export function createTabPanelController({ sidePanel, hasSession }) {
  const activeTabByWindow = new Map()

  async function initialize(sessions, activeTabs = []) {
    await sidePanel.setOptions({ enabled: false })
    for (const session of sessions) {
      await sidePanel.setOptions({ tabId: session.tabId, path: 'index.html', enabled: true })
    }
    for (const tab of activeTabs) {
      if (Number.isInteger(tab?.windowId) && Number.isInteger(tab?.id)) {
        activeTabByWindow.set(tab.windowId, tab.id)
      }
    }
  }

  function openManually(tab) {
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
      return Promise.reject(new Error('No active tab is available'))
    }
    activeTabByWindow.set(tab.windowId, tab.id)
    // These calls must occur synchronously inside the toolbar click handler.
    // Awaiting setup first consumes Chrome/Brave's required user gesture.
    const configure = sidePanel.setOptions({ tabId: tab.id, path: 'index.html', enabled: true })
    const open = sidePanel.open({ tabId: tab.id })
    return Promise.all([configure, open])
  }

  async function handleActivated({ tabId, windowId }) {
    const previousTabId = activeTabByWindow.get(windowId)
    activeTabByWindow.set(windowId, tabId)
    if (Number.isInteger(previousTabId) && previousTabId !== tabId && !hasSession(previousTabId)) {
      await sidePanel.setOptions({ tabId: previousTabId, enabled: false }).catch(() => {})
    }
    await sidePanel.setOptions({
      tabId,
      path: 'index.html',
      enabled: hasSession(tabId),
    })
  }

  function sessionActivated(session) {
    return sidePanel.setOptions({ tabId: session.tabId, path: 'index.html', enabled: true })
  }

  function sessionRemoved(tabId) {
    const isCurrentlyActive = [...activeTabByWindow.values()].includes(tabId)
    if (isCurrentlyActive) return Promise.resolve()
    return sidePanel.setOptions({ tabId, enabled: false }).catch(() => {})
  }

  function handleRemoved(tabId) {
    for (const [windowId, activeTabId] of activeTabByWindow) {
      if (activeTabId === tabId) activeTabByWindow.delete(windowId)
    }
  }

  return { initialize, openManually, handleActivated, sessionActivated, sessionRemoved, handleRemoved }
}
