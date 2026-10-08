import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ExitCode, Redactor, type StaticServer, serveStatic } from '@covi/core';
import { type Browser, type BrowserContextOptions, chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { capturePage, contextOptions, runFlow } from '../src/browser.ts';
import { finalizeRecording, RecordingUnavailableError } from '../src/recording.ts';
import { MAX_REGIONS } from '../src/regions.ts';
import { TraceCollector } from '../src/trace.ts';

const browserAvailable = await canUseBrowser();
let dir: string | undefined;
let server: StaticServer | undefined;
let browser: Browser | undefined;
afterEach(async () => {
  await browser?.close();
  await server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  browser = undefined;
  server = undefined;
  dir = undefined;
});

const PAGE = `<!doctype html><html><head><title>Probe</title></head><body>
<button id="add">Add</button><ul id="list"></ul>
<script>
document.getElementById('add').addEventListener('click', async () => {
  const r = await fetch('/missing.json?token=abcdef123456');
  console.error('Could not load: HTTP ' + r.status);
  document.getElementById('list').appendChild(document.createElement('li')).textContent = 'Added';
});
</script></body></html>`;

// After load, adds a banner far wider than any viewport.
const WIDE = `<!doctype html><html><head><title>Wide</title></head><body><main>Items</main>
<script>
addEventListener('load', () => setTimeout(() => {
  const banner = document.body.appendChild(document.createElement('div'));
  banner.style.cssText = 'width:5000px;height:40px';
  banner.textContent = 'Loaded';
}, 0));
</script></body></html>`;

const FLOW = {
  name: 'Add one',
  path: '/',
  steps: [{ click: '#add', note: 'Add an item' }, { wait: 300 }],
};

const FLOW_META = {
  id: 'flow-add-one-head',
  scenario: 'flow-add-one',
  kind: 'flow',
  name: 'Add one',
  revision: 'head',
  viewport: 'desktop',
  path: '/',
} as const;

/**
 * A trace whose clock can jump ahead after the run: if the run stopped the clock, the jump does
 * not show up in the trace's duration.
 */
function stoppableTrace(origin: string) {
  let skew = 0;
  const trace = new TraceCollector(FLOW_META, {
    origin,
    redactor: new Redactor(),
    relative: (f) => (dir ? relative(dir, f) : f),
    now: () => performance.now() + skew,
  });
  return {
    trace,
    jump: () => {
      skew = 60_000;
    },
  };
}

/**
 * A stand-in for ffmpeg: logs its arguments, writes its last one (the MP4) as ffmpeg would, then
 * runs `exit`, the shell that decides how it ends.
 */
function fakeFfmpeg(at: string, exit: string): { path: string; calls: () => string[] } {
  const path = join(at, 'ffmpeg');
  const log = join(at, 'ffmpeg.log');
  writeFileSync(
    path,
    `#!/bin/sh\necho "$*" >> '${log}'\nfor arg in "$@"; do last=$arg; done\nprintf mp4 > "$last"\n${exit}\n`,
  );
  chmodSync(path, 0o755);
  return {
    path,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []),
  };
}

/** Recording targets next to a raw WebM, as the demonstration names them. */
function rawRecording() {
  dir = mkdtempSync(join(tmpdir(), 'covi-rec-'));
  const raw = join(dir, 'page@1.webm');
  writeFileSync(raw, 'webm bytes');
  return {
    raw,
    targets: { mp4: join(dir, 'flow-x-head.mp4'), webm: join(dir, 'flow-x-head.webm') },
  };
}

describe('contextOptions', () => {
  it('records at the viewport in CSS pixels, only when asked', () => {
    expect(contextOptions('desktop').recordVideo).toBeUndefined();
    const mobile = contextOptions('mobile', { recordDir: '/tmp/rec' });
    expect(mobile.recordVideo).toEqual({ dir: '/tmp/rec', size: { width: 390, height: 844 } });
    expect(mobile.deviceScaleFactor).toBe(2);
  });
});

