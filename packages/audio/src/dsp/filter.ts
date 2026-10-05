/*
 * Filters: RBJ-cookbook biquads for static EQ, a TPT state-variable filter for swept synth
 * filters (stable under fast modulation), and one-pole helpers. States flush tiny values to 0
 * so long decays never fall into slow denormal arithmetic.
 */

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf';

const TINY = 1e-25;

export class Biquad {
  type: BiquadType;
  freq: number;
  q: number;
  sr: number;
  gainDb: number;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: BiquadType, freq: number, q: number, sr: number, gainDb = 0) {
    this.type = type;
    this.freq = freq;
    this.q = q;
    this.sr = sr;
    this.gainDb = gainDb;
    this.update();
  }

  setFreq(freq: number): void {
    this.freq = freq;
    this.update();
  }

  set(freq: number, q: number, gainDb = this.gainDb): void {
    this.freq = freq;
    this.q = q;
    this.gainDb = gainDb;
    this.update();
  }

  private update(): void {
    const f = Math.min(Math.max(this.freq, 5), 0.49 * this.sr);
    const w0 = (2 * Math.PI * f) / this.sr;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const q = Math.max(this.q, 1e-3);
    const alpha = sinw / (2 * q);
    const A = 10 ** (this.gainDb / 40);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (this.type) {
      case 'lowpass':
        b0 = (1 - cosw) / 2;
        b1 = 1 - cosw;
        b2 = (1 - cosw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cosw) / 2;
        b1 = -(1 + cosw);
        b2 = (1 + cosw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case 'bandpass': // constant 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cosw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf': {
        const sq = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cosw + sq);
        b1 = 2 * A * (A - 1 - (A + 1) * cosw);
        b2 = A * (A + 1 - (A - 1) * cosw - sq);
        a0 = A + 1 + (A - 1) * cosw + sq;
        a1 = -2 * (A - 1 + (A + 1) * cosw);
        a2 = A + 1 + (A - 1) * cosw - sq;
        break;
      }
      case 'highshelf': {
        const sq = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cosw + sq);
        b1 = -2 * A * (A - 1 + (A + 1) * cosw);
        b2 = A * (A + 1 + (A - 1) * cosw - sq);
        a0 = A + 1 - (A - 1) * cosw + sq;
        a1 = 2 * (A - 1 - (A + 1) * cosw);
        a2 = A + 1 - (A - 1) * cosw - sq;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    let y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    if (y < TINY && y > -TINY) y = 0;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  /** Filter a whole buffer in place. */
  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]!);
    return buf;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/**
 * Topology-preserving-transform state-variable filter (Simper). `lp`/`bp`/`hp` each advance the
 * filter by one sample and return that response; call only one of them per sample.
 */
export class Svf {
  private sr: number;
  private k = Math.SQRT2;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private ic1 = 0;
  private ic2 = 0;
  private v1 = 0;
  private v2 = 0;

  constructor(sr: number, freq = 1000, q = Math.SQRT1_2) {
    this.sr = sr;
    this.set(freq, q);
  }

  set(freq: number, q: number): void {
    const f = Math.min(Math.max(freq, 5), 0.47 * this.sr);
    const g = Math.tan((Math.PI * f) / this.sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  private tick(x: number): void {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (this.ic1 < TINY && this.ic1 > -TINY) this.ic1 = 0;
    if (this.ic2 < TINY && this.ic2 > -TINY) this.ic2 = 0;
    this.v1 = v1;
    this.v2 = v2;
  }

  lp(x: number): number {
    this.tick(x);
    return this.v2;
  }

  bp(x: number): number {
    this.tick(x);
    return this.v1;
  }

  hp(x: number): number {
    this.tick(x);
    return x - this.k * this.v1 - this.v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = this.v1 = this.v2 = 0;
  }
}

/** One-pole lowpass (6 dB/oct). `hp()` returns the complementary highpass of the same state. */
export class OnePole {
  private a: number;
  private y = 0;

  constructor(freq: number, sr: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * Math.min(freq, 0.49 * sr)) / sr);
  }

  setFreq(freq: number, sr: number): void {
    this.a = 1 - Math.exp((-2 * Math.PI * Math.min(freq, 0.49 * sr)) / sr);
  }

  lp(x: number): number {
    this.y += this.a * (x - this.y);
    if (this.y < TINY && this.y > -TINY) this.y = 0;
    return this.y;
  }

  hp(x: number): number {
    return x - this.lp(x);
  }
}

/** DC blocker: y = x − x₁ + R·y₁ with a corner of a few Hz. */
export class DcBlocker {
  private r: number;
  private x1 = 0;
  private y1 = 0;

  constructor(sr: number, corner = 8) {
    this.r = 1 - (2 * Math.PI * corner) / sr;
  }

  process(x: number): number {
    let y = x - this.x1 + this.r * this.y1;
    if (y < TINY && y > -TINY) y = 0;
    this.x1 = x;
    this.y1 = y;
    return y;
  }

  run(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.process(buf[i]!);
    return buf;
  }
}
