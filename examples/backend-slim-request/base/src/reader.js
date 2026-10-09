import { messageBytes } from './request.js';

/** The reader parses a message 4 KB per step. */
export const PAGE_BYTES = 4096;
/** Steps one call may take before the worker gives up on it. */
export const STEP_BUDGET = 8;

/**
 * Runs the reader worker over a review's messages, one call each: it parses the message, indexes
 * every document in it, and merges the part with the ones before it.
 */
export function runReader(messages) {
  let steps = 0;
  let timeouts = 0;
  const call = (cost) => {
    steps += cost;
    if (cost > STEP_BUDGET) timeouts++;
  };
  for (const message of messages) {
    const parse = Math.ceil(messageBytes(message) / PAGE_BYTES);
    call(parse + message.documents.length + (message.part > 1 ? 1 : 0));
  }
  return { steps, timeouts };
}
