import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Demonstration, parseConfigInput, resolveConfig } from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  densityChecks,
  type LayoutReport,
  layoutChecks,
  layoutScenes,
  Media,
  OUTRO_ID,
  pacingFor,
  renderComposition,
  resolveVideoSpec,
  runQc,
  type StoryboardInput,
  StoryboardSchema,
  syntheticMouth,
  type Timeline,
  TRANSITION_MIN,
  TRANSITION_SHARE,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../../packages/cli/src/examples.ts';
import { DirectionSchema } from '../../packages/video/src/direction/schema.ts';
import { contactSheetFrames, sheetColumns } from '../../packages/video/src/render/renderer.ts';
import { tileLayout } from '../../packages/video/src/render/sheet.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import { TEXT_FLOOR } from '../../packages/video/src/runtime/sizing.ts';
import {
  edgeEntrance,
  edgeLabelEntrance,
  interactionTiming,
  morphTiming,
  screenshotMarks,
  settledFrame,
} from '../../packages/video/src/timeline/cues.ts';
import type { TimelineVisual } from '../../packages/video/src/timeline/types.ts';
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
  it('keeps the layout reports in frame order, however the frames are split between workers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-layouts-'));
    dirs.push(dir);
    const { config } = resolveConfig([
      {
        name: 'explicit',
        values: parseConfigInput(
          { video: { mode: 'custom', width: 426, height: 240, fps: 12, duration: 8 } },
          't',
        ),
      },
    ]);
    const spec = resolveVideoSpec(config);
    const layout = layoutScenes(storyboard.scenes, new Map(), new Map(), 'en', pacingFor(spec));
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: storyboard.scenes,
      layout,
      spec,
      image: new AssetCollector(dir).image,
    });
    await writeComposition(join(dir, 'composition'), timeline, new Map());
    const media = await Media.locate();
    // The last frame of the first worker's share and the first of the last's: split three ways,
    // the later frame is sampled long before the earlier one.
    const third = Math.floor(timeline.frames / 3);
    const layoutFrames = [third - 1, third, timeline.frames - 1];
    const render = (workers: number) =>
      renderComposition({
        compositionDir: join(dir, 'composition'),
        output: join(dir, `video-${workers}.mp4`),
        timeline,
        media,
        workers,
        layoutFrames,
      });
    const split = await render(3);
    const alone = await render(1);
    expect(split.layouts.map((l) => l.frame)).toEqual(layoutFrames);
    // What frames.json keeps of them is byte for byte the same.
    expect(JSON.stringify(split.layouts)).toBe(JSON.stringify(alone.layouts));
  });

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
    // Every render is checked for small text, empty frames, and monotony.
    expect(qc.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety']),
    );
    expect(readFileSync(result.contactSheet!).length).toBeGreaterThan(1000);
    // Each tile is the frame with its label in a band below it: the label never covers the
    // captions, and the sheet is as tall as frames plus bands.
    const { label } = tileLayout(360, 640);
    const captioned = result.layouts.filter((l) => l.captions);
    expect(captioned.length).toBeGreaterThan(0);
    for (const l of captioned) {
      const c = l.captions!;
      expect(c.y + c.height, `frame ${l.frame}`).toBeLessThanOrEqual(label.y);
    }
    const tiles = contactSheetFrames(timeline).length;
    const rows = Math.ceil(tiles / sheetColumns(tiles, true));
    const tile = (320 * (640 + label.height)) / 360;
    const sheet = await media.probe(result.contactSheet!);
    expect(sheet.width).toBe(12 + sheetColumns(tiles, true) * (320 + 12));
    expect(Math.abs(sheet.height! - (12 + rows * (tile + 12)))).toBeLessThanOrEqual(rows * 2);
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

  /** Opens a composition whose first scene is a title over a landscape capture. */
  async function openOn(browser: Browser, title: string) {
    const dir = mkdtempSync(join(tmpdir(), 'covi-open-'));
    dirs.push(dir);
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
                title,
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
          narrator: document.querySelector('.narrator').style.transform.replace(/^.* scale/, 'scale'),
        };
      })()`) as Promise<Record<string, unknown>>;
    const report = () => page.evaluate('window.covi.layout()') as Promise<LayoutReport>;
    return { timeline, look, report };
  }

  it('opens on a title over a capture: in place at frame 0, the capture drifting', async () => {
    const browser = await chromium.launch();
    try {
      const { timeline, look, report } = await openOn(browser, 'Clamp cart quantities at zero');
      // Frame 0 already shows the capture, its title, and the narrator, settled.
      expect(await look(0)).toEqual({
        capture: '1',
        heading: 'Clamp cart quantities at zero',
        headingOpacity: '1',
        eyebrowOpacity: '1',
        panel: false,
        camera: '',
        narrator: 'scale(1)',
      });
      // The title in the header is checked for fit, as on a title card.
      const heading = (await report()).items.filter((i) => i.role === 'text');
      expect(heading).toHaveLength(1);
      expect(heading[0]!.overflow).toBe(false);
      // The stage's camera drifts the capture, as on a screenshot.
      const s1 = timeline.scenes[0]!;
      const middle = await look(Math.round(((s1.start + s1.end) / 2) * timeline.fps));
      expect(middle.camera).toMatch(/^scale\(1\.0\d+\)$/);
    } finally {
      await browser.close();
    }
  });

  it('reports a title over a capture that does not fit the header', async () => {
    const browser = await chromium.launch();
    try {
      const long = Array.from({ length: 6 }, () => 'Clamp cart quantities at zero').join(' and ');
      const { timeline, look, report } = await openOn(browser, long);
      await look(0);
      const layout = await report();
      expect(layout.items.find((i) => i.role === 'text')?.overflow).toBe(true);
      const fits = layoutChecks(timeline, [layout]).find((c) => c.id === 'text-fits')!;
      expect(fits).toMatchObject({ status: 'warn' });
      expect(fits.message).toMatch(/s1/);
    } finally {
      await browser.close();
    }
  });

  /**
   * Builds a composition from storyboard scenes (360×640 in English unless `options` says
   * otherwise), with one 640×400 capture at demo/a.png, and opens it. `look` seeks to a frame and
   * evaluates `body`, a function body over `scene` (that scene's root element). `redact` rewrites
   * every narration after validation, as the redactor can, so a phrase it hides pins nothing.
   */
  async function compose(
    browser: Browser,
    scenes: StoryboardInput['scenes'],
    redact?: (narration: string) => string,
    options: { language?: 'en' | 'ko' | 'ja' | 'zh'; width?: number; height?: number } = {},
  ) {
    const { width = 360, height = 640, language = 'en' } = options;
    const dir = mkdtempSync(join(tmpdir(), 'covi-parts-'));
    dirs.push(dir);
    const capture = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await capture.setContent(
      '<body style="margin:0;background:linear-gradient(90deg,#2a6f97,#f4a261)"></body>',
    );
    mkdirSync(join(dir, 'demo'));
    await capture.screenshot({ path: join(dir, 'demo', 'a.png') });
    await capture.close();
    const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width, height });
    const parsed = StoryboardSchema.parse({ ...storyboard, language, scenes }).scenes.map((s) =>
      redact ? { ...s, narration: redact(s.narration) } : s,
    );
    const layout = layoutScenes(parsed, new Map(), new Map(), language, pacingFor(spec));
    const assets = new AssetCollector(dir);
    await assets.prepare(['demo/a.png']);
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: parsed,
      layout,
      spec,
      image: assets.image,
      language,
    });
    const composition = join(dir, 'composition');
    await writeComposition(composition, timeline, assets.files);
    const page = await browser.newPage({ viewport: { width, height } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`file://${join(composition, 'index.html')}`);
    await page.waitForFunction('window.covi !== undefined');
    await page.evaluate('window.covi.ready');
    const frameAt = (id: string, seconds: number) => {
      const scene = timeline.scenes.find((s) => s.id === id)!;
      return Math.round((scene.start + seconds) * timeline.fps);
    };
    // The tests have no DOM types: the page reads its own elements from a script.
    const look = <T>(frame: number, id: string, body: string) =>
      page.evaluate(
        `(() => { window.covi.seek(${frame}); const scene = document.querySelector('[data-scene="${id}"]'); ${body} })()`,
      ) as Promise<T>;
    const report = () => page.evaluate('window.covi.layout()') as Promise<LayoutReport>;
    return { timeline, frameAt, look, report, errors };
  }

  const cart = {
    id: 's1',
    beat: 'context',
    narration: 'Here is the cart.',
    visual: { kind: 'callout', tone: 'info', title: 'Cart' },
  } satisfies StoryboardInput['scenes'][number];

  /** A scene's layout report at its settled frame, where QC measures sizes and emptiness. */
  async function settledReport(c: Awaited<ReturnType<typeof compose>>, id: string) {
    const frame = settledFrame(
      c.timeline,
      c.timeline.scenes.findIndex((s) => s.id === id),
    )!;
    await c.look(frame, id, 'return null;');
    return c.report();
  }

  /** A morph scene's code visual and how far into the scene its morph is done. */
  function morphOf(timeline: Timeline, index: number) {
    const scene = timeline.scenes[index]!;
    const v = scene.visual as Extract<TimelineVisual, { kind: 'code' }>;
    const duration = scene.end - scene.start;
    const m = morphTiming(duration, v.lines, scene.phases);
    return { v, m, duration, done: Math.min(m.end + 0.1, duration - 0.05) };
  }

  type Box = { left: number; top: number; right: number; bottom: number; width: number };

  /**
   * A marked capture in scene s2 at a frame: the gloss (or step chip), and the camera, ring, and
   * cursor of frame `which` (an interaction's step), with their boxes on the page.
   */
  function frameState(look: Awaited<ReturnType<typeof compose>>['look'], frame: number, which = 0) {
    return look<{
      gloss: string;
      shown: number;
      image: string;
      zoom: number;
      ring: number;
      cursor: number;
      boxes: { gloss: Box; frame: Box; image: Box; cursor: Box };
    }>(
      frame,
      's2',
      `const gloss = scene.querySelector('.gloss');
       const nth = (selector) => scene.querySelectorAll(selector)[${which}];
       const opacity = (node) => Number.parseFloat(node.style.opacity || '0');
       const box = (node) => {
         const { left, top, right, bottom, width } = node.getBoundingClientRect();
         return { left, top, right, bottom, width };
       };
       const image = nth('.frame img').style.transform;
       return {
         gloss: gloss.textContent,
         shown: opacity(gloss),
         image,
         zoom: Number.parseFloat(image.match(/scale\\(([\\d.]+)\\)/)[1]),
         ring: opacity(nth('.focus-ring')),
         cursor: opacity(nth('.cursor')),
         boxes: {
           gloss: box(gloss),
           frame: box(nth('.frame')),
           image: box(nth('.frame img')),
           cursor: box(nth('.cursor')),
         },
       };`,
    );
  }

  /** The chip sits just under its frame, from the frame's left edge. */
  function expectUnderFrame(boxes: { gloss: Box; frame: Box }) {
    expect(Math.abs(boxes.gloss.left - boxes.frame.left)).toBeLessThan(1);
    expect(boxes.gloss.top).toBeGreaterThan(boxes.frame.bottom);
    expect(boxes.gloss.top - boxes.frame.bottom).toBeLessThan(20);
  }

  it('morphs code: the old lines struck to ghosts, the new ones typed where they were', async () => {
    const browser = await chromium.launch();
    try {
      const full = '  return Math.max(0, qty - 1);';
      const { timeline, frameAt, look, report } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'fix',
          narration: 'Minus one becomes a clamp at zero, so the cart stops.',
          sync: { morph: 'becomes a clamp' },
          visual: {
            kind: 'code',
            path: 'src/cart.js',
            language: 'javascript',
            mode: 'morph',
            lines: [
              { type: 'context', text: 'function decrement(qty) {' },
              { type: 'del', text: '  return qty - 1;' },
              { type: 'add', text: full },
              { type: 'context', text: '}' },
            ],
            highlight: [2],
            caption: 'Clamped at zero',
          },
        },
        storyboard.scenes[2]!,
      ]);
      const s2 = timeline.scenes[1]!;
      const v = s2.visual as Extract<TimelineVisual, { kind: 'code' }>;
      const m = morphTiming(s2.end - s2.start, v.lines, s2.phases);
      const typing = m.typing.get(2)!;
      const rows = (frame: number) =>
        look<{ heights: number[]; texts: string[]; struck: boolean[]; ghost: number }>(
          frame,
          's2',
          `const rows = [...scene.querySelectorAll('.ln')];
           return {
             heights: rows.map((r) => Number.parseFloat(r.style.height || '1.55')),
             texts: rows.map((r) => r.querySelector('.txt').textContent),
             struck: rows.map((r) => r.classList.contains('struck')),
             ghost: Number.parseFloat(rows[1].querySelector('.txt').style.opacity || '1'),
           };`,
        );
      // Before the morph: the old code, the new line folded away.
      expect(m.strike[0] - 0.15).toBeGreaterThan(0.6);
      const before = await rows(frameAt('s2', m.strike[0] - 0.15));
      expect(before.heights[2]).toBe(0);
      expect(before.struck).toEqual([false, false, false, false]);
      expect(before.texts[1]).toBe('  return qty - 1;');
      // Mid-typing: a strict prefix of the new line.
      const mid = await rows(frameAt('s2', (typing[0] + typing[1]) / 2));
      expect(full.startsWith(mid.texts[2]!)).toBe(true);
      expect(mid.texts[2]!.length).toBeLessThan(full.length);
      // After: the old line a struck ghost, the new one whole in its place.
      const done = Math.min(m.end + 0.1, s2.end - s2.start - 0.05);
      const after = await rows(frameAt('s2', done));
      expect(after.heights[2]).toBeCloseTo(1.55, 3);
      expect(after.texts[2]).toBe(full);
      expect(after.struck[1]).toBe(true);
      expect(after.ghost).toBeCloseTo(0.4, 2);
      const caption = await look<string>(
        frameAt('s2', done),
        's2',
        "return scene.querySelector('.code-caption').textContent;",
      );
      expect(caption).toBe('Clamped at zero');
      const text = (await report()).items.filter((i) => i.role === 'text');
      expect(text).toHaveLength(1);
      expect(text[0]!.overflow).toBe(false);
    } finally {
      await browser.close();
    }
  });

  it('morphs each added line in under the line it replaces, lighting it only once typed', async () => {
    const browser = await chromium.launch();
    try {
      const lines = [
        { type: 'context', text: 'function total(items) {' },
        { type: 'del', text: '  let sum = 0;' },
        { type: 'del', text: '  for (const i of items) sum += i.price;' },
        { type: 'add', text: '  const sum = items' },
        { type: 'add', text: '    .reduce((a, i) => a + i.price, 0);' },
        { type: 'context', text: '  return sum;' },
        { type: 'context', text: '}' },
      ] as const;
      const { timeline, frameAt, look, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'fix',
          narration: 'The loop becomes a single reduce, which reads as one sum.',
          sync: { morph: 'becomes a single reduce' },
          // Pinned at the morph itself, before either line has typed.
          visual: {
            kind: 'code',
            path: 'src/cart.js',
            language: 'javascript',
            mode: 'morph',
            lines: [...lines],
            highlight: [{ lines: [3, 4], sync: 'morph' }],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const { m, duration, done } = morphOf(timeline, 1);
      const rows = (frame: number) =>
        look<{ texts: string[]; tops: number[]; bottoms: number[]; lit: number[] }>(
          frame,
          's2',
          `const rows = [...scene.querySelectorAll('.ln')];
           const rects = rows.map((r) => r.getBoundingClientRect());
           return {
             texts: rows.map((r) => r.querySelector('.txt').textContent),
             tops: rects.map((r) => r.top),
             bottoms: rects.map((r) => r.bottom),
             lit: rows.map((r) => Number.parseFloat(r.querySelector('.hl')?.style.opacity ?? '0')),
           };`,
        );
      // Each new line sits directly under the old line it replaces, in a row of its own.
      const order = [0, 1, 3, 2, 4, 5, 6];
      const after = await rows(frameAt('s2', done));
      expect(after.texts).toEqual(order.map((i) => lines[i]!.text));
      for (let k = 1; k < order.length; k++)
        expect(after.tops[k]!).toBeGreaterThanOrEqual(after.bottoms[k - 1]! - 0.5);
      // Lit once both have typed in.
      const lit = await rows(frameAt('s2', Math.min(m.end + 0.55, duration - 0.02)));
      expect(lit.lit[2]).toBeCloseTo(1, 2);
      expect(lit.lit[4]).toBeCloseTo(1, 2);
      // While the first new line types, neither new line is lit.
      const typing = m.typing.get(3)!;
      const mid = await rows(frameAt('s2', (typing[0] + typing[1]) / 2));
      expect(mid.lit[2]).toBe(0);
      expect(mid.lit[4]).toBe(0);
      // Nor while the second still types: the group waits for it, then lights as one.
      const second = m.typing.get(4)!;
      const late = await rows(frameAt('s2', (second[0] + second[1]) / 2));
      expect(late.lit[2]).toBe(0);
      expect(late.lit[4]).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('reports a code caption too long for its two lines', async () => {
    const browser = await chromium.launch();
    try {
      // As long as the schema allows (160 characters), still more than two lines.
      const long = Array.from({ length: 8 }, () => 'the quantity is clamped at zero')
        .join(', ')
        .slice(0, 160);
      const { timeline, frameAt, look, report } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'fix',
          narration: 'Minus one becomes a clamp at zero, so the cart stops.',
          visual: {
            kind: 'code',
            path: 'src/cart.js',
            language: 'javascript',
            lines: [
              { type: 'del', text: 'qty = qty - 1;' },
              { type: 'add', text: 'qty = Math.max(0, qty - 1);' },
            ],
            highlight: [1],
            caption: long,
          },
        },
        storyboard.scenes[2]!,
      ]);
      await look(frameAt('s2', 1.5), 's2', 'return null;');
      const layout = await report();
      expect(layout.items.find((i) => i.role === 'text')?.overflow).toBe(true);
      const fits = layoutChecks(timeline, [layout]).find((c) => c.id === 'text-fits')!;
      expect(fits).toMatchObject({ status: 'warn' });
      expect(fits.message).toMatch(/s2/);
    } finally {
      await browser.close();
    }
  });

  it('morphs where it would have when redaction hid its phrase', async () => {
    const browser = await chromium.launch();
    try {
      const full = '  return Math.max(0, qty - 1);';
      const { timeline, frameAt, look, errors } = await compose(
        browser,
        [
          cart,
          {
            id: 's2',
            beat: 'fix',
            narration: 'Minus one becomes a clamp at zero, so the cart stops.',
            sync: { morph: 'becomes a clamp', stop: 'the cart stops' },
            visual: {
              kind: 'code',
              path: 'src/cart.js',
              language: 'javascript',
              mode: 'morph',
              lines: [
                { type: 'del', text: '  return qty - 1;' },
                { type: 'add', text: full },
              ],
              highlight: [{ lines: 1, sync: 'stop' }],
              caption: 'Clamped at zero',
            },
          },
          storyboard.scenes[2]!,
        ],
        (narration) => narration.replace('becomes a clamp', '[REDACTED]').replace('cart', '[X]'),
      );
      const scene = timeline.scenes[1]!;
      expect(scene.phases?.morph).toBeUndefined();
      expect(scene.phases?.stop).toBeUndefined();
      const { m, duration, done } = morphOf(timeline, 1);
      // A quarter into the scene, as without a phase.
      expect(m.strike[0]).toBeCloseTo(duration * 0.25, 6);
      const state = (frame: number) =>
        look<{ text: string; lit: number }>(
          frame,
          's2',
          `const row = scene.querySelectorAll('.ln')[1];
           return {
             text: row.querySelector('.txt').textContent.trim(),
             lit: Number.parseFloat(row.querySelector('.hl').style.opacity || '0'),
           };`,
        );
      expect(await state(frameAt('s2', m.strike[0] - 0.1))).toEqual({ text: '', lit: 0 });
      const after = await state(frameAt('s2', Math.min(done + 0.5, duration - 0.02)));
      expect(after.text).toBe(full.trim());
      expect(after.lit).toBeCloseTo(1, 2);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('tours marks: the camera pans from one to the next, each gloss under the frame', async () => {
    const browser = await chromium.launch();
    try {
      const { timeline, frameAt, look, report, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'proof',
          narration: 'The total updates, and the badge clears.',
          visual: {
            kind: 'screenshot',
            image: { path: 'demo/a.png' },
            device: 'mobile',
            marks: [
              { focus: { x: 40, y: 40, width: 160, height: 80 }, label: 'Total' },
              { focus: { x: 440, y: 280, width: 160, height: 80 }, label: 'Badge' },
            ],
            click: { x: 520, y: 320 },
          },
        },
        storyboard.scenes[2]!,
      ]);
      const s2 = timeline.scenes[1]!;
      const v = s2.visual as Extract<TimelineVisual, { kind: 'screenshot' }>;
      const [first, second] = screenshotMarks(s2.end - s2.start, v.marks!, s2.phases).marks;
      const state = (seconds: number) => frameState(look, frameAt('s2', seconds));
      const early = await state(Math.max(0.05, first!.start - 0.1));
      expect(early.shown).toBe(0);
      // Arriving at the first mark: its gloss, the ring, and the cursor on it.
      const onFirst = await state(first!.pan[1] - 0.05);
      expect(onFirst).toMatchObject({ gloss: 'Total', shown: 1 });
      expect(onFirst.ring).toBeGreaterThan(0.5);
      expect(onFirst.cursor).toBe(1);
      expectUnderFrame(onFirst.boxes);
      // As the camera leaves, the first gloss fades out over a few frames rather than cutting.
      // (0.05 s in: inside the 0.15 s fade-out, `NOTE_OUT` in the runtime's framing.ts.)
      const leaving = await state(second!.start + 0.05);
      expect(leaving.gloss).toBe('Total');
      expect(leaving.shown).toBeGreaterThan(0);
      expect(leaving.shown).toBeLessThan(1);
      // After the pan: the second gloss, the camera moved.
      const onSecond = await state(second!.pan[1] + 0.05);
      expect(onSecond).toMatchObject({ gloss: 'Badge', shown: 1 });
      expect(onSecond.image).not.toBe(onFirst.image);
      // Two marks zoom the frame's own camera to 1.6× at most.
      expect(onSecond.zoom).toBeGreaterThan(1);
      expect(onSecond.zoom).toBeLessThanOrEqual(1.6);
      // The gloss is text QC checks, and it stays inside the media region.
      const items = (await report()).items;
      const gloss = items.find((i) => i.role === 'text')!;
      expect(gloss.overflow).toBe(false);
      const media = computeRegions(timeline).media;
      expect(gloss.rect.y + gloss.rect.height).toBeLessThanOrEqual(media.y + media.height + 4);
      expect(items.some((i) => i.role === 'focus')).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('tours a step’s marks, its chip showing each gloss in place of the step’s label', async () => {
    const browser = await chromium.launch();
    try {
      // A step's own label has no length limit; a gloss's 40 characters fit this frame.
      const long = Array.from({ length: 6 }, () => 'then the receipt opens').join(', ');
      const { timeline, frameAt, look, report, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'proof',
          narration:
            'Open the cart, read the total and the badge, then check out to see the receipt.',
          sync: { step2: 'then check out' },
          visual: {
            kind: 'interaction',
            steps: [
              {
                image: { path: 'demo/a.png' },
                label: 'Open the cart',
                marks: [
                  { focus: { x: 40, y: 40, width: 160, height: 80 }, label: 'Total' },
                  { focus: { x: 440, y: 280, width: 160, height: 80 }, label: 'Badge' },
                ],
                // Away from the last mark: the next step's cursor waits here, where it clicked.
                click: { x: 120, y: 330 },
              },
              {
                image: { path: 'demo/a.png' },
                label: long,
                marks: [{ focus: { x: 200, y: 160, width: 200, height: 100 }, label: 'Receipt' }],
              },
            ],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const s2 = timeline.scenes[1]!;
      const v = s2.visual as Extract<TimelineVisual, { kind: 'interaction' }>;
      const timing = interactionTiming(
        s2.end - s2.start,
        v.steps.length,
        s2.phases,
        v.steps.map((s) => s.marks),
      );
      const [first, second] = timing[0]!.marks!;
      const state = (seconds: number) => frameState(look, frameAt('s2', seconds));
      // The step's label until the camera heads for a mark, then each mark's gloss.
      expect((await state(first!.start - 0.1)).gloss).toBe('1/2  Open the cart');
      const onFirst = await state(first!.pan[1] - 0.05);
      expect(onFirst.gloss).toBe('1/2  Total');
      expect(onFirst.ring).toBeGreaterThan(0.5);
      expect(onFirst.cursor).toBe(1);
      expectUnderFrame(onFirst.boxes);
      const onSecond = await state(second!.pan[1] + 0.05);
      expect(onSecond.gloss).toBe('1/2  Badge');
      expect(onSecond.image).not.toBe(onFirst.image);
      // A step zooms no further for its marks than for its focus.
      expect(onSecond.zoom).toBeGreaterThan(1);
      expect(onSecond.zoom).toBeLessThanOrEqual(1.5);
      const fits = (await report()).items.find((i) => i.role === 'text')!;
      expect(fits.overflow).toBe(false);
      // The next step opens with the cursor where the last one clicked, not on its last mark.
      const mark = timing[1]!.marks![0]!;
      expect(mark.start).toBeGreaterThan(timing[1]!.start + 0.1);
      const opening = await frameState(look, frameAt('s2', timing[1]!.start + 0.05), 1);
      expect(opening.cursor).toBe(1);
      const scale = opening.boxes.image.width / 640;
      expect(opening.boxes.cursor.left).toBeCloseTo(opening.boxes.image.left + 120 * scale, -1);
      expect(opening.boxes.cursor.top).toBeCloseTo(opening.boxes.image.top + 330 * scale, -1);
      expectUnderFrame({ gloss: opening.boxes.gloss, frame: opening.boxes.frame });
      // A label too long for the chip is ellipsized inside the media region, and QC hears of it.
      expect((await state(mark.start - 0.05)).gloss).toBe(`2/2  ${long}`);
      const clipped = (await report()).items.find((i) => i.role === 'text')!;
      expect(clipped.overflow).toBe(true);
      const media = computeRegions(timeline).media;
      // (Within the stage camera's push-in, which scales the whole media layer.)
      expect(clipped.rect.x + clipped.rect.width).toBeLessThanOrEqual(media.x + media.width + 4);
      expect((await state(mark.pan[1] - 0.05)).gloss).toBe('2/2  Receipt');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('reports a step label too long for its chip, with or without glosses', async () => {
    const browser = await chromium.launch();
    try {
      const long = Array.from({ length: 6 }, () => 'then the receipt opens').join(', ');
      const { frameAt, look, report, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'proof',
          narration: 'Check out, and the receipt opens.',
          visual: {
            kind: 'interaction',
            steps: [{ image: { path: 'demo/a.png' }, label: long, click: { x: 120, y: 330 } }],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const state = await frameState(look, frameAt('s2', 1));
      expect(state.gloss).toBe(`1/1  ${long}`);
      expectUnderFrame(state.boxes);
      const text = (await report()).items.filter((i) => i.role === 'text');
      expect(text).toHaveLength(1);
      expect(text[0]!.overflow).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('tours marks where they would have been when redaction hid their phrase', async () => {
    const browser = await chromium.launch();
    try {
      const { timeline, frameAt, look, errors } = await compose(
        browser,
        [
          cart,
          {
            id: 's2',
            beat: 'proof',
            narration: 'The total updates, and the badge clears.',
            sync: { total: 'The total updates' },
            visual: {
              kind: 'screenshot',
              image: { path: 'demo/a.png' },
              device: 'mobile',
              marks: [
                { focus: { x: 40, y: 40, width: 160, height: 80 }, label: 'Total', sync: 'total' },
                { focus: { x: 440, y: 280, width: 160, height: 80 }, label: 'Badge' },
              ],
            },
          },
          storyboard.scenes[2]!,
        ],
        (narration) => narration.replace('The total updates', '[REDACTED]'),
      );
      const s2 = timeline.scenes[1]!;
      expect(s2.phases?.total).toBeUndefined();
      const v = s2.visual as Extract<TimelineVisual, { kind: 'screenshot' }>;
      const duration = s2.end - s2.start;
      const [first] = screenshotMarks(duration, v.marks!, s2.phases).marks;
      // At 22% of the scene, as without a phase.
      expect(first!.start).toBeCloseTo(duration * 0.22, 6);
      const onFirst = await frameState(look, frameAt('s2', first!.pan[1] - 0.05));
      expect(onFirst).toMatchObject({ gloss: 'Total', shown: 1 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('labels diagram edges on their midpoints, and reports a label that does not fit', async () => {
    const browser = await chromium.launch();
    try {
      const long = 'validates every quantity before checkout'; // 40 characters, the most allowed
      const { timeline, frameAt, look, report, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'architecture',
          narration: 'The button calls the cart, and the cart checks the quantity.',
          visual: {
            kind: 'diagram',
            nodes: [
              { id: 'button', label: 'Minus button' },
              { id: 'cart', label: 'cart.js', changed: true },
              { id: 'check', label: 'clamp()' },
            ],
            edges: [
              { from: 'button', to: 'cart', label: 'calls' },
              { from: 'cart', to: 'check', label: long },
            ],
          },
        },
        storyboard.scenes[2]!,
      ]);
      type Box = { x: number; y: number; width: number; height: number };
      const labels = (seconds: number) =>
        look<{ text: string; opacity: number; box: Box }[]>(
          frameAt('s2', seconds),
          's2',
          `return [...scene.querySelectorAll('.edge-label')].map((l) => {
             const r = l.getBoundingClientRect();
             return { text: l.textContent, opacity: Number.parseFloat(l.style.opacity || '0'),
               box: { x: r.x, y: r.y, width: r.width, height: r.height } };
           });`,
        );
      const nodes = () =>
        look<Box[]>(
          frameAt('s2', 2.5),
          's2',
          `return [...scene.querySelectorAll('.node')].map((n) => {
             const r = n.getBoundingClientRect();
             return { x: r.x, y: r.y, width: r.width, height: r.height };
           });`,
        );
      // Not yet: the first label waits for its line.
      const early = await labels(edgeLabelEntrance(0)[0] - 0.2);
      expect(early.map((l) => l.opacity)).toEqual([0, 0]);
      // Settled: both shown, the first centered between its two nodes.
      const settled = await labels(2.5);
      expect(settled.map((l) => [l.text, l.opacity])).toEqual([
        ['calls', 1],
        [long, 1],
      ]);
      const [a, b] = await nodes();
      const mid = (r: Box) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
      expect(mid(settled[0]!.box).x).toBeCloseTo((mid(a!).x + mid(b!).x) / 2, 0);
      expect(mid(settled[0]!.box).y).toBeCloseTo((mid(a!).y + mid(b!).y) / 2, 0);
      // The long label is clipped: QC says so, naming the scene.
      const layout = await report();
      const text = layout.items.filter((i) => i.role === 'text' && i.rect.height < 40);
      expect(text.some((i) => i.overflow)).toBe(true);
      const fits = layoutChecks(timeline, [layout]).find((c) => c.id === 'text-fits')!;
      expect(fits).toMatchObject({ status: 'warn' });
      expect(fits.message).toMatch(/s2/);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('times an edge by its place in the list, also after an edge it cannot draw', async () => {
    const browser = await chromium.launch();
    try {
      const { frameAt, look, errors } = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'architecture',
          narration: 'The button calls the cart, and the cart checks the quantity.',
          visual: {
            kind: 'diagram',
            nodes: [
              { id: 'button', label: 'Minus button' },
              { id: 'cart', label: 'cart.js', changed: true },
            ],
            edges: [
              { from: 'button', to: 'gone', label: 'lost' },
              { from: 'button', to: 'cart', label: 'calls' },
            ],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const at = (seconds: number) =>
        look<{ labels: [string, number][]; drawn: number[] }>(
          frameAt('s2', seconds),
          's2',
          `return {
             labels: [...scene.querySelectorAll('.edge-label')].map((l) =>
               [l.textContent, Number.parseFloat(l.style.opacity || '0')]),
             drawn: [...scene.querySelectorAll('line')].map((l) =>
               1 - Number(l.getAttribute('stroke-dashoffset')) / Number(l.getAttribute('stroke-dasharray'))),
           };`,
        );
      // The drawn edge is the second entry: its line and label wait for the second slot, as
      // settledAt counts them, not the first.
      const [lineStart] = edgeEntrance(1);
      const beforeLine = await at((edgeEntrance(0)[0] + lineStart) / 2);
      expect(beforeLine.drawn).toEqual([0]);
      const [labelStart] = edgeLabelEntrance(1);
      const beforeLabel = await at((edgeLabelEntrance(0)[0] + labelStart) / 2);
      expect(beforeLabel.labels).toEqual([['calls', 0]]);
      const settled = await at(edgeLabelEntrance(1)[1] + 0.1);
      expect(settled.labels).toEqual([['calls', 1]]);
      expect(settled.drawn[0]).toBeCloseTo(1, 6);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('renders a short code block large, in a card that fills the frame', async () => {
    const browser = await chromium.launch();
    try {
      for (const size of [{}, { width: 640, height: 360 }]) {
        const c = await compose(browser, storyboard.scenes, undefined, size);
        const report = await settledReport(c, 's2');
        const { unit, media } = computeRegions(c.timeline);
        const card = report.items.find((i) => i.text === 'code')!;
        // Two short lines reach the ceiling: 48 units in 9:16, 44 in 16:9 (the camera may have
        // begun to push in).
        const ceiling = c.timeline.orientation === 'vertical' ? 48 : 44;
        expect(card.font! / unit).toBeGreaterThanOrEqual(ceiling - 0.5);
        expect(card.font! / unit).toBeLessThan(ceiling * 1.07);
        const share = (card.rect.width * card.rect.height) / (media.width * media.height);
        expect(share).toBeGreaterThan(0.59);
        const checks = densityChecks(c.timeline, [report]);
        expect(checks.find((x) => x.id === 'text-size')!.status).toBe('pass');
        expect(checks.find((x) => x.id === 'empty-frame')!.status).toBe('pass');
        expect(c.errors).toEqual([]);
      }
    } finally {
      await browser.close();
    }
  });

  it('shrinks code under the floor only when its lines need it, and QC names the scene', async () => {
    const browser = await chromium.launch();
    try {
      const long =
        'const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);';
      const c = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'fix',
          narration: 'The total now counts the quantity of every item.',
          visual: {
            kind: 'code',
            path: 'src/cart.js',
            language: 'javascript',
            lines: [
              { type: 'del', text: long.replace(' * item.quantity', '') },
              { type: 'add', text: long },
            ],
            highlight: [1],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const report = await settledReport(c, 's2');
      const { unit } = computeRegions(c.timeline);
      const card = report.items.find((i) => i.text === 'code')!;
      expect(card.font! / unit).toBeLessThan(24);
      expect(card.font! / unit).toBeGreaterThanOrEqual(13 - 0.5);
      const size = densityChecks(c.timeline, [report]).find((x) => x.id === 'text-size')!;
      expect(size.status).toBe('warn');
      expect(size.message).toMatch(/code at \d+(\.\d)? px in s2/);
    } finally {
      await browser.close();
    }
  });

  it('draws a before and an after terminal at one readable size, and API bodies large', async () => {
    const browser = await chromium.launch();
    try {
      const c = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'proof',
          narration: 'The request shrinks from seventy kilobytes to ten.',
          visual: {
            kind: 'terminal',
            command: 'node scripts/measure.js',
            before: [
              'request bytes: 70406',
              'chunks: 4',
              'reader steps: 28',
              'timeouts: 1',
              'retries: 3',
              'cache misses: 12',
              'queue depth: 5',
              'warnings: 2',
              'elapsed: 840 ms',
            ].join('\n'),
            output: 'request bytes: 9907\nchunks: 1',
          },
        },
        {
          id: 's3',
          beat: 'exchange',
          narration: 'The response lists the documents.',
          visual: {
            kind: 'api',
            method: 'GET',
            path: '/api/reviews/1',
            after: { status: 200, body: '{\n  "refs": 6,\n  "chunks": 1\n}' },
          },
        },
        { ...storyboard.scenes[2]!, id: 's4' },
      ]);
      const { unit } = computeRegions(c.timeline);
      const terminal = await settledReport(c, 's2');
      const windows = terminal.items.filter((i) => i.text === 'code');
      expect(windows).toHaveLength(2);
      // The before's nine lines set one size for both windows (27.8 units in 9:16); sized alone,
      // the after's two lines would grow to the ceiling.
      expect(windows[0]!.font).toBeCloseTo(windows[1]!.font!, 3);
      expect(windows[0]!.font! / unit).toBeGreaterThanOrEqual(24);
      const api = await settledReport(c, 's3');
      const [request, ...responses] = api.items.filter((i) => i.text === 'code');
      expect(request!.font! / unit).toBeGreaterThanOrEqual(24);
      // A four-line body reaches the 48-unit ceiling.
      expect(responses).toHaveLength(1);
      expect(responses[0]!.font! / unit).toBeGreaterThanOrEqual(48 - 0.5);
      const checks = densityChecks(c.timeline, [terminal, api]);
      expect(checks.find((x) => x.id === 'text-size')!.status).toBe('pass');
      expect(checks.find((x) => x.id === 'empty-frame')!.status).toBe('pass');
      expect(c.errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });

  it('holds body text to 28 px and grows short cards to fill the frame, in both shapes and Korean', async () => {
    const browser = await chromium.launch();
    try {
      const words = {
        en: {
          problem: 'One reader call ran past its step budget.',
          heading: 'Why the reader timed out',
          title: 'The reader timed out',
          body: 'One chunk took nine steps; the budget is eight.',
          review: 'One thing to check before merging.',
          finding: 'Nothing tests a document that changed',
          note: 'The size check throws, but no test reaches it.',
          nodes: ['Request builder', 'Reader worker', 'Document store', 'Chunk cache'],
        },
        ko: {
          problem: '리더 호출 하나가 단계 예산을 넘겼습니다.',
          heading: '리더가 멈춘 이유',
          title: '리더가 시간 초과로 멈췄습니다',
          body: '청크 하나가 아홉 단계를 썼고, 예산은 여덟 단계입니다.',
          review: '병합 전에 확인할 것이 하나 있습니다.',
          finding: '바뀐 문서를 다루는 테스트가 없습니다',
          note: '크기 검사가 예외를 던지지만, 그 경로를 지나는 테스트는 없습니다.',
          // Long enough to wrap in its node: Korean breaks between words, never inside one.
          nodes: ['요청 빌더', '바뀐 문서를 다시 읽는 리더 워커', '문서 저장소', '청크 캐시'],
        },
      } as const;
      // 9:16 sets body text at 32 units; 16:9 sets it at the 28-unit floor, in landscape layouts.
      for (const size of [{}, { width: 640, height: 360 }])
        for (const language of ['en', 'ko'] as const) {
          const w = words[language];
          const c = await compose(
            browser,
            [
              {
                id: 's1',
                beat: 'problem',
                eyebrow: 'Problem',
                heading: w.heading,
                narration: w.problem,
                visual: { kind: 'callout', tone: 'warning', title: w.title, body: w.body },
              },
              {
                id: 's2',
                beat: 'review',
                eyebrow: 'Review',
                narration: w.review,
                visual: {
                  kind: 'findings',
                  findings: [
                    {
                      title: w.finding,
                      certainty: 'risk',
                      severity: 'low',
                      location: 'src/reader.js:24',
                      note: w.note,
                    },
                  ],
                },
              },
              {
                id: 's3',
                beat: 'architecture',
                eyebrow: 'How it flows',
                narration: 'The builder sends a list, and the reader fetches each document.',
                visual: {
                  kind: 'diagram',
                  nodes: [
                    { id: 'builder', label: w.nodes[0] },
                    { id: 'reader', label: w.nodes[1], changed: true },
                    { id: 'store', label: w.nodes[2] },
                    { id: 'cache', label: w.nodes[3] },
                  ],
                  edges: [
                    { from: 'builder', to: 'reader', label: 'list' },
                    { from: 'reader', to: 'store', label: 'fetch' },
                    { from: 'store', to: 'cache', label: 'miss' },
                  ],
                },
              },
              {
                id: 's4',
                beat: 'map',
                eyebrow: 'Where',
                narration: 'Two areas changed, the source and its tests.',
                visual: {
                  kind: 'change-map',
                  areas: [
                    { name: 'src', additions: 20, deletions: 12, files: 2 },
                    { name: 'test', additions: 30, deletions: 10, files: 2 },
                  ],
                },
              },
              { ...storyboard.scenes[2]!, id: 's5' },
            ],
            undefined,
            { ...size, language },
          );
          const vertical = c.timeline.orientation === 'vertical';
          const at = `${language} ${c.timeline.orientation}`;
          const ids = ['s1', 's2', 's3', 's4', 's5'];
          const reports: LayoutReport[] = [];
          for (const id of ids) reports.push(await settledReport(c, id));
          const { unit, media } = computeRegions(c.timeline);
          const body = reports.map((r) => r.items.filter((i) => i.text === 'body'));
          // The callout and the heading, the finding, four nodes, two areas, and the summary.
          expect(
            body.map((items) => items.length),
            at,
          ).toEqual([2, 1, 4, 2, 1]);
          for (const [i, items] of body.entries())
            for (const item of items)
              expect(item.font! / unit, `${at} ${ids[i]}`).toBeGreaterThanOrEqual(
                TEXT_FLOOR.body - 0.1,
              );
          // The callout and the finding card cover 60% of the media region.
          const [callout, finding] = [body[0]![0]!, body[1]![0]!];
          for (const card of [callout, finding])
            expect(
              (card.rect.width * card.rect.height) / (media.width * media.height),
              at,
            ).toBeGreaterThan(0.59);
          // The layouts of each shape: a 1400-unit callout in 16:9; rows grown to twice their
          // base height (150 or 96 units, less the 14-unit gap); four nodes in one row in 16:9.
          expect(callout.rect.width / unit, at).toBeCloseTo(
            vertical ? media.width / unit : 1400,
            0,
          );
          for (const row of body[3]!)
            expect(row.rect.height / unit, at).toBeCloseTo(vertical ? 286 : 178, 0);
          expect(new Set(body[2]!.map((n) => Math.round(n.rect.y))).size, at).toBe(
            vertical ? 2 : 1,
          );
          // Short content sits in the middle of its grown card.
          for (const [id, selector] of [
            ['s1', '.callout'],
            ['s2', '.finding .body'],
          ] as const) {
            const frame = settledFrame(c.timeline, ids.indexOf(id))!;
            const [above, below] = await c.look<[number, number]>(
              frame,
              id,
              `const box = scene.querySelector('${selector}').getBoundingClientRect();
               const first = scene.querySelector('${selector}').firstElementChild.getBoundingClientRect();
               const last = scene.querySelector('${selector}').lastElementChild.getBoundingClientRect();
               return [first.top - box.top, box.bottom - last.bottom];`,
            );
            expect(Math.abs(above - below), `${at} ${id}`).toBeLessThan(1.5);
          }
          // Every word of a node label stays on one line; the long Korean label wraps.
          const labels = await c.look<Array<{ lines: number; words: number[] }>>(
            settledFrame(c.timeline, 2)!,
            's3',
            `const range = document.createRange();
             const lines = (text, from, to) => {
               range.setStart(text, from);
               range.setEnd(text, to);
               const rects = [...range.getClientRects()].filter((r) => r.width > 0);
               return new Set(rects.map((r) => Math.round(r.top))).size;
             };
             return [...scene.querySelectorAll('.nlabel')].map((label) => {
               const text = label.firstChild;
               let from = 0;
               const words = text.data.split(' ').map((word) => {
                 const n = lines(text, from, from + word.length);
                 from += word.length + 1;
                 return n;
               });
               return { lines: lines(text, 0, text.data.length), words };
             });`,
          );
          for (const label of labels) expect(label.words, at).toEqual(label.words.map(() => 1));
          if (language === 'ko') expect(labels[1]!.lines, at).toBeGreaterThan(1);
          const checks = [
            ...layoutChecks(c.timeline, reports),
            ...densityChecks(c.timeline, reports),
          ];
          const status = Object.fromEntries(checks.map((x) => [x.id, x.status]));
          expect(status, at).toMatchObject({
            'text-fits': 'pass',
            'text-size': 'pass',
            'empty-frame': 'pass',
          });
          expect(c.errors).toEqual([]);
        }
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
    // The benchmark for changes with nothing to see: a command's output before and after, and code.
    ['backend-slim-request', ['--standard']],
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
        runDir: string;
        video: { rendered: boolean; qc: string; seconds: number };
      };
      expect(result.video.rendered).toBe(true);
      expect(result.video.qc).not.toBe('fail');
      // Every render is checked for small text, empty frames, and monotony.
      const qc = JSON.parse(readFileSync(join(result.runDir, 'video', 'qc.json'), 'utf8')) as {
        checks: Array<{ id: string }>;
      };
      expect(qc.checks.map((c) => c.id)).toEqual(
        expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety']),
      );
      // Drawn on the canvas by Covi's default director: every story scene at a stop, the camera
      // travelling between them, no fades, and, from four moves, no entrance taking more than
      // 60% of them.
      const timeline = JSON.parse(
        readFileSync(join(result.runDir, 'video', 'timeline.json'), 'utf8'),
      ) as Timeline;
      const story = timeline.scenes.filter((s) => s.visual.kind !== 'outro');
      expect(story.every((s) => s.stop)).toBe(true);
      const moves = story.slice(1).map((s) => s.transition!.kind);
      expect(moves).not.toContain('fade');
      expect(moves.some((k) => k === 'pan' || k === 'zoom')).toBe(true);
      if (moves.length >= TRANSITION_MIN)
        for (const kind of new Set(moves))
          expect(moves.filter((k) => k === kind).length / moves.length, kind).toBeLessThanOrEqual(
            TRANSITION_SHARE,
          );
      // The benchmark has nothing to see: its code changes on screen, and the sheet shows it.
      if (example === 'backend-slim-request') {
        const morphs = story.flatMap((s) =>
          (s.direction?.beats ?? []).flatMap((b) => (b.verb === 'morph' ? [{ s, b }] : [])),
        );
        expect(morphs.length).toBeGreaterThan(0);
        const tiles = contactSheetFrames(timeline);
        for (const { s, b } of morphs)
          expect(tiles).toContain(Math.round((s.start + b.t + b.seconds / 2) * timeline.fps));
      }
    }, 600_000);
  }
});

// The CLI from this checkout, and a run's JSON files, for the full-pipeline tests below.
const root = join(import.meta.dirname, '..', '..');
const covi = (args: string[]) =>
  JSON.parse(
    execFileSync('node', ['bin/covi.mjs', ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000,
    }),
  ) as { runId: string; runDir: string; video: { rendered: boolean; qc: string } };
const read = <T>(run: string, rel: string) => JSON.parse(readFileSync(join(run, rel), 'utf8')) as T;

describe.skipIf(!available || !fullRenders)('the timing grammar (full pipeline)', () => {
  it('renders a storyboard that uses every timing field', async () => {
    const repo = await materializeExample(
      (await listExamples()).find((e) => e.name === 'ui-comment-composer')!,
    );
    dirs.push(repo);
    // No --duration: an automatic window is a ceiling, so the duration check passes however
    // short the story is.
    const draft = covi(['video', '--repo', repo, '--short', '--draft']);
    const run = draft.runDir;
    // Real captures from the run: the composer page before and after, and the flow's steps.
    const demo = read<Demonstration>(run, 'demo/captures.json');
    const page = demo.shots.find(
      (s) => s.kind === 'page' && s.viewport === 'mobile' && s.before && s.after,
    );
    const steps = demo.shots
      .filter((s) => s.kind === 'flow-step' && s.viewport === 'mobile' && s.after)
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
      .slice(0, 2)
      .map((s) => ({
        image: { path: s.after!.path },
        click: s.click,
        focus: s.focus,
        label: s.label,
      }));
    expect(page).toBeDefined();
    expect(steps).toHaveLength(2);
    const shot = page!;

    // Every new field: a title over a capture, sync on four kinds of visual, all five
    // transitions (zoom-through as the hero's default), the hero, both camera modes, and [[…]].
    const storyboard: StoryboardInput = {
      title: 'Count the characters left in a comment',
      template: 'feature-demo',
      draft: false,
      scenes: [
        {
          id: 'open',
          beat: 'context',
          narration: 'What stops a comment that is [[too long]] to post?',
          visual: {
            kind: 'title',
            title: 'Count the characters left',
            eyebrow: 'Comments',
            background: { path: shot.after!.path, label: shot.name },
          },
        },
        {
          id: 'type',
          beat: 'interaction',
          eyebrow: 'Type',
          narration: 'Type a comment, and the counter counts down as you go.',
          transition: 'push',
          camera: 'drift',
          sync: { step2: 'the counter counts down', zoom: 'as you go' },
          visual: { kind: 'interaction', steps },
        },
        {
          id: 'code',
          beat: 'implementation',
          eyebrow: 'The check',
          narration: 'Past the limit, the counter flags it, and the form refuses to post.',
          transition: 'cut',
          sync: { highlight1: 'the counter flags it', highlight2: 'refuses to post' },
          visual: {
            kind: 'code',
            path: 'app.js',
            language: 'javascript',
            lines: [
              { type: 'add', text: 'const LIMIT = 280;' },
              { type: 'add', text: "counter.classList.toggle('over', left < 0);" },
              { type: 'add', text: 'if (!text || remaining() < 0) return;' },
            ],
            highlight: [1, 2],
          },
        },
        {
          id: 'compare',
          beat: 'review',
          eyebrow: 'Before and after',
          hero: true,
          narration: 'Before, nothing warned you. Now [[the limit]] is right there.',
          sync: { reveal: 'Now the limit', hero: 'is right there' },
          visual: {
            kind: 'before-after',
            before: { path: shot.before!.path },
            after: { path: shot.after!.path },
            ...(shot.diff?.bounds ? { focus: shot.diff.bounds } : {}),
          },
        },
        {
          id: 'pixels',
          beat: 'review',
          eyebrow: 'Worth a look',
          narration: 'It warns twenty characters early, so nobody is surprised.',
          transition: 'wipe',
          camera: 'static',
          sync: { zoom: 'twenty characters early' },
          visual: {
            kind: 'screenshot',
            image: { path: shot.after!.path, label: shot.name },
            ...(shot.diff?.bounds ? { focus: shot.diff.bounds } : {}),
            device: 'mobile',
          },
        },
        {
          id: 'wrap',
          beat: 'summary',
          eyebrow: 'Verdict',
          narration: 'Ready to merge.',
          transition: 'fade',
          minSeconds: 1.5,
          expression: 'success',
          visual: {
            kind: 'summary',
            verdict: 'looks-good',
            headline: 'A counter that blocks overlong comments',
            points: [],
          },
        },
      ],
    };
    writeFileSync(
      join(run, 'video', 'storyboard.json'),
      `${JSON.stringify(StoryboardSchema.parse(storyboard), null, 2)}\n`,
    );

    // Off reads no direction: a file that is not even JSON, which would refuse the render on the
    // canvas, is neither read nor rewritten.
    const unread = '{ "schemaVersion": 1, "draft": false, "shots": [ { "scene": "nowhere" ';
    writeFileSync(join(run, 'video', 'direction.json'), unread);

    // This test pins 0.2.0's timing grammar (zoom-through into the hero, its music lift 0.6 s
    // in), which `--direction off` keeps; tests/render/canvas.test.ts covers the canvas.
    const rendered = covi(['render', '--repo', repo, '--run', draft.runId, '--direction', 'off']);
    expect(rendered.video.rendered).toBe(true);
    expect(rendered.video.qc).not.toBe('fail');
    expect(readFileSync(join(run, 'video', 'direction.json'), 'utf8')).toBe(unread);

    const timeline = read<Timeline>(run, 'video/timeline.json');
    expect(timeline.scenes.every((s) => s.stop === undefined && s.direction === undefined)).toBe(
      true,
    );
    const [open, type, code, compare, pixels] = timeline.scenes;
    expect(timeline.scenes.map((s) => s.transition?.kind)).toEqual([
      undefined,
      'push',
      'cut',
      'zoom-through',
      'wipe',
      'fade',
      'fade',
    ]);
    expect(timeline.scenes.at(-1)!.id).toBe(OUTRO_ID);
    // The cold open: the title over the capture, and the hook heard by 0.5 s.
    expect(open!.visual).toMatchObject({ kind: 'title', background: { label: shot.name } });
    expect(open).toMatchObject({ eyebrow: 'Comments', heading: 'Count the characters left' });
    expect(open!.speech!.start).toBeLessThanOrEqual(0.5);
    // Phases land in the order their phrases are spoken.
    expect(type!.phases!.step2).toBeLessThan(type!.phases!.zoom!);
    expect(code!.phases!.highlight1).toBeLessThan(code!.phases!.highlight2!);
    expect(compare).toMatchObject({ hero: true });
    expect(compare!.phases!.reveal).toBeLessThan(compare!.phases!.hero!);
    // A cut lands on the first word of its line.
    expect(code!.start).toBeCloseTo(code!.speech!.start, 2);
    expect(pixels).toMatchObject({ camera: 'static' });
    expect(type).not.toHaveProperty('camera');

    // The marked phrases are swept in the captions and never reach the voice or the files.
    const marks = timeline.captions.flatMap((c) =>
      (c.emphasis ?? []).map((e) => c.lines[e.line]!.slice(e.from, e.to)),
    );
    expect(marks.join(' ')).toContain('too long');
    expect(marks.join(' ')).toContain('the limit');
    for (const file of ['video/captions.vtt', 'video/speech.json', 'video/narration.md'])
      if (existsSync(join(run, file)))
        expect(readFileSync(join(run, file), 'utf8'), file).not.toMatch(/\[\[|\]\]/);

    // The music lifts on the marked hero once its zoom-through has settled.
    const audio = read<{ music: { hero?: { moment: number } } }>(run, 'video/audio.json');
    expect(audio.music.hero?.moment).toBeCloseTo(compare!.start + 0.6, 2);

    const qc = read<{ checks: Array<{ id: string; status: string; message?: string }> }>(
      run,
      'video/qc.json',
    );
    const status = Object.fromEntries(qc.checks.map((c) => [c.id, c.status]));
    expect(status.hook).toBe('pass');
    expect(status.duration).toBe('pass');
    expect(Object.keys(status)).toEqual(expect.arrayContaining(['still', 'speech-share']));
    // freezedetect on the rendered MP4: the static scene holds still after its zoom while its
    // line goes on, and the captures that drift never do.
    const still = qc.checks.find((c) => c.id === 'still')!;
    expect(still.status).toBe('warn');
    expect(still.message).toMatch(/\bpixels \(/);
    // The code scene pushes in from its entrance through the gap before its pinned highlights.
    expect(still.message).not.toMatch(/\b(open|type|code|compare) \(/);
    // Every scene rests on a capture or a hunk, and every statement of Covi's explanation cites.
    expect(status.grounding).toBe('pass');
    expect(qc.checks.filter((c) => c.id !== 'still' && c.status !== 'pass')).toEqual([]);
    expect(existsSync(join(run, 'video', 'contact-sheet.jpg'))).toBe(true);
  }, 900_000);

  it('renders a storyboard that uses every component and sound field', async () => {
    const repo = await materializeExample(
      (await listExamples()).find((e) => e.name === 'ui-comment-composer')!,
    );
    const draft = covi(['video', '--repo', repo, '--short', '--draft']);
    const run = draft.runDir;
    // COVI_KEEP_RENDER=<file> keeps this render for review and writes its run directory there.
    if (process.env.COVI_KEEP_RENDER) writeFileSync(process.env.COVI_KEEP_RENDER, run);
    else dirs.push(repo);
    const demo = read<Demonstration>(run, 'demo/captures.json');
    const page = demo.shots.find(
      (s) => s.kind === 'page' && s.viewport === 'mobile' && s.before && s.after,
    )!;
    const steps = demo.shots
      .filter((s) => s.kind === 'flow-step' && s.viewport === 'mobile' && s.after)
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
      .slice(0, 2);
    expect(page).toBeDefined();
    expect(steps).toHaveLength(2);
    // A PNG's size is in its header: width at byte 16, height at byte 20.
    const size = (path: string) => {
      const png = readFileSync(join(run, path));
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    /** A band across the capture: the top, middle, or bottom third. */
    const band = (path: string, i: number) => {
      const { width, height } = size(path);
      return {
        x: Math.round(width * 0.1),
        y: Math.round(height * (0.1 + 0.3 * i)),
        width: Math.round(width * 0.8),
        height: Math.round(height * 0.2),
      };
    };
    const stepPath = (i: number) => steps[i]!.after!.path;

    const storyboard: StoryboardInput = {
      title: 'Count the characters left in a comment',
      template: 'feature-demo',
      draft: false,
      scenes: [
        {
          id: 'open',
          beat: 'context',
          narration: 'What stops a comment that is [[too long]] to post?',
          visual: {
            kind: 'title',
            title: 'Count the characters left',
            eyebrow: 'Comments',
            background: { path: page.after!.path, label: page.name },
          },
        },
        {
          id: 'type',
          beat: 'interaction',
          eyebrow: 'Type',
          narration: 'Type, and the counter counts down as you go.',
          transition: 'push',
          sync: { step2: 'the counter counts down', box: 'as you go' },
          cues: [{ at: 'box', kind: 'click' }],
          visual: {
            kind: 'interaction',
            steps: [
              {
                image: { path: stepPath(0) },
                label: steps[0]!.label,
                marks: [{ focus: band(stepPath(0), 1), label: 'The box' }],
              },
              {
                image: { path: stepPath(1) },
                label: steps[1]!.label,
                marks: [{ focus: band(stepPath(1), 2), label: 'The counter', sync: 'box' }],
              },
            ],
          },
        },
        {
          id: 'code',
          beat: 'implementation',
          eyebrow: 'The check',
          narration: 'Past the limit, the button gives way to a warning.',
          transition: 'cut',
          sync: { morph: 'gives way to', warn: 'a warning' },
          visual: {
            kind: 'code',
            path: 'app.js',
            language: 'javascript',
            mode: 'morph',
            lines: [
              { type: 'context', text: 'function update() {' },
              { type: 'del', text: '  post.disabled = !text;' },
              { type: 'add', text: '  post.disabled = !text || left < 0;' },
              { type: 'add', text: "  counter.classList.toggle('over', left < 0);" },
              { type: 'context', text: '}' },
            ],
            highlight: [{ lines: [2, 3], sync: 'warn' }],
            caption: 'Blocked past the limit',
          },
        },
        {
          id: 'compare',
          beat: 'review',
          eyebrow: 'Before and after',
          hero: true,
          narration: 'Before, nothing warned you. Now [[the limit]] shows.',
          sync: { reveal: 'Now the limit', hero: 'shows' },
          visual: {
            kind: 'before-after',
            before: { path: page.before!.path },
            after: { path: page.after!.path },
            ...(page.diff?.bounds ? { focus: page.diff.bounds } : {}),
          },
        },
        {
          id: 'look',
          beat: 'review',
          eyebrow: 'Worth a look',
          narration: 'The count turns red, and the button rests.',
          transition: 'wipe',
          sync: { mark2: 'the button rests' },
          cues: [{ at: 1, kind: 'reveal' }],
          visual: {
            kind: 'screenshot',
            image: { path: page.after!.path, label: page.name },
            device: 'mobile',
            marks: [
              { focus: band(page.after!.path, 1), label: 'The count' },
              { focus: band(page.after!.path, 2), label: 'The button' },
            ],
          },
        },
        {
          id: 'flow',
          beat: 'implementation',
          eyebrow: 'How it flows',
          narration: 'Typing feeds the counter, which gates the button.',
          transition: 'push',
          // A diagram shows nothing from the run, so it cites the hunk it draws.
          evidenceIds: ['diff-hunk:app.js:1'],
          visual: {
            kind: 'diagram',
            nodes: [
              { id: 'input', label: 'textarea' },
              { id: 'counter', label: 'counter', changed: true },
              { id: 'post', label: 'Post button', changed: true },
            ],
            edges: [
              { from: 'input', to: 'counter', label: 'input' },
              { from: 'counter', to: 'post', label: 'disables' },
            ],
          },
        },
        {
          id: 'wrap',
          beat: 'summary',
          eyebrow: 'Verdict',
          narration: 'Ready to merge.',
          minSeconds: 1.5,
          expression: 'success',
          visual: {
            kind: 'summary',
            verdict: 'looks-good',
            headline: 'A counter that blocks overlong comments',
            points: [],
          },
        },
      ],
    };
    writeFileSync(
      join(run, 'video', 'storyboard.json'),
      `${JSON.stringify(StoryboardSchema.parse(storyboard), null, 2)}\n`,
    );

    const rendered = covi(['render', '--repo', repo, '--run', draft.runId]);
    expect(rendered.video.rendered).toBe(true);
    expect(rendered.video.qc).not.toBe('fail');

    // The timeline carries every new field, resolved.
    const timeline = read<Timeline>(run, 'video/timeline.json');
    const scene = (id: string) => timeline.scenes.find((s) => s.id === id)!;
    const type = scene('type');
    const code = scene('code');
    const compare = scene('compare');
    expect(type.visual).toMatchObject({
      steps: [
        { marks: [{ label: 'The box', phase: 'mark1' }] },
        { marks: [{ label: 'The counter', phase: 'box' }] },
      ],
    });
    expect(code.visual).toMatchObject({
      mode: 'morph',
      highlight: [2, 3],
      groups: [{ lines: [2, 3], phase: 'warn' }],
      caption: 'Blocked past the limit',
    });
    expect(code.phases!.morph).toBeLessThan(code.phases!.warn!);
    expect(scene('look').visual).toMatchObject({
      marks: [{ phase: 'mark1' }, { phase: 'mark2' }],
    });
    expect(scene('flow').visual).toMatchObject({
      edges: [{ label: 'input' }, { label: 'disables' }],
    });
    expect(scene('flow').evidenceIds).toContain('diff-hunk:app.js:1');

    // Sounds land where the picture put their moments.
    const hit = timeline.cues.find((c) => c.kind === 'hero')!;
    expect(hit.t).toBeCloseTo(compare.start + compare.phases!.hero!, 3);
    const riser = timeline.cues.find((c) => c.kind === 'riser')!;
    expect(riser.t).toBeCloseTo(hit.t - 0.8, 3);
    expect(timeline.cues.filter((c) => c.kind === 'transition').map((c) => c.scene)).toEqual(
      expect.arrayContaining(['type', 'look', 'flow']),
    );
    expect(timeline.cues.some((c) => c.kind === 'click' && c.scene === 'type')).toBe(true);
    expect(timeline.cues.some((c) => c.kind === 'reveal' && c.scene === 'look')).toBe(true);

    // In the browser, each component moves at its phase, and falls back where it has none.
    const browser = await chromium.launch();
    try {
      const tab = await browser.newPage({
        viewport: { width: timeline.width, height: timeline.height },
      });
      const errors: string[] = [];
      tab.on('pageerror', (error) => errors.push(error.message));
      await tab.goto(`file://${join(run, 'video', 'composition', 'index.html')}`);
      await tab.waitForFunction('window.covi !== undefined');
      await tab.evaluate('window.covi.ready');
      const look = <T>(id: string, seconds: number, body: string) =>
        tab.evaluate(
          `(() => { window.covi.seek(${Math.round((scene(id).start + seconds) * timeline.fps)}); const scene = document.querySelector('[data-scene="${id}"]'); ${body} })()`,
        ) as Promise<T>;
      const gloss = (id: string, seconds: number) =>
        look<{ text: string; shown: number }>(
          id,
          seconds,
          `const gloss = scene.querySelector('.gloss');
           return { text: gloss.textContent, shown: Number.parseFloat(gloss.style.opacity || '0') };`,
        );

      // The code: the old line until the morph phase, the group lit as one at its phase.
      const v = code.visual as Extract<TimelineVisual, { kind: 'code' }>;
      const codeSeconds = code.end - code.start;
      const m = morphTiming(codeSeconds, v.lines, code.phases);
      expect(m.strike[0]).toBeCloseTo(code.phases!.morph!, 3);
      const rows = (seconds: number) =>
        look<{ heights: number[]; struck: boolean[]; lit: number[] }>(
          'code',
          seconds,
          `const rows = [...scene.querySelectorAll('.ln')];
           return {
             heights: rows.map((r) => Number.parseFloat(r.style.height || '1.55')),
             struck: rows.map((r) => r.classList.contains('struck')),
             lit: rows.map((r) => Number.parseFloat(r.querySelector('.hl')?.style.opacity ?? '0')),
           };`,
        );
      const old = await rows(m.strike[0] - 0.15);
      expect(old.heights.slice(2, 4)).toEqual([0, 0]);
      expect(old.struck).toEqual([false, false, false, false, false]);
      const lit = await rows(Math.min(m.end + 0.55, codeSeconds - 0.02));
      expect(lit.struck[1]).toBe(true);
      expect(lit.lit[2]).toBeCloseTo(1, 2);
      expect(lit.lit[3]).toBeCloseTo(1, 2);

      // The steps: the first mark where it falls by default, the second at the phase it names.
      const iv = type.visual as Extract<TimelineVisual, { kind: 'interaction' }>;
      const stepTiming = interactionTiming(
        type.end - type.start,
        iv.steps.length,
        type.phases,
        iv.steps.map((s) => s.marks),
      );
      const counter = stepTiming[1]!.marks![0]!;
      expect(counter.start).toBeCloseTo(type.phases!.box!, 3);
      const box = stepTiming[0]!.marks![0]!;
      expect((await gloss('type', box.pan[1] - 0.05)).text).toBe('1/2  The box');
      expect((await gloss('type', counter.pan[1] + 0.05)).text).toBe('2/2  The counter');

      // The screenshot: the second mark at its phase, the unpinned first sharing the time before.
      const sv = scene('look').visual as Extract<TimelineVisual, { kind: 'screenshot' }>;
      const lookSeconds = scene('look').end - scene('look').start;
      const [count, button] = screenshotMarks(lookSeconds, sv.marks!, scene('look').phases).marks;
      expect(button!.start).toBeCloseTo(scene('look').phases!.mark2!, 3);
      expect(count!.start).toBeCloseTo(button!.start / 2, 6);
      expect(await gloss('look', count!.pan[1] - 0.05)).toEqual({ text: 'The count', shown: 1 });
      expect(await gloss('look', button!.pan[1] + 0.05)).toEqual({ text: 'The button', shown: 1 });

      // The diagram: both edge labels shown once their edges have drawn.
      const flowSeconds = scene('flow').end - scene('flow').start;
      expect(edgeLabelEntrance(1)[1]).toBeLessThan(flowSeconds);
      const labels = await look<[string, number][]>(
        'flow',
        flowSeconds - 0.05,
        `return [...scene.querySelectorAll('.edge-label')].map((l) =>
           [l.textContent, Number.parseFloat(l.style.opacity || '0')]);`,
      );
      expect(labels).toEqual([
        ['input', 1],
        ['disables', 1],
      ]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }

    // What the mix did with them: the new engine, the whooshes placed, and the riser swelling
    // into the hero's hit.
    type Audio = {
      engine: string;
      effects: {
        placed: Array<{ kind: string; t: number }>;
        dropped: Array<{ kind: string; t: number; reason: string }>;
      };
    };
    const audio = read<Audio>(run, 'video/audio.json');
    expect(audio.engine).toBe('covi-audio-4');
    const placed = (kind: string) => audio.effects.placed.filter((p) => p.kind === kind);
    expect(placed('transition').length).toBeGreaterThanOrEqual(3);
    expect(placed('hero').map((p) => p.t)).toEqual([expect.closeTo(hit.t, 3)]);
    expect(placed('riser').map((p) => p.t)).toEqual([expect.closeTo(hit.t - 0.8, 3)]);

    const qc = read<{ checks: Array<{ id: string; status: string; message?: string }> }>(
      run,
      'video/qc.json',
    );
    const status = Object.fromEntries(qc.checks.map((c) => [c.id, c.status]));
    expect(status.hook).toBe('pass');
    expect(status.duration).toBe('pass');
    // Every scene rests on the run's evidence: the diagram by its citation.
    expect(status.grounding).toBe('pass');
    // Glosses, the code caption, and edge labels fit; nothing covers the captions.
    expect(qc.checks.filter((c) => c.id !== 'still' && c.status !== 'pass')).toEqual([]);
    expect(existsSync(join(run, 'video', 'contact-sheet.jpg'))).toBe(true);

    // Crowded: two cues of the hero scene's own in the second before its hit leave the riser
    // more than three effects a second, so it gives way and the hit still lands. (Wherever the
    // before/after reveal falls, at least two of the three stay 0.15 s apart inside that second.)
    const crowdedRun = `${run}-crowded`;
    cpSync(run, crowdedRun, { recursive: true });
    const hero = compare.phases!.hero!;
    expect(hero).toBeGreaterThan(0.8);
    const crowded = StoryboardSchema.parse({
      ...storyboard,
      scenes: storyboard.scenes.map((s) =>
        s.id === 'compare'
          ? {
              ...s,
              cues: [
                { at: Math.round((hero - 0.6) * 1000) / 1000, kind: 'click' },
                { at: Math.round((hero - 0.35) * 1000) / 1000, kind: 'reveal' },
              ],
            }
          : s,
      ),
    });
    const crowdedFile = join(crowdedRun, 'video', 'storyboard-crowded.json');
    writeFileSync(crowdedFile, `${JSON.stringify(crowded, null, 2)}\n`);
    const again = covi([
      'render',
      '--repo',
      repo,
      '--run',
      crowdedRun,
      '--storyboard',
      crowdedFile,
    ]);
    expect(again.video.rendered).toBe(true);
    expect(again.video.qc).not.toBe('fail');
    const busy = read<Audio>(crowdedRun, 'video/audio.json');
    expect(busy.effects.placed.filter((p) => p.kind === 'hero').map((p) => p.t)).toEqual([
      expect.closeTo(hit.t, 3),
    ]);
    expect(busy.effects.placed.some((p) => p.kind === 'riser')).toBe(false);
    expect(busy.effects.dropped).toContainEqual(
      expect.objectContaining({ kind: 'riser', reason: 'more than 3 per second' }),
    );
  }, 900_000);
});

describe.skipIf(!available || !fullRenders)('an agent’s direction (full pipeline)', () => {
  it('renders the shot an agent wrote, code beside a node and a label, and QC reads it', async () => {
    const repo = await materializeExample(
      (await listExamples()).find((e) => e.name === 'backend-slim-request')!,
    );
    dirs.push(repo);
    const draft = covi(['video', '--repo', repo, '--short', '--draft']);
    const run = draft.runDir;
    const evidence = read<{ items: Array<{ id: string; kind: string }> }>(run, 'evidence.json');
    const hunk = evidence.items.find((i) => i.kind === 'diff-hunk' && i.id.includes(':src/'));
    const drafted = read<StoryboardInput>(run, 'video/storyboard.json');
    const scene = drafted.scenes.find((s) => s.visual.kind === 'code');
    expect(hunk).toBeDefined();
    expect(scene?.id).toBeDefined();
    // The agent's own shot: no longer Covi's draft, so it is checked against the run and kept.
    const direction = DirectionSchema.parse({
      schemaVersion: 1,
      draft: false,
      shots: [
        {
          scene: scene!.id,
          layout: 'auto',
          elements: [
            { id: 'fix', kind: 'code', evidence: hunk!.id, side: 'diff' },
            { id: 'reader', kind: 'node', label: 'Reader' },
            { id: 'note', kind: 'label', text: 'Fetches each document', tone: 'success' },
          ],
          beats: [
            { verb: 'reveal', element: 'note', style: 'pop' },
            { verb: 'camera', move: 'zoom', to: 'reader' },
          ],
        },
      ],
    });
    writeFileSync(join(run, 'video', 'direction.json'), `${JSON.stringify(direction, null, 2)}\n`);

    const rendered = covi(['render', '--repo', repo, '--run', draft.runId]);
    expect(rendered.video.rendered).toBe(true);
    expect(rendered.video.qc).not.toBe('fail');
    const qc = read<{ checks: Array<{ id: string; status: string }> }>(run, 'video/qc.json');
    expect(qc.checks.filter((c) => c.status === 'fail')).toEqual([]);
    const status = (id: string) => qc.checks.find((c) => c.id === id)?.status;
    expect(status('text-fits')).toBe('pass');
    expect(status('captions-clear-of-content')).toBe('pass');

    // The timeline holds the shot as resolved, its beats timed.
    const timeline = read<Timeline>(run, 'video/timeline.json');
    const drawn = timeline.scenes.find((s) => s.id === scene!.id)!;
    expect(drawn.direction!.whole).toBe(false);
    expect(drawn.direction!.elements.map((e) => [e.id, e.kind])).toEqual([
      ['fix', 'code'],
      ['reader', 'node'],
      ['note', 'label'],
    ]);
    expect(drawn.direction!.beats.map((b) => b.verb)).toEqual(['reveal', 'camera']);
    // And QC read it as drawn: a frame sampled in the scene holds the node's and label's text.
    const frames = read<{ layouts: LayoutReport[] }>(run, 'video/frames.json');
    const body = (report: LayoutReport) => report.items.filter((i) => i.text === 'body').length;
    expect(
      frames.layouts.some((l) => l.scene === drawn.id && body(l) === 2 + (drawn.heading ? 1 : 0)),
    ).toBe(true);
  }, 600_000);
});
