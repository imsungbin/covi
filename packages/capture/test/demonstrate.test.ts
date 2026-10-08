import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type BehaviorDiff,
  type EvidenceFile,
  Git,
  parseConfigInput,
  Redactor,
  Run,
  resolveChange,
  resolveConfig,
  type StaticServer,
  serveStatic,
  silentLogger,
  type Trace,
  understandChange,
  which,
} from '@covi/core';
import { chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR_APP,
  BEHAVIOR_CONFIG,
  BEHAVIOR_FLOWS,
  BEHAVIOR_SECRETS,
  RETRY_FLOW,
} from '../../../tests/helpers/behavior-app.ts';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { createChangeRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { demonstrate } from '../src/demonstrate.ts';
import { flowScenario, uniqueIds } from '../src/ids.ts';
import { observeFlow, recordingStatus } from '../src/scenarios.ts';

const browser = await canUseBrowser();
let repo: TempRepo | undefined;
let root: string | undefined;
let server: StaticServer | undefined;
afterEach(async () => {
  await server?.close();
  repo?.cleanup();
  if (root) rmSync(root, { recursive: true, force: true });
  server = undefined;
  repo = undefined;
  root = undefined;
});

async function setup(
  configFor: (repoRoot: string) => unknown | Promise<unknown> = () => BEHAVIOR_CONFIG,
) {
  repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
  const { config } = resolveConfig([
    { name: 'repository', values: parseConfigInput(await configFor(repo.root), 't') },
  ]);
  const change = await resolveChange({ repo: repo.root });
  const context = await understandChange(change, { git: new Git(repo.root), config });
  root = mkdtempSync(join(tmpdir(), 'covi-demo-run-'));
  const run = await Run.create({
    root,
    workflow: 'demo',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: 'test',
    redactor: new Redactor(),
  });
  return { config, change, context, run };
}

/** Every JSON and Markdown file in the run, run.json included, is free of the app's secrets. */
async function expectNoSecrets(run: Run) {
  await run.save();
  const files = readdirSync(run.dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
    /\.(json|md)$/.test(f),
  );
  expect(files).toContain('run.json');
  for (const file of files) {
    const text = readFileSync(join(run.dir, file), 'utf8');
    expect(text, file).not.toContain(BEHAVIOR_SECRETS.session);
    expect(text, file).not.toContain(BEHAVIOR_SECRETS.token);
  }
}

const json = <T>(run: Run, rel: string) => JSON.parse(readFileSync(run.path(rel), 'utf8')) as T;

describe('scenario ids', () => {
  it('gives flows whose names make the same id distinct ids, in order', () => {
    expect(flowScenario('Post comment')).toBe(flowScenario('post-comment'));
    expect(
      uniqueIds(['flow-post-comment', 'flow-post-comment', 'flow-post-comment-2', 'flow-x']),
    ).toEqual(['flow-post-comment', 'flow-post-comment-2', 'flow-post-comment-2-2', 'flow-x']);
  });
});

describe('recording status', () => {
  it('says why recordings are WebM or missing', () => {
    expect(recordingStatus(false, [], 0)).toEqual({ status: 'off' });
    expect(recordingStatus(true, [], 2)).toEqual({ status: 'mp4' });
    expect(recordingStatus(true, [{ status: 'webm', cause: 'no-ffmpeg' }], 2)).toEqual({
      status: 'webm',
      cause: 'no-ffmpeg',
    });
    expect(
      recordingStatus(
        true,
        [
          { status: 'webm', cause: 'no-ffmpeg' },
          { status: 'unavailable', cause: 'no-recorder', detail: 'x' },
        ],
        1,
      ),
    ).toEqual({ status: 'unavailable', cause: 'no-recorder', detail: 'x' });
    expect(recordingStatus(true, [], 0)).toEqual({ status: 'unavailable', cause: 'no-recorder' });
  });
});

describe.skipIf(!browser)('behavior diff capture', () => {
  it('compares a flow at base and head: one changed request and one new console error', async () => {
    const { config, change, context, run } = await setup();
    const ffmpeg = await which(['ffmpeg']);
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      locateFfmpeg: async () => ffmpeg,
    });
    // The changed index.html makes `/` a page to capture too; its added Retry button is a change.
    expect(demo.behavior).toEqual({ path: 'demo/behavior-diff.json', scenarios: 2, changed: 2 });
    const diff = json<BehaviorDiff>(run, 'demo/behavior-diff.json');
    expect(diff.scenarios.map((s) => s.id).sort()).toEqual(['flow-load-items', 'home-desktop']);
    const home = diff.scenarios.find((s) => s.id === 'home-desktop')!;
    expect(home.status).toBe('changed');
    expect(home.steps.map((s) => s.id)).toEqual(['load']);
    expect(home.steps[0]!.regions.length).toBeGreaterThan(0);
    const flow = diff.scenarios.find((s) => s.id === 'flow-load-items')!;
    expect(flow).toMatchObject({
      id: 'flow-load-items',
      kind: 'flow',
      status: 'changed',
      traces: { base: 'flow-load-items-base', head: 'flow-load-items-head' },
    });
    expect(flow.network.changed).toEqual([
      expect.objectContaining({
        key: 'GET /items.json',
        base: expect.objectContaining({ status: 200 }),
        head: expect.objectContaining({ status: 404 }),
      }),
    ]);
    expect(flow.network.added).toEqual([]);
    expect(flow.network.removed).toEqual([]);
    expect(flow.console.added.map((m) => m.text)).toEqual(['Could not load items: HTTP 404']);
    expect(flow.console.removed).toEqual([]);
    const end = flow.steps.find((s) => s.id === 'end')!;
    expect(end.regions.length).toBeGreaterThan(0);
    expect(existsSync(run.path(end.diff!))).toBe(true);

    expect(demo.recordings!.map((r) => r.revision)).toEqual(['base', 'head']);
    for (const r of demo.recordings!) {
      expect(r.path).toMatch(/^demo\/recordings\/flow-load-items-(base|head)\.(mp4|webm)$/);
      expect(existsSync(run.path(r.path))).toBe(true);
    }
    expect(readdirSync(run.path('demo/recordings')).sort()).toEqual(
      demo.recordings!.map((r) => r.path.slice('demo/recordings/'.length)).sort(),
    );
    expect(demo.recording?.status).toBe(ffmpeg ? 'mp4' : 'webm');
    expect(demo.traces!.map((t) => t.path)).toEqual([
      'demo/traces/home-desktop-base.json',
      'demo/traces/home-desktop-head.json',
      'demo/traces/flow-load-items-base.json',
      'demo/traces/flow-load-items-head.json',
    ]);
    const recorded = new Map(run.manifest.artifacts.map((a) => [a.path, a]));
    for (const path of [
      ...demo.recordings!.map((r) => r.path),
      'demo/traces/flow-load-items-base.json',
      'demo/traces/flow-load-items-head.json',
      'demo/behavior-diff.json',
    ])
      expect(recorded.get(path)?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.get(demo.recordings![0]!.path)?.kind).toBe('recording');
    expect(recorded.get('demo/traces/flow-load-items-head.json')?.kind).toBe('trace');
    expect(recorded.get('demo/behavior-diff.json')?.kind).toBe('behavior-diff');
    // Each flow frame carries the base frame of the same step.
    const steps = demo.shots.filter((s) => s.kind === 'flow-step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.before?.path.endsWith('-base.png'))).toBe(true);
    expect(demo.findings).toEqual([]);
    // Everything the run captured is evidence a claim can cite, and every file it names exists.
    const evidence = json<EvidenceFile>(run, 'evidence.json');
    const byId = new Map(evidence.items.map((i) => [i.id, i]));
    for (const id of [
      'screenshot:home-desktop-after',
      'pixel-diff:home-desktop#load',
      'pixel-diff:flow-load-items#end',
      'trace:flow-load-items-base',
      'trace:flow-load-items-head',
      'recording:flow-load-items-head',
    ])
      expect(byId.has(id), id).toBe(true);
    expect(byId.get('pixel-diff:flow-load-items#end')!.refs).toContain(
      'pixel-diff:flow-load-items#end.r1',
    );
    const traceRefs = byId.get('trace:flow-load-items-head')!.refs ?? [];
    expect(traceRefs).toContain('trace:flow-load-items-head#end');
    expect(traceRefs.some((r) => /#n\d+$/.test(r))).toBe(true);
    for (const item of evidence.items) expect(existsSync(run.path(item.path)), item.id).toBe(true);
    await expectNoSecrets(run);
  });

  it('keeps secrets out of every file, does not record when off, and tolerates a flow that fails at base', async () => {
    const { config, change, context, run } = await setup(() => ({
      ...BEHAVIOR_CONFIG,
      demo: { ...BEHAVIOR_CONFIG.demo, flows: [...BEHAVIOR_FLOWS, RETRY_FLOW] },
    }));
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      recording: { enabled: false, required: false },
    });
    expect(demo.recording).toEqual({ status: 'off' });
    expect(demo.recordings).toBeUndefined();
    await expectNoSecrets(run);
    const head = json<Trace>(run, 'demo/traces/flow-load-items-head.json');
    expect(head.requests).toContainEqual(
      expect.objectContaining({ url: '/items.json?session=[REDACTED]', status: 404 }),
    );
    expect(head.console.map((m) => m.text)).toContain('debug token ghp_[REDACTED]');
    // The Retry button only exists at head: base stopping there is expected, not a finding.
    expect(demo.findings.filter((f) => f.source?.id === 'flow-failure')).toEqual([]);
    const retry = json<BehaviorDiff>(run, 'demo/behavior-diff.json').scenarios.find(
      (s) => s.id === 'flow-retry',
    )!;
    expect(retry.status).toBe('changed');
    expect(retry.failure?.base).toBeTruthy();
    expect(retry.steps[0]).toMatchObject({ id: 's1', base: 'failed', head: 'ok' });
  });

  it('leaves a flow unrecorded, not failed, when its video cannot be saved', async () => {
    const { run } = await setup();
    server = await serveStatic(repo!.root);
    const recordings = run.path('demo/recordings');
    const browserInstance = await chromium.launch();
    try {
      const observed = await observeFlow({
        run,
        browser: browserInstance,
        baseUrl: server.url,
        flow: BEHAVIOR_FLOWS[0]!,
        scenario: 'flow-load-items',
        viewport: 'desktop',
        revision: 'head',
        record: true,
        // Asked for while saving: the WebM Playwright wrote disappears first.
        ffmpeg: async () => {
          for (const entry of await readdir(recordings, { recursive: true }))
            if (entry.endsWith('.webm')) await rm(join(recordings, entry));
          return undefined;
        },
      });
      expect(observed.recording).toBeUndefined();
      expect(observed.note).toEqual({
        status: 'unavailable',
        cause: 'save-failed',
        detail: expect.stringContaining('ENOENT'),
      });
      expect(observed.note?.detail).not.toContain(run.dir);
      expect(observed.trace.recording).toBeUndefined();
      expect(existsSync(run.path('demo/traces/flow-load-items-head.json'))).toBe(true);
      // Playwright's own directory for the flow is gone, recorded or not.
      expect(readdirSync(recordings)).toEqual([]);
    } finally {
      await browserInstance.close();
    }
  });

  it('says nothing about recording when no flow ran because the app never started', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { start: 'exit 1', timeout: 5 },
      demo: { viewports: ['desktop'], flows: BEHAVIOR_FLOWS },
    }));
    const demo = await demonstrate({ run, change, context, config, logger: silentLogger });
    expect(demo.skipped.length).toBeGreaterThan(0);
    expect(demo.recordings).toBeUndefined();
    expect(demo.recording).toBeUndefined();
    // The start-up error is kept, and the head's app-start finding cites it.
    expect(demo.findings.find((f) => f.source?.id === 'app-start')?.evidenceIds).toEqual([
      'terminal:app-start-head',
    ]);
    const ids = json<EvidenceFile>(run, 'evidence.json').items.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining(['terminal:app-start-base', 'terminal:app-start-head']),
    );
    expect(existsSync(run.path('demo/app-head.log'))).toBe(true);
  });

  it('cites the head trace of a flow that breaks at head', async () => {
    const broken = { name: 'Broken', path: '/', steps: [{ click: '#missing', note: 'Missing' }] };
    const { config, change, context, run } = await setup(() => ({
      ...BEHAVIOR_CONFIG,
      demo: { ...BEHAVIOR_CONFIG.demo, flows: [broken] },
    }));
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      recording: { enabled: false, required: false },
    });
    const failure = demo.findings.find((f) => f.source?.id === 'flow-failure')!;
    expect(failure.evidenceIds).toEqual(['trace:flow-broken-head']);
    const ids = new Set(json<EvidenceFile>(run, 'evidence.json').items.map((i) => i.id));
    expect(ids.has('trace:flow-broken-head')).toBe(true);
  });

  it('records and traces only the head for an app given by URL, and writes no behavior diff', async () => {
    const { config, change, context, run } = await setup(async (repoRoot) => {
      server = await serveStatic(repoRoot);
      return { app: { url: server.url }, demo: { viewports: ['desktop'], flows: BEHAVIOR_FLOWS } };
    });
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      // A locator that fails counts as no ffmpeg: the recording is kept as WebM.
      locateFfmpeg: () => Promise.reject(new Error('which failed')),
    });
    expect(demo.recording).toEqual({ status: 'webm', cause: 'no-ffmpeg' });
    expect(demo.recordings?.map((r) => r.format)).toEqual(['webm']);
    expect(demo.app?.mode).toBe('url');
    expect(demo.behavior).toBeUndefined();
    expect(existsSync(run.path('demo/behavior-diff.json'))).toBe(false);
    expect(demo.recordings?.map((r) => r.revision)).toEqual(['head']);
    expect(demo.traces?.map((t) => t.path)).toEqual([
      'demo/traces/home-desktop-head.json',
      'demo/traces/flow-load-items-head.json',
    ]);
  });
});
