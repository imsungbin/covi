import type { Rect } from './demo.ts';

/**
 * Evidence of behavior: what a page load or a flow did at one revision (a trace), and the
 * deterministic comparison of base and head (the behavior diff). Ids are stable within a run:
 * `<trace>#<step|request|message>` (e.g. `flow-load-items-head#n2`) and
 * `<scenario>#<step>.<region>` (e.g. `flow-load-items#end.r1`) each name one piece of evidence.
 */

export type DemoRevision = 'base' | 'head';
export type DemoViewport = 'desktop' | 'tablet' | 'mobile';
export type ConsoleLevel = 'error' | 'warning' | 'info' | 'log' | 'debug';

/** DOM changes after the page loaded: how many, and where (image pixels, merged, at most six). */
export interface MutationSummary {
  count: number;
  regions: Rect[];
}

export interface TraceStep {
  /**
   * `open` (a flow's first navigation), `load` (a page capture), `s1`… (the flow's steps in plan
   * order), or `end` (the final frame). The same at base and head, so steps pair up.
   */
  id: string;
  /** `goto`, `click`, `fill`, `press`, `hover`, `select`, `check`, `scroll`, `wait`, `screenshot`, or `end`. */
  action: string;
  /** The selector or path the step acts on. */
  target?: string;
  label?: string;
  /** Seconds from the start of the trace, which is also the start of its recording. */
  t: number;
  durationMs: number;
  status: 'ok' | 'failed';
  error?: string;
  /** The frame taken for this step (just before its action, or at a screenshot step), run-relative. */
  screenshot?: string;
  /** The target's bounding box in image pixels when the frame was taken. */
  box?: Rect;
  /** What the step's action changed in the DOM, read at the end of the step. */
  mutations?: MutationSummary;
}

export interface TraceRequest {
  /** `n1`, `n2`…, in the order requests started. */
  id: string;
  /** The step running when the request started. */
  step?: string;
  method: string;
  /** Relative (`/api/items?page=2`) on the app's own origin, absolute elsewhere; redacted. */
  url: string;
  /** Playwright's resource type: `document`, `script`, `fetch`, `xhr`, `image`, … */
  type: string;
  status?: number;
  failure?: string;
  /** Milliseconds from the start of the trace. */
  startMs: number;
  durationMs?: number;
}

export interface TraceConsole {
  /** `c1`, `c2`…, in the order messages arrived. */
  id: string;
  step?: string;
  level: ConsoleLevel;
  /** `pageerror` for uncaught exceptions. */
  source: 'console' | 'pageerror';
  text: string;
  /** `path:line:column`, 1-based, app-relative. */
  location?: string;
  tMs: number;
}

/** `demo/traces/<scenario>-<revision>.json`. */
export interface Trace {
  schemaVersion: 1;
  /** `<scenario>-<revision>`: the file's stem and the recording's id. */
  id: string;
  /** `flow-<flow>` or `<page>-<viewport>`; the same at base and head. */
  scenario: string;
  kind: 'flow' | 'page';
  name: string;
  revision: DemoRevision;
  viewport: DemoViewport;
  /** Where the scenario starts, relative to the app. */
  path: string;
  title?: string;
  /** The run-relative recording, when the flow was recorded. */
  recording?: string;
  durationMs: number;
  steps: TraceStep[];
  requests: TraceRequest[];
  console: TraceConsole[];
  /** All steps' DOM changes together. */
  mutations: MutationSummary;
  /** Why the scenario stopped, when it did not finish. */
  error?: string;
  /** Entries beyond the trace's limits that were counted but not kept. */
  truncated?: { requests?: number; console?: number };
}

export type StepState = 'ok' | 'failed' | 'missing';

export interface StepDiff {
  id: string;
  label?: string;
  base: StepState;
  head: StepState;
  /** Present when the step's screenshots differ beyond the threshold. */
  changedRatio?: number;
  /** The run-relative pixel diff image. */
  diff?: string;
  /** Where the pixels changed (`r1`…), in image pixels of the head screenshot. */
  regions: Array<Rect & { id: string }>;
}

export interface RequestRef {
  /** The request's id in its trace. */
  request: string;
  status?: number;
  failure?: string;
}

export interface NetworkEntry extends RequestRef {
  /** `METHOD path` without the query: how base and head requests are matched. */
  key: string;
  method: string;
  url: string;
}

export interface NetworkChange {
  key: string;
  method: string;
  url: string;
  base: RequestRef;
  head: RequestRef;
}

export interface ConsoleEntry {
  /** The message's id in its trace (base for removed, head for added). */
  message: string;
  level: ConsoleLevel;
  text: string;
}

export interface TimingDelta {
  step: string;
  baseMs: number;
  headMs: number;
  deltaMs: number;
}

export interface ScenarioDiff {
  id: string;
  kind: 'flow' | 'page';
  name: string;
  viewport: DemoViewport;
  /** `changed` from steps, requests, console errors, or outcome; never from timing alone. */
  status: 'changed' | 'unchanged' | 'incomplete';
  /** The revision with no trace, when the scenario is incomplete. */
  missing?: DemoRevision;
  /** Trace ids. */
  traces: Partial<Record<DemoRevision, string>>;
  /** Run-relative recordings. */
  recordings?: Partial<Record<DemoRevision, string>>;
  /** Why the scenario stopped at a revision. */
  failure?: Partial<Record<DemoRevision, string>>;
  steps: StepDiff[];
  network: { added: NetworkEntry[]; removed: NetworkEntry[]; changed: NetworkChange[] };
  console: { added: ConsoleEntry[]; removed: ConsoleEntry[] };
  timing: { totalMs: Partial<Record<DemoRevision, number>>; steps: TimingDelta[] };
}

/** `demo/behavior-diff.json`. */
export interface BehaviorDiff {
  schemaVersion: 1;
  scenarios: ScenarioDiff[];
  summary: { scenarios: number; changed: number; unchanged: number; incomplete: number };
}
