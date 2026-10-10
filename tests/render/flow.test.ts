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
import { edgeRoute, pointAlong } from '../../packages/video/src/runtime/routes.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * Flow verbs, drawn in Chromium from timelines built by hand (elements and beats as the resolver
 * writes them): packets travel edges between nodes, splits fan into as many pieces as their count
 * (twelve at most) and merges pull them back, piles stack up to their true number, and counters
 * count up. Files under tests/ are typechecked without DOM types, so the page reads its own
 * elements; `runtime/routes.ts` and `runtime/layout.ts` are DOM-free.
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
type Size = typeof LANDSCAPE;
type Point = { x: number; y: number };

/** The media region of a frame, and its two halves side by side (one above the other when tall). */
function regionsOf(size: Size) {
  const tall = size.height > size.width;
  const regions = computeRegions({ ...size, orientation: tall ? 'vertical' : 'landscape' });
  const m = regions.media;
  const gap = 28 * regions.unit;
  const half = tall ? (m.height - gap) / 2 : (m.width - gap) / 2;
  const left: Rect = tall ? { ...m, height: half } : { ...m, width: half };
  const right: Rect = tall
    ? { ...m, y: m.y + half + gap, height: half }
    : { ...m, x: m.x + half + gap, width: half };
  const pivot = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
  return { regions, media: m, left, right, pivot };
}

/** Four node slots as the resolver lays them out: a grid of two rows of two (`auto`), or a row. */
const fourNodes = (layout: 'auto' | 'row') => (r: ReturnType<typeof regionsOf>) =>
  elementSlots(Array(4).fill('node'), layout, r.media, 'landscape', 28 * r.regions.unit);
const grid = fourNodes('auto');
const row = fourNodes('row');

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A two-scene composition whose second scene stages `elements` with `beats` (seconds since that
 * scene started), opened in Chromium at `size`.
 */
async function staged(
  elements: (r: ReturnType<typeof regionsOf>) => DirectionElement[],
  beats: DirectionBeat[],
  size: Size = LANDSCAPE,
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
  dirs.push(dir);
  const r = regionsOf(size);
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
        narration: 'The request broke into chunks, and the reader took many steps to read them.',
        minSeconds: 7,
        visual: { kind: 'callout', title: 'After' },
      },
    ],
  }).scenes;
  const staging: SceneStaging[] = [
    {
      stop: { x: 0, y: 0 },
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect: r.media }],
        beats: [],
      },
    },
    {
      stop: { x: Math.round(size.width * 1.25), y: 0 },
      direction: { whole: false, elements: elements(r), beats },
    },
  ];
  const timeline = buildTimeline({
    title,
    scenes,
    layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
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
  const s2 = timeline.scenes.find((s) => s.id === 's2')!;
  const frameAt = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  /** Seconds into s2 at a frame, as the runtime's clock has them. */
  const local = (frame: number) => frame / timeline.fps - s2.start;
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, r, frameAt, local, seek, report, shot, errors };
}

type Staged = Awaited<ReturnType<typeof staged>>;

interface Drawn {
  /** Drawn boxes by selector, in screen pixels; the visible ones only for pieces and items. */
  nodes: Record<string, Rect>;
  packet: (Rect & { opacity: number; label: string | null; children: number }) | null;
  pieces: Rect[];
  badges: Array<{ opacity: number; side: string; name: string; num: string; children: number }>;
  /** The count captions on screen. */
  badgeBoxes: Rect[];
  edge: { offset: number; length: number; head: number } | null;
  dot: (Rect & { opacity: number }) | null;
  rows: Array<{ cap: string; items: number; num: string; numOpacity: number }>;
  pileName: string | null;
  value: string | null;
}

