import assert from 'node:assert/strict'
import test from 'node:test'

import {
  validateCalibrationProfile,
} from './calibration/profile-validation.js'
import { inspectCalibrationProfile } from './calibration/profile-schema.js'

function fingerprint(tagName, selector) {
  return {
    version: 1,
    tagName,
    attributes: {},
    primarySelector: selector,
    fallbackSelectors: [],
    ancestorChain: [],
  }
}

function element(tagName, closest) {
  return {
    tagName: tagName.toUpperCase(),
    isConnected: true,
    getAttribute: () => null,
    closest,
  }
}

test('preserves the existing Checkpoint 4 profile shape', () => {
  const profile = {
    version: 1,
    origin: 'https://chatgpt.com',
    composer: fingerprint('textarea', '#composer'),
    send: fingerprint('button', '#send'),
  }
  const inspected = inspectCalibrationProfile(profile, 'https://chatgpt.com')
  assert.equal(inspected.code, 'stored')
  assert.equal(inspected.profile, profile)
})

test('invalid saved profile is invalid rather than unsupported', () => {
  assert.equal(inspectCalibrationProfile({ version: 1 }, 'https://example.com').code, 'schema_invalid')
})

test('live validation resolves both semantic controls', () => {
  let composer
  let send
  composer = element('textarea', (selector) => selector.includes('textarea') ? composer : null)
  send = element('button', (selector) => selector.includes('button') ? send : null)
  const root = {
    querySelectorAll(selector) {
      if (selector === '#composer') return [composer]
      if (selector === '#send') return [send]
      return []
    },
  }
  const result = validateCalibrationProfile(root, {
    version: 1,
    origin: 'https://example.com',
    composer: fingerprint('textarea', '#composer'),
    send: fingerprint('button', '#send'),
  }, { isVisible: () => true })
  assert.equal(result.code, 'valid')
  assert.equal(result.composerResolved, true)
  assert.equal(result.sendResolved, true)
})

test('missing and ambiguous controls produce explicit validation results', () => {
  const profile = {
    version: 1,
    origin: 'https://example.com',
    composer: fingerprint('textarea', '#composer'),
    send: fingerprint('button', '#send'),
  }
  const missing = validateCalibrationProfile({ querySelectorAll: () => [] }, profile)
  assert.equal(missing.code, 'composer_not_found')

  const first = element('textarea', () => first)
  const second = element('textarea', () => second)
  const ambiguous = validateCalibrationProfile({
    querySelectorAll: (selector) => selector === '#composer' ? [first, second] : [],
  }, profile)
  assert.equal(ambiguous.code, 'ambiguous')
})

test('an empty composer permits a conditionally mounted Send control to be dormant', () => {
  const profile = {
    version: 1,
    origin: 'https://example.com',
    composer: fingerprint('textarea', '#composer'),
    send: fingerprint('button', '#send'),
  }
  const composer = {
    ...element('textarea', (selector) => selector.includes('textarea') ? composer : null),
    value: '',
  }
  const root = {
    querySelectorAll: (selector) => selector === '#composer' ? [composer] : [],
  }
  const result = validateCalibrationProfile(root, profile, { isVisible: () => true })
  assert.equal(result.code, 'valid_send_dormant')
  assert.equal(result.valid, true)
  assert.equal(result.composerResolved, true)
  assert.equal(result.sendResolved, false)
})

test('a missing Send control remains invalid when the composer contains text', () => {
  const profile = {
    version: 1,
    origin: 'https://example.com',
    composer: fingerprint('textarea', '#composer'),
    send: fingerprint('button', '#send'),
  }
  const composer = {
    ...element('textarea', (selector) => selector.includes('textarea') ? composer : null),
    value: 'ready to submit',
  }
  const root = {
    querySelectorAll: (selector) => selector === '#composer' ? [composer] : [],
  }
  const result = validateCalibrationProfile(root, profile, { isVisible: () => true })
  assert.equal(result.code, 'send_not_found')
  assert.equal(result.valid, false)
})
