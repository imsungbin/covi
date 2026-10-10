import type { Point, Rect } from '../timeline/types.ts';

/*
 * Where flows travel and piles stack: edge routes between node boxes, a packet's place along
 * them, a split's fan, and a pile's grid. Pure and DOM-free, so the runtime draws with them, the
 * camera follows with them, and Node's tests check them.
 */

// `anim.ts` has these too, but it carries DOM types, and Node and tests/ import this file.
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Items a pile or a split draws at most; the number beside them is the true count. */
export const DRAWN_ITEMS = 12;
/** Items in one line of a pile or a fan. */
export const PER_LINE = 6;

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * A node's or a label's box in its slot, as the runtime draws it: centered, at most 520 × 170
 * design units (760 × 220 on tall frames).
 */
export function textBoxRect(slot: Rect, unit: number, tall: boolean): Rect {
  const width = Math.min(slot.width, (tall ? 760 : 520) * unit);
  const height = Math.min(slot.height, (tall ? 220 : 170) * unit);
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  };
}

/**
 * The path an edge takes from box `a` to box `b`, border to border: straight across when the
 * boxes share a row or a column, else with one elbow (out of `a`'s side that faces `b`, along to
 * above or below `b`'s center, then into `b`). Boxes that overlap join center to center.
 */
export function edgeRoute(a: Rect, b: Rect): Point[] {
  const ca = center(a);
  const cb = center(b);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const row = bottom > top;
  const column = right > left;
  if (row && column) return [ca, cb];
  if (row) {
    const y = (top + bottom) / 2;
    return cb.x > ca.x
      ? [
          { x: a.x + a.width, y },
          { x: b.x, y },
        ]
      : [
          { x: a.x, y },
          { x: b.x + b.width, y },
        ];
  }
  if (column) {
    const x = (left + right) / 2;
    return cb.y > ca.y
      ? [
          { x, y: a.y + a.height },
          { x, y: b.y },
        ]
      : [
          { x, y: a.y },
          { x, y: b.y + b.height },
        ];
  }
  return [
    { x: cb.x > ca.x ? a.x + a.width : a.x, y: ca.y },
    { x: cb.x, y: ca.y },
    { x: cb.x, y: cb.y > ca.y ? b.y : b.y + b.height },
  ];
}

export function routeLength(route: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++)
    length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  return length;
}

/** The point `k` (0–1) of the way along a route, by distance. */
export function pointAlong(route: readonly Point[], k: number): Point {
  let left = clamp(k) * routeLength(route);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || i === route.length - 1) {
      const f = length ? Math.min(1, left / length) : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= length;
  }
  return route[0]!;
}

/** The triangle of an arrowhead `size` long at a route's end, pointing the way it arrives. */
export function arrowHead(route: readonly Point[], size: number): Point[] {
  const tip = route.at(-1)!;
  const from = route.at(-2) ?? tip;
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const dx = (tip.x - from.x) / length;
  const dy = (tip.y - from.y) / length;
  const back = { x: tip.x - dx * size, y: tip.y - dy * size };
  const half = size * 0.6;
  return [
    tip,
    { x: back.x - dy * half, y: back.y + dx * half },
    { x: back.x + dy * half, y: back.y - dx * half },
  ];
}

/** A packet's trip along one edge: from `t` (seconds) for `seconds`. */
export interface Leg {
  t: number;
  seconds: number;
  route: readonly Point[];
}

/** How far through a trip a packet is at `t`, eased in and out. */
export function legProgress(leg: Pick<Leg, 't' | 'seconds'>, t: number): number {
  return easeInOutCubic(clamp((t - leg.t) / Math.max(leg.seconds, 1e-6)));
}

/**
 * Where a packet's center is at `t`: at the start of its first trip before it leaves, along each
 * trip as it travels, and where the last one ended after it arrives. Without trips, at `rest`.
 */
export function legPoint(legs: readonly Leg[], t: number, rest: Point): Point {
  if (!legs.length) return rest;
  let at = legs[0]!.route[0]!;
  for (const leg of legs) {
    if (t < leg.t) break;
    at = pointAlong(leg.route, legProgress(leg, t));
  }
  return at;
}

/** A split's pieces: their size, and their centers' offsets from the source's center. */
export interface Fan {
  width: number;
  height: number;
  offsets: Point[];
}

/**
 * Where the pieces of a split sit when it has fanned out: at most twelve, in lines of up to six,
 * each a little smaller than `source` (a packet), the lines shrunk to fit `room` px wide. A packet
 * breaks apart in place (`drop` 0); a node stays, and its pieces fan out `drop` px below its center.
 */
export function fanOut(
  count: number,
  source: { width: number; height: number },
  room: number,
  drop: number,
): Fan {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const columns = Math.max(1, Math.min(n, PER_LINE));
  const lines = Math.ceil(n / columns);
  const step = 1.3;
  const fit = Math.min(1, room / (source.width * 0.6 * (step * (columns - 1) + 1)));
  const width = source.width * 0.6 * fit;
  const height = source.height * 0.7 * fit;
  const offsets = Array.from({ length: n }, (_, i) => {
    const line = Math.floor(i / columns);
    const inLine = Math.min(columns, n - line * columns);
    const x = ((i % columns) - (inLine - 1) / 2) * width * step;
    const y =
      drop > 0 ? drop + height * (0.5 + 1.5 * line) : (line - (lines - 1) / 2) * height * 1.5;
    return { x, y };
  });
  return { width, height, offsets };
}

/**
 * A pile row's items in its grid box (box-relative): at most twelve squares in two lines of six,
 * filled left to right and top to bottom, sized so twelve would fit, the block centered.
 */
export function pileGrid(
  count: number,
  box: { width: number; height: number },
  gap: number,
): Rect[] {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const size = Math.max(
    0,
    Math.min((box.width - gap * (PER_LINE - 1)) / PER_LINE, (box.height - gap) / 2),
  );
  const left = (box.width - (PER_LINE * size + (PER_LINE - 1) * gap)) / 2;
  const top = (box.height - (2 * size + gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: left + (i % PER_LINE) * (size + gap),
    y: top + Math.floor(i / PER_LINE) * (size + gap),
    width: size,
    height: size,
  }));
}

/** The number a pile row shows `k` (0–1) of the way through its stack: up to the true count. */
export function stackCount(count: number, k: number): number {
  return Math.floor(count * clamp(k) + 1e-9);
}

/** Each row's progress `k` (0–1) of the way through one stack: rows fill one after another. */
export function stackRows(k: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => clamp(k * rows - i));
}
