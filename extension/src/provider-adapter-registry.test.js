import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_MANIFEST_BYTES,
  createDriftReport,
  createPackagedProviderManifests,
  createProviderAdapterRegistry,
  validateProviderAdapterManifest,
} from './provider-adapter-registry.js'
import { PROVIDERS } from './provider-registry.js'

const ORIGIN = 'https://tinker.thinkingmachines.ai'

function manifest(adapterVersion = 1) {
  return {
    schemaVersion: 1,
    origin: ORIGIN,
    adapterVersion,
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
  }
}

test('strict manifest validation rejects malformed, wrong-origin, oversized, and unsafe input', () => {
  assert.equal(validateProviderAdapterManifest(manifest(), ORIGIN).origin, ORIGIN)
  assert.throws(
    () => validateProviderAdapterManifest({ ...manifest(), extra: true }, ORIGIN),
    { code: 'manifest_schema_invalid' },
  )
  assert.throws(
    () => validateProviderAdapterManifest({ ...manifest(), origin: 'https://evil.example' }, ORIGIN),
    { code: 'manifest_origin_mismatch' },
  )
  assert.throws(
    () => validateProviderAdapterManifest({
      ...manifest(),
      composer: { selectors: ['script { color: red }'] },
    }, ORIGIN),
    { code: 'manifest_selector_unsafe' },
  )
  assert.throws(
    () => validateProviderAdapterManifest(JSON.stringify(manifest()).padEnd(MAX_MANIFEST_BYTES + 1), ORIGIN),
    { code: 'manifest_too_large' },
  )
})

test('unavailable registry falls back to the packaged adapter', async () => {
  const packaged = manifest(1)
  const registry = createProviderAdapterRegistry({
    packagedManifests: [packaged],
    fetchManifest: async () => { throw new Error('offline') },
    storage: memoryStorage(),
  })
  const resolved = await registry.resolve(ORIGIN, { refresh: true })
  assert.equal(resolved.adapterVersion, 1)
  assert.equal(resolved.source, 'packaged')
})

test('packaged adapters preserve all four built-in providers', async () => {
  const registry = createProviderAdapterRegistry({
    packagedManifests: createPackagedProviderManifests(PROVIDERS),
    storage: memoryStorage(),
  })
  for (const origin of [
    'https://chatgpt.com',
    'https://gemini.google.com',
    'https://claude.ai',
    'https://chat.deepseek.com',
  ]) {
    const resolved = await registry.resolve(origin)
    assert.equal(resolved.source, 'packaged')
    assert.ok(resolved.composer.selectors.length > 0)
    assert.ok(resolved.send.selectors.length > 0)
    assert.ok(resolved.response.turnSelectors.length > 0)
  }
})

test('a malformed update preserves last-known-good and supports version rollback', async () => {
  const storage = memoryStorage()
  const updates = [
    manifest(2),
    { ...manifest(3), origin: 'https://evil.example' },
  ]
  const registry = createProviderAdapterRegistry({
    packagedManifests: [manifest(1)],
    fetchManifest: async () => ({
      manifest: updates.shift(),
      etag: '"fixture"',
    }),
    storage,
  })

  assert.equal((await registry.resolve(ORIGIN, { refresh: true })).adapterVersion, 2)
  assert.equal((await registry.resolve(ORIGIN, { refresh: true })).adapterVersion, 2)
  assert.equal((await registry.rollback(ORIGIN, 1)).adapterVersion, 1)
  assert.equal((await registry.resolve(ORIGIN)).adapterVersion, 1)
})

test('a page-invalid candidate can be rejected without losing the previous adapter', async () => {
  const registry = createProviderAdapterRegistry({
    packagedManifests: [manifest(1)],
    storage: memoryStorage(),
  })
  await registry.accept(ORIGIN, manifest(2))
  await registry.accept(ORIGIN, manifest(3))
  assert.equal((await registry.reject(ORIGIN, 3)).adapterVersion, 2)
  assert.equal((await registry.resolve(ORIGIN)).adapterVersion, 2)
})

test('registry timeout is bounded and the drift report contains metadata only', async () => {
  const registry = createProviderAdapterRegistry({
    packagedManifests: [manifest(1)],
    fetchManifest: () => new Promise(() => {}),
    storage: memoryStorage(),
    timeoutMs: 5,
  })
  assert.equal((await registry.resolve(ORIGIN, { refresh: true })).adapterVersion, 1)
  assert.deepEqual(
    createDriftReport({
      origin: ORIGIN,
      adapterVersion: 1,
      extensionVersion: '0.0.0',
      errorCode: 'assistant_selector_missing',
    }),
    {
      origin: ORIGIN,
      adapterVersion: 1,
      extensionVersion: '0.0.0',
      errorCode: 'assistant_selector_missing',
    },
  )
})

function memoryStorage() {
  const values = {}
  return {
    async get(key) {
      return { [key]: values[key] }
    },
    async set(next) {
      Object.assign(values, next)
    },
  }
}
