import { randomUUID } from 'node:crypto'
import { EXTENSION_PROTOCOL, EXTENSION_PROTOCOL_VERSION } from './extension-session-registry.js'

export const TEST_REQUEST_MESSAGE = 'TETHER_ADAPTER_EXTENSION_CHECK'
export const TEST_COMPLETED_MESSAGE = 'TETHER_EXTENSION_ADAPTER_OK'

export function createTestRequestController({
  registry,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  timeoutMs = 5000,
  maxSettled = 128,
} = {}) {
  const pending = new Map()
  const settled = new Map()

  function request({ requestId = randomUUID() } = {}) {
    const { registration, session } = registry.selectExactlyOne()
    const key = correlationKey(registration.extensionInstanceId, session.browserSessionId, requestId)
    if (settled.has(key)) return Promise.resolve(settled.get(key))
    if (pending.has(key)) return pending.get(key).promise

    let resolveRequest
    let rejectRequest
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    const operation = {
      key,
      requestId,
      extensionInstanceId: registration.extensionInstanceId,
      browserSessionId: session.browserSessionId,
      peer: registration.peer,
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
      timeoutId: null,
    }
    operation.timeoutId = schedule(() => {
      if (pending.get(key) !== operation) return
      pending.delete(key)
      rejectRequest(coded('test_request_timeout', 'Extension test request timed out'))
    }, timeoutMs)
    pending.set(key, operation)
    registration.peer.sendJson({
      protocol: EXTENSION_PROTOCOL,
      version: EXTENSION_PROTOCOL_VERSION,
      type: 'test_request',
      requestId,
      browserSessionId: session.browserSessionId,
      payload: { message: TEST_REQUEST_MESSAGE },
    })
    return promise
  }

  function complete(message, peer, extensionInstanceId) {
    const key = correlationKey(extensionInstanceId, message.browserSessionId, message.requestId)
    const operation = pending.get(key)
    if (!operation || operation.peer !== peer) throw coded('unknown_request_id', 'No matching test request is pending')
    pending.delete(key)
    cancelSchedule(operation.timeoutId)

    if (message.type === 'test_error') {
      operation.reject(coded(message.error?.code ?? 'extension_test_failed', message.error?.message ?? 'Extension test failed'))
      return
    }
    if (message.type !== 'test_completed' || message.payload?.message !== TEST_COMPLETED_MESSAGE) {
      operation.reject(coded('invalid_test_completion', 'Extension returned an invalid test completion'))
      return
    }
    const result = {
      extensionInstanceId,
      browserSessionId: message.browserSessionId,
      requestId: message.requestId,
      message: message.payload.message,
    }
    remember(settled, key, result, maxSettled)
    operation.resolve(result)
  }

  function disconnect(peer) {
    for (const [key, operation] of pending) {
      if (operation.peer !== peer) continue
      pending.delete(key)
      cancelSchedule(operation.timeoutId)
      operation.reject(coded('extension_disconnected', 'Extension disconnected before completing the test request'))
    }
  }

  return { request, complete, disconnect, pendingCount: () => pending.size }
}

function correlationKey(extensionInstanceId, browserSessionId, requestId) {
  return `${extensionInstanceId}\u0000${browserSessionId}\u0000${requestId}`
}

function remember(map, key, value, limit) {
  map.set(key, value)
  while (map.size > limit) map.delete(map.keys().next().value)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
