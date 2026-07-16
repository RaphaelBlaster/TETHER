export function createCalibrationStartCoordinator({ resolvePanelTab, inspectSite, hasAccess, assertAvailable = () => {}, start }) {
  return async function startFromPanel(message, sender) {
    const tab = await resolvePanelTab(sender)
    const site = inspectSite(tab?.url)
    if (site.kind !== 'web') throw new Error('TETHER cannot access this browser page')
    if (!(await hasAccess(site.origin))) throw new Error('Permission is required for this site')
    assertAvailable(tab)
    return start({
      requestId: message.requestId,
      tab,
      origin: site.origin,
      mode: 'replace',
    })
  }
}
