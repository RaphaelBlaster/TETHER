import { createBrowserSessionRegistry } from './browser-session-registry.js'
import { createConnectionManager } from './connection-manager.js'
import { hasCalibrationAccess } from './calibration/calibration-access.js'
import {
  ACTIVE_CALIBRATION_KEY,
  CALIBRATION_STORAGE_KEY,
  createCalibrationSession,
} from './calibration/calibration-session.js'
import { registerSidePanelConnection } from './calibration/panel-lifecycle.js'
import { inspectCalibrationProfile } from './calibration/profile-schema.js'
import { createCalibrationStartCoordinator } from './calibration/start-coordinator.js'
import { inspectSite } from './provider-registry.js'
import { createTabPanelController } from './tab-panel-controller.js'
import { createInjectionCoordinator } from './injection/injection-coordinator.js'
import { createExtractionCoordinator } from './extraction/extraction-coordinator.js'
import { createBrowserAutomation } from './automation/browser-automation.js'
import { createDebuggerTransport } from './automation/debugger-transport.js'
import { getOrCreateExtensionInstanceId } from './extension-protocol.js'
import { shouldCancelTabOperations, shouldReleaseBrowserAutomation } from './navigation-policy.js'
import { ensureTetherContentScript } from './content-script-lifecycle.js'
import {
  ACTIVE_RESPONSE_CALIBRATIONS_KEY,
  createResponseCalibrationSession,
} from './response-calibration/response-calibration-session.js'

const TRANSPORT_MODE_KEY = 'tetherTransportMode'
let transportMode = 'CLI'
const modeReady = chrome.storage.session.get(TRANSPORT_MODE_KEY).then((stored) => {
  transportMode = stored[TRANSPORT_MODE_KEY] === 'CROSS' ? 'CROSS' : 'CLI'
})

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function loadCalibrationProfiles() {
  const stored = await chrome.storage.local.get(CALIBRATION_STORAGE_KEY)
  return stored[CALIBRATION_STORAGE_KEY] ?? {}
}

const ensureContentScript = (tabId) => ensureTetherContentScript({
  tabId,
  executeScript: (details) => chrome.scripting.executeScript(details),
  sendTabMessage: (targetTabId, message) => chrome.tabs.sendMessage(targetTabId, message),
})

const calibration = createCalibrationSession({
  injectContentScript(tabId) {
    return ensureContentScript(tabId)
  },
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  loadProfiles: loadCalibrationProfiles,
  saveProfiles: (profiles) => chrome.storage.local.set({ [CALIBRATION_STORAGE_KEY]: profiles }),
  async loadActiveOperation() {
    const stored = await chrome.storage.session.get(ACTIVE_CALIBRATION_KEY)
    return stored[ACTIVE_CALIBRATION_KEY] ?? null
  },
  saveActiveOperation: (operation) => chrome.storage.session.set({ [ACTIVE_CALIBRATION_KEY]: operation }),
  clearActiveOperation: () => chrome.storage.session.remove(ACTIVE_CALIBRATION_KEY),
  getPageState: (tabId) => chrome.tabs.sendMessage(tabId, { type: 'calibration.getPageState' }),
  publish(state) {
    broadcast({ type: 'calibration.stateChanged', state })
    broadcast({ type: 'panel.stateChanged' })
  },
})

const browserSessions = createBrowserSessionRegistry({
  storage: chrome.storage.session,
  getTab: (tabId) => chrome.tabs.get(tabId),
})

const injection = createInjectionCoordinator({
  async sendTabMessage(tabId, message) {
    if (message.type === 'injection.execute') {
      await ensureContentScript(tabId)
    }
    return chrome.tabs.sendMessage(tabId, message)
  },
  publish(state) {
    broadcast({ type: 'injection.stateChanged', state })
    broadcast({ type: 'panel.stateChanged' })
  },
})

const responseCalibration = createResponseCalibrationSession({
  injectContentScript: (tabId) => ensureContentScript(tabId),
  sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  loadProfiles: loadCalibrationProfiles,
  saveProfiles: (profiles) => chrome.storage.local.set({ [CALIBRATION_STORAGE_KEY]: profiles }),
  async loadActiveOperations() {
    const stored = await chrome.storage.session.get(ACTIVE_RESPONSE_CALIBRATIONS_KEY)
    return stored[ACTIVE_RESPONSE_CALIBRATIONS_KEY] ?? {}
  },
  saveActiveOperations: (operations) => chrome.storage.session.set({ [ACTIVE_RESPONSE_CALIBRATIONS_KEY]: operations }),
  getPageState: (tabId) => chrome.tabs.sendMessage(tabId, { type: 'responseCalibration.getPageState' }),
  publish(state) {
    broadcast({ type: 'responseCalibration.stateChanged', state })
    broadcast({ type: 'panel.stateChanged' })
  },
})