describe('finalizeRecording', () => {
  it('keeps the WebM when there is no ffmpeg', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-rec-'));
    writeFileSync(join(dir, 'page@1.webm'), 'webm bytes');
    const targets = { mp4: join(dir, 'flow-x-head.mp4'), webm: join(dir, 'flow-x-head.webm') };
    expect(await finalizeRecording(join(dir, 'page@1.webm'), targets, undefined)).toEqual({
      file: targets.webm,
      format: 'webm',
      cause: 'no-ffmpeg',
    });
    expect(existsSync(targets.webm)).toBe(true);
    expect(existsSync(join(dir, 'page@1.webm'))).toBe(false);
  });

  it('keeps the WebM, and says why, when ffmpeg cannot convert it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-rec-'));
    writeFileSync(join(dir, 'page@1.webm'), 'not a video');
    const targets = { mp4: join(dir, 'flow-x-head.mp4'), webm: join(dir, 'flow-x-head.webm') };
    const result = await finalizeRecording(
      join(dir, 'page@1.webm'),
      targets,
      join(dir, 'no-ffmpeg'),
    );
    expect(result).toMatchObject({ file: targets.webm, format: 'webm', cause: 'convert-failed' });
    expect(result.detail).toBeTruthy();
    expect(existsSync(targets.mp4)).toBe(false);
  });

  describe.skipIf(process.platform === 'win32')('with ffmpeg', () => {
    it('converts the WebM to MP4 and removes the raw file', async () => {
      const { raw, targets } = rawRecording();
      const ffmpeg = fakeFfmpeg(dir!, 'exit 0');
      expect(await finalizeRecording(raw, targets, ffmpeg.path)).toEqual({
        file: targets.mp4,
        format: 'mp4',
      });
      expect(existsSync(targets.mp4)).toBe(true);
      expect(existsSync(raw)).toBe(false);
      expect(ffmpeg.calls()).toHaveLength(1);
    });

    it('falls back to mpeg4 when this ffmpeg has no libx264', async () => {
      const { raw, targets } = rawRecording();
      const ffmpeg = fakeFfmpeg(dir!, 'case "$*" in *libx264*) exit 1 ;; esac\nexit 0');
      expect(await finalizeRecording(raw, targets, ffmpeg.path)).toEqual({
        file: targets.mp4,
        format: 'mp4',
      });
      const calls = ffmpeg.calls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain('libx264');
      expect(calls[1]).toContain('mpeg4');
    });

    it('keeps the WebM, removes the partial MP4, and says why, when every encoder fails', async () => {
      const { raw, targets } = rawRecording();
      const ffmpeg = fakeFfmpeg(dir!, "echo 'bad input' >&2\nexit 1");
      expect(await finalizeRecording(raw, targets, ffmpeg.path)).toEqual({
        file: targets.webm,
        format: 'webm',
        cause: 'convert-failed',
        detail: 'bad input',
      });
      expect(existsSync(targets.webm)).toBe(true);
      expect(existsSync(targets.mp4)).toBe(false);
      expect(existsSync(raw)).toBe(false);
      expect(ffmpeg.calls()).toHaveLength(2);
    });
  });

  it('fails with the environment exit code when recording was required', () => {
    const error = new RecordingUnavailableError('Chromium is not installed');
    expect(error.exitCode).toBe(ExitCode.environment);
    expect(error.message).toBe('Flows cannot be recorded: Chromium is not installed');
  });
});

