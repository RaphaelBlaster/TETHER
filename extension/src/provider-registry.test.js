import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectSite } from './provider-registry.js'

test('browser pages and extension stores are restricted', () => {
  assert.equal(inspectSite('chrome://extensions').kind, 'restricted')
  assert.equal(inspectSite('brave://newtab').kind, 'restricted')
  assert.equal(inspectSite('https://chromewebstore.google.com/detail/example').kind, 'restricted')
})

test('unknown HTTPS origins are configurable without adapters', () => {
  const site = inspectSite('https://support.example.com/app')
  assert.equal(site.kind, 'web')
  assert.equal(site.origin, 'https://support.example.com')
  assert.equal(site.label, 'support.example.com')
  assert.equal(site.hasAdapter, false)
  assert.equal(site.conversationId, null)
})

test('known LLM origins expose built-in adapters without deciding the CROSS role', () => {
  for (const url of ['https://gemini.google.com/app', 'https://claude.ai/new', 'https://chat.deepseek.com/']) {
    const site = inspectSite(url)
    assert.equal(site.hasAdapter, true)
    assert.equal(site.providerKind, 'llm')
  }
})

test('optional ChatGPT adapter enriches label and conversation identity only', () => {
  const site = inspectSite('https://chatgpt.com/c/thread-1')
  assert.equal(site.kind, 'web')
  assert.equal(site.label, 'ChatGPT')
  assert.equal(site.hasAdapter, true)
  assert.equal(site.conversationId, 'thread-1')
})
