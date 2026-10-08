import type {
  BehaviorDiff,
  ConsoleEntry,
  DemoRevision,
  DemoViewport,
  NetworkEntry,
  Rect,
  RequestRef,
  ScenarioDiff,
  StepDiff,
  StepState,
  TimingDelta,
  Trace,
  TraceConsole,
  TraceRequest,
  TraceStep,
} from '@covi/core';

/**
 * The comparison of one scenario (a page load or a flow) at base and head, from the two traces
 * and the pixel comparison of their screenshots. Pure: the same inputs give the same diff, and
 * nothing here touches a browser or the disk.
 */

/** A step looks different from this share of changed pixels (the threshold drafts use for before/after). */
export const PIXEL_THRESHOLD = 0.0005;

/**
 * A step's timing is reported when it moved by at least 500 ms and by half its base duration;
 * smaller differences are machine noise. Timing never makes a scenario `changed` on its own.
 */
export const TIMING_THRESHOLD = { ms: 500, ratio: 0.5 } as const;

/** Chrome repeats every failed resource load on the console; the network diff already reports it. */
const RESOURCE_ERROR = /^Failed to load resource:/;

export interface StepPixels {
  changedRatio: number;
  /** The run-relative diff image, when one was written. */
  diff?: string;
  bounds?: Rect;
  regions: Rect[];
}

export interface ScenarioObservation {
  id: string;
  kind: 'flow' | 'page';
  name: string;
  viewport: DemoViewport;
  traces: Partial<Record<DemoRevision, Trace>>;
  /** Pixel comparisons of the base and head screenshots, by step id. */
  pixels: Record<string, StepPixels>;
}

export function diffBehavior(observations: readonly ScenarioObservation[]): BehaviorDiff {
  const scenarios = observations.map(diffScenario);
  const count = (status: ScenarioDiff['status']) =>
    scenarios.filter((s) => s.status === status).length;
  return {
    schemaVersion: 1,
    scenarios,
    summary: {
      scenarios: scenarios.length,
      changed: count('changed'),
      unchanged: count('unchanged'),
      incomplete: count('incomplete'),
    },
  };
}

export function diffScenario(observation: ScenarioObservation): ScenarioDiff {
  const { base, head } = observation.traces;
  const traces: ScenarioDiff['traces'] = {};
  const recordings: NonNullable<ScenarioDiff['recordings']> = {};
  const failure: NonNullable<ScenarioDiff['failure']> = {};
  for (const [revision, trace] of [
    ['base', base],
    ['head', head],
  ] as const) {
    if (!trace) continue;
    traces[revision] = trace.id;
    if (trace.recording) recordings[revision] = trace.recording;
    if (trace.error) failure[revision] = trace.error;
  }
  const out: ScenarioDiff = {
    id: observation.id,
    kind: observation.kind,
    name: observation.name,
    viewport: observation.viewport,
    status: 'unchanged',
    traces,
    ...(Object.keys(recordings).length ? { recordings } : {}),
    ...(Object.keys(failure).length ? { failure } : {}),
    steps: [],
    network: { added: [], removed: [], changed: [] },
    console: { added: [], removed: [] },
    timing: { totalMs: {}, steps: [] },
  };
  if (!base || !head) {
    out.status = 'incomplete';
    out.missing = base ? 'head' : 'base';
    const present = base ?? head;
    if (present) out.timing.totalMs[present.revision] = present.durationMs;
    return out;
  }
  out.steps = diffSteps(base, head, observation.pixels);
  out.network = diffNetwork(base.requests, head.requests);
  out.console = diffConsole(base.console, head.console);
  out.timing = diffTiming(base, head);
  const differs =
    Boolean(base.error) !== Boolean(head.error) ||
    out.steps.length > 0 ||
    out.network.added.length + out.network.removed.length + out.network.changed.length > 0 ||
    out.console.added.length + out.console.removed.length > 0;
  out.status = differs ? 'changed' : 'unchanged';
  return out;
}

const stateOf = (step?: TraceStep): StepState => (step ? step.status : 'missing');

