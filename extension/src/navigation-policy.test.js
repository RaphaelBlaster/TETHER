import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldCancelTabOperations, shouldReleaseBrowserAutomation } from './navigation-policy.js'

const session = { origin: 'https://chatgpt.com', providerId: 'chatgpt' }

test('same-origin conversation URL changes preserve active operations', () => {
  assert.equal(shouldCancelTabOperations({ url: 'https://chatgpt.com/c/abc' }, session), false)
})

test('reloads and unsupported navigation cancel active operations', () => {
  assert.equal(shouldCancelTabOperations({ status: 'loading' }, session), true)
  assert.equal(shouldCancelTabOperations({ url: 'https://example.com/' }, session), true)
  assert.equal(shouldCancelTabOperations({ url: 'brave://settings/' }, session), true)
})

test('Puppeteer remains attached while ChatGPT creates the conversation URL', () => {
  assert.equal(shouldReleaseBrowserAutomation({ status: 'loading' }, session), false)
  assert.equal(shouldReleaseBrowserAutomation({ url: 'https://chatgpt.com/c/abc' }, session), false)
  assert.equal(shouldReleaseBrowserAutomation({ url: 'https://example.com/' }, session), true)
})
