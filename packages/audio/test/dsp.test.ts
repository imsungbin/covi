import { describe, expect, it } from 'vitest';
import { adsr } from '../src/dsp/env.ts';
import { Biquad, Svf } from '../src/dsp/filter.ts';
import { fm2 } from '../src/dsp/fm.ts';
import {
  chorus,
  compressor,
  delay,
  glueCompressor,
  limiter,
  reverb,
  softClip,
  voiceCarve,
} from '../src/dsp/fx.ts';
import { karplusStrong } from '../src/dsp/ks.ts';
import { modal } from '../src/dsp/modal.ts';
import { noise } from '../src/dsp/noise.ts';
import { oscillator, sine } from '../src/dsp/osc.ts';
import { mulberry32 } from '../src/dsp/prng.ts';
import { hashOf } from '../src/hash.ts';

const SR = 48000;

/** `n` samples of `buf` from `start` under a Hann window. */
function hann(buf: Float32Array, start: number, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++)
    out[i] = buf[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  return out;
}

/** DFT magnitude of `x` at frequency `f` (Goertzel: exact at any frequency, not only bins). */
function dftMag(x: Float64Array, sr: number, f: number): number {
  const c = 2 * Math.cos((2 * Math.PI * f) / sr);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i]! + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
}

/** Dominant frequency: a scan over DFT bins up to 8 kHz, refined in 0.5 Hz steps around the peak. */
function dominantFreq(buf: Float32Array, sr: number, start = Math.round(0.05 * sr), n = 4096) {
  const x = hann(buf, start, n);
  const bin = sr / n;
  let best = 0;
  let bestF = 0;
  for (let k = 2; k * bin < 8000; k++) {
    const m = dftMag(x, sr, k * bin);
    if (m > best) [best, bestF] = [m, k * bin];
  }
  for (let f = bestF - bin; f <= bestF + bin; f += 0.5) {
    const m = dftMag(x, sr, f);
    if (m > best) [best, bestF] = [m, f];
  }
  return bestF;
}

