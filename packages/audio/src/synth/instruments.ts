/*
 * Instrument voices: render one note of a patch as a stereo buffer that includes its release tail.
 * Every voice starts at exactly 0 (linear attack ≥ 2 ms) and ends at exactly 0 (release curve
 * plus a final 3 ms fade), so notes can be summed anywhere without clicks.
 */
import { type Adsr, adsr, applyRelease, decayCoef, fadeOut } from '../dsp/env.ts';
import { Biquad, Svf } from '../dsp/filter.ts';
import { fm2 } from '../dsp/fm.ts';
import { panGains } from '../dsp/fx.ts';
import { karplusStrong } from '../dsp/ks.ts';
import { modal } from '../dsp/modal.ts';
import { noise } from '../dsp/noise.ts';
import { addOsc } from '../dsp/osc.ts';
import type { Rng } from '../dsp/prng.ts';
import { drumSeconds, renderDrum } from './drums.ts';
import type {
  FmPatch,
  KsPatch,
  ModalPatch,
  Patch,
  SubtractivePatch,
  WindPatch,
} from './patches.ts';

export interface NoteSpec {
  midi: number;
  /** 0..1 */
  velocity: number;
  /** Gate length in seconds; the release tail is rendered after it. */
  duration: number;
}

const TWO_PI = 2 * Math.PI;
const CENT = Math.LN2 / 1200;
const MIN_ATTACK = 0.002;
const MIN_RELEASE = 0.008;
const EDGE_FADE = 0.003;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const freqOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** Velocity → amplitude (slightly expanded curve: 0.8 ≈ −2.5 dB, 0.35 ≈ −12 dB). */
export const velAmp = (v: number) => clamp(v, 0, 1) ** 1.3;

function safeAdsr(e: Adsr): Adsr {
  return {
    a: Math.max(MIN_ATTACK, e.a),
    d: Math.max(0.001, e.d),
    s: e.s,
    r: Math.max(MIN_RELEASE, e.r),
  };
}

/**
 * Frequency multiplier per sample for a delayed, faded-in sine vibrato; `lfo` is its normalised
 * depth·sin. Computed exactly every 32 samples and linearly interpolated (the LFO is ≤ 20 Hz).
 */
function vibratoCurve(
  v: { rate: number; depth: number; delay: number; fade: number },
  n: number,
  sr: number,
): { mul: Float32Array; lfo: Float32Array } {
  const mul = new Float32Array(n);
  const lfo = new Float32Array(n);
  const dN = v.delay * sr;
  const fN = Math.max(1, v.fade * sr);
  const w = (TWO_PI * v.rate) / sr;
  const lfoAt = (i: number) => (i < dN ? 0 : Math.min(1, (i - dN) / fN) * Math.sin(w * (i - dN)));
  const BLOCK = 32;
  let s0 = lfoAt(0);
  let m0 = Math.exp(v.depth * s0 * CENT);
  for (let i = 0; i < n; i += BLOCK) {
    const s1 = lfoAt(i + BLOCK);
    const m1 = Math.exp(v.depth * s1 * CENT);
    const end = Math.min(n, i + BLOCK);
    for (let j = i; j < end; j++) {
      const t = (j - i) / BLOCK;
      lfo[j] = s0 + (s1 - s0) * t;
      mul[j] = m0 + (m1 - m0) * t;
    }
    s0 = s1;
    m0 = m1;
  }
  return { mul, lfo };
}

function applyEdges(buf: Float32Array, sr: number): Float32Array {
  return fadeOut(buf, EDGE_FADE, sr);
}

/**
 * Post-oscillator chain fused into a single pass over one or two channels: swept filter
 * (coefficients every 16 samples) → gain/drive → highpass → amp envelope.
 */
