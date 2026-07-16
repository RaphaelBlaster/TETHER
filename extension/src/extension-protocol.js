export const EXTENSION_PROTOCOL = 'tether-extension'
export const EXTENSION_PROTOCOL_VERSION = 1
export const EXTENSION_INSTANCE_ID_KEY = 'tetherExtensionInstanceId'
export const MAX_MESSAGE_SIZE = 16 * 1024 * 1024
export const TEST_REQUEST_MESSAGE = 'TETHER_ADAPTER_EXTENSION_CHECK'
export const TEST_COMPLETED_MESSAGE = 'TETHER_EXTENSION_ADAPTER_OK'

export async function getOrCreateExtensionInstanceId(storage, uuid = () => crypto.randomUUID()) {
  const stored = await storage.get(EXTENSION_INSTANCE_ID_KEY)
  const existing = stored[EXTENSION_INSTANCE_ID_KEY]
  if (validIdentifier(existing)) return existing
  const extensionInstanceId = uuid()
  if (!validIdentifier(extensionInstanceId)) throw new Error('Generated extension instance ID is invalid')
  await storage.set({ [EXTENSION_INSTANCE_ID_KEY]: extensionInstanceId })
  return extensionInstanceId
}

export function registrationMessage(type, extensionInstanceId, sessions) {
  if (!['hello', 'sessions_changed'].includes(type) || !validIdentifier(extensionInstanceId)) {
    throw new Error('Invalid extension registration')
  }
  return {
    protocol: EXTENSION_PROTOCOL,
    version: EXTENSION_PROTOCOL_VERSION,
    type,
    extensionInstanceId,
    sessions: sessions.filter((session) => session.status === 'active').map(projectSession),
  }
}

export function parseAdapterMessage(data) {
  if (typeof data !== 'string' || data.length > MAX_MESSAGE_SIZE) throw new Error('Message must be bounded text')
  const message = JSON.parse(data)
  if (!isObject(message) || message.protocol !== EXTENSION_PROTOCOL || message.version !== EXTENSION_PROTOCOL_VERSION) {
    throw new Error('Unsupported TETHER extension message')
  }
  if (message.type === 'ping' && validIdentifier(message.requestId)) return message
  if (
    message.type === 'test_request' &&
    validIdentifier(message.requestId) &&
    validIdentifier(message.browserSessionId) &&
    message.payload?.message === TEST_REQUEST_MESSAGE
  ) return message
  if (
    message.type === 'browser_request' &&
    validIdentifier(message.requestId) &&
    validIdentifier(message.browserSessionId) &&
    isObject(message.payload) &&
    typeof message.payload.prompt === 'string' &&
    message.payload.prompt.length > 0 &&
    message.payload.prompt.length <= MAX_MESSAGE_SIZE &&
    typeof message.payload.installBootstrap === 'boolean'
  ) return message
  if (
    message.type === 'browser_cancel' &&
    validIdentifier(message.requestId) &&
    validIdentifier(message.browserSessionId)
  ) return message
  throw new Error('Unsupported TETHER extension message')
}

export function pongMessage(requestId) {
  return baseMessage('pong', { requestId })
}

export function testCompletedMessage(requestId, browserSessionId) {
  return baseMessage('test_completed', {
    requestId,
    browserSessionId,
    payload: { message: TEST_COMPLETED_MESSAGE },
  })
}

export function testErrorMessage(requestId, browserSessionId, error) {
  return baseMessage('test_error', {
    requestId,
    browserSessionId,
    error: {
      code: error?.code ?? 'test_request_failed',
      message: (error instanceof Error ? error.message : String(error || 'Test request failed')).slice(0, 1024),
    },
  })
}

export function browserCompletedMessage(requestId, browserSessionId, text) {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE_SIZE) throw new Error('Browser response must be bounded text')
  return baseMessage('browser_completed', { requestId, browserSessionId, payload: { text } })
}

export function browserErrorMessage(requestId, browserSessionId, error) {
  return baseMessage('browser_error', {
    requestId,
    browserSessionId,
    error: {
      code: error?.code ?? 'browser_request_failed',
      message: (error instanceof Error ? error.message : String(error || 'Browser request failed')).slice(0, 1024),
    },
  })
}

export function correlationKey(extensionInstanceId, browserSessionId, requestId) {
  return `${extensionInstanceId}\u0000${browserSessionId}\u0000${requestId}`
}

function projectSession(session) {
  return {
    browserSessionId: session.browserSessionId,
    tabId: session.tabId,
    origin: session.origin,
    providerId: session.providerId,
    conversationId: session.conversationId ?? null,
    transportMode: session.transportMode === 'CROSS' ? 'CROSS' : 'CLI',
    role: session.transportMode === 'CROSS' && session.role === 'SLAVE' ? 'SLAVE' : session.transportMode === 'CROSS' ? 'MASTER' : 'ENDPOINT',
  }
}

function baseMessage(type, fields) {
  return { protocol: EXTENSION_PROTOCOL, version: EXTENSION_PROTOCOL_VERSION, type, ...fields }
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
