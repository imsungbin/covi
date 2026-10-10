import type { DiffLine } from '@covi/core';
import {
  keywordsOf,
  lexer,
  NUMBER,
  type SyntaxFamily,
  syntaxFamily,
  WORD,
} from '../runtime/syntax.ts';
import type { MorphRow, MorphToken, MorphVisual, TokenTone } from '../timeline/types.ts';
import { codeLineText, DIRECTION_LIMITS } from './schema.ts';

/*
 * A morph's model, built from a diff hunk: every line split into tokens, the lines a card keeps
 * when the hunk is longer than it shows, and what stays between the code before the change and
 * the code after it. Pure and deterministic: the same hunk gives the same morph.
 */

const LIMITS = DIRECTION_LIMITS.morph;

type Lexeme = 'comment' | 'string' | 'number' | 'word' | 'space' | 'other';

/** The groups of the code panel's lexer, in order: each character lands in exactly one. */
const LEXEMES: readonly Lexeme[] = ['comment', 'string', 'number', 'word', 'space', 'other'];

/** The words, numbers, spaces, and single characters inside a comment or a string. */
const PARTS = new RegExp(`${WORD.source}|${NUMBER.source}|\\s+|[\\s\\S]`, 'gu');

/** Whitespace is layout only: it is never kept, removed, or added. */
export const isSpace = (token: MorphToken) => /^\s+$/u.test(token.text);

/** A line that opens a block comment, or (in C-like code) continues one, by family. */
const BLOCK_COMMENT: Partial<Record<SyntaxFamily, RegExp>> = {
  c: /^(\s*)((?:\/\*|\*).*)$/u,
  // A CSS line that starts with a star is a selector (`* {`, `*, *::before`), not a comment.
  css: /^(\s*)(\/\*.*)$/u,
};

/**
 * A line's lexemes. A line that opens or continues a block comment (it starts with a slash and a
 * star, or a star outside CSS) reads as a comment, as it does in its file, though the line is
 * read alone.
 */
function lex(line: string, family: SyntaxFamily): Array<{ text: string; kind: Lexeme }> {
  const inside = BLOCK_COMMENT[family]?.exec(line);
  if (inside)
    return [
      ...(inside[1] ? [{ text: inside[1], kind: 'space' as const }] : []),
      { text: inside[2]!, kind: 'comment' as const },
    ];
  return [...line.matchAll(lexer(family))].map((m) => ({
    text: m[0],
    kind: LEXEMES[m.slice(1).findIndex((group) => group !== undefined)] ?? 'other',
  }));
}

/**
 * A line's tokens with their syntax colors, as the code panel colors them: keywords, strings
 * (JSON keys as props), numbers, comments, calls, and capitalized names. Comments and strings are
 * split into their words, so a changed word moves on its own. At most `tokensPerLine`; the rest
 * of a longer line stays one token. Markup and CSS read as code here, where the panel has passes
 * of their own, so their colors can differ; their characters never do.
 */
export function tokenize(line: string, language?: string): MorphToken[] {
  const family = syntaxFamily(language);
  const keywords = keywordsOf(family);
  const lexemes = lex(line, family);
  const tokens = lexemes.flatMap((l, i): MorphToken[] => {
    const next = lexemes.slice(i + 1).find((n) => n.kind !== 'space')?.text ?? '';
    const tone = toneOf(l, next, family, keywords);
    const parts =
      l.kind === 'comment' || l.kind === 'string'
        ? [...l.text.matchAll(PARTS)].map((m) => m[0])
        : [l.text];
    return parts.map((text) => (tone ? { text, tone } : { text }));
  });
  if (tokens.length <= LIMITS.tokensPerLine) return tokens;
  const rest = tokens.slice(LIMITS.tokensPerLine - 1);
  return [...tokens.slice(0, LIMITS.tokensPerLine - 1), { text: rest.map((t) => t.text).join('') }];
}