function tone(freq: number, seconds: number, amp = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

function rmsOf(buf: Float32Array, from = 0, to = buf.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

function peakOf(buf: Float32Array): number {
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return p;
}

function allFinite(...bufs: Float32Array[]): boolean {
  return bufs.every((b) => b.every((v) => Number.isFinite(v)));
}

/** Steady-state gain (dB) of a mono process applied to a sine at `freq`. */
function gainDb(process: (x: number) => number, freq: number): number {
  const x = tone(freq, 0.5);
  const y = x.map(process);
  const from = Math.round(0.25 * SR);
  return 20 * Math.log10(rmsOf(y, from) / rmsOf(x, from));
}

const within = (f: number, target: number, tol = 0.015) => Math.abs(f - target) / target <= tol;

describe('prng', () => {
  it('mulberry32 is seeded, deterministic and uniform in [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const xs = Array.from({ length: 10000 }, () => a());
    expect(Array.from({ length: 10000 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('oscillators', () => {
  it('render A4 with the dominant bin within 1.5% of 440 Hz', () => {
    expect(within(dominantFreq(sine(440, 0.5, SR), SR), 440)).toBe(true);
    for (const wave of ['triangle', 'saw', 'square', 'pulse'] as const) {
      const buf = oscillator(wave, 440, 0.5, SR, { duty: 0.25 });
      expect(within(dominantFreq(buf, SR), 440), wave).toBe(true);
      expect(peakOf(buf), wave).toBeLessThan(1.8);
    }
  });

  it('pulse waves are DC-free at every duty', () => {
    for (const duty of [0.125, 0.25, 0.5]) {
      const buf = oscillator('pulse', 400, 0.5, SR, { duty }); // 400 Hz: exactly 120 samples per period
      let mean = 0;
      for (let i = 0; i < 24000; i++) mean += buf[i]!;
      expect(Math.abs(mean / 24000), `duty ${duty}`).toBeLessThan(0.01);
    }
  });

  it('PolyBLEP saw aliases far less than a naive saw', () => {
    // Harmonic 27 of 1760 Hz (47 520 Hz) folds back to 480 Hz, where a band-limited saw has no energy.
    const f0 = 1760;
    const n = Math.round(0.5 * SR);
    const naive = new Float32Array(n);
    for (let i = 0; i < n; i++) naive[i] = 2 * (((f0 * i) / SR) % 1) - 1;
    const blep = oscillator('saw', f0, 0.5, SR);
    const rel = (buf: Float32Array) => {
      const x = hann(buf, 2400, 4096);
      return 20 * Math.log10(dftMag(x, SR, 480) / dftMag(x, SR, f0));
    };
    expect(rel(blep)).toBeLessThan(rel(naive) - 12);
  });
});

describe('noise', () => {
  const lag1 = (xs: number[]) => {
    let num = 0;
    let den = 0;
    for (let i = 1; i < xs.length; i++) {
      num += xs[i]! * xs[i - 1]!;
      den += xs[i]! * xs[i]!;
    }
    return num / den;
  };

  it('white noise is zero-mean in [-1, 1) and uncorrelated; pink noise is correlated', () => {
    const w = noise.white(mulberry32(1));
    const xs = Array.from({ length: 48000 }, () => w());
    expect(xs.every((x) => x >= -1 && x < 1)).toBe(true);
    expect(Math.abs(xs.reduce((s, x) => s + x, 0) / xs.length)).toBeLessThan(0.02);
    expect(Math.abs(lag1(xs))).toBeLessThan(0.05);
    const p = noise.pink(mulberry32(1));
    const ps = Array.from({ length: 48000 }, () => p());
    expect(ps.every((x) => Number.isFinite(x))).toBe(true);
    expect(lag1(ps)).toBeGreaterThan(0.3);
  });
});

describe('adsr', () => {
  it('has length (gate + r)·sr, starts at 0, peaks at 1, holds sustain and releases to 0', () => {
    const env = adsr({ a: 0.01, d: 0.1, s: 0.5, r: 0.2 }, 0.5, SR);
    expect(env.length).toBe(Math.round((0.5 + 0.2) * SR));
    expect(env[0]).toBe(0);
    expect(peakOf(env)).toBeGreaterThan(0.99);
    expect(peakOf(env)).toBeLessThanOrEqual(1);
    expect(env[Math.round(0.4 * SR)]).toBeCloseTo(0.5, 3);
    expect(env[env.length - 1]).toBeLessThan(1e-3);
    for (let i = Math.round(0.5 * SR) + 1; i < env.length; i++)
      expect(env[i]).toBeLessThanOrEqual(env[i - 1]!);
  });

  it('releases from the current level when the gate ends during the attack', () => {
    const env = adsr({ a: 0.2, d: 0.1, s: 0.8, r: 0.1 }, 0.05, SR);
    expect(env.length).toBe(Math.round(0.15 * SR));
    expect(peakOf(env)).toBeLessThan(0.3);
  });
});

describe('filters', () => {
  it('RBJ biquads: lowpass, highpass, bandpass and peaking responses', () => {
    const run = (make: () => Biquad, freq: number) => {
      const f = make();
      return gainDb((x) => f.process(x), freq);
    };
    const lp = () => new Biquad('lowpass', 1000, Math.SQRT1_2, SR);
    expect(run(lp, 100)).toBeGreaterThan(-0.5);
    expect(run(lp, 10000)).toBeLessThan(-30);
    const hp = () => new Biquad('highpass', 1000, Math.SQRT1_2, SR);
    expect(run(hp, 100)).toBeLessThan(-30);
    expect(run(hp, 10000)).toBeGreaterThan(-0.5);
    const bp = () => new Biquad('bandpass', 1000, 2, SR);
    expect(Math.abs(run(bp, 1000))).toBeLessThan(0.5);
    expect(run(bp, 100)).toBeLessThan(-15);
    const pk = () => new Biquad('peaking', 1000, 1, SR, 6);
    expect(run(pk, 1000)).toBeCloseTo(6, 0);
    const moved = new Biquad('lowpass', 1000, Math.SQRT1_2, SR);
    moved.setFreq(8000);
    expect(gainDb((x) => moved.process(x), 3000)).toBeGreaterThan(-1);
  });

  it('the state-variable filter lowpasses and stays stable while swept', () => {
    const f = new Svf(SR);
    f.set(500, Math.SQRT1_2);
    expect(gainDb((x) => f.lp(x), 8000)).toBeLessThan(-30);
    const g = new Svf(SR);
    const x = noise.white(mulberry32(3));
    let ok = true;
    for (let i = 0; i < SR; i++) {
      if (i % 16 === 0) g.set(100 * 2 ** (7 * Math.abs(Math.sin(i / 3000))), 4);
      if (!Number.isFinite(g.lp(x()))) ok = false;
    }
    expect(ok).toBe(true);
  });
});

describe('physical and FM voices', () => {
  it('Karplus-Strong is in tune, decays, and is deterministic per seed', () => {
    const params = { damping: 0.4, brightness: 0.6, pluckPos: 0.2 };
    const a = karplusStrong(440, 1.5, params, SR, mulberry32(5));
    const b = karplusStrong(440, 1.5, params, SR, mulberry32(5));
    expect(a.length).toBe(Math.round(1.5 * SR));
    expect(hashOf(a)).toBe(hashOf(b));
    expect(allFinite(a)).toBe(true);
    expect(within(dominantFreq(a, SR), 440)).toBe(true);
    expect(rmsOf(a, a.length - 4800)).toBeLessThan(rmsOf(a, 0, 4800) / 10);
    const low = karplusStrong(
      110,
      1,
      { damping: 0.3, brightness: 0.5, pluckPos: 0.15 },
      SR,
      mulberry32(5),
    );
    expect(within(dominantFreq(low, SR, 2400, 8192), 110)).toBe(true);
  });

  it('modal resonators ring at the partial frequencies and skip partials above Nyquist', () => {
    const partials = [
      { ratio: 1, gain: 1, decay: 1.2 },
      { ratio: 3.93, gain: 0.3, decay: 0.3 },
      { ratio: 200, gain: 0.5, decay: 0.2 },
    ];
    const m = modal(261.63, 1.5, partials, SR, { noise: 0.2, ms: 2 });
    expect(m.length).toBe(Math.round(1.5 * SR));
    expect(allFinite(m)).toBe(true);
    expect(within(dominantFreq(m, SR), 261.63)).toBe(true);
    expect(peakOf(m)).toBeLessThan(1.5);
    expect(hashOf(m)).toBe(hashOf(modal(261.63, 1.5, partials, SR, { noise: 0.2, ms: 2 })));
  });

  it('2-op FM follows its envelope and reduces to a sine at index 0', () => {
    const env = { a: 0.005, d: 0.2, s: 0.6, r: 0.3 };
    const y = fm2(440, 0.5, { ratio: 3.5, index: 3, indexDecay: 0.3, feedback: 0.2 }, env, SR);
    expect(y.length).toBe(Math.round(0.8 * SR));
    expect(allFinite(y)).toBe(true);
    expect(peakOf(y)).toBeLessThanOrEqual(1);
    const pure = fm2(440, 0.5, { ratio: 1, index: 0, indexDecay: 1 }, env, SR);
    expect(within(dominantFreq(pure, SR), 440)).toBe(true);
  });
});

describe('effects', () => {
  const impulse = (seconds: number) => {
    const l = new Float32Array(Math.round(seconds * SR));
    const r = new Float32Array(l.length);
    l[0] = 1;
    r[0] = 1;
    return [l, r];
  };

  it('delay repeats the input after `time` seconds', () => {
    const buf = delay(impulse(1), {
      time: 0.25,
      feedback: 0.5,
      mix: 1,
      lowpass: 20000,
      pingpong: false,
    });
    const L = buf[0]!;
    const at = Math.round(0.25 * SR);
    expect(peakOf(L.subarray(0, at - 10))).toBeLessThan(1e-6);
    expect(peakOf(L.subarray(at - 2, at + 40))).toBeGreaterThan(0.3);
    expect(peakOf(L.subarray(2 * at - 2, 2 * at + 60))).toBeGreaterThan(0.1);
  });

  it('chorus keeps level and stays finite', () => {
    const x = [tone(330, 1, 0.5), tone(330, 1, 0.5)];
    const before = rmsOf(x[0]!);
    const y = chorus(x, { depth: 0.5, rate: 0.8, mix: 0.5 });
    expect(allFinite(...y)).toBe(true);
    expect(Math.abs(20 * Math.log10(rmsOf(y[0]!, 4800) / before))).toBeLessThan(3);
  });

  it('freeverb produces a decaying stereo tail', () => {
    const [L, R] = reverb(impulse(4), { size: 0.6, damp: 0.5, mix: 1, width: 1 }) as [
      Float32Array,
      Float32Array,
    ];
    expect(allFinite(L, R)).toBe(true);
    const early = rmsOf(L, Math.round(0.1 * SR), Math.round(0.4 * SR));
    const late = rmsOf(L, Math.round(3.5 * SR), Math.round(4 * SR));
    expect(early).toBeGreaterThan(1e-4);
    expect(late).toBeLessThan(early / 30);
    let diff = 0;
    for (let i = 0; i < L.length; i++) diff += Math.abs(L[i]! - R[i]!);
    expect(diff).toBeGreaterThan(0);
  });

  it('compressor reduces loud material', () => {
    const x = [tone(200, 1), tone(200, 1)];
    const y = compressor(x, { threshold: -20, ratio: 4, attack: 0.005, release: 0.1, makeup: 0 });
    expect(20 * Math.log10(rmsOf(y[0]!, 24000) / Math.SQRT1_2)).toBeLessThan(-10);
  });

  it("compressor's output is pinned (it shares its gain computer with the glue)", () => {
    // Quiet, inside the knee, and well over: every branch of the knee, attack and release.
    const random = mulberry32(5);
    const swell = (i: number) => [0.02, 0.1, 0.25, 0.9, 0.3][Math.floor((5 * i) / SR)]!;
    const input = () => {
      const l = Float32Array.from({ length: SR }, (_, i) => swell(i) * Math.sin(i * 0.031));
      const r = Float32Array.from(l, (v) => v + 0.05 * (random() * 2 - 1));
      return [l, r];
    };
    const a = compressor(input(), { threshold: -18, ratio: 4, attack: 0.005, release: 0.08 });
    const b = compressor(input(), {
      threshold: -12,
      ratio: 2.5,
      attack: 0.02,
      release: 0.3,
      makeup: 3,
      knee: 10,
    });
    // A mismatch means the output changed (bump AUDIO_ENGINE_VERSION), or a new Node changed the
    // float math with fx.ts untouched (measure again before re-pinning).
    expect(hashOf(a[0]!, a[1]!, b[0]!, b[1]!)).toBe('d9ad428ce2352cd8');
  });

  it('lookahead limiter holds the ceiling and leaves quiet audio untouched', () => {
    const loud = [tone(100, 1, 2), tone(150, 1, 1.5)];
    const y = limiter(loud, -1);
    const ceiling = 10 ** (-1 / 20);
    expect(Math.max(peakOf(y[0]!), peakOf(y[1]!))).toBeLessThanOrEqual(ceiling + 1e-6);
    const quiet = [tone(100, 0.5, 0.5), tone(100, 0.5, 0.5)];
    const copy = quiet.map((c) => c.slice());
    limiter(quiet, -1);
    let maxDiff = 0;
    for (let i = 0; i < copy[0]!.length; i++)
      maxDiff = Math.max(maxDiff, Math.abs(copy[0]![i]! - quiet[0]![i]!));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('softClip is odd, near-linear for small input and bounded', () => {
    expect(softClip(0.1)).toBeCloseTo(0.1, 3);
    expect(softClip(-0.3)).toBeCloseTo(-softClip(0.3), 9);
    for (const x of [1, 2, 5, 50]) expect(Math.abs(softClip(x))).toBeLessThan(1);
    expect(softClip(2)).toBeGreaterThan(softClip(1));
  });
});

describe('the music bus', () => {
  it('glue takes a steady loud sine down by half its excess over the threshold', () => {
    // A sine at −10 dBFS peak has a mean square of −13 dB: 11 dB over −24, so 2:1 takes 5.5 dB.
    const x = [tone(1000, 2, 10 ** (-10 / 20)), tone(1000, 2, 10 ** (-10 / 20))];
    const before = rmsOf(x[0]!, SR, 2 * SR);
    glueCompressor(x, { sr: SR });
    expect(20 * Math.log10(rmsOf(x[0]!, SR, 2 * SR) / before)).toBeCloseTo(-5.5, 1);
  });

  it('glue leaves quiet passages exactly as they were', () => {
    const x = [tone(1000, 1, 0.01), tone(1000, 1, 0.01)]; // −40 dBFS
    const copy = x.map((c) => c.slice());
    glueCompressor(x, { sr: SR });
    expect(x).toEqual(copy);
  });

  it('glue is deterministic', () => {
    const noisy = () => {
      const random = mulberry32(3);
      const c = Float32Array.from({ length: SR }, () => 0.5 * (random() * 2 - 1));
      return [c, c.slice()];
    };
    const a = glueCompressor(noisy(), { sr: SR });
    const b = glueCompressor(noisy(), { sr: SR });
    expect(hashOf(a[0]!, a[1]!)).toBe(hashOf(b[0]!, b[1]!));
  });

  it('carves −6 dB at 2 kHz while ducked, about 1–4 kHz in all, and nothing at amount 0', () => {
    const carved = (freq: number, amount: number) => {
      const x = tone(freq, 0.5);
      const y = [x.slice()];
      voiceCarve(y, new Float32Array(x.length).fill(amount), { sr: SR });
      const from = Math.round(0.25 * SR);
      return 20 * Math.log10(rmsOf(y[0]!, from) / rmsOf(x, from));
    };
    expect(carved(2000, 1)).toBeCloseTo(-6.02, 1);
    expect(carved(1000, 1)).toBeLessThan(-1);
    expect(carved(4000, 1)).toBeLessThan(-1);
    expect(Math.abs(carved(150, 1))).toBeLessThan(0.2);
    expect(carved(8000, 1)).toBeGreaterThan(-1);
    expect(carved(2000, 0)).toBe(0);
  });
});
