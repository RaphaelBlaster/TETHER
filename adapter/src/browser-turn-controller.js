import { createHash } from 'node:crypto'
import { EXTENSION_PROTOCOL, EXTENSION_PROTOCOL_VERSION } from './extension-session-registry.js'
import {
  BOOTSTRAP_VERSION,
  buildBrowserPromptSequence,
  buildCompletionCheckPrompt,
  buildDeferredToolSchemaPrompt,
  buildProtocolHelpPrompt,
  buildUnavailableToolPrompt,
} from './browser-prompt.js'
import { parseBrowserResponse } from './browser-envelope.js'
import { compactInstallationState, compactProjectionState, selectDeferredToolDefinitions } from './compact-request.js'
import { finalizeWebToolTurn, prepareWebToolTurn } from './web-tool-bridge.js'

export function createBrowserTurnController({
  registry,
  stateStore,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  timeoutMs = 120000,
  bootstrapTimeoutMs = 300000,
  maxSettled = 128,
  logger = console,
} = {}) {
  const pending = new Map()
  const operations = new Map()
  const settled = new Map()

  async function request(codexRequest, { connectionId = null, selection = null, signal = null } = {}) {
    if (signal?.aborted) throw coded('request_cancelled', 'Request was cancelled')
    const { registration, session } = selection ?? registry.selectExactlyOne()
    const requestId = codexRequestId(codexRequest, connectionId)
    const key = correlationKey(registration.extensionInstanceId, session.browserSessionId, requestId)
    if (settled.has(key)) return settled.get(key)
    if (operations.has(key)) return operations.get(key).promise

    const { conversationKey, conversation } = await resolveConversationState({
      registration,
      session,
      stateStore,
    })
    const webToolPrepared = codexRequest.model === 'tether-tool-bridge'
      ? prepareWebToolTurn({
          request: codexRequest,
          conversation,
          providerId: session.providerId,
        })
      : null
    if (webToolPrepared) {
      logWebToolStage(logger, 'prepared', {
        sessionId: webToolPrepared.sessionState.sessionId,
        browserConversationId: session.conversationId,
        provider: session.providerId,
        turnType: webToolPrepared.turnType,
        toolsHash: webToolPrepared.sessionState.toolsHash,
        pendingCalls: webToolPrepared.sessionState.pendingCalls.length,
        completedCalls: webToolPrepared.sessionState.completedCalls.length,
      })
    }
    if (webToolPrepared?.cachedEnvelope) return webToolPrepared.cachedEnvelope
    const installBootstrap = codexRequest.model !== 'tether-tool-bridge' &&
      conversation?.bootstrapVersion !== BOOTSTRAP_VERSION
    const frames = webToolPrepared
      ? [{
          requestId,
          kind: 'web_tool_turn',
          prompt: webToolPrepared.prompt,
        }]
      : buildBrowserPromptSequence({
          requestId,
          request: codexRequest,
          installBootstrap,
          conversation,
          connectionId,
        })
    let resolveRequest
    let rejectRequest
    const promise = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject })
    const operation = {
      key: null, baseKey: key, requestId, conversationKey, installBootstrap, codexRequest, connectionId,
      extensionInstanceId: registration.extensionInstanceId,
      browserSessionId: session.browserSessionId,
      providerConversationId: session.conversationId,
      providerId: session.providerId,
      peer: registration.peer,
      frames, frameIndex: 0, repairCount: 0, unavailableToolCount: 0,
      webToolPrepared,
      promise, resolve: resolveRequest, reject: rejectRequest, timeoutId: null,
      signal, abortListener: null,
    }
    if (signal) {
      operation.abortListener = () => cancelOperation(operation)
      signal.addEventListener('abort', operation.abortListener, { once: true })
    }
    operations.set(key, operation)
    dispatchFrame(operation)
    return promise
  }

  async function complete(message, peer, extensionInstanceId) {
    const key = correlationKey(extensionInstanceId, message.browserSessionId, message.requestId)
    const operation = pending.get(key)
    if (!operation || operation.peer !== peer) throw coded('unknown_browser_request', 'No matching browser request is pending')
    pending.delete(key)
    cancelSchedule(operation.timeoutId)
    const frame = operation.frames[operation.frameIndex]
    if (message.type === 'browser_error') {
      const stableResponse = stableResponseFromTimeout(message.error)
      if (frame?.kind === 'install' && message.error?.code === 'response_timeout') {
        message = {
          ...message,
          type: 'browser_completed',
          payload: { text: JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: frame.requestId, content: 'TETHER_INSTALL_OK' }) },
        }
      } else if (stableResponse !== null) {
        message = { ...message, type: 'browser_completed', payload: { text: stableResponse } }
      } else {
        rejectOperation(operation, coded(message.error?.code ?? 'browser_turn_failed', message.error?.message ?? 'Browser turn failed'))
        return
      }
    }
    try {
      if (frame.kind === 'web_tool_turn' || frame.kind === 'web_tool_retry') {
        const finalized = finalizeWebToolTurn({
          text: message.payload?.text,
          providerId: operation.providerId,
          requestId: operation.requestId,
          prepared: operation.webToolPrepared,
          providerMessageId: message.payload?.providerMessageId ?? null,
        })
        const previousConversation = await stateStore.get(operation.conversationKey)
        await stateStore.set(operation.conversationKey, {
          ...previousConversation,
          browserSessionId: operation.browserSessionId,
          providerConversationId: operation.providerConversationId,
          webToolSession: finalized.sessionState,
          updatedAt: Date.now(),
        })
        if (finalized.retryPrompt) {
          logWebToolStage(logger, 'duplicate_suppressed', {
            sessionId: finalized.sessionState.sessionId,
            browserConversationId: operation.providerConversationId,
            provider: operation.providerId,
            responseHash: finalized.sessionState.lastProcessedResponse,
            duplicates: finalized.duplicateCompleted.length,
            retryCount: finalized.sessionState.retryCount,
          })
          if (frame.kind === 'web_tool_retry' || finalized.sessionState.retryCount > 1) {
            throw coded('duplicate_browser_tool_call', 'Browser repeated an already completed tool call')
          }
          const retryRequestId = `${operation.requestId}.dedupe.1`
          operation.webToolPrepared = {
            ...operation.webToolPrepared,
            deliveredToolResults: [],
            sessionState: finalized.sessionState,
          }
          operation.frames.push({
            requestId: retryRequestId,
            kind: 'web_tool_retry',
            prompt: finalized.retryPrompt,
          })
          operation.frameIndex += 1
          dispatchFrame(operation)
          return
        }
        logWebToolStage(logger, 'completed', {
          sessionId: finalized.sessionState.sessionId,
          browserConversationId: operation.providerConversationId,
          provider: operation.providerId,
          responseHash: finalized.sessionState.lastProcessedResponse,
          outputType: finalized.envelope.type,
          toolCalls: finalized.envelope.calls?.length ?? 0,
          pendingCalls: finalized.sessionState.pendingCalls.length,
          completedCalls: finalized.sessionState.completedCalls.length,
        })
        remember(settled, operation.baseKey, finalized.envelope, maxSettled)
        operations.delete(operation.baseKey)
        cleanupOperation(operation)
        operation.resolve(finalized.envelope)
        return
      }
      let envelope
      try {
        envelope = parseFrameResponse(
          message.payload?.text,
          operation,
          frame,
          frame.kind === 'install' ? [] : operation.codexRequest.tools ?? [],
        )
      } catch (error) {
        if (frame.kind === 'install' && isSubmittedInstallEcho(message.payload?.text, frame.requestId)) {
          // The extension already proved injection and submission. Some React
          // layouts briefly classify the submitted install card as an
          // assistant turn; installation frames are acknowledgements only, so
          // checkpoint delivery without weakening real turn/tool extraction.
          envelope = { schemaVersion: 1, type: 'assistant_text', requestId: frame.requestId, content: 'TETHER_INSTALL_OK' }
        } else
        if (error?.code === 'invalid_tool_schema_request' && frame.kind !== 'install') {
          const maxAttempts = 3
          if (operation.unavailableToolCount < maxAttempts) {
            operation.unavailableToolCount += 1
            queueUnavailableToolFrame(operation, frame, error, maxAttempts)
            return
          }
          const requested = formatToolReferences(error.details?.requestedTools)
          envelope = {
            schemaVersion: 1,
            type: 'assistant_text',
            requestId: frame.requestId,
            content: requested
              ? `The browser model repeatedly requested the unavailable tool ${requested}. Should I install or provide that capability, or continue using only the available tools?`
              : 'The browser model repeatedly requested an unavailable capability. Should I install or provide it, or continue using only the available tools?',
          }
        } else
        if ([
          'invalid_protocol_help_request',
          'invalid_browser_json',
          'invalid_browser_envelope',
        ].includes(error?.code) &&
            frame.kind !== 'install' && operation.repairCount < 1) {
          operation.repairCount += 1
          const repairRequestId = `${operation.requestId}.repair.${operation.repairCount}`
          operation.frames.push({
            requestId: repairRequestId,
            kind: 'repair',
            toolSchemaDelivered: frame.kind === 'schema' || frame.toolSchemaDelivered === true,
            protocolHelpDelivered: frame.kind === 'protocol_help' || frame.protocolHelpDelivered === true,
            prompt: JSON.stringify({
              schemaVersion: 1,
              type: 'tether_protocol_repair',
              requestId: repairRequestId,
              error: error.code === 'invalid_tool_schema_request'
                ? 'The previous tool schema request named a tool that Codex did not offer.'
                : error.code === 'invalid_protocol_help_request'
                  ? 'The previous protocol help request named an unavailable topic.'
                  : 'The previous response was neither a plain-text final answer nor a valid structured TETHER control message.',
              offeredTools: error.details?.offeredTools ?? offeredToolReferences(operation.codexRequest.tools ?? []),
              ...(error.details?.availableTopics ? { availableProtocolHelp: error.details.availableTopics } : {}),
              originalRequestId: frame.requestId,
              originalCommand: frame.prompt,
              ...(error.details?.rawText !== undefined ? { previousResponse: error.details.rawText } : {}),
              instruction: 'Re-evaluate originalCommand using previousResponse only as diagnostic context. Continue the same original objective across automatic tool-result turns. Return a final answer as ordinary plain text only when that objective is complete or progress genuinely requires missing user input. If another tool is needed but originalCommand does not deliver an exact tether_tool_schema, return exactly one minified tool_schema_request JSON object for one offeredTools entry using this repair requestId. If originalCommand delivers tether_tool_schema, return exactly one minified tool_call JSON object matching it and using this repair requestId. JSON-escape strings only inside a JSON control message. Do not quote or copy previousResponse.',
            }),
          })
          operation.frameIndex += 1
          dispatchFrame(operation)
          return
        }
        else throw error
      }
      if (frame.kind === 'install') {
        if (envelope.type !== 'assistant_text' || envelope.content !== 'TETHER_INSTALL_OK') {
          throw coded('invalid_install_ack', 'Browser did not acknowledge the installation frame exactly')
        }
        const acknowledgedConversation = await stateStore.get(operation.conversationKey)
        await stateStore.set(operation.conversationKey, {
          ...acknowledgedConversation,
          browserSessionId: operation.browserSessionId,
          installedInstallKeys: [...new Set([...(acknowledgedConversation?.installedInstallKeys ?? []), frame.installKey])],
          updatedAt: Date.now(),
        })
        operation.frameIndex += 1
        if (operation.frames[operation.frameIndex]?.kind !== 'install') {
          const previousConversation = await stateStore.get(operation.conversationKey)
          const installationState = operation.codexRequest.model === 'tether-compact'
            ? compactInstallationState(operation.codexRequest, { conversation: previousConversation, connectionId: operation.connectionId })
            : {}
          await stateStore.set(operation.conversationKey, {
            ...previousConversation,
            bootstrapInstalled: operation.installBootstrap || previousConversation?.bootstrapInstalled === true,
            bootstrapVersion: operation.installBootstrap ? BOOTSTRAP_VERSION : previousConversation?.bootstrapVersion ?? null,
            browserSessionId: operation.browserSessionId,
            providerConversationId: operation.providerConversationId,
            installedInstallKeys: [],
            ...installationState,
            updatedAt: Date.now(),
          })
        }
        dispatchFrame(operation)
        return
      }
      const toolSchemaDelivered = frame.kind === 'schema' || frame.toolSchemaDelivered === true
      const protocolHelpDelivered = frame.kind === 'protocol_help' || frame.protocolHelpDelivered === true
      if (envelope.type === 'tool_call' && operation.codexRequest.model === 'tether-compact' && !toolSchemaDelivered) {
        queueToolSchemaFrame(operation, frame, [{
          ...(envelope.namespace ? { namespace: envelope.namespace } : {}),
          name: envelope.name,
        }])
        return
      }
      if (envelope.type === 'tool_schema_request') {
        if (toolSchemaDelivered) throw coded('repeated_tool_schema_request', 'Browser requested another schema after exact schema delivery')
        queueToolSchemaFrame(operation, frame, envelope.tools)
        return
      }
      if (envelope.type === 'protocol_help_request') {
        if (protocolHelpDelivered) {
          throw coded('repeated_protocol_help_request', 'Browser requested protocol help again after exact documentation delivery')
        }
        queueProtocolHelpFrame(operation, frame, envelope.topics)
        return
      }
      if (
        envelope.type === 'assistant_text' &&
        operation.codexRequest.model === 'tether-compact' &&
        frame.kind !== 'completion_check' &&
        (operation.codexRequest.input ?? []).some(isToolResult)
      ) {
        queueCompletionCheckFrame(operation, frame, envelope.content)
        return
      }
      const previousConversation = await stateStore.get(operation.conversationKey)
      const compactState = operation.codexRequest.model === 'tether-compact'
        ? compactProjectionState(operation.codexRequest, { conversation: previousConversation, connectionId: operation.connectionId })
        : {}
      const installsBootstrap = operation.codexRequest.model !== 'tether-smoke' && operation.installBootstrap
      await stateStore.set(operation.conversationKey, {
        bootstrapInstalled: installsBootstrap || previousConversation?.bootstrapInstalled === true,
        bootstrapVersion: installsBootstrap ? BOOTSTRAP_VERSION : previousConversation?.bootstrapVersion ?? null,
        browserSessionId: operation.browserSessionId,
        providerConversationId: operation.providerConversationId,
        lastRequestId: operation.requestId,
        ...compactState,
        installedInstallKeys: [],
        updatedAt: Date.now(),
      })
      remember(settled, operation.baseKey, envelope, maxSettled)
      operations.delete(operation.baseKey)
      cleanupOperation(operation)
      operation.resolve(envelope)
    } catch (error) {
      rejectOperation(operation, error)
    }
  }

  function disconnect(peer) {
    for (const [key, operation] of operations) {
      if (operation.peer !== peer) continue
      rejectOperation(operation, coded('extension_disconnected', 'Extension disconnected during browser turn'))
    }
  }

  function dispatchFrame(operation) {
    const frame = operation.frames[operation.frameIndex]
    if (!frame) return rejectOperation(operation, coded('missing_browser_frame', 'Browser request frame is missing'))
    const frameKey = correlationKey(operation.extensionInstanceId, operation.browserSessionId, frame.requestId)
    operation.key = frameKey
    const operationTimeoutMs = browserFrameTimeoutMs({
      model: operation.codexRequest.model,
      frame,
      timeoutMs,
      bootstrapTimeoutMs,
    })
    operation.timeoutId = schedule(() => {
      if (pending.get(frameKey) !== operation) return
      pending.delete(frameKey)
      try {
        operation.peer.sendJson({
          protocol: EXTENSION_PROTOCOL, version: EXTENSION_PROTOCOL_VERSION, type: 'browser_cancel',
          requestId: frame.requestId, browserSessionId: operation.browserSessionId,
        })
      } catch (error) { void error }
      rejectOperation(operation, coded('browser_turn_timeout', 'Browser turn timed out'))
    }, operationTimeoutMs)
    pending.set(frameKey, operation)
    operation.peer.sendJson({
      protocol: EXTENSION_PROTOCOL, version: EXTENSION_PROTOCOL_VERSION, type: 'browser_request',
      requestId: frame.requestId, browserSessionId: operation.browserSessionId,
      payload: { prompt: frame.prompt, installBootstrap: operation.installBootstrap && operation.frameIndex === 0 },
    })
  }

  function queueToolSchemaFrame(operation, sourceFrame, requestedTools) {
    const definitions = selectDeferredToolDefinitions(operation.codexRequest.tools ?? [], requestedTools)
    const schemaRequestId = `${operation.requestId}.schema.0`
    const prompt = buildDeferredToolSchemaPrompt({
      requestId: schemaRequestId,
      originalRequestId: operation.requestId,
      definitions,
    })
    if (prompt.length > 60000) throw coded('deferred_tool_schema_too_large', 'Selected tool schema exceeds the browser message limit')
    operation.frames.push({
      requestId: schemaRequestId,
      kind: 'schema',
      protocolHelpDelivered:
        sourceFrame.kind === 'protocol_help' || sourceFrame.protocolHelpDelivered === true,
      prompt,
    })
    operation.frameIndex += 1
    dispatchFrame(operation)
  }

  function queueProtocolHelpFrame(operation, sourceFrame, topics) {
    const helpRequestId = `${operation.requestId}.docs.0`
    const prompt = buildProtocolHelpPrompt({
      requestId: helpRequestId,
      originalRequestId: sourceFrame.requestId,
      originalCommand: sourceFrame.prompt,
      topics,
    })
    if (prompt.length > 60_000) {
      throw coded('protocol_help_too_large', 'Selected protocol documentation exceeds the browser message limit')
    }
    operation.frames.push({
      requestId: helpRequestId,
      kind: 'protocol_help',
      toolSchemaDelivered: sourceFrame.kind === 'schema' || sourceFrame.toolSchemaDelivered === true,
      protocolHelpDelivered: true,
      prompt,
    })
    operation.frameIndex += 1
    dispatchFrame(operation)
  }

  function queueCompletionCheckFrame(operation, sourceFrame, candidateAnswer) {
    const completionRequestId = `${operation.requestId}.complete.0`
    const prompt = buildCompletionCheckPrompt({
      requestId: completionRequestId,
      originalRequestId: operation.requestId,
      candidateAnswer,
      offeredTools: offeredToolReferences(operation.codexRequest.tools ?? []),
    })
    if (prompt.length > 60_000) throw coded('completion_check_too_large', 'Completion check exceeds the browser message limit')
    operation.frames.push({
      requestId: completionRequestId,
      kind: 'completion_check',
      toolSchemaDelivered: sourceFrame.kind === 'schema' || sourceFrame.toolSchemaDelivered === true,
      protocolHelpDelivered: sourceFrame.kind === 'protocol_help' || sourceFrame.protocolHelpDelivered === true,
      prompt,
    })
    operation.frameIndex += 1
    dispatchFrame(operation)
  }

  function queueUnavailableToolFrame(operation, sourceFrame, error, maxAttempts) {
    const unavailableRequestId = `${operation.requestId}.tool-unavailable.${operation.unavailableToolCount}`
    const originalFrame = operation.frames.find((candidate) => candidate.kind === 'turn') ?? sourceFrame
    const prompt = buildUnavailableToolPrompt({
      requestId: unavailableRequestId,
      originalRequestId: operation.requestId,
      originalCommand: originalFrame.prompt,
      requestedTools: error.details?.requestedTools ?? null,
      offeredTools: error.details?.offeredTools ?? offeredToolReferences(operation.codexRequest.tools ?? []),
      attempt: operation.unavailableToolCount,
      maxAttempts,
    })
    if (prompt.length > 60_000) throw coded('unavailable_tool_recovery_too_large', 'Unavailable-tool recovery exceeds the browser message limit')
    operation.frames.push({
      requestId: unavailableRequestId,
      kind: 'tool_unavailable',
      toolSchemaDelivered: sourceFrame.kind === 'schema' || sourceFrame.toolSchemaDelivered === true,
      protocolHelpDelivered: sourceFrame.kind === 'protocol_help' || sourceFrame.protocolHelpDelivered === true,
      prompt,
    })
    operation.frameIndex += 1
    dispatchFrame(operation)
  }

  function rejectOperation(operation, error) {
    if (!operations.has(operation.baseKey)) return
    operations.delete(operation.baseKey)
    if (operation.key) pending.delete(operation.key)
    if (operation.timeoutId !== null) cancelSchedule(operation.timeoutId)
    cleanupOperation(operation)
    operation.reject(error)
  }

  function cancelOperation(operation) {
    if (!operations.has(operation.baseKey)) return
    if (operation.key) pending.delete(operation.key)
    if (operation.timeoutId !== null) cancelSchedule(operation.timeoutId)
    try {
      operation.peer.sendJson({
        protocol: EXTENSION_PROTOCOL,
        version: EXTENSION_PROTOCOL_VERSION,
        type: 'browser_cancel',
        requestId: operation.frames[operation.frameIndex]?.requestId ?? operation.requestId,
        browserSessionId: operation.browserSessionId,
      })
    } catch (error) { void error }
    rejectOperation(operation, coded('request_cancelled', 'Request was cancelled'))
  }

  function cleanupOperation(operation) {
    if (operation.signal && operation.abortListener) {
      operation.signal.removeEventListener('abort', operation.abortListener)
      operation.abortListener = null
    }
  }

  return { request, complete, disconnect }
}

