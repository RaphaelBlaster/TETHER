import assert from 'node:assert/strict';
import test from 'node:test';
import { createStabilityTracker } from './automation/response-observer.js';

test('provider generation state, not JSON shape, controls completion', () => {
  const tracker = createStabilityTracker({ stableMs: 100 });
  const partial = '{"anything":"including malformed output';
  tracker.update(partial, { now: 0 });
  assert.equal(tracker.update(partial, { now: 150, streaming: true }).stable, false);
  assert.equal(tracker.update(partial, { now: 151 }).stable, false);
  assert.equal(tracker.update(partial, { now: 260 }).stable, true);
});
