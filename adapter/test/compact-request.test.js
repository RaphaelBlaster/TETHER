import assert from 'node:assert/strict'
import test from 'node:test'
import { compactInstallationState, compactProjectionState, compactToolCatalog, projectCompactRequest, selectDeferredToolDefinitions } from '../src/compact-request.js'
import { buildBrowserPromptSequence } from '../src/browser-prompt.js'
import { browserFrameTimeoutMs } from '../src/browser-turn-controller.js'

function request(overrides = {}) {
  return {
    type: 'response.create',
    model: 'tether-compact',
    instructions: 'Preserve these exact instructions.',
    previous_response_id: null,
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'static context' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'new user turn' }] },
    ],
    tools: [{
      type: 'function', name: 'shell_command',
      description: `Runs PowerShell.\n\n${'Repeated guidance '.repeat(100)}`,
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Command to execute.' } },
        required: ['command'], additionalProperties: false,
      },
    }],
    tool_choice: 'auto', parallel_tool_calls: false, stream: true, store: false,
    client_metadata: { session_id: 'must-not-cross-browser-boundary' },
    prompt_cache_key: 'must-not-cross-browser-boundary',
    ...overrides,
  }
}

test('compact projection drops runtime context and defers exact tool schemas behind a names-only catalog', () => {
  const original = request()
  const projected = projectCompactRequest({ requestId: 'req-1', request: original })
  const serialized = JSON.stringify(projected)
  assert.equal(serialized.includes('must-not-cross-browser-boundary'), false)
  assert.equal(projected.instructions, undefined)
  assert.equal(projected.context, undefined)
  assert.equal(projected.turn.input[0].content[0].text, 'new user turn')
  assert.deepEqual(projected.toolCatalog, [{ type: 'function', name: 'shell_command' }])
  assert.deepEqual(selectDeferredToolDefinitions(original.tools, [{ name: 'shell_command' }]), original.tools)
})

test('persistent conversation omits unchanged installed assets but keeps a new turn delta', () => {
  const first = request()
  const state = compactProjectionState(first, { connectionId: 'conn-1' })
  const followup = request({ input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'follow-up' }] }] })
  const projected = projectCompactRequest({ requestId: 'req-2', request: followup, conversation: state, connectionId: 'conn-1' })
  assert.equal(projected.install, undefined)
  assert.equal(projected.turn.input[0].content[0].text, 'follow-up')
})

test('same-connection repeated input is omitted but a new connection keeps its user turn', () => {
  const first = request()
  const state = compactProjectionState(first, { connectionId: 'conn-1' })
  const same = projectCompactRequest({ requestId: 'same', request: first, conversation: state, connectionId: 'conn-1' })
  assert.deepEqual(same.turn.input, [])
  const nextConnection = projectCompactRequest({ requestId: 'next', request: first, conversation: state, connectionId: 'conn-2' })
  assert.equal(nextConnection.turn.input[0].content[0].text, 'new user turn')
})

test('tool-result continuation preserves the complete output item and does not classify it as static context', () => {
  const output = { type: 'function_call_output', call_id: 'call-1', output: 'TETHER_TOOL_EXECUTED' }
  const continuation = request({ previous_response_id: 'resp-1', input: [output] })
  const projected = projectCompactRequest({ requestId: 'req-3', request: continuation, conversation: compactProjectionState(request(), { connectionId: 'conn-1' }), connectionId: 'conn-1' })
  assert.deepEqual(projected.turn.input, [output])
})

test('failed tool output is preserved verbatim for the next browser-model turn', () => {
  const failedOutput = {
    type: 'function_call_output',
    call_id: 'call-1',
    output: 'Access denied: the requested file could not be read.',
    is_error: true,
  }
  const continuation = request({ previous_response_id: 'resp-1', input: [failedOutput] })
  const projected = projectCompactRequest({
    requestId: 'req-tool-failure', request: continuation,
    conversation: compactProjectionState(request(), { connectionId: 'conn-1' }), connectionId: 'conn-1',
  })
  assert.deepEqual(projected.turn.input, [failedOutput])
})