function subtractiveChain(
  L: Float32Array,
  R: Float32Array | null,
  p: SubtractivePatch,
  env: Float32Array,
  fenv: Float32Array,
  midi: number,
  velocity: number,
  levelSum: number,
  sr: number,
): void {
  const n = L.length;
  const fl = p.filter;
  const keyOct = fl ? (fl.keytrack * (midi - 60)) / 12 : 0;
  const velOct = fl ? fl.velocity * (velocity - 0.8) : 0;
  const mode = fl ? (fl.type === 'lowpass' ? 0 : fl.type === 'highpass' ? 1 : 2) : -1;
  const fa = new Svf(sr);
  const fb = new Svf(sr);
  const hpa = p.highpass ? new Biquad('highpass', p.highpass, Math.SQRT1_2, sr) : null;
  const hpb = p.highpass ? new Biquad('highpass', p.highpass, Math.SQRT1_2, sr) : null;
  const g = (0.6 / Math.max(levelSum, 1e-6)) * velAmp(velocity);
  const k = p.drive > 0 ? 1 + 5 * p.drive : 0;
  const BLOCK = 16;
  for (let i = 0; i < n; i += BLOCK) {
    if (fl) {
      const e = i < fenv.length ? fenv[i]! : 0;
      const fc = clamp(fl.cutoff * 2 ** (keyOct + velOct + fl.env * e), 20, 0.45 * sr);
      fa.set(fc, fl.q);
      if (R) fb.set(fc, fl.q);
    }
    const end = Math.min(n, i + BLOCK);
    for (let j = i; j < end; j++) {
      let l = L[j]!;
      if (mode === 0) l = fa.lp(l);
      else if (mode === 1) l = fa.hp(l);
      else if (mode === 2) l = fa.bp(l);
      l *= g;
      if (k) l = Math.tanh(k * l) / k;
      if (hpa) l = hpa.process(l);
      const e = env[j]!;
      L[j] = l * e;
      if (R) {
        let r = R[j]!;
        if (mode === 0) r = fb.lp(r);
        else if (mode === 1) r = fb.hp(r);
        else if (mode === 2) r = fb.bp(r);
        r *= g;
        if (k) r = Math.tanh(k * r) / k;
        if (hpb) r = hpb.process(r);
        R[j] = r * e;
      }
    }
  }
  applyEdges(L, sr);
  if (R) applyEdges(R, sr);
}

function subtractive(p: SubtractivePatch, note: NoteSpec, sr: number, rng: Rng): Float32Array[] {
  const env = adsr(safeAdsr(p.amp), note.duration, sr);
  const n = env.length;
  const midi = note.midi + p.transpose;
  const f0 = freqOf(midi);
  const vib = p.vibrato ? vibratoCurve(p.vibrato, n, sr).mul : null;
  // Centred patches without noise are rendered once and duplicated (half the filter work).
  const mono = p.noise === 0 && p.oscs.every((o) => o.pan === 0);
  const L = new Float32Array(n);
  const R = mono ? L : new Float32Array(n);
  let levelSum = p.noise;
  for (const o of p.oscs) levelSum += o.level;
  for (const o of p.oscs) {
    const f = f0 * 2 ** (o.octave + o.semi / 12 + o.detune / 1200);
    if (f >= 0.45 * sr) continue;
    const [gl, gr]: [number, number] = mono ? [1, 0] : panGains(o.pan);
    addOsc(L, R, n, o.wave, Math.min(0.49, f / sr), rng(), gl * o.level, gr * o.level, o.duty, vib);
  }
  if (p.noise > 0) {
    const wl = noise.white(rng);
    const wr = noise.white(rng);
    for (let i = 0; i < n; i++) {
      L[i]! += wl() * p.noise;
      R[i]! += wr() * p.noise;
    }
  }
  const fenv = p.filter?.adsr ? adsr(safeAdsr(p.filter.adsr), note.duration, sr) : env;
  subtractiveChain(L, mono ? null : R, p, env, fenv, midi, note.velocity, levelSum, sr);
  return mono ? [L, L.slice()] : [L, R];
}

function pluck(p: KsPatch, note: NoteSpec, sr: number, rng: Rng): Float32Array[] {
  const midi = note.midi + p.transpose;
  const f0 = freqOf(midi);
  const t60 = p.decay * 2 ** ((-p.keyDecay * (midi - 60)) / 12);
  const r = Math.max(MIN_RELEASE, p.amp.r);
  const len = Math.min(note.duration + r, t60 * 1.3 + r);
  const vel = note.velocity;
  const brightness = clamp(p.brightness + 0.3 * (vel - 0.8), 0, 1);
  const x = karplusStrong(
    f0,
    len,
    { damping: p.damping, brightness, pluckPos: p.pluckPos, decay: t60 },
    sr,
    rng,
  );
  const n = x.length;
  if (p.attackSoft > 0) {
    const svf = new Svf(sr);
    const top = Math.min(0.45 * sr, 16000);
    const start = Math.min(top, Math.max(2 * f0, 700));
    const tau = Math.max(1, p.attackSoft * sr);
    for (let i = 0; i < n; i += 16) {
      svf.set(start * (top / start) ** (1 - Math.exp(-i / tau)), 0.6);
      const end = Math.min(n, i + 16);
      for (let j = i; j < end; j++) x[j] = svf.lp(x[j]!);
    }
  }
  for (const b of p.body) new Biquad('peaking', b.freq, b.q, sr, b.gain).run(x);
  if (p.lowpass) new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(x);
  const aN = Math.max(1, Math.max(MIN_ATTACK, p.amp.a) * sr);
  for (let i = 0; i < n && i < aN; i++) x[i]! *= i / aN;
  applyRelease(x, note.duration, r, sr);
  const g = 0.5 * velAmp(vel);
  for (let i = 0; i < n; i++) x[i]! *= g;
  return [applyEdges(x, sr)];
}

