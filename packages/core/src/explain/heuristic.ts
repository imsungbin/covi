import { endSentence, joinSentences, listOf, t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
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
  lowerFirst,
  sentenceCase,
  toThirdPersonClause,
} from '../util/text.ts';

function kindPhrase(kind: IntentKind, language: Language): string {
  return t(language, `explain.kindPhrase.${kind}`);
}

export function dataPhrase(d: DataChange, language: Language = 'en'): string {
  const verb = t(language, `explain.dataVerb.${d.operation satisfies DataOperation}`);
  if (d.column && d.table)
    return t(language, 'explain.data.columnOnTable', {
      verb,
      column: code(d.column),
      table: code(d.table),
    });
  if (d.column) return t(language, 'explain.data.single', { verb, name: code(d.column) });
  if (d.table) return t(language, 'explain.data.single', { verb, name: code(d.table) });
  return verb;
}

export function depthFor(context: ReviewContext): Depth {
  const cls = context.size.class;
  if (cls === 'trivial' || cls === 'small') return 'brief';
  if (cls === 'medium') return 'standard';
  return 'deep';
}

/** One sentence that states what the change does, from its (possibly imperative) summary. */
export function intentSentence(context: ReviewContext, language: Language = 'en'): string {
  const { intent } = context;
  const say = (key: string, params?: Record<string, string>) =>
    t(language, `explain.sentence.${key}`, params);
  let summary = intent.summary.trim().replace(/[.!。！]$/, '');
  if (intent.scope && !summary.toLowerCase().includes(intent.scope.toLowerCase()))
    summary = say('scopeIn', { summary, scope: intent.scope });
  const kind = kindPhrase(intent.kind, language);
  if (language !== 'en') return endSentence(language, say('kind', { kind, summary }));
  const first = summary.split(/\s+/)[0] ?? '';
  if (isImperativeVerb(first))
    return ensurePeriod(say('imperative', { clause: toThirdPersonClause(lowerFirst(summary)) }));
  // A summary with its own colon ("Initial commit: Covi, …") reads better quoted as written.
  if (summary.includes(': ')) return say('titled', { kind, summary });
  return ensurePeriod(say('kind', { kind, summary: lowerFirst(summary) }));
}

/** Why the change exists, attributed to its source so readers can weigh it. */
export function intentStatement(context: ReviewContext, language: Language = 'en'): string {
  const { intent } = context;
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `explain.statement.${key}`, params);
  const kind = kindPhrase(intent.kind, language);
  // Credit the title or commits with the kind only when the evidence came from them.
  const from = (source: 'title' | 'commits') =>
    intent.evidenceFrom
      ? intent.evidenceFrom.includes(source)
      : intent.evidence.some((e) => e.startsWith(source === 'title' ? 'title' : 'commit'));
  const fromFiles = intent.kind === 'unknown' ? '' : say('fromFiles', { kind });
  if (intent.basis === 'title') {
    const title = context.change.metadata.title ?? '';
    return from('title')
      ? say('titleKind', { kind, title })
      : say('titleSays', { title, fromFiles });
  }
  if (intent.basis === 'commit') {
    const n = context.change.commits.length;
    if (!from('commits')) return say('commitSays', { summary: intent.summary, fromFiles });
    return say('commitsDescribe', {
      count: n,
      kind,
      summary: intent.summary ? say('commitSummary', { summary: intent.summary }) : '',
    });
  }
  return intent.kind === 'unknown' ? say('noPurpose') : say('inferred', { kind });
}

function symbolPhrase(
  symbols: readonly SymbolChange[],
  change: SymbolChange['change'],
  verb: 'adds' | 'changes' | 'removes',
  language: Language,
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
        `${code(s.name)}${['component', 'hook', 'class', 'interface', 'type'].includes(s.kind) ? ` (${t(language, `explain.area.symbolKind.${s.kind}`)})` : ''}`,
    );
  const more =
    list.length > 2 ? t(language, 'explain.area.others', { count: list.length - 2 }) : '';
  return t(language, `explain.area.${verb}`, { names: listOf(language, names), more });
}

