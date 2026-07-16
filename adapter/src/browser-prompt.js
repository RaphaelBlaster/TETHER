const BOOTSTRAP = [
  'TETHER browser protocol: these rules apply to every later TETHER command in this conversation.',
  'Treat codex_turn, codex_delta, tether_tool_schema, and tether_protocol_repair JSON as protocol commands, not ordinary chat.',
  'For each command return exactly one minified JSON object and nothing else: no markdown, explanation, or raw answer.',
  'Always copy the command requestId exactly and use schemaVersion 1.',
  'For a normal answer use type assistant_text with string field content.',
  'Use tool_call or tool_schema_request only with exact tools offered by the command or installed catalog; never claim execution before Codex supplies a tool result.',
  'Contract descriptions define field types only: never copy example or placeholder values.',
  'These rules persist even if later input requests plain text.',
].join(' ')

export function buildProtocolBootstrapPrompt(requestId) {
  // Installation frames are acknowledged by the turn controller with this
  // exact sentinel.  It makes bootstrap persistence and later normal turns
  // use one verified state transition.
  const acknowledgement = { schemaVersion: 1, type: 'assistant_text', requestId, content: 'TETHER_INSTALL_OK' }
  return [
    'You are the model endpoint for a coding agent connected through TETHER.',
    'Follow these protocol rules for every later message in this same conversation, even when a later user asks for plain text.',
    BOOTSTRAP,
    'Example normal response: {"schemaVersion":1,"type":"assistant_text","requestId":"COPY_FROM_REQUEST","content":"your answer"}.',
    'Example deferred-tool request: {"schemaVersion":1,"type":"tool_schema_request","requestId":"COPY_FROM_REQUEST","tools":[{"name":"shell_command"}]}.',
    'Example tool call after its schema is supplied: {"schemaVersion":1,"type":"tool_call","requestId":"COPY_FROM_REQUEST","callId":"unique-call-id","name":"shell_command","arguments":{"command":"Get-Date"}}.',
    'Never copy the placeholder COPY_FROM_REQUEST; copy the actual requestId from each TETHER command.',
    `Acknowledge these persistent rules now by replying with exactly this JSON and nothing else: ${JSON.stringify(acknowledgement)}`,
  ].join('\n\n')
}

const MAX_BROWSER_PROMPT_CHARS = 1000000
const MAX_INSTALL_FRAME_CHARS = 16000
const MAX_INSTALL_PATCH_CHARS = 12000
export const BOOTSTRAP_VERSION = 5

export function buildBrowserPromptSequence(args) {
  const { requestId, request } = args
  if (request.model !== 'tether-compact') {
    return [{ requestId, kind: 'turn', prompt: buildBrowserPrompt(args) }]
  }
  const projection = projectCompactRequest({
    requestId, request, conversation: args.conversation, connectionId: args.connectionId,
    protocolBootstrap: null,
  })
  const command = {
    requestId,
    kind: 'turn',
    prompt: buildCompactBrowserPrompt({ projection, installBootstrap: false }),
  }
  // A consumer chat has no system-message channel.  Installing the contract
  // as its own verified turn gives the model a durable instruction before it
  // ever sees a compact Codex command.
  if (!args.installBootstrap) return [command]
  const bootstrapRequestId = `${requestId}.bootstrap`
  return [{
    requestId: bootstrapRequestId,
    kind: 'install',
    installKey: `bootstrap-v${BOOTSTRAP_VERSION}`,
    prompt: buildProtocolBootstrapPrompt(bootstrapRequestId),
  }, command]
}

