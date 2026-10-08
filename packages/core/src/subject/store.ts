import type { Stats } from 'node:fs';
import { lstat, open, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { CoviConfig } from '../config/schema.ts';
import type { Git } from '../git/git.ts';
import {
  SUBJECT_LIMITS,
  type Subject,
  type SubjectObservation,
  SubjectSchema,
  type SubjectSnapshot,
  SubjectSnapshotSchema,
} from '../model/subject.ts';
import { DEMO_PATHS, SUBJECT_PATHS } from '../run/paths.ts';
import type { Run } from '../run/run.ts';
import type { Redactor } from '../security/redact.ts';
import { ensureDir, writeFileAtomic } from '../util/fs.ts';
import { formatIssues, parseOrThrow } from '../util/zod.ts';
import { emptySubject, mergeSubject } from './merge.ts';

export interface SubjectSource {
  store: 'repo' | 'runs';
  /**
   * Where the model is read from: a file under `base` (no symbolic link may sit between them), or
   * (in CI) the repository file at the base revision.
   */
  from:
    | { kind: 'file'; path: string; base: string }
    | { kind: 'revision'; revision: string; path: string };
  /** Where a run saves what it saw; absent when the model comes from a revision. */
  to?: string;
  /** Serializes saves across runs. */
  lock: string;
  expireAfter: number;
}

/** The model a run reads and updates. Not writable when it comes from a revision or failed to load. */
export interface SubjectHandle {
  source: SubjectSource;
  model: Subject;
  writable: boolean;
}

/**
 * Where the model is for `subject.store`. In CI (`baseRevision`) the repository's copy is read
 * from the base revision, like configuration, so a change cannot steer its own demonstration; it
 * is never written there, since the checkout is thrown away. The runs directory is not part of
 * the change, so `runs` reads and writes it everywhere.
 */
export function subjectSource(options: {
  root: string;
  runsRoot: string;
  config: Pick<CoviConfig, 'subject'>;
  baseRevision?: string;
}): SubjectSource | undefined {
  const { store, expireAfter } = options.config.subject;
  if (store === 'off') return undefined;
  const lock = join(options.runsRoot, SUBJECT_PATHS.lock);
  if (store === 'runs') {
    const path = join(options.runsRoot, SUBJECT_PATHS.runs);
    return {
      store,
      from: { kind: 'file', path, base: options.runsRoot },
      to: path,
      lock,
      expireAfter,
    };
  }
  if (options.baseRevision)
    return {
      store,
      from: { kind: 'revision', revision: options.baseRevision, path: SUBJECT_PATHS.repo },
      lock,
      expireAfter,
    };
  const path = join(options.root, SUBJECT_PATHS.repo);
  return { store, from: { kind: 'file', path, base: options.root }, to: path, lock, expireAfter };
}

function labelOf(from: SubjectSource['from']): string {
  return from.kind === 'file' ? from.path : `${from.path}@${from.revision.slice(0, 7)} (base)`;
}

type Read = { text: string } | { missing: true } | { refused: string };

/**
 * Reads the store's file without following a symbolic link at or above it (up to `base`): a
 * repository could otherwise point `.covi/subject` at a file of the user's, and Covi would read it
 * and write over it. The size is checked before reading.
 */
async function readStoreFile(from: { path: string; base: string }): Promise<Read> {
  const unreadable = (error: unknown): Read => ({
    refused: `could not be read (${(error as NodeJS.ErrnoException).code ?? error})`,
  });
  let at = from.base;
  let info: Stats | undefined;
  for (const part of relative(from.base, from.path).split(sep)) {
    at = join(at, part);
    try {
      info = await lstat(at);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { missing: true };
      return unreadable(error);
    }
    if (info.isSymbolicLink()) return { refused: 'is reached through a symbolic link' };
  }
  if (!info?.isFile()) return { refused: 'is not a file' };
  if (info.size > SUBJECT_LIMITS.bytes) return { refused: 'is larger than 512 KB' };
  try {
    return { text: await readFile(from.path, 'utf8') };
  } catch (error) {
    return unreadable(error);
  }
}

/** The repository file at a revision; its size is asked first, so a huge blob is never read. */
async function readAtRevision(
  from: { revision: string; path: string },
  git: Git | undefined,
): Promise<Read> {
  const spec = `${from.revision}:${from.path}`;
  const size = await git?.tryOut(['cat-file', '-s', spec]);
  if (!git || size === undefined) return { missing: true };
  if (Number(size) > SUBJECT_LIMITS.bytes) return { refused: 'is larger than 512 KB' };
  const result = await git.run(['cat-file', 'blob', spec]);
  return result.exitCode === 0 ? { text: result.stdout } : { missing: true };
}

/**
 * Reads the model. It is repository data, so it is checked before anything uses it: a file that is
 * too large, reached through a symbolic link, not JSON, not a model this version reads, or that
 * holds anything the schema does not allow (a command line, a goto off the app, control
 * characters) is set aside with a warning and an empty model, and `invalid` keeps Covi from
 * overwriting what someone may want to fix.
 */
export async function loadSubject(
  source: Pick<SubjectSource, 'from'>,
  options: { git?: Git; warn: (message: string) => void },
): Promise<{ model: Subject; status: 'loaded' | 'empty' | 'invalid' }> {
  const { from } = source;
  const read =
    from.kind === 'file' ? await readStoreFile(from) : await readAtRevision(from, options.git);
  const setAside = (why: string) => {
    options.warn(
      `${labelOf(from)} ${why}; Covi planned without it and will not overwrite it. Fix or delete the file.`,
    );
    return { model: emptySubject(), status: 'invalid' as const };
  };
  if ('missing' in read) return { model: emptySubject(), status: 'empty' };
  if ('refused' in read) return setAside(read.refused);
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return setAside('is not valid JSON');
  }
  const parsed = SubjectSchema.safeParse(raw);
  if (!parsed.success)
    return setAside(`is not a subject model Covi can read (${formatIssues(parsed.error, 1)[0]})`);
  return { model: parsed.data, status: 'loaded' };
}

