import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPuppeteerTabDriver,
  PUPPETEER_EXTENSION_ENGINE,
} from './automation/puppeteer-tab-driver.js'

test('connects Puppeteer to one existing tab and uses unique provider selectors', async () => {
  const calls = []
  const page = {
    async $$(selector) {
      calls.push(['matches', selector])
      return [{
        async focus() {
          calls.push(['focus', selector])
        },
        async evaluate() {
          calls.push(['clear', selector])
        },
        async dispose() {
          calls.push(['dispose', selector])
        },
      }]
    },
    locator(selector) {
      return {
        setTimeout(timeout) {
          calls.push(['timeout', selector, timeout])
          return this
        },
        async fill(value) {
          calls.push(['fill', selector, value])
        },
        async click() {
          calls.push(['click', selector])
        },
      }
    },
    keyboard: {
      async press(key) {
        calls.push(['press', key])
      },
      async sendCharacter(value) {
        calls.push(['sendCharacter', value])
      },
    },
  }
  const browser = {
    async pages() {
      return [page]
    },
    async disconnect() {
      calls.push(['disconnect'])
    },
  }
  const transport = { close() { calls.push(['transport.close']) } }
  const driver = createPuppeteerTabDriver({
    connect: async ({ transport: received }) => {
      assert.equal(received, transport)
      return browser
    },
    extensionTransport: {
      async connectTab(tabId) {
        calls.push(['connectTab', tabId])
        return transport
      },
    },
    debuggerApi: {
      async sendCommand(target, method, params) {
        calls.push(['sendCommand', target, method, params])
      },
      async detach() {},
    },
    locatorTimeoutMs: 2_500,
  })

  await driver.attach(42)
  await driver.fill(42, 'textarea[data-provider="deepseek"]', 'hello')
  await driver.clickSelector(42, 'div[role="button"][data-send="deepseek"]')
  await driver.pressEnter(42)
  await driver.detach(42)

  assert.equal(driver.getEngine(), PUPPETEER_EXTENSION_ENGINE)
  assert.deepEqual(calls, [
    ['connectTab', 42],
    ['matches', 'textarea[data-provider="deepseek"]'],
    ['focus', 'textarea[data-provider="deepseek"]'],
    ['clear', 'textarea[data-provider="deepseek"]'],
    ['sendCharacter', 'hello'],
    ['dispose', 'textarea[data-provider="deepseek"]'],
    ['matches', 'div[role="button"][data-send="deepseek"]'],
    ['dispose', 'div[role="button"][data-send="deepseek"]'],
    ['timeout', 'div[role="button"][data-send="deepseek"]', 2_500],
    ['click', 'div[role="button"][data-send="deepseek"]'],
    ['press', 'Enter'],
    ['disconnect'],
  ])
})

test('rejects an ambiguous send selector before Puppeteer clicks', async () => {
  let clicked = false
  const handles = [
    { async dispose() {} },
    { async dispose() {} },
  ]
  const page = {
    async $$() {
      return handles
    },
    locator() {
      return {
        setTimeout() {
          return this
        },
        async click() {
          clicked = true
        },
      }
    },
  }
  const driver = createPuppeteerTabDriver({
    connect: async () => ({
      async pages() {
        return [page]
      },
      async disconnect() {},
    }),
    extensionTransport: {
      async connectTab() {
        return { close() {} }
      },
    },
    debuggerApi: { async detach() {} },
  })

  await driver.attach(7)
  await assert.rejects(
    driver.clickSelector(7, '.send'),
    { code: 'send_selector_ambiguous' },
  )
  assert.equal(clicked, false)
  await driver.detach(7)
})
