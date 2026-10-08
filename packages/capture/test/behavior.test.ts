import type { Trace, TraceConsole, TraceRequest, TraceStep } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  diffBehavior,
  diffConsole,
  diffNetwork,
  diffScenario,
  diffSteps,
  diffTiming,
  PIXEL_THRESHOLD,
  type ScenarioObservation,
} from '../src/behavior.ts';

const step = (id: string, extra: Partial<TraceStep> = {}): TraceStep => ({
  id,
  action: 'click',
  t: 0,
  durationMs: 300,
  status: 'ok',
  ...extra,
});
const req = (
  id: string,
  url: string,
  status?: number,
  extra: Partial<TraceRequest> = {},
): TraceRequest => ({
  id,
  method: 'GET',
  url,
  type: 'fetch',
  startMs: 0,
  ...(status === undefined ? {} : { status }),
  ...extra,
});
const msg = (id: string, text: string, level: TraceConsole['level'] = 'error'): TraceConsole => ({
  id,
  level,
  source: 'console',
  text,
  tMs: 0,
});
function trace(revision: 'base' | 'head', extra: Partial<Trace> = {}): Trace {
  return {
    schemaVersion: 1,
    id: `flow-x-${revision}`,
    scenario: 'flow-x',
    kind: 'flow',
    name: 'X',
    revision,
    viewport: 'desktop',
    path: '/',
    durationMs: 1000,
    steps: [step('open'), step('s1'), step('end')],
    requests: [],
    console: [],
    mutations: { count: 0, regions: [] },
    ...extra,
  };
}
const observe = (
  base?: Trace,
  head?: Trace,
  pixels: ScenarioObservation['pixels'] = {},
): ScenarioObservation => ({
  id: 'flow-x',
  kind: 'flow',
  name: 'X',
  viewport: 'desktop',
  traces: { ...(base ? { base } : {}), ...(head ? { head } : {}) },
  pixels,
});

describe('network', () => {
  it('reports added, removed, and changed-status requests, keyed by method and path', () => {
    expect(
      diffNetwork(
        [
          req('n1', '/', 200),
          req('n2', '/items.json?session=[REDACTED]', 200),
          req('n3', '/legacy.js', 200),
        ],
        [
          req('n1', '/', 200),
          req('n2', '/items.json?session=[REDACTED]', 404),
          req('n3', '/api/limits', 200),
        ],
      ),
    ).toEqual({
      added: [
        { key: 'GET /api/limits', method: 'GET', url: '/api/limits', request: 'n3', status: 200 },
      ],
      removed: [
        { key: 'GET /legacy.js', method: 'GET', url: '/legacy.js', request: 'n3', status: 200 },
      ],
      changed: [
        {
          key: 'GET /items.json',
          method: 'GET',
          url: '/items.json?session=[REDACTED]',
          base: { request: 'n2', status: 200 },
          head: { request: 'n2', status: 404 },
        },
      ],
    });
  });

  it('stays quiet about repeated calls and changed query strings', () => {
    const poll = (n: number) =>
      Array.from({ length: n }, (_, i) => req(`n${i + 1}`, `/poll?t=${i}`, 200));
    expect(diffNetwork(poll(3), poll(5))).toEqual({ added: [], removed: [], changed: [] });
  });

  it('treats a failed request as a change from a response', () => {
    expect(
      diffNetwork(
        [req('n1', '/a', 200)],
        [req('n1', '/a', undefined, { failure: 'net::ERR_FAILED' })],
      ).changed,
    ).toEqual([
      {
        key: 'GET /a',
        method: 'GET',
        url: '/a',
        base: { request: 'n1', status: 200 },
        head: { request: 'n1', failure: 'net::ERR_FAILED' },
      },
    ]);
  });
});

describe('console', () => {
  it('reports new and gone errors once each, ignoring warnings and resource-load noise', () => {
    expect(
      diffConsole(
        [msg('c1', 'Deprecated API'), msg('c2', 'just a warning', 'warning')],
        [
          msg('c1', 'Could not load items: HTTP 404'),
          msg('c2', 'Could not load items: HTTP 404'),
          msg(
            'c3',
            'Failed to load resource: the server responded with a status of 404 (Not Found)',
          ),
          msg('c4', 'other warning', 'warning'),
        ],
      ),
    ).toEqual({
      added: [{ message: 'c1', level: 'error', text: 'Could not load items: HTTP 404' }],
      removed: [{ message: 'c1', level: 'error', text: 'Deprecated API' }],
    });
  });

  it('matches errors that differ only in long numbers such as timestamps', () => {
    expect(
      diffConsole([msg('c1', 'Timed out after 12345 ms')], [msg('c1', 'Timed out after 12399 ms')]),
    ).toEqual({ added: [], removed: [] });
  });

  it('keeps short numbers such as HTTP statuses apart', () => {
    expect(diffConsole([msg('c1', 'HTTP 404')], [msg('c1', 'HTTP 500')])).toEqual({
      added: [{ message: 'c1', level: 'error', text: 'HTTP 500' }],
      removed: [{ message: 'c1', level: 'error', text: 'HTTP 404' }],
    });
  });
});

