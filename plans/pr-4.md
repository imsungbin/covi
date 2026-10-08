# PR 4 — Behavior Diff Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every browser flow runs at base and head with a recording and a redacted JSON trace, every page load gets a trace, and `demo/behavior-diff.json` deterministically compares the two revisions, summarized in `demo/demo.md`.

**Architecture:** Shared types and run paths live in `@covi/core` (`model/behavior.ts`, `run/paths.ts`), which also gets `demo.record` and URL-aware redaction. `@covi/capture` gets pure modules that are unit-tested without a browser: `regions.ts` (where pixels or DOM changed), `trace.ts` (`TraceCollector`), and `behavior.ts` (`diffBehavior`). A Playwright adapter (`observe.ts`, plus changes to `browser.ts`) feeds the collector and records video. `recording.ts` converts WebM to MP4 when ffmpeg is present. `scenarios.ts` joins these in `demonstrate()`. The CLI adds `--record`/`--no-record`, finds ffmpeg through `@covi/video`'s `Media.locate()` (capture may not import video, so the CLI injects it), exits 3 only for an explicit recording request it cannot honor, and appends the behavior section to `demo/demo.md`.

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, `.ts` imports), Playwright 1.63 (`recordVideo`, request/console events, `addInitScript`), pixelmatch and pngjs, system ffmpeg (optional), Zod (config), Vitest, Biome.

**Spec:** `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/SPEC.md`, section "PR 4 — Behavior diff capture". It also binds "Global constraints" and "Vocabulary", and constrains these shapes because PR 5 (evidence ids) and PR 6 (subject model) build on them. The repository's `AGENTS.md` is binding.

**Where to work:** the worktree for branch `behavior-diff-capture`. Run every command from the repository root. Before Task 1, rebase onto the current `main`. PR 1 may have landed `CHANGELOG.md`, which Task 9 needs.

---

## Global Constraints

Copied verbatim from the spec's "Global constraints (bind every PR)":

- Follow `/Users/a10637/projects/covi/AGENTS.md` exactly (architecture rules, dependency
  direction, security model, code style, i18n catalogs ×4, derived files, test expectations).
- TypeScript on Node 22, `.ts` imports, `import type`, no enums/namespaces. Biome format.
- Code comments, commit messages, PR text, CHANGELOG: English. Comments explain why.
- No spec/plan/design documents are added to the repository. Existing product docs under
  `docs/` are updated only where they describe behavior that changed.
- `CHANGELOG.md` at the repo root, Keep a Changelog format. PR 1 creates it with
  `## [Unreleased]`; every later PR adds one concise line under Added/Changed/Fixed. No PR
  except PR 8 touches any `version` field.
- Schemas: additive only (new optional fields). A breaking change to a `schemaVersion` file
  bumps the version and updates the skill that describes it.
- Every deterministic behavior has tests (positive and negative). Rules in
  `packages/core/src/review/rules/` need a firing and a quiet test.
- Runtime components: pure functions of frame time; no Date/Math.random/CSS animation.
- Sound engine: deterministic; bump `AUDIO_ENGINE_VERSION` whenever rendered audio changes.
- Text for people goes through `templates/i18n/*.yml` (en, ko, ja, zh), never literals.
- `npm run check` green before any PR is opened. Render tests (`npm run test:render`) are
  run locally for PRs touching `packages/video` or `packages/audio`.
- Commits authored by the default git identity; no Claude authorship. Commit messages end
  with `Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh`.

Repository rules that matter most here (from `AGENTS.md`):

- Dependency direction: `capture` imports only `core` (a test enforces it). `cli` may import `capture` and `video`. Nothing here touches `packages/video` or `packages/audio`, so render tests are not required.
- Every artifact goes through the `Redactor` and is registered in `run.json` with sha256: `run.writeJson`, `run.writeText`, and `run.record`.
- Paths are defined once, in code. This PR adds `packages/core/src/run/paths.ts` and moves the demo paths into it.
- Text for people goes through the four catalogs with identical placeholders. Log and error messages stay in English.
- No `Date`/`Math.random` in deterministic code. The diff and region code is pure. Capture timing uses `performance.now()`, which is an observation, not a rendering input.

## Decisions (where the spec leaves a choice)

1. **Flows now run at base too.** Today they run only at head (`demonstrate.ts`, `if (revision === 'head')`). The spec's "same scenario at base and head" requires both. A flow that fails at base is not a finding (the change may add what it uses). Only head failures keep producing the existing `flow-failure` finding. Head flow frames keep their file names. Base frames are `…-NN-base.png` and become each flow-step shot's `before`.
2. **Scenarios include pages.** The spec says "per flow". The diff also lists page loads (`kind: 'page'`, one step `load`) because pages already have traces, and PR 5 and PR 6 benefit. This is a superset.
3. **Ids.** Scenario ids reuse the existing shot-id scheme: flows are `flow-<slug>`, pages are `<slug>-<viewport>`. Flow ids are de-duplicated (`-2`, `-3`). A trace id is `<scenario>-<revision>` and doubles as its file stem. Step ids are the same at both revisions: `open`, `load`, `s1`…`sN` (plan order), and `end`. Within a trace, requests are `n1…` and console messages `c1…`. In the diff, regions are `r1…` within a step. The citation forms for PR 5 are `<trace>#<id>` (e.g. `flow-load-items-head#n2`) and `<scenario>#<step>.<region>` (e.g. `flow-load-items#end.r1`).
4. **What is compared.** Requests are matched by `METHOD path`. The query string is excluded from the key because cache busters and polling stamps vary. Requests are reported as added or removed only when the key is absent on the other side. Extra occurrences of the same key (polling) are ignored. Paired requests are "changed" when status or failure differs. Console comparison covers errors only (`error`, `assert`, `pageerror`), as a set of `level + text` with runs of four or more digits normalized. Chrome's `Failed to load resource:` lines are skipped because the network diff already reports them. A step "looks different" at `changedRatio ≥ 0.0005`, the threshold the storyboard drafter uses. A timing delta is reported at `|Δ| ≥ max(500 ms, 50 % of base)`. **Timing never makes a scenario `changed` on its own** because it is noisy.
5. **Recording.** The recording size is the viewport in CSS pixels (1280×800 on desktop, 390×844 on mobile). Playwright's default would shrink it to fit 800×800. When ffmpeg is present, the WebM becomes `demo/recordings/<flow>-<rev>.mp4` (libx264, else mpeg4). The `.webm` is kept when ffmpeg is missing or the conversion fails, and `captures.json` → `recording` plus `demo.md` say why. When Playwright's own recorder binary is missing, `newPage` throws (verified). The flow then runs unrecorded with `recording.status: 'unavailable'`.
6. **Explicit request.** A request is explicit when `demo.record: true` is set by a layer other than the defaults: `--record`, `COVI_DEMO_RECORD`, or the repository's `.covi/config.yml`. Provenance decides, using the same rule as `providedVideoKeys`. When an explicit request cannot be honored (Chromium missing while flows are planned, or recorder missing), `demonstrate` throws `RecordingUnavailableError` (an `EnvironmentError`, exit 3), and the CLI and CI let it through. Otherwise nothing changes: `covi demo` still exits 3 when Chromium is missing (existing behavior), and `review --demo`, `video`, and `ci` still warn and continue.
7. **ffmpeg discovery.** This reuses `Media.locate()` from `@covi/video` (`COVI_FFMPEG`, else PATH). `capture` cannot import `video`, so `demonstrate()` takes `locateFfmpeg?: () => Promise<string | undefined>` and the CLI passes `() => Media.locate().then((m) => m.ffmpegPath, () => undefined)`. Without the hook, recordings stay WebM.
8. **Trace contents.** Each trace has step timing, requests (method, app-relative URL, resource type, status or failure, start, duration), console messages (level, source, text, location), and DOM-change counts and regions after load. It never holds headers or bodies. URLs on the app's origin are stored relative, so base and head (different ports) compare. `Redactor.redactUrl` masks credential-shaped query and fragment parameters, then `run.writeJson` redacts everything again. Playwright's `trace.zip` is never produced.
9. **Where the diff text goes.** `demonstrate()` writes `demo/behavior-diff.json` and puts a pointer in `captures.json` (`behavior: { path, scenarios, changed }`). The CLI reads the file and passes it to `renderDemo(demo, language, behavior)`. Without it the output is byte-identical to today, so the English baseline holds.
10. **When `behavior-diff.json` is written.** It is written only when both revisions ran (not in `app.url` mode) and at least one scenario was observed. A scenario missing one side is `incomplete`.

## Review Focus

Five inputs that the spec implies and that bite users. Each one is pinned by a test in its owning task.

1. **Two flows whose names give the same id** ("Post comment" and "post-comment"). They should get distinct scenario ids, and no recording, trace, or frame should overwrite another. Covered by Task 7, `uniqueIds` and `flowScenario` tests.
2. **A flow that cannot run at base** because the change adds the button it clicks. This should produce no finding. The diff should show `base: 'failed'` at the step where base stopped and `failure.base`, with the scenario `changed`. Covered by Task 5 (pure) and Task 7 (the integration "Retry" flow).
3. **Secrets in request URLs and console text** (`?session=…`, `#access_token=…`, a token-shaped string logged by the page). These must never reach traces, `behavior-diff.json`, `captures.json`, or `demo.md`. Covered by Task 2 (`redactUrl`/`redactUrls`), Task 4 (the collector), and Task 7 (a grep of every written file).
4. **Polling, cache-busting queries, and timing jitter.** These should produce no added or removed noise, and timing alone should never flip a scenario to `changed`. Covered by Task 5.
5. **App given by `app.url`** (head only). It should record and trace the head only, write no `behavior-diff.json`, and not crash. Covered by Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/run/paths.ts` (new) | `DEMO_PATHS` and `demoPath.*`: every demo artifact path, defined once |
| `packages/core/src/model/behavior.ts` (new) | Types: `Trace`, steps, requests, console, mutations, `BehaviorDiff`, `ScenarioDiff`, ids |
| `packages/core/src/model/demo.ts` | `Demonstration` gains optional `recordings`, `recording`, `traces`, `behavior` |
| `packages/core/src/run/run.ts` | `ArtifactKind` gains `'trace'` and `'behavior-diff'` |
| `packages/core/src/config/schema.ts`, `resolve.ts` | `demo.record` (default `true`), `COVI_DEMO_RECORD` |
| `packages/core/src/security/redact.ts` | `Redactor.redactUrl`, `Redactor.redactUrls` |
| `packages/capture/src/regions.ts` (new) | `mergeRegions`, `changedRegions` (pure) |
| `packages/capture/src/pixels.ts` | `PixelDiff.regions`; `comparePngs(..., { minRatio })` |
| `packages/capture/src/trace.ts` (new) | `TraceCollector` (pure, injectable clock) |
| `packages/capture/src/behavior.ts` (new) | `diffBehavior` and its parts (pure) |
| `packages/capture/src/recording.ts` (new) | `finalizeRecording`, `RecordingUnavailableError` |
| `packages/capture/src/observe.ts` (new) | Playwright → collector wiring; DOM mutation init script |
| `packages/capture/src/browser.ts` | `contextOptions`, recording contexts, traced `capturePage` and `runFlow`, step ids |
| `packages/capture/src/ids.ts` (new) | `slug`, `uniqueIds`, `flowScenario`, `pageScenario` |
| `packages/capture/src/scenarios.ts` (new) | `observeFlow`, `compareSteps`, `flowShots`, `writeBehaviorDiff`, `recordingStatus` |
| `packages/capture/src/demonstrate.ts` | Flows at both revisions, page traces, behavior diff, recording policy |
| `packages/cli/src/main.ts`, `workflows.ts`, `ci.ts` | Flags, policy, ffmpeg hook, exit 3, `demo.md` sections |
| `templates/i18n/{en,ko,ja,zh}.yml` | `demo.recordings`, `demo.recording.*`, `demo.behavior.*` |
| `tests/helpers/behavior-app.ts` (new) | The tiny static app: one changed request and one new console error |
| Docs and skills | `skills/covi-demo/SKILL.md`, `skills/covi/SKILL.md`, `docs/{artifacts,configuration,cli,architecture,security,video}.md`, `AGENTS.md`, `CHANGELOG.md` |

No example's `change.yml` lists artifacts, so no example expectation changes.

---

### Task 1: Core — demo paths, behavior model, artifact kinds, and `demo.record`

**Files:**
- Create: `packages/core/src/run/paths.ts`
- Create: `packages/core/src/model/behavior.ts`
- Modify: `packages/core/src/model/demo.ts`
- Modify: `packages/core/src/run/run.ts:12-37` (ArtifactKind)
- Modify: `packages/core/src/index.ts` (exports)
- Modify: `packages/core/src/config/schema.ts` (`demo` input, `CoviConfig.demo`, `DEFAULT_CONFIG.demo`)
- Modify: `packages/core/src/config/resolve.ts` (`configFromEnv`)
- Test: `packages/core/test/run.test.ts`, `packages/core/test/config.test.ts`

**Interfaces:**
- Produces: `DEMO_PATHS`, `demoPath.{pageFull,pageCrop,pageDiff,flowFrame,stepDiff,recording,trace}` and the types `DemoRevision`, `DemoViewport`, `ConsoleLevel`, `MutationSummary`, `TraceStep`, `TraceRequest`, `TraceConsole`, `Trace`, `StepState`, `StepDiff`, `RequestRef`, `NetworkEntry`, `NetworkChange`, `ConsoleEntry`, `TimingDelta`, `ScenarioDiff`, `BehaviorDiff`, `DemoRecording`, `DemoRecordingStatus`, `DemoTraceRef`. It also produces `ArtifactKind` members `'trace' | 'behavior-diff'`, `CoviConfig['demo']['record']: boolean`, and the env var `COVI_DEMO_RECORD`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/run.test.ts`, and add `import { DEMO_PATHS, demoPath } from '../src/run/paths.ts';` to its imports:

```ts
describe('demo paths', () => {
  it('names every file a scenario produces inside demo/', () => {
    expect(demoPath.trace('flow-load-items', 'base')).toBe('demo/traces/flow-load-items-base.json');
    expect(demoPath.recording('flow-load-items', 'head', 'mp4')).toBe(
      'demo/recordings/flow-load-items-head.mp4',
    );
    expect(demoPath.recording('flow-load-items', 'base', 'webm')).toBe(
      'demo/recordings/flow-load-items-base.webm',
    );
    // Head frames keep the names they had before flows also ran at base.
    expect(demoPath.flowFrame('flow-load-items', 3, 'head')).toBe(
      'demo/screenshots/flow-load-items-03.png',
    );
    expect(demoPath.flowFrame('flow-load-items', 3, 'base')).toBe(
      'demo/screenshots/flow-load-items-03-base.png',
    );
    expect(demoPath.stepDiff('flow-load-items', 'end')).toBe('demo/diffs/flow-load-items-end.png');
    expect(demoPath.pageFull('home-desktop', 'base')).toBe(
      'demo/screenshots/home-desktop-base.full.png',
    );
    expect(demoPath.pageCrop('home-desktop', 'after')).toBe('demo/screenshots/home-desktop-after.png');
    expect(demoPath.pageDiff('home-desktop')).toBe('demo/diffs/home-desktop.png');
    for (const path of Object.values(DEMO_PATHS)) expect(path.startsWith('demo/')).toBe(true);
  });
});
```

Append inside `describe('configuration', …)` in `packages/core/test/config.test.ts`:

```ts
  it('records browser flows by default; demo.record and COVI_DEMO_RECORD turn it off', () => {
    expect(resolveConfig([]).config.demo.record).toBe(true);
    const repo = resolveConfig([
      {
        name: 'repository',
        source: '.covi/config.yml',
        values: parseConfigInput({ demo: { record: false } }, 't'),
      },
    ]);
    expect(repo.config.demo.record).toBe(false);
    expect(repo.provenance['demo.record']).toBe('repository (.covi/config.yml)');
    expect(configFromEnv({ COVI_DEMO_RECORD: '0' }).demo?.record).toBe(false);
    expect(configFromEnv({ COVI_DEMO_RECORD: 'yes' }).demo?.record).toBe(true);
    expect(() => parseConfigInput({ demo: { record: 'yes' } }, 't')).toThrow(/demo\.record/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/run.test.ts packages/core/test/config.test.ts`
Expected: FAIL. `run.test.ts` cannot resolve `../src/run/paths.ts`. In `config.test.ts`, `config.demo.record` is `undefined`, and `parseConfigInput` rejects `record` as an unknown key.

- [ ] **Step 3: Implement**

`packages/core/src/model/behavior.ts`:

```ts
import type { Rect } from './demo.ts';

/**
 * Evidence of behavior: what a page load or a flow did at one revision (a trace), and the
 * deterministic comparison of base and head (the behavior diff). Ids are stable within a run:
 * `<trace>#<step|request|message>` (e.g. `flow-load-items-head#n2`) and
 * `<scenario>#<step>.<region>` (e.g. `flow-load-items#end.r1`) each name one piece of evidence.
 */

export type DemoRevision = 'base' | 'head';
export type DemoViewport = 'desktop' | 'tablet' | 'mobile';
export type ConsoleLevel = 'error' | 'warning' | 'info' | 'log' | 'debug';

/** DOM changes after the page loaded: how many, and where (image pixels, merged, at most six). */
export interface MutationSummary {
  count: number;
  regions: Rect[];
}

export interface TraceStep {
  /**
   * `open` (a flow's first navigation), `load` (a page capture), `s1`… (the flow's steps in plan
   * order), or `end` (the final frame). The same at base and head, so steps pair up.
   */
  id: string;
  /** `goto`, `click`, `fill`, `press`, `hover`, `select`, `check`, `scroll`, `wait`, `screenshot`, or `end`. */
  action: string;
  /** The selector or path the step acts on. */
  target?: string;
  label?: string;
  /** Seconds from the start of the trace, which is also the start of its recording. */
  t: number;
  durationMs: number;
  status: 'ok' | 'failed';
  error?: string;
  /** The frame taken for this step (just before its action, or at a screenshot step), run-relative. */
  screenshot?: string;
  /** The target's bounding box in image pixels when the frame was taken. */
  box?: Rect;
  /** What the step's action changed in the DOM, read at the end of the step. */
  mutations?: MutationSummary;
}

export interface TraceRequest {
  /** `n1`, `n2`…, in the order requests started. */
  id: string;
  /** The step running when the request started. */
  step?: string;
  method: string;
  /** Relative (`/api/items?page=2`) on the app's own origin, absolute elsewhere; redacted. */
  url: string;
  /** Playwright's resource type: `document`, `script`, `fetch`, `xhr`, `image`, … */
  type: string;
  status?: number;
  failure?: string;
  /** Milliseconds from the start of the trace. */
  startMs: number;
  durationMs?: number;
}

export interface TraceConsole {
  /** `c1`, `c2`…, in the order messages arrived. */
  id: string;
  step?: string;
  level: ConsoleLevel;
  /** `pageerror` for uncaught exceptions. */
  source: 'console' | 'pageerror';
  text: string;
  /** `path:line:column`, 1-based, app-relative. */
  location?: string;
  tMs: number;
}

/** `demo/traces/<scenario>-<revision>.json`. */
export interface Trace {
  schemaVersion: 1;
  /** `<scenario>-<revision>`: the file's stem and the recording's id. */
  id: string;
  /** `flow-<flow>` or `<page>-<viewport>`; the same at base and head. */
  scenario: string;
  kind: 'flow' | 'page';
  name: string;
  revision: DemoRevision;
  viewport: DemoViewport;
  /** Where the scenario starts, relative to the app. */
  path: string;
  title?: string;
  /** The run-relative recording, when the flow was recorded. */
  recording?: string;
  durationMs: number;
  steps: TraceStep[];
  requests: TraceRequest[];
  console: TraceConsole[];
  /** All steps' DOM changes together. */
  mutations: MutationSummary;
  /** Why the scenario stopped, when it did not finish. */
  error?: string;
  /** Entries beyond the trace's limits that were counted but not kept. */
  truncated?: { requests?: number; console?: number };
}

export type StepState = 'ok' | 'failed' | 'missing';

export interface StepDiff {
  id: string;
  label?: string;
  base: StepState;
  head: StepState;
  /** Present when the step's screenshots differ beyond the threshold. */
  changedRatio?: number;
  /** The run-relative pixel diff image. */
  diff?: string;
  /** Where the pixels changed (`r1`…), in image pixels of the head screenshot. */
  regions: Array<Rect & { id: string }>;
}

export interface RequestRef {
  /** The request's id in its trace. */
  request: string;
  status?: number;
  failure?: string;
}

export interface NetworkEntry extends RequestRef {
  /** `METHOD path` without the query: how base and head requests are matched. */
  key: string;
  method: string;
  url: string;
}

export interface NetworkChange {
  key: string;
  method: string;
  url: string;
  base: RequestRef;
  head: RequestRef;
}

