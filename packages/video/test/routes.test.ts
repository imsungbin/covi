import { describe, expect, it } from 'vitest';
import { flowSlots } from '../src/direction/flow.ts';
import { elementSlots } from '../src/direction/layout.ts';
import type { Shot } from '../src/direction/schema.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import {
  arrangedPacketSplit,
  arrangedSplit,
  arrowHead,
  DRAWN_ITEMS,
  EDGE_STROKE,
  edgeRoute,
  fanBoxes,
  fanOut,
  legPoint,
  nodeBoxRect,
  nodeFans,
  nodeSplits,
  packetSplit,
  pileGrid,
  pileGridWidth,
  pillHeight,
  pointAlong,
  type Resting,
  restingAt,
  routeLength,
  type SplitLayout,
  splitLayout,
  stackCount,
  stackRows,
  textBoxRect,
} from '../src/runtime/routes.ts';
import { orientationOf } from '../src/spec.ts';
import type { DirectionBeat, DirectionElement, Rect } from '../src/timeline/types.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('flow routes', () => {
  it('size a node’s box as the runtime draws it, centered in its slot', () => {
    expect(textBoxRect(box(0, 0, 1000, 600), 1, false)).toEqual(box(240, 215, 520, 170));
    expect(textBoxRect(box(0, 0, 1000, 600), 1, true)).toEqual(box(120, 190, 760, 220));
    expect(textBoxRect(box(10, 20, 300, 100), 2, false)).toEqual(box(10, 20, 300, 100));
  });

  it('run straight between boxes that share a row or a column, border to border', () => {
    const a = box(0, 0, 100, 50);
    expect(edgeRoute(a, box(300, 10, 100, 50))).toEqual([
      { x: 100, y: 30 },
      { x: 300, y: 30 },
    ]);
    expect(edgeRoute(box(300, 10, 100, 50), a)).toEqual([
      { x: 300, y: 30 },
      { x: 100, y: 30 },
    ]);
    expect(edgeRoute(a, box(20, 200, 100, 50))).toEqual([
      { x: 60, y: 50 },
      { x: 60, y: 200 },
    ]);
    expect(edgeRoute(box(20, 200, 100, 50), a)).toEqual([
      { x: 60, y: 200 },
      { x: 60, y: 50 },
    ]);
  });

  it('turn once between boxes that share neither, and join overlapping boxes center to center', () => {
    const a = box(0, 0, 100, 50);
    const b = box(300, 200, 100, 50);
    expect(edgeRoute(a, b)).toEqual([
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ]);
    expect(edgeRoute(b, a)).toEqual([
      { x: 300, y: 225 },
      { x: 50, y: 225 },
      { x: 50, y: 50 },
    ]);
    expect(edgeRoute(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual([
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ]);
  });

  it('measure a route and find a point along it by distance', () => {
    const route = edgeRoute(box(0, 0, 100, 50), box(300, 200, 100, 50));
    expect(routeLength(route)).toBe(425);
    expect(pointAlong(route, 0)).toEqual({ x: 100, y: 25 });
    expect(pointAlong(route, 0.5)).toEqual({ x: 312.5, y: 25 });
    expect(pointAlong(route, 250 / 425)).toEqual({ x: 350, y: 25 });
    expect(pointAlong(route, 1)).toEqual({ x: 350, y: 200 });
    expect(pointAlong(route, 7)).toEqual({ x: 350, y: 200 });
  });

  it('point an arrowhead the way the route arrives', () => {
    expect(
      arrowHead(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        10,
      ),
    ).toEqual([
      { x: 100, y: 0 },
      { x: 90, y: 6 },
      { x: 90, y: -6 },
    ]);
  });

  it('carry a packet along its trips, eased, waiting where each one ends', () => {
    const legs = [
      {
        t: 1,
        seconds: 1,
        route: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        t: 3,
        seconds: 1,
        route: [
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ];
    const rest = { x: -5, y: -5 };
    expect(legPoint(legs, 0.5, rest)).toEqual({ x: 0, y: 0 });
    expect(legPoint(legs, 1.5, rest)).toEqual({ x: 50, y: 0 });
    expect(legPoint(legs, 1.25, rest).x).toBeCloseTo(100 * 4 * 0.25 ** 3, 9);
    expect(legPoint(legs, 2.5, rest)).toEqual({ x: 100, y: 0 });
    expect(legPoint(legs, 3.5, rest)).toEqual({ x: 100, y: 50 });
    expect(legPoint(legs, 9, rest)).toEqual({ x: 100, y: 100 });
    expect(legPoint([], 2, rest)).toEqual(rest);
  });
});

describe('splits and piles', () => {
  it('fan a split into as many pieces as it counts, twelve at most, in lines of six', () => {
    const four = fanOut(4, { width: 150, height: 64 }, 1000, 0);
    expect(four.width).toBe(90);
    expect(four.height).toBeCloseTo(44.8, 9);
    expect(four.offsets.map((o) => [o.x, o.y])).toEqual([
      [-175.5, 0],
      [-58.5, 0],
      [58.5, 0],
      [175.5, 0],
    ]);
    const forty = fanOut(40, { width: 150, height: 64 }, 1000, 0);
    expect(forty.offsets).toHaveLength(DRAWN_ITEMS);
    expect(new Set(forty.offsets.map((o) => o.y.toFixed(3)))).toEqual(
      new Set(['-33.600', '33.600']),
    );
    expect(fanOut(0, { width: 150, height: 64 }, 1000, 0).offsets).toEqual([]);
  });

  it('shrink a fan to its room, and drop a node’s pieces below it', () => {
    const tight = fanOut(12, { width: 150, height: 64 }, 300, 0);
    const xs = tight.offsets.map((o) => o.x);
    expect(Math.max(...xs) - Math.min(...xs) + tight.width).toBeCloseTo(300, 9);
    const below = fanOut(3, { width: 200, height: 100 }, 1000, 60);
    expect(below.offsets.map((o) => [o.x, o.y])).toEqual([
      [-156, 95],
      [0, 95],
      [156, 95],
    ]);
  });

  it('lay a pile row out in two lines of six squares, the same size for any count', () => {
    const grid = pileGrid(28, { width: 330, height: 130 }, 10);
    expect(grid).toHaveLength(DRAWN_ITEMS);
    expect(grid[0]!.x).toBe(0);
    expect(grid[0]!.y).toBeCloseTo(40 / 3, 9);
    expect(grid[0]!.width).toBeCloseTo(280 / 6, 9);
    expect(grid[6]!.y).toBeCloseTo(70, 9);
    expect(grid[11]!.x).toBeCloseTo((5 * 340) / 6, 9);
    const four = pileGrid(4, { width: 330, height: 130 }, 10);
    expect(four.map((r) => r.y)).toEqual(Array(4).fill(grid[0]!.y));
    expect(four[3]).toEqual(grid[3]);
    expect(pileGrid(0, { width: 330, height: 130 }, 10)).toEqual([]);
    // A box wider than twelve need: the block sits in its middle.
    expect(pileGrid(1, { width: 600, height: 130 }, 10)[0]).toEqual({
      x: 95,
      y: 0,
      width: 60,
      height: 60,
    });
  });

  it('lay a pile row out in one line of twelve when two lines of six would draw it smaller', () => {
    // A row as wide and short as a square frame's pile under its number: two lines of six would
    // be 35 pixels, one line of twelve is 65.
    const line = pileGrid(28, { width: 900, height: 80 }, 10);
    expect(line).toHaveLength(DRAWN_ITEMS);
    const size = (900 - 11 * 10) / 12;
    for (const [i, item] of line.entries())
      expect(item).toEqual({
        x: expect.closeTo(i * (size + 10), 9),
        y: expect.closeTo((80 - size) / 2, 9),
        width: expect.closeTo(size, 9),
        height: expect.closeTo(size, 9),
      });
    // The same size for any count, filled from the left.
    expect(pileGrid(4, { width: 900, height: 80 }, 10)).toEqual(line.slice(0, 4));
    // Where two lines draw them larger, they keep two.
    expect(pileGrid(28, { width: 900, height: 200 }, 10)[6]!.y).toBeGreaterThan(line[0]!.y);
  });

  it('give a pile row the width its items need at their least, in the lines its height allows', () => {
    // Tall enough for two lines of 24-pixel items: six across. Too short: twelve across.
    expect(pileGridWidth(130, 24, 10)).toBe(6 * 24 + 5 * 10);
    expect(pileGridWidth(57, 24, 10)).toBe(12 * 24 + 11 * 10);
    // At that width, the grid draws them at their least or larger.
    for (const height of [24, 40, 57, 58, 130]) {
      const width = pileGridWidth(height, 24, 10);
      expect(pileGrid(12, { width, height }, 10)[0]!.width, `${height}`).toBeGreaterThanOrEqual(24);
      expect(pileGrid(12, { width: width - 12, height }, 10)[0]!.width).toBeLessThan(24);
    }
  });

  it('count a stack up to its true number, and fill rows one after another', () => {
    expect([0, 0.5, 0.99, 1].map((k) => stackCount(28, k))).toEqual([0, 14, 27, 28]);
    expect(stackRows(0.25, 2)).toEqual([0.5, 0]);
    expect(stackRows(0.75, 2)).toEqual([1, 0.5]);
    expect(stackRows(1, 1)).toEqual([1]);
  });
});

/** Node slots as the resolver lays them out, at a frame size. */
const slots = (width: number, height: number, n: number, layout: 'auto' | 'column' | 'split') => {
  const orientation = orientationOf(width, height);
  const regions = computeRegions({ width, height, orientation });
  const rects = elementSlots(
    Array(n).fill('node'),
    layout,
    regions.media,
    orientation,
    28 * regions.unit,
  );
  return { rects, unit: regions.unit, tall: orientation === 'vertical' };
};

describe('a node that splits', () => {
  const inside = (r: Rect, slot: Rect) =>
    r.x >= slot.x - 1e-6 &&
    r.y >= slot.y - 1e-6 &&
    r.x + r.width <= slot.x + slot.width + 1e-6 &&
    r.y + r.height <= slot.y + slot.height + 1e-6;
  const overlap = (a: Rect, b: Rect) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-6 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6;
  const pieceRects = (l: SplitLayout) =>
    l.fan.offsets.map((o) => ({
      x: l.origin.x + o.x - l.fan.width / 2,
      y: l.origin.y + o.y - l.fan.height / 2,
      width: l.fan.width,
      height: l.fan.height,
    }));

  it('keeps its pieces and its count off its box and inside its slot, in every layout', () => {
    const layouts = [
      ['2×2, 1920×1080', slots(1920, 1080, 4, 'auto')],
      ['2×2, 640×360', slots(640, 360, 4, 'auto')],
      ['2×2, 1080×1080', slots(1080, 1080, 4, 'auto')],
      ['2×2, 1080×1920', slots(1080, 1920, 4, 'auto')],
      ['3 in a column, 1920×1080', slots(1920, 1080, 3, 'column')],
      ['4 in a column, 1920×1080', slots(1920, 1080, 4, 'column')],
      ['4 in a column, 1080×1920', slots(1080, 1920, 4, 'column')],
      ['2 side by side, 1920×1080', slots(1920, 1080, 2, 'auto')],
    ] as const;
    for (const [name, { rects, unit, tall }] of layouts)
      for (const slot of rects)
        for (let count = 1; count <= 40; count += count < 12 ? 1 : 28) {
          const l = splitLayout(slot, unit, tall, count);
          const pieces = pieceRects(l);
          const where = `${name}, ${count} pieces`;
          expect(pieces, where).toHaveLength(Math.min(count, DRAWN_ITEMS));
          for (const r of [l.box, l.caption, ...pieces]) expect(inside(r, slot), where).toBe(true);
          for (const r of [l.caption, ...pieces]) expect(overlap(r, l.box), where).toBe(false);
          for (const r of pieces) expect(overlap(r, l.caption), where).toBe(false);
          // Room for its label (two lines at the floor), and pieces at least a quarter their size.
          expect(l.box.height, where).toBeGreaterThanOrEqual(
            Math.min(96 * unit, textBoxRect(slot, unit, tall).height) - 1e-6,
          );
          expect(l.fan.width, where).toBeGreaterThanOrEqual(0.25 * 90 * unit - 1e-6);
          // The count's room holds two lines of name beside the number, or the slot's height.
          expect(l.caption.height, where).toBeCloseTo(Math.min(120 * unit, slot.height), 6);
          expect(nodeBoxRect(slot, unit, tall, count), where).toEqual(l.box);
        }
  });

  it('fans out under a box with room for it, and to the right of one in a wide, short slot', () => {
    const [left] = slots(1920, 1080, 2, 'auto').rects;
    const roomy = splitLayout(left!, 1, false, 3);
    // Full-size pieces under a full-size box, the count under them, all centered in the slot.
    expect(roomy.beside).toBe(false);
    expect(roomy.box.height).toBe(170);
    expect(roomy.fan.width).toBeCloseTo(90, 9);
    expect(roomy.origin).toEqual({ x: roomy.box.x + 260, y: roomy.box.y + 170 });
    expect(roomy.fan.offsets.every((o) => o.y > 0)).toBe(true);
    const column = slots(1920, 1080, 4, 'column').rects[3]!;
    const few = splitLayout(column, 1, false, 3);
    // Beside, the box stays where it is unsplit, so edges up and down the column run straight.
    expect(few.beside).toBe(true);
    expect(few.box).toEqual(textBoxRect(column, 1, false));
    expect(few.origin).toEqual({ x: few.box.x + few.box.width, y: few.box.y + few.box.height / 2 });
    expect(few.fan.offsets.every((o) => o.x > 0)).toBe(true);
    // Twelve need more room: the box moves left, as it was otherwise, still above and below its
    // neighbours' boxes, so the edges to them stay straight.
    const many = splitLayout(column, 1, false, 12);
    expect(many.box).toMatchObject({ y: few.box.y, width: 520, height: few.box.height });
    expect(many.box.x).toBeLessThan(few.box.x);
    expect(many.box.x + many.box.width).toBeGreaterThan(few.box.x);
    // A node that does not split keeps its box.
    expect(nodeBoxRect(column, 1, false)).toEqual(textBoxRect(column, 1, false));
  });
});

describe('where splits fan out of nodes', () => {
  it('arrange a split only in a slot with room for it beside the label', () => {
    const [left] = slots(1920, 1080, 2, 'auto').rects;
    expect(arrangedSplit(left!, 1, false, 4)).toEqual(splitLayout(left!, 1, false, 4));
    // A row of a square frame split for seven: the fallback alone gives way to the pieces.
    const short = slots(1080, 1080, 7, 'split').rects[3]!;
    expect(arrangedSplit(short, 1, false, 4)).toBeUndefined();
    expect(splitLayout(short, 1, false, 4).box.height).toBeLessThan(
      textBoxRect(short, 1, false).height,
    );
  });

  const flow = (from: string, to: string, t: number): DirectionBeat => ({
    verb: 'flow',
    from,
    to,
    packet: 'p',
    t,
    seconds: 1,
  });
  const trips = [flow('a', 'b', 1), flow('b', 'c', 3)];

  it('find the node a packet rests against when it splits, and none while it travels', () => {
    const at = (t: number) => restingAt(trips, { element: 'p', t });
    expect([0.5, 1, 1.5, 2, 2.5, 3.5, 4, 6].map(at)).toEqual([
      'a',
      undefined,
      undefined,
      'b',
      'b',
      undefined,
      'c',
      'c',
    ]);
    expect(restingAt(trips, { element: 'q', t: 2 })).toBeUndefined();
  });

  it('give each node the first split to fan out of it: its own, or a resting packet’s', () => {
    const rect = box(0, 0, 100, 100);
    const elements: DirectionElement[] = [
      { id: 'a', kind: 'node', rect, label: 'A' },
      { id: 'b', kind: 'node', rect, label: 'B' },
      { id: 'c', kind: 'node', rect, label: 'C' },
      { id: 'p', kind: 'packet', rect },
    ];
    const split = (element: string, count: number, t: number): DirectionBeat => ({
      verb: 'split',
      element,
      count,
      name: 'chunks',
      side: 'base',
      t,
      seconds: 0.9,
    });
    // The packet splits on its way to c: in place, so no node makes room for it.
    expect(nodeFans({ elements, beats: [...trips, split('p', 4, 3.5)] })).toEqual(new Map());
    expect(
      nodeFans({ elements, beats: [split('b', 3, 0.5), ...trips, split('p', 4, 2.5)] }),
    ).toEqual(new Map([['b', { count: 3, element: 'b', rests: false }]]));
    expect(nodeFans({ elements, beats: [...trips, split('p', 4, 5)] })).toEqual(
      new Map([['c', { count: 4, element: 'p', rests: true }]]),
    );
  });
});

describe('a packet that splits', () => {
  const overlap = (a: Rect, b: Rect) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-6 &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6;
  const inside = (r: Rect, slot: Rect) =>
    r.x >= slot.x - 1e-6 &&
    r.y >= slot.y - 1e-6 &&
    r.x + r.width <= slot.x + slot.width + 1e-6 &&
    r.y + r.height <= slot.y + slot.height + 1e-6;
  // From where the pieces start, through the spread, to fanned out: a merge plays the same poses.
  const POSES = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
  const FRAMES = [
    ['16:9', 1920, 1080],
    ['9:16', 1080, 1920],
    ['square', 1080, 1080],
  ] as const;
  const frame = (width: number, height: number) => {
    const orientation = orientationOf(width, height);
    const regions = computeRegions({ width, height, orientation });
    return { regions, orientation, unit: regions.unit, tall: orientation === 'vertical' };
  };
  const counts = [1, 2, 3, 4, 5, 6, 7, 9, 12, 40];

  it('fans out past its pill in its own slot, off its label at every pose, as staged shots lay it out', () => {
    let laid = 0;
    for (const [name, width, height] of FRAMES) {
      const { regions, orientation, unit, tall } = frame(width, height);
      const at = (kinds: DirectionElement['kind'][], layout: 'auto' | 'split') =>
        elementSlots(kinds, layout, regions.media, orientation, 28 * unit)[
          kinds.indexOf('packet')
        ]!;
      // The default director's staged shot, the worked example's proof, and a packet alone.
      const shots = [
        ['the benchmark', at(['metric', 'packet', 'pile'], 'split')],
        ['the example', at(['metric', 'packet'], 'split')],
        ['alone', at(['packet'], 'auto')],
      ] as const;
      for (const [shot, slot] of shots) {
        // Both staged shots keep their four chunks.
        if (shot !== 'alone')
          expect(arrangedPacketSplit(slot, unit, tall, 4), `${name}, ${shot}`).toBeDefined();
        for (const count of counts) {
          const l = arrangedPacketSplit(slot, unit, tall, count);
          if (!l) continue;
          laid++;
          const where = `${name}, ${shot}, ${count} pieces`;
          // The pill holds the label: a piece clear of the pill is clear of the label.
          const pill = l.box;
          expect(pill.height, where).toBeCloseTo(pillHeight(unit, tall), 6);
          expect(pill.width, where).toBeCloseTo(Math.min(slot.width, 420 * unit), 6);
          for (const k of POSES)
            for (const piece of fanBoxes(l.fan, l.origin, k))
              expect(overlap(piece, pill), `${where}, at ${k}`).toBe(false);
          const fanned = fanBoxes(l.fan, l.origin, 1);
          expect(fanned, where).toHaveLength(Math.min(count, DRAWN_ITEMS));
          for (const r of [pill, l.caption, ...fanned]) expect(inside(r, slot), where).toBe(true);
          expect(overlap(l.caption, pill), where).toBe(false);
          for (const r of fanned) expect(overlap(r, l.caption), where).toBe(false);
          // A narrower pill, as its label draws it, is laid out the same way or with more room.
          expect(packetSplit(slot, unit, tall, count, 150 * unit).fan.width).toBeGreaterThanOrEqual(
            l.fan.width - 1e-9,
          );
        }
      }
    }
    expect(laid).toBeGreaterThan(80);
  });

  it('leaves a slot too small for its pill, its pieces, and their count without a split', () => {
    const { unit } = frame(1920, 1080);
    expect(arrangedPacketSplit(box(0, 0, 300, 150), unit, false, 4)).toBeUndefined();
    // Drawn anyway (a timeline built by hand), its pieces still keep off its pill.
    const l = packetSplit(box(0, 0, 300, 150), unit, false, 4);
    for (const k of POSES)
      for (const piece of fanBoxes(l.fan, l.origin, k)) expect(overlap(piece, l.box)).toBe(false);
    // A slot shorter than the pill has no room, however wide.
    expect(arrangedPacketSplit(box(0, 0, 1200, 40), unit, false, 4)).toBeUndefined();
    expect(arrangedPacketSplit(box(0, 0, 1200, 64), unit, false, 1)).toBeDefined();
  });

  it('fans out off a pill resting anywhere on the node it splits beside, where that is not known', () => {
    let laid = 0;
    for (const [name, width, height] of FRAMES) {
      const { unit, tall } = frame(width, height);
      // A column's slots are short: no room under the box there, past a resting pill.
      const layouts = [
        ['2 side by side', slots(width, height, 2, 'auto').rects],
        ['2×2', slots(width, height, 4, 'auto').rects],
        ['a split for three', slots(width, height, 3, 'split').rects],
        ['4 in a column', slots(width, height, 4, 'column').rects],
      ] as const;
      for (const [layout, rects] of layouts)
        for (const slot of rects)
          for (const count of counts) {
            const l = arrangedSplit(slot, unit, tall, count, true);
            if (!l) continue;
            laid++;
            const where = `${name}, ${layout}, ${count} pieces`;
            expect(l, where).toEqual(splitLayout(slot, unit, tall, count, true));
            expect(nodeBoxRect(slot, unit, tall, count, true), where).toEqual(l.box);
            // The pill rests where an edge meets the box: anywhere on its sides, or at its center
            // (boxes that overlap join center to center), at its widest.
            const size = { width: 420 * unit, height: pillHeight(unit, tall) };
            const b = l.box;
            const rests = [
              { x: b.x + b.width / 2, y: b.y + b.height / 2 },
              ...[0, 0.25, 0.5, 0.75, 1].flatMap((f) => [
                { x: b.x + f * b.width, y: b.y },
                { x: b.x + f * b.width, y: b.y + b.height },
                { x: b.x, y: b.y + f * b.height },
                { x: b.x + b.width, y: b.y + f * b.height },
              ]),
            ];
            const fanned = fanBoxes(l.fan, l.origin, 1);
            for (const r of [l.caption, ...fanned]) {
              expect(inside(r, slot), where).toBe(true);
              expect(overlap(r, b), where).toBe(false);
            }
            for (const p of rests) {
              const pill = {
                x: p.x - size.width / 2,
                y: p.y - size.height / 2,
                ...size,
              };
              expect(overlap(l.caption, pill), where).toBe(false);
              for (const k of POSES)
                for (const piece of fanBoxes(l.fan, l.origin, k))
                  expect(overlap(piece, pill), `${where}, at ${k}`).toBe(false);
            }
          }
    }
    expect(laid).toBeGreaterThan(200);
  });

  /**
   * A packet resting against node slot `i` of a layout, its trip from or to slot `j`'s box: every
   * pair of slots, arrived and leaving, for every count, in every frame.
   */
  function* restingCases() {
    for (const [name, width, height] of FRAMES) {
      const { unit, tall } = frame(width, height);
      const layouts = [
        ['2 side by side', slots(width, height, 2, 'auto').rects],
        ['2×2', slots(width, height, 4, 'auto').rects],
        ['a split for three', slots(width, height, 3, 'split').rects],
        ['a split for four', slots(width, height, 4, 'split').rects],
        ['4 in a column', slots(width, height, 4, 'column').rects],
      ] as const;
      for (const [layout, rects] of layouts)
        for (const [i, slot] of rects.entries())
          for (const [j, from] of rects.entries()) {
            if (i === j) continue;
            const other = textBoxRect(from, unit, tall);
            for (const arrives of [true, false])
              for (const count of counts) {
                const rests: Resting = { other, arrives, width: 420 * unit };
                const where = `${name}, ${layout}, ${j}→${i}, ${arrives ? 'arrived' : 'leaving'}, ${count} pieces`;
                yield { slot, unit, tall, count, rests, where };
              }
          }
    }
  }
  /**
   * The leg of a resting packet's trip that meets `box`, as wide as the edge is drawn, and the
   * side of the box it comes from.
   */
  const legAt = ({ other, arrives }: Resting, box: Rect, unit: number) => {
    const route = arrives ? edgeRoute(other, box) : edgeRoute(box, other);
    const [near, far] = arrives ? [route.at(-1)!, route.at(-2)!] : [route[0]!, route[1]!];
    const half = (EDGE_STROKE / 2) * unit;
    const leg = {
      x: Math.min(near.x, far.x) - half,
      y: Math.min(near.y, far.y) - half,
      width: Math.abs(far.x - near.x) + 2 * half,
      height: Math.abs(far.y - near.y) + 2 * half,
    };
    const side =
      far.y >= box.y + box.height
        ? 'below'
        : far.y <= box.y
          ? 'above'
          : far.x <= box.x
            ? 'left'
            : far.x >= box.x + box.width
              ? 'right'
              : 'over';
    return { leg, side };
  };
  /** Whether a layout's count, or any of its pieces at any pose, meets `r`. */
  const meets = (l: SplitLayout, r: Rect) =>
    overlap(l.caption, r) ||
    POSES.some((k) => fanBoxes(l.fan, l.origin, k).some((piece) => overlap(piece, r)));

  it('fans out off a pill resting where its trip meets the node, at every pose, in more slots', () => {
    let laid = 0;
    let more = 0;
    for (const { slot, unit, tall, count, rests, where } of restingCases()) {
      const l = arrangedSplit(slot, unit, tall, count, rests);
      // Wherever it fits not knowing where the pill is, it fits knowing it, unless the edge the
      // pill rests at runs through the pieces or the count that layout draws (a trip from below).
      const blind = arrangedSplit(slot, unit, tall, count, true);
      if (blind && !l) expect(meets(blind, legAt(rests, blind.box, unit).leg), where).toBe(true);
      if (!l) continue;
      laid++;
      if (!blind) more++;
      expect(l, where).toEqual(splitLayout(slot, unit, tall, count, rests));
      expect(nodeBoxRect(slot, unit, tall, count, rests), where).toEqual(l.box);
      // The pill, at its widest, rests where the edge between the boxes meets this one.
      const { other, arrives } = rests;
      const at = arrives ? edgeRoute(other, l.box).at(-1)! : edgeRoute(l.box, other)[0]!;
      const size = { width: 420 * unit, height: pillHeight(unit, tall) };
      const pill = { x: at.x - size.width / 2, y: at.y - size.height / 2, ...size };
      const fanned = fanBoxes(l.fan, l.origin, 1);
      for (const r of [l.caption, ...fanned]) {
        expect(inside(r, slot), where).toBe(true);
        expect(overlap(r, l.box), where).toBe(false);
      }
      expect(overlap(l.caption, pill), where).toBe(false);
      for (const k of POSES)
        for (const piece of fanBoxes(l.fan, l.origin, k))
          expect(overlap(piece, pill), `${where}, at ${k}`).toBe(false);
    }
    expect(laid).toBeGreaterThan(1000);
    // Knowing where the pill rests finds room in many slots that keeping off every side does not.
    expect(more).toBeGreaterThan(200);
  });

  it('keeps its pieces and its count off the edge its packet rests at, at every pose, from every side', () => {
    // How many arrangements were checked with the edge meeting the box from each side.
    const sides = new Map<string, number>();
    for (const { slot, unit, tall, count, rests, where } of restingCases()) {
      const l = arrangedSplit(slot, unit, tall, count, rests);
      if (!l) continue;
      const { leg, side } = legAt(rests, l.box, unit);
      sides.set(side, (sides.get(side) ?? 0) + 1);
      expect(meets(l, leg), `${where}, from ${side}`).toBe(false);
    }
    for (const side of ['below', 'above', 'left', 'right'])
      expect(sides.get(side) ?? 0, side).toBeGreaterThan(300);
  });

  it('keeps the worked example’s split beside the reader, off where its packet rests and its edge', () => {
    // s1 of references/direction.md: two parts and a warning, split; the packet rides, then
    // splits against the reader into its four chunks.
    const kept: string[] = [];
    for (const [name, width, height] of FRAMES) {
      const { regions, orientation, unit, tall } = frame(width, height);
      const shot: Pick<Shot, 'elements' | 'layout' | 'beats'> = {
        layout: 'split',
        elements: [
          { id: 'review', kind: 'node', label: 'Review' },
          { id: 'reader', kind: 'node', label: 'Reader' },
          { id: 'docs', kind: 'packet', label: 'Every document' },
          { id: 'late', kind: 'label', text: 'Timed out', tone: 'warning' },
        ],
        beats: [{ verb: 'flow', from: 'review', to: 'reader', packet: 'docs' }],
      };
      const beats: DirectionBeat[] = [
        { verb: 'flow', from: 'review', to: 'reader', packet: 'docs', t: 1, seconds: 1 },
        {
          verb: 'split',
          element: 'docs',
          count: 4,
          name: 'chunks',
          side: 'base',
          t: 2.5,
          seconds: 1,
        },
      ];
      const placed = flowSlots(shot, beats, regions.media, orientation, 28 * unit, unit);
      const elements = shot.elements.map(
        (e, i) => ({ ...e, rect: placed[i]! }) as DirectionElement,
      );
      // Where its pill rests is known, as the resolver and the render lay the reader out.
      const rests = nodeSplits({ elements, beats }, unit, tall).get('reader')!.rests;
      if (typeof rests !== 'object') throw new Error(`${name}: the pill's place is not known`);
      const l = arrangedSplit(placed[1]!, unit, tall, 4, rests);
      if (!l) continue;
      kept.push(name);
      expect(meets(l, legAt(rests, l.box, unit).leg), name).toBe(false);
    }
    // It renders in 16:9 (the test that renders it), and keeps its split in 9:16 too. A square
    // reader's slot has room beside the label only where the edge from the review runs through.
    expect(kept).toEqual(expect.arrayContaining(['16:9', '9:16']));
  });
});
