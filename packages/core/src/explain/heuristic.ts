import type {
  DataChange,
  DataOperation,
  IntentKind,
  ReviewContext,
  SymbolChange,
} from '../model/context.ts';
import type { Depth, Explanation } from '../model/explanation.ts';
import {
  code,
  ensurePeriod,
  isImperativeVerb,
  joinList,
  lowerFirst,
  plural,
  sentenceCase,
  toThirdPersonClause,
} from '../util/text.ts';

const KIND_PHRASE: Record<IntentKind, string> = {
  feature: 'a new feature',
  'bug-fix': 'a bug fix',
  refactor: 'a refactor',
  performance: 'a performance improvement',
  visual: 'a visual update',
  docs: 'a documentation update',
  test: 'a test update',
  dependency: 'a dependency update',
  config: 'a configuration change',
  build: 'a build/tooling change',
  ci: 'a CI change',
  chore: 'maintenance work',
  security: 'a security fix',
  revert: 'a revert',
  mixed: 'a mix of changes',
  unknown: 'a change',
};

const DATA_VERB: Record<DataOperation, string> = {
  'create-table': 'creates table',
  'drop-table': 'drops table',
  'rename-table': 'renames table',
  'add-column': 'adds column',
  'drop-column': 'drops column',
  'rename-column': 'renames column',
  'alter-column': 'alters column',
  'add-index': 'adds an index on',
  'drop-index': 'drops an index',
  data: 'modifies data in',
  other: 'changes',
};

export function dataPhrase(d: DataChange): string {
  const verb = DATA_VERB[d.operation];
  if (d.column && d.table) return `${verb} ${code(d.column)} on ${code(d.table)}`;
  if (d.column) return `${verb} ${code(d.column)}`;
  if (d.table) return `${verb} ${code(d.table)}`;
  return verb;
}

export function depthFor(context: ReviewContext): Depth {
  const cls = context.size.class;
  if (cls === 'trivial' || cls === 'small') return 'brief';
  if (cls === 'medium') return 'standard';
  return 'deep';
}

/** One sentence that states what the change does, from its (possibly imperative) summary. */
export function intentSentence(context: ReviewContext): string {
  const { intent } = context;
  let summary = intent.summary.trim().replace(/[.!]$/, '');
  if (intent.scope && !summary.toLowerCase().includes(intent.scope.toLowerCase()))
    summary += ` in ${intent.scope}`;
  const first = summary.split(/\s+/)[0] ?? '';
  if (isImperativeVerb(first))
    return ensurePeriod(`This change ${toThirdPersonClause(lowerFirst(summary))}`);
  return ensurePeriod(`This change is ${KIND_PHRASE[intent.kind]}: ${lowerFirst(summary)}`);
}

/** Why the change exists, attributed to its source so readers can weigh it. */
export function intentStatement(context: ReviewContext): string {
  const { intent } = context;
  const kind = KIND_PHRASE[intent.kind];
  if (intent.basis === 'title')
    return `The title describes it as ${kind}: “${context.change.metadata.title}”.`;
  if (intent.basis === 'commit') {
    const n = context.change.commits.length;
    return `${n === 1 ? 'The commit message describes' : `The ${n} commit messages describe`} it as ${kind}${intent.summary ? `: “${intent.summary}”` : ''}.`;
  }
  return intent.kind === 'unknown'
    ? 'No description or commit message states the purpose, and the files do not suggest one.'
    : `Inferred from the files alone: it looks like ${kind}.`;
}

function symbolPhrase(
  symbols: readonly SymbolChange[],
  change: SymbolChange['change'],
  verb: string,
): string | undefined {
  const all = symbols.filter(
    (s) => s.change === change && s.kind !== 'selector' && s.kind !== 'route' && s.kind !== 'test',
  );
  // Name behavior (functions, components, types) before configuration-like constants.
  const callables = all.filter((s) => s.kind !== 'constant' && s.kind !== 'variable');
  const list = callables.length ? callables : all;
  if (list.length === 0) return undefined;
  const names = list
    .slice(0, 2)
    .map(
      (s) =>
        `${code(s.name)}${['component', 'hook', 'class', 'interface', 'type'].includes(s.kind) ? ` (${s.kind})` : ''}`,
    );
  const more = list.length > 2 ? ` and ${plural(list.length - 2, 'other')}` : '';
  return `${verb} ${joinList(names)}${more}`;
}

function describeArea(context: ReviewContext, files: readonly string[]): string {
  const inArea = (path: string) => files.includes(path);
  const symbols = context.symbols.filter((s) => inArea(s.path));
  const phrases: string[] = [];
  for (const [change, verb] of [
    ['added', 'adds'],
    ['modified', 'changes'],
    ['removed', 'removes'],
  ] as const) {
    const p = symbolPhrase(symbols, change, verb);
    if (p) phrases.push(p);
  }
  for (const r of context.routes.filter((x) => inArea(x.file))) {
    phrases.push(
      `${r.change === 'added' ? 'adds' : r.change === 'removed' ? 'removes' : 'changes'} route ${code(r.method ? `${r.method} ${r.path}` : r.path)}`,
    );
  }
  for (const d of context.data.filter((x) => inArea(x.file)).slice(0, 3))
    phrases.push(dataPhrase(d));
  const deps = context.dependencies.filter((d) => inArea(d.manifest));
  if (deps.length) {
    phrases.push(
      joinList(
        deps
          .slice(0, 4)
          .map((d) =>
            d.change === 'added'
              ? `adds ${code(d.name)}`
              : d.change === 'removed'
                ? `removes ${code(d.name)}`
                : `${d.change === 'downgraded' ? 'downgrades' : 'upgrades'} ${code(d.name)} ${d.from} → ${d.to}${d.major ? ' (major)' : ''}`,
          ),
      ),
    );
  }
  for (const env of context.envVars.filter((e) => inArea(e.path) && e.change === 'added')) {
    phrases.push(`reads a new environment variable ${code(env.name)}`);
  }
  const selectors = symbols.filter((s) => s.kind === 'selector');
  if (selectors.length) {
    phrases.push(
      `updates styles for ${joinList(selectors.slice(0, 3).map((s) => code(s.name)))}${selectors.length > 3 ? ` and ${selectors.length - 3} more` : ''}`,
    );
  }
  if (phrases.length === 0) {
    const names = files.slice(0, 3).map((f) => code(f.split('/').pop() ?? f));
    phrases.push(
      `edits ${joinList(names)}${files.length > 3 ? ` and ${files.length - 3} more files` : ''}`,
    );
  }
  return sentenceCase(ensurePeriod(joinList(phrases.slice(0, 4), 'and')));
}

