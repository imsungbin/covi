import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type BehaviorDiff,
  type ConfigLayer,
  type Demonstration,
  type DemoRecordingStatus,
  normalizeFinding,
  parseConfigInput,
  resolveConfig,
} from '@covi/core';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { recordingOf, renderDemo } from '../packages/cli/src/workflows.ts';
import { BEHAVIOR_APP } from './helpers/behavior-app.ts';
import { covi } from './helpers/cli.ts';
import { canUseBrowser } from './helpers/env.ts';
import { createChangeRepo } from './helpers/repo.ts';

const browser = await canUseBrowser();
const examples = await listExamples();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function demo(name: string, args: string[] = []): Promise<Demonstration> {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  dirs.push(dir);
  const result = covi(['demo', '--repo', dir, '--json', ...args]);
  expect(result.code).toBe(0);
  return (result.json() as { data: { demo: Demonstration } }).data.demo;
}

describe('demonstrations', () => {
  it('replays a CLI command at base and head', async () => {
    const result = await demo('bugfix-cli-slugify');
    expect(result.commands[0]).toMatchObject({
      changed: true,
      before: { output: 'h-llo--w-rld---a-va-' },
      after: { output: 'hello-world-ca-va' },
    });
  });

  it.skipIf(!browser)(
    'runs the app at both revisions and turns an observed response change into a confirmed finding',
    async () => {
      const result = await demo('api-users-pagination');
      expect(result.app?.mode).toBe('command');
      expect(result.requests[0]).toMatchObject({
        method: 'GET',
        path: '/api/users',
        changed: true,
        before: { status: 200 },
        after: { status: 200 },
      });
      expect(result.requests[0]!.shapeChange).toMatch(/from a JSON array to a JSON object/);
      expect(result.findings).toEqual([
        expect.objectContaining({
          certainty: 'confirmed',
          severity: 'high',
          category: 'api-compatibility',
        }),
      ]);
      // Written in Korean, the finding keeps its id: SARIF and GitLab track findings by id.
      const korean = await demo('api-users-pagination', ['--language', 'ko']);
      expect(korean.findings[0]!.title).toMatch(/\p{Script=Hangul}/u);
      const ids = (d: Demonstration) =>
        d.findings.map((f) => normalizeFinding(f, { kind: 'demo' }).id);
      expect(ids(korean)).toEqual(ids(result));
    },
  );

  it.skipIf(!browser)('captures a scripted flow step by step on a static site', async () => {
    const result = await demo('ui-comment-composer');
    const steps = result.shots.filter((s) => s.kind === 'flow-step');
    expect(steps.map((s) => s.label)).toEqual([
      'Type a comment',
      'Counter updates as you type',
      'Post the comment',
      'Write a comment',
    ]);
    expect(steps[0]!.click).toBeDefined();
    expect(steps[0]!.focus).toBeDefined();
    const page = result.shots.find((s) => s.kind === 'page')!;
    expect(page.before && page.after).toBeTruthy();
  });

  it.skipIf(!browser)('captures before/after at each viewport and locates the change', async () => {
    const result = await demo('visual-pricing-cards');
    const pages = result.shots.filter((s) => s.kind === 'page');
    expect(pages.map((s) => s.viewport).sort()).toEqual(['desktop', 'mobile']);
    for (const shot of pages) {
      expect(shot.diff!.changedRatio).toBeGreaterThan(0.01);
      expect(shot.focus).toBeDefined();
      expect(shot.after!.width).toBe(shot.viewport === 'mobile' ? 780 : 1280);
    }
  });

  it('says why it skipped when there is nothing to show', async () => {
    const result = await demo('refactor-retry-helper');
    expect(result.shots).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/Nothing user-visible changes/);
  });
});

