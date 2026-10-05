import { backoffDelay } from './backoff.js';

/**
 * Calls `request` until it succeeds or `retries` attempts fail.
 * Waits between attempts with exponential backoff and full jitter (see backoff.js).
 */
export async function withRetry(request, { retries = 3, baseMs = 100, maxMs = 2000, random = Math.random, sleep = defaultSleep } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await request(attempt);
    } catch (error) {
      attempt++;
      if (attempt > retries || !isRetryable(error)) throw error;
      await sleep(backoffDelay(attempt, { baseMs, maxMs, random }));
    }
  }
}

function isRetryable(error) {
  return error?.retryable !== false;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
