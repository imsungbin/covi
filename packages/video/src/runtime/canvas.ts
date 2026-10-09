import {
  CAMERA_TRANSITIONS,
  type CameraMove,
  type Point,
  type Rect,
  type Stop,
  type TransitionKind,
} from '../timeline/types.ts';
import { clamp, easeInOutCubic, lerp } from './anim.ts';

/*
 * The canvas: every story scene sits at its stop, a frame-sized region of one large world, and
 * the camera travels between them. A view is what the camera looks at: the world point drawn at
 * the pivot (the media region's center, where the push-in always scaled from) and how much it
 * magnifies. Pure functions of their inputs, so any frame draws on its own.
 */

export interface View {
  x: number;
  y: number;
  scale: number;
}

export type CameraKind = (typeof CAMERA_TRANSITIONS)[number];

/** A camera beat inside a stop: from `t` (seconds since the scene started) for `seconds`, toward `to`. */
export interface CameraStep {
  t: number;
  seconds: number;
  to: View;
}

/** The most a camera beat magnifies. */
export const MAX_ZOOM = 2.5;
/** A fitted target fills this share of the region. */
const FIT = 0.9;
/** A zoom between stops pulls back a little further than both regions need, so they breathe. */
export const PULL_MARGIN = 0.92;

export function isCameraMove(kind: TransitionKind): kind is CameraKind {
  return (CAMERA_TRANSITIONS as readonly TransitionKind[]).includes(kind);
}

/** The view at rest in a stop, in stop-local coordinates: its own region, unmagnified. */
export function restView(pivot: Point): View {
  return { x: pivot.x, y: pivot.y, scale: 1 };
}

/** A stop-local view placed on the canvas. */
export function toWorld(view: View, stop: Stop): View {
  return { x: view.x + stop.x, y: view.y + stop.y, scale: view.scale };
}

/** The scene camera's push-in (drift, linger, the hero's punch) on top of a view. */
export function withPush(view: View, push: number): View {
  return { ...view, scale: view.scale * (1 + push) };
}

function lerpView(a: View, b: View, k: number): View {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), scale: lerp(a.scale, b.scale, k) };
}

/**
 * A magnified view moved just enough that what it shows stays inside `region`: a stop never shows
 * the empty canvas beside it. Views that pull back (between stops) are left alone.
 */
export function clampView(view: View, region: Rect, pivot: Point): View {
  if (view.scale < 1) return view;
  const axis = (f: number, start: number, size: number, p: number) =>
    clamp(f, start + (p - start) / view.scale, start + size - (start + size - p) / view.scale);
  return {
    x: axis(view.x, region.x, region.width, pivot.x),
    y: axis(view.y, region.y, region.height, pivot.y),
    scale: view.scale,
  };
}

/**
 * Where a camera beat takes the camera (stop-local): `zoom` and `follow` frame the target at the
 * beat's zoom, else fitted to the region (at most 2.5×); `pan` centers it at the scale the camera
 * already has. A target wider or taller than the view shows its start (code reads from the left).
 */
export function beatView(
  move: CameraMove,
  target: Rect,
  zoom: number | undefined,
  from: View,
  region: Rect,
  pivot: Point,
): View {
  const fitted = Math.min(region.width / target.width, region.height / target.height) * FIT;
  const scale = move === 'pan' ? from.scale : clamp(zoom ?? fitted, 1, MAX_ZOOM);
  const focus = (
    start: number,
    size: number,
    regionStart: number,
    regionSize: number,
    p: number,
  ) => (size * scale > regionSize ? start + (p - regionStart) / scale : start + size / 2);
  return clampView(
    {
      x: focus(target.x, target.width, region.x, region.width, pivot.x),
      y: focus(target.y, target.height, region.y, region.height, pivot.y),
      scale,
    },
    region,
    pivot,
  );
}

/**
 * The view at `t` (seconds since the scene started): each beat eases from where the camera was
 * when it started, which is where the beat before it had got to by then. `steps` must be in time
 * order: the walk stops at the first step that has not started.
 */
