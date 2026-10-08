import type { Rect } from '@covi/core';

/** At most this many regions per step: a reviewer (or a video) can point at a few, not dozens. */
export const MAX_REGIONS = 6;
/** Inputs beyond this are folded into one box first, so merging stays cheap on noisy pages. */
const MAX_INPUT = 256;

const area = (r: Rect) => r.width * r.height;

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The area a union of two boxes adds beyond their own, without allocating: it runs per pair. */
function addedArea(a: Rect, b: Rect): number {
  const width = Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x);
  const height = Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y);
  return width * height - area(a) - area(b);
}

function near(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x <= b.x + b.width + gap &&
    b.x <= a.x + a.width + gap &&
    a.y <= b.y + b.height + gap &&
    b.y <= a.y + a.height + gap
  );
}

const byPosition = (a: Rect, b: Rect) =>
  a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;

/** Merges the first pair of boxes that overlap or nearly touch; false when none do. */
function mergeOnce(boxes: Rect[], gap: number): boolean {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (near(boxes[i]!, boxes[j]!, gap)) {
        boxes[i] = union([boxes[i]!, boxes[j]!]);
        boxes.splice(j, 1);
        return true;
      }
  return false;
}

/**
 * Scales boxes (CSS pixels → image pixels), drops empty ones, and merges boxes that overlap or
 * nearly touch. When more than `max` remain, the pair whose union adds the least area merges
 * until at most `max` are left, and no two left overlap. The input order never changes the result.
 */
export function mergeRegions(
  rects: readonly Rect[],
  options: { scale?: number; gap?: number; max?: number } = {},
): Rect[] {
  const scale = options.scale ?? 1;
  const gap = options.gap ?? 8;
  const max = options.max ?? MAX_REGIONS;
  let boxes = rects
    .map((r) => {
      const x = Math.max(0, Math.round(r.x * scale));
      const y = Math.max(0, Math.round(r.y * scale));
      return {
        x,
        y,
        width: Math.round((r.x + r.width) * scale) - x,
        height: Math.round((r.y + r.height) * scale) - y,
      };
    })
    .filter((r) => r.width > 0 && r.height > 0)
    .sort(byPosition);
  if (boxes.length > MAX_INPUT) {
    const bySize = [...boxes].sort((a, b) => area(b) - area(a) || byPosition(a, b));
    boxes = [...bySize.slice(0, MAX_INPUT - 1), union(bySize.slice(MAX_INPUT - 1))].sort(
      byPosition,
    );
  }
  while (mergeOnce(boxes, gap)) {
    // Keep merging until no two boxes overlap or nearly touch.
  }
  while (boxes.length > max) {
    let best: [number, number] = [0, 1];
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const cost = addedArea(boxes[i]!, boxes[j]!);
        if (cost < bestCost) {
          bestCost = cost;
          best = [i, j];
        }
      }
    const [i, j] = best;
    boxes[i] = union([boxes[i]!, boxes[j]!]);
    boxes.splice(j, 1);
    while (mergeOnce(boxes, gap)) {
      // The union can reach a box it did not include; merge those too so none overlap.
    }
  }
  return boxes.sort(byPosition);
}

/** 8-neighbourhood, so diagonal steps of a change stay one region. */
const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * The separate areas of change in a pixelmatch diff image (changed pixels are pure red). Pixels are
 * grouped into cells, neighbouring changed cells form one area, and each area keeps the exact
 * bounds of its changed pixels.
 */
export function changedRegions(
  image: { data: Uint8Array; width: number; height: number },
  options: { cell?: number; max?: number } = {},
): Rect[] {
  const cell = options.cell ?? 16;
  const { data, width, height } = image;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  // Per cell: minX, minY, maxX, maxY of its changed pixels (-1 when it has none).
  const box = new Int32Array(cols * rows * 4).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] !== 255 || data[i + 1] !== 0 || data[i + 2] !== 0) continue;
      const c = (Math.floor(y / cell) * cols + Math.floor(x / cell)) * 4;
      if (box[c] === -1) {
        box[c] = x;
        box[c + 1] = y;
        box[c + 2] = x;
        box[c + 3] = y;
      } else {
        box[c] = Math.min(box[c]!, x);
        box[c + 1] = Math.min(box[c + 1]!, y);
        box[c + 2] = Math.max(box[c + 2]!, x);
        box[c + 3] = Math.max(box[c + 3]!, y);
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const areas: Rect[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || box[start * 4] === -1) continue;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = -1;
    let y1 = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      x0 = Math.min(x0, box[c * 4]!);
      y0 = Math.min(y0, box[c * 4 + 1]!);
      x1 = Math.max(x1, box[c * 4 + 2]!);
      y1 = Math.max(y1, box[c * 4 + 3]!);
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (!seen[n] && box[n * 4] !== -1) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    areas.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  return mergeRegions(areas, { gap: cell, max: options.max ?? MAX_REGIONS });
}
