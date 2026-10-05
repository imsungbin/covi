/*
 * Effects on planar buffers (Float32Array per channel, usually stereo). Every effect processes in
 * place and returns the same array so calls can be chained. Sample rate defaults to 48 kHz.
 */
import { Biquad, OnePole } from './filter.ts';

const DEFAULT_SR = 48000;
const TINY = 1e-25;

/** Equal-power pan gains normalised so centre = unity on both sides (hard left = +3 dB left). */
export function panGains(pan: number): [number, number] {
  const p = Math.min(1, Math.max(-1, pan));
  const th = ((p + 1) * Math.PI) / 4;
  return [Math.cos(th) * Math.SQRT2, Math.sin(th) * Math.SQRT2];
}

/**
 * Add `src` (mono or stereo) into `dst` starting at sample `offset`, scaled by `gain` (or
 * [gl, gr]).
 */
export function mixInto(
  dst: Float32Array[],
  src: Float32Array[],
  offset: number,
  gain: number | [number, number] = 1,
): void {
  for (let c = 0; c < dst.length; c++) {
    const s = src[Math.min(c, src.length - 1)]!;
    const d = dst[c]!;
    const g = typeof gain === 'number' ? gain : gain[Math.min(c, 1)]!;
    const start = Math.max(0, offset);
    const end = Math.min(d.length, offset + s.length);
    for (let i = start; i < end; i++) d[i]! += s[i - offset]! * g;
  }
}

export function stereo(length: number): Float32Array[] {
  return [new Float32Array(length), new Float32Array(length)];
}

export interface DelayOptions {
  /** Delay time in seconds. */
  time: number;
  feedback: number;
  /** Wet/dry crossfade: 0 = dry, 1 = wet only (use 1 on a send bus). */
  mix: number;
  /** Lowpass (Hz) on everything entering the delay line; repeats get darker each pass. */
  lowpass?: number;
  /** Highpass (Hz) on everything entering the delay line; keeps repeats out of the bass. */
  highpass?: number;
  /** Stereo ping-pong: repeats alternate left/right. */
  pingpong?: boolean;
  sr?: number;
}

export function delay(buf: Float32Array[], o: DelayOptions): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const D = Math.max(1, Math.round(o.time * sr));
  const L = buf[0]!;
  const R = buf[1] ?? L;
  const mono = buf.length < 2;
  const lineL = new Float32Array(D);
  const lineR = new Float32Array(D);
  const lpL = new OnePole(o.lowpass ?? 20000, sr);
  const lpR = new OnePole(o.lowpass ?? 20000, sr);
  const hpL = o.highpass ? new OnePole(o.highpass, sr) : null;
  const hpR = o.highpass ? new OnePole(o.highpass, sr) : null;
  const fb = Math.min(0.97, Math.max(0, o.feedback));
  const wet = Math.min(1, Math.max(0, o.mix));
  const dry = 1 - wet;
  const pp = !!o.pingpong && !mono;
  let idx = 0;
  for (let i = 0; i < L.length; i++) {
    const dl = lineL[idx]!;
    const dr = lineR[idx]!;
    const inL = L[i]!;
    const inR = R[i]!;
    let wl: number;
    let wr: number;
    if (pp) {
      wl = 0.5 * (inL + inR) + fb * dr;
      wr = fb * dl;
    } else {
      wl = inL + fb * dl;
      wr = inR + fb * dr;
    }
    wl = lpL.lp(hpL ? hpL.hp(wl) : wl);
    wr = lpR.lp(hpR ? hpR.hp(wr) : wr);
    lineL[idx] = wl;
    lineR[idx] = wr;
    if (++idx === D) idx = 0;
    L[i] = inL * dry + dl * wet;
    if (!mono) R[i] = inR * dry + dr * wet;
  }
  return buf;
}

export interface ChorusOptions {
  /** Modulation depth 0..1 (0..6 ms of delay swing). */
  depth: number;
  /** LFO rate in Hz. */
  rate: number;
  /** Equal-power wet/dry mix 0..1. */
  mix: number;
  /** Centre delay in ms, default 14. */
  delayMs?: number;
  sr?: number;
}

/** Stereo chorus: one modulated delay per channel, LFOs 90° apart. */
export function chorus(buf: Float32Array[], o: ChorusOptions): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const base = ((o.delayMs ?? 14) / 1000) * sr;
  const swing = ((0.5 + 5.5 * Math.min(1, Math.max(0, o.depth))) / 1000) * sr;
  const size = Math.ceil(base + swing + 4);
  const mix = Math.min(1, Math.max(0, o.mix));
  const gDry = Math.cos((mix * Math.PI) / 2);
  const gWet = Math.sin((mix * Math.PI) / 2);
  const w = (2 * Math.PI * o.rate) / sr;
  for (let c = 0; c < buf.length; c++) {
    const x = buf[c]!;
    const line = new Float32Array(size);
    const phase = c === 0 ? 0 : Math.PI / 2;
    let widx = 0;
    for (let i = 0; i < x.length; i++) {
      const input = x[i]!;
      line[widx] = input;
      const d = base + swing * (0.5 + 0.5 * Math.sin(w * i + phase));
      let rp = widx - d;
      while (rp < 0) rp += size;
      const i0 = Math.floor(rp);
      const frac = rp - i0;
      const a = line[i0]!;
      const b = line[i0 + 1 === size ? 0 : i0 + 1]!;
      const wet = a + (b - a) * frac;
      if (++widx === size) widx = 0;
      x[i] = input * gDry + wet * gWet;
    }
  }
  return buf;
}

