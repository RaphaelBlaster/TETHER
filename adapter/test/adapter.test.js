import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTetherAdapter, HARDCODED_TEXT } from '../src/adapter.js'

test('handles warmup and an incremental hardcoded response on one Codex connection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-adapter-'))
  const capturePath = join(directory, 'requests.ndjson')
  const adapter = createTetherAdapter({ capturePath, logger: { error() {} } })
  const info = await adapter.start()
  t.after(async () => {
    await adapter.stop()
    await rm(directory, { recursive: true, force: true })
  })

  const socket = new WebSocket(info.websocketUrl)
  await opened(socket)

  socket.send(JSON.stringify(request({ generate: false })))
  const warmup = await collectThroughCompletion(socket)
  assert.deepEqual(warmup.map((event) => event.type), ['response.created', 'response.completed'])
  const warmupId = warmup[1].response.id

  socket.send(JSON.stringify(request({ previous_response_id: warmupId, input: [] })))
  const response = await collectThroughCompletion(socket)
  assert.deepEqual(response.map((event) => event.type), [
    'response.created',
    'response.output_item.added',
    'response.output_text.delta',
    'response.output_item.done',
    'response.completed',
  ])
  assert.equal(response[2].delta, HARDCODED_TEXT)
  assert.equal(response[3].item.content[0].text, HARDCODED_TEXT)

  const captures = (await readFile(capturePath, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(captures.length, 2)
  assert.equal(captures[0].request.generate, false)
  assert.equal(captures[1].request.previous_response_id, warmupId)
  assert.deepEqual(captures[1].request.input, [])
})

test('rejects malformed request JSON without closing the connection', async (t) => {
  const adapter = createTetherAdapter({ logger: { error() {} } })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const socket = new WebSocket(info.websocketUrl)
  await opened(socket)
  socket.send('{')
  const [event] = await collectEvents(socket, 1)
  assert.equal(event.type, 'response.failed')
  assert.equal(event.response.error.code, 'invalid_json')
})

test('terminates a timed-out browser turn with the native Responses failure event', async (t) => {
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    browserTurnTimeoutMs: 10,
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-timeout',
    sessions: [{ browserSessionId: 'browser-timeout', tabId: 8, origin: 'https://chat.example', providerId: 'example', conversationId: 'timeout-conversation' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)

  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  const extensionMessages = collectEvents(extension, 2)
  codex.send(JSON.stringify(request()))
  const events = await collectEvents(codex, 2)
  const [browserRequest, browserCancel] = await extensionMessages
  assert.deepEqual(events.map((event) => event.type), ['response.created', 'response.failed'])
  assert.equal(events[1].response.id, events[0].response.id)
  assert.equal(events[1].response.error.code, 'browser_turn_timeout')
  assert.equal(browserRequest.type, 'browser_request')
  assert.deepEqual(browserCancel, {
    protocol: 'tether-extension', version: 1, type: 'browser_cancel',
    requestId: browserRequest.requestId, browserSessionId: browserRequest.browserSessionId,
  })
})

test('emits parseable Responses activity while a browser turn is pending', async (t) => {
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    codexKeepaliveMs: 10,
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-keepalive',
    sessions: [{ browserSessionId: 'browser-keepalive', tabId: 18, origin: 'https://chat.example', providerId: 'example', conversationId: 'keepalive-conversation' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    setTimeout(() => extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { text: JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'late answer' }) },
    })), 35)
  })
  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request()))
  const events = await collectThroughCompletion(codex)
  assert.ok(events.filter((event) => event.type === 'response.created').length >= 2)
  assert.equal(events.find((event) => event.type === 'response.output_text.delta').delta, 'late answer')
})

