import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
