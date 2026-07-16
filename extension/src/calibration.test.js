import assert from 'node:assert/strict'
import test from 'node:test'

import { createCalibrationController } from './calibration/calibration-controller.js'
import { requestCalibrationAccess } from './calibration/calibration-access.js'
import { createFingerprint, resolveFingerprint } from './calibration/element-fingerprint.js'
import { createElementInspector } from './calibration/element-inspector.js'
import { createCalibrationSession } from './calibration/calibration-session.js'
import { normalizeCalibrationTarget } from './calibration/target-normalizer.js'
import { SIDE_PANEL_PORT, registerSidePanelConnection } from './calibration/panel-lifecycle.js'

class FakeElement {
  constructor(tagName, attributes = {}, parentElement = null) {
    this.tagName = tagName.toUpperCase()
    this.attributes = attributes
    this.parentElement = parentElement
    this.innerText = attributes.innerText ?? ''
    this.isContentEditable = attributes.contenteditable === 'true'
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }
}

function fakeRoot(selectorMatches) {
  return { querySelectorAll: (selector) => selectorMatches.get(selector) ?? [] }
}

function startOperation(tabId, requestId = `calibration-${tabId}`, origin = 'https://chat.example') {
  return { requestId, tab: { id: tabId, url: `${origin}/chat` }, origin, mode: 'replace' }
}

function storedOperation(tabId, stage = 'selecting_composer', requestId = `calibration-${tabId}`) {
  return { requestId, tabId, origin: 'https://chat.example', mode: 'replace', stage, startedAt: 100 }
}

function completeProfile(origin = 'https://chat.example', marker = 'new') {
  const fingerprint = (tagName) => ({
    version: 1,
    tagName,
    attributes: {},
    primarySelector: `#${marker}-${tagName}`,
    fallbackSelectors: [],
    ancestorChain: [],
  })
  return { version: 1, origin, composer: fingerprint('textarea'), send: fingerprint('button') }
}

test('creates a semantic fingerprint and resolves an equivalent replacement', () => {
  const parent = new FakeElement('form', { role: 'form' })
  const original = new FakeElement('button', { 'aria-label': 'Send message' }, parent)
  const replacement = new FakeElement('button', { 'aria-label': 'Send message' }, parent)
  const selector = 'button[aria-label="Send message"]'
  const firstRoot = fakeRoot(new Map([[selector, [original]]]))
  const fingerprint = createFingerprint(original, firstRoot)

  assert.equal(fingerprint.primarySelector, selector)
  assert.equal(fingerprint.expectedMatchCount, 1)
  assert.equal(resolveFingerprint(fakeRoot(new Map([[selector, [replacement]]])), fingerprint).element, replacement)
})

test('resolves one uniquely attributed control after provider wrapper drift', () => {
  const calibratedParent = new FakeElement('form', { role: 'form' })
  const runtimeParent = new FakeElement('div', { role: 'presentation' })
  const original = new FakeElement('button', { 'aria-label': 'Send message' }, calibratedParent)
  const replacement = new FakeElement('button', { 'aria-label': 'Send message' }, runtimeParent)
  const selector = 'button[aria-label="Send message"]'
  const fingerprint = createFingerprint(original, fakeRoot(new Map([[selector, [original]]])))
  const runtimeRoot = fakeRoot(new Map([[selector, [replacement]]]))

  assert.equal(resolveFingerprint(runtimeRoot, fingerprint).element, null)
  const resolved = resolveFingerprint(runtimeRoot, fingerprint, { allowAncestorDrift: true })
  assert.equal(resolved.element, replacement)
  assert.equal(resolved.ancestorDrifted, true)
  const ambiguous = resolveFingerprint(fakeRoot(new Map([[selector, [replacement, new FakeElement('button', { 'aria-label': 'Send message' }, runtimeParent)]]])), fingerprint, { allowAncestorDrift: true })
  assert.equal(ambiguous.element, null)
  assert.equal(ambiguous.matchCount, 2)
})

test('rejects a selection that cannot be resolved uniquely', () => {
  const one = new FakeElement('button', { type: 'button' })
  const two = new FakeElement('button', { type: 'button' })
  const root = fakeRoot(
    new Map([
      ['button[type="button"]', [one, two]],
      ['button', [one, two]],
    ]),
  )
  assert.throws(() => createFingerprint(one, root), /uniquely/)
})

test('calibration requires composer then Send and validates both again', () => {
  const composer = new FakeElement('textarea', { name: 'prompt' })
  const send = new FakeElement('button', { 'aria-label': 'Send' })
  const root = fakeRoot(
    new Map([
      ['textarea[name="prompt"]', [composer]],
      ['button[aria-label="Send"]', [send]],
    ]),
  )
  const controller = createCalibrationController({ root, origin: 'https://chat.example' })

  assert.equal(controller.start().stage, 'selecting_composer')
  assert.equal(controller.confirm(composer).stage, 'selecting_send')
  const result = controller.confirm(send)
  assert.equal(result.stage, 'complete')
  assert.equal(result.profile.origin, 'https://chat.example')
  assert.equal(result.profile.composer.primarySelector, 'textarea[name="prompt"]')
})

