import assert from 'node:assert/strict'
import test from 'node:test'

import { createBrowserAutomation } from './automation/browser-automation.js'

test('wakes a hidden provider target before reading or writing its DOM', async () => {
  const commands = []
  const transport = {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_tabId, method, params = {}) => {
      commands.push({ method, params })
      if (method === 'Runtime.evaluate') throw Object.assign(new Error('stop after wake verification'), { code: 'test_stop' })
      return {}
    },
  }
  const automation = createBrowserAutomation({ transport })

  await assert.rejects(() => automation.request({
    requestId: 'background-tab-request',
    browserSessionId: 'background-tab-session',
    extensionInstanceId: 'test-extension',
    tabId: 42,
    origin: 'https://chatgpt.com',
    providerId: 'chatgpt',
    prompt: 'test',
  }), /stop after wake verification/)

  assert.deepEqual(commands.slice(0, 3), [
    { method: 'Page.enable', params: {} },
    { method: 'Page.setWebLifecycleState', params: { state: 'active' } },
    { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
  ])
})

test('continues when a browser does not support one wake command', async () => {
  const methods = []
  const transport = {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_tabId, method) => {
      methods.push(method)
      if (method === 'Page.setWebLifecycleState') throw new Error('unsupported')
      if (method === 'Runtime.evaluate') throw new Error('stop after wake verification')
      return {}
    },
  }
  const automation = createBrowserAutomation({ transport })

  await assert.rejects(() => automation.request({
    requestId: 'fallback-request',
    browserSessionId: 'fallback-session',
    extensionInstanceId: 'test-extension',
    tabId: 43,
    origin: 'https://gemini.google.com',
    providerId: 'gemini',
    prompt: 'test',
  }), /stop after wake verification/)

  assert.ok(methods.includes('Emulation.setFocusEmulationEnabled'))
  assert.ok(methods.includes('Runtime.evaluate'))
})
