/**
 * Sound for Covi videos: a deterministic synthesizer, music scores and their fitting, sound-effect
 * recipes, and the narration-first mix. Nothing is sampled or downloaded: music and effects are
 * rendered from data, so they are license-clean, exactly as long as the video, and the same bytes
 * every time. This package depends on no other Covi package and never locates resources itself.
 */
export {
  type DroppedEffect,
  type EffectCue,
  effectRecipe,
  effectTranspose,
  type PlacedEffect,
  placeEffects,
  type SoundEffectsConfig,
  SoundEffectsSchema,
} from './effects.ts';
export { hashOf, stableStringify } from './hash.ts';
export {
  AUDIO_ENGINE_VERSION,
  checkScoreReferences,
  loadMusicLibrary,
  type MusicCacheInput,
  type MusicLibrary,
  musicCacheKey,
} from './library.ts';
export {
  AUDIBLE,
  audibleSeconds,
  dbfs,
  dbToGain,
  integratedLoudness,
  type Jump,
  type Loudness,
  largestJump,
  loudnessJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  samplePeak,
  truePeak,
  weightedLevel,
} from './loudness.ts';
export {
  CEILING_DB,
  MASTER_LUFS,
  type MixInput,
  type MixLevels,
  type MixResult,
  mixSound,
  normalizeVoice,
  STEM_LUFS,
  TRUE_PEAK_MAX_DB,
} from './mix.ts';
export {
  type Arrangement,
  type FitScore,
  type FitTarget,
  fitMusic,
  MIN_MUSIC_SECONDS,
} from './music/fit.ts';
export {
  logoNotes,
  musicLength,
  noteLimit,
  renderMusic,
  scheduleArrangement,
} from './music/render.ts';
export { type ParsedScore, parseScore, ScoreError } from './music/score.ts';
export {
  clearOfSpeech,
  PLACEMENT,
  type Placement,
  type PlacementParams,
  placementEnvelope,
} from './placement.ts';
export {
  SCORE_LIMITS,
  type Score,
  type ScoreInput,
  ScoreSchema,
  VERDICTS,
  type Verdict,
} from './schema/score.ts';
export type { SfxRecipe } from './schema/sfx.ts';
export { renderSfx } from './sfx/recipes.ts';
export type { Kit, Patch } from './synth/patches.ts';
export { decodeWav, encodeWav, readWav, type WavData, writeWav } from './wav.ts';
