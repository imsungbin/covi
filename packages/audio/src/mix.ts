import { glueCompressor, limiter, mixInto, stereo, voiceCarve } from './dsp/fx.ts';
import {
  dbToGain,
  integratedLoudness,
  type Jump,
  largestJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  samplePeak,
  weightedLevel,
} from './loudness.ts';
import {
  duckAmount,
  type Placement,
  placementLevels,
  swellingPauses,
  validSpeech,
  type Window,
} from './placement.ts';

/*
 * The narration-first mix. The voice is brought to −16 LUFS. The music becomes a bus: brought to
 * −16 LUFS, glued by a gentle compressor, and brought to −16 LUFS again; then, while someone
 * speaks, the voice's band (about 1–4 kHz) is carved out of it, and its level follows the
 * placement. The placement never makes the music jump: outside the opening, the hero, and the
 * ending, its ramps move at most 5 dB within a second, and a pause whose swell, added to the
 * music's own movement, would bring the momentary loudness within half a dB of 6 dB in a second
 * stays at the speech level, and the music is placed again. A score that jumps on its own is only
 * measured (`musicJumps`), and QC fails it. Effects sit at levels written against the bed,
 * lowered together if any comes within 8 dB of the voice's peak. The master then gets linear gain
 * to its target and a deterministic lookahead limiter at −1.5 dBFS, up to three times, until it is
 * within ±0.5 LU of the target with a true peak at or below −1 dBTP. A linear gain plus a
 * limiter, rather than ffmpeg's loudnorm, because loudnorm silently turns dynamic when linear gain
 * would break its peak target.
 */

export const STEM_LUFS = -16;
/** Narrated videos, and music without narration; effects alone are only limited. */
export const MASTER_LUFS = { narrated: -16, music: -20 } as const;
export const CEILING_DB = -1.5;
export const TRUE_PEAK_MAX_DB = -1;
/** Effects stay at least this far under the voice's peak (dB): the mix lowers them together. */
export const EFFECTS_UNDER_VOICE_DB = 8;
/**
 * The most the music's momentary loudness may change within 1 s outside the exempt windows (dB).
 */
export const MUSIC_JUMP_DB = 6;
/** A pause whose swell would bring the music this close to the limit stays down (dB). */
const JUMP_MARGIN_DB = 0.5;
/**
 * Where the music may move faster (s): the opening, until 1 s after the first line starts; the
 * hero, 1.5 s either side of its downbeat; the ending, from 0.5 s before the last line ends.
 */
export const EXEMPT = { opening: 1, hero: 1.5, ending: 0.5 } as const;
/** How far either side of a pause its jumps reach: a 400 ms window, paired up to 1 s away (s). */
const PAUSE_REACH = 1.4;
const TOLERANCE_LU = 0.5;
const PASSES = 3;

export interface MixInput {
  sampleRate: number;
  /** The video's length in seconds. */
  duration: number;
  /** The narration, mono and already placed (the samples of video/narration.wav). */
  voice?: Float32Array;
  /** Where someone speaks, in seconds: for placement and for levels. */
  speech: ReadonlyArray<readonly [number, number]>;
  /** The rendered music, stereo and as long as the video, before any level change. */
  music?: Float32Array[];
  placement: Placement;
  /** The hero's downbeat (s), where the music lifts: exempt from the jump limit. */
  hero?: number;
  /** Effects at their cue times, each recipe at −3 dBFS peak, played at `gainDb`. */
  effects: ReadonlyArray<{ t: number; audio: Float32Array[]; gainDb: number }>;
}

export interface MixLevels {
  /** The voice stem's integrated loudness, as heard on both channels. */
  voiceLufs?: number;
  /** How far the music sits under the voice where someone speaks (K-weighted RMS, dB). */
  musicBelowVoiceDb?: number;
  /** The music's loudness range from the first line's start to the last line's end (LU). */
  musicRangeLu?: number;
  /** The largest change of the music's momentary loudness within 1 s, outside `exempt`. */
  musicJumps?: Jump & { exempt: Array<[number, number]> };
  /** Pauses kept at the speech level because swelling in them would have made the music jump. */
  pausesHeld?: number;
  /** How far the loudest effect sits under the voice's peak (dB). */
  effectsBelowVoiceDb?: number;
  /** How far the mix lowered every effect together to keep them under the voice's peak (dB). */
  effectsCutDb?: number;
  master?: { integrated: number; truePeak: number };
}