export interface ConsoleEntry {
  /** The message's id in its trace (base for removed, head for added). */
  message: string;
  level: ConsoleLevel;
  text: string;
}

export interface TimingDelta {
  step: string;
  baseMs: number;
  headMs: number;
  deltaMs: number;
}

export interface ScenarioDiff {
  id: string;
  kind: 'flow' | 'page';
  name: string;
  viewport: DemoViewport;
  /** `changed` from steps, requests, console errors, or outcome; never from timing alone. */
  status: 'changed' | 'unchanged' | 'incomplete';
  /** The revision with no trace, when the scenario is incomplete. */
  missing?: DemoRevision;
  /** Trace ids. */
  traces: Partial<Record<DemoRevision, string>>;
  /** Run-relative recordings. */
  recordings?: Partial<Record<DemoRevision, string>>;
  /** Why the scenario stopped at a revision. */
  failure?: Partial<Record<DemoRevision, string>>;
  steps: StepDiff[];
  network: { added: NetworkEntry[]; removed: NetworkEntry[]; changed: NetworkChange[] };
  console: { added: ConsoleEntry[]; removed: ConsoleEntry[] };
  timing: { totalMs: Partial<Record<DemoRevision, number>>; steps: TimingDelta[] };
}

/** `demo/behavior-diff.json`. */
export interface BehaviorDiff {
  schemaVersion: 1;
  scenarios: ScenarioDiff[];
  summary: { scenarios: number; changed: number; unchanged: number; incomplete: number };
}
```

`packages/core/src/run/paths.ts`:

```ts
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
  flowFrame: (flow: string, frame: number, revision: DemoRevision) =>
    `${DEMO_PATHS.screenshots}/${flow}-${frameNumber(frame)}${revision === 'base' ? '-base' : ''}.png`,
  stepDiff: (scenario: string, step: string) => `${DEMO_PATHS.diffs}/${scenario}-${step}.png`,
  recording: (flow: string, revision: DemoRevision, format: 'mp4' | 'webm') =>
    `${DEMO_PATHS.recordings}/${flow}-${revision}.${format}`,
  trace: (scenario: string, revision: DemoRevision) =>
    `${DEMO_PATHS.traces}/${scenario}-${revision}.json`,
} as const;
```

`packages/core/src/model/demo.ts`: add `import type { DemoRevision, DemoViewport } from './behavior.ts';` at the top. Add these interfaces before `Demonstration`:

```ts
/** A browser flow recorded at one revision. */
export interface DemoRecording {
  /** `<scenario>-<revision>`: the file's stem, and the id of the trace recorded with it. */
  id: string;
  scenario: string;
  flow: string;
  revision: DemoRevision;
  viewport: DemoViewport;
  path: string;
  format: 'mp4' | 'webm';
  /** The video frame: the viewport in CSS pixels. */
  width: number;
  height: number;
  seconds: number;
}

/** How recording went: MP4s, WebMs kept (no ffmpeg, or converting failed), off, or impossible. */
export interface DemoRecordingStatus {
  status: 'mp4' | 'webm' | 'off' | 'unavailable';
  cause?: 'no-ffmpeg' | 'convert-failed' | 'no-recorder';
  detail?: string;
}

export interface DemoTraceRef {
  id: string;
  scenario: string;
  kind: 'page' | 'flow';
  revision: DemoRevision;
  path: string;
}
```

Add these optional fields at the end of `Demonstration`:

```ts
  /** Flow recordings at base and head (absent when no flow was recorded). */
  recordings?: DemoRecording[];
  /** Present when flows ran in a browser. */
  recording?: DemoRecordingStatus;
  /** One trace per page and flow per revision. */
  traces?: DemoTraceRef[];
  /** Where the base/head comparison is (`demo/behavior-diff.json`), and how many scenarios changed. */
  behavior?: { path: string; scenarios: number; changed: number };
```

`packages/core/src/run/run.ts`: add `| 'trace'` and `| 'behavior-diff'` to `ArtifactKind`, right after `| 'recording'`.

`packages/core/src/index.ts`: add `export * from './model/behavior.ts';` immediately before `export * from './model/change.ts';`. Add `export * from './run/paths.ts';` immediately before `export * from './run/run.ts';`. Exports stay sorted by module path.

`packages/core/src/config/schema.ts`:
- In `ConfigInputSchema.demo`, after `viewports`, add:

```ts
      record: z
        .boolean()
        .optional()
        .describe(
          'Record every browser flow at base and head (MP4 with ffmpeg, else WebM). Default true.',
        ),
```

- In `CoviConfig.demo`, add `/** Record browser flows; recording only happens when a browser runs. */ record: boolean;`.
- In `DEFAULT_CONFIG.demo`, add `record: true`, giving `demo: { pages: [], flows: [], commands: [], requests: [], viewports: ['desktop'], record: true }`.

`packages/core/src/config/resolve.ts`, `configFromEnv`: add after the `COVI_OUTRO` line:

```ts
  if (env.COVI_DEMO_RECORD) set('demo', 'record', bool(env.COVI_DEMO_RECORD));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/run.test.ts packages/core/test/config.test.ts`
Expected: PASS. The existing "uses global defaults" test still passes because it compares against `DEFAULT_CONFIG`.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/core && npx biome check packages/core`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/run/paths.ts packages/core/src/model/behavior.ts packages/core/src/model/demo.ts packages/core/src/run/run.ts packages/core/src/index.ts packages/core/src/config/schema.ts packages/core/src/config/resolve.ts packages/core/test/run.test.ts packages/core/test/config.test.ts
git commit -m "Add demo run paths, behavior evidence types, and demo.record" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 2: Core — URL-aware redaction

**Files:**
- Modify: `packages/core/src/security/redact.ts`
- Test: `packages/core/test/redact.test.ts`

**Interfaces:**
- Produces: `Redactor.redactUrl(url: string): string`, which masks credential-shaped query and fragment parameter values, keeps the parameter names, then applies `redact()`. Also produces `Redactor.redactUrls(text: string): string`, which applies the same treatment to every URL inside free text, then applies `redact()`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/redact.test.ts`:

```ts
describe('URL redaction', () => {
  const r = new Redactor();

  it('masks credential-shaped query and fragment parameters, keeping their names', () => {
    expect(r.redactUrl('/items.json?session=sess-4f9c2a7b1e&page=2')).toBe(
      '/items.json?session=[REDACTED]&page=2',
    );
    expect(
      r.redactUrl('https://cdn.test/a.png?X-Amz-Signature=abc123&X-Amz-Credential=AK%2F1&w=10'),
    ).toBe('https://cdn.test/a.png?X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]&w=10');
    expect(r.redactUrl('/callback#access_token=zz9&state=ok')).toBe(
      '/callback#access_token=[REDACTED]&state=ok',
    );
    expect(r.redactUrl('/login?api_key=k1&apiKey=k2&x-api-key=k3')).toBe(
      '/login?api_key=[REDACTED]&apiKey=[REDACTED]&x-api-key=[REDACTED]',
    );
    expect(r.redactUrl('https://user:pw123456@example.test/x')).toBe(
      'https://[REDACTED]@example.test/x',
    );
  });

  it('leaves ordinary URLs alone', () => {
    for (const url of [
      '/',
      '/items.json',
      '/search?q=tokens&page=2',
      '/kb?keyboard=us&monkey=1',
      '/docs#section-2',
      '/a?flag',
      '/a?=x',
    ])
      expect(r.redactUrl(url)).toBe(url);
  });

  it('masks URLs inside text', () => {
    expect(
      r.redactUrls('GET /a?token=abc123456 failed; see https://x.test/cb#code=zz9 (retry)'),
    ).toBe('GET /a?token=[REDACTED] failed; see https://x.test/cb#code=[REDACTED] (retry)');
    expect(r.redactUrls('Could not load items: HTTP 404')).toBe('Could not load items: HTTP 404');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/test/redact.test.ts`
Expected: FAIL with "r.redactUrl is not a function".

- [ ] **Step 3: Implement**

In `packages/core/src/security/redact.ts`, add after `URL_CREDENTIALS`:

```ts
/**
 * Query and fragment parameters whose values are credentials (`?token=…`, `#access_token=…`,
 * `X-Amz-Signature=…`). The name must match whole, after an optional prefix such as `x-api-`,
 * so `keyboard` or `monkey` stay readable.
 */
const SECRET_PARAM =
  /^(?:[a-z0-9]+[_-])*(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pwd|auth|authorization|session|session[_-]?id|sessionid|sid|sig|signature|credentials?|code|jwt|otp)$/i;

/** URLs inside free text: absolute ones, and paths that carry a query or a fragment. */
const URL_IN_TEXT =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+|(?<![\w./])\/[^\s"'<>`?#]*[?#][^\s"'<>`]+/gi;

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, ' '));
  } catch {
    return name;
  }
}

function maskPairs(text: string): string {
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq <= 0) return pair;
      const name = pair.slice(0, eq);
      return name.length <= 64 && SECRET_PARAM.test(decodeName(name))
        ? `${name}=[REDACTED]`
        : pair;
    })
    .join('&');
}

/** Masks the values of credential-shaped parameters in a URL's query and fragment. */
function maskSecretParams(url: string): string {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
  const fragment = hashAt < 0 ? undefined : url.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const query = queryAt < 0 ? undefined : beforeHash.slice(queryAt + 1);
  return `${path}${query === undefined ? '' : `?${maskPairs(query)}`}${fragment === undefined ? '' : `#${maskPairs(fragment)}`}`;
}
```

Add these methods to `class Redactor`, after `redact`:

```ts
  /** A URL with credential-shaped query and fragment parameters masked, then redacted as text. */
  redactUrl(url: string): string {
    return this.redact(maskSecretParams(url));
  }

  /** Text with every URL in it masked like `redactUrl` (console messages, error text). */
  redactUrls(text: string): string {
    if (!text) return text;
    return this.redact(text.replace(URL_IN_TEXT, (url) => maskSecretParams(url)));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/redact.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/core/src/security/redact.ts packages/core/test/redact.test.ts && npx biome check packages/core`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/security/redact.ts packages/core/test/redact.test.ts
git commit -m "Mask credential-shaped URL parameters in redaction" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 3: Capture — change regions

**Files:**
- Create: `packages/capture/src/regions.ts`
- Modify: `packages/capture/src/pixels.ts`
- Test: `packages/capture/test/regions.test.ts` (new), `packages/capture/test/capture.test.ts` (pixel diffs block)

**Interfaces:**
- Consumes: `Rect` from `@covi/core`.
- Produces:
  - `MAX_REGIONS = 6`.
  - `mergeRegions(rects: readonly Rect[], options?: { scale?: number; gap?: number; max?: number }): Rect[]`.
  - `changedRegions(image: { data: Uint8Array; width: number; height: number }, options?: { cell?: number; max?: number }): Rect[]`.
  - `PixelDiff.regions: Rect[]`.
  - `comparePngs(before, after, diffPath?, options?: { minRatio?: number })`. It writes the diff image only when `changedRatio >= minRatio` (default 0, which writes always, as today).

- [ ] **Step 1: Write the failing tests**

`packages/capture/test/regions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { changedRegions, MAX_REGIONS, mergeRegions } from '../src/regions.ts';

const RED = [255, 0, 0, 255];

/** A pixelmatch-style diff image: white, with changed pixels painted pure red. */
function diffImage(width: number, height: number, blocks: Array<[number, number, number, number]>) {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const [x0, y0, w, h] of blocks)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) data.set(RED, (y * width + x) * 4);
  return { data, width, height };
}

describe('changedRegions', () => {
  it('finds separate areas of change with exact pixel bounds', () => {
    expect(
      changedRegions(
        diffImage(200, 120, [
          [10, 10, 20, 20],
          [150, 80, 30, 25],
        ]),
      ),
    ).toEqual([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 150, y: 80, width: 30, height: 25 },
    ]);
  });

  it('joins changes that sit close together into one region', () => {
    expect(
      changedRegions(
        diffImage(200, 120, [
          [10, 10, 20, 20],
          [34, 12, 10, 10],
        ]),
      ),
    ).toEqual([{ x: 10, y: 10, width: 34, height: 20 }]);
  });

  it('finds nothing in an unchanged image', () => {
    expect(changedRegions(diffImage(64, 64, []))).toEqual([]);
  });
});

describe('mergeRegions', () => {
  it('scales CSS pixels to image pixels, clamps at the edges, and drops empty boxes', () => {
    expect(
      mergeRegions(
        [
          { x: -5, y: 10, width: 20, height: 5 },
          { x: 0, y: 0, width: 0, height: 9 },
        ],
        { scale: 2 },
      ),
    ).toEqual([{ x: 0, y: 20, width: 30, height: 10 }]);
  });

  it('merges overlapping or nearly touching boxes', () => {
    expect(
      mergeRegions(
        [
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 14, y: 0, width: 10, height: 10 },
          { x: 100, y: 100, width: 5, height: 5 },
        ],
        { gap: 8 },
      ),
    ).toEqual([
      { x: 0, y: 0, width: 24, height: 10 },
      { x: 100, y: 100, width: 5, height: 5 },
    ]);
  });

  it('keeps at most max boxes, still covering every input', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({ x: i * 100, y: 0, width: 10, height: 10 }));
    const merged = mergeRegions(boxes, { gap: 0 });
    expect(merged).toHaveLength(MAX_REGIONS);
    for (const b of boxes)
      expect(merged.some((m) => m.x <= b.x && m.x + m.width >= b.x + b.width)).toBe(true);
  });

  it('gives the same result for the same boxes in any order', () => {
    const boxes = [
      { x: 50, y: 50, width: 5, height: 5 },
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 300, y: 0, width: 5, height: 5 },
    ];
    expect(mergeRegions(boxes, { max: 2 })).toEqual(mergeRegions([...boxes].reverse(), { max: 2 }));
  });
});
```

In `packages/capture/test/capture.test.ts`, add `existsSync` to the `node:fs` import. Inside `describe('pixel diffs', …)`, add:

```ts
  it('lists separate regions and writes the diff image only above minRatio', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-px-'));
    writeFileSync(join(dir, 'a.png'), png(100, 80));
    writeFileSync(
      join(dir, 'b.png'),
      png(100, 80, (x, y) => (x < 2 && y < 2 ? [0, 0, 255] : undefined)),
    );
    const diff = await comparePngs(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'd.png'), {
      minRatio: 0.01,
    });
    expect(diff.regions).toEqual([{ x: 0, y: 0, width: 2, height: 2 }]);
    expect(existsSync(join(dir, 'd.png'))).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts`
Expected: FAIL. `../src/regions.ts` is not found, and `diff.regions` is `undefined`.

- [ ] **Step 3: Implement**

`packages/capture/src/regions.ts`:

```ts
import type { Rect } from '@covi/core';

/** At most this many regions per step: a reviewer (or a video) can point at a few, not dozens. */
export const MAX_REGIONS = 6;
/** Inputs beyond this are folded into one box first, so merging stays cheap on noisy pages. */
const MAX_INPUT = 256;

const area = (r: Rect) => r.width * r.height;

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

function near(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x <= b.x + b.width + gap &&
    b.x <= a.x + a.width + gap &&
    a.y <= b.y + b.height + gap &&
    b.y <= a.y + a.height + gap
  );
}

const byPosition = (a: Rect, b: Rect) =>
  a.y - b.y || a.x - b.x || a.width - b.width || a.height - b.height;

/** Merges the first pair of boxes that overlap or nearly touch; false when none do. */
function mergeOnce(boxes: Rect[], gap: number): boolean {
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (near(boxes[i]!, boxes[j]!, gap)) {
        boxes[i] = union([boxes[i]!, boxes[j]!]);
        boxes.splice(j, 1);
        return true;
      }
  return false;
}

/**
 * Scales boxes (CSS pixels → image pixels), drops empty ones, and merges boxes that overlap or
 * nearly touch. When more than `max` remain, the pair whose union adds the least area merges
 * until `max` are left. The input order never changes the result.
 */
export function mergeRegions(
  rects: readonly Rect[],
  options: { scale?: number; gap?: number; max?: number } = {},
): Rect[] {
  const scale = options.scale ?? 1;
  const gap = options.gap ?? 8;
  const max = options.max ?? MAX_REGIONS;
  let boxes = rects
    .map((r) => {
      const x = Math.max(0, Math.round(r.x * scale));
      const y = Math.max(0, Math.round(r.y * scale));
      return {
        x,
        y,
        width: Math.round((r.x + r.width) * scale) - x,
        height: Math.round((r.y + r.height) * scale) - y,
      };
    })
    .filter((r) => r.width > 0 && r.height > 0)
    .sort(byPosition);
  if (boxes.length > MAX_INPUT) {
    const bySize = [...boxes].sort((a, b) => area(b) - area(a) || byPosition(a, b));
    boxes = [...bySize.slice(0, MAX_INPUT - 1), union(bySize.slice(MAX_INPUT - 1))].sort(byPosition);
  }
  while (mergeOnce(boxes, gap)) {
    // Keep merging until no two boxes overlap or nearly touch.
  }
  while (boxes.length > max) {
    let best: [number, number] = [0, 1];
    let bestCost = Number.POSITIVE_INFINITY;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const cost = area(union([boxes[i]!, boxes[j]!])) - area(boxes[i]!) - area(boxes[j]!);
        if (cost < bestCost) {
          bestCost = cost;
          best = [i, j];
        }
      }
    const [i, j] = best;
    boxes[i] = union([boxes[i]!, boxes[j]!]);
    boxes.splice(j, 1);
  }
  return boxes.sort(byPosition);
}

/** 8-neighbourhood, so diagonal steps of a change stay one region. */
const NEIGHBORS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

/**
 * The separate areas of change in a pixelmatch diff image (changed pixels are pure red). Pixels are
 * grouped into cells, neighbouring changed cells form one area, and each area keeps the exact
 * bounds of its changed pixels.
 */
