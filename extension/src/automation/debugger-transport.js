/**
 * chrome.debugger transport — attaches only after explicit activation.
 * No remote-debugging ports. No external browser processes.
 */

const PROTOCOL_VERSION = '1.3';

export function createDebuggerTransport() {
  /** @type {Map<number, { state: string, attachPromise?: Promise<void> }>} */
  const tabs = new Map();

  function getState(tabId) {
    return tabs.get(tabId)?.state || 'not_attached';
  }

  async function attach(tabId) {
    const cur = tabs.get(tabId);
    if (cur?.state === 'attached') return;
    if (cur?.attachPromise) {
      await cur.attachPromise;
      return;
    }

    tabs.set(tabId, { state: 'attaching' });
    const promise = (async () => {
      try {
        await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
        tabs.set(tabId, { state: 'attached' });
      } catch (err) {
        const msg = String(err?.message || err);
        if (/already attached/i.test(msg)) {
          try {
            await chrome.debugger.detach({ tabId });
          } catch {
            /* ignore */
          }
          await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
          tabs.set(tabId, { state: 'attached' });
          return;
        }
        tabs.set(tabId, { state: 'failed' });
        const e = new Error(msg);
        e.code = 'debugger_attach_failed';
        throw e;
      }
    })();

    tabs.set(tabId, { state: 'attaching', attachPromise: promise });
    await promise;
  }

  async function detach(tabId) {
    const state = getState(tabId);
    if (state === 'not_attached') {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        /* ignore */
      }
      tabs.delete(tabId);
      return;
    }
    tabs.set(tabId, { state: 'detaching' });
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      /* ignore */
    }
    tabs.delete(tabId);
  }

  async function sendCommand(tabId, method, params = {}) {
    if (getState(tabId) !== 'attached') {
      // Chrome may still have us attached even if map was lost (SW restart).
      try {
        await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
        tabs.set(tabId, { state: 'attached' });
      } catch (err) {
        const e = new Error(String(err?.message || err));
        e.code = 'debugger_detached';
        throw e;
      }
    }
    try {
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/not attached|detached|debugger is not attached/i.test(msg)) {
        tabs.delete(tabId);
        const e = new Error(msg);
        e.code = 'debugger_detached';
        throw e;
      }
      throw err;
    }
  }

  function markDetached(tabId) {
    tabs.delete(tabId);
  }

  function isAttached(tabId) {
    return getState(tabId) === 'attached';
  }

  // Keep map in sync with Chrome detach events.
  if (globalThis.chrome?.debugger?.onDetach) {
    chrome.debugger.onDetach.addListener((source) => {
      if (source?.tabId != null) {
        markDetached(source.tabId);
      }
    });
  }

  return {
    attach,
    detach,
    sendCommand,
    getState,
    isAttached,
    markDetached,
    PROTOCOL_VERSION,
  };
}
