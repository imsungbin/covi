import { execFileSync } from 'node:child_process';
import {
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
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../../packages/cli/src/examples.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import {
  edgeEntrance,
  edgeLabelEntrance,
  interactionTiming,
  morphTiming,
  screenshotMarks,
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
   * Builds a 360×640 composition from storyboard scenes, with one 640×400 capture at demo/a.png,
   * and opens it. `look` seeks to a frame and evaluates `body`, a function body over `scene` (that
   * scene's root element). `redact` rewrites every narration after validation, as the redactor
   * can, so a phrase it hides pins nothing.
   */
  async function compose(
    browser: Browser,
    scenes: StoryboardInput['scenes'],
    redact?: (narration: string) => string,
  ) {
    const dir = mkdtempSync(join(tmpdir(), 'covi-parts-'));
    dirs.push(dir);
    const capture = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await capture.setContent(
      '<body style="margin:0;background:linear-gradient(90deg,#2a6f97,#f4a261)"></body>',
    );
    mkdirSync(join(dir, 'demo'));
    await capture.screenshot({ path: join(dir, 'demo', 'a.png') });
    await capture.close();
    const spec = resolveVideoSpec(resolveConfig([]).config, {
      mode: 'custom',
      width: 360,
      height: 640,
    });
    const parsed = StoryboardSchema.parse({ ...storyboard, scenes }).scenes.map((s) =>
      redact ? { ...s, narration: redact(s.narration) } : s,
    );
    const layout = layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(spec));
    const assets = new AssetCollector(dir);
    await assets.prepare(['demo/a.png']);
    const timeline = buildTimeline({
      title: storyboard.title,
      scenes: parsed,
      layout,
      spec,
      image: assets.image,
    });
    const composition = join(dir, 'composition');
    await writeComposition(composition, timeline, assets.files);
    const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
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
      const long = Array.from({ length: 8 }, () => 'the quantity is clamped at zero').join(', ');
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
      const long = 'validates every quantity before it ever reaches the cart total';
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

describe.skipIf(!available || !fullRenders)('the timing grammar (full pipeline)', () => {
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
  const read = <T>(run: string, rel: string) =>
    JSON.parse(readFileSync(join(run, rel), 'utf8')) as T;

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

    const rendered = covi(['render', '--repo', repo, '--run', draft.runId]);
    expect(rendered.video.rendered).toBe(true);
    expect(rendered.video.qc).not.toBe('fail');

    const timeline = read<Timeline>(run, 'video/timeline.json');
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
});
