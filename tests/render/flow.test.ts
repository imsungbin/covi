import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvidence, type Demonstration, indexEvidence, resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type DirectionElement,
  defaultDirection,
  directionSources,
  type LayoutReport,
  layoutChecks,
  layoutScenes,
  OVERLAP_SHARE,
  outOfFrameCheck,
  overlapCheck,
  pacingFor,
  type Rect,
  resolveDirection,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  type Timeline,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { elementSlots } from '../../packages/video/src/direction/layout.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import {
  EDGE_MIN,
  edgeRoute,
  PILE_ITEM_MIN,
  pointAlong,
  routeLength,
  splitLayout,
  stackCount,
  stackRows,
} from '../../packages/video/src/runtime/routes.ts';
import { TEXT_FLOOR } from '../../packages/video/src/runtime/sizing.ts';
import { orientationOf } from '../../packages/video/src/spec.ts';
import { settledFrame } from '../../packages/video/src/timeline/cues.ts';
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
  const orientation = orientationOf(size.width, size.height);
  const tall = orientation === 'vertical';
  const regions = computeRegions({ ...size, orientation });
  const m = regions.media;
  const gap = 28 * regions.unit;
  const half = tall ? (m.height - gap) / 2 : (m.width - gap) / 2;
  const left: Rect = tall ? { ...m, height: half } : { ...m, width: half };
  const right: Rect = tall
    ? { ...m, y: m.y + half + gap, height: half }
    : { ...m, x: m.x + half + gap, width: half };
  const pivot = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
  return { regions, orientation, media: m, left, right, pivot };
}

/**
 * Four node slots as the resolver lays them out: a grid of two rows of two (`auto`), a row, or a
 * column.
 */
const fourNodes = (layout: 'auto' | 'row' | 'column') => (r: ReturnType<typeof regionsOf>) =>
  elementSlots(Array(4).fill('node'), layout, r.media, r.orientation, 28 * r.regions.unit);
const grid = fourNodes('auto');
const row = fourNodes('row');
const column = fourNodes('column');
const ids = ['a', 'b', 'c', 'd'] as const;
const steps = (slots: Rect[]): DirectionElement[] =>
  slots.map((rect, i) => ({ id: ids[i]!, kind: 'node', rect, label: `Step ${i}` }));

/** `box` lies inside `slot`, to rounding. */
const inside = (box: Rect, slot: Rect) => {
  expect(box.x).toBeGreaterThanOrEqual(slot.x - 0.5);
  expect(box.y).toBeGreaterThanOrEqual(slot.y - 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(slot.y + slot.height + 0.5);
};
/** Two boxes that do not overlap, to rounding. */
const apart = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <= 0.5 ||
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <= 0.5;

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
  const { seek, report, shot, errors } = await opened(timeline, size);
  const s2 = timeline.scenes.find((s) => s.id === 's2')!;
  const frameAt = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  /** Seconds into s2 at a frame, as the runtime's clock has them. */
  const local = (frame: number) => frame / timeline.fps - s2.start;
  return { timeline, r, frameAt, local, seek, report, shot, errors };
}

