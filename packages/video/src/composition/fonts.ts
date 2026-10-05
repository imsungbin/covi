import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import type { Language } from '@covi/core';

const require = createRequire(import.meta.url);

/**
 * CJK fonts bundled with Covi (Noto Sans, SIL Open Font License). Inter and JetBrains Mono have no
 * CJK glyphs, and system fallbacks differ between machines (Linux CI often has none, showing □),
 * so a composition embeds the Noto slices its own text needs. Han characters take the shapes of
 * the video's language: Japanese kanji, Simplified Chinese hanzi, or Korean hanja.
 */
export type CjkFont = 'ko' | 'ja' | 'zh';

export const CJK_FAMILY: Record<CjkFont, string> = {
  ko: 'Noto Sans KR Variable',
  ja: 'Noto Sans JP Variable',
  zh: 'Noto Sans SC Variable',
};

const PACKAGE: Record<CjkFont, { name: string; id: string }> = {
  ko: { name: '@fontsource-variable/noto-sans-kr', id: 'noto-sans-kr' },
  ja: { name: '@fontsource-variable/noto-sans-jp', id: 'noto-sans-jp' },
  zh: { name: '@fontsource-variable/noto-sans-sc', id: 'noto-sans-sc' },
};

const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_OR_CJK_PUNCTUATION = /[\p{Script=Han}　-〿＀-￯]/u;

/** The CJK fonts some text needs, the video's own language first. */
export function cjkFontsFor(text: string, language: Language): CjkFont[] {
  const needed = new Set<CjkFont>();
  const kana = KANA.test(text);
  const hangul = HANGUL.test(text);
  if (hangul) needed.add('ko');
  if (kana) needed.add('ja');
  if (HAN_OR_CJK_PUNCTUATION.test(text))
    needed.add(language !== 'en' ? language : kana ? 'ja' : hangul ? 'ko' : 'zh');
  const order: CjkFont[] = language === 'en' ? ['ko', 'ja', 'zh'] : [language];
  for (const f of ['ko', 'ja', 'zh'] as const) if (!order.includes(f)) order.push(f);
  return order.filter((f) => needed.has(f));
}

/** A font stack with the CJK families placed right after the first (Latin) family. */
export function withCjkFamilies(stack: string, fonts: readonly CjkFont[]): string {
  if (!fonts.length) return stack;
  const [first, ...rest] = stack.split(',');
  return [first, ...fonts.map((f) => ` '${CJK_FAMILY[f]}'`), ...rest].join(',');
}

export interface FontSlice {
  family: string;
  /** Absolute path of the woff2 file. */
  file: string;
  /** File name inside the composition's assets/fonts/. */
  name: string;
  unicodeRange: string;
}

type Range = [number, number];

function parseRanges(unicodeRange: string): Range[] {
  return unicodeRange.split(',').map((part) => {
    const [lo, hi] = part.trim().replace(/^U\+/i, '').split('-');
    const a = Number.parseInt(lo!, 16);
    return [a, hi ? Number.parseInt(hi, 16) : a];
  });
}

/**
 * The slices of each font that cover `text`. Fontsource splits each CJK font into about a hundred
 * unicode-range slices; copying only those the text uses keeps a composition small and offline.
 * Latin slices are skipped (Inter draws Latin text).
 */
export function fontSlices(fonts: readonly CjkFont[], text: string): FontSlice[] {
  const used = [...new Set([...text].map((c) => c.codePointAt(0)!))].filter((c) => c > 0x7f);
  const out: FontSlice[] = [];
  for (const font of fonts) {
    const pkg = PACKAGE[font];
    const meta = require.resolve(`${pkg.name}/unicode.json`);
    const subsets = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, string>;
    for (const [subset, unicodeRange] of Object.entries(subsets)) {
      const index = /^\[(\d+)\]$/.exec(subset)?.[1];
      if (index === undefined) continue;
      const ranges = parseRanges(unicodeRange);
      if (!used.some((c) => ranges.some(([lo, hi]) => c >= lo && c <= hi))) continue;
      const name = `${pkg.id}-${index}-wght-normal.woff2`;
      out.push({
        family: CJK_FAMILY[font],
        file: join(dirname(meta), 'files', name),
        name: basename(name),
        unicodeRange,
      });
    }
  }
  return out;
}
