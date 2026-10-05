import type { Rng } from './prng.ts';

export interface KsParams {
  /** 0 = bright, long-ringing string; 1 = dull, muted string (loop-filter high-frequency loss). */
  damping: number;
  /** 0 = soft, dark pluck (felt/finger); 1 = hard, bright pick (excitation lowpass). */
  brightness: number;
  /** Pluck position along the string, 0..0.5 (comb-filters the excitation). */
  pluckPos: number;
  /** Optional T60 of the fundamental in seconds; default derived from `damping`. */
  decay?: number;
}

/**
 * Extended Karplus–Strong plucked string: a noise burst shaped by pluck position and brightness
 * circulates through a delay line with a one-zero damping filter and an allpass fractional delay,
 * so the pitch is accurate at any frequency. Output is DC-free with a peak near 1.
 */
export function karplusStrong(
  freq: number,
  dur: number,
  p: KsParams,
  sr: number,
  rng: Rng,
): Float32Array {
  const n = Math.max(1, Math.round(dur * sr));
  const out = new Float32Array(n);
  const period = sr / Math.max(20, Math.min(freq, sr / 4));
  const damping = Math.min(1, Math.max(0, p.damping));
  const S = 0.06 + 0.44 * damping; // one-zero weight: phase delay ≈ S samples
  let N = Math.floor(period - S - 0.15);
  if (N < 2) N = 2;
  const frac = Math.max(0.05, period - S - N);
  const c = (1 - frac) / (1 + frac); // first-order allpass for the fractional part
  const t60 = p.decay ?? 3.2 * 0.08 ** damping; // 3.2 s (bright) … 0.26 s (muted)
  const w0 = (2 * Math.PI) / period;
  const hMag = Math.sqrt((1 - S) * (1 - S) + S * S + 2 * S * (1 - S) * Math.cos(w0));
  const perPeriod = 10 ** (-3 / (freq * Math.max(0.02, t60)));
  const rho = Math.min(0.99995, perPeriod / Math.max(hMag, 1e-6));

  // Excitation: one period of the initial string shape — a triangle peaked at the pluck position
  // (harmonics fall as 1/n², so the fundamental leads) plus brightness-scaled noise for a lively,
  // slightly different pluck every time — lowpassed by brightness, DC removed, peak-normalised.
  const brightness = Math.min(1, Math.max(0, p.brightness));
  const exc = new Float32Array(N);
  const M = Math.min(N - 1, Math.max(1, Math.round(Math.min(0.5, Math.max(0.02, p.pluckPos)) * N)));
  const noiseAmt = 0.15 + 0.35 * brightness;
  for (let i = 0; i < N; i++) {
    const shape = i < M ? i / M : (N - i) / (N - M);
    exc[i] = (1 - noiseAmt) * shape + noiseAmt * (rng() * 2 - 1);
  }
  const cutoff = Math.min(0.45 * sr, freq * (1.5 + 30 * brightness * brightness) + 200);
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
  let lp = exc[N - 1]!;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      lp += a * (exc[i]! - lp);
      exc[i] = lp;
    }
  }
  let mean = 0;
  for (let i = 0; i < N; i++) mean += exc[i]!;
  mean /= N;
  let peak = 1e-9;
  for (let i = 0; i < N; i++) {
    exc[i]! -= mean;
    peak = Math.max(peak, Math.abs(exc[i]!));
  }
  for (let i = 0; i < N; i++) exc[i]! /= peak;

  const line = new Float32Array(N);
  let idx = 0;
  let prev = 0;
  let apX1 = 0;
  let apY1 = 0;
  for (let i = 0; i < n; i++) {
    const delayed = line[idx]!;
    const lpv = (1 - S) * delayed + S * prev;
    prev = delayed;
    let ap = c * lpv + apX1 - c * apY1;
    if (ap < 1e-25 && ap > -1e-25) ap = 0;
    apX1 = lpv;
    apY1 = ap;
    const y = (i < N ? exc[i]! : 0) + rho * ap;
    line[idx] = y;
    if (++idx === N) idx = 0;
    out[i] = y;
  }
  // Remove any residual DC the loop accumulated.
  let x1 = 0;
  let y1 = 0;
  const R = 1 - (2 * Math.PI * 10) / sr;
  for (let i = 0; i < n; i++) {
    const y = out[i]! - x1 + R * y1;
    x1 = out[i]!;
    y1 = y;
    out[i] = y;
  }
  return out;
}
