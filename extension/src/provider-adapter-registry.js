export const PROVIDER_ADAPTER_SCHEMA_VERSION = 1
export const PROVIDER_ADAPTER_ENGINE_VERSION = 1
export const PROVIDER_ADAPTER_CACHE_KEY = 'providerAdapterCacheV1'
export const MAX_MANIFEST_BYTES = 64 * 1024
export const DEFAULT_REGISTRY_TIMEOUT_MS = 3000

const MAX_SELECTOR_LENGTH = 300
const MAX_SELECTORS_PER_FIELD = 16
const MAX_CACHED_VERSIONS = 4
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'origin',
  'adapterVersion',
  'engineVersion',
  'composer',
  'send',
  'response',
  'completion',
])

export const TINKER_PACKAGED_MANIFEST = Object.freeze({
  schemaVersion: 1,
  origin: 'https://tinker.thinkingmachines.ai',
  adapterVersion: 1,
  engineVersion: 1,
  composer: { selectors: ['textarea[aria-label="Message"]'] },
  send: { selectors: ['button[aria-label="Send message"]'] },
  response: {
    turnSelectors: [
      'article:has(button[aria-label="View raw"]):has(button[aria-label="Copy request ID"])',
    ],
    contentSelectors: ['p'],
    excludeSelectors: ['[data-slot="collapsible"]'],
  },
  completion: {
    stopSelectors: ['button[aria-label="Stop generating"]'],
    progressSelectors: ['[role="status"]'],
  },
})

export function createPackagedProviderManifests(providers = []) {
  const manifests = providers.flatMap((provider) =>
    (provider.origins ?? []).map((origin) => ({
      schemaVersion: PROVIDER_ADAPTER_SCHEMA_VERSION,
      origin,
      adapterVersion: 1,
      engineVersion: PROVIDER_ADAPTER_ENGINE_VERSION,
      composer: { selectors: [...(provider.composerHints ?? [])] },
      send: { selectors: [...(provider.submitHints ?? [])] },
      response: {
        turnSelectors: [...(provider.assistantHints ?? [])],
        contentSelectors: [],
        excludeSelectors: [],
      },
      completion: {
        stopSelectors: [...(provider.stopHints ?? [])],
        progressSelectors: [],
      },
    })),
  )
  return [...manifests, TINKER_PACKAGED_MANIFEST]
}

export function validateProviderAdapterManifest(input, expectedOrigin) {
  const serialized = typeof input === 'string' ? input : JSON.stringify(input)
  if (byteLength(serialized) > MAX_MANIFEST_BYTES) {
    throw coded('manifest_too_large', `Provider adapter exceeds ${MAX_MANIFEST_BYTES} bytes`)
  }

  let manifest
  try {
    manifest = typeof input === 'string' ? JSON.parse(input) : JSON.parse(serialized)
  } catch {
    throw coded('manifest_json_invalid', 'Provider adapter must be valid JSON')
  }

  assertExactObject(manifest, MANIFEST_KEYS, 'manifest')
  if (manifest.schemaVersion !== PROVIDER_ADAPTER_SCHEMA_VERSION) {
    throw coded('manifest_schema_unsupported', 'Unsupported provider adapter schema version')
  }
  if (manifest.engineVersion !== PROVIDER_ADAPTER_ENGINE_VERSION) {
    throw coded('manifest_engine_unsupported', 'Provider adapter requires an unsupported engine')
  }
  if (!Number.isSafeInteger(manifest.adapterVersion) || manifest.adapterVersion < 1) {
    throw coded('manifest_schema_invalid', 'adapterVersion must be a positive integer')
  }

  let origin
  try {
    const parsed = new URL(manifest.origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== manifest.origin) throw new Error()
    origin = parsed.origin
  } catch {
    throw coded('manifest_schema_invalid', 'origin must be an exact HTTP(S) origin')
  }
  if (expectedOrigin && origin !== new URL(expectedOrigin).origin) {
    throw coded('manifest_origin_mismatch', 'Provider adapter origin does not match the target page')
  }

  assertSelectorGroup(manifest.composer, 'composer', true)
  assertSelectorGroup(manifest.send, 'send', true)
  assertExactObject(
    manifest.response,
    new Set(['turnSelectors', 'contentSelectors', 'excludeSelectors']),
    'response',
  )
  assertSelectors(manifest.response.turnSelectors, 'response.turnSelectors', true)
  assertSelectors(manifest.response.contentSelectors, 'response.contentSelectors', false)
  assertSelectors(manifest.response.excludeSelectors, 'response.excludeSelectors', false)
  assertExactObject(
    manifest.completion,
    new Set(['stopSelectors', 'progressSelectors']),
    'completion',
  )
  assertSelectors(manifest.completion.stopSelectors, 'completion.stopSelectors', false)
  assertSelectors(manifest.completion.progressSelectors, 'completion.progressSelectors', false)
  return deepFreeze(manifest)
}

