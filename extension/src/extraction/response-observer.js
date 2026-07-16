import { resolveFingerprint } from '../calibration/element-fingerprint.js'
import { assertSendActionable } from '../injection/submission-verifier.js'

export class ExtractionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ExtractionError'
    this.code = code
  }
}

export function observeNextAssistantResponse({
  document,
  responseCalibration,
  sendFingerprint,
  composerFingerprint,
  expectedPrompt,
  signal,
  stableMs = 6000,
  completionStableMs = 500,
  maxCompletionGateMs = 15000,
  sendPollMs = 250,
  timeoutMs = 90000,
  MutationObserver = document.defaultView?.MutationObserver,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let root = resolveFingerprint(document, responseCalibration.conversationRoot).element
  if (!root) throw new ExtractionError('conversation_root_missing', 'The calibrated conversation root is unavailable')
  const baseline = new Set(resolveTurns(root, responseCalibration.assistantTurn))
  const baselineTextCounts = countTurnTexts([...baseline], responseCalibration.assistantContent, root)
  const normalizedPrompt = normalize(expectedPrompt)
  const correlatedRequestId = requestIdFromPrompt(expectedPrompt)
  let correlatedText = ''
  let observer
  let stableTimer
  let sendPollTimer
  let timeoutTimer
  let candidate = null
  let lastText = ''
  let textStableSince = 0
  let settled = false
  let sendActionable = readSendActionable(document, sendFingerprint)
  let generationStateObserved = false
  let sendControlRestored = false
  const controlRoot = resolveControlRoot(document, composerFingerprint, sendFingerprint)
  const initialControlState = readControlState(controlRoot)
  let controlStateDiverged = false
  let controlStateRestored = false
  let generationControlActive = hasGenerationControl(controlRoot)
  let generationControlObserved = generationControlActive
  let generationControlRestored = false

  const promise = new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (settled) return
      settled = true
      observer?.disconnect()
      clearTimer(stableTimer)
      clearTimer(sendPollTimer)
      clearTimer(timeoutTimer)
      signal?.removeEventListener?.('abort', onAbort)
      if (error) reject(error)
      else resolve(value)
    }
    const scheduleStable = (delay = stableMs) => {
      clearTimer(stableTimer)
      stableTimer = setTimer(() => {
        updateSendState()
        updateControlState()
        const text = currentResponseText()
        if (!text || text !== lastText) {
          lastText = text
          textStableSince = Date.now()
          scheduleStable()
          return
        }
        if (isIncompleteJson(text) && Date.now() - textStableSince < maxCompletionGateMs) {
          scheduleStable()
          return
        }
        if (
          generationControlActive ||
          (generationStateObserved && !sendControlRestored)
        ) {
          if (Date.now() - textStableSince < maxCompletionGateMs) {
            scheduleStable()
            return
          }
        }
        const completionSignals = ['new_assistant_turn', 'text_stable']
        if (sendControlRestored) completionSignals.push('send_control_restored')
        if (controlStateRestored) completionSignals.push('composer_controls_restored')
        if (generationControlRestored) completionSignals.push('generation_control_restored')
        if (generationControlActive || (generationStateObserved && !sendControlRestored)) {
          completionSignals.push('bounded_stability_fallback')
        }
        finish(null, { text, completionSignals })
      }, delay)
    }
    const updateSendState = () => {
      if (!sendFingerprint) return false
      const current = readSendActionable(document, sendFingerprint)
      if (sendActionable && !current) generationStateObserved = true
      const restored = generationStateObserved && !sendActionable && current
      sendActionable = current
      if (restored) sendControlRestored = true
      if (restored && candidate) scheduleStable(completionStableMs)
      return current
    }
    const updateControlState = () => {
      if (!controlRoot) return false
      const current = readControlState(controlRoot)
      if (current !== initialControlState) controlStateDiverged = true
      const restored = controlStateDiverged && current === initialControlState
      if (restored && !controlStateRestored && candidate) scheduleStable(completionStableMs)
      controlStateRestored = restored
      const currentGenerationControl = hasGenerationControl(controlRoot)
      if (currentGenerationControl) generationControlObserved = true
      const generationRestored = generationControlObserved && generationControlActive && !currentGenerationControl
      generationControlActive = currentGenerationControl
      if (generationRestored) {
        generationControlRestored = true
        if (candidate) scheduleStable(completionStableMs)
      }
      return restored
    }
    const pollSendState = () => {
      if (settled) return
      updateSendState()
      updateControlState()
      sendPollTimer = setTimer(pollSendState, sendPollMs)
    }
    const inspect = (records = []) => {
      const currentRoot = resolveFingerprint(document, responseCalibration.conversationRoot).element
      if (!currentRoot) return
      root = currentRoot
      const turns = resolveTurns(root, responseCalibration.assistantTurn, records)
      const seenTextCounts = new Map()
      const newTurns = turns.filter((turn) => {
        const text = normalize(extractContent(turn, responseCalibration.assistantContent, root))
        const occurrence = (seenTextCounts.get(text) ?? 0) + 1
        seenTextCounts.set(text, occurrence)
        if (baseline.has(turn)) return false
        if (occurrence <= (baselineTextCounts.get(text) ?? 0)) return false
        return text && text !== normalizedPrompt &&
          !isSubmittedPromptTurn(turn, normalizedPrompt) &&
          !containsProtocolCommand(readableSource(turn), correlatedRequestId)
      })
      const correlated = correlatedRequestId
        ? newTurns.flatMap((turn) => correlatedEnvelopes(readableSource(turn), correlatedRequestId)).at(-1)
        : null
      if (correlated && turns.length > baseline.size) {
        const nextText = JSON.stringify(correlated)
        if (nextText !== correlatedText) {
          correlatedText = nextText
          lastText = nextText
          textStableSince = Date.now()
          scheduleStable(generationStateObserved && sendActionable ? completionStableMs : stableMs)
        }
        return
      }
      candidate = newTurns.at(-1) ?? candidate
      if (!candidate) return
      const text = extractContent(candidate, responseCalibration.assistantContent, root)
      if (!text) return
      if (text !== lastText) {
        lastText = text
        textStableSince = Date.now()
        scheduleStable(generationStateObserved && sendActionable ? completionStableMs : stableMs)
      }
    }
    const currentResponseText = () => {
      if (correlatedRequestId && correlatedText) return correlatedText
      return extractContent(candidate, responseCalibration.assistantContent, root)
    }
    const onAbort = () => finish(new ExtractionError('cancelled', 'Response extraction was cancelled'))
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted) return onAbort()
    observer = new MutationObserver(inspect)
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true, characterData: true })
    if (sendFingerprint || controlRoot) sendPollTimer = setTimer(pollSendState, sendPollMs)
    timeoutTimer = setTimer(() => {
      const turnCount = root?.isConnected === false ? 0 : resolveTurns(root, responseCalibration.assistantTurn).length
      const diagnostic = {
        rootConnected: root?.isConnected !== false,
        turnCount,
        baselineCount: baseline.size,
        candidateFound: Boolean(candidate),
        lastTextLength: lastText.length,
        lastTextPreview: lastText.length > 240 ? `${lastText.slice(0, 237)}...` : lastText,
        generationControlActive,
        generationStateObserved,
        sendActionable,
        sendControlRestored,
      }
      finish(new ExtractionError('response_timeout', `No completed assistant response was observed (${JSON.stringify(diagnostic)})`))
    }, timeoutMs)
  })
  return { promise, cancel: () => signal?.dispatchEvent?.(new Event('abort')) }
}

