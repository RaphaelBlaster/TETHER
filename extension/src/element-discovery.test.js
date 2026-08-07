import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import {
  buildActionabilityScript,
  buildCancelActionableSendWaitScript,
  buildDiscoveryScript,
  buildWaitForActionableSendScript,
} from './automation/element-discovery.js'
import { buildClickSendScript } from './automation/submission-controller.js'

const COMPOSER_SELECTOR = 'textarea[placeholder="Message DeepSeek"]'
const SEND_SELECTOR =
  'div[role="button"].ds-button.ds-button--primary.ds-button--filled.ds-button--circle'

test('preserves a unique provider selector for an anonymous React send control', () => {
  const composer = element({
    tagName: 'TEXTAREA',
    attributes: { placeholder: 'Message DeepSeek' },
    value: 'hello',
    rect: { left: 100, top: 500, width: 600, height: 100 },
  })
  const send = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className: 'ds-button ds-button--primary ds-button--filled ds-button--circle',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const document = documentFor(new Map([
    [COMPOSER_SELECTOR, [composer]],
    [SEND_SELECTOR, [send]],
  ]))

  const result = vm.runInNewContext(
    buildDiscoveryScript({
      composerHints: [COMPOSER_SELECTOR],
      submitHints: [SEND_SELECTOR],
    }),
    pageContext(document),
  )

  assert.equal(result.composer.selector, COMPOSER_SELECTOR)
  assert.equal(result.send.selector, SEND_SELECTOR)
  assert.equal(result.send.method, 'provider_hint')
})

test('rejects an ambiguous accessible-name selector for the selected Gemini composer', () => {
  const hiddenComposer = element({
    tagName: 'DIV',
    attributes: {
      'aria-label': 'Enter a prompt here',
      contenteditable: 'true',
      role: 'textbox',
    },
    className: 'ql-editor hidden-editor',
    rect: { left: 100, top: 500, width: 0, height: 0 },
  })
  const visibleComposer = element({
    tagName: 'DIV',
    attributes: {
      'aria-label': 'Enter a prompt here',
      contenteditable: 'true',
      role: 'textbox',
    },
    className: 'ql-editor active-editor',
    rect: { left: 100, top: 500, width: 600, height: 100 },
  })
  const geminiSelector = 'div.ql-editor.active-editor[contenteditable="true"]'
  const ariaSelector = '[aria-label="Enter a prompt here"]'
  const document = documentFor(new Map([
    [ariaSelector, [hiddenComposer, visibleComposer]],
    [geminiSelector, [visibleComposer]],
  ]))

  const result = vm.runInNewContext(
    buildDiscoveryScript({ composerHints: [geminiSelector, ariaSelector] }),
    pageContext(document),
  )

  assert.equal(result.composer.method, 'provider_hint')
  assert.equal(result.composer.selector, geminiSelector)
})

test('discovery reports the DeepSeek class-disabled send control as disabled', () => {
  const composer = element({
    tagName: 'TEXTAREA',
    attributes: { placeholder: 'Message DeepSeek' },
    value: 'hello',
    rect: { left: 100, top: 500, width: 600, height: 100 },
  })
  const send = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className:
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const document = documentFor(new Map([
    [COMPOSER_SELECTOR, [composer]],
    [SEND_SELECTOR, [send]],
  ]))

  const result = vm.runInNewContext(
    buildDiscoveryScript({
      composerHints: [COMPOSER_SELECTOR],
      submitHints: [SEND_SELECTOR],
    }),
    pageContext(document),
  )

  assert.equal(result.send.selector, SEND_SELECTOR)
  assert.equal(result.send.disabled, true)
  assert.equal(result.send.enabled, false)
})

test('actionability waits while DeepSeek keeps the send control class-disabled', () => {
  const disabledSend = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className:
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const document = documentFor(new Map([[SEND_SELECTOR, [disabledSend]]]))

  const result = vm.runInNewContext(
    buildActionabilityScript({
      composerFp: null,
      sendFp: null,
      composerSelector: null,
      sendSelector: SEND_SELECTOR,
    }),
    pageContext(document),
  )

  assert.equal(result.hasSend, true)
  assert.equal(result.send.disabled, true)
  assert.equal(result.send.actionable, false)
})

test('actionability re-queries the enabled anonymous React control through the provider selector', () => {
  const enabledReplacement = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className: 'ds-button ds-button--primary ds-button--filled ds-button--circle',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const document = documentFor(new Map([[SEND_SELECTOR, [enabledReplacement]]]))

  const result = vm.runInNewContext(
    buildActionabilityScript({
      composerFp: null,
      sendFp: {
        tag: 'DIV',
        className: 'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled',
      },
      composerSelector: null,
      sendSelector: SEND_SELECTOR,
    }),
    pageContext(document),
  )

  assert.equal(result.hasSend, true)
  assert.equal(result.send.connected, true)
  assert.equal(result.send.disabled, false)
  assert.equal(result.send.actionable, true)
})