/** A timeline's composition, opened in Chromium at `size`. */
async function opened(timeline: Timeline, size: Size) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
  dirs.push(dir);
  await writeComposition(join(dir, 'composition'), timeline, new Map());
  const page = await browser!.newPage({ viewport: size });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(dir, 'composition', 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { seek, report, shot, errors };
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

/**
 * A node as scene s2 draws it at a frame: its box on screen and as placed (stage pixels, as edges
 * are routed), its label's text, and its visible pieces and count captions.
 */
const node = (v: Staged, frame: number, id: string) =>
  v.seek(
    frame,
    `const layer = document.querySelector('[data-scene="s2"] [data-element="${id}"]');
     const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
     const op = (n) => Number.parseFloat(n.style.opacity || '1');
     const shown = (s) => [...layer.querySelectorAll(s)].filter((n) => op(n) > 0).map(box);
     const node = layer.querySelector('.dnode');
     const px = (k) => Number.parseFloat(node.style[k]);
     return {
       box: box(node),
       placed: { x: px('left'), y: px('top'), width: px('width'), height: px('height') },
       label: box(node.querySelector('.nlabel')),
       pieces: shown('.fpiece'),
       badges: shown('.fbadge'),
     };`,
  ) as Promise<{ box: Rect; placed: Rect; label: Rect; pieces: Rect[]; badges: Rect[] }>;

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

  it('rests on the node its trip ends at where QC reads it, which is no collision', async () => {
    const v = await staged(twoNodes(true), [FLOW]);
    const index = v.timeline.scenes.findIndex((s) => s.id === 's2');
    const report = await v.report(settledFrame(v.timeline, index)!);
    const at = new Map(report.shot!.elements.map((e) => [e.id, e.rect]));
    const [b, p] = [at.get('b')!, at.get('p')!];
    // Half the pill lies over the node's side: between any other two elements, a collision.
    const w = Math.min(b.x + b.width, p.x + p.width) - Math.max(b.x, p.x);
    const h = Math.min(b.y + b.height, p.y + p.height) - Math.max(b.y, p.y);
    expect((w * h) / (p.width * p.height)).toBeGreaterThan(10 * OVERLAP_SHARE);
    expect(overlapCheck(v.timeline, [report])).toMatchObject({ status: 'pass' });
    expect(overlapCheck(v.timeline, [report]).message).not.toContain('No shot');
    expect(outOfFrameCheck(v.timeline, [report]).status).toBe('pass');
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

  for (const [name, slotsOf, splits] of [
    [
      'both rows of a 2×2 grid',
      grid,
      [
        ['b', 12],
        ['c', 3],
      ],
    ],
    [
      'a column of four',
      column,
      [
        ['d', 12],
        ['b', 6],
      ],
    ],
  ] as const)
    it(`keeps a node’s pieces and count off its label and inside its slot, in ${name}`, async () => {
      const [first] = splits;
      const v = await staged(
        (r) => steps(slotsOf(r)),
        [
          { verb: 'flow', from: 'a', to: first[0], t: 0.6, seconds: 0.4 },
          ...splits.map(
            ([element, count]) =>
              ({
                verb: 'split',
                element,
                count,
                name: 'jobs',
                side: 'head',
                t: 1,
                seconds: 0.9,
              }) as const,
          ),
        ],
      );
      const frame = v.frameAt(2.2);
      for (const [id, count] of splits) {
        const slot = slotsOf(v.r)[ids.indexOf(id)]!;
        const drawn = await node(v, frame, id);
        expect(drawn.pieces).toHaveLength(count);
        expect(drawn.badges).toHaveLength(1);
        for (const part of [drawn.box, ...drawn.pieces, ...drawn.badges]) inside(part, slot);
        for (const part of [...drawn.pieces, ...drawn.badges]) {
          expect(apart(part, drawn.label)).toBe(true);
          expect(apart(part, drawn.box)).toBe(true);
        }
      }
      // The edge into a node that splits meets its box where it is drawn.
      const path = (await v.seek(
        frame,
        `return document.querySelector('[data-scene="s2"] .flows path').getAttribute('d');`,
      )) as string;
      const route = edgeRoute(
        (await node(v, frame, 'a')).placed,
        (await node(v, frame, first[0])).placed,
      );
      expect(path.match(/-?[\d.]+/g)!.map(Number)).toEqual(
        route.flatMap((p) => [expect.closeTo(p.x, 1), expect.closeTo(p.y, 1)]),
      );
      expect(v.errors).toEqual([]);
    });

  it('fans a packet that has arrived out beside the node it rests against, off its label', async () => {
    const SPLIT = { verb: 'split', element: 'p', count: 4, name: 'chunks', side: 'base' } as const;
    const MERGE = { verb: 'merge', element: 'p', t: 4.4, seconds: 0.8 } as const;
    const v = await staged(twoNodes(true), [FLOW, { ...SPLIT, t: 2.6, seconds: 0.9 }, MERGE]);
    const frame = v.frameAt(3.8);
    const slot = v.r.right;
    const b = await node(v, frame, 'b');
    // The node makes room in its slot as if it split itself, and the edge meets it there.
    const layout = splitLayout(slot, v.r.regions.unit, false, 4);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(b.placed[key]).toBeCloseTo(layout.box[key], 1);
    const drawn = await read(v, frame);
    expect(drawn.pieces).toHaveLength(4);
    expect(drawn.badgeBoxes).toHaveLength(1);
    expect(drawn.badges[0]).toMatchObject({ side: 'Before', name: 'chunks', num: '4' });
    for (const part of [...drawn.pieces, ...drawn.badgeBoxes]) {
      inside(part, slot);
      expect(apart(part, b.label)).toBe(true);
      expect(apart(part, b.box)).toBe(true);
    }
    // It breaks apart where it arrived, on the edge's end, and is whole there again once merged.
    const end = edgeRoute((await node(v, frame, 'a')).placed, b.placed).at(-1)!;
    const arrived = await read(v, v.frameAt(2.4));
    expect(near(center(arrived.packet!), end)).toBeLessThan(1);
    const merged = await read(v, v.frameAt(5.6));
    expect(merged.pieces).toHaveLength(0);
    expect(merged.packet!.opacity).toBe(1);
    expect(near(center(merged.packet!), end)).toBeLessThan(1);
    expect(v.errors).toEqual([]);
  });

  it('lets the first split to reach a node take its room, in a timeline built by hand', async () => {
    // A resolved direction never has both; drawn anyway, the node's own split gives way.
    const v = await staged(twoNodes(true), [
      FLOW,
      { verb: 'split', element: 'p', count: 4, name: 'chunks', side: 'base', t: 2.6, seconds: 0.9 },
      { verb: 'split', element: 'b', count: 3, name: 'jobs', side: 'head', t: 3, seconds: 0.9 },
    ]);
    const frame = v.frameAt(4.4);
    const b = await node(v, frame, 'b');
    expect(b.pieces).toEqual([]);
    expect(b.badges).toEqual([]);
    const drawn = await read(v, frame);
    expect(drawn.pieces).toHaveLength(4);
    expect(drawn.badges.map((x) => x.name)).toEqual(['chunks']);
    expect(v.errors).toEqual([]);
  });

  it('fits a count’s caption to its slot, and reports a name too long to fit there', async () => {
    const split = (name: string) =>
      staged(
        (r) => steps(row(r)),
        [{ verb: 'split', element: 'a', count: 3, name, side: 'base', t: 1, seconds: 0.9 }],
      );
    const within = (v: Staged, box: Rect) => inside(box, row(v.r)[0]!);
    const overflowing = async (v: Staged, frame: number) =>
      (await v.report(frame)).items.filter((item) => item.overflow).length;
    // A name that fits on two lines wraps onto them, at the body floor at least, and nothing
    // overflows.
    const two = await split('documents waiting in the queue');
    within(two, (await read(two, two.frameAt(2.2))).badgeBoxes[0]!);
    expect(await overflowing(two, two.frameAt(2.2))).toBe(0);
    const caption = (await two.seek(
      two.frameAt(2.2),
      `const b = document.querySelector('[data-scene="s2"] .fbadge');
       return [Number.parseFloat(b.style.fontSize), b.querySelector('.fname').getBoundingClientRect().height];`,
    )) as [number, number];
    expect(caption[0]).toBeGreaterThanOrEqual(28 * two.r.regions.unit - 0.01);
    expect(caption[1]).toBeGreaterThan(2 * caption[0]);
    // One that does not is cut off inside the slot, and QC hears about it.
    const long = await split(
      'documents waiting in the request queue for the reader to fetch them one by one, again',
    );
    within(long, (await read(long, long.frameAt(2.2))).badgeBoxes[0]!);
    expect(await overflowing(long, long.frameAt(2.2))).toBeGreaterThan(0);
  });

  it('shrinks a count below the body floor rather than leave a slot too short for it', async () => {
    const six = (r: ReturnType<typeof regionsOf>) =>
      elementSlots(Array(6).fill('node'), 'column', r.media, r.orientation, 28 * r.regions.unit);
    const v = await staged(
      (r) => six(r).map((rect, i) => ({ id: `n${i}`, kind: 'node', rect, label: `Step ${i}` })),
      [
        {
          verb: 'split',
          element: 'n5',
          count: 12,
          name: 'documents waiting in the queue',
          side: 'head',
          t: 1,
          seconds: 0.9,
        },
      ],
    );
    const frame = v.frameAt(2.2);
    const slot = six(v.r)[5]!;
    const drawn = await node(v, frame, 'n5');
    for (const part of [drawn.box, ...drawn.pieces, ...drawn.badges]) inside(part, slot);
    for (const part of [...drawn.pieces, ...drawn.badges])
      expect(apart(part, drawn.label)).toBe(true);
    // QC reads the smaller text, where it holds text to the floor.
    const fonts = (await v.report(frame)).items.flatMap((item) =>
      item.role === 'text' && item.font !== undefined && item.rect.y >= slot.y - 0.5
        ? [item.font]
        : [],
    );
    expect(Math.min(...fonts)).toBeLessThan(28 * v.r.regions.unit);
    const size = await v.seek(
      frame,
      `return Number.parseFloat(document.querySelector('[data-element="n5"] .fbadge').style.fontSize);`,
    );
    expect(size).toBeCloseTo(Math.min(...fonts), 0);
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
    // In order, as a render draws them, the scene's entrance included: the same bytes twice.
    const [c, d] = [await make(), await make()];
    for (const t of [0.2, 1.6, 2.8]) {
      const frame = c.frameAt(t);
      expect((await d.shot(frame)).equals(await c.shot(frame))).toBe(true);
    }
  });
});

const READS = (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
  {
    id: 'reads',
    kind: 'pile',
    rect: r.media,
    name: 'reader steps',
    rows: [
      { side: 'base', count: 28 },
      { side: 'head', count: 10 },
    ],
  },
];
const STACK = { verb: 'stack', element: 'reads', t: 1, seconds: 1.8 } as const;
/** A counter's change in percent: its opacity at a frame. */
const deltaAt = (v: Staged, frame: number) =>
  v.seek(
    frame,
    `return Number.parseFloat(document.querySelector('[data-scene="s2"] .mdelta').style.opacity || '1');`,
  ) as Promise<number>;

describe.skipIf(!available)('piles and count-ups', () => {
  it('stacks a pile item by item, before then after, the number counting up to the true count', async () => {
    const v = await staged(READS, [STACK]);
    expect((await read(v, v.frameAt(0.5))).rows).toEqual([
      { cap: 'Before', items: 0, num: '0', numOpacity: 1 },
      { cap: 'After', items: 0, num: '0', numOpacity: 1 },
    ]);
    const frame = v.frameAt(STACK.t + STACK.seconds / 4);
    const [base, head] = stackRows((v.local(frame) - STACK.t) / STACK.seconds, 2);
    const mid = await read(v, frame);
    const visible = (k: number, n: number) =>
      Array.from({ length: n }, (_, j) => j).filter((j) => k * n > j).length;
    expect(mid.rows.map((r) => r.items)).toEqual([visible(base!, 12), visible(head!, 10)]);
    expect(mid.rows.map((r) => r.num)).toEqual([
      String(stackCount(28, base!)),
      String(stackCount(10, head!)),
    ]);
    expect(mid.rows[0]!.items).toBeGreaterThan(0);
    expect(mid.rows[0]!.items).toBeLessThan(12);
    const done = await read(v, v.frameAt(STACK.t + STACK.seconds + 0.2));
    expect(done.rows.map((r) => [r.items, r.num])).toEqual([
      [12, '28'],
      [10, '10'],
    ]);
    expect(done.pileName).toBe('reader steps');
    // The rows' items line up, whatever their captions and numbers.
    const lefts = (await v.seek(
      v.frameAt(3),
      `return [...document.querySelectorAll('.prow')].map((row) => row.querySelector('.pitem').getBoundingClientRect().x);`,
    )) as number[];
    expect(lefts[1]).toBeCloseTo(lefts[0]!, 1);
    // Body text, at least the body floor, and nothing overflows.
    const items = (await v.report(v.frameAt(3))).items.filter((i) => i.role === 'text');
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.overflow).toBe(false);
      expect(item.font! / v.r.regions.unit).toBeGreaterThanOrEqual(TEXT_FLOOR.body - 0.1);
    }
    expect(v.errors).toEqual([]);
  });

  it('shows a pile with no stack whole from the start, and collapses it when it merges', async () => {
    const v = await staged(READS, [{ verb: 'merge', element: 'reads', t: 2, seconds: 0.8 }]);
    expect((await read(v, v.frameAt(0.3))).rows.map((r) => [r.items, r.num])).toEqual([
      [12, '28'],
      [10, '10'],
    ]);
    const merged = await read(v, v.frameAt(3.1));
    expect(merged.rows.map((r) => [r.items, r.numOpacity])).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  it('fits two rows in a tall frame', async () => {
    const v = await staged(READS, [STACK], VERTICAL);
    const frame = v.frameAt(3);
    const card = (await v.seek(
      frame,
      `const r = document.querySelector('.pcard').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`,
    )) as Rect;
    const inside = (await v.seek(
      frame,
      `return [...document.querySelectorAll('.pitem')].map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });`,
    )) as Rect[];
    expect(inside).toHaveLength(22);
    for (const r of inside) {
      expect(r.x).toBeGreaterThanOrEqual(card.x - 1);
      expect(r.x + r.width).toBeLessThanOrEqual(card.x + card.width + 1);
      expect(r.y).toBeGreaterThanOrEqual(card.y - 1);
      expect(r.y + r.height).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    expect((await v.report(frame)).items.some((i) => i.overflow)).toBe(false);
  });

  it('keeps a pile’s items at their smallest size or more, or reports the pile', async () => {
    const SQUARE = { width: 540, height: 540 };
    /** A pile of `[before, after]` counts in half the frame, stacked: its smallest item and its
     * numbers' size in design units, and whether QC hears about it. */
    const pileOf = async (counts: [number, number], size: Size) => {
      const v = await staged(
        (r) => [
          {
            id: 'reads',
            kind: 'pile',
            rect: r.right,
            name: 'request bytes',
            rows: [
              { side: 'base', count: counts[0] },
              { side: 'head', count: counts[1] },
            ],
          },
        ],
        [STACK],
        size,
      );
      const frame = v.frameAt(3);
      const drawn = (await v.seek(
        frame,
        `const scene = document.querySelector('[data-scene="s2"]');
         const items = [...scene.querySelectorAll('.pitem')].map((n) => n.getBoundingClientRect().width);
         const nums = [...scene.querySelectorAll('.pnum')].map((n) => Number.parseFloat(n.style.fontSize));
         return [Math.min(...items), Math.min(...nums)];`,
      )) as [number, number];
      const unit = v.r.regions.unit;
      return {
        item: drawn[0] / unit,
        num: drawn[1] / unit,
        reported: (await v.report(frame)).items.some((i) => i.overflow),
      };
    };
    // Two-digit counts in a square frame's half: the number gives the items room.
    const small = await pileOf([28, 10], SQUARE);
    expect(small.item).toBeGreaterThanOrEqual(PILE_ITEM_MIN - 0.1);
    expect(small.reported).toBe(false);
    for (const [counts, size] of [
      [[70406, 9907], SQUARE],
      [[1234567890, 3], LANDSCAPE],
    ] as const) {
      const pile = await pileOf([...counts], size);
      // The number never drops below the body floor; items smaller than their least are reported,
      // and only those.
      expect(pile.num).toBeGreaterThanOrEqual(TEXT_FLOOR.body - 0.1);
      if (pile.reported) expect(pile.item).toBeLessThan(PILE_ITEM_MIN);
      else expect(pile.item).toBeGreaterThanOrEqual(PILE_ITEM_MIN - 0.1);
    }
  });

  it('shrinks a short row’s number so its one line of items keeps its least size', async () => {
    // A row too short for two lines of items draws them in one line of twelve, which needs more
    // than twice the width two lines of six do: the number gives way for that width, not the
    // narrower one, so a card wide enough for it at the body floor draws its items whole.
    const BIG = { width: 1920, height: 1080 };
    const pileIn = (rect: Rect) =>
      staged(
        () => [
          {
            id: 'reads',
            kind: 'pile',
            rect,
            name: 'steps',
            rows: [{ side: 'base', count: 1234567 }],
          },
        ],
        [STACK],
        BIG,
      );
    const measure = (v: Staged) =>
      v.seek(
        v.frameAt(3),
        `const scene = document.querySelector('[data-scene="s2"]');
         const q = (s) => scene.querySelector(s);
         const num = q('.pnum');
         const items = [...scene.querySelectorAll('.pitem')].map((n) => Number.parseFloat(n.style.width));
         return { row: q('.prow').clientHeight, rowWidth: q('.prow').clientWidth, cap: q('.pcap').offsetWidth, size: Number.parseFloat(num.style.fontSize), item: Math.min(...items) };`,
      ) as Promise<{ row: number; rowWidth: number; cap: number; size: number; item: number }>;
    // What the number takes at a size, as the pile holds it (two pixels to spare).
    const widthAt = (v: Staged, size: number) =>
      v.seek(
        v.frameAt(3),
        `const num = document.querySelector('[data-scene="s2"] .pnum');
         num.style.minWidth = ''; num.style.fontSize = '${size}px';
         return num.scrollWidth + 2;`,
      ) as Promise<number>;
    // A row 55 px tall is short of two lines of items, and caps the number at 0.55 of it.
    const rowHeight = 55;
    const most = 0.55 * rowHeight;
    const card = { x: 100, y: 300, width: 1400, height: 180 };
    const wide = await pileIn(card);
    // At 1080p a design unit is a pixel, so sizes read as they are written.
    expect(wide.r.regions.unit).toBe(1);
    const first = await measure(wide);
    const floorWidth = await widthAt(wide, TEXT_FLOOR.body);
    const mostWidth = await widthAt(wide, most);
    expect(mostWidth).toBeGreaterThan(floorWidth);
    const gap = 18;
    const oneLine = 12 * PILE_ITEM_MIN + 11 * 10;
    // A row exactly as wide as one line of items needs with the number at the floor, and half of
    // what the number gains at its largest to spare.
    const row = first.cap + gap + oneLine + (mostWidth - floorWidth) / 2 + gap + floorWidth;
    const v = await pileIn({
      ...card,
      width: card.width + row - first.rowWidth,
      height: card.height + rowHeight - first.row,
    });
    const drawn = await measure(v);
    expect(drawn.row).toBe(rowHeight);
    expect(drawn.row).toBeLessThan(2 * PILE_ITEM_MIN + 10);
    // The largest number would fit its share of the row: only the items make it smaller.
    expect(mostWidth).toBeLessThanOrEqual(0.3 * drawn.rowWidth);
    expect(drawn.size).toBeLessThan(most - 0.25);
    expect(drawn.size).toBeGreaterThanOrEqual(TEXT_FLOOR.body);
    expect(drawn.item).toBeGreaterThanOrEqual(PILE_ITEM_MIN - 0.1);
    expect((await v.report(v.frameAt(3))).items.some((i) => i.overflow)).toBe(false);
  });

  it('wraps a long name onto two lines, and reports one too long even for that', async () => {
    // Half the frame's width, as a staged shot gives a pile beside its counter.
    const named = (name: string) =>
      staged(
        (r) => [{ ...(READS(r)[0] as DirectionElement & { kind: 'pile' }), rect: r.right, name }],
        [STACK],
      );
    const nameOf = (v: Staged) =>
      v.seek(
        v.frameAt(3),
        `const n = document.querySelector('.pname'); return [Number.parseFloat(n.style.fontSize), n.getBoundingClientRect().height];`,
      ) as Promise<[number, number]>;
    const overflowing = async (v: Staged) =>
      (await v.report(v.frameAt(3))).items.filter((item) => item.overflow).length;
    const two = await named(
      'documents the reader fetched one at a time from the request queue, in the order they came',
    );
    const [size, height] = await nameOf(two);
    expect(size).toBeGreaterThanOrEqual(TEXT_FLOOR.body * two.r.regions.unit - 0.01);
    expect(height).toBeGreaterThan(2 * size);
    expect(await overflowing(two)).toBe(0);
    const long = await named(
      'documents the reader fetched one at a time from the request queue, in the order they came, again and again, until the queue was empty and nothing else was left to read',
    );
    expect(await overflowing(long)).toBeGreaterThan(0);
  });

  it('sets a pile’s name as text, whatever it holds', async () => {
    const hostile = '<b onmouseover="window.__pwned=2">steps</b>';
    const v = await staged(
      (r) => [
        {
          id: 'reads',
          kind: 'pile',
          rect: r.media,
          name: hostile,
          rows: [{ side: 'head', count: 3 }],
        },
      ],
      [],
    );
    const frame = v.frameAt(1);
    expect((await read(v, frame)).pileName).toBe(hostile);
    expect(
      await v.seek(frame, 'return document.querySelectorAll("[data-element] b").length;'),
    ).toBe(0);
  });

  it('draws the same pile frame every time', async () => {
    const make = () =>
      staged(READS, [STACK, { verb: 'merge', element: 'reads', t: 3.2, seconds: 0.8 }]);
    const [a, b] = [await make(), await make()];
    for (const t of [1.6, 3.6]) {
      const frame = a.frameAt(t);
      expect((await b.shot(frame)).equals(await a.shot(frame))).toBe(true);
    }
  });

  it('counts a counter up from zero, holds it, then counts it from before to after', async () => {
    const v = await staged(
      (r) => [
        {
          id: 'bytes',
          kind: 'metric',
          rect: r.media,
          show: 'counter',
          name: 'request bytes',
          from: 70406,
          to: 9907,
          decimals: 0,
          delta: -86,
        },
      ],
      [
        { verb: 'count-up', element: 'bytes', value: 70406, t: 0.5, seconds: 1.6 },
        { verb: 'count', element: 'bytes', t: 2.6, seconds: 1.6 },
      ],
    );
    expect((await read(v, v.frameAt(0.3))).value).toBe('0');
    const rising = Number((await read(v, v.frameAt(1.3))).value!.replace(/,/g, ''));
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(70406);
    expect((await read(v, v.frameAt(2.3))).value).toBe('70,406');
    expect((await read(v, v.frameAt(4.5))).value).toBe('9,907');
    // The change shows once the count has landed it, not while it counts up.
    for (const [t, opacity] of [
      [1.3, 0],
      [2.3, 0],
      [4.8, 1],
    ] as const)
      expect(await deltaAt(v, v.frameAt(t))).toBe(opacity);
  });

  it('shows a counter’s change once its count-up has landed, when no count follows', async () => {
    const v = await staged(
      (r) => [
        {
          id: 'bytes',
          kind: 'metric',
          rect: r.media,
          show: 'counter',
          name: 'request bytes',
          from: 70406,
          to: 9907,
          decimals: 0,
          delta: -86,
        },
      ],
      [{ verb: 'count-up', element: 'bytes', value: 9907, t: 0.5, seconds: 1.6 }],
    );
    expect(await deltaAt(v, v.frameAt(1.3))).toBe(0);
    expect((await read(v, v.frameAt(2.7))).value).toBe('9,907');
    expect(await deltaAt(v, v.frameAt(2.7))).toBe(1);
  });

  it('counts a single value up from zero', async () => {
    const v = await staged(
      (r) => [
        {
          id: 'n',
          kind: 'metric',
          rect: r.media,
          show: 'counter',
          name: 'reader steps',
          to: 28,
          decimals: 0,
        },
      ],
      [{ verb: 'count-up', element: 'n', value: 28, t: 0.5, seconds: 1.6 }],
    );
    expect((await read(v, v.frameAt(0.3))).value).toBe('0');
    expect((await read(v, v.frameAt(2.5))).value).toBe('28');
  });
});

/**
 * The benchmark's terminal scene with a command that printed `counts` besides its request bytes
 * (70,406 → 9,907), directed by Covi and resolved as a render does, opened in a square frame at
 * its settled frame: what the shot stages, its counter's size and its pile's items, in design
 * units, and how many pixels of the value's and the name's lines a short card cuts off (they
 * hide what runs past them, so a squeezed line loses the comma's tail and the descenders).
 */
async function measuredSquare(counts: Array<[string, number, number]>) {
  const size = { width: 1080, height: 1080 };
  const lines = (side: 1 | 2) => counts.map((c) => `${c[0]}: ${c[side]}`).join('\n');
  const demo = {
    commands: [
      {
        name: 'Measure the review request',
        command: 'node scripts/measure.js',
        before: { exitCode: 0, output: `request bytes: 70406\n${lines(1)}` },
        after: { exitCode: 0, output: `request bytes: 9907\n${lines(2)}` },
        changed: true,
      },
    ],
    shots: [],
    requests: [],
    skipped: [],
    findings: [],
  } as unknown as Demonstration;
  const evidence = indexEvidence(buildEvidence({ demo }));
  const sources = directionSources({ demo, evidence });
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
          "Here's the same command before and after the change. It now prints request bytes: 9907.",
        visual: {
          kind: 'terminal',
          command: 'node scripts/measure.js',
          output: 'request bytes: 9907',
          before: 'request bytes: 70406',
        },
      },
    ],
  }).scenes;
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  const image = () => ({ src: '', width: 1, height: 1 });
  const plan = defaultDirection({ scenes, evidence, sources, seed: 3, orientation: 'square' });
  const staging = resolveDirection({
    plan,
    scenes,
    layout,
    spec,
    language: 'en',
    sources,
    image,
    seed: 3,
    redact: (value) => value,
  });
  const direction = staging[1]!.direction;
  const timeline = buildTimeline({ title, scenes, layout, spec, image, staging });
  const v = await opened(timeline, size);
  const frame = settledFrame(timeline, 1)!;
  const drawn = (await v.seek(
    frame,
    `const scene = document.querySelector('[data-scene="s2"]');
     const items = [...scene.querySelectorAll('.pitem')].map((n) => n.getBoundingClientRect().width);
     const value = scene.querySelector('.mvalue');
     const name = scene.querySelector('.mname');
     const lost = (n) => Math.max(0, Math.round(n));
     return { counter: Number.parseFloat(getComputedStyle(value).fontSize), items: items.length, item: Math.min(...items),
       cut: { value: lost(value.offsetHeight - value.parentElement.clientHeight), name: lost(Number.parseFloat(getComputedStyle(name).lineHeight) - name.clientHeight) } };`,
  )) as { counter: number; items: number; item: number; cut: { value: number; name: number } };
  const unit = computeRegions({ ...size, orientation: 'square' }).unit;
  return {
    direction,
    counter: drawn.counter / unit,
    items: drawn.items,
    item: drawn.item / unit,
    cut: drawn.cut,
    overflowing: (await v.report(frame)).items.filter((i) => i.overflow),
    errors: v.errors,
  };
}

