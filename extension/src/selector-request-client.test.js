import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SELECTOR_REQUEST_CACHE_KEY,
  createSelectorRequestClient,
  selectorRequestId,
} from './selector-request-client.js'

const ORIGIN = 'https://new-model.ai'

test('selector request client canonicalizes one idempotent request and reuses pending status', async () => {
  const storage = memoryStorage()
  const calls = []
  const requestId = await selectorRequestId(ORIGIN)
  const client = createSelectorRequestClient({
    baseUrl: 'https://tether-provider-registry.onrender.com',
    storage,
    extensionVersion: '0.1.0',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (options.method === 'GET') {
        return jsonResponse({
          requestId,
          origin: ORIGIN,
          status: 'not_requested',
          nextPollAfterSeconds: 300,
        })
      }
      return jsonResponse({
        requestId,
        origin: ORIGIN,
        status: 'pending',
        requestedAt: '2026-07-24T00:00:00.000Z',
        nextPollAfterSeconds: 300,
      }, 202)
    },
  })

  const [first, duplicate] = await Promise.all([
    client.request(ORIGIN),
    client.request(ORIGIN),
  ])
  assert.equal(first.status, 'pending')
  assert.deepEqual(duplicate, first)
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1)
  const post = calls.find((call) => call.options.method === 'POST')
  assert.equal(post.options.headers['Idempotency-Key'], requestId)
  assert.deepEqual(JSON.parse(post.options.body), {
    origin: ORIGIN,
    extensionVersion: '0.1.0',
    reason: 'missing_adapter',
    adapterVersion: 0,
  })

  assert.equal((await client.request(ORIGIN)).status, 'pending')
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1)
})

test('selector status cache is bounded and preserves stale pending state while offline', async () => {
  const storage = memoryStorage()
  let timestamp = 0
  const client = createSelectorRequestClient({
    baseUrl: 'https://registry.example',
    storage,
    extensionVersion: '0.1.0',
    now: () => timestamp,
    maxEntries: 2,
    fetchImpl: async (url) => {
      const origin = new URL(url).searchParams.get('origin')
      return jsonResponse({
        requestId: await selectorRequestId(origin),
        origin,
        status: 'pending',
        requestedAt: '2026-07-24T00:00:00.000Z',
        nextPollAfterSeconds: 30,
      })
    },
  })

  for (const origin of ['https://one.ai', 'https://two.ai', 'https://three.ai']) {
    timestamp += 1
    await client.status(origin, { refresh: true })
  }
  const cache = (await storage.get(SELECTOR_REQUEST_CACHE_KEY))[SELECTOR_REQUEST_CACHE_KEY]
  assert.deepEqual(Object.keys(cache.origins).sort(), ['https://three.ai', 'https://two.ai'])
})

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function memoryStorage() {
  const values = {}
  return {
    async get(key) {
      return { [key]: values[key] }
    },
    async set(next) {
      Object.assign(values, structuredClone(next))
    },
  }
}
