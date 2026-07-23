import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { validateProviderAdapterManifest } from '../../extension/src/provider-adapter-registry.js'

export function createRegistryCatalog({
  root,
  cache,
  database,
  now = () => Date.now(),
}) {
  let snapshot = null

  async function loadIndex() {
    const path = resolve(root, 'index.json')
    const metadata = await stat(path)
    if (snapshot && snapshot.modifiedAt === metadata.mtimeMs) return snapshot

    const body = await readFile(path, 'utf8')
    const index = validateIndex(JSON.parse(body))
    const sha256 = hash(body)
    snapshot = {
      body,
      index,
      sha256,
      etag: quoteEtag(sha256),
      modifiedAt: metadata.mtimeMs,
      loadedAt: now(),
    }
    database.recordPublication({
      registryVersion: index.registryVersion,
      generatedAt: index.generatedAt,
      indexSha256: sha256,
    })
    return snapshot
  }

  async function manifestForOrigin(origin) {
    const normalized = normalizeOrigin(origin)
    const current = await loadIndex()
    const descriptor = Object.values(current.index.providers)
      .find((provider) => provider.origin === normalized)
    if (!descriptor) return null

    const cacheKey = `manifest:${descriptor.sha256}`
    let body = await cache.getCache(cacheKey)
    if (body && hash(body) !== descriptor.sha256) body = null
    if (!body) {
      const path = safeRegistryPath(root, descriptor.url)
      body = await readFile(path, 'utf8')
      if (Buffer.byteLength(body, 'utf8') > 64 * 1024) {
        throw coded('manifest_too_large', 'Published provider adapter exceeds 64 KiB')
      }
      if (hash(body) !== descriptor.sha256) {
        throw coded('manifest_checksum_mismatch', 'Published provider adapter checksum does not match the index')
      }
      await cache.setCache(cacheKey, body, 60)
    }

    const manifest = validateProviderAdapterManifest(body, normalized)
    if (manifest.adapterVersion !== descriptor.adapterVersion) {
      throw coded('manifest_version_mismatch', 'Published provider adapter version does not match the index')
    }
    return {
      body,
      manifest,
      sha256: descriptor.sha256,
      etag: quoteEtag(descriptor.sha256),
    }
  }

  async function signature() {
    const body = await readFile(resolve(root, 'index.sig.json'), 'utf8')
    return { body, etag: quoteEtag(hash(body)) }
  }

  return { loadIndex, manifestForOrigin, signature }
}

function validateIndex(input) {
  if (!isObject(input) ||
      input.schemaVersion !== 1 ||
      !Number.isSafeInteger(input.registryVersion) ||
      input.registryVersion < 1 ||
      typeof input.generatedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.generatedAt)) ||
      !isObject(input.providers)) {
    throw coded('registry_index_invalid', 'Registry index has an invalid envelope')
  }

  for (const [host, descriptor] of Object.entries(input.providers)) {
    if (!/^[a-z0-9.-]{1,253}$/.test(host) ||
        !isObject(descriptor) ||
        !exactKeys(descriptor, ['origin', 'adapterVersion', 'url', 'sha256']) ||
        !Number.isSafeInteger(descriptor.adapterVersion) ||
        descriptor.adapterVersion < 1 ||
        typeof descriptor.url !== 'string' ||
        !/^\.\/sites\/[a-z0-9.-]+\.json$/.test(descriptor.url) ||
        typeof descriptor.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
      throw coded('registry_index_invalid', `Registry provider entry is invalid: ${host}`)
    }
    const origin = normalizeOrigin(descriptor.origin)
    if (new URL(origin).hostname !== host) {
      throw coded('registry_index_invalid', `Registry provider host does not match its origin: ${host}`)
    }
  }
  return input
}

function safeRegistryPath(root, relativePath) {
  const path = resolve(root, relativePath)
  const prefix = `${resolve(root)}${sep}`
  if (!path.startsWith(prefix)) throw coded('registry_path_invalid', 'Registry path escaped its root')
  return path
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value) throw new Error()
    return url.origin
  } catch {
    throw coded('origin_invalid', 'origin must be an exact HTTPS origin')
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function quoteEtag(value) {
  return `"${value}"`
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && keys.slice().sort().every((key, index) => actual[index] === key)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
