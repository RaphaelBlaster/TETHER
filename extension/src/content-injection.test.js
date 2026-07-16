import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveContextualSend } from './injection/content-injection.js'

function actionableButton(label) {
  const document = { defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) } }
  return {
    tagName: 'BUTTON',
    isConnected: true,
    disabled: false,
    ownerDocument: document,
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
    getAttribute: (name) => name === 'aria-label' ? label : null,
  }
}

function actionableButtonWithId(id) {
  const button = actionableButton(null)
  button.id = id
  return button
}

test('resolves one actionable semantic Send control inside the calibrated composer form', () => {
  const send = actionableButton('Send prompt')
  const form = { querySelectorAll: () => [send] }
  const composer = { tagName: 'TEXTAREA', isConnected: true, closest: (selector) => selector === 'form' ? form : null }
  assert.equal(resolveContextualSend(composer, { tagName: 'button' }), send)
})

test('rejects ambiguous contextual Send controls', () => {
  const form = { querySelectorAll: () => [actionableButton('Send prompt'), actionableButton('Submit')] }
  const composer = { tagName: 'TEXTAREA', isConnected: true, closest: (selector) => selector === 'form' ? form : null }
  assert.equal(resolveContextualSend(composer, { tagName: 'button' }), null)
})

test('resolves a semantic Send control rendered outside the composer form', () => {
  const send = actionableButton('Send prompt')
  const form = { querySelectorAll: () => [] }
  const wrapper = { tagName: 'DIV', parentElement: null, querySelectorAll: () => [send] }
  const composer = {
    tagName: 'TEXTAREA', isConnected: true, parentElement: wrapper,
    closest: (selector) => selector === 'form' ? form : null,
  }
  assert.equal(resolveContextualSend(composer, { tagName: 'button' }), send)
})

test('does not escape an outer scope containing multiple semantic Send controls', () => {
  const form = { querySelectorAll: () => [] }
  const wrapper = {
    tagName: 'DIV', parentElement: null,
    querySelectorAll: () => [actionableButton('Send prompt'), actionableButton('Submit')],
  }
  const composer = {
    tagName: 'TEXTAREA', isConnected: true, parentElement: wrapper,
    closest: (selector) => selector === 'form' ? form : null,
  }
  assert.equal(resolveContextualSend(composer, { tagName: 'button' }), null)
})

test('resolves ChatGPT fresh Send control by its stable submit id', () => {
  const send = actionableButtonWithId('composer-submit-button')
  const form = { querySelectorAll: () => [send] }
  const composer = { tagName: 'TEXTAREA', isConnected: true, closest: (selector) => selector === 'form' ? form : null }
  assert.equal(resolveContextualSend(composer, { tagName: 'button' }), send)
})
