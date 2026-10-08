import type { Stats } from 'node:fs';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { z } from 'zod';
import type { CoviConfig } from '../config/schema.ts';
import { Git } from '../git/git.ts';
import {
  SUBJECT_CONTROL,
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
import { ensureDir, isWithin, linkedOrOutside, writeFileAtomic } from '../util/fs.ts';
import { parseOrThrow } from '../util/zod.ts';
import { emptySubject, mergeSubject } from './merge.ts';

export interface SubjectSource {
  store: 'repo' | 'runs';
  /**
   * Where the model is read from: a file under `base` (no symbolic link may sit between them), or
   * (in CI) the repository file at the base revision. A file with `checkout` is refused when git
   * tracks it there: in CI that copy came with the change.
   */
  from:
    | { kind: 'file'; path: string; base: string; checkout?: string }
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
 * the change, so `runs` reads and writes it everywhere, except a file there that the change
 * committed (the runs directory is inside the checkout by default).
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
      from: {
        kind: 'file',
        path,
        // Checked from the repository root when the runs directory is inside it: the repository
        // could commit `.covi/runs` itself as a link.
        base: isWithin(options.root, options.runsRoot) ? options.root : options.runsRoot,
        ...(options.baseRevision ? { checkout: options.root } : {}),
      },
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
async function readStoreFile(from: {
  path: string;
  base: string;
  checkout?: string;
}): Promise<Read> {
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
  const escapes = from.checkout ? await linkedOrOutside(from.checkout, from.path) : undefined;
  if (escapes) return { refused: escapes };
  if (from.checkout && (await tracked(from.checkout, from.path)))
    return { refused: 'is committed to the repository, so the change could have written it' };
  try {
    return { text: await readFile(from.path, 'utf8') };
  } catch (error) {
    return unreadable(error);
  }
}

/** Whether git tracks `path` in `checkout`; when that cannot be told, it is taken as tracked. */
async function tracked(checkout: string, path: string): Promise<boolean> {
  const real = await Promise.all([realpath(checkout), realpath(path)]).catch(() => undefined);
  if (!real) return true;
  const inside = relative(real[0], real[1]);
  if (inside.startsWith('..') || isAbsolute(inside)) return false;
  const literal = `:(literal)${inside.split(sep).join('/')}`;
  const result = await new Git(checkout).run(['ls-files', '--error-unmatch', '--', literal]);
  return result.exitCode === 0;
}

/**
 * The repository file at a revision, held to the same rules as the file: it must be a regular
 * blob (not a link, a directory, or a submodule), and its size is asked first, so a huge blob is
 * never read.
 */
async function readAtRevision(
  from: { revision: string; path: string },
  git: Git | undefined,
): Promise<Read> {
  const listing = await git?.tryOut([
    'ls-tree',
    '-l',
    '--full-tree',
    '--end-of-options',
    from.revision,
    '--',
    from.path,
  ]);
  const entry = listing
    ?.split('\n')
    .map((line) => /^(\d{6}) (\w+) ([0-9a-f]+) +(\S+)\t(.*)$/.exec(line))
    .find((match) => match?.[5] === from.path);
  if (!git || !entry) return { missing: true };
  const [, mode, type, object, size] = entry;
  if (mode === '120000') return { refused: 'is reached through a symbolic link' };
  if (type !== 'blob') return { refused: 'is not a file' };
  if (Number(size) > SUBJECT_LIMITS.bytes) return { refused: 'is larger than 512 KB' };
  const result = await git.run(['cat-file', 'blob', object!]);
  return result.exitCode === 0 ? { text: result.stdout } : { missing: true };
}

const UNPRINTABLE = new RegExp(SUBJECT_CONTROL.source, 'g');

/** Text from the file, safe to print: no control or bidi characters, and short. */
function printable(text: string, max: number): string {
  const clean = text.replace(UNPRINTABLE, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The first schema issue, without echoing the file: its keys are stripped and cut short. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid';
  const path = issue.path.length
    ? issue.path.map((part) => printable(String(part), 40)).join('.')
    : '(root)';
  const message =
    issue.code === 'unrecognized_keys'
      ? `unknown key(s): ${issue.keys
          .slice(0, 3)
          .map((key) => printable(key, 40))
          .join(', ')}`
      : issue.message;
  return printable(`${path}: ${message}`, 200);
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
  const setAside = (why: string, fix = 'Fix or delete the file.') => {
    options.warn(
      `${labelOf(from)} ${why}; Covi planned without it and will not overwrite it. ${fix}`,
    );
    return { model: emptySubject(), status: 'invalid' as const };
  };
  if ('missing' in read) return { model: emptySubject(), status: 'empty' };
  if ('refused' in read) return setAside(read.refused);
  // Two branches that each changed the committed model conflict; either side is a whole model.
  if (/^(<{7}|>{7}) /m.test(read.text))
    return setAside(
      'has merge conflict markers',
      'Take either side, or delete the file: Covi rebuilds it.',
    );
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return setAside('is not valid JSON');
  }
  const parsed = SubjectSchema.safeParse(raw);
  if (!parsed.success)
    return setAside(`is not a subject model Covi can read (${firstIssue(parsed.error)})`);
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

/**
 * Runs `fn` while holding `lock` (a file created exclusively); undefined when it stayed busy, or
 * when something other than a file sits at the lock's path.
 */
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
      // Covi only makes plain files; anything else was put there, and is never removed.
      if (info && !info.isFile()) return undefined;
      if (info && Date.now() - info.mtimeMs > staleMs) {
        try {
          await rm(lock, { force: true });
          continue;
        } catch {
          return undefined;
        }
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
  // The lock is created before the store is read again, so its place is checked first.
  const misplaced = await linkedOrOutside(from.base, source.lock);
  if (misplaced) {
    options.warn(
      `${source.lock} ${misplaced}; this run's observations are only in ${DEMO_PATHS.subject}.`,
    );
    return 'skipped';
  }
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
  if (saved === undefined) {
    const planted = await lstat(source.lock).then(
      (info) => !info.isFile(),
      () => false,
    );
    options.warn(
      planted
        ? `${source.lock} is not a lock file Covi made; this run's observations are only in ${DEMO_PATHS.subject}. Delete it.`
        : `Another Covi run kept ${to} busy; this run's observations are only in ${DEMO_PATHS.subject}.`,
    );
  }
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