test('final click guard rejects a DeepSeek class-disabled send control', () => {
  const disabledSend = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className:
      'ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--disabled',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const document = documentFor(new Map([[SEND_SELECTOR, [disabledSend]]]))

  const result = vm.runInNewContext(
    buildClickSendScript({
      sendFp: null,
      sendSelector: SEND_SELECTOR,
    }),
    pageContext(document),
  )

  assert.equal(result.ok, false)
  assert.equal(result.code, 'send_not_actionable')
  assert.equal(result.clickable, false)
  assert.equal(result.diagnostics.disabled, true)
})

test('send readiness wakes on React replacement instead of polling', async () => {
  const disabledSend = element({
    tagName: 'DIV',
    attributes: { role: 'button' },
    className: 'ds-button ds-button--disabled',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const enabledSend = element({
    tagName: 'DIV',
    attributes: { role: 'button', 'aria-label': 'Send message' },
    className: 'ds-button',
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const selectors = new Map([[SEND_SELECTOR, [disabledSend]]])
  const harness = observerHarness(documentFor(selectors))
  const pending = vm.runInContext(
    buildWaitForActionableSendScript({
      waiterId: 'replacement',
      sendSelectors: [SEND_SELECTOR],
      timeoutMs: 100,
      readyStableMs: 1,
    }),
    harness.context,
  )

  disabledSend.isConnected = false
  selectors.set(SEND_SELECTOR, [enabledSend])
  harness.mutate()
  const result = await pending

  assert.equal(result.ready, true)
  assert.equal(result.selector, SEND_SELECTOR)
  assert.equal(harness.disconnects(), 1)
})

test('send readiness cancellation disconnects without clicking', async () => {
  const disabledSend = element({
    tagName: 'DIV',
    attributes: { role: 'button', 'aria-disabled': 'true' },
    rect: { left: 650, top: 530, width: 40, height: 40 },
  })
  const harness = observerHarness(documentFor(new Map([[SEND_SELECTOR, [disabledSend]]])))
  const pending = vm.runInContext(
    buildWaitForActionableSendScript({
      waiterId: 'cancelled',
      sendSelectors: [SEND_SELECTOR],
      timeoutMs: 1000,
      readyStableMs: 1,
    }),
    harness.context,
  )
  const cancelled = vm.runInContext(
    buildCancelActionableSendWaitScript('cancelled'),
    harness.context,
  )
  const result = await pending

  assert.equal(cancelled, true)
  assert.equal(result.ready, false)
  assert.equal(result.cancelled, true)
  assert.equal(harness.disconnects(), 1)
})

function element({
  tagName,
  attributes = {},
  className = '',
  value = '',
  rect,
}) {
  return {
    tagName,
    id: '',
    className,
    value,
    innerText: '',
    textContent: '',
    disabled: false,
    isConnected: true,
    isContentEditable: false,
    ownerDocument: null,
    getAttribute(name) {
      if (name === 'class') return className || null
      return attributes[name] ?? null
    },
    getBoundingClientRect() {
      return {
        x: rect.left,
        y: rect.top,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        ...rect,
      }
    },
    closest() {
      return null
    },
    focus() {},
  }
}

function documentFor(selectorMap) {
  const all = [...new Set([...selectorMap.values()].flat())]
  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'button, [role="button"], input[type="submit"]') {
        return all.filter((item) => item.getAttribute('role') === 'button')
      }
      if (
        selector ===
        'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [role="textbox"]'
      ) {
        return all.filter((item) => item.tagName === 'TEXTAREA')
      }
      return selectorMap.get(selector) ?? []
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    },
    getElementById() {
      return null
    },
  }
  for (const item of all) item.ownerDocument = document
  return document
}

function observerHarness(document) {
  let callback = null
  let disconnectCount = 0
  class MutationObserver {
    constructor(next) {
      callback = next
    }
    observe() {}
    disconnect() {
      disconnectCount += 1
    }
  }
  return {
    context: vm.createContext({
      ...pageContext(document),
      MutationObserver,
      Map,
      setTimeout,
      clearTimeout,
    }),
    mutate() {
      callback?.([])
    },
    disconnects() {
      return disconnectCount
    },
  }
}

function pageContext(document) {
  const getComputedStyle = () => ({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    pointerEvents: 'auto',
  })
  return {
    document,
    innerHeight: 900,
    innerWidth: 1400,
    getComputedStyle,
    window: { getComputedStyle },
    CSS: { escape: (value) => value },
    Set,
  }
}
