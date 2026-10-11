import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type DirectionElement,
  type LayoutReport,
  layoutScenes,
  pacingFor,
  type Rect,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { elementSlots } from '../../packages/video/src/direction/layout.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import {
  countProgress,
  formatNumber,
  tickValue,
} from '../../packages/video/src/runtime/numbers.ts';
import { TEXT_FLOOR } from '../../packages/video/src/runtime/sizing.ts';
import { orientationOf } from '../../packages/video/src/spec.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * Measured numbers, drawn in Chromium: a counter ticking from before to after, bars on one scale,
 * and the two values side by side. Files under tests/ are typechecked without DOM types, so the
 * page reads its own elements from scripts; `runtime/numbers.ts` and `runtime/layout.ts` are
 * DOM-free.
 */

const available = await canUseBrowser();
const dirs: string[] = [];
let browser: Browser | undefined;
beforeAll(async () => {
  if (available) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const LANDSCAPE = { width: 640, height: 360 };
const VERTICAL = { width: 360, height: 640 };
const SQUARE = { width: 360, height: 360 };
type Size = typeof LANDSCAPE;
type Metric = Extract<DirectionElement, { kind: 'metric' }>;

const terminal = {
  kind: 'terminal',
  title: 'Measure the review request',
  command: 'node scripts/measure.js',
  before: 'request bytes: 70406\nchunks: 4',
  output: 'request bytes: 9907\nchunks: 1',
} as const;

/** The metric's slot and the visual's beside it (below it when tall), as the director lays them out. */
function slots(size: Size) {
  const orientation = orientationOf(size.width, size.height);
  const r = computeRegions({ ...size, orientation });
  const [metric, visual] = elementSlots(
    ['metric', 'visual'],
    orientation === 'vertical' ? 'column' : 'row',
    r.media,
    orientation,
    28 * r.unit,
  ) as [Rect, Rect];
  return { regions: r, metric, visual };
}

const bytes = (rect: Rect, extra: Partial<Metric> = {}): Metric => ({
  id: 'bytes',
  kind: 'metric',
  rect,
  show: 'counter',
  name: 'request bytes',
  from: 70406,
  to: 9907,
  decimals: 0,
  delta: -86,
  ...extra,
});
const COUNT = {
  verb: 'count',
  element: 'bytes',
  t: 1.5,
  seconds: 1.6,
} as const satisfies DirectionBeat;

interface Read {
  value: string | null;
  valueFont: number | null;
  row: Rect | null;
  delta: string | null;
  deltaOpacity: number | null;
  name: string | null;
  nameChildren: number | null;
  fills: number[];
  nums: string[];
  head: number | null;
  arrow: number | null;
  card: Rect | null;
  /** The card's direct parts: the name, the value row, bars, or pair, and the change. */
  parts: Rect[];
  valueBox: Rect | null;
  /** The value's text as drawn, inside its box. */
  valueText: Rect | null;
  /** The value's text is wider than its box. */
  valueClipped: boolean | null;
  unitBox: Rect | null;
  numBoxes: Rect[];
  arrowText: string | null;
  arrowShape: boolean;
}

/**
 * A two-scene composition whose second scene shows a metric beside the terminal it came from (the
 * shot the default director gives a terminal scene), opened at `size`. A `static` camera holds
 * the shot still, for a test that measures where the metric's parts are drawn across frames: the
 * push-in moves everything in it.
 */
async function staged(
  make: (rect: Rect) => Metric = (rect) => bytes(rect),
  beats: DirectionBeat[] = [COUNT],
  size: Size = LANDSCAPE,
  camera?: 'static',
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-metric-'));
  dirs.push(dir);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', ...size });
  const title = 'Send document references';
  const scenes = StoryboardSchema.parse({
    title,
    template: 'bug-fix',
    scenes: [
      {
        id: 's1',
        beat: 'a',
        narration: 'The request carried every document.',
        visual: { kind: 'callout', title: 'Before' },
      },
      {
        id: 's2',
        beat: 'b',
        narration:
          'Here is the same command before and after, and it now prints request bytes: 9907.',
        minSeconds: 6,
        visual: terminal,
        ...(camera ? { camera } : {}),
      },
    ],
  }).scenes;
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  const s = slots(size);
  const staging: SceneStaging[] = [
    {
      stop: { x: 0, y: 0 },
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect: s.regions.media }],
        beats: [],
      },
    },
    {
      stop: { x: Math.round(size.width * 1.25), y: 0 },
      direction: {
        whole: false,
        elements: [make(s.metric), { id: 'visual', kind: 'visual', rect: s.visual }],
        beats,
      },
    },
  ];
  const timeline = buildTimeline({
    title,
    scenes,
    layout,
    spec,
    image: () => ({ src: '', width: 1, height: 1 }),
    staging,
  });
  await writeComposition(join(dir, 'composition'), timeline, new Map());
  const page = await browser!.newPage({ viewport: size });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(dir, 'composition', 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const s2 = timeline.scenes.find((x) => x.id === 's2')!;
  const frameAt = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  /** Seconds into s2 at a frame, as the runtime's clock has them. */
  const local = (frame: number) => frame / timeline.fps - s2.start;
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const read = (frame: number) =>
    seek(
      frame,
      `const root = document.querySelector('[data-element="bytes"]');
       const q = (s) => root.querySelector(s);
       const all = (s) => [...root.querySelectorAll(s)];
       const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
       const op = (n) => (n ? Number.parseFloat(n.style.opacity || '1') : null);
       const value = q('.mvalue');
       return {
         value: value?.textContent ?? null,
         valueFont: q('.mrow') ? Number.parseFloat(getComputedStyle(q('.mrow')).fontSize) : null,
         row: q('.mrow') ? box(q('.mrow')) : null,
         delta: q('.mdelta')?.textContent ?? null,
         deltaOpacity: op(q('.mdelta')),
         name: q('.mname')?.textContent ?? null,
         nameChildren: q('.mname')?.children.length ?? null,
         fills: all('.mfill').map((f) => Number.parseFloat(f.style.width)),
         nums: all('.mnum').map((n) => n.textContent),
         head: op(q('.mside.head')),
         arrow: op(q('.marrow')),
         card: q('.mcard') ? box(q('.mcard')) : null,
         parts: q('.mcard') ? [...q('.mcard').children].map(box) : [],
         valueBox: value ? box(value) : null,
         valueText: value ? (() => { const r = document.createRange(); r.selectNodeContents(value); return box(r); })() : null,
         valueClipped: value ? value.scrollWidth > value.clientWidth + 1 : null,
         unitBox: q('.munit') ? box(q('.munit')) : null,
         numBoxes: all('.mnum').map(box),
         arrowText: q('.marrow')?.textContent ?? null,
         arrowShape: Boolean(q('.marrow svg path')),
       };`,
    ) as Promise<Read>;
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, unit: s.regions.unit, frameAt, local, seek, read, report, shot, errors };
}

