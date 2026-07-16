import { resolveCalibrationControls } from '../calibration/profile-validation.js'
import { readEditorText, writeEditorTextIncrementally } from './editor-writer.js'
import { assertSendActionable, findSubmissionRoot, verifySubmission } from './submission-verifier.js'

export class InjectionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'InjectionError'
    this.code = code
  }
}

export async function executePlainTextInjection({
  document,
  profile,
  text,
  signal,
  postWriteDelayMs = 1000,
  waitTimeoutMs = 2500,
  submissionTimeoutMs = 8000,
}) {
  const initial = resolveCalibrationControls(document, profile)
  if (!initial.validation.valid) {
    throw new InjectionError('calibration_invalid', `Calibrated controls are unavailable: ${initial.validation.code}`)
  }

  let write
  try {
    write = await writeEditorTextIncrementally(initial.composer, text, {
      document,
      window: document.defaultView,
    })
  } catch (error) {
    throw tagInjectionStage(error, 'write')
  }
  let final
  try {
    await waitAfterWrite(document.defaultView, postWriteDelayMs, signal)
    final = await waitForReadyControls({ document, profile, signal, timeoutMs: waitTimeoutMs })
  } catch (error) {
    throw tagInjectionStage(error, 'resolve_send')
  }
  if (readEditorText(final.composer).length === 0) {
    throw new InjectionError('input_changed', 'The calibrated composer was cleared before submission')
  }
  assertSendActionable(final.send)

  let evidence
  try {
    evidence = await verifySubmission({
      root: findSubmissionRoot(final.composer),
      composer: final.composer,
      send: final.send,
      expectedText: text,
      signal,
      timeoutMs: submissionTimeoutMs,
      MutationObserver: document.defaultView?.MutationObserver,
      scheduleFrame: document.defaultView?.requestAnimationFrame?.bind(document.defaultView),
      cancelFrame: document.defaultView?.cancelAnimationFrame?.bind(document.defaultView),
    })
  } catch (error) {
    throw tagInjectionStage(error, 'submit_and_verify')
  }
  return { strategy: write.strategy, evidence }
}

function tagInjectionStage(error, stage) {
  const normalized = error instanceof Error ? error : new Error(String(error))
  normalized.tetherStage = stage
  return normalized
}

async function waitForReadyControls({ document, profile, signal, timeoutMs }) {
  const startedAt = Date.now()
  let diagnostic = {
    validation: 'not_checked',
    composerRetained: false,
    sendResolved: false,
    actionability: 'not_checked',
  }
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new InjectionError('cancelled', 'Test-message injection was cancelled')
    const resolved = resolveCalibrationControls(document, profile)
    const composerRetained = Boolean(resolved.composer) && readEditorText(resolved.composer).length > 0
    const contextual = composerRetained && !resolved.send
      ? findContextualSend(resolved.composer, profile.send)
      : { element: null, candidateCounts: [] }
    const contextualSend = contextual.element
    const send = resolved.send ?? contextualSend
    diagnostic = {
      validation: resolved.validation.code,
      composerRetained,
      sendResolved: Boolean(send),
      sendResolution: contextualSend ? 'contextual_unique' : resolved.send ? 'fingerprint' : 'missing',
      contextualCandidateCounts: contextual.candidateCounts,
      actionability: send ? 'unchecked' : 'send_missing',
    }
    if ((resolved.validation.valid || contextualSend) && composerRetained) {
      try {
        assertSendActionable(send)
        return { ...resolved, send }
      } catch (error) {
        diagnostic.actionability = error?.code ?? error?.message ?? 'rejected'
        // The editor framework may enable Send on its next render.
      }
    }
    await nextFrame(document.defaultView)
  }
  throw new InjectionError(
    'send_not_ready',
    `The page did not make the calibrated Send control ready (${JSON.stringify(diagnostic)})`,
  )
}

export function resolveContextualSend(composer, sendFingerprint) {
  return findContextualSend(composer, sendFingerprint).element
}

function findContextualSend(composer, sendFingerprint) {
  const candidateCounts = []
  for (const scope of contextualScopes(composer)) {
    const candidates = [...scope.querySelectorAll('button, [role="button"], input[type="submit"]')].filter((element) => {
    if (element === composer || !element?.isConnected) return false
    if (sendFingerprint?.tagName && element.tagName?.toLowerCase() !== sendFingerprint.tagName) return false
    const semantic = [
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('name'),
      element.getAttribute?.('type'),
      element.id,
      element.textContent,
    ].filter(Boolean).join(' ').toLowerCase()
    if (!/(?:^|[-_\s])(send|submit)(?:$|[-_\s])/.test(semantic)) return false
    try { return assertSendActionable(element) }
    catch { return false }
    })
    candidateCounts.push(candidates.length)
    if (candidates.length === 1) return { element: candidates[0], candidateCounts }
    if (candidates.length > 1) return { element: null, candidateCounts }
  }
  return { element: null, candidateCounts }
}

function contextualScopes(composer) {
  const scopes = []
  const add = (scope) => {
    if (scope?.querySelectorAll && !scopes.includes(scope)) scopes.push(scope)
  }
  add(composer?.closest?.('form'))
  let ancestor = composer?.parentElement
  for (let depth = 0; ancestor && depth < 8; depth += 1) {
    add(ancestor)
    if (['BODY', 'HTML'].includes(ancestor.tagName)) break
    ancestor = ancestor.parentElement
  }
  add(findSubmissionRoot(composer))
  add(composer?.ownerDocument)
  return scopes
}

function nextFrame(window) {
  return new Promise((resolve) => {
    const schedule = window?.requestAnimationFrame?.bind(window) ?? ((callback) => setTimeout(callback, 16))
    schedule(resolve)
  })
}

function waitAfterWrite(window, delayMs, signal) {
  if (delayMs <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const setTimer = window?.setTimeout?.bind(window) ?? setTimeout
    const clearTimer = window?.clearTimeout?.bind(window) ?? clearTimeout
    let timer = setTimer(() => {
      timer = null
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      if (timer != null) clearTimer(timer)
      reject(new InjectionError('cancelled', 'Test-message injection was cancelled'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}
