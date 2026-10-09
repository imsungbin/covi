import { dbToGain } from './loudness.ts';

/*
 * Where music plays, as a level in dB over the music bus (already at the voice's loudness).
 *
 * Continuous, the default: a bed under the whole video. It sits 15 dB down while someone speaks,
 * 8 dB down in a pause long enough to rise and hold there for half a second (shorter pauses stay
 * down), and 6 dB down before the first line, after the last, and throughout without narration.
 * Bookends: music before the first line and after the last, effectively off under speech;
 * between lines it rises and falls at 5 dB a second, so a short breath barely moves it.
 *
 * A ramp into a line ends as the line starts, so the music is down when the voice begins; a ramp
 * out of one starts as it ends. The ramp into the first line and the one out of the last are
 * raised cosines of their nominal lengths: the opening and the ending may move faster, and QC
 * exempts them. Between the first line and the last, every ramp is long enough that the level
 * changes by at most `maxStepDb` within any second. There the level is the minimum of per-line
 * shapes that each keep that bound, and a minimum keeps it too, so it holds by construction.
 */

export type Placement = 'continuous' | 'bookends';
export type RampShape = 'cosine' | 'linear';
export type Window = readonly [number, number];

export interface PlacementParams {
  /** Music level while someone speaks (dB). */
  speechDb: number;
  /** Music level in a pause between lines that swells (dB). */
  gapDb: number;
  /** Music level before the first line, after the last, and throughout without narration (dB). */
  endsDb: number;
  /** Nominal ramp into a line, ending as it starts (s). */
  down: number;
  /** Nominal ramp out of a line, starting as it ends (s). */
  up: number;
  /** The shape of the ramps between lines, in dB. */
  gapRamp: RampShape;
  /**
   * How long a pause must hold the gap level to swell at all (s); shorter pauses stay at the
   * speech level. Null: every pause swells as far as its ramps reach.
   */
  hold: number | null;
  /** Between the first line and the last, the most the level changes within any second (dB). */
  maxStepDb: number;
}

export const PLACEMENT: Record<Placement, PlacementParams> = {
  continuous: {
    speechDb: -15,
    gapDb: -8,
    endsDb: -6,
    down: 1.2,
    up: 1.5,
    gapRamp: 'cosine',
    hold: 0.5,
    maxStepDb: 5,
  },
  bookends: {
    speechDb: -40,
    gapDb: -11,
    endsDb: -11,
    down: 1.2,
    up: 1.5,
    gapRamp: 'linear',
    hold: null,
    maxStepDb: 5,
  },
};

/**
 * The continuous bed's level under speech: what effect levels are written against
 * (templates/music/sound-effects.yml), whatever the placement and with no music at all.
 */
export const BED_DB = PLACEMENT.continuous.speechDb;

/** Lines closer than this are one stretch of speech (s). */
const MIN_PAUSE = 0.05;

/**
 * The shortest ramp of `depth` dB, at least `nominal` seconds, whose level changes by at most
 * `step` dB within any second: a raised cosine moves most in its middle, D·sin(π/2T) in a
 * second; a straight line D/T.
 */
export function rampSeconds(
  depth: number,
  nominal: number,
  step: number,
  shape: RampShape,
): number {
  if (depth <= step) return nominal;
  const needed = shape === 'linear' ? depth / step : Math.PI / (2 * Math.asin(step / depth));
  return Math.max(nominal, needed);
}

function shapeAt(shape: RampShape, k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return shape === 'linear' ? x : (1 - Math.cos(Math.PI * x)) / 2;
}

/**
 * The speech windows a level can follow: finite, with the end after the start. Windows past
 * either end of the video stay, because a line beyond the samples asked for still shapes the
 * ramps inside them.
 */
export function validSpeech(speech: readonly Window[]): Window[] {
  return speech.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
}

