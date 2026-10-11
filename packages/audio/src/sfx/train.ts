/*
 * A counter's ticks: one tick for each equal step of its number, timed by the count's ease-out
 * (progress 1 − (1 − τ)³, as the video draws it), so they crowd as it starts and spread out as it
 * lands, the last on the landing. The train is one sound as long as the count: the effects place
 * or drop it whole, so density limits never thin out its ticks.
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
 * k/N of the way, for the most steps N (up to `TICK_STEPS`) whose first gap, the shortest, is at
 * least `TICK_GAP`. A count shorter than that gap is one tick.
 */
export function tickTimes(seconds: number): number[] {
  if (!(seconds >= TICK_GAP)) return [0];
  let steps = TICK_STEPS;
  while (steps > 1 && seconds * progressAt(1 / steps) < TICK_GAP - 1e-12) steps--;
  return Array.from({ length: steps + 1 }, (_, k) =>
    k === steps ? seconds : seconds * progressAt(k / steps),
  );
}

/**
 * The ticks of a count `seconds` long, as one stereo sound: `tick` (a rendered recipe) at each of
 * `tickTimes`. A tick longer than the gap would stack where two meet, so the train never peaks
 * above the tick itself.
 */
export function tickTrain(
  tick: Float32Array[],
  seconds: number,
  sampleRate: number,
): Float32Array[] {
  const offsets = tickTimes(seconds).map((t) => Math.round(t * sampleRate));
  const out = stereo(offsets.at(-1)! + tick[0]!.length);
  for (const offset of offsets) mixInto(out, tick, offset);
  const ceiling = peakAbs(tick);
  const peak = peakAbs(out);
  if (ceiling > 0 && peak > ceiling)
    for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= ceiling / peak;
  return out;
}
