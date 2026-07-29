import { PROTOCOL_HELP_TOPICS } from './protocol-help.js'

const ENVELOPE_TYPES = Object.freeze([
  'assistant_text',
  'tool_call',
  'tool_schema_request',
  'protocol_help_request',
])

export function parseBrowserEnvelope(text, requestId, offeredTools = []) {
  const parsed = parseJsonObjects(text).map(inferEnvelopeType)
  const matching = parsed.filter((value) => isObject(value) && value.requestId === requestId &&
    ENVELOPE_TYPES.includes(value.type))
  if (parsed.length === 0) {
    throw coded('invalid_browser_json', `Browser response is not valid JSON (received: ${preview(text)})`, {
      rawText: boundedRawText(text),
    })
  }
  if (parsed.length !== 1 && matching.length !== 1) {
    throw coded('invalid_browser_json', `Browser response contains multiple JSON objects and no unique current response (received: ${preview(text)})`, {
      rawText: boundedRawText(text),
    })
  }
  const envelope = parsed.length === 1 ? parsed[0] : matching[0]
  if (
    envelope === null ||
    typeof envelope !== 'object' ||
    Array.isArray(envelope) ||
    envelope.schemaVersion !== 1 ||
    envelope.requestId !== requestId
  ) {
    throw coded('invalid_browser_envelope', `Browser response does not match the TETHER schema (${JSON.stringify({
      schemaVersion: envelope?.schemaVersion ?? null,
      type: envelope?.type ?? null,
      requestIdMatches: envelope?.requestId === requestId,
      keys: isObject(envelope) ? Object.keys(envelope).slice(0, 8) : [],
    })})`)
  }
  if (envelope.type === 'assistant_text') {
    if (
      typeof envelope.content !== 'string' ||
      !envelope.content.trim() ||
      Object.keys(envelope).some((key) => !['schemaVersion', 'type', 'requestId', 'content'].includes(key))
    ) throw coded('invalid_browser_envelope', 'Browser response does not match the assistant_text schema')
    const content = restoreWindowsPathTabs(envelope.content)
    return content === envelope.content ? envelope : { ...envelope, content }
  }
  if (envelope.type === 'tool_call') {
    if (
      !validIdentifier(envelope.callId) ||
      !validIdentifier(envelope.name) ||
      (envelope.namespace !== undefined && !validIdentifier(envelope.namespace)) ||
      !isOfferedTool(envelope, offeredTools) ||
      !isObject(envelope.arguments) ||
      Object.keys(envelope).some((key) => !['schemaVersion', 'type', 'requestId', 'callId', 'namespace', 'name', 'arguments'].includes(key))
    ) throw coded('invalid_browser_tool_call', 'Browser response does not match an offered tool_call schema')
    return envelope
  }
  if (envelope.type === 'tool_schema_request') {
    if (
      !Array.isArray(envelope.tools) ||
      envelope.tools.length !== 1 ||
      envelope.tools.some((tool) => !isObject(tool) || !validIdentifier(tool.name) ||
        (tool.namespace !== undefined && !validIdentifier(tool.namespace)) ||
        Object.keys(tool).some((key) => !['name', 'namespace'].includes(key)) ||
        !isOfferedTool(tool, offeredTools)) ||
      Object.keys(envelope).some((key) => !['schemaVersion', 'type', 'requestId', 'tools'].includes(key))
    ) throw coded('invalid_tool_schema_request', 'Browser requested an unavailable tool schema', {
      requestedTools: Array.isArray(envelope.tools) ? envelope.tools : null,
      offeredTools: offeredToolReferences(offeredTools),
    })
    return envelope
  }
  if (envelope.type === 'protocol_help_request') {
    if (
      !Array.isArray(envelope.topics) ||
      envelope.topics.length !== 1 ||
      envelope.topics.some((topic) => !PROTOCOL_HELP_TOPICS.includes(topic)) ||
      Object.keys(envelope).some((key) => !['schemaVersion', 'type', 'requestId', 'topics'].includes(key))
    ) throw coded('invalid_protocol_help_request', 'Browser requested an unavailable protocol help topic', {
      requestedTopics: Array.isArray(envelope.topics) ? envelope.topics : null,
      availableTopics: PROTOCOL_HELP_TOPICS,
    })
    return envelope
  }
  throw coded('invalid_browser_envelope', 'Browser response type is unsupported')
}

