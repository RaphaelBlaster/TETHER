import { createServer } from 'node:http'
import { mkdir, appendFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { acceptWebSocket } from './websocket.js'
import { createExtensionSessionRegistry } from './extension-session-registry.js'
import { createTestRequestController } from './extension-test-controller.js'
import { createExtensionConnectionHandler, extensionError } from './extension-connection.js'
import { createBrowserTurnController } from './browser-turn-controller.js'
import { createConversationStateStore } from './conversation-state-store.js'

export const HARDCODED_TEXT = 'TETHER hardcoded Responses WebSocket round trip succeeded.'

export function createTetherAdapter({
  host = '127.0.0.1',
  port = 0,
  capturePath,
  serverInfoPath,
  hardcodedText = HARDCODED_TEXT,
  extensionMaxMessageBytes,
  testRequestTimeoutMs,
  browserTurnTimeoutMs,
  codexKeepaliveMs = 30_000,
  conversationStatePath,
  routeResponsesToBrowser = false,
  browserController = null,
  logger = console,
} = {}) {
  let responseSequence = 0
  let connectionSequence = 0
  const connections = new Set()
  const extensionSessions = createExtensionSessionRegistry()
  const testRequests = createTestRequestController({ registry: extensionSessions, timeoutMs: testRequestTimeoutMs })
  const conversationState = createConversationStateStore({ path: conversationStatePath })
  const browserTurns = createBrowserTurnController({ registry: extensionSessions, stateStore: conversationState, timeoutMs: browserTurnTimeoutMs })

  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/tether/health') {
      sendHttpJson(response, 200, { status: 'ok', service: 'tether-adapter' })
      return
    }
    if (request.method === 'POST' && request.url === '/v1/responses') {
      try {
        const message = await readHttpJson(request)
        // Codex uses this endpoint when its WebSocket transport reconnects or
        // falls back.  Keep the event vocabulary identical to the WebSocket
        // Responses path; only the framing changes to server-sent events.
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        await handleResponseRequest(message, (event) => sendSse(response, event))
        response.end()
      } catch (error) {
        if (!response.headersSent) {
          sendHttpJson(response, 400, {
            error: {
              code: error.code ?? 'invalid_request',
              message: error instanceof Error ? error.message : String(error),
            },
          })
        } else {
          response.end()
        }
      }
      return
    }
    if (request.method === 'POST' && request.url === '/tether/dev/test') {
      try {
        const result = await testRequests.request()
        sendHttpJson(response, 200, result)
      } catch (error) {
        const body = { error: { code: error.code ?? 'test_failed', message: error.message } }
        if (Number.isInteger(error.count)) body.error.count = error.count
        sendHttpJson(response, error.code === 'no_active_session' || error.code === 'ambiguous_session' ? 409 : 504, body)
      }
      return
    }
    sendHttpJson(response, 404, { error: '/v1/models and HTTP Responses are unsupported in Checkpoint 8C' })
  })

  server.on('upgrade', (request, socket, head) => {
    const connectionId = `conn-${++connectionSequence}`
    if (request.url === '/tether/extension') {
      const handler = createExtensionConnectionHandler({ registry: extensionSessions, testRequests, browserTurns, connectionId })
      const peer = acceptWebSocket(request, socket, head, {
        path: '/tether/extension',
        maxMessageBytes: extensionMaxMessageBytes,
        onText: async (text, client) => {
          try {
            await handler.onText(text, client)
          } catch (error) {
            const extra = Number.isInteger(error.count) ? { count: error.count } : {}
            client.sendJson(extensionError(error.code ?? 'invalid_extension_message', error.message, extra))
            client.close(1002, 'Invalid TETHER extension message')
          }
        },
        onClose: () => {
          handler.onClose()
          connections.delete(peer)
        },
      })
      if (peer) {
        handler.attach(peer)
        connections.add(peer)
      }
      return
    }

    if (request.url !== '/v1/responses') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    let active = false
    const peer = acceptWebSocket(request, socket, head, {
      path: '/v1/responses',
      onText: async (text, client) => {
        if (active) {
          client.sendJson(errorEvent('concurrent_request', 'Only one active response is allowed per connection'))
          return
        }
        active = true
        let responseId = null
        let keepalive = null
        try {
          const message = parseRequest(text)
          await capture(capturePath, { receivedAt: new Date().toISOString(), connectionId, request: message })
          await handleResponseRequest(message, (event) => client.sendJson(event), {
            connectionId,
            ping: () => client.ping('tether-active'),
          })
        } catch (error) {
          const code = error.code ?? 'invalid_request'
          const message = error instanceof Error ? error.message : String(error)
          const failedResponseId = responseId ?? `resp_tether_${++responseSequence}`
          logger.error(`TETHER response failed (${connectionId}, ${code}): ${message}`)
          client.sendJson(failedEvent(failedResponseId, code, message))
        } finally {
          if (keepalive !== null) clearInterval(keepalive)
          active = false
        }
      },
      onClose: () => connections.delete(peer),
    })
    if (peer) connections.add(peer)
  })

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, resolve)
      })
      const address = server.address()
      const info = {
        host,
        port: address.port,
        pid: process.pid,
        websocketUrl: `ws://${host}:${address.port}/v1/responses`,
        extensionWebsocketUrl: `ws://${host}:${address.port}/tether/extension`,
        developmentTestUrl: `http://${host}:${address.port}/tether/dev/test`,
      }
      if (serverInfoPath) {
        await mkdir(dirname(serverInfoPath), { recursive: true })
        await writeFile(serverInfoPath, `${JSON.stringify(info)}\n`, 'utf8')
      }
      logger.error(`TETHER adapter listening on ${info.websocketUrl} and ${info.extensionWebsocketUrl}`)
      return info
    },
    async stop() {
      for (const connection of connections) connection.close(1001, 'adapter shutting down')
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await browserController?.stop?.()
    },
    requestExtensionTest: (options) => testRequests.request(options),
    listExtensionRegistrations: () => extensionSessions.list(),
  }

  async function handleResponseRequest(message, emit, { connectionId = 'http', ping = null } = {}) {
    const responseId = `resp_tether_${++responseSequence}`
    emit({ type: 'response.created', response: { id: responseId } })
    let keepalive = null
    try {
      if (Number.isFinite(codexKeepaliveMs) && codexKeepaliveMs > 0) {
        keepalive = setInterval(() => {
          ping?.()
          emit({ type: 'response.created', response: { id: responseId } })
        }, codexKeepaliveMs)
      }
      if (message.generate === false) {
        emit(completedEvent(responseId))
        return
      }
      const browserEnvelope = routeResponsesToBrowser
        ? await routeBrowserResponse(message, { connectionId })
        : { type: 'assistant_text', content: hardcodedText }
      if (browserEnvelope.type === 'tool_call') {
        emit({
          type: 'response.output_item.done', output_index: 0,
          item: {
            type: 'function_call', call_id: browserEnvelope.callId,
            name: browserEnvelope.name,
            ...(browserEnvelope.namespace ? { namespace: browserEnvelope.namespace } : {}),
            arguments: JSON.stringify(browserEnvelope.arguments),
          },
        })
        emit(completedEvent(responseId))
        return
      }
      const responseText = browserEnvelope.content
      const itemId = `msg_tether_${responseSequence}`
      emit({ type: 'response.output_item.added', output_index: 0, item: assistantItem(itemId, '') })
      emit({ type: 'response.output_text.delta', item_id: itemId, output_index: 0, content_index: 0, delta: responseText })
      emit({ type: 'response.output_item.done', output_index: 0, item: assistantItem(itemId, responseText) })
      emit(completedEvent(responseId))
    } catch (error) {
      const code = error.code ?? 'invalid_request'
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`TETHER response failed (${connectionId}, ${code}): ${errorMessage}`)
      emit(failedEvent(responseId, code, errorMessage))
    } finally {
      if (keepalive !== null) clearInterval(keepalive)
    }
  }

  async function routeBrowserResponse(message, { connectionId }) {
    if (browserController) return browserController.request(message, { connectionId })
    const route = extensionSessions.selectRoute()
    if (route.mode === 'CLI') {
      return browserTurns.request(message, { connectionId, selection: route.endpoint })
    }
    const masterEnvelope = await browserTurns.request(message, {
      connectionId: `${connectionId}:master`,
      selection: route.master,
    })
    if (masterEnvelope.type !== 'assistant_text') return masterEnvelope
    const relayRequest = crossRelayRequest(message, masterEnvelope.content)
    return browserTurns.request(relayRequest, {
      connectionId: `${connectionId}:slave`,
      selection: route.slave,
    })
  }
}

