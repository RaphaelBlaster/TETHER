export const EXTENSION_PROTOCOL = 'tether-extension'
export const EXTENSION_PROTOCOL_VERSION = 1
export const EXTENSION_INSTANCE_ID_KEY = 'tetherExtensionInstanceId'
export const EXTENSION_PAIRING_TOKEN_KEY = 'tetherExtensionPairingToken'
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

export async function getOrCreateExtensionPairingToken(storage, generate = generatePairingToken) {
  const stored = await storage.get(EXTENSION_PAIRING_TOKEN_KEY)
  const existing = stored[EXTENSION_PAIRING_TOKEN_KEY]
  if (validPairingToken(existing)) return existing
  const pairingToken = generate()
  if (!validPairingToken(pairingToken)) throw new Error('Generated extension pairing token is invalid')
  await storage.set({ [EXTENSION_PAIRING_TOKEN_KEY]: pairingToken })
  return pairingToken
}

export function registrationMessage(type, extensionInstanceId, sessions, pairingToken = undefined) {
  if (!['hello', 'sessions_changed'].includes(type) || !validIdentifier(extensionInstanceId)) {
    throw new Error('Invalid extension registration')
  }
  if (pairingToken !== undefined && !validPairingToken(pairingToken)) {
    throw new Error('Invalid extension pairing token')
  }
  return {
    protocol: EXTENSION_PROTOCOL,
    version: EXTENSION_PROTOCOL_VERSION,
    type,
    extensionInstanceId,
    ...(type === 'hello' && pairingToken ? { pairingToken } : {}),
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
    message.type === 'xpose_ready' &&
    validXposeBaseUrl(message.baseUrl) &&
    validIdentifier(message.model)
  ) return message
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
  const transportMode = ['CLI', 'CROSS', 'XPOSE'].includes(session.transportMode)
    ? session.transportMode
    : 'CLI'
  return {
    browserSessionId: session.browserSessionId,
    tabId: session.tabId,
    origin: session.origin,
    providerId: session.providerId,
    conversationId: session.conversationId ?? null,
    transportMode,
    role: transportMode === 'CROSS' && session.role === 'SLAVE' ? 'SLAVE' : transportMode === 'CROSS' ? 'MASTER' : 'ENDPOINT',
  }
}

function validXposeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 128) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      Number.isInteger(Number(url.port)) &&
      Number(url.port) > 0 &&
      Number(url.port) <= 65535 &&
      url.pathname === '/v1' &&
      url.search === '' &&
      url.hash === ''
  } catch {
    return false
  }
}

function baseMessage(type, fields) {
  return { protocol: EXTENSION_PROTOCOL, version: EXTENSION_PROTOCOL_VERSION, type, ...fields }
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function validPairingToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

function generatePairingToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
