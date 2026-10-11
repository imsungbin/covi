/*
 * A counter's ticks: one tick for each equal step of its number, timed by the count's ease-out
 * (progress 1 − (1 − τ)³, as the video draws it), so they crowd as it starts and spread out as it
 * lands, the last on the landing. A number that changes fewer times than that ticks only as often
 * as it changes. The train is one sound as long as the count: the effects place or drop it whole,
 * so density limits never thin out its ticks.
 */
import { mixInto, peakAbs, stereo } from '../dsp/fx.ts';

/** The fewest seconds between two ticks: closer, they blur into a buzz. */
export const TICK_GAP = 0.06;
/** At most this many steps in a count, so at most one more tick. */
export const TICK_STEPS = 12;

/** The share of a count's time at which its eased progress reaches `p`. */
const progressAt = (p: number) => 1 - Math.cbrt(1 - p);

/**
 * When a count's ticks sound, in seconds from its start: at 0 and wherever its number has come
 * k/N of the way, for the most steps N (up to `TICK_STEPS`, and up to the `steps` its printed
 * number takes) whose first gap, the shortest, is at least `TICK_GAP`. A count shorter than that
 * gap, without a length, or whose number never changes is one tick.
 */
export function tickTimes(seconds: number, steps = TICK_STEPS): number[] {
  if (!(Number.isFinite(seconds) && seconds >= TICK_GAP)) return [0];
  let n = Number.isNaN(steps) ? TICK_STEPS : Math.min(TICK_STEPS, Math.max(0, Math.floor(steps)));
  if (n === 0) return [0];
  while (n > 1 && seconds * progressAt(1 / n) < TICK_GAP - 1e-12) n--;
  return Array.from({ length: n + 1 }, (_, k) => (k === n ? seconds : seconds * progressAt(k / n)));
}

/**
 * A placed counter: how long it counts (s; without, a single tick), how many times its printed
 * number changes, and whether it is tied to the counter before it, which lands as it starts.
 */
export interface TickCount {
  seconds?: number;
  steps?: number;
  tied?: boolean;
}

/**
 * The ticks a placed counter plays, in seconds from its start: `tickTimes`, without the opening
 * tick of a tied count, where the counter before it has just played its last.
 */
export function countTicks(count: TickCount): number[] {
  const times = tickTimes(count.seconds ?? 0, count.steps);
  return count.tied ? times.slice(1) : times;
}

/**
 * A counter's ticks as one stereo sound from its start: `tick` (a rendered recipe) at each of
 * `countTicks`. A tick longer than the gap would stack where two meet, so the train never peaks
 * above the tick itself.
 */
export function tickTrain(
  tick: Float32Array[],
  count: TickCount,
  sampleRate: number,
): Float32Array[] {
  const offsets = countTicks(count).map((t) => Math.round(t * sampleRate));
  // As long as the count plus a tick, whichever of its ticks it plays.
  const last = tickTimes(count.seconds ?? 0).at(-1)!;
  const out = stereo(Math.round(last * sampleRate) + tick[0]!.length);
  for (const offset of offsets) mixInto(out, tick, offset);
  const ceiling = peakAbs(tick);
  const peak = peakAbs(out);
  if (ceiling > 0 && peak > ceiling) {
    const gain = ceiling / peak;
    for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= gain;
  }
  return out;
}
