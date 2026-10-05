import assert from 'node:assert/strict';
import test from 'node:test';
import { slugify } from '../src/slugify.js';

test('lowercases and joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});

test('keeps accented letters as their base letter', () => {
  assert.equal(slugify('Héllo Wörld'), 'hello-world');
});

test('collapses repeated separators and trims the ends', () => {
  assert.equal(slugify('  Ça va?  Oui!! '), 'ca-va-oui');
});
