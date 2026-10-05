import { type Language, LOCALE, wordCount } from '@covi/core';

/**
 * How much text is on screen and in speech, per language. English counts words and characters as
 * it always has; Korean, Japanese, and Chinese count characters and syllables, measured with
 * Intl.Segmenter and East Asian Width so CJK text is neither undercounted nor overflowing.
 */

/** East Asian Wide and Fullwidth ranges (UAX #11): CJK, Hangul, kana, fullwidth forms, emoji. */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

export function isWide(codePoint: number): boolean {
  for (const [lo, hi] of WIDE) {
    if (codePoint < lo) return false;
    if (codePoint <= hi) return true;
  }
  return false;
}

/** Display width in half-width cells: CJK characters take two, Latin letters one. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += isWide(char.codePointAt(0)!) ? 2 : 1;
  return width;
}

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(language: Language, granularity: 'grapheme' | 'word' | 'sentence') {
  const key = `${language}:${granularity}`;
  let s = segmenters.get(key);
  if (!s) {
    s = new Intl.Segmenter(LOCALE[language], { granularity });
    segmenters.set(key, s);
  }
  return s;
}

export function segments(
  text: string,
  language: Language,
  granularity: 'grapheme' | 'word' | 'sentence',
): string[] {
  return [...segmenter(language, granularity).segment(text)].map((s) => s.segment);
}

const CJK_CHAR = /[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export function isCjk(char: string): boolean {
  return CJK_CHAR.test(char);
}

/** Rough syllables in a Latin word: vowel groups, at least one (a spelled letter is one). */
function latinSyllables(word: string): number {
  return Math.max(1, word.toLowerCase().match(/[aeiouy]+/g)?.length ?? 0);
}

/**
 * Units of speech: words in English; in Korean, Japanese, and Chinese, characters (syllables, or
 * morae for kana), with Latin words counted by their syllables and numbers by their digits.
 */
export function speechUnits(text: string, language: Language): number {
  if (language === 'en') return wordCount(text);
  let units = 0;
  for (const g of segments(text, language, 'grapheme')) if (isCjk(g)) units++;
  for (const word of text.match(/[A-Za-z]+/g) ?? []) units += latinSyllables(word);
  for (const digits of text.match(/\d+/g) ?? []) units += digits.length;
  return units;
}

/**
 * Narration budget, in speech units per second. English keeps its 2.5 words per second. The
 * others are measured speaking rates of macOS voices (Yuna 5.8 syllables/s, Kyoko 5.4 and
 * Tingting 4.0 characters/s) scaled by the same margin English has (2.5 against Samantha's 3.4).
 */
export const SPEECH_RATE: Record<Language, number> = { en: 2.5, ko: 4.3, ja: 4.0, zh: 3.0 };

/**
 * Narration faster than this sounds rushed (QC `narration-pace`). English keeps 4.2 words per
 * second; the others sit at about 1.3 times the measured voice rates, above Covi's own maximum
 * tempo (1.15) so a fitted video never trips it.
 */
export const PACE_LIMIT: Record<Language, number> = { en: 4.2, ko: 7.5, ja: 7, zh: 5.5 };

/**
 * Captions faster than this, in characters per second, flash by (QC `caption-timing`). English
 * keeps 24, counting spaces. The others follow subtitle reading speeds (Korean 12, Chinese 9)
 * with English's margin (24 against 17), counting characters without spaces. Japanese subtitle
 * guidance (4) assumes condensed text; Covi's captions are the narration itself, which a Japanese
 * voice speaks at 5–7 characters per second, so its limit sits just above that instead.
 */
export const CAPTION_SPEED_LIMIT: Record<Language, number> = { en: 24, ko: 17, ja: 8, zh: 13 };

/**
 * Characters a caption cue asks the viewer to read, counted the way CAPTION_SPEED_LIMIT expects:
 * in Korean, Japanese, and Chinese a full-width character counts one and a half-width one (a Latin
 * letter or digit) half, as subtitle guidelines for those languages count them.
 */
export function captionCharacters(lines: readonly string[], language: Language): number {
  if (language === 'en') return lines.join(' ').length;
  let count = 0;
  for (const g of segments(lines.join(''), language, 'grapheme')) {
    if (/\s/.test(g)) continue;
    count += isWide(g.codePointAt(0)!) ? 1 : 0.5;
  }
  return count;
}
