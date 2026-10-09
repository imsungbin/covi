import { escapeHtml } from './dom.ts';
import { commentPattern, keywordsOf, syntaxFamily } from './syntax.ts';

/**
 * A deliberately small syntax highlighter: enough contrast to read code on screen, no grammars.
 * Each line is highlighted independently (diff excerpts rarely carry multi-line context).
 */
const span = (cls: string, text: string) => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

export function highlightLine(line: string, language?: string): string {
  const fam = syntaxFamily(language);
  if (fam === 'markup' || (fam === 'c' && /^\s*<\/?[A-Za-z]/.test(line)))
    return highlightMarkup(line);
  if (fam === 'css') return highlightCss(line);
  const kw = keywordsOf(fam);
  const comment = commentPattern(fam);
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
