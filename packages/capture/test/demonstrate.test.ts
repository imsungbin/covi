import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  type BehaviorDiff,
  type Demonstration,
  type EvidenceFile,
  emptySubject,
  Git,
  indexEvidence,
  loadSubjectSnapshot,
  mergeSubject,
  openSubject,
  parseConfigInput,
  Redactor,
  Run,
  resolveChange,
  resolveConfig,
  type StaticServer,
  SUBJECT_PATHS,
  SubjectSchema,
  serveStatic,
  silentLogger,
  type Trace,
  understandChange,
  which,
} from '@covi/core';
import { chromium } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BEHAVIOR_APP,
  BEHAVIOR_CONFIG,
  BEHAVIOR_FLOWS,
  BEHAVIOR_SECRETS,
  RETRY_FLOW,
} from '../../../tests/helpers/behavior-app.ts';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { createChangeRepo, type FileMap, type TempRepo } from '../../../tests/helpers/repo.ts';
import { demonstrate } from '../src/demonstrate.ts';
import { flowScenario, uniqueIds } from '../src/ids.ts';
import { RecordingUnavailableError } from '../src/recording.ts';
import { observeFlow, recordingStatus } from '../src/scenarios.ts';

// Counts element scans, which only head captures that feed a subject model should pay for.
const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/elements.ts', async (original) => {
  const actual = await original<typeof import('../src/elements.ts')>();
  return {
    ...actual,
    scanPage: (...args: Parameters<typeof actual.scanPage>) => {
      scans.count++;
      return actual.scanPage(...args);
    },
  };
});

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
  extra: { base: FileMap; head: FileMap } = { base: {}, head: {} },
) {
  repo = createChangeRepo(
    { ...BEHAVIOR_APP.base, ...extra.base },
    { ...BEHAVIOR_APP.head, ...extra.head },
  );
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

/**
 * Every id a demo finding cites is in the run's evidence. A finding citing an id that drifted would
 * be demoted to a risk by the review and silently stop failing a CI gate.
 */
function expectCitedEvidence(run: Run, findings: Demonstration['findings']) {
  const index = indexEvidence(json<EvidenceFile>(run, 'evidence.json'));
  for (const f of findings) {
    expect(f.evidenceIds?.length, f.source?.id).toBeGreaterThan(0);
    for (const id of f.evidenceIds!) expect(index.find(id), `${f.source?.id}: ${id}`).toBeDefined();
  }
}

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
    expectCitedEvidence(run, demo.findings);
    expect(existsSync(run.path('demo/app-head.log'))).toBe(true);
  });

  it('cites evidence the run has in every finding it makes, a broken flow its head trace', async () => {
    const broken = { name: 'Broken', path: '/', steps: [{ click: '#missing', note: 'Missing' }] };
    const page = (body: string) => `<!doctype html><title>Page</title><p>Page</p>${body}\n`;
    const { config, change, context, run } = await setup(
      () => ({
        ...BEHAVIOR_CONFIG,
        demo: {
          ...BEHAVIOR_CONFIG.demo,
          flows: [broken],
          pages: ['/gone.html', '/boom.html'],
          requests: [{ name: 'Data', path: '/data.json' }],
          // items.json is gone at head.
          commands: [{ name: 'Items', run: 'test -f items.json' }],
        },
      }),
      {
        base: {
          'gone.html': page(''),
          'boom.html': page(''),
          'data.json': '{"items": ["Apples"]}\n',
        },
        head: {
          'gone.html': null,
          'boom.html': page("<script>throw new Error('boom')</script>"),
          'data.json': '{"list": ["Apples"]}\n',
        },
      },
    );
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      recording: { enabled: false, required: false },
    });
    expect([...new Set(demo.findings.map((f) => f.source?.id))].sort()).toEqual([
      'api-shape',
      'command-failure',
      'flow-failure',
      'page-error',
      'page-status',
    ]);
    const failure = demo.findings.find((f) => f.source?.id === 'flow-failure')!;
    expect(failure.evidenceIds).toEqual(['trace:flow-broken-head']);
    expectCitedEvidence(run, demo.findings);
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

