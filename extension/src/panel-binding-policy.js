export function shouldBindPanelToActivation(
  panelWindowId,
  activeInfo,
  protectedTabId = null,
) {
  return Number.isInteger(panelWindowId) &&
    Number.isInteger(activeInfo?.windowId) &&
    Number.isInteger(activeInfo?.tabId) &&
    activeInfo.windowId === panelWindowId &&
    (!Number.isInteger(protectedTabId) || activeInfo.tabId === protectedTabId)
}