/** What scene s2 draws at a frame. */
const read = (v: Staged, frame: number) =>
  v.seek(
    frame,
    `const scene = document.querySelector('[data-scene="s2"]');
     const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
     const op = (n) => Number.parseFloat(n.style.opacity || '1');
     const nodes = {};
     for (const n of scene.querySelectorAll('[data-element] .dnode')) nodes[n.closest('[data-element]').dataset.element] = box(n);
     const pill = scene.querySelector('.fpacket');
     const path = scene.querySelector('.flows path');
     const head = scene.querySelector('.flows polygon');
     const dot = scene.querySelector('.fdot');
     return {
       nodes,
       packet: pill ? { ...box(pill), opacity: op(pill), label: pill.querySelector('.nlabel')?.textContent ?? null, children: pill.querySelector('.nlabel')?.children.length ?? 0 } : null,
       pieces: [...scene.querySelectorAll('.fpiece')].filter((n) => op(n) > 0).map(box),
       badges: [...scene.querySelectorAll('.fbadge')].map((badge) => ({ opacity: op(badge), side: badge.querySelector('.fside').textContent,
         name: badge.querySelector('.fname').textContent, num: badge.querySelector('.fnum').textContent, children: badge.querySelector('.fname').children.length })),
       badgeBoxes: [...scene.querySelectorAll('.fbadge')].filter((n) => op(n) > 0).map(box),
       edge: path ? { offset: Number(path.getAttribute('stroke-dashoffset')), length: Number(path.getAttribute('stroke-dasharray')), head: op(head) } : null,
       dot: dot ? { ...box(dot), opacity: op(dot) } : null,
       rows: [...scene.querySelectorAll('.prow')].map((row) => ({
         cap: row.querySelector('.pcap').textContent,
         items: [...row.querySelectorAll('.pitem')].filter((n) => op(n) > 0).length,
         num: row.querySelector('.pnum').textContent,
         numOpacity: op(row.querySelector('.pnum')),
       })),
       pileName: scene.querySelector('.pname')?.textContent ?? null,
       value: scene.querySelector('.mvalue')?.textContent ?? null,
     };`,
  ) as Promise<Drawn>;

/** Two nodes side by side, and (`packet`) a packet `p` that rides from the first, as resolved. */
const twoNodes =
  (packet = false) =>
  (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
    { id: 'a', kind: 'node', rect: r.left, label: 'Request builder' },
    { id: 'b', kind: 'node', rect: r.right, label: 'Reader' },
    ...(packet ? [{ id: 'p', kind: 'packet', rect: r.left } as const] : []),
  ];
const FLOW = { verb: 'flow', from: 'a', to: 'b', packet: 'p', t: 1, seconds: 1.2 } as const;
const chunks = (count: number, t = 1) =>
  ({ verb: 'split', element: 'q', count, name: 'chunks', side: 'base', t, seconds: 0.9 }) as const;
const alone = (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
  { id: 'q', kind: 'packet', rect: r.media },
];