describe.skipIf(!browser)('the subject model', () => {
  const off = { enabled: false, required: false };
  const open = (config: Parameters<typeof openSubject>[0]['config'], runsRoot = root!) =>
    openSubject({ root: repo!.root, runsRoot, config, warn: () => {} });
  const nextRun = () =>
    Run.create({
      root: root!,
      workflow: 'demo',
      entryPoint: 'cli',
      interactive: false,
      coviVersion: 'test',
      redactor: new Redactor(),
    });

  it('replays a flow the subject model saw when the plan names none, and keeps secrets out of it', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    const first = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      plan: { flows: BEHAVIOR_FLOWS },
      subject: await open(config),
      recording: off,
    });
    // Compared with base, the page keeps its pixel diff's focus (or none): the model adds nothing.
    expect(first.subject).toEqual({
      store: 'repo',
      proposed: [],
      focused: [],
      flows: [{ name: 'Load items', outcome: 'kept' }],
      path: 'demo/subject.json',
      saved: true,
    });
    const file = join(repo!.root, SUBJECT_PATHS.repo);
    const stored = SubjectSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(stored.revisions).toEqual([change.head.sha.slice(0, 12)]);
    expect(stored.flows.map((f) => [f.key, f.name, f.steps.map((s) => s.action)])).toEqual([
      ['load-items', 'Load items', BEHAVIOR_FLOWS[0]!.steps],
    ]);
    expect(stored.screens.find((s) => s.key === 'home')!.elements.map((e) => e.key)).toContain(
      'load',
    );
    for (const secret of Object.values(BEHAVIOR_SECRETS))
      expect(readFileSync(file, 'utf8')).not.toContain(secret);

    const again = await nextRun();
    const second = await demonstrate({
      run: again,
      change,
      context,
      config,
      logger: silentLogger,
      subject: await open(config),
      recording: off,
    });
    expect(second.subject).toMatchObject({ proposed: ['Load items'], saved: true });
    expect(second.traces?.map((t) => t.id)).toContain('flow-load-items-head');
    const snapshot = await loadSubjectSnapshot(again);
    const home = snapshot!.images.find((i) => i.path === 'demo/screenshots/home-desktop-after.png');
    expect(home!.elements.map((e) => e.key)).toContain('load');
    // The replayed flow's head frames are indexed too, never its base ones.
    expect(snapshot!.images.some((i) => i.path.includes('flow-load-items'))).toBe(true);
    expect(snapshot!.images.every((i) => !i.path.includes('-base'))).toBe(true);
    await expectNoSecrets(again);
  });

  it('reports a replayed flow that fails at head as a risk, not a likely regression', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    const revision = change.head.sha.slice(0, 12);
    const stale = mergeSubject(
      emptySubject(),
      {
        revision,
        screens: [],
        flows: [
          {
            name: 'Missing',
            path: '/',
            viewport: 'desktop',
            steps: [{ action: { click: '#missing' } }],
            passed: true,
          },
        ],
        commands: [],
      },
      { expireAfter: 20 },
    );
    mkdirSync(join(repo!.root, '.covi/subject'), { recursive: true });
    writeFileSync(join(repo!.root, SUBJECT_PATHS.repo), JSON.stringify(stale));
    const result = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      subject: await open(config),
      recording: off,
    });
    expect(result.subject?.proposed).toEqual(['Missing']);
    expect(result.subject?.flows).toEqual([{ name: 'Missing', outcome: 'failed' }]);
    expect(result.findings.find((f) => f.source?.id === 'flow-failure')).toMatchObject({
      certainty: 'risk',
    });
  });

  it('focuses a head-only capture on what the model had not seen, and replays nothing on an app it did not start', async () => {
    const base = mkdtempSync(join(tmpdir(), 'covi-demo-base-'));
    for (const [name, text] of Object.entries(BEHAVIOR_APP.base)) {
      if (text === null) continue;
      mkdirSync(dirname(join(base, name)), { recursive: true });
      writeFileSync(join(base, name), text);
    }
    const baseServer = await serveStatic(base);
    try {
      const { config, change, context, run } = await setup(async (repoRoot) => {
        server = await serveStatic(repoRoot);
        return { app: { url: server.url }, demo: { viewports: ['desktop'], pages: ['/'] } };
      });
      // The model first sees the page as it was, without the Retry button, and a flow on it.
      const before = resolveConfig([
        {
          name: 'repository',
          values: parseConfigInput(
            {
              app: { url: baseServer.url },
              demo: { viewports: ['desktop'], pages: ['/'], flows: BEHAVIOR_FLOWS },
            },
            't',
          ),
        },
      ]).config;
      // ...at the base commit: what is new is judged against what the model knew before head.
      const first = await demonstrate({
        run,
        change: { ...change, head: { ...change.head, sha: change.base.sha } },
        context,
        config: before,
        logger: silentLogger,
        subject: await open(before),
        recording: off,
      });
      expect(first.subject).toMatchObject({ focused: [], saved: true });

      const again = await nextRun();
      const second = await demonstrate({
        run: again,
        change,
        context,
        config,
        logger: silentLogger,
        subject: await open(config),
        recording: off,
      });
      expect(second.app?.mode).toBe('url');
      // The model has a flow on this page, but Covi does not drive a site it did not start unasked.
      expect(second.subject?.proposed).toEqual([]);
      expect(second.traces?.map((t) => t.kind)).toEqual(['page']);
      expect(second.subject?.focused).toEqual(['home-desktop']);
      const shot = second.shots.find((s) => s.id === 'home-desktop')!;
      expect(shot.before).toBeUndefined();
      expect(shot.focus).toBeDefined();
      expect(shot.focus!.width * shot.focus!.height).toBeLessThan(
        (shot.after!.width * shot.after!.height) / 2,
      );
      const captures = json<Demonstration>(again, 'demo/captures.json');
      expect(captures.shots.find((s) => s.id === 'home-desktop')!.focus).toEqual(shot.focus);
      // The second run saved the Retry button; a third at the same commit (`covi video` after
      // `covi demo`) still sees it as new at head, and focuses the same way.
      const third = await demonstrate({
        run: await nextRun(),
        change,
        context,
        config,
        logger: silentLogger,
        subject: await open(config),
        recording: off,
      });
      expect(third.subject?.focused).toEqual(['home-desktop']);
      expect(third.shots.find((s) => s.id === 'home-desktop')!.focus).toEqual(shot.focus);
    } finally {
      await baseServer.close();
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('finishes the demonstration with a warning when the model cannot be kept', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'], flows: BEHAVIOR_FLOWS },
    }));
    // The lock cannot be made: its directory is a file.
    const blocked = join(root!, 'blocked');
    writeFileSync(blocked, '');
    const result = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      subject: await open(config, blocked),
      recording: off,
    });
    expect(result.subject).toMatchObject({ store: 'repo', saved: false });
    expect(run.manifest.warnings.some((w) => w.includes('subject model'))).toBe(true);
    expect(existsSync(run.path('demo/captures.json'))).toBe(true);
    expect(existsSync(run.path('evidence.json'))).toBe(true);
    expect(result.shots.length).toBeGreaterThan(0);
  });

  /** A model that saw "Load items" pass at head, in the repository's store. */
  const remember = (revision: string) => {
    const model = mergeSubject(
      emptySubject(),
      {
        revision,
        screens: [],
        flows: [
          {
            name: 'Load items',
            path: '/',
            viewport: 'desktop',
            steps: BEHAVIOR_FLOWS[0]!.steps.map((action) => ({ action })),
            passed: true,
          },
        ],
        commands: [],
      },
      { expireAfter: 20 },
    );
    mkdirSync(join(repo!.root, '.covi/subject'), { recursive: true });
    writeFileSync(join(repo!.root, SUBJECT_PATHS.repo), JSON.stringify(model));
  };

  it('lists as replayed only the flows that ran', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { start: 'node server.js' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    remember(change.head.sha.slice(0, 12));
    // The app may not start here, so the flow the model proposes never runs.
    const result = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      execution: { allowed: false, reason: 'not here', withheld: [] },
      subject: await open(config),
      recording: off,
    });
    expect(result.app).toBeUndefined();
    expect(result.traces).toBeUndefined();
    expect(result.subject?.proposed).toEqual([]);
  });

  it('never fails a run over the recording of a flow nobody asked for', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    remember(change.head.sha.slice(0, 12));
    // Asked for while saving: the WebM Playwright wrote disappears first, so no recording is kept.
    const losesRecordings = (of: Run) => async () => {
      const recordings = of.path('demo/recordings');
      for (const entry of await readdir(recordings, { recursive: true }))
        if (entry.endsWith('.webm')) await rm(join(recordings, entry));
      return undefined;
    };
    const required = { enabled: true, required: true };
    const replayed = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      subject: await open(config),
      recording: required,
      locateFfmpeg: losesRecordings(run),
    });
    expect(replayed.subject?.proposed).toEqual(['Load items']);
    expect(replayed.recording?.status).toBe('unavailable');
    // The same flow, asked for, still requires its recording.
    const again = await nextRun();
    await expect(
      demonstrate({
        run: again,
        change,
        context,
        config,
        logger: silentLogger,
        plan: { flows: BEHAVIOR_FLOWS },
        recording: required,
        locateFfmpeg: losesRecordings(again),
      }),
    ).rejects.toBeInstanceOf(RecordingUnavailableError);
  });

  it('scans only what head shows, and only for a model', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    scans.count = 0;
    const result = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      plan: { flows: BEHAVIOR_FLOWS },
      subject: await open(config),
      recording: off,
    });
    expect(result.traces?.map((t) => t.id).sort()).toEqual([
      'flow-load-items-base',
      'flow-load-items-head',
      'home-desktop-base',
      'home-desktop-head',
    ]);
    const frames = await readdir(run.path('demo/screenshots'));
    const headFrames = frames.filter((f) => /^flow-load-items-\d+\.png$/.test(f)).length;
    expect(headFrames).toBeGreaterThan(0);
    expect(frames.some((f) => /^flow-load-items-\d+-base\.png$/.test(f))).toBe(true);
    // The head page and each head frame; nothing at base.
    expect(scans.count).toBe(1 + headFrames);
  });

  it('demonstrates as before without a subject model', async () => {
    const { config, change, context, run } = await setup(() => ({
      app: { static: '.' },
      demo: { viewports: ['desktop'], pages: ['/'] },
    }));
    scans.count = 0;
    const result = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      recording: off,
    });
    expect(result.subject).toBeUndefined();
    expect(scans.count).toBe(0);
    expect(existsSync(run.path('demo/subject.json'))).toBe(false);
    expect(existsSync(join(repo!.root, SUBJECT_PATHS.repo))).toBe(false);
  });
});
