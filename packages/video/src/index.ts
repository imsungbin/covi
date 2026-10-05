export { buildCaptions, captionOptionsFor, chunkCaption, toSrt, toVtt } from './captions.ts';
export { AssetCollector, fontFiles, writeComposition } from './composition/build.ts';
export { imageSize } from './composition/images.ts';
export { runtimeScript } from './composition/runtime-bundle.ts';
export {
  chooseTts,
  ElevenLabsTts,
  OpenAiTts,
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
export { layoutChecks, type QcCheck, type QcReport, runQc, timingChecks } from './qc.ts';
export { Media, type ProbeResult } from './render/ffmpeg.ts';
export { type RenderOptions, type RenderResult, renderComposition } from './render/renderer.ts';
export * from './spec.ts';
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
export { loadTemplates, type StoryTemplate, selectTemplate, TemplateSchema } from './templates.ts';
export {
  buildTimeline,
  estimateSpeech,
  fitToDuration,
  layoutScenes,
  minSecondsFor,
  TRANSITION,
} from './timeline/build.ts';
export type * from './timeline/types.ts';
