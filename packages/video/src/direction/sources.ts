import {
  type Demonstration,
  type DiffLine,
  type EvidenceIndex,
  evidenceId,
  type Hunk,
  parseDiff,
  renderHunk,
  sha256,
} from '@covi/core';

/*
 * What direction elements may show, looked up by the evidence id they cite. A shot's content
 * comes only from here: the run's diff, its demo commands and start-up logs, and its captures.
 */

export interface HunkSource {
  /** The changed file's path, and its language for highlighting. */
  path: string;
  language?: string;
  lines: readonly DiffLine[];
}

export interface CommandSource {
  name: string;
  /** Empty for the app's start-up log, which is output without a command. */
  command: string;
  /** The output after the change (head). */
  output: string;
  /** The output before it, when the command ran at base too. */
  before?: string;
}

export interface CaptureSource {
  /** Run-relative path of the image. */
  path: string;
  device: 'desktop' | 'mobile';
}

export interface DirectionSources {
  hunk(id: string): HunkSource | undefined;
  command(id: string): CommandSource | undefined;
  capture(id: string): CaptureSource | undefined;
}

export interface SourcesInput {
  /**
   * The run's diff with its hunks (`diffFiles`): what the evidence was built from. A hunk shows
   * only when its lines are the ones its evidence item hashed.
   */
  files?: ReadonlyArray<{ path: string; language?: string; hunks: readonly Hunk[] }>;
  demo?: Pick<Demonstration, 'commands' | 'shots'>;
  evidence?: EvidenceIndex;
  /** The app's start-up logs (`demo/app-<revision>.log`), when the run has them. */
  appLogs?: Partial<Record<'base' | 'head', string>>;
  /** The redaction the registry's ids went through, so a hunk's id is computed as it wrote it. */
  redact?: (text: string) => string;
}

/**
 * The run's `diff.patch` (`RUN_PATHS.diff`) as `files`, each file with the language the change
 * gives it. The patch, not the change: a change resolved again from git can differ from what the
 * evidence was built from (a working tree edited since), and it is not redacted.
 */
export function diffFiles(
  patch: string,
  change: ReadonlyArray<{ path: string; language?: string }>,
): Array<{ path: string; language?: string; hunks: Hunk[] }> {
  const languages = new Map(change.map((f) => [f.path, f.language]));
  return parseDiff(patch).map((file) => {
    const language = languages.get(file.path);
    return { path: file.path, ...(language ? { language } : {}), hunks: file.hunks };
  });
}

export type CodeSide = 'head' | 'base' | 'diff';

/**
 * A hunk's lines as one side shows them: head (context and added), base (context and deleted), or
 * diff (all).
 */
export function hunkView(lines: readonly DiffLine[], side: CodeSide): DiffLine[] {
  if (side === 'diff') return [...lines];
  const changed = side === 'head' ? 'add' : 'del';
  return lines.filter((l) => l.kind === 'context' || l.kind === changed);
}

export function directionSources(input: SourcesInput): DirectionSources {
  const redact = input.redact ?? ((text: string) => text);
  // Keyed by id and digest as the registry records them (it hashes a hunk as `diffHunkEvidence`
  // does), so lines that differ from the evidenced hunk are never shown under its id.
  const key = (id: string, digest: string) => `${id}\n${digest}`;
  const hunks = new Map<string, HunkSource>();
  for (const file of input.files ?? [])
    for (const hunk of file.hunks) {
      const at = key(redact(evidenceId.hunk(file.path, hunk.newStart)), sha256(renderHunk(hunk)));
      if (!hunks.has(at))
        hunks.set(at, {
          path: file.path,
          ...(file.language ? { language: file.language } : {}),
          lines: hunk.lines,
        });
    }
  const item = (id: string) => input.evidence?.find(id);
  return {
    hunk(id) {
      const found = item(id);
      return found?.kind === 'diff-hunk' ? hunks.get(key(found.id, found.sha256)) : undefined;
    },
    command(id) {
      const found = item(id);
      if (found?.kind !== 'terminal') return undefined;
      const start = /^terminal:app-start-(base|head)$/.exec(found.id);
      if (start) {
        const log = input.appLogs?.[start[1] as 'base' | 'head'];
        return log === undefined ? undefined : { name: found.label, command: '', output: log };
      }
      const n = /^terminal:(\d+)$/.exec(found.id);
      const c = n ? input.demo?.commands[Number(n[1]) - 1] : undefined;
      if (!c) return undefined;
      return {
        name: c.name,
        command: c.command,
        output: c.after.output,
        ...(c.before ? { before: c.before.output } : {}),
      };
    },
    capture(id) {
      const found = item(id);
      if (found?.kind !== 'screenshot') return undefined;
      const shot = input.demo?.shots.find(
        (s) => s.before?.path === found.path || s.after?.path === found.path,
      );
      return { path: found.path, device: shot?.viewport === 'mobile' ? 'mobile' : 'desktop' };
    },
  };
}