function toneOf(
  l: { text: string; kind: Lexeme },
  next: string,
  family: SyntaxFamily,
  keywords: ReadonlySet<string>,
): TokenTone | undefined {
  switch (l.kind) {
    case 'comment':
      return 'comment';
    case 'string':
      return family === 'json' && next.startsWith(':') ? 'prop' : 'string';
    case 'number':
      return 'number';
    case 'word':
      if (keywords.has(l.text) || (family === 'sql' && /^[A-Z]{2,}$/.test(l.text)))
        return 'keyword';
      if (next.startsWith('(')) return 'fn';
      return /^[A-Z]/.test(l.text) ? 'type' : undefined;
    default:
      return undefined;
  }
}

/**
 * The tokens two lines share, in order (a longest common subsequence of their non-space tokens,
 * weighed by length), as pairs of token indexes, and how many characters they hold.
 */
export function sharedTokens(
  a: readonly MorphToken[],
  b: readonly MorphToken[],
): { pairs: Array<[number, number]>; weight: number } {
  const ia = a.flatMap((t, i) => (isSpace(t) ? [] : [i]));
  const ib = b.flatMap((t, i) => (isSpace(t) ? [] : [i]));
  const text = (list: readonly MorphToken[], at: readonly number[], k: number) =>
    list[at[k]!]!.text;
  const best = Array.from({ length: ia.length + 1 }, () =>
    new Array<number>(ib.length + 1).fill(0),
  );
  for (let i = ia.length - 1; i >= 0; i--)
    for (let j = ib.length - 1; j >= 0; j--) {
      const same = text(a, ia, i) === text(b, ib, j);
      best[i]![j] = Math.max(
        same ? text(a, ia, i).length + best[i + 1]![j + 1]! : 0,
        best[i + 1]![j]!,
        best[i]![j + 1]!,
      );
    }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < ia.length && j < ib.length; ) {
    const t = text(a, ia, i);
    if (t === text(b, ib, j) && best[i]![j] === t.length + best[i + 1]![j + 1]!) {
      pairs.push([ia[i]!, ib[j]!]);
      i++;
      j++;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  return { pairs, weight: best[0]![0]! };
}

/** Two lines pair when they share at least this share of the shorter one's characters (and two). */
const PAIR_SHARE = 0.25;

/** A line's characters outside whitespace. */
const weightOf = (tokens: readonly MorphToken[]) =>
  tokens.reduce((n, t) => n + (isSpace(t) ? 0 : t.text.length), 0);

/**
 * Which added line replaces which deleted line in a block of changes: pairs in order, chosen to
 * keep the most characters in place. Lines that share little (a comma) are not paired: each folds
 * away, or slides in, on its own.
 */
export function pairLines(
  dels: ReadonlyArray<readonly MorphToken[]>,
  adds: ReadonlyArray<readonly MorphToken[]>,
): Array<[number, number]> {
  const w = dels.map((d) =>
    adds.map((a) => {
      const { weight } = sharedTokens(d, a);
      return weight >= Math.max(2, PAIR_SHARE * Math.min(weightOf(d), weightOf(a))) ? weight : 0;
    }),
  );
  const best = Array.from({ length: dels.length + 1 }, () =>
    new Array<number>(adds.length + 1).fill(0),
  );
  for (let i = dels.length - 1; i >= 0; i--)
    for (let j = adds.length - 1; j >= 0; j--)
      best[i]![j] = Math.max(
        w[i]![j]! > 0 ? w[i]![j]! + best[i + 1]![j + 1]! : -1,
        best[i + 1]![j]!,
        best[i]![j + 1]!,
      );
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < dels.length && j < adds.length; ) {
    if (w[i]![j]! > 0 && best[i]![j] === w[i]![j]! + best[i + 1]![j + 1]!) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (best[i + 1]![j]! >= best[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const onBase = (l: Pick<DiffLine, 'kind'>) => l.kind !== 'add';
const onHead = (l: Pick<DiffLine, 'kind'>) => l.kind !== 'del';

interface Sides {
  base: number;
  head: number;
}

/**
 * The rows each side shows for the lines kept: the kept lines on that side, and one marker for
 * each run left out between kept lines that hides lines of that side. Runs at either end are cut,
 * as a code card cuts a hunk to its window.
 */
function rowsShown(lines: readonly DiffLine[], keep: readonly boolean[]): Sides {
  const rows = { base: 0, head: 0 };
  const hidden = { base: 0, head: 0 };
  let started = false;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (onBase(l)) hidden.base++;
      if (onHead(l)) hidden.head++;
      return;
    }
    if (started) {
      if (hidden.base) rows.base++;
      if (hidden.head) rows.head++;
    }
    hidden.base = 0;
    hidden.head = 0;
    started = true;
    if (onBase(l)) rows.base++;
    if (onHead(l)) rows.head++;
  });
  return rows;
}

/**
 * Which lines of a hunk a morph keeps when a side has more than `max` rows: the changed lines
 * first (in order, while they fit), then the context nearest them (closest first, the earlier on
 * a tie). A run left out between kept lines takes a row on each side it hides lines of, its
 * marker, so no side shows more than `max` rows, markers included.
 */
export function keptLines(lines: readonly DiffLine[], max: number): boolean[] {
  const keep = lines.map(() => false);
  const changed = lines.flatMap((l, i) => (l.kind === 'context' ? [] : [i]));
  const distance = (i: number) => Math.min(...changed.map((c) => Math.abs(c - i)));
  const context = lines
    .flatMap((l, i) => (l.kind === 'context' ? [i] : []))
    .sort((a, b) => distance(a) - distance(b) || a - b);
  const fits = () => {
    const rows = rowsShown(lines, keep);
    return rows.base <= max && rows.head <= max;
  };
  // Keeping a line never takes a row away from either side (a run it splits costs at least the
  // marker it had), so a line refused once stays refused: one pass keeps all that fits.
  for (const i of [...changed, ...context]) {
    keep[i] = true;
    if (!fits()) keep[i] = false;
  }
  return keep;
}

/** The rows of a landscape card, the fewest any frame shows. */
const CARD_ROWS = LIMITS.changedLines + 2;

/**
 * Why a hunk cannot morph, or nothing when it can: it needs code on both sides (a new or a
 * deleted file has nothing to turn into), and few enough changed lines on each side that every
 * one shows, with room for context. Changes spread through a hunk need a marker for each run of
 * context between them, so fewer than that can still overflow a card and hide behind a marker,
 * or fill it so that one side shows nothing but markers. A card shows a side's code at 18 rows
 * whenever it does at 14 (it keeps the same changes, then the nearest context that fits).
 */
export function morphProblem(lines: readonly DiffLine[]): string | undefined {
  if (!lines.some(onBase))
    return 'the hunk has no lines before the change (a new file); show it as code';
  if (!lines.some(onHead))
    return 'the hunk has no lines after the change (a deleted file); show it as code';
  const most = LIMITS.changedLines;
  for (const [kind, side] of [
    ['del', 'base'],
    ['add', 'head'],
  ] as const) {
    const count = lines.filter((l) => l.kind === kind).length;
    if (count > most)
      return `the hunk changes ${count} lines on its ${side} side, and a morph shows at most ${most}; show it as code, with \`lines\``;
  }
  const keep = keptLines(lines.slice(0, LIMITS.hunkLines), CARD_ROWS);
  if (lines.some((l, i) => l.kind !== 'context' && !keep[i]))
    return `the hunk's changes lie too far apart for a morph's ${CARD_ROWS} rows to show every one; show it as code, with \`lines\``;
  for (const [side, on] of [
    ['base', onBase],
    ['head', onHead],
  ] as const)
    if (!lines.some((l, i) => keep[i] && on(l)))
      return `the hunk's changes fill a morph's ${CARD_ROWS} rows and leave its ${side} side no code, only markers for the lines left out; show it as code, with \`lines\``;
  return undefined;
}

export interface MorphOptions {
  /** The rows a side shows at most: 14, or 18 on tall frames. */
  max: number;
  language?: string;
  /** The marker for a run of `count` lines left out, in the video's language. */
  elided: (count: number) => string;
}

/**
 * A hunk as a morph shows it: the rows of each side (elided to `max`), the rows that become each
 * other (context lines, replaced lines, and elided runs on both sides), and the tokens that stay.
 * Nothing when a side has no lines (a new or a deleted file has nothing to turn into).
 */
export function morphHunk(
  lines: readonly DiffLine[],
  options: MorphOptions,
): Omit<MorphVisual, 'path' | 'language'> | undefined {
  if (!lines.some(onBase) || !lines.some(onHead)) return undefined;
  // Lines past the read limit are cut like a run at the end: a hunk that long fills a card first.
  const read = lines.slice(0, LIMITS.hunkLines);
  const keep = keptLines(read, options.max);
  const base: MorphRow[] = [];
  const head: MorphRow[] = [];
  const rows: MorphVisual['rows'] = [];
  const tokens: MorphVisual['tokens'] = [];
  const link = (b: number, h: number, pairs: ReadonlyArray<readonly [number, number]>) => {
    rows.push([b, h]);
    for (const [i, j] of pairs) tokens.push([b, i, h, j]);
  };
  const tokensOf = (text: string) => tokenize(codeLineText(text), options.language);
  const numbered = (n: number | undefined) => (n === undefined ? {} : { number: n });
  // The changed rows since the last context line or marker: a block whose lines may pair.
  let dels: number[] = [];
  let adds: number[] = [];
  const closeBlock = () => {
    const pairs = pairLines(
      dels.map((r) => base[r]!.tokens),
      adds.map((r) => head[r]!.tokens),
    );
    for (const [i, j] of pairs) {
      const [b, h] = [dels[i]!, adds[j]!];
      link(b, h, sharedTokens(base[b]!.tokens, head[h]!.tokens).pairs);
    }
    dels = [];
    adds = [];
  };
  const hidden = { base: 0, head: 0 };
  // A run left out between kept lines becomes a marker on each side it hides lines of.
  const closeHidden = () => {
    if (!hidden.base && !hidden.head) return;
    closeBlock();
    const marker = (count: number): MorphRow => ({
      type: 'elided',
      tokens: [{ text: options.elided(count) }],
    });
    const b = hidden.base ? base.push(marker(hidden.base)) - 1 : -1;
    const h = hidden.head ? head.push(marker(hidden.head)) - 1 : -1;
    if (b >= 0 && h >= 0)
      link(b, h, base[b]!.tokens[0]!.text === head[h]!.tokens[0]!.text ? [[0, 0]] : []);
    hidden.base = 0;
    hidden.head = 0;
  };
  read.forEach((l, i) => {
    if (!keep[i]) {
      if (onBase(l)) hidden.base++;
      if (onHead(l)) hidden.head++;
      return;
    }
    if (base.length || head.length) closeHidden();
    hidden.base = 0;
    hidden.head = 0;
    const t = tokensOf(l.text);
    if (l.kind === 'context') {
      closeBlock();
      const b = base.push({ type: 'context', ...numbered(l.oldLine), tokens: t }) - 1;
      const h = head.push({ type: 'context', ...numbered(l.newLine), tokens: [...t] }) - 1;
      link(
        b,
        h,
        t.flatMap((token, k): Array<[number, number]> => (isSpace(token) ? [] : [[k, k]])),
      );
    } else if (l.kind === 'del')
      dels.push(base.push({ type: 'del', ...numbered(l.oldLine), tokens: t }) - 1);
    else adds.push(head.push({ type: 'add', ...numbered(l.newLine), tokens: t }) - 1);
  });
  closeBlock();
  return { base, head, rows, tokens };
}
