import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { buildReviewRequest, CHUNK_LIMIT, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());

test('asks for each document by id, title, and size', () => {
  const [message] = buildReviewRequest(store, store.ids());
  assert.deepEqual(
    message.refs,
    fixtureDocuments().map((d) => ({ id: d.id, title: d.title, bytes: Buffer.byteLength(d.body) })),
  );
});

test('leaves the documents out, so the review fits in one message', () => {
  const messages = buildReviewRequest(store, store.ids());
  assert.equal(messages.length, 1);
  assert.ok(messageBytes(messages[0]) <= CHUNK_LIMIT);
  assert.ok(!JSON.stringify(messages).includes(fixtureDocuments()[0].body));
});
