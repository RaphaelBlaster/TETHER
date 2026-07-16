import { readEditorText } from './editor-writer.js'

export class SubmissionError extends Error {
  constructor(code, message, evidence = null) {
    super(message)
    this.name = 'SubmissionError'
    this.code = code
    this.evidence = evidence
  }
}

export function assertSendActionable(element, { window = element?.ownerDocument?.defaultView } = {}) {
  if (!element?.isConnected) throw new SubmissionError('send_disconnected', 'The calibrated Send control is no longer connected')
  const style = window?.getComputedStyle?.(element)
  const rect = element.getBoundingClientRect?.()
  if (
    style?.display === 'none' ||
    style?.visibility === 'hidden' ||
    style?.opacity === '0' ||
    (rect && (rect.width <= 0 || rect.height <= 0))
  ) {
    throw new SubmissionError('send_hidden', 'The calibrated Send control is not visible')
  }
  if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
    throw new SubmissionError('send_disabled', 'The calibrated Send control is disabled')
  }
  return true
}

export function findSubmissionRoot(composer) {
  const semanticRoot = composer.closest?.('main, [role="main"]')
  if (semanticRoot) return semanticRoot
  let candidate = composer.parentElement
  for (let depth = 0; candidate?.parentElement && depth < 4; depth += 1) {
    if (['BODY', 'HTML'].includes(candidate.parentElement.tagName)) break
    candidate = candidate.parentElement
  }
  return candidate ?? composer.parentElement ?? composer
}

export function verifySubmission({
  root,
  composer,
  send,
  expectedText,
  signal,
  timeoutMs = 8000,
  MutationObserver = globalThis.MutationObserver,
  scheduleFrame = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 16)),
  cancelFrame = globalThis.cancelAnimationFrame ?? clearTimeout,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  assertSendActionable(send)
  const normalizedExpected = normalize(expectedText)
  const initialSendActionable = sendActionable(send)
  let userTurnAppeared = false
  let clickCount = 0
  let observer
  let frame
  let timer
  let settled = false

  return new Promise((resolve, reject) => {
    const finish = (error, evidence) => {
      if (settled) return
      settled = true
      observer?.disconnect()
      if (frame != null) cancelFrame(frame)
      if (timer != null) clearTimer(timer)
      signal?.removeEventListener?.('abort', onAbort)
      if (error) reject(error)
      else resolve(evidence)
    }

    const evidence = () => {
      const composerChanged = composer.isConnected === false || normalize(readEditorText(composer)) !== normalizedExpected
      const sendChanged = sendActionable(send) !== initialSendActionable
      return { composerChanged, sendChanged, userTurnAppeared, clickCount }
    }

    const evaluate = () => {
      if (settled) return
      const current = evidence()
      if (
        (current.userTurnAppeared && (current.composerChanged || current.sendChanged)) ||
        (current.composerChanged && current.sendChanged)
      ) {
        finish(null, current)
        return
      }
      if (frame == null) {
        frame = scheduleFrame(() => {
          frame = null
          evaluate()
        })
      }
    }

    const onAbort = () => finish(new SubmissionError('cancelled', 'Submission verification was cancelled', evidence()))
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes ?? []) {
          if (node === composer || composer.contains?.(node) || node.contains?.(composer)) continue
          if (normalize(node.textContent ?? '').includes(normalizedExpected)) userTurnAppeared = true
        }
      }
      evaluate()
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'data-state'],
    })

    timer = setTimer(() => {
      const current = evidence()
      finish(new SubmissionError(
        'submission_timeout',
        'The page did not provide enough evidence that the test message was submitted',
        current,
      ))
    }, timeoutMs)

    clickCount += 1
    send.click()
    evaluate()
  })
}

function sendActionable(send) {
  try {
    return assertSendActionable(send)
  } catch {
    return false
  }
}

function normalize(value) {
  return String(value).replaceAll('\r\n', '\n').replaceAll('\u00a0', ' ').trim()
}
