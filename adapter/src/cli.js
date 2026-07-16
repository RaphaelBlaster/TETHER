import { resolve } from 'node:path'
import { createTetherAdapter } from './adapter.js'

const port = parsePort(process.env.TETHER_ADAPTER_PORT ?? '8766')
const browserEngine = process.env.TETHER_BROWSER_ENGINE
const browserOptions = {
      executablePath: process.env.TETHER_BRAVE_PATH ?? 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      userDataDir: resolve('state/puppeteer-profile'),
      extensionPath: resolve('..', '..', 'REACT', 'rerender', 'dist'),
    }
const browserController = await createBrowserController(browserEngine, browserOptions)
const adapter = createTetherAdapter({
  port,
  capturePath: resolve('captures/requests.ndjson'),
  serverInfoPath: resolve('server-info.json'),
  conversationStatePath: resolve('state/conversations.json'),
  routeResponsesToBrowser: true,
  browserController,
})

await adapter.start()
await browserController?.ensureBrowser()

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await adapter.stop()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

function parsePort(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) throw new Error(`Invalid TETHER_ADAPTER_PORT: ${value}`)
  return parsed
}

async function createBrowserController(engine, options) {
  if (engine === 'playwright') {
    const { createPlaywrightBrowserController } = await import('./playwright-browser-controller.js')
    return createPlaywrightBrowserController(options)
  }
  if (engine === 'puppeteer') {
    const { createPuppeteerBrowserController } = await import('./puppeteer-browser-controller.js')
    return createPuppeteerBrowserController(options)
  }
  return null
}
