import assert from 'node:assert/strict';
import test from 'node:test';
import { backoffDelay } from '../src/http/backoff.js';

test('grows exponentially up to the cap', () => {
  const max = () => 0.999999;
  assert.equal(backoffDelay(1, { random: max }), 100);
  assert.equal(backoffDelay(3, { random: max }), 400);
  assert.equal(backoffDelay(10, { random: max }), 2000);
});

test('applies full jitter', () => {
  assert.equal(backoffDelay(4, { random: () => 0 }), 0);
  assert.equal(backoffDelay(4, { random: () => 0.5 }), 400);
});
