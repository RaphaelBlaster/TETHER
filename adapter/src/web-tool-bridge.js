import { createHash } from 'node:crypto'
import {
  parseDeepSeekToolCalls,
  serializeDeepSeekToolPrompt,
} from './omniroute-deepseek-web-tools.js'
import {
  parseToolCallsFromText,
} from './omniroute-web-tools.js'
import {
  escapeRawBackslashesInJsonStrings,
  repairQuotedCommandArgument,
} from './browser-envelope.js'

// OmniRoute's translators own tool serialization and response parsing. TETHER's
// only intentional difference is transport state: the browser conversation keeps
// prior turns, so this bridge injects only the newest user/tool-result delta.

const LOCAL_TOOL_EXECUTION_BOUNDARY = [
  'Execution environment:',
  'You are the reasoning model for TETHER. The tools below are executed by the connected local client harness on the user\'s machine.',
  'Do NOT use this website\'s built-in tools, shell, code runner, sandbox, VM, or search for tasks that require the listed tools. Those environments are separate from the user\'s machine and their results do not complete the local task.',
  'When an external action is required, output only the exact <tool>...</tool> block for the local harness and stop. Wait for the returned Tool result before continuing.',
  'Every <tool> payload must be valid JSON. In Windows paths, escape each backslash as \\\\ (for example, C:\\\\Users\\\\Name\\\\file.txt).',
  String.raw`Inside JSON strings, escape embedded double quotes as \". Example: {"command":"Remove-Item -LiteralPath \"C:\\Users\\Name\\file.txt\" -Force"}.`,
  'Never simulate a tool result or claim an action succeeded unless the local tool result confirms it.',
].join('\n')
const WEB_TOOL_CONTRACT_VERSION = 4

export function prepareWebToolTurn({ request, conversation, providerId }) {
  const requestedSessionId = request.client_metadata?.tool_session_id
  if (!validIdentifier(requestedSessionId)) {
    throw coded('invalid_tool_session', 'A stable tool session id is required')
  }

  const previous = conversation?.webToolSession ?? null
  const sessionId = previous?.sessionId ?? requestedSessionId
  const suppliedTools = normalizeToolDefinitions(request.tools ?? [])
  const availableTools = suppliedTools.length > 0
    ? suppliedTools
    : normalizeToolDefinitions(previous?.availableTools ?? [])
  const toolsHash = digest(availableTools)
  const instructions = typeof request.instructions === 'string' && request.instructions.trim()
    ? request.instructions.trim()
    : previous?.instructions ?? ''
  const includeInstructions = Boolean(instructions) && previous?.instructionsInstalled !== true
  const includeToolContract = availableTools.length > 0 &&
    (previous?.toolsHash !== toolsHash ||
      previous?.toolContractVersion !== WEB_TOOL_CONTRACT_VERSION)
  const pendingCalls = Array.isArray(previous?.pendingCalls) ? previous.pendingCalls : []
  const completedCalls = Array.isArray(previous?.completedCalls) ? previous.completedCalls : []
  const completedIds = new Set(completedCalls.map((call) => call.id))
  const pendingById = new Map(pendingCalls.map((call) => [call.id, call]))
  const toolResults = (request.input ?? []).filter(isToolResult)
    .filter((item) => !completedIds.has(item.call_id))

  let prompt
  let deliveredToolResults = []
  const nextUserInputCounts = { ...(previous?.deliveredUserInputCounts ?? {}) }

  if (toolResults.length > 0) {
    deliveredToolResults = toolResults.map((item) => {
      const call = pendingById.get(item.call_id)
      if (!call) {
        throw coded(
          'unknown_tool_call_id',
          `Tool result references unknown or non-pending call id ${String(item.call_id)}`,
        )
      }
      return {
        call,
        output: toolResultText(item),
        status: item.status === 'failed' ? 'error' : 'success',
      }
    })
    prompt = buildToolResultPrompt({
      results: deliveredToolResults,
      instructions,
      tools: availableTools,
      providerId,
      includeInstructions,
      includeToolContract,
    })
  } else {
    const unseen = unseenUserMessages(request.input ?? [], nextUserInputCounts)
    const latest = unseen.at(-1)
    if (!latest) {
      if (previous?.lastEnvelope) {
        return {
          cachedEnvelope: previous.lastEnvelope,
          sessionState: previous,
          availableTools,
          turnType: 'cached',
        }
      }
      throw coded('missing_browser_delta', 'Request contains no new user message or tool result')
    }
    nextUserInputCounts[latest.hash] = latest.index
    prompt = buildUserTurnPrompt({
      text: messageText(latest.item),
      instructions,
      tools: availableTools,
      providerId,
      includeInstructions,
      includeToolContract,
    })
  }

  return {
    prompt,
    turnType: deliveredToolResults.length > 0 ? 'tool_results' : 'user',
    availableTools,
    deliveredToolResults,
    sessionState: {
      sessionId,
      provider: providerId,
      browserConversationId: conversation?.providerConversationId ?? null,
      instructions,
      instructionsInstalled: previous?.instructionsInstalled === true || includeInstructions,
      availableTools,
      toolsHash,
      toolContractVersion: WEB_TOOL_CONTRACT_VERSION,
      toolChoice: request.tool_choice ?? 'auto',
      pendingCalls,
      completedCalls,
      deliveredUserInputCounts: nextUserInputCounts,
      lastProviderMessageId: previous?.lastProviderMessageId ?? null,
      lastProcessedResponse: previous?.lastProcessedResponse ?? null,
      lastEnvelope: previous?.lastEnvelope ?? null,
      retryCount: 0,
    },
  }
}

