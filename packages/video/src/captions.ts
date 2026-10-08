import { formatTimestamp, type Language } from '@covi/core';
import type { PhraseSpan } from './storyboard/grammar.ts';
import { displayWidth, isCjk, segments } from './text.ts';
import type { CaptionCue } from './timeline/types.ts';

export interface CaptionOptions {
  /** Line length in half-width cells: a Latin letter takes one, a CJK character two. */
  maxChars: number;
  maxLines: number;
  minDuration: number;
  /** The narration's language; decides how sentences and lines break. Default: English. */
  language?: Language;
}

/**
 * How a language breaks into sentences, words, and lines. English splits at spaces and counts
 * characters, as it always has. Korean also breaks lines at spaces (between words, never inside
 * one) but counts display width. Japanese and Chinese have no spaces: lines break between words
 * found by Intl.Segmenter, following line-break rules (kinsoku) for punctuation.
 */
interface Layout {
  join: string;
  width: (text: string) => number;
  /** A unit ending a clause, where a cue may break early. */
  clauseEnd: RegExp;
  /** A line ending that reads well before a line break. */
  lineEnd: RegExp;
}

const ENGLISH: Layout = {
  join: ' ',
  width: (text) => text.length,
  clauseEnd: /[,;:]$/,
  lineEnd: /[,.;:]$/,
};
const KOREAN: Layout = { ...ENGLISH, width: displayWidth };
const CJK: Layout = {
  join: '',
  width: displayWidth,
  clauseEnd: /[,;:、，；：]\s*$/,
  lineEnd: /[,.;:、，。；：！？]\s*$/,
};

function layoutFor(language: Language): Layout {
  return language === 'en' ? ENGLISH : language === 'ko' ? KOREAN : CJK;
}

/** Characters that never start a line (closing punctuation, small kana, the long vowel mark). */
const NO_LINE_START =
  /^[、。，．,.!?！？)）\]］}｝」』】〕〉》〙〗"'”’ーゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ…‥・：；:;%％‰°]/u;
