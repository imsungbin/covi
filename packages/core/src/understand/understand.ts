import type { CoviConfig } from '../config/schema.ts';
import type { Git } from '../git/git.ts';
import { RevisionReader } from '../git/reader.ts';
import {
  type ChangedFile,
  type CodeChange,
  reviewableFiles,
  type Surface,
} from '../model/change.ts';
import {
  type ChangeSize,
  type DataChange,
  type DependencyChange,
  digestChange,
  type EnvVarChange,
  type ReadingStep,
  type ReviewContext,
  type RouteChange,
  type Signal,
  type SizeClass,
  type SymbolChange,
  type TestSummary,
} from '../model/context.ts';
import { type Logger, silentLogger } from '../util/log.ts';
import { code, joinList, plural } from '../util/text.ts';
import { groupAreas } from './areas.ts';
import { assessDemonstration, type RepoShape } from './demonstration.ts';
import { diffManifest, isDependencyManifest } from './dependencies.ts';
import { ENV_DOC_PATHSPECS, extractEnvVars } from './env-vars.ts';
import { cleanSubject, inferIntent } from './intent.ts';
import { extractDataChanges, rollbackLineSet } from './migrations.ts';
import { countTestCases, diffSymbols, extractSymbols } from './symbols.ts';

export interface UnderstandOptions {
  git: Git;
  config: CoviConfig;
  logger?: Logger;
}

const SYMBOL_CATEGORIES = new Set(['source', 'markup', 'style']);
const MAX_SYMBOL_FILE_LINES = 4000;

/** The Understand phase: turns a CodeChange into structured, reusable context. */
export async function understandChange(
  change: CodeChange,
  options: UnderstandOptions,
): Promise<ReviewContext> {
  const logger = options.logger ?? silentLogger;
  const reader = new RevisionReader(options.git, change);
  const files = reviewableFiles(change);

  const { changes: symbols, routeFiles } = await collectSymbols(files, reader, logger);
  // Files that define HTTP routes are API surface regardless of where they live.
  for (const f of files)
    if (routeFiles.has(f.path) && !f.surfaces.includes('api')) f.surfaces.push('api');
  const routes: RouteChange[] = symbols
    .filter((s) => s.kind === 'route')
    .map((s) => {
      const [first, ...rest] = s.name.split(' ');
      const hasMethod = rest.length > 0;
      return {
        method: hasMethod ? first : undefined,
        path: hasMethod ? rest.join(' ') : s.name,
        change: s.change,
        file: s.path,
        line: s.line,
      };
    });
  const dependencies = await collectDependencies(files, reader);
  const envVars = await collectEnvVars(files, reader);
  const data = await collectDataChanges(files, reader);
  const tests = await summarizeTests(files, options.git, reader);

  const size = sizeOf(files);
  const intent = inferIntent({ change, files, symbols, routes, hasDataChanges: data.length > 0 });
  const areas = groupAreas(files);
  size.areas = areas.length;
  const repo = await repoShape(reader);
  const demonstration = assessDemonstration({
    files,
    symbols,
    routes,
    intent,
    size,
    areaCount: areas.length,
    config: options.config,
    repo,
  });

  const surfaces: Partial<Record<Surface, string[]>> = {};
  for (const f of files) {
    for (const s of f.surfaces) surfaces[s] = [...(surfaces[s] ?? []), f.path];
  }

  const signals = collectSignals(change, files, {
    symbols,
    dependencies,
    envVars,
    data,
    routes,
    tests,
  });
  const notes = collectNotes(change, files, tests);
  const ambiguities = intent.ambiguity ? [intent.ambiguity] : [];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    change: digestChange(change),
    size,
    intent,
    areas,
    surfaces,
    symbols,
    dependencies,
    envVars,
    routes,
    data,
    tests,
    demonstration,
    readingOrder: readingOrder(files, symbols, data, dependencies),
    signals,
    notes,
    ambiguities,
  };
}