export function changedRegions(
  image: { data: Uint8Array; width: number; height: number },
  options: { cell?: number; max?: number } = {},
): Rect[] {
  const cell = options.cell ?? 16;
  const { data, width, height } = image;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  // Per cell: minX, minY, maxX, maxY of its changed pixels (-1 when it has none).
  const box = new Int32Array(cols * rows * 4).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] !== 255 || data[i + 1] !== 0 || data[i + 2] !== 0) continue;
      const c = (Math.floor(y / cell) * cols + Math.floor(x / cell)) * 4;
      if (box[c] === -1) {
        box[c] = x;
        box[c + 1] = y;
        box[c + 2] = x;
        box[c + 3] = y;
      } else {
        box[c] = Math.min(box[c]!, x);
        box[c + 1] = Math.min(box[c + 1]!, y);
        box[c + 2] = Math.max(box[c + 2]!, x);
        box[c + 3] = Math.max(box[c + 3]!, y);
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const areas: Rect[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (seen[start] || box[start * 4] === -1) continue;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = -1;
    let y1 = -1;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      x0 = Math.min(x0, box[c * 4]!);
      y0 = Math.min(y0, box[c * 4 + 1]!);
      x1 = Math.max(x1, box[c * 4 + 2]!);
      y1 = Math.max(y1, box[c * 4 + 3]!);
      const cx = c % cols;
      const cy = Math.floor(c / cols);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (!seen[n] && box[n * 4] !== -1) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    areas.push({ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  return mergeRegions(areas, { gap: cell, max: options.max ?? MAX_REGIONS });
}
```

`packages/capture/src/pixels.ts`:
- Add `import { changedRegions } from './regions.ts';`.
- Add to `PixelDiff`: `/** Separate areas of change (at most six), in image pixels. */ regions: Rect[];`.
- Change `comparePngs` to:

```ts
/**
 * Compares two screenshots; writes a diff image (only when at least `minRatio` of the pixels
 * changed, if given) and returns where pixels changed.
 */
export async function comparePngs(
  beforePath: string,
  afterPath: string,
  diffPath?: string,
  options: { minRatio?: number } = {},
): Promise<PixelDiff> {
  // … unchanged up to and including the pixelmatch call …
  const changedRatio = changedPixels / (width * height);
  if (diffPath && changedRatio >= (options.minRatio ?? 0))
    await writeFile(diffPath, PNG.sync.write(diff));
  // … unchanged bounds loop …
  const sizeChanged = a.width !== b.width || a.height !== b.height;
  return {
    changedPixels,
    changedRatio,
    bounds:
      maxX >= 0 ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : undefined,
    regions: changedRegions(diff),
    sizeChanged,
  };
}
```

Remove the old unconditional `if (diffPath) await writeFile(…)` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts`
Expected: PASS, and the existing "finds where pixels changed" test is unchanged.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/capture && npx biome check packages/capture`

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/regions.ts packages/capture/src/pixels.ts packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts
git commit -m "Find separate regions of change in pixel diffs" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 4: Capture — `TraceCollector`

**Files:**
- Create: `packages/capture/src/trace.ts`
- Test: `packages/capture/test/trace.test.ts` (new)

**Interfaces:**
- Consumes: `Redactor.redactUrl` and `Redactor.redactUrls` (Task 2), `mergeRegions` (Task 3), and the `Trace*` types (Task 1).
- Produces:

```ts
export const TRACE_LIMITS: { requests: 300; console: 200; text: 500; url: 500 };
export interface TraceMeta { id: string; scenario: string; kind: 'flow' | 'page'; name: string; revision: DemoRevision; viewport: DemoViewport; path: string }
export interface TraceOptions { origin: string; redactor: Redactor; relative?: (file: string) => string; now?: () => number }
export class TraceCollector {
  constructor(meta: TraceMeta, options: TraceOptions);
  start(): void;                       // restarts the clock (page and recording start)
  stop(): void;                        // freezes durationMs (page closed)
  beginStep(step: { id: string; action: string; target?: string; label?: string }): void;
  frame(file: string, box?: Rect): void;
  endStep(end?: { status?: 'ok' | 'failed'; error?: string; mutations?: MutationSummary }): void;
  request(handle: object, init: { method: string; url: string; type: string }): void;
  response(handle: object, done: { status?: number; failure?: string; durationMs?: number }): void;
  console(message: { level: string; text: string; location?: { url: string; line: number; column: number }; source?: 'console' | 'pageerror' }): void;
  finish(extra?: { title?: string; recording?: string; error?: string }): Trace;
}
```

- [ ] **Step 1: Write the failing tests**

`packages/capture/test/trace.test.ts`:

```ts
import { Redactor } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { TRACE_LIMITS, TraceCollector } from '../src/trace.ts';

const META = {
  id: 'flow-x-head',
  scenario: 'flow-x',
  kind: 'flow',
  name: 'X',
  revision: 'head',
  viewport: 'desktop',
  path: '/',
} as const;
const ORIGIN = 'http://127.0.0.1:5000';

function collector() {
  let now = 1000;
  const trace = new TraceCollector(META, {
    origin: ORIGIN,
    redactor: new Redactor(),
    relative: (file) => file.replace('/runs/r1/', ''),
    now: () => now,
  });
  return {
    trace,
    at: (ms: number) => {
      now = 1000 + ms;
    },
  };
}

describe('TraceCollector', () => {
  it('times steps, attributes requests and messages to them, keeps app URLs relative, and redacts', () => {
    const { trace, at } = collector();
    trace.start();
    trace.beginStep({ id: 'open', action: 'goto', target: '/' });
    const page = {};
    trace.request(page, { method: 'get', url: `${ORIGIN}/`, type: 'document' });
    trace.request({}, { method: 'GET', url: 'data:image/png;base64,AAAA', type: 'image' });
    at(40);
    trace.response(page, { status: 200, durationMs: 12.4 });
    at(100);
    trace.endStep({ mutations: { count: 2, regions: [{ x: 0, y: 0, width: 10, height: 10 }] } });
    trace.beginStep({ id: 's1', action: 'click', target: '#load', label: 'Load the items' });
    trace.frame('/runs/r1/demo/screenshots/flow-x-01.png', { x: 2, y: 4, width: 6, height: 8 });
    at(150);
    const api = {};
    trace.request(api, {
      method: 'GET',
      url: `${ORIGIN}/items.json?session=sess-4f9c2a7b1e`,
      type: 'fetch',
    });
    trace.console({
      level: 'error',
      text: `Load failed at ${ORIGIN}/app.js?token=abcdef123456`,
      location: { url: `${ORIGIN}/app.js`, line: 4, column: 9 },
    });
    trace.console({ level: 'log', text: 'hello' });
    trace.console({ level: 'assert', text: 'Assertion failed' });
    at(180);
    trace.response(api, { failure: 'net::ERR_FAILED' });
    at(400);
    trace.endStep({ mutations: { count: 1, regions: [{ x: 5, y: 5, width: 20, height: 20 }] } });
    at(450);
    trace.stop();
    at(9000);
    expect(trace.finish({ title: 'Items', recording: 'demo/recordings/flow-x-head.mp4' })).toEqual({
      schemaVersion: 1,
      ...META,
      title: 'Items',
      recording: 'demo/recordings/flow-x-head.mp4',
      durationMs: 450,
      steps: [
        {
          id: 'open',
          action: 'goto',
          target: '/',
          t: 0,
          durationMs: 100,
          status: 'ok',
          mutations: { count: 2, regions: [{ x: 0, y: 0, width: 10, height: 10 }] },
        },
        {
          id: 's1',
          action: 'click',
          target: '#load',
          label: 'Load the items',
          t: 0.1,
          durationMs: 300,
          status: 'ok',
          screenshot: 'demo/screenshots/flow-x-01.png',
          box: { x: 2, y: 4, width: 6, height: 8 },
          mutations: { count: 1, regions: [{ x: 5, y: 5, width: 20, height: 20 }] },
        },
      ],
      requests: [
        { id: 'n1', step: 'open', method: 'GET', url: '/', type: 'document', startMs: 0, status: 200, durationMs: 12 },
        {
          id: 'n2',
          step: 's1',
          method: 'GET',
          url: '/items.json?session=[REDACTED]',
          type: 'fetch',
          startMs: 150,
          failure: 'net::ERR_FAILED',
          durationMs: 30,
        },
      ],
      console: [
        {
          id: 'c1',
          step: 's1',
          level: 'error',
          source: 'console',
          text: 'Load failed at /app.js?token=[REDACTED]',
          location: '/app.js:5:10',
          tMs: 150,
        },
        { id: 'c2', step: 's1', level: 'log', source: 'console', text: 'hello', tMs: 150 },
        { id: 'c3', step: 's1', level: 'error', source: 'console', text: 'Assertion failed', tMs: 150 },
      ],
      mutations: { count: 3, regions: [{ x: 0, y: 0, width: 25, height: 25 }] },
    });
  });

  it('keeps at most TRACE_LIMITS entries, counts the rest, and clips long text', () => {
    const { trace } = collector();
    trace.start();
    for (let i = 0; i < TRACE_LIMITS.requests + 5; i++)
      trace.request({}, { method: 'GET', url: `${ORIGIN}/r${i}`, type: 'fetch' });
    for (let i = 0; i < TRACE_LIMITS.console + 5; i++)
      trace.console({ level: 'log', text: 'x'.repeat(TRACE_LIMITS.text + 50) });
    const result = trace.finish();
    expect(result.requests).toHaveLength(TRACE_LIMITS.requests);
    expect(result.console).toHaveLength(TRACE_LIMITS.console);
    expect(result.truncated).toEqual({ requests: 5, console: 5 });
    expect(result.console[0]!.text.length).toBeLessThanOrEqual(TRACE_LIMITS.text);
  });

  it('closes an open step as failed when the scenario failed, and ignores late events', () => {
    const { trace, at } = collector();
    trace.start();
    trace.beginStep({ id: 's1', action: 'click', target: '#missing' });
    at(8000);
    const result = trace.finish({ error: 'Timeout 8000ms exceeded' });
    trace.request({}, { method: 'GET', url: `${ORIGIN}/late`, type: 'fetch' });
    trace.console({ level: 'error', text: 'late' });
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 's1',
        status: 'failed',
        error: 'Timeout 8000ms exceeded',
        durationMs: 8000,
      }),
    ]);
    expect(result.error).toBe('Timeout 8000ms exceeded');
    expect(result.requests).toEqual([]);
    expect(result.console).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/capture/test/trace.test.ts`
Expected: FAIL. `../src/trace.ts` is not found.

- [ ] **Step 3: Implement**

`packages/capture/src/trace.ts`:

```ts
import {
  type ConsoleLevel,
  type DemoRevision,
  type DemoViewport,
  type MutationSummary,
  type Rect,
  type Redactor,
  type Trace,
  type TraceConsole,
  type TraceRequest,
  type TraceStep,
  truncate,
} from '@covi/core';
import { mergeRegions } from './regions.ts';

/** Bounds on one trace: a page can make thousands of requests or log in a loop. */
export const TRACE_LIMITS = { requests: 300, console: 200, text: 500, url: 500 } as const;

export interface TraceMeta {
  id: string;
  scenario: string;
  kind: 'flow' | 'page';
  name: string;
  revision: DemoRevision;
  viewport: DemoViewport;
  path: string;
}

export interface TraceOptions {
  /** The app's origin (`http://127.0.0.1:4321`): URLs on it stay relative, so base and head compare. */
  origin: string;
  redactor: Redactor;
  /** Turns an absolute screenshot path into one relative to the run. */
  relative?: (file: string) => string;
  /** Milliseconds from any fixed point; tests pass a fake clock. */
  now?: () => number;
}

const LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  assert: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'debug',
};

/** Nothing crossed the network for these. */
const LOCAL_URL = /^(data|blob|about|javascript|chrome-extension):/i;

const seconds = (ms: number) => Math.round(ms) / 1000;

/**
 * Collects what one page load or flow did at one revision. It holds no browser: the Playwright
 * adapter (`observe.ts`) feeds it events, and it decides ids, step attribution, relative URLs,
 * redaction, and bounds, so all of that is testable without a browser.
 */
export class TraceCollector {
  private readonly meta: TraceMeta;
  private readonly redactor: Redactor;
  private readonly origin: string;
  private readonly relative: (file: string) => string;
  private readonly now: () => number;
  private t0: number;
  private stoppedAt?: number;
  private open?: { step: TraceStep; startedAt: number };
  private readonly steps: TraceStep[] = [];
  private readonly requests: TraceRequest[] = [];
  private readonly pending = new Map<object, { entry: TraceRequest; startedAt: number }>();
  private readonly messages: TraceConsole[] = [];
  private requestCount = 0;
  private consoleCount = 0;
  private finished = false;

  constructor(meta: TraceMeta, options: TraceOptions) {
    this.meta = meta;
    this.redactor = options.redactor;
    this.origin = options.origin.replace(/\/$/, '');
    this.relative = options.relative ?? ((file) => file);
    this.now = options.now ?? (() => performance.now());
    this.t0 = this.now();
  }

  /** Restarts the clock: call when the page, and its recording, start. */
  start(): void {
    this.t0 = this.now();
  }

  /** Stops the clock: the page, and its recording, ended. */
  stop(): void {
    this.stoppedAt ??= this.elapsed();
  }

  beginStep(step: { id: string; action: string; target?: string; label?: string }): void {
    if (this.open) this.endStep();
    const startedAt = this.elapsed();
    this.open = {
      startedAt,
      step: {
        id: step.id,
        action: step.action,
        ...(step.target ? { target: step.target } : {}),
        ...(step.label ? { label: step.label } : {}),
        t: seconds(startedAt),
        durationMs: 0,
        status: 'ok',
      },
    };
  }

  /** The screenshot taken for the open step, and its target's box in image pixels. */
  frame(file: string, box?: Rect): void {
    if (!this.open) return;
    this.open.step.screenshot = this.relative(file);
    if (box) this.open.step.box = box;
  }

  endStep(
    end: { status?: 'ok' | 'failed'; error?: string; mutations?: MutationSummary } = {},
  ): void {
    const open = this.open;
    if (!open) return;
    this.open = undefined;
    const { step } = open;
    step.durationMs = Math.round(this.elapsed() - open.startedAt);
    step.status = end.status ?? 'ok';
    if (end.error) step.error = truncate(end.error, TRACE_LIMITS.text);
    if (end.mutations) step.mutations = end.mutations;
    this.steps.push(step);
  }

  request(handle: object, init: { method: string; url: string; type: string }): void {
    if (this.finished) return;
    const url = this.url(init.url);
    if (url === undefined) return;
    const id = `n${++this.requestCount}`;
    if (this.requests.length >= TRACE_LIMITS.requests) return;
    const startedAt = this.elapsed();
    const entry: TraceRequest = {
      id,
      ...(this.open ? { step: this.open.step.id } : {}),
      method: init.method.toUpperCase(),
      url,
      type: init.type,
      startMs: Math.round(startedAt),
    };
    this.requests.push(entry);
    this.pending.set(handle, { entry, startedAt });
  }

  response(handle: object, done: { status?: number; failure?: string; durationMs?: number }): void {
    if (this.finished) return;
    const pending = this.pending.get(handle);
    if (!pending) return;
    this.pending.delete(handle);
    if (done.status !== undefined) pending.entry.status = done.status;
    if (done.failure) pending.entry.failure = truncate(done.failure, 200);
    pending.entry.durationMs = Math.round(done.durationMs ?? this.elapsed() - pending.startedAt);
  }

  console(message: {
    level: string;
    text: string;
    location?: { url: string; line: number; column: number };
    source?: 'console' | 'pageerror';
  }): void {
    if (this.finished) return;
    const id = `c${++this.consoleCount}`;
    if (this.messages.length >= TRACE_LIMITS.console) return;
    const where = message.location?.url ? this.url(message.location.url) : undefined;
    this.messages.push({
      id,
      ...(this.open ? { step: this.open.step.id } : {}),
      level: LEVELS[message.level] ?? 'log',
      source: message.source ?? 'console',
      text: truncate(
        this.redactor.redactUrls(message.text.split(this.origin).join('')),
        TRACE_LIMITS.text,
      ),
      ...(where && message.location
        ? { location: `${where}:${message.location.line + 1}:${message.location.column + 1}` }
        : {}),
      tMs: Math.round(this.elapsed()),
    });
  }

  finish(extra: { title?: string; recording?: string; error?: string } = {}): Trace {
    if (this.open) this.endStep(extra.error ? { status: 'failed', error: extra.error } : {});
    this.finished = true;
    const summaries = this.steps.flatMap((s) => (s.mutations ? [s.mutations] : []));
    const trace: Trace = {
      schemaVersion: 1,
      ...this.meta,
      ...(extra.title ? { title: truncate(extra.title, 200) } : {}),
      ...(extra.recording ? { recording: extra.recording } : {}),
      durationMs: Math.round(this.stoppedAt ?? this.elapsed()),
      steps: this.steps,
      requests: this.requests,
      console: this.messages,
      mutations: {
        count: summaries.reduce((sum, m) => sum + m.count, 0),
        regions: mergeRegions(summaries.flatMap((m) => m.regions)),
      },
    };
    if (extra.error) trace.error = truncate(extra.error, TRACE_LIMITS.text);
    const dropped = {
      requests: this.requestCount - this.requests.length,
      console: this.consoleCount - this.messages.length,
    };
    if (dropped.requests || dropped.console)
      trace.truncated = {
        ...(dropped.requests ? { requests: dropped.requests } : {}),
        ...(dropped.console ? { console: dropped.console } : {}),
      };
    return trace;
  }

  private elapsed(): number {
    return this.now() - this.t0;
  }

  /** App-relative and redacted, or undefined for URLs that never cross the network. */
  private url(raw: string): string | undefined {
    if (LOCAL_URL.test(raw)) return undefined;
    const local =
      raw === this.origin
        ? '/'
        : raw.startsWith(`${this.origin}/`)
          ? raw.slice(this.origin.length)
          : raw;
    return truncate(this.redactor.redactUrl(local), TRACE_LIMITS.url);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/capture/test/trace.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/capture && npx biome check packages/capture`

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/trace.ts packages/capture/test/trace.test.ts
git commit -m "Collect bounded, redacted traces of pages and flows" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 5: Capture — the behavior diff (pure)

**Files:**
- Create: `packages/capture/src/behavior.ts`
- Test: `packages/capture/test/behavior.test.ts` (new)

**Interfaces:**
- Consumes: the Task 1 types.
- Produces:

```ts
export const PIXEL_THRESHOLD = 0.0005;
export const TIMING_THRESHOLD: { ms: 500; ratio: 0.5 };
export interface StepPixels { changedRatio: number; diff?: string; bounds?: Rect; regions: Rect[] }
export interface ScenarioObservation { id: string; kind: 'flow' | 'page'; name: string; viewport: DemoViewport; traces: Partial<Record<DemoRevision, Trace>>; pixels: Record<string, StepPixels> }
export function diffBehavior(observations: readonly ScenarioObservation[]): BehaviorDiff;
export function diffScenario(observation: ScenarioObservation): ScenarioDiff;
export function diffSteps(base: Trace, head: Trace, pixels: Record<string, StepPixels>): StepDiff[];
export function diffNetwork(base: readonly TraceRequest[], head: readonly TraceRequest[]): ScenarioDiff['network'];
export function diffConsole(base: readonly TraceConsole[], head: readonly TraceConsole[]): ScenarioDiff['console'];
export function diffTiming(base: Trace, head: Trace): ScenarioDiff['timing'];
```

- [ ] **Step 1: Write the failing tests**

`packages/capture/test/behavior.test.ts`:

```ts
import type { Trace, TraceConsole, TraceRequest, TraceStep } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  diffBehavior,
  diffConsole,
  diffNetwork,
  diffScenario,
  diffSteps,
  diffTiming,
  PIXEL_THRESHOLD,
  type ScenarioObservation,
} from '../src/behavior.ts';

const step = (id: string, extra: Partial<TraceStep> = {}): TraceStep => ({
  id,
  action: 'click',
  t: 0,
  durationMs: 300,
  status: 'ok',
  ...extra,
});
const req = (
  id: string,
  url: string,
  status?: number,
  extra: Partial<TraceRequest> = {},
): TraceRequest => ({
  id,
  method: 'GET',
  url,
  type: 'fetch',
  startMs: 0,
  ...(status === undefined ? {} : { status }),
  ...extra,
});
const msg = (id: string, text: string, level: TraceConsole['level'] = 'error'): TraceConsole => ({
  id,
  level,
  source: 'console',
  text,
  tMs: 0,
});
function trace(revision: 'base' | 'head', extra: Partial<Trace> = {}): Trace {
  return {
    schemaVersion: 1,
    id: `flow-x-${revision}`,
    scenario: 'flow-x',
    kind: 'flow',
    name: 'X',
    revision,
    viewport: 'desktop',
    path: '/',
    durationMs: 1000,
    steps: [step('open'), step('s1'), step('end')],
    requests: [],
    console: [],
    mutations: { count: 0, regions: [] },
    ...extra,
  };
}
const observe = (
  base?: Trace,
  head?: Trace,
  pixels: ScenarioObservation['pixels'] = {},
): ScenarioObservation => ({
  id: 'flow-x',
  kind: 'flow',
  name: 'X',
  viewport: 'desktop',
  traces: { ...(base ? { base } : {}), ...(head ? { head } : {}) },
  pixels,
});

describe('network', () => {
  it('reports added, removed, and changed-status requests, keyed by method and path', () => {
    expect(
      diffNetwork(
        [req('n1', '/', 200), req('n2', '/items.json?session=[REDACTED]', 200), req('n3', '/legacy.js', 200)],
        [req('n1', '/', 200), req('n2', '/items.json?session=[REDACTED]', 404), req('n3', '/api/limits', 200)],
      ),
    ).toEqual({
      added: [{ key: 'GET /api/limits', method: 'GET', url: '/api/limits', request: 'n3', status: 200 }],
      removed: [{ key: 'GET /legacy.js', method: 'GET', url: '/legacy.js', request: 'n3', status: 200 }],
      changed: [
        {
          key: 'GET /items.json',
          method: 'GET',
          url: '/items.json?session=[REDACTED]',
          base: { request: 'n2', status: 200 },
          head: { request: 'n2', status: 404 },
        },
      ],
    });
  });

  it('stays quiet about repeated calls and changed query strings', () => {
    const poll = (n: number) =>
      Array.from({ length: n }, (_, i) => req(`n${i + 1}`, `/poll?t=${i}`, 200));
    expect(diffNetwork(poll(3), poll(5))).toEqual({ added: [], removed: [], changed: [] });
  });

  it('treats a failed request as a change from a response', () => {
    expect(
      diffNetwork([req('n1', '/a', 200)], [req('n1', '/a', undefined, { failure: 'net::ERR_FAILED' })])
        .changed,
    ).toEqual([
      {
        key: 'GET /a',
        method: 'GET',
        url: '/a',
        base: { request: 'n1', status: 200 },
        head: { request: 'n1', failure: 'net::ERR_FAILED' },
      },
    ]);
  });
});

describe('console', () => {
  it('reports new and gone errors once each, ignoring warnings and resource-load noise', () => {
    expect(
      diffConsole(
        [msg('c1', 'Deprecated API'), msg('c2', 'just a warning', 'warning')],
        [
          msg('c1', 'Could not load items: HTTP 404'),
          msg('c2', 'Could not load items: HTTP 404'),
          msg('c3', 'Failed to load resource: the server responded with a status of 404 (Not Found)'),
          msg('c4', 'other warning', 'warning'),
        ],
      ),
    ).toEqual({
      added: [{ message: 'c1', level: 'error', text: 'Could not load items: HTTP 404' }],
      removed: [{ message: 'c1', level: 'error', text: 'Deprecated API' }],
    });
  });

  it('matches errors that differ only in long numbers such as timestamps', () => {
    expect(
      diffConsole([msg('c1', 'Timed out after 12345 ms')], [msg('c1', 'Timed out after 12399 ms')]),
    ).toEqual({ added: [], removed: [] });
  });
});

describe('steps', () => {
  it('lists steps whose screenshots differ beyond the threshold, with region ids', () => {
    expect(
      diffSteps(trace('base'), trace('head'), {
        s1: { changedRatio: PIXEL_THRESHOLD / 2, regions: [] },
        end: {
          changedRatio: 0.0123,
          diff: 'demo/diffs/flow-x-end.png',
          regions: [
            { x: 1, y: 2, width: 3, height: 4 },
            { x: 50, y: 60, width: 7, height: 8 },
          ],
        },
      }),
    ).toEqual([
      {
        id: 'end',
        base: 'ok',
        head: 'ok',
        changedRatio: 0.0123,
        diff: 'demo/diffs/flow-x-end.png',
        regions: [
          { id: 'r1', x: 1, y: 2, width: 3, height: 4 },
          { id: 'r2', x: 50, y: 60, width: 7, height: 8 },
        ],
      },
    ]);
  });

  it('lists steps that failed or were never reached at one revision', () => {
    const base = trace('base', {
      steps: [step('open'), step('s1', { status: 'failed', label: 'Open the menu' })],
      error: 'Timeout 8000ms exceeded',
    });
    expect(diffSteps(base, trace('head'), {})).toEqual([
      { id: 's1', label: 'Open the menu', base: 'failed', head: 'ok', regions: [] },
      { id: 'end', base: 'missing', head: 'ok', regions: [] },
    ]);
  });
});

describe('timing', () => {
  it('reports a step slower by at least 500 ms and half its base time, and stays quiet otherwise', () => {
    const base = trace('base', {
      durationMs: 2600,
      steps: [step('open', { durationMs: 2000 }), step('s1', { durationMs: 300 }), step('end')],
    });
    const head = trace('head', {
      durationMs: 3900,
      steps: [step('open', { durationMs: 2400 }), step('s1', { durationMs: 1200 }), step('end')],
    });
    expect(diffTiming(base, head)).toEqual({
      totalMs: { base: 2600, head: 3900 },
      steps: [{ step: 's1', baseMs: 300, headMs: 1200, deltaMs: 900 }],
    });
  });
});

describe('scenarios', () => {
  it('is unchanged when nothing but timing differs', () => {
    const slow = trace('head', { steps: [step('open'), step('s1', { durationMs: 2000 }), step('end')] });
    const result = diffScenario(observe(trace('base'), slow));
    expect(result.status).toBe('unchanged');
    expect(result.timing.steps).toHaveLength(1);
  });

  it('is changed when a request, a console error, a step, or the outcome differs', () => {
    const changed = (head: Trace, pixels: ScenarioObservation['pixels'] = {}) =>
      diffScenario(observe(trace('base'), head, pixels)).status;
    expect(changed(trace('head', { requests: [req('n1', '/new', 200)] }))).toBe('changed');
    expect(changed(trace('head', { console: [msg('c1', 'boom')] }))).toBe('changed');
    expect(changed(trace('head'), { end: { changedRatio: 0.2, regions: [] } })).toBe('changed');
    const failed = diffScenario(observe(trace('base'), trace('head', { error: 'Timeout' })));
    expect(failed).toMatchObject({ status: 'changed', failure: { head: 'Timeout' } });
  });

  it('is changed, not a failure of the review, when the flow cannot run at base', () => {
    const base = trace('base', {
      steps: [step('open'), step('s1', { status: 'failed' })],
      error: 'locator.click: Timeout 8000ms exceeded',
    });
    expect(diffScenario(observe(base, trace('head')))).toMatchObject({
      status: 'changed',
      failure: { base: 'locator.click: Timeout 8000ms exceeded' },
      steps: [
        { id: 's1', base: 'failed', head: 'ok' },
        { id: 'end', base: 'missing', head: 'ok' },
      ],
    });
  });

  it('is incomplete when one revision has no trace', () => {
    expect(diffScenario(observe(undefined, trace('head')))).toMatchObject({
      status: 'incomplete',
      missing: 'base',
      traces: { head: 'flow-x-head' },
      timing: { totalMs: { head: 1000 } },
    });
  });

  it('summarizes deterministically', () => {
    const inputs = [
      observe(trace('base'), trace('head')),
      observe(undefined, trace('head')),
      observe(trace('base'), trace('head', { console: [msg('c1', 'boom')] })),
    ];
    const diff = diffBehavior(inputs);
    expect(diff.schemaVersion).toBe(1);
    expect(diff.summary).toEqual({ scenarios: 3, changed: 1, unchanged: 1, incomplete: 1 });
    expect(diffBehavior(inputs)).toEqual(diff);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/capture/test/behavior.test.ts`
Expected: FAIL. `../src/behavior.ts` is not found.

- [ ] **Step 3: Implement**

`packages/capture/src/behavior.ts`:

```ts
import type {
  BehaviorDiff,
  ConsoleEntry,
  DemoRevision,
  DemoViewport,
  NetworkEntry,
  Rect,
  RequestRef,
  ScenarioDiff,
  StepDiff,
  StepState,
  TimingDelta,
  Trace,
  TraceConsole,
  TraceRequest,
  TraceStep,
} from '@covi/core';

/**
 * The comparison of one scenario (a page load or a flow) at base and head, from the two traces
 * and the pixel comparison of their screenshots. Pure: the same inputs give the same diff, and
 * nothing here touches a browser or the disk.
 */

/** A step looks different from this share of changed pixels (the threshold drafts use for before/after). */
export const PIXEL_THRESHOLD = 0.0005;

/**
 * A step's timing is reported when it moved by at least 500 ms and by half its base duration;
 * smaller differences are machine noise. Timing never makes a scenario `changed` on its own.
 */
export const TIMING_THRESHOLD = { ms: 500, ratio: 0.5 } as const;

/** Chrome repeats every failed resource load on the console; the network diff already reports it. */
const RESOURCE_ERROR = /^Failed to load resource:/;

export interface StepPixels {
  changedRatio: number;
  /** The run-relative diff image, when one was written. */
  diff?: string;
  bounds?: Rect;
  regions: Rect[];
}

export interface ScenarioObservation {
  id: string;
  kind: 'flow' | 'page';
  name: string;
  viewport: DemoViewport;
  traces: Partial<Record<DemoRevision, Trace>>;
  /** Pixel comparisons of the base and head screenshots, by step id. */
  pixels: Record<string, StepPixels>;
}

export function diffBehavior(observations: readonly ScenarioObservation[]): BehaviorDiff {
  const scenarios = observations.map(diffScenario);
  const count = (status: ScenarioDiff['status']) =>
    scenarios.filter((s) => s.status === status).length;
  return {
    schemaVersion: 1,
    scenarios,
    summary: {
      scenarios: scenarios.length,
      changed: count('changed'),
      unchanged: count('unchanged'),
      incomplete: count('incomplete'),
    },
  };
}

export function diffScenario(observation: ScenarioObservation): ScenarioDiff {
  const { base, head } = observation.traces;
  const traces: ScenarioDiff['traces'] = {};
  const recordings: NonNullable<ScenarioDiff['recordings']> = {};
  const failure: NonNullable<ScenarioDiff['failure']> = {};
  for (const [revision, trace] of [
    ['base', base],
    ['head', head],
  ] as const) {
    if (!trace) continue;
    traces[revision] = trace.id;
    if (trace.recording) recordings[revision] = trace.recording;
    if (trace.error) failure[revision] = trace.error;
  }
  const out: ScenarioDiff = {
    id: observation.id,
    kind: observation.kind,
    name: observation.name,
    viewport: observation.viewport,
    status: 'unchanged',
    traces,
    ...(Object.keys(recordings).length ? { recordings } : {}),
    ...(Object.keys(failure).length ? { failure } : {}),
    steps: [],
    network: { added: [], removed: [], changed: [] },
    console: { added: [], removed: [] },
    timing: { totalMs: {}, steps: [] },
  };
  if (!base || !head) {
    out.status = 'incomplete';
    out.missing = base ? 'head' : 'base';
    const present = base ?? head;
    if (present) out.timing.totalMs[present.revision] = present.durationMs;
    return out;
  }
  out.steps = diffSteps(base, head, observation.pixels);
  out.network = diffNetwork(base.requests, head.requests);
  out.console = diffConsole(base.console, head.console);
  out.timing = diffTiming(base, head);
  const differs =
    Boolean(base.error) !== Boolean(head.error) ||
    out.steps.length > 0 ||
    out.network.added.length + out.network.removed.length + out.network.changed.length > 0 ||
    out.console.added.length + out.console.removed.length > 0;
  out.status = differs ? 'changed' : 'unchanged';
  return out;
}

const stateOf = (step?: TraceStep): StepState => (step ? step.status : 'missing');

/** Steps whose outcome differs, or whose screenshots differ beyond PIXEL_THRESHOLD. Head order first. */
export function diffSteps(
  base: Trace,
  head: Trace,
  pixels: Record<string, StepPixels>,
): StepDiff[] {
  const before = new Map(base.steps.map((s) => [s.id, s]));
  const after = new Map(head.steps.map((s) => [s.id, s]));
  const ids = [...after.keys(), ...[...before.keys()].filter((id) => !after.has(id))];
  const out: StepDiff[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const h = after.get(id);
    const p = pixels[id];
    const looks = p !== undefined && p.changedRatio >= PIXEL_THRESHOLD;
    if (stateOf(b) === stateOf(h) && !looks) continue;
    const label = h?.label ?? b?.label;
    out.push({
      id,
      ...(label ? { label } : {}),
      base: stateOf(b),
      head: stateOf(h),
      ...(looks
        ? {
            changedRatio: Number(p.changedRatio.toFixed(5)),
            ...(p.diff ? { diff: p.diff } : {}),
            regions: p.regions.map((r, i) => ({ id: `r${i + 1}`, ...r })),
          }
        : { regions: [] }),
    });
  }
  return out;
}

const keyOf = (r: TraceRequest) => `${r.method} ${r.url.split(/[?#]/)[0]}`;

const refOf = (r: TraceRequest): RequestRef => ({
  request: r.id,
  ...(r.status !== undefined ? { status: r.status } : {}),
  ...(r.failure ? { failure: r.failure } : {}),
});

const entryOf = (key: string, r: TraceRequest): NetworkEntry => ({
  key,
  method: r.method,
  url: r.url,
  ...refOf(r),
});

function byKey(requests: readonly TraceRequest[]): Map<string, TraceRequest[]> {
  const out = new Map<string, TraceRequest[]>();
  for (const r of requests) out.set(keyOf(r), [...(out.get(keyOf(r)) ?? []), r]);
  return out;
}

/**
 * Requests matched by `METHOD path`. A key on one side only is added or removed; paired requests
 * changed when their status or failure differs. Extra repeats of a key (polling) are ignored:
 * their count depends on how long the run took, not on the change.
 */
export function diffNetwork(
  base: readonly TraceRequest[],
  head: readonly TraceRequest[],
): ScenarioDiff['network'] {
  const before = byKey(base);
  const after = byKey(head);
  const out: ScenarioDiff['network'] = { added: [], removed: [], changed: [] };
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(key) ?? [];
    const h = after.get(key) ?? [];
    if (!b.length) {
      out.added.push(entryOf(key, h[0]!));
      continue;
    }
    if (!h.length) {
      out.removed.push(entryOf(key, b[0]!));
      continue;
    }
    for (let i = 0; i < Math.min(b.length, h.length); i++) {
      const x = b[i]!;
      const y = h[i]!;
      if (x.status !== y.status || Boolean(x.failure) !== Boolean(y.failure))
        out.changed.push({ key, method: y.method, url: y.url, base: refOf(x), head: refOf(y) });
    }
  }
  return out;
}

/** Errors only, as a set: the same error logged ten times is one error. */
function errorsByKey(messages: readonly TraceConsole[]): Map<string, TraceConsole> {
  const out = new Map<string, TraceConsole>();
  for (const m of messages) {
    if (m.level !== 'error' || RESOURCE_ERROR.test(m.text)) continue;
    // Long numbers are timestamps, ids, or durations: they differ between any two runs.
    const key = `${m.level} ${m.text.replace(/\d{4,}/g, '#')}`;
    if (!out.has(key)) out.set(key, m);
  }
  return out;
}

const consoleEntry = (m: TraceConsole): ConsoleEntry => ({
  message: m.id,
  level: m.level,
  text: m.text,
});

export function diffConsole(
  base: readonly TraceConsole[],
  head: readonly TraceConsole[],
): ScenarioDiff['console'] {
  const before = errorsByKey(base);
  const after = errorsByKey(head);
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, m]) => consoleEntry(m)),
    removed: [...before].filter(([k]) => !after.has(k)).map(([, m]) => consoleEntry(m)),
  };
}

export function diffTiming(base: Trace, head: Trace): ScenarioDiff['timing'] {
  const before = new Map(base.steps.map((s) => [s.id, s]));
  const steps: TimingDelta[] = [];
  for (const s of head.steps) {
    const b = before.get(s.id);
    if (!b || b.status !== 'ok' || s.status !== 'ok') continue;
    const deltaMs = s.durationMs - b.durationMs;
    if (Math.abs(deltaMs) >= Math.max(TIMING_THRESHOLD.ms, b.durationMs * TIMING_THRESHOLD.ratio))
      steps.push({ step: s.id, baseMs: b.durationMs, headMs: s.durationMs, deltaMs });
  }
  return { totalMs: { base: base.durationMs, head: head.durationMs }, steps };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/capture/test/behavior.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/capture && npx biome check packages/capture`

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/behavior.ts packages/capture/test/behavior.test.ts
git commit -m "Compare base and head traces into a deterministic behavior diff" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 6: Capture — Playwright recording and tracing

**Files:**
- Create: `packages/capture/src/recording.ts`
- Create: `packages/capture/src/observe.ts`
- Modify: `packages/capture/src/browser.ts` (full replacement below)
- Test: `packages/capture/test/browser.test.ts` (new)

**Interfaces:**
- Consumes: `TraceCollector` (Task 4), `mergeRegions` (Task 3), `exec` and `EnvironmentError` from core.
- Produces:
  - `RecordingUnavailableError extends EnvironmentError` (exit 3). Its constructor takes `detail: string`, and its message is `Flows cannot be recorded: <detail>`.
  - `finalizeRecording(raw: string, targets: { mp4: string; webm: string }, ffmpeg: string | undefined): Promise<FinalRecording>`, with `FinalRecording = { file: string; format: 'mp4' | 'webm'; cause?: 'no-ffmpeg' | 'convert-failed'; detail?: string }`.
  - `MUTATION_SCRIPT: string`, `observe(page: Page, trace: TraceCollector): Promise<void>`, and `collectMutations(page: Page, scale: number): Promise<MutationSummary>`.
  - `contextOptions(viewport, options?: { recordDir?: string }): BrowserContextOptions` and `newContext(browser, viewport, options?)`.
  - `capturePage(browser, url, viewport, file, trace?: TraceCollector): Promise<PageCapture>`. `PageCapture` gains `title?`.
  - `FlowFrame.step: string`, `stepId(index: number): string` (returns `s<index+1>`), and `FlowOptions = { recordDir?: string; trace?: TraceCollector }`.
  - `FlowRun = { frames; error?; errors; title?; video?: string; recordError?: string }`, and `runFlow(browser, baseUrl, flow, viewport, fileFor, options?: FlowOptions): Promise<FlowRun>`.

- [ ] **Step 1: Write the failing tests**

`packages/capture/test/browser.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ExitCode, Redactor, serveStatic, type StaticServer } from '@covi/core';
import { type Browser, type BrowserContextOptions, chromium } from 'playwright';
import { afterEach, describe, expect, it } from 'vitest';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { contextOptions, runFlow } from '../src/browser.ts';
import { finalizeRecording, RecordingUnavailableError } from '../src/recording.ts';
import { TraceCollector } from '../src/trace.ts';

const browserAvailable = await canUseBrowser();
let dir: string | undefined;
let server: StaticServer | undefined;
let browser: Browser | undefined;
afterEach(async () => {
  await browser?.close();
  await server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  browser = undefined;
  server = undefined;
  dir = undefined;
});

const PAGE = `<!doctype html><html><head><title>Probe</title></head><body>
<button id="add">Add</button><ul id="list"></ul>
<script>
document.getElementById('add').addEventListener('click', async () => {
  const r = await fetch('/missing.json?token=abcdef123456');
  console.error('Could not load: HTTP ' + r.status);
  document.getElementById('list').appendChild(document.createElement('li')).textContent = 'Added';
});
</script></body></html>`;

const FLOW = {
  name: 'Add one',
  path: '/',
  steps: [{ click: '#add', note: 'Add an item' }, { wait: 300 }],
};

describe('contextOptions', () => {
  it('records at the viewport in CSS pixels, only when asked', () => {
    expect(contextOptions('desktop').recordVideo).toBeUndefined();
    const mobile = contextOptions('mobile', { recordDir: '/tmp/rec' });
    expect(mobile.recordVideo).toEqual({ dir: '/tmp/rec', size: { width: 390, height: 844 } });
    expect(mobile.deviceScaleFactor).toBe(2);
  });
});

describe('finalizeRecording', () => {
  it('keeps the WebM when there is no ffmpeg', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-rec-'));
    writeFileSync(join(dir, 'page@1.webm'), 'webm bytes');
    const targets = { mp4: join(dir, 'flow-x-head.mp4'), webm: join(dir, 'flow-x-head.webm') };
    expect(await finalizeRecording(join(dir, 'page@1.webm'), targets, undefined)).toEqual({
      file: targets.webm,
      format: 'webm',
      cause: 'no-ffmpeg',
    });
    expect(existsSync(targets.webm)).toBe(true);
    expect(existsSync(join(dir, 'page@1.webm'))).toBe(false);
  });

  it('keeps the WebM, and says why, when ffmpeg cannot convert it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-rec-'));
    writeFileSync(join(dir, 'page@1.webm'), 'not a video');
    const targets = { mp4: join(dir, 'flow-x-head.mp4'), webm: join(dir, 'flow-x-head.webm') };
    const result = await finalizeRecording(join(dir, 'page@1.webm'), targets, join(dir, 'no-ffmpeg'));
    expect(result).toMatchObject({ file: targets.webm, format: 'webm', cause: 'convert-failed' });
    expect(result.detail).toBeTruthy();
    expect(existsSync(targets.mp4)).toBe(false);
  });

  it('fails with the environment exit code when recording was required', () => {
    const error = new RecordingUnavailableError('Chromium is not installed');
    expect(error.exitCode).toBe(ExitCode.environment);
    expect(error.message).toBe('Flows cannot be recorded: Chromium is not installed');
  });
});

