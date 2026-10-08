import { Redactor } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { TRACE_LIMITS, TraceCollector } from '../src/trace.ts';

const META = {
  id: 'flow-x-head',
  scenario: 'flow-x',
  kind: 'flow',
  name: 'X',
  revision: 'head',
  viewport: 'desktop',
  path: '/',
} as const;
const ORIGIN = 'http://127.0.0.1:5000';

function collector() {
  let now = 1000;
  const trace = new TraceCollector(META, {
    origin: ORIGIN,
    redactor: new Redactor(),
    relative: (file) => file.replace('/runs/r1/', ''),
    now: () => now,
  });
  return {
    trace,
    at: (ms: number) => {
      now = 1000 + ms;
    },
  };
}

describe('TraceCollector', () => {
  it('times steps, attributes requests and messages to them, keeps app URLs relative, and redacts', () => {
    const { trace, at } = collector();
    trace.start();
    trace.beginStep({ id: 'open', action: 'goto', target: '/' });
    const page = {};
    trace.request(page, { method: 'get', url: `${ORIGIN}/`, type: 'document' });
    trace.request({}, { method: 'GET', url: 'data:image/png;base64,AAAA', type: 'image' });
    at(40);
    trace.response(page, { status: 200, durationMs: 12.4 });
    at(100);
    trace.endStep({ mutations: { count: 2, regions: [{ x: 0, y: 0, width: 10, height: 10 }] } });
    trace.beginStep({ id: 's1', action: 'click', target: '#load', label: 'Load the items' });
    trace.frame('/runs/r1/demo/screenshots/flow-x-01.png', { x: 2, y: 4, width: 6, height: 8 });
    at(150);
    const api = {};
    trace.request(api, {
      method: 'GET',
      url: `${ORIGIN}/items.json?session=sess-4f9c2a7b1e`,
      type: 'fetch',
    });
    trace.console({
      level: 'error',
      text: `Load failed at ${ORIGIN}/app.js?token=abcdef123456`,
      location: { url: `${ORIGIN}/app.js`, line: 4, column: 9 },
    });
    trace.console({ level: 'log', text: 'hello' });
    trace.console({ level: 'assert', text: 'Assertion failed' });
    at(180);
    trace.response(api, { failure: 'net::ERR_FAILED' });
    at(400);
    trace.endStep({ mutations: { count: 1, regions: [{ x: 5, y: 5, width: 20, height: 20 }] } });
    at(450);
    trace.stop();
    at(9000);
    expect(trace.finish({ title: 'Items', recording: 'demo/recordings/flow-x-head.mp4' })).toEqual({
      schemaVersion: 1,
      ...META,
      title: 'Items',
      recording: 'demo/recordings/flow-x-head.mp4',
      durationMs: 450,
      steps: [
        {
          id: 'open',
          action: 'goto',
          target: '/',
          t: 0,
          durationMs: 100,
          status: 'ok',
          mutations: { count: 2, regions: [{ x: 0, y: 0, width: 10, height: 10 }] },
        },
        {
          id: 's1',
          action: 'click',
          target: '#load',
          label: 'Load the items',
          t: 0.1,
          durationMs: 300,
          status: 'ok',
          screenshot: 'demo/screenshots/flow-x-01.png',
          box: { x: 2, y: 4, width: 6, height: 8 },
          mutations: { count: 1, regions: [{ x: 5, y: 5, width: 20, height: 20 }] },
        },
      ],
      requests: [
        {
          id: 'n1',
          step: 'open',
          method: 'GET',
          url: '/',
          type: 'document',
          startMs: 0,
          status: 200,
          durationMs: 12,
        },
        {
          id: 'n2',
          step: 's1',
          method: 'GET',
          url: '/items.json?session=[REDACTED]',
          type: 'fetch',
          startMs: 150,
          failure: 'net::ERR_FAILED',
          durationMs: 30,
        },
      ],
      console: [
        {
          id: 'c1',
          step: 's1',
          level: 'error',
          source: 'console',
          text: 'Load failed at /app.js?token=[REDACTED]',
          location: '/app.js:5:10',
          tMs: 150,
        },
        { id: 'c2', step: 's1', level: 'log', source: 'console', text: 'hello', tMs: 150 },
        {
          id: 'c3',
          step: 's1',
          level: 'error',
          source: 'console',
          text: 'Assertion failed',
          tMs: 150,
        },
      ],
      mutations: { count: 3, regions: [{ x: 0, y: 0, width: 25, height: 25 }] },
    });
  });

  it('keeps at most TRACE_LIMITS entries, counts the rest, and clips long text', () => {
    const { trace } = collector();
    trace.start();
    for (let i = 0; i < TRACE_LIMITS.requests + 5; i++)
      trace.request({}, { method: 'GET', url: `${ORIGIN}/r${i}`, type: 'fetch' });
    for (let i = 0; i < TRACE_LIMITS.console + 5; i++)
      trace.console({ level: 'log', text: 'x'.repeat(TRACE_LIMITS.text + 50) });
    const result = trace.finish();
    expect(result.requests).toHaveLength(TRACE_LIMITS.requests);
    expect(result.console).toHaveLength(TRACE_LIMITS.console);
    expect(result.truncated).toEqual({ requests: 5, console: 5 });
    expect(result.console[0]!.text.length).toBeLessThanOrEqual(TRACE_LIMITS.text);
  });

  it('bounds hostile page text before redacting it, so a huge message or URL cannot stall capture', () => {
    const { trace } = collector();
    // Super-linear for the redactor when redacted whole: tens of seconds each at this length.
    const hostile = 'a.'.repeat(150_000);
    const started = performance.now();
    trace.console({ level: 'error', text: hostile });
    trace.request({}, { method: hostile, url: `${ORIGIN}/search?q=${hostile}`, type: 'fetch' });
    const result = trace.finish();
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.console[0]!.text).toHaveLength(TRACE_LIMITS.text);
    expect(result.requests[0]!.url).toHaveLength(TRACE_LIMITS.url);
    // Run files are redacted again when written, so no stored field may stay unbounded.
    expect(result.requests[0]!.method.length).toBeLessThanOrEqual(32);
  });

  it('masks a secret that crosses the text limit instead of keeping an unmasked prefix of it', () => {
    const { trace } = collector();
    const before = 'x'.repeat(480);
    trace.console({ level: 'log', text: `${before} ghp_${'A1b2C3d4E5'.repeat(4)} done` });
    trace.console({ level: 'log', text: 'short and clean' });
    const [crossing, clean] = trace.finish().console;
    expect(crossing!.text).toBe(`${before} ghp_[REDACTED] done`);
    expect(clean!.text).toBe('short and clean');
  });

  it('masks and clips the page title', () => {
    const { trace } = collector();
    const result = trace.finish({ title: `Reset /reset?token=abc ${'x'.repeat(300)}` });
    expect(result.title).toMatch(/^Reset \/reset\?token=\[REDACTED\] x+…$/);
    expect(result.title).toHaveLength(200);
  });

  it('masks and clips the error of a failed scenario and its open step', () => {
    const { trace } = collector();
    trace.beginStep({ id: 's1', action: 'click', target: '#go' });
    const error = `Failed with ghp_${'A1b2C3d4E5'.repeat(4)} ${'x'.repeat(600)}`;
    const result = trace.finish({ error });
    for (const text of [result.error, result.steps[0]!.error]) {
      expect(text).toMatch(/^Failed with ghp_\[REDACTED\] x+…$/);
      expect(text).toHaveLength(TRACE_LIMITS.text);
    }
  });

  it('closes an open step as failed when the scenario failed, and ignores late events', () => {
    const { trace, at } = collector();
    trace.start();
    trace.beginStep({ id: 's1', action: 'click', target: '#missing' });
    at(8000);
    const result = trace.finish({ error: 'Timeout 8000ms exceeded' });
    trace.request({}, { method: 'GET', url: `${ORIGIN}/late`, type: 'fetch' });
    trace.console({ level: 'error', text: 'late' });
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 's1',
        status: 'failed',
        error: 'Timeout 8000ms exceeded',
        durationMs: 8000,
      }),
    ]);
    expect(result.error).toBe('Timeout 8000ms exceeded');
    expect(result.requests).toEqual([]);
    expect(result.console).toEqual([]);
  });
});