function mallet(p: ModalPatch, note: NoteSpec, sr: number, rng: Rng): Float32Array[] {
  const midi = note.midi + p.transpose;
  const f0 = p.fixedFreq ?? freqOf(midi);
  const oct = p.fixedFreq ? 0 : (midi - 60) / 12;
  const dScale = 2 ** (-p.keyDecay * oct);
  const vel = note.velocity;
  const hard = Math.max(0.05, vel / 0.8) ** p.hardness;
  let gainSum = 0;
  const partials = p.partials.map((q) => {
    gainSum += q.gain;
    const bright = q.ratio > 1.5 ? hard ** Math.log2(q.ratio) : 1;
    return { ratio: q.ratio, gain: q.gain * bright, decay: q.decay * dScale };
  });
  const maxDecay = Math.max(...partials.map((q) => q.decay));
  const r = Math.max(MIN_RELEASE, p.amp.r);
  const len = Math.min(note.duration + r, maxDecay * 1.25 + 0.02);
  const ms = p.strike.ms * Math.sqrt(0.8 / Math.max(0.3, vel));
  const x = modal(
    f0,
    len,
    partials,
    sr,
    { noise: p.strike.noise * vel, ms, freq: p.strike.freq, q: p.strike.q },
    rng,
  );
  if (p.lowpass) new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(x);
  applyRelease(x, note.duration, r, sr);
  const g = (0.7 / Math.max(gainSum, 1e-6)) * velAmp(vel);
  for (let i = 0; i < x.length; i++) x[i]! *= g;
  return [applyEdges(x, sr)];
}

function fmVoice(p: FmPatch, note: NoteSpec, sr: number): Float32Array[] {
  const midi = note.midi + p.transpose;
  const f0 = freqOf(midi);
  const ks = 2 ** ((-p.keyDecay * (midi - 60)) / 12);
  const env = adsr(
    safeAdsr({ a: p.amp.a, d: p.amp.d * ks, s: p.amp.s, r: p.amp.r * ks }),
    note.duration,
    sr,
  );
  const out = new Float32Array(env.length);
  const idxScale = Math.max(0.2, 1 + 1.5 * p.velocityIndex * (note.velocity - 0.8));
  let levels = 0;
  for (const op of p.ops) {
    levels += op.level;
    const y = fm2(
      f0 * 2 ** (op.detune / 1200),
      note.duration,
      {
        ratio: op.ratio,
        index: op.index * idxScale,
        indexDecay: op.indexDecay,
        indexSustain: op.indexSustain,
        feedback: op.feedback,
        carrier: op.carrier,
      },
      env,
      sr,
    );
    let g = op.level;
    const c = op.decay ? decayCoef(op.decay * ks, sr) : 1;
    for (let i = 0; i < y.length; i++) {
      out[i]! += y[i]! * g;
      g *= c;
    }
  }
  if (p.lowpass) new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(out);
  const g = (0.6 / Math.max(levels, 1e-6)) * velAmp(note.velocity);
  for (let i = 0; i < out.length; i++) out[i]! *= g;
  return [applyEdges(out, sr)];
}