/** The counter's value and name keep their whole lines, to rounding. */
const whole = (cut: { value: number; name: number }) => {
  expect(cut.value).toBeLessThanOrEqual(1);
  expect(cut.name).toBeLessThanOrEqual(1);
};

describe.skipIf(!available)('the default director’s staged counts', () => {
  it('keeps the benchmark’s counter at its floor and its reads’ items at their least in a square frame', async () => {
    const drawn = await measuredSquare([
      ['chunks', 4, 1],
      ['reader steps', 28, 10],
      ['timeouts', 1, 0],
    ]);
    expect(drawn.direction.elements.map((e) => e.kind)).toEqual(['metric', 'packet', 'pile']);
    // Every beat plays, in the order written: the flow verbs make way, and the count ticks alone.
    expect(drawn.direction.beats.map((b) => b.verb)).toEqual(['split', 'stack', 'merge', 'count']);
    expect(drawn.direction.dropped).toBeUndefined();
    // Both at once: a counter at its floor beside a pile of dots would not do, nor one whose
    // digits lose their feet.
    expect(drawn.counter).toBeGreaterThanOrEqual(120);
    whole(drawn.cut);
    expect(drawn.items).toBe(22);
    expect(drawn.item).toBeGreaterThanOrEqual(PILE_ITEM_MIN);
    expect(drawn.overflowing).toEqual([]);
    expect(drawn.errors).toEqual([]);
  });

  it('keeps the counter at its floor beside a packet or above a pile alone, in a square frame', async () => {
    const packet = await measuredSquare([['chunks', 4, 1]]);
    expect(packet.direction.elements.map((e) => e.kind)).toEqual(['metric', 'packet']);
    expect(packet.counter).toBeGreaterThanOrEqual(120);
    expect(packet.overflowing).toEqual([]);
    const pile = await measuredSquare([['reader steps', 28, 10]]);
    expect(pile.direction.elements.map((e) => e.kind)).toEqual(['metric', 'pile']);
    expect(pile.counter).toBeGreaterThanOrEqual(120);
    expect(pile.items).toBe(22);
    expect(pile.item).toBeGreaterThanOrEqual(PILE_ITEM_MIN);
    expect(pile.overflowing).toEqual([]);
    for (const drawn of [packet, pile]) {
      whole(drawn.cut);
      expect(drawn.direction.dropped).toBeUndefined();
      expect(drawn.errors).toEqual([]);
    }
  });
});

