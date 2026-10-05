import { copyFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ResolvedConfig } from '../config/resolve.ts';
import type { ResolvedLanguage } from '../i18n/language.ts';
import type { ChangeSource, CodeChange, Revision } from '../model/change.ts';
import type { Certainty, Verdict } from '../model/finding.ts';
import { Redactor } from '../security/redact.ts';
import { UsageError } from '../util/errors.ts';
import { ensureDir, exists, readJson, writeFileAtomic } from '../util/fs.ts';
import { sha256File } from '../util/hash.ts';

export type ArtifactKind =
  | 'context'
  | 'diff'
  | 'brief'
  | 'explanation'
  | 'review'
  | 'findings'
  | 'summary'
  | 'comment'
  | 'demo-plan'
  | 'capture'
  | 'screenshot'
  | 'recording'
  | 'terminal'
  | 'storyboard'
  | 'timeline'
  | 'narration'
  | 'audio'
  | 'captions'
  | 'composition'
  | 'video'
  | 'poster'
  | 'contact-sheet'
  | 'qc'
  | 'report'
  | 'log';

export type EntryPoint = 'cli' | 'github-action' | 'gitlab-ci' | 'agent';
export type StageStatus = 'ok' | 'skipped' | 'failed';
export type OutcomeStatus = 'success' | 'partial' | 'failed' | 'gated';

export interface StageRecord {
  name: string;
  status: StageStatus;
  startedAt: string;
  durationMs: number;
  reason?: string;
  error?: string;
}

export interface CommandRecord {
  command: string;
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  purpose: string;
}

export interface Artifact {
  path: string;
  kind: ArtifactKind;
  bytes: number;
  sha256: string;
}

export interface RunOutcome {
  status: OutcomeStatus;
  exitCode: number;
  verdict?: Verdict;
  findings?: Partial<Record<Certainty, number>>;
  gateFailures?: number;
  video?: { rendered: boolean; reason?: string; path?: string; seconds?: number };
  message?: string;
}

export interface RunManifest {
  schemaVersion: 1;
  runId: string;
  covi: { version: string };
  workflow: string;
  entryPoint: EntryPoint;
  interactive: boolean;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  /** When a later command (`covi report`, `covi render`) last updated the outcome. */
  updatedAt?: string;
  environment: { node: string; platform: string; ci?: string };
  repository?: { name: string; remote?: string; branch?: string };
  change?: {
    id: string;
    base: Revision;
    head: Revision;
    mergeBase?: string;
    source: ChangeSource;
    title?: string;
    includesUncommitted: boolean;
    stats: CodeChange['stats'];
  };
  config?: { provenance: Record<string, string>; values: unknown };
  /** The language Covi writes in, the setting it came from, and why (see `language` config). */
  language?: {
    value: ResolvedLanguage['language'];
    setting: ResolvedLanguage['setting'];
    source: string;
  };
  options?: Record<string, unknown>;
  stages: StageRecord[];
  commands: CommandRecord[];
  artifacts: Artifact[];
  warnings: string[];
  errors: Array<{ stage?: string; message: string }>;
  outcome?: RunOutcome;
}

export interface CreateRunOptions {
  /** Repository root (runs default to `<root>/.covi/runs/<id>`). */
  root: string;
  workflow: string;
  entryPoint: EntryPoint;
  interactive: boolean;
  coviVersion: string;
  /** Exact run directory (CI uses this for predictable artifact paths). */
  dir?: string;
  /** Runs root override (`output.dir`), relative to the repository root. */
  runsDir?: string;
  headSha?: string;
  keep?: number;
  redactor?: Redactor;
  now?: Date;
}

const RUN_ID = /^\d{8}-\d{6}-[a-z-]+(-[0-9a-f]{7})?(-\d+)?$/;

/**
 * A run is a directory of inspectable artifacts plus run.json, the manifest that records what was
 * asked, what ran, what was produced, and how it ended. The manifest is rewritten after every stage
 * so even an interrupted run can be inspected.
 */
export class Run {
  readonly id: string;
  readonly dir: string;
  readonly manifest: RunManifest;
  readonly redactor: Redactor;

  private constructor(id: string, dir: string, manifest: RunManifest, redactor: Redactor) {
    this.id = id;
    this.dir = dir;
    this.manifest = manifest;
    this.redactor = redactor;
  }

