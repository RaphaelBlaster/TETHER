export function resetStaleTetherContentScript() {
  try { globalThis.__tetherContentScriptCleanup?.() } catch (error) { void error }
  delete globalThis.__tetherContentScriptCleanup
  delete globalThis.__tetherCalibrationVersion
}

export async function ensureTetherContentScript({ tabId, executeScript, sendTabMessage }) {
  try {
    const ready = await sendTabMessage(tabId, { type: 'tether.endpointReady' })
    if (ready?.ok) return ready
  } catch (error) {
    void error
  }

  // Extension reloads invalidate runtime listeners without necessarily clearing
  // globals in the tab's isolated world. Remove that stale marker before loading
  // the current bundle or its version guard can incorrectly skip registration.
  await executeScript({ target: { tabId }, func: resetStaleTetherContentScript })
  await executeScript({ target: { tabId }, files: ['content-script.js'] })

  const ready = await sendTabMessage(tabId, { type: 'tether.endpointReady' })
  if (!ready?.ok) {
    throw Object.assign(new Error('TETHER endpoint did not acknowledge readiness'), {
      code: 'endpoint_not_ready',
    })
  }
  return ready
}