/**
 * A diagram scene as the storyboard drafter writes one (every area changed, its line counts as
 * details, no edge labels), directed by Covi and resolved as a render does, opened at `size`: four
 * areas, or (`pair`) the first two and the edge between them.
 */
async function draftedDiagram(size: Size, pair = false) {
  const orientation = orientationOf(size.width, size.height);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', ...size });
  const title = 'Play the theme under every video';
  const area = (id: string, label: string, detail: string) => ({
    id,
    label,
    changed: true,
    detail,
  });
  const scenes = StoryboardSchema.parse({
    title,
    template: 'architecture-explainer',
    scenes: [
      {
        id: 's1',
        beat: 'a',
        narration: 'Every video now ends on the theme.',
        visual: { kind: 'callout', title: 'Theme' },
      },
      {
        id: 's2',
        beat: 'b',
        narration:
          'The command line asks the video package for a render, and both read the core package. The video package then plays its music through the audio package.',
        visual: {
          kind: 'diagram',
          nodes: [
            area('n0', 'packages/cli', '+12 −3'),
            area('n1', 'packages/video', '+48 −20'),
            area('n2', 'packages/core', '+4 −1'),
            area('n3', 'packages/audio', '+96 −0'),
          ].slice(0, pair ? 2 : 4),
          edges: [
            { from: 'n0', to: 'n1' },
            { from: 'n0', to: 'n2' },
            { from: 'n1', to: 'n2' },
            { from: 'n1', to: 'n3' },
          ].slice(0, pair ? 1 : 4),
        },
      },
    ],
  }).scenes;
  const evidence = indexEvidence({ items: [] });
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
  const image = () => ({ src: '', width: 1, height: 1 });
  const plan = defaultDirection({ scenes, evidence, seed: 3, orientation });
  const staging = resolveDirection({
    plan,
    scenes,
    layout,
    spec,
    language: 'en',
    sources: directionSources({ evidence }),
    image,
    seed: 3,
    redact: (value) => value,
  });
  const timeline = buildTimeline({ title, scenes, layout, spec, image, staging });
  const s2 = timeline.scenes[1]!;
  return {
    timeline,
    direction: s2.direction!,
    media: computeRegions({ ...size, orientation }).media,
    unit: computeRegions({ ...size, orientation }).unit,
    /** A frame `seconds` into s2. */
    frameAt: (seconds: number) => Math.round((s2.start + seconds) * timeline.fps),
    ...(await opened(timeline, size)),
  };
}

