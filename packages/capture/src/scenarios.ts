import { mkdir, rm } from 'node:fs/promises';
import {
  type BehaviorDiff,
  DEMO_PATHS,
  type DemoRecording,
  type DemoRecordingStatus,
  type DemoRevision,
  type DemoShot,
  demoPath,
  type Flow,
  type Run,
  type Trace,
} from '@covi/core';
import type { Browser } from 'playwright';
import {
  diffBehavior,
  PIXEL_FLOOR,
  type ScenarioObservation,
  type StepPixels,
} from './behavior.ts';
import { type FlowRun, runFlow, VIEWPORT_PRESETS, type ViewportName } from './browser.ts';
import { comparePngs, readPng } from './pixels.ts';
import { type FinalRecording, finalizeRecording } from './recording.ts';
import { TraceCollector } from './trace.ts';

/** A path inside the run, relative to it: how captures.json and traces name files. */
export function runRelative(run: Run, file: string): string {
  return file.startsWith(run.dir) ? file.slice(run.dir.length + 1) : file;
}

export interface RecordingNote {
  status: 'webm' | 'unavailable';
  cause: NonNullable<DemoRecordingStatus['cause']>;
  detail?: string;
}

export interface ObservedFlow {
  outcome: FlowRun;
  trace: Trace;
  recording?: DemoRecording;
  /** Why the recording is a WebM or missing; absent for an MP4 or when not asked for. */
  note?: RecordingNote;
}

export interface ObserveFlowInput {
  run: Run;
  browser: Browser;
  baseUrl: string;
  flow: Flow;
  scenario: string;
  viewport: ViewportName;
  revision: DemoRevision;
  record: boolean;
  /** Scan each frame for the subject model. */
  scan?: boolean;
  ffmpeg: () => Promise<string | undefined>;
}

/**
 * Saves the flow's WebM as MP4 (or WebM) under its scenario's name. Any failure, including a video
 * file that is not there, leaves the flow unrecorded rather than failing the demonstration.
 */
async function saveRecording(
  input: ObserveFlowInput,
  outcome: FlowRun,
): Promise<{ saved?: FinalRecording; note?: RecordingNote }> {
  const { run, scenario, revision } = input;
  if (!outcome.video)
    return {
      note: {
        status: 'unavailable',
        cause: 'no-recorder',
        ...(outcome.recordError ? { detail: outcome.recordError } : {}),
      },
    };
  try {
    const saved = await finalizeRecording(
      outcome.video,
      {
        mp4: run.path(demoPath.recording(scenario, revision, 'mp4')),
        webm: run.path(demoPath.recording(scenario, revision, 'webm')),
      },
      await input.ffmpeg(),
    );
    if (!saved.cause) return { saved };
    const detail = saved.detail ? { detail: saved.detail } : {};
    return { saved, note: { status: 'webm', cause: saved.cause, ...detail } };
  } catch (error) {
    // Paths in the message are made run-relative, like every other path in captures.json.
    const detail = (error as Error).message.split('\n')[0]!.split(`${run.dir}/`).join('');
    return { note: { status: 'unavailable', cause: 'save-failed', detail } };
  }
}

/** Runs one flow at one revision with its trace (and recording), and writes the trace. */
export async function observeFlow(input: ObserveFlowInput): Promise<ObservedFlow> {
  const { run, flow, scenario, revision, viewport } = input;
  const preset = VIEWPORT_PRESETS[viewport];
  const id = `${scenario}-${revision}`;
  const collector = new TraceCollector(
    { id, scenario, kind: 'flow', name: flow.name, revision, viewport, path: flow.path },
    {
      origin: new URL(input.baseUrl).origin,
      redactor: run.redactor,
      relative: (file) => runRelative(run, file),
    },
  );
  // Playwright names its video file itself; a directory of the flow's own keeps runs apart.
  const recordDir = input.record
    ? run.path(demoPath.rawRecordingDir(scenario, revision))
    : undefined;
  if (recordDir) await mkdir(recordDir, { recursive: true });
  let outcome: FlowRun;
  let saved: FinalRecording | undefined;
  let note: RecordingNote | undefined;
  try {
    outcome = await runFlow(
      input.browser,
      input.baseUrl,
      flow,
      viewport,
      (i) => run.path(demoPath.flowFrame(scenario, i + 1, revision)),
      { recordDir, trace: collector, scan: input.scan },
    );
    if (input.record) ({ saved, note } = await saveRecording(input, outcome));
  } finally {
    if (recordDir) await rm(recordDir, { recursive: true, force: true });
  }
  collector.stop();
  const path = saved ? runRelative(run, saved.file) : undefined;
  const trace = collector.finish({ title: outcome.title, recording: path, error: outcome.error });
  await run.writeJson(demoPath.trace(scenario, revision), trace, 'trace');
  if (!saved || !path) return { outcome, trace, ...(note ? { note } : {}) };
  await run.record(path, 'recording');
  return {
    outcome,
    trace,
    recording: {
      id: trace.id,
      scenario,
      flow: flow.name,
      revision,
      viewport,
      path,
      format: saved.format,
      width: preset.width,
      height: preset.height,
      seconds: trace.durationMs / 1000,
    },
    ...(note ? { note } : {}),
  };
}

