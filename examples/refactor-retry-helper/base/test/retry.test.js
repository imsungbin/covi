import assert from 'node:assert/strict';
import test from 'node:test';
import { withRetry } from '../src/http/retry.js';

test('retries until the request succeeds', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  }, { sleep: async () => {} });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('does not retry errors marked as not retryable', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => {
    calls++;
    throw Object.assign(new Error('bad request'), { retryable: false });
  }, { sleep: async () => {} }));
  assert.equal(calls, 1);
});
