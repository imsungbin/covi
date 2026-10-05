/**
 * Delay before retry number `attempt` (1-based): exponential growth capped at `maxMs`,
 * with full jitter so concurrent clients do not retry in lockstep.
 */
export function backoffDelay(attempt, { baseMs = 100, maxMs = 2000, random = Math.random } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}
