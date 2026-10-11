import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEMO_PATHS,
  type Demonstration,
  demoPath,
  EvidenceFileSchema,
  type EvidenceIndex,
  indexEvidence,
  parseOrThrow,
  RUN_PATHS,
  resolveChange,
  seedFrom,
} from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  directionImages,
  fitToDuration,
  loadTemplates,
  orientationOf,
  pacingFor,
  type QcCheck,
  type Storyboard,
  StoryboardSchema,
  type Timeline,
  type VideoSpec,
} from '@covi/video';
import {
  droppedBeatsCheck,
  motionBusyCheck,
  motionGapCheck,
  readingTimeCheck,
} from '../../packages/video/src/choreography.ts';
import { monotonyCheck, transitionVarietyCheck } from '../../packages/video/src/density.ts';
import { planDirection } from '../../packages/video/src/direction/plan.ts';
import { resolveDirection } from '../../packages/video/src/direction/resolve.ts';
import { type Direction, DirectionSchema } from '../../packages/video/src/direction/schema.ts';
import {
  type DirectionSources,
  diffFiles,
  directionSources,
} from '../../packages/video/src/direction/sources.ts';
import { storyboardImages } from '../../packages/video/src/pipeline.ts';

/**
 * Directing a run as `covi render` does, without drawing a frame: the steps of `produceVideo`
 * (packages/video/src/pipeline.ts) from the storyboard to the timeline, with Covi's estimate of
 * each line's speech in place of a voice. For a captions-only run that is Covi's timeline exactly
 * (a captions-only render test checks it); for a narrated one it is an estimate, since the render
 * times each line by its take.
 */

/** What a run holds for directing its video. */
export interface VideoRun {
  runDir: string;
  storyboard: Storyboard;
  evidence: EvidenceIndex;
  sources: DirectionSources;
  spec: VideoSpec;
}

/** Reads a run `covi video` wrote, drafted or rendered: storyboard, evidence, demo, change, spec. */
export async function readVideoRun(runDir: string, repo: string): Promise<VideoRun> {
  const has = (rel: string) => existsSync(join(runDir, rel));
  const text = (rel: string) => readFileSync(join(runDir, rel), 'utf8');
  const read = (rel: string): unknown => JSON.parse(text(rel));
  const evidence = indexEvidence(
    parseOrThrow(EvidenceFileSchema, read(RUN_PATHS.evidence), 'evidence.json'),
  );
  // The change as the run recorded it, the way `covi render` reloads it.
  const { change: recorded } = read('run.json') as {
    change: { base: { sha: string }; head: { sha: string } };
  };
  const change = await resolveChange({
    repo,
    range: `${recorded.base.sha}..${recorded.head.sha}`,
    scope: 'committed',
  });
  // The sources `produceVideo` reads: the diff the evidence was built from, the demo, and the
  // app's start-up logs.
  const appLogs: Partial<Record<'base' | 'head', string>> = {};
  for (const revision of ['base', 'head'] as const)
    if (has(demoPath.appLog(revision))) appLogs[revision] = text(demoPath.appLog(revision));
  return {
    runDir,
    storyboard: StoryboardSchema.parse(read('video/storyboard.json')),
    evidence,
    sources: directionSources({
      files: has(RUN_PATHS.diff) ? diffFiles(text(RUN_PATHS.diff), change.files) : change.files,
      demo: has(DEMO_PATHS.captures) ? (read(DEMO_PATHS.captures) as Demonstration) : undefined,
      evidence,
      appLogs,
      redact: (value) => value,
    }),
    spec: (read('video/decision.json') as { spec: VideoSpec }).spec,
  };
}

/**
 * The timeline a captions-only render of this run draws, and a narrated one's estimate: `direction`
 * (an agent's file; none for Covi's default director) checked and merged as `planDirection` does,
 * the scenes timed with estimated speech (paced as narrated unless the spec turns narration off),
 * and the shots resolved against the run's evidence. Rejects with the `UsageError` `covi render`
 * exits 2 with.
 */
export async function directedTimeline(
  run: VideoRun,
  direction?: unknown,
): Promise<{ plan: Direction; timeline: Timeline }> {
  const { storyboard, evidence, sources, spec } = run;
  const scenes = storyboard.scenes.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` }));
  // As the render resolves it: a language the request named wins over the storyboard's.
  const language = spec.language ?? storyboard.language ?? 'en';
  const seed = seedFrom(storyboard.title);
  const directed = planDirection({
    mode: 'auto',
    file:
      direction === undefined
        ? undefined
        : parseOrThrow(DirectionSchema, direction, 'video/direction.json'),
    authored: scenes,
    scenes,
    evidence,
    sources,
    seed,
    orientation: orientationOf(spec.width, spec.height),
  });
  const plan = directed.plan!;
  const hero = (await loadTemplates()).get(storyboard.template)?.hero;
  // The render paces by whether a voice speaks; here, by whether the spec asks for one.
  const fit = fitToDuration(
    { ...storyboard, scenes },
    new Map(),
    spec,
    language,
    pacingFor(spec, hero, spec.narration.enabled),
    directed.entrances,
  );
  const assets = new AssetCollector(run.runDir);
  await assets.prepare([...storyboardImages(storyboard), ...directionImages(plan, sources)]);
  const staging = resolveDirection({
    plan,
    scenes: fit.scenes,
    layout: fit.layout,
    spec,
    language,
    sources,
    image: assets.image,
    seed,
    redact: (value) => value,
  });
  const timeline = buildTimeline({
    title: storyboard.title,
    scenes: fit.scenes,
    layout: fit.layout,
    spec,
    image: assets.image,
    language,
    entrances: directed.entrances,
    staging,
  });
  return { plan, timeline };
}

/** The checks that read the timeline alone: what QC says about a video before a frame is drawn. */
export const TIMELINE_CHECKS = [
  'monotony',
  'transition-variety',
  'motion-gap',
  'motion-busy',
  'reading-time',
  'dropped-beats',
] as const;

export function timelineChecks(timeline: Timeline): QcCheck[] {
  return [
    monotonyCheck(timeline),
    transitionVarietyCheck(timeline),
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    droppedBeatsCheck(timeline),
  ];
}