test('calibration rejects assigning the composer as the Send control', () => {
  const composer = new FakeElement('textarea', { name: 'prompt' })
  const root = fakeRoot(new Map([['textarea[name="prompt"]', [composer]]]))
  const controller = createCalibrationController({ root, origin: 'https://chat.example' })
  controller.start()
  controller.confirm(composer)
  assert.throws(() => controller.confirm(composer), /different controls/)
})

test('starting the inspector repeatedly installs one overlay and one listener set', () => {
  let overlays = 0
  let documentListeners = 0
  let windowListeners = 0
  let documentRemovals = 0
  let windowRemovals = 0
  const makeElement = () => ({
    style: {},
    setAttribute() {},
    attachShadow: () => ({ append() {} }),
    remove() {},
  })
  const document = {
    createElement: makeElement,
    documentElement: { append: () => { overlays += 1 } },
    addEventListener: () => { documentListeners += 1 },
    removeEventListener: () => { documentRemovals += 1 },
  }
  const window = {
    addEventListener: () => { windowListeners += 1 },
    removeEventListener: () => { windowRemovals += 1 },
  }
  const inspector = createElementInspector({
    document,
    window,
    onConfirm() {},
    onCancel() {},
    onError() {},
  })
  inspector.start('first')
  inspector.start('duplicate')
  assert.equal(overlays, 1)
  assert.equal(documentListeners, 3)
  assert.equal(windowListeners, 1)
  inspector.stop()
  assert.equal(documentRemovals, 3)
  assert.equal(windowRemovals, 1)
})

test('session routes to the active tab and stores a completed profile by origin', async () => {
  const calls = []
  let stored = {}
  const session = createCalibrationSession({
    injectContentScript: async (tabId) => calls.push(['inject', tabId]),
    sendTabMessage: async (tabId, message) => {
      calls.push(['send', tabId, message.type])
      return { ok: true }
    },
    loadProfiles: async () => stored,
    saveProfiles: async (profiles) => {
      stored = profiles
    },
  })

  await session.start(startOperation(42))
  assert.deepEqual(calls, [
    ['inject', 42],
    ['send', 42, 'calibration.start'],
  ])
  await session.handlePageState(
    { stage: 'complete', requestId: 'calibration-42', profile: completeProfile() },
    42,
  )
  assert.equal(stored['https://chat.example'].version, 1)
  assert.equal(session.getState().stage, 'complete')
})

test('session ignores page messages from another tab and fails on navigation', async () => {
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  await session.start(startOperation(7))
  await session.handlePageState({ stage: 'selecting_send', requestId: 'calibration-7' }, 8)
  assert.equal(session.getState().stage, 'selecting_composer')
  session.handleTabUpdated(7, { status: 'loading' })
  assert.equal(session.getState().stage, 'failed')
})

test('recalibration keeps the old profile until valid completion replaces it', async () => {
  const old = completeProfile('https://chat.example', 'old')
  let profiles = { 'https://chat.example': old, 'https://other.example': completeProfile('https://other.example') }
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => profiles,
    saveProfiles: async (next) => { profiles = next },
  })
  await session.start(startOperation(12))
  assert.equal(profiles['https://chat.example'], old)
  const replacement = completeProfile('https://chat.example', 'replacement')
  await session.handlePageState({
    stage: 'complete',
    requestId: 'calibration-12',
    profile: replacement,
  }, 12)
  assert.equal(profiles['https://chat.example'], replacement)
  assert.equal(profiles['https://other.example'].origin, 'https://other.example')
})

test('cancelled and failed recalibration preserve the old profile', async () => {
  for (const outcome of ['cancelled', 'failed']) {
    const old = completeProfile('https://chat.example', `old-${outcome}`)
    let profiles = { 'https://chat.example': old }
    const session = createCalibrationSession({
      injectContentScript: async () => {},
      sendTabMessage: async () => ({ ok: true }),
      loadProfiles: async () => profiles,
      saveProfiles: async (next) => { profiles = next },
    })
    await session.start(startOperation(13, `request-${outcome}`))
    await session.handlePageState({ stage: outcome, requestId: `request-${outcome}` }, 13)
    assert.equal(profiles['https://chat.example'], old)
  }
})

