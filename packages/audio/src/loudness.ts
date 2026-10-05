/*
 * Loudness (ITU-R BS.1770-4) and true peak, measured in TypeScript rather than with ffmpeg, so the
 * mix stays deterministic and needs no temporary files.
 *
 * Integrated loudness: K-weighting (a high shelf and the RLB high-pass), mean square over 400 ms
 * blocks every 100 ms summed across channels, an absolute gate at −70 LUFS, then a relative gate
 * 10 LU below the loudness of the blocks that passed it. True peak: 4× oversampling with a
 * windowed-sinc interpolator, and the largest magnitude found.
 */

export interface Loudness {
  /** Integrated loudness in LUFS (−Infinity for silence). */
  integrated: number;
  /** True peak in dBTP. */
  truePeak: number;
  /** Largest sample magnitude in dBFS. */
  samplePeak: number;
}

export interface BiquadCoefficients {
  b: [number, number, number];
  a: [number, number, number];
}

export function dbfs(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : Number.NEGATIVE_INFINITY;
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/** K-weighting for any sample rate (the formulas behind the standard's 48 kHz table). */
export function kWeightingCoefficients(sampleRate: number): {
  shelf: BiquadCoefficients;
  highpass: BiquadCoefficients;
} {
  let f0 = 1681.974450955533;
  const gain = 3.999843853973347;
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gain / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const shelf: BiquadCoefficients = {
    b: [
      (vh + (vb * k) / q + k * k) / a0,
      (2 * (k * k - vh)) / a0,
      (vh - (vb * k) / q + k * k) / a0,
    ],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
  f0 = 38.13547087602444;
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * f0) / sampleRate);
  const r0 = 1 + k / q + k * k;
  const highpass: BiquadCoefficients = {
    b: [1, -2, 1],
    a: [1, (2 * (k * k - 1)) / r0, (1 - k / q + k * k) / r0],
  };
  return { shelf, highpass };
}

/** The K-weighted signal of one channel, in double precision. */
function kWeighted(channel: Float32Array, sampleRate: number): Float64Array {
  const { shelf, highpass } = kWeightingCoefficients(sampleRate);
  const out = Float64Array.from(channel);
  for (const { b, a } of [shelf, highpass]) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x = out[i]!;
      const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/** Mean square of the K-weighted signal per 100 ms step, summed across channels. */
function stepEnergies(channels: readonly Float32Array[], sampleRate: number): Float64Array {
  const step = Math.round(sampleRate / 10);
  const length = channels[0]?.length ?? 0;
  const steps = Math.floor(length / step);
  const energy = new Float64Array(steps);
  for (const channel of channels) {
    const y = kWeighted(channel, sampleRate);
    for (let s = 0; s < steps; s++) {
      let sum = 0;
      for (let i = s * step; i < (s + 1) * step; i++) sum += y[i]! * y[i]!;
      energy[s]! += sum;
    }
  }
  return energy;
}

const LUFS_OFFSET = -0.691;
const toLufs = (power: number) =>
  power > 0 ? LUFS_OFFSET + 10 * Math.log10(power) : Number.NEGATIVE_INFINITY;

/** Integrated loudness in LUFS: gated, so silence and quiet passages do not pull it down. */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  const steps = stepEnergies(channels, sampleRate);
  const blockSamples = 4 * Math.round(sampleRate / 10);
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= steps.length; j++)
    blocks.push((steps[j]! + steps[j + 1]! + steps[j + 2]! + steps[j + 3]!) / blockSamples);
  const absolute = 10 ** ((-70 - LUFS_OFFSET) / 10);
  const loud = blocks.filter((p) => p > absolute);
  if (!loud.length) return Number.NEGATIVE_INFINITY;
  const relative = (loud.reduce((a, b) => a + b, 0) / loud.length) * 0.1;
  const gated = loud.filter((p) => p > relative);
  return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/**
 * K-weighted level (LUFS scale, ungated) over time windows in seconds: how loud one stem is where
 * another speaks. −Infinity when the windows hold nothing.
 */
export function weightedLevel(
  channels: readonly Float32Array[],
  sampleRate: number,
  windows: ReadonlyArray<readonly [number, number]>,
): number {
  const ranges = windows
    .map(([s, e]) => [Math.max(0, Math.floor(s * sampleRate)), Math.ceil(e * sampleRate)] as const)
    .filter(([s, e]) => e > s);
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    const y = kWeighted(channel, sampleRate);
    for (const [s, e] of ranges) {
      const end = Math.min(e, y.length);
      for (let i = s; i < end; i++) sum += y[i]! * y[i]!;
    }
  }
  for (const [s, e] of ranges) count += Math.max(0, Math.min(e, channels[0]?.length ?? 0) - s);
  return count ? toLufs(sum / count) : Number.NEGATIVE_INFINITY;
}

