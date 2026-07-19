export function shouldBindPanelToActivation(panelWindowId, activeInfo) {
  return Number.isInteger(panelWindowId) &&
    Number.isInteger(activeInfo?.windowId) &&
    Number.isInteger(activeInfo?.tabId) &&
    activeInfo.windowId === panelWindowId
}
