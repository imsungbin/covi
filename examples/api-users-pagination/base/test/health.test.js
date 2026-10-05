import assert from 'node:assert/strict';
import test from 'node:test';
import { handle } from '../app.js';

test('health check responds ok', () => {
  let status = 0;
  let body = '';
  const res = {
    writeHead(code) {
      status = code;
      return this;
    },
    end(text) {
      body = text;
    },
  };
  handle({ url: '/health', method: 'GET' }, res);
  assert.equal(status, 200);
  assert.equal(body, 'ok');
});
