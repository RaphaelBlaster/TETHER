import { ExtensionTransport } from 'puppeteer-core/lib/puppeteer/cdp/ExtensionTransport.js'
import { _connectToCdpBrowser } from 'puppeteer-core/lib/puppeteer/cdp/BrowserConnector.js'

export const PUPPETEER_EXTENSION_ENGINE = 'puppeteer-extension'

async function connectPuppeteer({ transport, ...options }) {
  return _connectToCdpBrowser(transport, '', options)
}

export function createPuppeteerTabDriver({
  connect = connectPuppeteer,
  extensionTransport = ExtensionTransport,
  debuggerApi = globalThis.chrome?.debugger,
  locatorTimeoutMs = 15_000,
} = {}) {
  const sessions = new Map()

  async function attach(tabId) {
    assertTabId(tabId)
    if (sessions.has(tabId)) return

    let transport
    try {
      transport = await extensionTransport.connectTab(tabId)
    } catch (error) {
      if (!/already attached/i.test(String(error?.message || error)) || !debuggerApi?.detach) {
        throw error
      }
      await debuggerApi.detach({ tabId })
      transport = await extensionTransport.connectTab(tabId)
    }

    try {
      const browser = await connect({
        transport,
        defaultViewport: null,
        protocol: 'cdp',
      })
      const pages = await browser.pages()
      if (pages.length !== 1) {
        throw coded(
          'puppeteer_page_unavailable',
          `Expected one attached page, received ${pages.length}`,
        )
      }
      sessions.set(tabId, { browser, page: pages[0] })
    } catch (error) {
      transport.close()
      throw error
    }
  }

  async function detach(tabId) {
    const session = sessions.get(tabId)
    sessions.delete(tabId)
    if (!session) {
      await debuggerApi?.detach?.({ tabId }).catch(() => {})
      return
    }
    await session.browser.disconnect()
  }

  async function sendCommand(tabId, method, params = {}) {
    requireSession(tabId)
    if (!debuggerApi?.sendCommand) {
      throw coded('debugger_unavailable', 'chrome.debugger is unavailable')
    }
    return debuggerApi.sendCommand({ tabId }, method, params)
  }

  async function evaluate(tabId, expression) {
    return requireSession(tabId).page.evaluate(expression)
  }

  async function fill(tabId, selector, text) {
    const page = requireSession(tabId).page
    await withUniqueSelector(page, selector, 'composer', async (handle) => {
      // DeepSeek rolls back locator.fill() on its React-controlled textarea,
      // while per-character keyboard.type() floods TETHER's interaction guard
      // and can lose characters in long JSON prompts. Clear the exact matched
      // control through its native setter, then use Puppeteer's atomic
      // Input.insertText-backed primitive.
      await handle.focus()
      await handle.evaluate((element) => {
        const input = element instanceof HTMLInputElement
        const textarea = element instanceof HTMLTextAreaElement
        if (input || textarea) {
          const prototype = input
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
          setter?.call(element, '')
        } else {
          element.textContent = ''
        }
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward',
          data: null,
        }))
      })
      await page.keyboard.sendCharacter(text)
    })
  }

  async function clickSelector(tabId, selector) {
    const page = requireSession(tabId).page
    await assertUniqueSelector(page, selector, 'send')
    await page.locator(selector)
      .setTimeout(locatorTimeoutMs)
      .click()
  }

  async function replaceFocusedText(tabId, text) {
    const { keyboard } = requireSession(tabId).page
    await keyboard.down('Control')
    await keyboard.press('a')
    await keyboard.up('Control')
    await keyboard.press('Backspace')
    await keyboard.sendCharacter(text)
  }

  async function pressEnter(tabId) {
    await requireSession(tabId).page.keyboard.press('Enter')
  }

  async function mouseClickAt(tabId, x, y) {
    await requireSession(tabId).page.mouse.click(x, y)
  }

  function requireSession(tabId) {
    const session = sessions.get(tabId)
    if (!session) {
      throw coded(
        'debugger_detached',
        `Puppeteer is not attached to tab ${tabId}`,
      )
    }
    return session
  }

  return {
    attach,
    detach,
    sendCommand,
    evaluate,
    fill,
    clickSelector,
    replaceFocusedText,
    pressEnter,
    mouseClickAt,
    getEngine: () => PUPPETEER_EXTENSION_ENGINE,
    _sessions: sessions,
  }
}

async function assertUniqueSelector(page, selector, role) {
  return withUniqueSelector(page, selector, role, async () => {})
}

async function withUniqueSelector(page, selector, role, action) {
  if (typeof selector !== 'string' || !selector) {
    throw coded(
      `${role}_selector_missing`,
      `A unique ${role} selector is required`,
    )
  }
  let handles
  try {
    handles = await page.$$(selector)
  } catch (error) {
    throw coded(
      `${role}_selector_invalid`,
      `The ${role} selector is invalid: ${error.message}`,
    )
  }
  try {
    if (handles.length !== 1) {
      throw coded(
        `${role}_selector_ambiguous`,
        `Expected one ${role} match, received ${handles.length}`,
      )
    }
    return await action(handles[0])
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId)) {
    throw coded('invalid_tab', 'A numeric Chrome tab ID is required')
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
