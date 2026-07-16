import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXTENSION_INSTANCE_ID_KEY,
  MAX_MESSAGE_SIZE,
  getOrCreateExtensionInstanceId,
  parseAdapterMessage,
  registrationMessage,
} from './extension-protocol.js'

test('persists one stable extension instance id and reuses it across restarts', async () => {
  const values = {}
  const storage = {
    async get(key) { return { [key]: values[key] } },
    async set(update) { Object.assign(values, update) },
  }
  let generated = 0
  const uuid = () => `extension-${++generated}`
  assert.equal(await getOrCreateExtensionInstanceId(storage, uuid), 'extension-1')
  assert.equal(await getOrCreateExtensionInstanceId(storage, uuid), 'extension-1')
  assert.equal(values[EXTENSION_INSTANCE_ID_KEY], 'extension-1')
  assert.equal(generated, 1)
})

test('replaces an invalid stored extension instance id', async () => {
  const values = { [EXTENSION_INSTANCE_ID_KEY]: '' }
  const storage = {
    async get(key) { return { [key]: values[key] } },
    async set(update) { Object.assign(values, update) },
  }
  assert.equal(await getOrCreateExtensionInstanceId(storage, () => 'replacement'), 'replacement')
  assert.equal(values[EXTENSION_INSTANCE_ID_KEY], 'replacement')
})

test('registration sends only active projected session metadata', () => {
  const message = registrationMessage('hello', 'extension-1', [
    { browserSessionId: 'active', tabId: 7, status: 'active', origin: 'https://chat.example', providerId: 'chat', conversationId: null, calibrationKey: 'secret' },
    { browserSessionId: 'inactive', tabId: 8, status: 'inactive', origin: 'https://other.example', providerId: 'other' },
  ])
  assert.deepEqual(message.sessions, [{ browserSessionId: 'active', tabId: 7, origin: 'https://chat.example', providerId: 'chat', conversationId: null, transportMode: 'CLI', role: 'ENDPOINT' }])
  assert.equal(JSON.stringify(message).includes('calibration'), false)
})

test('validates test requests and rejects malformed, old, unknown, and oversized messages', () => {
  assert.equal(parseAdapterMessage(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'test_request', requestId: 'request-1',
    browserSessionId: 'browser-1', payload: { message: 'TETHER_ADAPTER_EXTENSION_CHECK' },
  })).type, 'test_request')
  for (const data of [
    '{',
    JSON.stringify({ version: 1, type: 'model_request', requestId: 'old' }),
    JSON.stringify({ protocol: 'tether-extension', version: 2, type: 'unknown' }),
    'x'.repeat(MAX_MESSAGE_SIZE + 1),
  ]) assert.throws(() => parseAdapterMessage(data))
})

test('validates one bounded browser request with explicit bootstrap state', () => {
  const message = parseAdapterMessage(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'browser_request', requestId: 'turn-1',
    browserSessionId: 'browser-1', payload: { prompt: 'structured prompt', installBootstrap: true },
  }))
  assert.equal(message.type, 'browser_request')
  assert.equal(message.payload.installBootstrap, true)
  for (const payload of [
    { prompt: '', installBootstrap: true },
    { prompt: 'hello' },
    { prompt: 'hello', installBootstrap: 'yes' },
  ]) assert.throws(() => parseAdapterMessage(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'browser_request', requestId: 'turn-1',
    browserSessionId: 'browser-1', payload,
  })))
})

test('validates one correlated browser cancellation', () => {
  const message = parseAdapterMessage(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'browser_cancel', requestId: 'turn-1',
    browserSessionId: 'browser-1',
  }))
  assert.equal(message.type, 'browser_cancel')
  assert.throws(() => parseAdapterMessage(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'browser_cancel', requestId: 'turn-1',
  })))
})
