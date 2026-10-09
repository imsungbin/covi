import type { DiffLine } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
import {
  isSpace,
  keptLines,
  morphHunk,
  morphProblem,
  pairLines,
  sharedTokens,
  tokenize,
} from '../src/direction/tokens.ts';
import type { MorphVisual } from '../src/timeline/types.ts';

const texts = (line: string, language?: string) => tokenize(line, language).map((t) => t.text);
const context = (text: string, oldLine: number, newLine = oldLine): DiffLine => ({
  kind: 'context',
  text,
  oldLine,
  newLine,
});
const del = (text: string, n: number): DiffLine => ({ kind: 'del', text, oldLine: n });
const add = (text: string, n: number): DiffLine => ({ kind: 'add', text, newLine: n });
const elided = (count: number) => `… ${count} lines`;
type Morph = Omit<MorphVisual, 'path' | 'language'>;
/** One side of a morph, a row a string. */
const side = (m: Morph, which: 'base' | 'head') =>
  m[which].map((r) => r.tokens.map((t) => t.text).join(''));
/** What stays of each linked row pair, as the kept tokens' text. */
const kept = (m: Morph) =>
  m.rows.map(([b, h]) =>
    m.tokens
      .filter(([tb, , th]) => tb === b && th === h)
      .map(([, i]) => m.base[b]!.tokens[i]!.text)
      .join(''),
  );

// The benchmark's change: the request lists document refs instead of embedding the documents.
const hunk: DiffLine[] = [
  context('  return messages.map((message) => ({ ...message, parts: messages.length }));', 39),
  context('}', 40),
  context('', 41),
  del(
    '/** The messages that ask the reader to review these documents, each document in full. */',
    42,
  ),
  add('/**', 42),
  add(
    ' * The messages that ask the reader to review these documents: which ones, by id, title, and',
    43,
  ),
  add(' * size. The reader fetches each document from the store itself.', 44),
  add(' */', 45),
  context('export function buildReviewRequest(store, ids) {', 43, 46),
  context('  return chunk(', 44, 47),
  context("    'review-1',", 45, 48),
  del("    'documents',", 46),
  del('    ids.map((id) => store.get(id)),', 47),
  add("    'refs',", 49),
  add('    ids.map((id) => {', 50),
  add('      const { title, body } = store.get(id);', 51),
  add('      return { id, title, bytes: Buffer.byteLength(body) };', 52),
  add('    }),', 53),
  context('  );', 48, 54),
  context('}', 49, 55),
];

describe('tokenizing a line', () => {
  it('splits words, numbers, strings, comments, whitespace, and single punctuation', () => {
    expect(texts('  ids.map((id) => store.get(id)), // fetch')).toEqual([
      '  ',
      'ids',
      '.',
      'map',
      '(',
      '(',
      'id',
      ')',
      ' ',
      '=',
      '>',
      ' ',
      'store',
      '.',
      'get',
      '(',
      'id',
      ')',
      ')',
      ',',
      ' ',
      '/',
      '/',
      ' ',
      'fetch',
    ]);
    // Strings and comments split into their words, so a changed word moves on its own.
    expect(texts("send('a b', 42);")).toEqual([
      'send',
      '(',
      "'",
      'a',
      ' ',
      'b',
      "'",
      ',',
      ' ',
      '42',
      ')',
      ';',
    ]);
    expect(texts('x = 1 # note', 'python')).toEqual([
      'x',
      ' ',
      '=',
      ' ',
      '1',
      ' ',
      '#',
      ' ',
      'note',
    ]);
  });

  it('keeps every character, in any script, with an unclosed quote and a carriage return', () => {
    for (const line of ['const 수량 = "🙂🎉";', 'say("unclosed', 'café = naïve\r', '\t\tx', ''])
      expect(texts(line).join('')).toBe(line);
    expect(texts('const 수량 = 1;')).toContain('수량');
  });

  it('colors tokens as the code panel does, and a line inside a block comment as a comment', () => {
    const tones = (line: string, language?: string) =>
      tokenize(line, language)
        .filter((t) => !isSpace(t))
        .map((t) => `${t.text}:${t.tone ?? '-'}`);
    expect(tones('return buildRequest(Store, "x", 2);')).toEqual([
      'return:keyword',
      'buildRequest:fn',
      '(:-',
      'Store:type',
      ',:-',
      '":string',
      'x:string',
      '":string',
      ',:-',
      '2:number',
      '):-',
      ';:-',
    ]);
    expect(tones('"refs": true', 'json')).toEqual([
      '":prop',
      'refs:prop',
      '":prop',
      '::-',
      'true:keyword',
    ]);
    expect(tones('def run(self):', 'python')[0]).toBe('def:keyword');
    expect(tones('SELECT id FROM docs', 'sql')).toEqual([
      'SELECT:keyword',
      'id:-',
      'FROM:keyword',
      'docs:-',
    ]);
    expect(tones(' * The reader fetches it.').every((t) => t.endsWith(':comment'))).toBe(true);
  });

  it('caps the tokens of a line, keeping the rest of it as one', () => {
    const line = Array.from({ length: 100 }, (_, i) => `a${i}`).join(',');
    const tokens = tokenize(line);
    expect(tokens).toHaveLength(DIRECTION_LIMITS.morph.tokensPerLine);
    expect(tokens.map((t) => t.text).join('')).toBe(line);
  });
});