export function createProviderAdapterRegistry({
  packagedManifests = [],
  storage = null,
  fetchManifest = null,
  timeoutMs = DEFAULT_REGISTRY_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const packaged = new Map()
  for (const candidate of packagedManifests) {
    const manifest = validateProviderAdapterManifest(candidate, candidate?.origin)
    packaged.set(manifest.origin, manifest)
  }
  let cachePromise = null

  async function loadCache() {
    if (!cachePromise) {
      cachePromise = (async () => {
        if (!storage) return { origins: {} }
        const stored = await storage.get(PROVIDER_ADAPTER_CACHE_KEY)
        const value = stored?.[PROVIDER_ADAPTER_CACHE_KEY]
        return value && isObject(value.origins) ? value : { origins: {} }
      })()
    }
    return cachePromise
  }

  async function persist(cache) {
    if (storage) await storage.set({ [PROVIDER_ADAPTER_CACHE_KEY]: cache })
  }

  function packagedFor(origin) {
    return packaged.get(normalizeOrigin(origin)) ?? null
  }

  async function current(origin) {
    const normalized = normalizeOrigin(origin)
    const cache = await loadCache()
    const entry = cache.origins[normalized]
    const cached = entry?.versions?.[entry.activeVersion]?.manifest
    if (cached) {
      try {
        return withSource(validateProviderAdapterManifest(cached, normalized), entry.activeVersion === entry.rollbackVersion ? 'rollback' : 'cache')
      } catch {
        // Ignore corrupted local cache and retain the immutable packaged copy.
      }
    }
    const fallback = packagedFor(normalized)
    return fallback ? withSource(fallback, 'packaged') : null
  }

  async function resolve(origin, { refresh = false } = {}) {
    const normalized = normalizeOrigin(origin)
    const fallback = await current(normalized)
    if (!refresh || typeof fetchManifest !== 'function') return fallback

    const cache = await loadCache()
    const entry = cache.origins[normalized]
    let remote
    try {
      remote = await timedFetch(fetchManifest, {
        origin: normalized,
        etag: entry?.etag ?? null,
        timeoutMs,
      })
      if (remote?.notModified) return fallback
      const manifest = validateProviderAdapterManifest(remote?.manifest ?? remote, normalized)
      if (fallback && manifest.adapterVersion <= fallback.adapterVersion) {
        if (remote?.etag && entry?.etag !== remote.etag) {
          cache.origins[normalized] = {
            ...(entry ?? { versions: {} }),
            etag: remote.etag,
            checkedAt: now(),
          }
          await persist(cache)
        }
        return fallback
      }
      await accept(normalized, manifest, { etag: remote?.etag ?? null })
      return withSource(manifest, 'remote')
    } catch {
      return fallback
    }
  }

  async function accept(origin, input, { etag = null } = {}) {
    const normalized = normalizeOrigin(origin)
    const manifest = validateProviderAdapterManifest(input, normalized)
    const cache = await loadCache()
    const previous = cache.origins[normalized] ?? { versions: {} }
    const versions = {
      ...previous.versions,
      [manifest.adapterVersion]: {
        manifest,
        etag,
        acceptedAt: now(),
      },
    }
    trimVersions(versions, manifest.adapterVersion)
    cache.origins[normalized] = {
      ...previous,
      previousActiveVersion: previous.activeVersion ?? packagedFor(normalized)?.adapterVersion ?? null,
      activeVersion: manifest.adapterVersion,
      rollbackVersion: null,
      etag,
      versions,
    }
    await persist(cache)
    return withSource(manifest, 'cache')
  }

  async function reject(origin, adapterVersion) {
    const normalized = normalizeOrigin(origin)
    const cache = await loadCache()
    const entry = cache.origins[normalized]
    if (!entry || entry.activeVersion !== adapterVersion) return current(normalized)
    const rejected = { ...(entry.rejectedVersions ?? {}), [adapterVersion]: now() }
    const previous = entry.previousActiveVersion
    if (previous && entry.versions?.[previous]) {
      entry.activeVersion = previous
      entry.rollbackVersion = previous
    } else {
      delete cache.origins[normalized]
    }
    if (cache.origins[normalized]) cache.origins[normalized].rejectedVersions = rejected
    await persist(cache)
    return current(normalized)
  }

  async function rollback(origin, adapterVersion) {
    const normalized = normalizeOrigin(origin)
    const cache = await loadCache()
    const entry = cache.origins[normalized] ?? { versions: {} }
    let target = entry.versions?.[adapterVersion]?.manifest ?? null
    const packagedTarget = packagedFor(normalized)
    if (!target && packagedTarget?.adapterVersion === adapterVersion) target = packagedTarget
    if (!target) throw coded('adapter_version_missing', 'Requested provider adapter version is unavailable')
    const validated = validateProviderAdapterManifest(target, normalized)
    entry.versions = {
      ...entry.versions,
      [adapterVersion]: entry.versions?.[adapterVersion] ?? {
        manifest: validated,
        etag: null,
        acceptedAt: now(),
      },
    }
    entry.previousActiveVersion = entry.activeVersion ?? null
    entry.activeVersion = adapterVersion
    entry.rollbackVersion = adapterVersion
    cache.origins[normalized] = entry
    await persist(cache)
    return withSource(validated, 'rollback')
  }

  return {
    resolve,
    accept,
    reject,
    rollback,
    getPackaged: packagedFor,
  }
}

export function createHttpProviderAdapterClient({
  endpointForOrigin,
  fetchImpl = fetch,
  maxBytes = MAX_MANIFEST_BYTES,
} = {}) {
  if (typeof endpointForOrigin !== 'function') {
    throw new TypeError('endpointForOrigin is required')
  }
  return async function fetchManifest({ origin, etag, signal }) {
    const endpoint = endpointForOrigin(origin)
    const headers = { Accept: 'application/json' }
    if (etag) headers['If-None-Match'] = etag
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers,
      signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    })
    if (response.status === 304) return { notModified: true }
    if (!response.ok) throw coded('registry_unavailable', `Registry returned HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw coded('manifest_too_large', `Provider adapter exceeds ${maxBytes} bytes`)
    }
    const text = await response.text()
    if (byteLength(text) > maxBytes) {
      throw coded('manifest_too_large', `Provider adapter exceeds ${maxBytes} bytes`)
    }
    return { manifest: text, etag: response.headers.get('etag') }
  }
}

export function createProviderAdapterEndpointResolver(baseUrl) {
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new TypeError('Provider adapter registry URL is invalid')
  }
  if (base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash) {
    throw new TypeError('Provider adapter registry must be an HTTPS base URL')
  }
  return function endpointForOrigin(origin) {
    const endpoint = new URL('/v1/adapters', base)
    endpoint.searchParams.set('origin', normalizeOrigin(origin))
    return endpoint.href
  }
}

export function buildAdapterPageValidationScript(manifest) {
  const composer = manifest?.composer?.selectors ?? []
  const send = manifest?.send?.selectors ?? []
  return `(() => {
    const composerSelectors = ${JSON.stringify(composer)};
    const sendSelectors = ${JSON.stringify(send)};
    function matches(selectors) {
      const found = [];
      for (const selector of selectors) {
        try {
          for (const element of document.querySelectorAll(selector)) {
            if (!found.includes(element)) found.push(element);
          }
        } catch (_) { return { invalidSelector: true, count: 0 }; }
      }
      return { invalidSelector: false, count: found.length };
    }
    const composer = matches(composerSelectors);
    const send = matches(sendSelectors);
    return {
      valid: !composer.invalidSelector && !send.invalidSelector &&
        composer.count === 1 && send.count <= 1,
      composerCount: composer.count,
      sendCount: send.count,
      invalidSelector: composer.invalidSelector || send.invalidSelector,
    };
  })()`
}

export function createDriftReport({
  origin,
  adapterVersion,
  extensionVersion,
  errorCode,
}) {
  const normalized = normalizeOrigin(origin)
  if (!Number.isSafeInteger(adapterVersion) || adapterVersion < 1) {
    throw coded('drift_report_invalid', 'adapterVersion is invalid')
  }
  if (typeof extensionVersion !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(extensionVersion)) {
    throw coded('drift_report_invalid', 'extensionVersion is invalid')
  }
  if (typeof errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) {
    throw coded('drift_report_invalid', 'errorCode is invalid')
  }
  return { origin: normalized, adapterVersion, extensionVersion, errorCode }
}

function assertSelectorGroup(value, name, required) {
  assertExactObject(value, new Set(['selectors']), name)
  assertSelectors(value.selectors, `${name}.selectors`, required)
}

function assertSelectors(value, name, required) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > MAX_SELECTORS_PER_FIELD) {
    throw coded('manifest_schema_invalid', `${name} must be a bounded selector array`)
  }
  for (const selector of value) {
    if (
      typeof selector !== 'string' ||
      selector.length === 0 ||
      selector.length > MAX_SELECTOR_LENGTH ||
      hasUnsafeSelectorCharacter(selector)
    ) {
      throw coded('manifest_selector_unsafe', `${name} contains an unsafe selector`)
    }
  }
}

function assertExactObject(value, allowed, name) {
  if (!isObject(value) || Object.keys(value).some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => !(key in value))) {
    throw coded('manifest_schema_invalid', `${name} does not match the strict schema`)
  }
}

function hasUnsafeSelectorCharacter(selector) {
  for (const character of selector) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127 || '{}@'.includes(character)) return true
  }
  return false
}

async function timedFetch(fetchManifest, { origin, etag, timeoutMs }) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      fetchManifest({ origin, etag, signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(coded('registry_timeout', 'Provider adapter registry timed out'))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function trimVersions(versions, activeVersion) {
  const ordered = Object.keys(versions).map(Number).sort((a, b) => b - a)
  for (const version of ordered.slice(MAX_CACHED_VERSIONS)) {
    if (version !== activeVersion) delete versions[version]
  }
}

function normalizeOrigin(value) {
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    return parsed.origin
  } catch {
    throw coded('manifest_origin_invalid', 'A valid HTTP(S) origin is required')
  }
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

function withSource(manifest, source) {
  return { ...manifest, source }
}

function deepFreeze(value) {
  Object.freeze(value)
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child)
  }
  return value
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
