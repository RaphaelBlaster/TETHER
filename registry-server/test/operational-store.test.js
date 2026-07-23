import assert from 'node:assert/strict'
import test from 'node:test'

import { createOperationalStore } from '../src/operational-store.js'

test('memory operational store enforces rate and dedupe windows', async () => {
  let timestamp = 0
  const store = await createOperationalStore({ now: () => timestamp })

  assert.equal((await store.checkRateLimit('client', 2, 10)).allowed, true)
  assert.equal((await store.checkRateLimit('client', 2, 10)).allowed, true)
  assert.equal((await store.checkRateLimit('client', 2, 10)).allowed, false)

  assert.equal(await store.claimDedup('report', 10), true)
  assert.equal(await store.claimDedup('report', 10), false)
  timestamp = 10_001
  assert.equal(await store.claimDedup('report', 10), true)
})

test('Redis operational store uses expiring keys, cache and a job notification list', async () => {
  const fake = fakeRedisClient()
  const store = await createOperationalStore({
    redisUrl: 'redis://example.test:6379',
    createRedisClient: () => fake,
  })

  assert.equal(store.kind, 'redis')
  assert.equal((await store.checkRateLimit('client', 1, 60)).allowed, true)
  assert.equal((await store.checkRateLimit('client', 1, 60)).allowed, false)
  assert.equal(await store.claimDedup('report', 30), true)
  assert.equal(await store.claimDedup('report', 30), false)
  await store.setCache('manifest', '{"ok":true}', 60)
  assert.equal(await store.getCache('manifest'), '{"ok":true}')
  await store.enqueueMaintenanceJob({ id: 7 })
  assert.deepEqual(fake.lists.get('tether:maintenance:jobs'), ['{"id":7}'])
  await store.close()
  assert.equal(fake.isOpen, false)
})

function fakeRedisClient() {
  const strings = new Map()
  const counters = new Map()
  const ttls = new Map()
  const lists = new Map()
  return {
    strings,
    lists,
    isOpen: false,
    isReady: false,
    on() {},
    async connect() {
      this.isOpen = true
      this.isReady = true
    },
    async incr(key) {
      const value = (counters.get(key) ?? 0) + 1
      counters.set(key, value)
      return value
    },
    async expire(key, seconds) {
      ttls.set(key, seconds)
      return true
    },
    async ttl(key) {
      return ttls.get(key) ?? -1
    },
    async set(key, value, options = {}) {
      if (options.NX && strings.has(key)) return null
      strings.set(key, value)
      if (options.EX) ttls.set(key, options.EX)
      return 'OK'
    },
    async get(key) {
      return strings.get(key) ?? null
    },
    async lPush(key, value) {
      const list = lists.get(key) ?? []
      list.unshift(value)
      lists.set(key, list)
      return list.length
    },
    async quit() {
      this.isOpen = false
      this.isReady = false
    },
  }
}
