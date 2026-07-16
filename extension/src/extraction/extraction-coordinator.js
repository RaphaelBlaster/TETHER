export function createExtractionCoordinator({ sendTabMessage, publish = () => {} }) {
  const states = new Map()
  const active = new Map()

  async function start({ requestId, session, profile, text }) {
    const current = active.get(session.browserSessionId)
    if (current) {
      if (current.requestId === requestId) return current.promise
      throw coded('session_busy', 'This browser session is already observing a response')
    }
    const base = { requestId, browserSessionId: session.browserSessionId, tabId: session.tabId, stage: 'observing', text: null, error: null }
    states.set(session.browserSessionId, base); publish(base)
    let entry
    const promise = sendTabMessage(session.tabId, {
      type: 'extraction.execute.v2', requestId, browserSessionId: session.browserSessionId,
      origin: session.origin, profile, text,
    }).then((response) => {
      if (!response?.ok) throw coded(response?.code, response?.error)
      const done = { ...base, stage: 'complete', result: response.result }
      states.set(session.browserSessionId, done); publish(done)
      return done
    }, (error) => { throw error }).catch((error) => {
      const failed = { ...base, stage: error?.code === 'cancelled' ? 'cancelled' : 'failed', error: error.message }
      states.set(session.browserSessionId, failed); publish(failed)
      throw error
    }).finally(() => {
      if (active.get(session.browserSessionId) === entry) active.delete(session.browserSessionId)
    })
    entry = { ...base, promise }
    active.set(session.browserSessionId, entry)
    return promise
  }
  function cancelBySessionId(id, reason = 'cancelled') {
    const operation = active.get(id)
    if (!operation) return false
    // Release routing immediately. A content-script cancellation response can
    // be delayed or lost during navigation/service-worker lifecycle changes.
    // The identity-guarded finally above prevents that stale promise from
    // deleting a newer operation for the same browser session.
    active.delete(id)
    sendTabMessage(operation.tabId, { type: 'extraction.cancel.v2', requestId: operation.requestId }).catch(() => {})
    const state = { ...operation, stage: 'cancelled', error: reason }
    states.set(id, state); publish(state)
    return true
  }
  function cancelByTabId(tabId, reason) {
    for (const operation of active.values()) if (operation.tabId === tabId) cancelBySessionId(operation.browserSessionId, reason)
  }
  return { start, cancelBySessionId, cancelByTabId, getBySessionId: (id) => states.get(id) ?? null }
}

function coded(code = 'extraction_failed', message = 'Response extraction failed') {
  return Object.assign(new Error(message), { code })
}