export interface MixResult {
  /** The master, stereo; undefined when nothing plays. */
  master?: Float32Array[];
  /** The voice stem at −16 LUFS (mono). */
  voice?: Float32Array;
  /** The music stem after placement (stereo). */
  music?: Float32Array[];
  /**
   * What the music was placed under as speech: the narration's windows as given (not validated),
   * then any pause held down. Unsorted, with the held pauses last: readers validate and sort, as
   * placement does.
   */
  musicLines?: Array<[number, number]>;
  levels: MixLevels;
  /** The master's loudness target, when it has one. */
  target?: number;
}

function scale(channels: readonly Float32Array[], gain: number): void {
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= gain;
}

/**
 * The narration at −16 LUFS, measured as heard: the mono voice plays on both channels of the
 * master, so it is measured as that pair. Returns a new array; silence stays silence.
 */
export function normalizeVoice(voice: Float32Array, sampleRate: number): Float32Array {
  const out = Float32Array.from(voice);
  const loudness = integratedLoudness([out, out], sampleRate);
  if (Number.isFinite(loudness)) scale([out], dbToGain(STEM_LUFS - loudness));
  return out;
}

/** The first line's start and the last line's end; undefined without speech. */
function speechSpan(speech: readonly Window[]): [number, number] | undefined {
  const valid = validSpeech(speech);
  if (!valid.length) return undefined;
  return [Math.min(...valid.map(([s]) => s)), Math.max(...valid.map(([, e]) => e))];
}

/** Where the music may move faster than `MUSIC_JUMP_DB`: the whole video without speech. */
export function musicExemptWindows(input: {
  speech: readonly Window[];
  hero?: number;
  duration: number;
}): Array<[number, number]> {
  const span = speechSpan(input.speech);
  if (!span) return [[0, input.duration]];
  const windows: Array<[number, number]> = [[0, span[0] + EXEMPT.opening]];
  // A hero at NaN would exempt every window, so the jump limit would never be checked.
  if (input.hero !== undefined && Number.isFinite(input.hero))
    windows.push([input.hero - EXEMPT.hero, input.hero + EXEMPT.hero]);
  windows.push([span[1] - EXEMPT.ending, input.duration]);
  return windows;
}

/** The music bus before placement: at −16 LUFS, glued, at −16 LUFS again; undefined when silent. */
function musicBus(music: Float32Array[], n: number, sr: number): Float32Array[] | undefined {
  const bus = stereo(n);
  mixInto(bus, music, 0);
  const loudness = integratedLoudness(bus, sr);
  if (!Number.isFinite(loudness)) return undefined;
  scale(bus, dbToGain(STEM_LUFS - loudness));
  glueCompressor(bus, { sr });
  const glued = integratedLoudness(bus, sr);
  if (!Number.isFinite(glued)) return undefined;
  scale(bus, dbToGain(STEM_LUFS - glued));
  return bus;
}

/** The bus placed under `lines`: the voice's band carved as far as it is ducked, then the level. */
function placeMusic(
  bus: readonly Float32Array[],
  lines: readonly Window[],
  placement: Placement,
  duration: number,
  sr: number,
): Float32Array[] {
  const levels = placementLevels(lines, placement, { duration, sampleRate: sr });
  const placed = bus.map((c) => Float32Array.from(c));
  voiceCarve(placed, duckAmount(levels, placement), { sr });
  const gain = Float32Array.from(levels, (db) => dbToGain(db));
  for (const c of placed) for (let i = 0; i < c.length; i++) c[i]! *= gain[i]!;
  return placed;
}

/**
 * Places the music, then holds at the speech level every pause in which it would jump: a swell's
 * ramp adding to the music's own movement past the limit, less a margin. Each round holds at least
 * one more pause, and a held pause merges with the lines around it, so the rounds end.
 */
function placeWithoutJumps(
  bus: readonly Float32Array[],
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sr: number; exempt: ReadonlyArray<readonly [number, number]> },
): {
  music: Float32Array[];
  momentary: Float64Array;
  lines: Array<[number, number]>;
  held: number;
} {
  let lines = speech.map(([s, e]): [number, number] => [s, e]);
  let held = 0;
  for (;;) {
    const music = placeMusic(bus, lines, placement, options.duration, options.sr);
    const momentary = momentaryLoudness(music, options.sr);
    const jumpy = swellingPauses(lines, placement).filter(([a, b]) => {
      const jump = largestJump(momentary, {
        exempt: [
          ...options.exempt,
          [Number.NEGATIVE_INFINITY, a - PAUSE_REACH],
          [b + PAUSE_REACH, Number.POSITIVE_INFINITY],
        ],
      });
      return jump !== undefined && jump.maxDb > MUSIC_JUMP_DB - JUMP_MARGIN_DB;
    });
    if (!jumpy.length) return { music, momentary, lines, held };
    lines = [...lines, ...jumpy];
    held += jumpy.length;
  }
}

