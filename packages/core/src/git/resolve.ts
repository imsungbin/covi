import { readFile, stat } from 'node:fs/promises';
import { basename, join, resolve as resolvePath } from 'node:path';
import {
  type ChangedFile,
  type ChangeMetadata,
  type ChangeSource,
  type CodeChange,
  type Commit,
  computeStats,
  type Revision,
} from '../model/change.ts';
import { classifyFile, ignoreReason, looksGenerated } from '../understand/classify.ts';
import { EnvironmentError, UsageError } from '../util/errors.ts';
import { shortHash } from '../util/hash.ts';
import { type Logger, silentLogger } from '../util/log.ts';
import { type ParsedFile, parseDiff } from './diff-parser.ts';
import { EMPTY_TREE, Git, GitError, repoNameFromRemote, sanitizeRemote } from './git.ts';

export type ChangeScope = 'auto' | 'committed' | 'uncommitted' | 'staged';

export interface ResolveOptions {
  /** Any path inside the repository. */
  repo: string;
  /** Positional range: `main`, `A..B`, `A...B`, or `<sha>^!`. */
  range?: string;
  base?: string;
  head?: string;
  scope?: ChangeScope;
  /** Base branch from configuration, used when nothing else names one. */
  defaultBase?: string;
  metadata?: ChangeMetadata;
  source?: ChangeSource;
  /** Allow fetching missing commits (CI checkouts are often shallow). */
  fetch?: boolean;
  ignore?: readonly string[];
  logger?: Logger;
}

export class NoChangesError extends UsageError {
  constructor(message: string) {
    super(message, 'Pass a range (e.g. `covi review main`) or --base <ref>.');
    this.name = 'NoChangesError';
  }
}

interface Plan {
  base: Revision;
  head: Revision;
  mergeBase?: string;
  /** Compare against the working tree (tracked changes + untracked files). */
  worktree: boolean;
  staged: boolean;
  source: ChangeSource;
  /** Commit range used for `git log`, if any. */
  logRange?: { from: string; to: string };
}

const MAX_UNTRACKED_BYTES = 512 * 1024;
const MAX_UNTRACKED_FILES = 200;

