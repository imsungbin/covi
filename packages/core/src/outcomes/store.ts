import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Git } from '../git/git.ts';
import { OUTCOME_LIMITS, type OutcomeFile, OutcomeFileSchema } from '../model/outcome.ts';
import { RUN_ID_PATTERN } from '../run/paths.ts';
import { ensureSelfIgnored } from '../run/run.ts';
import type { Redactor } from '../security/redact.ts';
import { EnvironmentError } from '../util/errors.ts';
import { writeFileAtomic } from '../util/fs.ts';

/**
 * Collected outcomes, relative to the repository root. Next to the runs (which are pruned), not
 * inside them; a cache of what the platform says, so the directory ignores itself.
 */
export const OUTCOMES_DIR = '.covi/outcomes';

export function outcomesDir(root: string): string {
  return join(root, OUTCOMES_DIR);
}

const changeKey = (o: Pick<OutcomeFile, 'change'>) =>
  `${o.change.platform}\u0000${o.change.repository}\u0000${o.change.number}`;

/**
 * The first of `.covi` and `.covi/outcomes` that is a symbolic link. A checkout can carry one, and
 * it would point reads and writes at files Covi never collected.
 */
async function linkOnTheWay(root: string): Promise<string | undefined> {
  for (const rel of ['.covi', OUTCOMES_DIR]) {
    const info = await lstat(join(root, rel)).catch(() => undefined);
    if (!info) return undefined;
    if (info.isSymbolicLink()) return rel;
  }
  return undefined;
}

/** Names of outcome files (`<run-id>.json`), newest first. */
async function outcomeNames(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.json') && RUN_ID_PATTERN.test(name.slice(0, -5)))
    .sort()
    .reverse();
}

interface Listed {
  file: string;
  outcome: OutcomeFile;
}

/**
 * Outcome files in a directory, newest name (run id) first, valid ones only. Names that are not
 * run ids are left out before the limit, so stray files cannot crowd real outcomes out.
 */
async function listOutcomes(
  dir: string,
  options: { limit?: number; warn?: (message: string) => void } = {},
): Promise<Listed[]> {
  const names = (await outcomeNames(dir)).slice(0, options.limit);
  const out: Listed[] = [];
  for (const file of names) {
    const path = join(dir, file);
    // lstat: a link is not a file Covi wrote, wherever it points.
    const info = await lstat(path).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (info.size > OUTCOME_LIMITS.fileBytes) {
      options.warn?.(
        `Skipped ${OUTCOMES_DIR}/${file}: larger than ${OUTCOME_LIMITS.fileBytes} bytes.`,
      );
      continue;
    }
    try {
      const parsed = OutcomeFileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (parsed.success) out.push({ file, outcome: parsed.data });
      else options.warn?.(`Skipped ${OUTCOMES_DIR}/${file}: it does not match the outcome schema.`);
    } catch {
      options.warn?.(`Skipped ${OUTCOMES_DIR}/${file}: it is not JSON.`);
    }
  }
  return out;
}

/**
 * Writes one change's outcome as `<run-id>.json`, redacted, and removes any older file for the
 * same change (the comment moves to a newer run with every push) and any file beyond the newest
 * `OUTCOME_LIMITS.files`.
 */
export async function writeOutcome(
  root: string,
  outcome: OutcomeFile,
  redactor: Redactor,
): Promise<string> {
  // Validated after redaction: the run id that names the file must still be a run id.
  const valid = OutcomeFileSchema.parse(redactor.redactDeep(outcome));
  const link = await linkOnTheWay(root);
  if (link)
    throw new EnvironmentError(
      `Refused to write an outcome: ${link} is a symbolic link.`,
      `Remove the link; Covi keeps outcomes in ${OUTCOMES_DIR} inside the repository.`,
    );
  const dir = outcomesDir(root);
  await ensureSelfIgnored(dir);
  const name = `${valid.runId}.json`;
  const path = join(dir, name);
  // Written before the older file goes, so a failed write loses nothing.
  await writeFileAtomic(path, `${JSON.stringify(valid, null, 2)}\n`);
  for (const other of await listOutcomes(dir))
    if (other.file !== name && changeKey(other.outcome) === changeKey(valid))
      await rm(join(dir, other.file), { force: true });
  // Reads take only the newest files; the rest would only grow the CI cache that carries them.
  for (const old of (await outcomeNames(dir)).slice(OUTCOME_LIMITS.files))
    await rm(join(dir, old), { force: true });
  return path;
}

/**
 * The newest outcome per change, newest first, at most `OUTCOME_LIMITS.files`. Outcome files
 * tracked by git are not read at all: outcomes are collected, never authored, and in CI the
 * checkout is the change under review.
 */
export async function readOutcomes(
  root: string,
  options: { git?: Git; warn?: (message: string) => void } = {},
): Promise<OutcomeFile[]> {
  const link = await linkOnTheWay(root);
  if (link) {
    options.warn?.(`Ignored ${OUTCOMES_DIR}: ${link} is a symbolic link.`);
    return [];
  }
  if (options.git) {
    // Any case (a case-insensitive file system reads .COVI/outcomes as ours), and inside a
    // submodule a change could put at .covi.
    const tracked = await options.git.tryOut([
      'ls-files',
      '--recurse-submodules',
      '--',
      `:(icase)${OUTCOMES_DIR}`,
    ]);
    // A failed check counts as tracked: without an answer, the files could be anyone's.
    if (tracked === undefined) {
      options.warn?.(`Ignored ${OUTCOMES_DIR}: Covi could not check whether git tracks it.`);
      return [];
    }
    if (tracked) {
      options.warn?.(
        `Ignored ${OUTCOMES_DIR}: it holds files committed to the repository, and outcomes are only collected (\`covi outcomes collect\`), never committed.`,
      );
      return [];
    }
  }
  const newest = new Map<string, OutcomeFile>();
  const listed = await listOutcomes(outcomesDir(root), {
    limit: OUTCOME_LIMITS.files,
    warn: options.warn,
  });
  for (const { outcome } of listed) {
    const key = changeKey(outcome);
    const seen = newest.get(key);
    if (!seen || seen.collectedAt < outcome.collectedAt) newest.set(key, outcome);
  }
  return [...newest.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

/**
 * Outcomes of one repository: the calibration must not mix in how findings held up elsewhere.
 * Names compare without case, as both platforms do; an unknown platform (outside CI) matches any.
 */
export function outcomesOfRepository(
  files: readonly OutcomeFile[],
  repository: { name: string; platform?: string },
): OutcomeFile[] {
  const name = repository.name.toLowerCase();
  return files.filter(
    (f) =>
      f.change.repository.toLowerCase() === name &&
      (!repository.platform || f.change.platform === repository.platform),
  );
}
