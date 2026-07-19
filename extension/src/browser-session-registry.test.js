import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BROWSER_SESSIONS_KEY,
  LEGACY_TAB_ATTACHMENTS_KEY,
  SESSION_SCHEMA_KEY,
  SESSION_SCHEMA_VERSION,
  createBrowserSessionRegistry,
} from './browser-session-registry.js'

const calibration = { version: 1, origin: 'https://chatgpt.com' }
const profiles = { 'https://chatgpt.com': calibration }
const validCalibration = { valid: true, code: 'valid' }

function tab(id, url = 'https://chatgpt.com/', windowId = 1) {
  return { id, windowId, url }
}

function harness({ initial = {}, tabs = new Map(), uuids = [] } = {}) {
  let stored = structuredClone(initial)
  let uuidIndex = 0
  let clock = 1000
  const registry = createBrowserSessionRegistry({
    storage: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => key in stored).map((key) => [key, stored[key]]))
      },
      async set(value) {
        stored = { ...stored, ...structuredClone(value) }
      },
      async remove(key) {
        delete stored[key]
      },
    },
    getTab: async (tabId) => {
      if (!tabs.has(tabId)) throw new Error('No tab')
      return tabs.get(tabId)
    },
    uuid: () => uuids[uuidIndex++] ?? `session-${uuidIndex}`,
    now: () => clock++,
  })
  return { registry, stored: () => stored }
}

test('rejects unsupported activation but allows a built-in provider without calibration', async () => {
  const { registry } = harness()
  await registry.initialize()
  await assert.rejects(() => registry.activate(tab(1, 'chrome://extensions'), profiles, validCalibration), { code: 'restricted_tab' })
  assert.equal((await registry.activate(tab(1), {}, null)).providerId, 'chatgpt')
})

test('explicit activation is idempotent for one tab', async () => {
  const { registry } = harness({ uuids: ['browser-a'] })
  await registry.initialize()
  const first = await registry.activate(tab(1), profiles, validCalibration)
  const second = await registry.activate(tab(1), profiles, validCalibration)
  assert.equal(first.browserSessionId, 'browser-a')
  assert.equal(second.browserSessionId, first.browserSessionId)
  assert.equal(registry.list().length, 1)
})

test('two identical provider conversations in two tabs receive distinct sessions', async () => {
  const { registry } = harness({ uuids: ['browser-a', 'browser-b'] })
  await registry.initialize()
  const first = await registry.activate(tab(1, 'https://chatgpt.com/c/same'), profiles, validCalibration, { transportMode: 'CROSS', role: 'MASTER' })
  const second = await registry.activate(tab(2, 'https://chatgpt.com/c/same'), profiles, validCalibration, { transportMode: 'CROSS', role: 'SLAVE' })
  assert.notEqual(first.browserSessionId, second.browserSessionId)
  assert.equal(first.conversationId, 'same')
  assert.equal(second.conversationId, 'same')
})

test('concurrent CLI activation creates exactly one endpoint', async () => {
  const { registry } = harness({ uuids: ['browser-a', 'browser-b'] })
  await registry.initialize()
  const results = await Promise.allSettled([
    registry.activate(tab(1), profiles, validCalibration),
    registry.activate(tab(2), profiles, validCalibration),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'cli_endpoint_exists').length, 1)
  assert.equal(registry.list().length, 1)
})

test('stable conversation navigation preserves browserSessionId', async () => {
  const { registry } = harness({ uuids: ['browser-a'] })
  await registry.initialize()
  const created = await registry.activate(tab(1), profiles, validCalibration)
  const updated = await registry.updateTab(tab(1, 'https://chatgpt.com/c/assigned'))
  assert.equal(updated.browserSessionId, created.browserSessionId)
  assert.equal(updated.conversationId, 'assigned')
  assert.equal(updated.createdAt, created.createdAt)
})