/** Frames through a count, from its start to its end. */
const through = (v: Awaited<ReturnType<typeof staged>>, steps = 8) =>
  Array.from({ length: steps + 1 }, (_, i) => v.frameAt(COUNT.t + (i / steps) * COUNT.seconds));

/** Whether `inner` lies inside `outer`, to a pixel. */
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

describe.skipIf(!available)('a metric on screen', () => {
  it('ticks from the value before to the value after, eased, and shows the change once it lands', async () => {
    const v = await staged();
    const mid = v.frameAt(COUNT.t + COUNT.seconds / 2);
    const expected = formatNumber(tickValue(70406, 9907, countProgress(v.local(mid), COUNT), 0), 0);
    const during = await v.read(mid);
    expect(during.value).toBe(expected);
    expect(during.value).toMatch(/^\d{1,3}(,\d{3})*$/);
    const n = Number(during.value!.replace(/,/g, ''));
    expect(n).toBeGreaterThan(9907);
    expect(n).toBeLessThan(70406);
    const before = await v.read(v.frameAt(COUNT.t - 0.3));
    expect(before).toMatchObject({ value: '70,406', deltaOpacity: 0 });
    const after = await v.read(v.frameAt(COUNT.t + COUNT.seconds + 0.4));
    expect(after).toMatchObject({ value: '9,907', delta: '−86%', deltaOpacity: 1 });
    // One size through the whole count, and nothing overflows mid-tick.
    expect(during.valueFont).toBe(before.valueFont);
    expect(after.valueFont).toBe(before.valueFont);
    expect((await v.report(mid)).items.some((i) => i.overflow)).toBe(false);
    expect(v.errors).toEqual([]);
  });

  for (const [size, label] of [
    [LANDSCAPE, '16:9'],
    [VERTICAL, '9:16'],
    [SQUARE, '1:1'],
  ] as const)
    it(`is the largest text on screen when it lands, at least 120 px at 1080p (${label})`, async () => {
      const v = await staged(undefined, [COUNT], size);
      const landed = v.frameAt(COUNT.t + COUNT.seconds + 0.2);
      const { row, card, parts } = await v.read(landed);
      const items = (await v.report(landed)).items.filter((i) => i.font !== undefined);
      const top = items.reduce((a, b) => (b.font! > a.font! ? b : a));
      // The largest text is the counter's value row, beside the terminal's code and the heading.
      expect(Math.abs(top.rect.x - row!.x)).toBeLessThan(1);
      expect(Math.abs(top.rect.width - row!.width)).toBeLessThan(1);
      expect(top.font! / v.unit).toBeGreaterThanOrEqual(120);
      for (const other of items)
        if (other !== top) expect(other.font!).toBeLessThan(0.6 * top.font!);
      // The terminal beside it keeps its code readable.
      const code = items.filter((i) => i.text === 'code');
      expect(code.length).toBeGreaterThan(0);
      for (const c of code) expect(c.font! / v.unit).toBeGreaterThanOrEqual(TEXT_FLOOR.code - 0.1);
      // The card holds its name, value, and change: none is cut off at its edges.
      expect(parts).toHaveLength(3);
      for (const part of parts) expect(inside(part, card!)).toBe(true);
    });

  it('keeps the value in place while it counts, its unit beside it held to the body floor', async () => {
    const v = await staged(
      (rect) => bytes(rect, { name: 'request size', unit: 'bytes' }),
      [COUNT],
      LANDSCAPE,
      'static',
    );
    const reads: Read[] = [];
    for (const frame of through(v)) reads.push(await v.read(frame));
    // It counts: one value per frame or so.
    expect(new Set(reads.map((r) => r.value)).size).toBeGreaterThan(5);
    const [first] = reads;
    for (const r of reads) {
      expect(r.valueBox!.x).toBeCloseTo(first!.valueBox!.x, 2);
      expect(r.valueBox!.width).toBeCloseTo(first!.valueBox!.width, 2);
      expect(r.unitBox!.x).toBeCloseTo(first!.unitBox!.x, 2);
      expect(r.valueClipped).toBe(false);
    }
    const landed = v.frameAt(COUNT.t + COUNT.seconds + 0.4);
    const { unitBox, card, parts } = await v.read(landed);
    const unit = (await v.report(landed)).items.find(
      (i) =>
        i.role === 'text' &&
        Math.abs(i.rect.x - unitBox!.x) < 1 &&
        Math.abs(i.rect.width - unitBox!.width) < 1,
    );
    expect(unit).toMatchObject({ text: 'body', overflow: false });
    expect(unit!.font! / v.unit).toBeGreaterThanOrEqual(TEXT_FLOOR.body - 0.1);
    for (const part of parts) expect(inside(part, card!)).toBe(true);
  });

  it('eases the landed value to its own width once it lands, so it ends centered', async () => {
    const v = await staged();
    const end = COUNT.t + COUNT.seconds;
    const center = (r: Rect) => r.x + r.width / 2;
    const landed = await v.read(v.frameAt(end));
    // Held at the widest value as it lands: 9,907 sits right of center in 70,406's width.
    expect(landed.value).toBe('9,907');
    expect(landed.valueBox!.width).toBeGreaterThan(landed.valueText!.width + 4);
    expect(center(landed.valueText!) - center(landed.card!)).toBeGreaterThan(2);
    const easing = v.frameAt(end + 0.15);
    const mid = await v.read(easing);
    expect(mid.valueBox!.width).toBeLessThan(landed.valueBox!.width);
    expect(mid.valueBox!.width).toBeGreaterThan(mid.valueText!.width);
    const settled = await v.read(v.frameAt(end + 0.4));
    expect(settled.valueBox!.width).toBeCloseTo(settled.valueText!.width, 0);
    expect(Math.abs(center(settled.valueText!) - center(settled.card!))).toBeLessThan(1);
    // A pure function of the clock: the same frame, however it is reached.
    await v.read(v.frameAt(COUNT.t));
    expect((await v.read(easing)).valueBox).toEqual(mid.valueBox);
  });

  it('grows or shrinks the after bar with the count, on one scale with the before bar', async () => {
    const v = await staged((rect) => bytes(rect, { show: 'bars' }));
    const start = await v.read(v.frameAt(COUNT.t - 0.2));
    expect(start.fills).toEqual([100, 100]);
    expect(start.nums).toEqual(['70,406', '70,406']);
    const mid = await v.read(v.frameAt(COUNT.t + COUNT.seconds / 2));
    expect(mid.fills[1]).toBeLessThan(100);
    expect(mid.fills[1]).toBeGreaterThan((100 * 9907) / 70406);
    const end = await v.read(v.frameAt(COUNT.t + COUNT.seconds + 0.2));
    expect(end.fills[0]).toBe(100);
    expect(end.fills[1]).toBeCloseTo((100 * 9907) / 70406, 2);
    expect(end.nums).toEqual(['70,406', '9,907']);
    expect(
      (await v.report(v.frameAt(COUNT.t + COUNT.seconds / 2))).items.some((i) => i.overflow),
    ).toBe(false);
    for (const part of end.parts) expect(inside(part, end.card!)).toBe(true);
  });

  it('compares the two values side by side, the after value landing last', async () => {
    const v = await staged((rect) => bytes(rect, { show: 'compare' }));
    const before = await v.read(v.frameAt(COUNT.t - 0.5));
    expect(before).toMatchObject({ head: 0, arrow: 0 });
    expect(before.nums[0]).toBe('70,406');
    const after = await v.read(v.frameAt(COUNT.t + COUNT.seconds + 0.4));
    expect(after).toMatchObject({ head: 1, arrow: 1, nums: ['70,406', '9,907'], delta: '−86%' });
  });

  it('draws the compare’s arrow as a shape, and keeps both values in place while one counts', async () => {
    const v = await staged(
      (rect) => bytes(rect, { show: 'compare' }),
      [COUNT],
      LANDSCAPE,
      'static',
    );
    const reads: Read[] = [];
    for (const frame of through(v)) reads.push(await v.read(frame));
    const [first] = reads;
    for (const r of reads)
      r.numBoxes.forEach((b, i) => {
        expect(b.x).toBeCloseTo(first!.numBoxes[i]!.x, 2);
        expect(b.width).toBeCloseTo(first!.numBoxes[i]!.width, 2);
      });
    // The arrow is not a glyph: the embedded font has no arrow, and a fallback face varies by host.
    const end = reads.at(-1)!;
    expect(end).toMatchObject({ arrowText: '', arrowShape: true });
    for (const part of end.parts) expect(inside(part, end.card!)).toBe(true);
  });

  it('wraps a name too long for one line, rather than cutting it short', async () => {
    const name = 'requests per second under sustained load from many clients';
    const v = await staged((rect) => bytes(rect, { name }));
    const landed = v.frameAt(COUNT.t + COUNT.seconds + 0.4);
    const read = await v.read(landed);
    expect(read.name).toBe(name);
    expect((await v.report(landed)).items.some((i) => i.overflow)).toBe(false);
    for (const part of read.parts) expect(inside(part, read.card!)).toBe(true);
  });

  it('shows one value alone without a change, and its name as text, whatever it holds', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const v = await staged(
      (rect) => ({
        id: 'bytes',
        kind: 'metric',
        rect,
        show: 'counter',
        name: hostile,
        to: 70406,
        decimals: 0,
      }),
      [],
    );
    const frame = v.frameAt(2);
    expect(await v.read(frame)).toMatchObject({
      value: '70,406',
      delta: null,
      name: hostile,
      nameChildren: 0,
    });
    expect(
      await v.seek(
        frame,
        'return [window.__pwned ?? null, document.querySelectorAll("[data-element] img").length];',
      ),
    ).toEqual([null, 0]);
  });

  it('draws the same frame every time', async () => {
    const a = await staged();
    const b = await staged();
    const mid = a.frameAt(COUNT.t + COUNT.seconds / 2);
    const first = await a.shot(mid);
    await a.shot(a.frameAt(0.5));
    expect((await a.shot(mid)).equals(first)).toBe(true);
    expect((await b.shot(mid)).equals(first)).toBe(true);
  });
});