function isSubmittedInstallEcho(value, requestId) {
  const text = String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  return text.includes(requestId) && /"type"\s*:\s*"tether_install"/.test(text)
}

function stableResponseFromTimeout(error) {
  if (error?.code !== 'response_timeout') return null
  const match = String(error.message ?? '').match(/\((\{"rootConnected"[\s\S]*\})\)$/)
  if (!match) return null
  try {
    const diagnostic = JSON.parse(match[1])
    return typeof diagnostic.lastTextPreview === 'string' &&
      diagnostic.lastTextPreview.length > 0 &&
      diagnostic.lastTextLength === diagnostic.lastTextPreview.length
      ? diagnostic.lastTextPreview
      : null
  } catch {
    return null
  }
}

export function browserFrameTimeoutMs({ model, frame, timeoutMs, bootstrapTimeoutMs }) {
  const largeCompactFrame = model === 'tether-compact' && (frame.kind === 'install' || frame.prompt.length > 16_384)
  return largeCompactFrame ? bootstrapTimeoutMs : timeoutMs
}

function isToolResult(item) {
  return ['function_call_output', 'custom_tool_call_output', 'computer_call_output'].includes(item?.type)
}

function parseFrameResponse(text, operation, frame, offeredTools) {
  const requestIds = frame.kind === 'schema'
    ? [frame.requestId, operation.requestId]
    : [frame.requestId]
  let lastError
  for (const requestId of new Set(requestIds)) {
    try {
      return parseBrowserResponse(text, requestId, offeredTools)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function resolveConversationState({ registration, session, stateStore }) {
  const prefix = [
    registration.extensionInstanceId,
    session.origin,
    session.providerId,
  ]
  const fallbackKey = JSON.stringify([...prefix, session.browserSessionId])
  if (!session.conversationId) {
    const fallback = await stateStore.get(fallbackKey)
    if (!fallback?.migratedToConversationId) {
      return { conversationKey: fallbackKey, conversation: fallback }
    }
    const fresh = {
      browserSessionId: session.browserSessionId,
      providerConversationId: null,
      updatedAt: Date.now(),
    }
    await stateStore.set(fallbackKey, fresh)
    return { conversationKey: fallbackKey, conversation: fresh }
  }

  const conversationKey = JSON.stringify([...prefix, session.conversationId])
  const conversation = await stateStore.get(conversationKey)
  if (conversation) return { conversationKey, conversation }

  const fallback = await stateStore.get(fallbackKey)
  if (!canMigrateFallback(fallback, session)) {
    return { conversationKey, conversation: null }
  }

  const migrated = {
    ...fallback,
    providerConversationId: session.conversationId,
    updatedAt: Date.now(),
  }
  await stateStore.set(conversationKey, migrated)
  await stateStore.set(fallbackKey, {
    ...fallback,
    migratedToConversationId: session.conversationId,
    updatedAt: Date.now(),
  })
  return { conversationKey, conversation: migrated }
}

function canMigrateFallback(fallback, session) {
  return Boolean(
    fallback &&
    fallback.browserSessionId === session.browserSessionId &&
    (!fallback.providerConversationId || fallback.providerConversationId === session.conversationId) &&
    (!fallback.migratedToConversationId || fallback.migratedToConversationId === session.conversationId),
  )
}

export function codexRequestId(request, connectionId = null) {
  const identity = JSON.stringify({
    connectionId,
    turnId: request.client_metadata?.turn_id ?? null,
    previousResponseId: request.previous_response_id ?? null,
    input: request.input,
  })
  return `tether-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`
}

function correlationKey(extensionInstanceId, browserSessionId, requestId) {
  return `${extensionInstanceId}\u0000${browserSessionId}\u0000${requestId}`
}

function remember(map, key, value, limit) {
  map.set(key, value)
  while (map.size > limit) map.delete(map.keys().next().value)
}

function logWebToolStage(logger, stage, details) {
  logger.info?.(JSON.stringify({
    component: 'tether-web-tool-bridge',
    stage,
    ...details,
  }))
}

function offeredToolReferences(tools) {
  return tools.flatMap((tool) => tool?.type === 'namespace'
    ? (tool.tools ?? []).map((child) => ({ namespace: tool.name, name: child.name }))
    : tool?.name ? [{ name: tool.name }] : [])
}

function formatToolReferences(tools) {
  if (!Array.isArray(tools)) return ''
  const names = tools
    .filter((tool) => tool && typeof tool.name === 'string')
    .map((tool) => JSON.stringify(tool.namespace ? `${tool.namespace}.${tool.name}` : tool.name))
  return names.join(', ')
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