/** A structural explanation built only from deterministic analysis (no model). */
export function explainHeuristically(context: ReviewContext): Explanation {
  const depth = depthFor(context);
  const { intent, demonstration, size } = context;
  const userVisible = demonstration.kinds.some((k) => k !== 'architecture');
  const areaNames = context.areas.map((a) => a.name);

  const sentences = [intentSentence(context)];
  const stats = context.change.stats;
  const onlyFile =
    size.files === 1 ? context.change.files.find((f) => !f.ignored)?.path : undefined;
  const where = onlyFile
    ? code(onlyFile)
    : `${plural(size.files, 'file')}${areaNames.length > 1 ? ` across ${joinList(areaNames.slice(0, 4).map((a) => code(a)))}${areaNames.length > 4 ? ' and more' : ''}` : areaNames[0] ? ` in ${code(areaNames[0])}` : ''}`;
  sentences.push(`It touches ${where} (+${stats.additions} −${stats.deletions}).`);

  if (userVisible) {
    const kinds = demonstration.kinds.filter((k) => k !== 'architecture');
    sentences.push(`The change is user-visible (${joinList(kinds)}).`);
  } else if (!context.change.files.every((f) => f.category === 'docs' || f.category === 'test')) {
    sentences.push('No user-facing surface (UI, API, or CLI) is touched.');
  }
  if (intent.confidence === 'low')
    sentences.push('The intent is inferred from limited evidence, so treat it as a hypothesis.');

  const details: string[] = [];
  for (const signal of context.signals) {
    if (
      [
        'breaking-commit',
        'destructive-migration',
        'export-removed',
        'route-removed',
        'dependency-added',
        'major-upgrade',
        'env-var-added',
        'mode-changed',
      ].includes(signal.id)
    ) {
      details.push(signal.message);
    }
  }

  const reviewerNotes = [...context.notes];
  const first = context.readingOrder[0];
  if (first && context.readingOrder.length > 1)
    reviewerNotes.unshift(`Start with ${code(first.path)}: ${lowerFirst(first.reason)}`);
  if (context.tests.untestedSourceFiles.length && context.tests.changedTestFiles.length === 0) {
    reviewerNotes.push(
      `No tests changed alongside ${plural(context.tests.untestedSourceFiles.length, 'modified source file')}.`,
    );
  }
  if (context.change.includesUncommitted)
    reviewerNotes.push('Includes uncommitted work in the working tree.');

  const architecture: string[] = [];
  if (depth === 'deep') {
    architecture.push(
      `Spans ${plural(context.areas.length, 'area')}: ${joinList(context.areas.map((a) => `${code(a.name)} (${a.surfaces.join(', ') || 'internal'})`))}.`,
    );
    if (context.dependencies.length)
      architecture.push(
        `Dependency graph changes: ${plural(context.dependencies.length, 'package')}.`,
      );
    if (context.data.length)
      architecture.push(
        `Data model changes: ${joinList(context.data.slice(0, 4).map((d) => d.statement))}.`,
      );
    if (context.routes.length)
      architecture.push(
        `API surface changes: ${joinList(context.routes.slice(0, 5).map((r) => code(r.method ? `${r.method} ${r.path}` : r.path)))}.`,
      );
  }

  const headline =
    intent.summary.length > 3 ? intent.summary : `Changes in ${areaNames[0] ?? 'the repository'}`;

  return {
    schemaVersion: 1,
    depth,
    headline,
    summary: sentences.join(' '),
    intent: {
      statement: intentStatement(context),
      confidence: intent.confidence,
      evidence: intent.evidence,
    },
    behavior: {
      userVisible,
      notes: userVisible
        ? demonstration.runnable.available
          ? 'Covi can run this project to show the behavior; see the demo artifacts when present.'
          : 'Behavior was not observed; configure app.start or app.static to let Covi capture it.'
        : undefined,
    },
    changes: context.areas.map((a) => ({
      area: a.name,
      description: describeArea(context, a.files),
      files: a.files,
    })),
    architecture,
    details: depth === 'brief' ? details.slice(0, 2) : details,
    reviewerNotes: depth === 'brief' ? reviewerNotes.slice(0, 3) : reviewerNotes,
    readingOrder: depth === 'brief' ? context.readingOrder.slice(0, 3) : context.readingOrder,
    ambiguities: context.ambiguities,
    generatedBy: { provider: 'heuristic' },
  };
}
