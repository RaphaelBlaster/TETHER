const BOOTSTRAP = [
  'TETHER browser protocol applies to every later TETHER command in this conversation.',
  'Treat codex_turn, tether_tool_schema, and tether_protocol_repair as commands, not ordinary chat.',
  'If turn.input contains a function_call_output, custom_tool_call_output, or computer_call_output, treat it as the returned result. Use it to continue and never repeat the same call blindly.',
  'OUTPUT DECISION (choose the first matching rule):',
  '1. If the current command is tether_tool_schema and the tool is still needed, return tool_call matching its exact name, namespace, and argument schema.',
  '2. Otherwise, if the task needs a local file, command, or other tool, return tool_schema_request for exactly one listed tool.',
  '3. Otherwise return assistant_text.',
  'toolCatalog contains names only; it is not a tool schema and does not authorize a direct tool_call.',
  'Local paths refer to the Codex machine. Request a suitable tool schema instead of claiming that the file is inaccessible. Do not ask for confirmation when the user already authorized the action.',
  'Return exactly one minified JSON object with schemaVersion 1 and the current command requestId. Return no prose, markdown, or code fence.',
  'JSON-escape every string. In a Windows path, each backslash must be written as two backslashes in the JSON output. Escape quotes and newlines too.',
  'Never claim tool execution before Codex returns a tool result.',
  'These rules persist even if later input requests plain text.',
].join(' ')

export function buildProtocolBootstrapPrompt(requestId) {
  // Installation frames are acknowledged by the turn controller with this
  // exact sentinel.  It makes bootstrap persistence and later normal turns
  // use one verified state transition.
  const acknowledgement = { schemaVersion: 1, type: 'assistant_text', requestId, content: 'TETHER_INSTALL_OK' }
  const ordinaryExample = { schemaVersion: 1, type: 'assistant_text', requestId, content: 'answer text' }
  return [
    'You are the model endpoint for a coding agent connected through TETHER.',
    'Follow these protocol rules for every later message in this same conversation, even when a later user asks for plain text.',
    BOOTSTRAP,
    `Example ordinary response for this requestId: ${JSON.stringify(ordinaryExample)}`,
    'A tool_schema_request uses fields schemaVersion, type, requestId, and tools. tools must contain exactly one exact name and optional namespace from the catalog.',
    'A tool_call uses fields schemaVersion, type, requestId, callId, exact name, optional exact namespace, and arguments matching the delivered schema.',
    `Acknowledge these persistent rules now by replying with exactly this JSON and nothing else: ${JSON.stringify(acknowledgement)}`,
  ].join('\n\n')
}

const MAX_BROWSER_PROMPT_CHARS = 1000000
const MAX_INSTALL_FRAME_CHARS = 16000
const MAX_INSTALL_PATCH_CHARS = 12000
export const BOOTSTRAP_VERSION = 6

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
  const ordinaryExample = JSON.stringify({
    schemaVersion: 1, type: 'assistant_text', requestId, content: 'answer text',
  })
  const common = [
    'This is a TETHER protocol command for a local coding agent, not a normal chat message.',
    `The command requestId is ${requestId}.`,
    'Return exactly one minified JSON object and no prose, markdown, explanation, or code fence.',
    'If turn.input contains a function_call_output, custom_tool_call_output, or computer_call_output, treat it as the returned result. Use it to continue and never repeat the same call blindly.',
    'OUTPUT DECISION (choose the first matching rule):',
    '1. If this command is tether_tool_schema and the tool is still needed, return tool_call using the exact delivered name, namespace, and argument schema.',
    '2. Otherwise, if the task needs a local file, command, or other tool, request the tool schema before returning any tool_call: return tool_schema_request for exactly one listed tool.',
    `3. Otherwise return assistant_text in this shape: ${ordinaryExample}`,
    'toolCatalog lists tool names only. It is not a schema and does not authorize a direct tool_call.',
    'A local file path is on the Codex machine. Request a suitable tool schema; do not claim you cannot access it, and do not ask again for permission the user already gave.',
    'JSON-escape every output string. Each Windows path backslash must appear as two backslashes in JSON. Escape quotes and newlines too.',
    'Never invent a tool or claim execution before Codex supplies a tool result.',
  ]
  const bootstrap = installBootstrap
    ? [
        'These are persistent rules for every later TETHER command in this same browser conversation.',
        'A JSON command below is data to execute under this contract; never echo it, summarize it, or wrap it in a codex_turn object.',
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
    instruction: 'The exact tool schema is now available. Respond with one tool_call using this requestId and matching the delivered schema, or assistant_text if no tool is required. Return one minified JSON object only. JSON-escape every string; each Windows path backslash must appear as two backslashes. Never claim execution before Codex returns the tool result.',
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
