import { limiter, mixInto, stereo } from './dsp/fx.ts';
import {
  dbToGain,
  integratedLoudness,
  measureLoudness,
  samplePeak,
  weightedLevel,
} from './loudness.ts';
import { type Placement, placementEnvelope } from './placement.ts';

/*
 * The narration-first mix. The voice and the music are each brought to −16 LUFS, the music is
 * shaped by its placement (under speech, in the gaps, at the ends), effects sit at levels written
 * against the bed, lowered together if any comes within 8 dB of the voice's peak. The master then
 * gets linear gain to its target and a deterministic lookahead limiter at −1.5 dBFS, up to three
 * times, until it is within ±0.5 LU of the target with a true peak at or below −1 dBTP. A linear
 * gain plus a limiter, rather than ffmpeg's loudnorm, because loudnorm silently turns dynamic when
 * linear gain would break its peak target.
 */

export const STEM_LUFS = -16;
/** Narrated videos, and music without narration; effects alone are only limited. */
export const MASTER_LUFS = { narrated: -16, music: -20 } as const;
export const CEILING_DB = -1.5;
export const TRUE_PEAK_MAX_DB = -1;
/** Effects stay at least this far under the voice's peak (dB): the mix lowers them together. */
export const EFFECTS_UNDER_VOICE_DB = 8;
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
  /** Effects at their cue times, each recipe at −3 dBFS peak, played at `gainDb`. */
  effects: ReadonlyArray<{ t: number; audio: Float32Array[]; gainDb: number }>;
}

export interface MixLevels {
  /** The voice stem's integrated loudness, as heard on both channels. */
  voiceLufs?: number;
  /** How far the music sits under the voice where someone speaks (K-weighted RMS, dB). */
  musicBelowVoiceDb?: number;
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
  if (input.music) {
    music = stereo(n);
    mixInto(music, input.music, 0);
    const loudness = integratedLoudness(music, sr);
    if (Number.isFinite(loudness)) {
      scale(music, dbToGain(STEM_LUFS - loudness));
      const envelope = placementEnvelope(voice ? input.speech : [], input.placement, {
        duration: input.duration,
        sampleRate: sr,
      });
      for (const c of music) for (let i = 0; i < n; i++) c[i]! *= envelope[i]!;
    } else music = undefined;
  }

  let effects: Float32Array[] | undefined;
  for (const e of input.effects) {
    effects ??= stereo(n);
    mixInto(effects, e.audio, Math.round(e.t * sr), dbToGain(e.gainDb));
  }

  if (voice && music && input.speech.length)
    levels.musicBelowVoiceDb =
      weightedLevel([voice, voice], sr, input.speech) - weightedLevel(music, sr, input.speech);
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
  return { master, voice, music, levels, target };
}
