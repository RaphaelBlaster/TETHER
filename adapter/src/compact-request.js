import { createHash } from 'node:crypto'

export const COMPACT_SCHEMA_VERSION = 1

export function projectCompactRequest({ requestId, request, conversation = null, connectionId = null, protocolBootstrap = null }) {
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
    responseContract: {
      jsonOnly: true,
      schemaVersion: 1,
      requestId,
      assistantText: { type: 'assistant_text', content: 'string' },
      toolCall: { type: 'tool_call', callId: 'unique string', namespace: 'optional exact namespace', name: 'exact offered tool name', arguments: 'object' },
      toolSchemaRequest: { type: 'tool_schema_request', tools: 'one-element array containing an exact offered {name, optional namespace}' },
    },
    ...(protocolBootstrap ? { protocolBootstrap } : {}),
    ...(toolCatalog ? { toolCatalog } : {}),
    turn: {
      input: delta,
      toolChoice: request.tool_choice ?? 'auto',
      parallelToolCalls: request.parallel_tool_calls === true,
      ...(request.reasoning ? { reasoning: request.reasoning } : {}),
    },
  }
}

export function compactProjectionState(request, { conversation = null, connectionId = null } = {}) {
  const sameConnection = conversation?.codexConnectionId === connectionId
  const delivered = new Set(sameConnection ? conversation.deliveredInputHashes ?? [] : [])
  for (const item of request.input ?? []) delivered.add(digest(item))
  const { context } = splitInput(request.input ?? [], request.previous_response_id == null, conversation, connectionId)
  return {
    ...compactAssets(request),
    contextHash: context.length ? digest(context) : conversation?.contextHash ?? digest([]),
    codexConnectionId: connectionId,
    deliveredInputHashes: [...delivered],
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
    const delivered = new Set(conversation.deliveredInputHashes ?? [])
    return { context: [], delta: input.filter((item) => !delivered.has(digest(item))) }
  }
  if (!initial || input.length <= 1 || input.some((item) => isToolResult(item))) return { context: [], delta: input }
  return { context: input.slice(0, -1), delta: input.slice(-1) }
}

function browserVisibleInput(input) {
  const toolResults = input.filter((item) => isToolResult(item))
  if (toolResults.length) return toolResults
  const users = input.filter((item) => item?.type === 'message' && item?.role === 'user')
  return users.length ? [users.at(-1)] : []
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
