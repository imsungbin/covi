import { describe, expect, it } from 'vitest';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
import { tokenize } from '../src/direction/tokens.ts';
import { seeded } from '../src/runtime/anim.ts';
import { highlightLine } from '../src/runtime/highlight.ts';

/** A language of each highlighting family, and none. */
const LANGUAGES = [
  undefined,
  'typescript',
  'go',
  'python',
  'yaml',
  'shell',
  'css',
  'html',
  'vue',
  'json',
  'sql',
];

/** Lines that trip highlighters: number forms, strings, comments, markup, and odd characters. */
const TRICKY = [
  'const big = 10n + 1e5 + 0x1F + 0o7 + 0b1 + 1_000 + .5 + 2.5E-3;',
  'let n = 0xFFn + 1E-7 + 3.14e+2 + 1. + 08 + 0x + 1e + 1__2;',
  'total = pair.0 + version(1.2.3) + range(0..10) + 5px + 42abc + 1.toString()',
  'say("she said \\"hi\\"", \'it\\\'s\', `a ${b} \\` c`);',
  'const re = /^[a-z]+\\d{2,}$/gi.test(s) && /\\/\\*/.source;',
  'x = "unterminated',
  "y = 'open",
  'z = `open ${',
  'foo();// trailing',
  '/* an open block comment',
  ' * a line inside one',
  'a /* inline */ b */ c',
  '# a comment with a "quote',
  '-- an sql comment 1e5',
  '@app.route("/x", methods=["GET"])',
  'f"{name!r:>10} {1e3}"',
  'def f(x: int = 0o17) -> None: ...  # done',
  'color: #fff; margin: .5em 10px 1.5rem -2%;',
  '.card > a:hover { opacity: .5 }',
  'background: url("a&b.png") /* c */;',
  'echo "$HOME" ${PATH:-/bin} $1 $@ 2>&1 | grep -e \'x\' > /dev/null',
  '{"a": 1.5e10, "b": -2, "c": [0, .5, 1E3], "d": "x\\"y"}',
  '<div class="a" data-x={1 < 2 && b}>1 & 2 &amp; <b>three</b></div>',
  '<a href="?x=1&y=2">',
  '</p>',
  "SELECT id, 1e3 FROM t WHERE x <> 'a''b' AND y >= .5; -- note",
  '',
  '\t\tindented\ttab',
  '😀 emoji 漢字 수량(1) café naïve',
  'a < b && c > d & e; "<&>"',
  'trailing space  ',
  'crlf line;\r',
  'zero​width nbsp bom﻿',
  'lone \ud800 surrogate',
  'line sep end',
  '\\\\ backslashes \\',
  '٣٤ arabic digits ² é5 x²',
];

/** Characters code is made of, weighted toward the ones numbers, strings, and comments use. */
const ALPHABET = [
  ...'0123456789012345 abcdefxnoEX_$.+-*/#"\'`\\<>&;:{}()[]=@%!?,|\t\r',
  '수',
  'é',
  '漢',
  '😀',
  '́',
  ' ',
  ' ',
];

/** Seeded random lines, so the fuzz is the same on every run. */
const FUZZ = (() => {
  const random = seeded(1729);
  return Array.from({ length: 2000 }, () =>
    Array.from(
      { length: Math.floor(random() * 60) },
      () => ALPHABET[Math.floor(random() * ALPHABET.length)],
    ).join(''),
  );
})();

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
const TAG = /<span class="tk-[a-z]+">|<\/span>/g;

/** The text a highlighted line shows: its spans stripped and its escapes read back. */
const shown = (html: string) =>
  html.replace(TAG, '').replace(/&(amp|lt|gt|quot);/g, (e) => ENTITIES[e]!);

/** The numbers a highlighted line colors. */
const numbers = (line: string, language?: string) =>
  [...highlightLine(line, language).matchAll(/<span class="tk-number">([^<]*)<\/span>/g)].map(
    (m) => m[1],
  );

/** Every language with every line, for checks that hold for all of them. */
const EVERY = LANGUAGES.flatMap((language) =>
  [...TRICKY, ...FUZZ].map((line) => ({ language, line, html: highlightLine(line, language) })),
);

describe('highlighting a code line', () => {
  it('shows every character of the line, in order, in every language', () => {
    expect(EVERY.filter(({ line, html }) => shown(html) !== line)).toEqual([]);
  });

  it('escapes everything it does not wrap in its own spans', () => {
    const unsafe = EVERY.filter(({ html }) => {
      let depth = 0;
      for (const tag of html.match(TAG) ?? []) {
        depth += tag === '</span>' ? -1 : 1;
        if (depth < 0) return true;
      }
      const text = html.replace(TAG, '');
      return depth !== 0 || /[<>"]|&(?!(amp|lt|gt|quot);)/.test(text);
    });
    expect(unsafe).toEqual([]);
  });

  it('colors a number whole, in every form', () => {
    expect(numbers('const big = 10n + 1e5 + 0x1F + .5 + 2.5E-3;', 'typescript')).toEqual([
      '10n',
      '1e5',
      '0x1F',
      '.5',
      '2.5E-3',
    ]);
    expect(numbers('x = 1_000 + 0o7 + 0b1 + 3.14', 'python')).toEqual([
      '1_000',
      '0o7',
      '0b1',
      '3.14',
    ]);
    expect(numbers('{"a": 1.5e10, "b": -2}', 'json')).toEqual(['1.5e10', '2']);
    expect(numbers('margin: .5em 10px -2px;', 'css')).toEqual(['.5em', '10px', '2px']);
    // A dot after a name is a member access, and letters after a number are a word of their own;
    // a dotted run of numbers stays numbers, and a range's dots are not a number's.
    expect(numbers('pair.0 + v2.0 + 5px')).toEqual(['0', '0', '5']);
    expect(numbers('ip = 127.0.0.1; r = 0..10')).toEqual(['127.0', '.0', '.1', '0', '10']);
    // Inside a string or a comment, a number is the string's or the comment's.
    expect(numbers('f("1e5") // 10n')).toEqual([]);
  });

  it('reads code as the morph does: the same characters, and the same numbers', () => {
    const differ = [undefined, 'typescript', 'python', 'shell', 'json', 'sql'].flatMap((language) =>
      [...TRICKY, ...FUZZ].flatMap((line) => {
        const tokens = tokenize(line, language);
        if (tokens.map((t) => t.text).join('') !== line) return [{ language, line }];
        // The morph reads a line that opens or continues a block comment as a comment, and the
        // code panel draws a line that starts with a tag as markup: neither colors numbers alike.
        if (/^\s*(\/\*|\*|<\/?[A-Za-z])/.test(line)) return [];
        if (tokens.length >= DIRECTION_LIMITS.morph.tokensPerLine) return [];
        const morph = tokens.filter((t) => t.tone === 'number').map((t) => t.text);
        const card = numbers(line, language);
        return morph.join('\n') === card.join('\n') ? [] : [{ language, line, morph, card }];
      }),
    );
    expect(differ).toEqual([]);
  });
});
