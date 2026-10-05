import type { ChangedFile, CodeChange, Surface } from '../model/change.ts';
import type {
  Confidence,
  Intent,
  IntentKind,
  RouteChange,
  SymbolChange,
} from '../model/context.ts';
import { sentenceCase } from '../util/text.ts';

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

const TYPE_TO_KIND: Record<string, IntentKind> = {
  feat: 'feature',
  feature: 'feature',
  fix: 'bug-fix',
  bugfix: 'bug-fix',
  hotfix: 'bug-fix',
  refactor: 'refactor',
  perf: 'performance',
  docs: 'docs',
  doc: 'docs',
  test: 'test',
  tests: 'test',
  build: 'build',
  ci: 'ci',
  chore: 'chore',
  style: 'chore',
  revert: 'revert',
  deps: 'dependency',
  security: 'security',
  sec: 'security',
  ui: 'visual',
  design: 'visual',
};

const KEYWORDS: Array<[IntentKind, RegExp]> = [
  [
    'bug-fix',
    /\b(fix(e[sd])?|bugs?|crash(es|ed)?|broken|regression|incorrect(ly)?|wrong|prevents?|resolves?|workaround|off-by-one)\b/i,
  ],
  ['feature', /\b(adds?|added|introduces?|support(s|ed)?|implements?|new|enables?|allows?)\b/i],
  [
    'refactor',
    /\b(refactor(s|ed|ing)?|clean[ -]?up|restructure|extract(s|ed)?|renames?|reorgani[sz]e|simplif(y|ies|ied)|consolidate|dedupe|move[sd]?)\b/i,
  ],
  [
    'performance',
    /\b(perf(ormance)?|optimi[sz](e|es|ed|ation)|faster|speed[ -]?up|latency|memoi[sz]e|throughput)\b/i,
  ],
  [
    'visual',
    /\b(styles?|styling|css|layout|design|colou?rs?|spacing|padding|margins?|alignment|theme|font|typography|responsive|dark mode|visual|polish)\b/i,
  ],
  ['docs', /\b(docs?|documentation|readme|typos?)\b/i],
  ['test', /\b(tests?|coverage|specs?)\b/i],
  ['dependency', /\b(bumps?|upgrades?|dependenc(y|ies)|deps)\b/i],
  [
    'security',
    /\b(security|vulnerab(le|ility)|cve-\d{4}-\d+|xss|csrf|injection|sanitiz(e|ation)|escap(e|ing))\b/i,
  ],
];