describe('recording', () => {
  it('is required only when someone asked for it', () => {
    const of = (...layers: ConfigLayer[]) => {
      const resolved = resolveConfig(layers);
      return recordingOf({ config: resolved.config, resolved });
    };
    const record = (value: boolean) => parseConfigInput({ demo: { record: value } }, 't');
    expect(of()).toEqual({ enabled: true, required: false });
    expect(of({ name: 'workflow', values: record(true) })).toEqual({
      enabled: true,
      required: false,
    });
    expect(of({ name: 'repository', source: '.covi/config.yml', values: record(true) })).toEqual({
      enabled: true,
      required: true,
    });
    expect(of({ name: 'explicit', source: 'command line', values: record(false) })).toEqual({
      enabled: false,
      required: false,
    });
  });

  it('says when a recording was made but could not be saved', () => {
    const demo: Demonstration = {
      schemaVersion: 1,
      shots: [],
      commands: [],
      requests: [],
      skipped: [],
      findings: [],
      recording: { status: 'unavailable', cause: 'save-failed', detail: 'EACCES demo/recordings' },
    };
    expect(renderDemo(demo)).toContain(
      'Flows were recorded, but a recording could not be saved: `EACCES demo/recordings`',
    );
  });

  const EMPTY: Demonstration = {
    schemaVersion: 1,
    shots: [],
    commands: [],
    requests: [],
    skipped: [],
    findings: [],
  };

  it.each<[DemoRecordingStatus, string]>([
    [
      { status: 'webm', cause: 'no-ffmpeg' },
      'Recordings are WebM because ffmpeg was not found. Install ffmpeg, or set COVI_FFMPEG, to get MP4.',
    ],
    [
      { status: 'webm', cause: 'convert-failed', detail: 'Unknown encoder' },
      'Recordings are WebM because converting them to MP4 failed: `Unknown encoder`',
    ],
    [
      { status: 'webm', cause: 'convert-failed' },
      'Recordings are WebM because converting them to MP4 failed.',
    ],
    [
      { status: 'unavailable', cause: 'no-recorder', detail: 'ENOSPC' },
      'Flows were not recorded because the browser did not record them: `ENOSPC`',
    ],
    [
      { status: 'unavailable', cause: 'no-recorder' },
      'Flows were not recorded because the browser did not record them.',
    ],
    [
      { status: 'unavailable', cause: 'save-failed', detail: 'EACCES' },
      'Flows were recorded, but a recording could not be saved: `EACCES`',
    ],
    [
      { status: 'unavailable', cause: 'save-failed' },
      'Flows were recorded, but a recording could not be saved.',
    ],
  ])('explains %o in a sentence', (recording, sentence) => {
    const notes = renderDemo({ ...EMPTY, recording });
    expect(notes.split('\n')).toContain(sentence);
    expect(notes).not.toContain(recording.cause!);
    expect(notes).not.toContain('``');
  });

  it('names the revision in the language of the notes', () => {
    const scenario = (id: string, extra: Partial<BehaviorDiff['scenarios'][number]>) => ({
      id,
      kind: 'flow' as const,
      name: id,
      viewport: 'desktop' as const,
      status: 'incomplete' as const,
      traces: {},
      steps: [],
      network: { added: [], removed: [], changed: [] },
      console: { added: [], removed: [] },
      timing: { totalMs: {}, steps: [] },
      ...extra,
    });
    const behavior: BehaviorDiff = {
      schemaVersion: 1,
      scenarios: [
        scenario('only-base', { missing: 'head', failure: { base: 'Timeout' } }),
        scenario('only-head', { missing: 'base' }),
      ],
      summary: { scenarios: 2, changed: 0, unchanged: 0, incomplete: 2 },
    };
    const demo: Demonstration = {
      ...EMPTY,
      recordings: (['base', 'head'] as const).map((revision) => ({
        id: `flow-x-${revision}`,
        scenario: 'flow-x',
        flow: 'X',
        revision,
        viewport: 'desktop',
        path: `demo/recordings/flow-x-${revision}.mp4`,
        format: 'mp4',
        width: 1280,
        height: 800,
        seconds: 1,
      })),
      recording: { status: 'mp4' },
    };
    const ko = renderDemo(demo, 'ko', behavior);
    expect(ko).toContain('- X(베이스): [');
    expect(ko).toContain('- X(헤드): [');
    expect(ko).toContain('비교하지 못했습니다: 베이스에서만 실행했습니다.');
    expect(ko).toContain('비교하지 못했습니다: 헤드에서만 실행했습니다.');
    expect(ko).toContain('베이스에서 실패했습니다: `Timeout`');
    const en = renderDemo(demo, 'en', behavior);
    expect(en).toContain('- X at base: [');
    expect(en).toContain('Not compared: it ran only at base.');
    expect(en).toContain('Failed at base: `Timeout`');
  });

  it('never calls a step that looks different 0.00% changed', () => {
    const behavior: BehaviorDiff = {
      schemaVersion: 1,
      scenarios: [
        {
          id: 'home-desktop',
          kind: 'page',
          name: '/',
          viewport: 'desktop',
          status: 'changed',
          traces: { base: 'home-desktop-base', head: 'home-desktop-head' },
          // 64 pixels of a full-page capture three viewports tall.
          steps: [
            {
              id: 'load',
              base: 'ok',
              head: 'ok',
              changedRatio: 0.00002,
              regions: [{ id: 'r1', x: 0, y: 0, width: 8, height: 8 }],
            },
          ],
          network: { added: [], removed: [], changed: [] },
          console: { added: [], removed: [] },
          timing: { totalMs: {}, steps: [] },
        },
      ],
      summary: { scenarios: 1, changed: 1, unchanged: 0, incomplete: 0 },
    };
    expect(renderDemo(EMPTY, 'en', behavior)).toContain(
      'The page looks different: <0.01% of pixels changed.',
    );
  });

  it('keeps reviewing without a browser, and exits 3 only when recording was asked for', () => {
    const repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
    dirs.push(repo.root);
    const empty = mkdtempSync(join(tmpdir(), 'covi-no-browser-'));
    dirs.push(empty);
    // An empty browsers directory: Playwright finds no Chromium.
    const env = { PLAYWRIGHT_BROWSERS_PATH: empty };
    const quiet = covi(['review', '--demo', '--repo', repo.root, '--json'], { env });
    expect(quiet.code).toBe(0);
    expect((quiet.json().warnings as string[]).join('\n')).toMatch(/Demonstration failed/);
    const asked = covi(['review', '--demo', '--record', '--repo', repo.root, '--json'], { env });
    expect(asked.code).toBe(3);
    expect(String(asked.json().error)).toMatch(/Flows cannot be recorded/);
  });

  it.skipIf(!browser)('writes the behavior section to demo.md and honors --no-record', () => {
    const repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
    dirs.push(repo.root);
    const result = covi(['demo', '--no-record', '--repo', repo.root, '--json']);
    expect(result.code).toBe(0);
    const json = result.json() as unknown as {
      data: { demo: Demonstration };
      artifacts: Record<string, string>;
      runDir: string;
    };
    expect(json.data.demo.recording).toEqual({ status: 'off' });
    expect(json.data.demo.recordings).toBeUndefined();
    expect(existsSync(json.artifacts.behaviorDiff!)).toBe(true);
    const notes = readFileSync(json.artifacts.demo!, 'utf8');
    expect(notes).toContain('## Behavior at base and head');
    expect(notes).toContain(
      '- `GET /items.json?session=[REDACTED]`: HTTP 200 at base, HTTP 404 at head',
    );
    expect(notes).toContain('- New console error: `Could not load items: HTTP 404`');
    const manifest = JSON.parse(readFileSync(join(json.runDir, 'run.json'), 'utf8'));
    expect(manifest.config.provenance['demo.record']).toBe('explicit (command line)');
  });
});
