/*
 * Phase-accumulating oscillators. Saw, square and pulse are band-limited with PolyBLEP; every
 * waveform is zero-mean so nothing downstream has to fight DC. Phase is in cycles, [0, 1).
 */

export type Wave = 'sine' | 'triangle' | 'saw' | 'square' | 'pulse';

const TWO_PI = 2 * Math.PI;

/**
 * Two-sample polynomial band-limited step residual (Välimäki). `t` = phase, `dt` = phase
 * increment.
 */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Band-limited pulse with duty `duty`, DC removed (mean 0, swing 2). */
export function pulseSample(phase: number, dt: number, duty: number): number {
  let v = phase < duty ? 1 : -1;
  v += polyBlep(phase, dt);
  let t2 = phase - duty;
  if (t2 < 0) t2 += 1;
  v -= polyBlep(t2, dt);
  return v + 1 - 2 * duty;
}

/** Triangle aligned with sine: 0 at phase 0, +1 at 0.25, −1 at 0.75. */
export function triangleSample(phase: number): number {
  if (phase < 0.25) return 4 * phase;
  if (phase < 0.75) return 2 - 4 * phase;
  return 4 * phase - 4;
}

/** One sample of `wave` at `phase` with phase increment `dt` (= freq / sr). */
export function waveSample(wave: Wave, phase: number, dt: number, duty = 0.5): number {
  switch (wave) {
    case 'sine':
      return Math.sin(TWO_PI * phase);
    case 'triangle':
      return triangleSample(phase);
    case 'saw':
      return 2 * phase - 1 - polyBlep(phase, dt);
    case 'square':
      return pulseSample(phase, dt, 0.5);
    case 'pulse':
      return pulseSample(phase, dt, duty);
  }
}

/** Streaming oscillator for per-sample modulation (vibrato, sweeps). */
export class Osc {
  wave: Wave;
  duty: number;
  phase: number;

  constructor(wave: Wave, phase = 0, duty = 0.5) {
    this.wave = wave;
    this.phase = phase - Math.floor(phase);
    this.duty = duty;
  }

  next(freq: number, sr: number): number {
    let dt = freq / sr;
    if (dt > 0.49) dt = 0.49;
    else if (dt < 0) dt = 0;
    const v = waveSample(this.wave, this.phase, dt, this.duty);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}

/**
 * Add `n` samples of a band-limited oscillator into L/R with gains gl/gr (the hot loop of the
 * subtractive voice; one specialised loop per waveform). `fm` optionally scales the frequency per
 * sample (vibrato). Returns the final phase.
 */
export function addOsc(
  L: Float32Array,
  R: Float32Array,
  n: number,
  wave: Wave,
  dt0: number,
  phase: number,
  gl: number,
  gr: number,
  duty = 0.5,
  fm: Float32Array | null = null,
): number {
  let ph = phase;
  if (wave === 'saw') {
    for (let i = 0; i < n; i++) {
      const dt = fm === null ? dt0 : dt0 * fm[i]!;
      let v = 2 * ph - 1;
      if (ph < dt) {
        const x = ph / dt;
        v -= x + x - x * x - 1;
      } else if (ph > 1 - dt) {
        const x = (ph - 1) / dt;
        v -= x * x + x + x + 1;
      }
      L[i]! += v * gl;
      R[i]! += v * gr;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  } else if (wave === 'square' || wave === 'pulse') {
    const d = wave === 'square' ? 0.5 : duty;
    const dc = 1 - 2 * d;
    for (let i = 0; i < n; i++) {
      const dt = fm === null ? dt0 : dt0 * fm[i]!;
      let v = (ph < d ? 1 : -1) + dc;
      if (ph < dt) {
        const x = ph / dt;
        v += x + x - x * x - 1;
      } else if (ph > 1 - dt) {
        const x = (ph - 1) / dt;
        v += x * x + x + x + 1;
      }
      let t2 = ph - d;
      if (t2 < 0) t2 += 1;
      if (t2 < dt) {
        const x = t2 / dt;
        v -= x + x - x * x - 1;
      } else if (t2 > 1 - dt) {
        const x = (t2 - 1) / dt;
        v -= x * x + x + x + 1;
      }
      L[i]! += v * gl;
      R[i]! += v * gr;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  } else if (wave === 'triangle') {
    for (let i = 0; i < n; i++) {
      const dt = fm === null ? dt0 : dt0 * fm[i]!;
      const v = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
      L[i]! += v * gl;
      R[i]! += v * gr;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const dt = fm === null ? dt0 : dt0 * fm[i]!;
      const v = Math.sin(TWO_PI * ph);
      L[i]! += v * gl;
      R[i]! += v * gr;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  }
  return ph;
}

export interface OscOptions {
  duty?: number;
  /** Start phase in cycles. */
  phase?: number;
}

/** Render `seconds` of a fixed-frequency waveform. */
export function oscillator(
  wave: Wave,
  freq: number,
  seconds: number,
  sr: number,
  opts: OscOptions = {},
): Float32Array {
  const out = new Float32Array(Math.max(0, Math.round(seconds * sr)));
  const osc = new Osc(wave, opts.phase ?? 0, opts.duty ?? 0.5);
  for (let i = 0; i < out.length; i++) out[i] = osc.next(freq, sr);
  return out;
}

export const sine = (freq: number, seconds: number, sr: number, phase = 0) =>
  oscillator('sine', freq, seconds, sr, { phase });
export const triangle = (freq: number, seconds: number, sr: number, phase = 0) =>
  oscillator('triangle', freq, seconds, sr, { phase });
export const saw = (freq: number, seconds: number, sr: number, phase = 0) =>
  oscillator('saw', freq, seconds, sr, { phase });
export const square = (freq: number, seconds: number, sr: number, phase = 0) =>
  oscillator('square', freq, seconds, sr, { phase });
export const pulse = (freq: number, duty: number, seconds: number, sr: number, phase = 0) =>
  oscillator('pulse', freq, seconds, sr, { duty, phase });
