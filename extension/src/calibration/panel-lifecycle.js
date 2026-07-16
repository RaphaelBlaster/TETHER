export const SIDE_PANEL_PORT = 'tether.sidePanel'

export function registerSidePanelConnection(port, { getTab, onBind = () => {}, onExplicitClose }) {
  if (port?.name !== SIDE_PANEL_PORT) return false
  let attachedTabId = null
  port.onMessage.addListener((message) => {
    if (message?.type === 'panel.bind' && Number.isInteger(message.tabId)) {
      attachedTabId = message.tabId
      onBind(message.tabId, port)
    }
  })
  port.onDisconnect.addListener(async () => {
    if (!Number.isInteger(attachedTabId)) return
    try {
      const tab = await getTab(attachedTabId)
      // A tab-specific panel may unload simply because another tab became active.
      // Only an active attached tab indicates an explicit panel close.
      if (tab.active) await onExplicitClose(attachedTabId)
    } catch {
      // Tab removal/navigation has its own authoritative lifecycle listeners.
    }
  })
  return true
}