/** Steps whose outcome differs, or whose screenshots differ beyond PIXEL_THRESHOLD. Head order first. */
export function diffSteps(
  base: Trace,
  head: Trace,
  pixels: Record<string, StepPixels>,
): StepDiff[] {
  const before = new Map(base.steps.map((s) => [s.id, s]));
  const after = new Map(head.steps.map((s) => [s.id, s]));
  const ids = [...after.keys(), ...[...before.keys()].filter((id) => !after.has(id))];
  const out: StepDiff[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const h = after.get(id);
    const p = pixels[id];
    const looks = p !== undefined && p.changedRatio >= PIXEL_THRESHOLD;
    if (stateOf(b) === stateOf(h) && !looks) continue;
    const label = h?.label ?? b?.label;
    out.push({
      id,
      ...(label ? { label } : {}),
      base: stateOf(b),
      head: stateOf(h),
      ...(looks
        ? {
            changedRatio: Number(p.changedRatio.toFixed(5)),
            ...(p.diff ? { diff: p.diff } : {}),
            regions: p.regions.map((r, i) => ({ id: `r${i + 1}`, ...r })),
          }
        : { regions: [] }),
    });
  }
  return out;
}

const keyOf = (r: TraceRequest) => `${r.method} ${r.url.split(/[?#]/)[0]}`;

const refOf = (r: TraceRequest): RequestRef => ({
  request: r.id,
  ...(r.status !== undefined ? { status: r.status } : {}),
  ...(r.failure ? { failure: r.failure } : {}),
});

const entryOf = (key: string, r: TraceRequest): NetworkEntry => ({
  key,
  method: r.method,
  url: r.url,
  ...refOf(r),
});

function byKey(requests: readonly TraceRequest[]): Map<string, TraceRequest[]> {
  const out = new Map<string, TraceRequest[]>();
  for (const r of requests) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), r]);
  return out;
}

/**
 * Requests matched by `METHOD path`. A key on one side only is added or removed; paired requests
 * changed when their status or failure differs. Extra repeats of a key (polling) are ignored:
 * their count depends on how long the run took, not on the change.
 */
export function diffNetwork(
  base: readonly TraceRequest[],
  head: readonly TraceRequest[],
): ScenarioDiff['network'] {
  const before = byKey(base);
  const after = byKey(head);
  const out: ScenarioDiff['network'] = { added: [], removed: [], changed: [] };
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(key) ?? [];
    const h = after.get(key) ?? [];
    if (!b.length) {
      out.added.push(entryOf(key, h[0]!));
      continue;
    }
    if (!h.length) {
      out.removed.push(entryOf(key, b[0]!));
      continue;
    }
    for (let i = 0; i < Math.min(b.length, h.length); i++) {
      const x = b[i]!;
      const y = h[i]!;
      if (x.status !== y.status || Boolean(x.failure) !== Boolean(y.failure))
        out.changed.push({ key, method: y.method, url: y.url, base: refOf(x), head: refOf(y) });
    }
  }
  return out;
}

/** Errors only, as a set: the same error logged ten times is one error. */
function errorsByKey(messages: readonly TraceConsole[]): Map<string, TraceConsole> {
  const out = new Map<string, TraceConsole>();
  for (const m of messages) {
    if (m.level !== 'error' || RESOURCE_ERROR.test(m.text)) continue;
    // Long numbers are timestamps, ids, or durations: they differ between any two runs.
    const key = `${m.level} ${m.text.replace(/\d{4,}/g, '#')}`;
    if (!out.has(key)) out.set(key, m);
  }
  return out;
}

const consoleEntry = (m: TraceConsole): ConsoleEntry => ({
  message: m.id,
  level: m.level,
  text: m.text,
});

export function diffConsole(
  base: readonly TraceConsole[],
  head: readonly TraceConsole[],
): ScenarioDiff['console'] {
  const before = errorsByKey(base);
  const after = errorsByKey(head);
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, m]) => consoleEntry(m)),
    removed: [...before].filter(([k]) => !after.has(k)).map(([, m]) => consoleEntry(m)),
  };
}

export function diffTiming(base: Trace, head: Trace): ScenarioDiff['timing'] {
  const before = new Map(base.steps.map((s) => [s.id, s]));
  const steps: TimingDelta[] = [];
  for (const s of head.steps) {
    const b = before.get(s.id);
    if (b?.status !== 'ok' || s.status !== 'ok') continue;
    const deltaMs = s.durationMs - b.durationMs;
    if (Math.abs(deltaMs) >= Math.max(TIMING_THRESHOLD.ms, b.durationMs * TIMING_THRESHOLD.ratio))
      steps.push({ step: s.id, baseMs: b.durationMs, headMs: s.durationMs, deltaMs });
  }
  return { totalMs: { base: base.durationMs, head: head.durationMs }, steps };
}
