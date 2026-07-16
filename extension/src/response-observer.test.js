import assert from 'node:assert/strict';
import test from 'node:test';
import { createStabilityTracker, looksLikeIncompleteJson } from './automation/response-observer.js';

test('recognizes an incomplete protocol JSON object after a provider speaker prefix', () => {
  const partial = 'Gemini said {"schemaVersion":1,"type":"tool_call","requestId":"request-1","arguments":';
  assert.equal(looksLikeIncompleteJson(partial), true);
  assert.equal(looksLikeIncompleteJson(`${partial}{}}`), false);
});

test('does not complete a stable prefixed streamed tool call before its JSON closes', () => {
  const tracker = createStabilityTracker({ stableMs: 100 });
  const partial = 'Gemini said {"schemaVersion":1,"type":"tool_call","requestId":"request-1","arguments":';
  tracker.update(partial, { now: 0 });
  assert.equal(tracker.update(partial, { now: 150 }).stable, false);
});
