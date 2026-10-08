export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ellipsis.length)).trimEnd() + ellipsis;
}

export function sentenceCase(text: string): string {
  const t = text.trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : t;
}

export function lowerFirst(text: string): string {
  const t = text.trim();
  if (!t) return t;
  // Keep acronyms and identifiers ("API", "useState") intact.
  if (/^[A-Z]{2,}/.test(t) || /^[a-z]+[A-Z]/.test(t)) return t;
  return t[0]!.toLowerCase() + t.slice(1);
}

export function ensurePeriod(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?:]$/.test(t) ? t : `${t}.`;
}

export function joinList(items: readonly string[], conjunction = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items.at(-1)}`;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function code(identifier: string): string {
  return `\`${identifier.replace(/`/g, "'")}\``;
}

/** Common imperative verbs found in commit subjects, mapped to third person. */
const VERBS = [
  'accept',
  'block',
  'calculate',
  'cap',
  'check',
  'clamp',
  'clear',
  'collapse',
  'compute',
  'count',
  'decode',
  'delete',
  'deprecate',
  'detect',
  'downgrade',
  'encode',
  'escape',
  'expand',
  'extend',
  'fetch',
  'filter',
  'format',
  'group',
  'highlight',
  'load',
  'lock',
  'log',
  'mark',
  'merge',
  'parse',
  'pin',
  'print',
  'read',
  'require',
  'round',
  'run',
  'sanitize',
  'save',
  'send',
  'store',
  'strip',
  'stream',
  'truncate',
  'unlock',
  'verify',
  'write',
  'add',
  'allow',
  'apply',
  'avoid',
  'bump',
  'change',
  'clean',
  'clarify',
  'convert',
  'correct',
  'create',
  'disable',
  'drop',
  'enable',
  'ensure',
  'expose',
  'extract',
  'fix',
  'guard',
  'handle',
  'hide',
  'implement',
  'improve',
  'include',
  'introduce',
  'keep',
  'limit',
  'make',
  'migrate',
  'move',
  'normalize',
  'optimize',
  'prevent',
  'reduce',
  'refactor',
  'reject',
  'remove',
  'rename',
  'reorder',
  'replace',
  'restore',
  'retry',
  'return',
  'revert',
  'rewrite',
  'show',
  'simplify',
  'skip',
  'sort',
  'split',
  'stop',
  'support',
  'switch',
  'tidy',
  'track',
  'treat',
  'tweak',
  'unify',
  'update',
  'upgrade',
  'use',
  'validate',
  'wrap',
  'debounce',
  'cache',
  'centralize',
  'document',
  'display',
  'redesign',
  'restyle',
  'paginate',
  'polish',
  'persist',
  'preserve',
  'render',
  'reset',
  'resolve',
  'surface',
  'tighten',
  'trim',
  'warn',
  'deduplicate',
  'align',
];
const VERB_SET = new Set(VERBS);

export function isImperativeVerb(word: string): boolean {
  return VERB_SET.has(word.toLowerCase());
}

export function thirdPerson(verb: string): string {
  const v = verb.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(v)) return `${verb}es`;
  if (/[^aeiou]y$/.test(v)) return `${verb.slice(0, -1)}ies`;
  return `${verb}s`;
}

/** "fix the cart total" → "fixes the cart total"; leaves non-imperative text untouched. */
export function toThirdPersonClause(clause: string): string {
  const match = /^(\s*)([A-Za-z]+)(\b.*)$/s.exec(clause);
  if (!match) return clause;
  const [, lead, word, rest] = match;
  if (!isImperativeVerb(word!)) return clause;
  // Coordinated imperatives get the same treatment: "show X and block Y" → "shows X and blocks Y".
  const tail = rest!.replace(
    /(,\s+|\s+and\s+|\s+or\s+)([A-Za-z]+)\b/g,
    (m, sep: string, verb: string) =>
      isImperativeVerb(verb) && verb === verb.toLowerCase() ? `${sep}${thirdPerson(verb)}` : m,
  );
  return `${lead}${thirdPerson(word!.toLowerCase())}${tail}`;
}

/** "fix the cart total" → "fixing the cart total". */
export function toGerundClause(clause: string): string {
  const match = /^(\s*)([A-Za-z]+)(\b.*)$/s.exec(clause);
  if (!match) return clause;
  const [, lead, word, rest] = match;
  if (!isImperativeVerb(word!)) return clause;
  const v = word!.toLowerCase();
  let gerund: string;
  if (v.endsWith('ie')) gerund = `${v.slice(0, -2)}ying`;
  else if (v.endsWith('e') && !v.endsWith('ee')) gerund = `${v.slice(0, -1)}ing`;
  else if (/^(stop|drop|skip|wrap|trim|split)$/.test(v)) gerund = `${v}${v.at(-1)}ing`;
  else gerund = `${v}ing`;
  return `${lead}${gerund}${rest}`;
}

/** Turns identifiers and paths into words that read and speak naturally. */
export function humanizeIdentifier(identifier: string): string {
  return identifier
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-./]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

/**
 * Escapes text for safe inclusion in Markdown rendered by GitHub/GitLab (no HTML, no mentions).
 * Text stays on one line: CommonMark ends a line at a lone CR too, and a `~~~` that starts a line
 * opens a code block that runs to the end of the comment.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_{}[\]<>|#~]/g, (c) => `\\${c}`)
    .replace(/@(?=[A-Za-z0-9-])/g, '@​')
    .replace(/[\r\n]+/g, ' ');
}

/** Like escapeMarkdown, but keeps inline `code` spans (safe: GitHub/GitLab render them literally). */
export function escapeMarkdownKeepCode(text: string): string {
  return text
    .split(/(`[^`\r\n]{1,200}`)/)
    .map((part, i) => (i % 2 === 1 ? part : escapeMarkdown(part)))
    .join('');
}

/** Wraps code in a fence that cannot be closed by the content itself. */
export function fence(content: string, lang = ''): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${content.replace(/\n$/, '')}\n${ticks}`;
}