export interface ReverbOptions {
  /** Room size 0..1. */
  size: number;
  /** High-frequency damping 0..1. */
  damp: number;
  /** Wet/dry: 0 = dry, 1 = wet only (use 1 on a send bus). */
  mix: number;
  /** Stereo width 0..1. */
  width: number;
  /** Pre-delay in seconds, default 0.012. */
  predelay?: number;
  /** Highpass on the reverb input (Hz), default 200: keeps the tail out of the low end. */
  lowcut?: number;
  /** Lowpass on the reverb input (Hz), default 9000: keeps the tail soft. */
  highcut?: number;
  sr?: number;
}

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;

interface Line {
  buf: Float32Array;
  idx: number;
  store: number;
}

/** Freeverb (Jezar): 8 damped feedback combs + 4 series allpasses per channel, stereo spread 23. */
export function reverb(buf: Float32Array[], o: ReverbOptions): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const scale = sr / 44100;
  const L = buf[0]!;
  const R = buf[1] ?? L;
  const mono = buf.length < 2;
  const room = Math.min(1, Math.max(0, o.size)) * 0.28 + 0.7;
  const damp = Math.min(1, Math.max(0, o.damp)) * 0.4;
  const mix = Math.min(1, Math.max(0, o.mix));
  const wet = mix * 3;
  const width = Math.min(1, Math.max(0, o.width));
  const wet1 = wet * (width / 2 + 0.5);
  const wet2 = wet * ((1 - width) / 2);
  const dry = 1 - mix;

  const make = (len: number): Line => ({
    buf: new Float32Array(Math.max(1, Math.round(len * scale))),
    idx: 0,
    store: 0,
  });
  const combsL = COMB_TUNING.map((t) => make(t));
  const combsR = COMB_TUNING.map((t) => make(t + STEREO_SPREAD));
  const apsL = ALLPASS_TUNING.map((t) => make(t));
  const apsR = ALLPASS_TUNING.map((t) => make(t + STEREO_SPREAD));

  const pre = Math.max(1, Math.round((o.predelay ?? 0.012) * sr));
  const preLine = new Float32Array(pre);
  let preIdx = 0;
  const hp = new Biquad('highpass', o.lowcut ?? 200, Math.SQRT1_2, sr);
  const lp = new Biquad('lowpass', o.highcut ?? 9000, Math.SQRT1_2, sr);

  const runComb = (c: Line, input: number): number => {
    const y = c.buf[c.idx]!;
    let s = y * (1 - damp) + c.store * damp;
    if (s < TINY && s > -TINY) s = 0;
    c.store = s;
    c.buf[c.idx] = input + s * room;
    if (++c.idx === c.buf.length) c.idx = 0;
    return y;
  };
  const runAllpass = (a: Line, input: number): number => {
    const b = a.buf[a.idx]!;
    a.buf[a.idx] = input + b * 0.5;
    if (++a.idx === a.buf.length) a.idx = 0;
    return b - input;
  };

  for (let i = 0; i < L.length; i++) {
    const inL = L[i]!;
    const inR = R[i]!;
    const delayed = preLine[preIdx]!;
    preLine[preIdx] = lp.process(hp.process((inL + inR) * 0.5));
    if (++preIdx === pre) preIdx = 0;
    const input = delayed * 0.03; // Freeverb fixed gain (0.015) for a summed stereo input
    let outL = 0;
    let outR = 0;
    for (let k = 0; k < 8; k++) {
      outL += runComb(combsL[k]!, input);
      outR += runComb(combsR[k]!, input);
    }
    for (let k = 0; k < 4; k++) {
      outL = runAllpass(apsL[k]!, outL);
      outR = runAllpass(apsR[k]!, outR);
    }
    L[i] = outL * wet1 + outR * wet2 + inL * dry;
    if (!mono) R[i] = outR * wet1 + outL * wet2 + inR * dry;
  }
  return buf;
}

export interface CompressorOptions {
  /** Threshold in dBFS. */
  threshold: number;
  ratio: number;
  /** Attack time in seconds. */
  attack: number;
  /** Release time in seconds. */
  release: number;
  /** Makeup gain in dB, default 0. */
  makeup?: number;
  /** Soft-knee width in dB, default 6. */
  knee?: number;
  sr?: number;
}