async function collectSymbols(
  files: readonly ChangedFile[],
  reader: RevisionReader,
  logger: Logger,
): Promise<{ changes: SymbolChange[]; routeFiles: Set<string> }> {
  const targets = files.filter(
    (f) =>
      !f.binary &&
      SYMBOL_CATEGORIES.has(f.category) &&
      f.language &&
      f.additions + f.deletions < MAX_SYMBOL_FILE_LINES,
  );
  const headPaths = targets.filter((f) => f.status !== 'deleted').map((f) => f.path);
  const basePaths = targets.filter((f) => f.status !== 'added').map((f) => f.oldPath ?? f.path);
  const [head, base] = await Promise.all([
    reader.read('head', headPaths),
    reader.read('base', basePaths),
  ]);
  const changes: SymbolChange[] = [];
  const routeFiles = new Set<string>();
  for (const f of targets) {
    try {
      const headText = f.status === 'deleted' ? undefined : head.get(f.path);
      const baseText = f.status === 'added' ? undefined : base.get(f.oldPath ?? f.path);
      const headSymbols =
        headText === undefined ? undefined : extractSymbols(headText, f.language, f.path);
      const baseSymbols =
        baseText === undefined
          ? undefined
          : extractSymbols(baseText, f.language, f.oldPath ?? f.path);
      if ([...(headSymbols ?? []), ...(baseSymbols ?? [])].some((s) => s.kind === 'route'))
        routeFiles.add(f.path);
      const headChanged = new Set(
        f.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'add').map((l) => l.newLine!)),
      );
      const baseChanged = new Set(
        f.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'del').map((l) => l.oldLine!)),
      );
      changes.push(
        ...diffSymbols({
          path: f.path,
          head:
            headSymbols && headText !== undefined
              ? { symbols: headSymbols, lines: headText.split('\n').length, changed: headChanged }
              : undefined,
          base:
            baseSymbols && baseText !== undefined
              ? { symbols: baseSymbols, lines: baseText.split('\n').length, changed: baseChanged }
              : undefined,
        }),
      );
    } catch (error) {
      logger.debug(`Symbol extraction failed for ${f.path}: ${(error as Error).message}`);
    }
  }
  return { changes, routeFiles };
}

async function collectDependencies(
  files: readonly ChangedFile[],
  reader: RevisionReader,
): Promise<DependencyChange[]> {
  const manifests = files.filter((f) => f.category === 'manifest' && isDependencyManifest(f.path));
  const out: DependencyChange[] = [];
  for (const f of manifests) {
    const before =
      f.status === 'added' ? undefined : await reader.readOne('base', f.oldPath ?? f.path);
    const after = f.status === 'deleted' ? undefined : await reader.readOne('head', f.path);
    out.push(...diffManifest(f.path, before, after));
  }
  return out;
}

async function collectEnvVars(
  files: readonly ChangedFile[],
  reader: RevisionReader,
): Promise<EnvVarChange[]> {
  const added = new Map<string, { path: string; line?: number }>();
  const removed = new Map<string, { path: string; line?: number }>();
  for (const f of files) {
    if (f.category !== 'source' && f.category !== 'markup') continue;
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.kind === 'context') continue;
        for (const name of extractEnvVars(l.text)) {
          const target = l.kind === 'add' ? added : removed;
          if (!target.has(name))
            target.set(name, { path: f.path, line: l.kind === 'add' ? l.newLine : l.oldLine });
        }
      }
    }
  }
  const out: EnvVarChange[] = [];
  for (const [name, where] of [...added].slice(0, 20)) {
    if (removed.has(name)) continue;
    const before = await reader.grep(name, { at: 'base', fixed: true, word: true, maxHits: 1 });
    if (before.length > 0) continue;
    const docs = await reader.grep(name, {
      at: 'head',
      fixed: true,
      word: true,
      pathspecs: ENV_DOC_PATHSPECS,
      maxHits: 1,
    });
    out.push({
      name,
      change: 'added',
      path: where.path,
      line: where.line,
      documented: docs.length > 0,
    });
  }
  for (const [name, where] of [...removed].slice(0, 20)) {
    if (added.has(name)) continue;
    const after = await reader.grep(name, { at: 'head', fixed: true, word: true, maxHits: 1 });
    if (after.length > 0) continue;
    out.push({ name, change: 'removed', path: where.path, line: where.line, documented: false });
  }
  return out;
}