export function mixSound(input: MixInput): MixResult {
  const sr = input.sampleRate;
  const n = Math.ceil(input.duration * sr);
  const levels: MixLevels = {};

  let voice: Float32Array | undefined;
  if (input.voice) {
    const placed = new Float32Array(n);
    placed.set(input.voice.subarray(0, n));
    voice = normalizeVoice(placed, sr);
    levels.voiceLufs = integratedLoudness([voice, voice], sr);
    if (!Number.isFinite(levels.voiceLufs)) {
      voice = undefined;
      delete levels.voiceLufs;
    }
  }

  let music: Float32Array[] | undefined;
  let musicLines: Array<[number, number]> | undefined;
  const bus = input.music ? musicBus(input.music, n, sr) : undefined;
  if (bus) {
    const speech = voice ? input.speech : [];
    const span = speechSpan(speech);
    if (span) {
      const exempt = musicExemptWindows({ speech, hero: input.hero, duration: input.duration });
      const placed = placeWithoutJumps(bus, speech, input.placement, {
        duration: input.duration,
        sr,
        exempt,
      });
      music = placed.music;
      musicLines = placed.lines;
      if (placed.held) levels.pausesHeld = placed.held;
      const range = loudnessRange(music, sr, span);
      if (range !== undefined) levels.musicRangeLu = range;
      const jump = largestJump(placed.momentary, { exempt });
      if (jump) levels.musicJumps = { ...jump, exempt };
    } else music = placeMusic(bus, [], input.placement, input.duration, sr);
  }

  let effects: Float32Array[] | undefined;
  for (const e of input.effects) {
    effects ??= stereo(n);
    mixInto(effects, e.audio, Math.round(e.t * sr), dbToGain(e.gainDb));
  }
  if (voice && effects) {
    const voicePeak = samplePeak([voice]);
    const below = voicePeak - samplePeak(effects);
    if (Number.isFinite(below)) {
      if (below < EFFECTS_UNDER_VOICE_DB) {
        // A tenth of a dB of margin keeps float rounding from landing a hair under the floor.
        const cut = EFFECTS_UNDER_VOICE_DB + 0.1 - below;
        scale(effects, dbToGain(-cut));
        levels.effectsCutDb = cut;
      }
      levels.effectsBelowVoiceDb = voicePeak - samplePeak(effects);
    }
  }

  if (voice && music && input.speech.length) {
    // Music silent wherever someone speaks sits infinitely far under the voice: none plays there.
    const below =
      weightedLevel([voice, voice], sr, input.speech) - weightedLevel(music, sr, input.speech);
    if (Number.isFinite(below)) levels.musicBelowVoiceDb = below;
  }

  if (!voice && !music && !effects) return { levels };
  const master = stereo(n);
  if (voice) mixInto(master, [voice], 0);
  if (music) mixInto(master, music, 0);
  if (effects) mixInto(master, effects, 0);

  const target = voice ? MASTER_LUFS.narrated : music ? MASTER_LUFS.music : undefined;
  if (target === undefined) {
    limiter(master, CEILING_DB, { sr });
  } else {
    let ceiling = CEILING_DB;
    for (let pass = 0; pass < PASSES; pass++) {
      const before = integratedLoudness(master, sr);
      if (!Number.isFinite(before)) break;
      scale(master, dbToGain(target - before));
      limiter(master, ceiling, { sr });
      const after = measureLoudness(master, sr);
      if (Math.abs(after.integrated - target) <= TOLERANCE_LU && after.truePeak <= TRUE_PEAK_MAX_DB)
        break;
      // Peaks between samples can pass a sample-peak limiter: lower its ceiling by the overshoot.
      if (after.truePeak > TRUE_PEAK_MAX_DB) ceiling -= after.truePeak - TRUE_PEAK_MAX_DB + 0.1;
    }
  }
  const measured = measureLoudness(master, sr);
  levels.master = { integrated: measured.integrated, truePeak: measured.truePeak };
  return { master, voice, music, ...(musicLines ? { musicLines } : {}), levels, target };
}