describe.skipIf(!browserAvailable)('runFlow with a trace and a recording', () => {
  it('records the flow, traces its steps, requests, console, and DOM changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    browser = await chromium.launch();
    const trace = new TraceCollector(
      { id: 'flow-add-one-head', scenario: 'flow-add-one', kind: 'flow', name: 'Add one', revision: 'head', viewport: 'mobile', path: '/' },
      { origin: server.url, redactor: new Redactor(), relative: (f) => relative(dir!, f) },
    );
    const outcome = await runFlow(browser, server.url, FLOW, 'mobile', (i) => join(dir!, `f-${i}.png`), {
      recordDir: join(dir, 'rec'),
      trace,
    });
    const result = trace.finish({ title: outcome.title });
    expect(outcome.error).toBeUndefined();
    expect(outcome.frames.map((f) => f.step)).toEqual(['s1', 'end']);
    expect(outcome.video).toMatch(/\.webm$/);
    expect(existsSync(outcome.video!)).toBe(true);
    expect(result.title).toBe('Probe');
    expect(result.steps.map((s) => s.id)).toEqual(['open', 's1', 's2', 'end']);
    const s1 = result.steps[1]!;
    expect(s1).toMatchObject({ action: 'click', target: '#add', label: 'Add an item', screenshot: 'f-0.png' });
    // Mobile renders at 2×: the box is in image pixels, like the frame's focus (12 CSS px padding a side).
    const focus = outcome.frames[0]!.focus!;
    expect(Math.abs(focus.width - s1.box!.width - 48)).toBeLessThanOrEqual(1);
    expect(result.mutations.count).toBeGreaterThan(0);
    expect(result.requests).toContainEqual(
      expect.objectContaining({ method: 'GET', url: '/missing.json?token=[REDACTED]', status: 404, type: 'fetch' }),
    );
    expect(result.console).toContainEqual(
      expect.objectContaining({ level: 'error', text: 'Could not load: HTTP 404' }),
    );
  });

  it('runs the flow unrecorded and says why when the recorder cannot start', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
    writeFileSync(join(dir, 'index.html'), PAGE);
    server = await serveStatic(dir);
    const real = await chromium.launch();
    browser = real;
    // Playwright records with its own ffmpeg build; without it, opening a recorded page fails.
    const noRecorder = {
      newContext: (options?: BrowserContextOptions) =>
        options?.recordVideo
          ? Promise.reject(new Error("Executable doesn't exist at /x/ffmpeg-mac"))
          : real.newContext(options),
    } as unknown as Browser;
    const outcome = await runFlow(noRecorder, server.url, FLOW, 'desktop', (i) => join(dir!, `f-${i}.png`), {
      recordDir: join(dir, 'rec'),
    });
    expect(outcome.video).toBeUndefined();
    expect(outcome.recordError).toMatch(/Executable doesn't exist/);
    expect(outcome.frames.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/capture/test/browser.test.ts`
Expected: FAIL. `../src/recording.ts` is not found, and `contextOptions` is not exported.

- [ ] **Step 3: Implement**

`packages/capture/src/recording.ts`:

```ts
import { rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EnvironmentError, exec } from '@covi/core';

/** Recording was asked for explicitly (a flag, COVI_DEMO_RECORD, or configuration) and cannot happen. */
export class RecordingUnavailableError extends EnvironmentError {
  constructor(detail: string) {
    super(
      `Flows cannot be recorded: ${detail}`,
      'Install the browser with `covi doctor --install-browser`, or pass --no-record (demo.record: false).',
    );
    this.name = 'RecordingUnavailableError';
  }
}

export interface FinalRecording {
  file: string;
  format: 'mp4' | 'webm';
  /** Why the recording stayed WebM. */
  cause?: 'no-ffmpeg' | 'convert-failed';
  detail?: string;
}

/** H.264 plays everywhere; mpeg4 when this ffmpeg build has no libx264. */
const ENCODERS: ReadonlyArray<readonly string[]> = [
  ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'],
  ['-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p'],
];

/**
 * Turns Playwright's WebM into `targets.mp4` with ffmpeg, or keeps it as `targets.webm` when ffmpeg
 * is missing or fails: a WebM is still evidence, and missing ffmpeg must not fail a demonstration.
 */
export async function finalizeRecording(
  raw: string,
  targets: { mp4: string; webm: string },
  ffmpeg: string | undefined,
): Promise<FinalRecording> {
  if (!ffmpeg) {
    await rename(raw, targets.webm);
    return { file: targets.webm, format: 'webm', cause: 'no-ffmpeg' };
  }
  let detail = '';
  for (const encoder of ENCODERS) {
    try {
      const result = await exec(
        ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-y',
          '-loglevel',
          'error',
          '-i',
          raw,
          '-an',
          ...encoder,
          // yuv420p needs even dimensions.
          '-vf',
          'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-movflags',
          '+faststart',
          targets.mp4,
        ],
        { cwd: dirname(raw), timeoutMs: 120_000 },
      );
      if (result.exitCode === 0) {
        await rm(raw, { force: true });
        return { file: targets.mp4, format: 'mp4' };
      }
      detail = result.stderr.trim().split('\n').at(-1) || `ffmpeg exited with ${result.exitCode}`;
    } catch (error) {
      // ffmpeg cannot run at all; another encoder will not help.
      detail = (error as Error).message.split('\n')[0]!;
      break;
    }
  }
  await rm(targets.mp4, { force: true });
  await rename(raw, targets.webm);
  return { file: targets.webm, format: 'webm', cause: 'convert-failed', detail };
}
```

`packages/capture/src/observe.ts`:

```ts
import type { MutationSummary, Rect } from '@covi/core';
import type { Page, Request } from 'playwright';
import { mergeRegions } from './regions.ts';
import type { TraceCollector } from './trace.ts';

/**
 * Counts DOM changes once the page has loaded and remembers which elements changed (at most 200).
 * Changes inside <head>, Covi's own style tag among them, are not the app's behavior. Written as a
 * string because this package compiles without DOM types.
 */
export const MUTATION_SCRIPT = `(() => {
  if (window.__coviMutations) return;
  const state = { count: 0, targets: new Set(), on: false };
  window.__coviMutations = state;
  new MutationObserver((records) => {
    if (!state.on) return;
    for (const record of records) {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!el || el === document.documentElement || (document.head && document.head.contains(el))) continue;
      state.count++;
      if (state.targets.size < 200) state.targets.add(el);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener('load', () => { state.on = true; });
})();`;

/** Reads and resets the changes since the last call; boxes in CSS pixels, relative to the viewport. */
const TAKE_MUTATIONS = `(() => {
  const state = window.__coviMutations;
  if (!state) return { count: 0, rects: [] };
  const rects = [];
  for (const el of state.targets) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  const out = { count: state.count, rects };
  state.count = 0;
  state.targets.clear();
  return out;
})()`;

/** DOM changes since the last call, as merged regions in image pixels. */
export async function collectMutations(page: Page, scale: number): Promise<MutationSummary> {
  const taken = (await page.evaluate(TAKE_MUTATIONS).catch(() => undefined)) as
    | { count: number; rects: Rect[] }
    | undefined;
  if (!taken) return { count: 0, regions: [] };
  return { count: taken.count, regions: mergeRegions(taken.rects, { scale }) };
}

function elapsed(request: Request): number | undefined {
  const end = request.timing().responseEnd;
  return end >= 0 ? end : undefined;
}

/** Feeds a page's requests, console messages, and errors into a trace. Call before navigating. */
export async function observe(page: Page, trace: TraceCollector): Promise<void> {
  await page.addInitScript(MUTATION_SCRIPT);
  page.on('request', (request) =>
    trace.request(request, {
      method: request.method(),
      url: request.url(),
      type: request.resourceType(),
    }),
  );
  page.on('requestfinished', (request) => {
    request.response().then(
      (response) =>
        trace.response(request, { status: response?.status(), durationMs: elapsed(request) }),
      () => trace.response(request, { durationMs: elapsed(request) }),
    );
  });
  page.on('requestfailed', (request) =>
    trace.response(request, {
      failure: request.failure()?.errorText ?? 'failed',
      durationMs: elapsed(request),
    }),
  );
  page.on('console', (message) =>
    trace.console({ level: message.type(), text: message.text(), location: message.location() }),
  );
  page.on('pageerror', (error) =>
    trace.console({ level: 'error', source: 'pageerror', text: error.message }),
  );
}
```

`packages/capture/src/browser.ts`: full replacement. `describe`, `shortSelector`, `targetOf`, and `settle` are unchanged from today.

```ts
import type { Flow, FlowStep, Rect } from '@covi/core';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { collectMutations, observe } from './observe.ts';
import type { TraceCollector } from './trace.ts';

export const VIEWPORT_PRESETS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
} as const;

export type ViewportName = keyof typeof VIEWPORT_PRESETS;

export interface ContextOptions {
  /** Record a WebM of every page in the context into this directory. */
  recordDir?: string;
}

/** Context settings for a viewport, the same at base and head so their captures compare. */
export function contextOptions(
  viewport: ViewportName,
  options: ContextOptions = {},
): BrowserContextOptions {
  const v = VIEWPORT_PRESETS[viewport];
  return {
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.deviceScaleFactor,
    isMobile: v.isMobile,
    hasTouch: v.isMobile,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    // The viewport at CSS size; Playwright would otherwise shrink the video to fit 800×800.
    ...(options.recordDir
      ? { recordVideo: { dir: options.recordDir, size: { width: v.width, height: v.height } } }
      : {}),
  };
}

export async function newContext(
  browser: Browser,
  viewport: ViewportName,
  options: ContextOptions = {},
): Promise<BrowserContext> {
  return browser.newContext(contextOptions(viewport, options));
}

// settle(page) — unchanged.

export interface PageCapture {
  file: string;
  width: number;
  height: number;
  scale: number;
  status?: number;
  errors: string[];
  title?: string;
}

/** Screenshots a page (full height, capped) and collects console and page errors. */
export async function capturePage(
  browser: Browser,
  url: string,
  viewport: ViewportName,
  file: string,
  trace?: TraceCollector,
): Promise<PageCapture> {
  const context = await newContext(browser, viewport);
  const page = await context.newPage();
  const v = VIEWPORT_PRESETS[viewport];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  if (trace) {
    trace.start();
    await observe(page, trace);
    trace.beginStep({ id: 'load', action: 'goto' });
  }
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const fullHeight = Number(
      await page.evaluate(
        'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
      ),
    );
    const height = Math.min(Math.max(v.height, fullHeight), v.height * 3);
    await page.screenshot({
      path: file,
      fullPage: true,
      clip: { x: 0, y: 0, width: v.width, height },
    });
    trace?.frame(file);
    trace?.endStep({ mutations: await collectMutations(page, v.deviceScaleFactor) });
    return {
      file,
      width: v.width * v.deviceScaleFactor,
      height: height * v.deviceScaleFactor,
      scale: v.deviceScaleFactor,
      status: response?.status(),
      errors,
      title: await page.title().catch(() => undefined),
    };
  } catch (error) {
    trace?.endStep({ status: 'failed', error: (error as Error).message.split('\n')[0] });
    throw error;
  } finally {
    trace?.stop();
    await context.close();
  }
}

export interface FlowFrame {
  file: string;
  label: string;
  /** The step the frame belongs to (`open`, `s1`…, `end`): the same at base and head. */
  step: string;
  click?: { x: number; y: number };
  focus?: { x: number; y: number; width: number; height: number };
}

// describe(step), shortSelector(selector), targetOf(step) — unchanged.

/** A flow step's id: `s1`… in plan order, so base and head steps pair up. */
export function stepId(index: number): string {
  return `s${index + 1}`;
}

const ACTIONS = [
  'goto',
  'click',
  'fill',
  'press',
  'hover',
  'select',
  'check',
  'scroll',
  'wait',
  'screenshot',
] as const;

function actionOf(step: FlowStep): string {
  return ACTIONS.find((a) => a in step) ?? 'step';
}

function traceTarget(step: FlowStep): string | undefined {
  if ('goto' in step) return step.goto;
  if ('scroll' in step) return typeof step.scroll === 'string' ? step.scroll : undefined;
  if ('wait' in step) return typeof step.wait === 'string' ? step.wait : undefined;
  return targetOf(step);
}

export interface FlowOptions {
  /** Record the flow as WebM into this directory (Playwright picks the file name). */
  recordDir?: string;
  trace?: TraceCollector;
}

export interface FlowRun {
  frames: FlowFrame[];
  error?: string;
  errors: string[];
  title?: string;
  /** The WebM Playwright wrote, when the flow was recorded. */
  video?: string;
  /** Why recording was asked for and could not start; the flow still ran, unrecorded. */
  recordError?: string;
}

/**
 * Opens a page, recording it when asked. Playwright records with its own ffmpeg build; when that
 * is missing the page cannot open with recording on, so the flow runs unrecorded and says why.
 */
async function openPage(
  browser: Browser,
  viewport: ViewportName,
  recordDir?: string,
): Promise<{ context: BrowserContext; page: Page; recordError?: string }> {
  if (recordDir) {
    let context: BrowserContext | undefined;
    try {
      context = await newContext(browser, viewport, { recordDir });
      return { context, page: await context.newPage() };
    } catch (error) {
      await context?.close().catch(() => undefined);
      const plain = await newContext(browser, viewport);
      return {
        context: plain,
        page: await plain.newPage(),
        recordError: (error as Error).message.split('\n')[0]!,
      };
    }
  }
  const context = await newContext(browser, viewport);
  return { context, page: await context.newPage() };
}

/**
 * Runs a scripted flow. Each interactive step is captured *before* it happens (so the video can
 * move the cursor to the target and click), and the flow ends with the resulting state. With a
 * trace, every step is timed from the start of the recording, with what it changed in the DOM.
 */
export async function runFlow(
  browser: Browser,
  baseUrl: string,
  flow: Flow,
  viewport: ViewportName,
  fileFor: (index: number) => string,
  options: FlowOptions = {},
): Promise<FlowRun> {
  const { context, page, recordError } = await openPage(browser, viewport, options.recordDir);
  const video = page.video();
  const scale = VIEWPORT_PRESETS[viewport].deviceScaleFactor;
  const trace = options.trace;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (trace) {
    trace.start();
    await observe(page, trace);
  }
  const frames: FlowFrame[] = [];
  let current = 'open';
  const shoot = async (label: string, target?: string) => {
    let click: FlowFrame['click'];
    let focus: FlowFrame['focus'];
    let box: Rect | undefined;
    if (target) {
      const found = await page
        .locator(target)
        .first()
        .boundingBox({ timeout: 5000 })
        .catch(() => null);
      if (found) {
        click = {
          x: Math.round((found.x + found.width / 2) * scale),
          y: Math.round((found.y + found.height / 2) * scale),
        };
        const pad = 12;
        focus = {
          x: Math.round((found.x - pad) * scale),
          y: Math.round((found.y - pad) * scale),
          width: Math.round((found.width + pad * 2) * scale),
          height: Math.round((found.height + pad * 2) * scale),
        };
        box = {
          x: Math.round(found.x * scale),
          y: Math.round(found.y * scale),
          width: Math.round(found.width * scale),
          height: Math.round(found.height * scale),
        };
      }
    }
    const file = fileFor(frames.length);
    await page.screenshot({ path: file });
    frames.push({ file, label, step: current, click, focus });
    trace?.frame(file, box);
  };
  // Read after each step, so the DOM changes describe what that step's action caused.
  const endStep = async () => trace?.endStep({ mutations: await collectMutations(page, scale) });
  let result: FlowRun;
  try {
    trace?.beginStep({ id: 'open', action: 'goto', target: flow.path });
    await page.goto(`${baseUrl}${flow.path}`, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);
    const first = flow.steps[0];
    if (!first || !describe(first)) await shoot(flow.description ?? `Open ${flow.path}`);
    await endStep();
    for (const [index, step] of flow.steps.entries()) {
      current = stepId(index);
      const label = describe(step);
      const target = targetOf(step);
      trace?.beginStep({
        id: current,
        action: actionOf(step),
        target: traceTarget(step),
        label: label ?? ('screenshot' in step ? (step.note ?? step.screenshot) : undefined),
      });
      if (label && target) await shoot(label, target);
      if ('goto' in step) await page.goto(`${baseUrl}${step.goto}`, { waitUntil: 'load' });
      else if ('click' in step) await page.locator(step.click).first().click({ timeout: 8000 });
      else if ('fill' in step)
        await page.locator(step.fill).first().fill(step.text, { timeout: 8000 });
      else if ('press' in step)
        await (step.selector
          ? page.locator(step.selector).first().press(step.press)
          : page.keyboard.press(step.press));
      else if ('hover' in step) await page.locator(step.hover).first().hover({ timeout: 8000 });
      else if ('select' in step)
        await page.locator(step.select).first().selectOption(step.value, { timeout: 8000 });
      else if ('check' in step) await page.locator(step.check).first().check({ timeout: 8000 });
      else if ('scroll' in step) {
        if (typeof step.scroll === 'number') await page.mouse.wheel(0, step.scroll);
        else await page.locator(step.scroll).first().scrollIntoViewIfNeeded();
      } else if ('wait' in step) {
        if (typeof step.wait === 'number') await page.waitForTimeout(Math.min(step.wait, 10_000));
        else await page.locator(step.wait).first().waitFor({ timeout: 10_000 });
      } else if ('screenshot' in step) {
        await settle(page);
        await shoot(step.note ?? step.screenshot, step.focus);
        await endStep();
        continue;
      }
      await page.waitForTimeout(200);
      await endStep();
    }
    const last = flow.steps.at(-1);
    if (!last || !('screenshot' in last)) {
      current = 'end';
      trace?.beginStep({ id: 'end', action: 'end', label: flow.name });
      await settle(page);
      await shoot(flow.name);
      await endStep();
    }
    result = { frames, errors, title: await page.title().catch(() => undefined) };
  } catch (error) {
    const message = (error as Error).message.split('\n')[0]!;
    trace?.endStep({ status: 'failed', error: message });
    result = { frames, error: message, errors };
  } finally {
    trace?.stop();
    await context.close();
  }
  if (recordError) result.recordError = recordError;
  // Playwright finishes writing the video when the context closes.
  const recorded = await video?.path().catch(() => undefined);
  if (recorded) result.video = recorded;
  return result;
}
```

Do not touch `index.ts` yet; Task 7 rewrites its exports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/capture/test/browser.test.ts packages/capture/test/capture.test.ts tests/demo.test.ts`
Expected: PASS. The browser tests are skipped when Chromium is missing. `tests/demo.test.ts` still passes because the flow labels are unchanged.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/capture && npx biome check packages/capture`

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/recording.ts packages/capture/src/observe.ts packages/capture/src/browser.ts packages/capture/test/browser.test.ts
git commit -m "Record and trace browser flows and page captures with Playwright" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 7: Capture — demonstrate at both revisions and write the behavior diff

**Files:**
- Create: `packages/capture/src/ids.ts`
- Create: `packages/capture/src/scenarios.ts`
- Create: `tests/helpers/behavior-app.ts`
- Modify: `packages/capture/src/demonstrate.ts`
- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/test/demonstrate.test.ts` (new)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  - `slug(text)`, `uniqueIds(ids)`, `flowScenario(name)`, and `pageScenario(path, viewport)`.
  - `runRelative(run, file)` and `observeFlow(input: ObserveFlowInput): Promise<ObservedFlow>`.
  - `compareSteps(run, scenario, base: Trace, head: Trace): Promise<Record<string, StepPixels>>`.
  - `flowShots(run, input): Promise<DemoShot[]>` and `writeBehaviorDiff(run, observations): Promise<BehaviorDiff>`.
  - `recordingStatus(enabled: boolean, notes: readonly RecordingNote[], recorded: number): DemoRecordingStatus`.
  - `DemonstrateInput.recording?: { enabled: boolean; required: boolean }` and `DemonstrateInput.locateFfmpeg?: () => Promise<string | undefined>`.
  - The fixture `BEHAVIOR_APP`, `BEHAVIOR_CONFIG`, `BEHAVIOR_SECRETS`, and `RETRY_FLOW` (used again by Task 8).

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/helpers/behavior-app.ts`:

```ts
import type { FileMap } from './repo.ts';

/**
 * A tiny static app for behavior diffs: clicking "Load" fetches /items.json. At head the file is
 * gone, so the same request answers 404 and the page logs one new console error. The page also
 * sends a session id in the URL and logs a token-shaped string, which no artifact may contain.
 */

const TOKEN_TAIL = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';

// Assembled at runtime, so no secret scanner (or Covi) flags this file.
export const BEHAVIOR_SECRETS = {
  session: 'sess-4f9c2a7b1e',
  token: ['ghp', '_', TOKEN_TAIL].join(''),
};

export const BEHAVIOR_FLOWS = [
  {
    name: 'Load items',
    path: '/',
    steps: [{ click: '#load', note: 'Load the items' }, { wait: 300 }],
  },
];

/** Works only at head, where the Retry button exists: base fails at its step. */
export const RETRY_FLOW = { name: 'Retry', path: '/', steps: [{ click: '#retry', note: 'Retry' }] };

export const BEHAVIOR_CONFIG = {
  app: { static: '.' },
  demo: { viewports: ['desktop'], flows: BEHAVIOR_FLOWS },
};

const index = (extra: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Items</title>
  <style>body{font:16px/1.4 sans-serif;margin:40px}li{padding:4px 0}#status{color:#b00020}</style>
</head>
<body>
  <h1>Items</h1>
  <button id="load">Load</button>${extra}
  <ul id="list"></ul>
  <p id="status" role="alert"></p>
  <script src="app.js"></script>
</body>
</html>
`;

const render = `  const items = await response.json();
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    document.getElementById('list').appendChild(li);
  }`;

export const BEHAVIOR_APP: { base: FileMap; head: FileMap } = {
  base: {
    '.covi/config.yml': [
      'app:',
      '  static: .',
      'demo:',
      '  viewports: [desktop]',
      '  flows:',
      '    - name: Load items',
      '      path: /',
      '      steps:',
      '        - click: "#load"',
      '          note: Load the items',
      '        - wait: 300',
      '',
    ].join('\n'),
    'index.html': index(''),
    'items.json': '["Apples", "Pears"]\n',
    'app.js': `const SESSION = '${BEHAVIOR_SECRETS.session}';
document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/items.json?session=' + SESSION);
${render}
});
`,
  },
  head: {
    'index.html': index('\n  <button id="retry">Retry</button>'),
    'items.json': null,
    'app.js': `const SESSION = '${BEHAVIOR_SECRETS.session}';
