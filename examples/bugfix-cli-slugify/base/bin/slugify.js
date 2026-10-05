#!/usr/bin/env node
import { slugify } from '../src/slugify.js';

const input = process.argv.slice(2).join(' ');
if (!input) {
  console.error('usage: slugify <text>');
  process.exit(2);
}
console.log(slugify(input));