describe('when a page cannot open or be watched', () => {
  const refused = () => Promise.reject(new Error('No page today'));

  it('closes every context it made', async () => {
    let closed = 0;
    const noPages = {
      newContext: async () => ({
        newPage: refused,
        close: async () => {
          closed++;
        },
      }),
    } as unknown as Browser;
    const flow = runFlow(noPages, 'http://127.0.0.1:9', FLOW, 'desktop', (i) => `f-${i}.png`, {
      recordDir: '/nonexistent/rec',
    });
    await expect(flow).rejects.toThrow('No page today');
    // The recorded context, then the unrecorded one.
    expect(closed).toBe(2);
    await expect(
      capturePage(noPages, 'http://127.0.0.1:9/', 'desktop', '/nonexistent/p.png'),
    ).rejects.toThrow('No page today');
    expect(closed).toBe(3);
  });

  it('closes the context and stops the trace when the page cannot be observed', async () => {
    let closed = 0;
    const page = {
      video: () => null,
      on: () => undefined,
      addInitScript: () => Promise.reject(new Error('Init script refused')),
    };
    const unobservable = {
      newContext: async () => ({
        newPage: async () => page,
        close: async () => {
          closed++;
        },
      }),
    } as unknown as Browser;
    const flowTrace = stoppableTrace('http://127.0.0.1:9');
    const outcome = await runFlow(
      unobservable,
      'http://127.0.0.1:9',
      FLOW,
      'desktop',
      (i) => `f-${i}.png`,
      { trace: flowTrace.trace },
    );
    flowTrace.jump();
    expect(outcome.error).toBe('Init script refused');
    expect(closed).toBe(1);
    expect(flowTrace.trace.finish().durationMs).toBeLessThan(60_000);

    const pageTrace = stoppableTrace('http://127.0.0.1:9');
    await expect(
      capturePage(unobservable, 'http://127.0.0.1:9/', 'desktop', 'p.png', pageTrace.trace),
    ).rejects.toThrow('Init script refused');
    pageTrace.jump();
    expect(closed).toBe(2);
    expect(pageTrace.trace.finish().durationMs).toBeLessThan(60_000);
  });
});

describe.skipIf(!browserAvailable)('runFlow with a trace and a recording', () => {
  it('records the flow, traces its steps, requests, console, and DOM changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    browser = await chromium.launch();
    const trace = new TraceCollector(
      {
        id: 'flow-add-one-head',
        scenario: 'flow-add-one',
        kind: 'flow',
        name: 'Add one',
        revision: 'head',
        viewport: 'mobile',
        path: '/',
      },
      { origin: server.url, redactor: new Redactor(), relative: (f) => relative(dir!, f) },
    );
    const outcome = await runFlow(
      browser,
      server.url,
      FLOW,
      'mobile',
      (i) => join(dir!, `f-${i}.png`),
      {
        recordDir: join(dir, 'rec'),
        trace,
      },
    );
    const result = trace.finish({ title: outcome.title });
    expect(outcome.error).toBeUndefined();
    expect(outcome.frames.map((f) => f.step)).toEqual(['s1', 'end']);
    expect(outcome.video).toMatch(/\.webm$/);
    expect(existsSync(outcome.video!)).toBe(true);
    expect(result.title).toBe('Probe');
    expect(result.steps.map((s) => s.id)).toEqual(['open', 's1', 's2', 'end']);
    const s1 = result.steps[1]!;
    expect(s1).toMatchObject({
      action: 'click',
      target: '#add',
      label: 'Add an item',
      screenshot: 'f-0.png',
    });
    // Mobile renders at 2×: the box is in image pixels, like the frame's focus (12 CSS px padding a side).
    const focus = outcome.frames[0]!.focus!;
    expect(Math.abs(focus.width - s1.box!.width - 48)).toBeLessThanOrEqual(1);
    expect(result.mutations.count).toBeGreaterThan(0);
    expect(result.requests).toContainEqual(
      expect.objectContaining({
        method: 'GET',
        url: '/missing.json?token=[REDACTED]',
        status: 404,
        type: 'fetch',
      }),
    );
    expect(result.console).toContainEqual(
      expect.objectContaining({ level: 'error', text: 'Could not load: HTTP 404' }),
    );
  });

  it('runs the flow unrecorded and says why when the recorder cannot start', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    const real = await chromium.launch();
    browser = real;
    // Playwright records with its own ffmpeg build; without it, opening a recorded page fails.
    const noRecorder = {
      newContext: (options?: BrowserContextOptions) =>
        options?.recordVideo
          ? Promise.reject(new Error("Executable doesn't exist at /x/ffmpeg-mac"))
          : real.newContext(options),
    } as unknown as Browser;
    const outcome = await runFlow(
      noRecorder,
      server.url,
      FLOW,
      'desktop',
      (i) => join(dir!, `f-${i}.png`),
      {
        recordDir: join(dir, 'rec'),
      },
    );
    expect(outcome.video).toBeUndefined();
    expect(outcome.recordError).toMatch(/Executable doesn't exist/);
    expect(outcome.frames.length).toBeGreaterThan(0);
  });

  it('closes a recorded context whose page cannot open, and runs the flow unrecorded', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    const real = await chromium.launch();
    browser = real;
    let halfMadeClosed = 0;
    // Playwright's missing-recorder error comes from newPage, after the context exists.
    const recorderFailsOnOpen = {
      newContext: async (options?: BrowserContextOptions) =>
        options?.recordVideo
          ? {
              newPage: () => Promise.reject(new Error("Executable doesn't exist at /x/ffmpeg-mac")),
              close: async () => {
                halfMadeClosed++;
              },
            }
          : real.newContext(options),
    } as unknown as Browser;
    const outcome = await runFlow(
      recorderFailsOnOpen,
      server.url,
      FLOW,
      'desktop',
      (i) => join(dir!, `f-${i}.png`),
      { recordDir: join(dir, 'rec') },
    );
    expect(halfMadeClosed).toBe(1);
    // The demonstration reports this as `recording.status: 'unavailable'` with this detail.
    expect(outcome.video).toBeUndefined();
    expect(outcome.recordError).toMatch(/Executable doesn't exist/);
    expect(outcome.error).toBeUndefined();
    expect(outcome.frames.length).toBeGreaterThan(0);
  });

  it('marks the step that failed, stops the clock, and still returns the recording', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    browser = await chromium.launch();
    const { trace, jump } = stoppableTrace(server.url);
    const broken = {
      name: 'Broken',
      path: '/',
      steps: [{ click: '#add', note: 'Add an item' }, { press: 'NoSuchKey' }, { wait: 300 }],
    };
    const outcome = await runFlow(
      browser,
      server.url,
      broken,
      'desktop',
      (i) => join(dir!, `f-${i}.png`),
      { recordDir: join(dir, 'rec'), trace },
    );
    jump();
    const result = trace.finish();
    expect(outcome.error).toMatch(/NoSuchKey/);
    expect(result.steps.map((s) => [s.id, s.status])).toEqual([
      ['open', 'ok'],
      ['s1', 'ok'],
      ['s2', 'failed'],
    ]);
    expect(result.steps[2]!.error).toMatch(/NoSuchKey/);
    expect(result.durationMs).toBeLessThan(60_000);
    expect(outcome.video).toMatch(/\.webm$/);
    expect(existsSync(outcome.video!)).toBe(true);
  });
});

