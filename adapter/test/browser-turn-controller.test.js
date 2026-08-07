import assert from 'node:assert/strict'
import test from 'node:test'
import {
  codexRequestId,
  createBrowserTurnController,
  observedComposerPromptBudget,
} from '../src/browser-turn-controller.js'

const request = {
  type: 'response.create',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same input' }] }],
}

test('request identity is stable within one Codex connection', () => {
  assert.equal(codexRequestId(request, 'conn-1'), codexRequestId(request, 'conn-1'))
})

test('identical requests from separate Codex connections do not collide', () => {
  assert.notEqual(codexRequestId(request, 'conn-1'), codexRequestId(request, 'conn-2'))
})

test('derives a safe retry budget from extension prompt-retention evidence', () => {
  assert.equal(observedComposerPromptBudget({
    code: 'prompt_verification_failed',
    message: 'Composer did not contain the exact prompt after write ({"expectedLength":42958,"actualLength":32351,"normalizedExpectedLength":42382,"normalizedActualLength":31744})',
  }), 29_696)
  assert.equal(observedComposerPromptBudget({ code: 'other', message: '{}' }), null)
})

test('Gemini receives an oversized compact turn as acknowledged chunks before execution', async () => {
  const sent = []
  const peer = { sendJson: (message) => sent.push(message) }
  let conversation = { bootstrapVersion: 12, installedInstallKeys: [] }
  const controller = createBrowserTurnController({
    timeoutMs: 1_000,
    bootstrapTimeoutMs: 1_000,
    registry: {
      selectExactlyOne() {
        return {
          registration: { extensionInstanceId: 'extension-large', peer },
          session: {
            browserSessionId: 'browser-large',
            origin: 'https://gemini.google.com',
            providerId: 'gemini',
            conversationId: 'conversation-large',
          },
        }
      },
    },
    stateStore: {
      async get() { return conversation },
      async set(_key, value) { conversation = value },
    },
  })
  const longText = 'complete every exact step\n'.repeat(2_000)
  const pending = controller.request({
    ...request,
    model: 'tether-compact',
    tools: [],
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: longText }] }],
  }, { connectionId: 'xpose:http' })
  await new Promise((resolve) => setTimeout(resolve, 0))

  let reconstructed = ''
  let cursor = 0
  while (true) {
    const message = sent[cursor++]
    assert.equal(message.type, 'browser_request')
    assert.ok(message.payload.prompt.length <= 28_000)
    const payload = JSON.parse(message.payload.prompt)
    if (payload.type === 'tether_install') {
      reconstructed += payload.patches[0].value
      await controller.complete({
        type: 'browser_completed',
        browserSessionId: message.browserSessionId,
        requestId: message.requestId,
        payload: { text: 'Gemini said\nTETHER_INSTALL_OK' },
      }, peer, 'extension-large')
      continue
    }
    assert.equal(payload.type, 'tether_deferred_execute')
    assert.equal(payload.finalChunk, undefined)
    assert.ok(message.payload.prompt.length < 1_000)
    await controller.complete({
      type: 'browser_completed',
      browserSessionId: message.browserSessionId,
      requestId: message.requestId,
      payload: { text: 'completed long objective' },
    }, peer, 'extension-large')
    break
  }

  assert.equal(JSON.parse(reconstructed).turn.input[0].content[0].text, longText)
  assert.equal((await pending).content, 'completed long objective')
  assert.deepEqual(conversation.installedInstallKeys, [])
})

test('an unknown provider can adaptively defer after the extension reports truncation', async () => {
  const sent = []
  const peer = { sendJson: (message) => sent.push(message) }
  const controller = createBrowserTurnController({
    timeoutMs: 1_000,
    bootstrapTimeoutMs: 1_000,
    registry: {
      selectExactlyOne() {
        return {
          registration: { extensionInstanceId: 'extension-adaptive', peer },
          session: {
            browserSessionId: 'browser-adaptive', origin: 'https://chat.example',
            providerId: 'example', conversationId: 'conversation-adaptive',
          },
        }
      },
    },
    stateStore: { async get() { return { bootstrapVersion: 12 } }, async set() {} },
  })
  const abort = new AbortController()
  const pending = controller.request({
    ...request,
    model: 'tether-compact',
    tools: [],
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x'.repeat(40_000) }] }],
  }, { connectionId: 'adaptive', signal: abort.signal })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const initial = sent[0]
  assert.doesNotMatch(initial.payload.prompt, /tether_install/)

  await controller.complete({
    type: 'browser_error',
    browserSessionId: initial.browserSessionId,
    requestId: initial.requestId,
    error: {
      code: 'prompt_verification_failed',
      message: 'Composer did not contain the exact prompt after write ({"expectedLength":40200,"actualLength":32000,"normalizedActualLength":31744})',
    },
  }, peer, 'extension-adaptive')
  assert.equal(JSON.parse(sent[1].payload.prompt).type, 'tether_install')
  assert.notEqual(sent[1].requestId, initial.requestId)
  abort.abort()
  await assert.rejects(pending, { code: 'request_cancelled' })
})

test('aborting a local API request sends one correlated browser cancellation', async () => {
  const sent = []
  const peer = { sendJson: (message) => sent.push(message) }
  const controller = createBrowserTurnController({
    registry: {
      selectExactlyOne() {
        return {
          registration: { extensionInstanceId: 'extension-1', peer },
          session: {
            browserSessionId: 'browser-1',
            origin: 'https://gemini.google.com',
            providerId: 'gemini',
            conversationId: 'conversation-1',
          },
        }
      },
    },
    stateStore: { async get() { return null }, async set() {} },
  })
  const abort = new AbortController()
  const pending = controller.request({ ...request, model: 'tether-compact', tools: [] }, {
    connectionId: 'xpose:http',
    signal: abort.signal,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(sent[0].type, 'browser_request')
  abort.abort()
  await assert.rejects(pending, { code: 'request_cancelled' })
  assert.deepEqual(sent[1], {
    protocol: 'tether-extension',
    version: 1,
    type: 'browser_cancel',
    requestId: sent[0].requestId,
    browserSessionId: 'browser-1',
  })
})
