/** Small, pure geometry helpers for drawing the mascot. Coordinates are view-box units, y down. */

export type Point = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rounds to two decimals, which is plenty for SVG coordinates and keeps the markup short. */
export const r = (n: number): number => Math.round(n * 100) / 100;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v));
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (radians: number): number => (radians * 180) / Math.PI;

/** The signed difference b − a between two angles in degrees, in (−180, 180]. */
export function angleDelta(a: number, b: number): number {
  const d = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Interpolates angles in degrees along the shorter way round. */
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

/** Rotates `p` by `degrees` (clockwise on screen, since y points down) around `c`. */
export function rotate(p: Point, degrees: number, c: Point = [0, 0]): Point {
  const a = rad(degrees);
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)];
}

export function boundsOf(points: readonly Point[]): Rect {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function union(rects: readonly Rect[]): Rect {
  return boundsOf(
    rects.flatMap((b): Point[] => [
      [b.x, b.y],
      [b.x + b.width, b.y + b.height],
    ]),
  );
}

export function corners(b: Rect): Point[] {
  return [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ];
}

/** A closed, smooth path through `points` (Catmull-Rom converted to cubic Béziers). */
export function smoothClosed(points: readonly Point[]): string {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n]!;
  let d = `M${r(at(0)[0])} ${r(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r(c1[0]!)} ${r(c1[1]!)} ${r(c2[0]!)} ${r(c2[1]!)} ${r(p2[0])} ${r(p2[1])}`;
  }
  return `${d} Z`;
}

/** Points of a polyline as an SVG path ("M x y L x y …"), closed with Z when asked. */
export function polyline(points: readonly Point[], close = false): string {
  return `M${points.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L')}${close ? ' Z' : ''}`;
}
