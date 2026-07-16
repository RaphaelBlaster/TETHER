import {
  EXTENSION_PROTOCOL,
  EXTENSION_PROTOCOL_VERSION,
  parseExtensionMessage,
  validateHello,
  validateSessionsChanged,
} from './extension-session-registry.js'

export function createExtensionConnectionHandler({ registry, testRequests, browserTurns, connectionId, heartbeatMs = 20000, scheduleInterval = setInterval, cancelInterval = clearInterval }) {
  let extensionInstanceId = null
  let peer = null
  let heartbeat = null

  function attach(nextPeer) {
    peer = nextPeer
  }

  async function onText(text, client) {
    const message = parseExtensionMessage(text)
    if (!extensionInstanceId) {
      const hello = validateHello(message)
      extensionInstanceId = hello.extensionInstanceId
      registry.register({ ...hello, peer: client, connectionId })
      heartbeat = scheduleInterval(() => {
        client.sendJson({
          protocol: EXTENSION_PROTOCOL,
          version: EXTENSION_PROTOCOL_VERSION,
          type: 'ping',
          requestId: `heartbeat-${Date.now()}`,
        })
      }, heartbeatMs)
      return
    }

    if (message.type === 'sessions_changed') {
      const sessions = validateSessionsChanged(message, extensionInstanceId)
      registry.update({ extensionInstanceId, sessions, peer: client })
      return
    }
    if (message.type === 'pong') return
    if (message.type === 'test_completed' || message.type === 'test_error') {
      testRequests.complete(message, client, extensionInstanceId)
      return
    }
    if (message.type === 'browser_completed' || message.type === 'browser_error') {
      await browserTurns.complete(message, client, extensionInstanceId)
      return
    }
    throw coded('unknown_extension_message', 'Unsupported extension message')
  }

  function onClose() {
    if (heartbeat !== null) cancelInterval(heartbeat)
    if (peer) testRequests.disconnect(peer)
    if (peer) browserTurns.disconnect(peer)
    if (extensionInstanceId && peer) registry.unregister(extensionInstanceId, peer)
  }

  return { attach, onText, onClose, getExtensionInstanceId: () => extensionInstanceId }
}

export function extensionError(code, message, extra = {}) {
  return {
    protocol: EXTENSION_PROTOCOL,
    version: EXTENSION_PROTOCOL_VERSION,
    type: 'protocol_error',
    error: { code, message, ...extra },
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
