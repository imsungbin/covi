import { type Adsr, adsr } from './env.ts';

export interface Fm2Params {
  /** Modulator frequency ratio to the note frequency. */
  ratio: number;
  /** Peak modulation index (radians of phase deviation). */
  index: number;
  /** Time constant (s) of the index decay toward `indexSustain · index`. */
  indexDecay: number;
  /** Fraction of the index kept after the decay (0..1), default 0. */
  indexSustain?: number;
  /** Modulator self-feedback (0..1.5), default 0. */
  feedback?: number;
  /** Carrier frequency ratio, default 1. */
  carrier?: number;
}

const TWO_PI = 2 * Math.PI;

/**
 * Two-operator FM: a sine modulator (with optional feedback) phase-modulates a sine carrier. The
 * output follows `env` — an ADSR (gate = `dur`, length (dur + r)·sr) or a precomputed amplitude
 * array (output length = its length). The index is capped so sidebands stay below Nyquist.
 */
export function fm2(
  freq: number,
  dur: number,
  p: Fm2Params,
  env: Adsr | Float32Array,
  sr: number,
): Float32Array {
  const amp = env instanceof Float32Array ? env : adsr(env, dur, sr);
  const n = amp.length;
  const out = new Float32Array(n);
  const fc = freq * (p.carrier ?? 1);
  if (fc >= 0.45 * sr) return out; // carrier above the usable band: silent
  const fmod = freq * p.ratio;
  const maxIndex = Math.max(0, (0.45 * sr - fc) / Math.max(fmod, 1) - 1.5);
  const peakIndex = Math.min(p.index, maxIndex);
  const floor = peakIndex * Math.min(1, Math.max(0, p.indexSustain ?? 0));
  const coef = Math.exp(-1 / (Math.max(1e-4, p.indexDecay) * sr));
  const fb = p.feedback ?? 0;
  const dc = fc / sr;
  const dm = fmod / sr;
  let pc = 0;
  let pm = 0;
  let idx = peakIndex;
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < n; i++) {
    const mod = Math.sin(TWO_PI * pm + fb * 0.5 * (m1 + m2));
    m2 = m1;
    m1 = mod;
    out[i] = Math.sin(TWO_PI * pc + idx * mod) * amp[i]!;
    pc += dc;
    if (pc >= 1) pc -= 1;
    pm += dm;
    if (pm >= 1) pm -= 1;
    idx = floor + (idx - floor) * coef;
  }
  return out;
}
