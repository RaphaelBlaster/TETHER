import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildToolContract,
  finalizeWebToolTurn,
  parseWebToolResponse,
  prepareWebToolTurn,
} from '../src/web-tool-bridge.js'
import {
  parseDeepSeekToolCalls,
  serializeDeepSeekToolPrompt,
} from '../src/omniroute-deepseek-web-tools.js'

const TOOLS = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get weather.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' }, units: { enum: ['c', 'f'] } },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'run_command',
    description: 'Run a command.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
  },
]

test('tool contract keeps OmniRoute serialization and defines the local execution boundary', () => {
  const openAiTools = TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const contract = buildToolContract(TOOLS)
  assert.ok(contract.endsWith(serializeDeepSeekToolPrompt(openAiTools)))
  assert.equal(buildToolContract(TOOLS, 'gemini'), contract)
  assert.match(contract, /connected local client harness/)
  assert.match(contract, /Do NOT use this website's built-in tools/)
  assert.match(contract, /Every <tool> payload must be valid JSON/)
  assert.match(contract, /escape each backslash as \\\\/)
  assert.match(contract, /escape embedded double quotes as \\"/)
  assert.match(contract, /Never simulate a tool result/)
  assert.match(contract, /<tool>\{"name": "<tool_name>", "arguments": \{ \.\.\. \}\}<\/tool>/)
  assert.match(contract, /get_weather/)
  assert.match(contract, /additionalProperties/)
  assert.doesNotMatch(contract, /tool_schema_request|completion_check|requestId/)
})

test('parses canonical, fenced, loose, and multiple tool blocks', () => {
  const cases = [
    '<tool>{"name":"get_weather","arguments":{"city":"Paris"}}</tool>',
    '<tool>```json\n{"name":"get_weather","arguments":{"city":"Paris"}}\n```</tool>',
    "<tool>{name: 'get_weather', arguments: {city: 'Paris', units: 'c',}, enabled: True}</tool>",
  ]
  for (const value of cases) {
    const parsed = parseWebToolResponse(value, { tools: TOOLS })
    assert.equal(parsed.toolCalls.length, 1)
    assert.equal(parsed.toolCalls[0].name, 'get_weather')
    assert.equal(parsed.toolCalls[0].arguments.city, 'Paris')
  }
  const multiple = parseWebToolResponse([
    'Working.',
    '<tool>{"name":"get_weather","arguments":{"city":"Paris"}}</tool>',
    '<tool>{"name":"run_command","arguments":{"command":"pwd"}}</tool>',
  ].join('\n'), { tools: TOOLS })
  assert.equal(multiple.toolCalls.length, 2)
  assert.equal(multiple.content, 'Working.')
})

test('normalizes casing and one unambiguous slight misspelling', () => {
  const casing = parseWebToolResponse(
    '{"name":"GetWeather","arguments":{"city":"Paris"}}',
    { tools: TOOLS },
  )
  assert.equal(casing.toolCalls[0].name, 'get_weather')
  const typo = parseWebToolResponse(
    '<tool>{"name":"get_wether","arguments":{"city":"Paris"}}</tool>',
    { tools: TOOLS },
  )
  assert.equal(typo.toolCalls[0].name, 'get_weather')
})

test('recovers a bare offered-tool call missing only its outer closing brace', () => {
  const text = [
    '{"name":"run_command","arguments":',
    '{"command":"Remove-Item -LiteralPath \\"C:\\\\Users\\\\Megh Mayur\\\\file.txt\\" -Force"}',
  ].join('')
  const parsed = parseWebToolResponse(text, {
    tools: TOOLS,
    providerId: 'inkling',
  })
  assert.equal(parsed.content, '')
  assert.equal(parsed.toolCalls.length, 1)
  assert.equal(parsed.toolCalls[0].name, 'run_command')
  assert.equal(
    parsed.toolCalls[0].arguments.command,
    'Remove-Item -LiteralPath "C:\\Users\\Megh Mayur\\file.txt" -Force',
  )
})

test('parses a DeepSeek tool block containing raw Windows path separators', () => {
  const raw = String.raw`<tool>{"name":"read_file","arguments":{"filePath":"C:\Users\Megh Mayur\OneDrive\Desktop\test.txt"}}</tool>`
  const parsed = parseWebToolResponse(raw, {
    tools: [{
      type: 'function',
      name: 'read_file',
      description: 'Read a file.',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string' } },
        required: ['filePath'],
      },
    }],
    providerId: 'deepseek',
  })
  assert.equal(parsed.content, '')
  assert.equal(parsed.toolCalls.length, 1)
  assert.equal(parsed.toolCalls[0].name, 'read_file')
  assert.equal(
    parsed.toolCalls[0].arguments.filePath,
    String.raw`C:\Users\Megh Mayur\OneDrive\Desktop\test.txt`,
  )
})

test('parses a DeepSeek bash call with unescaped path quotes and backslashes', () => {
  const raw = String.raw`<tool>{"name":"bash","arguments":{"command":"Remove-Item -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\dump\temp\test_out.docx" -Force","timeout":30000}}</tool>`
  const parsed = parseWebToolResponse(raw, {
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Run PowerShell.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout: { type: 'integer' },
        },
        required: ['command'],
      },
    }],
    providerId: 'deepseek',
  })
  assert.equal(parsed.content, '')
  assert.equal(parsed.toolCalls.length, 1)
  assert.equal(parsed.toolCalls[0].name, 'bash')
  assert.equal(
    parsed.toolCalls[0].arguments.command,
    String.raw`Remove-Item -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\dump\temp\test_out.docx" -Force`,
  )
  assert.equal(parsed.toolCalls[0].arguments.timeout, 30000)
})