async function collectDataChanges(
  files: readonly ChangedFile[],
  reader: RevisionReader,
): Promise<DataChange[]> {
  const out: DataChange[] = [];
  for (const f of files) {
    if (f.category !== 'migration' && f.category !== 'schema' && f.language !== 'sql') continue;
    const head = f.status === 'deleted' ? undefined : await reader.readOne('head', f.path);
    const rollback = head ? rollbackLineSet(head) : new Set<number>();
    const lines = f.hunks.flatMap((h) =>
      h.lines
        .filter((l) => l.kind === 'add' && !rollback.has(l.newLine ?? -1))
        .map((l) => ({ text: l.text, line: l.newLine })),
    );
    out.push(...extractDataChanges(f.path, lines));
  }
  return out;
}

async function summarizeTests(
  files: readonly ChangedFile[],
  git: Git,
  reader: RevisionReader,
): Promise<TestSummary> {
  const testFiles = files.filter((f) => f.category === 'test');
  let addedCases = 0;
  let removedCases = 0;
  for (const f of testFiles) {
    addedCases += countTestCases(
      f.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'add').map((l) => l.text)),
    );
    removedCases += countTestCases(
      f.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'del').map((l) => l.text)),
    );
  }
  const testNames = testFiles.map((f) =>
    (f.path.split('/').pop() ?? '')
      .replace(/(\.|_)(test|spec)\b.*$/i, '')
      .replace(/^test_/, '')
      .toLowerCase(),
  );
  const untested = files
    .filter(
      (f) =>
        f.category === 'source' && f.additions + f.deletions >= 2 && !f.surfaces.includes('test'),
    )
    .filter((f) => {
      const stem = (f.path.split('/').pop() ?? '').replace(/\.\w+$/, '').toLowerCase();
      return !testNames.some((n) => n === stem || n.includes(stem) || stem.includes(n));
    })
    .map((f) => f.path);

  const listing = await git.tryOut([
    'ls-files',
    '--',
    ':(glob)**/*test*',
    ':(glob)**/*spec*',
    ':(glob)**/tests/**',
    ':(glob)**/__tests__/**',
  ]);
  const repoHasTests = Boolean(listing && listing.length > 0) || testFiles.length > 0;

  const frameworks = new Set<string>();
  const pkg = await reader.readOne('head', 'package.json');
  if (pkg) {
    for (const name of [
      'vitest',
      'jest',
      'mocha',
      'ava',
      '@playwright/test',
      'cypress',
      'node:test',
    ]) {
      if (pkg.includes(`"${name}"`)) frameworks.add(name);
    }
    if (/"test"\s*:\s*"node --test/.test(pkg)) frameworks.add('node:test');
  }
  if (files.some((f) => f.language === 'python' && f.category === 'test')) frameworks.add('pytest');
  if (files.some((f) => f.language === 'go' && f.category === 'test')) frameworks.add('go test');

  return {
    changedTestFiles: testFiles.map((f) => f.path),
    addedTestCases: addedCases,
    removedTestCases: removedCases,
    untestedSourceFiles: repoHasTests ? untested : [],
    repoHasTests,
    frameworks: [...frameworks],
  };
}

function sizeOf(files: readonly ChangedFile[]): ChangeSize {
  const counted = files.filter((f) => f.category !== 'lockfile' && f.category !== 'generated');
  const changedLines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  const n = counted.length;
  let cls: SizeClass = 'huge';
  if (changedLines <= 10 && n <= 2) cls = 'trivial';
  else if (changedLines <= 80 && n <= 6) cls = 'small';
  else if (changedLines <= 400 && n <= 20) cls = 'medium';
  else if (changedLines <= 1500 && n <= 60) cls = 'large';
  return { class: cls, changedLines, files: n, areas: 0 };
}

async function repoShape(reader: RevisionReader): Promise<RepoShape> {
  const pkgText = await reader.readOne('head', 'package.json');
  let scripts: Record<string, string> = {};
  let needsBuild = false;
  let bin = false;
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as {
        scripts?: Record<string, string>;
        dependencies?: object;
        devDependencies?: object;
        bin?: unknown;
      };
      scripts = pkg.scripts ?? {};
      bin = pkg.bin !== undefined;
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      needsBuild = deps.some((d) =>
        /^(vite|next|nuxt|react-scripts|webpack|parcel|@sveltejs\/kit|astro|@angular\/core|gatsby|remix|@remix-run\/dev)$/.test(
          d,
        ),
      );
    } catch {
      // Ignore malformed package.json.
    }
  }
  let staticRoot: string | undefined;
  if (!needsBuild) {
    for (const dir of ['.', 'public', 'static', 'site', 'www']) {
      const path = dir === '.' ? 'index.html' : `${dir}/index.html`;
      if ((await reader.readOne('head', path)) !== undefined) {
        staticRoot = dir;
        break;
      }
    }
  }
  return { staticRoot, scripts, needsBuild, bin };
}

