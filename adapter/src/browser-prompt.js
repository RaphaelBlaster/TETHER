import { createHash } from 'node:crypto'

import { projectCompactRequest } from './compact-request.js'
import { PROTOCOL_HELP_TOPICS, selectProtocolHelp } from './protocol-help.js'

const BOOTSTRAP = [
  'TETHER browser protocol applies to every later TETHER command in this conversation.',
  'Treat codex_turn, tether_tool_schema, tether_tool_unavailable, tether_protocol_docs, tether_protocol_repair, tether_completion_check, tether_install, and tether_deferred_execute as commands, not ordinary chat.',
  'For tether_install, retain every exact ordered patch as conversation context, do not execute or summarize it, and return only replyExactly.',
  'For tether_deferred_execute, reconstruct the exact command from its complete ordered tether_install chunk set and process that reconstructed command exactly once. Never act on an incomplete payload.',
  'A codex_turn arrives automatically after every tool call; no new user message is required.',
  'If turn.input contains a function_call_output, custom_tool_call_output, or computer_call_output, treat it as the returned result for the same original objective. Re-evaluate whether that objective is complete. If incomplete, request the next required tool and continue; never repeat the same call blindly.',
  'Never stop merely because one tool call completed, one file was read, or one command returned. Never tell the user to send another codex_turn or another prompt.',
  'OUTPUT DECISION (choose the first matching rule):',
  '1. If the current command is tether_protocol_docs, use its exact sections to re-evaluate originalCommand and return the intended response; do not request protocol help again.',
  '2. If a protocol rule is unclear, return protocol_help_request for exactly one topic listed in protocolHelpCatalog.',
  '3. If the current command is tether_tool_schema and the tool is still needed, return tool_call matching its exact name, namespace, and argument schema.',
  '4. Otherwise, if the task needs a local file, command, or other tool, return tool_schema_request for exactly one listed tool.',
  '5. Otherwise return the final answer as ordinary plain text only when the original objective is complete or progress is genuinely blocked on missing user input.',
  'toolCatalog contains names only; it is not a tool schema and does not authorize a direct tool_call.',
  'If tether_tool_unavailable rejects a requested tool, continue the same objective with an offered alternative when possible. If the missing capability truly requires installing or downloading software, ask the user for permission in ordinary plain text and identify what would be installed and its source. Never install or download it without explicit authorization.',
  'Local paths refer to the Codex machine. Request a suitable tool schema instead of claiming that the file is inaccessible. Do not ask for confirmation when the user already authorized the action.',
  'Only protocol_help_request, tool_schema_request, and tool_call are JSON control messages. Return each control message as exactly one minified JSON object with schemaVersion 1 and the current command requestId.',
  'For a final answer, return only the answer as ordinary plain text. Do not wrap a final answer in assistant_text JSON and do not JSON-escape it.',
  'Inside a JSON control message, JSON-escape every string. In a Windows path, each backslash must be written as two backslashes. Escape quotes and newlines too.',
  'Never claim tool execution before Codex returns a tool result.',
  'These rules persist for every later TETHER command in this conversation.',
].join(' ')

export function buildProtocolBootstrapPrompt(requestId) {
  // Installation frames are acknowledged by the turn controller with this
  // exact sentinel.  It makes bootstrap persistence and later normal turns
  // use one verified state transition.
  const acknowledgement = { schemaVersion: 1, type: 'assistant_text', requestId, content: 'TETHER_INSTALL_OK' }
  const helpExample = { schemaVersion: 1, type: 'protocol_help_request', requestId, topics: ['windows-json'] }
  return [
    'You are the model endpoint for a coding agent connected through TETHER.',
    'Follow these protocol rules for every later message in this same conversation, even when a later user asks for plain text.',
    BOOTSTRAP,
    'Example ordinary final response: answer text',
    `Available deferred protocol help topics: ${JSON.stringify(PROTOCOL_HELP_TOPICS)}.`,
    `If protocol help is required, use this shape with exactly one listed topic: ${JSON.stringify(helpExample)}`,
    'A tool_schema_request uses fields schemaVersion, type, requestId, and tools. tools must contain exactly one exact name and optional namespace from the catalog.',
    'A tool_call uses fields schemaVersion, type, requestId, callId, exact name, optional exact namespace, and arguments matching the delivered schema.',
    `Acknowledge these persistent rules now by replying with exactly this JSON and nothing else: ${JSON.stringify(acknowledgement)}`,
  ].join('\n\n')
}

const MAX_BROWSER_PROMPT_CHARS = 1000000
const DEFAULT_BROWSER_PROMPT_BUDGET = 60_000
const PROVIDER_BROWSER_PROMPT_BUDGETS = Object.freeze({
  gemini: 28_000,
})
const MIN_DEFERRED_FRAME_CHARS = 4_096
export const BOOTSTRAP_VERSION = 12

