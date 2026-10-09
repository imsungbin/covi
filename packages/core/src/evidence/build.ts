import type { BehaviorDiff, Trace } from '../model/behavior.ts';
import type { Hunk } from '../model/change.ts';
import type { Demonstration } from '../model/demo.ts';
import {
  EVIDENCE_ID,
  EVIDENCE_LIMITS,
  type EvidenceFile,
  type EvidenceItem,
  EvidenceItemSchema,
} from '../model/evidence.ts';
import { renderHunk } from '../report/digest.ts';
import { DEMO_PATHS, demoPath, RUN_PATHS } from '../run/paths.ts';
import { sha256 } from '../util/hash.ts';
import { truncate } from '../util/text.ts';
import { evidenceId, evidencePart } from './ids.ts';

export interface EvidenceSources {
  /** The change's files with their hunks: parsed from `diff.patch`, or the resolved change. */
  diff?: ReadonlyArray<{ path: string; hunks: readonly Hunk[] }>;
  demo?: Demonstration;
  /** The traces `demo.traces` names, as read from the run. */
  traces?: readonly Trace[];
  behavior?: BehaviorDiff;
  /** The test command, when `tests.log` holds its output. */
  tests?: { command: string };
  /** A run file's sha256; undefined when the file is missing, which leaves its item out. */
  fileSha?: (path: string) => string | undefined;
  /**
   * The run's redaction, applied to every string of every item (ids and paths too) before it is
   * checked, as writing the file would apply it: the id Covi writes is then the one it checks.
   */
  redact?: (text: string) => string;
}

const label = (text: string) => truncate(text, EVIDENCE_LIMITS.label);
const scene = (name: string, viewport: string, revision: string) =>
  `${name} (${viewport}) · ${revision}`;
/** What the registry's own schema accepts as an id, so Covi never writes a file it would reject. */
const citable = (id: string) => id.length <= EVIDENCE_LIMITS.id && EVIDENCE_ID.test(id);

/**
 * The digest the registry records for a hunk, so whoever shows a hunk under its id can check that
 * its lines are the ones the evidence names.
 */
export function hunkDigest(hunk: Hunk): string {
  return sha256(renderHunk(hunk));
}

/**
 * One item per hunk, located on its head lines, or its base lines when it only deletes. A hunk
 * whose id would be too long to cite (a path of hundreds of characters) is left out.
 */
export function diffHunkEvidence(
  files: ReadonlyArray<{ path: string; hunks: readonly Hunk[] }>,
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const file of files)
    for (const hunk of file.hunks) {
      if (!hunk.newLines && !hunk.oldLines) continue;
      const id = evidenceId.hunk(file.path, hunk.newStart);
      if (!citable(id)) continue;
      const head = hunk.newLines > 0;
      const line = head ? hunk.newStart : hunk.oldStart;
      const endLine = line + (head ? hunk.newLines : hunk.oldLines) - 1;
      const lines = line === endLine ? `${line}` : `${line}-${endLine}`;
      items.push({
        id,
        kind: 'diff-hunk',
        path: RUN_PATHS.diff,
        revision: 'both',
        sha256: hunkDigest(hunk),
        label: label(`${file.path}:${lines}${head ? '' : ' (base)'}`),
        location: { path: file.path, line, endLine, side: head ? 'head' : 'base' },
      });
    }
  return items;
}

/** Every run file `buildEvidence` may list, in its order, so a caller can hash them first. */
export function evidenceFiles(sources: Pick<EvidenceSources, 'demo' | 'behavior'>): string[] {
  const { demo, behavior } = sources;
  return [
    ...(demo?.shots ?? []).flatMap((s) =>
      [s.before?.path, s.after?.path].filter((p): p is string => p !== undefined),
    ),
    ...(behavior?.scenarios ?? []).flatMap((s) =>
      s.steps.flatMap((step) => (step.diff ? [step.diff] : [])),
    ),
    ...(demo?.recordings ?? []).map((r) => r.path),
    ...(demo?.traces ?? []).map((t) => t.path),
    demoPath.appLog('base'),
    demoPath.appLog('head'),
    RUN_PATHS.testsLog,
  ];
}

function redactStrings<T>(value: T, redact: (text: string) => string): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactStrings(v, redact)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactStrings(v, redact)]),
    ) as T;
  return value;
}