function requestIdFromPrompt(value) {
  const match = String(value ?? '').match(/"requestId"\s*:\s*"([^"\\]{1,128})"/)
  return match?.[1] ?? null
}

function correlatedEnvelopes(value, requestId) {
  const matches = []
  for (const parsed of topLevelJsonValues(value)) collectCorrelated(parsed, requestId, matches)
  return matches
}

function containsProtocolCommand(value, requestId) {
  if (!requestId) return false
  return topLevelJsonValues(value).some((parsed) => parsed && !Array.isArray(parsed) &&
    parsed.requestId === requestId &&
    ['codex_turn', 'codex_delta', 'tether_install', 'tether_tool_schema', 'tether_protocol_repair'].includes(parsed.type))
}

function collectCorrelated(value, requestId, matches) {
  if (!value || typeof value !== 'object') return
  if (!Array.isArray(value) && value.requestId === requestId &&
      ['assistant_text', 'tool_call', 'tool_schema_request'].includes(value.type)) matches.push(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) collectCorrelated(child, requestId, matches)
}

function topLevelJsonValues(value) {
  // Rich chat renderers may insert zero-width word-break characters into long
  // machine-readable tokens. They are presentation artifacts, not response
  // data, and make otherwise valid JSON fail JSON.parse().
  const text = stripBrowserFormatting(value)
  const values = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue
    const opening = text[start]
    const closing = opening === '{' ? '}' : ']'
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
      else if (character === opening) depth += 1
      else if (character === closing && --depth === 0) {
        try { values.push(JSON.parse(text.slice(start, end + 1))) } catch { /* Ignore non-JSON browser text. */ }
        start = end
        break
      }
    }
  }
  return values
}