  static async create(options: CreateRunOptions): Promise<Run> {
    const now = options.now ?? new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const base = `${stamp}-${options.workflow}${options.headSha ? `-${options.headSha.slice(0, 7)}` : ''}`;
    let dir: string;
    let id: string;
    if (options.dir) {
      dir = resolve(options.dir);
      id = base;
    } else {
      const runsRoot = runsRootFor(options.root, options.runsDir);
      await ensureSelfIgnored(runsRoot);
      id = base;
      for (let n = 2; await exists(join(runsRoot, id)); n++) id = `${base}-${n}`;
      dir = join(runsRoot, id);
      if (options.keep) await pruneRuns(runsRoot, options.keep - 1);
    }
    await ensureDir(dir);
    const manifest: RunManifest = {
      schemaVersion: 1,
      runId: id,
      covi: { version: options.coviVersion },
      workflow: options.workflow,
      entryPoint: options.entryPoint,
      interactive: options.interactive,
      startedAt: now.toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        ci: detectCi(),
      },
      stages: [],
      commands: [],
      artifacts: [],
      warnings: [],
      errors: [],
    };
    const run = new Run(id, dir, manifest, options.redactor ?? Redactor.fromProcess());
    await run.save();
    if (!options.dir) await writeFile(join(dirname(dir), 'LATEST'), `${id}\n`);
    return run;
  }

  /** Opens an existing run by directory, id, or `latest`. */
  static async open(
    ref: string,
    options: { root: string; runsDir?: string; redactor?: Redactor },
  ): Promise<Run> {
    const runsRoot = runsRootFor(options.root, options.runsDir);
    let dir: string;
    if (ref === 'latest') {
      const id = (await readFile(join(runsRoot, 'LATEST'), 'utf8').catch(() => '')).trim();
      if (!id)
        throw new UsageError('No runs yet.', 'Start one with `covi analyze` or `covi review`.');
      dir = join(runsRoot, id);
    } else if (isAbsolute(ref) || ref.includes('/') || ref.startsWith('.')) {
      dir = resolve(ref);
    } else {
      dir = join(runsRoot, ref);
    }
    const manifestPath = join(dir, 'run.json');
    if (!(await exists(manifestPath)))
      throw new UsageError(`No Covi run at ${dir}`, 'List runs with `covi runs`.');
    const manifest = await readJson<RunManifest>(manifestPath);
    return new Run(manifest.runId, dir, manifest, options.redactor ?? Redactor.fromProcess());
  }

  path(rel: string): string {
    const full = resolve(this.dir, rel);
    const inside = relative(this.dir, full);
    if (inside.startsWith('..') || isAbsolute(inside))
      throw new Error(`Artifact path escapes the run directory: ${rel}`);
    return full;
  }

  async has(rel: string): Promise<boolean> {
    return exists(this.path(rel));
  }

  async readJson<T>(rel: string): Promise<T> {
    return readJson<T>(this.path(rel));
  }

  async readText(rel: string): Promise<string> {
    return readFile(this.path(rel), 'utf8');
  }

  async writeJson(rel: string, value: unknown, kind: ArtifactKind): Promise<string> {
    const full = this.path(rel);
    await writeFileAtomic(full, `${JSON.stringify(this.redactor.redactDeep(value), null, 2)}\n`);
    await this.record(rel, kind);
    return full;
  }

  async writeText(rel: string, text: string, kind: ArtifactKind): Promise<string> {
    const full = this.path(rel);
    await writeFileAtomic(full, this.redactor.redact(text));
    await this.record(rel, kind);
    return full;
  }

  /** Copies an external file into the run (e.g. a rendered video). */
  async importFile(source: string, rel: string, kind: ArtifactKind): Promise<string> {
    const full = this.path(rel);
    await ensureDir(dirname(full));
    if (resolve(source) !== full) await copyFile(source, full);
    await this.record(rel, kind);
    return full;
  }

  /** Records a file that another component already wrote inside the run directory. */
  async record(rel: string, kind: ArtifactKind): Promise<void> {
    const full = this.path(rel);
    const info = await stat(full);
    const entry: Artifact = {
      path: relative(this.dir, full),
      kind,
      bytes: info.size,
      sha256: await sha256File(full),
    };
    const i = this.manifest.artifacts.findIndex((a) => a.path === entry.path);
    if (i >= 0) this.manifest.artifacts[i] = entry;
    else this.manifest.artifacts.push(entry);
  }

  /** Removes a file a later stage made stale, and its record. */
  async discard(rel: string): Promise<void> {
    const full = this.path(rel);
    await rm(full, { force: true });
    const path = relative(this.dir, full);
    this.manifest.artifacts = this.manifest.artifacts.filter((a) => a.path !== path);
  }

  artifact(kind: ArtifactKind): Artifact | undefined {
    return this.manifest.artifacts.find((a) => a.kind === kind);
  }

  async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    const record: StageRecord = {
      name,
      status: 'ok',
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
    };
    this.manifest.stages.push(record);
    try {
      const result = await fn();
      record.durationMs = Date.now() - started;
      return result;
    } catch (error) {
      record.status = 'failed';
      record.durationMs = Date.now() - started;
      record.error = this.redactor.redact((error as Error).message ?? String(error));
      this.manifest.errors.push({ stage: name, message: record.error });
      throw error;
    } finally {
      await this.save();
    }
  }

  async skip(name: string, reason: string): Promise<void> {
    this.manifest.stages.push({
      name,
      status: 'skipped',
      startedAt: new Date().toISOString(),
      durationMs: 0,
      reason,
    });
    await this.save();
  }

  recordCommand(entry: CommandRecord): void {
    this.manifest.commands.push({ ...entry, command: this.redactor.redact(entry.command) });
  }

  warn(message: string): void {
    const m = this.redactor.redact(message);
    if (!this.manifest.warnings.includes(m)) this.manifest.warnings.push(m);
  }

  setChange(change: CodeChange): void {
    this.manifest.repository = {
      name: change.repository.name,
      remote: change.repository.remote,
      branch: change.repository.branch,
    };
    this.manifest.change = {
      id: change.id,
      base: change.base,
      head: change.head,
      mergeBase: change.mergeBase,
      source: change.source,
      title: change.metadata.title ? this.redactor.redact(change.metadata.title) : undefined,
      includesUncommitted: change.includesUncommitted,
      stats: change.stats,
    };
  }

  setConfig(resolved: ResolvedConfig, options?: Record<string, unknown>): void {
    this.manifest.config = {
      provenance: resolved.provenance,
      values: this.redactor.redactDeep(resolved.config),
    };
    if (options) this.manifest.options = this.redactor.redactDeep(options);
  }

  setLanguage(resolved: ResolvedLanguage): void {
    this.manifest.language = {
      value: resolved.language,
      setting: resolved.setting,
      source: this.redactor.redact(resolved.source),
    };
  }

  async finish(outcome: RunOutcome): Promise<void> {
    const finished = new Date();
    this.manifest.finishedAt = finished.toISOString();
    this.manifest.durationMs = finished.getTime() - new Date(this.manifest.startedAt).getTime();
    this.manifest.outcome = {
      ...outcome,
      message: outcome.message ? this.redactor.redact(outcome.message) : undefined,
    };
    await this.save();
  }

  /**
   * Updates the outcome of a finished run that a later command re-entered (`covi report` reviews
   * again, `covi render` renders again). Only the given fields change; timing stays the original.
   */
  async updateOutcome(update: Partial<RunOutcome>): Promise<void> {
    const defined = Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined));
    const merged = { ...this.manifest.outcome, ...defined } as RunOutcome;
    this.manifest.outcome = {
      ...merged,
      message: merged.message ? this.redactor.redact(merged.message) : undefined,
    };
    this.manifest.updatedAt = new Date().toISOString();
    await this.save();
  }

  async save(): Promise<void> {
    await writeFileAtomic(
      join(this.dir, 'run.json'),
      `${JSON.stringify(this.manifest, null, 2)}\n`,
    );
  }
}

