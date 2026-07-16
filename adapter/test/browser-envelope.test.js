import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBrowserEnvelope, parseBrowserResponse } from '../src/browser-envelope.js'

test('invalid JSON reports one bounded diagnostic preview', () => {
  assert.throws(
    () => parseBrowserEnvelope(`not-json ${'x'.repeat(400)}`, 'request-1'),
    (error) => error.code === 'invalid_browser_json' && error.message.includes('not-json') &&
      error.message.length < 340 && error.details.rawText.startsWith('not-json'),
  )
})

test('translates unambiguous plain browser text without weakening JSON tool validation', () => {
  assert.deepEqual(parseBrowserResponse('first line\nsecond line', 'request-1'), {
    schemaVersion: 1, type: 'assistant_text', requestId: 'request-1', content: 'first line\nsecond line',
  })
  assert.throws(() => parseBrowserResponse('{"type":"tool_call","name":"invented"}', 'request-1', []), {
    code: 'invalid_browser_envelope',
  })
})

test('selects the one current TETHER envelope from adjacent browser DOM text', () => {
  const current = { schemaVersion: 1, type: 'assistant_text', requestId: 'current', content: 'OK' }
  const text = [
    JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: 'old', content: 'OLD' }),
    JSON.stringify({ schemaVersion: 1, type: 'tether_install', requestId: 'current' }),
    JSON.stringify(current),
  ].join(' ')
  assert.deepEqual(parseBrowserEnvelope(text, 'current'), current)
})

test('accepts a uniquely correlated JSON envelope after a Gemini speaker prefix', () => {
  const current = { schemaVersion: 1, type: 'assistant_text', requestId: 'current', content: 'OK' }
  assert.deepEqual(parseBrowserResponse(`Gemini said ${JSON.stringify(current)}`, 'current'), current)
})

test('accepts a prefixed legacy complete envelope after inferring its assistant type', () => {
  const current = { schemaVersion: 1, requestId: 'current', content: 'OK' }
  assert.deepEqual(parseBrowserResponse(`Gemini said ${JSON.stringify(current)}`, 'current'), {
    schemaVersion: 1, type: 'assistant_text', requestId: 'current', content: 'OK',
  })
})

test('repairs a missing requestId on one speaker-prefixed offered tool call', () => {
  const toolCall = {
    schemaVersion: 1, type: 'tool_call', callId: 'tether-call-0',
    name: 'shell_command', arguments: { command: "Get-Content -LiteralPath 'C:\\test.txt'" },
  }
  for (const speaker of ['Gemini said', 'Claude said']) {
    assert.deepEqual(parseBrowserResponse(`${speaker} ${JSON.stringify(toolCall)}`, 'current', ['shell_command']), {
      ...toolCall, requestId: 'current',
    })
  }
})

test('repairs raw Windows backslashes in a speaker-prefixed tool call', () => {
  const response = String.raw`Gemini said {"schemaVersion":1,"type":"tool_call","callId":"tether-call-1","name":"shell_command","arguments":{"command":"Get-Content -LiteralPath 'C:\Users\Megh Mayur\OneDrive\Desktop\test.txt'"}}`
  const envelope = parseBrowserResponse(response, 'current', ['shell_command'])
  assert.equal(envelope.type, 'tool_call')
  assert.equal(envelope.requestId, 'current')
  assert.equal(envelope.arguments.command, String.raw`Get-Content -LiteralPath 'C:\Users\Megh Mayur\OneDrive\Desktop\test.txt'`)
})

test('does not repair uncorrelated tool JSON embedded in ordinary prose', () => {
  const toolCall = JSON.stringify({
    schemaVersion: 1, type: 'tool_call', callId: 'call-1',
    name: 'shell_command', arguments: { command: 'Get-Date' },
  })
  const text = `For example use ${toolCall}`
  assert.deepEqual(parseBrowserResponse(text, 'current', ['shell_command']), {
    schemaVersion: 1, type: 'assistant_text', requestId: 'current', content: text,
  })
})

test('rejects multiple valid current envelopes in adjacent browser DOM text', () => {
  const envelope = JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: 'current', content: 'OK' })
  assert.throws(() => parseBrowserEnvelope(`${envelope} ${envelope}`, 'current'), { code: 'invalid_browser_json' })
})

test('accepts only correlated offered tool calls with object arguments', () => {
  const envelope = parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'request-1',
    callId: 'call-1',
    name: 'shell_command',
    arguments: { command: 'Get-Date' },
  }), 'request-1', ['shell_command'])
  assert.equal(envelope.type, 'tool_call')
  assert.deepEqual(envelope.arguments, { command: 'Get-Date' })

  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, name: 'unoffered' }), 'request-1', ['shell_command']), { code: 'invalid_browser_tool_call' })
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, requestId: 'wrong' }), 'request-1', ['shell_command']), { code: 'invalid_browser_envelope' })
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, arguments: 'not-an-object' }), 'request-1', ['shell_command']), { code: 'invalid_browser_tool_call' })
})

test('infers a missing type only from a complete correlated tool-call shape', () => {
  const envelope = parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1, requestId: 'request-1', callId: 'call-1',
    name: 'shell_command', arguments: { command: 'Get-Date' },
  }), 'request-1', ['shell_command'])
  assert.equal(envelope.type, 'tool_call')
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1, requestId: 'request-1', name: 'shell_command', arguments: {},
  }), 'request-1', ['shell_command']), { code: 'invalid_browser_envelope' })
})

test('accepts a tool only inside its offered namespace', () => {
  const offered = [{ type: 'namespace', name: 'apps', tools: [{ type: 'function', name: 'search' }] }]
  const envelope = parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'request-1',
    callId: 'call-1',
    namespace: 'apps',
    name: 'search',
    arguments: { query: 'TETHER' },
  }), 'request-1', offered)
  assert.equal(envelope.namespace, 'apps')
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, namespace: 'other' }), 'request-1', offered), { code: 'invalid_browser_tool_call' })
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, name: 'missing' }), 'request-1', offered), { code: 'invalid_browser_tool_call' })
})

test('accepts one correlated deferred schema request for an offered tool', () => {
  const offered = [{ type: 'function', name: 'shell_command' }]
  const envelope = parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1, type: 'tool_schema_request', requestId: 'request-1',
    tools: [{ name: 'shell_command' }],
  }), 'request-1', offered)
  assert.deepEqual(envelope.tools, [{ name: 'shell_command' }])
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, tools: [{ name: 'missing' }] }), 'request-1', offered), (error) => {
    assert.equal(error.code, 'invalid_tool_schema_request')
    assert.deepEqual(error.details, { requestedTools: [{ name: 'missing' }], offeredTools: [{ name: 'shell_command' }] })
    return true
  })
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({ ...envelope, tools: [{ name: 'shell_command' }, { name: 'shell_command' }] }), 'request-1', offered), { code: 'invalid_tool_schema_request' })
})
