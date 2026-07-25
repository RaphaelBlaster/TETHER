import { timingSafeEqual } from 'node:crypto'

export const XPOSE_MODEL_ID = 'tether-browser'
export const XPOSE_MAX_BODY_BYTES = 2 * 1024 * 1024

const XPOSE_PATHS = new Set(['/v1/models', '/v1/responses', '/v1/chat/completions'])

export function createXposeApi({
  apiToken,
  executeResponses,
  listSessions,
  modelId = XPOSE_MODEL_ID,
  maxBodyBytes = XPOSE_MAX_BODY_BYTES,
  maxConcurrentTurns = 1,
  now = () => Date.now(),
} = {}) {
  if (typeof apiToken !== 'string' || apiToken.length < 32) {
    throw new Error('XposE requires a strong API token')
  }
  let activeTurns = 0

  async function handle(request, response) {
    const pathname = requestPath(request.url)
    if (!XPOSE_PATHS.has(pathname)) return false
    try {
      assertLocalRequest(request)
      assertBearerToken(request.headers.authorization, apiToken)
      if (request.method === 'GET' && pathname === '/v1/models') {
        sendJson(response, 200, modelsResponse(modelId, listSessions(), now()))
        return true
      }
      if (request.method !== 'POST' || pathname === '/v1/models') {
        throw httpError(405, 'method_not_allowed', 'Method is not allowed for this endpoint')
      }
      if (activeTurns >= maxConcurrentTurns) {
        throw httpError(429, 'xpose_busy', 'The selected browser endpoint is already handling a request')
      }
      const body = await readJson(request, maxBodyBytes)
      activeTurns += 1
      try {
        const abort = requestAbortSignal(request, response)
        try {
          if (pathname === '/v1/responses') {
            await handleResponses(body, request, response, abort.signal)
          } else {
            await handleChatCompletions(body, request, response, abort.signal)
          }
        } finally {
          abort.dispose()
        }
      } finally {
        activeTurns -= 1
      }
      return true
    } catch (error) {
      if (!response.headersSent) sendOpenAiError(response, error)
      else if (!response.writableEnded) response.end()
      return true
    }
  }

  async function handleResponses(body, request, response, signal) {
    const parsed = normalizeResponsesRequest(body, modelId)
    const events = []
    let createdSent = false
    if (parsed.stream) writeSseHeaders(response)
    await executeResponses(parsed.request, {
      connectionId: xposeConnectionId(request),
      signal,
      emit(event) {
        events.push(event)
        if (!parsed.stream) return
        if (event.type === 'response.created' && createdSent) {
          response.write(': tether keepalive\n\n')
          return
        }
        if (event.type === 'response.created') createdSent = true
        sendResponseSse(response, event)
      },
    })
    const result = responseResult(events, parsed.requestedModel, now())
    if (parsed.stream) {
      response.end()
      return
    }
    sendJson(response, 200, result)
  }

  async function handleChatCompletions(body, request, response, signal) {
    const parsed = normalizeChatRequest(body, modelId)
    const events = []
    await executeResponses(parsed.request, {
      connectionId: xposeConnectionId(request),
      signal,
      emit: (event) => events.push(event),
    })
    const result = chatResult(events, parsed.requestedModel, now())
    if (!parsed.stream) {
      sendJson(response, 200, result)
      return
    }
    writeSseHeaders(response)
    for (const chunk of chatChunks(result)) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
    response.end('data: [DONE]\n\n')
  }

  return { handle, getActiveTurns: () => activeTurns }
}

function modelsResponse(modelId, registrations, timestamp) {
  const sessions = registrations.flatMap((registration) => registration.sessions ?? [])
    .filter((session) => session.transportMode === 'XPOSE')
  return {
    object: 'list',
    data: [{
      id: modelId,
      object: 'model',
      created: Math.floor(timestamp / 1000),
      owned_by: 'tether',
      metadata: {
        session_status: sessions.length === 1 ? 'ready' : sessions.length === 0 ? 'waiting' : 'ambiguous',
        active_sessions: sessions.length,
      },
    }],
  }
}

function normalizeResponsesRequest(body, modelId) {
  assertObject(body, 'Request body must be a JSON object')
  const requestedModel = requireModel(body.model, modelId)
  const input = typeof body.input === 'string'
    ? [userMessage(body.input)]
    : Array.isArray(body.input) ? body.input : null
  if (!input) throw httpError(400, 'invalid_request', 'Responses input must be a string or array')
  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    throw httpError(400, 'invalid_request', 'stream must be a boolean')
  }
  return {
    requestedModel,
    stream: body.stream === true,
    request: {
      type: 'response.create',
      model: 'tether-compact',
      instructions: typeof body.instructions === 'string' ? body.instructions : '',
      input,
      tools: normalizeResponsesTools(body.tools),
      tool_choice: body.tool_choice ?? 'auto',
      parallel_tool_calls: body.parallel_tool_calls === true,
      reasoning: body.reasoning ?? null,
      previous_response_id: typeof body.previous_response_id === 'string' ? body.previous_response_id : null,
      stream: true,
      store: false,
    },
  }
}

