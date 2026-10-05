/**
 * The platform-independent model of a code change. GitHub pull requests, GitLab merge requests,
 * local branches, and uncommitted work all resolve to a CodeChange; nothing below this layer
 * knows which hosting platform (if any) the change came from.
 */

export interface Repository {
  /** Absolute path of the working tree root. */
  root: string;
  /** Human-friendly name: `owner/repo` when a remote is known, otherwise the directory name. */
  name: string;
  /** Remote URL with any embedded credentials removed. */
  remote?: string;
  /** Current branch of the working tree, if attached. */
  branch?: string;
}

export interface Revision {
  /** What the user or platform asked for (`main`, `HEAD`, `origin/main`, a SHA, or `WORKTREE`). */
  ref: string;
  /** Resolved commit SHA. For uncommitted changes the head SHA is the commit they sit on. */
  sha: string;
}

/** The revision a change is compared against (the merge base for branch and pull request reviews). */
export type BaseRevision = Revision;

/** The revision under review. For uncommitted work, its SHA is the commit the work sits on. */
export type HeadRevision = Revision;

export type ChangeSource =
  | { kind: 'range'; spec: string }
  | { kind: 'branch'; base: string }
  | { kind: 'uncommitted' }
  | { kind: 'staged' }
  | { kind: 'pull-request'; platform: string; number: number; url?: string }
  | { kind: 'merge-request'; platform: string; number: number; url?: string };

export interface Commit {
  sha: string;
  subject: string;
  body: string;
  /** Author display name only; e-mail addresses are never recorded. */
  author: string;
  date: string;
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed';

export interface DiffLine {
  kind: 'add' | 'del' | 'context';
  text: string;
  oldLine?: number;
  newLine?: number;
  /** The line has no trailing newline in its file. */
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Enclosing function/section name that git prints after the @@ markers. */
  section?: string;
  lines: DiffLine[];
}

export type FileCategory =
  | 'source'
  | 'test'
  | 'style'
  | 'markup'
  | 'config'
  | 'docs'
  | 'asset'
  | 'manifest'
  | 'lockfile'
  | 'migration'
  | 'schema'
  | 'ci'
  | 'build'
  | 'infra'
  | 'generated'
  | 'vendored'
  | 'other';

export type Surface =
  | 'ui'
  | 'api'
  | 'cli'
  | 'data'
  | 'state'
  | 'config'
  | 'dependency'
  | 'ci'
  | 'security'
  | 'docs'
  | 'test'
  | 'build';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  language?: string;
  category: FileCategory;
  surfaces: Surface[];
  /** Excluded from analysis by configuration or built-in rules (still counted in stats). */
  ignored: boolean;
  ignoreReason?: string;
}

export interface ChangeMetadata {
  title?: string;
  description?: string;
  url?: string;
  number?: number;
  platform?: string;
  /** The change comes from a fork (untrusted contributor context on hosted platforms). */
  fromFork?: boolean;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface CodeChange {
  /** Stable identifier derived from repository, base, head, and source. */
  id: string;
  repository: Repository;
  base: BaseRevision;
  head: HeadRevision;
  mergeBase?: string;
  source: ChangeSource;
  metadata: ChangeMetadata;
  commits: Commit[];
  files: ChangedFile[];
  /** The change includes uncommitted (staged, unstaged, or untracked) work. */
  includesUncommitted: boolean;
  stats: ChangeStats;
}

export interface ChangeStats {
  files: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  ignoredFiles: number;
}

export function computeStats(files: readonly ChangedFile[]): ChangeStats {
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  let ignoredFiles = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
    if (f.binary) binaryFiles++;
    if (f.ignored) ignoredFiles++;
  }
  return { files: files.length, additions, deletions, binaryFiles, ignoredFiles };
}

/** Files that analysis and reviewers should actually look at. */
export function reviewableFiles(change: Pick<CodeChange, 'files'>): ChangedFile[] {
  return change.files.filter((f) => !f.ignored);
}

export function addedLines(file: ChangedFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'add'));
}

export function removedLines(file: ChangedFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === 'del'));
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
