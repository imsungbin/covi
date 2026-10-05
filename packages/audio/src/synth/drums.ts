/*
 * Synthesized drum voices. Each renders a one-shot at unit velocity with a peak around 0.8 and
 * returns [mono] or [left, right] (noise voices get decorrelated channels for width).
 */
import { fadeOut } from '../dsp/env.ts';
import { Biquad, OnePole } from '../dsp/filter.ts';
import { modal } from '../dsp/modal.ts';
import { noise } from '../dsp/noise.ts';
import { pulseSample } from '../dsp/osc.ts';
import type { Rng } from '../dsp/prng.ts';
import type { DrumPatch } from './patches.ts';

const TWO_PI = 2 * Math.PI;
/** 808-style inharmonic square partials for metallic voices (Hz at freq = 400). */
const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

const velAmp = (v: number) => Math.min(1, Math.max(0, v)) ** 1.3;

/** exp decay reaching −60 dB after `t60` seconds, evaluated at sample i. */
const decayAt = (i: number, t60: number, sr: number) =>
  Math.exp((-6.9 * i) / (Math.max(1e-3, t60) * sr));

function attackAt(i: number, attack: number, sr: number): number {
  const n = Math.max(1, attack * sr);
  return i < n ? i / n : 1;
}

function tanhDrive(buf: Float32Array, drive: number): void {
  if (drive <= 0) return;
  const k = 1 + 4 * drive;
  const norm = 1 / Math.tanh(k);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(k * buf[i]!) * norm;
}

function scale(buf: Float32Array, g: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  return buf;
}

/** Two noise channels sharing `1 − width` of their content. */
function noisePair(n: number, width: number, rng: Rng): [Float32Array, Float32Array] {
  const a = noise.white(rng);
  const b = noise.white(rng);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const w = Math.min(1, Math.max(0, width));
  const shared = Math.sqrt(1 - w * 0.5);
  const own = Math.sqrt(w * 0.5);
  for (let i = 0; i < n; i++) {
    const s = a();
    L[i] = s * shared + b() * own;
    R[i] = s * shared + b() * own;
  }
  return [L, R];
}

function metal(n: number, ratio: number, sr: number): Float32Array {
  const out = new Float32Array(n);
  for (const f of METAL) {
    const fr = f * ratio;
    const dt = Math.min(0.49, fr / sr);
    let ph = (f * 0.618) % 1;
    for (let i = 0; i < n; i++) {
      out[i]! += pulseSample(ph, dt, 0.5) / METAL.length;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  }
  return out;
}

function kick(p: DrumPatch, sr: number, rng: Rng): Float32Array {
  const f0 = p.freq ?? 120;
  const f1 = p.freqEnd ?? 48;
  const pd = p.pitchDecay ?? 0.04;
  const decay = p.decay ?? 0.4;
  const n = Math.round((decay + 0.02) * sr);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    out[i] = Math.sin(TWO_PI * ph) * decayAt(i, decay, sr) * attackAt(i, p.attack ?? 0.0008, sr);
  }
  const click = p.click ?? 0.15;
  if (click > 0) {
    const cn = Math.round(0.005 * sr);
    const lp = new OnePole(3500, sr);
    const w = noise.white(rng);
    for (let i = 0; i < cn; i++) {
      const e = attackAt(i, 0.0004, sr) * (1 - i / cn) ** 3;
      out[i]! += click * lp.lp(w()) * e * 2;
    }
  }
  tanhDrive(out, p.drive ?? 0.15);
  new Biquad('lowpass', p.lowpass ?? 4500, Math.SQRT1_2, sr).run(out);
  return scale(out, 0.82);
}

function tom(p: DrumPatch, sr: number, rng: Rng): Float32Array {
  const f0 = p.freq ?? 160;
  const f1 = p.freqEnd ?? f0 * 0.72;
  const out = kick(
    {
      ...p,
      freq: f0,
      freqEnd: f1,
      pitchDecay: p.pitchDecay ?? 0.08,
      decay: p.decay ?? 0.35,
      click: p.click ?? 0.05,
    },
    sr,
    rng,
  );
  const nl = p.noise ?? 0.06;
  if (nl > 0) {
    const w = noise.white(rng);
    const lp = new OnePole(2500, sr);
    for (let i = 0; i < out.length; i++)
      out[i]! += nl * lp.lp(w()) * decayAt(i, 0.08, sr) * attackAt(i, 0.001, sr);
  }
  return out;
}

