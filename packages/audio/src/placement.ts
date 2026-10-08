import { dbToGain } from './loudness.ts';

/*
 * Where music plays, as a gain envelope over the music stem (already at the voice's loudness).
 * Continuous: a quiet bed under the whole video that swells in the gaps; feed formats are watched
 * with the sound low and the music carries them. Bookends: music at the start, in the breaths
 * between lines, and at the end, effectively off under speech, because a two-minute bed under
 * technical narration tires. Before the first line and after the last, both sit at the
 * "elsewhere" level, so the video still opens and closes with music. Ramps are linear in dB: the
 * music starts to duck 60 ms before speech and is down as it starts, then comes back over the
 * 300 ms after a line. A bookends rise is done 0.3 s after a line ends: before the hero scene
 * settles (0.5 s after the line before it), so the lift's downbeat is heard at full level.
 */

export type Placement = 'continuous' | 'bookends';

export interface PlacementParams {
  /** Music gain while someone speaks (dB). */
  speechDb: number;
  /** Music gain everywhere else (dB). */
  elsewhereDb: number;
  /** Gaps between lines shorter than this stay ducked (s). */
  minGap: number;
  /** Ramp down, ending as speech starts (s). */
  down: number;
  /** Ramp up, starting as speech ends (s). */
  up: number;
}

export const PLACEMENT: Record<Placement, PlacementParams> = {
  continuous: { speechDb: -20, elsewhereDb: -11, minGap: 0.6, down: 0.06, up: 0.3 },
  bookends: { speechDb: -40, elsewhereDb: -11, minGap: 1.2, down: 0.06, up: 0.3 },
};

export type Window = readonly [number, number];

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

/**
 * Whether the music plays at its full ("elsewhere") level at `t`: outside every stretch of speech
 * (gaps too short to rise in count as speech) and outside the ramps around it.
 */
export function clearOfSpeech(t: number, speech: readonly Window[], placement: Placement): boolean {
  const p = PLACEMENT[placement];
  return mergeSpeech(speech, p.minGap).every(
    ([start, end]) => t <= start - p.down + 1e-9 || t >= end + p.up - 1e-9,
  );
}

/** Per-sample linear gain for the music stem. */
export function placementEnvelope(
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sampleRate: number },
): Float32Array {
  const p = PLACEMENT[placement];
  const sr = options.sampleRate;
  const n = Math.ceil(options.duration * sr);
  const db = new Float32Array(n).fill(p.elsewhereDb);
  const depth = p.elsewhereDb - p.speechDb;
  for (const [start, end] of mergeSpeech(speech, p.minGap)) {
    const s0 = Math.max(0, Math.floor(start * sr));
    const e0 = Math.min(n, Math.ceil(end * sr));
    const a0 = Math.max(0, Math.floor((start - p.down) * sr));
    for (let i = a0; i < Math.min(s0, n); i++) {
      const k = (i / sr - (start - p.down)) / p.down;
      db[i] = Math.min(db[i]!, p.elsewhereDb - depth * Math.min(1, Math.max(0, k)));
    }
    for (let i = s0; i < e0; i++) db[i] = p.speechDb;
    const r1 = Math.min(n, Math.ceil((end + p.up) * sr));
    for (let i = e0; i < r1; i++) {
      const k = (i / sr - end) / p.up;
      db[i] = Math.min(db[i]!, p.speechDb + depth * Math.min(1, Math.max(0, k)));
    }
  }
  const gain = new Float32Array(n);
  for (let i = 0; i < n; i++) gain[i] = dbToGain(db[i]!);
  return gain;
}
