import {
  angleDelta,
  boundsOf,
  clamp,
  deg,
  lerp,
  type Point,
  type Rect,
  rad,
  rotate,
} from './geometry.ts';

/**
 * The fox's tail as a rig. Its spine is an arc of fixed length whose curvature changes linearly
 * along it, κ(s) = a + b·s/L, so every pose (and every blend of two poses) is a smooth curve;
 * blending Bézier control points between drawn poses instead produces kinks. A width profile
 * around the spine gives the outline, closed by a round cap that holds the play disc.
 */
export interface TailOptions {
  /** 0 = curled beside the body (rest), 1 = extended toward `aim`. */
  reach?: number;
  /**
   * Where the tip points once extended: a direction in degrees (screen angles, y down: 0 = right,
   * 90 = down, 180 = left) or a point in view-box units that the tip turns toward.
   */
  aim?: number | { x: number; y: number };
  /** Extra bend, −1 (looser) … 1 (tighter). */
  curl?: number;
  /** 0 … 1: carries the tail higher, the way a startled fox does. */
  lift?: number;
  /** −1 … 1: swings the tail about the hip (positive swings it up) and whips the tip after it. */
  wag?: number;
  /** 0 … 1: the fur puffs up, so the tail and its disc grow wider. */
  puff?: number;
}

export interface TailShape {
  /** The outline: one side of the tail, around the round cap, and back along the other side. */
  outline: Point[];
  /** Points on the spine from the hip to the cap's center. */
  spine: Point[];
  /** The round cap closing the tail; the disc is concentric with it. */
  cap: { center: Point; radius: number };
  /** Radius of the paper disc inside the cap (the rest of the cap shows as a fur rim). */
  disc: number;
  /** The play mark on the disc: an upright ▶ at rest that turns into an arrow toward the aim. */
  mark: Point[];
  /** Direction of the spine at the cap, in degrees. */
  tip: number;
  /** Half-widths of the tail at each spine point. */
  widths: number[];
  /** Curvature at each spine point, in degrees per unit. */
  curvature: number[];
}

/** Where the tail leaves the body: hidden behind the hips. */
export const TAIL_BASE: Point = [66, 113];
/** Aims the tail can reach from its side of the body, in degrees. */
export const TAIL_AIM_RANGE = { min: 100, max: 245 } as const;

interface Arc {
  /** Direction at the hip, in degrees. */
  theta0: number;
  length: number;
  /** Curvature at the hip and its growth toward the tip, in degrees per unit. */
  a: number;
  b: number;
}

/** Curled up beside the body, the tip above the hip. */
const REST: Arc = { theta0: 167, length: 99, a: 0.55, b: 2.5 };
const EXTENDED_LENGTH = 89;
/** The fur rim left around the disc. */
const RIM = 3.4;
/** How close the inner edge may come to folding: the radius of curvature stays above width / 0.9. */
const FOLD_MARGIN = 0.9;
const STEPS = 128;
const SAMPLES = 32;

const smooth = (k: number) => k * k * (3 - 2 * k);

function widths(puff: number): { base: number; max: number } {
  return { base: 4.6 + 1 * puff, max: 13.6 + 2.4 * puff };
}

/**
 * The extended pose for a tip direction. The tail leaves the hip rising and bends down toward the
 * target, like a finger pointing at a line: the lower the target, the higher the arch. The bend
 * grows toward the tip, and it is solved so the spine points exactly at `aim` where the cap starts.
 */
function extended(aim: number, capWidth: number): Arc {
  const phi = clampAim(aim);
  const theta0 = clamp(phi + 89 - 1.17 * (phi - 128), 176, 224);
  const u = (EXTENDED_LENGTH - capWidth) / EXTENDED_LENGTH;
  const turn = (phi - theta0) / (0.6 * u + 0.4 * u * u);
  return {
    theta0,
    length: EXTENDED_LENGTH,
    a: (0.6 * turn) / EXTENDED_LENGTH,
    b: (0.8 * turn) / EXTENDED_LENGTH,
  };
}