describe.skipIf(!browserAvailable)('capturePage with a trace', () => {
  it('traces one load step, its requests, the title, and DOM changes within the frame', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-page-'));
    writeFileSync(join(dir, 'index.html'), WIDE);
    server = await serveStatic(dir);
    browser = await chromium.launch();
    const trace = new TraceCollector(
      {
        id: 'page-root-head',
        scenario: 'page-root',
        kind: 'page',
        name: '/',
        revision: 'head',
        viewport: 'desktop',
        path: '/',
      },
      {
        origin: new URL(server.url).origin,
        redactor: new Redactor(),
        relative: (f) => relative(dir!, f),
      },
    );
    const capture = await capturePage(
      browser,
      `${server.url}/`,
      'desktop',
      join(dir, 'page.png'),
      trace,
    );
    const result = trace.finish({ title: capture.title });
    expect(capture.title).toBe('Wide');
    expect(result.title).toBe('Wide');
    expect(result.steps).toEqual([
      expect.objectContaining({ id: 'load', action: 'goto', status: 'ok', screenshot: 'page.png' }),
    ]);
    expect(result.requests).toContainEqual(
      expect.objectContaining({
        step: 'load',
        method: 'GET',
        url: '/',
        status: 200,
        type: 'document',
      }),
    );
    expect(Number.isInteger(result.mutations.count)).toBe(true);
    expect(result.mutations.count).toBeGreaterThan(0);
    expect(result.mutations.regions.length).toBeGreaterThan(0);
    expect(result.mutations.regions.length).toBeLessThanOrEqual(MAX_REGIONS);
    // The banner is 5000 CSS px wide; its change is clipped to the screenshot.
    for (const r of result.mutations.regions) {
      expect(r.x + r.width).toBeLessThanOrEqual(capture.width);
      expect(r.y + r.height).toBeLessThanOrEqual(capture.height);
    }
  });
});
