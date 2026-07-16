import assert from 'node:assert/strict'
import test from 'node:test'
import { observeNextAssistantResponse } from './extraction/response-observer.js'
import { createExtractionCoordinator } from './extraction/extraction-coordinator.js'
import { injectAndExtract } from './extraction/prompt-extraction.js'

class Element {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.textContent = text; this.innerText = text; this.children = []; this.parentElement = null }
  append(child) { child.parentElement = this; this.children.push(child) }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)) }
  querySelectorAll(selector) { return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]).filter((node) => selector === '*' || node.tagName.toLowerCase() === selector) }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
  getAttribute() { return null }
}

test('cancelled extraction releases its session immediately and stale completion cannot delete its replacement', async () => {
  const releases = []
  const coordinator = createExtractionCoordinator({
    sendTabMessage: (_tabId, message) => message.type === 'extraction.cancel.v2'
      ? Promise.resolve({ ok: true })
      : new Promise((resolve) => releases.push(resolve)),
  })
  const session = { browserSessionId: 'browser-1', tabId: 7, origin: 'https://chat.example' }
  const first = coordinator.start({ requestId: 'old', session, profile: {}, text: 'old' })
  assert.equal(coordinator.cancelBySessionId(session.browserSessionId), true)
  const replacement = coordinator.start({ requestId: 'new', session, profile: {}, text: 'new' })
  releases[0]({ ok: false, code: 'cancelled', error: 'cancelled' })
  await assert.rejects(first, { code: 'cancelled' })
  await assert.rejects(
    coordinator.start({ requestId: 'third', session, profile: {}, text: 'third' }),
    { code: 'session_busy' },
  )
  releases[1]({ ok: true, result: { text: 'done' } })
  assert.equal((await replacement).result.text, 'done')
})

test('one issued click may use the correlated response when DOM submission evidence is weak', async () => {
  const expected = { text: '{"type":"assistant_text"}', completionSignals: ['new_assistant_turn'] }
  const result = await injectAndExtract({
    document: {}, profile: { responseCalibration: {} }, text: 'prompt', signal: new AbortController().signal,
    inject: async () => { throw Object.assign(new Error('weak evidence'), { code: 'submission_timeout', evidence: { clickCount: 1 } }) },
    observe: () => ({ promise: Promise.resolve(expected) }),
  })
  assert.deepEqual(result, {
    ...expected,
    submission: { verification: 'correlated_response', evidence: { clickCount: 1 } },
  })
})

test('weak submission evidence without an issued click still fails extraction', async () => {
  await assert.rejects(injectAndExtract({
    document: {}, profile: { responseCalibration: {} }, text: 'prompt', signal: new AbortController().signal,
    inject: async () => { throw Object.assign(new Error('not clicked'), { code: 'submission_timeout', evidence: { clickCount: 0 } }) },
    observe: () => ({ promise: new Promise(() => {}) }),
  }), { message: 'not clicked' })
})

test('observes one new assistant turn, waits for stable text, and disconnects', async () => {
  let notify
  let disconnected = false
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() { disconnected = true } }
  const root = new Element('main')
  const oldTurn = new Element('article'); oldTurn.append(new Element('p', 'old')) ; root.append(oldTurn)
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 5, timeoutMs: 100, MutationObserver: Observer })
  const next = new Element('article'); next.append(new Element('p', 'hello')); root.append(next)
  notify([{ target: next }])
  const result = await observation.promise
  assert.equal(result.text, 'hello')
  assert.equal(disconnected, true)
})

test('re-resolves the calibrated conversation root after provider navigation', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const oldRoot = new Element('main')
  let currentRoot = oldRoot
  const document = {
    querySelectorAll: (selector) => selector === 'main' ? [currentRoot] : [],
    defaultView: { MutationObserver: Observer },
  }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, stableMs: 5, timeoutMs: 100, MutationObserver: Observer,
  })
  currentRoot = new Element('main')
  const next = new Element('article'); next.append(new Element('p', 'after navigation')); currentRoot.append(next)
  notify([{ target: currentRoot }])
  assert.equal((await observation.promise).text, 'after navigation')
})

