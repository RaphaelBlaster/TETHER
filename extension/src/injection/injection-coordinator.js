export const MAX_TEST_MESSAGE_LENGTH = 1000000

export class InjectionCoordinatorError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'InjectionCoordinatorError'
    this.code = code
  }
}

export function createInjectionCoordinator({
  sendTabMessage,
  publish = () => {},
  timeoutMs = 12000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
}) {
  const activeBySession = new Map()
  const settledBySession = new Map()
  const latestBySession = new Map()

  function start({ requestId, session, profile, text }) {
    validateRequest({ requestId, session, profile, text })
    const active = activeBySession.get(session.browserSessionId)
    if (active) {
      if (active.requestId === requestId) return active.promise
      return Promise.reject(new InjectionCoordinatorError('session_busy', 'This browser session is already injecting a test message'))
    }
    const settled = settledBySession.get(session.browserSessionId)
    if (settled?.requestId === requestId) {
      return settled.ok ? Promise.resolve(settled.value) : Promise.reject(settled.error)
    }

    let cancelOperation
    let cancellationRequested = false
    const cancellation = new Promise((_, reject) => {
      cancelOperation = (reason = 'cancelled') => {
        if (cancellationRequested) return
        cancellationRequested = true
        sendTabMessage(session.tabId, { type: 'injection.cancel', requestId }).catch(() => {})
        reject(new InjectionCoordinatorError(reason, readableCancellation(reason)))
      }
    })
    let timeout
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimer(() => {
        sendTabMessage(session.tabId, { type: 'injection.cancel', requestId }).catch(() => {})
        reject(new InjectionCoordinatorError('injection_timeout', 'Test-message injection timed out'))
      }, timeoutMs)
    })

    const state = {
      requestId,
      browserSessionId: session.browserSessionId,
      tabId: session.tabId,
      origin: session.origin,
      stage: 'injecting',
      startedAt: now(),
    }
    publish(state)
    latestBySession.set(session.browserSessionId, state)

    const execution = sendTabMessage(session.tabId, {
      type: 'injection.execute',
      requestId,
      browserSessionId: session.browserSessionId,
      origin: session.origin,
      profile,
      text,
    }).then((response) => {
      if (!response?.ok) {
        throw new InjectionCoordinatorError(response?.code ?? 'injection_failed', response?.error ?? 'Test-message injection failed')
      }
      return { ...state, stage: 'complete', result: response.result }
    })

    const promise = Promise.race([execution, cancellation, timeoutPromise]).then(
      (result) => {
        settledBySession.set(session.browserSessionId, { requestId, ok: true, value: result })
        latestBySession.set(session.browserSessionId, result)
        publish(result)
        return result
      },
      (error) => {
        const normalized = error instanceof InjectionCoordinatorError
          ? error
          : new InjectionCoordinatorError('injection_failed', error instanceof Error ? error.message : String(error))
        settledBySession.set(session.browserSessionId, { requestId, ok: false, error: normalized })
        const failedState = { ...state, stage: normalized.code === 'cancelled' ? 'cancelled' : 'failed', error: normalized.message }
        latestBySession.set(session.browserSessionId, failedState)
        publish(failedState)
        throw normalized
      },
    ).finally(() => {
      clearTimer(timeout)
      if (activeBySession.get(session.browserSessionId)?.requestId === requestId) {
        activeBySession.delete(session.browserSessionId)
      }
    })

    activeBySession.set(session.browserSessionId, { ...state, promise, cancel: cancelOperation })
    return promise
  }

  function cancelBySessionId(browserSessionId, reason = 'cancelled') {
    const active = activeBySession.get(browserSessionId)
    if (!active) return false
    active.cancel(reason)
    return true
  }

  function cancelByTabId(tabId, reason = 'cancelled') {
    for (const active of activeBySession.values()) {
      if (active.tabId === tabId) active.cancel(reason)
    }
  }

  function getByTabId(tabId) {
    const active = [...activeBySession.values()].find((candidate) => candidate.tabId === tabId)
    if (!active) return null
    return {
      requestId: active.requestId,
      browserSessionId: active.browserSessionId,
      tabId: active.tabId,
      origin: active.origin,
      stage: active.stage,
      startedAt: active.startedAt,
    }
  }

  function getBySessionId(browserSessionId) {
    return latestBySession.get(browserSessionId) ?? null
  }

  return { start, cancelBySessionId, cancelByTabId, getByTabId, getBySessionId }
}

function validateRequest({ requestId, session, profile, text }) {
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    throw new InjectionCoordinatorError('invalid_request_id', 'A valid injection request ID is required')
  }
  if (!session?.browserSessionId || !Number.isInteger(session.tabId) || !session.origin) {
    throw new InjectionCoordinatorError('invalid_session', 'A valid activated browser session is required')
  }
  if (!profile || profile.origin !== session.origin || profile.version !== 1) {
    throw new InjectionCoordinatorError('calibration_mismatch', 'The calibration profile does not belong to this browser session')
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new InjectionCoordinatorError('empty_text', 'Enter a plain-text test message')
  }
  if (text.length > MAX_TEST_MESSAGE_LENGTH) {
    throw new InjectionCoordinatorError('text_too_large', `Test message exceeds ${MAX_TEST_MESSAGE_LENGTH} characters`)
  }
}

function readableCancellation(reason) {
  if (reason === 'tab_closed') return 'The owning browser tab was closed'
  if (reason === 'tab_navigated') return 'The owning browser tab navigated'
  if (reason === 'session_deactivated') return 'TETHER was deactivated for the owning tab'
  return 'Test-message injection was cancelled'
}
