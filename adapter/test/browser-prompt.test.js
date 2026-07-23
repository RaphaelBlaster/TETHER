import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBrowserPrompt, buildProtocolBootstrapPrompt, buildToolDemoPrompt } from '../src/browser-prompt.js'

test('protocol bootstrap is an explicit instructional turn with examples and correlated acknowledgement', () => {
  const prompt = buildProtocolBootstrapPrompt('bootstrap-1')
  assert.match(prompt, /Follow these protocol rules for every later message/)
  assert.match(prompt, /OUTPUT DECISION/)
  assert.match(prompt, /tool_schema_request/)
  assert.match(prompt, /JSON-escape/)
  assert.doesNotMatch(prompt, /COPY_FROM_REQUEST|COPY_THE_REQUEST_ID/)
  assert.match(prompt, /"requestId":"bootstrap-1"/)
  assert.ok(prompt.length < 4_000)
})

test('compact turns repeat a concrete decision tree for weaker browser models', () => {
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
  assert.match(prompt, /OUTPUT DECISION/)
  assert.match(prompt, /local file/i)
  assert.match(prompt, /request the tool schema before.*tool_call/i)
  assert.match(prompt, /backslash/i)
  assert.match(prompt, new RegExp(requestId))
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
