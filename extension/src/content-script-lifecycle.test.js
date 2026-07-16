import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensureTetherContentScript,
  resetStaleTetherContentScript,
} from './content-script-lifecycle.js'

test('uses an already responsive content script without reinjecting it', async () => {
  const executions = []
  const ready = await ensureTetherContentScript({
    tabId: 7,
    executeScript: async (details) => executions.push(details),
    sendTabMessage: async () => ({ ok: true, version: 34 }),
  })

  assert.equal(ready.ok, true)
  assert.deepEqual(executions, [])
})

test('clears stale page markers and reinjects when the receiver disappeared', async () => {
  const executions = []
  let attempts = 0
  const ready = await ensureTetherContentScript({
    tabId: 9,
    executeScript: async (details) => executions.push(details),
    sendTabMessage: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Could not establish connection. Receiving end does not exist.')
      return { ok: true, version: 34 }
    },
  })

  assert.equal(ready.ok, true)
  assert.equal(executions.length, 2)
  assert.equal(executions[0].func, resetStaleTetherContentScript)
  assert.deepEqual(executions[1], { target: { tabId: 9 }, files: ['content-script.js'] })
})

test('fails clearly when a freshly injected receiver still does not acknowledge', async () => {
  await assert.rejects(() => ensureTetherContentScript({
    tabId: 11,
    executeScript: async () => {},
    sendTabMessage: async () => ({ ok: false }),
  }), { code: 'endpoint_not_ready' })
})