const TOKEN = ['ghp', '_', '${TOKEN_TAIL}'].join('');
document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/items.json?session=' + SESSION);
  if (!response.ok) {
    console.error('Could not load items: HTTP ' + response.status);
    console.info('debug token ' + TOKEN);
    document.getElementById('status').textContent = 'Could not load items.';
    return;
  }
${render}
});
document.getElementById('retry').addEventListener('click', () => {
  document.getElementById('status').textContent = '';
});
`,
  },
};
```

`packages/capture/test/demonstrate.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type BehaviorDiff,
  Git,
  parseConfigInput,
  Redactor,
  Run,
  resolveChange,
  resolveConfig,
  type StaticServer,
  serveStatic,
  silentLogger,
  type Trace,
  understandChange,
  which,
} from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BEHAVIOR_APP,
  BEHAVIOR_CONFIG,
  BEHAVIOR_FLOWS,
  BEHAVIOR_SECRETS,
  RETRY_FLOW,
} from '../../../tests/helpers/behavior-app.ts';
import { canUseBrowser } from '../../../tests/helpers/env.ts';
import { createChangeRepo, type TempRepo } from '../../../tests/helpers/repo.ts';
import { demonstrate } from '../src/demonstrate.ts';
import { flowScenario, uniqueIds } from '../src/ids.ts';
import { recordingStatus } from '../src/scenarios.ts';

const browser = await canUseBrowser();
let repo: TempRepo | undefined;
let root: string | undefined;
let server: StaticServer | undefined;
afterEach(async () => {
  await server?.close();
  repo?.cleanup();
  if (root) rmSync(root, { recursive: true, force: true });
  server = undefined;
  repo = undefined;
  root = undefined;
});

async function setup(configFor: (repoRoot: string) => unknown | Promise<unknown> = () => BEHAVIOR_CONFIG) {
  repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
  const { config } = resolveConfig([
    { name: 'repository', values: parseConfigInput(await configFor(repo.root), 't') },
  ]);
  const change = await resolveChange({ repo: repo.root });
  const context = await understandChange(change, { git: new Git(repo.root), config });
  root = mkdtempSync(join(tmpdir(), 'covi-demo-run-'));
  const run = await Run.create({
    root,
    workflow: 'demo',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: 'test',
    redactor: new Redactor(),
  });
  return { config, change, context, run };
}

const json = <T>(run: Run, rel: string) => JSON.parse(readFileSync(run.path(rel), 'utf8')) as T;

describe('scenario ids', () => {
  it('gives flows whose names make the same id distinct ids, in order', () => {
    expect(flowScenario('Post comment')).toBe(flowScenario('post-comment'));
    expect(
      uniqueIds(['flow-post-comment', 'flow-post-comment', 'flow-post-comment-2', 'flow-x']),
    ).toEqual(['flow-post-comment', 'flow-post-comment-2', 'flow-post-comment-2-2', 'flow-x']);
  });
});

describe('recording status', () => {
  it('says why recordings are WebM or missing', () => {
    expect(recordingStatus(false, [], 0)).toEqual({ status: 'off' });
    expect(recordingStatus(true, [], 2)).toEqual({ status: 'mp4' });
    expect(recordingStatus(true, [{ status: 'webm', cause: 'no-ffmpeg' }], 2)).toEqual({
      status: 'webm',
      cause: 'no-ffmpeg',
    });
    expect(
      recordingStatus(
        true,
        [
          { status: 'webm', cause: 'no-ffmpeg' },
          { status: 'unavailable', cause: 'no-recorder', detail: 'x' },
        ],
        1,
      ),
    ).toEqual({ status: 'unavailable', cause: 'no-recorder', detail: 'x' });
    expect(recordingStatus(true, [], 0)).toEqual({ status: 'unavailable', cause: 'no-recorder' });
  });
});

describe.skipIf(!browser)('behavior diff capture', () => {
  it('compares a flow at base and head: one changed request and one new console error', async () => {
    const { config, change, context, run } = await setup();
    const ffmpeg = await which(['ffmpeg']);
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      locateFfmpeg: async () => ffmpeg,
    });
    expect(demo.behavior).toEqual({ path: 'demo/behavior-diff.json', scenarios: 1, changed: 1 });
    const flow = json<BehaviorDiff>(run, 'demo/behavior-diff.json').scenarios[0]!;
    expect(flow).toMatchObject({
      id: 'flow-load-items',
      kind: 'flow',
      status: 'changed',
      traces: { base: 'flow-load-items-base', head: 'flow-load-items-head' },
    });
    expect(flow.network.changed).toEqual([
      expect.objectContaining({
        key: 'GET /items.json',
        base: expect.objectContaining({ status: 200 }),
        head: expect.objectContaining({ status: 404 }),
      }),
    ]);
    expect(flow.network.added).toEqual([]);
    expect(flow.network.removed).toEqual([]);
    expect(flow.console.added.map((m) => m.text)).toEqual(['Could not load items: HTTP 404']);
    expect(flow.console.removed).toEqual([]);
    const end = flow.steps.find((s) => s.id === 'end')!;
    expect(end.regions.length).toBeGreaterThan(0);
    expect(existsSync(run.path(end.diff!))).toBe(true);

    expect(demo.recordings!.map((r) => r.revision)).toEqual(['base', 'head']);
    for (const r of demo.recordings!) {
      expect(r.path).toMatch(/^demo\/recordings\/flow-load-items-(base|head)\.(mp4|webm)$/);
      expect(existsSync(run.path(r.path))).toBe(true);
    }
    expect(demo.recording?.status).toBe(ffmpeg ? 'mp4' : 'webm');
    expect(demo.traces!.map((t) => t.path)).toEqual([
      'demo/traces/flow-load-items-base.json',
      'demo/traces/flow-load-items-head.json',
    ]);
    const recorded = new Map(run.manifest.artifacts.map((a) => [a.path, a]));
    for (const path of [
      ...demo.recordings!.map((r) => r.path),
      'demo/traces/flow-load-items-base.json',
      'demo/traces/flow-load-items-head.json',
      'demo/behavior-diff.json',
    ])
      expect(recorded.get(path)?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.get(demo.recordings![0]!.path)?.kind).toBe('recording');
    expect(recorded.get('demo/traces/flow-load-items-head.json')?.kind).toBe('trace');
    expect(recorded.get('demo/behavior-diff.json')?.kind).toBe('behavior-diff');
    // Each flow frame carries the base frame of the same step.
    const steps = demo.shots.filter((s) => s.kind === 'flow-step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.before?.path.endsWith('-base.png'))).toBe(true);
    expect(demo.findings).toEqual([]);
  });

  it('keeps secrets out of every file, does not record when off, and tolerates a flow that fails at base', async () => {
    const { config, change, context, run } = await setup(() => ({
      ...BEHAVIOR_CONFIG,
      demo: { ...BEHAVIOR_CONFIG.demo, flows: [...BEHAVIOR_FLOWS, RETRY_FLOW] },
    }));
    const demo = await demonstrate({
      run,
      change,
      context,
      config,
      logger: silentLogger,
      recording: { enabled: false, required: false },
    });
    expect(demo.recording).toEqual({ status: 'off' });
    expect(demo.recordings).toBeUndefined();
    const files = [
      'demo/captures.json',
      'demo/behavior-diff.json',
      ...readdirSync(run.path('demo/traces')).map((f) => `demo/traces/${f}`),
    ];
    for (const file of files) {
      const text = readFileSync(run.path(file), 'utf8');
      expect(text, file).not.toContain(BEHAVIOR_SECRETS.session);
      expect(text, file).not.toContain(BEHAVIOR_SECRETS.token);
    }
    const head = json<Trace>(run, 'demo/traces/flow-load-items-head.json');
    expect(head.requests).toContainEqual(
      expect.objectContaining({ url: '/items.json?session=[REDACTED]', status: 404 }),
    );
    expect(head.console.map((m) => m.text)).toContain('debug token ghp_[REDACTED]');
    // The Retry button only exists at head: base stopping there is expected, not a finding.
    expect(demo.findings.filter((f) => f.source?.id === 'flow-failure')).toEqual([]);
    const retry = json<BehaviorDiff>(run, 'demo/behavior-diff.json').scenarios.find(
      (s) => s.id === 'flow-retry',
    )!;
    expect(retry.status).toBe('changed');
    expect(retry.failure?.base).toBeTruthy();
    expect(retry.steps[0]).toMatchObject({ id: 's1', base: 'failed', head: 'ok' });
  });

  it('records and traces only the head for an app given by URL, and writes no behavior diff', async () => {
    const { config, change, context, run } = await setup(async (repoRoot) => {
      server = await serveStatic(repoRoot);
      return { app: { url: server.url }, demo: { viewports: ['desktop'], flows: BEHAVIOR_FLOWS } };
    });
    const demo = await demonstrate({ run, change, context, config, logger: silentLogger });
    expect(demo.app?.mode).toBe('url');
    expect(demo.behavior).toBeUndefined();
    expect(existsSync(run.path('demo/behavior-diff.json'))).toBe(false);
    expect(demo.recordings?.map((r) => r.revision)).toEqual(['head']);
    expect(demo.traces?.map((t) => t.revision)).toEqual(['head']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/capture/test/demonstrate.test.ts`
