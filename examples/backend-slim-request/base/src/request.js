import { reviewGuide } from './documents.js';

/** The largest message the reader worker accepts, in bytes. */
export const CHUNK_LIMIT = 24 * 1024;

export function messageBytes(message) {
  return Buffer.byteLength(JSON.stringify(message));
}

/**
 * Splits a review into messages under CHUNK_LIMIT: the guide goes in the first one, then each
 * item joins the current message while it still fits.
 */
function chunk(review, key, items) {
  const messages = [{ kind: 'review', review, part: 1, guide: reviewGuide(), [key]: [] }];
  for (const item of items) {
    let current = messages.at(-1);
    const grown = { ...current, [key]: [...current[key], item] };
    if (messageBytes(grown) > CHUNK_LIMIT && (current.guide || current[key].length)) {
      current = { kind: 'review', review, part: messages.length + 1, [key]: [] };
      messages.push(current);
    }
    current[key].push(item);
  }
  return messages.map((message) => ({ ...message, parts: messages.length }));
}

/** The messages that ask the reader to review these documents, each document in full. */
export function buildReviewRequest(store, ids) {
  return chunk(
    'review-1',
    'documents',
    ids.map((id) => store.get(id)),
  );
}
