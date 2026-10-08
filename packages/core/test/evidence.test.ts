import { describe, expect, it } from 'vitest';
import { buildEvidence, diffHunkEvidence, evidenceFiles } from '../src/evidence/build.ts';
import { evidenceId, evidencePart } from '../src/evidence/ids.ts';
import type { BehaviorDiff, Trace } from '../src/model/behavior.ts';
import type { Hunk } from '../src/model/change.ts';
import type { Demonstration } from '../src/model/demo.ts';
import { EVIDENCE_LIMITS, EvidenceFileSchema } from '../src/model/evidence.ts';
import { demoPath, RUN_PATHS } from '../src/run/paths.ts';

const hunk = (oldStart: number, oldLines: number, newStart: number, newLines: number): Hunk => ({
  oldStart,
  oldLines,
  newStart,
  newLines,
  lines: [{ kind: 'add', text: 'x', newLine: newStart }],
});

const DEMO = {
  schemaVersion: 1,
  shots: [
    {
      id: 'home-desktop',
      kind: 'page',
      name: '/',
      viewport: 'desktop',
      before: { path: 'demo/screenshots/home-desktop-before.png', width: 10, height: 10 },
      after: { path: 'demo/screenshots/home-desktop-after.png', width: 10, height: 10 },
    },
  ],
  commands: [
    {
      name: 'Help',
      command: 'node cli.js --help',
      before: { exitCode: 0, output: 'a' },
      after: { exitCode: 0, output: 'b' },
      changed: true,
    },
  ],
  requests: [
    {
      name: 'Users',
      method: 'GET',
      path: '/api/users',
      after: { status: 200, body: '[]' },
      changed: true,
    },
  ],
  skipped: [],
  findings: [],
  recordings: (['base', 'head'] as const).map((revision) => ({
    id: `flow-post-${revision}`,
    scenario: 'flow-post',
    flow: 'Post',
    revision,
    viewport: 'desktop' as const,
    path: `demo/recordings/flow-post-${revision}.mp4`,
    format: 'mp4' as const,
    width: 1280,
    height: 800,
    seconds: 2,
  })),
  traces: [
    {
      id: 'flow-post-head',
      scenario: 'flow-post',
      kind: 'flow',
      revision: 'head',
      path: 'demo/traces/flow-post-head.json',
    },
  ],
} satisfies Demonstration;

const TRACE = {
  schemaVersion: 1,
  id: 'flow-post-head',
  scenario: 'flow-post',
  kind: 'flow',
  name: 'Post',
  revision: 'head',
  viewport: 'desktop',
  path: '/',
  durationMs: 10,
  steps: [
    { id: 'open', action: 'goto', t: 0, durationMs: 1, status: 'ok' },
    { id: 'end', action: 'end', t: 1, durationMs: 1, status: 'ok' },
  ],
  requests: [{ id: 'n1', method: 'GET', url: '/api', type: 'fetch', startMs: 1 }],
  console: [{ id: 'c1', level: 'error', source: 'console', text: 'x', tMs: 2 }],
  mutations: { count: 0, regions: [] },
} satisfies Trace;

const BEHAVIOR = {
  schemaVersion: 1,
  summary: { scenarios: 1, changed: 1, unchanged: 0, incomplete: 0 },
  scenarios: [
    {
      id: 'home-desktop',
      kind: 'page',
      name: '/',
      viewport: 'desktop',
      status: 'changed',
      traces: {},
      steps: [
        {
          id: 'load',
          base: 'ok',
          head: 'ok',
          changedRatio: 0.1,
          diff: 'demo/diffs/home-desktop.png',
          regions: [{ id: 'r1', x: 0, y: 0, width: 5, height: 5 }],
        },
      ],
      network: { added: [], removed: [], changed: [] },
      console: { added: [], removed: [] },
      timing: { totalMs: {}, steps: [] },
    },
  ],
} satisfies BehaviorDiff;