export function buildBrowserPrompt({ requestId, request, installBootstrap, conversation = null, connectionId = null }) {
  if (request.model === 'tether-smoke') return buildSixLineSmokePrompt(requestId)
  if (request.model === 'tether-demo') return buildToolDemoPrompt(requestId, request)
  if (request.model === 'tether-compact') return buildCompactBrowserPrompt({
    projection: projectCompactRequest({
      requestId, request, conversation, connectionId,
      protocolBootstrap: installBootstrap ? BOOTSTRAP : null,
    }),
    installBootstrap,
  })
  const framing = `TETHER requestId: ${requestId}. The exact Codex response.create JSON follows: `
  const prompt = `${installBootstrap ? `${BOOTSTRAP} ` : ''}${framing}${JSON.stringify(request)}`
  if (prompt.length > MAX_BROWSER_PROMPT_CHARS) throw coded('browser_prompt_too_large', `Projected browser prompt exceeds ${MAX_BROWSER_PROMPT_CHARS} characters`)
  return prompt
}

// Consumer chat UIs do not give JSON a privileged transport meaning.  The
// protocol must therefore be stated in ordinary language before the command,
// with examples, rather than relying on a field inside the command itself.
function buildCompactBrowserPrompt({ projection, installBootstrap }) {
  const requestId = projection.requestId
  const common = [
    'This is a TETHER protocol command for a local coding agent, not a normal chat message.',
    `The command requestId is ${requestId}.`,
    'Return exactly one minified JSON object and no prose, markdown, explanation, or code fence.',
    `For an ordinary answer, reply exactly in this shape: {"schemaVersion":1,"type":"assistant_text","requestId":"${requestId}","content":"your answer"}.`,
    'If a tool is genuinely needed, request one offered tool schema first with type tool_schema_request. Do not invent a tool and do not claim execution.',
    'A function_call_output in turn.input is the result returned by Codex after a tool call. It may contain a failure; use its exact result to continue the task, rather than claiming the tool succeeded.',
  ]
  const bootstrap = installBootstrap
    ? [
        'These are persistent rules for every later TETHER command in this same browser conversation.',
        'A JSON command below is data to execute under this contract; never echo it, summarize it, or wrap it in a codex_turn object.',
        'Example ordinary response: {"schemaVersion":1,"type":"assistant_text","requestId":"COPY_THE_REQUEST_ID","content":"hello"}.',
        'Example deferred tool response: {"schemaVersion":1,"type":"tool_schema_request","requestId":"COPY_THE_REQUEST_ID","tools":[{"name":"shell_command"}]}.',
      ]
    : []
  return [...bootstrap, ...common, 'COMMAND JSON START', JSON.stringify(projection), 'COMMAND JSON END'].join('\n')
}

