// Builds the request for the fixture review, runs the reader over it, and prints what it measured.
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());
const messages = buildReviewRequest(store, store.ids());
const { steps, timeouts } = runReader(messages, store);

console.log(`request bytes: ${messages.reduce((n, m) => n + messageBytes(m), 0)}`);
console.log(`chunks: ${messages.length}`);
console.log(`reader steps: ${steps}`);
console.log(`timeouts: ${timeouts}`);