export function runsRootFor(root: string, runsDir?: string): string {
  return resolve(root, runsDir ?? '.covi/runs');
}

/**
 * Keeps run artifacts out of git without touching the user's .gitignore: the runs directory
 * ignores itself (like pytest's cache), so nothing Covi writes shows up in `git status`.
 */
export async function ensureSelfIgnored(dir: string): Promise<void> {
  const file = join(dir, '.gitignore');
  if (await exists(file)) return;
  await ensureDir(dir);
  await writeFile(file, '# Created by Covi: everything here is generated.\n*\n');
}

export interface RunSummary {
  id: string;
  dir: string;
  workflow: string;
  startedAt: string;
  status?: OutcomeStatus;
  verdict?: Verdict;
  title?: string;
}

export async function listRuns(root: string, runsDir?: string): Promise<RunSummary[]> {
  const runsRoot = runsRootFor(root, runsDir);
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const out: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = await readJson<RunManifest>(join(runsRoot, entry.name, 'run.json')).catch(
      () => undefined,
    );
    if (!manifest) continue;
    out.push({
      id: manifest.runId,
      dir: join(runsRoot, entry.name),
      workflow: manifest.workflow,
      startedAt: manifest.startedAt,
      status: manifest.outcome?.status,
      verdict: manifest.outcome?.verdict,
      title: manifest.change?.title,
    });
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Deletes the oldest Covi run directories beyond `keep`. Only touches directories that hold a run.json. */
export async function pruneRuns(runsRoot: string, keep: number): Promise<string[]> {
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const runs = entries
    .filter((e) => e.isDirectory() && RUN_ID.test(e.name))
    .map((e) => e.name)
    .sort();
  const removed: string[] = [];
  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) {
    const dir = join(runsRoot, name);
    if (!(await exists(join(dir, 'run.json')))) continue;
    await rm(dir, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export function detectCi(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.GITHUB_ACTIONS === 'true') return 'github-actions';
  if (env.GITLAB_CI === 'true') return 'gitlab-ci';
  if (env.BUILDKITE) return 'buildkite';
  if (env.CIRCLECI) return 'circleci';
  if (env.JENKINS_URL) return 'jenkins';
  if (env.CI) return 'ci';
  return undefined;
}
