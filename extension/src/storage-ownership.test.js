import assert from 'node:assert/strict'
import test from 'node:test'

import { createBrowserSessionRegistry } from './browser-session-registry.js'

function sessionStorage(initial = {}) {
  let value = structuredClone(initial)
  return {
    area: {
      async get(keys) {
        return Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, value[key]]))
      },
      async set(patch) {
        value = { ...value, ...structuredClone(patch) }
      },
      async remove(key) {
        delete value[key]
      },
    },
  }
}

test('session initialization and removal cannot delete durable calibration profiles', async () => {
  const calibrationProfiles = {
    'https://chatgpt.com': {
      version: 1,
      origin: 'https://chatgpt.com',
      composer: { preserved: true },
      send: { preserved: true },
    },
  }
  const before = structuredClone(calibrationProfiles)
  const session = sessionStorage()
  const registry = createBrowserSessionRegistry({
    storage: session.area,
    getTab: async () => { throw new Error('missing') },
  })
  await registry.initialize()
  await registry.removeByTabId(1)
  assert.deepEqual(calibrationProfiles, before)
})
