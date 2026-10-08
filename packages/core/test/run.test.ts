import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

  it('in CI, refuses a runs directory a link leads to, and writes nothing there', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const outside = mkdtempSync(join(tmpdir(), 'covi-run-outside-'));
    try {
      mkdirSync(join(root, '.covi'));
      symlinkSync(outside, join(root, '.covi/runs'));
      const refused = Run.create(options({ confined: true }));
      await expect(refused).rejects.toMatchObject({
        name: 'EnvironmentError',
        exitCode: 3,
        message: expect.stringContaining(
          `${join(root, '.covi/runs')} is reached through a symbolic link`,
        ),
      });
      expect(readdirSync(outside)).toEqual([]);
      // A place the user chose is theirs: --out, or a runs directory outside the repository.
      await Run.create(options({ confined: true, dir: join(root, 'out') }));
      await Run.create(options({ confined: true, runsDir: join(outside, 'runs') }));
      // Locally the link is followed, as before.
      await Run.create(options());
      rmSync(join(root, '.covi/runs'));
      await Run.create(options({ confined: true }));
      expect(readFileSync(join(root, '.covi/runs/.gitignore'), 'utf8')).toContain('*');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('replaces links planted in the runs directory instead of writing through them', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const outside = mkdtempSync(join(tmpdir(), 'covi-run-outside-'));
    try {
      const runs = join(root, '.covi/runs');
      mkdirSync(runs, { recursive: true });
      writeFileSync(join(outside, 'precious'), 'keep me\n');
      symlinkSync(join(outside, 'precious'), join(runs, 'LATEST'));
      symlinkSync(join(outside, 'created'), join(runs, '.gitignore'));
      const run = await Run.create(options());
      expect(readFileSync(join(outside, 'precious'), 'utf8')).toBe('keep me\n');
      expect(readdirSync(outside)).toEqual(['precious']);
      expect(lstatSync(join(runs, 'LATEST')).isFile()).toBe(true);
      expect(readFileSync(join(runs, 'LATEST'), 'utf8').trim()).toBe(run.id);
      expect(lstatSync(join(runs, '.gitignore')).isFile()).toBe(true);
      expect(readFileSync(join(runs, '.gitignore'), 'utf8')).toContain('*');
      // A link to nowhere at the run's own path is refused, not followed.
      const at = new Date('2026-10-04T12:00:00Z');
      symlinkSync(join(outside, 'run'), join(runs, '20261004-120000-review-abcdef1'));
      await expect(Run.create(options({ headSha: 'abcdef1234', now: at }))).rejects.toMatchObject({
        name: 'EnvironmentError',
        exitCode: 3,
        message: expect.stringContaining(
          `${join(runs, '20261004-120000-review-abcdef1')} is a symbolic link`,
        ),
      });
      expect(readdirSync(outside)).toEqual(['precious']);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
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

  it('records where a run was published, redacted, and lists it with the run', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(options());
    await run.setPublish({
      platform: 'github',
      repository: 'acme/shop',
      number: 7,
      comment: { id: '42', url: 'https://github.com/acme/shop/pull/7?t=tok-secret-123' },
      at: '2026-10-09T12:00:00.000Z',
    });
    const reopened = await Run.open(run.id, { root });
    expect(reopened.manifest.publish).toMatchObject({
      platform: 'github',
      repository: 'acme/shop',
      number: 7,
      comment: { id: '42' },
    });
    expect(JSON.stringify(reopened.manifest.publish)).not.toContain('tok-secret-123');
    expect((await listRuns(root))[0]!.publish?.number).toBe(7);
  });

  it('drops a publish record that does not fit its schema when listing or opening runs', async () => {
    root = mkdtempSync(join(tmpdir(), 'covi-run-'));
    const run = await Run.create(options());
    const record = {
      platform: 'github' as const,
      repository: 'acme/shop',
      number: 7,
      comment: { id: '42' },
      at: '2026-10-09T12:00:00.000Z',
    };
    // A run directory can come from a downloaded artifact, so run.json says whatever it likes.
    for (const publish of [
      { ...record, repository: '../../elsewhere' },
      { ...record, platform: 'bitbucket' },
      { ...record, comment: { id: '42/../../x' } },
      { ...record, number: -1 },
      { ...record, extra: true },
      'acme/shop#7',
    ]) {
      const manifest = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'));
      writeFileSync(join(run.dir, 'run.json'), JSON.stringify({ ...manifest, publish }));
      const [listed] = await listRuns(root);
      expect(listed!.id).toBe(run.id);
      expect(listed!.publish).toBeUndefined();
      expect((await Run.open(run.id, { root })).manifest.publish).toBeUndefined();
    }
    // A GitLab project known only by its id still counts.
    await run.setPublish({ ...record, platform: 'gitlab', repository: '5' });
    expect((await listRuns(root))[0]!.publish).toMatchObject({
      platform: 'gitlab',
      repository: '5',
    });
    expect((await Run.open(run.id, { root })).manifest.publish?.repository).toBe('5');
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
