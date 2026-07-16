import assert from 'node:assert/strict'
import test from 'node:test'

import { CALIBRATION_COMPOSER_PROBE, createComposerProbe } from './calibration/composer-probe.js'
import { writeEditorText } from './injection/editor-writer.js'
import { createInjectionCoordinator } from './injection/injection-coordinator.js'
import { verifySubmission } from './injection/submission-verifier.js'

class FakeInputEvent {
  constructor(type, options = {}) {
    this.type = type
    Object.assign(this, options)
  }
}

class FakeInput {
  constructor(tagName, window, { cancelBeforeInput = false } = {}) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = { defaultView: window }
    this.isConnected = true
    this.events = []
    this.cancelBeforeInput = cancelBeforeInput
    this._value = ''
  }
  get value() { return this._value }
  set value(value) { this._value = value }
  focus() {}
  dispatchEvent(event) {
    this.events.push(event.type)
    return !(event.type === 'beforeinput' && this.cancelBeforeInput)
  }
}

class FakeTextarea extends FakeInput {
  get value() { return this._value }
  set value(value) { this._value = value }
}

function editorWindow() {
  const window = {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextarea,
    InputEvent: FakeInputEvent,
    Event: FakeInputEvent,
  }
  return window
}

test('input and textarea use native setters and required input events', () => {
  const window = editorWindow()
  for (const editor of [new FakeInput('input', window), new FakeTextarea('textarea', window)]) {
    const result = writeEditorText(editor, 'TETHER test')
    assert.equal(editor.value, 'TETHER test')
    assert.deepEqual(editor.events, ['beforeinput', 'input'])
    assert.equal(result.strategy, 'native_value')
  }
})

test('cancelled beforeinput prevents editor mutation', () => {
  const window = editorWindow()
  const editor = new FakeInput('input', window, { cancelBeforeInput: true })
  assert.throws(() => writeEditorText(editor, 'must not appear'), { code: 'beforeinput_cancelled' })
  assert.equal(editor.value, '')
  assert.deepEqual(editor.events, ['beforeinput'])
})

test('calibration probe replaces any draft and clears the composer without restoring it', () => {
  const window = editorWindow()
  const editor = new FakeTextarea('textarea', window)
  editor.value = 'an existing draft'
  const probe = createComposerProbe({ prefersReducedMotion: () => true })

  assert.deepEqual(probe.activate(editor), { inserted: true, animated: false })
  assert.equal(editor.value, CALIBRATION_COMPOSER_PROBE)
  assert.equal(probe.isActive(), true)

  probe.cleanup()
  assert.equal(editor.value, '')
  assert.equal(probe.isActive(), false)
  assert.deepEqual(editor.events, ['beforeinput', 'input', 'beforeinput', 'input'])
})

test('calibration probe types one character at a time and cancels pending typing on cleanup', () => {
  const window = editorWindow()
  const editor = new FakeTextarea('textarea', window)
  const pending = new Map()
  let timerId = 0
  const probe = createComposerProbe({
    intervalMs: 42,
    setTimer(callback) {
      timerId += 1
      pending.set(timerId, callback)
      return timerId
    },
    clearTimer(id) { pending.delete(id) },
    prefersReducedMotion: () => false,
  })

  assert.deepEqual(probe.activate(editor), { inserted: true, animated: true })
  assert.equal(editor.value, CALIBRATION_COMPOSER_PROBE[0])
  for (let index = 0; index < 4; index += 1) {
    const [id, callback] = pending.entries().next().value
    pending.delete(id)
    callback()
  }
  assert.equal(editor.value, CALIBRATION_COMPOSER_PROBE.slice(0, 5))

  probe.cleanup()
  assert.equal(editor.value, '')
  assert.equal(pending.size, 0)
})

test('contenteditable uses selection and Range before any execCommand fallback', () => {
  let selected
  let execCommands = 0
  const selection = { removeAllRanges() {}, addRange() {} }
  const window = {
    InputEvent: FakeInputEvent,
    Event: FakeInputEvent,
    getSelection: () => selection,
  }
  const document = {
    defaultView: window,
    createTextNode: (text) => ({ textContent: text }),
    createRange: () => ({
      selectNodeContents(element) { selected = element },
      deleteContents() { selected.textContent = '' },
      insertNode(node) { selected.textContent += node.textContent },
      collapse() {},
    }),
    execCommand() { execCommands += 1; return true },
  }
  const editor = {
    tagName: 'DIV',
    ownerDocument: document,
    isConnected: true,
    isContentEditable: true,
    textContent: '',
    focus() {},
    getAttribute: () => 'true',
    dispatchEvent: () => true,
  }
  const result = writeEditorText(editor, 'contenteditable message')
  assert.equal(editor.textContent, 'contenteditable message')
  assert.equal(result.strategy, 'contenteditable_range')
  assert.equal(execCommands, 0)
})

