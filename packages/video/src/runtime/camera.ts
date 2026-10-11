import { motion } from '@covi/brand';
import { type CameraPlan, PUNCH_OUT } from '../timeline/motion.ts';
import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from './anim.ts';

/*
 * The camera: a scene never holds still while its line is spoken. Its plan (`cameraPlan`, shared
 * with QC) says when it drifts, pushes in, and punches; these are the moves, pure functions of the
 * scene clock.
 */

export { type CameraPlan, cameraPlan } from '../timeline/motion.ts';

/** How far the camera has pushed in at `t` (0 = not at all; 0.02 = 2%). */
export function cameraPush(t: number, plan: CameraPlan): number {
  let push = 0;
  if (!plan.still) {
    if (plan.drift) push += motion.drift * easeInOutSine(seg(t, 0, plan.duration));
    else if (
      plan.speechEnd !== undefined &&
      plan.settled < Math.min(plan.speechEnd, plan.duration)
    ) {
      const k = seg(t, plan.settled, plan.duration);
      push += motion.linger * (plan.steady ? k : easeInOutSine(k));
    }
  }
  if (plan.hero !== undefined) push += motion.punch * heroPunch(t - plan.hero);
  // Never past the punch: at 6% the media region's content stays clear of the caption band in
  // every orientation, while drift and punch together (8%) would reach into it.
  return Math.min(motion.punch, push);
}

const PUNCH_IN = 0.1;
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
