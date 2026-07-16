import test from 'node:test'
import assert from 'node:assert/strict'
import { createTetherAdapter } from '../src/adapter.js'
import { TEST_COMPLETED_MESSAGE } from '../src/extension-test-controller.js'

const session = {
  browserSessionId: 'browser-1',
  tabId: 7,
  origin: 'https://chat.example',
  providerId: 'chat-example',
  conversationId: 'conversation-1',
  transportMode: 'CLI',
  role: 'ENDPOINT',
}

test('accepts an extension hello and registers its sanitized session snapshot', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  socket.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)

  const [registration] = adapter.listExtensionRegistrations()
  assert.equal(registration.extensionInstanceId, 'extension-1')
  assert.deepEqual(registration.sessions, [session])
})

test('replaces registration state from a full sessions_changed snapshot', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  socket.send(JSON.stringify(hello('extension-1', [])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  socket.send(JSON.stringify({
    protocol: 'tether-extension',
    version: 1,
    type: 'sessions_changed',
    extensionInstanceId: 'extension-1',
    sessions: [session],
  }))
  await until(() => adapter.listExtensionRegistrations()[0]?.sessions.length === 1)
  assert.deepEqual(adapter.listExtensionRegistrations()[0].sessions, [session])
})

test('rejects invalid extension protocol and never registers it', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  socket.send(JSON.stringify({ ...hello('extension-1', [session]), protocol: 'wrong' }))
  const [message] = await collectMessages(socket, 1)
  assert.equal(message.type, 'protocol_error')
  assert.equal(message.error.code, 'invalid_protocol')
  assert.equal(adapter.listExtensionRegistrations().length, 0)
})

test('a reconnect replaces the prior socket and stale close cannot remove replacement state', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const first = await extensionSocket(info)
  first.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)

  const replacementSession = { ...session, conversationId: 'conversation-2' }
  const second = await extensionSocket(info)
  t.after(() => second.close())
  second.send(JSON.stringify(hello('extension-1', [replacementSession])))
  await until(() => adapter.listExtensionRegistrations()[0]?.sessions[0]?.conversationId === 'conversation-2')
  first.close()
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.equal(adapter.listExtensionRegistrations().length, 1)
  assert.deepEqual(adapter.listExtensionRegistrations()[0].sessions, [replacementSession])
})

test('reports zero and multiple active sessions without choosing one', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  assert.throws(() => adapter.requestExtensionTest(), { code: 'no_active_session' })

  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  socket.send(JSON.stringify(hello('extension-1', [session, { ...session, browserSessionId: 'browser-2', tabId: 8 }])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  assert.throws(() => adapter.requestExtensionTest(), { code: 'ambiguous_session', count: 2 })
})

test('selects the LLM MASTER deterministically from one CROSS pair', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  const master = { ...session, transportMode: 'CROSS', role: 'MASTER' }
  const slave = { ...session, browserSessionId: 'browser-2', tabId: 8, providerId: 'site:support', conversationId: null, transportMode: 'CROSS', role: 'SLAVE' }
  socket.send(JSON.stringify(hello('extension-1', [master, slave])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  const request = adapter.requestExtensionTest({ requestId: 'cross-selection' })
  const [message] = await collectMessages(socket, 1)
  assert.equal(message.browserSessionId, master.browserSessionId)
  socket.send(JSON.stringify({ protocol: 'tether-extension', version: 1, type: 'test_completed', requestId: message.requestId, browserSessionId: master.browserSessionId, payload: { message: TEST_COMPLETED_MESSAGE } }))
  assert.equal((await request).browserSessionId, master.browserSessionId)
})

test('correlates one test request and scopes duplicate idempotency to extension, session, and request', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  socket.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)

  const messages = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'test_request') return
    messages.push(message)
    socket.send(JSON.stringify({
      protocol: 'tether-extension',
      version: 1,
      type: 'test_completed',
      requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { message: TEST_COMPLETED_MESSAGE },
    }))
  })

  const first = adapter.requestExtensionTest({ requestId: 'request-1' })
  const duplicate = adapter.requestExtensionTest({ requestId: 'request-1' })
  assert.equal(first, duplicate)
  assert.deepEqual(await first, {
    extensionInstanceId: 'extension-1',
    browserSessionId: 'browser-1',
    requestId: 'request-1',
    message: TEST_COMPLETED_MESSAGE,
  })
  assert.equal(messages.length, 1)
  assert.deepEqual(await adapter.requestExtensionTest({ requestId: 'request-1' }), await first)
  assert.equal(messages.length, 1)
})

