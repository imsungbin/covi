import { tickTimes } from '@covi/audio';
import { describe, expect, it } from 'vitest';
import { countProgress } from '../src/runtime/numbers.ts';

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
});