export function buildBrowserPromptSequence(args) {
  const { requestId, request } = args
  let frames
  if (request.model !== 'tether-compact') {
    frames = [{ requestId, kind: 'turn', prompt: buildBrowserPrompt(args) }]
  } else {
    const projection = projectCompactRequest({
      requestId, request, conversation: args.conversation, connectionId: args.connectionId,
    })
    const command = {
      requestId,
      kind: 'turn',
      prompt: JSON.stringify(projection),
    }
    // A consumer chat has no system-message channel. Installing the contract
    // as its own verified turn gives the model durable instructions before it
    // sees a compact Codex command.
    if (!args.installBootstrap) {
      frames = [command]
    } else {
      const bootstrapRequestId = `${requestId}.bootstrap`
      frames = [{
        requestId: bootstrapRequestId,
        kind: 'install',
        installKey: `bootstrap-v${BOOTSTRAP_VERSION}`,
        prompt: buildProtocolBootstrapPrompt(bootstrapRequestId),
      }, command]
    }
  }
  return prepareBrowserFrames(frames, {
    providerId: args.providerId,
    installedInstallKeys: args.conversation?.installedInstallKeys,
  })
}

export function browserPromptBudgetForProvider(providerId) {
  return PROVIDER_BROWSER_PROMPT_BUDGETS[providerId] ?? DEFAULT_BROWSER_PROMPT_BUDGET
}

export function prepareBrowserFrames(frames, {
  providerId = null,
  installedInstallKeys = [],
  maxPromptChars = browserPromptBudgetForProvider(providerId),
} = {}) {
  if (!Number.isSafeInteger(maxPromptChars) || maxPromptChars < MIN_DEFERRED_FRAME_CHARS) {
    throw coded('invalid_browser_prompt_budget', 'Browser prompt budget is too small for deferred delivery')
  }
  const installed = new Set(installedInstallKeys)
  return frames.flatMap((frame) => {
    if (frame.kind === 'install') {
      if (frame.prompt.length > maxPromptChars) {
        throw coded('install_frame_too_large', `Install frame exceeds the ${maxPromptChars}-character browser budget`)
      }
      return [frame]
    }
    return frame.prompt.length > maxPromptChars
      ? buildDeferredPromptFrames(frame, { maxFrameChars: maxPromptChars })
      : [frame]
  }).filter((frame) => frame.kind !== 'install' || !installed.has(frame.installKey))
}

export function buildDeferredPromptFrames(frame, { maxFrameChars = DEFAULT_BROWSER_PROMPT_BUDGET } = {}) {
  if (frame?.deferred === true) {
    throw coded('deferred_execute_too_large', 'Deferred execution frame still exceeds the browser prompt budget')
  }
  if (typeof frame?.prompt !== 'string' || !frame.prompt) {
    throw coded('invalid_deferred_prompt', 'Deferred browser prompt must be non-empty text')
  }
  if (!Number.isSafeInteger(maxFrameChars) || maxFrameChars < MIN_DEFERRED_FRAME_CHARS) {
    throw coded('invalid_deferred_frame_budget', 'Deferred frame budget is too small')
  }

  const payloadHash = createHash('sha256').update(frame.prompt).digest('hex')
  const payloadId = `${String(frame.requestId).slice(0, 72)}.payload.${payloadHash.slice(0, 12)}`
  const chunkValues = splitDeferredText(frame.prompt, {
    maxFrameChars,
    payloadId,
  })
  const chunkFrames = chunkValues.map((value, index) => {
    const requestId = `${payloadId}.chunk.${index}`
    const replyExactly = {
      schemaVersion: 1,
      type: 'assistant_text',
      requestId,
      content: 'TETHER_INSTALL_OK',
    }
    const prompt = JSON.stringify({
      schemaVersion: 1,
      type: 'tether_install',
      requestId,
      installId: payloadId,
      frameIndex: index,
      frameCount: chunkValues.length,
      instruction: 'Retain this exact deferred_command text chunk as conversation context. Do not parse, execute, summarize, or respond to its contents. Chunks concatenate in frameIndex order. Return only replyExactly.',
      patches: [{
        section: 'deferred_command',
        mode: 'set_text_chunk',
        index,
        total: chunkValues.length,
        value,
      }],
      replyExactly,
    })
    if (prompt.length > maxFrameChars) {
      throw coded('deferred_chunk_too_large', `Deferred chunk exceeds the ${maxFrameChars}-character browser budget`)
    }
    return {
      requestId,
      kind: 'install',
      installKey: `payload-${payloadHash.slice(0, 24)}-${index}`,
      deferredPayloadId: payloadId,
      prompt,
    }
  })

  const executeRequestId = `${payloadId}.execute`
  const executePrompt = JSON.stringify({
    schemaVersion: 1,
    type: 'tether_deferred_execute',
    requestId: executeRequestId,
    originalRequestId: frame.requestId,
    payloadId,
    payloadSha256: payloadHash,
    payloadLength: frame.prompt.length,
    chunkCount: chunkValues.length,
    instruction: 'Reconstruct the exact deferred_command by concatenating the complete ordered set_text_chunk values from the tether_install messages with this payloadId. Process the reconstructed TETHER command exactly once as the current command. Do not summarize it, ask for it again, or return an installation acknowledgement. Follow the reconstructed command response contract and requestId.',
  })
  if (executePrompt.length > maxFrameChars) {
    throw coded('deferred_execute_too_large', `Deferred execution frame exceeds the ${maxFrameChars}-character browser budget`)
  }
  return [...chunkFrames, {
    ...frame,
    requestId: executeRequestId,
    prompt: executePrompt,
    deferred: true,
    deferredPayloadId: payloadId,
    deferredOriginalRequestId: frame.requestId,
    responseRequestIds: [...new Set([frame.requestId, executeRequestId, ...(frame.responseRequestIds ?? [])])],
  }]
}