function normalizeChatRequest(body, modelId) {
  assertObject(body, 'Request body must be a JSON object')
  const requestedModel = requireModel(body.model, modelId)
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw httpError(400, 'invalid_request', 'messages must be a non-empty array')
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    throw httpError(400, 'invalid_request', 'stream must be a boolean')
  }
  const input = body.messages.flatMap(normalizeChatMessage)
  if (input.length === 0) throw httpError(400, 'invalid_request', 'messages contain no supported user or tool input')
  return {
    requestedModel,
    stream: body.stream === true,
    request: {
      type: 'response.create',
      model: 'tether-compact',
      instructions: chatInstructions(body.messages),
      input,
      tools: normalizeChatTools(body.tools),
      tool_choice: normalizeChatToolChoice(body.tool_choice),
      parallel_tool_calls: body.parallel_tool_calls === true,
      reasoning: null,
      previous_response_id: null,
      stream: true,
      store: false,
    },
  }
}

function normalizeChatMessage(message) {
  assertObject(message, 'Every chat message must be an object')
  if (message.role === 'system' || message.role === 'developer' || message.role === 'assistant') return []
  if (message.role === 'user') return [userMessage(chatText(message.content))]
  if (message.role === 'tool') {
    if (typeof message.tool_call_id !== 'string' || !message.tool_call_id) {
      throw httpError(400, 'invalid_request', 'Tool messages require tool_call_id')
    }
    return [{
      type: 'function_call_output',
      call_id: message.tool_call_id,
      output: chatText(message.content),
    }]
  }
  throw httpError(400, 'invalid_request', `Unsupported chat role: ${String(message.role)}`)
}

function chatInstructions(messages) {
  return messages
    .filter((message) => ['system', 'developer'].includes(message?.role))
    .map((message) => chatText(message.content))
    .join('\n\n')
}

function chatText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) throw httpError(400, 'invalid_request', 'Message content must be text')
  return content.map((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') return part.text
    throw httpError(400, 'invalid_request', 'Only text chat content is supported')
  }).join('')
}

function normalizeResponsesTools(tools) {
  if (tools === undefined) return []
  if (!Array.isArray(tools)) throw httpError(400, 'invalid_request', 'tools must be an array')
  return tools.map((tool) => {
    assertObject(tool, 'Every tool must be an object')
    if (tool.type !== 'function' || typeof tool.name !== 'string' || !tool.name) {
      throw httpError(400, 'invalid_request', 'Only named function tools are supported')
    }
    return {
      type: 'function',
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      parameters: isObject(tool.parameters) ? tool.parameters : { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    }
  })
}

function normalizeChatTools(tools) {
  if (tools === undefined) return []
  if (!Array.isArray(tools)) throw httpError(400, 'invalid_request', 'tools must be an array')
  return tools.map((tool) => {
    assertObject(tool, 'Every tool must be an object')
    if (tool.type !== 'function' || !isObject(tool.function) ||
        typeof tool.function.name !== 'string' || !tool.function.name) {
      throw httpError(400, 'invalid_request', 'Only named function tools are supported')
    }
    return {
      type: 'function',
      name: tool.function.name,
      description: typeof tool.function.description === 'string' ? tool.function.description : '',
      parameters: isObject(tool.function.parameters)
        ? tool.function.parameters
        : { type: 'object', properties: {} },
      ...(typeof tool.function.strict === 'boolean' ? { strict: tool.function.strict } : {}),
    }
  })
}

function normalizeChatToolChoice(choice) {
  if (choice === undefined || ['auto', 'none', 'required'].includes(choice)) return choice ?? 'auto'
  if (choice?.type === 'function' && typeof choice.function?.name === 'string') {
    return { type: 'function', name: choice.function.name }
  }
  throw httpError(400, 'invalid_request', 'Unsupported tool_choice')
}

function responseResult(events, model, timestamp) {
  const failed = events.find((event) => event.type === 'response.failed')
  if (failed) throw responseFailure(failed)
  const created = events.find((event) => event.type === 'response.created')
  const completed = events.find((event) => event.type === 'response.completed')
  if (!created || !completed) throw httpError(502, 'invalid_browser_response', 'Browser response did not complete')
  const items = events.filter((event) => event.type === 'response.output_item.done').map((event) => event.item)
  return {
    id: created.response.id,
    object: 'response',
    created_at: Math.floor(timestamp / 1000),
    status: 'completed',
    model,
    output: items,
    usage: completed.response.usage ?? zeroResponsesUsage(),
  }
}

function chatResult(events, model, timestamp) {
  const response = responseResult(events, model, timestamp)
  const item = response.output[0]
  let message
  let finishReason
  if (item?.type === 'function_call') {
    message = {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: item.call_id,
        type: 'function',
        function: { name: item.name, arguments: item.arguments },
      }],
    }
    finishReason = 'tool_calls'
  } else {
    const content = item?.content?.find((part) => part.type === 'output_text')?.text ?? ''
    message = { role: 'assistant', content }
    finishReason = 'stop'
  }
  return {
    id: response.id.replace(/^resp_/, 'chatcmpl_'),
    object: 'chat.completion',
    created: response.created_at,
    model,
    choices: [{ index: 0, message, logprobs: null, finish_reason: finishReason }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }
}