test('ignores a newly inserted user prompt before observing the assistant response', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: 'question', stableMs: 5, timeoutMs: 100, MutationObserver: Observer,
  })
  const user = new Element('article'); user.append(new Element('p', 'question')); root.append(user)
  notify([{ target: user }])
  const assistant = new Element('article'); assistant.append(new Element('p', 'answer')); root.append(assistant)
  notify([{ target: assistant }])
  assert.equal((await observation.promise).text, 'answer')
})

test('extracts every calibrated paragraph in the assistant response region', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 5, timeoutMs: 100, MutationObserver: Observer })
  const turn = new Element('article')
  const content = new Element('div')
  content.append(new Element('p', 'first paragraph'))
  content.append(new Element('p', 'second paragraph'))
  content.innerText = content.textContent = 'first paragraph\n\nsecond paragraph'
  turn.append(content)
  root.append(turn)
  notify([{ target: turn }])
  assert.equal((await observation.promise).text, 'first paragraph\n\nsecond paragraph')
})

test('does not finalize during a paragraph pause while generation is active', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const send = new Element('button')
  send.isConnected = true
  send.disabled = false
  send.getBoundingClientRect = () => ({ width: 20, height: 20 })
  send.getAttribute = (name) => name === 'data-testid' ? 'send' : null
  const document = {
    querySelectorAll: (selector) => selector === 'main' ? [root] : selector === 'button[data-testid="send"]' ? [send] : [],
    defaultView: { MutationObserver: Observer, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
  }
  send.ownerDocument = document
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const sendFingerprint = {
    version: 1, tagName: 'button', attributes: { 'data-testid': 'send' }, primarySelector: 'button[data-testid="send"]', fallbackSelectors: [], ancestorChain: [],
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, sendFingerprint, stableMs: 50, completionStableMs: 2, sendPollMs: 2, timeoutMs: 200, MutationObserver: Observer,
  })
  const turn = new Element('article')
  const content = new Element('div')
  const first = new Element('p', 'first paragraph')
  content.append(first); content.innerText = content.textContent = 'first paragraph'; turn.append(content); root.append(turn)
  send.disabled = true
  notify([{ target: turn }])
  const premature = await Promise.race([observation.promise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 25))])
  assert.equal(premature, false)
  const second = new Element('p', 'second paragraph')
  content.append(second); content.innerText = content.textContent = 'first paragraph\n\nsecond paragraph'
  notify([{ target: second }])
  send.disabled = false
  assert.equal((await observation.promise).text, 'first paragraph\n\nsecond paragraph')
})

test('falls back to bounded text stability when an empty composer does not restore Send', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 100, MutationObserver: Observer })
  const turn = new Element('article'); turn.append(new Element('p', 'complete answer')); root.append(turn)
  notify([{ target: turn }])
  assert.equal((await observation.promise).text, 'complete answer')
})

test('does not finalize a stable JSON prefix while composer controls show generation', async () => {
  let notify
  let controlLabel = 'Voice mode'
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const form = new Element('form')
  const composer = new Element('textarea')
  composer.getAttribute = (name) => name === 'data-testid' ? 'composer' : null
  composer.closest = (selector) => selector === 'form' ? form : null
  const control = new Element('button')
  control.getAttribute = (name) => name === 'aria-label' ? controlLabel : null
  form.querySelectorAll = () => [control]
  const document = {
    querySelectorAll: (selector) => {
      if (selector === 'main') return [root]
      if (selector === 'textarea[data-testid="composer"]') return [composer]
      return []
    },
    defaultView: { MutationObserver: Observer },
  }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const composerFingerprint = {
    version: 1, tagName: 'textarea', attributes: { 'data-testid': 'composer' },
    primarySelector: 'textarea[data-testid="composer"]', fallbackSelectors: [], ancestorChain: [],
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, composerFingerprint,
    stableMs: 10, completionStableMs: 2, sendPollMs: 2, timeoutMs: 200, MutationObserver: Observer,
  })
  controlLabel = 'Stop streaming'
  await new Promise((resolve) => setTimeout(resolve, 5))
  const turn = new Element('article')
  const content = new Element('div')
  const paragraph = new Element('p', '{"')
  content.append(paragraph); content.innerText = content.textContent = '{"'; turn.append(content); root.append(turn)
  notify([{ target: turn }])
  const premature = await Promise.race([
    observation.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 25)),
  ])
  assert.equal(premature, false)
  paragraph.innerText = paragraph.textContent = '{"schemaVersion":1}'
  content.innerText = content.textContent = '{"schemaVersion":1}'
  controlLabel = 'Voice mode'
  notify([{ target: paragraph }])
  assert.equal((await observation.promise).text, '{"schemaVersion":1}')
})

