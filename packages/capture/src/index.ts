export { freePort, type RunningApp, startApp, substitute, waitForReady } from './app.ts';
export {
  diffBehavior,
  diffConsole,
  diffNetwork,
  diffScenario,
  diffSteps,
  diffTiming,
  PIXEL_FLOOR,
  type ScenarioObservation,
  type StepPixels,
  TIMING_THRESHOLD,
} from './behavior.ts';
export {
  capturePage,
  contextOptions,
  type FlowFrame,
  type FlowOptions,
  type FlowRun,
  newContext,
  type PageCapture,
  runFlow,
  stepId,
  VIEWPORT_PRESETS,
  type ViewportName,
} from './browser.ts';
export { type Checkout, checkoutRevision, tempWorkspace } from './checkout.ts';
export { type DemonstrateInput, demonstrate } from './demonstrate.ts';
export {
  isFocusSecret,
  isSecretField,
  type PageScan,
  parseScan,
  quoteSelector,
  SCAN_ELEMENTS,
  type ScannedElement,
  scanPage,
  selectorFor,
} from './elements.ts';
export { flowScenario, pageScenario, slug, uniqueIds } from './ids.ts';
export { collectMutations, MUTATION_SCRIPT, observe } from './observe.ts';
export { comparePngs, cropPng, type PixelDiff, readPng } from './pixels.ts';
export {
  type DemoPlan,
  DemoPlanSchema,
  MAX_PROPOSED_FLOWS,
  planDemo,
  proposeFlows,
} from './plan.ts';
export { type FinalRecording, finalizeRecording, RecordingUnavailableError } from './recording.ts';
export { changedRegions, MAX_REGIONS, mergeRegions } from './regions.ts';
export {
  describeShapeChange,
  type HttpResult,
  normalizeBody,
  performRequest,
  shapeOf,
} from './requests.ts';
export {
  compareSteps,
  flowShots,
  type ObservedFlow,
  type ObserveFlowInput,
  observeFlow,
  type RecordingNote,
  recordingStatus,
  runRelative,
  writeBehaviorDiff,
} from './scenarios.ts';
export {
  focusShots,
  frameWindow,
  inImage,
  type SubjectCaptures,
  type SubjectFlowRun,
  type SubjectFrame,
  type SubjectPage,
  subjectFocus,
  subjectImages,
  subjectObservation,
  subjectPageImage,
} from './subject.ts';
export { TRACE_LIMITS, TraceCollector, type TraceMeta, type TraceOptions } from './trace.ts';
