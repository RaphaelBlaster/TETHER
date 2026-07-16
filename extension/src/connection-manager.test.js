import assert from 'node:assert/strict'
import test from 'node:test'

import { CONNECTION_STATE, createConnectionManager } from './connection-manager.js'
import { TEST_COMPLETED_MESSAGE } from './extension-protocol.js'

const baseSession = {
  browserSessionId: 'browser-1', tabId: 7, status: 'active', origin: 'https://chat.example',
  providerId: 'chat-example', conversationId: 'conversation-1', calibrationKey: 'chat.example',
}

class FakeSocket {
  listeners = new Map()
  sent = []
  closed = false

  addEventListener(type, listener) { this.listeners.set(type, listener) }
  emit(type, event = {}) { this.listeners.get(type)?.(event) }
  send(message) { this.sent.push(message) }
  close(code, reason) { this.closed = true; this.closeCode = code; this.closeReason = reason }
}

test('sends hello only after restored browser sessions and stable identity are ready', async () => {
  const socket = new FakeSocket()
  let finishRestore
  const restored = new Promise((resolve) => { finishRestore = resolve })
  const states = []
  const manager = createConnectionManager({
    createSocket: () => socket,
    getRegistration: () => restored,
    onStateChange: (state) => states.push(state),
  })

  manager.connect()
  socket.emit('open')
  await tick()
  assert.equal(socket.sent.length, 0)
  assert.equal(manager.getState(), CONNECTION_STATE.CONNECTING)

  finishRestore({ extensionInstanceId: 'extension-1', sessions: [baseSession] })
  await tick()
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-1',
    sessions: [projected(baseSession)],
  })
  assert.equal(states.at(-1), CONNECTION_STATE.CONNECTED)
})

test('sends full updated registration snapshots for activation, deactivation, and tab closure', async () => {
  const socket = new FakeSocket()
  let sessions = []
  const manager = createConnectionManager({
    createSocket: () => socket,
    getRegistration: async () => ({ extensionInstanceId: 'extension-1', sessions }),
  })
  manager.connect(); socket.emit('open'); await tick()

  sessions = [baseSession]
  await manager.sessionsChanged()
  sessions = []
  await manager.sessionsChanged()
  await manager.sessionsChanged()

  assert.deepEqual(socket.sent.map((entry) => JSON.parse(entry).sessions), [[], [projected(baseSession)], [], []])
  assert.deepEqual(socket.sent.map((entry) => JSON.parse(entry).type), ['hello', 'sessions_changed', 'sessions_changed', 'sessions_changed'])
})

test('returns one correlated hardcoded completion without any DOM callback', async () => {
  const socket = new FakeSocket()
  let validations = 0
  const manager = managerWithSocket(socket, {
    onTestRequest: async (message) => {
      validations += 1
      assert.equal(message.browserSessionId, 'browser-1')
    },
  })
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify(testRequest()) })
  await tick()

  assert.equal(validations, 1)
  assert.deepEqual(JSON.parse(socket.sent[1]), {
    protocol: 'tether-extension', version: 1, type: 'test_completed', requestId: 'request-1',
    browserSessionId: 'browser-1', payload: { message: TEST_COMPLETED_MESSAGE },
  })
})

test('returns a correlated error for a wrong browser session', async () => {
  const socket = new FakeSocket()
  const manager = managerWithSocket(socket, {
    onTestRequest: async (message, registration) => {
      if (!registration.sessions.some((session) => session.browserSessionId === message.browserSessionId)) {
        throw Object.assign(new Error('Browser session is not active'), { code: 'inactive_session' })
      }
    },
  })
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify(testRequest({ browserSessionId: 'wrong' })) })
  await tick()
  const response = JSON.parse(socket.sent[1])
  assert.equal(response.type, 'test_error')
  assert.equal(response.error.code, 'inactive_session')
})

test('same scoped request is idempotent while pending and after completion', async () => {
  const socket = new FakeSocket()
  let validations = 0
  let finish
  const manager = managerWithSocket(socket, {
    onTestRequest: () => { validations += 1; return new Promise((resolve) => { finish = resolve }) },
  })
  manager.connect(); socket.emit('open'); await tick()
  const request = JSON.stringify(testRequest())
  socket.emit('message', { data: request })
  socket.emit('message', { data: request })
  assert.equal(validations, 1)
  finish()
  await tick()
  socket.emit('message', { data: request })
  assert.equal(validations, 1)
  assert.equal(socket.sent.length, 3)
  assert.deepEqual(JSON.parse(socket.sent[1]), JSON.parse(socket.sent[2]))
})

test('responds to a versioned heartbeat', async () => {
  const socket = new FakeSocket()
  const manager = managerWithSocket(socket)
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify({ protocol: 'tether-extension', version: 1, type: 'ping', requestId: 'ping-1' }) })
  assert.deepEqual(JSON.parse(socket.sent[1]), { protocol: 'tether-extension', version: 1, type: 'pong', requestId: 'ping-1' })
})