function chatChunks(result) {
  const choice = result.choices[0]
  const base = {
    id: result.id,
    object: 'chat.completion.chunk',
    created: result.created,
    model: result.model,
  }
  const chunks = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, logprobs: null, finish_reason: null }] }]
  if (choice.message.tool_calls) {
    chunks.push({
      ...base,
      choices: [{
        index: 0,
        delta: { tool_calls: choice.message.tool_calls.map((call, index) => ({ index, ...call })) },
        logprobs: null,
        finish_reason: null,
      }],
    })
  } else if (choice.message.content) {
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: { content: choice.message.content }, logprobs: null, finish_reason: null }],
    })
  }
  chunks.push({
    ...base,
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: choice.finish_reason }],
  })
  return chunks
}

function requestAbortSignal(request, response) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const close = () => { if (!response.writableEnded) abort() }
  request.once('aborted', abort)
  response.once('close', close)
  return {
    signal: controller.signal,
    dispose() {
      request.off('aborted', abort)
      response.off('close', close)
    },
  }
}

function assertLocalRequest(request) {
  if (!isLoopback(request.socket.remoteAddress)) {
    throw httpError(403, 'local_only', 'XposE accepts loopback clients only')
  }
  const host = String(request.headers.host ?? '')
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':', 1)[0]
  if (!['127.0.0.1', '::1', 'localhost'].includes(hostname.toLowerCase())) {
    throw httpError(403, 'invalid_host', 'Host header is not allowed')
  }
}

function assertBearerToken(header, expected) {
  const prefix = 'Bearer '
  if (typeof header !== 'string' || !header.startsWith(prefix)) {
    throw httpError(401, 'invalid_api_key', 'Missing bearer token')
  }
  const actual = Buffer.from(header.slice(prefix.length))
  const target = Buffer.from(expected)
  if (actual.length !== target.length || !timingSafeEqual(actual, target)) {
    throw httpError(401, 'invalid_api_key', 'Bearer token is invalid')
  }
}

function requireModel(value, modelId) {
  if (value !== modelId) throw httpError(400, 'model_not_found', `Model ${String(value)} is not available`)
  return value
}

function responseFailure(event) {
  const error = event.response?.error ?? {}
  return httpError(statusForCode(error.code), error.code ?? 'browser_request_failed', error.message ?? 'Browser request failed')
}

function statusForCode(code) {
  if (['no_active_session', 'ambiguous_session', 'cross_pair_incomplete', 'cross_not_supported', 'xpose_mode_required'].includes(code)) return 409
  if (['browser_turn_timeout', 'response_timeout'].includes(code)) return 504
  if (['extension_disconnected', 'browser_request_failed'].includes(code)) return 502
  if (code === 'request_cancelled') return 499
  return 400
}

async function readJson(request, maxBytes) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw httpError(413, 'request_too_large', `Request exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'invalid_json', 'Request body must be valid JSON')
  }
}

function requestPath(url) {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return ''
  }
}

function xposeConnectionId(request) {
  const client = request.headers['x-tether-client-id']
  return typeof client === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(client) ? `xpose:${client}` : 'xpose:http'
}

function sendResponseSse(response, event) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

function writeSseHeaders(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
}

function sendOpenAiError(response, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  sendJson(response, status, {
    error: {
      message: status === 500 ? 'Internal XposE error' : error.message,
      type: status >= 500 ? 'server_error' : 'invalid_request_error',
      param: null,
      code: error?.code ?? 'internal_error',
    },
  }, status === 401 ? { 'www-authenticate': 'Bearer realm="TETHER XposE"' } : {})
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  response.end(JSON.stringify(body))
}

function zeroResponsesUsage() {
  return {
    input_tokens: 0,
    input_tokens_details: null,
    output_tokens: 0,
    output_tokens_details: null,
    total_tokens: 0,
  }
}

function userMessage(text) {
  return { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
}

function isLoopback(address) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
}

function assertObject(value, message) {
  if (!isObject(value)) throw httpError(400, 'invalid_request', message)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}