test('rejects an unknown completion request id', async (t) => {
  const { info } = await startedAdapter(t)
  const socket = await extensionSocket(info)
  socket.send(JSON.stringify(hello('extension-1', [session])))
  await new Promise((resolve) => setTimeout(resolve, 10))
  socket.send(JSON.stringify({
    protocol: 'tether-extension',
    version: 1,
    type: 'test_completed',
    requestId: 'unknown',
    browserSessionId: 'browser-1',
    payload: { message: TEST_COMPLETED_MESSAGE },
  }))
  const [message] = await collectMessages(socket, 1)
  assert.equal(message.error.code, 'unknown_request_id')
})

test('disconnect removes current live registration and reconnect restores it', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const first = await extensionSocket(info)
  first.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  first.close()
  await until(() => adapter.listExtensionRegistrations().length === 0)

  const second = await extensionSocket(info)
  t.after(() => second.close())
  second.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  assert.deepEqual(adapter.listExtensionRegistrations()[0].sessions, [session])
})

test('times out a test request and clears pending correlation', async (t) => {
  const adapter = createTetherAdapter({ logger: quiet, testRequestTimeoutMs: 10 })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const socket = await extensionSocket(info)
  t.after(() => socket.close())
  socket.send(JSON.stringify(hello('extension-1', [session])))
  await until(() => adapter.listExtensionRegistrations().length === 1)
  await assert.rejects(adapter.requestExtensionTest({ requestId: 'timeout' }), { code: 'test_request_timeout' })
})

test('rejects malformed and bounded extension messages', async (t) => {
  const adapter = createTetherAdapter({ logger: quiet, extensionMaxMessageBytes: 256 })
  const info = await adapter.start()
  t.after(() => adapter.stop())

  const malformed = await extensionSocket(info)
  malformed.send('{')
  assert.equal((await collectMessages(malformed, 1))[0].error.code, 'invalid_json')

  const oversized = await extensionSocket(info)
  const closed = new Promise((resolve) => oversized.addEventListener('close', resolve, { once: true }))
  oversized.send('x'.repeat(257))
  await closed
})

test('does not confuse extension and Codex Responses roles', async (t) => {
  const { adapter, info } = await startedAdapter(t)
  const responsesSocket = new WebSocket(info.websocketUrl)
  await opened(responsesSocket)
  responsesSocket.send(JSON.stringify(hello('extension-1', [session])))
  const [response] = await collectMessages(responsesSocket, 1)
  assert.equal(response.type, 'response.failed')
  assert.equal(response.response.error.code, 'invalid_request')
  assert.equal(adapter.listExtensionRegistrations().length, 0)
  responsesSocket.close()
})

function hello(extensionInstanceId, sessions) {
  return { protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId, sessions }
}

async function startedAdapter(t) {
  const adapter = createTetherAdapter({ logger: quiet })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  return { adapter, info }
}

async function extensionSocket(info) {
  const socket = new WebSocket(info.extensionWebsocketUrl)
  await opened(socket)
  return socket
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
}

function collectMessages(socket, count) {
  return new Promise((resolve, reject) => {
    const messages = []
    const onMessage = (event) => {
      messages.push(JSON.parse(event.data))
      if (messages.length !== count) return
      socket.removeEventListener('message', onMessage)
      resolve(messages)
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', reject, { once: true })
  })
}

async function until(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const quiet = { error() {} }
