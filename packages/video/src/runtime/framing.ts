import type { MarkTiming } from '../timeline/cues.ts';
import type { Point, Rect } from '../timeline/types.ts';
import { clamp, easeInOutCubic, lerp, seg } from './anim.ts';

/*
 * A frame's camera, as pure math: the image zooms and moves inside the frame's viewport (which
 * clips it), so it never touches the stage's camera on the media layer. Marks are a tour: the
 * camera zooms to the first, then pans from mark to mark.
 */

/** What a frame's camera works with: the image's size, where it rests, and the viewport's size. */
export interface FrameGeometry {
  image: { width: number; height: number };
  /** The image at rest, in viewport pixels. */
  base: Rect;
  viewport: { width: number; height: number };
}

/** The image's zoom and its offset in the viewport. */
export interface FrameCamera {
  z: number;
  ox: number;
  oy: number;
}

/** Zooms toward `focus` (image px) by progress `k` (0–1), never showing past the image's edge. */
export function frameCamera(
  g: FrameGeometry,
  focus: Rect | undefined,
  k: number,
  maxZoom = 1.9,
): FrameCamera {
  const s0 = g.base.width / g.image.width;
  let z = 1;
  let fx = g.image.width / 2;
  let fy = g.image.height / 2;
  if (focus && k > 0) {
    const pad = 1.5;
    const target = Math.min(
      maxZoom,
      g.viewport.width / (focus.width * s0 * pad),
      g.viewport.height / (focus.height * s0 * pad),
    );
    z = lerp(1, Math.max(1, target), easeInOutCubic(clamp(k)));
    fx = focus.x + focus.width / 2;
    fy = focus.y + focus.height / 2;
  }
  const startX = g.base.x + fx * s0;
  const startY = g.base.y + fy * s0;
  const e = focus ? easeInOutCubic(clamp(k)) : 0;
  const cx = lerp(startX, g.viewport.width / 2, e);
  const cy = lerp(startY, g.viewport.height / 2, e);
  let ox = cx - fx * s0 * z;
  let oy = cy - fy * s0 * z;
  const w = g.image.width * s0 * z;
  const h = g.image.height * s0 * z;
  ox = w > g.viewport.width ? clamp(ox, g.viewport.width - w, 0) : (g.viewport.width - w) / 2;
  oy = h > g.viewport.height ? clamp(oy, g.viewport.height - h, 0) : (g.viewport.height - h) / 2;
  return { z, ox, oy };
}

export function blendCamera(a: FrameCamera, b: FrameCamera, k: number): FrameCamera {
  return { z: lerp(a.z, b.z, k), ox: lerp(a.ox, b.ox, k), oy: lerp(a.oy, b.oy, k) };
}

export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    width: lerp(a.width, b.width, k),
    height: lerp(a.height, b.height, k),
  };
}

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Where the camera is among marks at `t`: the mark it is reaching (the last whose move has
 * started, else the first), the one it left (−1 before the first), and how far it has moved (0–1).
 */
export function markProgress(
  timing: readonly MarkTiming[],
  t: number,
): { from: number; to: number; k: number } {
  let to = 0;
  while (to + 1 < timing.length && t >= timing[to + 1]!.start) to++;
  return { from: to - 1, to, k: seg(t, ...timing[to]!.pan) };
}

/** Two or three marks zoom less than one focus does, so a pan keeps the page in view. */
export const MARK_ZOOM = 1.6;

/**
 * The camera among marks at `t`, and the region it frames (for the ring, the tail, and QC). A
 * single mark zooms as far as the frame's one-region shorthand (`focus`) would, `oneZoom`; a tour
 * zooms to `MARK_ZOOM` at most, and never past `oneZoom`.
 */
export function marksCamera(
  g: FrameGeometry,
  marks: readonly Rect[],
  timing: readonly MarkTiming[],
  t: number,
  oneZoom = 1.9,
): { camera: FrameCamera; focus: Rect; from: number; to: number; k: number } {
  const maxZoom = marks.length > 1 ? Math.min(MARK_ZOOM, oneZoom) : oneZoom;
  const { from, to, k } = markProgress(timing, t);
  const target = marks[to]!;
  if (from < 0) return { camera: frameCamera(g, target, k, maxZoom), focus: target, from, to, k };
  const e = easeInOutCubic(clamp(k));
  return {
    camera: blendCamera(
      frameCamera(g, marks[from]!, 1, maxZoom),
      frameCamera(g, target, 1, maxZoom),
      e,
    ),
    focus: lerpRect(marks[from]!, target, e),
    from,
    to,
    k,
  };
}