/** Characters that never end a line (opening brackets and quotes). */
const NO_LINE_END = /[(（[［{｛「『【〔〈《〘〖"'“‘]$/u;
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;
const LATINISH = (s: string) => !/\s/.test(s) && ![...s].some(isCjk);

/**
 * Words a Japanese or Chinese line may break between. Punctuation stays with the word before it,
 * an opening bracket with the word after it, Latin runs (`c2-delegate`) stay whole, and Japanese
 * particles and endings written in hiragana stay with the word they follow (CLIを, 追加します).
 */
export function lineUnits(sentence: string, language: Language): string[] {
  const units: string[] = [];
  for (const seg of segments(sentence, language, 'word')) {
    const prev = units.at(-1);
    const glue =
      prev !== undefined &&
      (/^\s+$/.test(seg) ||
        NO_LINE_START.test(seg) ||
        NO_LINE_END.test(prev) ||
        (LATINISH(seg) && LATINISH(prev)) ||
        (HIRAGANA_ONLY.test(seg) && !/\s$/.test(prev)));
    if (glue) units[units.length - 1] = prev + seg;
    else units.push(seg);
  }
  return units;
}

function sentencesOf(text: string, language: Language): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (language === 'en') return clean.split(/(?<=[.!?]["')]?)\s+/).filter(Boolean);
  return segments(clean, language, 'sentence')
    .flatMap((s) => s.split(/(?<=[。！？])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function unitsOf(sentence: string, language: Language): string[] {
  return language === 'en' || language === 'ko'
    ? sentence.split(' ')
    : lineUnits(sentence, language);
}

/**
 * Splits narration into caption cues. Each sentence is planned on its own: Covi finds the fewest
 * cues that fit it, spreads the words evenly across them (no orphaned last word), and balances the
 * lines inside each cue. A sentence end always closes a cue.
 */
export function chunkCaption(text: string, options: CaptionOptions): string[][] {
  const language = options.language ?? 'en';
  const layout = layoutFor(language);
  const cues: string[][] = [];
  for (const sentence of sentencesOf(text, language))
    cues.push(...chunkSentence(unitsOf(sentence, language), options, layout));
  return cues;
}

function joined(words: readonly string[], layout: Layout): string {
  return words.join(layout.join).trim();
}

function chunkSentence(words: string[], options: CaptionOptions, layout: Layout): string[][] {
  const length = layout.width(joined(words, layout));
  const capacity = options.maxChars * options.maxLines;
  for (let count = Math.max(1, Math.ceil(length / capacity)); count <= words.length; count++) {
    const groups = splitEvenly(words, count, layout);
    const cues = groups.map((g) => toLines(g, options, layout));
    if (cues.every((c) => c !== undefined)) return cues as string[][];
  }
  // Single words longer than a line: show them as they are.
  return words.map((w) => [w.trim()]);
}

/** Splits words into `count` groups of roughly equal length, preferring clause breaks. */
function splitEvenly(words: string[], count: number, layout: Layout): string[][] {
  if (count <= 1) return [words];
  const gap = layout.width(layout.join);
  const total = layout.width(joined(words, layout));
  const groups: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const [i, word] of words.entries()) {
    const remainingGroups = count - groups.length;
    const target = (total - used) / remainingGroups;
    const currentLength = layout.width(joined(current, layout));
    const wordsLeft = words.length - i;
    const mustBreak = remainingGroups > 1 && current.length > 0 && wordsLeft >= remainingGroups - 1;
    const commaBreak = layout.clauseEnd.test(current.at(-1) ?? '') && currentLength >= target * 0.7;
    if (
      mustBreak &&
      (currentLength + gap + layout.width(word.trim()) > target * 1.15 || commaBreak)
    ) {
      groups.push(current);
      used += currentLength + gap;
      current = [];
    }
    current.push(word);
  }
  groups.push(current);
  return groups;
}

/** Lays a group out as one line, or two balanced lines; undefined when it does not fit. */
function toLines(words: string[], options: CaptionOptions, layout: Layout): string[] | undefined {
  const line = joined(words, layout);
  if (layout.width(line) <= options.maxChars) return [line];
  if (options.maxLines < 2 || words.length < 2) return undefined;
  const [a, b] = balance(words, options.maxChars, layout);
  return layout.width(a) <= options.maxChars && layout.width(b) <= options.maxChars
    ? [a, b]
    : undefined;
}

/** Splits a two-line cue at its most balanced break so lines read evenly. */
function balance(words: string[], maxChars: number, layout: Layout): [string, string] {
  let best: [string, string] = [joined(words.slice(0, 1), layout), joined(words.slice(1), layout)];
  let bestScore = Math.abs(layout.width(best[0]) - layout.width(best[1]));
  for (let i = 1; i < words.length; i++) {
    const left = joined(words.slice(0, i), layout);
    const right = joined(words.slice(i), layout);
    const l = layout.width(left);
    const r = layout.width(right);
    if (l > maxChars || r > maxChars) continue;
    const score = Math.abs(l - r) + (layout.lineEnd.test(left) ? -4 : 0);
    if (score < bestScore) {
      best = [left, right];
      bestScore = score;
    }
  }
  return best;
}

/** One speech window's cues, timed, with each cue's characters (whitespace removed) in order. */
interface TimedWindow {
  cues: CaptionCue[];
  chars: string[][];
}

const denseChars = (text: string) => [...text.replace(/\s/g, '')];

/** What one character weighs in a cue's timing, the way a whole cue is weighed. */
function charWeight(language: Language): (char: string) => number {
  return language === 'en' ? (char) => char.length : displayWidth;
}

/** Times a window's cues in proportion to their length, honoring a minimum duration. */
function timeWindow(
  w: { text: string; start: number; end: number },
  options: CaptionOptions,
): TimedWindow | undefined {
  const language = options.language ?? 'en';
  const weigh = (lines: string[]) =>
    language === 'en'
      ? lines.join(' ').replace(/\s/g, '').length
      : displayWidth(lines.join('').replace(/\s/g, ''));
  const chunks = chunkCaption(w.text, options);
  if (chunks.length === 0 || w.end <= w.start) return undefined;
  const weights = chunks.map((c) => Math.max(4, weigh(c)));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = w.end - w.start;
  let durations = weights.map((wt) => (span * wt) / total);
  // Borrow time for cues that would flash by too quickly.
  const short = durations.filter((d) => d < options.minDuration).length;
  if (short && span >= options.minDuration * chunks.length) {
    const deficit = durations.reduce((n, d) => n + Math.max(0, options.minDuration - d), 0);
    const pool = durations.reduce((n, d) => n + Math.max(0, d - options.minDuration), 0);
    durations = durations.map((d) =>
      d < options.minDuration
        ? options.minDuration
        : d - ((d - options.minDuration) / pool) * deficit,
    );
  }
  const cues: CaptionCue[] = [];
  let t = w.start;
  chunks.forEach((lines, i) => {
    const end = i === chunks.length - 1 ? w.end : t + durations[i]!;
    cues.push({ start: round(t), end: round(end), lines });
    t = end;
  });
  return { cues, chars: chunks.map((lines) => denseChars(lines.join(''))) };
}

/**
 * When a window reaches its character `j` (whitespace removed; `j` equal to the count is its
 * end): the start of the cue holding it, plus that cue's share by the weight before it.
 */
function spokenAt(timed: TimedWindow, j: number, weight: (char: string) => number): number {
  let from = 0;
  for (const [k, chars] of timed.chars.entries()) {
    if (j < from + chars.length || k === timed.chars.length - 1) {
      const cue = timed.cues[k]!;
      const local = Math.max(0, Math.min(chars.length, j - from));
      const total = chars.reduce((n, c) => n + weight(c), 0);
      const before = chars.slice(0, local).reduce((n, c) => n + weight(c), 0);
      return cue.start + (cue.end - cue.start) * (total > 0 ? before / total : 0);
    }
    from += chars.length;
  }
  return timed.cues.at(-1)?.end ?? 0;
}

/** Times cues within each speech window in proportion to their length, honoring a minimum duration. */
export function buildCaptions(
  windows: Array<{ text: string; start: number; end: number }>,
  options: CaptionOptions,
): CaptionCue[] {
  return windows.flatMap((w) => timeWindow(w, options)?.cues ?? []);
}

/**
 * When a phrase of a line is spoken, from its first character to just past its last, by the
 * text-weighted split the captions use: each cue gets its share of the window, and inside a cue
 * the phrase starts after the weight of the text before it. `span` is what `findPhrase` returns.
 * Undefined when the window has no time, the line no text, or the phrase was not found.
 */
export function phraseTime(
  w: { text: string; start: number; end: number },
  span: PhraseSpan,
  options: CaptionOptions,
): { start: number; end: number } | undefined {
  const timed = timeWindow(w, options);
  if (!timed || span.index < 0) return undefined;
  const weight = charWeight(options.language ?? 'en');
  return {
    start: round(spokenAt(timed, span.index, weight)),
    end: round(spokenAt(timed, span.index + span.length, weight)),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function toVtt(cues: readonly CaptionCue[]): string {
  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.lines.join('\n')}`,
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return `${cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.start, ',')} --> ${formatTimestamp(c.end, ',')}\n${c.lines.join('\n')}`).join('\n\n')}\n`;
}

export function captionOptionsFor(
  orientation: 'vertical' | 'landscape' | 'square',
): CaptionOptions {
  if (orientation === 'vertical') return { maxChars: 30, maxLines: 2, minDuration: 0.9 };
  if (orientation === 'square') return { maxChars: 34, maxLines: 2, minDuration: 0.9 };
  return { maxChars: 44, maxLines: 2, minDuration: 0.9 };
}