function crossRelayRequest(original, masterText) {
  return {
    ...original,
    previous_response_id: null,
    client_metadata: {
      ...(original.client_metadata ?? {}),
      turn_id: `${original.client_metadata?.turn_id ?? 'turn'}-cross-slave`,
    },
    input: [{
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: masterText }],
    }],
  }
}

function sendHttpJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function sendSse(response, event) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

async function readHttpJson(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
      throw coded('request_too_large', 'Request exceeds 16 MiB')
    }
  }
  return parseRequest(text)
}

function parseRequest(text) {
  let message
  try {
    message = JSON.parse(text)
  } catch {
    throw coded('invalid_json', 'Request must be valid JSON')
  }
  // The realtime WebSocket client sends { type: "response.create", ... }.
  // The ordinary HTTP Responses API sends the same payload without that
  // transport command wrapper. Accept both at this boundary.
  if (!message ||
      (message.type !== undefined && message.type !== 'response.create') ||
      typeof message.model !== 'string' ||
      !Array.isArray(message.input)) {
    throw coded('invalid_request', 'Expected a Responses request with model and input')
  }
  return message
}

function assistantItem(id, text) {
  return { type: 'message', id, role: 'assistant', content: [{ type: 'output_text', text }] }
}

function completedEvent(id) {
  return {
    type: 'response.completed',
    response: {
      id,
      usage: {
        input_tokens: 0,
        input_tokens_details: null,
        output_tokens: 0,
        output_tokens_details: null,
        total_tokens: 0,
      },
    },
  }
}

function failedEvent(id, code, message) {
  return {
    type: 'response.failed',
    response: {
      id,
      status: 'failed',
      error: { type: code, code, message },
    },
  }
}

async function capture(path, record) {
  if (!path) return
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8')
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
