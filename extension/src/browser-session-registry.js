import { detectProvider } from './provider-registry.js'

export const BROWSER_SESSIONS_KEY = 'browserSessions'
export const SESSION_SCHEMA_KEY = 'tetherSessionSchemaVersion'
export const SESSION_SCHEMA_VERSION = 1
export const LEGACY_TAB_ATTACHMENTS_KEY = 'tabAttachments'

export class BrowserSessionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BrowserSessionError'
    this.code = code
  }
}

export function createBrowserSessionRegistry({
  storage,
  getTab,
  uuid = () => crypto.randomUUID(),
  now = () => Date.now(),
} = {}) {
  let sessions = {}
  let sessionIdByTabId = new Map()

  function rebuildTabIndex() {
    sessionIdByTabId = new Map()
    for (const session of Object.values(sessions)) {
      sessionIdByTabId.set(session.tabId, session.browserSessionId)
    }
  }

  async function persist() {
    await storage.set({
      [SESSION_SCHEMA_KEY]: SESSION_SCHEMA_VERSION,
      [BROWSER_SESSIONS_KEY]: sessions,
    })
  }

  async function initialize() {
    const stored = await storage.get([
      SESSION_SCHEMA_KEY,
      BROWSER_SESSIONS_KEY,
      LEGACY_TAB_ATTACHMENTS_KEY,
    ])
    sessions = stored[SESSION_SCHEMA_KEY] === SESSION_SCHEMA_VERSION
      ? stored[BROWSER_SESSIONS_KEY] ?? {}
      : {}
    await storage.remove(LEGACY_TAB_ATTACHMENTS_KEY)
    await reconcile()
    return list()
  }

  async function reconcile() {
    const reconciled = {}
    const claimedTabs = new Set()
    for (const candidate of Object.values(sessions)) {
      if (!isValidRecord(candidate) || claimedTabs.has(candidate.tabId)) continue
      try {
        const tab = await getTab(candidate.tabId)
        const provider = detectProvider(tab?.url)
        if (!provider || provider.providerId !== candidate.providerId || provider.origin !== candidate.origin) {
          continue
        }
        claimedTabs.add(candidate.tabId)
        reconciled[candidate.browserSessionId] = {
          ...candidate,
          transportMode: candidate.transportMode === 'CROSS' ? 'CROSS' : 'CLI',
          role: candidate.transportMode === 'CROSS' && candidate.role === 'SLAVE' ? 'SLAVE' : candidate.transportMode === 'CROSS' ? 'MASTER' : 'ENDPOINT',
          windowId: tab.windowId,
          conversationId: provider.conversationId,
          lastSeenAt: now(),
        }
      } catch {
        // A missing/closed tab invalidates only its own ephemeral session.
      }
    }
    sessions = reconciled
    rebuildTabIndex()
    await persist()
    return list()
  }

  async function activate(tab, calibrationProfiles, calibrationValidation, configuration = {}) {
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
      throw new BrowserSessionError('invalid_tab', 'No valid browser tab is available')
    }
    const transportMode = configuration.transportMode === 'CROSS' ? 'CROSS' : 'CLI'
    const role = transportMode === 'CROSS' && configuration.role === 'SLAVE' ? 'SLAVE' : transportMode === 'CROSS' ? 'MASTER' : 'ENDPOINT'
    const existing = getByTabId(tab.id)
    if (existing) {
      const updated = { ...existing, transportMode, role, lastSeenAt: now() }
      sessions = { ...sessions, [updated.browserSessionId]: updated }
      await persist()
      return updated
    }
    const active = list()
    if (transportMode === 'CROSS' && active.length >= 2) {
      throw new BrowserSessionError('cross_pair_complete', 'CROSS already has its MASTER and SLAVE endpoints')
    }
    if (transportMode === 'CROSS' && active.some((session) => session.transportMode === 'CROSS' && session.role === role)) {
      throw new BrowserSessionError('cross_role_taken', `CROSS already has a ${role} endpoint`)
    }
    const provider = detectProvider(tab.url)
    if (!provider) throw new BrowserSessionError('restricted_tab', 'This browser page does not allow TETHER access')
    const calibration = calibrationProfiles[provider.calibrationKey]
    if (!provider.hasAdapter && (!calibration || calibration.version !== 1)) {
      throw new BrowserSessionError('calibration_required', 'This site must be calibrated first')
    }
    if (!provider.hasAdapter && !calibrationValidation?.valid) {
      throw new BrowserSessionError('calibration_invalid', 'The saved controls must be validated before activation')
    }
    const timestamp = now()
    const browserSessionId = uuid()
    const session = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      browserSessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      providerId: provider.providerId,
      origin: provider.origin,
      conversationId: provider.conversationId,
      calibrationKey: provider.calibrationKey,
      transportMode,
      role,
      status: 'active',
      createdAt: timestamp,
      lastSeenAt: timestamp,
    }
    sessions = { ...sessions, [browserSessionId]: session }
    sessionIdByTabId.set(tab.id, browserSessionId)
    await persist()
    return session
  }

  async function configureMode(transportMode, roleForSession = () => 'ENDPOINT') {
    const mode = transportMode === 'CROSS' ? 'CROSS' : 'CLI'
    const active = list()
    if (mode === 'CLI' && active.length > 1) {
      throw new BrowserSessionError('multiple_cli_endpoints', 'Deactivate all but one endpoint before switching to CLI mode')
    }
    if (mode === 'CROSS' && active.length > 2) {
      throw new BrowserSessionError('too_many_cross_endpoints', 'CROSS supports exactly one MASTER and one SLAVE endpoint')
    }
    const roles = active.map((session) => mode === 'CROSS' ? roleForSession(session) : 'ENDPOINT')
    if (mode === 'CROSS' && new Set(roles).size !== roles.length) {
      throw new BrowserSessionError('duplicate_cross_role', 'CROSS requires one LLM MASTER and one non-LLM SLAVE')
    }
    sessions = Object.fromEntries(active.map((session, index) => [session.browserSessionId, {
      ...session,
      transportMode: mode,
      role: roles[index],
      lastSeenAt: now(),
    }]))
    rebuildTabIndex()
    await persist()
    return list()
  }

  async function setRole(tabId, role) {
    const existing = getByTabId(tabId)
    if (!existing) throw new BrowserSessionError('inactive_session', 'Activate this tab before changing its CROSS role')
    if (existing.transportMode !== 'CROSS') throw new BrowserSessionError('invalid_mode', 'Only CROSS endpoints have MASTER or SLAVE roles')
    if (!['MASTER', 'SLAVE'].includes(role)) throw new BrowserSessionError('invalid_role', 'Choose MASTER or SLAVE')
    if (list().some((session) => session.tabId !== tabId && session.transportMode === 'CROSS' && session.role === role)) {
      throw new BrowserSessionError('cross_role_taken', `CROSS already has a ${role} endpoint`)
    }
    const updated = { ...existing, role, lastSeenAt: now() }
    sessions = { ...sessions, [updated.browserSessionId]: updated }
    await persist()
    return updated
  }

  async function updateTab(tab) {
    const existing = getByTabId(tab?.id)
    if (!existing) return null
    const provider = detectProvider(tab.url)
    if (!provider || provider.providerId !== existing.providerId || provider.origin !== existing.origin) {
      await removeByTabId(tab.id)
      return null
    }
    const updated = {
      ...existing,
      windowId: tab.windowId,
      conversationId: provider.conversationId,
      lastSeenAt: now(),
    }
    sessions = { ...sessions, [updated.browserSessionId]: updated }
    await persist()
    return updated
  }

  async function removeByTabId(tabId) {
    const existing = getByTabId(tabId)
    if (!existing) return false
    const next = { ...sessions }
    delete next[existing.browserSessionId]
    sessions = next
    sessionIdByTabId.delete(tabId)
    await persist()
    return true
  }

  function assertSender(browserSessionId, senderTabId) {
    const session = sessions[browserSessionId]
    if (!session) throw new BrowserSessionError('unknown_session', 'Unknown browser session')
    if (session.tabId !== senderTabId) {
      throw new BrowserSessionError('session_tab_mismatch', 'Browser session does not belong to sender tab')
    }
    return session
  }

  function getByTabId(tabId) {
    const id = sessionIdByTabId.get(tabId)
    return id ? sessions[id] ?? null : null
  }

  function getById(browserSessionId) {
    return sessions[browserSessionId] ?? null
  }

  function list() {
    return Object.values(sessions)
  }

  return { initialize, reconcile, activate, configureMode, setRole, updateTab, removeByTabId, assertSender, getByTabId, getById, list }
}

function isValidRecord(record) {
  return Boolean(
    record &&
      record.schemaVersion === SESSION_SCHEMA_VERSION &&
      typeof record.browserSessionId === 'string' &&
      record.browserSessionId &&
      Number.isInteger(record.tabId) &&
      Number.isInteger(record.windowId) &&
      typeof record.providerId === 'string' &&
      typeof record.origin === 'string' &&
      typeof record.calibrationKey === 'string' &&
      record.status === 'active' &&
      Number.isFinite(record.createdAt) &&
      Number.isFinite(record.lastSeenAt),
  )
}
