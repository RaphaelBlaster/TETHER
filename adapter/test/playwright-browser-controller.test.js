import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewAssistantSnapshot } from '../src/playwright-browser-controller.js'

test('detects a new assistant response when ChatGPT reuses the same DOM node count', () => {
  const baseline = { count: 2, text: 'previous answer' }
  assert.equal(isNewAssistantSnapshot({ count: 2, text: 'new answer' }, baseline), true)
  assert.equal(isNewAssistantSnapshot({ count: 2, text: 'previous answer' }, baseline), false)
  assert.equal(isNewAssistantSnapshot({ count: 3, text: 'new answer' }, baseline), true)
})
