/*
 * What Covi's code highlighting knows about languages, without the DOM: the runtime highlights
 * code lines with it, and Node tokenizes the lines a morph moves with it, so both color code alike.
 */

/** Languages grouped by how their code is highlighted. */
export type SyntaxFamily = 'c' | 'py' | 'sh' | 'css' | 'markup' | 'json' | 'sql';

const KEYWORDS: Record<'c' | 'py' | 'sh', readonly string[]> = {
  c: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'class',
    'extends',
    'import',
    'export',
    'from',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'interface',
    'type',
    'enum',
    'implements',
    'public',
    'private',
    'protected',
    'static',
    'readonly',
    'func',
    'package',
    'struct',
    'go',
    'defer',
    'fn',
    'pub',
    'impl',
    'mut',
    'match',
    'use',
    'mod',
    'in',
    'of',
    'as',
    'void',
    'null',
    'undefined',
    'true',
    'false',
    'nil',
    'this',
    'self',
    'super',
    'yield',
  ],
  py: [
    'def',
    'class',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'while',
    'in',
    'not',
    'and',
    'or',
    'import',
    'from',
    'as',
    'with',
    'try',
    'except',
    'finally',
    'raise',
    'lambda',
    'yield',
    'pass',
    'None',
    'True',
    'False',
    'self',
    'async',
    'await',
    'end',
    'do',
    'module',
    'require',
    'nil',
  ],
  sh: [
    'if',
    'then',
    'fi',
    'for',
    'do',
    'done',
    'case',
    'esac',
    'echo',
    'export',
    'function',
    'return',
    'in',
  ],
};

export function syntaxFamily(language?: string): SyntaxFamily {
  switch (language) {
    case 'python':
    case 'ruby':
    case 'yaml':
    case 'toml':
      return 'py';
    case 'shell':
      return 'sh';
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'css';
    case 'html':
    case 'vue':
    case 'svelte':
    case 'astro':
      return 'markup';
    case 'json':
      return 'json';
    case 'sql':
      return 'sql';
    default:
      return 'c';
  }
}

/** Words a family colors as keywords. */
export function keywordsOf(family: SyntaxFamily): ReadonlySet<string> {
  if (family === 'json') return new Set(['true', 'false', 'null']);
  if (family === 'sql') return new Set();
  return new Set(family === 'py' || family === 'sh' ? KEYWORDS[family] : KEYWORDS.c);
}

/**
 * A family's comments: to the end of the line, or a block comment that closes on it. Two slashes
 * after a colon are an address (`https://…`), not a comment, as in Markdown and plain text.
 */
export function commentPattern(family: SyntaxFamily): RegExp {
  if (family === 'py' || family === 'sh') return /#.*$/;
  if (family === 'sql') return /--.*$/;
  return /(?<!:)\/\/.*$|\/\*.*?\*\//;
}

/** A string closed on its line, in double, single, or back quotes, escapes included. */
const STRING = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/u;

/**
 * A number, whole: decimal (with `_` separators, a fraction, and an exponent), hex, octal, or
 * binary, and a BigInt's `n`. A leading-dot decimal (`.5`) starts where a value can, or ends a
 * dotted run of numbers (`1.2.3`), but not after a word, a dot, or a closing bracket, where the dot
 * is a member access (`pair.0`, `v2.0`), nor after a backslash, which escapes it.
 */
export const NUMBER =
  /(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|(?<![\p{L}\p{M}_$][\p{L}\p{M}\p{N}_$]*|[.)\]\\])\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/u;

/** A word: a letter of any script, `_`, or `$`, then letters, digits, `_`, and `$`. */
export const WORD = /[\p{L}\p{M}_$][\p{L}\p{M}\p{N}_$]*/u;

/**
 * A family's lexer, the one the code panel and the morph read code with: a comment, a string, a
 * number, a word, a whitespace run, or any one other character, so every character of a line lands
 * in exactly one token, in order. Its groups are those six, in that order.
 */
export function lexer(family: SyntaxFamily): RegExp {
  return new RegExp(
    `(${commentPattern(family).source})|(${STRING.source})|(${NUMBER.source})|(${WORD.source})|(\\s+)|([\\s\\S])`,
    'gu',
  );
}
