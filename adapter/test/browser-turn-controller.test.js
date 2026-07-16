import assert from 'node:assert/strict'
import test from 'node:test'
import { codexRequestId } from '../src/browser-turn-controller.js'

const request = {
  type: 'response.create',
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same input' }] }],
}

test('request identity is stable within one Codex connection', () => {
  assert.equal(codexRequestId(request, 'conn-1'), codexRequestId(request, 'conn-1'))
})

test('identical requests from separate Codex connections do not collide', () => {
  assert.notEqual(codexRequestId(request, 'conn-1'), codexRequestId(request, 'conn-2'))
})
