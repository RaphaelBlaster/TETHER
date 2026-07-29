import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTetherAdapter } from '../src/adapter.js'

const API_TOKEN = 'x'.repeat(43)

test('XposE serves authenticated Models, Responses, Chat Completions, tools, and SSE', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-api-'))
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    conversationStatePath: join(directory, 'conversations.json'),
    xpose: {
      apiToken: API_TOKEN,
      authenticateExtension: async () => ({ paired: true }),
    },
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(async () => {
    await adapter.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  const xposeReady = nextMessageOfType(extension, 'xpose_ready')
  extension.send(JSON.stringify({
    protocol: 'tether-extension',
    version: 1,
    type: 'hello',
    extensionInstanceId: 'extension-xpose',
    pairingToken: 'a'.repeat(43),
    sessions: [{
      browserSessionId: 'browser-xpose',
      tabId: 21,
      origin: 'https://gemini.google.com',
      providerId: 'gemini',
      conversationId: 'xpose-conversation',
      transportMode: 'XPOSE',
    }],
  }))
  assert.deepEqual(await xposeReady, {
    protocol: 'tether-extension',
    version: 1,
    type: 'xpose_ready',
    baseUrl: info.baseUrl,
    model: 'tether-browser',
  })
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  let browserRequestCount = 0
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type !== 'browser_request') return
    browserRequestCount += 1
    let text
    if (message.payload.prompt.startsWith('You are the model endpoint for a coding agent connected through TETHER.')) {
      text = JSON.stringify({
        schemaVersion: 1,
        type: 'assistant_text',
        requestId: message.requestId,
        content: 'TETHER_INSTALL_OK',
      })
    } else if (message.payload.prompt.includes('Tool result (')) {
      assert.doesNotMatch(message.payload.prompt, /SYSTEM START PROMPT/)
      assert.doesNotMatch(message.payload.prompt, /Available tools:/)
      text = 'browser:tool result accepted; task complete'
    } else if (message.payload.prompt.includes('Available tools:')) {
      if (message.payload.prompt.includes('use two tools')) {
        assert.doesNotMatch(message.payload.prompt, /SYSTEM START PROMPT/)
        text = [
          '<tool>{"name":"echo_text","arguments":{"text":"' + 'x'.repeat(140) + '"}}</tool>',
          '<tool>{"name":"get_number","arguments":{}}</tool>',
        ].join('\n')
      } else {
        assert.match(message.payload.prompt, /SYSTEM START PROMPT/)
        assert.match(message.payload.prompt, /echo_text/)
        assert.match(message.payload.prompt, /additionalProperties/)
        text = 'I will use the tool.\n<tool>{"name":"echo_text","arguments":{"text":"hello"}}</tool>'
      }
    } else if (message.payload.prompt.startsWith('User: ') || message.payload.prompt.includes('\n\nUser: ')) {
      const marker = message.payload.prompt.lastIndexOf('User: ')
      text = `browser:${message.payload.prompt.slice(marker + 'User: '.length)}`
    } else {
      const command = JSON.parse(message.payload.prompt)
      if (command.type === 'tether_tool_schema') {
        assert.equal(command.definitions[0].name, 'echo_text')
        text = JSON.stringify({
          schemaVersion: 1,
          type: 'tool_call',
          requestId: message.requestId,
          callId: 'call-echo',
          name: 'echo_text',
          arguments: { text: 'hello' },
        })
      } else if (command.toolCatalog?.some((tool) => tool.name === 'echo_text')) {
        text = JSON.stringify({
          schemaVersion: 1,
          type: 'tool_schema_request',
          requestId: message.requestId,
          tools: [{ name: 'echo_text' }],
        })
      } else {
        const visible = command.turn.input.at(-1)
        const visibleText = visible?.type === 'message'
          ? visible.content[0].text
          : visible?.output ?? 'no input'
        text = JSON.stringify({
          schemaVersion: 1,
          type: 'assistant_text',
          requestId: message.requestId,
          content: `browser:${visibleText}`,
        })
      }
    }
    extension.send(JSON.stringify({
      protocol: 'tether-extension',
      version: 1,
      type: 'browser_completed',
      requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { text },
    }))
  })

  const unauthorized = await fetch(`${info.baseUrl}/models`)
  assert.equal(unauthorized.status, 401)
  assert.equal((await unauthorized.json()).error.code, 'invalid_api_key')

  const invalidHost = await rawRequest(`${info.baseUrl}/models`, {
    authorization: `Bearer ${API_TOKEN}`,
    host: 'attacker.example',
  })
  assert.equal(invalidHost.status, 403)
  assert.equal(JSON.parse(invalidHost.body).error.code, 'invalid_host')

  const models = await authenticatedFetch(`${info.baseUrl}/models`)
  assert.equal(models.status, 200)
  assert.deepEqual((await models.json()).data.map((model) => model.id), ['tether-browser'])

  const browserRequestsBeforeTitle = browserRequestCount
  const title = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      stream: true,
      messages: [
        {
          role: 'system',
          content: 'You are a title generator. You output ONLY a thread title. Nothing else.',
        },
        { role: 'user', content: 'hih' },
      ],
    }),
  })
  assert.equal(title.status, 200)
  const titleSse = await title.text()
  assert.match(titleSse, /"content":"hih"/)
  assert.match(titleSse, /data: \[DONE\]/)
  assert.equal(browserRequestCount, browserRequestsBeforeTitle)

  const chat = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [{ role: 'user', content: 'hello from chat' }],
    }),
  })
  assert.equal(chat.status, 200)
  const chatBody = await chat.json()
  assert.equal(chatBody.object, 'chat.completion')
  assert.equal(chatBody.choices[0].message.content, 'browser:hello from chat')
  assert.equal(chatBody.choices[0].finish_reason, 'stop')

  const responses = await authenticatedFetch(`${info.baseUrl}/responses`, {
    method: 'POST',
    body: JSON.stringify({ model: 'tether-browser', input: 'hello from responses' }),
  })
  assert.equal(responses.status, 200)
  const responsesBody = await responses.json()
  assert.equal(responsesBody.object, 'response')
  assert.equal(responsesBody.output[0].content[0].text, 'browser:hello from responses')

  const codexTools = await authenticatedFetch(`${info.baseUrl}/responses`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      input: 'hello from Codex tools',
      tools: [
        {
          type: 'namespace',
          name: 'workspace',
          tools: [{
            type: 'function',
            name: 'read_file',
            description: 'Read one file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          }],
        },
        { type: 'web_search' },
      ],
    }),
  })
  assert.equal(codexTools.status, 200)
  const codexToolsBody = await codexTools.json()
  assert.equal(codexToolsBody.output[0].content[0].text, 'browser:hello from Codex tools')

  const streamed = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      stream: true,
      messages: [{ role: 'user', content: 'hello stream' }],
    }),
  })
  assert.match(streamed.headers.get('content-type'), /text\/event-stream/)
  const streamBody = await streamed.text()
  assert.match(streamBody, /chat\.completion\.chunk/)
  assert.match(streamBody, /browser:hello stream/)
  assert.match(streamBody, /data: \[DONE\]/)

  const tool = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [
        { role: 'system', content: 'SYSTEM START PROMPT' },
        { role: 'user', content: 'use the echo tool' },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'echo_text',
          description: 'Echo text.',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
      }],
    }),
  })
  assert.equal(tool.status, 200)
  const toolBody = await tool.json()
  assert.equal(toolBody.choices[0].finish_reason, 'tool_calls')
  assert.equal(toolBody.choices[0].message.tool_calls.length, 1)
  assert.match(toolBody.choices[0].message.tool_calls[0].id, /^call-\d+_0$/)
  assert.deepEqual(toolBody.choices[0].message.tool_calls[0].function, {
    name: 'echo_text',
    arguments: '{"text":"hello"}',
  })

  const toolCall = toolBody.choices[0].message.tool_calls[0]
  const continuation = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [
        { role: 'user', content: 'use the echo tool' },
        { role: 'assistant', content: null, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: toolCall.id, content: 'hello' },
      ],
    }),
  })
  assert.equal(continuation.status, 200)
  const continuationBody = await continuation.json()
  assert.equal(continuationBody.choices[0].finish_reason, 'stop')
  assert.equal(continuationBody.choices[0].message.content, 'browser:tool result accepted; task complete')

  const multipleStream = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      stream: true,
      messages: [
        { role: 'user', content: 'use the echo tool' },
        { role: 'assistant', content: null, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: toolCall.id, content: 'hello' },
        { role: 'user', content: 'use two tools' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'echo_text',
            parameters: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'get_number',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        },
      ],
    }),
  })
  assert.equal(multipleStream.status, 200)
  const multipleSse = await multipleStream.text()
  const chunks = multipleSse.split('\n')
    .filter((line) => line.startsWith('data: {'))
    .map((line) => JSON.parse(line.slice(6)))
  const toolDeltas = chunks.flatMap((chunk) => chunk.choices[0].delta.tool_calls ?? [])
  assert.deepEqual([...new Set(toolDeltas.map((delta) => delta.index))], [0, 1])
  assert.ok(toolDeltas.filter((delta) => delta.index === 0 && delta.function?.arguments).length >= 3)
  assert.equal(chunks.at(-1).choices[0].finish_reason, 'tool_calls')
})

