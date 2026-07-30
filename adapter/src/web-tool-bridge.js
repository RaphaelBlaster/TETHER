import { createHash } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import dirtyJson from 'dirty-json'
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
  'When an external action is required, output only the exact browser-safe <tool>...</tool> block shown below for the local harness and stop. Wait for the returned Tool result before continuing.',
  'Emit exactly one tool call per response. After every Tool result, if the task is unfinished, immediately emit the next required <tool> call. Never end an unfinished task with only a plan, a promise to call a tool, or a request for the user to say continue.',
  'Keep the tool JSON inside the shown json code fence. The fence prevents the host website from interpreting command characters such as $, |, _, and - as Markdown or mathematics.',
  'Every <tool> payload must be valid JSON. In Windows paths, escape each backslash as \\\\ (for example, C:\\\\Users\\\\Name\\\\file.txt).',
  String.raw`Inside JSON strings, escape embedded double quotes as \". Example: {"command":"Remove-Item -LiteralPath \"C:\\Users\\Name\\file.txt\" -Force"}.`,
  'Never simulate a tool result or claim an action succeeded unless the local tool result confirms it.',
].join('\n')
const WEB_TOOL_CONTRACT_VERSION = 5
const dirtyToolAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
})

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
  const renderedSource = normalizeIncompleteRenderedToolEnvelope(source)
  const recoveredSource = recoverMissingOuterToolBrace(renderedSource)
  const parseSource = normalizeRawWindowsToolPaths(recoveredSource)
  const primaryParsed = isDeepSeek(providerId)
    ? parseDeepSeekToolCalls(parseSource, idSeed, openAiTools)
    : parseToolCallsFromText(parseSource, idSeed, openAiTools)
  const parsed = primaryParsed.toolCalls?.length
    ? primaryParsed
    : parseDirtyToolCalls(recoveredSource, idSeed, normalizedTools) ?? primaryParsed
  return {
    content: String(parsed.content ?? '').trim(),
    toolCalls: (parsed.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    })),
  }
}

// Last-resort deserialization for rendered web-chat tool calls. The primary
// OmniRoute parsers remain authoritative. dirty-json is accepted only for a
// standalone tool payload whose exact name was offered and whose arguments
// validate against that tool's schema with no undeclared top-level fields.
function parseDirtyToolCalls(source, idSeed, tools) {
  const candidates = standaloneDirtyToolCandidates(source)
  if (candidates.length === 0) return null
  const offered = new Map(tools.map((tool) => [tool.name, tool]))
  const toolCalls = []

  for (const candidate of candidates) {
    const repairedCandidate = repairFinalDirtyStringArgument(candidate, offered)
    const parseCandidate = repairedCandidate ?? normalizeRawWindowsToolPaths(candidate)
    let parsed
    try {
      parsed = JSON.parse(parseCandidate)
    } catch {
      try {
        parsed = dirtyJson.parse(parseCandidate)
      } catch {
        return null
      }
    }
    if (!isObject(parsed)) return null

    const functionPayload = parsed.type === 'function' && isObject(parsed.function)
      ? parsed.function
      : parsed
    const name = functionPayload.name
    const tool = offered.get(name)
    if (!tool) return null

    let args = functionPayload.arguments
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        try {
          args = dirtyJson.parse(args)
        } catch {
          return null
        }
      }
    }
    if (!isObject(args) || !validateDirtyToolArguments(args, tool.parameters)) return null

    toolCalls.push({
      id: `${idSeed}_${toolCalls.length}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(args),
      },
    })
  }

  return toolCalls.length > 0
    ? { content: '', toolCalls }
    : null
}

function repairFinalDirtyStringArgument(candidate, offered) {
  const name = candidate.match(/["']name["']\s*:\s*["']([^"'\\]{1,128})["']/)?.[1]
  const tool = offered.get(name)
  const properties = tool?.parameters?.properties
  if (!tool || !isObject(properties)) return null

  const argumentsIndex = candidate.search(/["']arguments["']\s*:/)
  const closing = candidate.match(/"\s*}\s*}\s*$/)
  if (argumentsIndex < 0 || !closing) return null

  let selected = null
  for (const [propertyName, schema] of Object.entries(properties)) {
    const types = Array.isArray(schema?.type) ? schema.type : [schema?.type]
    if (!types.includes('string')) continue
    const matcher = new RegExp(`${escapeRegExp(JSON.stringify(propertyName))}\\s*:\\s*"`, 'g')
    for (const match of candidate.matchAll(matcher)) {
      const valueStart = match.index + match[0].length
      if (match.index > argumentsIndex && valueStart < closing.index &&
          (!selected || match.index > selected.matchIndex)) {
        selected = { propertyName, matchIndex: match.index, valueStart }
      }
    }
  }
  if (!selected) return null

  const rawValue = candidate.slice(selected.valueStart, closing.index)
  const nestedJson = selected.propertyName === 'content'
    ? recoverNestedJsonContent(rawValue)
    : null
  const value = nestedJson ?? decodeMalformedJsonString(rawValue)
  if (value === null) return null
  const encoded = JSON.stringify(value)
  const repaired = `${candidate.slice(0, selected.valueStart)}${encoded.slice(1, -1)}${candidate.slice(closing.index)}`
  return repairEarlierWindowsPathArguments(repaired, tool.parameters, selected.propertyName, argumentsIndex)
}