test('does not finalize an incomplete JSON prefix before generation controls appear', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer,
  })
  const turn = new Element('article')
  const content = new Element('p', '{"')
  turn.append(content); root.append(turn); notify([{ target: turn }])
  const premature = await Promise.race([
    observation.promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 25)),
  ])
  assert.equal(premature, false)
  content.innerText = content.textContent = '{"schemaVersion":1}'
  notify([{ target: content }])
  assert.equal((await observation.promise).text, '{"schemaVersion":1}')
})

test('uses the calibrated assistant turn when its inner anchor remains an incomplete JSON fragment', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer })
  const complete = '{"schemaVersion":1,"type":"assistant_text"}'
  const turn = new Element('article', complete)
  turn.append(new Element('p', '{"'))
  root.append(turn); notify([{ target: turn }])
  assert.equal((await observation.promise).text, complete)
})

test('returns a stable malformed JSON response after the bounded completion gate', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, stableMs: 5, maxCompletionGateMs: 10, timeoutMs: 100, MutationObserver: Observer,
  })
  const turn = new Element('article'); turn.append(new Element('p', '{"broken"'))
  root.append(turn); notify([{ target: turn }])
  assert.equal((await observation.promise).text, '{"broken"')
})

test('widens an incomplete JSON turn to the nearest longer ancestor inside the conversation root', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer })
  const complete = '{"schemaVersion":1,"type":"assistant_text"}'
  const wrapper = new Element('section', complete)
  const turn = new Element('article', '{"')
  turn.append(new Element('p', '{"'))
  wrapper.append(turn); root.append(wrapper); notify([{ target: wrapper }])
  assert.equal((await observation.promise).text, complete)
})

test('widens an incomplete JSON fragment when provider layout text does not preserve its exact prefix', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer })
  const complete = 'controls\n{"schemaVersion":1,"type":"assistant_text"}'
  const wrapper = new Element('section', complete)
  const turn = new Element('article', '{"')
  turn.append(new Element('p', '{"'))
  wrapper.append(turn); root.append(wrapper); notify([{ target: wrapper }])
  assert.equal((await observation.promise).text, complete)
})

test('falls back to the calibrated assistant turn when JSON rendering removes the inner content selector', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer })
  const complete = '{"schemaVersion":1,"type":"assistant_text","content":"TETHER_INSTALL_OK"}'
  const turn = new Element('article', complete)
  turn.append(new Element('code', complete))
  root.append(turn); notify([{ target: turn }])
  assert.equal((await observation.promise).text, complete)
})

test('does not treat React replacements of baseline turns as a new assistant response', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const oldText = '{"schemaVersion":1,"type":"assistant_text","requestId":"old"}'
  const oldTurn = new Element('article', oldText); oldTurn.append(new Element('code', oldText)); root.append(oldTurn)
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({ document, responseCalibration: calibration, stableMs: 8, timeoutMs: 150, MutationObserver: Observer })
  const replacement = new Element('article', oldText); replacement.append(new Element('code', oldText))
  root.children[0] = replacement; replacement.parentElement = root
  const currentText = '{"schemaVersion":1,"type":"assistant_text","requestId":"current"}'
  const currentTurn = new Element('article', currentText); currentTurn.append(new Element('code', currentText)); root.append(currentTurn)
  notify([{ target: root }])
  assert.equal((await observation.promise).text, currentText)
})