/** What a staged diagram draws at a frame: its nodes as placed, edges, and dots, in stage pixels. */
const diagramAt = (v: Awaited<ReturnType<typeof draftedDiagram>>, frame: number) =>
  v.seek(
    frame,
    `const scene = document.querySelector('[data-scene="s2"]');
     const px = (n, k) => Number.parseFloat(n.style[k]);
     const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
     const nodes = {};
     for (const n of scene.querySelectorAll('[data-element] .dnode'))
       nodes[n.closest('[data-element]').dataset.element] = {
         placed: { x: px(n, 'left'), y: px(n, 'top'), width: px(n, 'width'), height: px(n, 'height') },
         box: box(n),
         label: box(n.querySelector('.nlabel')),
       };
     const edges = [...scene.querySelectorAll('.flows path')].map((p) => ({
       points: p.getAttribute('d').match(/-?[\\d.]+/g).map(Number),
       drawn: Number(p.getAttribute('stroke-dashoffset')),
     }));
     const heads = [...scene.querySelectorAll('.flows polygon')].map((h) => Number.parseFloat(h.style.opacity));
     const dots = [...scene.querySelectorAll('.fdot')].map((d) => {
       const [x, y] = d.style.transform.match(/-?[\\d.]+/g).map(Number);
       return { x, y, width: px(d, 'width'), height: px(d, 'height'), opacity: Number.parseFloat(d.style.opacity || '1') };
     });
     return { nodes, edges, heads, dots };`,
  ) as Promise<{
    nodes: Record<string, { placed: Rect; box: Rect; label: Rect }>;
    edges: Array<{ points: number[]; drawn: number }>;
    heads: number[];
    dots: Array<Rect & { opacity: number }>;
  }>;

