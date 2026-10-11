import type { CameraKind, CameraMove, Point, Rect, Stop } from '../timeline/types.ts';
import { clamp, easeInOutCubic, lerp, seg } from './anim.ts';

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

/**
 * A camera beat inside a stop: from `t` (seconds since the scene started) for `seconds`, toward
 * `to`, or, following a moving target, toward where it is at each moment.
 */
export interface CameraStep {
  t: number;
  seconds: number;
  to: View | ((t: number) => View);
}

/** The most a camera beat magnifies. */
export const MAX_ZOOM = 2.5;
/** A fitted target fills this share of the region. */
const FIT = 0.9;
/** A zoom between stops pulls back a little further than both regions need, so they breathe. */
export const PULL_MARGIN = 0.92;

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

export function lerpView(a: View, b: View, k: number): View {
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
  const scale = move === 'pan' ? from.scale : clamp(zoom ?? fitted(target, region), 1, MAX_ZOOM);
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

/** The scale at which a target fills its share of the region. */
function fitted(target: Rect, region: Rect): number {
  return Math.min(region.width / target.width, region.height / target.height) * FIT;
}

/** A follow's clamps ease in over this share of the view, so the camera's speed never jumps. */
const EASE_IN = 1 / 4;

/** `min(a, b)`, rounded off where they are within `k` of each other, so its slope is continuous. */
function softMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/**
 * A follow framing a card (a morph's code) holds back to keep the card whole while its zoom asks
 * for at most this many times the scale that would: closer, it would cut only a sliver off the
 * card's sides or its header row, which reads as a mistake…
 */
const HOLD_BACK = 1.25;
/**
 * …and from there it eases toward the zoom asked, so a little more zoom never flips the framing,
 * until, at this many times that scale, it is a close-up of the lines alone.
 */
const CLOSE_UP = 1.6;

/**
 * The card a follow frames its target in, kept whole: its box (stop-local), the frame's width,
 * and how far the push-in may magnify the view on top of the follow.
 */
export interface FollowedCard {
  rect: Rect;
  width: number;
  push: number;
}

/**
 * The scale at which a card stays whole across the frame, with its top row and the lowest box
 * its target takes inside the region, even once the push-in has magnified it.
 */
function wholeScale(card: FollowedCard, bounds: Rect, region: Rect): number {
  const below = bounds.y + bounds.height - card.rect.y;
  const rows = below > 0 ? region.height / below : Number.POSITIVE_INFINITY;
  return Math.min(card.width / card.rect.width, rows) / (1 + card.push);
}

/**
 * How a follow beat frames a target that moves (stop-local): at one scale for the whole beat, the
 * beat's zoom, else what fits `bounds` (every box the target takes), so only the position tracks
 * it. As in `beatView`, a target that fits is centered, one that outgrows the view shows its start,
 * and the view stays inside `region`; here each of those clamps eases in, so the camera slows down
 * rather than stopping dead as the target grows past the view or nears the region's edge. With a
 * `card`, a modest zoom holds back to where the card stays whole (see `HOLD_BACK`), and the view
 * then also keeps the card across the frame and its top row below the region's top, so its header
 * never slides under the header band; a closer zoom eases from that framing to the close-up.
 */
export function follower(
  bounds: Rect,
  zoom: number | undefined,
  region: Rect,
  pivot: Point,
  card?: FollowedCard,
): (target: Rect) => View {
  const asked = clamp(zoom ?? fitted(bounds, region), 1, MAX_ZOOM);
  const free = framing(asked, region, pivot);
  if (!card) return free;
  const whole = wholeScale(card, bounds, region);
  const loose = easeInOutCubic(seg(asked / whole, HOLD_BACK, CLOSE_UP));
  if (loose >= 1) return free;
  const held = framing(clamp(whole, 1, asked), region, pivot, card);
  // Both views stay inside the region, and so does any blend of them: the view's room there only
  // widens as its scale grows.
  return loose <= 0 ? held : (target) => lerpView(held(target), free(target), loose);
}

/** A follow's framing at one `scale`, kept inside the region and, given a `card`, the card whole. */
function framing(
  scale: number,
  region: Rect,
  pivot: Point,
  card?: FollowedCard,
): (target: Rect) => View {
  // The scale the push-in may reach, at which the card's bounds must still hold.
  const most = scale * (1 + (card?.push ?? 0));
  /** Where the view's center may go on one axis: inside the region, as `clampView` keeps it. */
  const range = (regionStart: number, regionSize: number, p: number): [number, number] => [
    regionStart + (p - regionStart) / scale,
    regionStart + regionSize - (regionStart + regionSize - p) / scale,
  ];
  /** The same range narrowed to `[lo, hi]`, never past the region's. */
  const within = ([a, b]: [number, number], lo: number, hi: number): [number, number] => {
    const from = clamp(Math.max(a, lo), a, b);
    return [from, clamp(Math.min(b, hi), from, b)];
  };
  let xs = range(region.x, region.width, pivot.x);
  let ys = range(region.y, region.height, pivot.y);
  if (card) {
    const c = card.rect;
    xs = within(xs, c.x + c.width - (card.width - pivot.x) / most, c.x + pivot.x / most);
    ys = within(ys, Number.NEGATIVE_INFINITY, c.y + (pivot.y - region.y) / most);
  }
  const axis = (
    start: number,
    size: number,
    regionStart: number,
    regionSize: number,
    p: number,
    [lo, hi]: [number, number],
  ) => {
    const k = (regionSize / scale) * EASE_IN;
    // How far past its start the view centers on the target: its middle, or, once it outgrows the
    // view, where its start meets the region's.
    const focus = start + softMin(size / 2, (p - regionStart) / scale, k);
    // Kept inside its range as `clampView` keeps it inside the region, each end rounded within at
    // most half the room, so the two roundings never meet and the view never leaves the range.
    const edge = Math.min(k, (hi - lo) / 2);
    return softMin(-softMin(-focus, -lo, edge), hi, edge);
  };
  return (target) => ({
    x: axis(target.x, target.width, region.x, region.width, pivot.x, xs),
    y: axis(target.y, target.height, region.y, region.height, pivot.y, ys),
    scale,
  });
}

/**
 * The view at `t` (seconds since the scene started): each beat eases from the view the beats
 * before it give at that same moment. So a beat that starts while another is still moving takes
 * over from wherever that one has the camera, and the one before keeps moving underneath while
 * this one eases in: the camera's speed carries over rather than dropping to rest. `steps` must
 * be in time order: the walk stops at the first step that has not started. A beat that follows a
 * moving target keeps up with it once it has eased in, until the next beat has eased in too.
 */
export function viewAt(steps: readonly CameraStep[], t: number, rest: View): View {
  let view = rest;
  for (const step of steps) {
    if (t < step.t) break;
    const to = typeof step.to === 'function' ? step.to(t) : step.to;
    view = lerpView(view, to, easeInOutCubic(clamp((t - step.t) / Math.max(step.seconds, 1e-6))));
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
 * glides; a zoom glides too while it pulls back to `back` halfway there and pushes in again.
 */
export function between(kind: CameraKind, from: View, to: View, k: number, back: number): View {
  const travel = easeInOutCubic(clamp(k));
  const view = lerpView(from, to, travel);
  if (kind === 'pan') return view;
  // The dip follows the travel, not the clock: on the clock it would pull back while the camera
  // has barely moved, sweeping the frame behind the stop it leaves. It pulls back in proportion
  // to the travel from the start, so it never has to catch up where the travel is fastest.
  const dip = 4 * travel * (1 - travel);
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

/**
 * A box drawn on screen through a stop-local `view`, back where the stop lays it out: what it
 * covers when the camera is at rest. The inverse of `drawnRect`, which draws stop point p at
 * pivot + scale · (p − view).
 */
export function unview(rect: Rect, view: View, pivot: Point): Rect {
  return {
    x: view.x + (rect.x - pivot.x) / view.scale,
    y: view.y + (rect.y - pivot.y) / view.scale,
    width: rect.width / view.scale,
    height: rect.height / view.scale,
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

/**
 * A viewport clip feathered `feather` px past its top and bottom edges, as far as the frame
 * allows: `clip-path` reaches that far, and a mask fades the picture out over the reach, so what
 * passes out of the clip fades rather than being cut. The clip spans the frame's width, so its
 * sides need none.
 */
export function featherOf(
  clip: Rect,
  feather: number,
  width: number,
  height: number,
): { clip: string; mask: string } {
  const bottom = clip.y + clip.height;
  const above = Math.min(feather, clip.y);
  const below = Math.min(feather, height - bottom);
  const px = (n: number) => `${n.toFixed(2)}px`;
  return {
    clip: insetOf(
      { ...clip, y: clip.y - above, height: clip.height + above + below },
      width,
      height,
    ),
    mask: `linear-gradient(to bottom, transparent ${px(clip.y - above)}, #000 ${px(clip.y)}, #000 ${px(bottom)}, transparent ${px(bottom + below)})`,
  };
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
