import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateProviderAdapterManifest } from '../../extension/src/provider-adapter-registry.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sitesDirectory = resolve(root, 'sites')
const files = (await readdir(sitesDirectory))
  .filter((name) => name.endsWith('.json'))
  .sort()

const providers = {}
for (const file of files) {
  const bytes = await readFile(resolve(sitesDirectory, file))
  const manifest = validateProviderAdapterManifest(bytes.toString('utf8'))
  const host = new URL(manifest.origin).hostname
  if (providers[host]) {
    throw new Error(`Duplicate registry host: ${host}`)
  }
  providers[host] = {
    origin: manifest.origin,
    adapterVersion: manifest.adapterVersion,
    url: `./sites/${file}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

const previous = await readJson(resolve(root, 'index.json'))
const providersChanged = JSON.stringify(previous?.providers ?? null) !== JSON.stringify(providers)
const registryVersion = parsePositiveInt(process.env.TETHER_REGISTRY_VERSION)
  ?? (providersChanged
    ? Math.max(1, (Number(previous?.registryVersion) || 0) + 1)
    : Math.max(1, Number(previous?.registryVersion) || 1))
if (providersChanged &&
    previous &&
    registryVersion <= previous.registryVersion) {
  throw new Error('A changed registry must increment TETHER_REGISTRY_VERSION')
}

const unsigned = {
  schemaVersion: 1,
  registryVersion,
  generatedAt: process.env.TETHER_REGISTRY_GENERATED_AT
    ?? (providersChanged ? new Date().toISOString() : previous?.generatedAt)
    ?? new Date().toISOString(),
  providers,
}
const canonical = `${JSON.stringify(unsigned, null, 2)}\n`
const privateKeyPem = process.env.TETHER_REGISTRY_PRIVATE_KEY
const signature = privateKeyPem
  ? sign(null, Buffer.from(canonical), createPrivateKey(privateKeyPem)).toString('base64url')
  : null

await writeFile(resolve(root, 'index.json'), canonical, 'utf8')
await writeFile(
  resolve(root, 'index.sig.json'),
  `${JSON.stringify({
    algorithm: 'Ed25519',
    keyId: process.env.TETHER_REGISTRY_KEY_ID ?? 'unsigned-development',
    signature,
  }, null, 2)}\n`,
  'utf8',
)

console.log(`Built registry index ${registryVersion} with ${files.length} provider manifests.`)
if (!signature) {
  console.log('Development index is unsigned. Set TETHER_REGISTRY_PRIVATE_KEY in trusted CI for production.')
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function parsePositiveInt(value) {
  if (value === undefined) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('TETHER_REGISTRY_VERSION must be a positive integer')
  }
  return parsed
}