function repairEarlierWindowsPathArguments(candidate, parameters, finalPropertyName, argumentsIndex) {
  const properties = parameters?.properties
  if (!isObject(properties)) return candidate
  const repairs = []

  for (const [propertyName, schema] of Object.entries(properties)) {
    const types = Array.isArray(schema?.type) ? schema.type : [schema?.type]
    if (propertyName === finalPropertyName || !types.includes('string') || !/path|file|dir/i.test(propertyName)) continue
    const marker = new RegExp(`${escapeRegExp(JSON.stringify(propertyName))}\\s*:\\s*"`, 'g')
    for (const match of candidate.matchAll(marker)) {
      const valueStart = match.index + match[0].length
      if (match.index <= argumentsIndex) continue
      const nextPropertyIndex = nextDeclaredPropertyIndex(candidate, properties, valueStart, propertyName)
      if (nextPropertyIndex < 0) continue
      const segment = candidate.slice(valueStart, nextPropertyIndex)
      const boundary = segment.match(/"\s*,\s*$/)
      if (!boundary) continue
      const valueEnd = valueStart + boundary.index
      const rawValue = candidate.slice(valueStart, valueEnd)
      if (!/^[A-Za-z]:\\/.test(rawValue)) continue
      repairs.push({ valueStart, valueEnd, value: collapseJsonBackslashPairs(rawValue) })
    }
  }

  let repaired = candidate
  for (const repair of repairs.sort((left, right) => right.valueStart - left.valueStart)) {
    const encoded = JSON.stringify(repair.value)
    repaired = `${repaired.slice(0, repair.valueStart)}${encoded.slice(1, -1)}${repaired.slice(repair.valueEnd)}`
  }
  return repaired
}

function nextDeclaredPropertyIndex(candidate, properties, valueStart, currentPropertyName) {
  let next = -1
  for (const propertyName of Object.keys(properties)) {
    if (propertyName === currentPropertyName) continue
    const matcher = new RegExp(`${escapeRegExp(JSON.stringify(propertyName))}\\s*:`, 'g')
    for (const match of candidate.matchAll(matcher)) {
      if (match.index > valueStart && (next < 0 || match.index < next)) next = match.index
    }
  }
  return next
}

function collapseJsonBackslashPairs(value) {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '\\' && value[index + 1] === '\\') index += 1
    result += character
  }
  return result
}

function decodeMalformedJsonString(rawValue) {
  let repaired = ''
  let backslashes = 0
  for (const character of rawValue) {
    if (character === '"' && backslashes % 2 === 0) repaired += '\\'
    if (character === '\n') repaired += '\\n'
    else if (character === '\r') repaired += '\\r'
    else if (character === '\t') repaired += '\\t'
    else repaired += character
    backslashes = character === '\\' ? backslashes + 1 : 0
  }
  try {
    return JSON.parse(`"${repaired}"`)
  } catch {
    return null
  }
}

function recoverNestedJsonContent(rawValue) {
  const candidate = decodeJsonWhitespaceEscapes(rawValue)
  const trimmed = candidate.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  const normalized = /[A-Za-z]:\\/.test(candidate)
    ? escapeRawBackslashesInJsonStrings(candidate)
    : candidate
  try {
    JSON.parse(normalized)
    return normalized
  } catch {
    return null
  }
}

function decodeJsonWhitespaceEscapes(value) {
  let result = ''
  let quoted = false
  let escaped = false
  const whitespace = { n: '\n', r: '\r', t: '\t' }
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quoted) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') {
      quoted = true
      result += character
      continue
    }
    if (character === '\\') {
      const doubledEscape = value[index + 1] === '\\' ? value[index + 2] : null
      const singleEscape = value[index + 1]
      if (doubledEscape && whitespace[doubledEscape]) {
        result += whitespace[doubledEscape]
        index += 2
        continue
      }
      if (whitespace[singleEscape]) {
        result += whitespace[singleEscape]
        index += 1
        continue
      }
    }
    result += character
  }
  return result
}

