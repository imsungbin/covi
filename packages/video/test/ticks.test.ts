import { tickTimes } from '@covi/audio';
import { describe, expect, it } from 'vitest';
import { countProgress, printedSteps, tickValue } from '../src/runtime/numbers.ts';

describe("a counter's ticks", () => {
  it('fall where the number drawn has taken each equal step of its count', () => {
    for (const seconds of [0.6, 1.6, 2.4, 4]) {
      const times = tickTimes(seconds);
      const steps = times.length - 1;
      for (const [k, t] of times.entries())
        expect(countProgress(5 + t, { t: 5, seconds }), `${seconds} s, tick ${k}`).toBeCloseTo(
          k / steps,
          9,
        );
    }
  });

  it('come no more often than the number drawn changes', () => {
    const counts: Array<[number, number, number]> = [
      [0, 1, 0],
      [3, 0, 0],
      [0, 4, 0],
      [1.2, 1.5, 1],
      [28, 10, 0],
      [70406, 9907, 0],
    ];
    for (const [from, to, decimals] of counts) {
      const times = tickTimes(1.6, printedSteps(from, to, decimals));
      const shown = times.map((t) =>
        tickValue(from, to, countProgress(5 + t, { t: 5, seconds: 1.6 }), decimals),
      );
      // Every tick after the first shows a number the one before it did not.
      for (let k = 1; k < shown.length; k++)
        expect(shown[k], `${from} → ${to}, tick ${k}`).not.toBe(shown[k - 1]);
      expect(shown.at(-1)).toBe(to);
    }
    expect(tickTimes(1.6, printedSteps(0, 1, 0))).toHaveLength(2);
    expect(tickTimes(1.6, printedSteps(70406, 9907, 0))).toHaveLength(10);
  });
});