/** Feed-forward stereo-linked peak compressor with a soft knee. */
export function compressor(buf: Float32Array[], o: CompressorOptions): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const n = buf[0]!.length;
  const att = Math.exp(-1 / (Math.max(1e-4, o.attack) * sr));
  const rel = Math.exp(-1 / (Math.max(1e-4, o.release) * sr));
  const knee = o.knee ?? 6;
  const slope = 1 - 1 / Math.max(1, o.ratio);
  const makeup = o.makeup ?? 0;
  let env = 0;
  let gr = 0;
  for (let i = 0; i < n; i++) {
    let lvl = 0;
    for (const ch of buf) lvl = Math.max(lvl, Math.abs(ch[i]!));
    env = lvl > env ? lvl : lvl + (env - lvl) * rel;
    const db = 20 * Math.log10(Math.max(env, 1e-9));
    const over = db - o.threshold;
    let target: number;
    if (over <= -knee / 2) target = 0;
    else if (over >= knee / 2) target = over * slope;
    else target = (slope * (over + knee / 2) ** 2) / (2 * knee);
    gr = target > gr ? target + (gr - target) * att : target + (gr - target) * rel;
    const g = 10 ** ((makeup - gr) / 20);
    for (const ch of buf) ch[i]! *= g;
  }
  return buf;
}

/**
 * Brick-wall lookahead limiter (5 ms). Gain = moving average of a release-smoothed running minimum
 * of the required gain, which provably never exceeds the requirement; a final clamp guards float
 * rounding. Zero latency: the lookahead is realised by reading the gain curve ahead of the audio.
 */
export function limiter(
  buf: Float32Array[],
  ceilingDb = -1,
  opts: { release?: number; lookahead?: number; sr?: number } = {},
): Float32Array[] {
  const sr = opts.sr ?? DEFAULT_SR;
  const n = buf[0]!.length;
  const ceiling = 10 ** (ceilingDb / 20);
  const La = Math.max(1, Math.round((opts.lookahead ?? 0.005) * sr));
  const relCoef = 1 - Math.exp(-1 / (Math.max(1e-3, opts.release ?? 0.08) * sr));
  const total = n + La;
  // required gain per sample (1 beyond the end)
  const req = new Float32Array(total);
  let any = false;
  for (let i = 0; i < total; i++) {
    let p = 0;
    if (i < n) for (const ch of buf) p = Math.max(p, Math.abs(ch[i]!));
    const r = p > ceiling ? ceiling / p : 1;
    if (r < 1) any = true;
    req[i] = r;
  }
  if (!any) return buf;
  // running minimum over the window [i - La, i] with a monotonic deque
  const minHold = new Float32Array(total);
  const dq = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i++) {
    while (tail > head && req[dq[tail - 1]!]! >= req[i]!) tail--;
    dq[tail++] = i;
    while (dq[head]! < i - La) head++;
    minHold[i] = req[dq[head]!]!;
  }
  // instant attack, smooth release (never above minHold)
  let g = 1;
  for (let i = 0; i < total; i++) {
    const m = minHold[i]!;
    g = m < g ? m : g + (1 - g) * relCoef;
    if (g > m) g = m;
    minHold[i] = g;
  }
  // moving average over La + 1 samples; gain for audio sample j is avg(smoothed[j .. j + La])
  let sum = 0;
  for (let i = 0; i <= La && i < total; i++) sum += minHold[i]!;
  for (let j = 0; j < n; j++) {
    const gain = sum / (La + 1);
    for (const ch of buf) {
      let v = ch[j]! * gain;
      if (v > ceiling) v = ceiling;
      else if (v < -ceiling) v = -ceiling;
      ch[j] = v;
    }
    sum -= minHold[j]!;
    if (j + La + 1 < total) sum += minHold[j + La + 1]!;
    else sum += 1;
  }
  return buf;
}

/**
 * Soft clipper: identity below `knee`, then a smooth rational curve that approaches (never
 * reaches) ±1.
 */
export function softClip(x: number, knee = 0.75): number {
  const a = x < 0 ? -x : x;
  if (a <= knee) return x;
  const t = (a - knee) / (1 - knee);
  const y = knee + (1 - knee) * (t / (1 + t));
  return x < 0 ? -y : y;
}

/**
 * Apply a static gain and equal-power pan to a stereo buffer in place (mono input is
 * duplicated).
 */
export function gainPan(buf: Float32Array[], gain: number, pan: number): Float32Array[] {
  if (buf.length === 1) buf.push(buf[0]!.slice());
  const [gl, gr] = panGains(pan);
  const a = gain * gl;
  const b = gain * gr;
  const L = buf[0]!;
  const R = buf[1]!;
  if (a !== 1) for (let i = 0; i < L.length; i++) L[i]! *= a;
  if (b !== 1) for (let i = 0; i < R.length; i++) R[i]! *= b;
  return buf;
}

export function peakAbs(buf: Float32Array[]): number {
  let p = 0;
  for (const ch of buf) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]!;
      const v = x < 0 ? -x : x;
      if (v > p) p = v;
    }
  }
  return p;
}

export function rmsAll(buf: Float32Array[]): number {
  let s = 0;
  let n = 0;
  for (const ch of buf) {
    for (let i = 0; i < ch.length; i++) s += ch[i]! * ch[i]!;
    n += ch.length;
  }
  return n ? Math.sqrt(s / n) : 0;
}
