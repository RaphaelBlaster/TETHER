import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
import { buildBrowserPrompt } from './browser-prompt.js'
import { parseBrowserResponse } from './browser-envelope.js'

const CHATGPT_URL = 'https://chatgpt.com/'
const COMPOSER = '#prompt-textarea'
const ASSISTANT = '[data-message-author-role="assistant"]'
const SEND = '#composer-submit-button, [data-testid="send-button"], button[aria-label^="Send"]'

export function createPuppeteerBrowserController({ executablePath, userDataDir, extensionPath, logger = console } = {}) {
  let browser = null
  let active = false

  async function ensureBrowser() {
    if (browser?.connected) return browser
    await mkdir(userDataDir, { recursive: true })
    browser = await puppeteer.launch({
      browser: 'chrome', executablePath, userDataDir, headless: false,
      defaultViewport: null,
      enableExtensions: extensionPath ? [extensionPath] : true,
      args: ['--start-maximized'],
    })
    return browser
  }

  async function chatPage() {
    const instance = await ensureBrowser()
    const pages = await instance.pages()
    let page = pages.find((candidate) => candidate.url().startsWith(CHATGPT_URL)) ?? pages[0]
    if (!page) page = await instance.newPage()
    if (!page.url().startsWith(CHATGPT_URL)) await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()
    try {
      await page.waitForSelector(COMPOSER, { visible: true, timeout: 15_000 })
    } catch {
      throw coded('puppeteer_login_required', 'Sign in to ChatGPT in the TETHER Brave window, then retry')
    }
    return page
  }

  async function request(codexRequest) {
    if (active) throw coded('concurrent_browser_request', 'Only one Puppeteer browser turn may run at once')
    active = true
    try {
      const requestId = `tether-${crypto.randomUUID()}`
      const prompt = buildBrowserPrompt({ requestId, request: codexRequest, installBootstrap: true })
      const page = await chatPage()
      const baseline = await page.$$eval(ASSISTANT, (nodes) => nodes.length)
      await page.locator(COMPOSER).fill(prompt)
      await page.waitForFunction((selector) => {
        const button = document.querySelector(selector)
        return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      }, { timeout: 15_000 }, SEND)
      await page.click(SEND)
      const text = await waitForStableAssistant(page, baseline)
      return parseBrowserResponse(text, requestId, codexRequest.tools ?? [])
    } finally {
      active = false
    }
  }

  async function stop() {
    if (!browser) return
    await browser.close()
    browser = null
  }

  return { request, stop, ensureBrowser }
}

async function waitForStableAssistant(page, baseline, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let previous = ''
  let stableCount = 0
  while (Date.now() < deadline) {
    const result = await page.$$eval(ASSISTANT, (nodes) => ({
      count: nodes.length,
      text: String(nodes.at(-1)?.innerText ?? nodes.at(-1)?.textContent ?? '').trim(),
    }))
    if (result.count > baseline && result.text) {
      stableCount = result.text === previous ? stableCount + 1 : 0
      previous = result.text
      if (stableCount >= 3) return result.text
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  throw coded('puppeteer_response_timeout', 'ChatGPT did not produce a stable assistant response')
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
