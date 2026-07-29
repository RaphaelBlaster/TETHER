#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

if (process.argv.includes('--help')) {
  process.stdout.write([
    'Run the same deterministic OpenAI Chat Completions tool loop against configured proxies.',
    '',
    'Environment:',
    '  OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL',
    '  TETHER_BASE_URL, TETHER_API_KEY, TETHER_MODEL (default tether-browser)',
    '  LEGACY_TETHER_BASE_URL, LEGACY_TETHER_API_KEY, LEGACY_TETHER_MODEL (optional)',
    '',
    'API keys are used for Authorization headers and are never written to the trace.',
    '',
  ].join('\n'))
  process.exit(0)
}

const targets = [
  target('omniroute', 'OMNIROUTE', false),
  target('tether-revised', 'TETHER', false),
  target('tether-legacy', 'LEGACY_TETHER', true),
].filter(Boolean)

if (targets.length === 0) {
  process.stderr.write('No proxy targets configured. Run with --help for environment variables.\n')
  process.exit(2)
}

const traces = []
for (const configured of targets) {
  try {
    traces.push(await runToolLoop(configured))
  } catch (error) {
    traces.push({
      target: configured.name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, traces }, null, 2)}\n`)

function target(name, prefix, optional) {
  const baseURL = process.env[`${prefix}_BASE_URL`]?.replace(/\/+$/, '')
  const apiKey = process.env[`${prefix}_API_KEY`]
  if (!baseURL || !apiKey) {
    if (optional) return null
    return null
  }
  return {
    name,
    baseURL: baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`,
    apiKey,
    model: process.env[`${prefix}_MODEL`] || (prefix === 'TETHER' ? 'tether-browser' : ''),
  }
}

async function runToolLoop(configured) {
  if (!configured.model) throw new Error(`${configured.name} model is not configured`)
  const sessionId = `comparison-${randomUUID()}`
  const messages = [{
    role: 'user',
    content: [
      'Use get_weather for Paris. Then use echo_text with a short summary of the result.',
      'After both tool results, give a final answer. Do not skip either tool.',
    ].join(' '),
  }]
  const stages = []

  for (let turn = 0; turn < 8; turn += 1) {
    const requestBody = {
      model: configured.model,
      stream: turn % 2 === 1,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    }
    const response = await fetch(`${configured.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configured.apiKey}`,
        'content-type': 'application/json',
        'x-tether-session-id': sessionId,
      },
      body: JSON.stringify(requestBody),
    })
    const raw = await response.text()
    const completion = requestBody.stream ? parseSseCompletion(raw) : parseJsonCompletion(raw)
    stages.push({
      turn,
      status: response.status,
      request: requestBody,
      rawResponse: raw,
      normalizedResponse: completion,
    })
    if (!response.ok) throw new Error(`${configured.name} returned HTTP ${response.status}`)
    const message = completion.choices?.[0]?.message
    if (!message) throw new Error(`${configured.name} returned no assistant message`)
    messages.push(message)
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      return { target: configured.name, sessionId, stages, final: message.content ?? '' }
    }
    for (const call of message.tool_calls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: executeFixtureTool(call),
      })
    }
  }
  throw new Error(`${configured.name} did not finish within 8 turns`)
}

function parseJsonCompletion(raw) {
  const value = JSON.parse(raw)
  if (value.error) throw new Error(value.error.message ?? JSON.stringify(value.error))
  return value
}

function parseSseCompletion(raw) {
  const chunks = raw.split(/\r?\n/)
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice(6)))
  if (chunks.length === 0) throw new Error('SSE response contained no data chunks')
  const first = chunks[0]
  const content = []
  const calls = new Map()
  let finishReason = null
  for (const chunk of chunks) {
    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (typeof choice.delta?.content === 'string') content.push(choice.delta.content)
    for (const delta of choice.delta?.tool_calls ?? []) {
      const call = calls.get(delta.index) ?? {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      }
      if (delta.id) call.id = delta.id
      if (delta.function?.name) call.function.name += delta.function.name
      if (delta.function?.arguments) call.function.arguments += delta.function.arguments
      calls.set(delta.index, call)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }
  return {
    id: first.id,
    object: 'chat.completion',
    model: first.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content.join('') || null,
        ...(calls.size > 0 ? { tool_calls: [...calls.values()] } : {}),
      },
      finish_reason: finishReason,
    }],
  }
}

function executeFixtureTool(call) {
  let args
  try {
    args = JSON.parse(call.function.arguments)
  } catch {
    return JSON.stringify({ error: 'fixture received malformed arguments' })
  }
  if (call.function.name === 'get_weather') {
    return JSON.stringify({ city: args.city, temperature_c: 22, conditions: 'clear' })
  }
  if (call.function.name === 'echo_text') {
    return JSON.stringify({ echoed: args.text })
  }
  return JSON.stringify({ error: `fixture refuses undeclared tool ${call.function.name}` })
}

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Return deterministic fixture weather for one city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'echo_text',
      description: 'Echo one text value.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
]
