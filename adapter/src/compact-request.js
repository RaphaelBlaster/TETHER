import { createHash } from 'node:crypto'

export const COMPACT_SCHEMA_VERSION = 1

export function projectCompactRequest({ requestId, request, conversation = null, connectionId = null }) {
  const assets = compactAssets(request)
  const { context, delta } = splitInput(request.input ?? [], request.previous_response_id == null, conversation, connectionId)
  const contextHash = digest(context)
  // Codex instructions and synthetic context are local agent-runtime state. Sending
  // them to a consumer chat both leaks implementation detail and routinely exceeds
  // browser composer limits. Only the user/tool delta crosses this boundary.
  const toolCatalog = conversation?.toolsHash !== assets.toolsHash
    ? compactToolCatalog(request.tools ?? [])
    : null

  return {
    schemaVersion: COMPACT_SCHEMA_VERSION,
    type: 'codex_turn',
    requestId,
    ...(toolCatalog ? { toolCatalog } : {}),
    turn: {
      input: delta,
      completionPolicy: 'continue_until_objective_complete_or_user_input_required',
      toolChoice: request.tool_choice ?? 'auto',
      parallelToolCalls: request.parallel_tool_calls === true,
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    },
  }
}

export function compactProjectionState(request, { conversation = null, connectionId = null } = {}) {
  const sameConnection = conversation?.codexConnectionId === connectionId
  const inputHashes = browserVisibleInput(request.input ?? []).map(digest)
  const delivered = sameConnection
    ? mergeInputOccurrences(conversation.deliveredInputHashes ?? [], inputHashes)
    : inputHashes
  const { context } = splitInput(request.input ?? [], request.previous_response_id == null, conversation, connectionId)
  return {
    ...compactAssets(request),
    contextHash: context.length ? digest(context) : conversation?.contextHash ?? digest([]),
    codexConnectionId: connectionId,
    deliveredInputHashes: delivered,
  }
}

export function compactInstallationState(request, { conversation = null, connectionId = null } = {}) {
  const { context } = splitInput(request.input ?? [], request.previous_response_id == null, conversation, connectionId)
  return {
    ...compactAssets(request),
    contextHash: context.length ? digest(context) : conversation?.contextHash ?? digest([]),
  }
}

export function compactTools(tools) {
  return cloneJson(tools)
}

export function compactToolCatalog(tools) {
  return tools.map((tool) => {
    if (tool?.type === 'namespace') {
      return {
        type: 'namespace', name: tool.name,
        tools: (tool.tools ?? []).map((child) => ({ name: child.name })),
      }
    }
    if (tool?.name) return { type: tool.type ?? 'function', name: tool.name }
    return { type: tool?.type ?? 'unknown' }
  })
}

export function selectDeferredToolDefinitions(tools, requested) {
  return requested.map(({ namespace, name }) => {
    if (namespace) {
      const parent = tools.find((tool) => tool?.type === 'namespace' && tool.name === namespace)
      const child = parent?.tools?.find((tool) => tool.name === name)
      if (!child) throw Object.assign(new Error(`Tool ${namespace}.${name} was not offered`), { code: 'unoffered_tool_schema' })
      return { type: 'namespace', name: namespace, description: parent.description ?? '', tools: [cloneJson(child)] }
    }
    const tool = tools.find((candidate) => candidate?.type !== 'namespace' && candidate?.name === name)
    if (!tool) throw Object.assign(new Error(`Tool ${name} was not offered`), { code: 'unoffered_tool_schema' })
    return cloneJson(tool)
  })
}

function compactAssets(request) {
  return {
    instructionsHash: digest(request.instructions ?? ''),
    toolsHash: digest(request.tools ?? []),
  }
}

function splitInput(input, initial, conversation, connectionId) {
  input = browserVisibleInput(input)
  if (conversation?.codexConnectionId === connectionId) {
    const delivered = occurrenceCounts(conversation.deliveredInputHashes ?? [])
    return {
      context: [],
      delta: input.filter((item) => {
        const hash = digest(item)
        const remaining = delivered.get(hash) ?? 0
        if (remaining === 0) return true
        delivered.set(hash, remaining - 1)
        return false
      }),
    }
  }
  if (!initial || input.length <= 1 || input.some((item) => isToolResult(item))) return { context: [], delta: input }
  return { context: input.slice(0, -1), delta: input.slice(-1) }
}

function mergeInputOccurrences(previous, current) {
  const merged = [...previous]
  const mergedCounts = occurrenceCounts(merged)
  const currentCounts = occurrenceCounts(current)
  for (const [hash, count] of currentCounts) {
    for (let index = mergedCounts.get(hash) ?? 0; index < count; index += 1) merged.push(hash)
  }
  return merged
}

function occurrenceCounts(hashes) {
  const counts = new Map()
  for (const hash of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1)
  return counts
}

function browserVisibleInput(input) {
  return input.filter((item) =>
    isToolResult(item) ||
    (item?.type === 'message' && item?.role === 'user'))
}

function isToolResult(item) {
  return ['function_call_output', 'custom_tool_call_output', 'computer_call_output'].includes(item?.type)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}
