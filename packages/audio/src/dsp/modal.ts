import { mulberry32, type Rng, seedFrom } from './prng.ts';

export interface ModalPartial {
  /** Frequency ratio to the fundamental. */
  ratio: number;
  /** Amplitude for an ideal (infinitely short) strike. */
  gain: number;
  /** T60 decay time in seconds. */
  decay: number;
}

export interface ModalStrike {
  /** Level of the broadband strike noise ("tock") added on top of the resonators. */
  noise: number;
  /** Mallet contact time in ms: longer = softer mallet, duller upper partials. */
  ms: number;
  /** Centre frequency of the strike noise (Hz), default 3000. */
  freq?: number;
  /** Bandwidth (Q) of the strike noise, default 0.8. */
  q?: number;
}

/**
 * Modal synthesis: a bank of two-pole resonators excited by a half-sine mallet pulse, plus an
 * optional short noise strike. Partials at or above 0.45·sr are skipped.
 */
export function modal(
  freq: number,
  dur: number,
  partials: ModalPartial[],
  sr: number,
  strike: ModalStrike,
  rng: Rng = mulberry32(seedFrom('modal', freq, dur)),
): Float32Array {
  const n = Math.max(1, Math.round(dur * sr));
  const out = new Float32Array(n);

  // Half-sine contact pulse with unit area; capped at 0.35 of the fundamental period so the
  // fundamental always speaks.
  const contact = Math.min(Math.max(strike.ms, 0.05) / 1000, 0.35 / Math.max(freq, 1));
  const M = Math.max(1, Math.round(contact * sr));
  const pulse = new Float64Array(M);
  let area = 0;
  for (let i = 0; i < M; i++) {
    pulse[i] = Math.sin((Math.PI * (i + 0.5)) / M);
    area += pulse[i]!;
  }
  for (let i = 0; i < M; i++) pulse[i]! /= area;

  for (const p of partials) {
    const f = freq * p.ratio;
    if (!(f > 0) || f >= 0.45 * sr || p.gain <= 0) continue;
    const w = (2 * Math.PI * f) / sr;
    const r = 10 ** (-3 / (Math.max(1e-3, p.decay) * sr));
    const b1 = 2 * r * Math.cos(w);
    const b2 = -r * r;
    const g = p.gain * Math.sin(w);
    const stop = Math.min(n, Math.ceil(Math.max(1e-3, p.decay) * 1.7 * sr) + M); // ≈ −100 dB
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < stop; i++) {
      const x = i < M ? pulse[i]! * g : 0;
      const y = x + b1 * y1 + b2 * y2;
      y2 = y1;
      y1 = y;
      out[i]! += y;
    }
  }

  if (strike.noise > 0) {
    const len = Math.min(n, Math.max(8, Math.round((contact * 2 + 0.006) * sr)));
    const fc = Math.min(strike.freq ?? 3000, 0.45 * sr);
    const w = (2 * Math.PI * fc) / sr;
    const alpha = Math.sin(w) / (2 * (strike.q ?? 0.8));
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const a1 = (-2 * Math.cos(w)) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const tau = len / 5;
    for (let i = 0; i < len; i++) {
      const x = rng() * 2 - 1;
      const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      const env = Math.min(1, i / Math.max(1, M)) * Math.exp(-i / tau);
      out[i]! += strike.noise * y * env;
    }
  }
  return out;
}