describe('steps', () => {
  it('lists steps whose screenshots differ beyond the threshold, with region ids', () => {
    expect(
      diffSteps(trace('base'), trace('head'), {
        s1: { changedRatio: PIXEL_THRESHOLD / 2, regions: [] },
        end: {
          changedRatio: 0.0123,
          diff: 'demo/diffs/flow-x-end.png',
          regions: [
            { x: 1, y: 2, width: 3, height: 4 },
            { x: 50, y: 60, width: 7, height: 8 },
          ],
        },
      }),
    ).toEqual([
      {
        id: 'end',
        base: 'ok',
        head: 'ok',
        changedRatio: 0.0123,
        diff: 'demo/diffs/flow-x-end.png',
        regions: [
          { id: 'r1', x: 1, y: 2, width: 3, height: 4 },
          { id: 'r2', x: 50, y: 60, width: 7, height: 8 },
        ],
      },
    ]);
  });

  it('lists steps that failed or were never reached at one revision', () => {
    const base = trace('base', {
      steps: [step('open'), step('s1', { status: 'failed', label: 'Open the menu' })],
      error: 'Timeout 8000ms exceeded',
    });
    expect(diffSteps(base, trace('head'), {})).toEqual([
      { id: 's1', label: 'Open the menu', base: 'failed', head: 'ok', regions: [] },
      { id: 'end', base: 'missing', head: 'ok', regions: [] },
    ]);
  });

  it('counts a step at exactly the threshold as different', () => {
    const steps = diffSteps(trace('base'), trace('head'), {
      s1: { changedRatio: PIXEL_THRESHOLD, regions: [] },
    });
    expect(steps.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('timing', () => {
  it('reports a step slower by at least 500 ms and half its base time, and stays quiet otherwise', () => {
    const base = trace('base', {
      durationMs: 2600,
      steps: [step('open', { durationMs: 2000 }), step('s1', { durationMs: 300 }), step('end')],
    });
    const head = trace('head', {
      durationMs: 3900,
      steps: [step('open', { durationMs: 2400 }), step('s1', { durationMs: 1200 }), step('end')],
    });
    expect(diffTiming(base, head)).toEqual({
      totalMs: { base: 2600, head: 3900 },
      steps: [{ step: 's1', baseMs: 300, headMs: 1200, deltaMs: 900 }],
    });
  });

  it('stays quiet when a long step moves by less than half, and reports a speedup', () => {
    const base = trace('base', {
      steps: [step('open', { durationMs: 2000 }), step('s1', { durationMs: 1200 }), step('end')],
    });
    const head = trace('head', {
      steps: [step('open', { durationMs: 2700 }), step('s1', { durationMs: 300 }), step('end')],
    });
    expect(diffTiming(base, head).steps).toEqual([
      { step: 's1', baseMs: 1200, headMs: 300, deltaMs: -900 },
    ]);
  });
});

describe('scenarios', () => {
  it('is unchanged, with nothing to report, when base and head behave the same', () => {
    const io = { requests: [req('n1', '/', 200)], console: [msg('c1', 'Deprecated API')] };
    expect(diffScenario(observe(trace('base', io), trace('head', io)))).toEqual({
      id: 'flow-x',
      kind: 'flow',
      name: 'X',
      viewport: 'desktop',
      status: 'unchanged',
      traces: { base: 'flow-x-base', head: 'flow-x-head' },
      steps: [],
      network: { added: [], removed: [], changed: [] },
      console: { added: [], removed: [] },
      timing: { totalMs: { base: 1000, head: 1000 }, steps: [] },
    });
  });

  it('is unchanged when nothing but timing differs', () => {
    const slow = trace('head', {
      steps: [step('open'), step('s1', { durationMs: 2000 }), step('end')],
    });
    const result = diffScenario(observe(trace('base'), slow));
    expect(result.status).toBe('unchanged');
    expect(result.timing.steps).toHaveLength(1);
  });

  it('is changed when a request, a console error, a step, or the outcome differs', () => {
    const changed = (head: Trace, pixels: ScenarioObservation['pixels'] = {}) =>
      diffScenario(observe(trace('base'), head, pixels)).status;
    expect(changed(trace('head', { requests: [req('n1', '/new', 200)] }))).toBe('changed');
    expect(changed(trace('head', { console: [msg('c1', 'boom')] }))).toBe('changed');
    expect(changed(trace('head'), { end: { changedRatio: 0.2, regions: [] } })).toBe('changed');
    const failed = diffScenario(observe(trace('base'), trace('head', { error: 'Timeout' })));
    expect(failed).toMatchObject({ status: 'changed', failure: { head: 'Timeout' } });
  });

  it('is changed, not a failure of the review, when the flow cannot run at base', () => {
    const base = trace('base', {
      steps: [step('open'), step('s1', { status: 'failed' })],
      error: 'locator.click: Timeout 8000ms exceeded',
    });
    expect(diffScenario(observe(base, trace('head')))).toMatchObject({
      status: 'changed',
      failure: { base: 'locator.click: Timeout 8000ms exceeded' },
      steps: [
        { id: 's1', base: 'failed', head: 'ok' },
        { id: 'end', base: 'missing', head: 'ok' },
      ],
    });
  });

  it('is incomplete when one revision has no trace', () => {
    expect(diffScenario(observe(undefined, trace('head')))).toMatchObject({
      status: 'incomplete',
      missing: 'base',
      traces: { head: 'flow-x-head' },
      timing: { totalMs: { head: 1000 } },
    });
  });

  it('summarizes deterministically', () => {
    const inputs = [
      observe(trace('base'), trace('head')),
      observe(undefined, trace('head')),
      observe(trace('base'), trace('head', { console: [msg('c1', 'boom')] })),
    ];
    const diff = diffBehavior(inputs);
    expect(diff.schemaVersion).toBe(1);
    expect(diff.summary).toEqual({ scenarios: 3, changed: 1, unchanged: 1, incomplete: 1 });
    expect(diffBehavior(inputs)).toEqual(diff);
  });
});
