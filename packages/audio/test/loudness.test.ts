import { describe, expect, it } from 'vitest';
import {
  AUDIBLE,
  audibleSeconds,
  dbfs,
  integratedLoudness,
  kWeightingCoefficients,
  largestJump,
  loudnessJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  truePeak,
  weightedLevel,
} from '../src/loudness.ts';

const SR = 48_000;

/** A sine with peak `dbfs` (AES17: a full-scale sine is 0 dBFS). */
function sine(freq: number, seconds: number, peakDb: number, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const a = 10 ** (peakDb / 20);
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('K-weighting', () => {
  it('reproduces the 48 kHz coefficients tabled in BS.1770-4', () => {
    const { shelf, highpass } = kWeightingCoefficients(SR);
    const close = (got: number[], want: number[]) => {
      for (const [i, g] of got.entries()) expect(g).toBeCloseTo(want[i]!, 9);
    };
    close(shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]);
    close(shelf.a, [1, -1.69065929318241, 0.73248077421585]);
    close(highpass.b, [1, -2, 1]);
    close(highpass.a, [1, -1.99004745483398, 0.99007225036621]);
  });
});

describe('integrated loudness (EBU Tech 3341)', () => {
  it('reads a 1 kHz stereo sine at −23 dBFS per channel as −23.0 LUFS', () => {
    const x = sine(1000, 20, -23);
    expect(integratedLoudness([x, x], SR)).toBeCloseTo(-23, 1);
    expect(Math.abs(integratedLoudness([x, x], SR) + 23)).toBeLessThanOrEqual(0.1);
  });

  it('reads a 1 kHz stereo sine at −33 dBFS per channel as −33.0 LUFS', () => {
    const x = sine(1000, 20, -33);
    expect(Math.abs(integratedLoudness([x, x], SR) + 33)).toBeLessThanOrEqual(0.1);
  });

  it('gates quiet passages relative to the program (−36/−23/−36 dBFS, 10/60/10 s)', () => {
    const x = concat(sine(1000, 10, -36), sine(1000, 60, -23), sine(1000, 10, -36));
    expect(Math.abs(integratedLoudness([x, x], SR) + 23)).toBeLessThanOrEqual(0.1);
  });

  it('gates both ways (−72/−36/−23/−36/−72 dBFS, 10/10/60/10/10 s)', () => {
    const x = concat(
      sine(1000, 10, -72),
      sine(1000, 10, -36),
      sine(1000, 60, -23),
      sine(1000, 10, -36),
      sine(1000, 10, -72),
    );
    expect(Math.abs(integratedLoudness([x, x], SR) + 23)).toBeLessThanOrEqual(0.1);
  });

  it('ignores digital silence: more of it changes nothing', () => {
    const padded = (seconds: number) => {
      const x = concat(new Float32Array(seconds * SR), sine(1000, 10, -30), new Float32Array(SR));
      return integratedLoudness([x, x], SR);
    };
    // Blocks straddling the edges count, as BS.1770 says (ffmpeg's ebur128 reads −30.1 too).
    expect(padded(2)).toBeCloseTo(-30.12, 1);
    expect(padded(40)).toBeCloseTo(padded(2), 9);
  });

  it('sums channels: one channel of a stereo pair reads 3 dB quieter', () => {
    const x = sine(1000, 5, -20);
    expect(integratedLoudness([x], SR) - integratedLoudness([x, x], SR)).toBeCloseTo(-3.01, 1);
  });

  it('is −Infinity for silence and for audio shorter than one block', () => {
    expect(integratedLoudness([new Float32Array(SR)], SR)).toBe(Number.NEGATIVE_INFINITY);
    expect(integratedLoudness([sine(1000, 0.3, -10)], SR)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('audible music', () => {
  /** A sine of RMS `db` dBFS for `seconds`, on both channels. */
  const tone = (db: number, seconds: number) => {
    const n = Math.round(seconds * SR);
    const a = Math.SQRT2 * 10 ** (db / 20);
    return Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * 440 * i) / SR));
  };
  const join = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('counts quarter-second windows above −45 dBFS, before a moment', () => {
    expect(AUDIBLE).toEqual({ thresholdDbfs: -45, window: 0.25 });
    const music = join(tone(-30, 2), tone(-50, 1), tone(-20, 1));
    const stereo = [music, music];
    expect(audibleSeconds(stereo, SR, 4)).toBe(3);
    // Only the windows before the logo count.
    expect(audibleSeconds(stereo, SR, 3.5)).toBe(2.5);
    expect(audibleSeconds(stereo, SR, 1.1)).toBe(1);
    // A bed 20 dB under the voice is heard; music 40 dB under it is not.
    expect(audibleSeconds([tone(-36, 2), tone(-36, 2)], SR, 2)).toBe(2);
    expect(audibleSeconds([tone(-56, 2), tone(-56, 2)], SR, 2)).toBe(0);
  });
});

describe('true peak (4× oversampling)', () => {
  it('finds the peak between samples of a quarter-rate sine (EBU Tech 3341 case 16)', () => {
    // 12 kHz with a 45° phase: every sample sits 3 dB below the waveform's peak.
    const x = sine(SR / 4, 1, -6.02, Math.PI / 4);
    expect(dbfs(Math.max(...x.map(Math.abs)))).toBeCloseTo(-9.03, 1);
    const tp = truePeak([x, x], SR);
    expect(tp).toBeGreaterThanOrEqual(-6.02 - 0.4);
    expect(tp).toBeLessThanOrEqual(-6.02 + 0.2);
  });

  it('is never below the sample peak', () => {
    const x = sine(997, 1, -1, 0.3);
    expect(truePeak([x], SR)).toBeGreaterThanOrEqual(dbfs(Math.max(...x.map(Math.abs))) - 1e-9);
  });

  it('is −Infinity for silence', () => {
    expect(truePeak([new Float32Array(1000)], SR)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('measureLoudness and weightedLevel', () => {
  it('reports integrated loudness, true peak, and sample peak together', () => {
    const x = sine(1000, 5, -23);
    const m = measureLoudness([x, x], SR);
    expect(m.integrated).toBeCloseTo(-23, 1);
    expect(m.samplePeak).toBeCloseTo(-23, 2);
    expect(m.truePeak).toBeGreaterThanOrEqual(m.samplePeak - 1e-9);
  });

  it('measures K-weighted level over chosen windows only', () => {
    const x = concat(sine(1000, 2, -20), new Float32Array(2 * SR), sine(1000, 2, -40));
    const loud = weightedLevel([x, x], SR, [[0.5, 1.5]]);
    const quiet = weightedLevel([x, x], SR, [[4.5, 5.5]]);
    expect(loud - quiet).toBeCloseTo(20, 1);
    // Same scale as integrated loudness for a steady sine.
    expect(loud).toBeCloseTo(integratedLoudness([sine(1000, 2, -20), sine(1000, 2, -20)], SR), 1);
    // Between the sines only the filters' decaying tails remain.
    expect(weightedLevel([x, x], SR, [[2.2, 3.8]])).toBeLessThan(-150);
    expect(weightedLevel([x, x], SR, [])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('momentary loudness', () => {
  it("reads 400 ms windows every 100 ms, as ffmpeg's ebur128 M does", () => {
    const x = sine(1000, 2, -23);
    const m = momentaryLoudness([x, x], SR);
    // 20 steps of 100 ms, windows of 4 steps.
    expect(m.length).toBe(17);
    for (const v of m) expect(v).toBeCloseTo(-23, 1);
  });

  it('is −Infinity in digital silence', () => {
    const x = new Float32Array(SR);
    for (const v of momentaryLoudness([x, x], SR)) expect(v).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('loudness range (EBU Tech 3342)', () => {
  const lra = (...parts: Array<[number, number]>) => {
    const x = concat(...parts.map(([seconds, db]) => sine(1000, seconds, db)));
    return loudnessRange([x, x], SR)!;
  };

  it('reads the Tech 3342 test signals within ±1 LU', () => {
    expect(Math.abs(lra([20, -20], [20, -30]) - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([20, -20], [20, -15]) - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([20, -40], [20, -20]) - 20)).toBeLessThanOrEqual(1);
    // The −50 dBFS ends fall under the relative gate.
    expect(
      Math.abs(lra([20, -50], [20, -35], [20, -20], [20, -35], [20, -50]) - 15),
    ).toBeLessThanOrEqual(1);
  });

  it('measures only the windows inside a span, and nothing in silence or under 3 s', () => {
    const x = concat(
      sine(1000, 20, -50),
      sine(1000, 20, -35),
      sine(1000, 20, -20),
      sine(1000, 20, -35),
    );
    expect(Math.abs(loudnessRange([x, x], SR, [20, 80])! - 15)).toBeLessThanOrEqual(1);
    expect(loudnessRange([x, x], SR, [30, 32.5])).toBeUndefined();
    const silent = new Float32Array(5 * SR);
    expect(loudnessRange([silent, silent], SR)).toBeUndefined();
    const steady = sine(1000, 10, -20);
    expect(loudnessRange([steady, steady], SR)!).toBeLessThan(0.1);
  });
});

describe('loudness jumps', () => {
  const step = concat(sine(1000, 5, -20), sine(1000, 5, -30));

  it('finds a 10 dB step and when it is heard', () => {
    const jump = loudnessJump([step, step], SR)!;
    expect(jump.maxDb).toBeCloseTo(10, 0);
    expect(jump.at).toBeGreaterThanOrEqual(5);
    expect(jump.at).toBeLessThanOrEqual(5.6);
  });

  it('skips every window that touches an exempt window, open-ended ones too', () => {
    expect(loudnessJump([step, step], SR, { exempt: [[4.5, 5.5]] })!.maxDb).toBeLessThan(0.05);
    const around = loudnessJump([step, step], SR, {
      exempt: [
        [Number.NEGATIVE_INFINITY, 4],
        [6.5, Number.POSITIVE_INFINITY],
      ],
    })!;
    expect(around.maxDb).toBeCloseTo(10, 0);
  });

  it('measures a 5 dB-per-second fade as 5 dB within a second', () => {
    const x = new Float32Array(10 * SR);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const db = t < 4 ? -20 : t < 6 ? -20 - 5 * (t - 4) : -30;
      x[i] = 10 ** (db / 20) * Math.sin(2 * Math.PI * 1000 * t);
    }
    expect(loudnessJump([x, x], SR)!.maxDb).toBeCloseTo(5, 0);
  });

  it('counts silence as −70 LUFS, so a drop into silence is a finite jump', () => {
    const x = concat(sine(1000, 2, -20), new Float32Array(2 * SR));
    const jump = loudnessJump([x, x], SR)!;
    expect(Number.isFinite(jump.maxDb)).toBe(true);
    expect(jump.maxDb).toBeCloseTo(50, 0);
  });

  it('has nothing to report when fewer than two windows are clear', () => {
    const x = sine(1000, 2, -20);
    expect(loudnessJump([x, x], SR, { exempt: [[0, 2]] })).toBeUndefined();
    expect(largestJump(new Float64Array(0))).toBeUndefined();
  });
});
