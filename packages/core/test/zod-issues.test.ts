import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { escapeUnprintable } from '../src/util/text.ts';
import { formatIssues, parseOrThrow } from '../src/util/zod.ts';

const issuesOf = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error('expected a schema problem');
  return formatIssues(parsed.error);
};
const strict = z.strictObject({ name: z.string() });

describe('schema issues echoed from an untrusted file', () => {
  it('name ordinary unknown keys and paths exactly as before', () => {
    expect(issuesOf(strict, { name: 'a', mdoe: 1 })).toEqual(['(root): unknown key(s): mdoe']);
    expect(issuesOf(strict, { name: 'a', b: 1, c: 2 })).toEqual(['(root): unknown key(s): b, c']);
    const record = z.strictObject({ sync: z.record(z.string(), z.number()) });
    expect(issuesOf(record, { sync: { hero: 'x' } })).toEqual([
      'sync.hero: Invalid input: expected number, received string',
    ]);
  });

  it('escape control, ANSI, and bidi characters in keys and paths, and cut them short', () => {
    const hostile = `\u001b]0;pwned\u0007\u001b[2J\u202e${'k'.repeat(100_000)}`;
    const [line] = issuesOf(strict, { name: 'a', [hostile]: 1 });
    expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
    expect(line).toContain('\\u001b]0;pwned\\u0007\\u001b[2J\\u202e');
    expect(line!.length).toBeLessThan(150);
    const record = z.strictObject({ sync: z.record(z.string(), z.number()) });
    const [path] = issuesOf(record, { sync: { [hostile]: 'x' } });
    expect(path).not.toMatch(/[\u0000-\u001f\u202e]/);
    expect(path!.length).toBeLessThan(200);
  });

  it('name only the first few of many unknown keys', () => {
    const many = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, i]));
    const [line] = issuesOf(strict, { name: 'a', ...many });
    expect(line).toBe('(root): unknown key(s): k0, k1, k2, k3, k4, k5, k6, k7, …and 19992 more');
  });

  it('escape what a custom message quotes from the file', () => {
    const quoting = z.string().superRefine((value, ctx) => {
      ctx.addIssue({ code: 'custom', message: `"${value}" is not a phrase` });
    });
    expect(issuesOf(quoting, '\u001b[31mred')).toEqual([
      '(root): "\\u001b[31mred" is not a phrase',
    ]);
  });

  it('reach parseOrThrow unchanged', () => {
    expect(() => parseOrThrow(strict, { name: 'a', '\u001bx': 1 }, 'file.json')).toThrow(
      'file.json is invalid:\n  (root): unknown key(s): \\u001bx',
    );
  });
});

describe('escapeUnprintable', () => {
  it('leaves printable text of any script alone', () => {
    for (const text of ['plain', '요청이 너무 큼', 'タイム・アウト', 'emoji 🦊', 'tab-free'])
      expect(escapeUnprintable(text)).toBe(text);
  });

  it('spells control, format, separator, and lone surrogate characters as escapes', () => {
    expect(escapeUnprintable('a\u0000b\u007f\u009b\u200b\u2028\ufeff\u{e0001}\ud800')).toBe(
      'a\\u0000b\\u007f\\u009b\\u200b\\u2028\\ufeff\\u{e0001}\\ud800',
    );
  });

  it('cuts at a number of characters, never inside one', () => {
    expect(escapeUnprintable('abcdef', 6)).toBe('abcdef');
    expect(escapeUnprintable('abcdefg', 6)).toBe('abcdef…');
    expect(escapeUnprintable('🦊'.repeat(10), 3)).toBe('🦊🦊🦊…');
    expect(escapeUnprintable('x'.repeat(1_000_000), 4)).toBe('xxxx…');
  });
});