test('parses a final command argument with several unescaped PowerShell quotes', () => {
  const raw = String.raw`<tool>{"name":"bash","arguments":{"command":"if (Test-Path -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\boilerplate") { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("C:\Users\Megh Mayur\OneDrive\Desktop\boilerplate", "OnlyErrorDialogs", "SendToRecycleBin") } else { throw "Path not found." }"}}</tool>`
  const parsed = parseWebToolResponse(raw, {
    tools: [{
      type: 'function',
      name: 'bash',
      description: 'Run PowerShell.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    }],
    providerId: 'chatgpt',
  })
  assert.equal(parsed.content, '')
  assert.equal(parsed.toolCalls.length, 1)
  assert.equal(parsed.toolCalls[0].name, 'bash')
  assert.equal(
    parsed.toolCalls[0].arguments.command,
    String.raw`if (Test-Path -LiteralPath "C:\Users\Megh Mayur\OneDrive\Desktop\boilerplate") { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("C:\Users\Megh Mayur\OneDrive\Desktop\boilerplate", "OnlyErrorDialogs", "SendToRecycleBin") } else { throw "Path not found." }`,
  )
})

test('does not drop a malformed final bare call after parsing an earlier valid call', () => {
  const text = [
    '{"name":"get_weather","arguments":{"city":"Paris"}}',
    '{"name":"run_command","arguments":{"command":"Remove-Item -Force"}',
  ].join('\n')
  const parsed = parseWebToolResponse(text, {
    tools: TOOLS,
    providerId: 'inkling',
  })
  assert.equal(parsed.content, '')
  assert.deepEqual(
    parsed.toolCalls.map((call) => call.name),
    ['get_weather', 'run_command'],
  )
})

test('DeepSeek parsing and offered-tool filtering match OmniRoute exactly', () => {
  const text = [
    '<tool>{"name":"delete_everything","arguments":{}}</tool>',
    '<tool>{"name":"get_weather","arguments":{"city":4,"extra":true}}</tool>',
  ].join('\n')
  const openAiTools = TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const expected = parseDeepSeekToolCalls(text, 'parity', openAiTools)
  const actual = parseWebToolResponse(text, {
    tools: TOOLS,
    providerId: 'deepseek',
    idSeed: 'parity',
  })
  assert.deepEqual(actual.toolCalls, (expected.toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: JSON.parse(call.function.arguments),
  })))
})

test('DeepSeek provider normalization handles suffix, attributes, params, and XML children', () => {
  const cases = [
    '<tool:get_weather>{"city":"Paris"}</tool>',
    '<tool name="get_weather">{"city":"Paris"}</tool>',
    '<tool_call>{"type":"get_weather","params":{"city":"Paris"}}</tool_call>',
    '<tool id="1"><name>get_weather</name><arguments>{"city":"Paris"}</arguments></tool>',
  ]
  for (const value of cases) {
    const parsed = parseWebToolResponse(value, { tools: TOOLS, providerId: 'deepseek' })
    assert.equal(parsed.toolCalls.length, 1)
    assert.deepEqual(parsed.toolCalls[0].arguments, { city: 'Paris' })
  }
})

test('plain and malformed text handling matches OmniRoute behavior', () => {
  assert.deepEqual(
    parseWebToolResponse('The answer is 42.', { tools: TOOLS }),
    { content: 'The answer is 42.', toolCalls: [] },
  )
  const malformed = '<tool>{"name":"get_weather","arguments":'
  const expected = parseDeepSeekToolCalls(malformed, 'malformed', TOOLS.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  })))
  assert.deepEqual(
    parseWebToolResponse(malformed, {
      tools: TOOLS,
      providerId: 'deepseek',
      idSeed: 'malformed',
    }),
    { content: expected.content.trim(), toolCalls: [] },
  )
})

