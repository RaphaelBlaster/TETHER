import { inspectCalibrationProfile } from './profile-schema.js'

export const CALIBRATION_STORAGE_KEY = 'calibrationProfiles'
export const ACTIVE_CALIBRATION_KEY = 'activeCalibration'

const ACTIVE_STAGES = ['starting', 'selecting_composer', 'selecting_send', 'validating_new_profile']
const STARTABLE_STAGES = ['idle', 'complete', 'cancelled', 'failed']

export function createCalibrationSession({
  injectContentScript,
  sendTabMessage,
  loadProfiles,
  saveProfiles,
  loadActiveOperation = async () => null,
  saveActiveOperation = async () => {},
  clearActiveOperation = async () => {},
  getPageState = async () => null,
  publish = () => {},
}) {
  let state = idleState()

  async function setState(patch) {
    state = { ...state, ...patch }
    publish(state)
    if (ACTIVE_STAGES.includes(state.stage)) {
      await saveActiveOperation({
        requestId: state.requestId,
        tabId: state.tabId,
        origin: state.origin,
        mode: state.mode,
        startedAt: state.startedAt,
        stage: state.stage,
      })
    } else {
      await clearActiveOperation()
    }
    return state
  }

  async function restore() {
    const active = await loadActiveOperation()
    if (!isStoredOperation(active)) {
      await clearActiveOperation()
      return state
    }
    state = { ...idleState(), ...active, error: null }
    publish(state)
    try {
      const page = await getPageState(active.tabId)
      if (
        !page?.active ||
        page.requestId !== active.requestId ||
        !['selecting_composer', 'selecting_send'].includes(page.stage)
      ) {
        return setState({ ...terminalPatch('failed'), error: 'Calibration could not be recovered after worker restart' })
      }
      return setState({ stage: page.stage, error: null })
    } catch {
      return setState({ ...terminalPatch('failed'), error: 'Calibration page is no longer available' })
    }
  }

  async function start({ requestId, tab, origin, mode = 'replace' }) {
    validateStart({ requestId, tab, origin, mode })
    if (ACTIVE_STAGES.includes(state.stage)) {
      if (state.tabId === tab.id) return state
      throw new Error('Another calibration is already active in a different tab')
    }
    if (!STARTABLE_STAGES.includes(state.stage)) throw new Error('Calibration cannot start from its current state')

    try {
      await setState({
        stage: 'starting',
        requestId,
        tabId: tab.id,
        origin,
        mode,
        startedAt: Date.now(),
        error: null,
        profile: null,
      })
      await injectContentScript(tab.id)
      const response = await sendTabMessage(tab.id, { type: 'calibration.start', requestId, origin, mode })
      if (!response?.ok) throw new Error(response?.error ?? 'The page integration could not be started')
      return setState({ stage: 'selecting_composer', error: null })
    } catch (error) {
      await setState({ ...terminalPatch('failed'), error: readableError(error) })
      throw error
    }
  }

  async function cancel(requestId = state.requestId) {
    const { tabId } = state
    if (Number.isInteger(tabId)) {
      await sendTabMessage(tabId, { type: 'calibration.cancel', requestId }).catch(() => {})
    }
    return setState({ ...terminalPatch('cancelled'), error: null })
  }

  async function handlePageState(message, senderTabId) {
    if (senderTabId !== state.tabId || message.requestId !== state.requestId) return state
    if (message.stage === 'complete') {
      await setState({ stage: 'validating_new_profile', error: null })
      const profile = message.profile
      if (inspectCalibrationProfile(profile, state.origin).code !== 'stored') {
        return setState({ ...terminalPatch('failed'), error: 'The page returned an invalid calibration profile' })
      }
      try {
        const profiles = await loadProfiles()
        await saveProfiles({ ...profiles, [state.origin]: profile })
        return setState({ ...terminalPatch('complete'), error: null, profile })
      } catch (error) {
        return setState({
          ...terminalPatch('failed'),
          error: error instanceof Error ? error.message : 'The replacement calibration could not be saved',
        })
      }
    }
    if (message.stage === 'failed' || message.stage === 'cancelled') {
      return setState({ ...terminalPatch(message.stage), error: message.error ?? null })
    }
    if (
      message.stage === 'selection_rejected' &&
      ['selecting_composer', 'selecting_send'].includes(message.calibrationStage)
    ) {
      return setState({ stage: message.calibrationStage, error: message.error ?? 'Choose a different element' })
    }
    if (['selecting_composer', 'selecting_send'].includes(message.stage)) {
      return setState({ stage: message.stage, error: null })
    }
    return state
  }

  function handleTabRemoved(tabId) {
    if (tabId === state.tabId) {
      return setState({ ...terminalPatch('failed'), error: 'The calibrated tab was closed' })
    }
    return Promise.resolve(state)
  }

  function handleTabUpdated(tabId, changeInfo) {
    if (tabId === state.tabId && (changeInfo.status === 'loading' || changeInfo.url)) {
      return setState({ ...terminalPatch('failed'), error: 'The calibrated tab navigated' })
    }
    return Promise.resolve(state)
  }

  return { restore, start, cancel, handlePageState, handleTabRemoved, handleTabUpdated, getState: () => state }
}

function idleState() {
  return {
    stage: 'idle',
    requestId: null,
    tabId: null,
    origin: null,
    mode: null,
    startedAt: null,
    error: null,
    profile: null,
  }
}

function terminalPatch(stage) {
  return { stage, requestId: null, tabId: null, origin: null, mode: null, startedAt: null }
}

function validateStart({ requestId, tab, origin, mode }) {
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    throw new Error('A valid calibration request ID is required')
  }
  if (!Number.isInteger(tab?.id) || tab.url == null) throw new Error('No valid browser tab is available')
  if (new URL(tab.url).origin !== origin) throw new Error('The selected tab changed before calibration started')
  if (mode !== 'replace') throw new Error('Unsupported calibration mode')
}

function isStoredOperation(active) {
  return Boolean(
    active &&
      typeof active.requestId === 'string' &&
      Number.isInteger(active.tabId) &&
      typeof active.origin === 'string' &&
      active.mode === 'replace' &&
      ACTIVE_STAGES.includes(active.stage),
  )
}

function readableError(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/Cannot access|chrome:\/\/|edge:\/\/|Cannot use import statement/i.test(message)) {
    return 'The page integration could not be started. Reload the page and try again.'
  }
  if (/Receiving end does not exist|Could not establish connection/i.test(message)) {
    return 'The page integration could not be reached. Reload the page and try again.'
  }
  return message || 'Calibration could not start'
}
