export class MarkerCaptureError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MarkerCaptureError'
    this.code = code
  }
}

export function startMarkerCapture({
  root,
  marker,
  prompt,
  signal,
  timeoutMs = 60000,
  stableMs = 600,
  MutationObserver = root?.ownerDocument?.defaultView?.MutationObserver ?? globalThis.MutationObserver,
  scheduleFrame = root?.ownerDocument?.defaultView?.requestAnimationFrame?.bind(root.ownerDocument.defaultView) ??
    ((callback) => setTimeout(callback, 16)),
  cancelFrame = root?.ownerDocument?.defaultView?.cancelAnimationFrame?.bind(root.ownerDocument.defaultView) ?? clearTimeout,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let observer
  let timeout
  let stableTimer
  let frame
  let settled = false
  let candidate = null
  let rejectCapture
  let onAbort

  const cleanup = () => {
    observer?.disconnect()
    if (timeout != null) clearTimer(timeout)
    if (stableTimer != null) clearTimer(stableTimer)
    if (frame != null) cancelFrame(frame)
    signal?.removeEventListener?.('abort', onAbort)
  }

  const promise = new Promise((resolve, reject) => {
    rejectCapture = reject
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const complete = () => {
      const finalCandidate = findSmallestExactText(root, marker)
      if (settled || !finalCandidate?.isConnected) return
      candidate = finalCandidate
      const userContent = findSmallestExactText(root, prompt)
      settled = true
      cleanup()
      resolve({ marker, prompt, content: candidate, userContent })
    }
    const scheduleStableCheck = () => {
      if (stableTimer != null) clearTimer(stableTimer)
      stableTimer = setTimer(complete, stableMs)
    }
    const inspect = () => {
      const next = findSmallestExactText(root, marker)
      if (!next) return
      candidate = next
      scheduleStableCheck()
    }
    const scheduleInspect = () => {
      if (frame != null) return
      frame = scheduleFrame(() => {
        frame = null
        inspect()
      })
    }
    onAbort = () => fail(new MarkerCaptureError('cancelled', 'Response calibration was cancelled'))
    signal?.addEventListener?.('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    observer = new MutationObserver(scheduleInspect)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    timeout = setTimer(
      () => fail(new MarkerCaptureError('response_timeout', `The page did not produce ${marker} in time`)),
      timeoutMs,
    )
    inspect()
  })

  return {
    promise,
    cancel(reason = 'Response capture was cancelled') {
      if (settled) return
      settled = true
      cleanup()
      rejectCapture(new MarkerCaptureError('cancelled', reason))
    },
  }
}

export function findSmallestExactText(root, expected) {
  const normalizedExpected = normalize(expected)
  const matches = []
  for (const element of root.querySelectorAll('*')) {
    if (normalize(element.textContent) === normalizedExpected) matches.push(element)
  }
  return matches.find((element) => !matches.some((other) => other !== element && element.contains(other))) ?? null
}

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
