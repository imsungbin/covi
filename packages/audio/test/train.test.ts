import { describe, expect, it } from 'vitest';
import { peakAbs, stereo } from '../src/dsp/fx.ts';
import { countTicks, TICK_GAP, TICK_STEPS, tickTimes, tickTrain } from '../src/sfx/train.ts';

const SR = 48_000;
/** Progress of an ease-out cubic count at `t` of `seconds`, as the video draws a counter. */
const progress = (t: number, seconds: number) => 1 - (1 - t / seconds) ** 3;

describe('tickTimes', () => {
  it('ticks at the start and at every equal step of the number, the last on the landing', () => {
    const times = tickTimes(1.6);
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(1.6);
    for (const [k, t] of times.entries()) expect(progress(t, 1.6)).toBeCloseTo(k / 9, 9);
    expect(times[1]).toBeCloseTo(0.0616, 4);
    expect(times[8]).toBeCloseTo(0.8308, 4);
  });

  it('crowds the ticks as the count starts and spreads them as it lands', () => {
    const gaps = tickTimes(1.6).flatMap((t, k, all) => (k ? [t - all[k - 1]!] : []));
    for (let k = 1; k < gaps.length; k++) expect(gaps[k]!).toBeGreaterThan(gaps[k - 1]!);
    expect(gaps[0]!).toBeGreaterThanOrEqual(TICK_GAP - 1e-9);
  });

  it('keeps a long count to thirteen ticks and a short one to a few, never closer than the gap', () => {
    expect(TICK_STEPS).toBe(12);
    expect(tickTimes(4)).toHaveLength(13);
    expect(tickTimes(0.6)).toHaveLength(4);
    expect(tickTimes(0.1)).toEqual([0, 0.1]);
    for (const seconds of [0.06, 0.1, 0.35, 0.6, 1.6, 2.4, 4, 30]) {
      const times = tickTimes(seconds);
      expect(times.length, `${seconds}`).toBeLessThanOrEqual(TICK_STEPS + 1);
      expect(times.at(-1)).toBe(seconds);
      for (let k = 1; k < times.length; k++)
        expect(times[k]! - times[k - 1]!, `${seconds}`).toBeGreaterThanOrEqual(TICK_GAP - 1e-9);
    }
  });

  it('plays a count shorter than the gap, or one with no length, as a single tick', () => {
    expect(tickTimes(0.05)).toEqual([0]);
    expect(tickTimes(0)).toEqual([0]);
    expect(tickTimes(Number.NaN)).toEqual([0]);
    expect(tickTimes(Number.POSITIVE_INFINITY)).toEqual([0]);
    expect(tickTimes(Number.NEGATIVE_INFINITY)).toEqual([0]);
  });

  it('ticks no more often than the number on screen changes', () => {
    // A count-up from 0 to 1 ticks as it starts and as it lands.
    expect(tickTimes(1.6, 1)).toEqual([0, 1.6]);
    const three = tickTimes(1.6, 3);
    expect(three).toHaveLength(4);
    for (const [k, t] of three.entries()) expect(progress(t, 1.6)).toBeCloseTo(k / 3, 9);
    // A number that never changes ticks once; one with many steps keeps the gap's ticks.
    expect(tickTimes(1.6, 0)).toEqual([0]);
    expect(tickTimes(1.6, 1000)).toEqual(tickTimes(1.6));
    expect(tickTimes(1.6, 1000)).toHaveLength(10);
    expect(tickTimes(0.6, 2)).toHaveLength(3);
    expect(tickTimes(1.6, Number.NaN)).toEqual(tickTimes(1.6));
  });
});

describe('countTicks', () => {
  it("leaves out a tied count's opening tick, which the counter before it has just played", () => {
    expect(countTicks({ seconds: 1.6, steps: 1 })).toEqual([0, 1.6]);
    expect(countTicks({ seconds: 1.6, steps: 1, tied: true })).toEqual([1.6]);
    expect(countTicks({ seconds: 1.6, tied: true })).toEqual(tickTimes(1.6).slice(1));
  });
});

describe('tickTrain', () => {
  const tick = () => {
    const t = stereo(Math.round(0.05 * SR));
    for (let i = 0; i < t[0]!.length; i++) t[0]![i] = t[1]![i] = 0.7 * Math.exp(-i / 200);
    return t;
  };

  it('lays one tick at each tick time, as long as the count plus a tick', () => {
    const train = tickTrain(tick(), { seconds: 1.6 }, SR);
    expect(train).toHaveLength(2);
    expect(train[0]!.length).toBe(Math.round(1.6 * SR) + Math.round(0.05 * SR));
    for (const t of tickTimes(1.6)) expect(train[0]![Math.round(t * SR)]).toBeCloseTo(0.7, 5);
    // Silence between the last two ticks, after the one before the landing has died away.
    expect(peakAbs([train[0]!.subarray(Math.round(0.95 * SR), Math.round(1.55 * SR))])).toBe(0);
  });

  it('never peaks above the tick, even when ticks overlap', () => {
    const long = stereo(Math.round(0.3 * SR)).map((c) => c.fill(0.5));
    const train = tickTrain(long, { seconds: 1.6 }, SR);
    expect(peakAbs(train)).toBeCloseTo(0.5, 6);
  });

  it('plays only the ticks the number takes, silent where a tied count would open', () => {
    const one = tickTrain(tick(), { seconds: 1.6, steps: 1 }, SR);
    expect(one[0]![0]).toBeCloseTo(0.7, 5);
    expect(one[0]![Math.round(1.6 * SR)]).toBeCloseTo(0.7, 5);
    expect(peakAbs([one[0]!.subarray(Math.round(0.1 * SR), Math.round(1.55 * SR))])).toBe(0);
    const tied = tickTrain(tick(), { seconds: 1.6, steps: 1, tied: true }, SR);
    expect(tied[0]!.length).toBe(one[0]!.length);
    expect(peakAbs([tied[0]!.subarray(0, Math.round(1.55 * SR))])).toBe(0);
    expect(tied[1]![Math.round(1.6 * SR)]).toBeCloseTo(0.7, 5);
  });

  it('is the same every time', () => {
    const a = tickTrain(tick(), { seconds: 2.4 }, SR);
    const b = tickTrain(tick(), { seconds: 2.4 }, SR);
    for (const c of [0, 1])
      expect(Buffer.from(a[c]!.buffer).equals(Buffer.from(b[c]!.buffer)), `channel ${c}`).toBe(
        true,
      );
  });
});
