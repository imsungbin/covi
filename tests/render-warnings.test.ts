import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProduceVideoInput, ProduceVideoResult } from '@covi/video';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { main } from '../packages/cli/src/main.ts';
import { covi } from './helpers/cli.ts';

// The render renders nothing here. It checks as a render does: the first round fails a check and
// warns about another; the second, after a fix, warns about something else.
const rounds = vi.hoisted(() => ({ count: 0 }));
vi.mock('@covi/video', async (original) => {
  const video = await original<typeof import('@covi/video')>();
  return {
    ...video,
    produceVideo: async (input: ProduceVideoInput): Promise<ProduceVideoResult> => {
      rounds.count++;
      const checks =
        rounds.count === 1
          ? [
              { id: 'overlap', status: 'warn', message: 'Elements collide in s1.' },
              { id: 'out-of-frame', status: 'fail', message: 'Elements are cut off in s2.' },
            ]
          : [{ id: 'still', status: 'warn', message: 'The picture froze in s3.' }];
      for (const c of checks) input.run.warn(`Video QC ${c.status}: ${c.message}`);
      const status = checks.some((c) => c.status === 'fail') ? 'fail' : 'warn';
      return {
        storyboard: input.storyboard as ProduceVideoResult['storyboard'],
        drafted: false,
        narration: { enabled: false, reason: 'not rendered' },
        notes: [],
        video: input.run.path('video/covi-review.mp4'),
        duration: 1,
        qc: { status, checks } as unknown as ProduceVideoResult['qc'],
      };
    },
  };
});

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** `covi <args> --json` in this process, where the render is the one above: its result. */
async function inProcess(args: string[]): Promise<{ warnings: string[] }> {
  let out = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  try {
    await main([...args, '--json']);
  } finally {
    write.mockRestore();
    process.exitCode = undefined;
  }
  return JSON.parse(out) as { warnings: string[] };
}

describe('a render’s warnings', () => {
  it('are the checks of the video it rendered, never the ones of the render before', async () => {
    const example = (await listExamples()).find((e) => e.name === 'bugfix-cli-slugify')!;
    const dir = await materializeExample(example);
    dirs.push(dir);
    const drafted = covi(['video', '--repo', dir, '--draft', '--force', '--json']).json() as {
      runId: string;
      runDir: string;
    };
    // Understanding the change warned, and that stays whatever the renders find.
    const runJson = join(drafted.runDir, 'run.json');
    const read = () =>
      JSON.parse(readFileSync(runJson, 'utf8')) as {
        warnings: string[];
        stages: Array<{ name: string; warnings?: string[] }>;
      };
    const manifest = read();
    const understood = 'Model analysis failed; falling back to built-in heuristics (offline).';
    manifest.warnings.push(understood);
    const understand = manifest.stages.find((s) => s.name === 'understand')!;
    understand.warnings = [...(understand.warnings ?? []), understood];
    writeFileSync(runJson, JSON.stringify(manifest));
    const render = ['render', '--repo', dir, '--run', drafted.runId];

    const first = await inProcess(render);
    expect(first.warnings).toEqual(
      expect.arrayContaining([
        understood,
        'Video QC warn: Elements collide in s1.',
        'Video QC fail: Elements are cut off in s2.',
        'Video QC failed; see video/qc.json.',
      ]),
    );
    // Fixed, and rendered again: only what this render found, beside what understanding found.
    const second = await inProcess(render);
    const stale = [
      'Video QC warn: Elements collide in s1.',
      'Video QC fail: Elements are cut off in s2.',
      'Video QC failed; see video/qc.json.',
    ];
    expect(second.warnings).toContain(understood);
    expect(second.warnings).toContain('Video QC warn: The picture froze in s3.');
    for (const w of stale) expect(second.warnings).not.toContain(w);
    const after = read();
    expect(after.warnings).toContain(understood);
    expect(after.warnings).toContain('Video QC warn: The picture froze in s3.');
    for (const w of stale) expect(after.warnings).not.toContain(w);
    expect(second.warnings).toEqual(after.warnings);
    expect(rounds.count).toBe(2);
  });
});