/** Sorts speech windows and merges those closer than `minGap`. */
export function mergeSpeech(speech: readonly Window[], minGap: number): Array<[number, number]> {
  const sorted = [...speech].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out.at(-1);
    if (last && start - last[1] < minGap) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** The ramps between lines, lengthened to keep the placement's step. */
function gapRamps(p: PlacementParams): { down: number; up: number } {
  const depth = p.gapDb - p.speechDb;
  return {
    down: rampSeconds(depth, p.down, p.maxStepDb, p.gapRamp),
    up: rampSeconds(depth, p.up, p.maxStepDb, p.gapRamp),
  };
}

/** The lines the music ducks under: valid speech, merged across pauses too short to swell. */
function placementLines(speech: readonly Window[], p: PlacementParams): Array<[number, number]> {
  const ramps = gapRamps(p);
  const minGap = p.hold === null ? MIN_PAUSE : Math.max(MIN_PAUSE, ramps.up + p.hold + ramps.down);
  return mergeSpeech(validSpeech(speech), minGap);
}

/** The pauses between lines in which the music rises above the speech level. */
export function swellingPauses(
  speech: readonly Window[],
  placement: Placement,
): Array<[number, number]> {
  const lines = placementLines(speech, PLACEMENT[placement]);
  return lines.slice(1).map(([start], i): [number, number] => [lines[i]![1], start]);
}

/** The music's level in dB, one value per sample. */
export function placementLevels(
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sampleRate: number },
): Float64Array {
  const p = PLACEMENT[placement];
  const sr = options.sampleRate;
  const n = Math.ceil(options.duration * sr);
  const levels = new Float64Array(n).fill(p.endsDb);
  const lines = placementLines(speech, p);
  if (!lines.length) return levels;
  const ramps = gapRamps(p);
  // The samples from the first line's start to the last line's end.
  const from = Math.max(0, Math.ceil(lines[0]![0] * sr));
  const to = Math.min(n, Math.floor(lines.at(-1)![1] * sr) + 1);
  levels.fill(p.gapDb, from, to);
  lines.forEach(([start, end], j) => {
    const opening = j === 0;
    const closing = j === lines.length - 1;
    const into = {
      seconds: opening ? p.down : ramps.down,
      shape: (opening ? 'cosine' : p.gapRamp) as RampShape,
      from: opening ? p.endsDb : p.gapDb,
    };
    const out = {
      seconds: closing ? p.up : ramps.up,
      shape: (closing ? 'cosine' : p.gapRamp) as RampShape,
      to: closing ? p.endsDb : p.gapDb,
    };
    // A ramp between lines stops at the first line and the last: a long one (bookends) would
    // otherwise reach past them and pull the opening or the ending down.
    const a = Math.max(opening ? 0 : from, Math.floor((start - into.seconds) * sr));
    const b = Math.min(closing ? n : to, Math.ceil((end + out.seconds) * sr));
    for (let i = a; i < b; i++) {
      const t = i / sr;
      const db =
        t < start
          ? p.speechDb + (into.from - p.speechDb) * shapeAt(into.shape, (start - t) / into.seconds)
          : t <= end
            ? p.speechDb
            : p.speechDb + (out.to - p.speechDb) * shapeAt(out.shape, (t - end) / out.seconds);
      if (db < levels[i]!) levels[i] = db;
    }
  });
  return levels;
}

/** Per-sample linear gain for the music bus. */
export function placementEnvelope(
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sampleRate: number },
): Float32Array {
  return Float32Array.from(placementLevels(speech, placement, options), (db) => dbToGain(db));
}

/**
 * How far the music is ducked at each sample: 0 at a pause's level or above, 1 at the speech
 * level.
 */
export function duckAmount(levels: Float64Array, placement: Placement): Float32Array {
  const p = PLACEMENT[placement];
  const depth = p.gapDb - p.speechDb;
  return Float32Array.from(levels, (db) => Math.min(1, Math.max(0, (p.gapDb - db) / depth)));
}

/** Whether the music plays at a pause's full level (or above) at `t`. */
export function clearOfSpeech(t: number, speech: readonly Window[], placement: Placement): boolean {
  const sr = 1000;
  const levels = placementLevels(speech, placement, {
    duration: Math.max(0, t) + 2 / sr,
    sampleRate: sr,
  });
  const level = levels[Math.max(0, Math.round(t * sr))];
  return level !== undefined && level >= PLACEMENT[placement].gapDb - 1e-6;
}
