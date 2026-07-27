import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBrowserPrompt,
  buildProtocolBootstrapPrompt,
  buildToolDemoPrompt,
  buildUnavailableToolPrompt,
} from '../src/browser-prompt.js'

test('protocol bootstrap is an explicit instructional turn with examples and correlated acknowledgement', () => {
  const prompt = buildProtocolBootstrapPrompt('bootstrap-1')
  assert.match(prompt, /Follow these protocol rules for every later message/)
  assert.match(prompt, /OUTPUT DECISION/)
  assert.match(prompt, /tool_schema_request/)
  assert.match(prompt, /protocol_help_request/)
  assert.match(prompt, /windows-json/)
  assert.match(prompt, /JSON-escape/)
  assert.match(prompt, /final answer as ordinary plain text/)
  assert.match(prompt, /Do not wrap a final answer in assistant_text JSON/)
  assert.match(prompt, /codex_turn arrives automatically after every tool call/)
  assert.match(prompt, /Never stop merely because one tool call completed/)
  assert.match(prompt, /tether_tool_unavailable/)
  assert.match(prompt, /Never install or download it without explicit authorization/)
  assert.doesNotMatch(prompt, /COPY_FROM_REQUEST|COPY_THE_REQUEST_ID/)
  assert.match(prompt, /"requestId":"bootstrap-1"/)
  assert.ok(prompt.length < 4_000)
})

test('unavailable-tool recovery includes the rejected request, real catalog, and installation consent policy', () => {
  const payload = JSON.parse(buildUnavailableToolPrompt({
    requestId: 'request-1.tool-unavailable.1',
    originalRequestId: 'request-1',
    originalCommand: '{"type":"codex_turn"}',
    requestedTools: [{ name: 'invented_tool' }],
    offeredTools: [{ name: 'shell_command' }],
    attempt: 1,
    maxAttempts: 3,
  }))
  assert.equal(payload.type, 'tether_tool_unavailable')
  assert.deepEqual(payload.requestedTools, [{ name: 'invented_tool' }])
  assert.deepEqual(payload.offeredTools, [{ name: 'shell_command' }])
  assert.equal(payload.attempt, 1)
  assert.equal(payload.maxAttempts, 3)
  assert.match(payload.instruction, /offered tool can perform the work/)
  assert.match(payload.instruction, /asking the user for permission/)
  assert.match(payload.instruction, /from which source/)
  assert.match(payload.instruction, /Never install or download anything without explicit user authorization/)
})

test('compact turns contain only the command after the protocol bootstrap', () => {
  const requestId = 'request-compact-1'
  const prompt = buildBrowserPrompt({
    requestId,
    request: {
      type: 'response.create',
      model: 'tether-compact',
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Read C:\\Users\\Me\\file.pdf' }],
      }],
      tools: [{ type: 'function', name: 'shell_command' }],
    },
    installBootstrap: false,
  })
  assert.deepEqual(JSON.parse(prompt), {
    schemaVersion: 1,
    type: 'codex_turn',
    requestId,
    toolCatalog: [{ type: 'function', name: 'shell_command' }],
    turn: {
      input: [{
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Read C:\\Users\\Me\\file.pdf' }],
      }],
      completionPolicy: 'continue_until_objective_complete_or_user_input_required',
      toolChoice: 'auto',
      parallelToolCalls: false,
    },
  })
  assert.doesNotMatch(prompt, /OUTPUT DECISION|protocol command|JSON-escape|COMMAND JSON START/)
})

test('tether-smoke emits exactly six JSON lines with the correlated reply envelope', () => {
  const requestId = 'request-smoke-1'
  const prompt = buildBrowserPrompt({
    requestId,
    request: { type: 'response.create', model: 'tether-smoke' },
    installBootstrap: true,
  })
  assert.equal(prompt.split('\n').length, 6)
  const parsed = JSON.parse(prompt)
  assert.deepEqual(parsed, {
    schemaVersion: 1,
    type: 'tether_smoke_test',
    requestId,
    replyExactly: {
      schemaVersion: 1,
      type: 'assistant_text',
      requestId,
      content: 'TETHER_SIX_LINE_OK',
    },
  })
})

test('tether-demo sends one requested tool schema and a deterministic continuation contract', () => {
  const first = JSON.parse(buildToolDemoPrompt('demo-1', {
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'run it' }] }],
    tools: [{ type: 'function', name: 'shell_command', description: 'run PowerShell', parameters: { type: 'object' } }],
  }))
  assert.equal(first.type, 'tether_demo_tool_request')
  assert.equal(first.tool.name, 'shell_command')
  assert.match(first.instruction, /tool_call/)

  const second = JSON.parse(buildToolDemoPrompt('demo-2', {
    input: [{ type: 'function_call_output', call_id: 'call-1', output: 'TETHER_DEFERRED_TOOL_OK' }],
    tools: [],
  }))
  assert.equal(second.type, 'tether_demo_tool_result')
  assert.match(second.instruction, /TETHER_TOOL_CONTINUATION_OK/)
})
