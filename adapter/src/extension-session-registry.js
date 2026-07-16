export const EXTENSION_PROTOCOL = 'tether-extension'
export const EXTENSION_PROTOCOL_VERSION = 1

export function createExtensionSessionRegistry() {
  const registrations = new Map()

  function register({ extensionInstanceId, sessions, peer, connectionId }) {
    const existing = registrations.get(extensionInstanceId)
    const registration = {
      extensionInstanceId,
      sessions: validateSessions(sessions),
      peer,
      connectionId,
    }
    registrations.set(extensionInstanceId, registration)
    if (existing && existing.peer !== peer) {
      existing.peer.close(4001, 'replaced by reconnecting extension')
    }
    return registration
  }

  function update({ extensionInstanceId, sessions, peer }) {
    const current = registrations.get(extensionInstanceId)
    if (!current || current.peer !== peer) throw coded('stale_extension_connection', 'Extension connection is no longer current')
    current.sessions = validateSessions(sessions)
    return current
  }

  function unregister(extensionInstanceId, peer) {
    const current = registrations.get(extensionInstanceId)
    if (!current || current.peer !== peer) return false
    registrations.delete(extensionInstanceId)
    return true
  }

  function selectExactlyOne() {
    const candidates = []
    for (const registration of registrations.values()) {
      for (const session of registration.sessions) {
        candidates.push({ registration, session })
      }
    }
    if (candidates.length === 0) throw coded('no_active_session', 'No active browser session is registered')
    if (candidates.length > 1) {
      const masters = candidates.filter(({ session }) => session.transportMode === 'CROSS' && session.role === 'MASTER')
      const slaves = candidates.filter(({ session }) => session.transportMode === 'CROSS' && session.role === 'SLAVE')
      if (candidates.length === 2 && masters.length === 1 && slaves.length === 1) return masters[0]
      throw Object.assign(coded('ambiguous_session', 'More than one active browser session is registered'), {
        count: candidates.length,
      })
    }
    return candidates[0]
  }

  function selectRoute() {
    const candidates = []
    for (const registration of registrations.values()) {
      for (const session of registration.sessions) candidates.push({ registration, session })
    }
    if (candidates.length === 0) throw coded('no_active_session', 'No active browser session is registered')
    const cross = candidates.filter(({ session }) => session.transportMode === 'CROSS')
    if (cross.length) {
      const masters = cross.filter(({ session }) => session.role === 'MASTER')
      const slaves = cross.filter(({ session }) => session.role === 'SLAVE')
      if (candidates.length !== 2 || masters.length !== 1 || slaves.length !== 1) {
        throw coded('cross_pair_incomplete', 'CROSS requires exactly one MASTER and one SLAVE endpoint')
      }
      return { mode: 'CROSS', master: masters[0], slave: slaves[0] }
    }
    if (candidates.length !== 1) {
      throw Object.assign(coded('ambiguous_session', 'More than one active browser session is registered'), { count: candidates.length })
    }
    return { mode: 'CLI', endpoint: candidates[0] }
  }

  return {
    register,
    update,
    unregister,
    selectExactlyOne,
    selectRoute,
    get: (extensionInstanceId) => registrations.get(extensionInstanceId) ?? null,
    list: () => [...registrations.values()],
  }
}

export function parseExtensionMessage(text) {
  let message
  try {
    message = JSON.parse(text)
  } catch {
    throw coded('invalid_json', 'Extension message must be valid JSON')
  }
  if (!isObject(message) || message.protocol !== EXTENSION_PROTOCOL || message.version !== EXTENSION_PROTOCOL_VERSION) {
    throw coded('invalid_protocol', 'Unsupported extension protocol')
  }
  return message
}

export function validateHello(message) {
  if (message.type !== 'hello' || !validIdentifier(message.extensionInstanceId)) {
    throw coded('invalid_hello', 'A valid extension hello is required')
  }
  return {
    extensionInstanceId: message.extensionInstanceId,
    sessions: validateSessions(message.sessions),
  }
}

export function validateSessionsChanged(message, extensionInstanceId) {
  if (message.type !== 'sessions_changed' || message.extensionInstanceId !== extensionInstanceId) {
    throw coded('invalid_session_update', 'Session update does not match the registered extension')
  }
  return validateSessions(message.sessions)
}

function validateSessions(sessions) {
  if (!Array.isArray(sessions)) throw coded('invalid_sessions', 'Extension sessions must be an array')
  const ids = new Set()
  return sessions.map((session) => {
    if (
      !isObject(session) ||
      !validIdentifier(session.browserSessionId) ||
      !Number.isInteger(session.tabId) ||
      typeof session.origin !== 'string' ||
      !session.origin.startsWith('http') ||
      typeof session.providerId !== 'string' ||
      !session.providerId ||
      !(session.conversationId === null || typeof session.conversationId === 'string') ||
      !['CLI', 'CROSS'].includes(session.transportMode ?? 'CLI') ||
      !['ENDPOINT', 'MASTER', 'SLAVE'].includes(session.role ?? 'ENDPOINT') ||
      ids.has(session.browserSessionId)
    ) {
      throw coded('invalid_sessions', 'Extension session snapshot is invalid')
    }
    ids.add(session.browserSessionId)
    return {
      browserSessionId: session.browserSessionId,
      tabId: session.tabId,
      origin: session.origin,
      providerId: session.providerId,
      conversationId: session.conversationId ?? null,
      transportMode: session.transportMode === 'CROSS' ? 'CROSS' : 'CLI',
      role: session.transportMode === 'CROSS' && session.role === 'SLAVE' ? 'SLAVE' : session.transportMode === 'CROSS' ? 'MASTER' : 'ENDPOINT',
    }
  })
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