function standaloneDirtyToolCandidates(source) {
  const text = String(source ?? '').trim()
  if (!text) return []

  const wrappers = [...text.matchAll(/<tool>\s*([\s\S]*?)\s*<\/tool>/gi)]
  if (wrappers.length > 0) {
    const remainder = text.replace(/<tool>\s*[\s\S]*?\s*<\/tool>/gi, '').trim()
    if (remainder) return []
    return wrappers.map((match) => stripJsonFence(match[1]))
  }

  const candidate = stripJsonFence(text)
  return candidate.startsWith('{') &&
    candidate.endsWith('}') &&
    /["']name["']\s*:/.test(candidate) &&
    /["']arguments["']\s*:/.test(candidate)
    ? [candidate]
    : []
}

function stripJsonFence(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (match?.[1] ?? text).trim()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validateDirtyToolArguments(args, parameters) {
  if (!isObject(parameters)) return false
  const schema = parameters.type === 'object' && isObject(parameters.properties)
    ? { ...parameters, additionalProperties: false }
    : parameters
  try {
    return dirtyToolAjv.compile(schema)(args)
  } catch {
    return false
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
    'Continue the task using the tool results above. Do NOT repeat tool calls that already succeeded. If the task is unfinished, emit the next <tool> call now; do not respond with only a plan, a promise to use a tool, or a request for the user to say continue. Otherwise give the final answer.',
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
    .replace(
      'output ONLY this exact block (no markdown fence):',
      'output ONLY this exact browser-safe block:',
    )
    .replace(
      '<tool>{"name": "<tool_name>", "arguments": { ... }}</tool>',
      '<tool>\n```json\n{"name": "<tool_name>", "arguments": { ... }}\n```\n</tool>',
    )
    .replace(
      '- Use exactly <tool>...</tool>. Do NOT use <tool:name>, <tool_call>, <name>, <parameter>, id=/name= attributes, or code fences.',
      '- Use exactly <tool>...</tool> with the JSON inside its json code fence. Do NOT use <tool:name>, <tool_call>, <name>, <parameter>, or id=/name= attributes.',
    )
    .replace(
      '- Emit one <tool> block per call; you may put several blocks back to back.',
      '- Emit exactly one <tool> block per response. After its Tool result returns, immediately emit the next call if the task is unfinished.',
    )
}

function parseArguments(value) {
  try {
    const parsed = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Chat renderers can treat a model's literal <tool> wrapper as HTML. A malformed
// closing tag may then survive extraction as one trailing ">", while the JSON
// payload remains visible and complete. Normalize only a standalone object with
// the required tool-call keys; ordinary prose and comparison operators remain
// untouched. The existing JSON repair and offered-tool filtering still run.
function normalizeIncompleteRenderedToolEnvelope(source) {
  let candidate = source.trim()
  if (candidate.startsWith('<tool>') && !candidate.includes('</tool>')) {
    const remainder = candidate.slice('<tool>'.length).trim()
    if (
      remainder.startsWith('{') &&
      remainder.endsWith('>') &&
      /["']name["']\s*:/.test(remainder) &&
      /["']arguments["']\s*:/.test(remainder)
    ) {
      candidate = remainder
    }
  }
  if (
    candidate.startsWith('{') &&
    candidate.endsWith('>') &&
    /["']name["']\s*:/.test(candidate) &&
    /["']arguments["']\s*:/.test(candidate)
  ) {
    candidate = candidate.slice(0, -1).trim()
  }
  return candidate
}

function recoverMissingOuterToolBrace(source) {
  let repairedWrapper = false
  const wrapped = source.replace(/<tool>\s*([\s\S]*?)\s*<\/tool>/gi, (match, payload) => {
    const candidate = stripJsonFence(payload)
    const repaired = recoverBareMissingOuterToolBrace(candidate)
    if (repaired === candidate) return match
    repairedWrapper = true
    return `<tool>${repaired}</tool>`
  })
  return repairedWrapper ? wrapped : recoverBareMissingOuterToolBrace(source)
}

function recoverBareMissingOuterToolBrace(source) {
  const candidate = source.trim()
  if (!candidate.startsWith('{') || !candidate.endsWith('}') ||
      !/["']name["']\s*:/.test(candidate) ||
      !/["']arguments["']\s*:/.test(candidate)) {
    return source
  }

  let depth = 0
  let quote = ''
  let escaped = false
  for (const character of candidate) {
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
  return depth === 1 && !quote ? `${candidate}}` : source
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