test('contenteditable reports execCommand only when Range mutation is not retained', () => {
  let selected
  let execCommands = 0
  const selection = { removeAllRanges() {}, addRange() {} }
  const window = {
    InputEvent: FakeInputEvent,
    Event: FakeInputEvent,
    getSelection: () => selection,
  }
  const document = {
    defaultView: window,
    createTextNode: (text) => ({ textContent: text }),
    createRange: () => ({
      selectNodeContents(element) { selected = element },
      deleteContents() {},
      insertNode() {},
      collapse() {},
    }),
    execCommand(command, _showUi, text) {
      assert.equal(command, 'insertText')
      execCommands += 1
      selected.textContent = text
      return true
    },
  }
  const editor = {
    tagName: 'DIV',
    ownerDocument: document,
    isConnected: true,
    isContentEditable: true,
    textContent: '',
    focus() {},
    getAttribute: () => 'true',
    dispatchEvent: () => true,
  }
  const result = writeEditorText(editor, 'compatibility message')
  assert.equal(editor.textContent, 'compatibility message')
  assert.equal(result.strategy, 'contenteditable_exec_command')
  assert.equal(execCommands, 1)
})

test('submission requires combined evidence, clicks once, and disconnects its observer', async () => {
  let observerCallback
  let disconnected = false
  class FakeObserver {
    constructor(callback) { observerCallback = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  const window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) }
  const root = {}
  const composer = {
    tagName: 'TEXTAREA',
    value: 'submit me',
    parentElement: root,
    contains: () => false,
  }
  let clicks = 0
  const send = {
    isConnected: true,
    disabled: false,
    ownerDocument: { defaultView: window },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    click() {
      clicks += 1
      composer.value = ''
      this.disabled = true
      observerCallback([{ addedNodes: [{ textContent: 'submit me', contains: () => false }] }])
    },
  }
  const evidence = await verifySubmission({
    root,
    composer,
    send,
    expectedText: 'submit me',
    MutationObserver: FakeObserver,
    scheduleFrame: (callback) => setTimeout(callback, 0),
    cancelFrame: clearTimeout,
  })
  assert.equal(clicks, 1)
  assert.deepEqual(evidence, { composerChanged: true, sendChanged: true, userTurnAppeared: true, clickCount: 1 })
  assert.equal(disconnected, true)
})

test('composer clearing alone times out and disconnects the scoped observer', async () => {
  let disconnected = false
  class FakeObserver {
    observe() {}
    disconnect() { disconnected = true }
  }
  const window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) }
  const composer = { tagName: 'TEXTAREA', value: 'text', contains: () => false }
  const send = {
    isConnected: true,
    disabled: false,
    ownerDocument: { defaultView: window },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    click() { composer.value = '' },
  }
  await assert.rejects(() => verifySubmission({
    root: {},
    composer,
    send,
    expectedText: 'text',
    timeoutMs: 10,
    MutationObserver: FakeObserver,
    scheduleFrame: (callback) => setTimeout(callback, 1),
    cancelFrame: clearTimeout,
  }), { code: 'submission_timeout' })
  assert.equal(disconnected, true)
})

test('accepts submission when the page replaces both calibrated controls', async () => {
  class FakeObserver {
    observe() {}
    disconnect() {}
  }
  const window = { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) }
  const composer = { tagName: 'TEXTAREA', value: 'submit me', isConnected: true, contains: () => false }
  const send = {
    isConnected: true,
    disabled: false,
    ownerDocument: { defaultView: window },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    click() {
      composer.isConnected = false
      this.isConnected = false
    },
  }
  const evidence = await verifySubmission({
    root: {},
    composer,
    send,
    expectedText: 'submit me',
    MutationObserver: FakeObserver,
    scheduleFrame: (callback) => setTimeout(callback, 0),
    cancelFrame: clearTimeout,
  })
  assert.deepEqual(evidence, { composerChanged: true, sendChanged: true, userTurnAppeared: false, clickCount: 1 })
})

function coordinatorFixture() {
  let resolveExecution
  const calls = []
  const coordinator = createInjectionCoordinator({
    sendTabMessage: async (tabId, message) => {
      calls.push([tabId, message.type, message.requestId])
      if (message.type === 'injection.cancel') return { ok: true }
      return new Promise((resolve) => { resolveExecution = resolve })
    },
    timeoutMs: 1000,
  })
  const session = { browserSessionId: 'browser-a', tabId: 7, origin: 'https://chat.example' }
  const profile = { version: 1, origin: 'https://chat.example' }
  return { coordinator, session, profile, calls, resolve: (value) => resolveExecution(value) }
}

test('same request is idempotent and a different busy request is rejected', async () => {
  const fixture = coordinatorFixture()
  const request = { requestId: 'request-a', session: fixture.session, profile: fixture.profile, text: 'hello' }
  const first = fixture.coordinator.start(request)
  const duplicate = fixture.coordinator.start(request)
  assert.equal(first, duplicate)
  await assert.rejects(
    () => fixture.coordinator.start({ ...request, requestId: 'request-b' }),
    { code: 'session_busy' },
  )
  fixture.resolve({ ok: true, result: { evidence: {} } })
  await first
  assert.equal(fixture.calls.filter((call) => call[1] === 'injection.execute').length, 1)
  assert.deepEqual(await fixture.coordinator.start(request), await first)
})

test('navigation cancels only the owning tab operation', async () => {
  const fixture = coordinatorFixture()
  const pending = fixture.coordinator.start({
    requestId: 'request-nav',
    session: fixture.session,
    profile: fixture.profile,
    text: 'hello',
  })
  fixture.coordinator.cancelByTabId(99, 'tab_navigated')
  assert.equal(fixture.calls.some((call) => call[1] === 'injection.cancel'), false)
  fixture.coordinator.cancelByTabId(7, 'tab_navigated')
  await assert.rejects(() => pending, { code: 'tab_navigated' })
  assert.equal(fixture.calls.some((call) => call[1] === 'injection.cancel'), true)
})
