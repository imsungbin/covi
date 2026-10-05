import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfigInput, resolveConfig } from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  layoutScenes,
  Media,
  renderComposition,
  resolveVideoSpec,
  runQc,
  StoryboardSchema,
  syntheticMouth,
  writeComposition,
} from '@covi/video';
import { chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../../packages/cli/src/examples.ts';
import { canRenderVideo, fullRenders } from '../helpers/env.ts';

const available = await canRenderVideo();
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const storyboard = StoryboardSchema.parse({
  title: 'Clamp cart quantities at zero',
  template: 'bug-fix',
  scenes: [
    {
      id: 's1',
      beat: 'context',
      narration: 'This change clamps cart quantities at zero.',
      visual: { kind: 'title', title: 'Clamp cart quantities at zero', meta: ['acme/shop'] },
    },
    {
      id: 's2',
      beat: 'fix',
      eyebrow: 'The fix',
      heading: 'src/cart.js',
      narration: 'The fix lives in decrement.',
      visual: {
        kind: 'code',
        path: 'src/cart.js',
        language: 'javascript',
        lines: [
          { type: 'del', text: 'qty = qty - 1;' },
          { type: 'add', text: 'qty = Math.max(0, qty - 1);' },
        ],
        highlight: [1],
      },
    },
    {
      id: 's3',
      beat: 'summary',
      narration: 'Overall, this looks good to merge.',
      visual: {
        kind: 'summary',
        verdict: 'looks-good',
        headline: 'Clamp cart quantities',
        points: ['Quantity never goes negative'],
      },
    },
  ],
});

describe.skipIf(!available)('rendering', () => {
  it('renders a composition to H.264 with captions inside the safe area', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-render-'));
    dirs.push(dir);
    const { config } = resolveConfig([
      {
        name: 'explicit',
        values: parseConfigInput(
          { video: { mode: 'custom', width: 360, height: 640, fps: 12, duration: 8 } },
          't',
        ),
      },
    ]);
    const spec = resolveVideoSpec(config);
    const layout = layoutScenes(storyboard.scenes, new Map());
    const frames = Math.round(layout.duration * spec.fps);
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: storyboard.scenes,
      layout,
      spec,
      image: new AssetCollector(dir).image,
      mouth: syntheticMouth(
        layout.scenes.map((s) => ({ start: s.speechStart, end: s.speechEnd })),
        spec.fps,
        frames,
      ),
    });
    await writeComposition(join(dir, 'composition'), timeline, new Map());
    const media = await Media.locate();
    const out = join(dir, 'video.mp4');
    const result = await renderComposition({
      compositionDir: join(dir, 'composition'),
      output: out,
      timeline,
      media,
      workers: 2,
    });
    expect(result.frames).toBe(frames);
    expect(result.pageErrors).toEqual([]);
    const probe = await media.probe(out);
    expect(probe).toMatchObject({ width: 360, height: 640, videoCodec: 'h264', pixFmt: 'yuv420p' });
    expect(Math.abs(probe.duration - timeline.duration)).toBeLessThan(0.2);
    const qc = await runQc({
      video: out,
      spec,
      timeline,
      layouts: result.layouts,
      narrated: false,
      media,
    });
    const failing = qc.checks.filter((c) => c.status === 'fail' && c.id !== 'duration');
    expect(failing).toEqual([]);
    expect(readFileSync(result.contactSheet!).length).toBeGreaterThan(1000);
  });

  it('is deterministic: the same timeline renders the same frame bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-det-'));
    dirs.push(dir);
    const spec = resolveVideoSpec(resolveConfig([]).config, {
      mode: 'custom',
      width: 320,
      height: 320,
    });
    const layout = layoutScenes(storyboard.scenes, new Map());
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: storyboard.scenes,
      layout,
      spec,
      image: new AssetCollector(dir).image,
    });
    for (const name of ['a', 'b']) await writeComposition(join(dir, name), timeline, new Map());
    expect(readFileSync(join(dir, 'a', 'index.html'), 'utf8')).toBe(
      readFileSync(join(dir, 'b', 'index.html'), 'utf8'),
    );
    const browser = await chromium.launch();
    try {
      const shots: Buffer[] = [];
      for (const name of ['a', 'b']) {
        const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
        await page.goto(`file://${join(dir, name, 'index.html')}`);
        await page.waitForFunction('window.covi !== undefined');
        await page.evaluate('window.covi.ready');
        await page.evaluate('window.covi.seek(40)');
        shots.push(await page.screenshot({ type: 'png' }));
        await page.close();
      }
      expect(shots[0]!.equals(shots[1]!)).toBe(true);
    } finally {
      await browser.close();
    }
  });
});

describe.skipIf(!available || !fullRenders)('covi video (full pipeline)', () => {
  for (const [example, flags] of [
    ['ui-comment-composer', ['--short', '--duration', '30s']],
    ['api-users-pagination', ['--standard']],
  ] as const) {
    it(`renders ${example}`, async () => {
      const dir = await materializeExample((await listExamples()).find((e) => e.name === example)!);
      dirs.push(dir);
      const out = execFileSync(
        'node',
        ['bin/covi.mjs', 'video', '--repo', dir, ...flags, '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 },
      );
      const result = JSON.parse(out) as {
        video: { rendered: boolean; qc: string; seconds: number };
      };
      expect(result.video.rendered).toBe(true);
      expect(result.video.qc).not.toBe('fail');
    }, 600_000);
  }
});
