import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { silentLogger } from '@covi/core';
import type { ProduceVideoInput, ProduceVideoResult } from '@covi/video';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { openSession, reloadChange, type Session } from '../packages/cli/src/session.ts';
import { renderWorkflow } from '../packages/cli/src/workflows.ts';
import { covi } from './helpers/cli.ts';

// The draft renders nothing here. It warns as a render can: once with a warning new to the run,
// and once with one a render before it raised already.
vi.mock('@covi/video', async (original) => {
  const video = await original<typeof import('@covi/video')>();
  return {
    ...video,
    produceVideo: async (input: ProduceVideoInput): Promise<ProduceVideoResult> => {
      input.run.warn('Raised while drafting.');
      input.run.warn('Raised by the render before.');
      return {
        storyboard: input.storyboard as ProduceVideoResult['storyboard'],
        drafted: false,
        narration: { enabled: false, reason: 'not rendered' },
        notes: [],
        video: input.run.path('video/draft/preview.mp4'),
        duration: 1,
        qc: { status: 'pass', checks: [] } as unknown as ProduceVideoResult['qc'],
        draft: { width: 960, height: 540, fps: 15 },
      };
    },
  };
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('a draft render’s warnings', () => {
  it('are what this command raised, its session’s opening included, never the renders’ before it', async () => {
    const example = (await listExamples()).find((e) => e.name === 'bugfix-cli-slugify')!;
    const dir = await materializeExample(example);
    dirs.push(dir);
    const drafted = covi(['video', '--repo', dir, '--draft', '--force', '--json']).json() as {
      runId: string;
      runDir: string;
    };
    // The last real render warned; the run keeps that for the video.
    const runJson = join(drafted.runDir, 'run.json');
    const manifest = JSON.parse(readFileSync(runJson, 'utf8')) as { warnings: string[] };
    manifest.warnings.push('Raised by the render before.');
    writeFileSync(runJson, JSON.stringify(manifest));
    // A command in the repository's configuration, not trusted here: opening the session says so.
    mkdirSync(join(dir, '.covi'), { recursive: true });
    writeFileSync(join(dir, '.covi', 'config.yml'), 'test:\n  command: "node -e 1"\n');
    const opened = await openSession(drafted.runId, {
      repo: dir,
      logger: silentLogger,
      interactive: false,
      explicit: {},
    });
    const change = await reloadChange(opened.run, opened.git.cwd, silentLogger);
    const session = { ...opened, change } as Session;
    const result = await renderWorkflow(session, change, {
      spec: JSON.parse(readFileSync(join(drafted.runDir, 'video', 'decision.json'), 'utf8')).spec,
      draft: true,
    });
    expect(result.warnings.some((w) => /not trusted on this machine yet/.test(w))).toBe(true);
    expect(result.warnings).toContain('Raised while drafting.');
    // A warning the run already had is not news, even raised again: the run keeps one of each.
    expect(result.warnings).not.toContain('Raised by the render before.');
    expect(session.run.manifest.warnings).toContain('Raised by the render before.');
  });
});
