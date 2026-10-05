import { clamp, deg, lerp, lerpAngle } from './geometry.ts';
import { type Expression, type FoxOptions, restingPose } from './mascot.ts';
import { aimAngle } from './tail.ts';

/**
 * The narrator's named animations. Each is a pure function of time: a frame looks the same no
 * matter how it was reached, which keeps video rendering deterministic.
 *
 * - blink: eyelids close briefly on a seeded schedule (the caller supplies the amount)
 * - talk: the mouth follows the narration's loudness, and the tail flicks on its peaks
 * - look: the eyes, and the head a little, settle on the content the scene is about
 * - think: a slow sway with the eyes up and away and the tail curling, while thought dots appear
 * - alert: the ears flick, the head jolts, the tail puffs up, lifts, and flicks, and the warning
 *   badge pops in
 * - approve: two nods and a wag of the tail while the check badge pops in
 * - point: the tail sweeps out toward highlighted content and its ▶ turns into an arrow at it
 *
 * When nothing else moves it, the tail sways a tiny amount on a seeded phase.
 */
export const ANIMATIONS = ['blink', 'talk', 'look', 'think', 'alert', 'approve', 'point'] as const;
export type FoxAnimation = (typeof ANIMATIONS)[number];

export interface PoseInput {
  expression: Expression;
  /** Seconds since the scene began. */
  t: number;
  /** Seconds since the video began (for idle motion that continues across scenes). */
  time: number;
  /** Mouth opening from the narration audio, 0–1. */
  mouth: number;
  /** Eyelid closure, 0–1. */
  blink: number;
  /** Where the scene's content is, as seen from the narrator, each axis -1…1. */
  gaze: { x: number; y: number };
  /** The scene highlights something (a focus box, highlighted lines, findings). */
  pointing: boolean;
  /**
   * What the tail points at: a direction in degrees (screen angles, y down) or a point in the
   * fox's view-box units. Defaults to the direction of `gaze`.
   */
  aim?: number | { x: number; y: number };
  /** How far the tail may extend to point, 0–1; layouts with little room pass less. */
  reach?: number;
  seed?: number;
}

export interface Pose {
  /** Options for foxSvg (size, theme, and colors are the caller's). */
  fox: FoxOptions;
  /** The animations moving at this moment. */
  active: FoxAnimation[];
}

const seg = (t: number, start: number, end: number) => clamp((t - start) / (end - start));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const smoothstep = (a: number, b: number, x: number) => {
  const k = seg(x, a, b);
  return k * k * (3 - 2 * k);
};
/** 0 → about 1.08 → 1: a pop that overshoots a little and settles. */
const pop = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);

/** The tail's direction: the aim when given, else the way the eyes look. */
function aimFor(input: PoseInput): number {
  return aimAngle(input.aim ?? deg(Math.atan2(input.gaze.y, input.gaze.x)));
}