describe.skipIf(!available)('packets on edges', () => {
  it('carries a packet along the edge between two nodes, eased, drawing the edge behind it', async () => {
    const v = await staged(twoNodes(true), [FLOW]);
    const route = (d: Drawn) => edgeRoute(d.nodes.a!, d.nodes.b!);
    const before = await read(v, v.frameAt(0.5));
    expect(near(center(before.packet!), route(before)[0]!)).toBeLessThan(1.5);
    expect(before.edge!.offset).toBeCloseTo(before.edge!.length, 1);
    expect(before.edge!.head).toBe(0);
    const frame = v.frameAt(FLOW.t + FLOW.seconds / 2);
    const mid = await read(v, frame);
    const k = (v.local(frame) - FLOW.t) / FLOW.seconds;
    const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    expect(near(center(mid.packet!), pointAlong(route(mid), eased))).toBeLessThan(1.5);
    expect(mid.edge!.offset / mid.edge!.length).toBeCloseTo(1 - eased, 2);
    const after = await read(v, v.frameAt(FLOW.t + FLOW.seconds + 0.3));
    expect(near(center(after.packet!), route(after).at(-1)!)).toBeLessThan(1.5);
    expect(after.edge).toMatchObject({ offset: 0, head: 1 });
    expect(v.errors).toEqual([]);
  });

  it('runs the edge straight down between nodes stacked on a tall frame', async () => {
    const v = await staged(twoNodes(true), [FLOW], VERTICAL);
    const frame = v.frameAt(FLOW.t + FLOW.seconds / 2);
    const mid = await read(v, frame);
    const route = edgeRoute(mid.nodes.a!, mid.nodes.b!);
    expect(route).toHaveLength(2);
    expect(route[1]!.x).toBeCloseTo(route[0]!.x, 6);
    expect(route[1]!.y).toBeGreaterThan(route[0]!.y);
    const k = (v.local(frame) - FLOW.t) / FLOW.seconds;
    const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    expect(near(center(mid.packet!), pointAlong(route, eased))).toBeLessThan(1.5);
    expect(v.errors).toEqual([]);
  });

  it('sends a dot when a flow carries no packet, and it is gone once it arrives', async () => {
    const v = await staged(twoNodes(), [{ verb: 'flow', from: 'a', to: 'b', t: 1, seconds: 1.2 }]);
    expect((await read(v, v.frameAt(0.5))).dot!.opacity).toBe(0);
    const mid = await read(v, v.frameAt(1.6));
    expect(mid.dot!.opacity).toBe(1);
    const route = edgeRoute(mid.nodes.a!, mid.nodes.b!);
    expect(center(mid.dot!).x).toBeGreaterThan(route[0]!.x);
    expect(center(mid.dot!).x).toBeLessThan(route.at(-1)!.x);
    expect((await read(v, v.frameAt(2.5))).dot!.opacity).toBe(0);
  });

  it('keeps a travelling packet in the middle of the frame when the camera follows it', async () => {
    const v = await staged(twoNodes(true), [
      { ...FLOW, seconds: 2 },
      { verb: 'camera', move: 'follow', to: 'p', zoom: 1.5, t: 1, seconds: 0.4 },
    ]);
    const layer = (frame: number) =>
      v.seek(
        frame,
        `return document.querySelector('[data-scene="s2"] > .stop-view > .layer').style.transform;`,
      );
    const seen: string[] = [];
    // The follower rounds its clamp to the region off over a quarter of the view, so it frames the
    // packet exactly only well inside the region: here, as it passes the middle of the edge.
    for (const t of [1.9, 2]) {
      const frame = v.frameAt(t);
      const drawn = await read(v, frame);
      // The packet has moved along the edge, and the camera with it.
      expect(near(center(drawn.packet!), v.r.pivot)).toBeLessThan(3);
      seen.push((await layer(frame)) as string);
    }
    expect(new Set(seen).size).toBe(2);
    expect(seen[0]).toMatch(/scale\(1\.5/);
  });
});

describe.skipIf(!available)('splits and merges', () => {
  it('breaks a packet into as many pieces as its count, with the true count under them', async () => {
    const v = await staged(alone, [chunks(4)]);
    const before = await read(v, v.frameAt(0.5));
    expect(before.pieces).toHaveLength(0);
    expect(before.packet!.opacity).toBe(1);
    expect(before.badges[0]!.opacity).toBe(0);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(4);
    expect(split.packet!.opacity).toBe(0);
    expect(split.badges).toEqual([
      { opacity: 1, side: 'Before', name: 'chunks', num: '4', children: 0 },
    ]);
    // Fanned out in a row around where the packet was.
    const xs = split.pieces.map((p) => center(p).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.abs((xs[0]! + xs.at(-1)!) / 2 - center(before.packet!).x)).toBeLessThan(1);
  });

  it('draws at most twelve pieces, and the count it measured', async () => {
    const v = await staged(alone, [chunks(40)]);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(12);
    expect(split.badges[0]!.num).toBe('40');
  });

  it('pulls the pieces back into one packet when it merges, captioned with the one it became', async () => {
    const v = await staged(alone, [
      chunks(4),
      {
        verb: 'merge',
        element: 'q',
        into: { count: 1, name: 'chunks', side: 'head' },
        t: 3,
        seconds: 0.8,
      },
    ]);
    const fanned = await read(v, v.frameAt(2.5));
    const merging = await read(v, v.frameAt(3.4));
    const spread = (d: Drawn) => center(d.pieces.at(-1)!).x - center(d.pieces[0]!).x;
    expect(spread(merging)).toBeLessThan(spread(fanned));
    const merged = await read(v, v.frameAt(4.1));
    expect(merged.pieces).toHaveLength(0);
    expect(merged.packet!.opacity).toBe(1);
    expect(merged.badges.map((b) => [b.opacity, b.side, b.name, b.num])).toEqual([
      [0, 'Before', 'chunks', '4'],
      [1, 'After', 'chunks', '1'],
    ]);
  });

  it('fans a node’s pieces out below it, the node staying where it is', async () => {
    const v = await staged(twoNodes(), [
      { verb: 'split', element: 'a', count: 3, name: 'jobs', side: 'head', t: 1, seconds: 0.9 },
    ]);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(3);
    const node = split.nodes.a!;
    for (const piece of split.pieces) expect(piece.y).toBeGreaterThan(node.y + node.height);
    expect(split.badges[0]).toMatchObject({ side: 'After', name: 'jobs', num: '3' });
  });

  it('keeps a node’s pieces and count inside its slot in a grid’s bottom row', async () => {
    const v = await staged(
      (r) => grid(r).map((rect, i) => ({ id: 'abcd'[i]!, kind: 'node', rect, label: `Step ${i}` })),
      [{ verb: 'split', element: 'c', count: 12, name: 'jobs', side: 'head', t: 1, seconds: 0.9 }],
    );
    const slot = grid(v.r)[2]!;
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(12);
    expect(split.badgeBoxes).toHaveLength(1);
    // There is no room below the node for them all: they rise over it rather than leave the slot.
    const bottom = Math.min(slot.y + slot.height, v.r.regions.captions.y);
    for (const box of [...split.pieces, ...split.badgeBoxes]) {
      expect(box.y).toBeGreaterThanOrEqual(slot.y - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(bottom + 0.5);
      expect(box.x).toBeGreaterThanOrEqual(slot.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
    }
    // Still below where the node's box starts, and the count under the pieces.
    const ys = split.pieces.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(split.nodes.c!.y);
    expect(split.badgeBoxes[0]!.y).toBeGreaterThan(Math.max(...ys));
    expect(v.errors).toEqual([]);
  });

  it('fits a count’s caption to its slot, and reports a name too long to fit there', async () => {
    const split = (name: string) =>
      staged(
        (r) =>
          row(r).map((rect, i) => ({ id: 'abcd'[i]!, kind: 'node', rect, label: `Step ${i}` })),
        [{ verb: 'split', element: 'a', count: 3, name, side: 'base', t: 1, seconds: 0.9 }],
      );
    const within = (v: Staged, box: Rect) => {
      const slot = row(v.r)[0]!;
      expect(box.x).toBeGreaterThanOrEqual(slot.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
    };
    const overflowing = async (v: Staged, frame: number) =>
      (await v.report(frame)).items.filter((item) => item.overflow).length;
    // A name that fits on two lines wraps onto them, and nothing overflows.
    const two = await split('documents waiting in the queue');
    within(two, (await read(two, two.frameAt(2.2))).badgeBoxes[0]!);
    expect(await overflowing(two, two.frameAt(2.2))).toBe(0);
    // One that does not is cut off inside the slot, and QC hears about it.
    const long = await split(
      'documents waiting in the request queue for the reader to fetch them one by one, again',
    );
    within(long, (await read(long, long.frameAt(2.2))).badgeBoxes[0]!);
    expect(await overflowing(long, long.frameAt(2.2))).toBeGreaterThan(0);
  });

  it('sets the agent’s label and the run’s words as text', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const v = await staged(
      (r) => [{ id: 'q', kind: 'packet', rect: r.media, label: hostile }],
      [{ ...chunks(2), name: hostile }],
    );
    const frame = v.frameAt(2.2);
    const drawn = await read(v, frame);
    expect(drawn.packet).toMatchObject({ label: hostile, children: 0 });
    expect(drawn.badges[0]).toMatchObject({ name: hostile, children: 0 });
    expect(
      await v.seek(
        frame,
        'return [window.__pwned ?? null, document.querySelectorAll("[data-element] img").length];',
      ),
    ).toEqual([null, 0]);
  });

  it('draws the same frame every time', async () => {
    const make = () => staged(twoNodes(true), [FLOW, { ...chunks(4, 2.4), element: 'p' }]);
    const [a, b] = [await make(), await make()];
    for (const t of [1.6, 2.8]) {
      const frame = a.frameAt(t);
      const first = await a.shot(frame);
      // Away to a frame of the same scene, in place: after a frame of its entrance, which moves
      // it by a fraction of a pixel, Chromium rasters node corners a shade apart, flows or not.
      await a.shot(a.frameAt(0.6));
      expect((await a.shot(frame)).equals(first)).toBe(true);
      expect((await b.shot(frame)).equals(first)).toBe(true);
    }
  });
});
