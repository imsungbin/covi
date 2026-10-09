// The score format agents write (`covi schema score`); the CLI reaches the audio package here.
export { type Score, ScoreSchema } from '@covi/audio';
export { buildCaptions, captionOptionsFor, chunkCaption, toSrt, toVtt } from './captions.ts';
export { AssetCollector, fontFiles, writeComposition } from './composition/build.ts';
export { imageSize } from './composition/images.ts';
export { runtimeScript } from './composition/runtime-bundle.ts';
export {
  type DensityTimeline,
  densityChecks,
  EMPTY_SHARE,
  emptyFrameCheck,
  leadKind,
  MAX_RUN,
  monotonyCheck,
  TRANSITION_MIN,
  TRANSITION_SHARE,
  textSizeCheck,
  transitionVarietyCheck,
} from './density.ts';
export { defaultDirection, entrances, mergeDirection } from './direction/director.ts';
export { type DirectionMode, type DirectionPlan, planDirection } from './direction/plan.ts';
export { directionProblems } from './direction/refs.ts';
export { directionImages, resolveDirection } from './direction/resolve.ts';
export {
  DIRECTION_LIMITS,
  DIRECTION_PATH,
  type Direction,
  type DirectionInput,
  DirectionSchema,
  readDirectionFile,
  type Shot,
  type ShotBeat,
  type ShotElement,
} from './direction/schema.ts';
export { type DirectionSources, directionSources } from './direction/sources.ts';
export {
  localeLanguage,
  normalizeSpeech,
  type Pronunciations,
  resolveSpeechLanguage,
  type SpeechChange,
  type SpeechRecord,
  speakScenes,
  speechTable,
  unspokenAcronyms,
} from './narration/speech.ts';
export {
  chooseTts,
  ElevenLabsTts,
  OpenAiTts,
  parseSayVoices,
  pickMacVoice,
  SystemTts,
  synthesizeTake,
  type Take,
  type TtsProvider,
} from './narration/tts.ts';
export {
  durationOf,
  mixTakes,
  mouthEnvelope,
  readWav,
  SAMPLE_RATE,
  syntheticMouth,
  writeWav,
} from './narration/wav.ts';
export {
  decideVideo,
  type ProduceVideoInput,
  type ProduceVideoResult,
  produceVideo,
  type VideoDecision,
} from './pipeline.ts';
export {
  type AudioMeasure,
  audioCheck,
  layoutChecks,
  type QcCheck,
  type QcReport,
  runQc,
  soundChecks,
  speechChecks,
  timingChecks,
} from './qc.ts';
export { Media, type ProbeResult } from './render/ffmpeg.ts';
export {
  canReuseFrames,
  type FramesRecord,
  framesKey,
  type RenderOptions,
  type RenderResult,
  remuxAudio,
  renderComposition,
} from './render/renderer.ts';
export {
  AUDIO_PATHS,
  type AudioRecord,
  draftScore,
  heroMoment,
  lastLineEnd,
  type MusicSource,
  musicLibrary,
  musicVerdict,
  readScoreFile,
  resolveMusic,
} from './sound.ts';
export * from './spec.ts';
export { composeScore, musicMethodology } from './storyboard/compose.ts';
export {
  draftStoryboard,
  excerpt,
  fitWords,
  spoken,
  WORDS_PER_SECOND,
} from './storyboard/draft.ts';
export { refineNarration } from './storyboard/model.ts';
export {
  type Scene,
  SceneSchema,
  type Storyboard,
  type StoryboardInput,
  StoryboardSchema,
  type Visual,
  VisualSchema,
} from './storyboard/schema.ts';
export {
  heroScene,
  loadTemplates,
  type StoryTemplate,
  selectTemplate,
  TemplateSchema,
} from './templates.ts';
export {
  buildTimeline,
  estimateSpeech,
  fitToDuration,
  type Layout,
  layoutScenes,
  minSecondsFor,
  OUTRO_ID,
  OUTRO_SECONDS,
  type Pacing,
  pacingFor,
  storyScenes,
  TIGHT,
  TRANSITION,
  timelineLabels,
} from './timeline/build.ts';
export { buildCues, outroSettle } from './timeline/cues.ts';
export type * from './timeline/types.ts';