describe('aligning lines', () => {
  it('keeps the tokens two lines share, longest first, in order', () => {
    const a = tokenize('    ids.map((id) => store.get(id)),');
    const b = tokenize('    ids.map((id) => {');
    const { pairs } = sharedTokens(a, b);
    for (const [i, j] of pairs) expect(a[i]!.text).toBe(b[j]!.text);
    expect(pairs.map(([i]) => a[i]!.text).join('')).toBe('ids.map((id)=>');
  });

  it('pairs a deleted line with the added line it shares the most with, in order', () => {
    const dels = ['/** The messages that ask the reader to review these documents. */'].map((l) =>
      tokenize(l),
    );
    const adds = [
      '/**',
      ' * The messages that ask the reader to review these documents.',
      ' */',
    ].map((l) => tokenize(l));
    expect(pairLines(dels, adds)).toEqual([[0, 1]]);
    // Lines that share nothing, or only a comma, stay unpaired.
    expect(pairLines([tokenize('alpha')], [tokenize('beta')])).toEqual([]);
    expect(pairLines([tokenize('// every document, in full')], [tokenize("'refs',")])).toEqual([]);
    // Order is kept: a later deleted line never pairs with an earlier added line.
    expect(
      pairLines([tokenize('one()'), tokenize('two()')], [tokenize('two()'), tokenize('one()')]),
    ).toHaveLength(1);
  });
});