export async function openSubject(options: {
  root: string;
  runsRoot: string;
  config: Pick<CoviConfig, 'subject'>;
  baseRevision?: string;
  git?: Git;
  warn: (message: string) => void;
}): Promise<SubjectHandle | undefined> {
  const source = subjectSource(options);
  if (!source) return undefined;
  const loaded = await loadSubject(source, options);
  return {
    source,
    model: loaded.model,
    writable: source.to !== undefined && loaded.status !== 'invalid',
  };
}

const LOCK_WAIT_MS = 5_000;
/** A run holds the lock for one read, merge, and write; one older than this died holding it. */
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 50;

/** Runs `fn` while holding `lock` (a file created exclusively); undefined when it stayed busy. */
export async function withLock<T>(
  lock: string,
  fn: () => Promise<T>,
  options: { waitMs?: number; staleMs?: number } = {},
): Promise<T | undefined> {
  const deadline = Date.now() + (options.waitMs ?? LOCK_WAIT_MS);
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  await ensureDir(dirname(lock));
  for (;;) {
    try {
      await (await open(lock, 'wx')).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const info = await lstat(lock).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > staleMs) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * Saves what a run saw. Under the lock it reads the store again, so a run that saved since this
 * one opened the model keeps its observations, merges, redacts, checks, and writes atomically.
 */
export async function saveSubject(
  source: SubjectSource,
  observation: SubjectObservation,
  options: { redactor: Redactor; warn: (message: string) => void; lockWaitMs?: number },
): Promise<'saved' | 'skipped'> {
  const { from, to } = source;
  if (!to || from.kind !== 'file') return 'skipped';
  const saved = await withLock(
    source.lock,
    async () => {
      const current = await loadSubject({ from }, options);
      if (current.status === 'invalid') return 'skipped' as const;
      const merged = mergeSubject(current.model, options.redactor.redactDeep(observation), {
        expireAfter: source.expireAfter,
      });
      const model = SubjectSchema.parse(options.redactor.redactDeep(merged));
      await writeFileAtomic(to, `${JSON.stringify(model, null, 2)}\n`);
      return 'saved' as const;
    },
    { waitMs: options.lockWaitMs },
  );
  if (saved === undefined)
    options.warn(
      `Another Covi run kept ${to} busy; this run's observations are only in ${DEMO_PATHS.subject}.`,
    );
  return saved ?? 'skipped';
}

/** Writes `demo/subject.json` (redacted, recorded), checked first like every artifact Covi reads back. */
export async function writeSubjectSnapshot(run: Run, snapshot: SubjectSnapshot): Promise<void> {
  const checked = SubjectSnapshotSchema.parse(run.redactor.redactDeep(snapshot));
  await run.writeJson(DEMO_PATHS.subject, checked, 'subject');
}

/** The run's snapshot, or undefined when the run has none (no demonstration, or `subject.store: off`). */
export async function loadSubjectSnapshot(run: Run): Promise<SubjectSnapshot | undefined> {
  if (!(await run.has(DEMO_PATHS.subject))) return undefined;
  return parseOrThrow(
    SubjectSnapshotSchema,
    await run.readJson(DEMO_PATHS.subject),
    DEMO_PATHS.subject,
    'Covi writes demo/subject.json; demonstrate again (`covi demo`) to rebuild it.',
  );
}
