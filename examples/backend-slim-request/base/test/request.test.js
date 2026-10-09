import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { buildReviewRequest, CHUNK_LIMIT, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());

test('splits the review into messages under the chunk limit', () => {
  const messages = buildReviewRequest(store, store.ids());
  assert.ok(messages.length > 1);
  for (const message of messages) assert.ok(messageBytes(message) <= CHUNK_LIMIT);
  assert.deepEqual(
    messages.map((m) => [m.part, m.parts]),
    messages.map((_, i) => [i + 1, messages.length]),
  );
});

test('carries every document in full, in order', () => {
  const sent = buildReviewRequest(store, store.ids()).flatMap((m) => m.documents);
  assert.deepEqual(sent, store.ids().map((id) => store.get(id)));
});