test('turn injects OmniRoute contract and OpenCode instructions without replaying browser history', () => {
  const prepared = prepareWebToolTurn({
    request: bridgeRequest({
      input: [
        userMessage('old browser-visible message'),
        userMessage('current request'),
      ],
    }),
    conversation: {
      providerConversationId: 'browser-conversation-1',
      webToolSession: {
        sessionId: 'session-1',
        availableTools: TOOLS,
        toolsHash: 'old-schema',
        pendingCalls: [],
        completedCalls: [],
        deliveredUserInputCounts: {
          [hashInput(userMessage('old browser-visible message'))]: 1,
        },
      },
    },
    providerId: 'deepseek',
  })
  assert.match(prepared.prompt, /You are the OpenCode starter prompt/)
  assert.match(prepared.prompt, /User: current request/)
  assert.doesNotMatch(prepared.prompt, /old browser-visible message/)
  assert.match(prepared.prompt, /Available tools/)
  assert.ok(
    prepared.prompt.indexOf('Execution environment:') <
      prepared.prompt.indexOf('You are the OpenCode starter prompt'),
  )
  assert.ok(
    prepared.prompt.indexOf('You are the OpenCode starter prompt') <
      prepared.prompt.indexOf('Available tools:'),
  )

  const followUp = prepareWebToolTurn({
    request: bridgeRequest({
      input: [
        userMessage('old browser-visible message'),
        userMessage('current request'),
        userMessage('follow-up'),
      ],
    }),
    conversation: {
      providerConversationId: 'browser-conversation-1',
      webToolSession: prepared.sessionState,
    },
    providerId: 'deepseek',
  })
  assert.equal(followUp.prompt, 'User: follow-up')
})

test('OpenCode instructions are injected even when that request contains no tools', () => {
  const prepared = prepareWebToolTurn({
    request: {
      ...bridgeRequest({ input: [userMessage('hi')] }),
      tools: [],
      instructions: 'OPEN-CODE-STARTER-PROMPT',
    },
    conversation: null,
    providerId: 'deepseek',
  })
  assert.equal(prepared.prompt, 'OPEN-CODE-STARTER-PROMPT\n\nUser: hi')
})