test('three rapid same-tab starts create one injected operation', async () => {
  let injections = 0
  let releases
  const injected = new Promise((resolve) => { releases = resolve })
  const session = createCalibrationSession({
    injectContentScript: async () => {
      injections += 1
      await injected
    },
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  const first = session.start(startOperation(14, 'request-one'))
  const second = session.start(startOperation(14, 'request-two'))
  const third = session.start(startOperation(14, 'request-three'))
  releases()
  await Promise.all([first, second, third])
  assert.equal(injections, 1)
  assert.equal(session.getState().requestId, 'request-one')
})

test('a legitimate calibration cannot be stolen by another tab', async () => {
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  await session.start(startOperation(15, 'owner'))
  await assert.rejects(() => session.start(startOperation(16, 'thief')), /different tab/)
  assert.equal(session.getState().tabId, 15)
  assert.equal(session.getState().requestId, 'owner')
})

test('wrong request and wrong tab page updates cannot mutate the operation', async () => {
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  await session.start(startOperation(17, 'owner'))
  await session.handlePageState({ stage: 'selecting_send', requestId: 'wrong' }, 17)
  await session.handlePageState({ stage: 'selecting_send', requestId: 'owner' }, 18)
  assert.equal(session.getState().stage, 'selecting_composer')
})

test('session explains a missing activeTab grant', async () => {
  const session = createCalibrationSession({
    injectContentScript: async () => {
      throw new Error('Cannot access contents of the page')
    },
    sendTabMessage: async () => {},
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  await assert.rejects(() => session.start(startOperation(9)))
  assert.match(session.getState().error, /page integration/)
})

test('calibration requests access only for its origin and rejects denial', async () => {
  let requested
  await requestCalibrationAccess('https://chat.example', async (permissions) => {
    requested = permissions
    return true
  })
  assert.deepEqual(requested, { origins: ['https://chat.example/*'] })
  await assert.rejects(() => requestCalibrationAccess('https://chat.example', async () => false), /not granted/)
})

test('normalizes a clicked child to the semantic composer or Send control', () => {
  const composer = { kind: 'composer' }
  const send = { kind: 'send' }
  const child = {
    closest(selector) {
      return selector.includes('contenteditable') ? composer : send
    },
  }
  assert.equal(normalizeCalibrationTarget(child, 'composer'), composer)
  assert.equal(normalizeCalibrationTarget(child, 'send'), send)
})

test('an ambiguous selection remains recoverable in the active calibration', async () => {
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => ({ ok: true }),
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
  })
  await session.start(startOperation(11))
  await session.handlePageState(
    {
      stage: 'selection_rejected',
      requestId: 'calibration-11',
      calibrationStage: 'selecting_composer',
      error: 'Selected element cannot be resolved uniquely',
    },
    11,
  )
  assert.equal(session.getState().stage, 'selecting_composer')
  assert.equal(session.getState().tabId, 11)
})

test('registers lifecycle cancellation only for the TETHER side panel', () => {
  let disconnectListener
  let messageListener
  let cancellations = 0
  const port = {
    name: SIDE_PANEL_PORT,
    onDisconnect: { addListener: (listener) => (disconnectListener = listener) },
    onMessage: { addListener: (listener) => (messageListener = listener) },
  }
  assert.equal(
    registerSidePanelConnection(port, {
      getTab: async () => ({ active: true }),
      onExplicitClose: async () => cancellations++,
    }),
    true,
  )
  messageListener({ type: 'panel.bind', tabId: 14 })
  return disconnectListener().then(() => {
    assert.equal(cancellations, 1)
  })
})

test('does not cancel execution when a tab switch merely hides the side panel', async () => {
  let disconnectListener
  let messageListener
  let cancellations = 0
  const port = {
    name: SIDE_PANEL_PORT,
    onDisconnect: { addListener: (listener) => (disconnectListener = listener) },
    onMessage: { addListener: (listener) => (messageListener = listener) },
  }
  registerSidePanelConnection(port, {
    getTab: async () => ({ active: false }),
    onExplicitClose: async () => cancellations++,
  })
  messageListener({ type: 'panel.bind', tabId: 15 })
  await disconnectListener()
  assert.equal(cancellations, 0)
})

test('ignores lifecycle ports that do not belong to TETHER', () => {
  assert.equal(
    registerSidePanelConnection(
      {
        name: 'unrelated',
        onDisconnect: { addListener: () => assert.fail() },
        onMessage: { addListener: () => assert.fail() },
      },
      { getTab: async () => null, onExplicitClose: async () => {} },
    ),
    false,
  )
})

test('restores an active calibration only when the content script agrees', async () => {
  const saved = storedOperation(23, 'selecting_send')
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => {},
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
    loadActiveOperation: async () => saved,
    saveActiveOperation: async () => {},
    clearActiveOperation: async () => {},
    getPageState: async () => ({ active: true, stage: 'selecting_send', requestId: 'calibration-23' }),
  })
  await session.restore()
  assert.equal(session.getState().stage, 'selecting_send')
  assert.equal(session.getState().tabId, 23)
})

test('fails and clears recovery when the recorded page no longer owns calibration', async () => {
  let cleared = false
  const session = createCalibrationSession({
    injectContentScript: async () => {},
    sendTabMessage: async () => {},
    loadProfiles: async () => ({}),
    saveProfiles: async () => {},
    loadActiveOperation: async () => storedOperation(31),
    saveActiveOperation: async () => {},
    clearActiveOperation: async () => {
      cleared = true
    },
    getPageState: async () => ({ active: false, stage: 'idle' }),
  })
  await session.restore()
  assert.equal(session.getState().stage, 'failed')
  assert.equal(cleared, true)
})