function describeArea(
  context: ReviewContext,
  files: readonly string[],
  language: Language,
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `explain.area.${key}`, params);
  const list = (items: string[]) => listOf(language, items);
  const inArea = (path: string) => files.includes(path);
  const symbols = context.symbols.filter((s) => inArea(s.path));
  const phrases: string[] = [];
  for (const [change, verb] of [
    ['added', 'adds'],
    ['modified', 'changes'],
    ['removed', 'removes'],
  ] as const) {
    const p = symbolPhrase(symbols, change, verb, language);
    if (p) phrases.push(p);
  }
  for (const r of context.routes.filter((x) => inArea(x.file))) {
    phrases.push(
      say(
        r.change === 'added'
          ? 'routeAdded'
          : r.change === 'removed'
            ? 'routeRemoved'
            : 'routeChanged',
        { route: code(r.method ? `${r.method} ${r.path}` : r.path) },
      ),
    );
  }
  for (const d of context.data.filter((x) => inArea(x.file)).slice(0, 3))
    phrases.push(dataPhrase(d, language));
  const deps = context.dependencies.filter((d) => inArea(d.manifest));
  if (deps.length) {
    phrases.push(
      list(
        deps.slice(0, 4).map((d) =>
          d.change === 'added'
            ? say('depAdded', { name: code(d.name) })
            : d.change === 'removed'
              ? say('depRemoved', { name: code(d.name) })
              : say(d.change === 'downgraded' ? 'depDowngraded' : 'depUpgraded', {
                  name: code(d.name),
                  from: d.from ?? '',
                  to: d.to ?? '',
                  major: d.major ? say('major') : '',
                }),
        ),
      ),
    );
  }
  for (const env of context.envVars.filter((e) => inArea(e.path) && e.change === 'added')) {
    phrases.push(say('envVar', { name: code(env.name) }));
  }
  const selectors = symbols.filter((s) => s.kind === 'selector');
  if (selectors.length) {
    phrases.push(
      say('styles', {
        names: list(selectors.slice(0, 3).map((s) => code(s.name))),
        more: selectors.length > 3 ? say('stylesMore', { count: selectors.length - 3 }) : '',
      }),
    );
  }
  if (phrases.length === 0) {
    const names = files.slice(0, 3).map((f) => code(f.split('/').pop() ?? f));
    phrases.push(
      say('edits', {
        names: list(names),
        more: files.length > 3 ? say('editsMore', { count: files.length - 3 }) : '',
      }),
    );
  }
  return sentenceCase(endSentence(language, list(phrases.slice(0, 4))));
}

/** A structural explanation built only from deterministic analysis (no model). */
export function explainHeuristically(
  context: ReviewContext,
  language: Language = 'en',
): Explanation {
  const depth = depthFor(context);
  const { intent, demonstration, size } = context;
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `explain.${key}`, params);
  const list = (items: string[]) => listOf(language, items);
  const userVisible = demonstration.kinds.some((k) => k !== 'architecture');
  const areaNames = context.areas.map((a) => a.name);

  const sentences = [intentSentence(context, language)];
  const stats = context.change.stats;
  const onlyFile =
    size.files === 1 ? context.change.files.find((f) => !f.ignored)?.path : undefined;
  const files = t(language, 'count.files', { count: size.files });
  const where = onlyFile
    ? code(onlyFile)
    : areaNames.length > 1
      ? say('summary.filesAcross', {
          files,
          areas: list(areaNames.slice(0, 4).map((a) => code(a))),
          more: areaNames.length > 4 ? say('summary.andMore') : '',
        })
      : areaNames[0]
        ? say('summary.filesIn', { files, area: code(areaNames[0]) })
        : files;
  sentences.push(
    say('summary.touches', { where, additions: stats.additions, deletions: stats.deletions }),
  );

  if (userVisible) {
    const kinds = demonstration.kinds
      .filter((k) => k !== 'architecture')
      .map((k) => say(`demoKind.${k}`));
    sentences.push(say('summary.userVisible', { kinds: list(kinds) }));
  } else if (!context.change.files.every((f) => f.category === 'docs' || f.category === 'test')) {
    sentences.push(say('summary.noSurface'));
  }
  if (intent.confidence === 'low') sentences.push(say('summary.lowConfidence'));

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
    reviewerNotes.unshift(
      say('notes.startWith', {
        path: code(first.path),
        reason: language === 'en' ? lowerFirst(first.reason) : first.reason,
      }),
    );
  if (context.tests.untestedSourceFiles.length && context.tests.changedTestFiles.length === 0) {
    reviewerNotes.push(say('notes.noTests', { count: context.tests.untestedSourceFiles.length }));
  }
  if (context.change.includesUncommitted) reviewerNotes.push(say('notes.uncommitted'));

  const architecture: string[] = [];
  if (depth === 'deep') {
    architecture.push(
      say('architecture.spans', {
        areas: t(language, 'count.areas', { count: context.areas.length }),
        list: list(
          context.areas.map(
            (a) => `${code(a.name)} (${a.surfaces.join(', ') || say('architecture.internal')})`,
          ),
        ),
      }),
    );
    if (context.dependencies.length)
      architecture.push(
        say('architecture.dependencies', {
          packages: t(language, 'count.packages', { count: context.dependencies.length }),
        }),
      );
    if (context.data.length)
      architecture.push(
        say('architecture.data', { list: list(context.data.slice(0, 4).map((d) => d.statement)) }),
      );
    if (context.routes.length)
      architecture.push(
        say('architecture.api', {
          list: list(
            context.routes
              .slice(0, 5)
              .map((r) => code(r.method ? `${r.method} ${r.path}` : r.path)),
          ),
        }),
      );
  }

  const headline =
    intent.summary.length > 3
      ? intent.summary
      : say('headline', { area: areaNames[0] ?? say('repository') });

  return {
    schemaVersion: 1,
    ...(language === 'en' ? {} : { language }),
    depth,
    headline,
    summary: joinSentences(language, sentences),
    intent: {
      statement: intentStatement(context, language),
      confidence: intent.confidence,
      evidence: intent.evidence,
    },
    behavior: {
      userVisible,
      notes: userVisible
        ? demonstration.runnable.available
          ? say('behavior.canRun')
          : say('behavior.cannotRun')
        : undefined,
    },
    changes: context.areas.map((a) => ({
      area: a.name,
      description: describeArea(context, a.files, language),
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
