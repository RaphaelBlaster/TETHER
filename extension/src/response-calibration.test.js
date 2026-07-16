import assert from 'node:assert/strict'
import test from 'node:test'

import { inferGuidedResponseStructure, inferResponseStructure } from './response-calibration/structure-inference.js'
import { startMarkerCapture } from './response-calibration/marker-capture.js'
import { findCalibrationCaptureRoot, runResponseCalibration } from './response-calibration/response-calibration-runner.js'
import { createResponseCalibrationSession } from './response-calibration/response-calibration-session.js'

class FixtureElement {
  constructor(tagName, attributes = {}, textContent = '') {
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
    this.textContent = textContent
    this.children = []
    this.parentElement = null
    this.isConnected = true
    this.innerText = textContent
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
    this.refreshText()
  }

  refreshText() {
    if (this.children.length) this.textContent = this.children.map((child) => child.textContent).join(' ')
    this.parentElement?.refreshText()
  }

  contains(element) {
    return element === this || this.children.some((child) => child.contains(element))
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')])
    if (selector === '*') return descendants
    return descendants.filter((element) => matches(element, selector))
  }
}

function matches(element, selector) {
  const match = selector.match(/^([a-z0-9-]+)(?:\[([^=]+)="([^"]*)"\])?$/i)
  if (!match || element.tagName.toLowerCase() !== match[1].toLowerCase()) return false
  return !match[2] || element.getAttribute(match[2]) === match[3]
}

function responseFixture() {
  const document = new FixtureElement('html')
  const conversation = new FixtureElement('main', { 'data-testid': 'conversation' })
  document.append(conversation)
  const samples = []
  for (let index = 1; index <= 3; index += 1) {
    const marker = `TETHER_CALIBRATION_fixture_${index}`
    const prompt = `Reply only with: ${marker}`
    const userTurn = new FixtureElement('article', { 'data-message-author-role': 'user' })
    const userContent = new FixtureElement('div', { 'data-testid': 'message-content' }, prompt)
    userTurn.append(userContent)
    const assistantTurn = new FixtureElement('article', { 'data-message-author-role': 'assistant' })
    const assistantContent = new FixtureElement('div', { 'data-testid': 'message-content' }, marker)
    assistantTurn.append(assistantContent)
    conversation.append(userTurn, assistantTurn)
    samples.push({ marker, prompt, content: assistantContent, userContent })
  }
  return { document, samples }
}

test('infers a shared root and assistant-only turn/content fingerprints from three samples', () => {
  const { document, samples } = responseFixture()
  const inferred = inferResponseStructure({ document, samples })
  assert.equal(inferred.version, 1)
  assert.equal(inferred.sampleCount, 3)
  assert.equal(inferred.conversationRoot.primarySelector, 'main[data-testid="conversation"]')
  assert.equal(inferred.assistantTurn.primarySelector, 'article[data-message-author-role="assistant"]')
  assert.equal(inferred.assistantContent.primarySelector, 'div[data-testid="message-content"]')
})

test('rejects a turn selector that cannot exclude submitted user turns', () => {
  const { document, samples } = responseFixture()
  for (const sample of samples) {
    sample.content.parentElement.attributes = {}
    sample.userContent.parentElement.attributes = {}
  }
  assert.throws(
    () => inferResponseStructure({ document, samples }),
    { code: 'assistant_turn_ambiguous' },
  )
})

test('guided fallback maps one selected assistant boundary across all captured samples', () => {
  const { document, samples } = responseFixture()
  for (const sample of samples) {
    sample.content.parentElement.attributes = {}
    sample.userContent.parentElement.attributes = {}
  }
  const inferred = inferGuidedResponseStructure({
    document,
    samples,
    selectedTurn: samples.at(-1).content.parentElement,
  })
  assert.equal(inferred.inferenceMode, 'guided')
  assert.equal(inferred.assistantTurn.resolution, 'content_ancestor')
  assert.equal(inferred.assistantTurn.ancestorDepth, 1)
})

test('guided fallback rejects a boundary that also contains the submitted prompt', () => {
  const { document, samples } = responseFixture()
  assert.throws(
    () => inferGuidedResponseStructure({ document, samples, selectedTurn: document.children[0] }),
    { code: 'guided_turn_contains_prompt' },
  )
})

test('uses a stable semantic ancestor when the narrow response list is anonymous', () => {
  const { document, samples } = responseFixture()
  const main = document.children[0]
  const anonymousList = new FixtureElement('div')
  const turns = [...main.children]
  main.children = []
  main.append(anonymousList)
  anonymousList.append(...turns)
  const inferred = inferResponseStructure({ document, samples })
  assert.equal(inferred.conversationRoot.primarySelector, 'main[data-testid="conversation"]')
  assert.equal(inferred.assistantTurn.primarySelector, 'article[data-message-author-role="assistant"]')
})

test('finds a nested assistant-role boundary when direct conversation branches are anonymous', () => {
  const { document, samples } = responseFixture()
  const conversation = document.children[0]
  const originalTurns = [...conversation.children]
  conversation.children = []
  for (const turn of originalTurns) {
    const outer = new FixtureElement('section')
    outer.append(turn)
    conversation.append(outer)
  }
  const inferred = inferResponseStructure({ document, samples })
  assert.equal(inferred.assistantTurn.primarySelector, 'article[data-message-author-role="assistant"]')
  assert.equal(inferred.assistantContent.primarySelector, 'div[data-testid="message-content"]')
})

test('uses unique semantic tags for otherwise anonymous response content and roots', () => {
  const { document, samples } = responseFixture()
  const conversation = document.children[0]
  conversation.attributes = {}
  for (const sample of samples) {
    sample.content.attributes = {}
    sample.content.tagName = 'P'
  }
  const inferred = inferResponseStructure({ document, samples })
  assert.equal(inferred.conversationRoot.primarySelector, 'main')
  assert.equal(inferred.assistantContent.primarySelector, 'p')
})

test('temporary response capture falls back to body rather than a composer-only ancestor', () => {
  const body = {}
  const composer = { closest: () => null, ownerDocument: { body } }
  assert.equal(findCalibrationCaptureRoot(composer), body)
})

test('marker capture resolves after exact marker stability and disconnects', async () => {
  let notify
  let disconnected = false
  class FakeObserver {
    constructor(callback) { notify = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const marker = new FixtureElement('p', {}, 'TETHER_CALIBRATION_fixture_1')
  const prompt = new FixtureElement('p', {}, 'Reply only with: TETHER_CALIBRATION_fixture_1')
  const root = new FixtureElement('main')
  const capture = startMarkerCapture({
    root,
    marker: marker.textContent,
    prompt: prompt.textContent,
    MutationObserver: FakeObserver,
    stableMs: 5,
    timeoutMs: 100,
    scheduleFrame(callback) { callback(); return 1 },
    cancelFrame() {},
  })
  root.append(prompt, marker)
  notify([])
  const result = await capture.promise
  assert.equal(result.content, marker)
  assert.equal(result.userContent, prompt)
  assert.equal(disconnected, true)
})

test('runner injects and captures exactly three correlated marker turns in sequence', async () => {
  const events = []
  const samples = []
  const inferred = { version: 1, sampleCount: 3 }
  const response = await runResponseCalibration({
    document: {},
    profile: {},
    requestId: 'response-run-abc123',
    resolveControls: () => ({ validation: { valid: true }, composer: {} }),
    findRoot: () => ({}),
    inject: async ({ text }) => events.push(['inject', text]),
    startCapture: ({ marker, prompt }) => ({
      promise: Promise.resolve({ marker, prompt, content: { isConnected: true }, userContent: { isConnected: true } }),
      cancel() {},
    }),
    infer: ({ samples: captured }) => {
      samples.push(...captured)
      return inferred
    },
    onProgress: (state) => events.push(['progress', state.stage, state.turn]),
  })
  assert.equal(response, inferred)
  assert.equal(samples.length, 3)
  assert.deepEqual(samples.map((sample) => sample.marker), [
    'TETHER_CALIBRATION_responserunabc123_1',
    'TETHER_CALIBRATION_responserunabc123_2',
    'TETHER_CALIBRATION_responserunabc123_3',
  ])
  assert.equal(events.filter(([type]) => type === 'inject').length, 3)
  assert.equal(events.at(-1)[1], 'validated')
})

test('runner re-resolves samples replaced by later provider renders before inference', async () => {
  const replacements = new Map()
  const captured = []
  await runResponseCalibration({
    document: {},
    profile: {},
    requestId: 'replace-run',
    resolveControls: () => ({ validation: { valid: true }, composer: {} }),
    findRoot: () => ({}),
    inject: async () => {},
    startCapture: ({ marker, prompt }) => {
      const oldContent = { isConnected: false }
      const oldUser = { isConnected: false }
      replacements.set(marker, { marker, isConnected: true })
      replacements.set(prompt, { prompt, isConnected: true })
      return { promise: Promise.resolve({ marker, prompt, content: oldContent, userContent: oldUser }), cancel() {} }
    },
    findExactText: (_document, text) => replacements.get(text),
    infer: ({ samples }) => {
      captured.push(...samples)
      return { version: 1 }
    },
  })
  assert.equal(captured.length, 3)
  assert.equal(captured.every((sample) => sample.content.isConnected && sample.userContent.isConnected), true)
})

function calibrationProfile() {
  const control = (tagName, selector) => ({
    version: 1,
    tagName,
    attributes: {},
    primarySelector: selector,
    fallbackSelectors: [],
    ancestorChain: [],
  })
  return {
    version: 1,
    origin: 'https://chat.example',
    composer: control('textarea', '#composer'),
    send: control('button', '#send'),
  }
}

function responseStructure() {
  const structural = (tagName, selector, expectedMatchCount = 1) => ({
    version: 1,
    tagName,
    attributes: {},
    primarySelector: selector,
    fallbackSelectors: [],
    expectedMatchCount,
  })
  return {
    version: 1,
    conversationRoot: { ...structural('main', 'main'), ancestorChain: [] },
    assistantTurn: structural('article', 'article[data-author="assistant"]', 3),
    assistantContent: structural('div', 'div[data-testid="content"]'),
    sampleCount: 3,
    calibratedAt: 123,
  }
}

test('response session is idempotent per request and rejects a different busy request', async () => {
  const sent = []
  const session = createResponseCalibrationSession({
    injectContentScript: async (tabId) => sent.push(['inject', tabId]),
    sendTabMessage: async (tabId, message) => { sent.push(['send', tabId, message.type]); return { ok: true } },
    loadProfiles: async () => ({ 'https://chat.example': calibrationProfile() }),
    saveProfiles: async () => {},
  })
  const input = {
    requestId: 'response-1',
    session: { browserSessionId: 'browser-1', tabId: 8, origin: 'https://chat.example' },
    profile: calibrationProfile(),
  }
  await session.start(input)
  await session.start(input)
  await assert.rejects(
    session.start({ ...input, requestId: 'response-2' }),
    { code: 'session_busy' },
  )
  assert.deepEqual(sent, [['inject', 8], ['send', 8, 'responseCalibration.start']])
})

test('response session saves only validated response structure and preserves control fingerprints', async () => {
  const original = calibrationProfile()
  let stored = { 'https://chat.example': original }
  const session = createResponseCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => stored,
    saveProfiles: async (profiles) => { stored = profiles },
  })
  await session.start({
    requestId: 'response-1',
    session: { browserSessionId: 'browser-1', tabId: 8, origin: 'https://chat.example' },
    profile: original,
  })
  await session.handlePageState({
    browserSessionId: 'browser-1',
    requestId: 'response-1',
    stage: 'complete',
    responseCalibration: responseStructure(),
  }, 8)
  assert.equal(stored['https://chat.example'].composer, original.composer)
  assert.equal(stored['https://chat.example'].send, original.send)
  assert.equal(stored['https://chat.example'].responseCalibration.sampleCount, 3)
  assert.equal(session.getBySessionId('browser-1').stage, 'complete')
})

test('wrong-tab progress cannot mutate a response calibration operation', async () => {
  const session = createResponseCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({ 'https://chat.example': calibrationProfile() }),
    saveProfiles: async () => {},
  })
  await session.start({
    requestId: 'response-1',
    session: { browserSessionId: 'browser-1', tabId: 8, origin: 'https://chat.example' },
    profile: calibrationProfile(),
  })
  await session.handlePageState({
    browserSessionId: 'browser-1', requestId: 'response-1', stage: 'marker_captured', turn: 2,
  }, 9)
  assert.equal(session.getBySessionId('browser-1').stage, 'starting')
  assert.equal(session.getBySessionId('browser-1').turn, 0)
})