/** Compares each step's base and head screenshots; keeps a diff image for steps that look different. */
export async function compareSteps(
  run: Run,
  scenario: string,
  viewport: ViewportName,
  base: Trace,
  head: Trace,
): Promise<Record<string, StepPixels>> {
  const scale = VIEWPORT_PRESETS[viewport].deviceScaleFactor;
  const minPixels = PIXEL_FLOOR * scale * scale;
  const before = new Map(
    base.steps.flatMap((s) => (s.screenshot ? [[s.id, s.screenshot] as const] : [])),
  );
  const out: Record<string, StepPixels> = {};
  await mkdir(run.path(DEMO_PATHS.diffs), { recursive: true });
  for (const step of head.steps) {
    const from = before.get(step.id);
    if (!from || !step.screenshot) continue;
    const rel = demoPath.stepDiff(scenario, step.id);
    const diff = await comparePngs(run.path(from), run.path(step.screenshot), run.path(rel), {
      minPixels,
    });
    const written = diff.changedPixels >= minPixels;
    if (written) await run.record(rel, 'screenshot');
    out[step.id] = {
      changedPixels: diff.changedPixels,
      changedRatio: diff.changedRatio,
      regions: diff.regions,
      ...(diff.bounds ? { bounds: diff.bounds } : {}),
      ...(written ? { diff: rel } : {}),
    };
  }
  return out;
}

/** Flow-step shots from the head frames, each with the base frame of the same step as `before`. */
export async function flowShots(
  run: Run,
  input: {
    scenario: string;
    flow: Flow;
    viewport: ViewportName;
    head: FlowRun;
    base?: FlowRun;
    pixels: Record<string, StepPixels>;
  },
): Promise<DemoShot[]> {
  const before = new Map((input.base?.frames ?? []).map((f) => [f.step, f]));
  const shots: DemoShot[] = [];
  for (const [i, frame] of input.head.frames.entries()) {
    const size = await readPng(frame.file);
    const base = before.get(frame.step);
    const baseSize = base ? await readPng(base.file) : undefined;
    const pixels = input.pixels[frame.step];
    shots.push({
      id: `${input.scenario}-${i + 1}`,
      kind: 'flow-step',
      name: frame.label,
      flow: input.flow.name,
      step: i + 1,
      viewport: input.viewport,
      ...(base && baseSize
        ? {
            before: {
              path: runRelative(run, base.file),
              width: baseSize.width,
              height: baseSize.height,
            },
          }
        : {}),
      after: { path: runRelative(run, frame.file), width: size.width, height: size.height },
      ...(pixels
        ? {
            diff: {
              ...(pixels.diff ? { path: pixels.diff } : {}),
              changedRatio: Number(pixels.changedRatio.toFixed(5)),
              ...(pixels.bounds ? { bounds: pixels.bounds } : {}),
            },
          }
        : {}),
      click: frame.click,
      focus: frame.focus,
      label: frame.label,
    });
  }
  return shots;
}

export async function writeBehaviorDiff(
  run: Run,
  observations: readonly ScenarioObservation[],
): Promise<BehaviorDiff> {
  const diff = diffBehavior(observations);
  await run.writeJson(DEMO_PATHS.behaviorDiff, diff, 'behavior-diff');
  return diff;
}

/** How recording went, for captures.json and demo.md. */
export function recordingStatus(
  enabled: boolean,
  notes: readonly RecordingNote[],
  recorded: number,
): DemoRecordingStatus {
  if (!enabled) return { status: 'off' };
  const unavailable = notes.find((n) => n.status === 'unavailable');
  if (unavailable)
    return {
      status: 'unavailable',
      cause: unavailable.cause,
      ...(unavailable.detail ? { detail: unavailable.detail } : {}),
    };
  const webm = notes.find((n) => n.status === 'webm');
  if (webm)
    return { status: 'webm', cause: webm.cause, ...(webm.detail ? { detail: webm.detail } : {}) };
  return recorded > 0 ? { status: 'mp4' } : { status: 'unavailable', cause: 'no-recorder' };
}
