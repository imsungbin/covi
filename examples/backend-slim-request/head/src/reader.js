import { messageBytes } from './request.js';

/** The reader parses a message 4 KB per step. */
export const PAGE_BYTES = 4096;
/** Steps one call may take before the worker gives up on it. */
export const STEP_BUDGET = 8;

/**
 * Runs the reader worker over a review's messages. Each message is one call: it parses the list
 * of documents and merges the part with the ones before it. Then the reader fetches each document
 * from the store, one call and one step each, since the store hands it over already parsed.
 */
export function runReader(messages, store) {
  let steps = 0;
  let timeouts = 0;
  const call = (cost) => {
    steps += cost;
    if (cost > STEP_BUDGET) timeouts++;
  };
  for (const message of messages) {
    const parse = Math.ceil(messageBytes(message) / PAGE_BYTES);
    call(parse + 1 + (message.part > 1 ? 1 : 0));
    for (const ref of message.refs) {
      const document = store.get(ref.id);
      if (Buffer.byteLength(document.body) !== ref.bytes)
        throw new Error(`${ref.id} changed after the request was built`);
      call(1);
    }
  }
  return { steps, timeouts };
}