function arcFor(o: Required<Omit<TailOptions, 'aim'>>, aim: number, capWidth: number): Arc {
  const k = clamp(o.reach);
  const e = extended(aim, capWidth);
  // Modifiers act mostly on the curled tail: an extended tail keeps pointing where it was aimed.
  const free = 1 - 0.6 * k;
  // The head sits just above and right of the disc, so wag and curl move it mostly down and out:
  // wag turns the hip +1.5° … −10°, curl adds +0.2 … −1 degrees per unit toward the tip.
  const wag = o.wag * (5.75 - 4.25 * o.wag);
  const curl = o.curl * (0.6 - 0.4 * o.curl);
  return {
    theta0: lerp(REST.theta0, e.theta0, k) + (wag + 10 * o.lift) * free,
    // Mid-swing the tail turns toward the viewer and reads shorter, so the sweep stays within the
    // room its start and end poses take instead of swinging wide through a long, straight pose.
    length: lerp(REST.length, e.length, k) - 16 * Math.sin(Math.PI * k),
    a: lerp(REST.a, e.a, k) + (0.2 * curl - 0.25 * o.lift) * free,
    // Lifting opens the curl as it raises the hip, so the tail stands up beside the body.
    b: lerp(REST.b, e.b, k) + (curl + 0.06 * wag - 1.2 * o.lift) * free,
  };
}

interface Sample {
  p: Point;
  /** Spine direction in degrees. */
  phi: number;
  half: number;
  kappa: number;
}

/** Integrates the spine from the hip to the cap's center, clamping curvature so it never folds. */
function integrate(arc: Arc, w: { base: number; max: number }): Sample[] {
  const capStart = Math.max(arc.length * 0.5, arc.length - w.max);
  const half = (s: number) =>
    lerp(w.base, w.max, Math.sin(clamp(s / capStart) * (Math.PI / 2)) ** 1.25);
  const kappa = (s: number) => {
    const limit = deg(FOLD_MARGIN / half(s));
    return clamp(arc.a + (arc.b * s) / arc.length, -limit, limit);
  };
  const ds = capStart / STEPS;
  const out: Sample[] = [];
  let x = TAIL_BASE[0];
  let y = TAIL_BASE[1];
  let phi = arc.theta0;
  for (let i = 0; i <= STEPS; i++) {
    const s = i * ds;
    if (i % (STEPS / SAMPLES) === 0) out.push({ p: [x, y], phi, half: half(s), kappa: kappa(s) });
    // Midpoint rule: advance along the direction halfway through the step.
    const mid = phi + (kappa(s) * ds) / 2;
    x += Math.cos(rad(mid)) * ds;
    y += Math.sin(rad(mid)) * ds;
    phi += ((kappa(s) + kappa(s + ds)) / 2) * ds;
  }
  return out;
}