describe.skipIf(!available)('the default director’s staged diagrams', () => {
  for (const [name, size] of [
    ['a wide frame', LANDSCAPE],
    ['a square frame', { width: 360, height: 360 }],
    ['a tall frame', VERTICAL],
  ] as const)
    it(`draws a drafted diagram’s nodes, edges, and dots inside their slots, in ${name}`, async () => {
      const v = await draftedDiagram(size);
      const d = v.direction;
      expect(d.whole).toBe(false);
      expect(d.elements.map((e) => e.kind)).toEqual(['node', 'node', 'node', 'node']);
      expect(d.beats.map((b) => b.verb)).toEqual(['flow', 'flow', 'flow', 'flow']);
      expect(d.dropped).toBeUndefined();
      // Settled: every node in its slot with its label inside it, every edge drawn in with its
      // arrowhead, every dot arrived and gone, and nothing cut off.
      const frame = settledFrame(v.timeline, 1)!;
      const drawn = await diagramAt(v, frame);
      for (const e of d.elements) {
        const n = drawn.nodes[e.id]!;
        inside(n.placed, e.rect);
        inside(n.label, n.box);
      }
      expect(drawn.edges).toHaveLength(4);
      for (const edge of drawn.edges) {
        expect(edge.drawn).toBe(0);
        for (let i = 0; i < edge.points.length; i += 2)
          inside({ x: edge.points[i]!, y: edge.points[i + 1]!, width: 0, height: 0 }, v.media);
      }
      expect(drawn.heads).toEqual([1, 1, 1, 1]);
      expect(drawn.dots.map((dot) => dot.opacity)).toEqual([0, 0, 0, 0]);
      const report = await v.report(frame);
      expect(report.items.filter((i) => i.overflow)).toEqual([]);
      for (const item of report.items.filter((i) => i.text === 'body'))
        expect(item.font! / v.unit).toBeGreaterThanOrEqual(TEXT_FLOOR.body - 0.1);
      // On its way, each dot rides inside the frame's media region.
      for (const [i, b] of d.beats.entries()) {
        const mid = await diagramAt(v, v.frameAt(b.t + b.seconds / 2));
        expect(mid.dots[i]!.opacity).toBe(1);
        inside(mid.dots[i]!, v.media);
      }
      expect(v.errors).toEqual([]);
    });

  for (const [name, size] of [
    ['a square frame', { width: 1080, height: 1080 }],
    ['a tall frame', { width: 1080, height: 1920 }],
  ] as const)
    it(`keeps every edge three arrowheads long between nodes side by side, in ${name}`, async () => {
      for (const pair of [true, false]) {
        const v = await draftedDiagram(size, pair);
        expect(v.direction.dropped).toBeUndefined();
        const frame = settledFrame(v.timeline, 1)!;
        const drawn = await diagramAt(v, frame);
        expect(drawn.edges).toHaveLength(pair ? 1 : 4);
        for (const edge of drawn.edges) {
          const route = [];
          for (let i = 0; i < edge.points.length; i += 2)
            route.push({ x: edge.points[i]!, y: edge.points[i + 1]! });
          expect(routeLength(route) / v.unit).toBeGreaterThanOrEqual(EDGE_MIN - 0.5);
        }
        // The nodes give the edges their room and still hold their names whole.
        const fits = layoutChecks(v.timeline, [await v.report(frame)]);
        expect(fits.find((c) => c.id === 'text-fits')!.status).toBe('pass');
        expect(v.errors).toEqual([]);
      }
    });
});
