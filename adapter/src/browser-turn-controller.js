import { createHash } from 'node:crypto'
import { EXTENSION_PROTOCOL, EXTENSION_PROTOCOL_VERSION } from './extension-session-registry.js'
import { BOOTSTRAP_VERSION, buildBrowserPromptSequence, buildDeferredToolSchemaPrompt } from './browser-prompt.js'
import { parseBrowserResponse } from './browser-envelope.js'
import { compactInstallationState, compactProjectionState, selectDeferredToolDefinitions } from './compact-request.js'

export function createBrowserTurnController({
  registry,
  stateStore,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  timeoutMs = 120000,
  bootstrapTimeoutMs = 300000,
  maxSettled = 128,
} = {}) {
  const pending = new Map()
  const operations = new Map()
  const settled = new Map()

  async function request(codexRequest, { connectionId = null, selection = null } = {}) {
    const { registration, session } = selection ?? registry.selectExactlyOne()
    const requestId = codexRequestId(codexRequest, connectionId)
    const key = correlationKey(registration.extensionInstanceId, session.browserSessionId, requestId)
    if (settled.has(key)) return settled.get(key)
    if (operations.has(key)) return operations.get(key).promise

    const conversationKey = JSON.stringify([
      registration.extensionInstanceId,
      session.origin,
      session.providerId,
      session.conversationId ?? session.browserSessionId,
    ])
    const conversation = await stateStore.get(conversationKey)
    const installBootstrap = conversation?.bootstrapVersion !== BOOTSTRAP_VERSION
    const frames = buildBrowserPromptSequence({ requestId, request: codexRequest, installBootstrap, conversation, connectionId })
    let resolveRequest
    let rejectRequest
    const promise = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject })
    const operation = {
      key: null, baseKey: key, requestId, conversationKey, installBootstrap, codexRequest, connectionId,
      extensionInstanceId: registration.extensionInstanceId,
      browserSessionId: session.browserSessionId,
      peer: registration.peer,
      frames, frameIndex: 0, repairCount: 0,
      promise, resolve: resolveRequest, reject: rejectRequest, timeoutId: null,
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
      let envelope
      try {
        envelope = parseBrowserResponse(message.payload?.text, frame.requestId, frame.kind === 'install' ? [] : operation.codexRequest.tools ?? [])
      } catch (error) {
        if (frame.kind === 'install' && isSubmittedInstallEcho(message.payload?.text, frame.requestId)) {
          // The extension already proved injection and submission. Some React
          // layouts briefly classify the submitted install card as an
          // assistant turn; installation frames are acknowledgements only, so
          // checkpoint delivery without weakening real turn/tool extraction.
          envelope = { schemaVersion: 1, type: 'assistant_text', requestId: frame.requestId, content: 'TETHER_INSTALL_OK' }
        } else
        if (['invalid_tool_schema_request', 'invalid_browser_json', 'invalid_browser_envelope'].includes(error?.code) &&
            frame.kind !== 'install' && operation.repairCount < 1) {
          operation.repairCount += 1
          const repairRequestId = `${operation.requestId}.repair.${operation.repairCount}`
          operation.frames.push({
            requestId: repairRequestId,
            kind: 'repair',
            prompt: JSON.stringify({
              schemaVersion: 1,
              type: 'tether_protocol_repair',
              requestId: repairRequestId,
              error: error.code === 'invalid_tool_schema_request'
                ? 'The previous tool schema request named a tool that Codex did not offer.'
                : 'The previous response did not use the required TETHER JSON envelope.',
              offeredTools: error.details?.offeredTools ?? [],
              originalRequestId: frame.requestId,
              originalCommand: frame.prompt,
              ...(error.details?.rawText !== undefined ? { previousResponse: error.details.rawText } : {}),
              instruction: error.details?.rawText !== undefined
                ? 'Return exactly one assistant_text JSON object. Set content to previousResponse exactly, preserving all text and newlines. Do not add prose or markdown.'
                : 'Re-evaluate originalCommand now. Follow its user turn and response contract. Return assistant_text when no offered tool is required. Otherwise request exactly one tool from offeredTools. Use this repair requestId in the response. Do not invent, rename, or omit a namespace.',
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
            installedInstallKeys: [],
            ...installationState,
            updatedAt: Date.now(),
          })
        }
        dispatchFrame(operation)
        return
      }
      if (envelope.type === 'tool_schema_request') {
        if (frame.kind === 'schema') throw coded('repeated_tool_schema_request', 'Browser requested another schema after exact schema delivery')
        const definitions = selectDeferredToolDefinitions(operation.codexRequest.tools ?? [], envelope.tools)
        const schemaRequestId = `${operation.requestId}.schema.0`
        const prompt = buildDeferredToolSchemaPrompt({
          requestId: schemaRequestId,
          originalRequestId: operation.requestId,
          definitions,
        })
        if (prompt.length > 60000) throw coded('deferred_tool_schema_too_large', 'Selected tool schema exceeds the browser message limit')
        operation.frames.push({ requestId: schemaRequestId, kind: 'schema', prompt })
        operation.frameIndex += 1
        dispatchFrame(operation)
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
        lastRequestId: operation.requestId,
        lastDeliveredBrowserDelta: operation.codexRequest.input,
        ...compactState,
        installedInstallKeys: [],
        updatedAt: Date.now(),
      })
      remember(settled, operation.baseKey, envelope, maxSettled)
      operations.delete(operation.baseKey)
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

  function rejectOperation(operation, error) {
    if (!operations.has(operation.baseKey)) return
    operations.delete(operation.baseKey)
    if (operation.key) pending.delete(operation.key)
    if (operation.timeoutId !== null) cancelSchedule(operation.timeoutId)
    operation.reject(error)
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

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
