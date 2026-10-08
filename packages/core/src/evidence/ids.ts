import type { DemoRevision } from '../model/behavior.ts';

/** A file's name without its last extension: `demo/screenshots/home-after.png` → `home-after`. */
const stem = (path: string) => (path.split('/').at(-1) ?? path).replace(/\.[A-Za-z0-9]+$/, '');

/**
 * Every evidence id, defined once. Each starts with its kind, so ids never collide across kinds
 * (a recording and its trace share a stem), and PR 4's scenario, trace, step, and region names
 * follow the prefix unchanged.
 */
export const evidenceId = {
  /** A diff hunk: its file and the `+` start of its `@@` header, so anyone reading the diff can write it. */
  hunk: (path: string, newStart: number) => `diff-hunk:${path}:${newStart}`,
  screenshot: (path: string) => `screenshot:${stem(path)}`,
  /** `<scenario>-<revision>`, the recording's id in `demo/captures.json`. */
  recording: (id: string) => `recording:${id}`,
  /** `<scenario>-<revision>`, the trace's id. */
  trace: (id: string) => `trace:${id}`,
  /** A step's pixel diff in `demo/behavior-diff.json`. */
  pixelDiff: (scenario: string, step: string) => `pixel-diff:${scenario}#${step}`,
  /** The n-th (1-based) request in `demo/captures.json`: names are free text, positions are not. */
  http: (n: number) => `http:${n}`,
  /** The n-th (1-based) command in `demo/captures.json`. */
  terminal: (n: number) => `terminal:${n}`,
  /** Why the app did not start at a revision (`demo/app-<revision>.log`). */
  appStart: (revision: DemoRevision) => `terminal:app-start-${revision}`,
  testRun: () => 'test-run:tests',
} as const;

/** Parts of an item that a claim can cite on their own. */
export const evidencePart = {
  /** A step (`open`, `s3`, `end`), request (`n2`), or console message (`c1`) in a trace. */
  trace: (traceId: string, part: string) => `${evidenceId.trace(traceId)}#${part}`,
  /** A changed region (`r1`) of a step's pixel diff. */
  region: (scenario: string, step: string, region: string) =>
    `${evidenceId.pixelDiff(scenario, step)}.${region}`,
} as const;
