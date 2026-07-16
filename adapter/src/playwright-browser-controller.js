import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { buildBrowserPrompt, buildDeferredToolSchemaPrompt, buildProtocolBootstrapPrompt } from './browser-prompt.js'
import { parseBrowserEnvelope, parseBrowserResponse } from './browser-envelope.js'
import { selectDeferredToolDefinitions } from './compact-request.js'

const CHATGPT_URL = 'https://chatgpt.com/'
const COMPOSER = '#prompt-textarea'
const ASSISTANT = '[data-message-author-role="assistant"]'
const SEND = '#composer-submit-button, [data-testid="send-button"], button[aria-label^="Send"]'

export function createPlaywrightBrowserController({ executablePath, userDataDir, extensionPath, chromiumApi = chromium } = {}) {
  let context = null
  let active = false
  const bootstrappedPages = new WeakSet()

  async function ensureBrowser() {
    if (context) return context
    await mkdir(userDataDir, { recursive: true })
    const args = ['--start-maximized']
    if (extensionPath) args.push(`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`)
    context = await chromiumApi.launchPersistentContext(userDataDir, {
      executablePath,
      headless: false,
      chromiumSandbox: true,
      viewport: null,
      args,
    })
    context.on?.('close', () => { context = null })
    return context
  }

  async function chatPage() {
    const browserContext = await ensureBrowser()
    let page = browserContext.pages().find((candidate) => candidate.url().startsWith(CHATGPT_URL)) ?? browserContext.pages()[0]
    if (!page) page = await browserContext.newPage()
    if (!page.url().startsWith(CHATGPT_URL)) await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()
    try {
      await page.locator(COMPOSER).waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      throw coded('playwright_login_required', 'Sign in to ChatGPT in the TETHER Brave window, then retry')
    }
    return page
  }

  async function request(codexRequest) {
    if (active) throw coded('concurrent_browser_request', 'Only one Playwright browser turn may run at once')
    active = true
    try {
      const requestId = `tether-${crypto.randomUUID()}`
      const page = await chatPage()
      if (!bootstrappedPages.has(page)) {
        const bootstrapRequestId = `tether-bootstrap-${crypto.randomUUID()}`
        const bootstrapText = await submitAndExtract(page, buildProtocolBootstrapPrompt(bootstrapRequestId))
        const acknowledgement = parseBrowserEnvelope(bootstrapText, bootstrapRequestId, [])
        if (acknowledgement.content !== 'TETHER_BOOTSTRAP_OK') {
          throw coded('invalid_bootstrap_ack', 'Browser did not acknowledge the TETHER protocol bootstrap')
        }
        bootstrappedPages.add(page)
      }
      const prompt = buildBrowserPrompt({ requestId, request: codexRequest, installBootstrap: false })
      const text = await submitAndExtract(page, prompt)
      let envelope = parseBrowserResponse(text, requestId, codexRequest.tools ?? [])
      if (envelope.type === 'tool_schema_request') {
        const schemaRequestId = `${requestId}.schema`
        const definitions = selectDeferredToolDefinitions(codexRequest.tools ?? [], envelope.tools)
        const schemaPrompt = buildDeferredToolSchemaPrompt({
          requestId: schemaRequestId, originalRequestId: requestId, definitions,
        })
        if (schemaPrompt.length > 60_000) throw coded('deferred_tool_schema_too_large', 'Selected tool schema exceeds the browser message limit')
        const schemaText = await submitAndExtract(page, schemaPrompt)
        envelope = parseBrowserEnvelope(schemaText, schemaRequestId, codexRequest.tools ?? [])
      }
      return envelope
    } finally {
      active = false
    }
  }

  async function stop() {
    if (!context) return
    const current = context
    context = null
    await current.close()
  }

  return { request, stop, ensureBrowser }
}

async function submitAndExtract(page, prompt) {
  const assistants = page.locator(ASSISTANT)
  const baselineCount = await assistants.count()
  const baselineText = baselineCount ? String(await assistants.nth(baselineCount - 1).innerText()).trim() : ''
  await page.locator(COMPOSER).fill(prompt)
  const send = page.locator(SEND).first()
  await send.waitFor({ state: 'visible', timeout: 15_000 })
  await send.click()
  return waitForStableAssistant(page, { count: baselineCount, text: baselineText })
}

async function waitForStableAssistant(page, baseline, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let previous = ''
  let stableCount = 0
  while (Date.now() < deadline) {
    const assistants = page.locator(ASSISTANT)
    const count = await assistants.count()
    const text = count ? String(await assistants.nth(count - 1).innerText()).trim() : ''
    if (isNewAssistantSnapshot({ count, text }, baseline)) {
      stableCount = text === previous ? stableCount + 1 : 0
      previous = text
      if (stableCount >= 3) return text
    }
    await page.waitForTimeout(600)
  }
  throw coded('playwright_response_timeout', 'ChatGPT did not produce a stable assistant response')
}

export function isNewAssistantSnapshot(current, baseline) {
  return Boolean(current.text) && (current.count > baseline.count || current.text !== baseline.text)
}

function coded(code, message) {
  return Object.assign(new Error(message), { code })
}
