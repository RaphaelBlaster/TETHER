import { inspectCalibrationProfile, isResponseCalibration } from '../calibration/profile-schema.js'

export const ACTIVE_RESPONSE_CALIBRATIONS_KEY = 'activeResponseCalibrations'
const ACTIVE_STAGES = new Set(['starting', 'injecting_marker', 'waiting_for_marker', 'marker_captured', 'inferring_structure', 'manual_selection_required', 'manual_selecting_turn'])

export function createResponseCalibrationSession({
  injectContentScript,
  sendTabMessage,
  loadProfiles,
  saveProfiles,
  loadActiveOperations = async () => ({}),
  saveActiveOperations = async () => {},
  getPageState = async () => null,
  publish = () => {},
}) {
  const states = new Map()

  async function persist() {
    const active = {}
    for (const [sessionId, state] of states) {
      if (ACTIVE_STAGES.has(state.stage)) active[sessionId] = storedState(state)
    }
    await saveActiveOperations(active)
  }

  async function setState(sessionId, patch) {
    const state = { ...(states.get(sessionId) ?? idleState(sessionId)), ...patch }
    states.set(sessionId, state)
    publish(publicState(state))
    await persist()
    return state
  }

  async function start({ requestId, session, profile }) {
    validateStart({ requestId, session, profile })
    const existing = states.get(session.browserSessionId)
    if (existing && ACTIVE_STAGES.has(existing.stage)) {
      if (existing.requestId === requestId) return existing
      throw coded('session_busy', 'This browser session is already calibrating responses')
    }
    await setState(session.browserSessionId, {
      stage: 'starting',
      requestId,
      browserSessionId: session.browserSessionId,
      tabId: session.tabId,
      origin: session.origin,
      turn: 0,
      totalTurns: 3,
      startedAt: Date.now(),
      error: null,
    })
    try {
      await injectContentScript(session.tabId)
      const response = await sendTabMessage(session.tabId, {
        type: 'responseCalibration.start',
        requestId,
        browserSessionId: session.browserSessionId,
        origin: session.origin,
        profile,
      })
      if (!response?.ok) throw coded(response?.code ?? 'start_failed', response?.error ?? 'Response calibration could not start')
      return states.get(session.browserSessionId)
    } catch (error) {
      await setState(session.browserSessionId, terminal('failed', error))
      throw error
    }
  }

  async function handlePageState(message, senderTabId) {
    const state = states.get(message.browserSessionId)
    if (!state || state.tabId !== senderTabId || state.requestId !== message.requestId) return null
    if (message.stage === 'complete') {
      if (!isResponseCalibration(message.responseCalibration)) {
        return setState(state.browserSessionId, terminal('failed', coded('invalid_result', 'The page returned invalid response calibration')))
      }
      const profiles = await loadProfiles()
      const current = profiles[state.origin]
      if (inspectCalibrationProfile(current, state.origin).code !== 'stored') {
        return setState(state.browserSessionId, terminal('failed', coded('profile_changed', 'The control calibration changed during response calibration')))
      }
      const updated = { ...current, responseCalibration: message.responseCalibration }
      await saveProfiles({ ...profiles, [state.origin]: updated })
      return setState(state.browserSessionId, {
        ...terminal('complete'),
        responseCalibration: message.responseCalibration,
      })
    }
    if (message.stage === 'failed' || message.stage === 'cancelled') {
      return setState(state.browserSessionId, terminal(message.stage, coded(message.code, message.error)))
    }
    if (ACTIVE_STAGES.has(message.stage)) {
      return setState(state.browserSessionId, {
        stage: message.stage,
        turn: message.turn ?? state.turn,
        totalTurns: 3,
        error: null,
      })
    }
    return state
  }

  async function cancel(browserSessionId, reason = 'cancelled') {
    const state = states.get(browserSessionId)
    if (!state || !ACTIVE_STAGES.has(state.stage)) return false
    await sendTabMessage(state.tabId, { type: 'responseCalibration.cancel', requestId: state.requestId }).catch(() => {})
    await setState(browserSessionId, terminal('cancelled', coded(reason, cancellationMessage(reason))))
    return true
  }

  async function startManualSelection(browserSessionId) {
    const state = states.get(browserSessionId)
    if (!state || state.stage !== 'manual_selection_required') throw coded('manual_selection_unavailable', 'No guided response calibration is waiting in this tab')
    const response = await sendTabMessage(state.tabId, { type: 'responseCalibration.manualSelect', requestId: state.requestId })
    if (!response?.ok) throw coded(response?.code ?? 'manual_selection_failed', response?.error ?? 'Guided response selection could not start')
    return setState(browserSessionId, { stage: 'manual_selecting_turn', error: null })
  }

  async function restore() {
    const stored = await loadActiveOperations()
    for (const state of Object.values(stored ?? {})) {
      if (!validStoredState(state)) continue
      states.set(state.browserSessionId, state)
      try {
        const page = await getPageState(state.tabId)
        if (page?.requestId === state.requestId && page.browserSessionId === state.browserSessionId) {
          await handlePageState(page, state.tabId)
        } else {
          await setState(state.browserSessionId, terminal('failed', coded('restart_lost', 'Response calibration could not be recovered')))
        }
      } catch {
        await setState(state.browserSessionId, terminal('failed', coded('tab_unavailable', 'The response-calibration tab is unavailable')))
      }
    }
    await persist()
  }

  function cancelByTabId(tabId, reason) {
    return Promise.all([...states.values()].filter((state) => state.tabId === tabId).map((state) => cancel(state.browserSessionId, reason)))
  }

  return {
    start,
    startManualSelection,
    cancel,
    restore,
    handlePageState,
    cancelByTabId,
    getBySessionId: (id) => states.has(id) ? publicState(states.get(id)) : null,
  }
}

