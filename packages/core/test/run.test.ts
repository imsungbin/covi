import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PATHS, demoPath } from '../src/run/paths.ts';
import { listRuns, pruneRuns, Run } from '../src/run/run.ts';
import { Redactor } from '../src/security/redact.ts';

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

const options = (extra: Partial<Parameters<typeof Run.create>[0]> = {}) => ({
  root,
  workflow: 'review',
  entryPoint: 'cli' as const,
  interactive: false,
  coviVersion: '0.0.0-test',
  redactor: new Redactor({ literals: ['tok-secret-123'] }),
  ...extra,
});

describe('Run', () => {
  it('creates a run directory, manifest, LATEST pointer, and a self-ignoring runs directory', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(
      options({ headSha: 'abcdef1234', now: new Date('2026-10-04T12:00:00Z') }),
    );
    expect(run.id).toBe('20261004-120000-review-abcdef1');
    expect(readFileSync(join(root, '.covi/runs/LATEST'), 'utf8').trim()).toBe(run.id);
    expect(readFileSync(join(root, '.covi/runs/.gitignore'), 'utf8')).toContain('*');
    const reopened = await Run.open('latest', { root });
    expect(reopened.dir).toBe(run.dir);
  });

  it('discards a stale artifact and its record', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(options());
    await run.writeJson('video/audio.json', { a: 1 }, 'audio');
    await run.writeText('video/notes.md', 'x', 'narration');
    await run.discard('video/audio.json');
    await run.discard('video/missing.wav');
    expect(await run.has('video/audio.json')).toBe(false);
    expect(run.manifest.artifacts.map((a) => a.path)).toEqual(['video/notes.md']);
  });

  it('records stages, artifacts with hashes, commands, and redacts secrets', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(options());
    await run.stage('understand', async () => {
      await run.writeJson('context.json', { note: 'uses tok-secret-123' }, 'context');
    });
    await expect(
      run.stage('render', async () =>
        Promise.reject(new Error('ffmpeg failed with tok-secret-123')),
      ),
    ).rejects.toThrow();
    run.recordCommand({
      command: 'npm test --token=tok-secret-123',
      cwd: '.',
      exitCode: 0,
      durationMs: 5,
      timedOut: false,
      purpose: 'test',
    });
    await run.skip('video', 'not worth a video');
    await run.finish({ status: 'partial', exitCode: 0 });

    const manifest = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'));
    expect(
      manifest.stages.map((s: { name: string; status: string }) => `${s.name}:${s.status}`),
    ).toEqual(['understand:ok', 'render:failed', 'video:skipped']);
    expect(manifest.artifacts[0]).toMatchObject({ path: 'context.json', kind: 'context' });
    expect(manifest.artifacts[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toContain('tok-secret-123');
    expect(readFileSync(join(run.dir, 'context.json'), 'utf8')).not.toContain('tok-secret-123');
    expect(manifest.outcome).toMatchObject({ status: 'partial' });
  });

  it('refuses artifact paths that escape the run directory', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(options());
    expect(() => run.path('../../etc/passwd')).toThrow(/escapes/);
    // A sibling whose name starts with the run's name is still outside it.
    expect(() => run.path(`../${run.id}-evil/x.json`)).toThrow(/escapes/);
    expect(run.path('video/storyboard.json')).toBe(join(run.dir, 'video/storyboard.json'));
  });

  it('lists and prunes old runs, keeping the newest', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    for (let i = 0; i < 4; i++) {
      await Run.create(options({ now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }));
    }
    expect(await listRuns(root)).toHaveLength(4);
    const removed = await pruneRuns(join(root, '.covi/runs'), 2);
    expect(removed).toHaveLength(2);
    const remaining = await listRuns(root);
    expect(remaining.map((r) => r.id)).toEqual([
      '20260101-000003-review',
      '20260101-000002-review',
    ]);
  });
});

describe('demo paths', () => {
  it('names every file a scenario produces inside demo/', () => {
    expect(demoPath.trace('flow-load-items', 'base')).toBe('demo/traces/flow-load-items-base.json');
    expect(demoPath.recording('flow-load-items', 'head', 'mp4')).toBe(
      'demo/recordings/flow-load-items-head.mp4',
    );
    expect(demoPath.recording('flow-load-items', 'base', 'webm')).toBe(
      'demo/recordings/flow-load-items-base.webm',
    );
    // Head frames keep the names they had before flows also ran at base.
    expect(demoPath.flowFrame('flow-load-items', 3, 'head')).toBe(
      'demo/screenshots/flow-load-items-03.png',
    );
    expect(demoPath.flowFrame('flow-load-items', 3, 'base')).toBe(
      'demo/screenshots/flow-load-items-03-base.png',
    );
    expect(demoPath.rawRecordingDir('flow-load-items', 'head')).toBe(
      'demo/recordings/.flow-load-items-head',
    );
    expect(demoPath.stepDiff('flow-load-items', 'end')).toBe('demo/diffs/flow-load-items-end.png');
    expect(demoPath.pageFull('home-desktop', 'base')).toBe(
      'demo/screenshots/home-desktop-base.full.png',
    );
    expect(demoPath.pageCrop('home-desktop', 'after')).toBe(
      'demo/screenshots/home-desktop-after.png',
    );
    expect(demoPath.pageDiff('home-desktop')).toBe('demo/diffs/home-desktop.png');
    for (const path of Object.values(DEMO_PATHS)) expect(path.startsWith('demo/')).toBe(true);
  });
});