function stripBrowserFormatting(value) {
  return String(value ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
}

function countTurnTexts(turns, contentFingerprint, root) {
  const counts = new Map()
  for (const turn of turns) {
    const text = normalize(extractContent(turn, contentFingerprint, root))
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  return counts
}

function isSubmittedPromptTurn(turn, prompt) {
  if (!prompt) return false
  const turnText = normalize(turn?.innerText ?? turn?.textContent)
  // Provider wrappers can temporarily expose the entire conversation as one
  // calibrated "turn" while React is inserting the submitted prompt. Never
  // accept any candidate still containing that exact prompt; a correlated
  // assistant envelope is handled before this fallback filter.
  return turnText.includes(prompt)
}

function resolveTurns(root, fingerprint) {
  if (fingerprint.resolution === 'content_ancestor') {
    return [...root.querySelectorAll(fingerprint.tagName)].filter((element) =>
      Object.entries(fingerprint.attributes ?? {}).every(([name, value]) => element.getAttribute?.(name) === value))
  }
  try { return [...root.querySelectorAll(fingerprint.primarySelector)] }
  catch { return [] }
}

function extractContent(turn, fingerprint, conversationRoot = null) {
  if (!turn) return ''
  let elements
  if (fingerprint.resolution === 'relative_path') {
    let element = turn
    for (const step of fingerprint.path ?? []) {
      element = [...(element?.children ?? [])].filter((child) => child.tagName?.toLowerCase() === step.tagName)[step.sameTagIndex]
      if (!element) return ''
    }
    elements = [element]
  } else {
    try { elements = [...turn.querySelectorAll(fingerprint.primarySelector)] }
    catch { return '' }
  }
  if (!elements?.length) return readableText(turn)
  const region = responseRegion(turn, elements)
  const regionText = readableText(region)
  if (isIncompleteJson(regionText)) {
    const turnText = readableText(turn)
    if (turnText.length > regionText.length) return turnText
    for (let ancestor = turn.parentElement; ancestor && ancestor !== conversationRoot; ancestor = ancestor.parentElement) {
      const ancestorText = readableText(ancestor)
      if (ancestorText.length > regionText.length) return ancestorText
    }
  }
  return regionText
}

function responseRegion(turn, elements) {
  if (elements.length > 1) return lowestCommonAncestor(elements) ?? elements[0]
  const element = elements[0]
  return element.parentElement && element.parentElement !== turn ? element.parentElement : element
}

function lowestCommonAncestor(elements) {
  for (let candidate = elements[0]; candidate; candidate = candidate.parentElement) {
    if (elements.every((element) => candidate.contains?.(element))) return candidate
  }
  return null
}

function readSendActionable(document, fingerprint) {
  if (!fingerprint) return false
  const element = resolveFingerprint(document, fingerprint, { allowAncestorDrift: true }).element
  try { return assertSendActionable(element) }
  catch { return false }
}

function resolveControlRoot(document, composerFingerprint, sendFingerprint) {
  const composer = composerFingerprint ? resolveFingerprint(document, composerFingerprint, { allowAncestorDrift: true }).element : null
  const send = sendFingerprint ? resolveFingerprint(document, sendFingerprint, { allowAncestorDrift: true }).element : null
  return composer?.closest?.('form') ?? lowestCommonAncestor([composer, send].filter(Boolean)) ?? composer?.parentElement ?? null
}

function readControlState(root) {
  if (!root) return ''
  let controls
  try { controls = [...root.querySelectorAll('button, [role="button"], input[type="submit"]')] }
  catch { return '' }
  return controls.map((element) => [
    element.tagName?.toLowerCase(),
    element.getAttribute?.('type') ?? '',
    element.getAttribute?.('role') ?? '',
    element.getAttribute?.('aria-label') ?? '',
    element.getAttribute?.('data-testid') ?? '',
    element.getAttribute?.('title') ?? '',
    element.disabled ? 'disabled' : 'enabled',
  ].join('|')).sort().join('\n')
}

function hasGenerationControl(root) {
  if (!root) return false
  let controls
  try { controls = [...root.querySelectorAll('button, [role="button"], input[type="submit"]')] }
  catch { return false }
  return controls.some((element) => {
    const label = [
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('title'),
      element.textContent,
    ].filter(Boolean).join(' ').toLowerCase()
    return /\b(stop|cancel)\b/.test(label) && /\b(generat|stream|respond|response)\w*/.test(label)
  })
}

function normalize(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function isIncompleteJson(value) {
  const text = String(value).trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return false
  try {
    JSON.parse(text)
    return false
  } catch {
    return true
  }
}

function readableText(element) {
  return String(element?.innerText ?? element?.textContent ?? '').replace(/\u00a0/g, ' ').trim()
}

function readableSource(element) {
  return String(element?.textContent ?? element?.innerText ?? '').replace(/\u00a0/g, ' ').trim()
}
