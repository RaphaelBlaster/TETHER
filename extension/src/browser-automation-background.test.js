import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBrowserAutomation,
  shouldRetryDeepSeekSubmission,
  submissionMethodForProvider,
} from './automation/browser-automation.js'

test('uses keyboard submission only for DeepSeek', () => {
  assert.equal(submissionMethodForProvider('deepseek'), 'keyboard_enter')
  assert.equal(submissionMethodForProvider('chatgpt'), 'pointer')
  assert.equal(submissionMethodForProvider('gemini'), 'pointer')
  assert.equal(submissionMethodForProvider(null), 'pointer')
})

test('retries DeepSeek Enter only while the exact prompt remains untouched', () => {
  const untouched = {
    submitted: false,
    evidence: {
      composerChanged: false,
      composerLength: 2113,
      userIncreased: false,
      promptSeenInUser: false,
      stopVisible: false,
      asstIncreased: false,
    },
  }

  assert.equal(shouldRetryDeepSeekSubmission(untouched, 2113), true)
  assert.equal(shouldRetryDeepSeekSubmission({
    ...untouched,
    evidence: { ...untouched.evidence, composerChanged: true },
  }, 2113), false)
  assert.equal(shouldRetryDeepSeekSubmission({
    ...untouched,
    evidence: { ...untouched.evidence, stopVisible: true },
  }, 2113), false)
  assert.equal(shouldRetryDeepSeekSubmission(untouched, 2114), false)
})

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