function snare(p: DrumPatch, sr: number, rng: Rng): Float32Array[] {
  const f = p.freq ?? 185;
  const decay = p.decay ?? 0.18;
  const toneLvl = p.tone ?? 0.5;
  const noiseLvl = p.noise ?? 0.7;
  const n = Math.round((decay + 0.03) * sr);
  const [L, R] = noisePair(n, p.width ?? 0.3, rng);
  const hpL = new Biquad('highpass', p.color ?? 1800, 0.7, sr);
  const hpR = new Biquad('highpass', p.color ?? 1800, 0.7, sr);
  const lpL = new Biquad('lowpass', p.lowpass ?? 9000, Math.SQRT1_2, sr);
  const lpR = new Biquad('lowpass', p.lowpass ?? 9000, Math.SQRT1_2, sr);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const drop = 1 - 0.08 * (1 - Math.exp(-t / 0.02));
    p1 += (f * drop) / sr;
    p2 += (f * 1.62 * drop) / sr;
    const body = (Math.sin(TWO_PI * p1) + 0.6 * Math.sin(TWO_PI * p2)) / 1.6;
    const a = attackAt(i, p.attack ?? 0.0006, sr);
    const tone = toneLvl * body * decayAt(i, Math.min(decay, 0.14), sr) * a;
    const env = noiseLvl * decayAt(i, decay, sr) * a;
    L[i] = tone + lpL.process(hpL.process(L[i]!)) * env;
    R[i] = tone + lpR.process(hpR.process(R[i]!)) * env;
  }
  return [scale(L, 0.8), scale(R, 0.8)];
}

function clap(p: DrumPatch, sr: number, rng: Rng): Float32Array[] {
  const bursts = p.bursts ?? 3;
  const spacing = p.spacing ?? 0.011;
  const decay = p.decay ?? 0.2;
  const n = Math.round((bursts * spacing + decay + 0.03) * sr);
  const [L, R] = noisePair(n, p.width ?? 0.4, rng);
  const bpL = new Biquad('bandpass', p.color ?? 1300, p.q ?? 1.1, sr);
  const bpR = new Biquad('bandpass', p.color ?? 1300, p.q ?? 1.1, sr);
  const hpL = new Biquad('highpass', 450, Math.SQRT1_2, sr);
  const hpR = new Biquad('highpass', 450, Math.SQRT1_2, sr);
  const tailStart = (bursts - 1) * spacing * sr;
  for (let i = 0; i < n; i++) {
    let env = 0;
    for (let b = 0; b < bursts; b++) {
      const k = i - b * spacing * sr;
      if (k >= 0) env = Math.max(env, attackAt(k, 0.0004, sr) * Math.exp(-k / (0.0035 * sr)));
    }
    if (i >= tailStart)
      env = Math.max(
        env,
        0.55 * decayAt(i - tailStart, decay, sr) * attackAt(i - tailStart, 0.001, sr),
      );
    L[i] = hpL.process(bpL.process(L[i]!)) * env * 2.2;
    R[i] = hpR.process(bpR.process(R[i]!)) * env * 2.2;
  }
  return [L, R];
}

function hat(p: DrumPatch, sr: number, rng: Rng): Float32Array[] {
  const decay = p.decay ?? 0.06;
  const n = Math.round((decay + 0.02) * sr);
  const [L, R] = noisePair(n, p.width ?? 0.5, rng);
  const tone = p.tone ?? 0.3;
  const nl = p.noise ?? 0.8;
  const m = tone > 0 ? metal(n, (p.freq ?? 400) / 400, sr) : null;
  const color = p.color ?? 7500;
  const filters = [0, 1].map((): [Biquad, Biquad, Biquad] => [
    new Biquad('highpass', color, 0.8, sr),
    new Biquad('highpass', color * 0.8, 0.6, sr),
    new Biquad('lowpass', p.lowpass ?? 13000, Math.SQRT1_2, sr),
  ]);
  for (let i = 0; i < n; i++) {
    const env = decayAt(i, decay, sr) * attackAt(i, p.attack ?? 0.0005, sr);
    const mt = m ? m[i]! * tone : 0;
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? L : R;
      const [h1, h2, lp] = filters[c]!;
      ch[i] = lp.process(h2.process(h1.process(ch[i]! * nl + mt))) * env * 1.6;
    }
  }
  return [L, R];
}

function shaker(p: DrumPatch, sr: number, rng: Rng): Float32Array[] {
  const decay = p.decay ?? 0.08;
  const attack = p.attack ?? 0.012;
  const n = Math.round((attack + decay + 0.02) * sr);
  const [L, R] = noisePair(n, p.width ?? 0.6, rng);
  const filters = [0, 1].map((): [Biquad, Biquad, Biquad] => [
    new Biquad('bandpass', p.color ?? 5500, p.q ?? 1.2, sr),
    new Biquad('highpass', 2500, Math.SQRT1_2, sr),
    new Biquad('lowpass', p.lowpass ?? 11000, Math.SQRT1_2, sr),
  ]);
  const aN = Math.max(1, attack * sr);
  for (let i = 0; i < n; i++) {
    // Rounded swell into an exponential fall: the "swish" of grains.
    const rise = i < aN ? Math.sin((Math.PI / 2) * (i / aN)) ** 2 : 1;
    const env = rise * (i < aN ? 1 : decayAt(i - aN, decay, sr));
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? L : R;
      const [bp, hp, lp] = filters[c]!;
      ch[i] = lp.process(hp.process(bp.process(ch[i]!))) * env * 0.9;
    }
  }
  return [L, R];
}

