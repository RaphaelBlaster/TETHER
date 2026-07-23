import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createBrowserAutomation } from './automation/browser-automation.js'
import { buildExtractAssistantScript } from './automation/response-observer.js'

const TINKER_ORIGIN = 'https://tinker.thinkingmachines.ai'
const TINKER_TURN =
  'article:has(button[aria-label="View raw"]):has(button[aria-label="Copy request ID"])'

function control(tagName, primarySelector, attributes) {
  return {
    version: 1,
    tagName,
    attributes,
    primarySelector,
    fallbackSelectors: [],
    ancestorChain: [],
  }
}

function structural(tagName, primarySelector, expectedMatchCount = 1) {
  return {
    version: 1,
    tagName,
    attributes: {},
    primarySelector,
    fallbackSelectors: [],
    expectedMatchCount,
  }
}

function tinkerCalibration() {
  return {
    version: 1,
    origin: TINKER_ORIGIN,
    composer: control('textarea', 'textarea[aria-label="Message"]', {
      'aria-label': 'Message',
      placeholder: 'Start typing...',
    }),
    send: control('button', 'button[aria-label="Send message"]', {
      'aria-label': 'Send message',
    }),
    responseCalibration: {
      version: 1,
      sampleCount: 3,
      conversationRoot: {
        ...structural('main', 'main[data-testid="tinker-conversation"]'),
        ancestorChain: [],
      },
      assistantTurn: structural('article', TINKER_TURN, 3),
      assistantContent: structural('p', 'p'),
    },
  }
}

test('saved control and response calibration reach the direct-CDP scripts', async () => {
  const expressions = []
  const transport = {
    attach: async () => {},
    detach: async () => {},
    sendCommand: async (_tabId, method, params = {}) => {
      if (method !== 'Runtime.evaluate') return {}
      expressions.push(params.expression)
      if (expressions.length === 1) {
        return {
          result: {
            value: {
              url: `${TINKER_ORIGIN}/playground`,
              userCount: 0,
              assistantCount: 0,
              userTexts: [],
              assistantTexts: [],
              composerText: '',
              composerLength: 0,
            },
          },
        }
      }
      throw Object.assign(new Error('stop after discovery capture'), { code: 'test_stop' })
    },
  }
  const automation = createBrowserAutomation({
    transport,
    calibrationStore: { get: async () => tinkerCalibration() },
  })

  await assert.rejects(
    automation.request({
      requestId: 'tinker-calibration-wiring',
      browserSessionId: 'tinker-session',
      extensionInstanceId: 'test-extension',
      tabId: 42,
      origin: TINKER_ORIGIN,
      providerId: `site:${TINKER_ORIGIN}`,
      prompt: 'hello',
    }),
    /stop after discovery capture/,
  )

  assert.match(expressions[0], /Copy request ID/)
  assert.match(expressions[1], /textarea\[aria-label=\\?"Message\\?"\]/)
  assert.match(expressions[1], /button\[aria-label=\\?"Send message\\?"\]/)
})

test('Tinker fixture extraction returns only the final answer while generation is active', async () => {
  const fixture = await readFile(new URL('./fixtures/tinker-playground.html', import.meta.url), 'utf8')
  assert.match(fixture, /TETHER user prompt that must never be returned/)
  assert.match(fixture, /Thought: private reasoning that must never be returned/)
  assert.match(fixture, /TINKER_FINAL_ANSWER_ONLY/)

  const finalContent = fixture.match(/<p>(TINKER_FINAL_ANSWER_ONLY)<\/p>/)?.[1]
  const contentNode = textNode(finalContent)
  const finalTurn = elementNode('final turn', new Map([['p', [contentNode]]]))
  const selectorMap = new Map([
    [TINKER_TURN, [finalTurn]],
    ['button[aria-label="Stop generating"]', [elementNode('Stop')]],
    ['[role="status"]', [elementNode('Response in progress')]],
  ])
  const document = {
    querySelectorAll: (selector) => selectorMap.get(selector) ?? [],
    querySelector: (selector) => (selectorMap.get(selector) ?? [])[0] ?? null,
  }
  const script = buildExtractAssistantScript({
    baseline: {
      assistantCount: 0,
      assistantTexts: [],
      assistantSelectors: [TINKER_TURN],
    },
    response: {
      turnSelectors: [TINKER_TURN],
      contentSelectors: ['p'],
      excludeSelectors: ['[data-slot="collapsible"]'],
    },
    stopHints: ['button[aria-label="Stop generating"]'],
    progressHints: ['[role="status"]'],
  })
  const result = vm.runInNewContext(script, { document, Set })

  assert.equal(result.found, true)
  assert.equal(result.text, 'TINKER_FINAL_ANSWER_ONLY')
  assert.equal(result.streaming, true)
  assert.doesNotMatch(result.text, /TETHER user prompt|Thought:/)
})

function textNode(text) {
  return elementNode(text)
}

function elementNode(text, queries = new Map()) {
  return {
    innerText: text,
    textContent: text,
    querySelectorAll: (selector) => queries.get(selector) ?? [],
    cloneNode() {
      return {
        innerText: text,
        textContent: text,
        querySelectorAll: () => [],
      }
    },
  }
}
