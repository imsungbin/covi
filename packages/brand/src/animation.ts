import { type Expression, type FoxOptions, restingPose } from './mascot.ts';

/**
 * The narrator's named animations. Each is a pure function of time: a frame looks the same no
 * matter how it was reached, which keeps video rendering deterministic.
 *
 * - blink: eyelids close briefly on a seeded schedule (the caller supplies the amount)
 * - talk: the mouth follows the narration's loudness (the caller supplies the amount)
 * - look: the eyes settle on the content the scene is about
 * - think: a slow sway with the eyes up and away while thought dots appear one by one
 * - alert: the ears flick, the head jolts, and the warning badge pops in
 * - approve: two small nods while the check badge pops in
 * - point: the fox leans toward highlighted content and keeps its eyes on it
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
  seed?: number;
}

export interface Pose {
  /** Options for foxSvg (size and colors are the caller's). */
  fox: FoxOptions;
  /** Whole-narrator lean: horizontal shift in viewBox units and rotation in degrees. */
  lean: { x: number; rotate: number };
  /** The animations moving at this moment. */
  active: FoxAnimation[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (t: number, start: number, end: number) => clamp01((t - start) / (end - start));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** 0 → about 1.08 → 1: a pop that overshoots a little and settles. */
const pop = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);

export function foxPose(input: PoseInput): Pose {
  const { expression, t, time } = input;
  const seed = input.seed ?? 0;
  const rest = restingPose(expression);
  const active: FoxAnimation[] = [];
  if (input.blink > 0) active.push('blink');
  if (input.mouth > 0.05) active.push('talk');

  // look: from the resting gaze to the content once the scene has settled.
  const settle = easeOut(seg(t, 0.6, 1.2));
  let look = {
    x: rest.look.x + (input.gaze.x - rest.look.x) * settle,
    y: rest.look.y + (input.gaze.y - rest.look.y) * settle,
  };
  if ((input.gaze.x || input.gaze.y) && settle > 0) active.push('look');

  let tilt = rest.tilt;
  let ears = rest.ears;
  let bounce = 0;
  let propReveal = 1;
  if (expression === 'thinking') {
    active.push('think');
    tilt = rest.tilt + Math.sin(time * 1.3 + seed) * 2.5;
    // Thinking looks up and away, not at the content.
    look = { x: rest.look.x + Math.sin(time * 0.9 + seed) * 0.15, y: rest.look.y };
    propReveal = seg(t, 0.2, 1.4);
  } else if (expression === 'warning') {
    active.push('alert');
    ears = rest.ears + Math.sin(t * 9) * 2.2 * (1 - seg(t, 0, 0.8));
    bounce = -3 * Math.sin(Math.PI * seg(t, 0, 0.35));
    propReveal = pop(seg(t, 0, 0.45));
  } else if (expression === 'success') {
    active.push('approve');
    const n = seg(t, 0.15, 0.95);
    bounce = 2.8 * Math.abs(Math.sin(n * Math.PI * 2)) * (1 - n * 0.4);
    propReveal = pop(seg(t, 0.1, 0.55));
  }

  // point: lean toward highlighted content after it appears.
  let lean = { x: 0, rotate: 0 };
  if (input.pointing && expression !== 'thinking') {
    const k = easeOut(seg(t, 0.8, 1.4));
    if (k > 0) {
      active.push('point');
      const dir = Math.sign(input.gaze.x) || -1;
      lean = { x: dir * 5 * k, rotate: dir * 4 * k };
      look = { x: look.x + (dir - look.x) * k * 0.5, y: look.y };
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
      bounce,
      propReveal,
    },
    lean,
    active,
  };
}