export function finalizeWebToolTurn({
  text,
  providerId,
  requestId,
  prepared,
  providerMessageId = null,
}) {
  const parsed = parseWebToolResponse(text, {
    tools: prepared.availableTools,
    providerId,
    idSeed: `call-${Date.now()}`,
  })
  const completedResultIds = new Set(prepared.deliveredToolResults.map(({ call }) => call.id))
  const pendingCalls = prepared.sessionState.pendingCalls
    .filter((call) => !completedResultIds.has(call.id))
  const completedCalls = [
    ...prepared.sessionState.completedCalls,
    ...prepared.deliveredToolResults
      .map(({ call }) => ({ ...call, completedAt: Date.now() }))
      .filter((call) => !prepared.sessionState.completedCalls.some((known) => known.id === call.id)),
  ]

  const calls = parsed.toolCalls.map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
    createdAt: Date.now(),
  }))
  for (const call of calls) {
    if (!pendingCalls.some((known) => known.id === call.id)) pendingCalls.push(call)
  }

  const envelope = calls.length > 0
    ? {
        schemaVersion: 1,
        type: 'tool_calls',
        requestId,
        content: parsed.content || null,
        calls: calls.map((call) => ({
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      }
    : {
        schemaVersion: 1,
        type: 'assistant_text',
        requestId,
        content: parsed.content,
      }

  return {
    envelope,
    sessionState: {
      ...prepared.sessionState,
      pendingCalls,
      completedCalls,
      lastProviderMessageId: providerMessageId,
      lastProcessedResponse: digest(String(text ?? '')),
      lastEnvelope: envelope,
      retryCount: 0,
    },
  }
}

export function parseWebToolResponse(text, {
  tools = [],
  providerId = '',
  idSeed = 'call',
} = {}) {
  const source = String(text ?? '').trim()
  if (!source) throw coded('invalid_browser_response', 'Browser response was empty')
  const normalizedTools = normalizeToolDefinitions(tools)
  const openAiTools = toOpenAiTools(normalizedTools)
  const recoveredSource = recoverMissingOuterToolBrace(source)
  const parseSource = normalizeRawWindowsToolPaths(recoveredSource)
  const parsed = isDeepSeek(providerId)
    ? parseDeepSeekToolCalls(parseSource, idSeed, openAiTools)
    : parseToolCallsFromText(parseSource, idSeed, openAiTools)
  return {
    content: String(parsed.content ?? '').trim(),
    toolCalls: (parsed.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    })),
  }
}

export function buildToolContract(tools) {
  const serializedTools = buildToolCatalog(tools)
  return serializedTools
    ? `${LOCAL_TOOL_EXECUTION_BOUNDARY}\n\n${serializedTools}`
    : ''
}

export function normalizeToolDefinitions(tools) {
  if (!Array.isArray(tools)) return []
  const normalized = []
  const seen = new Set()
  for (const tool of tools) {
    const candidate = tool?.type === 'function' && typeof tool.name === 'string'
      ? tool
      : tool?.type === 'function' && typeof tool.function?.name === 'string'
        ? {
            type: 'function',
            name: tool.function.name,
            description: tool.function.description,
            parameters: tool.function.parameters,
            strict: tool.function.strict,
          }
        : null
    if (!candidate?.name || seen.has(candidate.name)) continue
    seen.add(candidate.name)
    normalized.push({
      type: 'function',
      name: candidate.name,
      description: typeof candidate.description === 'string' ? candidate.description : '',
      parameters: isObject(candidate.parameters)
        ? candidate.parameters
        : { type: 'object', properties: {} },
      ...(typeof candidate.strict === 'boolean' ? { strict: candidate.strict } : {}),
    })
  }
  return normalized
}