const CATEGORY_WEIGHT: Record<string, number> = {
  migration: 60,
  schema: 58,
  source: 50,
  markup: 42,
  style: 32,
  config: 28,
  ci: 26,
  manifest: 22,
  infra: 20,
  build: 16,
  test: 12,
  docs: 6,
  asset: 4,
  other: 4,
};

function readingOrder(
  files: readonly ChangedFile[],
  symbols: readonly SymbolChange[],
  data: readonly DataChange[],
  deps: readonly DependencyChange[],
): ReadingStep[] {
  const scored = files
    .filter(
      (f) => f.category !== 'lockfile' && f.category !== 'generated' && f.category !== 'vendored',
    )
    .map((f) => {
      const own = symbols.filter((s) => s.path === f.path);
      let score =
        (CATEGORY_WEIGHT[f.category] ?? 4) + Math.min(30, (f.additions + f.deletions) / 5);
      if (own.some((s) => s.exported && s.change !== 'modified')) score += 15;
      if (own.some((s) => s.kind === 'route')) score += 10;
      if (f.surfaces.includes('security')) score += 10;
      return { f, own, score };
    })
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path));

  // Tests read best right after the code they cover.
  const nonTests = scored.filter((s) => s.f.category !== 'test');
  const tests = scored.filter((s) => s.f.category === 'test');
  return [...nonTests, ...tests]
    .slice(0, 12)
    .map(({ f, own }) => ({ path: f.path, reason: readingReason(f, own, data, deps) }));
}