Expected: FAIL. `../src/ids.ts` and `../src/scenarios.ts` are not found.

- [ ] **Step 3: Implement `ids.ts` and `scenarios.ts`**

`packages/capture/src/ids.ts`:

```ts
/** A file-name-safe id from a URL path or a flow name. */
export function slug(text: string): string {
  return (
    text
      .replace(/^\/+/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 40) || 'home'
  );
}

/** Ids made unique in order: a second `flow-post` becomes `flow-post-2`, so files never collide. */
export function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.map((id) => {
    let unique = id;
    for (let n = 2; seen.has(unique); n++) unique = `${id}-${n}`;
    seen.add(unique);
    return unique;
  });
}

/** A flow's scenario id; flow shots and frames already start with it. */
export const flowScenario = (name: string) => `flow-${slug(name)}`;

/** A page's scenario id at one viewport; the same as its shot id. */
export const pageScenario = (path: string, viewport: string) => `${slug(path)}-${viewport}`;
```

`packages/capture/src/scenarios.ts`:

```ts
import { mkdir } from 'node:fs/promises';
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
  PIXEL_THRESHOLD,
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
  ffmpeg: () => Promise<string | undefined>;
}

/** Runs one flow at one revision with its trace (and recording), and writes the trace. */
export async function observeFlow(input: ObserveFlowInput): Promise<ObservedFlow> {
  const { run, flow, scenario, revision, viewport } = input;
  const preset = VIEWPORT_PRESETS[viewport];
  const collector = new TraceCollector(
    { id: `${scenario}-${revision}`, scenario, kind: 'flow', name: flow.name, revision, viewport, path: flow.path },
    { origin: input.baseUrl, redactor: run.redactor, relative: (file) => runRelative(run, file) },
  );
  const recordDir = input.record ? run.path(DEMO_PATHS.recordings) : undefined;
  if (recordDir) await mkdir(recordDir, { recursive: true });
  const outcome = await runFlow(
    input.browser,
    input.baseUrl,
    flow,
    viewport,
    (i) => run.path(demoPath.flowFrame(scenario, i + 1, revision)),
    { recordDir, trace: collector },
  );
  let saved: FinalRecording | undefined;
  let note: RecordingNote | undefined;
  if (outcome.video) {
    saved = await finalizeRecording(
      outcome.video,
      {
        mp4: run.path(demoPath.recording(scenario, revision, 'mp4')),
        webm: run.path(demoPath.recording(scenario, revision, 'webm')),
      },
      await input.ffmpeg(),
    );
    if (saved.cause)
      note = { status: 'webm', cause: saved.cause, ...(saved.detail ? { detail: saved.detail } : {}) };
  } else if (input.record) {
    note = {
      status: 'unavailable',
      cause: 'no-recorder',
      ...(outcome.recordError ? { detail: outcome.recordError } : {}),
    };
  }
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
  base: Trace,
  head: Trace,
): Promise<Record<string, StepPixels>> {
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
      minRatio: PIXEL_THRESHOLD,
    });
    const written = diff.changedRatio >= PIXEL_THRESHOLD;
    if (written) await run.record(rel, 'screenshot');
    out[step.id] = {
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
        ? { before: { path: runRelative(run, base.file), width: baseSize.width, height: baseSize.height } }
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
```

- [ ] **Step 4: Rewire `demonstrate.ts`**

Imports. Replace the import block with:

```ts
import { mkdir } from 'node:fs/promises';
import {
  type CodeChange,
  type CoviConfig,
  childEnv,
  DEMO_PATHS,
  type DemoCommandResult,
  type DemoRecording,
  type Demonstration,
  type DemoRequestResult,
  type DemoShot,
  type DemoTraceRef,
  demoPath,
  type ExecutionPolicy,
  execShell,
  type FindingInput,
  findingId,
  type Language,
  type Logger,
  type Params,
  type ReviewContext,
  type Run,
  t,
  type Trace,
} from '@covi/core';
import { type Browser, chromium } from 'playwright';
import { type RunningApp, startApp } from './app.ts';
import type { ScenarioObservation, StepPixels } from './behavior.ts';
import { capturePage, type PageCapture, VIEWPORT_PRESETS, type ViewportName } from './browser.ts';
import { checkoutRevision, tempWorkspace } from './checkout.ts';
import { flowScenario, pageScenario, uniqueIds } from './ids.ts';
import { comparePngs, cropPng } from './pixels.ts';
import { type DemoPlan, flowViewport, planDemo } from './plan.ts';
import { RecordingUnavailableError } from './recording.ts';
import { describeShapeChange, type HttpResult, normalizeBody, performRequest } from './requests.ts';
import {
  compareSteps,
  flowShots,
  type ObservedFlow,
  observeFlow,
  type RecordingNote,
  recordingStatus,
  runRelative,
  writeBehaviorDiff,
} from './scenarios.ts';
import { TraceCollector } from './trace.ts';
```

Delete the local `slug` and `relativeTo` functions; they moved to `ids.ts` and `scenarios.ts`. Keep `titled`, `ANSI`, `Revision`, `compareRequests`, and `compareCommands` unchanged.

Add to `DemonstrateInput`:

```ts
  /**
   * Whether flows are recorded, and whether a recording that cannot be made fails the run (exit 3).
   * Default: `demo.record`, not required.
   */
  recording?: { enabled: boolean; required: boolean };
  /** Finds ffmpeg for converting recordings to MP4; without it, recordings stay WebM. */
  locateFfmpeg?: () => Promise<string | undefined>;
```

Add above `demonstrate`:

```ts
async function launchBrowser(recordingRequired: boolean): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (error) {
    // Without a browser nothing is recorded; that fails the run only when recording was asked for.
    if (recordingRequired)
      throw new RecordingUnavailableError((error as Error).message.split('\n')[0]!);
    throw error;
  }
}
```

In `demonstrate()`:

1. After `const plan = planDemo(…)`, add:

```ts
  const recording = input.recording ?? { enabled: config.demo.record, required: false };
  let ffmpeg: Promise<string | undefined> | undefined;
  const locateFfmpeg = () => {
    ffmpeg ??= input.locateFfmpeg?.() ?? Promise.resolve(undefined);
    return ffmpeg;
  };
```

2. Replace both `run.writeJson('demo/captures.json', …)` calls with `run.writeJson(DEMO_PATHS.captures, …)`.
3. Replace `const shotsDir = 'demo/screenshots'; await mkdir(run.path(shotsDir), …)` with `await mkdir(run.path(DEMO_PATHS.screenshots), { recursive: true });`.
4. After the `commands` map declaration, add:

```ts
  const pageTraces = new Map<
    string,
    { name: string; viewport: ViewportName; traces: Partial<Record<Revision, Trace>> }
  >();
  const flowIds = uniqueIds(plan.flows.map((f) => flowScenario(f.name)));
  const flows = new Map<number, Partial<Record<Revision, ObservedFlow>>>();
  const notes: RecordingNote[] = [];
```

5. Replace `if (wantsBrowser && mode) browser = await chromium.launch();` with:

```ts
    if (wantsBrowser && mode)
      browser = await launchBrowser(
        recording.enabled && recording.required && plan.flows.length > 0,
      );
```

6. Replace the whole `if (app && browser) { … }` block (pages loop plus the head-only flows loop) with:

```ts
        if (app && browser) {
          for (const path of plan.pages) {
            for (const viewport of plan.viewports) {
              const key = `${path}|${viewport}`;
              const id = pageScenario(path, viewport);
              const file = run.path(demoPath.pageFull(id, revision));
              logger.info(`  capturing ${path} (${viewport}, ${revision})`);
              const collector = new TraceCollector(
                { id: `${id}-${revision}`, scenario: id, kind: 'page', name: path, revision, viewport, path },
                { origin: app.url, redactor: run.redactor, relative: (f) => runRelative(run, f) },
              );
              let trace: Trace;
              try {
                const capture = await capturePage(browser, `${app.url}${path}`, viewport, file, collector);
                pages.set(key, { ...pages.get(key), [revision]: capture });
                trace = collector.finish({ title: capture.title });
              } catch (error) {
                const reason = (error as Error).message.split('\n')[0]!;
                result.skipped.push({ what: `${path} (${viewport}, ${revision})`, reason });
                trace = collector.finish({ error: reason });
              }
              await run.writeJson(demoPath.trace(id, revision), trace, 'trace');
              const seen = pageTraces.get(id) ?? { name: path, viewport, traces: {} };
              seen.traces[revision] = trace;
              pageTraces.set(id, seen);
            }
          }
          for (const [index, flow] of plan.flows.entries()) {
            const viewport = flowViewport(flow, plan.viewports, input.prefer);
            logger.info(`  running flow "${flow.name}" (${viewport}, ${revision})`);
            const observed = await observeFlow({
              run,
              browser,
              baseUrl: app.url,
              flow,
              scenario: flowIds[index]!,
              viewport,
              revision,
              record: recording.enabled,
              ffmpeg: locateFfmpeg,
            });
            flows.set(index, { ...flows.get(index), [revision]: observed });
            if (observed.note) {
              if (observed.note.status === 'unavailable' && recording.required)
                throw new RecordingUnavailableError(observed.note.detail ?? 'the recorder did not start');
              notes.push(observed.note);
            }
            // A flow may fail at base because the change adds what it uses; only head failures count.
            if (revision === 'head' && observed.outcome.error) {
              result.skipped.push({
                what: say('skip.flow', { name: flow.name }),
                reason: observed.outcome.error,
              });
              result.findings.push({
                ...titled(language, 'flow-failure', 'capture.finding.flow.title', { name: flow.name }),
                certainty: 'likely',
                severity: 'medium',
                category: 'regression',
                evidence: observed.outcome.error,
                explanation: say('finding.flow.explanation'),
                source: { kind: 'demo', id: 'flow-failure' },
              });
            }
          }
        }
```

7. Replace the three lines after the revisions loop (`result.shots.unshift(…)`, `result.requests = …`, `result.commands = …`) with:

```ts
    const pixels = new Map<string, StepPixels>();
    const pageShots = await assemblePageShots(run, pages, result.findings, language, pixels);
    const observations: ScenarioObservation[] = [...pageTraces].map(([id, seen]) => ({
      id,
      kind: 'page',
      name: seen.name,
      viewport: seen.viewport,
      traces: seen.traces,
      pixels: pixels.has(id) ? { load: pixels.get(id)! } : {},
    }));
    const flowShotList: DemoShot[] = [];
    const recordings: DemoRecording[] = [];
    for (const [index, flow] of plan.flows.entries()) {
      const observed = flows.get(index);
      if (!observed) continue;
      const scenario = flowIds[index]!;
      const viewport = flowViewport(flow, plan.viewports, input.prefer);
      const { base, head } = observed;
      const stepPixels = base && head ? await compareSteps(run, scenario, base.trace, head.trace) : {};
      if (head)
        flowShotList.push(
          ...(await flowShots(run, {
            scenario,
            flow,
            viewport,
            head: head.outcome,
            base: base?.outcome,
            pixels: stepPixels,
          })),
        );
      observations.push({
        id: scenario,
        kind: 'flow',
        name: flow.name,
        viewport,
        traces: { ...(base ? { base: base.trace } : {}), ...(head ? { head: head.trace } : {}) },
        pixels: stepPixels,
      });
      for (const o of [base, head]) if (o?.recording) recordings.push(o.recording);
    }
    result.shots = [...pageShots, ...flowShotList];
    result.requests = compareRequests(plan, requests, result.findings, language);
    result.commands = compareCommands(plan, commands, result.findings, language);
    const traces: DemoTraceRef[] = observations.flatMap((o) =>
      (['base', 'head'] as const).flatMap((revision) => {
        const trace = o.traces[revision];
        return trace
          ? [{ id: trace.id, scenario: o.id, kind: o.kind, revision, path: demoPath.trace(o.id, revision) }]
          : [];
      }),
    );
    if (traces.length) result.traces = traces;
    if (recordings.length) result.recordings = recordings;
    if (browser && plan.flows.length)
      result.recording = recordingStatus(recording.enabled, notes, recordings.length);
    // Without base there is nothing to compare (an app given by URL runs at head only).
    if (revisions.includes('base') && observations.length) {
      const diff = await writeBehaviorDiff(run, observations);
      result.behavior = {
        path: DEMO_PATHS.behaviorDiff,
        scenarios: diff.summary.scenarios,
        changed: diff.summary.changed,
      };
    }
```