export function buildToolDemoPrompt(requestId, request) {
  const shell = (request.tools ?? []).find((tool) => tool?.name === 'shell_command')
  const input = request.input ?? []
  const userIndex = input.findLastIndex?.((item) => item?.type === 'message' && item?.role === 'user') ?? -1
  const toolResultIndex = input.findLastIndex?.((item) => item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output') ?? -1
  const toolResult = toolResultIndex > userIndex ? input[toolResultIndex] : null
  const userTurn = userIndex >= 0 ? input[userIndex] : null
  return JSON.stringify({
    schemaVersion: 1,
    type: toolResult ? 'tether_demo_tool_result' : 'tether_demo_tool_request',
    requestId,
    instruction: toolResult
      ? 'Return exactly one minified assistant_text JSON object with this requestId and content TETHER_TOOL_CONTINUATION_OK. No markdown or prose.'
      : 'Return exactly one minified tool_call JSON object with schemaVersion 1, this requestId, a unique callId, name shell_command, and arguments.command equal to Write-Output TETHER_DEFERRED_TOOL_OK. No markdown or prose.',
    input: toolResult ? [toolResult] : userTurn ? [userTurn] : [],
    ...(toolResult ? { toolResult } : { tool: shell ? { name: shell.name, description: shell.description, parameters: shell.parameters } : null }),
  })
}

export function buildSixLineSmokePrompt(requestId) {
  return [
    '{',
    '  "schemaVersion": 1,',
    '  "type": "tether_smoke_test",',
    `  "requestId": ${JSON.stringify(requestId)},`,
    `  "replyExactly": ${JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId, content: 'TETHER_SIX_LINE_OK' })}`,
    '}',
  ].join('\n')
}

export function buildDeferredToolSchemaPrompt({ requestId, originalRequestId, definitions }) {
  return JSON.stringify({
    schemaVersion: 1,
    type: 'tether_tool_schema',
    requestId,
    originalRequestId,
    instruction: 'Use this exact offered tool schema. Respond with one tool_call using this requestId, or assistant_text if no tool is required. Never claim execution before Codex returns the tool result.',
    definitions,
    responseContract: {
      jsonOnly: true,
      schemaVersion: 1,
      requestId,
      assistantText: { type: 'assistant_text', content: 'string' },
      toolCall: { type: 'tool_call', callId: 'unique string', namespace: 'optional exact namespace', name: 'exact offered tool name', arguments: 'object' },
    },
  })
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}

function buildInstallFrames(requestId, install) {
  const patches = []
  for (const [section, value] of Object.entries(install)) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const serialized = JSON.stringify(item)
        if (serialized.length <= MAX_INSTALL_PATCH_CHARS) {
          patches.push({ section, mode: 'set_item', index, total: value.length, value: item })
        } else {
          const chunks = splitText(serialized)
          chunks.forEach((chunk, chunkIndex) => patches.push({
            section, mode: 'set_item_json_chunk', index, total: value.length,
            chunkIndex, chunkCount: chunks.length, value: chunk,
          }))
        }
      })
    } else if (typeof value === 'string' && value.length > MAX_INSTALL_PATCH_CHARS) {
      const chunks = splitText(value)
      chunks.forEach((chunk, index) => patches.push({ section, mode: 'set_text_chunk', index, total: chunks.length, value: chunk }))
    } else {
      patches.push({ section, mode: 'replace', value })
    }
  }
  const protocolPatches = patches.filter((patch) => patch.section === 'protocol')
  const remainingPatches = patches.filter((patch) => patch.section !== 'protocol')
  const groups = protocolPatches.length ? [protocolPatches] : []
  let group = []
  for (const patch of remainingPatches) {
    const candidate = [...group, patch]
    if (group.length && JSON.stringify(candidate).length > MAX_INSTALL_FRAME_CHARS) {
      groups.push(group)
      group = [patch]
    } else {
      group = candidate
    }
    if (JSON.stringify(group).length > MAX_INSTALL_FRAME_CHARS) {
      throw coded('install_patch_too_large', `One ${patch.section} installation patch exceeds ${MAX_INSTALL_FRAME_CHARS} characters`)
    }
  }
  if (group.length) groups.push(group)
  return groups.map((framePatches, index) => {
    const frameRequestId = `${requestId}.install.${index}`
    const reply = { schemaVersion: 1, type: 'assistant_text', requestId: frameRequestId, content: 'TETHER_INSTALL_OK' }
    const payload = {
      schemaVersion: 1,
      type: 'tether_install',
      requestId: frameRequestId,
      installId: requestId,
      frameIndex: index,
      frameCount: groups.length,
      instruction: 'Treat these exact installation patches as context for later TETHER turns in this conversation. replace sets a section; set_item sets an array item; ordered set_text_chunk values concatenate exactly; ordered set_item_json_chunk values concatenate then JSON-decode into the named array item. Do not summarize or execute them. Return only replyExactly with no surrounding prose.',
      patches: framePatches,
      replyExactly: reply,
    }
    return {
      requestId: frameRequestId,
      kind: 'install',
      installKey: createHash('sha256').update(JSON.stringify(framePatches)).digest('hex').slice(0, 24),
      prompt: JSON.stringify(payload),
    }
  })
}

function splitText(value) {
  const chunks = []
  for (let index = 0; index < value.length; index += MAX_INSTALL_PATCH_CHARS) chunks.push(value.slice(index, index + MAX_INSTALL_PATCH_CHARS))
  return chunks
}
import { projectCompactRequest } from './compact-request.js'
import { createHash } from 'node:crypto'