test('a changed tool catalog is reinstalled without repeating OpenCode instructions', () => {
  const first = prepareWebToolTurn({
    request: bridgeRequest({ input: [userMessage('first')] }),
    conversation: null,
    providerId: 'deepseek',
  })
  const changed = prepareWebToolTurn({
    request: {
      ...bridgeRequest({
        input: [userMessage('first'), userMessage('use changed catalog')],
      }),
      tools: [
        ...TOOLS,
        {
          type: 'function',
          name: 'read_file',
          description: 'Read one file.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
    },
    conversation: { webToolSession: first.sessionState },
    providerId: 'deepseek',
  })
  assert.match(changed.prompt, /Available tools:/)
  assert.match(changed.prompt, /read_file/)
  assert.doesNotMatch(changed.prompt, /OpenCode starter prompt/)
  assert.match(changed.prompt, /User: use changed catalog/)
})

test('an upgraded tool contract is installed once without replaying OpenCode instructions', () => {
  const previous = prepareWebToolTurn({
    request: bridgeRequest({ input: [userMessage('first')] }),
    conversation: null,
    providerId: 'inkling',
  }).sessionState
  const upgraded = prepareWebToolTurn({
    request: bridgeRequest({
      input: [userMessage('first'), userMessage('second')],
    }),
    conversation: {
      webToolSession: {
        ...previous,
        toolContractVersion: 1,
      },
    },
    providerId: 'inkling',
  })
  assert.doesNotMatch(upgraded.prompt, /OpenCode starter prompt/)
  assert.match(upgraded.prompt, /Execution environment:/)
  assert.match(upgraded.prompt, /User: second/)
  assert.equal(upgraded.sessionState.toolContractVersion, 4)
})

test('tool result resolves a pending id and sends only the new result plus continuation', () => {
  const pending = {
    id: 'call_123',
    name: 'get_weather',
    arguments: { city: 'Paris' },
    signature: 'sig-1',
  }
  const prepared = prepareWebToolTurn({
    request: bridgeRequest({
      input: [
        userMessage('original task that must not be replayed'),
        { type: 'function_call_output', call_id: 'call_123', output: '{"temp":22}' },
      ],
    }),
    conversation: {
      providerConversationId: 'browser-conversation-1',
      webToolSession: {
        sessionId: 'session-1',
        instructions: 'You are the OpenCode starter prompt.',
        instructionsInstalled: true,
        availableTools: TOOLS,
        toolsHash: hashTools(TOOLS),
        toolContractVersion: 4,
        pendingCalls: [pending],
        completedCalls: [],
        deliveredUserInputCounts: {},
      },
    },
    providerId: 'deepseek',
  })
  assert.doesNotMatch(prepared.prompt, /OpenCode starter prompt/)
  assert.doesNotMatch(prepared.prompt, /Available tools/)
  assert.match(prepared.prompt, /Tool result \(get_weather\)/)
  assert.match(prepared.prompt, /temp/)
  assert.match(prepared.prompt, /22/)
  assert.match(prepared.prompt, /Continue the task/)
  assert.doesNotMatch(prepared.prompt, /original task that must not be replayed/)
})

test('unknown tool result ids are rejected before browser injection', () => {
  assert.throws(
    () => prepareWebToolTurn({
      request: bridgeRequest({
        input: [{ type: 'function_call_output', call_id: 'unknown', output: 'x' }],
      }),
      conversation: null,
      providerId: 'deepseek',
    }),
    { code: 'unknown_tool_call_id' },
  )
})

test('OmniRoute call ids and tool calls are returned without an internal repair loop', () => {
  const prepared = prepareWebToolTurn({
    request: bridgeRequest({ input: [userMessage('weather?')] }),
    conversation: null,
    providerId: 'deepseek',
  })
  const text = '<tool>{"name":"get_weather","arguments":{"city":"Paris"}}</tool>'
  const first = finalizeWebToolTurn({
    text,
    providerId: 'deepseek',
    requestId: 'request-1',
    prepared,
  })
  assert.match(first.envelope.calls[0].callId, /^call-\d+_0$/)

  const call = first.sessionState.pendingCalls[0]
  const afterResult = {
    ...prepared,
    deliveredToolResults: [{ call, output: '22C', status: 'success' }],
    sessionState: first.sessionState,
  }
  const duplicate = finalizeWebToolTurn({
    text,
    providerId: 'deepseek',
    requestId: 'request-2',
    prepared: afterResult,
  })
  assert.equal(duplicate.retryPrompt, undefined)
  assert.equal(duplicate.envelope.type, 'tool_calls')
  assert.equal(duplicate.sessionState.completedCalls[0].id, call.id)
})

test('browser conversation remains authoritative when a client session hint changes', () => {
  const prepared = prepareWebToolTurn({
    request: {
      ...bridgeRequest({ input: [userMessage('new')] }),
      client_metadata: { tool_session_id: 'session-2' },
    },
    conversation: {
      webToolSession: {
        sessionId: 'session-1',
        availableTools: TOOLS,
        pendingCalls: [],
        completedCalls: [],
      },
    },
    providerId: 'deepseek',
  })
  assert.equal(prepared.sessionState.sessionId, 'session-1')
  assert.match(prepared.prompt, /User: new/)
})

test('large tool results remain a single delta and a long sequential loop retains protocol state', async () => {
  let state = null
  let prepared = prepareWebToolTurn({
    request: bridgeRequest({ input: [userMessage('run six steps')] }),
    conversation: null,
    providerId: 'gemini',
  })

  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
    const called = finalizeWebToolTurn({
      text: `<tool>{"name":"run_command","arguments":{"command":"step-${index}"}}</tool>`,
      providerId: 'gemini',
      requestId: `request-call-${index}`,
      prepared,
    })
    const call = called.sessionState.pendingCalls.find((candidate) =>
      candidate.arguments.command === `step-${index}`)
    assert.ok(call)
    state = called.sessionState
    const output = index === 0 ? 'x'.repeat(100_000) : `completed-${index}`
    prepared = prepareWebToolTurn({
      request: bridgeRequest({
        input: [{ type: 'function_call_output', call_id: call.id, output }],
      }),
      conversation: { providerConversationId: 'browser-conversation-1', webToolSession: state },
      providerId: 'gemini',
    })
    assert.match(prepared.prompt, /Tool result \(run_command\)/)
    if (index === 0) assert.ok(prepared.prompt.length > 100_000)
    if (index < 5) continue
    const finished = finalizeWebToolTurn({
      text: 'All six steps completed.',
      providerId: 'gemini',
      requestId: 'request-final',
      prepared,
    })
    assert.equal(finished.envelope.type, 'assistant_text')
    assert.equal(finished.sessionState.pendingCalls.length, 0)
    assert.equal(finished.sessionState.completedCalls.length, 6)
  }
})

function bridgeRequest({ input }) {
  return {
    type: 'response.create',
    model: 'tether-tool-bridge',
    instructions: 'You are the OpenCode starter prompt.',
    input,
    tools: TOOLS,
    tool_choice: 'auto',
    client_metadata: { tool_session_id: 'session-1' },
  }
}

function userMessage(text) {
  return {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text }],
  }
}

function hashInput(value) {
  return hash(value)
}

function hashTools(value) {
  return hash(value)
}

function hash(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 32)
}