function woodblock(p: DrumPatch, sr: number, rng: Rng): Float32Array {
  const f = p.freq ?? 950;
  const decay = p.decay ?? 0.09;
  const x = modal(
    f,
    decay * 1.3 + 0.01,
    [
      { ratio: 1, gain: 1, decay },
      { ratio: 1.58, gain: 0.3, decay: decay * 0.6 },
      { ratio: 2.35, gain: 0.18, decay: decay * 0.4 },
      { ratio: 3.46, gain: 0.08, decay: decay * 0.25 },
    ],
    sr,
    { noise: p.noise ?? 0.25, ms: 0.5, freq: 2600, q: 1 },
    rng,
  );
  if (p.lowpass) new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(x);
  return scale(x, 0.62);
}

function rim(p: DrumPatch, sr: number, rng: Rng): Float32Array {
  const f = p.freq ?? 1650;
  const decay = p.decay ?? 0.035;
  const x = modal(
    f,
    decay * 1.4 + 0.012,
    [
      { ratio: 1, gain: 1, decay },
      { ratio: 0.5, gain: 0.6, decay: decay * 1.2 },
      { ratio: 2.3, gain: 0.3, decay: decay * 0.5 },
    ],
    sr,
    { noise: p.noise ?? 0.6, ms: 0.25, freq: p.color ?? 3500, q: 0.9 },
    rng,
  );
  new Biquad('highpass', 300, Math.SQRT1_2, sr).run(x);
  if (p.lowpass) new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(x);
  return scale(x, 0.55);
}

function crash(p: DrumPatch, sr: number, rng: Rng): Float32Array[] {
  const decay = p.decay ?? 1.8;
  const attack = p.attack ?? 0.006;
  const n = Math.round((decay + attack + 0.05) * sr);
  const [L, R] = noisePair(n, p.width ?? 0.8, rng);
  const tone = p.tone ?? 0.25;
  const m = tone > 0 ? metal(n, (p.freq ?? 480) / 400, sr) : null;
  const color = p.color ?? 3500;
  const filters = [0, 1].map((): [Biquad, Biquad] => [
    new Biquad('highpass', color, 0.7, sr),
    new Biquad('lowpass', p.lowpass ?? 9500, Math.SQRT1_2, sr),
  ]);
  for (let i = 0; i < n; i++) {
    const a = attackAt(i, attack, sr);
    const env = a * (0.65 * decayAt(i, decay, sr) + 0.35 * decayAt(i, decay * 0.25, sr));
    const mt = m ? m[i]! * tone : 0;
    for (let c = 0; c < 2; c++) {
      const ch = c === 0 ? L : R;
      const [hp, lp] = filters[c]!;
      ch[i] = lp.process(hp.process(ch[i]! * (p.noise ?? 0.8) + mt)) * env * 1.1;
    }
  }
  return [L, R];
}

/** Render one drum hit; the result is scaled by velocity and ends on exactly 0. */
/** Seconds of audio `renderDrum` returns: each kind's decay and the margins it renders after it. */
export function drumSeconds(p: DrumPatch): number {
  switch (p.kind) {
    case 'kick':
      return (p.decay ?? 0.4) + 0.02;
    case 'tom':
      return (p.decay ?? 0.35) + 0.02;
    case 'snare':
      return (p.decay ?? 0.18) + 0.03;
    case 'clap':
      return (p.bursts ?? 3) * (p.spacing ?? 0.011) + (p.decay ?? 0.2) + 0.03;
    case 'hat':
      return (p.decay ?? 0.06) + 0.02;
    case 'shaker':
      return (p.attack ?? 0.012) + (p.decay ?? 0.08) + 0.02;
    case 'woodblock':
      return (p.decay ?? 0.09) * 1.3 + 0.01;
    case 'rim':
      return (p.decay ?? 0.035) * 1.4 + 0.012;
    case 'crash-soft':
      return (p.decay ?? 1.8) + (p.attack ?? 0.006) + 0.05;
  }
}

export function renderDrum(p: DrumPatch, velocity: number, sr: number, rng: Rng): Float32Array[] {
  let out: Float32Array[];
  switch (p.kind) {
    case 'kick':
      out = [kick(p, sr, rng)];
      break;
    case 'tom':
      out = [tom(p, sr, rng)];
      break;
    case 'snare':
      out = snare(p, sr, rng);
      break;
    case 'clap':
      out = clap(p, sr, rng);
      break;
    case 'hat':
      out = hat(p, sr, rng);
      break;
    case 'shaker':
      out = shaker(p, sr, rng);
      break;
    case 'woodblock':
      out = [woodblock(p, sr, rng)];
      break;
    case 'rim':
      out = [rim(p, sr, rng)];
      break;
    case 'crash-soft':
      out = crash(p, sr, rng);
      break;
  }
  const g = velAmp(velocity);
  for (const ch of out) {
    scale(ch, g);
    fadeOut(ch, 0.003, sr);
  }
  return out;
}
