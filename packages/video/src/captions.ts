import { formatTimestamp } from '@covi/core';
import type { CaptionCue } from './timeline/types.ts';

export interface CaptionOptions {
  maxChars: number;
  maxLines: number;
  minDuration: number;
}

/**
 * Splits narration into caption cues. Each sentence is planned on its own: Covi finds the fewest
 * cues that fit it, spreads the words evenly across them (no orphaned last word), and balances the
 * lines inside each cue. A sentence end always closes a cue.
 */
export function chunkCaption(text: string, options: CaptionOptions): string[][] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?]["')]?)\s+/)
    .filter(Boolean);
  const cues: string[][] = [];
  for (const sentence of sentences) cues.push(...chunkSentence(sentence.split(' '), options));
  return cues;
}

function chunkSentence(words: string[], options: CaptionOptions): string[][] {
  const length = words.join(' ').length;
  const capacity = options.maxChars * options.maxLines;
  for (let count = Math.max(1, Math.ceil(length / capacity)); count <= words.length; count++) {
    const groups = splitEvenly(words, count);
    const cues = groups.map((g) => toLines(g, options));
    if (cues.every((c) => c !== undefined)) return cues as string[][];
  }
  // Single words longer than a line: show them as they are.
  return words.map((w) => [w]);
}

/** Splits words into `count` groups of roughly equal character length, preferring comma breaks. */
function splitEvenly(words: string[], count: number): string[][] {
  if (count <= 1) return [words];
  const total = words.join(' ').length;
  const groups: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const [i, word] of words.entries()) {
    const remainingGroups = count - groups.length;
    const target = (total - used) / remainingGroups;
    const currentLength = current.join(' ').length;
    const wordsLeft = words.length - i;
    const mustBreak = remainingGroups > 1 && current.length > 0 && wordsLeft >= remainingGroups - 1;
    const commaBreak = /[,;:]$/.test(current.at(-1) ?? '') && currentLength >= target * 0.7;
    if (mustBreak && (currentLength + 1 + word.length > target * 1.15 || commaBreak)) {
      groups.push(current);
      used += currentLength + 1;
      current = [];
    }
    current.push(word);
  }
  groups.push(current);
  return groups;
}

/** Lays a group out as one line, or two balanced lines; undefined when it does not fit. */
function toLines(words: string[], options: CaptionOptions): string[] | undefined {
  const line = words.join(' ');
  if (line.length <= options.maxChars) return [line];
  if (options.maxLines < 2 || words.length < 2) return undefined;
  const [a, b] = balance(words.slice(0, 1).join(' '), words.slice(1).join(' '), options.maxChars);
  return a!.length <= options.maxChars && b!.length <= options.maxChars ? [a!, b!] : undefined;
}

/** Re-splits a two-line cue at its most balanced space so lines read evenly. */
function balance(a: string, b: string, maxChars: number): string[] {
  const words = `${a} ${b}`.split(' ');
  let best: [string, string] = [a, b];
  let bestScore = Math.abs(a.length - b.length);
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(' ');
    const right = words.slice(i).join(' ');
    if (left.length > maxChars || right.length > maxChars) continue;
    const score = Math.abs(left.length - right.length) + (/[,.;:]$/.test(left) ? -4 : 0);
    if (score < bestScore) {
      best = [left, right];
      bestScore = score;
    }
  }
  return best;
}

/** Times cues within each speech window in proportion to their length, honoring a minimum duration. */
export function buildCaptions(
  windows: Array<{ text: string; start: number; end: number }>,
  options: CaptionOptions,
): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const w of windows) {
    const chunks = chunkCaption(w.text, options);
    if (chunks.length === 0 || w.end <= w.start) continue;
    const weights = chunks.map((c) => Math.max(4, c.join(' ').replace(/\s/g, '').length));
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
    let t = w.start;
    chunks.forEach((lines, i) => {
      const end = i === chunks.length - 1 ? w.end : t + durations[i]!;
      out.push({ start: round(t), end: round(end), lines });
      t = end;
    });
  }
  return out;
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