export async function resolveChange(options: ResolveOptions): Promise<CodeChange> {
  const logger = options.logger ?? silentLogger;
  const repoPath = resolvePath(options.repo);
  const probe = new Git(repoPath);
  const root = await probe.tryOut(['rev-parse', '--show-toplevel']).catch(() => undefined);
  if (!root) {
    throw new EnvironmentError(
      `Not a git repository: ${repoPath}`,
      'Run Covi inside a git repository or pass --repo <path>.',
    );
  }
  const git = new Git(root);
  const plan = await planChange(git, options, logger);

  const diffArgs = [
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--find-renames',
    '--unified=3',
    '--src-prefix=a/',
    '--dst-prefix=b/',
  ];
  let diffText: string;
  if (plan.staged) diffText = await git.out([...diffArgs, '--cached', plan.base.sha]);
  else if (plan.worktree) diffText = await git.out([...diffArgs, plan.base.sha]);
  else diffText = await git.out([...diffArgs, plan.base.sha, plan.head.sha]);

  const parsed = parseDiff(diffText);
  if (plan.worktree) parsed.push(...(await untrackedFiles(git, root, logger)));

  const ignore = options.ignore ?? [];
  const files: ChangedFile[] = parsed.map((p) => toChangedFile(p, ignore));

  const commits = plan.logRange ? await readCommits(git, plan.logRange.from, plan.logRange.to) : [];
  const remote = await git.tryOut(['config', '--get', 'remote.origin.url']);
  const branch = await git.tryOut(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const name = (remote && repoNameFromRemote(remote)) || basename(root);

  const metadata: ChangeMetadata = { ...options.metadata };
  if (!metadata.title && commits.length === 1) metadata.title = commits[0]!.subject;
  if (!metadata.sourceBranch && branch && !plan.staged) metadata.sourceBranch = branch;

  const includesUncommitted = plan.worktree || plan.staged;
  const id = shortHash(
    root,
    plan.base.sha,
    plan.head.sha,
    plan.source.kind,
    includesUncommitted ? shortHash(diffText) : '',
  );

  return {
    id,
    repository: { root, name, remote: remote ? sanitizeRemote(remote) : undefined, branch },
    base: plan.base,
    head: plan.head,
    mergeBase: plan.mergeBase,
    source: options.source ?? plan.source,
    metadata,
    commits,
    files,
    includesUncommitted,
    stats: computeStats(files),
  };
}

async function planChange(git: Git, options: ResolveOptions, logger: Logger): Promise<Plan> {
  const scope = options.scope ?? 'auto';
  const headRef = options.head ?? 'HEAD';
  const headImplicit = options.head === undefined;
  const headCommit = await git.revParse('HEAD');

  if (options.range && (options.base || options.head)) {
    throw new UsageError('Pass either a range or --base/--head, not both.');
  }
  for (const ref of [options.range, options.base, options.head, options.defaultBase]) {
    if (ref?.trim().startsWith('-')) throw new UsageError(`Invalid revision: ${ref}`);
  }

  if (scope === 'staged' || scope === 'uncommitted') {
    if (options.range || options.base) {
      throw new UsageError(
        `--${scope} compares against HEAD; it cannot be combined with a range or --base.`,
      );
    }
    const sha = headCommit ?? EMPTY_TREE;
    return {
      base: { ref: headCommit ? 'HEAD' : 'empty', sha },
      head: { ref: scope === 'staged' ? 'INDEX' : 'WORKTREE', sha },
      worktree: scope === 'uncommitted',
      staged: scope === 'staged',
      source: { kind: scope },
    };
  }

  const dirty = await isDirty(git);
  const includeWorktree = (implicitHead: boolean) =>
    scope !== 'committed' && implicitHead && dirty && headCommit !== undefined;

  if (options.range) {
    const range = options.range.trim();
    const three = /^(.*?)\.\.\.(.*)$/.exec(range);
    const two = three ? undefined : /^(.*?)\.\.(.*)$/.exec(range);
    if (three || two) {
      const m = (three ?? two)!;
      const fromRef = m[1] || 'HEAD';
      const toRef = m[2] || 'HEAD';
      const from = await requireCommit(git, fromRef, options.fetch, logger);
      const to = await requireCommit(git, toRef, options.fetch, logger);
      let baseSha = from;
      let mergeBase: string | undefined;
      if (three) {
        mergeBase = await findMergeBase(git, from, to, options.fetch, logger);
        baseSha = mergeBase;
      }
      return {
        base: { ref: fromRef, sha: baseSha },
        head: { ref: toRef, sha: to },
        mergeBase,
        worktree: false,
        staged: false,
        source: { kind: 'range', spec: range },
        logRange: { from: baseSha, to },
      };
    }
    if (range.endsWith('^!')) {
      const ref = range.slice(0, -2);
      const sha = await requireCommit(git, ref, options.fetch, logger);
      const parent = (await git.revParse(`${sha}^`)) ?? EMPTY_TREE;
      return {
        base: { ref: `${ref}^`, sha: parent },
        head: { ref, sha },
        worktree: false,
        staged: false,
        source: { kind: 'range', spec: range },
        logRange: { from: parent, to: sha },
      };
    }
    // A single ref names the base: review everything on HEAD since it diverged.
    return planAgainstBase(
      git,
      range,
      headRef,
      includeWorktree(headImplicit),
      { kind: 'branch', base: range },
      options,
      logger,
    );
  }

  if (options.base) {
    return planAgainstBase(
      git,
      options.base,
      headRef,
      includeWorktree(headImplicit),
      { kind: 'branch', base: options.base },
      options,
      logger,
    );
  }

  if (!headImplicit) {
    throw new UsageError(
      '--head needs a base: pass --base <ref> or a range such as main...feature.',
    );
  }
  if (!headCommit) {
    if (dirty) {
      return {
        base: { ref: 'empty', sha: EMPTY_TREE },
        head: { ref: 'WORKTREE', sha: EMPTY_TREE },
        worktree: true,
        staged: false,
        source: { kind: 'uncommitted' },
      };
    }
    throw new NoChangesError('This repository has no commits and no changes yet.');
  }

  const baseBranch = await detectBaseBranch(git, options.defaultBase);
  if (baseBranch) {
    const mergeBase = await git.mergeBase(baseBranch, headCommit);
    if (mergeBase && mergeBase !== headCommit) {
      return planAgainstBase(
        git,
        baseBranch,
        'HEAD',
        includeWorktree(true),
        { kind: 'branch', base: baseBranch },
        options,
        logger,
      );
    }
  }
  if (dirty && scope !== 'committed') {
    return {
      base: { ref: 'HEAD', sha: headCommit },
      head: { ref: 'WORKTREE', sha: headCommit },
      worktree: true,
      staged: false,
      source: { kind: 'uncommitted' },
    };
  }
  throw new NoChangesError(
    baseBranch
      ? `No changes: HEAD has no commits beyond ${baseBranch} and the working tree is clean.`
      : 'No changes found and no base branch could be detected.',
  );
}

async function planAgainstBase(
  git: Git,
  baseRef: string,
  headRef: string,
  worktree: boolean,
  source: ChangeSource,
  options: ResolveOptions,
  logger: Logger,
): Promise<Plan> {
  const head = await requireCommit(git, headRef, options.fetch, logger);
  const base = await requireCommit(git, baseRef, options.fetch, logger);
  const mergeBase = await findMergeBase(git, base, head, options.fetch, logger);
  return {
    base: { ref: baseRef, sha: mergeBase },
    head: { ref: worktree ? 'WORKTREE' : headRef, sha: head },
    mergeBase,
    worktree,
    staged: false,
    source,
    logRange: { from: mergeBase, to: head },
  };
}

async function requireCommit(
  git: Git,
  ref: string,
  fetch: boolean | undefined,
  logger: Logger,
): Promise<string> {
  const sha = await git.revParse(ref);
  if (sha) return sha;
  if (fetch && /^[0-9a-f]{7,40}$/i.test(ref)) {
    logger.debug(`Fetching missing commit ${ref}`);
    await git.run(['fetch', '--no-tags', '--depth=50', 'origin', ref]);
    const fetched = await git.revParse(ref);
    if (fetched) return fetched;
  }
  if (fetch && !ref.includes(' ')) {
    const branch = ref.replace(/^origin\//, '');
    await git.run([
      'fetch',
      '--no-tags',
      '--depth=50',
      'origin',
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
    const fetched = await git.revParse(ref.startsWith('origin/') ? ref : `origin/${branch}`);
    if (fetched) return fetched;
  }
  throw new UsageError(
    `Unknown revision: ${ref}`,
    'Check the ref name, or fetch it first (git fetch origin <ref>).',
  );
}

/** Finds the merge base, deepening shallow clones when needed. */
async function findMergeBase(
  git: Git,
  a: string,
  b: string,
  fetch: boolean | undefined,
  logger: Logger,
): Promise<string> {
  const direct = await git.mergeBase(a, b);
  if (direct) return direct;
  if (fetch && (await git.isShallow())) {
    for (const depth of [100, 400, 1600]) {
      logger.debug(`Deepening shallow clone by ${depth} to find the merge base`);
      await git.run(['fetch', '--no-tags', `--deepen=${depth}`, 'origin']);
      const found = await git.mergeBase(a, b);
      if (found) return found;
    }
    await git.run(['fetch', '--no-tags', '--unshallow', 'origin']);
    const found = await git.mergeBase(a, b);
    if (found) return found;
  }
  throw new EnvironmentError(
    `No common ancestor between ${a.slice(0, 7)} and ${b.slice(0, 7)}.`,
    'If this is a shallow clone, fetch more history (actions/checkout: fetch-depth: 0) or let Covi fetch (--fetch).',
  );
}

export async function detectBaseBranch(git: Git, configured?: string): Promise<string | undefined> {
  const candidates: string[] = [];
  if (configured) candidates.push(`origin/${configured.replace(/^origin\//, '')}`, configured);
  const originHead = await git.tryOut([
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (originHead) candidates.push(originHead);
  candidates.push(
    'origin/main',
    'origin/master',
    'main',
    'master',
    'origin/trunk',
    'trunk',
    'origin/develop',
    'develop',
  );
  for (const candidate of candidates) {
    if (await git.revParse(candidate)) return candidate;
  }
  return undefined;
}

/** Paths Covi itself writes; they never make a tree dirty or join a change. */
const COVI_OWNED = [':(exclude).covi/runs', ':(exclude).covi/cache', ':(exclude).covi/.gitignore'];

async function isDirty(git: Git): Promise<boolean> {
  const status = await git.tryOut([
    'status',
    '--porcelain',
    '--untracked-files=normal',
    '--',
    '.',
    ...COVI_OWNED,
  ]);
  return Boolean(status && status.length > 0);
}

async function untrackedFiles(git: Git, root: string, logger: Logger): Promise<ParsedFile[]> {
  const listing = await git.out([
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    '.',
    ...COVI_OWNED,
  ]);
  const paths = listing.split('\0').filter(Boolean);
  if (paths.length > MAX_UNTRACKED_FILES) {
    logger.warn(
      `Only the first ${MAX_UNTRACKED_FILES} of ${paths.length} untracked files are included.`,
    );
  }
  const out: ParsedFile[] = [];
  for (const path of paths.slice(0, MAX_UNTRACKED_FILES)) {
    const full = join(root, path);
    const info = await stat(full).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (info.size > MAX_UNTRACKED_BYTES) {
      out.push({ path, status: 'added', binary: true, additions: 0, deletions: 0, hunks: [] });
      continue;
    }
    const content = await readFile(full);
    if (content.includes(0)) {
      out.push({ path, status: 'added', binary: true, additions: 0, deletions: 0, hunks: [] });
      continue;
    }
    const text = content.toString('utf8');
    const lines = text.split('\n');
    const noNewline = !text.endsWith('\n');
    if (!noNewline) lines.pop();
    const hunkLines = lines.map((t, i) => ({
      kind: 'add' as const,
      text: t.endsWith('\r') ? t.slice(0, -1) : t,
      newLine: i + 1,
    }));
    if (noNewline && hunkLines.length) Object.assign(hunkLines.at(-1)!, { noNewline: true });
    out.push({
      path,
      status: 'added',
      binary: false,
      additions: hunkLines.length,
      deletions: 0,
      newMode: (info.mode & 0o111) !== 0 ? '100755' : '100644',
      hunks: hunkLines.length
        ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: hunkLines.length, lines: hunkLines }]
        : [],
    });
  }
  return out;
}

function toChangedFile(p: ParsedFile, ignore: readonly string[]): ChangedFile {
  const classification = classifyFile(p.path);
  let reason = ignoreReason(p.path, ignore);
  if (!reason && p.status === 'added') {
    const first = p.hunks[0]?.lines.slice(0, 5).map((l) => l.text) ?? [];
    if (looksGenerated(first)) reason = 'generated';
  }
  const category =
    reason === 'generated'
      ? 'generated'
      : reason === 'vendored'
        ? 'vendored'
        : classification.category;
  return {
    ...p,
    language: classification.language,
    category,
    surfaces: reason === 'generated' || reason === 'vendored' ? [] : classification.surfaces,
    ignored: reason !== undefined,
    ignoreReason: reason,
  };
}

async function readCommits(git: Git, from: string, to: string): Promise<Commit[]> {
  if (from === to) return [];
  const format = '%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e';
  // From the empty tree (a root commit) every commit reachable from `to` is part of the change.
  const range = from === EMPTY_TREE ? ['--max-count=200', to] : [`${from}..${to}`];
  let out: string;
  try {
    out = await git.out(['log', '--no-merges', `--format=${format}`, ...range]);
  } catch (error) {
    if (error instanceof GitError) return [];
    throw error;
  }
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha = '', author = '', date = '', subject = '', body = ''] = record.split('\x1f');
      return { sha, author, date, subject: subject.trim(), body: body.trim() };
    })
    .reverse();
}