const extraction = createExtractionCoordinator({
  async sendTabMessage(tabId, message) {
    if (message.type === 'extraction.execute.v2') await ensureContentScript(tabId)
    return chrome.tabs.sendMessage(tabId, message)
  },
  publish() {
    broadcast({ type: 'extraction.stateChanged' })
    broadcast({ type: 'panel.stateChanged' })
  },
})

const tabPanels = createTabPanelController({
  sidePanel: chrome.sidePanel,
  hasSession: (tabId) => Boolean(browserSessions.getByTabId(tabId)),
})

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error)
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(console.error)

const sessionReady = browserSessions.initialize()
const extensionInstanceReady = getOrCreateExtensionInstanceId(chrome.storage.local)
const calibrationReady = calibration.restore()
const responseCalibrationReady = responseCalibration.restore()
const panelReady = sessionReady.then(async (sessions) => {
  const activeTabs = await chrome.tabs.query({ active: true })
  await tabPanels.initialize(sessions, activeTabs)
})
const lifecycleReady = Promise.all([sessionReady, calibrationReady, responseCalibrationReady, panelReady])
// The adapter path deliberately uses the same self-contained direct-CDP
// pipeline that proved reliable in the replacement extension. It does not
// depend on the legacy content-script selector/extraction flow.
const browserAutomation = createBrowserAutomation({
  transport: createDebuggerTransport(),
})

async function extensionRegistration() {
  const [extensionInstanceId] = await Promise.all([extensionInstanceReady, sessionReady])
  return { extensionInstanceId, sessions: browserSessions.list() }
}

async function validateAdapterTestRequest(message, registration) {
  await sessionReady
  const registered = registration.sessions.find((session) => session.browserSessionId === message.browserSessionId)
  const session = browserSessions.getById(message.browserSessionId)
  if (!registered || !session || session.status !== 'active') {
    throw Object.assign(new Error('Browser session is not active'), { code: 'inactive_session' })
  }
  let tab
  try {
    tab = await chrome.tabs.get(session.tabId)
  } catch {
    throw Object.assign(new Error('Browser session tab is unavailable'), { code: 'tab_unavailable' })
  }
  const site = inspectSite(tab?.url)
  if (tab?.id !== session.tabId || site.kind !== 'web' || site.origin !== session.origin || site.providerId !== session.providerId) {
    throw Object.assign(new Error('Browser session no longer matches its tab'), { code: 'session_tab_mismatch' })
  }
  const responseOperation = responseCalibration.getBySessionId(session.browserSessionId)
  const busy =
    injection.getBySessionId(session.browserSessionId)?.stage === 'injecting' ||
    extraction.getBySessionId(session.browserSessionId)?.stage === 'observing' ||
    (responseOperation && !['complete', 'cancelled', 'failed'].includes(responseOperation.stage)) ||
    calibration.getState().tabId === session.tabId
  if (busy) throw Object.assign(new Error('Browser session is busy'), { code: 'session_busy' })
}