8. `assemblePageShots` gains a fifth parameter `pixels: Map<string, StepPixels>` and uses the paths module:
   - `const id = pageScenario(path, viewport);`
   - `const diffPath = demoPath.pageDiff(id);` and `await mkdir(run.path(DEMO_PATHS.diffs), { recursive: true });`
   - Right after `const diff = await comparePngs(…)`, add `pixels.set(id, { changedRatio: diff.changedRatio, diff: diffPath, regions: diff.regions, ...(diff.bounds ? { bounds: diff.bounds } : {}) });`
   - `const out = demoPath.pageCrop(id, revision === 'base' ? 'before' : 'after');`

`packages/capture/src/index.ts`: full replacement, sorted by module path.

```ts
export { freePort, type RunningApp, startApp, substitute, waitForReady } from './app.ts';
export {
  diffBehavior,
  diffConsole,
  diffNetwork,
  diffScenario,
  diffSteps,
  diffTiming,
  PIXEL_THRESHOLD,
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
export { flowScenario, pageScenario, slug, uniqueIds } from './ids.ts';
export { collectMutations, MUTATION_SCRIPT, observe } from './observe.ts';
export { comparePngs, cropPng, type PixelDiff, readPng } from './pixels.ts';
export { type DemoPlan, DemoPlanSchema, planDemo } from './plan.ts';
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
export { TRACE_LIMITS, TraceCollector, type TraceMeta, type TraceOptions } from './trace.ts';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/capture tests/demo.test.ts tests/architecture.test.ts`
Expected: PASS. Browser tests are skipped without Chromium. The existing `tests/demo.test.ts` flow and page assertions still hold because shot ids, labels, and page shot ordering are unchanged. Expect the second integration test to take about 15 s: base waits out the Retry click.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/capture tests/helpers/behavior-app.ts && npx biome check packages/capture tests/helpers`

- [ ] **Step 7: Commit**

```bash
git add packages/capture/src/ids.ts packages/capture/src/scenarios.ts packages/capture/src/demonstrate.ts packages/capture/src/index.ts packages/capture/test/demonstrate.test.ts tests/helpers/behavior-app.ts
git commit -m "Run flows at base and head and write demo/behavior-diff.json" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 8: CLI — flags, recording policy, exit 3, and the `demo.md` sections

**Files:**
- Modify: `packages/cli/src/main.ts` (`addRecord`, `explicitConfig`, and the `review`, `demo`, `video`, and `ci` chains)
- Modify: `packages/cli/src/workflows.ts` (`recordingOf`, `locateFfmpeg`, `demoStage`, `reviewWorkflow`, `demoWorkflow`, `renderDemo`)
- Modify: `packages/cli/src/ci.ts` (demonstrate call)
- Modify: `templates/i18n/en.yml`, `ko.yml`, `ja.yml`, `zh.yml` (the `demo:` section)
- Test: `tests/demo.test.ts`, `tests/english-baseline.test.ts` (plus its new snapshot entry)

**Interfaces:**
- Consumes: `RecordingUnavailableError` and `demonstrate({ recording, locateFfmpeg })` (Task 7), `Media` from `@covi/video`, and `DEMO_PATHS` and `BehaviorDiff` (Task 1).
- Produces:
  - `recordingOf(session: Pick<Session, 'config' | 'resolved'>): { enabled: boolean; required: boolean }`
  - `locateFfmpeg(): Promise<string | undefined>`
  - `renderDemo(demo: Demonstration, language?: Language, behavior?: BehaviorDiff): string`
  - `WorkflowResult.artifacts.behaviorDiff` when written.

- [ ] **Step 1: Write the failing tests**