export function viewAt(steps: readonly CameraStep[], t: number, rest: View): View {
  let view = rest;
  for (const [i, step] of steps.entries()) {
    if (t < step.t) break;
    const next = steps[i + 1];
    const until = next && next.t < t ? next.t : t;
    view = lerpView(
      view,
      step.to,
      easeInOutCubic(clamp((until - step.t) / Math.max(step.seconds, 1e-6))),
    );
  }
  return view;
}

/** How far a zoom between two stops pulls back: both stops' regions fit in the region at once. */
export function pullBack(a: Stop, b: Stop, region: Rect): number {
  return Math.min(
    1,
    region.width / (Math.abs(b.x - a.x) + region.width),
    region.height / (Math.abs(b.y - a.y) + region.height),
  );
}

/**
 * The camera `k` (0–1) of the way from one stop's view to the next's (world coordinates). A pan
 * glides; a zoom glides too while it pulls back to `back` at the middle and pushes in again.
 */
export function between(kind: CameraKind, from: View, to: View, k: number, back: number): View {
  const view = lerpView(from, to, easeInOutCubic(clamp(k)));
  if (kind === 'pan') return view;
  const dip = Math.sin(Math.PI * clamp(k)) ** 2;
  return { ...view, scale: lerp(view.scale, back, dip) };
}

/** Two decimals, never `-0.00`: float error at rest (stops on a fractional grid) has a sign. */
const fixed = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);

/** The CSS transform (origin 0 0) that draws a stop's layer as the camera sees it. */
export function layerTransform(view: View, stop: Stop, pivot: Point): string {
  const tx = pivot.x + view.scale * (stop.x - view.x);
  const ty = pivot.y + view.scale * (stop.y - view.y);
  return `translate(${fixed(tx)}px, ${fixed(ty)}px) scale(${view.scale.toFixed(5)})`;
}

/** Where the camera draws a box laid out in a stop (stop-local stage pixels): `layerTransform`'s. */
export function drawnRect(rect: Rect, view: View, stop: Stop, pivot: Point): Rect {
  const s = view.scale;
  return {
    x: pivot.x + s * (stop.x + rect.x - view.x),
    y: pivot.y + s * (stop.y + rect.y - view.y),
    width: rect.width * s,
    height: rect.height * s,
  };
}

export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    width: lerp(a.width, b.width, k),
    height: lerp(a.height, b.height, k),
  };
}

/** `clip-path` for a region of the frame. */
export function insetOf(clip: Rect, width: number, height: number): string {
  const px = (n: number) => `${Math.max(0, n).toFixed(2)}px`;
  return `inset(${px(clip.y)} ${px(width - clip.x - clip.width)} ${px(height - clip.y - clip.height)} ${px(clip.x)})`;
}

/** The part of a box inside the clip, or nothing when none of it is. */
export function clipRect(rect: Rect, clip: Rect): Rect | undefined {
  const x = Math.max(rect.x, clip.x);
  const y = Math.max(rect.y, clip.y);
  const right = Math.min(rect.x + rect.width, clip.x + clip.width);
  const bottom = Math.min(rect.y + rect.height, clip.y + clip.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/**
 * Where the canvas's dots sit for a view: they move and scale with the camera. Stops sit on the
 * grid, so at rest at any stop the dots line up with the stage's own.
 */
export function gridStyle(
  view: View,
  pivot: Point,
  spacing: number,
): { position: string; size: string } {
  const size = spacing * view.scale;
  const x = mod(pivot.x - view.scale * view.x, size);
  const y = mod(pivot.y - view.scale * view.y, size);
  // A remainder within rounding of the size is a whole tile: 0, not 29.999.
  const near = (v: number) => (size - v < 1e-6 ? 0 : v);
  return {
    position: `${near(x).toFixed(2)}px ${near(y).toFixed(2)}px`,
    size: `${size.toFixed(3)}px ${size.toFixed(3)}px`,
  };
}