test('unsupported navigation and tab closure remove only the matching session', async () => {
  const { registry } = harness({ uuids: ['browser-a', 'browser-b'] })
  await registry.initialize()
  await registry.activate(tab(1), profiles, validCalibration, { transportMode: 'CROSS', role: 'MASTER' })
  await registry.activate(tab(2), profiles, validCalibration, { transportMode: 'CROSS', role: 'SLAVE' })
  await registry.updateTab(tab(1, 'https://example.com'))
  assert.equal(registry.getByTabId(1), null)
  assert.notEqual(registry.getByTabId(2), null)
  await registry.removeByTabId(2)
  assert.equal(registry.list().length, 0)
})

test('unknown calibrated origin activates without a provider adapter', async () => {
  const genericProfile = { version: 1, origin: 'https://support.example.com' }
  const { registry } = harness({ uuids: ['browser-generic'] })
  await registry.initialize()
  const session = await registry.activate(
    tab(7, 'https://support.example.com/chat'),
    { 'https://support.example.com': genericProfile },
    validCalibration,
  )
  assert.equal(session.providerId, 'site:https://support.example.com')
  assert.equal(session.origin, 'https://support.example.com')
  assert.equal(session.conversationId, null)
})

test('CROSS records one MASTER and one SLAVE and rejects a duplicate role', async () => {
  const supportProfile = { version: 1, origin: 'https://support.example.com' }
  const { registry } = harness({ uuids: ['browser-master', 'browser-slave', 'browser-extra'] })
  await registry.initialize()
  const master = await registry.activate(tab(1, 'https://gemini.google.com/app'), {}, null, { transportMode: 'CROSS', role: 'MASTER' })
  const slave = await registry.activate(tab(2, 'https://support.example.com/chat'), { 'https://support.example.com': supportProfile }, validCalibration, { transportMode: 'CROSS', role: 'SLAVE' })
  assert.equal(master.role, 'MASTER')
  assert.equal(slave.role, 'SLAVE')
  await assert.rejects(() => registry.activate(tab(3, 'https://chatgpt.com/'), {}, null, { transportMode: 'CROSS', role: 'MASTER' }), { code: 'cross_pair_complete' })
})

test('an active CROSS endpoint can change role when that role is available', async () => {
  const { registry } = harness({ uuids: ['browser-a', 'browser-b'] })
  await registry.initialize()
  await registry.activate(tab(1, 'https://gemini.google.com/app'), {}, null, { transportMode: 'CROSS', role: 'MASTER' })
  assert.equal((await registry.setRole(1, 'SLAVE')).role, 'SLAVE')
  await registry.activate(tab(2, 'https://chatgpt.com/'), {}, null, { transportMode: 'CROSS', role: 'MASTER' })
  await assert.rejects(() => registry.setRole(2, 'SLAVE'), { code: 'cross_role_taken' })
})

test('restart reconciliation preserves valid sessions and removes missing sessions', async () => {
  const valid = {
    schemaVersion: 1,
    browserSessionId: 'browser-a',
    tabId: 1,
    windowId: 1,
    providerId: 'chatgpt',
    origin: 'https://chatgpt.com',
    conversationId: null,
    calibrationKey: 'https://chatgpt.com',
    status: 'active',
    createdAt: 10,
    lastSeenAt: 10,
  }
  const missing = { ...valid, browserSessionId: 'browser-b', tabId: 2 }
  const { registry, stored } = harness({
    initial: {
      [SESSION_SCHEMA_KEY]: SESSION_SCHEMA_VERSION,
      [BROWSER_SESSIONS_KEY]: { 'browser-a': valid, 'browser-b': missing },
      [LEGACY_TAB_ATTACHMENTS_KEY]: { 99: { tabId: 99 } },
    },
    tabs: new Map([[1, tab(1, 'https://chatgpt.com/c/restored')]]),
  })
  await registry.initialize()
  assert.equal(registry.list().length, 1)
  assert.equal(registry.getByTabId(1).conversationId, 'restored')
  assert.equal(stored()[LEGACY_TAB_ATTACHMENTS_KEY], undefined)
})

test('sender tab identity is authoritative', async () => {
  const { registry } = harness({ uuids: ['browser-a'] })
  await registry.initialize()
  await registry.activate(tab(1), profiles, validCalibration)
  assert.equal(registry.assertSender('browser-a', 1).tabId, 1)
  assert.throws(() => registry.assertSender('browser-a', 2), { code: 'session_tab_mismatch' })
})
