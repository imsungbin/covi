import { escapeHtml } from './dom.ts';

/**
 * A deliberately small syntax highlighter: enough contrast to read code on screen, no grammars.
 * Each line is highlighted independently (diff excerpts rarely carry multi-line context).
 */
const KEYWORDS: Record<string, string[]> = {
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

function family(language?: string): 'c' | 'py' | 'sh' | 'css' | 'markup' | 'json' | 'sql' {
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

const span = (cls: string, text: string) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

export function highlightLine(line: string, language?: string): string {
  const fam = family(language);
  if (fam === 'markup' || (fam === 'c' && /^\s*<\/?[A-Za-z]/.test(line)))
    return highlightMarkup(line);
  if (fam === 'css') return highlightCss(line);
  const kw = new Set(
    fam === 'json'
      ? ['true', 'false', 'null']
      : fam === 'sql'
        ? []
        : (KEYWORDS[fam] ?? KEYWORDS.c!),
  );
  const comment =
    fam === 'py' || fam === 'sh' ? /#.*$/ : fam === 'sql' ? /--.*$/ : /\/\/.*$|\/\*.*?\*\//;
  const token = new RegExp(
    `(${comment.source})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_.]*\\b)|([A-Za-z_$][\\w$]*)|(\\s+)|([^\\sA-Za-z_$\\d"'\`]+)`,
    'g',
  );
  let out = '';
  for (const m of line.matchAll(token)) {
    const [text, cm, str, num, ident] = m;
    if (cm) out += span('comment', text);
    else if (str)
      out += span(
        fam === 'json' && /^\s*:/.test(line.slice((m.index ?? 0) + text.length))
          ? 'prop'
          : 'string',
        text,
      );
    else if (num) out += span('number', text);
    else if (ident) {
      const after = line.slice((m.index ?? 0) + text.length);
      if (kw.has(text) || (fam === 'sql' && /^[A-Z]{2,}$/.test(text))) out += span('keyword', text);
      else if (/^\s*\(/.test(after)) out += span('fn', text);
      else if (/^[A-Z]/.test(text)) out += span('type', text);
      else out += escapeHtml(text);
    } else out += escapeHtml(text);
  }
  return out;
}

function highlightMarkup(line: string): string {
  return escapeHtml(line)
    .replace(
      /(&lt;\/?)([A-Za-z][\w.-]*)/g,
      (_m, open: string, tag: string) => `${open}<span class="tk-keyword">${tag}</span>`,
    )
    .replace(
      /([\w:@.-]+)(=)(&quot;[^&]*?&quot;|\{[^}]*\})/g,
      (_m, name: string, eq: string, value: string) =>
        `<span class="tk-prop">${name}</span>${eq}<span class="tk-string">${value}</span>`,
    );
}

function highlightCss(line: string): string {
  if (/^\s*\/\*/.test(line)) return span('comment', line);
  const prop = /^(\s*)([\w-]+)(\s*:\s*)([^;]*)(;?.*)$/.exec(line);
  if (prop && !line.includes('{')) {
    const [, ws, name, colon, value, rest] = prop;
    const v = escapeHtml(value!).replace(
      /(#[0-9a-fA-F]{3,8}|\b\d+(\.\d+)?(px|rem|em|%|s|ms|vh|vw)?\b)/g,
      '<span class="tk-number">$1</span>',
    );
    return `${escapeHtml(ws!)}${span('prop', name!)}${escapeHtml(colon!)}${v}${escapeHtml(rest!)}`;
  }
  return line.includes('{')
    ? `${span('type', line.slice(0, line.indexOf('{')))}${escapeHtml(line.slice(line.indexOf('{')))}`
    : escapeHtml(line);
}
