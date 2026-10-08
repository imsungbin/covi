import {
  type ConsoleLevel,
  type DemoRevision,
  type DemoViewport,
  type MutationSummary,
  type Rect,
  type Redactor,
  type Trace,
  type TraceConsole,
  type TraceRequest,
  type TraceStep,
  truncate,
} from '@covi/core';
import { mergeRegions } from './regions.ts';

/** Bounds on one trace: a page can make thousands of requests or log in a loop. */
export const TRACE_LIMITS = { requests: 300, console: 200, text: 500, url: 500 } as const;

export interface TraceMeta {
  id: string;
  scenario: string;
  kind: 'flow' | 'page';
  name: string;
  revision: DemoRevision;
  viewport: DemoViewport;
  path: string;
}

export interface TraceOptions {
  /** The app's origin (`http://127.0.0.1:4321`): URLs on it stay relative, so base and head compare. */
  origin: string;
  redactor: Redactor;
  /** Turns an absolute screenshot path into one relative to the run. */
  relative?: (file: string) => string;
  /** Milliseconds from any fixed point; tests pass a fake clock. */
  now?: () => number;
}

const LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  assert: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
};

/** Nothing crossed the network for these. */
const LOCAL_URL = /^(data|blob|about|javascript|chrome-extension):/i;

const seconds = (ms: number) => Math.round(ms) / 1000;

/**
 * Redacts page text and clips it to `max`. Pages can log or request hundreds of kilobytes, and
 * some of the redactor's patterns are super-linear, so it only ever sees a window of twice `max`.
 * The window is wider than `max` so a secret that crosses the limit is masked whole, not cut into
 * a prefix the patterns no longer recognise; clipping last keeps masks that lengthen within `max`.
 */
function redactBounded(text: string, max: number, redact: (text: string) => string): string {
  return truncate(redact(text.slice(0, max * 2)), max);
}

/**
 * Collects what one page load or flow did at one revision. It holds no browser: the Playwright
 * adapter (`observe.ts`) feeds it events, and it decides ids, step attribution, relative URLs,
 * redaction, and bounds, so all of that is testable without a browser.
 */
export class TraceCollector {
  private readonly meta: TraceMeta;
  private readonly redactor: Redactor;
  private readonly origin: string;
  private readonly relative: (file: string) => string;
  private readonly now: () => number;
  private t0: number;
  private stoppedAt?: number;
  private open?: { step: TraceStep; startedAt: number };
  private readonly steps: TraceStep[] = [];
  private readonly requests: TraceRequest[] = [];
  private readonly pending = new Map<object, { entry: TraceRequest; startedAt: number }>();
  private readonly messages: TraceConsole[] = [];
  private requestCount = 0;
  private consoleCount = 0;
  private finished = false;

  constructor(meta: TraceMeta, options: TraceOptions) {
    this.meta = meta;
    this.redactor = options.redactor;
    this.origin = options.origin.replace(/\/$/, '');
    this.relative = options.relative ?? ((file) => file);
    this.now = options.now ?? (() => performance.now());
    this.t0 = this.now();
  }

  /** Restarts the clock: call when the page, and its recording, start. */
  start(): void {
    this.t0 = this.now();
  }

  /** Stops the clock: the page, and its recording, ended. */
  stop(): void {
    this.stoppedAt ??= this.elapsed();
  }

  beginStep(step: { id: string; action: string; target?: string; label?: string }): void {
    if (this.open) this.endStep();
    const startedAt = this.elapsed();
    this.open = {
      startedAt,
      step: {
        id: step.id,
        action: step.action,
        ...(step.target ? { target: step.target } : {}),
        ...(step.label ? { label: step.label } : {}),
        t: seconds(startedAt),
        durationMs: 0,
        status: 'ok',
      },
    };
  }

  /** The screenshot taken for the open step, and its target's box in image pixels. */
  frame(file: string, box?: Rect): void {
    if (!this.open) return;
    this.open.step.screenshot = this.relative(file);
    if (box) this.open.step.box = box;
  }

