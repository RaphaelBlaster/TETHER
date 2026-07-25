import assert from 'node:assert/strict'
import test from 'node:test'
import { codexRequestId, createBrowserTurnController } from '../src/browser-turn-controller.js'

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