test('extracts the current correlated envelope after its nested prompt example', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const reply = { schemaVersion: 1, type: 'assistant_text', requestId: 'install.0', content: 'TETHER_INSTALL_OK' }
  const prompt = JSON.stringify({ schemaVersion: 1, type: 'tether_install', requestId: 'install.0', replyExactly: reply })
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: prompt, stableMs: 8, timeoutMs: 150, MutationObserver: Observer,
  })
  root.append(new Element('div', prompt))
  root.append(new Element('article', JSON.stringify(reply)))
  root.textContent = `${prompt} ${JSON.stringify(reply)}`
  notify([{ target: root }])
  assert.equal((await observation.promise).text, JSON.stringify(reply))
})

test('extracts correlated JSON containing browser-inserted zero-width word breaks', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const requestId = 'tether-long-install.6'
  const prompt = `Current request: {"requestId":"${requestId}"}`
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: prompt,
    stableMs: 5, timeoutMs: 100, MutationObserver: Observer,
  })
  const responseText = `{"schemaVersion":1,"type":"assistant_text","requestId":"tether-long-\u200Binstall.6","content":"TETHER_INSTALL_OK"}`
  const response = new Element('article', responseText)
  root.append(response)
  root.textContent = responseText
  notify([{ addedNodes: [response] }])
  assert.equal(JSON.parse((await observation.promise).text).content, 'TETHER_INSTALL_OK')
})

test('unrelated React mutations do not restart correlated response stability forever', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const requestId = 'install.3'
  const responseText = JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId, content: 'TETHER_INSTALL_OK' })
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: `{"requestId":"${requestId}"}`,
    stableMs: 12, timeoutMs: 100, MutationObserver: Observer,
  })
  root.append(new Element('article', responseText)); root.textContent = responseText
  notify([{ target: root }])
  for (let index = 0; index < 5; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 4))
    notify([{ target: root, type: 'attributes' }])
  }
  assert.equal((await observation.promise).text, responseText)
})

test('does not finalize the submitted protocol prompt before its correlated response arrives', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const reply = { schemaVersion: 1, type: 'assistant_text', requestId: 'install.1', content: 'TETHER_INSTALL_OK' }
  const prompt = JSON.stringify({ schemaVersion: 1, type: 'tether_install', requestId: 'install.1', replyExactly: reply })
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: prompt, stableMs: 5, timeoutMs: 100, MutationObserver: Observer,
  })
  root.textContent = prompt
  const browserFormattedPrompt = prompt.replace('install.1', 'install.\u200b1')
  root.append(new Element('article', `${JSON.stringify({ schemaVersion: 1, type: 'assistant_text', requestId: 'old', content: 'OLD' })} ${browserFormattedPrompt}`)); notify([{ target: root }])
  await new Promise((resolve) => setTimeout(resolve, 12))
  root.textContent = `${prompt} ${JSON.stringify(reply)}`
  root.append(new Element('article', JSON.stringify(reply))); notify([{ target: root }])
  assert.equal((await observation.promise).text, JSON.stringify(reply))
})

test('does not extract a response-contract example from the prompt when the new assistant turn is plain text', async () => {
  let notify
  class Observer { constructor(callback) { notify = callback } observe() {} disconnect() {} }
  const root = new Element('main')
  const old = new Element('article', 'old response'); root.append(old)
  const document = { querySelectorAll: (selector) => selector === 'main' ? [root] : [], defaultView: { MutationObserver: Observer } }
  const calibration = {
    conversationRoot: { tagName: 'main', attributes: {}, primarySelector: 'main', fallbackSelectors: [], ancestorChain: [] },
    assistantTurn: { primarySelector: 'article' },
    assistantContent: { primarySelector: 'p' },
  }
  const requestId = 'turn-with-contract'
  const example = { schemaVersion: 1, type: 'tool_schema_request', requestId, tools: [{ name: '<offered tool>' }] }
  const prompt = JSON.stringify({ requestId, responseContract: { toolSchemaRequest: example } })
  const observation = observeNextAssistantResponse({
    document, responseCalibration: calibration, expectedPrompt: prompt, stableMs: 5, timeoutMs: 100, MutationObserver: Observer,
  })
  const response = new Element('article', 'ALPHA TETHER\nBETA BROWSER\nGAMMA CODEX')
  root.append(response)
  root.textContent = `${prompt} ${response.textContent}`
  notify([{ target: root }])
  assert.equal((await observation.promise).text, response.textContent)
})