// Consumer chat models sometimes answer an ordinary text turn directly even
// after receiving the JSON protocol bootstrap. Plain text is unambiguous and
// can be translated losslessly. JSON-looking output stays on the strict path so
// malformed or invented tool calls are never accepted as assistant text.
export function parseBrowserResponse(text, requestId, offeredTools = []) {
  const rawNormalized = String(text ?? '').trim()
  if (!rawNormalized) throw coded('invalid_browser_json', 'Browser response was empty')
  const normalized = unwrapCorrelatedJsonString(rawNormalized, requestId)
  const hasSpeakerPrefix = /^[^{}\r\n]{1,80}\b(?:said|says)\s+(?=\{)/i.test(normalized)
  const protocolText = hasSpeakerPrefix ? normalized.slice(normalized.indexOf('{')) : normalized
  const standaloneCorrelatedToolCall =
    protocolText.startsWith('{') &&
    protocolText.endsWith('}') &&
    /"type"\s*:\s*"tool_call"/.test(protocolText) &&
    new RegExp(`"requestId"\\s*:\\s*${escapeRegExp(JSON.stringify(requestId))}`).test(protocolText)
  const standaloneCorrelatedAssistantText =
    protocolText.startsWith('{') &&
    protocolText.endsWith('}') &&
    /"type"\s*:\s*"assistant_text"/.test(protocolText) &&
    new RegExp(`"requestId"\\s*:\\s*${escapeRegExp(JSON.stringify(requestId))}`).test(protocolText)
  const repairedProtocolText = standaloneCorrelatedAssistantText
    ? repairQuotedAssistantText(protocolText) ?? protocolText
    : standaloneCorrelatedToolCall
      ? repairQuotedCommandArgument(protocolText) ?? protocolText
      : protocolText
  // Some providers render a small speaker prefix (for example, "Gemini said")
  // before an otherwise valid protocol object.  Accept only a uniquely
  // correlated object; never parse an arbitrary JSON fragment as a tool call.
  // A standalone tool call with the exact current requestId is equally
  // unambiguous, so repair raw Windows path separators there as well.
  const embedded = parseJsonObjects(repairedProtocolText, {
    repairToolCallBackslashes: hasSpeakerPrefix || standaloneCorrelatedToolCall,
  }).map(inferEnvelopeType)
  const matching = embedded.filter((value) => isObject(value) && value.requestId === requestId &&
    ENVELOPE_TYPES.includes(value.type))
  if (matching.length === 1) return parseBrowserEnvelope(JSON.stringify(matching[0]), requestId, offeredTools)
  // Gemini and Claude expose a rendered speaker label through innerText and
  // occasionally omit requestId even though the requested envelope included
  // it. Only repair that omission for one complete object directly following
  // the provider's "said"/"says" label; normal prose containing JSON remains
  // ordinary assistant text. Full schema and offered-tool validation still
  // happens in parseBrowserEnvelope.
  const uncorrelated = embedded.filter((value) => isObject(value) && value.requestId === undefined &&
    ENVELOPE_TYPES.includes(value.type))
  if (hasSpeakerPrefix && embedded.length === 1 && uncorrelated.length === 1) {
    return parseBrowserEnvelope(JSON.stringify({ ...uncorrelated[0], requestId }), requestId, offeredTools)
  }
  if (protocolText.startsWith('{') || protocolText.startsWith('[')) {
    return parseBrowserEnvelope(repairedProtocolText, requestId, offeredTools)
  }
  return { schemaVersion: 1, type: 'assistant_text', requestId, content: normalized }
}

function inferEnvelopeType(value) {
  if (!isObject(value)) return value
  let normalized = value
  if (normalized.type === 'tool_call' && normalized.name === undefined && typeof normalized.toolName === 'string') {
    const { toolName, ...rest } = normalized
    normalized = { ...rest, name: toolName }
  }
  if (normalized.type === undefined && typeof normalized.callId === 'string' && typeof normalized.name === 'string' && isObject(normalized.arguments)) {
    normalized = { ...normalized, type: 'tool_call' }
  } else if (normalized.type === undefined && typeof normalized.content === 'string') {
    normalized = { ...normalized, type: 'assistant_text' }
  }
  return ['tool_call', 'assistant_text'].includes(normalized.type) && normalized.schemaVersion === undefined
    ? { schemaVersion: 1, ...normalized }
    : normalized
}

function parseJsonObjects(value, { repairToolCallBackslashes = false } = {}) {
  const text = String(value ?? '')
  const values = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let end = start; end < text.length; end += 1) {
      const character = text[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        const candidate = text.slice(start, end + 1)
        try {
          values.push(JSON.parse(candidate))
        } catch {
          if (repairToolCallBackslashes && /"type"\s*:\s*"tool_call"/.test(candidate)) {
            try {
              values.push(JSON.parse(escapeRawBackslashesInJsonStrings(candidate)))
              start = end
              break
            } catch {}
            const repairedCommand = repairQuotedCommandArgument(candidate)
            if (repairedCommand) {
              try {
                values.push(JSON.parse(repairedCommand))
                start = end
                break
              } catch {
                try {
                  values.push(JSON.parse(escapeRawBackslashesInJsonStrings(repairedCommand)))
                  start = end
                  break
                } catch {}
              }
            }
          }
        }
        start = end
        break
      }
    }
  }
  return values
}

