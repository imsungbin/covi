import type { DemoRevision } from '../model/behavior.ts';

/**
 * Where the Demonstrate phase writes inside a run. Every stage and command that reads or writes
 * these files uses this module, so a path is defined once.
 */
export const DEMO_PATHS = {
  plan: 'demo/plan.json',
  captures: 'demo/captures.json',
  notes: 'demo/demo.md',
  screenshots: 'demo/screenshots',
  diffs: 'demo/diffs',
  recordings: 'demo/recordings',
  traces: 'demo/traces',
  behaviorDiff: 'demo/behavior-diff.json',
  /** This run's view of the subject model, and where elements are in each head capture. */
  subject: 'demo/subject.json',
} as const;

/** Files at the top of a run that more than one stage writes or reads. */
export const RUN_PATHS = {
  diff: 'diff.patch',
  /** The evidence registry: every id a claim may cite. */
  evidence: 'evidence.json',
  /** The test command and the tail of its output, when tests ran. */
  testsLog: 'tests.log',
} as const;

/**
 * Where the subject model lives: in the repository (meant to be committed), or next to the runs
 * (`subject.json` in the runs directory, which ignores itself). The lock sits in the runs directory
 * for every store, so it never shows up in `git status`.
 */
export const SUBJECT_PATHS = {
  repo: '.covi/subject/subject.json',
  runs: 'subject.json',
  lock: '.subject.lock',
} as const;

const frameNumber = (n: number) => String(n).padStart(2, '0');

/** Run-relative paths of the files one scenario (a page at a viewport, or a flow) produces. */
export const demoPath = {
  /** A page's full-height capture at one revision; the crops come from it. */
  pageFull: (page: string, revision: DemoRevision) =>
    `${DEMO_PATHS.screenshots}/${page}-${revision}.full.png`,
  /** A page's viewport-sized crop around the change: `before` is base, `after` is head. */
  pageCrop: (page: string, side: 'before' | 'after') =>
    `${DEMO_PATHS.screenshots}/${page}-${side}.png`,
  pageDiff: (page: string) => `${DEMO_PATHS.diffs}/${page}.png`,
  /** A flow frame, numbered from 1; head frames keep the names they had before base ran too. */
  flowFrame: (scenario: string, frame: number, revision: DemoRevision) =>
    `${DEMO_PATHS.screenshots}/${scenario}-${frameNumber(frame)}${revision === 'base' ? '-base' : ''}.png`,
  stepDiff: (scenario: string, step: string) => `${DEMO_PATHS.diffs}/${scenario}-${step}.png`,
  recording: (scenario: string, revision: DemoRevision, format: 'mp4' | 'webm') =>
    `${DEMO_PATHS.recordings}/${scenario}-${revision}.${format}`,
  /**
   * Where Playwright writes one flow's raw WebM, under a name it picks; removed once the recording
   * is saved. Hidden, so a run killed mid-flow leaves nothing that looks like a recording.
   */
  rawRecordingDir: (scenario: string, revision: DemoRevision) =>
    `${DEMO_PATHS.recordings}/.${scenario}-${revision}`,
  trace: (scenario: string, revision: DemoRevision) =>
    `${DEMO_PATHS.traces}/${scenario}-${revision}.json`,
  /** Why the app did not start at a revision: the evidence an `app-start` finding cites. */
  appLog: (revision: DemoRevision) => `demo/app-${revision}.log`,
} as const;

// Defined with the outcome model, which validates run ids too; paths are found here.
export { RUN_ID_PATTERN } from '../model/outcome.ts';
