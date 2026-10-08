import { parseDiff } from '../git/diff-parser.ts';
import type { BehaviorDiff, Trace } from '../model/behavior.ts';
import type { Demonstration } from '../model/demo.ts';
import { type EvidenceFile, EvidenceFileSchema } from '../model/evidence.ts';
import { DEMO_PATHS, RUN_PATHS } from '../run/paths.ts';
import type { Run } from '../run/run.ts';
import { exists, readJson } from '../util/fs.ts';
import { sha256File } from '../util/hash.ts';
import { parseOrThrow } from '../util/zod.ts';
import { buildEvidence, evidenceFiles } from './build.ts';

/** A run file's full path, or undefined when the path would leave the run (a hostile capture). */
function inside(run: Run, rel: string): string | undefined {
  try {
    return run.path(rel);
  } catch {
    return undefined;
  }
}

async function readIf<T>(run: Run, rel: string): Promise<T | undefined> {
  return (await run.has(rel)) ? run.readJson<T>(rel) : undefined;
}

/**
 * The run's evidence, built from the files its stages wrote: the diff, the captures, the traces
 * they name, the behavior diff, start-up logs, and test output. Only files inside the run are read.
 * Redacted as writing it would redact it, so a rebuilt registry is the one Covi would write.
 */
export async function collectEvidence(run: Run): Promise<EvidenceFile> {
  const diff = (await run.has(RUN_PATHS.diff))
    ? parseDiff(await run.readText(RUN_PATHS.diff))
    : undefined;
  // Request and command digests hash the captures as Covi writes them, so they agree whether the
  // registry is written or rebuilt, even from a captures.json that was not redacted.
  const captured = await readIf<Demonstration>(run, DEMO_PATHS.captures);
  const demo = captured && run.redactor.redactDeep(captured);
  const behavior = await readIf<BehaviorDiff>(run, DEMO_PATHS.behaviorDiff);
  const traces: Trace[] = [];
  for (const ref of demo?.traces ?? []) {
    const full = inside(run, ref.path);
    if (full && (await exists(full))) traces.push(await readJson<Trace>(full));
  }
  const tests = (await run.has(RUN_PATHS.testsLog))
    ? { command: (await run.readText(RUN_PATHS.testsLog)).split('\n')[0]!.replace(/^\$ /, '') }
    : undefined;
  // Hash only what exists inside the run; a hash recorded in run.json saves reading a recording.
  const recorded = new Map(run.manifest.artifacts.map((a) => [a.path, a.sha256]));
  const hashes = new Map<string, string>();
  for (const rel of evidenceFiles({ demo, behavior })) {
    const full = inside(run, rel);
    if (!full || hashes.has(rel) || !(await exists(full))) continue;
    hashes.set(rel, recorded.get(rel) ?? (await sha256File(full)));
  }
  return buildEvidence({
    diff,
    demo,
    traces,
    behavior,
    tests,
    fileSha: (p) => hashes.get(p),
    redact: (text) => run.redactor.redact(text),
  });
}

/**
 * Writes `evidence.json` (recorded like every artifact) and returns what it wrote. It is checked
 * against the schema first: Covi never writes a registry its own loader would reject.
 */
export async function writeEvidence(run: Run): Promise<EvidenceFile> {
  const evidence = EvidenceFileSchema.parse(await collectEvidence(run));
  await run.writeJson(RUN_PATHS.evidence, evidence, 'evidence');
  return evidence;
}

/**
 * The run's evidence: `evidence.json` when present (validated), else rebuilt from the run's files
 * without writing anything (runs made before Covi kept a registry).
 */
export async function loadEvidence(
  run: Run,
): Promise<{ evidence: EvidenceFile; source: 'file' | 'rebuilt' }> {
  if (await run.has(RUN_PATHS.evidence))
    return {
      evidence: parseOrThrow(
        EvidenceFileSchema,
        await run.readJson(RUN_PATHS.evidence),
        'evidence.json',
        'Covi writes evidence.json; delete it and run `covi report` to rebuild it.',
      ),
      source: 'file',
    };
  return { evidence: await collectEvidence(run), source: 'rebuilt' };
}
