import assert from 'node:assert/strict'
import test from 'node:test'

import { createTabPanelController } from './tab-panel-controller.js'

function harness(activeSessionTabs = []) {
  const calls = []
  const active = new Set(activeSessionTabs)
  const sidePanel = {
    setOptions(value) {
      calls.push(['setOptions', value])
      return Promise.resolve()
    },
    open(value) {
      calls.push(['open', value])
      return Promise.resolve()
    },
  }
  return {
    calls,
    active,
    controller: createTabPanelController({
      sidePanel,
      hasSession: (tabId) => active.has(tabId),
    }),
  }
}

test('manual open configures and opens synchronously without activating a tab', async () => {
  const { controller, calls, active } = harness()
  const pending = controller.openManually({ id: 4, windowId: 1 })
  assert.deepEqual(calls, [
    ['setOptions', { tabId: 4, path: 'index.html', enabled: true }],
    ['open', { tabId: 4 }],
  ])
  assert.equal(active.has(4), false)
  await pending
})

test('switching away hides an inactive manual panel without touching active sessions', async () => {
  const { controller, calls } = harness([1])
  await controller.initialize([{ tabId: 1 }], [{ id: 1, windowId: 9 }])
  await controller.handleActivated({ tabId: 2, windowId: 9 })
  assert.deepEqual(calls.at(-1), [
    'setOptions',
    { tabId: 2, path: 'index.html', enabled: false },
  ])
})

test('returning to an activated tab enables its persistent panel', async () => {
  const { controller, calls } = harness([1])
  await controller.initialize([{ tabId: 1 }], [{ id: 2, windowId: 9 }])
  await controller.handleActivated({ tabId: 1, windowId: 9 })
  assert.deepEqual(calls.at(-1), [
    'setOptions',
    { tabId: 1, path: 'index.html', enabled: true },
  ])
})
