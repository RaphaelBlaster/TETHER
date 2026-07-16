export function parseBrowserEnvelope(text, requestId, offeredTools = []) {
  const parsed = parseJsonObjects(text).map(inferEnvelopeType)
  const matching = parsed.filter((value) => isObject(value) && value.requestId === requestId &&
    ['assistant_text', 'tool_call', 'tool_schema_request'].includes(value.type))
  if (parsed.length !== 1 && matching.length !== 1) {
    throw coded('invalid_browser_json', `Browser response must be exactly one JSON object (received: ${preview(text)})`, {
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
    return envelope
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
  throw coded('invalid_browser_envelope', 'Browser response type is unsupported')
}

// Consumer chat models sometimes answer an ordinary text turn directly even
// after receiving the JSON protocol bootstrap. Plain text is unambiguous and
// can be translated losslessly. JSON-looking output stays on the strict path so
// malformed or invented tool calls are never accepted as assistant text.
export function parseBrowserResponse(text, requestId, offeredTools = []) {
  const normalized = String(text ?? '').trim()
  if (!normalized) throw coded('invalid_browser_json', 'Browser response was empty')
  const hasSpeakerPrefix = /^[^{}\r\n]{1,80}\b(?:said|says)\s+(?=\{)/i.test(normalized)
  // Some providers render a small speaker prefix (for example, "Gemini said")
  // before an otherwise valid protocol object.  Accept only a uniquely
  // correlated object; never parse an arbitrary JSON fragment as a tool call.
  const embedded = parseJsonObjects(normalized, { repairSpeakerToolCall: hasSpeakerPrefix }).map(inferEnvelopeType)
  const matching = embedded.filter((value) => isObject(value) && value.requestId === requestId &&
    ['assistant_text', 'tool_call', 'tool_schema_request'].includes(value.type))
  if (matching.length === 1) return parseBrowserEnvelope(JSON.stringify(matching[0]), requestId, offeredTools)
  // Gemini and Claude expose a rendered speaker label through innerText and
  // occasionally omit requestId even though the requested envelope included
  // it. Only repair that omission for one complete object directly following
  // the provider's "said"/"says" label; normal prose containing JSON remains
  // ordinary assistant text. Full schema and offered-tool validation still
  // happens in parseBrowserEnvelope.
  const uncorrelated = embedded.filter((value) => isObject(value) && value.requestId === undefined &&
    ['assistant_text', 'tool_call', 'tool_schema_request'].includes(value.type))
  if (hasSpeakerPrefix && embedded.length === 1 && uncorrelated.length === 1) {
    return parseBrowserEnvelope(JSON.stringify({ ...uncorrelated[0], requestId }), requestId, offeredTools)
  }
  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    return parseBrowserEnvelope(normalized, requestId, offeredTools)
  }
  return { schemaVersion: 1, type: 'assistant_text', requestId, content: normalized }
}

function inferEnvelopeType(value) {
  if (!isObject(value)) return value
  let normalized = value
  if (value.type === undefined && typeof value.callId === 'string' && typeof value.name === 'string' && isObject(value.arguments)) {
    normalized = { ...value, type: 'tool_call' }
  } else if (value.type === undefined && typeof value.content === 'string') {
    normalized = { ...value, type: 'assistant_text' }
  }
  return ['tool_call', 'assistant_text'].includes(normalized.type) && normalized.schemaVersion === undefined
    ? { schemaVersion: 1, ...normalized }
    : normalized
}

function parseJsonObjects(value, { repairSpeakerToolCall = false } = {}) {
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
          if (repairSpeakerToolCall && /"type"\s*:\s*"tool_call"/.test(candidate)) {
            try { values.push(JSON.parse(escapeRawBackslashesInJsonStrings(candidate))) } catch {}
          }
        }
        start = end
        break
      }
    }
  }
  return values
}

// Consumer model UIs sometimes render a Windows command with single path
// separators inside JSON. This runs only after JSON.parse failed and only for
// a speaker-prefixed tool_call, so preserve structural quote/backslash escapes
// while making other backslashes literal.
function escapeRawBackslashesInJsonStrings(value) {
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
      if (!['"', '\\', '/'].includes(next)) result += '\\'
    }
    result += character
  }
  return result
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
