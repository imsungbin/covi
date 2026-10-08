import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfigInput, resolveConfig } from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  layoutScenes,
  Media,
  OUTRO_ID,
  pacingFor,
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
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
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
    // With the outro: the summary's fox glides over to sign off.
    const layout = layoutScenes(storyboard.scenes, new Map(), new Map(), 'en', pacingFor(spec));
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
    // The outro is the last scene; its frames were sampled, and its text fits.
    expect(timeline.scenes.at(-1)!.visual.kind).toBe('outro');
    const outro = result.layouts.filter((l) => l.scene === OUTRO_ID);
    expect(outro.length).toBe(2);
    for (const report of outro) expect(report.items.some((i) => i.overflow)).toBe(false);
    expect(qc.checks.find((c) => c.id === 'text-fits')!.status).toBe('pass');
    // In the code scene the narrator points at the highlighted line: its tail reaches past its
    // box into empty space, and QC measures the fox as drawn.
    const box = computeRegions(timeline).narrator;
    const pointing = result.layouts.filter((l) => l.scene === 's2' && l.narratorParts);
    expect(pointing.length).toBeGreaterThan(0);
    expect(pointing.some((l) => l.narrator!.x < box.x - 0.05 * box.size)).toBe(true);
    expect(qc.checks.find((c) => c.id === 'narrator-clear-of-content')!.status).toBe('pass');
  });

  const CJK = {
    ko: [
      '이 변경은 장바구니 수량이 0 아래로 내려가지 않게 합니다. CLI 테스트도 추가했습니다.',
      '장바구니 수량을 0에서 멈춥니다',
    ],
    ja: [
      'この変更は、カートの数量がゼロ未満にならないようにします。CLIのテストも追加しました。',
      'カートの数量をゼロで止める',
    ],
    zh: [
      '这个改动让购物车数量不会低于零。还为命令行工具 CLI 添加了测试，“结算”按钮保持不变。',
      '购物车数量最低为零',
    ],
  } as const;

  /** Renders a short Japanese or Chinese video; `breakFonts` deletes its Noto slices first. */
  async function renderCjk(language: keyof typeof CJK, options: { breakFonts?: boolean } = {}) {
    const [narration, title] = CJK[language];
    const dir = mkdtempSync(join(tmpdir(), `covi-render-${language}-`));
    dirs.push(dir);
    const { config } = resolveConfig([
      {
        name: 'explicit',
        values: parseConfigInput(
          { video: { mode: 'custom', width: 360, height: 640, fps: 10, duration: 8 } },
          't',
        ),
      },
    ]);
    const spec = resolveVideoSpec(config);
    const scenes = StoryboardSchema.parse({
      ...storyboard,
      language,
      title,
      scenes: storyboard.scenes.map((s, i) =>
        i === 0
          ? { ...s, narration, visual: { kind: 'title', title, meta: ['acme/shop'] } }
          : i === 2
            ? { ...s, narration, visual: { ...s.visual, headline: title } }
            : s,
      ),
    }).scenes;
    // The outro carries the sign-off in the video's language; its text must fit too.
    const layout = layoutScenes(scenes, new Map(), new Map(), language, pacingFor(spec));
    const timeline = buildTimeline({
      title,
      scenes,
      layout,
      spec,
      image: new AssetCollector(dir).image,
      language,
    });
    const composition = join(dir, 'composition');
    await writeComposition(composition, timeline, new Map());
    const html = readFileSync(join(composition, 'index.html'), 'utf8');
    const fonts = join(composition, 'assets', 'fonts');
    if (options.breakFonts)
      for (const file of readdirSync(fonts))
        if (file.startsWith('noto-sans-')) rmSync(join(fonts, file));
    const media = await Media.locate();
    const out = join(dir, 'video.mp4');
    const result = await renderComposition({
      compositionDir: composition,
      output: out,
      timeline,
      media,
      workers: 2,
    });
    const qc = await runQc({
      video: out,
      spec,
      timeline,
      layouts: result.layouts,
      narrated: false,
      media,
    });
    return { timeline, html, result, qc };
  }

  const LANG = { ko: 'ko', ja: 'ja', zh: 'zh-Hans' } as const;
  const NOTO = {
    ko: 'Noto Sans KR Variable',
    ja: 'Noto Sans JP Variable',
    zh: 'Noto Sans SC Variable',
  };
  for (const language of ['ko', 'ja', 'zh'] as const) {
    it(`renders ${language} captions and the outro inside the frame with the bundled fonts`, async () => {
      const { timeline, html, result, qc } = await renderCjk(language);
      expect(timeline.fonts.cjk?.[0]).toBe(language);
      expect(html).toContain(`<html lang="${LANG[language]}">`);
      expect(html).toContain(NOTO[language]);
      expect(timeline.labels?.signOff).toMatch(/Covi/);
      expect(result.layouts.filter((l) => l.scene === OUTRO_ID).length).toBe(2);
      expect(result.pageErrors).toEqual([]);
      const failing = qc.checks.filter((c) => c.status === 'fail' && c.id !== 'duration');
      expect(failing).toEqual([]);
      expect(qc.checks.find((c) => c.id === 'text-fits')!.status).toBe('pass');
      expect(qc.checks.find((c) => c.id === 'fonts')!.status).toBe('pass');
    });
  }

  it('fails QC when a bundled font does not load', async () => {
    const { qc } = await renderCjk('ja', { breakFonts: true });
    const fonts = qc.checks.find((c) => c.id === 'fonts')!;
    expect(fonts.status).toBe('fail');
    expect(fonts.message).toMatch(/Noto Sans JP Variable did not load/);
  });

  it('opens on a title over a capture: in place at frame 0, the capture drifting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-open-'));
    dirs.push(dir);
    const browser = await chromium.launch();
    try {
      // A landscape capture to open on.
      const capture = await browser.newPage({ viewport: { width: 640, height: 400 } });
      await capture.setContent('<body style="margin:0;background:#2a6f97"></body>');
      mkdirSync(join(dir, 'demo'));
      await capture.screenshot({ path: join(dir, 'demo', 'a.png') });
      await capture.close();
      const spec = resolveVideoSpec(resolveConfig([]).config, {
        mode: 'custom',
        width: 360,
        height: 640,
      });
      const scenes = StoryboardSchema.parse({
        ...storyboard,
        scenes: storyboard.scenes.map((s, i) =>
          i === 0
            ? {
                ...s,
                visual: {
                  kind: 'title',
                  title: 'Clamp cart quantities at zero',
                  eyebrow: 'The bug',
                  meta: [],
                  background: { path: 'demo/a.png' },
                },
              }
            : s,
        ),
      }).scenes;
      const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
      const assets = new AssetCollector(dir);
      await assets.prepare(['demo/a.png']);
      const timeline = buildTimeline({
        title: storyboard.title,
        scenes,
        layout,
        spec,
        image: assets.image,
      });
      const composition = join(dir, 'composition');
      await writeComposition(composition, timeline, assets.files);
      const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
      await page.goto(`file://${join(composition, 'index.html')}`);
      await page.waitForFunction('window.covi !== undefined');
      await page.evaluate('window.covi.ready');
      // The tests have no DOM types: the page reads its own styles from a script.
      const look = (frame: number) =>
        page.evaluate(`(() => {
          window.covi.seek(${frame});
          const scene = document.querySelector('[data-scene="s1"]');
          const style = (selector) => scene.querySelector(selector)?.style;
          return {
            capture: style('.layer > .frame')?.opacity,
            heading: scene.querySelector('.scene-header .heading')?.textContent,
            headingOpacity: style('.scene-header .heading')?.opacity,
            eyebrowOpacity: style('.scene-header .eyebrow')?.opacity,
            panel: scene.querySelector('.title-panel') !== null,
            camera: style('.layer')?.transform,
          };
        })()`) as Promise<Record<string, unknown>>;
      // Frame 0 already shows the capture and its title, settled.
      expect(await look(0)).toEqual({
        capture: '1',
        heading: 'Clamp cart quantities at zero',
        headingOpacity: '1',
        eyebrowOpacity: '1',
        panel: false,
        camera: '',
      });
      // The stage's camera drifts the capture, as on a screenshot.
      const s1 = timeline.scenes[0]!;
      const middle = await look(Math.round(((s1.start + s1.end) / 2) * timeline.fps));
      expect(middle.camera).toMatch(/^scale\(1\.0\d+\)$/);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it('is deterministic: the same timeline renders the same frame bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-det-'));
    dirs.push(dir);
    const spec = resolveVideoSpec(resolveConfig([]).config, {
      mode: 'custom',
      width: 320,
      height: 320,
    });
    // Korean text loads its font slices lazily by unicode-range; rendering must not depend on it.
    const korean = storyboard.scenes.map((scene) => ({
      ...scene,
      narration: '이 변경은 장바구니 수량이 0 아래로 내려가지 않게 합니다.',
    }));
    const layout = layoutScenes(korean, new Map(), new Map(), 'ko', pacingFor(spec));
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: korean,
      layout,
      spec,
      image: new AssetCollector(dir).image,
      language: 'ko',
    });
    // A frame mid-handoff, as the summary's fox glides into the outro, renders the same too.
    const handoff = Math.round((layout.outro!.start + 0.3) * timeline.fps);
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
        for (const frame of [40, handoff]) {
          await page.evaluate(`window.covi.seek(${frame})`);
          shots.push(await page.screenshot({ type: 'png' }));
        }
        await page.close();
      }
      expect(shots[0]!.equals(shots[2]!)).toBe(true);
      expect(shots[1]!.equals(shots[3]!)).toBe(true);
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
