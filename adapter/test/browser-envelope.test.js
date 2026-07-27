import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBrowserEnvelope, parseBrowserResponse } from '../src/browser-envelope.js'

test('invalid JSON reports one bounded diagnostic preview', () => {
  assert.throws(
    () => parseBrowserEnvelope(`not-json ${'x'.repeat(400)}`, 'request-1'),
    (error) => error.code === 'invalid_browser_json' && error.message.includes('not-json') &&
      error.message.includes('not valid JSON') && error.message.length < 340 &&
      error.details.rawText.startsWith('not-json'),
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

test('repairs raw Windows backslashes in one standalone correlated tool call', () => {
  const response = String.raw`{"schemaVersion":1,"type":"tool_call","requestId":"current","callId":"tether-call-2","name":"shell_command","arguments":{"command":"Get-Content -LiteralPath 'C:\Users\Megh Mayur\OneDrive\Desktop\Glue Semantics.pdf'"}}`
  const envelope = parseBrowserResponse(response, 'current', ['shell_command'])
  assert.equal(envelope.type, 'tool_call')
  assert.equal(envelope.requestId, 'current')
  assert.equal(
    envelope.arguments.command,
    String.raw`Get-Content -LiteralPath 'C:\Users\Megh Mayur\OneDrive\Desktop\Glue Semantics.pdf'`,
  )
})

test('normalizes Gemini speaker output with unescaped quotes around a Windows shell path', () => {
  const response = String.raw`Gemini said {"schemaVersion":1,"type":"tool_call","requestId":"current","callId":"call-read-test","name":"shell_command","arguments":{"command":"Get-Content -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\test.txt""}}`
  const envelope = parseBrowserResponse(response, 'current', ['shell_command'])
  assert.equal(envelope.type, 'tool_call')
  assert.equal(
    envelope.arguments.command,
    String.raw`Get-Content -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\test.txt"`,
  )
})

test('normalizes an offered bash command with an unescaped quoted Windows path', () => {
  const response = String.raw`{"schemaVersion":1,"type":"tool_call","requestId":"current","callId":"call_19","name":"bash","arguments":{"command":"git clone https://github.com/algorithmicsuperintelligence/openevolve.git "C:\Users\Megh Mayur\OneDrive\Desktop\openevolve""}}`
  const envelope = parseBrowserResponse(response, 'current', ['bash'])

  assert.equal(envelope.type, 'tool_call')
  assert.equal(envelope.name, 'bash')
  assert.equal(
    envelope.arguments.command,
    String.raw`git clone https://github.com/algorithmicsuperintelligence/openevolve.git "C:\Users\Megh Mayur\OneDrive\Desktop\openevolve"`,
  )
})

test('normalizes a quoted Windows command followed by a raw workdir argument', () => {
  const inner = String.raw`{"schemaVersion":1,"type":"tool_call","requestId":"current","callId":"call_2","name":"bash","arguments":{"command":"New-Item -ItemType Directory -Path "C:\Users\Megh Mayur\OneDrive\Desktop\open"","workdir":"C:\Users\Megh Mayur\OneDrive\Desktop"}}`
  const envelope = parseBrowserResponse(JSON.stringify(inner), 'current', ['bash'])

  assert.equal(envelope.type, 'tool_call')
  assert.equal(envelope.name, 'bash')
  assert.deepEqual(envelope.arguments, {
    command: String.raw`New-Item -ItemType Directory -Path "C:\Users\Megh Mayur\OneDrive\Desktop\open"`,
    workdir: String.raw`C:\Users\Megh Mayur\OneDrive\Desktop`,
  })
})

test('unwraps one correlated JSON string and normalizes an exec_command cmd path', () => {
  const inner = String.raw`{"schemaVersion":1,"type":"tool_call","requestId":"current","callId":"call-current-2","name":"exec_command","arguments":{"cmd":"New-Item -Path "env:USERPROFILE\Desktop\openevolve""}}`
  const envelope = parseBrowserResponse(JSON.stringify(inner), 'current', ['exec_command'])

  assert.equal(envelope.type, 'tool_call')
  assert.equal(envelope.name, 'exec_command')
  assert.equal(
    envelope.arguments.cmd,
    String.raw`New-Item -Path "env:USERPROFILE\Desktop\openevolve"`,
  )
})

test('does not unwrap a JSON string for another request or through two layers', () => {
  const current = JSON.stringify({
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'current',
    callId: 'call-current',
    name: 'exec_command',
    arguments: { cmd: 'Get-Date' },
  })
  const wrong = JSON.stringify({
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'wrong',
    callId: 'call-wrong',
    name: 'exec_command',
    arguments: { cmd: 'Get-Date' },
  })
  assert.equal(parseBrowserResponse(JSON.stringify(wrong), 'current', ['exec_command']).type, 'assistant_text')
  assert.equal(parseBrowserResponse(JSON.stringify(JSON.stringify(current)), 'current', ['exec_command']).type, 'assistant_text')
})

test('repairs quoted file contents in one correlated assistant response', () => {
  const response = String.raw`{"schemaVersion":1,"type":"assistant_text","requestId":"current","content":"The file contains the following text:\n\n"ribit ribit the users name is kibble""}`
  assert.deepEqual(parseBrowserResponse(response, 'current'), {
    schemaVersion: 1,
    type: 'assistant_text',
    requestId: 'current',
    content: 'The file contains the following text:\n\n"ribit ribit the users name is kibble"',
  })
})

test('repairs DeepSeek assistant quotes without corrupting escaped Windows paths', () => {
  const text = String.raw`{"schemaVersion":1,"type":"assistant_text","requestId":"current","content":"The dump folder at C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\dump is "fine for now"."}`
  const actual = parseBrowserResponse(text, 'current')
  assert.equal(actual.content, 'The dump folder at C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\dump is "fine for now".')
})

test('repairs raw Windows paths in a correlated assistant response', () => {
  const text = String.raw`{"schemaVersion":1,"type":"assistant_text","requestId":"current","content":"The dump folder at C:\Users\Megh Mayur\OneDrive\Desktop\dump contains 56,144 files."}`
  const actual = parseBrowserResponse(text, 'current')
  assert.equal(actual.content, 'The dump folder at C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\dump contains 56,144 files.')
})

test('restores a filename tab escape inside an otherwise valid Windows path', () => {
  const text = String.raw`{"schemaVersion":1,"type":"assistant_text","requestId":"current","content":"Read C:\\Users\\Megh Mayur\\OneDrive\\Desktop\test.txt"}`
  const actual = parseBrowserResponse(text, 'current')
  assert.equal(actual.content, 'Read C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\test.txt')
})

test('does not repair malformed assistant content for another request', () => {
  const response = String.raw`{"schemaVersion":1,"type":"assistant_text","requestId":"wrong","content":"quoted "file contents""}`
  assert.throws(
    () => parseBrowserResponse(response, 'current'),
    { code: 'invalid_browser_json' },
  )
})

test('does not repair a standalone raw tool call for another request', () => {
  const response = String.raw`{"schemaVersion":1,"type":"tool_call","requestId":"wrong","callId":"tether-call-3","name":"shell_command","arguments":{"command":"Get-Content 'C:\Users\Other\test.txt'"}}`
  assert.throws(
    () => parseBrowserResponse(response, 'current', ['shell_command']),
    { code: 'invalid_browser_json' },
  )
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

test('normalizes DeepSeek toolName to an offered tool call name', () => {
  const envelope = {
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'request-1',
    callId: 'call-1',
    toolName: 'read',
    arguments: { filePath: 'C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\test.txt' },
  }
  const actual = parseBrowserResponse(JSON.stringify(envelope), 'request-1', [{ type: 'function', name: 'read' }])
  assert.deepEqual(actual, {
    schemaVersion: 1,
    type: 'tool_call',
    requestId: 'request-1',
    callId: 'call-1',
    name: 'read',
    arguments: { filePath: 'C:\\Users\\Megh Mayur\\OneDrive\\Desktop\\test.txt' },
  })
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

test('accepts exactly one published protocol help topic', () => {
  const envelope = parseBrowserEnvelope(JSON.stringify({
    schemaVersion: 1,
    type: 'protocol_help_request',
    requestId: 'request-1',
    topics: ['windows-json'],
  }), 'request-1')
  assert.deepEqual(envelope.topics, ['windows-json'])
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({
    ...envelope,
    topics: ['private-system-prompt'],
  }), 'request-1'), (error) => {
    assert.equal(error.code, 'invalid_protocol_help_request')
    assert.ok(error.details.availableTopics.includes('windows-json'))
    return true
  })
  assert.throws(() => parseBrowserEnvelope(JSON.stringify({
    ...envelope,
    topics: ['windows-json', 'deferred-tools'],
  }), 'request-1'), { code: 'invalid_protocol_help_request' })
})