function validateStart({ requestId, session, profile }) {
  if (typeof requestId !== 'string' || !requestId || requestId.length > 128) throw coded('invalid_request_id', 'A valid request ID is required')
  if (!session?.browserSessionId || !Number.isInteger(session.tabId)) throw coded('invalid_session', 'An activated browser session is required')
  if (inspectCalibrationProfile(profile, session.origin).code !== 'stored') throw coded('invalid_profile', 'Valid control calibration is required')
}

function idleState(browserSessionId) {
  return { browserSessionId, stage: 'idle', requestId: null, tabId: null, origin: null, turn: 0, totalTurns: 3, error: null }
}

function terminal(stage, error = null) {
  return { stage, requestId: null, startedAt: null, error: error?.message ?? null, code: error?.code ?? null }
}

function storedState(state) {
  return {
    stage: state.stage,
    requestId: state.requestId,
    browserSessionId: state.browserSessionId,
    tabId: state.tabId,
    origin: state.origin,
    turn: state.turn,
    totalTurns: state.totalTurns,
    startedAt: state.startedAt,
    error: state.error,
    code: state.code ?? null,
  }
}

function publicState(state) {
  return {
    stage: state.stage,
    turn: state.turn,
    totalTurns: state.totalTurns,
    error: state.error,
    code: state.code ?? null,
  }
}

function validStoredState(state) {
  return Boolean(state?.browserSessionId && Number.isInteger(state.tabId) && typeof state.requestId === 'string' && ACTIVE_STAGES.has(state.stage))
}

function coded(code = 'response_calibration_failed', message = 'Response calibration failed') {
  return Object.assign(new Error(message), { code })
}

function cancellationMessage(reason) {
  if (reason === 'tab_closed') return 'The owning browser tab was closed'
  if (reason === 'tab_navigated') return 'The owning browser tab navigated'
  if (reason === 'session_deactivated') return 'TETHER was deactivated for this tab'
  return 'Response calibration was cancelled'
}