function buildUserTurnPrompt({
  text,
  instructions,
  tools,
  providerId,
  includeInstructions,
  includeToolContract,
}) {
  return [
    includeToolContract ? LOCAL_TOOL_EXECUTION_BOUNDARY : '',
    includeInstructions ? instructions : '',
    includeToolContract ? buildToolCatalog(tools, providerId) : '',
    `User: ${text}`,
  ].filter(Boolean).join('\n\n')
}

function buildToolResultPrompt({
  results,
  instructions,
  tools,
  providerId,
  includeInstructions,
  includeToolContract,
}) {
  return [
    includeToolContract ? LOCAL_TOOL_EXECUTION_BOUNDARY : '',
    includeInstructions ? instructions : '',
    includeToolContract ? buildToolCatalog(tools, providerId) : '',
    ...results.map(({ call, output, status }) =>
      `Tool result (${call.name}${status === 'error' ? ', error' : ''}): ${output || '(no output)'}`),
    'Continue the task using the tool results above. Do NOT repeat tool calls that already succeeded; perform the next step or give the final answer.',
  ].filter(Boolean).join('\n\n')
}

function unseenUserMessages(input, deliveredCounts) {
  const occurrence = new Map()
  const unseen = []
  for (const item of input.filter(isUserMessage)) {
    const hash = digest(item)
    const index = (occurrence.get(hash) ?? 0) + 1
    occurrence.set(hash, index)
    if (index > (deliveredCounts[hash] ?? 0)) unseen.push({ item, hash, index })
  }
  return unseen
}

function toOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    },
  }))
}

function buildToolCatalog(tools) {
  const openAiTools = toOpenAiTools(normalizeToolDefinitions(tools))
  return serializeDeepSeekToolPrompt(openAiTools)
}

function parseArguments(value) {
  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function recoverMissingOuterToolBrace(source) {
  if (!source.startsWith('{') || !source.endsWith('}') ||
      !/["']name["']\s*:/.test(source) ||
      !/["']arguments["']\s*:/.test(source)) {
    return source
  }

  let depth = 0
  let quote = ''
  let escaped = false
  for (const character of source) {
    if (escaped) {
      escaped = false
      continue
    }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
    } else if (character === '{') {
      depth += 1
    } else if (character === '}') {
      depth -= 1
    }
    if (depth < 0) return source
  }
  return depth === 1 && !quote ? `${source}}` : source
}

function normalizeRawWindowsToolPaths(source) {
  const looksLikeToolCall =
    source.includes('<tool>') ||
    source.includes('<tool_call') ||
    (source.startsWith('{') &&
      /["']name["']\s*:/.test(source) &&
      /["']arguments["']\s*:/.test(source))
  if (!looksLikeToolCall) return source
  const backslashNormalized = /[A-Za-z]:\\/.test(source)
    ? escapeRawBackslashesInJsonStrings(source)
    : source
  if (toolJsonPayloadsAreValid(backslashNormalized)) return backslashNormalized
  const repairedCommand = repairQuotedCommandArgument(source)
  if (!repairedCommand) return backslashNormalized
  return /[A-Za-z]:\\/.test(repairedCommand)
    ? escapeRawBackslashesInJsonStrings(repairedCommand)
    : repairedCommand
}

function toolJsonPayloadsAreValid(source) {
  const payloads = [...source.matchAll(/<tool>\s*([\s\S]*?)\s*<\/tool>/g)]
    .map((match) => match[1])
  if (payloads.length === 0 && source.startsWith('{')) payloads.push(source)
  if (payloads.length === 0) return false
  return payloads.every((payload) => {
    try {
      JSON.parse(payload)
      return true
    } catch {
      return false
    }
  })
}

function isDeepSeek(providerId) {
  return String(providerId).toLowerCase().includes('deepseek')
}

function messageText(item) {
  return (item?.content ?? []).map((part) =>
    typeof part?.text === 'string' ? part.text : '').join('')
}

function toolResultText(item) {
  if (typeof item.output === 'string') return item.output
  return JSON.stringify(item.output ?? '')
}

function isUserMessage(item) {
  return item?.type === 'message' && item.role === 'user'
}

function isToolResult(item) {
  return item?.type === 'function_call_output' && typeof item.call_id === 'string'
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
}

function digest(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
    .slice(0, 32)
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