function wind(p: WindPatch, note: NoteSpec, sr: number, rng: Rng): Float32Array[] {
  const midi = note.midi + p.transpose;
  const f0 = freqOf(midi);
  const env = adsr(safeAdsr(p.amp), note.duration, sr);
  const n = env.length;
  const out = new Float32Array(n);
  const vib = p.vibrato ? vibratoCurve(p.vibrato, n, sr) : null;
  const hs = p.harmonics;
  let hMax = 0;
  while (hMax < hs.length && (hMax + 1) * f0 < 0.45 * sr) hMax++;
  let hSum = 0;
  for (let k = 0; k < hMax; k++) hSum += hs[k]!;
  const scoopN = 0.07 * sr;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    let mul = vib ? vib.mul[i]! : 1;
    if (p.scoop > 0 && i < scoopN) {
      const u = 1 - i / scoopN;
      mul *= Math.exp(-p.scoop * u * u * CENT);
    }
    ph += (f0 * mul) / sr;
    if (ph >= 1) ph -= 1;
    // sin(kθ) by the Chebyshev recurrence: s(k+1) = 2cosθ·s(k) − s(k−1)
    const s1 = Math.sin(TWO_PI * ph);
    const c2 = 2 * Math.cos(TWO_PI * ph);
    let sPrev = 0;
    let sCur = s1;
    let s = 0;
    for (let k = 0; k < hMax; k++) {
      s += hs[k]! * sCur;
      const next = c2 * sCur - sPrev;
      sPrev = sCur;
      sCur = next;
    }
    let a = s / Math.max(hSum, 1e-6);
    if (vib && p.tremolo > 0) a *= 1 + p.tremolo * vib.lfo[i]!;
    out[i] = a;
  }
  // Breath: band-limited noise that follows the envelope, plus an attack "chiff".
  if (p.breath > 0 || p.chiff > 0) {
    const w = noise.white(rng);
    const band = new Svf(sr, clamp(f0 * 2, 400, 6000), 0.9);
    const chiffBand = new Svf(sr, clamp(f0 * 4, 1500, 9000), 1.2);
    const chiffTau = 0.03 * sr;
    for (let i = 0; i < n; i++) {
      const x = w();
      const b = band.bp(x) * p.breath;
      const c = i < chiffTau * 6 ? chiffBand.bp(x) * p.chiff * Math.exp(-i / chiffTau) * 1.5 : 0;
      out[i]! += b + c;
    }
  }
  new Biquad('lowpass', p.lowpass, Math.SQRT1_2, sr).run(out);
  new Biquad('highpass', Math.max(60, f0 * 0.5), Math.SQRT1_2, sr).run(out);
  const g = 0.55 * velAmp(note.velocity);
  for (let i = 0; i < n; i++) out[i]! *= env[i]! * g;
  return [applyEdges(out, sr)];
}

/**
 * Seconds of audio `renderNote` returns for a note: its gate and release, or, for plucks and
 * mallets, until it rings out. Low notes ring longer where a patch scales its decay by pitch.
 * Scheduling budgets rendering with it before anything is rendered.
 */
export function noteSeconds(patch: Patch, note: Pick<NoteSpec, 'midi' | 'duration'>): number {
  if (patch.algo === 'drum') return drumSeconds(patch);
  const gate = Math.max(0, note.duration);
  const midi = note.midi + patch.transpose;
  const r = Math.max(MIN_RELEASE, patch.amp.r);
  switch (patch.algo) {
    case 'subtractive':
    case 'wind':
      return gate + r;
    case 'fm':
      return (
        gate + Math.max(MIN_RELEASE, patch.amp.r * 2 ** ((-patch.keyDecay * (midi - 60)) / 12))
      );
    case 'ks':
      return Math.min(
        note.duration + r,
        patch.decay * 2 ** ((-patch.keyDecay * (midi - 60)) / 12) * 1.3 + r,
      );
    case 'modal': {
      const oct = patch.fixedFreq ? 0 : (midi - 60) / 12;
      const decay = Math.max(...patch.partials.map((q) => q.decay)) * 2 ** (-patch.keyDecay * oct);
      return Math.min(note.duration + r, decay * 1.25 + 0.02);
    }
  }
}

/** Render one note (stereo, release tail included) with the patch's gain and pan applied. */
export function renderNote(patch: Patch, note: NoteSpec, sr: number, rng: Rng): Float32Array[] {
  let out: Float32Array[];
  switch (patch.algo) {
    case 'subtractive':
      out = subtractive(patch, note, sr, rng);
      break;
    case 'ks':
      out = pluck(patch, note, sr, rng);
      break;
    case 'modal':
      out = mallet(patch, note, sr, rng);
      break;
    case 'fm':
      out = fmVoice(patch, note, sr);
      break;
    case 'wind':
      out = wind(patch, note, sr, rng);
      break;
    case 'drum':
      out = renderDrum(patch, note.velocity, sr, rng);
      break;
  }
  const L = out[0]!;
  const R = out[1] ?? L.slice();
  const g = 10 ** (patch.gain / 20);
  const [gl, gr] = panGains(patch.pan);
  if (g * gl !== 1) for (let i = 0; i < L.length; i++) L[i]! *= g * gl;
  if (g * gr !== 1) for (let i = 0; i < R.length; i++) R[i]! *= g * gr;
  return [L, R];
}
