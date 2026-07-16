import assert from 'node:assert/strict'
import test from 'node:test'

import { createCalibrationStartCoordinator } from './calibration/start-coordinator.js'

test('calibration starts on the exact panel-bound tab without querying another tab', async () => {
  const boundTab = { id: 44, url: 'https://chat.example/thread' }
  let received
  const start = createCalibrationStartCoordinator({
    resolvePanelTab: async (sender) => {
      assert.equal(sender.documentId, 'panel-document')
      return boundTab
    },
    inspectSite: () => ({ kind: 'web', origin: 'https://chat.example' }),
    hasAccess: async () => true,
    start: async (operation) => {
      received = operation
      return { stage: 'starting' }
    },
  })
  await start({ requestId: 'request-44' }, { documentId: 'panel-document' })
  assert.deepEqual(received, {
    requestId: 'request-44',
    tab: boundTab,
    origin: 'https://chat.example',
    mode: 'replace',
  })
})

test('restricted and unpermitted panel tabs fail before calibration starts', async () => {
  let starts = 0
  const restricted = createCalibrationStartCoordinator({
    resolvePanelTab: async () => ({ id: 1, url: 'chrome://extensions' }),
    inspectSite: () => ({ kind: 'restricted' }),
    hasAccess: async () => true,
    start: async () => { starts += 1 },
  })
  await assert.rejects(() => restricted({ requestId: 'a' }, {}), /browser page/)

  const denied = createCalibrationStartCoordinator({
    resolvePanelTab: async () => ({ id: 2, url: 'https://example.com' }),
    inspectSite: () => ({ kind: 'web', origin: 'https://example.com' }),
    hasAccess: async () => false,
    start: async () => { starts += 1 },
  })
  await assert.rejects(() => denied({ requestId: 'b' }, {}), /Permission/)
  assert.equal(starts, 0)
})
