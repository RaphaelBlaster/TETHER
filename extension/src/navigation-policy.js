import { inspectSite } from './provider-registry.js'

export function shouldCancelTabOperations(changeInfo, currentSession) {
  if (changeInfo?.url) {
    const next = inspectSite(changeInfo.url)
    return !currentSession || next.kind !== 'web' || next.origin !== currentSession.origin || next.providerId !== currentSession.providerId
  }
  return changeInfo?.status === 'loading'
}

export function shouldReleaseBrowserAutomation(changeInfo, currentSession) {
  if (!changeInfo?.url) return false
  return shouldCancelTabOperations({ url: changeInfo.url }, currentSession)
}