/** The shape of the tail for a set of rig parameters. Pure: the same options give the same shape. */
export function tailShape(options: TailOptions = {}): TailShape {
  const o = {
    reach: clamp(options.reach ?? 0),
    curl: clamp(options.curl ?? 0, -1, 1),
    lift: clamp(options.lift ?? 0),
    wag: clamp(options.wag ?? 0, -1, 1),
    puff: clamp(options.puff ?? 0),
  };
  const w = widths(o.puff);
  const target = options.aim;
  let aim = typeof target === 'number' ? target : 140;
  let samples = integrate(arcFor(o, aim, w.max), w);
  if (target !== undefined && typeof target !== 'number' && o.reach > 0) {
    // Turn toward the point as seen from the extended tip; the tip moves with the aim, so iterate.
    for (let i = 0; i < 5; i++) {
      const tip = integrate(arcFor({ ...o, reach: 1 }, aim, w.max), w).at(-1)!.p;
      aim = clampAim(deg(Math.atan2(target.y - tip[1], target.x - tip[0])));
    }
    samples = integrate(arcFor(o, aim, w.max), w);
  }

  const left: Point[] = [];
  const right: Point[] = [];
  for (const q of samples) {
    const n: Point = [-Math.sin(rad(q.phi)), Math.cos(rad(q.phi))];
    left.push([q.p[0] + n[0] * q.half, q.p[1] + n[1] * q.half]);
    right.push([q.p[0] - n[0] * q.half, q.p[1] - n[1] * q.half]);
  }
  const end = samples.at(-1)!;
  const center = end.p;
  // The cap is part of the outline (a separate circle would leave nubs where it joins the sides).
  const cap: Point[] = [];
  for (let j = 1; j < 12; j++) {
    const a = rad(end.phi + 90 - (180 * j) / 12);
    cap.push([center[0] + Math.cos(a) * w.max, center[1] + Math.sin(a) * w.max]);
  }
  const disc = w.max - RIM;

  // The mark stays an upright ▶ (a play button) at rest. Extending, it turns clockwise to the
  // tip's direction (the short way round for targets below) and becomes an arrowhead: it grows
  // longer and a notch opens in its back, since a tilted triangle has no readable direction. The
  // spine's direction is never wrapped and stays within 0–360°, so the mark turns continuously.
  // The arrow takes shape ahead of the turn, so the mark is never a tilted triangle in between.
  const k = 1 - (1 - o.reach) ** 3;
  const angle = smooth(o.reach) * end.phi;
  const sc = disc / 10.2;
  const len = lerp(5.2, 7.8, k);
  const back = lerp(3.9, 4.6, k);
  const wid = lerp(5, 4.6, k);
  const notch = lerp(back, 1.4, k);
  const shift = lerp(0.6, -1.2, k);
  const mark = (
    [
      [-back, -wid],
      [len, 0],
      [-back, wid],
      [-notch, 0],
    ] as Point[]
  ).map(([x, y]) => {
    const q = rotate([(x + shift) * sc, y * sc], angle);
    return [q[0] + center[0], q[1] + center[1]] as Point;
  });

  return {
    outline: [...left, ...cap, ...right.reverse()],
    spine: samples.map((q) => q.p),
    cap: { center, radius: w.max },
    disc,
    mark,
    tip: end.phi,
    widths: samples.map((q) => q.half),
    curvature: samples.map((q) => q.kappa),
  };
}

/**
 * Boxes that cover the tail, tighter than one bounding box when it arches out to point. They are
 * padded by half a unit for the smooth outline's swing between sample points.
 */
export function tailParts(shape: TailShape, pieces = 5): Rect[] {
  const n = shape.spine.length;
  const side = (shape.outline.length - 11) / 2;
  const left = shape.outline.slice(0, side);
  const right = shape.outline.slice(side + 11).reverse();
  const parts: Rect[] = [];
  for (let i = 0; i < pieces; i++) {
    const from = Math.floor((i * (n - 1)) / pieces);
    const to = Math.ceil(((i + 1) * (n - 1)) / pieces);
    parts.push(pad(boundsOf([...left.slice(from, to + 1), ...right.slice(from, to + 1)]), 0.5));
  }
  const { center, radius } = shape.cap;
  parts.push(
    pad(
      { x: center[0] - radius, y: center[1] - radius, width: 2 * radius, height: 2 * radius },
      0.5,
    ),
  );
  return parts;
}

function pad(b: Rect, by: number): Rect {
  return { x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by };
}

/** The direction an extended tail settles on for an aim: an angle in reach, or toward a point. */
export function aimAngle(aim: number | { x: number; y: number }): number {
  return typeof aim === 'number' ? clampAim(aim) : tailShape({ reach: 1, aim }).tip;
}

/** The nearest direction the tail can reach, from its side of the body, in degrees. */
export function clampAim(angle: number): number {
  const a = ((angle % 360) + 360) % 360;
  const { min, max } = TAIL_AIM_RANGE;
  if (a >= min && a <= max) return a;
  return Math.abs(angleDelta(a, min)) <= Math.abs(angleDelta(a, max)) ? min : max;
}
