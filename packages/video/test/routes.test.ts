import { describe, expect, it } from 'vitest';
import {
  arrowHead,
  DRAWN_ITEMS,
  edgeRoute,
  fanOut,
  legPoint,
  pileGrid,
  pointAlong,
  routeLength,
  stackCount,
  stackRows,
  textBoxRect,
} from '../src/runtime/routes.ts';

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