export function foxPose(input: PoseInput): Pose {
  const { expression, t, time } = input;
  const seed = input.seed ?? 0;
  const rest = restingPose(expression);
  const active: FoxAnimation[] = [];
  if (input.blink > 0) active.push('blink');

  // talk: the mouth follows the voice; loud syllables flick the tail.
  const peak = smoothstep(0.35, 0.95, input.mouth);
  if (input.mouth > 0.05) active.push('talk');

  // look: from the resting gaze to the content once the scene has settled.
  const settle = easeOut(seg(t, 0.6, 1.2));
  let look = {
    x: lerp(rest.look.x, input.gaze.x, settle),
    y: lerp(rest.look.y, input.gaze.y, settle),
  };
  if ((input.gaze.x || input.gaze.y) && settle > 0) active.push('look');

  // A tiny sway keeps the tail alive; the seed sets its phase.
  let wag = 0.12 * Math.sin((2 * Math.PI * time) / 3.4 + seed * 2.39) + 0.1 * peak;
  let curl = rest.curl + 0.12 * peak;
  let tilt = rest.tilt;
  let ears = rest.ears;
  let bounce = 0;
  let nod = 0;
  let puff = 0;
  let lift = 0;
  let propReveal = 1;
  if (expression === 'thinking') {
    active.push('think');
    tilt = rest.tilt + Math.sin(time * 1.3 + seed) * 2.5;
    // Thinking looks up and away, not at the content, and slowly curls the tail.
    look = { x: rest.look.x + Math.sin(time * 0.9 + seed) * 0.15, y: rest.look.y };
    curl += 0.3 * Math.sin(time * 0.8 + seed * 1.7);
    propReveal = seg(t, 0.2, 1.4);
  } else if (expression === 'warning') {
    active.push('alert');
    ears = rest.ears + Math.sin(t * 9) * 2.2 * (1 - seg(t, 0, 0.8));
    bounce = -3 * Math.sin(Math.PI * seg(t, 0, 0.35));
    propReveal = pop(seg(t, 0, 0.45));
    // The fur puffs up and the tail lifts, with a quick flick that dies away.
    puff = rest.puff * easeOut(seg(t, 0, 0.3));
    lift = 0.6 * easeOut(seg(t, 0.05, 0.45));
    wag += 0.7 * Math.sin(2 * Math.PI * 2.6 * t) * Math.exp(-3.2 * t);
  } else if (expression === 'success') {
    active.push('approve');
    const n = seg(t, 0.15, 0.95);
    nod = 2.8 * Math.abs(Math.sin(n * Math.PI * 2)) * (1 - n * 0.4);
    propReveal = pop(seg(t, 0.1, 0.55));
    const w = seg(t, 0.15, 1.75);
    wag += 0.8 * Math.sin(2 * Math.PI * 1.7 * (t - 0.15)) * (w > 0 ? 1 - w : 0);
  }

  // point: the tail sweeps out toward highlighted content once it is on screen.
  let reach = 0;
  let lean = 0;
  if (input.pointing && expression !== 'thinking') {
    const k = easeInOut(seg(t, 0.8, 1.6));
    if (k > 0) {
      active.push('point');
      reach = k * clamp(input.reach ?? 1);
      // The tail does the pointing now; the body only leans into it a little.
      lean = -1.5 * k;
      // A pointing tail holds steady: the wag settles into the small idle sway.
      wag *= 1 - 0.7 * k;
    }
  }

  return {
    fox: {
      expression,
      mouth: input.mouth,
      blink: input.blink,
      look,
      tilt,
      ears,
      brow: rest.brow,
      bounce,
      nod,
      lean,
      propReveal,
      reach,
      aim: aimFor(input),
      curl: clamp(curl, -1, 1),
      lift,
      wag: clamp(wag, -1, 1),
      puff,
    },
    active,
  };
}

/**
 * Eases from one pose to another, `w` from 0 (all `a`) to 1 (all `b`), so the narrator never pops
 * between scenes. Continuous values blend; the face switches expression halfway, with the old
 * prop shrinking away before the new one appears.
 */
export function blendPoses(a: Pose, b: Pose, w: number): Pose {
  const k = clamp(w);
  const A = a.fox;
  const B = b.fox;
  const num = (x: number | undefined, y: number | undefined) => lerp(x ?? 0, y ?? 0, k);
  const restA = restingPose(A.expression ?? 'neutral');
  const restB = restingPose(B.expression ?? 'neutral');
  const browA = { ...restA.brow, ...A.brow };
  const browB = { ...restB.brow, ...B.brow };
  const lookA = A.look ?? restA.look;
  const lookB = B.look ?? restB.look;
  const aimA = typeof A.aim === 'number' ? A.aim : undefined;
  const aimB = typeof B.aim === 'number' ? B.aim : undefined;
  const first = k < 0.5;
  return {
    fox: {
      expression: first ? A.expression : B.expression,
      mouth: B.mouth,
      blink: B.blink,
      look: { x: lerp(lookA.x, lookB.x, k), y: lerp(lookA.y, lookB.y, k) },
      tilt: lerp(A.tilt ?? restA.tilt, B.tilt ?? restB.tilt, k),
      ears: lerp(A.ears ?? restA.ears, B.ears ?? restB.ears, k),
      brow: {
        left: lerp(browA.left, browB.left, k),
        right: lerp(browA.right, browB.right, k),
        inner: lerp(browA.inner, browB.inner, k),
      },
      bounce: num(A.bounce, B.bounce),
      nod: num(A.nod, B.nod),
      lean: num(A.lean, B.lean),
      propReveal: first ? (A.propReveal ?? 1) * (1 - 2 * k) : (B.propReveal ?? 1) * (2 * k - 1),
      reach: num(A.reach, B.reach),
      aim: aimA !== undefined && aimB !== undefined ? lerpAngle(aimA, aimB, k) : (aimB ?? aimA),
      curl: num(A.curl, B.curl),
      lift: num(A.lift, B.lift),
      wag: num(A.wag, B.wag),
      puff: num(A.puff, B.puff),
    },
    active: [...new Set([...(first ? a.active : b.active), ...(k > 0 && k < 1 ? b.active : [])])],
  };
}
