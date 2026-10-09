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

/** A family's comments: to the end of the line, or a block comment that closes on it. */
export function commentPattern(family: SyntaxFamily): RegExp {
  if (family === 'py' || family === 'sh') return /#.*$/;
  if (family === 'sql') return /--.*$/;
  return /\/\/.*$|\/\*.*?\*\//;
}
