import type { Regions } from '../runtime/layout.ts';
import type { Rect } from '../timeline/types.ts';
import type { ShotElement, ShotLayout } from './schema.ts';

/** How much room each kind takes along a row or a column. */
const WEIGHT: Record<ShotElement['kind'], number> = {
  visual: 3,
  code: 3,
  output: 3,
  capture: 3,
  morph: 3,
  node: 2,
  label: 1,
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const rounded = (r: Rect): Rect => ({
  x: r2(r.x),
  y: r2(r.y),
  width: r2(r.width),
  height: r2(r.height),
});

/** Cards that draw their own header (a title without a capture, the summary) fill the frame. */
export function headerless(visual: { kind: string; background?: unknown }): boolean {
  return visual.kind === 'summary' || (visual.kind === 'title' && visual.background === undefined);
}

/**
 * The region a shot lays out in. The storyboard visual alone keeps the region it has without
 * direction; any other shot keeps the scene header, so it uses the media region.
 */
export function shotRegion(
  whole: boolean,
  visual: { kind: string; background?: unknown },
  regions: Regions,
): Rect {
  return whole && headerless(visual) ? regions.full : regions.media;
}

/** Splits `region` along one axis into parts sized by weight, `gap` apart. */
function along(region: Rect, weights: readonly number[], axis: 'x' | 'y', gap: number): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const span = (axis === 'x' ? region.width : region.height) - gap * (weights.length - 1);
  let at = axis === 'x' ? region.x : region.y;
  return weights.map((w) => {
    const size = (span * w) / total;
    const rect =
      axis === 'x'
        ? { x: at, y: region.y, width: size, height: region.height }
        : { x: region.x, y: at, width: region.width, height: size };
    at += size + gap;
    return rect;
  });
}

/**
 * Deterministic slots for a shot's elements, in stop-local stage pixels. One element fills the
 * region whatever the layout. `auto` picks from the count: two split it, three line up (a row on
 * wide frames, a column on tall ones), and more make a grid of two columns on tall frames or two
 * rows on wide ones.
 */
export function elementSlots(
  kinds: readonly ShotElement['kind'][],
  layout: ShotLayout,
  region: Rect,
  orientation: 'vertical' | 'landscape' | 'square',
  gap: number,
): Rect[] {
  const n = kinds.length;
  const tall = orientation === 'vertical';
  const weights = kinds.map((k) => WEIGHT[k]);
  const resolved =
    n === 1
      ? 'single'
      : layout !== 'auto'
        ? layout
        : n === 2
          ? 'split'
          : n === 3
            ? tall
              ? 'column'
              : 'row'
            : 'grid';
  let slots: Rect[];
  if (resolved === 'single') slots = kinds.map(() => region);
  else if (resolved === 'row') slots = along(region, weights, 'x', gap);
  else if (resolved === 'column') slots = along(region, weights, 'y', gap);
  else if (resolved === 'split') {
    const [first, rest] = along(region, [1, 1], tall ? 'y' : 'x', gap) as [Rect, Rect];
    slots = [first, ...along(rest, weights.slice(1), tall ? 'x' : 'y', gap)];
  } else {
    const columns = tall ? 2 : Math.ceil(n / 2);
    const rows = Math.ceil(n / columns);
    const cells = along(region, Array(rows).fill(1), 'y', gap).flatMap((line) =>
      along(line, Array(columns).fill(1), 'x', gap),
    );
    slots = cells.slice(0, n);
  }
  return slots.map(rounded);
}