function readingReason(
  f: ChangedFile,
  own: readonly SymbolChange[],
  data: readonly DataChange[],
  deps: readonly DependencyChange[],
): string {
  const ops = data.filter((d) => d.file === f.path);
  if (ops.length)
    return `Schema/data change: ${joinList(ops.slice(0, 3).map((d) => d.operation.replace('-', ' ') + (d.table ? ` ${d.table}` : '')))}.`;
  if (f.category === 'manifest') {
    const mine = deps.filter((d) => d.manifest === f.path);
    if (mine.length)
      return `Dependency changes: ${joinList(mine.slice(0, 4).map((d) => code(d.name)))}.`;
  }
  if (f.category === 'test') {
    return f.status === 'added' ? 'New tests for this change.' : 'Test updates for this change.';
  }
  const routes = own.filter((s) => s.kind === 'route');
  if (routes.length)
    return `Route ${routes[0]!.change}: ${code(routes[0]!.name)}${routes.length > 1 ? ` and ${routes.length - 1} more` : ''}.`;
  const addedSyms = own.filter((s) => s.change === 'added' && s.kind !== 'selector');
  const modified = own.filter((s) => s.change === 'modified' && s.kind !== 'selector');
  const removed = own.filter((s) => s.change === 'removed' && s.kind !== 'selector');
  const parts: string[] = [];
  if (addedSyms.length)
    parts.push(`adds ${joinList(addedSyms.slice(0, 3).map((s) => code(s.name)))}`);
  if (modified.length)
    parts.push(`changes ${joinList(modified.slice(0, 3).map((s) => code(s.name)))}`);
  if (removed.length)
    parts.push(`removes ${joinList(removed.slice(0, 2).map((s) => code(s.name)))}`);
  if (parts.length) return `${capitalize(joinList(parts))}.`;
  const selectors = own.filter((s) => s.kind === 'selector');
  if (selectors.length)
    return `Styles for ${joinList(selectors.slice(0, 3).map((s) => code(s.name)))}.`;
  if (f.status === 'added') return `New ${f.category} file.`;
  if (f.status === 'deleted') return `Deleted ${f.category} file.`;
  if (f.status === 'renamed') return `Moved from ${f.oldPath}.`;
  return `${capitalize(f.category)} change (+${f.additions} −${f.deletions}).`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

interface SignalInput {
  symbols: readonly SymbolChange[];
  dependencies: readonly DependencyChange[];
  envVars: readonly EnvVarChange[];
  data: readonly DataChange[];
  routes: readonly RouteChange[];
  tests: TestSummary;
}

function collectSignals(
  change: CodeChange,
  files: readonly ChangedFile[],
  s: SignalInput,
): Signal[] {
  const out: Signal[] = [];
  const breaking = change.commits.find(
    (c) => cleanSubject(c.subject).breaking || /BREAKING[ -]CHANGE/.test(c.body),
  );
  if (breaking)
    out.push({
      id: 'breaking-commit',
      message: `A commit declares a breaking change: "${breaking.subject}".`,
    });
  for (const r of s.routes.filter((r) => r.change === 'removed')) {
    out.push({
      id: 'route-removed',
      message: `Route ${r.method ? `${r.method} ` : ''}${r.path} was removed.`,
      path: r.file,
      line: r.line,
    });
  }
  for (const sym of s.symbols.filter(
    (x) => x.change === 'removed' && x.exported && x.kind !== 'route' && x.kind !== 'selector',
  )) {
    out.push({
      id: 'export-removed',
      message: `Exported ${sym.kind} ${sym.name} was removed.`,
      path: sym.path,
      line: sym.line,
    });
  }
  for (const d of s.data.filter((x) => x.destructive)) {
    out.push({
      id: 'destructive-migration',
      message: `Destructive data operation: ${d.statement}`,
      path: d.file,
      line: d.line,
    });
  }
  for (const dep of s.dependencies.filter((d) => d.change === 'added' && !d.dev)) {
    out.push({
      id: 'dependency-added',
      message: `New runtime dependency ${dep.name}@${dep.to}.`,
      path: dep.manifest,
    });
  }
  for (const dep of s.dependencies.filter((d) => d.major)) {
    out.push({
      id: 'major-upgrade',
      message: `${dep.name} changes major version (${dep.from} → ${dep.to}).`,
      path: dep.manifest,
    });
  }
  for (const env of s.envVars.filter((e) => e.change === 'added')) {
    out.push({
      id: 'env-var-added',
      message: `New environment variable ${env.name}${env.documented ? '' : ' (not documented)'}.`,
      path: env.path,
      line: env.line,
    });
  }
  if (files.some((f) => f.surfaces.includes('security'))) {
    out.push({
      id: 'security-surface',
      message: 'Authentication, authorization, or crypto-related files changed.',
    });
  }
  const exec = files.filter((f) => f.oldMode && f.newMode && f.oldMode !== f.newMode);
  for (const f of exec)
    out.push({
      id: 'mode-changed',
      message: `File mode changed ${f.oldMode} → ${f.newMode}.`,
      path: f.path,
    });
  if (change.includesUncommitted)
    out.push({ id: 'uncommitted', message: 'The change includes uncommitted work.' });
  return out;
}

function collectNotes(
  change: CodeChange,
  files: readonly ChangedFile[],
  tests: TestSummary,
): string[] {
  const notes: string[] = [];
  const lock = change.files.filter((f) => f.category === 'lockfile');
  if (lock.length) {
    const lines = lock.reduce((n, f) => n + f.additions + f.deletions, 0);
    notes.push(
      `${plural(lock.length, 'lockfile')} changed (${lines} lines); these are mechanical and can be skimmed.`,
    );
  }
  const ignored = change.files.filter((f) => f.ignored);
  if (ignored.length) {
    const reasons = [...new Set(ignored.map((f) => f.ignoreReason))].join(', ');
    notes.push(`${plural(ignored.length, 'file')} skipped as ${reasons}.`);
  }
  const binary = files.filter((f) => f.binary);
  if (binary.length)
    notes.push(
      `${plural(binary.length, 'binary file')} changed: ${joinList(binary.slice(0, 3).map((f) => code(f.path)))}.`,
    );
  const todos = files.flatMap((f) =>
    f.hunks.flatMap((h) =>
      h.lines.filter((l) => l.kind === 'add' && /\b(TODO|FIXME|HACK|XXX)\b/.test(l.text)),
    ),
  );
  if (todos.length) notes.push(`Adds ${plural(todos.length, 'TODO/FIXME comment')}.`);
  if (tests.addedTestCases || tests.removedTestCases) {
    notes.push(
      `Tests: ${tests.addedTestCases} test case(s) added, ${tests.removedTestCases} removed.`,
    );
  }
  const renamed = files.filter((f) => f.status === 'renamed');
  if (renamed.length) notes.push(`${plural(renamed.length, 'file')} renamed or moved.`);
  return notes;
}
