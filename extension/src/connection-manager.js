import {
  MAX_MESSAGE_SIZE,
  correlationKey,
  parseAdapterMessage,
  pongMessage,
  registrationMessage,
  browserCompletedMessage,
  browserErrorMessage,
  testCompletedMessage,
  testErrorMessage,
} from './extension-protocol.js'

export const CONNECTION_STATE = Object.freeze({
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RETRYING: 'retrying',
})

export { MAX_MESSAGE_SIZE }

const DEFAULT_RETRY_DELAYS = [500, 1000, 2000, 4000, 10000]
const MAX_SETTLED_REQUESTS = 128

export function createConnectionManager({
  url = 'ws://127.0.0.1:8766/tether/extension',
  createSocket = (socketUrl) => new WebSocket(socketUrl),
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  retryDelays = DEFAULT_RETRY_DELAYS,
  getRegistration = async () => { throw new Error('Browser sessions are not initialized') },
  onTestRequest = async () => {},
  onBrowserRequest = async () => { throw new Error('Browser request handler is unavailable') },
  onStateChange = () => {},
} = {}) {
  let socket = null
  let reconnectTimer = null
  let retryAttempt = 0
  let state = CONNECTION_STATE.RETRYING
  let currentRegistration = null
  const pending = new Map()
  const settled = new Map()

  function publish(nextState) {
    state = nextState
    onStateChange(nextState)
  }

  function clearReconnectTimer() {
    if (reconnectTimer === null) return
    cancelSchedule(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) return
    publish(CONNECTION_STATE.RETRYING)
    const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)]
    retryAttempt += 1
    reconnectTimer = schedule(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  async function sendRegistration(targetSocket, type) {
    const registration = await getRegistration()
    if (socket !== targetSocket) return false
    currentRegistration = registration
    targetSocket.send(JSON.stringify(registrationMessage(type, registration.extensionInstanceId, registration.sessions)))
    return true
  }

  function remember(key, response) {
    settled.set(key, response)
    while (settled.size > MAX_SETTLED_REQUESTS) settled.delete(settled.keys().next().value)
  }

  function sendIfCurrent(targetSocket, response) {
    if (socket === targetSocket) targetSocket.send(JSON.stringify(response))
  }

  function handleRequest(targetSocket, message) {
    const registration = currentRegistration
    if (!registration) throw new Error('Extension registration is unavailable')
    const key = correlationKey(registration.extensionInstanceId, message.browserSessionId, message.requestId)
    if (message.type === 'browser_cancel') {
      const active = pending.get(key)
      if (active) {
        pending.delete(key)
        active.controller.abort()
      }
      return
    }
    const completed = settled.get(key)
    if (completed) {
      sendIfCurrent(targetSocket, completed)
      return
    }
    if (pending.has(key)) return

    const controller = new AbortController()
    const operation = Promise.resolve(
      message.type === 'test_request'
        ? onTestRequest(message, registration)
        : onBrowserRequest(message, registration, { signal: controller.signal }),
    ).then(
      (result) => message.type === 'test_request'
        ? testCompletedMessage(message.requestId, message.browserSessionId)
        : browserCompletedMessage(message.requestId, message.browserSessionId, result),
      (error) => message.type === 'test_request'
        ? testErrorMessage(message.requestId, message.browserSessionId, error)
        : browserErrorMessage(message.requestId, message.browserSessionId, error),
    ).then((response) => {
      if (pending.get(key)?.operation !== operation) return
      pending.delete(key)
      remember(key, response)
      sendIfCurrent(targetSocket, response)
    })
    pending.set(key, { operation, controller })
  }

  function connect() {
    clearReconnectTimer()
    const previousSocket = socket
    socket = null
    previousSocket?.close()
    currentRegistration = null
    abortPending()
    const nextSocket = createSocket(url)
    socket = nextSocket
    publish(CONNECTION_STATE.CONNECTING)

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) return
      retryAttempt = 0
      sendRegistration(nextSocket, 'hello').then(
        (sent) => { if (sent) publish(CONNECTION_STATE.CONNECTED) },
        () => { if (socket === nextSocket) nextSocket.close(1011, 'Registration failed') },
      )
    })

    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket) return
      try {
        const message = parseAdapterMessage(event.data)
        if (message.type === 'ping') sendIfCurrent(nextSocket, pongMessage(message.requestId))
        else handleRequest(nextSocket, message)
      } catch {
        nextSocket.close(1002, 'Invalid TETHER extension message')
      }
    })

    nextSocket.addEventListener('close', () => {
      if (socket !== nextSocket) return
      socket = null
      currentRegistration = null
      abortPending()
      scheduleReconnect()
    })

    nextSocket.addEventListener('error', () => {
      if (socket === nextSocket) nextSocket.close()
    })
  }

  async function sessionsChanged() {
    const activeSocket = socket
    if (!activeSocket || state !== CONNECTION_STATE.CONNECTED) return false
    return sendRegistration(activeSocket, 'sessions_changed')
  }

  function stop() {
    clearReconnectTimer()
    const activeSocket = socket
    socket = null
    currentRegistration = null
    abortPending()
    activeSocket?.close()
  }

  return {
    connect,
    getState: () => state,
    sessionsChanged,
    stop,
  }

  function abortPending() {
    for (const pendingRequest of pending.values()) pendingRequest.controller.abort()
    pending.clear()
  }
}