test('streams a Responses-compatible HTTP fallback when WebSockets reconnect', async (t) => {
  const adapter = createTetherAdapter({ logger: { error() {} } })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const response = await fetch(`http://${info.host}:${info.port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request()),
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const body = await response.text()
  assert.match(body, /event: response\.output_text\.delta/)
  assert.match(body, /TETHER hardcoded Responses WebSocket round trip succeeded\./)
  assert.match(body, /event: response\.completed/)
})

test('routes consecutive Codex turns through one persistent browser conversation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-browser-turn-'))
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    conversationStatePath: join(directory, 'conversations.json'),
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(async () => {
    await adapter.stop()
    await rm(directory, { recursive: true, force: true })
  })

  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-1',
    sessions: [{ browserSessionId: 'browser-1', tabId: 7, origin: 'https://chat.example', providerId: 'example', conversationId: 'conversation-1' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)

  const browserRequests = []
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    browserRequests.push(message)
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { text: JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: `browser answer ${browserRequests.length}` }) },
    }))
  })

  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request({
    client_metadata: { turn_id: 'turn-1' },
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'INTERNAL_ENVIRONMENT_CONTEXT' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ],
  })))
  const first = await collectThroughCompletion(codex)
  assert.equal(first.find((event) => event.type === 'response.output_text.delta').delta, 'browser answer 1')
  assert.equal(browserRequests[0].payload.installBootstrap, true)
  assert.match(browserRequests[0].payload.prompt, /TETHER browser protocol/)
  assert.match(browserRequests[0].payload.prompt, /"type":"response.create"/)
  assert.match(browserRequests[0].payload.prompt, /Use the available tools/)
  assert.match(browserRequests[0].payload.prompt, /INTERNAL_ENVIRONMENT_CONTEXT/)
  assert.doesNotMatch(browserRequests[0].payload.prompt, /[\r\n]/)
  assert.ok(browserRequests[0].payload.prompt.length <= 4096)

  codex.send(JSON.stringify(request({ client_metadata: { turn_id: 'turn-2' }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second' }] }] })))
  const second = await collectThroughCompletion(codex)
  assert.equal(second.find((event) => event.type === 'response.output_text.delta').delta, 'browser answer 2')
  assert.equal(browserRequests[1].payload.installBootstrap, false)
  assert.doesNotMatch(browserRequests[1].payload.prompt, /TETHER browser protocol/)
  assert.match(browserRequests[1].payload.prompt, /"type":"response.create"/)
})

test('CROSS relays one bounded MASTER answer through the SLAVE and returns the SLAVE answer', async (t) => {
  const adapter = createTetherAdapter({ routeResponsesToBrowser: true, logger: { error() {} } })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-cross',
    sessions: [
      { browserSessionId: 'browser-master', tabId: 7, origin: 'https://gemini.google.com', providerId: 'gemini', conversationId: null, transportMode: 'CROSS', role: 'MASTER' },
      { browserSessionId: 'browser-slave', tabId: 8, origin: 'https://support.example.com', providerId: 'site:support', conversationId: null, transportMode: 'CROSS', role: 'SLAVE' },
    ],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)

  const routed = []
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    routed.push(message.browserSessionId)
    const isMaster = message.browserSessionId === 'browser-master'
    if (!isMaster) assert.match(message.payload.prompt, /MASTER OUTPUT/)
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { text: JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: isMaster ? 'MASTER OUTPUT' : 'SLAVE OUTPUT' }) },
    }))
  })

  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request({ client_metadata: { turn_id: 'cross-turn' } })))
  const events = await collectThroughCompletion(codex)
  assert.deepEqual(routed, ['browser-master', 'browser-slave'])
  assert.equal(events.find((event) => event.type === 'response.output_text.delta').delta, 'SLAVE OUTPUT')
  codex.close()
  extension.close()
})

test('translates a browser tool call and sends its Codex result back as a delta', async (t) => {
  const adapter = createTetherAdapter({ routeResponsesToBrowser: true, logger: { error() {} } })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-tools',
    sessions: [{ browserSessionId: 'browser-tools', tabId: 9, origin: 'https://chat.example', providerId: 'example', conversationId: 'tools-conversation' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)

  const browserRequests = []
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    browserRequests.push(message)
    const response = browserRequests.length === 1
      ? { schemaVersion: 1, type: 'tool_call', requestId: message.requestId, callId: 'call-date', name: 'shell_command', arguments: { command: 'Get-Date' } }
      : { schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'tool result received' }
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId, payload: { text: JSON.stringify(response) },
    }))
  })

  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  const tools = [{ type: 'function', name: 'shell_command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }]
  codex.send(JSON.stringify(request({ client_metadata: { turn_id: 'tool-turn' }, tools })))
  const callEvents = await collectThroughCompletion(codex)
  const call = callEvents.find((event) => event.type === 'response.output_item.done').item
  assert.deepEqual(call, { type: 'function_call', call_id: 'call-date', name: 'shell_command', arguments: '{"command":"Get-Date"}' })

  codex.send(JSON.stringify(request({
    client_metadata: { turn_id: 'tool-turn' }, previous_response_id: callEvents.at(-1).response.id, tools,
    input: [{ type: 'function_call_output', call_id: 'call-date', output: 'Sunday, July 13, 2026' }],
  })))
  const finalEvents = await collectThroughCompletion(codex)
  assert.equal(finalEvents.find((event) => event.type === 'response.output_text.delta').delta, 'tool result received')
  assert.equal(browserRequests.length, 2)
  assert.notEqual(browserRequests[0].requestId, browserRequests[1].requestId)
  assert.match(browserRequests[1].payload.prompt, /function_call_output/)
  assert.match(browserRequests[1].payload.prompt, /Sunday, July 13, 2026/)
})

test('deferred compact tooling delivers one exact schema then continues with the Codex tool result', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-deferred-tool-'))
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    conversationStatePath: join(directory, 'conversations.json'),
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(async () => { await adapter.stop(); await rm(directory, { recursive: true, force: true }) })
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-deferred',
    sessions: [{ browserSessionId: 'browser-deferred', tabId: 10, origin: 'https://chat.example', providerId: 'example', conversationId: 'deferred-conversation' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)

  const exactTool = {
    type: 'function', name: 'shell_command', description: 'Runs PowerShell safely.', strict: false,
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
  }
  let sawCatalog = false
  let sawExactSchema = false
  let sawToolResult = false
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    let response
    if (message.payload.prompt.startsWith('You are the model endpoint for a coding agent connected through TETHER.')) {
      response = { schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'TETHER_INSTALL_OK' }
    } else {
    const payload = browserPayload(message.payload.prompt)
    if (payload.type === 'tether_install') {
      sawCatalog ||= payload.patches.some((patch) => patch.section === 'tools' && JSON.stringify(patch.value).includes('shell_command') && !JSON.stringify(patch.value).includes('parameters'))
      response = payload.replyExactly
    } else if (payload.type === 'codex_turn' && !sawExactSchema) {
      sawCatalog ||= JSON.stringify(payload.toolCatalog).includes('shell_command') &&
        !JSON.stringify(payload.toolCatalog).includes('parameters')
      response = { schemaVersion: 1, type: 'tool_schema_request', requestId: message.requestId, tools: [{ name: 'shell_command' }] }
    } else if (payload.type === 'tether_tool_schema') {
      assert.deepEqual(payload.definitions, [exactTool])
      sawExactSchema = true
      response = { schemaVersion: 1, type: 'tool_call', requestId: message.requestId, callId: 'call-deferred', name: 'shell_command', arguments: { command: 'Get-Date' } }
    } else {
      sawToolResult = JSON.stringify(payload).includes('function_call_output')
      response = { schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'deferred tool result received' }
    }
    }
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId, payload: { text: JSON.stringify(response) },
    }))
  })

  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request({ model: 'tether-compact', tools: [exactTool] })))
  const first = await collectThroughCompletion(codex)
  const call = first.find((event) => event.type === 'response.output_item.done').item
  assert.equal(call.type, 'function_call')
  assert.equal(call.call_id, 'call-deferred')
  assert.equal(sawCatalog, true)
  assert.equal(sawExactSchema, true)

  codex.send(JSON.stringify(request({
    model: 'tether-compact', tools: [exactTool], previous_response_id: first.at(-1).response.id,
    input: [{ type: 'function_call_output', call_id: 'call-deferred', output: '2026-07-14' }],
  })))
  const second = await collectThroughCompletion(codex)
  assert.equal(second.find((event) => event.type === 'response.output_text.delta').delta, 'deferred tool result received')
  assert.equal(sawToolResult, true)
})

test('repairs one invented deferred schema request without accepting the unavailable tool', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-schema-repair-'))
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    conversationStatePath: join(directory, 'conversations.json'),
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(async () => { await adapter.stop(); await rm(directory, { recursive: true, force: true }) })
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-repair',
    sessions: [{ browserSessionId: 'browser-repair', tabId: 11, origin: 'https://chat.example', providerId: 'example', conversationId: 'repair-conversation' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  const exactTool = { type: 'function', name: 'shell_command', description: 'Runs a command.', parameters: { type: 'object' } }
  let repairSeen = false
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    let response
    if (message.payload.prompt.startsWith('You are the model endpoint for a coding agent connected through TETHER.')) {
      response = { schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'TETHER_INSTALL_OK' }
    } else {
    const payload = browserPayload(message.payload.prompt)
    if (payload.type === 'tether_install') response = payload.replyExactly
    else if (payload.type === 'codex_turn') {
      response = { schemaVersion: 1, type: 'tool_schema_request', requestId: message.requestId, tools: [{ name: 'invented_tool' }] }
    } else {
      assert.equal(payload.type, 'tether_protocol_repair')
      assert.deepEqual(payload.offeredTools, [{ name: 'shell_command' }])
      assert.equal(browserPayload(payload.originalCommand).turn.input[0].content[0].text, 'hello')
      assert.equal(payload.originalRequestId, message.requestId.replace('.repair.1', ''))
      repairSeen = true
      response = { schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'repair completed' }
    }
    }
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId, payload: { text: JSON.stringify(response) },
    }))
  })
  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request({ model: 'tether-compact', tools: [exactTool] })))
  const events = await collectThroughCompletion(codex)
  assert.equal(events.find((event) => event.type === 'response.output_text.delta').delta, 'repair completed')
  assert.equal(repairSeen, true)
})

test('repairs one plain-text browser answer into the required assistant envelope', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-envelope-repair-'))
  const adapter = createTetherAdapter({ routeResponsesToBrowser: true, conversationStatePath: join(directory, 'conversations.json'), logger: { error() {} } })
  const info = await adapter.start()
  t.after(async () => { await adapter.stop(); await rm(directory, { recursive: true, force: true }) })
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension', version: 1, type: 'hello', extensionInstanceId: 'extension-plain-repair',
    sessions: [{ browserSessionId: 'browser-plain-repair', tabId: 12, origin: 'https://chat.example', providerId: 'example', conversationId: 'plain-repair' }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    let text
    if (message.payload.prompt.startsWith('You are the model endpoint for a coding agent connected through TETHER.')) {
      text = JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: 'TETHER_INSTALL_OK' })
    } else {
    const payload = browserPayload(message.payload.prompt)
    if (payload.type === 'tether_install') text = JSON.stringify(payload.replyExactly)
    else if (payload.type === 'codex_turn') text = 'ALPHA TETHER\nBETA BROWSER\nGAMMA CODEX'
    else {
      assert.equal(payload.type, 'tether_protocol_repair')
      assert.equal(payload.previousResponse, 'ALPHA TETHER\nBETA BROWSER\nGAMMA CODEX')
      text = JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: message.requestId, content: payload.previousResponse })
    }
    }
    extension.send(JSON.stringify({
      protocol: 'tether-extension', version: 1, type: 'browser_completed', requestId: message.requestId,
      browserSessionId: message.browserSessionId, payload: { text },
    }))
  })
  const codex = new WebSocket(info.websocketUrl)
  await opened(codex)
  codex.send(JSON.stringify(request({ model: 'tether-compact', tools: [] })))
  const events = await collectThroughCompletion(codex)
  assert.equal(events.find((event) => event.type === 'response.output_text.delta').delta, 'ALPHA TETHER\nBETA BROWSER\nGAMMA CODEX')
})

function browserPayload(prompt) {
  const match = String(prompt).match(/COMMAND JSON START\n([\s\S]+)\nCOMMAND JSON END$/)
  return JSON.parse(match ? match[1] : prompt)
}

function request(overrides = {}) {
  return {
    type: 'response.create',
    model: 'gpt-test',
    instructions: 'Use the available tools.',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    reasoning: null,
    store: false,
    stream: true,
    include: [],
    ...overrides,
  }
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function collectThroughCompletion(socket) {
  return new Promise((resolve, reject) => {
    const events = []
    const onMessage = (message) => {
      const event = JSON.parse(message.data)
      events.push(event)
      if (event.type === 'response.completed') {
        socket.removeEventListener('message', onMessage)
        resolve(events)
      }
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', reject, { once: true })
  })
}

function collectEvents(socket, count) {
  return new Promise((resolve, reject) => {
    const events = []
    const onMessage = (message) => {
      events.push(JSON.parse(message.data))
      if (events.length === count) {
        socket.removeEventListener('message', onMessage)
        resolve(events)
      }
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', reject, { once: true })
  })
}