In `tests/demo.test.ts`, extend the imports:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ConfigLayer,
  type Demonstration,
  normalizeFinding,
  parseConfigInput,
  resolveConfig,
} from '@covi/core';
import { recordingOf } from '../packages/cli/src/workflows.ts';
import { BEHAVIOR_APP } from './helpers/behavior-app.ts';
import { createChangeRepo } from './helpers/repo.ts';
```

Then append:

```ts
describe('recording', () => {
  it('is required only when someone asked for it', () => {
    const of = (...layers: ConfigLayer[]) => {
      const resolved = resolveConfig(layers);
      return recordingOf({ config: resolved.config, resolved });
    };
    const record = (value: boolean) => parseConfigInput({ demo: { record: value } }, 't');
    expect(of()).toEqual({ enabled: true, required: false });
    expect(of({ name: 'workflow', values: record(true) })).toEqual({ enabled: true, required: false });
    expect(of({ name: 'repository', source: '.covi/config.yml', values: record(true) })).toEqual({
      enabled: true,
      required: true,
    });
    expect(of({ name: 'explicit', source: 'command line', values: record(false) })).toEqual({
      enabled: false,
      required: false,
    });
  });

  it('keeps reviewing without a browser, and exits 3 only when recording was asked for', () => {
    const repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
    dirs.push(repo.root);
    const empty = mkdtempSync(join(tmpdir(), 'covi-no-browser-'));
    dirs.push(empty);
    // An empty browsers directory: Playwright finds no Chromium.
    const env = { PLAYWRIGHT_BROWSERS_PATH: empty };
    const quiet = covi(['review', '--demo', '--repo', repo.root, '--json'], { env });
    expect(quiet.code).toBe(0);
    expect((quiet.json().warnings as string[]).join('\n')).toMatch(/Demonstration failed/);
    const asked = covi(['review', '--demo', '--record', '--repo', repo.root, '--json'], { env });
    expect(asked.code).toBe(3);
    expect(String(asked.json().error)).toMatch(/Flows cannot be recorded/);
  });

  it.skipIf(!browser)('writes the behavior section to demo.md and honors --no-record', () => {
    const repo = createChangeRepo(BEHAVIOR_APP.base, BEHAVIOR_APP.head);
    dirs.push(repo.root);
    const result = covi(['demo', '--no-record', '--repo', repo.root, '--json']);
    expect(result.code).toBe(0);
    const json = result.json() as unknown as {
      data: { demo: Demonstration };
      artifacts: Record<string, string>;
      runDir: string;
    };
    expect(json.data.demo.recording).toEqual({ status: 'off' });
    expect(json.data.demo.recordings).toBeUndefined();
    expect(existsSync(json.artifacts.behaviorDiff!)).toBe(true);
    const notes = readFileSync(json.artifacts.demo!, 'utf8');
    expect(notes).toContain('## Behavior at base and head');
    expect(notes).toContain(
      '- `GET /items.json?session=[REDACTED]`: HTTP 200 at base, HTTP 404 at head',
    );
    expect(notes).toContain('- New console error: `Could not load items: HTTP 404`');
    const manifest = JSON.parse(readFileSync(join(json.runDir, 'run.json'), 'utf8'));
    expect(manifest.config.provenance['demo.record']).toBe('explicit (command line)');
  });
});
```

`dirs`, `covi`, and `browser` already exist in this file. Reuse them.

In `tests/english-baseline.test.ts`, add `type BehaviorDiff` to the `@covi/core` import. After the `DEMO` constant, add:

```ts
const BEHAVIOR: BehaviorDiff = {
  schemaVersion: 1,
  scenarios: [
    {
      id: 'flow-load-items',
      kind: 'flow',
      name: 'Load items',
      viewport: 'desktop',
      status: 'changed',
      traces: { base: 'flow-load-items-base', head: 'flow-load-items-head' },
      recordings: {
        base: 'demo/recordings/flow-load-items-base.webm',
        head: 'demo/recordings/flow-load-items-head.webm',
      },
      steps: [
        { id: 's2', label: 'Open the menu', base: 'failed', head: 'ok', regions: [] },
        {
          id: 'end',
          label: 'Load items',
          base: 'ok',
          head: 'ok',
          changedRatio: 0.0123,
          diff: 'demo/diffs/flow-load-items-end.png',
          regions: [{ id: 'r1', x: 40, y: 120, width: 300, height: 48 }],
        },
      ],
      network: {
        added: [{ key: 'GET /api/limits', method: 'GET', url: '/api/limits', request: 'n4', status: 200 }],
        removed: [{ key: 'GET /legacy.js', method: 'GET', url: '/legacy.js', request: 'n3', status: 200 }],
        changed: [
          {
            key: 'GET /items.json',
            method: 'GET',
            url: '/items.json?session=[REDACTED]',
            base: { request: 'n2', status: 200 },
            head: { request: 'n2', status: 404 },
          },
        ],
      },
      console: {
        added: [{ message: 'c2', level: 'error', text: 'Could not load items: HTTP 404' }],
        removed: [{ message: 'c1', level: 'error', text: 'Deprecated API' }],
      },
      timing: {
        totalMs: { base: 1800, head: 2900 },
        steps: [{ step: 's1', baseMs: 300, headMs: 1200, deltaMs: 900 }],
      },
    },
    {
      id: 'home-desktop',
      kind: 'page',
      name: '/',
      viewport: 'desktop',
      status: 'unchanged',
      traces: { base: 'home-desktop-base', head: 'home-desktop-head' },
      steps: [],
      network: { added: [], removed: [], changed: [] },
      console: { added: [], removed: [] },
      timing: { totalMs: { base: 900, head: 950 }, steps: [] },
    },
    {
      id: 'flow-checkout',
      kind: 'flow',
      name: 'Checkout',
      viewport: 'mobile',
      status: 'incomplete',
      missing: 'base',
      traces: { head: 'flow-checkout-head' },
      failure: { head: 'locator.click: Timeout 8000ms exceeded' },
      steps: [],
      network: { added: [], removed: [], changed: [] },
      console: { added: [], removed: [] },
      timing: { totalMs: { head: 8000 }, steps: [] },
    },
  ],
  summary: { scenarios: 3, changed: 1, unchanged: 1, incomplete: 1 },
};
```

Next to the existing `renders the same demonstration notes` test, add:

```ts
  it('renders behavior differences and recordings in the demonstration notes', () => {
    const demo: Demonstration = {
      ...DEMO,
      recordings: [
        { id: 'flow-load-items-base', scenario: 'flow-load-items', flow: 'Load items', revision: 'base', viewport: 'desktop', path: 'demo/recordings/flow-load-items-base.webm', format: 'webm', width: 1280, height: 800, seconds: 1.8 },
        { id: 'flow-load-items-head', scenario: 'flow-load-items', flow: 'Load items', revision: 'head', viewport: 'desktop', path: 'demo/recordings/flow-load-items-head.webm', format: 'webm', width: 1280, height: 800, seconds: 2.9 },
      ],
      recording: { status: 'webm', cause: 'no-ffmpeg' },
    };
    expect(renderDemo(demo, 'en', BEHAVIOR)).toMatchSnapshot();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/demo.test.ts tests/english-baseline.test.ts -t "recording|behavior differences"`
Expected: FAIL. `recordingOf` is not exported, and `--record` is an unknown option (exit 2, not 3). The snapshot has not been written yet, and `renderDemo` ignores its third argument.

- [ ] **Step 3: Add the message catalogs**

Append inside `demo:` (after `notDemonstrated`) in each catalog. The placeholders are identical across all four languages.

`templates/i18n/en.yml`:

```yaml
  recordings: Recordings
  recording:
    item: '{name} at {revision}: [{file}]({path})'
    webm: Recordings are WebM because ffmpeg was not found. Install ffmpeg, or set COVI_FFMPEG, to get MP4.
    convertFailed: 'Recordings are WebM because converting them to MP4 failed: {detail}'
    unavailable: 'Flows were not recorded: {detail}'
  behavior:
    title: Behavior at base and head
    scenario: '{name} ({viewport})'
    same:
      one: '{count} scenario behaved the same at base and head.'
      other: '{count} scenarios behaved the same at base and head.'
    incomplete: 'Not compared: it ran only at {revision}.'
    failed: 'Failed at {revision}: {error}'
    where:
      step: 'Step {n}'
      open: The opening frame
      end: The final frame
      load: The page
    label: ' (“{label}”)'
    step: '{where}{label} looks different: {percent}% of pixels changed{diff}.'
    stepState: '{where}{label}: {base} at base, {head} at head.'
    state:
      ok: completed
      failed: failed
      missing: not reached
    requestChanged: '{request}: {base} at base, {head} at head'
    requestAdded: 'New request: {request} → {status}'
    requestRemoved: 'No longer requested: {request} ({status} at base)'
    noResponse: no response
    consoleAdded: 'New console error: {text}'
    consoleRemoved: 'Console error no longer logged: {text}'
    timing: '{where} took {head} ms at head and {base} ms at base.'
```

`templates/i18n/ko.yml`. It avoids particles after Latin words, so no particle markers are needed:

```yaml
  recordings: 녹화
  recording:
    item: '{name}({revision}): [{file}]({path})'
    webm: '녹화는 WebM 형식으로 남겼습니다(ffmpeg 없음). MP4로 받으려면 ffmpeg 설치 또는 COVI_FFMPEG 설정이 필요합니다.'
    convertFailed: 'MP4 변환에 실패해 녹화는 WebM 형식으로 남겼습니다: {detail}'
    unavailable: '흐름을 녹화하지 못했습니다: {detail}'
  behavior:
    title: 베이스와 헤드의 동작
    scenario: '{name}({viewport})'
    same:
      other: '{count}개 시나리오는 베이스와 헤드에서 똑같이 동작했습니다.'
    incomplete: '비교하지 못했습니다: {revision}에서만 실행했습니다.'
    failed: '{revision}에서 실패했습니다: {error}'
    where:
      step: '{n}단계'
      open: 첫 화면
      end: 마지막 화면
      load: 페이지
    label: ' (“{label}”)'
    step: '{where}{label}: 화면이 다릅니다. 픽셀의 {percent}%가 바뀌었습니다{diff}.'
    stepState: '{where}{label}: 베이스에서는 {base}, 헤드에서는 {head}.'
    state:
      ok: 완료
      failed: 실패
      missing: 도달하지 못함
    requestChanged: '{request}: 베이스에서 {base}, 헤드에서 {head}'
    requestAdded: '새 요청: {request} → {status}'
    requestRemoved: '더 이상 보내지 않는 요청: {request}(베이스에서 {status})'
    noResponse: 응답 없음
    consoleAdded: '새 콘솔 오류: {text}'
    consoleRemoved: '더 이상 나오지 않는 콘솔 오류: {text}'
    timing: '{where}: 헤드에서 {head}ms, 베이스에서 {base}ms 걸렸습니다.'
```

`templates/i18n/ja.yml`. It uses `base`/`head` literally, as the rest of the ja catalog does:

```yaml
  recordings: 録画
  recording:
    item: '{name}（{revision}）: [{file}]({path})'
    webm: 'ffmpeg が見つからないため、録画は WebM のままです。MP4 にするには ffmpeg をインストールするか COVI_FFMPEG を設定してください。'
    convertFailed: 'MP4 への変換に失敗したため、録画は WebM のままです: {detail}'
    unavailable: 'フローを録画できませんでした: {detail}'
  behavior:
    title: base と head の動作
    scenario: '{name}（{viewport}）'
    same:
      other: '{count} 件のシナリオは base と head で同じように動作しました。'
    incomplete: '比較していません: {revision} でのみ実行しました。'
    failed: '{revision} で失敗しました: {error}'
    where:
      step: 'ステップ {n}'
      open: 最初の画面
      end: 最後の画面
      load: ページ
    label: '（「{label}」）'
    step: '{where}{label}: 画面が異なります。ピクセルの {percent}% が変わりました{diff}。'
    stepState: '{where}{label}: base では{base}、head では{head}。'
    state:
      ok: 完了
      failed: 失敗
      missing: 未到達
    requestChanged: '{request}: base では {base}、head では {head}'
    requestAdded: '新しいリクエスト: {request} → {status}'
    requestRemoved: '送られなくなったリクエスト: {request}（base では {status}）'
    noResponse: 応答なし
    consoleAdded: '新しいコンソールエラー: {text}'
    consoleRemoved: '出なくなったコンソールエラー: {text}'
    timing: '{where}: head では {head} ms、base では {base} ms かかりました。'
```

`templates/i18n/zh.yml`:

```yaml
  recordings: 录像
  recording:
    item: '{name}（{revision}）：[{file}]({path})'
    webm: '未找到 ffmpeg，录像保留为 WebM。安装 ffmpeg 或设置 COVI_FFMPEG 即可得到 MP4。'
    convertFailed: '转换为 MP4 失败，录像保留为 WebM：{detail}'
    unavailable: '未能录制流程：{detail}'
  behavior:
    title: base 与 head 的行为
    scenario: '{name}（{viewport}）'
    same:
      other: '{count} 个场景在 base 和 head 上表现相同。'
    incomplete: '未比较：只在 {revision} 上运行过。'
    failed: '在 {revision} 上失败：{error}'
    where:
      step: '第 {n} 步'
      open: 开头画面
      end: 最终画面
      load: 页面
    label: '（“{label}”）'
    step: '{where}{label}：画面不同，{percent}% 的像素有变化{diff}。'
    stepState: '{where}{label}：base 上{base}，head 上{head}。'
    state:
      ok: 已完成
      failed: 失败
      missing: 未到达
    requestChanged: '{request}：base 上为 {base}，head 上为 {head}'
    requestAdded: '新请求：{request} → {status}'
    requestRemoved: '不再发送的请求：{request}（base 上为 {status}）'
    noResponse: 无响应
    consoleAdded: '新的控制台错误：{text}'
    consoleRemoved: '不再出现的控制台错误：{text}'
    timing: '{where}：head 上用了 {head} 毫秒，base 上用了 {base} 毫秒。'
```

- [ ] **Step 4: Implement the CLI**

`packages/cli/src/main.ts`:
- Add this helper next to `addLanguage`:

```ts
/** --record and --no-record, for commands that may run browser flows. */
function addRecord(cmd: Command): Command {
  return cmd
    .option(
      '--record',
      'record browser flows at base and head (the default); exit 3 if they cannot be recorded',
    )
    .option('--no-record', 'do not record browser flows (screenshots and traces are still taken)');
}
```

- In `explicitConfig`, after the `annotations` line, add `if (explicitSource(cmd, 'record')) set('demo', 'record', o.record);`.
- Wrap these chains:
  - `review`: `addRecord(addIntelligence(addSelection(program.command('review')…)))`
  - `demo`: `addRecord(addLanguage(addSelection(program.command('demo')…)))`
  - `video`: `addRecord(addVideo(addIntelligence(addSelection(program.command('video')…))))`
  - `ci`: `addRecord(addVideo(addIntelligence(program.command('ci')…)))`

`packages/cli/src/workflows.ts`:
- Change the imports:
  - `import { demonstrate, RecordingUnavailableError } from '@covi/capture';`
  - Add `type BehaviorDiff`, `code`, `DEMO_PATHS`, `escapeMarkdown`, and `truncate` to the `@covi/core` import.
  - Add `Media` to the `@covi/video` import.
- Add after `WORKFLOW_DEFAULTS`:

```ts
/**
 * Whether flows are recorded, and whether failing to record is an error: only when someone asked
 * for it (a flag, COVI_DEMO_RECORD, or the repository's configuration), never by default.
 */
export function recordingOf(session: Pick<Session, 'config' | 'resolved'>): {
  enabled: boolean;
  required: boolean;
} {
  const enabled = session.config.demo.record;
  const source = session.resolved.provenance['demo.record'] ?? '';
  return { enabled, required: enabled && /^(repository|explicit)/.test(source) };
}

/** ffmpeg as video rendering finds it (COVI_FFMPEG, else PATH); recordings stay WebM without it. */
export function locateFfmpeg(): Promise<string | undefined> {
  return Media.locate().then(
    (media) => media.ffmpegPath,
    () => undefined,
  );
}
```

- In `demoStage`:
  - Replace `'demo/plan.json'` with `DEMO_PATHS.plan`.
  - Add `recording: recordingOf(session), locateFfmpeg,` to the `demonstrate({…})` arguments.
  - Replace the `writeText('demo/demo.md', renderDemo(…), 'capture')` call with:

```ts
    const behavior = demo.behavior
      ? await session.run.readJson<BehaviorDiff>(demo.behavior.path)
      : undefined;
    await session.run.writeText(
      DEMO_PATHS.notes,
      renderDemo(demo, session.language.language, behavior),
      'capture',
    );
```

  - Make the first line of the `catch` block:

```ts
    // An explicit request to record that cannot be honored is the user's to see (exit 3).
    if (error instanceof RecordingUnavailableError) throw error;
```

- In `reviewWorkflow` and `demoWorkflow`:
  - Replace `'demo/captures.json'` and `'demo/demo.md'` with `DEMO_PATHS.captures` and `DEMO_PATHS.notes`.
  - After those `artifact` calls, add `if (demo.behavior) artifact(session, result, 'behaviorDiff', DEMO_PATHS.behaviorDiff);`.
  - In `renderWorkflow`, replace the two later `'demo/captures.json'` literals (the `run.has` and `run.readJson` around lines 726 and 803) with `DEMO_PATHS.captures`.
- Replace `renderDemo`'s signature and tail. Keep the existing shots, requests, and commands loops unchanged:

```ts
export function renderDemo(
  demo: Demonstration,
  language: Language = 'en',
  behavior?: BehaviorDiff,
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `demo.${key}`, params);
  // … existing body up to and including the commands loop …
  out.push(...renderRecordings(demo, say));
  if (behavior) out.push(...renderBehavior(behavior, say));
  if (demo.skipped.length) {
    out.push(`## ${say('notDemonstrated')}`, '');
    for (const s of demo.skipped) out.push(`- ${s.what}: ${s.reason}`);
    out.push('');
  }
  return out.join('\n');
}

type Say = (key: string, params?: Record<string, string | number>) => string;

/** One line of text that came from the page (a URL, a console message, an error), as inline code. */
function inline(text: string): string {
  return code(truncate(text.replace(/\s+/g, ' ').trim(), 160));
}

function renderRecordings(demo: Demonstration, say: Say): string[] {
  const recordings = demo.recordings ?? [];
  const status = demo.recording;
  const note =
    status?.status === 'webm'
      ? status.cause === 'no-ffmpeg'
        ? say('recording.webm')
        : say('recording.convertFailed', { detail: inline(status.detail ?? status.cause ?? '') })
      : status?.status === 'unavailable'
        ? say('recording.unavailable', { detail: inline(status.detail ?? status.cause ?? '') })
        : undefined;
  if (!recordings.length && !note) return [];
  const out = [`## ${say('recordings')}`, ''];
  for (const r of recordings)
    out.push(
      `- ${say('recording.item', {
        name: escapeMarkdown(r.flow),
        revision: r.revision,
        file: escapeMarkdown(r.path.split('/').at(-1)!),
        path: `../${r.path}`,
      })}`,
    );
  if (recordings.length) out.push('');
  if (note) out.push(note, '');
  return out;
}

function whereOf(step: string, say: Say): string {
  const n = /^s(\d+)$/.exec(step)?.[1];
  if (n) return say('behavior.where.step', { n: Number(n) });
  return say(`behavior.where.${step === 'open' || step === 'load' ? step : 'end'}`);
}

function statusOf(ref: { status?: number; failure?: string }, say: Say): string {
  if (ref.status !== undefined) return `HTTP ${ref.status}`;
  return ref.failure ? inline(ref.failure) : say('behavior.noResponse');
}

/** One block per scenario that changed or could not be compared, then a count of the rest. */
function renderBehavior(behavior: BehaviorDiff, say: Say): string[] {
  if (!behavior.scenarios.length) return [];
  const out = [`## ${say('behavior.title')}`, ''];
  for (const s of behavior.scenarios.filter((x) => x.status !== 'unchanged')) {
    out.push(`### ${say('behavior.scenario', { name: escapeMarkdown(s.name), viewport: s.viewport })}`, '');
    const lines: string[] = [];
    if (s.missing)
      lines.push(say('behavior.incomplete', { revision: s.missing === 'base' ? 'head' : 'base' }));
    for (const revision of ['base', 'head'] as const) {
      const error = s.failure?.[revision];
      if (error) lines.push(say('behavior.failed', { revision, error: inline(error) }));
    }
    for (const step of s.steps) {
      const where = whereOf(step.id, say);
      const label = step.label ? say('behavior.label', { label: escapeMarkdown(step.label) }) : '';
      if (step.base !== step.head)
        lines.push(
          say('behavior.stepState', {
            where,
            label,
            base: say(`behavior.state.${step.base}`),
            head: say(`behavior.state.${step.head}`),
          }),
        );
      if (step.changedRatio !== undefined)
        lines.push(
          say('behavior.step', {
            where,
            label,
            percent: (step.changedRatio * 100).toFixed(2),
            diff: step.diff ? say('diffLink', { path: `../${step.diff}` }) : '',
          }),
        );
    }
    for (const r of s.network.changed)
      lines.push(
        say('behavior.requestChanged', {
          request: inline(`${r.method} ${r.url}`),
          base: statusOf(r.base, say),
          head: statusOf(r.head, say),
        }),
      );
    for (const r of s.network.added)
      lines.push(say('behavior.requestAdded', { request: inline(`${r.method} ${r.url}`), status: statusOf(r, say) }));
    for (const r of s.network.removed)
      lines.push(say('behavior.requestRemoved', { request: inline(`${r.method} ${r.url}`), status: statusOf(r, say) }));
    for (const m of s.console.added) lines.push(say('behavior.consoleAdded', { text: inline(m.text) }));
    for (const m of s.console.removed) lines.push(say('behavior.consoleRemoved', { text: inline(m.text) }));
    for (const d of s.timing.steps)
      lines.push(say('behavior.timing', { where: whereOf(d.step, say), base: d.baseMs, head: d.headMs }));
    out.push(...lines.map((line) => `- ${line}`), '');
  }
  const same = behavior.scenarios.filter((x) => x.status === 'unchanged').length;
  if (same) out.push(say('behavior.same', { count: same }), '');
  return out;
}
```

`packages/cli/src/ci.ts`:
- Import `RecordingUnavailableError` from `@covi/capture` and `locateFfmpeg, recordingOf` from `./workflows.ts`.
- In the `demonstrate({…})` call, add `recording: recordingOf(session), locateFfmpeg,`.
- Change the `.catch` to:

```ts
        .catch((error: Error) => {
          // Recording asked for explicitly and impossible: fail the job (exit 3) rather than warn.
          if (error instanceof RecordingUnavailableError) throw error;
          run.warn(`Demonstration failed: ${error.message.split('\n')[0]}`);
          return undefined;
        })
```

- [ ] **Step 5: Run the tests to verify they pass; write the new snapshot locally**

Run: `npx vitest run tests/demo.test.ts tests/english-baseline.test.ts packages/core/test/catalog.test.ts tests/cli.test.ts`
Expected: PASS. Vitest writes the new snapshot `renders behavior differences and recordings in the demonstration notes` into `tests/__snapshots__/english-baseline.test.ts.snap`. In CI, new snapshots are not written, so this file must be committed. Open the snapshot and check:
- the Recordings section lists both WebM links and the ffmpeg note;
- "Behavior at base and head" has `### Load items (desktop)`, `### Checkout (mobile)` with "Not compared: it ran only at head." and the failure, and the line "1 scenario behaved the same at base and head.";
- the existing `renders the same demonstration notes` snapshot is unchanged (the diff touches only the new entry).

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx biome check --write packages/cli tests/demo.test.ts tests/english-baseline.test.ts && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/main.ts packages/cli/src/workflows.ts packages/cli/src/ci.ts templates/i18n/en.yml templates/i18n/ko.yml templates/i18n/ja.yml templates/i18n/zh.yml tests/demo.test.ts tests/english-baseline.test.ts tests/__snapshots__/english-baseline.test.ts.snap
git commit -m "Add --record/--no-record and the behavior section in demo.md" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

### Task 9: Skill, docs, AGENTS.md, and CHANGELOG

**Files:**
- Modify: `skills/covi-demo/SKILL.md`, `skills/covi/SKILL.md`
- Modify: `docs/artifacts.md`, `docs/configuration.md`, `docs/cli.md`, `docs/architecture.md`, `docs/security.md`, `docs/video.md`
- Modify: `AGENTS.md` (Run outputs tree)
- Modify: `CHANGELOG.md`

**Interfaces:** none. This task is prose that describes Tasks 1–8. The check is `npm run check`, which covers `agents:check`, lint, typecheck, and the full test suite.

- [ ] **Step 1: Write the "test": state what must be true after this task**

These conditions must hold:
- (a) A reader of `skills/covi-demo/SKILL.md` knows that flows run at base and head, are recorded and traced, and how to read `demo/behavior-diff.json`, `--no-record`, and `--record`.
- (b) Every new file appears in `docs/artifacts.md` with its `kind`.
- (c) `demo.record` and `COVI_DEMO_RECORD` are documented.
- (d) The flags are in `docs/cli.md`.
- (e) The CHANGELOG has one line.

Verify with this grep:

Run: `grep -c "behavior-diff.json" skills/covi-demo/SKILL.md docs/artifacts.md docs/cli.md AGENTS.md skills/covi/SKILL.md; grep -n "COVI_DEMO_RECORD" docs/configuration.md; grep -n "no-record" docs/cli.md skills/covi-demo/SKILL.md`
Expected before the edits: 0 counts and no matches. That is the failing state.

- [ ] **Step 2: Update `skills/covi-demo/SKILL.md`**

- In the "Decide what to show" table, replace the row `| adds or changes an interaction | the key interaction on head, step by step (a flow) |` with `| adds or changes an interaction | the key interaction, step by step (a flow); Covi runs it at base and head |`.
- In **Run it**, replace step 3 with:

```markdown
3. `covi demo --plan plan.json --json` (or `covi review --demo --plan plan.json`). Covi checks out base and head into temporary directories, runs each, and writes `demo/captures.json`, screenshots, and pixel diffs. Every flow runs at both revisions; each run is recorded (`demo/recordings/`, MP4 when ffmpeg is installed, else WebM) and traced (`demo/traces/`: steps with timing, network requests, console messages, DOM changes), and `demo/behavior-diff.json` compares base and head. Covi keeps your plan as `demo/plan.json`. Pass `--no-record` when a recording is not wanted (traces and screenshots are still taken); `--record` makes a recording that cannot be made an error (exit 3).
```

- In **Run it**, append to step 4: `Then read demo/behavior-diff.json: for each flow and page, the steps that look different (with the changed regions), requests that appeared, disappeared, or got another status, console errors that appeared or went away, and steps that got much slower. Check that it shows the difference the change intends, and nothing you cannot explain.` Put `demo/behavior-diff.json` in backticks.
- In **Method**, replace `- Reproduce bugs on base first: the before state is evidence the fix matters.` with:

```markdown
- Reproduce bugs on base first: flows run at both revisions, so the before state is evidence the fix matters.
- A flow that cannot finish at base because the change adds what it uses is expected and is not a finding; the behavior diff shows where base stopped. A flow that breaks at head is a finding.
- Point at what a run showed by its id: a scenario (`flow-post-a-comment`, `home-desktop`), a step (`s3`, `end`), a request (`n4`) or console message (`c2`) in a trace, or a changed region (`r1`), as `demo/behavior-diff.json` and `demo/traces/` name them.
```

- Replace **Output files** with: ``demo/plan.json` (when you passed one), `demo/captures.json`, `demo/screenshots/*.png`, `demo/diffs/*.png`, `demo/recordings/*.mp4` (or `.webm`), `demo/traces/*.json`, `demo/behavior-diff.json`, `demo/demo.md`. Videos and reviews reuse them.`

- [ ] **Step 3: Update `skills/covi/SKILL.md` and `AGENTS.md`**

- `skills/covi/SKILL.md`, in the Artifacts code block: `demo/                 captures.json, screenshots, diffs, recordings, traces, behavior-diff.json`.
- `AGENTS.md`, in the Run outputs block, replace the `demo/` line with:

```
  demo/                plan.json (when given), captures.json, screenshots/, diffs/, demo.md,
                       recordings/, traces/, behavior-diff.json
```

- [ ] **Step 4: Update `docs/artifacts.md`**

In the **Demonstration** table:
- Change the `demo/screenshots/flow-<flow>-<NN>.png` row's content to `Flow frames at head: one just before each labeled step's action, one at each screenshot step, and one at the end`.
- Add these rows after it:

```markdown
| `demo/screenshots/flow-<flow>-<NN>-base.png` | `screenshot` | The same flow frames at base; each is the `before` of the head frame for the same step |
| `demo/diffs/flow-<flow>-<step>.png` | `screenshot` | The pixel difference of a flow step that looks different at base and head |
| `demo/recordings/flow-<flow>-base.mp4`, `-head.mp4` | `recording` | Each flow at base and head, at the flow's viewport in CSS pixels (1280×800 on desktop). WebM (`.webm`) when ffmpeg is missing or converting fails; `captures.json` → `recording` says why. Not written with `--no-record` or `demo.record: false`. |
| `demo/traces/<scenario>-base.json`, `-head.json` | `trace` | What happened while a page loaded or a flow ran: steps (id, action, target, label, seconds from the start of the recording, duration, status, screenshot, target box, DOM changes), network requests (method, URL relative to the app, resource type, status or failure, timing), console messages (level, text, location), and DOM change counts and regions. No headers or bodies. |
| `demo/behavior-diff.json` | `behavior-diff` | Per scenario (page or flow) observed at both revisions: `status` (`changed`, `unchanged`, `incomplete`), steps that look different (with region ids) or ended differently, requests added, removed, or answered with another status, console errors added or removed, and timing deltas of at least 500 ms and half the base time (timing alone never makes a scenario `changed`). Not written when only head ran (`app.url`). |
```

After the table, add a paragraph:

```markdown
**Ids.** A scenario is `flow-<flow>` or `<page>-<viewport>`, and its trace at a revision is `<scenario>-<revision>` (also the recording's file stem). Steps are `open`, `load` (a page), `s1`… (the flow's steps in order), and `end`, the same at base and head. Inside a trace, requests are `n1`… and console messages `c1`…; in `behavior-diff.json`, changed regions are `r1`… within their step. `<trace>#<id>` (`flow-load-items-head#n2`) and `<scenario>#<step>.<region>` (`flow-load-items#end.r1`) each name one piece of evidence in a run.
```

Also:
- In **Schema versions**, add `demo/traces/*.json` and `demo/behavior-diff.json` to the list of files that carry `schemaVersion: 1`.
- In **Redaction**, after "It also covers HTTP response bodies and command output captured during demonstrations,", insert "the URLs and console messages in traces, where credential-shaped query and fragment parameters (`token`, `key`, `session`, `signature`, `code`, and similar) are masked too,".
- Replace "Screenshots are pictures of the running software, and the video shows them as captured" with "Screenshots and recordings are pictures of the running software, and the video shows them as captured".

- [ ] **Step 5: Update `docs/configuration.md`, `docs/cli.md`, `docs/architecture.md`, `docs/security.md`, and `docs/video.md`**

`docs/configuration.md`:
- In the `demo` table, change the `flows` row's meaning to: `Scripted interactions run at base and head, each recorded and traced. Each interactive step is captured before it happens, and the flow ends with the resulting state. A flow that fails at base is expected when the change adds what it uses; one that fails at head is a finding.`
- Add a row:

```markdown
| `record` | `true`, `false` | `true` | Record every flow at base and head into `demo/recordings/` (MP4 when ffmpeg is installed, else WebM). When it is set explicitly — here, with `--record`, or with `COVI_DEMO_RECORD` — a recording that cannot be made (no Chromium, or Playwright's recorder is missing) fails the run with exit code 3; otherwise Covi records what it can and says why in `captures.json`. |
```

- In the `COVI_*` table, add `| \`COVI_DEMO_RECORD\` | \`demo.record\` (same values as \`COVI_NARRATION\`) |`.
- Extend the "Differences Covi observes become findings…" paragraph with: `Every demonstration that runs at both revisions also writes demo/behavior-diff.json, the step-by-step comparison of each page and flow.` Put the path in backticks.

`docs/cli.md`:
- Add these rows to the option tables of `covi review`, `covi demo`, `covi video`, and `covi ci`. On review, the meaning starts with "With `--demo`: ".

```markdown
| `--record` | Record browser flows at base and head (the default), and exit 3 if they cannot be recorded. |
| `--no-record` | Do not record browser flows; screenshots, traces, and the behavior diff are still written. |
```

- Change the `covi demo` **Writes** list to add `demo/recordings/` (each flow at base and head, MP4 or WebM), `demo/traces/` (one trace per page and flow per revision), and `demo/behavior-diff.json`. Add the same three to the review `--demo` "Writes" bullet.
- Change `covi demo` **Exit code** to: `3 when the demonstration cannot run at all, for example because Chromium is missing, or when recording was asked for (--record, COVI_DEMO_RECORD, or demo.record in the repository's configuration) and flows cannot be recorded. When there is nothing to demonstrate, the result says why.` Put the flags and keys in backticks.

`docs/architecture.md`, Demonstration step 4: replace `scripted flows step by step at head;` with `scripted flows step by step at base and head, each recorded (WebM converted to MP4 when ffmpeg is present) and traced (requests, console messages, DOM changes, step timing);`. After step 4, add a step `5.` and renumber the old 5 to 6:

```markdown
5. Compares base and head (`diffBehavior`, `packages/capture/src/behavior.ts`, pure and deterministic): per page and flow, steps whose screenshots differ (with regions), requests added, removed, or with another status, console errors added or removed, and timing deltas, written to `demo/behavior-diff.json`.
```

`docs/security.md`:
- In **Run outputs**, after "Command output appears only in `demo/captures.json` and the tests section of `review.json`, both redacted.", add: `Traces (demo/traces/) keep request URLs, console messages, and timing, never headers or bodies; credential-shaped URL parameters are masked before the usual redaction.` Put the path in backticks.
- Change "Redaction can't reach inside screenshots, though" to "Redaction can't reach inside screenshots or recordings, though".

`docs/video.md`: in the **Capture** row of the pipeline table, change the outputs cell to `demo/captures.json`, `demo/screenshots/`, `demo/diffs/`, `demo/recordings/`, `demo/traces/`, `demo/behavior-diff.json`, `demo/demo.md`.

- [ ] **Step 6: Update `CHANGELOG.md`**

If `CHANGELOG.md` is missing (PR 1 not merged yet), rebase onto `main` first. If it is still missing, create it with the Keep a Changelog header below. The controller resolves any conflict with PR 1 at rebase time.

```markdown
# Changelog

All notable changes to Covi are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
```

Under `## [Unreleased]` → `### Added` (create the `### Added` subsection if absent), add one line:

```markdown
- Behavior diff capture: browser flows run at base and head with a recording (MP4, or WebM without ffmpeg) and a redacted trace each, and `demo/behavior-diff.json` and `demo/demo.md` show what changed (`demo.record`, `--record`, `--no-record`).
```

- [ ] **Step 7: Verify**

Run: `grep -c "behavior-diff.json" skills/covi-demo/SKILL.md docs/artifacts.md docs/cli.md AGENTS.md skills/covi/SKILL.md && grep -n "COVI_DEMO_RECORD" docs/configuration.md && grep -n "no-record" docs/cli.md skills/covi-demo/SKILL.md`
Expected: every count ≥ 1, and both greps match.

Run: `npm run check`
Expected: lint, typecheck, `agents:check`, and the full test suite all pass. Browser tests run when Playwright Chromium is installed (it is locally).

- [ ] **Step 8: Commit**

```bash
git add skills/covi-demo/SKILL.md skills/covi/SKILL.md docs/artifacts.md docs/configuration.md docs/cli.md docs/architecture.md docs/security.md docs/video.md AGENTS.md CHANGELOG.md
git commit -m "Document behavior diff capture, recordings, traces, and demo.record" -m "Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh"
```

---

## Self-review (done while writing)

- **Spec coverage.** Each spec item maps to a task:
  - 1 (recording, webm→mp4, path): Tasks 6 and 7.
  - 2 (traces with network, console, mutations, step timeline; no trace.zip): Tasks 4, 6, and 7.
  - 3 (behavior diff: steps with region ids, network, console errors, timing; summary in `demo.md`): Tasks 3, 5, 7, and 8.
  - 4 (Redactor and run.json sha256): Tasks 2, 4, and 7. `writeJson`/`record` cover this, and Task 7 tests it.
  - 5 (`demo.record`, `--no-record`, CI parity via config and `COVI_DEMO_RECORD`): Tasks 1 and 8.
  - 6 (`assessDemonstration` unchanged): untouched.
  - Acceptance: tiny static app with one changed request and one console error (Tasks 7 and 8); skipped cleanly without ffmpeg or browser, exit 3 only when explicit (Tasks 6 and 8); redaction test (Task 7); Playwright tests (Tasks 6–8).
  - Docs, skill, and CHANGELOG: Task 9.
- **Type consistency.** These names are spelled the same in every task: `StepPixels`, `ScenarioObservation`, `RecordingNote`, `ObservedFlow`, `FlowRun.video/recordError`, `FlowFrame.step`, `DemoRecordingStatus.cause`, `DEMO_PATHS.notes/captures/plan/behaviorDiff`, `demoPath.*`, `recordingOf`, and `locateFfmpeg`.
- **Determinism.** `behavior.ts` and `regions.ts` use no clock or randomness. Inputs are sorted by key and position. `TraceCollector` takes an injected clock.