describe('a hunk as a morph shows it', () => {
  it('shows every changed line and the context nearest them, at most 14 rows a side', () => {
    const m = morphHunk(hunk, { max: 14, language: 'javascript', elided })!;
    expect(side(m, 'base')).toEqual([
      '',
      '/** The messages that ask the reader to review these documents, each document in full. */',
      'export function buildReviewRequest(store, ids) {',
      '  return chunk(',
      "    'review-1',",
      "    'documents',",
      '    ids.map((id) => store.get(id)),',
      '  );',
    ]);
    // The rows at either end are cut, as a code card cuts a hunk; nothing between is left out.
    expect(side(m, 'head')).toEqual([
      '',
      '/**',
      ' * The messages that ask the reader to review these documents: which ones, by id, title, and',
      ' * size. The reader fetches each document from the store itself.',
      ' */',
      'export function buildReviewRequest(store, ids) {',
      '  return chunk(',
      "    'review-1',",
      "    'refs',",
      '    ids.map((id) => {',
      '      const { title, body } = store.get(id);',
      '      return { id, title, bytes: Buffer.byteLength(body) };',
      '    }),',
      '  );',
    ]);
    expect(m.base.map((r) => r.number)).toEqual([41, 42, 43, 44, 45, 46, 47, 48]);
    expect(m.head.map((r) => r.number)).toEqual([
      41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54,
    ]);
  });

  it('links context lines and replaced lines, and keeps the tokens they share', () => {
    const m = morphHunk(hunk, { max: 14, language: 'javascript', elided })!;
    // The one-line comment becomes the comment's sentence (not its opening), `'documents'` the
    // `'refs'` (its quotes stay), and the call keeps everything up to the arrow.
    expect(m.rows).toEqual([
      [0, 0],
      [1, 2],
      [2, 5],
      [3, 6],
      [4, 7],
      [5, 8],
      [6, 9],
      [7, 13],
    ]);
    expect(kept(m)).toEqual([
      '',
      '*Themessagesthataskthereadertoreviewthesedocuments,',
      'exportfunctionbuildReviewRequest(store,ids){',
      'returnchunk(',
      "'review-1',",
      "'',",
      'ids.map((id)=>',
      ');',
    ]);
    for (const [b, i, h, j] of m.tokens)
      expect(m.base[b]!.tokens[i]!.text).toBe(m.head[h]!.tokens[j]!.text);
  });

  it('opens room for a line added between context lines, linking the context around it', () => {
    const m = morphHunk([context('a();', 1), add('b();', 2), context('c();', 2, 3)], {
      max: 14,
      elided,
    })!;
    expect(side(m, 'base')).toEqual(['a();', 'c();']);
    expect(side(m, 'head')).toEqual(['a();', 'b();', 'c();']);
    expect(m.rows).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('is deterministic', () => {
    expect(morphHunk(hunk, { max: 14, elided })).toEqual(morphHunk(hunk, { max: 14, elided }));
  });

  it('marks a run it leaves out between kept lines with how many lines it hides', () => {
    const groups: DiffLine[] = [
      context('top', 1),
      ...Array.from({ length: 6 }, (_, i) => add(`a${i}();`, i + 2)),
      ...Array.from({ length: 6 }, (_, i) => context(`m${i}`, i + 2, i + 8)),
      ...Array.from({ length: 6 }, (_, i) => add(`b${i}();`, i + 14)),
    ];
    const m = morphHunk(groups, { max: 14, elided })!;
    expect(side(m, 'head')).toEqual([
      'top',
      'a0();',
      'a1();',
      'a2();',
      'a3();',
      'a4();',
      'a5();',
      '… 6 lines',
      'b0();',
      'b1();',
      'b2();',
      'b3();',
      'b4();',
      'b5();',
    ]);
    expect(side(m, 'base')).toEqual(['top', '… 6 lines']);
    // The marker reads the same on both sides, so it stays and travels.
    expect(m.rows).toContainEqual([1, 7]);
    expect(m.tokens).toContainEqual([1, 0, 7, 0]);
  });

  it('cuts a long hunk to its changes and the context nearest them', () => {
    const long: DiffLine[] = [
      ...Array.from({ length: 20 }, (_, i) => context(`c${i}`, i + 1)),
      del('old();', 21),
      add('fresh();', 21),
      ...Array.from({ length: 20 }, (_, i) => context(`d${i}`, 22 + i)),
    ];
    const m = morphHunk(long, { max: 14, elided })!;
    expect(side(m, 'head')).toEqual([
      'c13',
      'c14',
      'c15',
      'c16',
      'c17',
      'c18',
      'c19',
      'fresh();',
      'd0',
      'd1',
      'd2',
      'd3',
      'd4',
      'd5',
    ]);
    const many: DiffLine[] = [
      del('old();', 1),
      add('fresh();', 1),
      ...Array.from({ length: DIRECTION_LIMITS.morph.hunkLines + 50 }, (_, i) =>
        context(`c${i}`, i + 2),
      ),
    ];
    expect(morphHunk(many, { max: 14, elided })!.head).toHaveLength(14);
  });

  it('keeps every side within its rows even when the changes alone overflow it', () => {
    const big: DiffLine[] = [
      context('start', 1),
      ...Array.from({ length: 30 }, (_, i) => add(`line${i}();`, i + 2)),
      context('end', 32),
    ];
    expect(morphHunk(big, { max: 14, elided })!.head.length).toBeLessThanOrEqual(14);
    expect(keptLines(big, 14).filter(Boolean).length).toBeLessThanOrEqual(14);
  });

  it('says why a hunk cannot morph: no code on a side, or more changes than a card shows', () => {
    expect(morphProblem(hunk)).toBeUndefined();
    expect(morphHunk([add('a', 1), add('b', 2)], { max: 14, elided })).toBeUndefined();
    expect(morphProblem([add('a', 1)])).toMatch(/no lines before the change/);
    expect(morphProblem([del('a', 1)])).toMatch(/no lines after the change/);
    const adds = Array.from({ length: 13 }, (_, i) => add(`x${i}`, i + 2));
    expect(morphProblem([context('a', 1), ...adds])).toMatch(
      /changes 13 lines on its head side, and a morph shows at most 12/,
    );
    expect(morphProblem([context('a', 1), ...adds.slice(1)])).toBeUndefined();
    // Twelve added lines in groups, each group after six context lines (one hunk at three lines of
    // context): three groups fit a card with a marker between each, four would hide a change.
    const spread = (groups: number) =>
      Array.from({ length: groups }, (_, g) => [
        ...Array.from({ length: 6 }, (_, i) => context(`c${g}.${i}`, g * 6 + i + 1)),
        ...Array.from({ length: 12 / groups }, (_, i) => add(`x${g}.${i}`, 100 + g * 12 + i)),
      ]).flat();
    expect(morphProblem(spread(3))).toBeUndefined();
    const shown = morphHunk(spread(3), { max: 14, elided })!.head.filter((r) => r.type === 'add');
    expect(shown).toHaveLength(12);
    expect(morphProblem(spread(4))).toMatch(
      /changes lie too far apart for a morph's 14 rows to show every one/,
    );
  });
});