/**
 * An item as it will be written: redacted throughout, its label cut after redaction (a mask can be
 * longer than what it hides), and its parts that are no longer citable dropped one by one. Nothing
 * when the item itself no longer fits the schema, such as an id that redaction pushed past the
 * limit or a digest that a secret happened to match.
 */
function finished(item: EvidenceItem, redact: (text: string) => string): EvidenceItem | undefined {
  const r = redactStrings(item, redact);
  const parsed = EvidenceItemSchema.safeParse({
    ...r,
    label: label(r.label),
    ...(r.refs ? { refs: r.refs.filter(citable).slice(0, EVIDENCE_LIMITS.refs) } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

function traceParts(trace: Trace): string[] {
  return [
    ...trace.steps.map((s) => s.id),
    ...trace.requests.map((r) => r.id),
    ...trace.console.map((c) => c.id),
  ].map((part) => evidencePart.trace(trace.id, part));
}

/**
 * The run's evidence registry from what its stages produced. Pure and deterministic: the same
 * sources give the same items in the same order (hunks, screenshots, pixel diffs, recordings,
 * traces, requests, commands, app start-up logs, the test run), so rebuilding is always safe.
 */
export function buildEvidence(sources: EvidenceSources): EvidenceFile {
  const sha = sources.fileSha ?? (() => undefined);
  const redact = sources.redact ?? ((text: string) => text);
  const items: EvidenceItem[] = diffHunkEvidence(sources.diff ?? []);
  const file = (item: Omit<EvidenceItem, 'sha256'>) => {
    const digest = sha(item.path);
    if (digest) items.push({ ...item, sha256: digest });
  };
  const { demo, behavior } = sources;
  for (const shot of demo?.shots ?? [])
    for (const [image, revision] of [
      [shot.before, 'base'],
      [shot.after, 'head'],
    ] as const)
      if (image)
        file({
          id: evidenceId.screenshot(image.path),
          kind: 'screenshot',
          path: image.path,
          revision,
          label: scene(shot.name, shot.viewport, revision),
        });
  for (const s of behavior?.scenarios ?? [])
    for (const step of s.steps)
      if (step.diff)
        file({
          id: evidenceId.pixelDiff(s.id, step.id),
          kind: 'pixel-diff',
          path: step.diff,
          revision: 'both',
          label: `${s.name} (${s.viewport}) · ${step.id}`,
          refs: step.regions.map((r) => evidencePart.region(s.id, step.id, r.id)),
        });
  for (const r of demo?.recordings ?? [])
    file({
      id: evidenceId.recording(r.id),
      kind: 'recording',
      path: r.path,
      revision: r.revision,
      label: scene(r.flow, r.viewport, r.revision),
    });
  const traces = new Map((sources.traces ?? []).map((t) => [t.id, t]));
  for (const ref of demo?.traces ?? []) {
    const trace = traces.get(ref.id);
    file({
      id: evidenceId.trace(ref.id),
      kind: 'trace',
      path: ref.path,
      revision: ref.revision,
      label: trace
        ? scene(trace.name, trace.viewport, ref.revision)
        : `${ref.scenario} · ${ref.revision}`,
      ...(trace ? { refs: traceParts(trace) } : {}),
    });
  }
  for (const [i, r] of (demo?.requests ?? []).entries())
    items.push({
      id: evidenceId.http(i + 1),
      kind: 'http',
      path: DEMO_PATHS.captures,
      revision: r.before ? 'both' : 'head',
      sha256: sha256(JSON.stringify(r)),
      label: `${r.method} ${r.path}`,
    });
  for (const [i, c] of (demo?.commands ?? []).entries())
    items.push({
      id: evidenceId.terminal(i + 1),
      kind: 'terminal',
      path: DEMO_PATHS.captures,
      revision: c.before ? 'both' : 'head',
      sha256: sha256(JSON.stringify(c)),
      label: c.command,
    });
  for (const revision of ['base', 'head'] as const)
    file({
      id: evidenceId.appStart(revision),
      kind: 'terminal',
      path: demoPath.appLog(revision),
      revision,
      label: `app-start · ${revision}`,
    });
  if (sources.tests)
    file({
      id: evidenceId.testRun(),
      kind: 'test-run',
      path: RUN_PATHS.testsLog,
      revision: 'head',
      label: sources.tests.command,
    });
  const seen = new Set<string>();
  const unique: EvidenceItem[] = [];
  for (const raw of items) {
    const item = finished(raw, redact);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return { schemaVersion: 1, items: unique.slice(0, EVIDENCE_LIMITS.items) };
}
