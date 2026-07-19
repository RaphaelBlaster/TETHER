import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldBindPanelToActivation } from './panel-binding-policy.js'

test('binds only tab activations from the side panel owning window', () => {
  assert.equal(shouldBindPanelToActivation(7, { windowId: 7, tabId: 41 }), true)
  assert.equal(shouldBindPanelToActivation(7, { windowId: 8, tabId: 42 }), false)
  assert.equal(shouldBindPanelToActivation(null, { windowId: 7, tabId: 41 }), false)
})