/**
 * What counts as music a viewer hears: a 0.25 s window of the placed music stem whose RMS is above
 * −45 dBFS. The stem is at the voice's loudness (−16 LUFS) before placement, and the master keeps
 * the narration there, so −45 dBFS sits about 29 dB under the voice as heard. That is halfway
 * between Covi's own placements: a continuous bed under speech (about −36, quiet but heard) and
 * bookends' ducked level (about −56, masked by the voice), with some 10 dB of margin either way
 * for the music's own dynamics. A quarter second resolves a one-second breath and averages over a
 * note's attack and decay.
 */
export const AUDIBLE = { thresholdDbfs: -45, window: 0.25 } as const;

/**
 * Seconds of audible music before `until`: whole windows from the start whose RMS (both channels
 * together) is above the threshold.
 */
export function audibleSeconds(
  channels: readonly Float32Array[],
  sampleRate: number,
  until: number,
): number {
  const window = Math.round(AUDIBLE.window * sampleRate);
  const end = Math.min(channels[0]?.length ?? 0, Math.floor(until * sampleRate + 1e-6));
  const floor = 10 ** (AUDIBLE.thresholdDbfs / 20);
  let windows = 0;
  for (let from = 0; from + window <= end; from += window) {
    let sum = 0;
    for (const c of channels) for (let i = from; i < from + window; i++) sum += c[i]! * c[i]!;
    if (Math.sqrt(sum / (window * channels.length)) > floor) windows++;
  }
  return windows * AUDIBLE.window;
}

const OVERSAMPLE = 4;
const HALF_TAPS = 6;

/**
 * Polyphase taps for the three in-between phases of a 4× interpolator: a Kaiser-windowed sinc
 * (12 taps per phase, as in BS.1770-4 Annex 2), each phase normalized to unity gain at DC.
 */
const PHASES: Float64Array[] = (() => {
  const beta = 6;
  const bessel = (x: number) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 30; k++) {
      term *= (x / (2 * k)) ** 2;
      sum += term;
    }
    return sum;
  };
  const span = HALF_TAPS + 0.5;
  const out: Float64Array[] = [];
  for (let p = 1; p < OVERSAMPLE; p++) {
    const frac = p / OVERSAMPLE;
    const taps = new Float64Array(2 * HALF_TAPS);
    let sum = 0;
    for (let k = 0; k < taps.length; k++) {
      // Distance from the interpolated point to source sample (i − HALF_TAPS + 1 + k).
      const d = k - (HALF_TAPS - 1) - frac;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = bessel(beta * Math.sqrt(Math.max(0, 1 - (d / span) ** 2))) / bessel(beta);
      taps[k] = sinc * w;
      sum += taps[k]!;
    }
    for (let k = 0; k < taps.length; k++) taps[k]! /= sum;
    out.push(taps);
  }
  return out;
})();

/** The largest gain any phase applies to a full-scale input, which bounds what lies between samples. */
const MAX_GAIN = Math.max(...PHASES.map((taps) => taps.reduce((a, t) => a + Math.abs(t), 0)));

/** True peak in dBTP. Only neighborhoods loud enough to beat the current peak are oversampled. */
export function truePeak(channels: readonly Float32Array[], _sampleRate: number): number {
  let peak = 0;
  for (const x of channels)
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  if (peak === 0) return Number.NEGATIVE_INFINITY;
  for (const x of channels) {
    const n = x.length;
    // A point between samples can exceed `peak` only near a sample above peak / MAX_GAIN.
    let lastHot = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (Math.abs(x[i]!) * MAX_GAIN >= peak) lastHot = i;
      if (i - lastHot > HALF_TAPS) {
        // Look ahead: a hot sample within reach of the points between i and i + 1.
        let near = false;
        for (let j = i + 1; j <= Math.min(n - 1, i + HALF_TAPS); j++)
          if (Math.abs(x[j]!) * MAX_GAIN >= peak) {
            near = true;
            break;
          }
        if (!near) continue;
      }
      for (const taps of PHASES) {
        let y = 0;
        for (let k = 0; k < taps.length; k++) {
          const j = i - (HALF_TAPS - 1) + k;
          if (j >= 0 && j < n) y += taps[k]! * x[j]!;
        }
        const a = Math.abs(y);
        if (a > peak) peak = a;
      }
    }
  }
  return dbfs(peak);
}

export function samplePeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const x of channels)
    for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]!));
  return dbfs(peak);
}

export function measureLoudness(channels: readonly Float32Array[], sampleRate: number): Loudness {
  return {
    integrated: integratedLoudness(channels, sampleRate),
    truePeak: truePeak(channels, sampleRate),
    samplePeak: samplePeak(channels),
  };
}