export function buildBrowserPrompt({ requestId, request, installBootstrap, conversation = null, connectionId = null }) {
  if (request.model === 'tether-smoke') return buildSixLineSmokePrompt(requestId)
  if (request.model === 'tether-demo') return buildToolDemoPrompt(requestId, request)
  if (request.model === 'tether-compact') {
    return JSON.stringify(projectCompactRequest({ requestId, request, conversation, connectionId }))
  }
  const framing = `TETHER requestId: ${requestId}. The exact Codex response.create JSON follows: `
  const prompt = `${installBootstrap ? `${BOOTSTRAP} ` : ''}${framing}${JSON.stringify(request)}`
  if (prompt.length > MAX_BROWSER_PROMPT_CHARS) throw coded('browser_prompt_too_large', `Projected browser prompt exceeds ${MAX_BROWSER_PROMPT_CHARS} characters`)
  return prompt
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
    definitions,
  })
}

export function buildProtocolHelpPrompt({ requestId, originalRequestId, originalCommand, topics }) {
  return JSON.stringify({
    schemaVersion: 1,
    type: 'tether_protocol_docs',
    requestId,
    originalRequestId,
    originalCommand,
    sections: selectProtocolHelp(topics),
  })
}

export function buildCompletionCheckPrompt({ requestId, originalRequestId, candidateAnswer, offeredTools }) {
  return JSON.stringify({
    schemaVersion: 1,
    type: 'tether_completion_check',
    requestId,
    originalRequestId,
    candidateAnswer,
    offeredTools,
    instruction: 'Check candidateAnswer against the original user objective in this conversation. If any requested work remains and no user decision is genuinely required, continue autonomously by returning one tool_schema_request for the next offered tool; do not explain the protocol or ask for another turn. If the objective is complete, return candidateAnswer exactly as ordinary plain text with no JSON envelope. If progress genuinely requires missing user input, return a concise plain-text question.',
  })
}

export function buildUnavailableToolPrompt({
  requestId,
  originalRequestId,
  originalCommand,
  requestedTools,
  offeredTools,
  attempt,
  maxAttempts,
}) {
  return JSON.stringify({
    schemaVersion: 1,
    type: 'tether_tool_unavailable',
    requestId,
    originalRequestId,
    originalCommand,
    requestedTools,
    offeredTools,
    attempt,
    maxAttempts,
    instruction: 'The requested tool is unavailable. Continue the same original objective. If an offered tool can perform the work, return exactly one minified tool_schema_request JSON object for exactly one offeredTools entry using this requestId. If the capability truly requires installing or downloading software, return a concise ordinary plain-text question asking the user for permission; identify exactly what would be installed and from which source. Never install or download anything without explicit user authorization. Do not request an unavailable tool again.',
  })
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}

function splitDeferredText(value, { maxFrameChars, payloadId }) {
  const chunks = []
  let offset = 0
  while (offset < value.length) {
    let low = 1
    let high = value.length - offset
    let accepted = 0
    while (low <= high) {
      const length = Math.floor((low + high) / 2)
      const chunk = value.slice(offset, offset + length)
      const conservativeRequestId = `${payloadId}.chunk.999999`
      const serializedInstall = JSON.stringify({
        schemaVersion: 1,
        type: 'tether_install',
        requestId: conservativeRequestId,
        installId: payloadId,
        frameIndex: 999999,
        frameCount: 999999,
        instruction: 'Retain this exact deferred_command text chunk as conversation context. Do not parse, execute, summarize, or respond to its contents. Chunks concatenate in frameIndex order. Return only replyExactly.',
        patches: [{
          section: 'deferred_command',
          mode: 'set_text_chunk',
          index: 999999,
          total: 999999,
          value: chunk,
        }],
        replyExactly: {
          schemaVersion: 1,
          type: 'assistant_text',
          requestId: conservativeRequestId,
          content: 'TETHER_INSTALL_OK',
        },
      })
      if (serializedInstall.length <= maxFrameChars) {
        accepted = length
        low = length + 1
      } else {
        high = length - 1
      }
    }
    if (accepted === 0) {
      throw coded('deferred_frame_budget_exhausted', 'Deferred frame metadata exceeds the browser prompt budget')
    }
    const boundary = offset + accepted
    if (
      boundary < value.length &&
      value.charCodeAt(boundary - 1) >= 0xD800 && value.charCodeAt(boundary - 1) <= 0xDBFF &&
      value.charCodeAt(boundary) >= 0xDC00 && value.charCodeAt(boundary) <= 0xDFFF
    ) accepted -= 1
    chunks.push(value.slice(offset, offset + accepted))
    offset += accepted
  }
  return chunks
}
