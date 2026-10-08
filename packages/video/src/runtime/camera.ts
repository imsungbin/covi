import { motion } from '@covi/brand';
import { settledAt } from '../timeline/cues.ts';
import { HERO_PHASE, type TimelineScene } from '../timeline/types.ts';
import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from './anim.ts';

/*
 * The camera: a scene never holds still while its line is spoken. A capture drifts through its
 * whole scene; any other visual pushes in once its own choreography is done, or once it has
 * entered when an event is pinned to the line (the visual would otherwise wait still for it) or
 * when it is a diagram (its edges draw mostly under its nodes, so the frame looks still while they
 * do); the hero punches in at its phase. Pure functions of the scene clock.
 */

export interface CameraPlan {
  duration: number;
  /** A capture: the camera drifts through the whole scene. */
  drift: boolean;
  /** When the push-in may start (seconds since the scene started): the choreography is done, or
   * the visual has entered when an event is pinned to its line or it is a diagram. */
  settled: number;
  /** When its line ends; a visual that settles before it pushes in. */
  speechEnd?: number;
  /** `camera: static`: neither drift nor push-in. */
  still: boolean;
  /** The hero phase, where the camera punches in. */
  hero?: number;
}

/** Visuals that are captures of the running software. */
const CAPTURES = new Set<TimelineScene['visual']['kind']>([
  'screenshot',
  'before-after',
  'interaction',
]);

/** When a visual's entrance has risen into place (the first `rise` of every component). */
const ENTERED = 0.5;

/** How the camera moves in a scene; the outro moves on its own. */
export function cameraPlan(scene: TimelineScene): CameraPlan | undefined {
  const v = scene.visual;
  if (v.kind === 'outro') return undefined;
  const duration = scene.end - scene.start;
  const hero = scene.hero ? scene.phases?.[HERO_PHASE] : undefined;
  const settled = settledAt(v, duration, scene.phases);
  const pinned = Object.keys(scene.phases ?? {}).some((name) => name !== HERO_PHASE);
  const early = pinned || v.kind === 'diagram';
  return {
    duration,
    drift: CAPTURES.has(v.kind) || (v.kind === 'title' && v.background !== undefined),
    settled: early ? Math.min(settled, ENTERED) : settled,
    ...(scene.speech ? { speechEnd: scene.speech.end - scene.start } : {}),
    still: scene.camera === 'static',
    ...(hero === undefined ? {} : { hero }),
  };
}

/** How far the camera has pushed in at `t` (0 = not at all; 0.02 = 2%). */
export function cameraPush(t: number, plan: CameraPlan): number {
  let push = 0;
  if (!plan.still) {
    if (plan.drift) push += motion.drift * easeInOutSine(seg(t, 0, plan.duration));
    else if (plan.speechEnd !== undefined && plan.settled < Math.min(plan.speechEnd, plan.duration))
      push += motion.linger * easeInOutSine(seg(t, plan.settled, plan.duration));
  }
  if (plan.hero !== undefined) push += motion.punch * heroPunch(t - plan.hero);
  // Never past the punch: at 6% the media region's content stays clear of the caption band in
  // every orientation, while drift and punch together (8%) would reach into it.
  return Math.min(motion.punch, push);
}

const PUNCH_IN = 0.1;
const PUNCH_OUT = 0.6;
const RING = 0.7;

/** The hero's punch, 0–1: in fast, out slowly. `dt` is seconds since the hero phase. */
export function heroPunch(dt: number): number {
  if (dt <= 0 || dt >= PUNCH_OUT) return 0;
  return dt < PUNCH_IN
    ? easeOutCubic(dt / PUNCH_IN)
    : 1 - easeInOutCubic((dt - PUNCH_IN) / (PUNCH_OUT - PUNCH_IN));
}

/** The hero's flash (opacity) and its one ring (progress 0–1 and opacity), `dt` after the phase. */
export function heroAccent(dt: number): { flash: number; ring: number; ringOpacity: number } {
  const { seconds, opacity } = motion.flash;
  const peak = 0.04;
  const flash =
    dt < 0 || dt >= seconds
      ? 0
      : dt < peak
        ? (opacity * dt) / peak
        : opacity * (1 - (dt - peak) / (seconds - peak));
  if (dt < 0 || dt >= RING) return { flash, ring: 0, ringOpacity: 0 };
  const ring = easeOutCubic(dt / RING);
  return { flash, ring, ringOpacity: 0.9 * (1 - ring) };
}