const BRANCH_PREFIX: Array<[RegExp, IntentKind]> = [
  [/^(feat|feature|features)\//i, 'feature'],
  [/^(fix|bugfix|hotfix|bug)\//i, 'bug-fix'],
  [/^refactor\//i, 'refactor'],
  [/^perf\//i, 'performance'],
  [/^docs?\//i, 'docs'],
  [/^tests?\//i, 'test'],
  [/^ci\//i, 'ci'],
  [/^chore\//i, 'chore'],
  [/^(deps|dependabot|renovate)\//i, 'dependency'],
  [/^(ui|design|style)\//i, 'visual'],
  [/^security\//i, 'security'],
];

/**
 * `style:` means formatting in Conventional Commits, but teams also use it for visual changes:
 * when only styles and markup changed, read it as a visual change.
 */
function kindForType(type: string, files: readonly ChangedFile[]): IntentKind | undefined {
  if (type === 'style') {
    const visual = files
      .filter((f) => !f.ignored)
      .every((f) => ['style', 'markup', 'asset', 'docs', 'test'].includes(f.category));
    return visual ? 'visual' : 'chore';
  }
  return TYPE_TO_KIND[type];
}

export interface IntentInput {
  change: Pick<CodeChange, 'commits' | 'metadata' | 'includesUncommitted'>;
  files: readonly ChangedFile[];
  symbols: readonly SymbolChange[];
  routes: readonly RouteChange[];
  hasDataChanges: boolean;
}

interface Score {
  points: number;
  sources: Set<string>;
  evidence: string[];
}

/** Strips conventional-commit prefixes and trailing issue references. */
export function cleanSubject(subject: string): {
  text: string;
  type?: string;
  scope?: string;
  breaking: boolean;
} {
  const trimmed = subject
    .trim()
    .replace(/\s*\((?:#|!)\d+\)\s*$/, '')
    .replace(/\.$/, '');
  const m = CONVENTIONAL.exec(trimmed);
  if (!m) return { text: trimmed, breaking: false };
  return {
    text: m[4]!.trim(),
    type: m[1]!.toLowerCase(),
    scope: m[2]?.trim() || undefined,
    breaking: Boolean(m[3]),
  };
}

export function inferIntent(input: IntentInput): Intent {
  const scores = new Map<IntentKind, Score>();
  const add = (kind: IntentKind, points: number, source: string, evidence?: string) => {
    const s = scores.get(kind) ?? { points: 0, sources: new Set<string>(), evidence: [] };
    s.points += points;
    s.sources.add(source);
    if (evidence && !s.evidence.includes(evidence) && s.evidence.length < 4)
      s.evidence.push(evidence);
    scores.set(kind, s);
  };

  const { commits, metadata } = input.change;
  const title = metadata.title?.trim();

  // 1. Conventional commit types and the change title.
  if (title) {
    const t = cleanSubject(title);
    const kind = t.type ? kindForType(t.type, input.files) : undefined;
    if (kind) add(kind, 4, 'title', `title "${title}" uses the ${t.type} prefix`);
    for (const [k, re] of KEYWORDS)
      if (re.test(t.text)) add(k, 1.5, 'title', `title mentions "${re.exec(t.text)?.[0]}"`);
  }
  const typed = commits
    .map((c) => cleanSubject(c.subject))
    .filter((c) => c.type && TYPE_TO_KIND[c.type]);
  for (const c of typed) {
    const kind = kindForType(c.type!, input.files)!;
    add(
      kind,
      3 / Math.max(1, typed.length) + 1,
      'commits',
      `commit "${c.type}${c.scope ? `(${c.scope})` : ''}: ${c.text}"`,
    );
  }
  for (const commit of commits.slice(0, 20)) {
    const text = `${cleanSubject(commit.subject).text} ${commit.body}`;
    for (const [k, re] of KEYWORDS) if (re.test(text)) add(k, 0.6, 'commits');
    if (/^revert\b/i.test(commit.subject))
      add('revert', 4, 'commits', `commit "${commit.subject}"`);
  }
  if (metadata.description) {
    for (const [k, re] of KEYWORDS) if (re.test(metadata.description)) add(k, 0.5, 'description');
  }

  // 2. Branch naming conventions.
  const branch = metadata.sourceBranch;
  if (branch) {
    for (const [re, kind] of BRANCH_PREFIX) {
      if (re.test(branch)) add(kind, 2, 'branch', `branch name "${branch}"`);
    }
  }

  // 3. What the files themselves say.
  const files = input.files.filter((f) => !f.ignored);
  const cats = new Set(files.map((f) => f.category));
  const only = (...allowed: string[]) =>
    files.length > 0 && [...cats].every((c) => allowed.includes(c));
  if (only('docs')) add('docs', 5, 'files', 'only documentation files changed');
  else if (only('test')) add('test', 5, 'files', 'only test files changed');
  else if (only('manifest', 'lockfile'))
    add('dependency', 5, 'files', 'only dependency manifests and lockfiles changed');
  else if (only('ci')) add('ci', 5, 'files', 'only CI configuration changed');
  else if (only('style', 'markup', 'asset'))
    add('visual', 4, 'files', 'only styles, markup, or assets changed');
  else if (only('build', 'infra', 'config'))
    add('build', 3, 'files', 'only build or configuration files changed');
  else if (only('style', 'markup', 'asset', 'test', 'docs') && cats.has('style'))
    add('visual', 2, 'files', 'changes are concentrated in styles and markup');

  const renames = files.filter((f) => f.status === 'renamed' && (f.similarity ?? 0) >= 80);
  if (renames.length >= 2 && renames.length >= files.length * 0.5)
    add('refactor', 2, 'files', `${renames.length} files were moved or renamed`);
  const added = input.symbols.filter(
    (s) => s.change === 'added' && s.exported && s.kind !== 'selector',
  );
  if (added.length >= 2 || input.routes.some((r) => r.change === 'added'))
    add('feature', 1, 'files');

  const ranked = [...scores.entries()].sort((a, b) => b[1].points - a[1].points);
  const [top, second] = ranked;

  const hasMessages = Boolean(title) || commits.length > 0;
  let kind: IntentKind = top?.[0] ?? 'unknown';
  let confidence: Confidence = 'low';
  const evidence = top ? [...top[1].evidence] : [];
  let ambiguity: string | undefined;

  if (top) {
    const [, s] = top;
    const margin = s.points - (second?.[1].points ?? 0);
    if (s.points >= 5 && margin >= 2 && s.sources.size >= 2) confidence = 'high';
    else if (s.points >= 3 && margin >= 1) confidence = 'medium';
    if (
      second &&
      second[1].points >= 3 &&
      second[1].points >= s.points * 0.75 &&
      second[0] !== kind
    ) {
      if (isCompatible(kind, second[0])) {
        // e.g. a feature that also adds tests: keep the stronger reading.
      } else {
        kind = 'mixed';
        confidence = s.points >= 5 ? 'medium' : 'low';
        ambiguity = `Signals point to both ${label(top[0])} and ${label(second[0])}; the change may combine separate concerns.`;
      }
    }
  }
  if (!hasMessages) {
    ambiguity ??= input.change.includesUncommitted
      ? 'Uncommitted work has no commit message, so intent is inferred from the files alone.'
      : 'No title, description, or commit message describes the change; intent is inferred from the files.';
    if (confidence === 'high') confidence = 'medium';
  }

  const mismatch = detectMismatch(kind, files, input);
  if (mismatch) ambiguity = mismatch;

  const { summary, scope, basis } = summarize(input, kind);
  const secondary = ranked
    .slice(1)
    .filter(([k, s]) => k !== kind && s.points >= 2)
    .map(([k]) => k)
    .slice(0, 3);

  return { kind, summary, confidence, evidence, ambiguity, secondary, scope, basis };
}

function isCompatible(a: IntentKind, b: IntentKind): boolean {
  const pairs = [
    ['feature', 'test'],
    ['bug-fix', 'test'],
    ['feature', 'docs'],
    ['bug-fix', 'docs'],
    ['visual', 'feature'],
    ['refactor', 'test'],
    ['dependency', 'build'],
    ['feature', 'refactor'],
    ['performance', 'refactor'],
    ['security', 'bug-fix'],
    ['visual', 'bug-fix'],
  ];
  return pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function label(kind: IntentKind): string {
  return kind.replace('-', ' ');
}

/** "Mismatch between implementation and apparent intent": refactors that change behavior, etc. */
function detectMismatch(
  kind: IntentKind,
  files: readonly ChangedFile[],
  input: IntentInput,
): string | undefined {
  if (!['refactor', 'chore', 'docs', 'test'].includes(kind)) return undefined;
  const behavioral: string[] = [];
  const routeChanges = input.routes.filter((r) => r.change !== 'modified');
  if (routeChanges.length) {
    behavioral.push(
      `API routes (${routeChanges
        .slice(0, 2)
        .map((r) => `${r.change} ${r.path}`)
        .join(', ')})`,
    );
  }
  if (input.hasDataChanges) behavioral.push('a database migration');
  const ui = files.filter((f) => f.surfaces.includes('ui' as Surface) && f.category !== 'test');
  if (kind === 'docs' && ui.length) behavioral.push('user interface files');
  if (kind === 'test' && files.some((f) => f.category === 'source'))
    behavioral.push('application source files');
  if (behavioral.length === 0) return undefined;
  return `Described as ${label(kind)}, but it also changes ${behavioral.join(' and ')}; confirm the behavior change is intended.`;
}

function summarize(
  input: IntentInput,
  kind: IntentKind,
): { summary: string; scope?: string; basis: Intent['basis'] } {
  const { metadata, commits } = input.change;
  if (metadata.title) {
    const t = cleanSubject(metadata.title);
    return { summary: sentenceCase(t.text), scope: t.scope, basis: 'title' };
  }
  const preferred = ['feat', 'fix', 'perf', 'refactor'];
  const significant =
    commits.find((c) => preferred.includes(cleanSubject(c.subject).type ?? '')) ??
    commits[commits.length - 1];
  if (significant) {
    const t = cleanSubject(significant.subject);
    return { summary: sentenceCase(t.text), scope: t.scope, basis: 'commit' };
  }
  const areas = [
    ...new Set(input.files.filter((f) => !f.ignored).map((f) => topDir(f.path))),
  ].slice(0, 3);
  const what =
    kind === 'unknown' || kind === 'mixed' ? 'Changes' : `${sentenceCase(label(kind))} changes`;
  return { summary: areas.length ? `${what} in ${areas.join(', ')}` : what, basis: 'files' };
}

function topDir(path: string): string {
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : path;
}
