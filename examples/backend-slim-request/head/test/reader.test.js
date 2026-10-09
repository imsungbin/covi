import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest } from '../src/request.js';
import { createStore } from '../src/store.js';

test('fetches each document itself, every call within the step budget', () => {
  const store = createStore(fixtureDocuments());
  const { steps, timeouts } = runReader(buildReviewRequest(store, store.ids()), store);
  assert.equal(timeouts, 0);
  assert.ok(steps >= fixtureDocuments().length);
});

test('stops at a document that changed after the request was built', () => {
  const store = createStore(fixtureDocuments());
  const messages = buildReviewRequest(store, store.ids());
  const changed = fixtureDocuments().map((d, i) => (i === 0 ? { ...d, body: `${d.body} More.` } : d));
  assert.throws(() => runReader(messages, createStore(changed)), /doc-001 changed/);
});

test('builds the same documents every time', () => {
  assert.deepEqual(fixtureDocuments(), fixtureDocuments());
});
