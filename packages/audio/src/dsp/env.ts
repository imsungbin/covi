/*
 * Envelopes. Attacks are linear from exactly 0; decays and releases are exponential curves that
 * land exactly on their target, so nothing ends with a step (no clicks).
 */

export interface Adsr {
  a: number;
  d: number;
  s: number;
  r: number;
}

const K = 5;
const EK = Math.exp(-K);

/** 1 → 0 over x ∈ [0, 1] along an exponential curve that reaches exactly 0 at x = 1. */
export function expFall(x: number): number {
  if (x <= 0) return 1;
  if (x >= 1) return 0;
  return (Math.exp(-K * x) - EK) / (1 - EK);
}

/**
 * ADSR amplitude envelope for a note held `gate` seconds, including the release tail:
 * length = round((gate + r) · sr). Linear attack, exponential decay to `s` and release to 0.
 */
export function adsr(env: Adsr, gate: number, sr: number): Float32Array {
  const g = Math.max(0, gate);
  const n = Math.max(1, Math.round((g + env.r) * sr));
  const out = new Float32Array(n);
  const aN = Math.max(1, env.a * sr);
  const dN = Math.max(1, env.d * sr);
  const rN = Math.max(1, env.r * sr);
  const s = Math.min(1, Math.max(0, env.s));
  const gN = Math.min(n, Math.round(g * sr));
  let i = 0;
  for (; i < gN && i < aN; i++) out[i] = i / aN;
  // Exponential segments by recursion (one multiply per sample): e = exp(−K·x), value ∝ e − e^−K.
  const span = (1 - s) / (1 - EK);
  let e = Math.exp((-K * (i - aN)) / dN);
  const gd = Math.exp(-K / dN);
  for (; i < gN; i++) {
    out[i] = e > EK ? s + span * (e - EK) : s;
    e *= gd;
  }
  const from = gN < aN ? gN / aN : e > EK ? s + span * (e - EK) : s;
  const spanR = from / (1 - EK);
  let r = 1;
  const gr = Math.exp(-K / rN);
  for (; i < n; i++) {
    out[i] = r > EK ? spanR * (r - EK) : 0;
    r *= gr;
  }
  return out;
}

/**
 * Attack–hold–decay one-shot envelope (SFX): linear rise over `a`, hold `h`, exponential fall
 * over `d`.
 */
export function ahd(a: number, h: number, d: number, sr: number, length?: number): Float32Array {
  const n = length ?? Math.max(1, Math.round((a + h + d) * sr));
  const out = new Float32Array(n);
  const aN = Math.max(1, a * sr);
  const hEnd = aN + h * sr;
  const dN = Math.max(1, d * sr);
  for (let i = 0; i < n; i++) {
    if (i < aN) out[i] = i / aN;
    else if (i < hEnd) out[i] = 1;
    else out[i] = expFall((i - hEnd) / dN);
  }
  return out;
}

/** Exponential decay reaching −60 dB after `t60` seconds (never exactly 0; pair with a fade). */
export function decayCoef(t60: number, sr: number): number {
  return 10 ** (-3 / (Math.max(1e-4, t60) * sr));
}

/**
 * Multiply `buf` by a gate: 1 until `gate` s, then an exponential release to 0 over `r` s
 * (then 0).
 */
export function applyRelease(buf: Float32Array, gate: number, r: number, sr: number): Float32Array {
  const gN = Math.max(0, Math.round(gate * sr));
  const rN = Math.max(1, r * sr);
  const span = 1 / (1 - EK);
  const gr = Math.exp(-K / rN);
  let e = 1;
  for (let i = gN; i < buf.length; i++) {
    buf[i]! *= e > EK ? span * (e - EK) : 0;
    e *= gr;
  }
  return buf;
}

/** Linear fade-in over the first `seconds`. */
export function fadeIn(buf: Float32Array, seconds: number, sr: number): Float32Array {
  const n = Math.min(buf.length, Math.max(1, Math.round(seconds * sr)));
  for (let i = 0; i < n; i++) buf[i]! *= i / n;
  return buf;
}

/** Linear fade-out over the last `seconds`, ending on exactly 0. */
export function fadeOut(buf: Float32Array, seconds: number, sr: number): Float32Array {
  const n = Math.min(buf.length, Math.max(1, Math.round(seconds * sr)));
  const start = buf.length - n;
  for (let i = 0; i < n; i++) buf[start + i]! *= 1 - (i + 1) / n;
  return buf;
}
