import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('fails with the environment exit code when recording was required', () => {
    const error = new RecordingUnavailableError('Chromium is not installed');
    expect(error.exitCode).toBe(ExitCode.environment);
    expect(error.message).toBe('Flows cannot be recorded: Chromium is not installed');
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