describe('evidence ids', () => {
  it('writes ids anyone reading the diff or the captures can form', () => {
    expect(evidenceId.hunk('src/a b.ts', 12)).toBe('diff-hunk:src/a b.ts:12');
    expect(evidenceId.screenshot('demo/screenshots/flow-post-03-base.png')).toBe(
      'screenshot:flow-post-03-base',
    );
    expect(evidenceId.recording('flow-post-head')).toBe('recording:flow-post-head');
    expect(evidencePart.trace('flow-post-head', 'n2')).toBe('trace:flow-post-head#n2');
    expect(evidencePart.region('flow-post', 'end', 'r1')).toBe('pixel-diff:flow-post#end.r1');
    expect(evidenceId.appStart('head')).toBe('terminal:app-start-head');
    expect(evidenceId.testRun()).toBe('test-run:tests');
    expect(RUN_PATHS.evidence).toBe('evidence.json');
    expect(demoPath.appLog('base')).toBe('demo/app-base.log');
  });
});

describe('diffHunkEvidence', () => {
  it('names a hunk by its file and the + start of its header, and locates it', () => {
    const items = diffHunkEvidence([
      { path: 'src/cart.ts', hunks: [hunk(10, 3, 10, 5), hunk(40, 2, 42, 0), hunk(60, 0, 61, 1)] },
      { path: 'old.ts', hunks: [hunk(1, 4, 0, 0)] },
    ]);
    expect(items.map((i) => [i.id, i.label, i.location])).toEqual([
      [
        'diff-hunk:src/cart.ts:10',
        'src/cart.ts:10-14',
        { path: 'src/cart.ts', line: 10, endLine: 14, side: 'head' },
      ],
      [
        'diff-hunk:src/cart.ts:42',
        'src/cart.ts:40-41 (base)',
        { path: 'src/cart.ts', line: 40, endLine: 41, side: 'base' },
      ],
      [
        'diff-hunk:src/cart.ts:61',
        'src/cart.ts:61',
        { path: 'src/cart.ts', line: 61, endLine: 61, side: 'head' },
      ],
      [
        'diff-hunk:old.ts:0',
        'old.ts:1-4 (base)',
        { path: 'old.ts', line: 1, endLine: 4, side: 'base' },
      ],
    ]);
    for (const item of items)
      expect(item).toMatchObject({
        kind: 'diff-hunk',
        path: 'diff.patch',
        revision: 'both',
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
  });

  it('skips a hunk with no lines on either side', () => {
    expect(diffHunkEvidence([{ path: 'a.ts', hunks: [hunk(0, 0, 0, 0)] }])).toEqual([]);
  });

  it('skips a hunk whose id would be too long to cite', () => {
    const longest = 'a'.repeat(EVIDENCE_LIMITS.id - 'diff-hunk::1'.length);
    const items = diffHunkEvidence([
      { path: longest, hunks: [hunk(1, 1, 1, 1)] },
      { path: `${longest}b`, hunks: [hunk(1, 1, 1, 1)] },
    ]);
    expect(items.map((i) => i.location?.path)).toEqual([longest]);
    expect(EvidenceFileSchema.safeParse({ schemaVersion: 1, items }).success).toBe(true);
  });
});

describe('buildEvidence', () => {
  const present = new Set([
    'demo/screenshots/home-desktop-before.png',
    'demo/screenshots/home-desktop-after.png',
    'demo/diffs/home-desktop.png',
    'demo/recordings/flow-post-head.mp4',
    'demo/traces/flow-post-head.json',
    'demo/app-head.log',
    'tests.log',
  ]);
  const fileSha = (path: string) => (present.has(path) ? 'a'.repeat(64) : undefined);

  it('lists what the run captured that still exists, with citable parts', () => {
    const evidence = buildEvidence({
      demo: DEMO,
      traces: [TRACE],
      behavior: BEHAVIOR,
      tests: { command: 'npm test' },
      fileSha,
    });
    expect(EvidenceFileSchema.parse(evidence)).toEqual(evidence);
    const byId = new Map(evidence.items.map((i) => [i.id, i]));
    // The base recording is not in the run any more, so it is not evidence.
    expect([...byId.keys()]).toEqual([
      'screenshot:home-desktop-before',
      'screenshot:home-desktop-after',
      'pixel-diff:home-desktop#load',
      'recording:flow-post-head',
      'trace:flow-post-head',
      'http:1',
      'terminal:1',
      'terminal:app-start-head',
      'test-run:tests',
    ]);
    expect(byId.get('screenshot:home-desktop-before')).toMatchObject({
      kind: 'screenshot',
      revision: 'base',
      label: '/ (desktop) · base',
      sha256: 'a'.repeat(64),
    });
    expect(byId.get('pixel-diff:home-desktop#load')).toMatchObject({
      revision: 'both',
      refs: ['pixel-diff:home-desktop#load.r1'],
    });
    expect(byId.get('trace:flow-post-head')!.refs).toEqual([
      'trace:flow-post-head#open',
      'trace:flow-post-head#end',
      'trace:flow-post-head#n1',
      'trace:flow-post-head#c1',
    ]);
    expect(byId.get('http:1')).toMatchObject({
      path: 'demo/captures.json',
      revision: 'head',
      label: 'GET /api/users',
    });
    expect(byId.get('terminal:1')).toMatchObject({ revision: 'both', label: 'node cli.js --help' });
    expect(byId.get('terminal:app-start-head')).toMatchObject({
      path: 'demo/app-head.log',
      revision: 'head',
      label: 'app-start · head',
    });
    expect(byId.get('test-run:tests')).toMatchObject({
      path: 'tests.log',
      revision: 'head',
      label: 'npm test',
    });
  });

  it('keeps the first of two items with the same id', () => {
    const twice = [
      { path: 'a.ts', hunks: [hunk(1, 1, 1, 1)] },
      { path: 'a.ts', hunks: [hunk(1, 1, 1, 1)] },
    ];
    expect(buildEvidence({ diff: twice }).items.map((i) => i.id)).toEqual(['diff-hunk:a.ts:1']);
  });

  it('redacts labels and keeps them within the label limit when redaction lengthens them', () => {
    const secret = 'tok123';
    const command = `${secret} `.repeat(28).trim();
    expect(command.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.label);
    const evidence = buildEvidence({
      demo: { ...DEMO, commands: [{ ...DEMO.commands[0]!, command }] },
      redact: (text) => text.split(secret).join('[REDACTED]'),
    });
    const label = evidence.items.find((i) => i.id === 'terminal:1')!.label;
    expect(label).not.toContain(secret);
    expect(label.startsWith('[REDACTED] [REDACTED]')).toBe(true);
    expect(label).toHaveLength(EVIDENCE_LIMITS.label);
    expect(EvidenceFileSchema.safeParse(evidence).success).toBe(true);
  });

  it('leaves out items and parts whose ids or paths are too long to cite', () => {
    const long = 'x'.repeat(EVIDENCE_LIMITS.id);
    const evidence = buildEvidence({
      demo: {
        ...DEMO,
        recordings: [{ ...DEMO.recordings[1]!, id: long }],
        traces: [{ ...DEMO.traces[0]!, path: `demo/traces/${long}.json` }],
      },
      behavior: {
        ...BEHAVIOR,
        scenarios: [
          {
            ...BEHAVIOR.scenarios[0]!,
            steps: [
              {
                ...BEHAVIOR.scenarios[0]!.steps[0]!,
                regions: [
                  { id: 'r1', x: 0, y: 0, width: 5, height: 5 },
                  { id: long, x: 0, y: 0, width: 5, height: 5 },
                ],
              },
            ],
          },
        ],
      },
      fileSha: () => 'a'.repeat(64),
    });
    expect(EvidenceFileSchema.safeParse(evidence).success).toBe(true);
    const ids = evidence.items.map((i) => i.id);
    expect(ids.some((id) => id.startsWith('recording:') || id.startsWith('trace:'))).toBe(false);
    expect(evidence.items.find((i) => i.kind === 'pixel-diff')!.refs).toEqual([
      'pixel-diff:home-desktop#load.r1',
    ]);
  });

  it('names every file it may hash, so the run can hash them first', () => {
    expect(evidenceFiles({ demo: DEMO, behavior: BEHAVIOR })).toEqual([
      'demo/screenshots/home-desktop-before.png',
      'demo/screenshots/home-desktop-after.png',
      'demo/diffs/home-desktop.png',
      'demo/recordings/flow-post-base.mp4',
      'demo/recordings/flow-post-head.mp4',
      'demo/traces/flow-post-head.json',
      'demo/app-base.log',
      'demo/app-head.log',
      'tests.log',
    ]);
  });
});