test('XposE rejects CROSS sessions instead of relaying them', async (t) => {
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    xpose: { apiToken: API_TOKEN, authenticateExtension: async () => ({ paired: true }) },
    logger: { error() {} },
  })
  const info = await adapter.start()
  t.after(() => adapter.stop())
  const extension = new WebSocket(info.extensionWebsocketUrl)
  await opened(extension)
  extension.send(JSON.stringify({
    protocol: 'tether-extension',
    version: 1,
    type: 'hello',
    extensionInstanceId: 'extension-cross-xpose',
    pairingToken: 'b'.repeat(43),
    sessions: [
      {
        browserSessionId: 'master',
        tabId: 30,
        origin: 'https://gemini.google.com',
        providerId: 'gemini',
        conversationId: 'master',
        transportMode: 'CROSS',
        role: 'MASTER',
      },
      {
        browserSessionId: 'slave',
        tabId: 31,
        origin: 'https://chatgpt.com',
        providerId: 'chatgpt',
        conversationId: 'slave',
        transportMode: 'CROSS',
        role: 'SLAVE',
      },
    ],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  const response = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, 'cross_not_supported')
})

test('XposE bounds concurrent turns and propagates client cancellation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tether-xpose-cancel-'))
  const adapter = createTetherAdapter({
    routeResponsesToBrowser: true,
    conversationStatePath: join(directory, 'conversations.json'),
    xpose: { apiToken: API_TOKEN, authenticateExtension: async () => ({ paired: true }) },
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
    protocol: 'tether-extension',
    version: 1,
    type: 'hello',
    extensionInstanceId: 'extension-cancel-xpose',
    pairingToken: 'c'.repeat(43),
    sessions: [{
      browserSessionId: 'browser-cancel-xpose',
      tabId: 40,
      origin: 'https://gemini.google.com',
      providerId: 'gemini',
      conversationId: 'cancel-conversation',
      transportMode: 'XPOSE',
    }],
  }))
  await waitFor(() => adapter.listExtensionRegistrations().length === 1)
  let heldRequest = null
  let resolveHeld
  let resolveCancelled
  const held = new Promise((resolve) => { resolveHeld = resolve })
  const cancelled = new Promise((resolve) => { resolveCancelled = resolve })
  extension.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.type === 'browser_cancel' && heldRequest?.requestId === message.requestId) {
      resolveCancelled(message)
      heldRequest = null
      return
    }
    if (message.type !== 'browser_request') return
    if (message.payload.prompt.startsWith('You are the model endpoint for a coding agent connected through TETHER.')) {
      extension.send(JSON.stringify({
        protocol: 'tether-extension',
        version: 1,
        type: 'browser_completed',
        requestId: message.requestId,
        browserSessionId: message.browserSessionId,
        payload: { text: JSON.stringify({
          schemaVersion: 1,
          type: 'assistant_text',
          requestId: message.requestId,
          content: 'TETHER_INSTALL_OK',
        }) },
      }))
      return
    }
    if (!heldRequest) {
      heldRequest = message
      resolveHeld()
      return
    }
    extension.send(JSON.stringify({
      protocol: 'tether-extension',
      version: 1,
      type: 'browser_completed',
      requestId: message.requestId,
      browserSessionId: message.browserSessionId,
      payload: { text: JSON.stringify({
        schemaVersion: 1,
        type: 'assistant_text',
        requestId: message.requestId,
        content: 'completed after cancellation',
      }) },
    }))
  })
  const abort = new AbortController()
  const first = authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    signal: abort.signal,
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [{ role: 'user', content: 'hold this request' }],
    }),
  })
  await held
  const concurrent = await authenticatedFetch(`${info.baseUrl}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'tether-browser',
      messages: [{ role: 'user', content: 'second request' }],
    }),
  })
  assert.equal(concurrent.status, 429)
  assert.equal((await concurrent.json()).error.code, 'xpose_busy')
  abort.abort()
  await assert.rejects(first, { name: 'AbortError' })
  const cancelMessage = await cancelled
  assert.equal(cancelMessage.browserSessionId, 'browser-cancel-xpose')
})

function authenticatedFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      'content-type': 'application/json',
      'x-tether-session-id': 'xpose-api-test-session',
      ...options.headers,
    },
  })
}

function rawRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', reject)
    request.end()
  })
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

function nextMessageOfType(socket, type) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.type !== type) return
      socket.removeEventListener('message', onMessage)
      resolve(message)
    }
    socket.addEventListener('message', onMessage)
    socket.addEventListener('error', reject, { once: true })
  })
}