// Consumer models can expose a command argument whose quoted Windows path was
// not JSON-escaped. Repair only arguments.command or arguments.cmd on one
// correlated tool_call; JSON.stringify preserves the exact command while
// escaping quotes and separators. Exact offered-tool validation still runs
// before execution.
export function repairQuotedCommandArgument(value) {
  const commandStart = /"arguments"\s*:\s*\{\s*"(?:command|cmd)"\s*:\s*"/.exec(value)
  if (!commandStart) return null
  const openingQuote = commandStart.index + commandStart[0].length - 1
  const remainder = value.slice(openingQuote + 1)
  const commandEnd = /"(?=\s*(?:,\s*"[^"]+"\s*:|}\s*}\s*(?:<\/tool(?:_call)?>)?\s*$))/i.exec(remainder)
  if (!commandEnd) return null
  const closingQuote = openingQuote + 1 + commandEnd.index
  const command = value.slice(openingQuote + 1, closingQuote)
  if (!command.includes('"')) return null
  return `${value.slice(0, openingQuote)}${JSON.stringify(command)}${value.slice(closingQuote + 1)}`
}

// DeepSeek can render the complete envelope as one JSON string instead of as a
// JSON object. Decode exactly one layer only when the decoded value is a
// standalone object carrying the current requestId. The normal strict schema
// and offered-tool checks still run after this normalization.
function unwrapCorrelatedJsonString(value, requestId) {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  let decoded
  try {
    decoded = JSON.parse(value)
  } catch {
    return value
  }
  if (typeof decoded !== 'string') return value
  const normalized = decoded.trim()
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return value
  const correlated = new RegExp(
    `"requestId"\\s*:\\s*${escapeRegExp(JSON.stringify(requestId))}`,
  ).test(normalized)
  return correlated ? normalized : value
}

// A provider can quote a tool result inside assistant_text.content without
// escaping the nested quotes, even after a protocol repair turn. Repair only a
// standalone, exactly correlated assistant_text object whose content is the
// final field. The ordinary envelope validator still enforces the complete
// schema after parsing.
function repairQuotedAssistantText(value) {
  try {
    JSON.parse(value)
    return null
  } catch {}
  const contentStart = /"content"\s*:\s*"/.exec(value)
  if (!contentStart) return null
  const openingQuote = contentStart.index + contentStart[0].length - 1
  const remainder = value.slice(openingQuote + 1)
  const contentEnd = /"\s*}\s*$/.exec(remainder)
  if (!contentEnd) return null
  const closingQuote = openingQuote + 1 + contentEnd.index
  const content = value.slice(openingQuote + 1, closingQuote)
  return `${value.slice(0, openingQuote + 1)}${escapeJsonStringContent(content)}${value.slice(closingQuote)}`
}

function escapeJsonStringContent(value) {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      result += '\\"'
      continue
    }
    if (character === '\\') {
      const next = value[index + 1]
      const validUnicodeEscape = next === 'u' && /^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))
      if (['"', '\\', '/'].includes(next)) {
        result += `${character}${next}`
        index += 1
        continue
      }
      if (!validUnicodeEscape && !['b', 'f', 'n', 'r', 't'].includes(next)) result += '\\'
      result += character
      continue
    }
    const encoded = JSON.stringify(character)
    result += encoded.slice(1, -1)
  }
  return result
}

function restoreWindowsPathTabs(value) {
  return value.replace(/([A-Za-z]:\\[^\r\n]*)\t(?=[A-Za-z0-9_.-])/g, '$1\\t')
}

// Consumer model UIs sometimes render a Windows command with single path
// separators inside JSON. This runs only after JSON.parse failed and only for
// a speaker-prefixed or standalone correlated tool_call, so preserve structural
// quote/backslash escapes while making other backslashes literal.
export function escapeRawBackslashesInJsonStrings(value) {
  let result = ''
  let quoted = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '"') {
      let precedingBackslashes = 0
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) precedingBackslashes += 1
      if (precedingBackslashes % 2 === 0) quoted = !quoted
      result += character
      continue
    }
    if (quoted && character === '\\') {
      const next = value[index + 1]
      if (['"', '\\', '/'].includes(next)) {
        result += `${character}${next}`
        index += 1
        continue
      }
      result += '\\'
    }
    result += character
  }
  return result
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isOfferedTool(envelope, offeredTools) {
  if (offeredTools.every((tool) => typeof tool === 'string')) return envelope.namespace === undefined && offeredTools.includes(envelope.name)
  if (envelope.namespace !== undefined) {
    const namespace = offeredTools.find((tool) => tool?.type === 'namespace' && tool.name === envelope.namespace)
    return Boolean(namespace?.tools?.some((tool) => tool.name === envelope.name))
  }
  return offeredTools.some((tool) => tool?.type !== 'namespace' && tool?.name === envelope.name)
}

function offeredToolReferences(tools) {
  return tools.flatMap((tool) => tool?.type === 'namespace'
    ? (tool.tools ?? []).map((child) => ({ namespace: tool.name, name: child.name }))
    : tool?.name ? [{ name: tool.name }] : [])
}

export const parseAssistantEnvelope = parseBrowserEnvelope

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function preview(value) {
  const normalized = String(value).replaceAll(/\s+/g, ' ').trim()
  return JSON.stringify(normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized)
}

function boundedRawText(value) {
  const text = String(value ?? '')
  return text.length <= 60_000 ? text : `${text.slice(0, 59_997)}...`
}

function coded(code, message, details = undefined) {
  return Object.assign(new Error(message), { code, ...(details ? { details } : {}) })
}
