import { describe, expect, it } from 'vitest';
import { elementSlots } from '../src/direction/layout.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import {
  arrowHead,
  DRAWN_ITEMS,
  edgeRoute,
  fanOut,
  legPoint,
  nodeBoxRect,
  pileGrid,
  pointAlong,
  routeLength,
  type SplitLayout,
  splitLayout,
  stackCount,
  stackRows,
  textBoxRect,
} from '../src/runtime/routes.ts';
import { orientationOf } from '../src/spec.ts';
import type { Rect } from '../src/timeline/types.ts';

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

  it('count a stack up to its true number, and fill rows one after another', () => {
    expect([0, 0.5, 0.99, 1].map((k) => stackCount(28, k))).toEqual([0, 14, 27, 28]);
    expect(stackRows(0.25, 2)).toEqual([0.5, 0]);
    expect(stackRows(0.75, 2)).toEqual([1, 0.5]);
    expect(stackRows(1, 1)).toEqual([1]);
  });
});

describe('a node that splits', () => {
  /** Node slots as the resolver lays them out, at a frame size. */
  const slots = (width: number, height: number, n: number, layout: 'auto' | 'column') => {
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
