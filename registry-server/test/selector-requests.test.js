import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSelectorRequest,
  createSelectorRequestReport,
  normalizeSelectorOrigin,
  selectorRequestId,
  validateIdempotencyKey,
} from '../src/selector-requests.js'

test('selector requests accept exact AI origins and derive deterministic identities', () => {
  const request = createSelectorRequest({
    origin: 'https://new-model.ai',
    extensionVersion: '0.1.0',
    reason: 'missing_adapter',
    adapterVersion: 0,
  })

  assert.equal(request.origin, 'https://new-model.ai')
  assert.equal(request.host, 'new-model.ai')
  assert.equal(request.requestId, selectorRequestId(request.origin))
  assert.doesNotThrow(() => validateIdempotencyKey(request.requestId, request.requestId))
})

test('selector requests reject page URLs, non-AI hosts, and mismatched versions', () => {
  assert.throws(
    () => normalizeSelectorOrigin('https://new-model.ai/chat/account-42?thread=secret'),
    { code: 'origin_invalid' },
  )
  assert.throws(
    () => createSelectorRequest({
      origin: 'https://example.com',
      extensionVersion: '0.1.0',
      reason: 'missing_adapter',
      adapterVersion: 0,
    }),
    { code: 'origin_not_ai_site', status: 422 },
  )
  assert.throws(
    () => createSelectorRequest({
      origin: 'https://new-model.ai',
      extensionVersion: '0.1.0',
      reason: 'adapter_invalid',
      adapterVersion: 0,
    }),
    { code: 'selector_request_invalid' },
  )
  assert.throws(
    () => validateIdempotencyKey('a'.repeat(64), selectorRequestId('https://new-model.ai')),
    { code: 'idempotency_key_invalid' },
  )
})

test('the branded maintenance report contains only pending declarative work', () => {
  const pending = {
    requestId: selectorRequestId('https://new-model.ai'),
    origin: 'https://new-model.ai',
    status: 'pending',
    reason: 'missing_adapter',
    extensionVersion: '0.1.0',
    adapterVersionAtRequest: 0,
    requestedAt: '2026-07-24T00:00:00.000Z',
  }
  const report = createSelectorRequestReport([
    pending,
    { ...pending, origin: 'https://fulfilled.ai', status: 'fulfilled' },
  ], {
    generatedAt: '2026-07-24T01:00:00.000Z',
    registryVersion: 12,
  })

  assert.match(report, /TETHER selector maintenance report/)
  assert.match(report, /https:\/\/new-model\.ai/)
  assert.doesNotMatch(report, /https:\/\/fulfilled\.ai/)
  assert.match(report, /Never add remotely executable JavaScript/)
  assert.match(report, /do not bypass review/)
})