  endStep(
    end: { status?: 'ok' | 'failed'; error?: string; mutations?: MutationSummary } = {},
  ): void {
    const open = this.open;
    if (!open) return;
    this.open = undefined;
    const { step } = open;
    step.durationMs = Math.round(this.elapsed() - open.startedAt);
    step.status = end.status ?? 'ok';
    if (end.error) step.error = truncate(end.error, TRACE_LIMITS.text);
    if (end.mutations) step.mutations = end.mutations;
    this.steps.push(step);
  }

  request(handle: object, init: { method: string; url: string; type: string }): void {
    if (this.finished) return;
    const url = this.url(init.url);
    if (url === undefined) return;
    const id = `n${++this.requestCount}`;
    if (this.requests.length >= TRACE_LIMITS.requests) return;
    const startedAt = this.elapsed();
    const entry: TraceRequest = {
      id,
      ...(this.open ? { step: this.open.step.id } : {}),
      // The page picks the method, and run files are redacted whole when written: keep it short.
      method: truncate(init.method, 32).toUpperCase(),
      url,
      type: init.type,
      startMs: Math.round(startedAt),
    };
    this.requests.push(entry);
    this.pending.set(handle, { entry, startedAt });
  }

  response(handle: object, done: { status?: number; failure?: string; durationMs?: number }): void {
    if (this.finished) return;
    const pending = this.pending.get(handle);
    if (!pending) return;
    this.pending.delete(handle);
    if (done.status !== undefined) pending.entry.status = done.status;
    if (done.failure) pending.entry.failure = truncate(done.failure, 200);
    pending.entry.durationMs = Math.round(done.durationMs ?? this.elapsed() - pending.startedAt);
  }

  console(message: {
    level: string;
    text: string;
    location?: { url: string; line: number; column: number };
    source?: 'console' | 'pageerror';
  }): void {
    if (this.finished) return;
    const id = `c${++this.consoleCount}`;
    if (this.messages.length >= TRACE_LIMITS.console) return;
    const where = message.location?.url ? this.url(message.location.url) : undefined;
    this.messages.push({
      id,
      ...(this.open ? { step: this.open.step.id } : {}),
      level: LEVELS[message.level] ?? 'log',
      source: message.source ?? 'console',
      text: redactBounded(message.text.split(this.origin).join(''), TRACE_LIMITS.text, (text) =>
        this.redactor.redactUrls(text),
      ),
      ...(where && message.location
        ? { location: `${where}:${message.location.line + 1}:${message.location.column + 1}` }
        : {}),
      tMs: Math.round(this.elapsed()),
    });
  }

  finish(extra: { title?: string; recording?: string; error?: string } = {}): Trace {
    if (this.open) this.endStep(extra.error ? { status: 'failed', error: extra.error } : {});
    this.finished = true;
    const summaries = this.steps.flatMap((s) => (s.mutations ? [s.mutations] : []));
    const trace: Trace = {
      schemaVersion: 1,
      ...this.meta,
      ...(extra.title ? { title: truncate(extra.title, 200) } : {}),
      ...(extra.recording ? { recording: extra.recording } : {}),
      durationMs: Math.round(this.stoppedAt ?? this.elapsed()),
      steps: this.steps,
      requests: this.requests,
      console: this.messages,
      mutations: {
        count: summaries.reduce((sum, m) => sum + m.count, 0),
        regions: mergeRegions(summaries.flatMap((m) => m.regions)),
      },
    };
    if (extra.error) trace.error = truncate(extra.error, TRACE_LIMITS.text);
    const dropped = {
      requests: this.requestCount - this.requests.length,
      console: this.consoleCount - this.messages.length,
    };
    if (dropped.requests || dropped.console)
      trace.truncated = {
        ...(dropped.requests ? { requests: dropped.requests } : {}),
        ...(dropped.console ? { console: dropped.console } : {}),
      };
    return trace;
  }

  private elapsed(): number {
    return this.now() - this.t0;
  }

  /** App-relative and redacted, or undefined for URLs that never cross the network. */
  private url(raw: string): string | undefined {
    if (LOCAL_URL.test(raw)) return undefined;
    const local =
      raw === this.origin
        ? '/'
        : raw.startsWith(`${this.origin}/`)
          ? raw.slice(this.origin.length)
          : raw;
    return redactBounded(local, TRACE_LIMITS.url, (url) => this.redactor.redactUrl(url));
  }
}
