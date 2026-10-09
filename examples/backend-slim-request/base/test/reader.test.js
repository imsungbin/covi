import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest } from '../src/request.js';
import { createStore } from '../src/store.js';

test('reads every message, counting its steps', () => {
  const store = createStore(fixtureDocuments());
  const messages = buildReviewRequest(store, store.ids());
  const { steps } = runReader(messages);
  assert.ok(steps >= messages.length + fixtureDocuments().length);
});

test('builds the same documents every time', () => {
  assert.deepEqual(fixtureDocuments(), fixtureDocuments());
});