test('returns correlated extracted browser text and cancels it on disconnect', async () => {
  const socket = new FakeSocket()
  let receivedSignal
  let finish
  const manager = managerWithSocket(socket, {
    onBrowserRequest: (message, registration, { signal }) => {
      assert.equal(message.payload.prompt, 'prompt')
      assert.equal(registration.extensionInstanceId, 'extension-1')
      receivedSignal = signal
      return new Promise((resolve) => { finish = resolve })
    },
  })
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify(browserRequest()) })
  finish('{"schemaVersion":1}')
  await tick()
  const response = JSON.parse(socket.sent[1])
  assert.equal(response.type, 'browser_completed')
  assert.equal(response.requestId, 'turn-1')
  assert.equal(response.payload.text, '{"schemaVersion":1}')

  socket.emit('message', { data: JSON.stringify(browserRequest({ requestId: 'turn-2' })) })
  socket.emit('close')
  assert.equal(receivedSignal.aborted, true)
})

test('aborts only the browser request named by a correlated cancellation', async () => {
  const socket = new FakeSocket()
  const signals = new Map()
  const manager = managerWithSocket(socket, {
    onBrowserRequest: (message, registration, { signal }) => {
      signals.set(message.requestId, signal)
      return new Promise(() => {})
    },
  })
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify(browserRequest({ requestId: 'turn-1' })) })
  socket.emit('message', { data: JSON.stringify(browserRequest({ requestId: 'turn-2' })) })
  socket.emit('message', { data: JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'browser_cancel', requestId: 'turn-1', browserSessionId: 'browser-1',
  }) })
  assert.equal(signals.get('turn-1').aborted, true)
  assert.equal(signals.get('turn-2').aborted, false)
})

test('reconnects and re-registers the same restored identity and sessions', async () => {
  const sockets = []
  const scheduled = []
  const manager = createConnectionManager({
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    getRegistration: async () => ({ extensionInstanceId: 'extension-1', sessions: [baseSession] }),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
    retryDelays: [5],
  })
  manager.connect(); sockets[0].emit('open'); await tick()
  sockets[0].emit('close')
  scheduled[0].callback()
  sockets[1].emit('open'); await tick()
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), JSON.parse(sockets[1].sent[0]))
})

test('rejects the old model_request protocol without invoking a handler', async () => {
  const socket = new FakeSocket()
  let invoked = false
  const manager = managerWithSocket(socket, { onTestRequest: () => { invoked = true } })
  manager.connect(); socket.emit('open'); await tick()
  socket.emit('message', { data: JSON.stringify({ version: 1, type: 'model_request', requestId: 'old', payload: { text: 'hello' } }) })
  assert.equal(socket.closed, true)
  assert.equal(socket.closeCode, 1002)
  assert.equal(invoked, false)
})

test('uses bounded reconnect delays and ignores events from stale sockets', async () => {
  const sockets = []
  const scheduled = []
  const manager = createConnectionManager({
    createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket },
    getRegistration: async () => ({ extensionInstanceId: 'extension-1', sessions: [] }),
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length },
    cancelSchedule: () => {},
    retryDelays: [5, 10],
  })
  manager.connect()
  manager.connect()
  sockets[0].emit('open')
  assert.equal(manager.getState(), CONNECTION_STATE.CONNECTING)
  sockets[1].emit('open'); await tick()
  sockets[0].emit('close')
  assert.equal(manager.getState(), CONNECTION_STATE.CONNECTED)
  sockets[1].emit('close')
  assert.equal(scheduled[0].delay, 5)
})

function managerWithSocket(socket, overrides = {}) {
  return createConnectionManager({
    createSocket: () => socket,
    getRegistration: async () => ({ extensionInstanceId: 'extension-1', sessions: [baseSession] }),
    ...overrides,
  })
}

function testRequest(overrides = {}) {
  return {
    protocol: 'tether-extension', version: 1, type: 'test_request', requestId: 'request-1',
    browserSessionId: 'browser-1', payload: { message: 'TETHER_ADAPTER_EXTENSION_CHECK' }, ...overrides,
  }
}

function browserRequest(overrides = {}) {
  return {
    protocol: 'tether-extension', version: 1, type: 'browser_request', requestId: 'turn-1',
    browserSessionId: 'browser-1', payload: { prompt: 'prompt', installBootstrap: true }, ...overrides,
  }
}

function projected(session) {
  return {
    browserSessionId: session.browserSessionId, tabId: session.tabId, origin: session.origin,
    providerId: session.providerId, conversationId: session.conversationId,
    transportMode: session.transportMode ?? 'CLI', role: session.role ?? 'ENDPOINT',
  }
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)) }