async function handleAdapterBrowserRequest(message, registration, { signal }) {
  await lifecycleReady
  await validateAdapterTestRequest(message, registration)
  const session = browserSessions.getById(message.browserSessionId)
  const extensionInstanceId = await extensionInstanceReady
  if (signal.aborted) throw Object.assign(new Error('Adapter disconnected'), { code: 'adapter_disconnected' })
  const cancel = () => browserAutomation.cancel({
    extensionInstanceId,
    browserSessionId: session.browserSessionId,
    requestId: message.requestId,
  })
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const operation = await browserAutomation.request({
      requestId: message.requestId,
      browserSessionId: session.browserSessionId,
      extensionInstanceId,
      tabId: session.tabId,
      origin: session.origin,
      providerId: session.providerId,
      prompt: message.payload.prompt,
      signal,
    })
    return operation.text
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

const manager = createConnectionManager({
  getRegistration: extensionRegistration,
  onTestRequest: validateAdapterTestRequest,
  onBrowserRequest: handleAdapterBrowserRequest,
  onStateChange(state) {
    broadcast({ type: 'connection.stateChanged', state })
  },
})

function publishBrowserSessions(tabId) {
  broadcast({ type: 'browserSession.stateChanged', tabId })
  return manager.sessionsChanged()
}

const panelTabByDocumentId = new Map()

async function tabForPanelSender(sender) {
  const boundTabId = panelTabByDocumentId.get(sender.documentId)
  if (Number.isInteger(boundTabId)) return chrome.tabs.get(boundTabId)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function validateStoredProfile(tabId, profile) {
  const validatedAt = Date.now()
  try {
    await ensureContentScript(tabId)
    const validation = await chrome.tabs.sendMessage(tabId, {
      type: 'calibration.validateProfile',
      profile,
    })
    return { ...validation, validatedAt }
  } catch (error) {
    return {
      code: 'validation_failed',
      valid: false,
      loaded: true,
      composerResolved: false,
      sendResolved: false,
      validatedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function calibrationProjection(profileInspection, validation, profile, origin) {
  const diagnostics = {
    storageKey: CALIBRATION_STORAGE_KEY,
    origin,
    loaded: profileInspection.loaded,
    migrated: false,
    profileSource: profile ? (profile.createdAt ? 'current_schema' : 'checkpoint_4_schema') : 'none',
    profileVersion: profile?.version ?? null,
    createdAt: profile?.createdAt ?? null,
    lastValidatedAt: validation?.validatedAt ?? null,
    validationResult: validation?.code ?? profileInspection.code,
    composerFingerprintExists: Boolean(profile?.composer),
    sendFingerprintExists: Boolean(profile?.send),
    composerResolved: Boolean(validation?.composerResolved),
    sendResolved: Boolean(validation?.sendResolved),
  }
  if (profileInspection.code === 'missing') return { state: 'missing', validation: profileInspection, diagnostics }
  if (profileInspection.code === 'schema_invalid') {
    return { state: 'invalid', validation: profileInspection, diagnostics }
  }
  if (validation?.valid) return { state: 'valid', validation, diagnostics }
  if (validation?.code === 'validation_failed') {
    return { state: 'validation_failed', validation, diagnostics }
  }
  return { state: 'needs_update', validation, diagnostics }
}

async function panelState(sender) {
  await lifecycleReady
  const tab = await tabForPanelSender(sender)
  const site = inspectSite(tab?.url)
  const session = browserSessions.getByTabId(tab?.id)
  const crossSessions = browserSessions.list().filter((candidate) => candidate.transportMode === 'CROSS')
  const endpoints = {
    count: transportMode === 'CROSS' ? crossSessions.length : browserSessions.list().filter((candidate) => candidate.transportMode === 'CLI').length,
    masterReady: crossSessions.some((candidate) => candidate.role === 'MASTER'),
    slaveReady: crossSessions.some((candidate) => candidate.role === 'SLAVE'),
  }
  const activation = {
    state: session ? 'active' : 'inactive',
    role: session?.role ?? null,
    transportMode: session?.transportMode ?? null,
  }
  if (site.kind === 'restricted') {
    return { site, tabId: tab?.id ?? null, access: 'restricted', calibration: null, activation, endpoints }
  }

  const profiles = await loadCalibrationProfiles()
  const profile = profiles[site.calibrationKey] ?? null
  const profileInspection = inspectCalibrationProfile(profile, site.origin)
  const permitted = await hasCalibrationAccess(site.origin)
  if (!permitted) {
    return {
      site,
      tabId: tab.id,
      access: 'required',
      calibration: {
        ...calibrationProjection(profileInspection, null, profile, site.origin),
        state: 'access_required',
      },
      activation,
      endpoints,
    }
  }

  const validation = profileInspection.code === 'stored'
    ? await validateStoredProfile(tab.id, profile)
    : null
  const calibrationStatus = calibrationProjection(profileInspection, validation, profile, site.origin)
  const liveCalibration = calibration.getState()
  const calibrationOperation = liveCalibration.tabId === tab.id
    ? liveCalibration
    : { stage: 'idle', error: null }
  return {
    site,
    tabId: tab.id,
    access: 'granted',
    calibration: calibrationStatus,
    calibrationOperation,
    injectionOperation: session ? injection.getBySessionId(session.browserSessionId) : null,
    responseCalibration: {
      state: profile?.responseCalibration ? 'ready' : 'missing',
      operation: session ? responseCalibration.getBySessionId(session.browserSessionId) : null,
    },
    extractionOperation: session ? extraction.getBySessionId(session.browserSessionId) : null,
    activation,
    endpoints,
  }
}

function sendFailure(sendResponse, error) {
  sendResponse({ ok: false, error: error.message, code: error.code ?? 'unexpected_error' })
}

async function setEndpointState(tabId, state, message = undefined) {
  await ensureContentScript(tabId)
  return chrome.tabs.sendMessage(tabId, { type: 'tether.endpointState', state, mode: transportMode, message })
}

const startCalibrationFromPanel = createCalibrationStartCoordinator({
  resolvePanelTab: tabForPanelSender,
  inspectSite,
  hasAccess: hasCalibrationAccess,
  assertAvailable(tab) {
    if (injection.getByTabId(tab.id)?.stage === 'injecting') {
      throw new Error('Cancel the active injection test before starting calibration')
    }
    const session = browserSessions.getByTabId(tab.id)
    const responseOperation = session ? responseCalibration.getBySessionId(session.browserSessionId) : null
    if (responseOperation && !['complete', 'cancelled', 'failed'].includes(responseOperation.stage)) {
      throw new Error('Cancel response calibration before recalibrating controls')
    }
  },
  start: (operation) => calibration.start(operation),
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'mode.get') {
    modeReady.then(() => sendResponse({ ok: true, mode: transportMode }))
    return true
  }
  if (message?.type === 'mode.set') {
    modeReady.then(async () => {
      if (!['CLI', 'CROSS'].includes(message.mode)) throw Object.assign(new Error('Unsupported TETHER mode'), { code: 'invalid_mode' })
      const nextMode = message.mode
      if (nextMode !== transportMode && browserSessions.list().length > 0) {
        throw Object.assign(new Error('Deactivate the current endpoints before switching TETHER modes'), { code: 'active_endpoints' })
      }
      transportMode = nextMode
      await chrome.storage.session.set({ [TRANSPORT_MODE_KEY]: nextMode })
      await Promise.all(browserSessions.list().map((session) => setEndpointState(session.tabId, 'active').catch(() => {})))
      broadcast({ type: 'mode.stateChanged', mode: transportMode })
      broadcast({ type: 'panel.stateChanged' })
      return transportMode
    }).then((mode) => sendResponse({ ok: true, mode }), (error) => sendFailure(sendResponse, error))
    return true
  }
  if (message?.type === 'connection.getState') {
    sendResponse({ state: manager.getState() })
    return undefined
  }
  if (message?.type === 'panel.getState') {
    panelState(sender).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'browserSession.activate') {
    lifecycleReady
      .then(async () => {
        const tab = await tabForPanelSender(sender)
        const current = await panelState(sender)
        if (current.access !== 'granted' || (!current.site?.hasAdapter && current.calibration?.state !== 'valid')) {
          throw Object.assign(new Error('This site requires a valid calibration before activation'), {
            code: 'calibration_required',
          })
        }
        if (transportMode === 'CLI' && !browserSessions.getByTabId(tab.id) && browserSessions.list().length > 0) {
          throw Object.assign(new Error('CLI already has an active endpoint; deactivate it before selecting another tab'), { code: 'cli_endpoint_exists' })
        }
        const requestedRole = message.role
        if (transportMode === 'CROSS' && !['MASTER', 'SLAVE'].includes(requestedRole)) {
          throw Object.assign(new Error('Choose MASTER or SLAVE before activating this CROSS endpoint'), { code: 'cross_role_required' })
        }
        const session = await browserSessions.activate(
          tab,
          await loadCalibrationProfiles(),
          current.calibration.validation,
          {
            transportMode,
            role: transportMode === 'CROSS' ? requestedRole : 'ENDPOINT',
          },
        )
        await tabPanels.sessionActivated(session)
        await publishBrowserSessions(tab.id)
        setEndpointState(session.tabId, 'active').catch(() => {})
        return panelState(sender)
      })
      .then(
        (state) => sendResponse({ ok: true, state }),
        (error) => sendFailure(sendResponse, error),
      )
    return true
  }
  if (message?.type === 'browserSession.deactivate') {
    lifecycleReady
      .then(async () => {
        const tab = await tabForPanelSender(sender)
        const existingSession = browserSessions.getByTabId(tab.id)
        if (existingSession) {
          await setEndpointState(existingSession.tabId, 'hidden').catch(() => {})
          injection.cancelBySessionId(existingSession.browserSessionId, 'session_deactivated')
          extraction.cancelBySessionId(existingSession.browserSessionId, 'session_deactivated')
          await responseCalibration.cancel(existingSession.browserSessionId, 'session_deactivated')
          await browserAutomation.release(existingSession.tabId)
        }
        await browserSessions.removeByTabId(tab.id)
        await tabPanels.sessionRemoved(tab.id)
        await publishBrowserSessions(tab.id)
        return panelState(sender)
      })
      .then(
        (state) => sendResponse({ ok: true, state }),
        (error) => sendFailure(sendResponse, error),
      )
    return true
  }
  if (message?.type === 'browserSession.role.set') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = await browserSessions.setRole(tab.id, message.role)
      await publishBrowserSessions(tab.id)
      setEndpointState(session.tabId, 'active').catch(() => {})
      return panelState(sender)
    }).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'browserSession.validate') {
    sessionReady
      .then(() => browserSessions.assertSender(message.browserSessionId, sender.tab?.id))
      .then(
        (session) => sendResponse({ ok: true, session }),
        (error) => sendFailure(sendResponse, error),
      )
    return true
  }
  if (message?.type === 'calibration.start') {
    lifecycleReady.then(() => startCalibrationFromPanel(message, sender)).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => {
        const state = calibration.getState()
        sendResponse({ ok: false, error: state.error ?? error.message, state })
      },
    )
    return true
  }
  if (message?.type === 'injection.start') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) throw Object.assign(new Error('Activate TETHER for this tab before testing injection'), { code: 'inactive_session' })
      const responseOperation = responseCalibration.getBySessionId(session.browserSessionId)
      if (responseOperation && !['complete', 'cancelled', 'failed'].includes(responseOperation.stage)) {
        throw Object.assign(new Error('Response calibration is using this browser session'), { code: 'session_busy' })
      }
      if (session.tabId !== tab.id) throw Object.assign(new Error('Browser session does not own the panel-bound tab'), { code: 'session_tab_mismatch' })
      const site = inspectSite(tab.url)
      if (site.kind !== 'web' || site.origin !== session.origin) {
        throw Object.assign(new Error('The activated browser session no longer matches this page'), { code: 'origin_mismatch' })
      }
      const profile = (await loadCalibrationProfiles())[session.calibrationKey]
      if (inspectCalibrationProfile(profile, session.origin).code !== 'stored') {
        throw Object.assign(new Error('This site requires a valid calibration before testing injection'), { code: 'calibration_invalid' })
      }
      if (calibration.getState().tabId === tab.id) {
        throw Object.assign(new Error('Finish or cancel calibration before testing injection'), { code: 'calibration_active' })
      }
      return injection.start({ requestId: message.requestId, session, profile, text: message.text })
    }).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'injection.cancel') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) throw Object.assign(new Error('No active browser session exists for this tab'), { code: 'inactive_session' })
      return { cancelled: injection.cancelBySessionId(session.browserSessionId) }
    }).then(
      (result) => sendResponse({ ok: true, ...result }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'responseCalibration.start') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) throw Object.assign(new Error('Activate TETHER in this tab first'), { code: 'inactive_session' })
      if (injection.getByTabId(tab.id)?.stage === 'injecting') {
        throw Object.assign(new Error('Cancel the injection test first'), { code: 'session_busy' })
      }
      if (calibration.getState().tabId === tab.id) {
        throw Object.assign(new Error('Finish control calibration first'), { code: 'page_busy' })
      }
      const profile = (await loadCalibrationProfiles())[session.calibrationKey]
      return responseCalibration.start({ requestId: message.requestId, session, profile })
    }).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'extraction.start') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) throw Object.assign(new Error('Activate TETHER in this tab first'), { code: 'inactive_session' })
      const profile = (await loadCalibrationProfiles())[session.calibrationKey]
      if (!profile?.responseCalibration) throw Object.assign(new Error('Complete response calibration first'), { code: 'response_calibration_missing' })
      return extraction.start({ requestId: message.requestId, session, profile, text: message.text })
    }).then((state) => sendResponse({ ok: true, state }), (error) => sendFailure(sendResponse, error))
    return true
  }
  if (message?.type === 'extraction.cancel') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      return session ? extraction.cancelBySessionId(session.browserSessionId) : false
    }).then((cancelled) => sendResponse({ ok: true, cancelled }), (error) => sendFailure(sendResponse, error))
    return true
  }
  if (message?.type === 'responseCalibration.cancel') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) return false
      return responseCalibration.cancel(session.browserSessionId)
    }).then(
      (cancelled) => sendResponse({ ok: true, cancelled }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'responseCalibration.manualSelect') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const session = browserSessions.getByTabId(tab?.id)
      if (!session) throw Object.assign(new Error('Activate TETHER in this tab first'), { code: 'inactive_session' })
      return responseCalibration.startManualSelection(session.browserSessionId)
    }).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'responseCalibration.pageState') {
    lifecycleReady.then(async () => {
      await browserSessions.assertSender(message.browserSessionId, sender.tab?.id)
      return responseCalibration.handlePageState(message, sender.tab.id)
    }).then(
      () => sendResponse({ ok: true }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'calibration.cancel') {
    lifecycleReady.then(async () => {
      const tab = await tabForPanelSender(sender)
      const current = calibration.getState()
      if (Number.isInteger(current.tabId) && current.tabId !== tab?.id) {
        throw new Error('Another tab owns the active calibration')
      }
      return calibration.cancel(message.requestId)
    }).then(
      (state) => sendResponse({ ok: true, state }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  if (message?.type === 'calibration.pageState') {
    calibration.handlePageState(message, sender.tab?.id).then(
      () => sendResponse({ ok: true }),
      (error) => sendFailure(sendResponse, error),
    )
    return true
  }
  return undefined
})

chrome.action.onClicked.addListener((tab) => {
  tabPanels.openManually(tab).catch((error) => console.error('TETHER could not open', error))
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  panelReady.then(() => tabPanels.handleActivated(activeInfo)).catch(console.error)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  calibration.handleTabUpdated(tabId, changeInfo)
  const currentSession = browserSessions.getByTabId(tabId)
  if (shouldCancelTabOperations(changeInfo, currentSession)) {
    injection.cancelByTabId(tabId, 'tab_navigated')
    extraction.cancelByTabId(tabId, 'tab_navigated')
    responseCalibration.cancelByTabId(tabId, 'tab_navigated')
  }
  if (shouldReleaseBrowserAutomation(changeInfo, currentSession)) {
    browserAutomation.release(tabId).catch(console.error)
  }
  if (changeInfo.status === 'complete' && currentSession && !changeInfo.url) {
    setEndpointState(tabId, 'active').catch(() => {})
  }
  if (!changeInfo.url) return
  sessionReady
    .then(async () => {
      const before = browserSessions.getByTabId(tabId)
      const after = await browserSessions.updateTab(tab)
      if (before && !after) await tabPanels.sessionRemoved(tabId)
      if (after) await tabPanels.sessionActivated(after)
      if (after && changeInfo.status === 'complete') await setEndpointState(tabId, 'active').catch(() => {})
      if (before || after) await publishBrowserSessions(tabId)
    })
    .catch(console.error)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  calibration.handleTabRemoved(tabId)
  injection.cancelByTabId(tabId, 'tab_closed')
  extraction.cancelByTabId(tabId, 'tab_closed')
  responseCalibration.cancelByTabId(tabId, 'tab_closed')
  browserAutomation.release(tabId).catch(console.error)
  sessionReady
    .then(async () => {
      await browserSessions.removeByTabId(tabId)
      tabPanels.handleRemoved(tabId)
      await publishBrowserSessions(tabId)
    })
    .catch(console.error)
})

chrome.runtime.onConnect.addListener((port) => {
  registerSidePanelConnection(port, {
    getTab: (tabId) => chrome.tabs.get(tabId),
    onBind(tabId, boundPort) {
      if (boundPort.sender?.documentId) panelTabByDocumentId.set(boundPort.sender.documentId, tabId)
      boundPort.postMessage({ type: 'panel.bound', tabId })
    },
    onExplicitClose: async (tabId) => {
      if (
        calibration.getState().tabId === tabId &&
        ['starting', 'selecting_composer', 'selecting_send'].includes(calibration.getState().stage)
      ) {
        await calibration.cancel()
      }
    },
  })
  port.onDisconnect.addListener(() => {
    if (port.sender?.documentId) panelTabByDocumentId.delete(port.sender.documentId)
  })
})

manager.connect()