test('installation checkpoint does not mark the unsent turn as delivered', () => {
  const state = compactInstallationState(request(), { connectionId: 'conn-1' })
  assert.equal(state.codexConnectionId, undefined)
  assert.equal(state.deliveredInputHashes, undefined)
  const retry = projectCompactRequest({ requestId: 'retry', request: request(), conversation: state, connectionId: 'conn-1' })
  assert.equal(retry.install, undefined)
  assert.equal(retry.turn.input[0].content[0].text, 'new user turn')
})

test('large exact tool definitions remain deferred behind one names-only turn', () => {
  const tools = [0, 1, 2].map((index) => ({
    type: 'function', name: `large_${index}`, description: `tool ${index}`,
    parameters: { type: 'object', properties: { value: { type: 'string', description: 'x'.repeat(40000) } } },
  }))
  const original = request({ tools })
  const frames = buildBrowserPromptSequence({
    requestId: 'req-large', request: original, installBootstrap: true, conversation: null, connectionId: 'conn-1',
  })
  assert.equal(frames.length, 2)
  assert.equal(frames[0].kind, 'install')
  assert.ok(frames.every((frame) => frame.prompt.length < 17000))
  const command = frames[1].prompt.match(/COMMAND JSON START\n([\s\S]+)\nCOMMAND JSON END$/)[1]
  const projected = JSON.parse(command)
  assert.deepEqual(projected.toolCatalog, compactToolCatalog(tools))
  assert.equal(projected.protocolBootstrap, undefined)
  assert.deepEqual(selectDeferredToolDefinitions(tools, tools.map(({ name }) => ({ name }))), tools)
  assert.equal(frames.at(-1).requestId, 'req-large')
})

test('large instructions and internal context never cross the browser boundary', () => {
  const instructions = 'instruction-'.repeat(5000)
  const contextItem = { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'context-'.repeat(8000) }] }
  const original = request({ instructions, input: [contextItem, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'delta' }] }] })
  const frames = buildBrowserPromptSequence({
    requestId: 'req-chunks', request: original, installBootstrap: true, conversation: null, connectionId: 'conn-chunks',
  })
  assert.ok(frames.every((frame) => frame.prompt.length < 17000))
  const serialized = frames.map((frame) => frame.prompt).join('\n')
  assert.equal(serialized.includes('instruction-instruction'), false)
  assert.equal(serialized.includes('context-context'), false)
  assert.match(serialized, /delta/)
})

test('huge Codex runtime payload projects to a browser prompt below the composer limit', () => {
  const original = request({
    instructions: 'system '.repeat(100_000),
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'skills '.repeat(100_000) }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello from user' }] },
    ],
    tools: Array.from({ length: 100 }, (_, index) => ({
      type: 'function', name: `tool_${index}`, description: 'description '.repeat(1000),
      parameters: { type: 'object', properties: { value: { type: 'string', description: 'schema '.repeat(1000) } } },
    })),
  })
  const projected = projectCompactRequest({ requestId: 'bounded', request: original, protocolBootstrap: 'bootstrap' })
  const serialized = JSON.stringify(projected)
  assert.ok(serialized.length < 16_000, `projected prompt was ${serialized.length} characters`)
  assert.match(serialized, /hello from user/)
  assert.equal(serialized.includes('skills skills'), false)
  assert.equal(serialized.includes('schema schema'), false)
})

test('large compact turn frames keep time for the post-write submit step', () => {
  assert.equal(browserFrameTimeoutMs({
    model: 'tether-compact', frame: { kind: 'turn', prompt: 'x'.repeat(20_000) },
    timeoutMs: 120_000, bootstrapTimeoutMs: 300_000,
  }), 300_000)
  assert.equal(browserFrameTimeoutMs({
    model: 'tether-compact', frame: { kind: 'turn', prompt: 'small' },
    timeoutMs: 120_000, bootstrapTimeoutMs: 300_000,
  }), 120_000)
})
