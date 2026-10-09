# PR B6 — Draft and critique loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can check a video's motion before the real render: `covi render --run <id> --draft` renders the same video at half size and 15 fps, with the voice alone, into `video/draft/` (preview, poster, contact sheet, QC, timeline) in seconds, never touching the video's own files; every `qc.json` (draft and final) gains seven motion checks (`motion-gap`, `motion-busy`, `reading-time`, `empty-opening`, `overlap`, `out-of-frame`, `dropped-beats`); the poster (draft and final) shows the change at its best instead of the frame at 1.6 s; a directed shot whose beats wait on its line no longer holds still before its first beat; and the `covi-video` skill tells the agent to draft, look, and revise `video/direction.json` at most three times before rendering.

**Architecture:** The scene camera's plan moves from `runtime/camera.ts` into a new DOM-free `timeline/motion.ts`, shared by the runtime and Node QC, which also lists every stretch of planned motion (`motionSpans`: entrances, shot elements and beats from the refactored `shotMotion`, the scene camera). A new Node module `choreography.ts` holds the seven checks: four read the timeline alone; `overlap`/`out-of-frame` read a new `LayoutReport.shot` the stage reports at settled frames (each element's box where its stop lays it out, the camera undone with the pure `unview`); and `empty-opening` reads a new `LayoutReport.content` (the box around what the scene visibly draws, `drawnBox`) at frames the renderer now samples through each scene's opening (`openingSpan`). The poster frame is chosen from the timeline by R-029 (`posterTime` in DOM-free `timeline/motion.ts`: where the key number's count lands, else the hero once its accent has played and it has settled, else 1.6 s). `still` shares its threshold and narration rule with `motion-gap` (`spokenStills`) and names stretches where only the camera's push-in moved. The draft is a branch of `produceVideo` after the timeline is built at the draft's spec (`draftSpec`): `renderDraft` writes only under `video/draft/` with a voice-only master (`masterVoice`), and the CLI reports it as a preview (`video.rendered: false`, `video.draft`).

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, no build step), Zod 4, Vitest 5, Playwright Chromium, ffmpeg (`freezedetect`, `ffprobe`), Biome; the browser runtime is bundled by esbuild.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` — §10 (draft and critique loop: the draft render and the motion checks), §4.7 (beat timing: spaced beats from 0.15 of the line, which this plan keeps), §5 (the canvas: stop camera, push, clip), §8 (QC warns, R-007), §14–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-006: the draft is `covi render --run <id> --draft` into `video/draft/`, `covi video --draft` keeps its meaning; R-007: motion checks warn, only `out-of-frame` fails; R-016: `video.direction: off` renders as 0.2.0; R-017: CHANGELOG subsection; R-023: the resolver records the beats it drops and B6's motion QC surfaces them; R-029, which superseded R-026: the poster's frame). Code worktree: `~/projects/covi-direction`, branch `draft-critique`, started from the latest `main` after B1–B5 merged.

## Global Constraints

Every task's requirements include these. Values are copied from the spec, the rulings, and `AGENTS.md`.

- TypeScript on Node 22.18+, run without a build step: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Dependency direction unchanged: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Nothing imports `cli`. `core`, `brand`, and `audio` import no other Covi package. Browser runtime files (`packages/video/src/runtime/**`) import only DOM-free shared files (`timeline/types.ts`, `timeline/cues.ts`, this PR's `timeline/motion.ts`, `runtime/*`, `@covi/brand`) and never `@covi/core`. Node code and files under `tests/` never import a runtime file that carries DOM types: `runtime/anim.ts`, `runtime/camera.ts`, `runtime/canvas.ts`, and the components are off limits to them (that is why the camera's plan moves to `timeline/motion.ts`).
- Runtime: every visual property is a pure function of the frame time. No `Date`, no `Math.random`, no CSS transitions or animations, no `Intl`. Text is set with `textContent`.
- Spec §10, verbatim: "`covi render --run <id> --draft` (R-006): renders at half size and 15 fps into `video/draft/` (`preview.mp4`, `contact-sheet.jpg`, `qc.json`, `timeline.json`), reusing cached narration; it never touches the final render's files or `frames.json`." Motion QC "in both draft and final `qc.json`": `motion-gap` (warn) "longest stretch of narration with nothing moving > 1.5 s (motion intervals computed from the timeline: transitions, camera moves, beats, component choreography via `settledAt`, stop camera push)"; `motion-busy` (warn) "more than 3 beats starting within any 1 s, or more than 2 camera moves within 2 s"; `reading-time` (warn) "text elements visible less than `0.4 s + characters / 15 s` (CJK: `/ 8`)"; `overlap` (warn) "direction element rects overlapping by > 4% of the smaller at settled frames (containment by design excluded)"; `out-of-frame` (fail) "an element rect outside the viewport clip at a settled frame". The skill: "after drafting, render `--draft`, open `video/draft/contact-sheet.jpg`, read `video/draft/qc.json`, revise `direction.json`; at most 3 rounds, then a final render."
- R-006: `covi video --draft` keeps its meaning (write the drafts and stop). The draft render is the `--draft` flag of `covi render` only.
- The program lead's addition (after B1's benchmark render): "Plan a deterministic poster choice that shows the change at its best (e.g. the hero scene settled after its accent, or the frame where the key metric's count lands — the largest number on screen — falling back to the current rule), apply it to both the draft and final render… Also make sure motion QC sees an opening phase that holds a mostly empty frame (B1's empty-frame reads only settled frames)." Its final ruling, R-029 (superseding R-026's order): "poster = where the key number's count lands (+0.3 s so the % shows; skip one that lands while the next scene is entering), else the hero after its accent has settled (phase + 0.7 s, inside the scene before its exit), else the old rule."
- R-007: the new checks warn; only `out-of-frame` fails. R-016: with `video.direction: off`, frames are drawn exactly as 0.2.0 drew them (this PR's camera change applies only to scenes with a direction).
- Spec §4.7: beats without `at` still start at 0.15 of the line and spread evenly (`SPACED_FROM` unchanged).
- Interactive and non-interactive parity: CI and `covi video` without an agent never draft; nothing new is asked, and no configuration key is added.
- Frames never depend on the sound; nothing in `video/timeline.json` depends on the music. The draft never composes, renders, or mixes music, and never calls a model provider.
- Everything an agent wrote reaches QC messages only as `qc.json` (written through `run.writeJson`, which redacts) or the logger; QC messages and CLI logs are English. No new catalog keys (`templates/i18n/*` unchanged).
- Never change any `version` field (`timeline.json` stays `version: 1`, `frames.json` and `qc.json` stay as they are; additive fields only). CHANGELOG: one line under `## [Unreleased]`, in its `### Added` subsection (R-017).
- Commits: default git identity (never Claude as author or co-author); concise English message ending with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Before each commit: `npx biome check --write <changed files>`, `npm run lint`, `npm run typecheck`. Each task leaves `npm run check` green.
- Long commands (full `npm test`, `npm run check`, `npm run test:render`, `covi video`, `covi render`) run in the background; wait for them to finish before reporting.

## B1–B5 names this plan builds on

B1–B5 merge before this PR starts. Plans: `~/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b1-density-checks.md`, `…-b2-direction-canvas.md`, `…-b3-code-morph.md`, `…-b4-metrics.md`, `…-b5-flow-verbs.md`. **Before Task 1, run a pre-flight scan of this plan against the merged `main`** (as R-020 and R-021 did for B2 and B4): where a merged name, signature, or file differs from the list below, use the merged one, keep the behavior this plan describes, and record the difference in the task report.

- **B1** (merged code read for this plan): `packages/video/src/density.ts` with the private `settledReports(timeline, layouts)` and `CARDS`, the exported `EMPTY_SHARE` (0.4), `DensityTimeline`, `textSizeCheck`, `emptyFrameCheck`, `monotonyCheck`, `transitionVarietyCheck`, `densityChecks`; `runQc` pushes `...densityChecks(input.timeline, input.layouts)` right after `...layoutChecks(…)`; `settledSpan`/`settledFrame` in `timeline/cues.ts`; `layoutSampleFrames` in `render/renderer.ts` (renders sample one settled frame per story scene), where `renderComposition` still takes the poster at `Math.min(1.6, duration / 3)`; the benchmark `examples/backend-slim-request/` and its `covi video (full pipeline)` entry in `tests/render/render.test.ts`, whose loop parses `qc.json` and asserts `expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety'])`.
- **B2:** `runtime/camera.ts` (`CameraPlan`, `cameraPlan`, `cameraPush`, `heroPunch`, `heroAccent`, the private `CAPTURES`, `ENTERED = 0.5`, `PUNCH_IN`, `PUNCH_OUT = 0.6`); `runtime/canvas.ts` (`View`, `CameraStep`, `restView`, `toWorld`, `withPush`, `clampView`, `viewAt`, `layerTransform`, `clipRect`, …); `runtime/stage.ts` (`MountedScene` with `viewport`, `region`, `visual`, `steps`, `shot`; the private `travels`, `moveAt`, `stopView`, `cameraAt`, `clipAt`, `cameraSteps`, `targetAt`; `report()`); `runtime/direction/elements.ts` (`ShotComponent` with `frame(id)` and `track(id, t)`; inside `mountShot` the `drawn` list, `now`, `own`); `timeline/cues.ts` (`shotSettledAt`); `timeline/types.ts` (`SceneDirection`, `DirectionElement`, `DirectionBeat`, `LayoutReport`, `Rect`, `Point`, `CAMERA_TRANSITIONS`); `runtime/tsconfig.json` (its `include` list); `pipeline.ts` (`ProduceVideoInput.direction`, `planDirection`, `resolveDirection`, the staging passed to `buildTimeline`); `tests/render/canvas.test.ts` (the `directed(scenes, shots, options)` helper returning `{ timeline, page, scene, frameAt, seek, state, of, report, grid, shot, errors }`, the `camera(transform)` parser, `regions`, `story`, `run`, `elements`); `packages/video/test/motion.test.ts` ("the camera in a directed scene": "pushes in once the shot’s beats are done, not before"); `packages/video/test/canvas.test.ts`.
- **B3:** `MORPH_SETTLE` and the morph branch of `shotSettledAt`; the follow camera; `tests/render/morph.test.ts` ("follows the changed lines with the camera as they move, keeping them in the region", which asserts `expect(c.scale).toBeCloseTo(1.25, 2)`).
- **B4:** `COMPARE_LANDS` (imported by `timeline/cues.ts` from `runtime/numbers.ts`) and the metric branch of `shotSettledAt`; the `metric` element's `name`; the benchmark's `if (example === 'backend-slim-request') { … }` block in the full-pipeline loop.
- **B5:** the `packet` and `pile` elements (`label?`, `name`), the packet/pile branch of `shotSettledAt`; `direction/resolve.ts`'s private `flowOrder(beats, elements)` (drops a merge timed before its split and a count-up that has not landed when its counter's count starts) and its call in `resolveShot`; `packages/video/test/direction-flow.test.ts` ("drop a merge timed before its split, and a count-up timed after its count"). **R-023** (ruled when B5's plan was approved): B5 records each beat it drops (a run warning and a note in the render result naming shot and beat). This plan reads them from the timeline as `SceneDirection.dropped`; Task 2 says what to do for each way B5 may have merged it.

Measured on a scratch copy of the repository with B1–B5 applied (a mirror built by earlier planners, B1's density module and settled-frame sampling ported in), before this PR: the benchmark's default render warns `still` in `s1` (en 1.7 s from 0.0 s, ko 2.1 s), the first beat (`split`) starts at 2.03 s (en) / 2.43 s (ko), and the push-in waits until the shot has settled at about 10.4 s. After this plan: both renders pass every check, the poster is the byte counter landed on 9,907 with −86% (before: the first scene's opening at 1.6 s), the draft renders in about 8 s against about 17 s for the video, and the full suite passes (1617 tests). The poster and `empty-opening` were added at the program lead's request after B1's benchmark render (a poster of the Before terminal window alone, about 30% of the media region, which `empty-frame` cannot see because it reads only settled frames).

## Review Focus

The five inputs or conditions the spec implies that a person will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **A sound-only `covi render` that reuses a `video/frames.json` written before this PR** (its layout reports have no `shot`) — `overlap` and `out-of-frame` must pass and say nothing was measured, never fail the reused video. Test: Task 3, `choreography.test.ts` "read only frames where the scene has settled, and say when nothing was measured".
2. **A 9:16 or odd-sized video drafted** (1080×1920, 1366×768) — the draft keeps even pixels and the same orientation, and its timeline has the same moments as the full-size one. Tests: Task 5, `draft.test.ts` "halves the size on even pixels…" and "is the same video, scaled…" (looped over three sizes).
3. **A draft render followed by a sound-only `covi render`** — the draft must leave `video/frames.json`, `video/composition/`, and the video untouched, so the next render still reuses its frames. Test: Task 5, `tests/render/render.test.ts` "drafts the benchmark beside its video…" (every file of the run but `run.json` and the draft hashes the same before and after; the run's outcome still describes the video).
4. **A machine without a speech engine** (captions only) — the draft renders with no audio stream and no crash; `masterVoice` writes nothing. Test: Task 5, `draft.test.ts` "masters the voice alone, and nothing without one".
5. **Korean and Japanese labels** — reading time counts CJK characters at 8 a second (a Korean label wants longer than its Latin length suggests). Test: Task 2, `choreography.test.ts` "reads Latin text at 15 characters a second and CJK at 8, after a glance".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/video/src/timeline/motion.ts` (create) | 1 | `CameraPlan` (+ `steady`), `cameraPlan`, `ENTERED`, `PUNCH_OUT`, `MotionKind`, `MotionSpan`, `motionSpans` (DOM-free, bundled by the runtime) |
| `packages/video/src/timeline/cues.ts` | 1 | `ShotMotion`, `shotMotion`; `shotSettledAt` takes its maximum |
| `packages/video/src/runtime/camera.ts`, `runtime/tsconfig.json` | 1 | re-export the plan; the steady push |
| `packages/video/src/choreography.ts` (create) | 2, 3, 4 | `STILL_SECONDS`, `Stretch`, `SpokenStill`, `spokenStills`, `onlyCameraMoves`, `plannedStills`, `motionGapCheck`, `BUSY_BEATS`, `BUSY_MOVES`, `motionBusyCheck`, `READING`, `readingSeconds`, `readingTimeCheck`, `droppedBeatsCheck`, `choreographyChecks` (2); `ChoreographyTimeline`, `OVERLAP_SHARE`, `overlapCheck`, `outOfFrameCheck` (3); `emptyOpeningCheck` (4) |
| `packages/video/src/qc.ts` | 2, 3 | `still` through `spokenStills` and its push-in note; the choreography checks in `runQc` |
| `packages/video/src/timeline/types.ts` | 2, 3, 4 | `DroppedBeat`, `SceneDirection.dropped` (2, unless B5 merged them); `ShotReport`, `LayoutReport.shot` (3); `LayoutReport.content` (4) |
| `packages/video/src/direction/resolve.ts` | 2 | `flowOrder` records what it drops (unless B5 did) |
| `packages/video/src/density.ts` | 3, 4 | export B1's `settledReports` (3) and `CARDS` (4) |
| `packages/video/src/runtime/canvas.ts`, `runtime/direction/elements.ts`, `runtime/stage.ts` | 3, 4 | `unview`; `ShotComponent.placed`; `localView`, `shotReport` (3); `content` in the report (4) |
| `packages/video/src/runtime/dom.ts` | 4 | `drawnBox` |
| `packages/video/src/timeline/motion.ts`, `runtime/camera.ts` | 4 | `ACCENT_OUT` (the hero's ring), shared |
| `packages/video/src/timeline/cues.ts` | 4 | `openingSpan` |
| `packages/video/src/render/renderer.ts` | 4 | opening samples in B1's `layoutSampleFrames`; `posterFrame` |
| `packages/video/src/draft.ts` (create) | 5 | `DRAFT_DIR`, `DRAFT_PATHS`, `DRAFT_FPS`, `DRAFT_SCALE`, `draftSpec` |
| `packages/video/src/pipeline.ts`, `sound.ts` | 5 | `draftRender`, `renderDraft`, `timelineGrounding`; `masterVoice` |
| `packages/video/src/index.ts` | 2–5 | exports |
| `packages/core/src/run/run.ts` | 5 | `ArtifactKind` `'draft'` |
| `packages/cli/src/main.ts`, `workflows.ts`, `ui.ts` | 5 | `--draft`, `RenderFlags`; `WorkflowResult.video.draft`, the draft branch of `applyVideoResult`; the `Draft` line |
| tests (see each task) | 1–6 | unit, render, CLI, and full-pipeline tests |
| `skills/covi-video/SKILL.md`, `docs/video.md`, `docs/cli.md`, `docs/artifacts.md`, `AGENTS.md`, `CHANGELOG.md` | 7 | the loop and the documentation |

---
### Task 1: The camera's plan moves where QC can read it, and a shot that waits on its line pushes in from its entrance

**Files:**
- Create: `packages/video/src/timeline/motion.ts`
- Modify: `packages/video/src/timeline/cues.ts` (B2's `shotSettledAt`, as B3–B5 extended it)
- Modify: `packages/video/src/runtime/camera.ts` (B2's `CameraPlan`, `CAPTURES`, `ENTERED`, `cameraPlan`, `PUNCH_OUT`; `cameraPush`)
- Modify: `packages/video/src/runtime/tsconfig.json` (`include`)
- Modify: `packages/video/test/motion.test.ts` (B2's "pushes in once the shot’s beats are done, not before")
- Modify: `tests/render/morph.test.ts` (B3's follow-camera scale assertion)
- Create: `packages/video/test/motion-spans.test.ts`

**Interfaces:**
- Consumes: `settledAt`, `shotSettledAt`, `Span`, `MORPH_SETTLE`, `COMPARE_LANDS` (B1–B4, `timeline/cues.ts`); `TimelineScene`, `Timeline`, `HERO_PHASE` (`timeline/types.ts`); `motion.linger` (`@covi/brand`).
- Produces (later tasks rely on these exact names):
  ```ts
  // packages/video/src/timeline/cues.ts
  export interface ShotMotion { name: string; beat: boolean; span: Span }
  export function shotMotion(scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>): ShotMotion[];
  export function shotSettledAt(scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>): number; // same results as before

  // packages/video/src/timeline/motion.ts (DOM-free; bundled by the runtime, imported by Node QC)
  export interface CameraPlan { duration: number; drift: boolean; settled: number; speechEnd?: number; steady: boolean; still: boolean; hero?: number }
  export const ENTERED = 0.5;
  export const PUNCH_OUT = 0.6;
  export function cameraPlan(scene: TimelineScene): CameraPlan | undefined;
  export type MotionKind = 'entrance' | 'element' | 'beat' | 'camera';
  export interface MotionSpan { scene: string; kind: MotionKind; name: string; span: Span }
  export function motionSpans(timeline: Pick<Timeline, 'scenes' | 'transition'>): MotionSpan[];

  // packages/video/src/runtime/camera.ts
  export { type CameraPlan, cameraPlan } from '../timeline/motion.ts'; // the stage keeps importing from here
  export function cameraPush(t: number, plan: CameraPlan): number;      // steady plans push linearly
  ```

Why this task exists: B5's planner measured the benchmark's first scene holding still for 1.7 s (en) and 2.1 s (ko): its beats are spread from 15% of a 12–15 s line (spec §4.7), and B2's push-in waits until the shot has settled after its last beat. In 0.2.0 a visual whose moments are pinned to its line already pushes in once it has entered, because it would otherwise wait still for them; a shot's beats wait on the line the same way. On the scratch copy, starting the eased push at 0.5 s was not enough (Korean still froze 1.8 s: `easeInOutSine` barely moves for its first seconds over a 15 s scene), while an even-paced push passed both languages. QC must read the same plan the runtime draws with, and `runtime/camera.ts` imports `anim.ts`, whose helpers carry DOM types Node cannot compile, so the plan moves to `timeline/motion.ts` (which the runtime bundles like `timeline/cues.ts`).

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/motion.test.ts`, inside `describe('the camera in a directed scene', …)`, replace B2's whole test `it('pushes in once the shot’s beats are done, not before', () => { … });` with:

```ts
  it('pushes in from the entrance, at an even pace, while a shot’s beats wait on its line', () => {
    expect(cameraPlan(base)).toMatchObject({ settled: 0.6, steady: false });
    const visual = { id: 'visual', kind: 'visual' as const, rect };
    const directed: TimelineScene = {
      ...base,
      direction: {
        whole: true,
        elements: [visual],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', t: 2, seconds: 0.8 }],
      },
    };
    const plan = cameraPlan(directed)!;
    expect(plan).toMatchObject({ settled: 0.5, steady: true });
    // From its entrance to the end at one pace: no stretch of the line waits for the beat.
    expect(cameraPush(0.5, plan)).toBe(0);
    expect(cameraPush(3.25, plan)).toBeCloseTo(motion.linger / 2, 9);
    const step = (t: number) => cameraPush(t + 0.1, plan) - cameraPush(t, plan);
    expect(step(0.6)).toBeGreaterThan(0);
    expect(step(4.5)).toBeCloseTo(step(0.6), 9);
    // A shot with nothing to wait for pushes in once it has settled, eased, as without direction.
    const placed: TimelineScene = {
      ...base,
      direction: { whole: true, elements: [visual], beats: [] },
    };
    expect(cameraPlan(placed)).toMatchObject({ settled: 0.6, steady: false });
  });
```

(`base` is B2's 6 s callout scene with its line from 0.3 s to 5 s; `rect` is the test block's `{ x: 0, y: 0, width: 10, height: 10 }`; the file already imports `motion` from `@covi/brand` and `cameraPlan`, `cameraPush` from `../src/runtime/camera.ts`.)

Create `packages/video/test/motion-spans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { settledAt, shotMotion, shotSettledAt } from '../src/timeline/cues.ts';
import { motionSpans, PUNCH_OUT } from '../src/timeline/motion.ts';
import type { TimelineScene, TimelineVisual } from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const capture: TimelineVisual = {
  kind: 'screenshot',
  image: { src: 'a.png', width: 10, height: 10 },
  device: 'desktop',
};
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: callout,
    expression: 'explaining',
    narrator: true,
    speech: { start: start + 0.3, end: end - 0.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const round = (spans: ReturnType<typeof motionSpans>) =>
  spans.map((m) => [m.scene, m.kind, m.name, ...m.span.map((v) => Math.round(v * 1000) / 1000)]);

describe('motion spans', () => {
  it('list each scene’s entrance, its shot’s elements and beats, and the camera', () => {
    const s1 = scene('s1', 0, 6, {
      direction: {
        whole: false,
        elements: [
          { id: 'n', kind: 'node', rect, label: 'Reader' },
          { id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' },
        ],
        beats: [
          { verb: 'reveal', element: 'l', style: 'pop', t: 2, seconds: 0.5 },
          { verb: 'camera', move: 'zoom', to: 'l', t: 3, seconds: 0.8 },
        ],
      },
    });
    const s2 = scene('s2', 5.3, 10, { transition: { kind: 'pan', seconds: 0.7 } });
    expect(round(motionSpans({ scenes: [s1, s2], transition: 0.45 }))).toEqual([
      ['s1', 'element', 'n', 0, 0.5],
      ['s1', 'camera', 'push', 0.5, 6],
      ['s1', 'beat', 'reveal', 2, 2.5],
      ['s1', 'element', 'l', 2, 2.5],
      ['s1', 'beat', 'camera', 3, 3.8],
      ['s2', 'entrance', 'pan', 5.3, 6],
      ['s2', 'element', 'callout', 5.3, 5.9],
      ['s2', 'camera', 'push', 5.9, 10],
    ]);
  });

  it('drift through a capture from its start, punch on the hero, and hold a static scene', () => {
    const drifting = scene('a', 0, 4, { visual: capture, hero: true, phases: { hero: 1 } });
    expect(round(motionSpans({ scenes: [drifting], transition: 0.45 }))).toContainEqual([
      'a',
      'camera',
      'drift',
      0,
      4,
    ]);
    expect(round(motionSpans({ scenes: [drifting], transition: 0.45 }))).toContainEqual([
      'a',
      'camera',
      'punch',
      1,
      1 + PUNCH_OUT,
    ]);
    const still = scene('a', 0, 4, { camera: 'static' });
    expect(motionSpans({ scenes: [still], transition: 0.45 }).map((m) => m.kind)).toEqual([
      'element',
    ]);
  });

  it('give the outro its entrance only', () => {
    const outro = scene('covi:outro', 4, 7, { visual: { kind: 'outro' }, speech: undefined });
    const spans = motionSpans({ scenes: [scene('s1', 0, 4.45), outro], transition: 0.45 });
    expect(round(spans.filter((m) => m.scene === 'covi:outro'))).toEqual([
      ['covi:outro', 'entrance', 'fade', 4, 4.45],
    ]);
  });

  it('settle a shot where its last part has moved', () => {
    const code = {
      kind: 'code' as const,
      path: 'a.js',
      lines: [{ type: 'add' as const, text: 'b' }],
      highlight: [],
    };
    const s = scene('s', 0, 6, {
      direction: {
        whole: false,
        elements: [
          { id: 'c', kind: 'code', rect, visual: code },
          {
            id: 'm',
            kind: 'morph',
            rect,
            morph: { path: 'a.js', base: [], head: [], rows: [], tokens: [] },
          },
        ],
        beats: [
          { verb: 'reveal', element: 'c', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'morph', element: 'm', t: 2, seconds: 1.6 },
        ],
      },
    });
    const parts = shotMotion(s);
    expect(parts.find((p) => p.name === 'c')!.span).toEqual([1, 1 + settledAt(code, 5)]);
    // A morph's added tokens keep their color half a second after it.
    expect(parts.find((p) => p.name === 'morph')!.span).toEqual([2, 4.1]);
    expect(shotSettledAt(s)).toBeCloseTo(4.1, 9);
  });
});
```

(If B3 merged `MorphVisual` with other required fields, add them to the morph literal; the test only needs a morph element to exist.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/motion.test.ts packages/video/test/motion-spans.test.ts`
Expected: FAIL — `motion-spans.test.ts` cannot import `../src/timeline/motion.ts` and `shotMotion`; in `motion.test.ts` the directed plan has `settled` 2.8 and no `steady`.

- [ ] **Step 3: Split `shotSettledAt` into `shotMotion` in `packages/video/src/timeline/cues.ts`**

Replace B2's `shotSettledAt` (with its doc comment; B3 added the morph branch, B4 the metric branch, B5 the packet/pile branch) with:

```ts
/**
 * A part of a directed scene that moves: an element entering and playing its own choreography,
 * or a beat.
 */
export interface ShotMotion {
  /** The element's id, or the beat's verb. */
  name: string;
  beat: boolean;
  /** Seconds since the scene started. */
  span: Span;
}

/**
 * When each part of a directed scene moves: every element from its reveal until it has entered
 * and played its own choreography (the storyboard visual on the scene's phases, code typing in,
 * a counter landing; a packet or a pile is in place half a second after it enters, and its verbs
 * are beats), and every beat (a morph's added tokens settle after it).
 */
export function shotMotion(
  scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>,
): ShotMotion[] {
  const d = scene.direction;
  if (!d) return [];
  const duration = scene.end - scene.start;
  const revealedAt = (id: string) =>
    d.beats.find((b) => b.verb === 'reveal' && b.element === id)?.t ?? 0;
  const elements = d.elements.map((e): ShotMotion => {
    const at = revealedAt(e.id);
    const settled =
      e.kind === 'visual'
        ? Math.max(at, settledAt(scene.visual, duration, scene.phases))
        : e.kind === 'metric'
          ? at + (e.show === 'compare' ? COMPARE_LANDS + 0.6 : 0.5)
          : e.kind === 'code' || e.kind === 'output' || e.kind === 'capture'
            ? at + settledAt(e.visual, Math.max(0.1, duration - at))
            : at + 0.5;
    return { name: e.id, beat: false, span: [at, settled] };
  });
  const beats = d.beats.map(
    (b): ShotMotion => ({
      name: b.verb,
      beat: true,
      span: [b.t, b.t + b.seconds + (b.verb === 'morph' ? MORPH_SETTLE : 0)],
    }),
  );
  // Beats first: at the same moment, a beat is what a viewer sees start.
  return [...beats, ...elements];
}

/**
 * When a directed scene's choreography is done: every element has entered and played its own,
 * and every beat has ended (see `shotMotion`).
 */
export function shotSettledAt(
  scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>,
): number {
  if (!scene.direction) return settledAt(scene.visual, scene.end - scene.start, scene.phases);
  return Math.max(0, ...shotMotion(scene).map((m) => m.span[1]));
}
```

The maximum is unchanged for every element kind: a morph element's `at + 0.5` and its morph beat's end plus `MORPH_SETTLE` are now two entries instead of one `Math.max`; node, label, packet, and pile settle at `at + 0.5` as before; a revealed visual's reveal beat already ends after its reveal. If B4 or B5 merged another kind with its own settle time (a kind this list sends to `at + 0.5`), keep its merged formula as its own branch here. B2's "waits for every element’s own choreography from its reveal" test and B3–B5's settle tests are the guard: they must pass unchanged.

- [ ] **Step 4: Create `packages/video/src/timeline/motion.ts`**

```ts
import { type Span, settledAt, shotMotion, shotSettledAt } from './cues.ts';
import { HERO_PHASE, type Timeline, type TimelineScene } from './types.ts';

/*
 * When the picture moves, as pure functions of the timeline: the scene camera's plan, which the
 * runtime pushes in with, and every stretch of motion a timeline plans, which QC holds against
 * the narration. No DOM and no Node APIs: the runtime bundles this file.
 */

export interface CameraPlan {
  duration: number;
  /** A capture: the camera drifts through the whole scene. */
  drift: boolean;
  /** When the push-in may start (seconds since the scene started): the choreography is done, or
   * the visual has entered when its moments wait on the line. */
  settled: number;
  /** When its line ends; a visual that settles before it pushes in. */
  speechEnd?: number;
  /**
   * The push-in moves at an even pace from `settled` to the end, never easing in: a shot whose
   * beats wait on its line, so the frame moves from its entrance to its first beat.
   */
  steady: boolean;
  /** `camera: static`: neither drift nor push-in. */
  still: boolean;
  /** The hero phase, where the camera punches in. */
  hero?: number;
}

/** Visuals that are captures of the running software. */
const CAPTURES = new Set<TimelineScene['visual']['kind']>([
  'screenshot',
  'before-after',
  'interaction',
]);

/** When a visual's entrance has risen into place (the first `rise` of every component). */
export const ENTERED = 0.5;
/** The hero's punch is over this long after its phase. */
export const PUNCH_OUT = 0.6;

/**
 * How the camera moves in a scene; the outro moves on its own. A capture drifts through its whole
 * scene; any other visual pushes in once its choreography is done, or once it has entered when
 * its moments wait on the line: an event pinned to a phrase, a diagram's edges drawing under its
 * nodes, or a shot's beats spread through the line (the frame would otherwise hold still until
 * the first of them).
 */
export function cameraPlan(scene: TimelineScene): CameraPlan | undefined {
  const v = scene.visual;
  if (v.kind === 'outro') return undefined;
  const duration = scene.end - scene.start;
  const hero = scene.hero ? scene.phases?.[HERO_PHASE] : undefined;
  // A directed scene settles once its elements have played and its beats have ended.
  const settled = scene.direction ? shotSettledAt(scene) : settledAt(v, duration, scene.phases);
  const pinned = Object.keys(scene.phases ?? {}).some((name) => name !== HERO_PHASE);
  const waits = Boolean(scene.direction?.beats.length);
  const early = pinned || v.kind === 'diagram' || waits;
  return {
    duration,
    // A shot that lays the capture out beside other elements holds it still: they move instead.
    drift:
      (!scene.direction || scene.direction.whole) &&
      (CAPTURES.has(v.kind) || (v.kind === 'title' && v.background !== undefined)),
    settled: early ? Math.min(settled, ENTERED) : settled,
    ...(scene.speech ? { speechEnd: scene.speech.end - scene.start } : {}),
    steady: waits,
    still: scene.camera === 'static',
    ...(hero === undefined ? {} : { hero }),
  };
}

/** What moves in a stretch of motion. */
export type MotionKind = 'entrance' | 'element' | 'beat' | 'camera';

/** A stretch in which something on screen moves, in seconds from the start of the video. */
export interface MotionSpan {
  scene: string;
  kind: MotionKind;
  /** The element or the beat's verb that moves; for the camera, how it moves. */
  name: string;
  span: Span;
}

/**
 * Every stretch in which the picture moves, ordered by start: each scene's entrance (a camera
 * move between stops among them), each story scene's visual or shot elements entering and
 * playing their own choreography, its beats, and the scene camera (a capture's drift, the push-in
 * once settled, the hero's punch). The outro's own choreography is Covi's and is not listed.
 */
export function motionSpans(timeline: Pick<Timeline, 'scenes' | 'transition'>): MotionSpan[] {
  const spans: MotionSpan[] = [];
  timeline.scenes.forEach((scene, i) => {
    const at = (s: Span): Span => [scene.start + s[0], scene.start + s[1]];
    const add = (kind: MotionKind, name: string, s: Span) => {
      if (s[1] > s[0] + 1e-9) spans.push({ scene: scene.id, kind, name, span: at(s) });
    };
    const enter = i === 0 ? 0 : (scene.transition?.seconds ?? timeline.transition);
    add('entrance', scene.transition?.kind ?? 'fade', [0, enter]);
    if (scene.visual.kind === 'outro') return;
    const duration = scene.end - scene.start;
    if (scene.direction)
      for (const m of shotMotion(scene)) add(m.beat ? 'beat' : 'element', m.name, m.span);
    else add('element', scene.visual.kind, [0, settledAt(scene.visual, duration, scene.phases)]);
    const plan = cameraPlan(scene);
    if (!plan) return;
    if (!plan.still && plan.drift) add('camera', 'drift', [0, duration]);
    else if (
      !plan.still &&
      plan.speechEnd !== undefined &&
      plan.settled < Math.min(plan.speechEnd, duration)
    )
      add('camera', 'push', [plan.settled, duration]);
    if (plan.hero !== undefined) add('camera', 'punch', [plan.hero, plan.hero + PUNCH_OUT]);
  });
  return spans.sort((a, b) => a.span[0] - b.span[0]);
}
```

(`cameraPlan` is B2's, moved, with two changes: `waits` joins `early`, and `steady`. If B3–B5 merged further changes into it, carry them over.)

- [ ] **Step 5: Point `packages/video/src/runtime/camera.ts` at the shared plan, and push steadily**

Replace everything from the top of the file down to (not including) `/** How far the camera has pushed in at \`t\`` with:

```ts
import { motion } from '@covi/brand';
import { type CameraPlan, PUNCH_OUT } from '../timeline/motion.ts';
import { easeInOutCubic, easeInOutSine, easeOutCubic, seg } from './anim.ts';

/*
 * The camera: a scene never holds still while its line is spoken. Its plan (`cameraPlan`, shared
 * with QC) says when it drifts, pushes in, and punches; these are the moves, pure functions of the
 * scene clock.
 */

export { type CameraPlan, cameraPlan } from '../timeline/motion.ts';

```

In `cameraPush`, replace:

```ts
    else if (plan.speechEnd !== undefined && plan.settled < Math.min(plan.speechEnd, plan.duration))
      push += motion.linger * easeInOutSine(seg(t, plan.settled, plan.duration));
```

with:

```ts
    else if (
      plan.speechEnd !== undefined &&
      plan.settled < Math.min(plan.speechEnd, plan.duration)
    ) {
      const k = seg(t, plan.settled, plan.duration);
      push += motion.linger * (plan.steady ? k : easeInOutSine(k));
    }
```

and delete the line `const PUNCH_OUT = 0.6;` (keep `const PUNCH_IN = 0.1;` and `const RING = 0.7;`; `heroPunch` now reads the imported `PUNCH_OUT`).

In `packages/video/src/runtime/tsconfig.json`, add `"../timeline/motion.ts",` to `include` after `"../timeline/cues.ts",`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/motion.test.ts packages/video/test/motion-spans.test.ts packages/video/test/density-direction.test.ts`
Expected: PASS (B2's settle tests unchanged).

Run: `npm run typecheck`
Expected: exit 0 (both configs; Node code may import `timeline/motion.ts`, which imports only `timeline/cues.ts` and `timeline/types.ts`).

- [ ] **Step 7: Update the render tests that pinned no push-in during beats**

The push-in now runs under a shot's beats, so a camera beat's scale grows by at most `motion.linger` (2%). In `tests/render/morph.test.ts` (B3's "follows the changed lines with the camera as they move, keeping them in the region"), replace:

```ts
    // Zoomed in, and moving with the lines: no two of these frames share a camera.
    for (const c of cameras) expect(c.scale).toBeCloseTo(1.25, 2);
```

with:

```ts
    // Zoomed in, and moving with the lines: no two of these frames share a camera. The push-in
    // runs under the beats, so the zoom grows by at most its 2%.
    for (const c of cameras) {
      expect(c.scale).toBeGreaterThanOrEqual(1.25 - 1e-3);
      expect(c.scale).toBeLessThanOrEqual(1.25 * 1.02 + 1e-3);
    }
```

Then run (in the background, and wait): `npx vitest run tests/render packages/video/test`
Expected: PASS. On the scratch copy only B2's motion test and this morph assertion pinned the old behavior. If another merged test pins a camera scale or transform during a directed scene's beats, loosen it the same way (by at most 2%, never by dropping the assertion) and name it in the report. The canvas test "with direction off, draws as 0.2.0 did" must pass unchanged (R-016).

- [ ] **Step 8: Render the benchmark in both languages and check `still`**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/en.json"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --language ko --json > "$RENDER/ko.json"
for f in en ko; do node -e '
const fs = require("fs"), path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const qc = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "qc.json"), "utf8"));
console.log(process.argv[1], qc.status);
for (const c of qc.checks.filter((c) => c.status !== "pass")) console.log(" ", c.id, c.status, c.message);
' "$RENDER/$f.json"; done
```

Run the two `covi video` lines in the background, one after the other, and wait. Expected (as measured on the scratch copy): both `pass`, and no `still` line (before this task: `still warn … s1 (1.7 s from 0.0 s)` in English, `s1 (2.1 s …)` in Korean). If `still` still names `s1`, measure where the picture froze with `ffmpeg -i <runDir>/video/covi-review.mp4 -an -vf "crop=1728:662:96:206,freezedetect=n=0.001:d=0.5" -f null - 2>&1 | grep freeze_` and report it before changing anything else.

- [ ] **Step 9: Commit**

```bash
rm -rf "$RENDER"
npx biome check --write packages/video/src/timeline packages/video/src/runtime/camera.ts packages/video/src/runtime/tsconfig.json packages/video/test/motion.test.ts packages/video/test/motion-spans.test.ts tests/render/morph.test.ts
npm run lint && npm run typecheck
git add packages/video/src/timeline/motion.ts packages/video/src/timeline/cues.ts packages/video/src/runtime/camera.ts packages/video/src/runtime/tsconfig.json packages/video/test/motion.test.ts packages/video/test/motion-spans.test.ts tests/render/morph.test.ts
git commit -m "$(cat <<'EOF'
Push in from the entrance while a shot's beats wait on its line

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 2: Motion checks on the timeline — `motion-gap`, `motion-busy`, `reading-time`, `dropped-beats` — and `still` shares their rule

**Files:**
- Create: `packages/video/src/choreography.ts`
- Modify: `packages/video/src/qc.ts` (imports; `STILL_SECONDS`; `stillCheck`; `measureStill`'s parameter type; `runQc`)
- Modify: `packages/video/src/timeline/types.ts` (`DroppedBeat`, `SceneDirection.dropped`) — only if B5 did not merge an equivalent (Step 0)
- Modify: `packages/video/src/direction/resolve.ts` (B5's `flowOrder` and its call in `resolveShot`) — only if B5 did not merge an equivalent (Step 0)
- Modify: `packages/video/src/index.ts` (exports)
- Create: `packages/video/test/choreography.test.ts`
- Modify: `packages/video/test/qc-grammar.test.ts` (`describe('the still gate', …)`)
- Modify: `packages/video/test/direction-flow.test.ts` (B5's "drop a merge timed before its split, and a count-up timed after its count")

**Interfaces:**
- Consumes: `motionSpans`, `MotionSpan` (Task 1, `timeline/motion.ts`); `storyScenes` (`timeline/build.ts`); `isCjk` (`text.ts`); `CAMERA_TRANSITIONS`, `DirectionElement`, `Timeline`, `TransitionKind` (`timeline/types.ts`); `QcCheck`, `Freeze`, `stillCheck`, `measureStill`, `runQc` (`qc.ts`); B1's `densityChecks` call in `runQc`.
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts (unless B5 merged an equivalent; Step 0)
  export interface DroppedBeat { verb: string; element: string; reason: string }
  // SceneDirection gains: dropped?: DroppedBeat[];

  // packages/video/src/choreography.ts
  export const STILL_SECONDS = 1.5;                       // moved from qc.ts, which re-exports it
  export interface Stretch { start: number; end: number }
  export interface SpokenStill { scene: string; seconds: number; at: number; end: number }
  export function spokenStills(timeline: Pick<Timeline, 'scenes'>, stretches: readonly Stretch[], min?: number): SpokenStill[];
  export function onlyCameraMoves(timeline: Pick<Timeline, 'scenes' | 'transition'>, still: Pick<SpokenStill, 'at' | 'end'>): boolean;
  export function plannedStills(timeline: Pick<Timeline, 'scenes' | 'transition'>): Stretch[];
  export function motionGapCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck;      // id 'motion-gap', warn
  export const BUSY_BEATS = 3;
  export const BUSY_MOVES = 2;
  export function motionBusyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck;                    // id 'motion-busy', warn
  export const READING: { readonly glance: 0.4; readonly latin: 15; readonly cjk: 8 };
  export function readingSeconds(text: string): number;
  export function readingTimeCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck;   // id 'reading-time', warn
  export function droppedBeatsCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck;                 // id 'dropped-beats', warn
  export function choreographyChecks(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck[]; // Task 3 widens it
  // packages/video/src/qc.ts
  export function stillCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>, freezes: readonly Freeze[]): QcCheck;
  ```

How `motion-gap` and `still` fit together (spec §10 and the reconciliation the program asked for): both hold the picture to one rule, "no stretch covering 1.5 s or more of narration holds still", through one helper (`spokenStills`, moved out of `stillCheck`). `motion-gap` finds the stretches from the timeline's own plan (`motionSpans`: entrances, elements entering and playing their choreography, beats, and the scene camera's drift, push-in, and punch, as the spec lists them) and names what ends each one; `still` finds them in the rendered pixels (ffmpeg `freezedetect`, unchanged). They disagree only where the plan moves nothing but the slow push-in or drift and the pixels barely change; `still` then says so ("where only the camera's slow push-in moves"), pointing at the same fix `motion-gap` names.

- [ ] **Step 0: Read how B5 merged R-023**

Find how B5 records a dropped beat: `grep -rn "dropped\|R-023" packages/video/src/direction packages/video/src/timeline/types.ts packages/video/src/pipeline.ts`.

- If the resolved `SceneDirection` (on `timeline.json`) already carries the dropped beats, keep B5's field and shape: skip Steps 3–4's type and resolver code, and in `droppedBeatsCheck` (Step 5) and the tests (Step 1) read B5's field name and reason text instead of `dropped` and `reason`.
- If B5 only warns (a run warning and a note in the render result) and keeps nothing on the timeline, apply Steps 3–4 as written and keep B5's warning and note: QC must read the dropped beats from the timeline, because the draft and the final render both check the timeline.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/choreography.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  choreographyChecks,
  droppedBeatsCheck,
  motionBusyCheck,
  motionGapCheck,
  readingSeconds,
  readingTimeCheck,
} from '../src/choreography.ts';
import type {
  DirectionBeat,
  DirectionElement,
  Timeline,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const label = (id: string, text: string): DirectionElement => ({
  id,
  kind: 'label',
  rect,
  text,
  tone: 'neutral',
});
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    speech: { start: start + 0.3, end: end - 0.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const shot = (elements: DirectionElement[], beats: DirectionBeat[] = []) => ({
  whole: false,
  elements,
  beats,
});
const outro = (start: number) =>
  scene('covi:outro', start, start + 2.5, { visual: { kind: 'outro' }, speech: undefined });
const timeline = (scenes: TimelineScene[]) =>
  ({
    scenes,
    transition: 0.45,
    fps: 30,
    frames: Math.round((scenes.at(-1)?.end ?? 0) * 30),
    width: 1920,
    height: 1080,
    orientation: 'landscape',
  }) as Timeline;
const reveal = (element: string, t: number): DirectionBeat => ({
  verb: 'reveal',
  element,
  style: 'rise',
  t,
  seconds: 0.5,
});

describe('motion gaps', () => {
  // A held picture: no push-in, and the second label waits 2.5 s after the first.
  const held = scene('s1', 0, 6, {
    camera: 'static',
    direction: shot([label('a', 'One'), label('b', 'Two')], [reveal('a', 0.5), reveal('b', 3)]),
  });

  it('name a stretch of narration with nothing moving, and what ends it', () => {
    const check = motionGapCheck(timeline([held, outro(6)]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain('s1 (2.0 s from 1.0 s, until the reveal at 3.0 s)');
  });

  it('pass a shot whose camera pushes in while its beats wait on the line', () => {
    const moving = { ...held, camera: undefined };
    expect(motionGapCheck(timeline([moving, outro(6)])).status).toBe('pass');
  });

  it('do not count silence: a still stretch with no line is not a gap', () => {
    const quiet = { ...held, speech: undefined };
    expect(motionGapCheck(timeline([quiet, outro(6)])).status).toBe('pass');
  });
});

describe('busy pictures', () => {
  it('warn when more than three beats start within a second', () => {
    const beats = [0.5, 0.7, 0.9, 1.2].map((t, i) => reveal(`e${i}`, t));
    const elements = beats.map((_, i) => label(`e${i}`, 'X'));
    const crowded = scene('s1', 0, 6, { direction: shot(elements, beats) });
    expect(motionBusyCheck(timeline([crowded])).message).toContain(
      '4 beats start within 1 s in s1 (from 0.5 s)',
    );
    const spread = beats.map((b, i) => ({ ...b, t: 0.5 + 0.4 * i }));
    expect(
      motionBusyCheck(timeline([scene('s1', 0, 6, { direction: shot(elements, spread) })])).status,
    ).toBe('pass');
  });

  it('warn on more than two camera moves within two seconds, a pan between stops among them', () => {
    const camera = (t: number): DirectionBeat => ({
      verb: 'camera',
      move: 'zoom',
      to: 'a',
      t,
      seconds: 0.8,
    });
    const stop = { x: 0, y: 0 };
    const scenes = (stops: boolean) => [
      scene('s1', 0, 4, stops ? { stop } : {}),
      scene('s2', 4, 9, {
        transition: { kind: 'pan', seconds: 0.7 },
        ...(stops ? { stop: { x: 2400, y: 0 } } : {}),
        direction: shot([label('a', 'A')], [camera(0.8), camera(1.6)]),
      }),
    ];
    expect(motionBusyCheck(timeline(scenes(true))).message).toContain(
      '3 camera moves within 2 s in s2 (from 4.0 s)',
    );
    // Without a canvas a pan is drawn as a push: not a camera move.
    expect(motionBusyCheck(timeline(scenes(false))).status).toBe('pass');
  });
});

describe('reading time', () => {
  it('reads Latin text at 15 characters a second and CJK at 8, after a glance', () => {
    expect(readingSeconds('Reader')).toBeCloseTo(0.4 + 6 / 15, 9);
    expect(readingSeconds('리더 단계')).toBeCloseTo(0.4 + 4 / 8, 9);
    expect(readingSeconds('  ')).toBeCloseTo(0.4, 9);
  });

  it('warn on words that leave before they can be read', () => {
    const words = 'Reader fetches each document';
    // Revealed at 3.6 s, fully in at 4.1 s; the next scene starts to enter at 4.55 s. Its 25
    // characters want 0.4 + 25 / 15 s.
    const late = scene('s1', 0, 5, { direction: shot([label('l', words)], [reveal('l', 3.6)]) });
    const next = scene('s2', 4.55, 9, { transition: { kind: 'fade', seconds: 0.45 } });
    const check = readingTimeCheck(timeline([late, next]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain(`"${words}" in s1 for 0.5 s (2.1 s wanted)`);
    const early = { ...late, direction: shot([label('l', words)], [reveal('l', 0.5)]) };
    expect(readingTimeCheck(timeline([early, next])).status).toBe('pass');
  });
});

describe('dropped beats', () => {
  it('say which beats did not play, and why', () => {
    const s = scene('s1', 0, 6, {
      direction: {
        ...shot([label('a', 'A')]),
        dropped: [
          { verb: 'merge', element: 'p', reason: 'the merge of "p" starts before its split' },
        ],
      },
    });
    const check = droppedBeatsCheck(timeline([s]));
    expect(check.status).toBe('warn');
    expect(check.message).toContain('s1: the merge of "p" starts before its split');
    expect(droppedBeatsCheck(timeline([scene('s1', 0, 6)])).status).toBe('pass');
  });
});

describe('the choreography checks', () => {
  it('come in one order, and warn', () => {
    const checks = choreographyChecks(timeline([scene('s1', 0, 6), outro(6)]));
    expect(checks.map((c) => c.id)).toEqual([
      'motion-gap',
      'motion-busy',
      'reading-time',
      'dropped-beats',
    ]);
    expect(checks.every((c) => c.status === 'pass')).toBe(true);
  });
});
```

In `packages/video/test/qc-grammar.test.ts`, add after the test "warns when the picture freezes for 1.5 s or more of narration, naming the scene" (add `type Timeline` to the existing `../src/timeline/types.ts` import if it is not there):

```ts
  it('says when only the camera’s slow push-in moved where the picture froze', () => {
    const timed = { ...story, transition: 0.45 } as Pick<Timeline, 'scenes' | 'transition'>;
    // s2's callout has risen by 4.8 s; from then on only the push-in moves until the outro.
    expect(stillCheck(timed, [{ start: 5, end: 7.5 }]).message).toContain(
      "s2 (2.5 s from 5.0 s), where only the camera's slow push-in moves",
    );
    // Across the cut, s2's entrance and its callout rising move: something else was planned.
    expect(stillCheck(timed, [{ start: 3, end: 5.5 }]).message).not.toContain('push-in');
  });
```

In `packages/video/test/direction-flow.test.ts`, at the end of B5's test "drop a merge timed before its split, and a count-up timed after its count" (after its `expect(s2!.direction.beats.map((b) => b.verb).sort()).toEqual(['count', 'split']);`), add:

```ts
    // Said, not silently dropped (R-023): QC's dropped-beats check names them.
    const dropped = s2!.direction.dropped!;
    expect(dropped.map((d) => d.verb).sort()).toEqual(['count-up', 'merge']);
    expect(dropped.find((d) => d.verb === 'merge')!.reason).toMatch(
      /^the merge of "p" at \d+\.\d s comes before its split$/,
    );
```

(If Step 0 found B5's own field, assert on it instead.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/choreography.test.ts packages/video/test/qc-grammar.test.ts packages/video/test/direction-flow.test.ts`
Expected: FAIL — `../src/choreography.ts` does not exist; the still message has no push-in note; `direction.dropped` is undefined (unless B5 carries it).

- [ ] **Step 3: `DroppedBeat` on the timeline (skip if B5 carries it)**

In `packages/video/src/timeline/types.ts`, insert before `/** A scene's shot, resolved. */`:

```ts
/** A beat the direction asked for that the resolver left out, and why (R-023). */
export interface DroppedBeat {
  verb: string;
  /** What it acted on. */
  element: string;
  /** Why, in a phrase QC quotes after the scene's id. */
  reason: string;
}
```

and add to `SceneDirection`, after `beats`:

```ts
  /** Beats the direction asked for that cannot play where their phrases put them (R-023). */
  dropped?: DroppedBeat[];
```

- [ ] **Step 4: The resolver records what it drops (skip if B5 does)**

In `packages/video/src/direction/resolve.ts`, add `DroppedBeat,` to the `../timeline/types.ts` import (after `DirectionElement,`). Replace B5's `flowOrder` (with its doc comment) with:

```ts
/**
 * The flow beats that still make sense once timed: a merge after the split it pulls back (a pile
 * merges any time), and a count-up that has landed by the time its counter's count starts (which
 * then ticks from where the count-up ended). Phrases can put beats out of the written order; the
 * ones that cannot play are left out and said why (R-023).
 */
function flowOrder(
  beats: DirectionBeat[],
  elements: readonly DirectionElement[],
): { beats: DirectionBeat[]; dropped: DroppedBeat[] } {
  const piles = new Set(elements.flatMap((e) => (e.kind === 'pile' ? [e.id] : [])));
  const split = new Map(
    beats.flatMap((b) => (b.verb === 'split' ? [[b.element, b.t] as const] : [])),
  );
  const count = new Map(
    beats.flatMap((b) => (b.verb === 'count' ? [[b.element, b.t] as const] : [])),
  );
  const dropped: DroppedBeat[] = [];
  const kept = beats.filter((b) => {
    if (
      b.verb === 'merge' &&
      !piles.has(b.element) &&
      !((split.get(b.element) ?? Number.POSITIVE_INFINITY) < b.t)
    ) {
      dropped.push({
        verb: b.verb,
        element: b.element,
        reason: `the merge of "${b.element}" at ${b.t.toFixed(1)} s comes before its split`,
      });
      return false;
    }
    if (
      b.verb === 'count-up' &&
      b.t + b.seconds > (count.get(b.element) ?? Number.POSITIVE_INFINITY) + 1e-9
    ) {
      dropped.push({
        verb: b.verb,
        element: b.element,
        reason: `the count-up of "${b.element}" lands at ${(b.t + b.seconds).toFixed(1)} s, after its count starts`,
      });
      return false;
    }
    return true;
  });
  return { beats: kept, dropped };
}
```

In `resolveShot`, replace B5's

```ts
  return { whole, elements, beats: stretchFlows(flowOrder(timed, elements), timing) };
```

with:

```ts
  const ordered = flowOrder(timed, elements);
  return {
    whole,
    elements,
    beats: stretchFlows(ordered.beats, timing),
    ...(ordered.dropped.length ? { dropped: ordered.dropped } : {}),
  };
```

The field is left out when nothing was dropped, so the timelines (and frames keys) of every direction that drops nothing are unchanged. Everything `resolveDirection` returns is redacted already (`input.redact(staged)`).

- [ ] **Step 5: Create `packages/video/src/choreography.ts`**

```ts
import type { QcCheck } from './qc.ts';
import { isCjk } from './text.ts';
import { storyScenes } from './timeline/build.ts';
import { type MotionSpan, motionSpans } from './timeline/motion.ts';
import {
  CAMERA_TRANSITIONS,
  type DirectionElement,
  type Timeline,
  type TransitionKind,
} from './timeline/types.ts';

/*
 * Choreography checks: does something move whenever the narration speaks, without crowding the
 * moment; is every word on screen long enough to read; do a shot's elements keep clear of one
 * another and inside the frame; and did every beat asked for play. All but `out-of-frame` warn
 * (R-007): they judge pacing, while an element drawn outside its frame is broken output.
 */

/** How long the picture may hold still under narration before the scene reads as a slide (s). */
export const STILL_SECONDS = 1.5;

/** A stretch of the video, in seconds from its start. */
export interface Stretch {
  start: number;
  end: number;
}

/** A still stretch under narration: the first scene it overlaps, how much speech it covers, when. */
export interface SpokenStill {
  scene: string;
  seconds: number;
  at: number;
  end: number;
}

/**
 * The stretches that hold still for `min` seconds of narration or more, summed over the lines
 * they span, each named by the first story scene whose line it covers. Shared by `still` (frozen
 * pixels) and `motion-gap` (stretches the timeline plans no motion in).
 */
export function spokenStills(
  timeline: Pick<Timeline, 'scenes'>,
  stretches: readonly Stretch[],
  min = STILL_SECONDS,
): SpokenStill[] {
  const out: SpokenStill[] = [];
  for (const f of stretches) {
    let spoken = 0;
    let scene: string | undefined;
    for (const s of storyScenes(timeline.scenes)) {
      if (!s.speech) continue;
      const overlap = Math.min(f.end, s.speech.end) - Math.max(f.start, s.speech.start);
      if (overlap <= 0) continue;
      spoken += overlap;
      scene ??= s.id;
    }
    if (scene && spoken >= min - 1e-6)
      out.push({ scene, seconds: spoken, at: f.start, end: f.end });
  }
  return out;
}

/**
 * Whether the timeline plans nothing to move in a still stretch but the scene camera's slow
 * push-in or drift: what `still` names when frozen pixels have no other cause.
 */
export function onlyCameraMoves(
  timeline: Pick<Timeline, 'scenes' | 'transition'>,
  still: Pick<SpokenStill, 'at' | 'end'>,
): boolean {
  return !motionSpans(timeline).some(
    (m) =>
      (m.kind !== 'camera' || m.name === 'punch') &&
      m.span[0] < still.end - 1e-6 &&
      m.span[1] > still.at + 1e-6,
  );
}

/** The stretches of the story in which the timeline plans nothing to move. */
export function plannedStills(timeline: Pick<Timeline, 'scenes' | 'transition'>): Stretch[] {
  const end = storyScenes(timeline.scenes).at(-1)?.end ?? 0;
  const out: Stretch[] = [];
  let at = 0;
  for (const { span } of motionSpans(timeline)) {
    if (span[0] >= end) break;
    if (span[0] > at + 1e-6) out.push({ start: at, end: span[0] });
    at = Math.max(at, span[1]);
  }
  if (at < end - 1e-6) out.push({ start: at, end });
  return out;
}

const seconds = (n: number) => `${n.toFixed(1)} s`;
/** The first three of `names`, and an ellipsis for the rest. */
const listed = (names: readonly string[], sep = ', ') =>
  `${names.slice(0, 3).join(sep)}${names.length > 3 ? `${sep}…` : ''}`;

/**
 * Something moves whenever the narration speaks: the timeline's own plan (entrances, elements
 * entering, beats, the scene camera) leaves no stretch of 1.5 s or more of narration in which
 * nothing moves. `still` measures the same on the rendered pixels.
 */
export function motionGapCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck {
  const stretches = plannedStills(timeline);
  const gaps = spokenStills(timeline, stretches);
  if (!gaps.length) {
    const longest = Math.max(0, ...spokenStills(timeline, stretches, 0).map((g) => g.seconds));
    return {
      id: 'motion-gap',
      status: 'pass',
      message: `Something moves whenever the narration speaks (the longest still stretch under it is ${seconds(longest)}).`,
    };
  }
  const spans = motionSpans(timeline);
  const named = gaps.map((g) => {
    const next = spans.find((m) => m.span[0] >= g.end - 1e-6);
    return `${g.scene} (${seconds(g.seconds)} from ${seconds(g.at)}${next ? `, until ${what(next)} at ${seconds(next.span[0])}` : ''})`;
  });
  return {
    id: 'motion-gap',
    status: 'warn',
    message: `Nothing moves while the narration continues in ${listed(named)}. Pin a beat to an earlier phrase with \`at\`, reveal an element sooner, or add a camera beat.`,
  };
}

/** What starts moving at the end of a still stretch, for the message that names it. */
function what(m: MotionSpan): string {
  if (m.kind === 'beat') return `the ${m.name}`;
  if (m.kind === 'entrance') return `the ${m.name} into ${m.scene}`;
  if (m.kind === 'camera') return `the camera's ${m.name}`;
  return `"${m.name}" enters`;
}

/** More than this many beats starting within one second crowd the moment… */
export const BUSY_BEATS = 3;
/** …as do more than this many camera moves within two seconds. */
export const BUSY_MOVES = 2;
const MOVE_WINDOW = 2;

/** The first moment at which more than `max` of `times` start within `window` seconds. */
function crowded(
  times: ReadonlyArray<{ t: number; scene: string }>,
  max: number,
  window: number,
): { scene: string; at: number; count: number } | undefined {
  const sorted = [...times].sort((a, b) => a.t - b.t);
  for (let i = 0; i + max < sorted.length; i++) {
    const from = sorted[i]!;
    if (sorted[i + max]!.t - from.t >= window - 1e-9) continue;
    const count = sorted.filter((x) => x.t >= from.t && x.t < from.t + window - 1e-9).length;
    return { scene: from.scene, at: from.t, count };
  }
  return undefined;
}

const travels = (kind: TransitionKind | undefined) =>
  (CAMERA_TRANSITIONS as readonly string[]).includes(kind ?? '');

/**
 * The picture is never too busy to follow: no more than three beats start within any second,
 * and no more than two camera moves (camera beats, and pans and zooms between stops) within any
 * two seconds.
 */
export function motionBusyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const story = storyScenes(timeline.scenes);
  const beats = story.flatMap((s) =>
    (s.direction?.beats ?? []).map((b) => ({ t: s.start + b.t, scene: s.id })),
  );
  const moves = story.flatMap((s, i) => [
    ...(i > 0 && s.stop && story[i - 1]!.stop && travels(s.transition?.kind)
      ? [{ t: s.start, scene: s.id }]
      : []),
    ...(s.direction?.beats ?? []).flatMap((b) =>
      b.verb === 'camera' ? [{ t: s.start + b.t, scene: s.id }] : [],
    ),
  ]);
  const busy = [crowded(beats, BUSY_BEATS, 1), crowded(moves, BUSY_MOVES, MOVE_WINDOW)] as const;
  const [b, m] = busy;
  if (!b && !m)
    return {
      id: 'motion-busy',
      status: 'pass',
      message: `No more than ${BUSY_BEATS} beats start within a second, nor ${BUSY_MOVES} camera moves within ${MOVE_WINDOW} s.`,
    };
  const parts = [
    ...(b ? [`${b.count} beats start within 1 s in ${b.scene} (from ${seconds(b.at)})`] : []),
    ...(m
      ? [`${m.count} camera moves within ${MOVE_WINDOW} s in ${m.scene} (from ${seconds(m.at)})`]
      : []),
  ];
  return {
    id: 'motion-busy',
    status: 'warn',
    message: `The picture is too busy to follow: ${parts.join('; ')}. At most ${BUSY_BEATS} beats a second and ${BUSY_MOVES} camera moves in ${MOVE_WINDOW} s: give each beat its own phrase, or drop one.`,
  };
}

/** Reading time: a fixed glance, then characters at 15 a second, or 8 for CJK characters. */
export const READING = { glance: 0.4, latin: 15, cjk: 8 } as const;

/** How long `text` takes to read, in seconds: whitespace is free. */
export function readingSeconds(text: string): number {
  let latin = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\s/u.test(char)) continue;
    if (isCjk(char)) cjk++;
    else latin++;
  }
  return READING.glance + latin / READING.latin + cjk / READING.cjk;
}

/** The words a shot's element puts on screen for the viewer to read, if any. */
function wordsOf(e: DirectionElement): string | undefined {
  if (e.kind === 'label') return e.text;
  if (e.kind === 'node') return e.label;
  if (e.kind === 'packet') return e.label;
  if (e.kind === 'pile' || e.kind === 'metric') return e.name;
  return undefined;
}

/**
 * Every word a shot puts on screen stays long enough to read: from when it has entered (its
 * reveal, else the scene's entrance) until the next scene starts to enter, at least 0.4 s plus
 * its characters at 15 a second (8 for CJK). Code, output, and captures are read with the
 * narration, which `narration-pace` holds to its pace.
 */
export function readingTimeCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck {
  const short: string[] = [];
  let checked = 0;
  timeline.scenes.forEach((scene, i) => {
    const d = scene.direction;
    if (!d || scene.visual.kind === 'outro') return;
    const next = timeline.scenes[i + 1];
    const enter = i === 0 ? 0 : (scene.transition?.seconds ?? timeline.transition);
    const leave = next ? (next.transition?.seconds ?? timeline.transition) : 0;
    for (const e of d.elements) {
      const words = wordsOf(e)?.trim();
      if (!words) continue;
      checked++;
      const reveal = d.beats.find((b) => b.verb === 'reveal' && b.element === e.id);
      const from = Math.max(enter, reveal ? reveal.t + reveal.seconds : 0);
      const shown = Math.max(0, scene.end - scene.start - leave - from);
      const wanted = readingSeconds(words);
      if (shown < wanted - 1e-6)
        short.push(`"${words}" in ${scene.id} for ${seconds(shown)} (${seconds(wanted)} wanted)`);
    }
  });
  if (!short.length)
    return {
      id: 'reading-time',
      status: 'pass',
      message: checked
        ? 'Every word a shot shows stays on screen long enough to read.'
        : 'No shot shows words of its own.',
    };
  return {
    id: 'reading-time',
    status: 'warn',
    message: `Words leave the screen before they can be read: ${listed(short, '; ')}. Reveal them earlier, shorten them, or give the scene a longer line.`,
  };
}

/**
 * Every beat the direction asked for plays: the resolver leaves out a beat that phrases put out
 * of order (a merge before its split, a count-up after its count starts) and says why (R-023).
 */
export function droppedBeatsCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const dropped = storyScenes(timeline.scenes).flatMap((s) =>
    (s.direction?.dropped ?? []).map((b) => `${s.id}: ${b.reason}`),
  );
  if (!dropped.length)
    return { id: 'dropped-beats', status: 'pass', message: 'Every beat asked for plays.' };
  return {
    id: 'dropped-beats',
    status: 'warn',
    message: `Beats were left out: ${listed(dropped, '; ')}. Pin them to phrases in the order they should play.`,
  };
}

/** The choreography checks, in the order `qc.json` lists them. */
export function choreographyChecks(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck[] {
  return [
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    droppedBeatsCheck(timeline),
  ];
}
```

(B5's labels are allowlisted text and the metric and pile names are the run's own redacted words; they reach `qc.json` through `run.writeJson`, which redacts again.)

- [ ] **Step 6: `still` through the shared rule, and the checks in `runQc` (`packages/video/src/qc.ts`)**

1. Imports: add after `import { LANGUAGE_NAME } from '@covi/core';`:

   ```ts
   import {
     choreographyChecks,
     onlyCameraMoves,
     STILL_SECONDS,
     spokenStills,
   } from './choreography.ts';
   ```

2. Replace

   ```ts
   /** How long the picture may freeze under narration before the scene reads as a slide (s). */
   export const STILL_SECONDS = 1.5;
   ```

   with `export { STILL_SECONDS };` (one value, now in `choreography.ts`; `qc.ts` keeps exporting it).

3. Replace `stillCheck` with:

   ```ts
   /**
    * The picture keeps moving while the narration speaks: a freeze of the media region that covers
    * 1.5 s or more of the lines (summed over the lines it spans) is a still, named by its scene, and
    * said to be a stretch the plan moved only with the camera's slow push-in when it was.
    */
   export function stillCheck(
     timeline: Pick<Timeline, 'scenes' | 'transition'>,
     freezes: readonly Freeze[],
   ): QcCheck {
     const stills = spokenStills(timeline, freezes);
     if (!stills.length)
       return {
         id: 'still',
         status: 'pass',
         message: 'The picture keeps moving while the narration speaks.',
       };
     return {
       id: 'still',
       status: 'warn',
       message: `The picture holds still while the narration continues in ${stills
         .slice(0, 3)
         .map(
           (s) =>
             `${s.scene} (${s.seconds.toFixed(1)} s from ${s.at.toFixed(1)} s)${
               // The plan moved only the camera there, and too slowly to see.
               onlyCameraMoves(timeline, s) ? ", where only the camera's slow push-in moves" : ''
             }`,
         )
         .join(
           ', ',
         )}${stills.length > 3 ? ', …' : ''}. Split the scene, sync its visual to the line, pin a beat to a phrase there, or let the camera drift.`,
     };
   }
   ```

4. In `measureStill`, widen the timeline parameter to `Pick<Timeline, 'scenes' | 'transition' | 'width' | 'height' | 'orientation'>` (`runQc` passes the whole timeline).

5. In `runQc`, after B1's `...densityChecks(input.timeline, input.layouts),` add `...choreographyChecks(input.timeline),`.

- [ ] **Step 7: Exports (`packages/video/src/index.ts`)**

Add, in alphabetical position among the module exports (after the `./captions.ts` block):

```ts
export {
  BUSY_BEATS,
  BUSY_MOVES,
  choreographyChecks,
  droppedBeatsCheck,
  motionBusyCheck,
  motionGapCheck,
  READING,
  readingSeconds,
  readingTimeCheck,
  STILL_SECONDS,
} from './choreography.ts';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/choreography.test.ts packages/video/test/qc-grammar.test.ts packages/video/test/direction-flow.test.ts packages/video/test/density.test.ts`
Expected: PASS (the existing still tests unchanged: their freezes overlap other planned motion, or their timelines carry no `transition`, so no note is added).

Run: `npm run typecheck && npm run lint`
Expected: exit 0. (`qc.ts` imports values from `choreography.ts`, which imports only the `QcCheck` type back: no value cycle.)

Then run the whole suite in the background and wait: `npm test`. Expected: PASS. Every `qc.json` now lists the four checks after B1's density checks; no test pins the exact list of check ids except the full-pipeline render loop, which Task 6 extends.

- [ ] **Step 9: Commit**

```bash
npx biome check --write packages/video/src packages/video/test
npm run lint && npm run typecheck
git add packages/video/src/choreography.ts packages/video/src/qc.ts packages/video/src/index.ts packages/video/src/timeline/types.ts packages/video/src/direction/resolve.ts packages/video/test/choreography.test.ts packages/video/test/qc-grammar.test.ts packages/video/test/direction-flow.test.ts
git commit -m "$(cat <<'EOF'
Check motion gaps, busy moments, reading time, and dropped beats

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 3: The stage reports each shot as its stop lays it out — `overlap` and `out-of-frame`

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (`ShotReport`, `LayoutReport.shot`)
- Modify: `packages/video/src/runtime/canvas.ts` (`unview`, after `layerTransform`)
- Modify: `packages/video/src/runtime/direction/elements.ts` (`ShotComponent.placed`, and its implementation in `mountShot`)
- Modify: `packages/video/src/runtime/stage.ts` (imports; `report()`; `stopView` split into `localView`; `shotReport`)
- Modify: `packages/video/src/density.ts` (export B1's `settledReports`)
- Modify: `packages/video/src/choreography.ts` (`ChoreographyTimeline`, `OVERLAP_SHARE`, `overlapCheck`, `outOfFrameCheck`; `choreographyChecks` takes the layouts)
- Modify: `packages/video/src/qc.ts` (`runQc` passes the layouts)
- Modify: `packages/video/src/index.ts` (exports)
- Modify: `packages/video/test/canvas.test.ts` (B2's pure canvas tests: `unview`)
- Modify: `packages/video/test/choreography.test.ts` (Task 2's file)
- Modify: `tests/render/canvas.test.ts` (B2's `directed` helper gains `edit`; a new `describe`)

**Interfaces:**
- Consumes: B2's `View`, `layerTransform`, `viewAt`, `withPush`, `clampView`, `restView`, `toWorld` (`runtime/canvas.ts`); `MountedScene`, `moveAt`, `stopView`, `this.pivot` (`runtime/stage.ts`); `ShotComponent`, `mountShot`'s `drawn`/`now` (`runtime/direction/elements.ts`); `union` (`runtime/narrator.ts`); B1's `settledReports` (`density.ts`); `computeRegions` (`runtime/layout.ts`); Task 2's `choreographyChecks`; `settledFrame` (`timeline/cues.ts`, in tests).
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts
  export interface ShotReport { region: Rect; elements: Array<{ id: string; rect: Rect }> }
  // LayoutReport gains: shot?: ShotReport;
  // packages/video/src/runtime/canvas.ts
  export function unview(rect: Rect, view: View, pivot: Point): Rect;
  // packages/video/src/runtime/direction/elements.ts — ShotComponent gains:
  placed(): Array<{ id: string; rect: Rect }>;
  // packages/video/src/density.ts
  export function settledReports(timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps'>, layouts: readonly LayoutReport[]): Array<{ scene: TimelineScene; report: LayoutReport }>;
  // packages/video/src/choreography.ts
  export type ChoreographyTimeline = Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'width' | 'height' | 'orientation'>;
  export const OVERLAP_SHARE = 0.04;
  export function overlapCheck(timeline: ChoreographyTimeline, layouts: readonly LayoutReport[]): QcCheck;    // id 'overlap', warn
  export function outOfFrameCheck(timeline: ChoreographyTimeline, layouts: readonly LayoutReport[]): QcCheck; // id 'out-of-frame', fail
  export function choreographyChecks(timeline: ChoreographyTimeline, layouts: readonly LayoutReport[]): QcCheck[];
  ```

What is measured, and why there: both checks read only frames where a story scene has settled (B1's `settledReports`), and only shots that lay out elements (a storyboard visual alone is drawn exactly as without direction, and B1's and 0.2.0's checks cover it). Each element's box is the union of everything it reports, mapped back to where its stop lays it out: the camera's beats and the push-in are undone (`unview`), because a camera that zooms toward one element crops the others by design, and B2's default code zoom deliberately shows the start of lines wider than the view. Holding those crops against the frame would fail sound videos; `out-of-frame` is a `fail` (R-007), so it must only see broken layout: an element drawn past the region the scene owns, which the viewport cuts off whatever the camera does. On the scratch copy no example's default render reported an overlap or an element out of frame.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/canvas.test.ts`, add `unview,` to the `../src/runtime/canvas.ts` import and append:

```ts
describe('undoing the camera', () => {
  it('puts a box drawn through a view back where its stop lays it out', () => {
    const view = { x: pivot.x + 120, y: pivot.y - 40, scale: 1.6 };
    const laid = { x: 300, y: 260, width: 200, height: 90 };
    // What layerTransform draws: stop point p at pivot + scale · (p − view).
    const drawn = {
      x: pivot.x + view.scale * (laid.x - view.x),
      y: pivot.y + view.scale * (laid.y - view.y),
      width: laid.width * view.scale,
      height: laid.height * view.scale,
    };
    const back = unview(drawn, view, pivot);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(laid[k], 9);
    expect(unview(laid, restView(pivot), pivot)).toEqual(laid);
  });
});
```

(`pivot` and `restView` are already in B2's file; if `pivot` is not a top-level constant there, define `const pivot = { x: media.x + media.width / 2, y: media.y + media.height / 2 };` from the file's `media`.)

In `packages/video/test/choreography.test.ts` (Task 2's file):

1. Add `outOfFrameCheck,` and `overlapCheck,` to the `../src/choreography.ts` import, add `import { computeRegions } from '../src/runtime/layout.ts';` and `import { settledFrame } from '../src/timeline/cues.ts';`, and add `LayoutReport,` to the type import.
2. Replace the whole `describe('the choreography checks', …)` block with:

```ts
describe('shots on the frame', () => {
  const media = computeRegions({ width: 1920, height: 1080, orientation: 'landscape' }).media;
  const t = timeline([scene('s1', 0, 6, { direction: shot([label('a', 'A'), label('b', 'B')]) })]);
  const at = (elements: Array<{ id: string; rect: typeof rect }>, frame = settledFrame(t, 0)!) =>
    [
      { frame, scene: 's1', items: [], imagesLoaded: true, shot: { region: media, elements } },
    ] as LayoutReport[];
  const box = (x: number, y: number, width = 400, height = 300) => ({ x, y, width, height });

  it('warn on elements that collide, but not on one set inside another', () => {
    const a = box(media.x, media.y);
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'b', rect: box(media.x + 350, media.y) },
        ]),
      ).message,
    ).toContain('"a" and "b" in s1 (13%)');
    // 3% of the smaller: close, not colliding.
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'b', rect: box(media.x + 388, media.y) },
        ]),
      ).status,
    ).toBe('pass');
    // A packet on its node lies wholly inside it, by design.
    expect(
      overlapCheck(
        t,
        at([
          { id: 'a', rect: a },
          { id: 'p', rect: box(media.x + 50, media.y + 50, 100, 60) },
        ]),
      ).status,
    ).toBe('pass');
  });

  it('fail an element drawn past the frame, within a few pixels of tolerance', () => {
    const past = outOfFrameCheck(
      t,
      at([{ id: 'a', rect: box(media.x + media.width - 380, media.y) }]),
    );
    expect(past).toMatchObject({ id: 'out-of-frame', status: 'fail' });
    expect(past.message).toContain('"a" in s1');
    const edge = box(media.x + media.width - 403, media.y);
    expect(outOfFrameCheck(t, at([{ id: 'a', rect: edge }])).status).toBe('pass');
  });

  it('read only frames where the scene has settled, and say when nothing was measured', () => {
    const early = at([{ id: 'a', rect: box(media.x + media.width - 100, media.y) }], 1);
    expect(outOfFrameCheck(t, early).message).toBe('No shot was measured at a settled frame.');
    // A frames.json written before shots were reported: nothing to hold, nothing failed.
    const old = at([]).map(({ shot: _, ...report }) => report);
    expect(outOfFrameCheck(t, old)).toMatchObject({ status: 'pass' });
    expect(overlapCheck(t, old)).toMatchObject({ status: 'pass' });
  });

  it('come in one order, out-of-frame the only one that fails', () => {
    const checks = choreographyChecks(t, at([{ id: 'a', rect: box(media.x - 50, media.y) }]));
    expect(checks.map((c) => c.id)).toEqual([
      'motion-gap',
      'motion-busy',
      'reading-time',
      'overlap',
      'out-of-frame',
      'dropped-beats',
    ]);
    expect(checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['out-of-frame']);
  });
});
```

In `tests/render/canvas.test.ts` (B2's file):

1. Add `outOfFrameCheck,` and `type Timeline,` to the `@covi/video` import, and `import { settledFrame } from '../../packages/video/src/timeline/cues.ts';` after the `runtime/layout.ts` import (both files are DOM-free).
2. In `directed(…)`, widen `options` to `{ off?: boolean; sources?: SourcesInput; edit?: (timeline: Timeline) => void }`, and call `options.edit?.(timeline);` right before `const composition = join(dir, 'composition');`.
3. Append:

```ts
describe.skipIf(!available)('a shot reported to QC', () => {
  it('reports each element where its stop lays it out, whatever the camera does', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'camera', move: 'zoom', to: 'note', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats.find((b) => b.verb === 'camera')!;
    const zoomed = v.frameAt('s3', beat.t + beat.seconds + 0.1);
    expect(camera(v.of(await v.state(zoomed), 's3').transform).scale).toBeGreaterThan(1.5);
    const before = (await v.report(v.frameAt('s3', beat.t - 0.05))).shot!;
    const after = (await v.report(zoomed)).shot!;
    expect(after.region).toEqual(regions.media);
    expect(after.elements.map((e) => e.id)).toEqual(['req', 'note', 'out']);
    for (const [i, e] of after.elements.entries()) {
      // The zoom and the push-in are undone: the same box before and after the camera moved.
      const was = before.elements[i]!.rect;
      for (const k of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(e.rect[k] - was[k]), `${e.id} ${k}`).toBeLessThan(0.5);
      // Inside its own slot.
      const slot = s3.direction!.elements.find((x) => x.id === e.id)!.rect;
      expect(e.rect.x, e.id).toBeGreaterThanOrEqual(slot.x - 0.5);
      expect(e.rect.x + e.rect.width, e.id).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
    }
    // A storyboard visual shown alone is drawn as without direction: no shot to report.
    expect((await v.report(v.frameAt('s2', 1.5))).shot).toBeUndefined();
  });

  it('fails a label pushed past the frame, and passes it where the layout put it', async () => {
    const single: DirectionInput['shots'] = [
      { scene: 's3', elements: [{ id: 'note', kind: 'label', text: 'Much smaller' }] },
    ];
    const check = async (v: Awaited<ReturnType<typeof directed>>) => {
      const index = v.timeline.scenes.findIndex((s) => s.id === 's3');
      return outOfFrameCheck(v.timeline, [await v.report(settledFrame(v.timeline, index)!)]);
    };
    expect((await check(await directed(story, single))).status).toBe('pass');
    const pushed = await directed(story, single, {
      edit: (timeline) => {
        const note = timeline.scenes.find((s) => s.id === 's3')!.direction!.elements[0]!;
        note.rect = { ...note.rect, x: note.rect.x + 0.6 * note.rect.width };
      },
    });
    const failed = await check(pushed);
    expect(failed.status).toBe('fail');
    expect(failed.message).toContain('"note" in s3');
  });
});
```

(`story`, `run`, `elements`, `camera`, and `regions` are B2's; `s2` is a callout the default director shows alone, `s3` the code scene. If B2 merged them with other names, use the merged ones.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/canvas.test.ts packages/video/test/choreography.test.ts tests/render/canvas.test.ts`
Expected: FAIL — `unview`, `overlapCheck`, and `outOfFrameCheck` do not exist; the layout report has no `shot`.

- [ ] **Step 3: The report's type (`packages/video/src/timeline/types.ts`)**

Insert before `export interface LayoutReport {`:

```ts
/**
 * A directed scene's elements as its stop lays them out, the camera aside: each element's box
 * around all it draws, and the region the scene owns, in stage pixels (where they are on screen
 * when the camera is at rest).
 */
export interface ShotReport {
  region: Rect;
  elements: Array<{ id: string; rect: Rect }>;
}
```

and add to `LayoutReport`, after `imagesLoaded: boolean;`:

```ts
  /** A directed scene's elements and region, reported when no camera move between stops is under way. */
  shot?: ShotReport;
```

- [ ] **Step 4: Undo the camera (`packages/video/src/runtime/canvas.ts`)**

Insert after `layerTransform`:

```ts
/**
 * A box drawn on screen through a stop-local `view`, back where the stop lays it out: what it
 * covers when the camera is at rest (see `layerTransform`, which draws stop point p at
 * pivot + scale · (p − view)).
 */
export function unview(rect: Rect, view: View, pivot: Point): Rect {
  return {
    x: view.x + (rect.x - pivot.x) / view.scale,
    y: view.y + (rect.y - pivot.y) / view.scale,
    width: rect.width / view.scale,
    height: rect.height / view.scale,
  };
}
```

- [ ] **Step 5: A shot lists its elements' boxes (`packages/video/src/runtime/direction/elements.ts`)**

Add to `ShotComponent`, after `track(…)`:

```ts
  /** Every element on screen and the box around all it draws, as last drawn (QC's shot report). */
  placed(): Array<{ id: string; rect: Rect }>;
```

and to the object `mountShot` returns, after `track(id, t) { … },`:

```ts
    placed: () =>
      drawn
        .filter((d) => !d.reveal || now >= d.reveal.t)
        .flatMap((d) => {
          const boxes = d.component
            .report()
            .filter((item) => item.role !== 'focus')
            .map((item) => item.rect);
          return boxes.length ? [{ id: d.element.id, rect: union(boxes) }] : [];
        }),
```

(`union` is already imported from `../narrator.ts` for `frame`.)

- [ ] **Step 6: The stage reports the shot (`packages/video/src/runtime/stage.ts`)**

1. Add `type ShotReport,` to the `../timeline/types.ts` import and `unview,` to the `./canvas.ts` import.
2. Split B2's `stopView` so the stop-local view can be read on its own; replace it with:

   ```ts
     /** Where the camera looks in a scene's own stop at `time` (world coordinates): beats, then push. */
     private stopView(m: MountedScene, time: number): View {
       return toWorld(this.localView(m, time), m.scene.stop!);
     }

     /** The same view in the stop's own coordinates. */
     private localView(m: MountedScene, time: number): View {
       const local = Math.max(0, time - m.scene.start);
       const push = m.camera && !m.component.camera ? cameraPush(local, m.camera) : 0;
       const view = viewAt(m.steps, local, restView(this.pivot));
       return clampView(withPush(view, push), m.region, this.pivot);
     }
   ```

   (If B3–B5 changed `stopView`'s body, move the merged body into `localView` without its final `toWorld`.)
3. In `report()`, add `shot: active ? this.shotReport(active, time) : undefined,` after `imagesLoaded: this.imagesOk,`.
4. Add after `report()`:

   ```ts
     /**
      * A shot's elements as its stop lays them out, the camera undone, and the region it owns: what
      * QC holds to the frame and to one another. Only between camera moves, and only for shots that
      * lay out elements (a storyboard visual alone is drawn as without direction).
      */
     private shotReport(m: MountedScene, time: number): ShotReport | undefined {
       if (!m.shot || !m.scene.stop || this.moveAt(m.index, time)) return undefined;
       const view = this.localView(m, time);
       return {
         region: m.region,
         elements: m.shot.placed().map((e) => ({ id: e.id, rect: unview(e.rect, view, this.pivot) })),
       };
     }
   ```

The boxes come from `getBoundingClientRect` and so include the layer's camera transform; `unview` with the same view the frame was drawn with puts them back in the stop. Reveal transforms are finished at a settled frame, which is the only place QC reads them.

- [ ] **Step 7: `overlap` and `out-of-frame` (`packages/video/src/density.ts`, `choreography.ts`, `qc.ts`, `index.ts`)**

In `packages/video/src/density.ts`, export B1's `settledReports` (change `function settledReports(` to `export function settledReports(`; nothing else).

In `packages/video/src/choreography.ts`:

1. Add imports: `import { settledReports } from './density.ts';` (first line) and `import { computeRegions } from './runtime/layout.ts';` (after the `./qc.ts` import); add `type LayoutReport,` and `type Rect,` to the `./timeline/types.ts` import.
2. Insert before `/** The choreography checks, in the order \`qc.json\` lists them. */`:

```ts
const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);

function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** `inner` lies inside `outer`, give or take `tolerance` pixels on every side. */
function inside(inner: Rect, outer: Rect, tolerance: number): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** Two elements overlapping by more than this share of the smaller collide. */
export const OVERLAP_SHARE = 0.04;
/** Boxes within this many design units of each other's edges are not told apart. */
const EDGE_UNITS = 4;

/** What the choreography checks read of a timeline. */
export type ChoreographyTimeline = Pick<
  Timeline,
  'scenes' | 'transition' | 'fps' | 'width' | 'height' | 'orientation'
>;

/**
 * A shot's elements keep clear of one another where it has settled: no two of them overlap by
 * more than 4% of the smaller, unless one lies wholly inside the other, which the layout does on
 * purpose (a packet on its node, a label set on a capture).
 */
export function overlapCheck(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const tolerance = EDGE_UNITS * computeRegions(timeline).unit;
  const hits = new Map<string, string>();
  let measured = 0;
  for (const { scene, report } of settledReports(timeline, layouts)) {
    const elements = report.shot?.elements ?? [];
    if (elements.length > 1) measured++;
    for (const [i, a] of elements.entries())
      for (const b of elements.slice(i + 1)) {
        if (inside(a.rect, b.rect, tolerance) || inside(b.rect, a.rect, tolerance)) continue;
        const share =
          intersection(a.rect, b.rect) / Math.max(1, Math.min(area(a.rect), area(b.rect)));
        if (share > OVERLAP_SHARE + 1e-9)
          hits.set(
            `${scene.id} ${a.id} ${b.id}`,
            `"${a.id}" and "${b.id}" in ${scene.id} (${Math.round(100 * share)}%)`,
          );
      }
  }
  if (!hits.size)
    return {
      id: 'overlap',
      status: 'pass',
      message: measured
        ? `No two elements of a shot overlap by more than ${Math.round(100 * OVERLAP_SHARE)}% of the smaller.`
        : 'No shot with several elements was measured at a settled frame.',
    };
  return {
    id: 'overlap',
    status: 'warn',
    message: `Elements collide: ${listed([...hits.values()])}. Choose another \`layout\` for the shot, or fewer elements.`,
  };
}

/**
 * Every element of a shot is drawn inside the scene's region where it has settled, as the stop
 * lays it out (the camera's moves are its framing and are not held against it). An element
 * drawn past the region is cut off by the frame: broken output, so this fails.
 */
export function outOfFrameCheck(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const tolerance = EDGE_UNITS * computeRegions(timeline).unit;
  const out = new Map<string, string>();
  let measured = 0;
  for (const { scene, report } of settledReports(timeline, layouts)) {
    const shot = report.shot;
    if (!shot) continue;
    measured++;
    for (const e of shot.elements)
      if (!inside(e.rect, shot.region, tolerance))
        out.set(`${scene.id} ${e.id}`, `"${e.id}" in ${scene.id}`);
  }
  if (!out.size)
    return {
      id: 'out-of-frame',
      status: 'pass',
      message: measured
        ? 'Every element of a shot is drawn inside its frame.'
        : 'No shot was measured at a settled frame.',
    };
  return {
    id: 'out-of-frame',
    status: 'fail',
    message: `Elements are cut off by the frame: ${listed([...out.values()])}. Show fewer lines or elements in the shot, or split it.`,
  };
}
```

3. Replace `choreographyChecks` with:

```ts
/** The choreography checks, in the order `qc.json` lists them. */
export function choreographyChecks(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck[] {
  return [
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    overlapCheck(timeline, layouts),
    outOfFrameCheck(timeline, layouts),
    droppedBeatsCheck(timeline),
  ];
}
```

In `packages/video/src/qc.ts`, `runQc`: `...choreographyChecks(input.timeline),` becomes `...choreographyChecks(input.timeline, input.layouts),`.

In `packages/video/src/index.ts`, add `type ChoreographyTimeline,`, `OVERLAP_SHARE,`, `outOfFrameCheck,`, and `overlapCheck,` to the `./choreography.ts` export block (alphabetical), and `settledReports,` to B1's `./density.ts` export block.

(Value imports run `qc.ts` → `choreography.ts` → `density.ts`; `density.ts` and `choreography.ts` import only the `QcCheck` type from `qc.ts`.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/canvas.test.ts packages/video/test/choreography.test.ts tests/render/canvas.test.ts tests/render/flow.test.ts tests/render/morph.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run lint`, then (in the background, and wait) `npm test`.
Expected: exit 0 and PASS. The runtime bundle changed, so every composition's frames key changes once; no test pins a key across versions.

- [ ] **Step 9: Commit**

```bash
npx biome check --write packages/video/src packages/video/test tests/render/canvas.test.ts
npm run lint && npm run typecheck
git add packages/video/src/timeline/types.ts packages/video/src/runtime/canvas.ts packages/video/src/runtime/direction/elements.ts packages/video/src/runtime/stage.ts packages/video/src/density.ts packages/video/src/choreography.ts packages/video/src/qc.ts packages/video/src/index.ts packages/video/test/canvas.test.ts packages/video/test/choreography.test.ts tests/render/canvas.test.ts
git commit -m "$(cat <<'EOF'
Report each shot as its stop lays it out, and check overlap and out-of-frame

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 4: What a viewer sees — the poster at the change's best, and an opening that holds a mostly empty frame

**Files:**
- Modify: `packages/video/src/timeline/motion.ts` (`ACCENT_OUT`, `COUNTED`, `posterTime`)
- Modify: `packages/video/src/runtime/camera.ts` (`heroAccent` reads `ACCENT_OUT`; its private `RING` goes)
- Modify: `packages/video/src/timeline/cues.ts` (`openingSpan`, before `settledFrame`)
- Modify: `packages/video/src/render/renderer.ts` (imports; B1's `layoutSampleFrames`; `OPENING_STEP`, `OPENING_SAMPLES`, `posterFrame`; `RenderOptions.posterFrame`'s doc; `renderComposition`)
- Modify: `packages/video/src/runtime/dom.ts` (`drawnBox`)
- Modify: `packages/video/src/timeline/types.ts` (`LayoutReport.content`)
- Modify: `packages/video/src/runtime/stage.ts` (`report()`)
- Modify: `packages/video/src/density.ts` (export B1's `CARDS`)
- Modify: `packages/video/src/choreography.ts` (`emptyOpeningCheck` in `choreographyChecks`)
- Modify: `packages/video/src/index.ts` (exports)
- Create: `packages/video/test/poster.test.ts`
- Modify: `packages/video/test/choreography.test.ts` (Tasks 2–3's file)
- Modify: `tests/render/canvas.test.ts` (Task 3's additions to B2's file)

**Interfaces:**
- Consumes: `settledSpan`, `settledFrame`, `Span` (B1, `timeline/cues.ts`); `HERO_PHASE`, `Timeline`, `LayoutReport`, `Rect` (`timeline/types.ts`); `PUNCH_OUT` (Task 1); B1's `layoutSampleFrames`, `EMPTY_SHARE`, `CARDS`, `leadKind` (B2–B5 widened it); Task 2's `Stretch`, `spokenStills`, and the private `seconds`, `listed`, `area`; Task 3's `ChoreographyTimeline`, `choreographyChecks`, `clipAt`/`region` in `report()`.
- Produces:
  ```ts
  // packages/video/src/timeline/motion.ts (DOM-free)
  export const ACCENT_OUT = 0.7; // the hero's ring has faded this long after its phase
  export const COUNTED = 0.3;    // a counter's change in percent has come in this long after it lands
  export function posterTime(timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'duration'>): number; // seconds (R-029)
  // packages/video/src/timeline/cues.ts
  export function openingSpan(timeline: Pick<Timeline, 'scenes' | 'transition'>, index: number): Span | undefined;
  // packages/video/src/render/renderer.ts
  export function posterFrame(timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'frames' | 'duration'>): number; // posterTime on the nearest frame
  // layoutSampleFrames also samples each story scene's opening (every 0.5 s, at most 8 frames)
  // packages/video/src/runtime/dom.ts
  export function drawnBox(root: HTMLElement, clip: Rect): Rect | undefined;
  // packages/video/src/timeline/types.ts — LayoutReport gains:
  content?: Rect;
  // packages/video/src/density.ts
  export const CARDS: ReadonlySet<TimelineScene['visual']['kind']>; // B1's, now exported
  // packages/video/src/choreography.ts
  export function emptyOpeningCheck(timeline: ChoreographyTimeline, layouts: readonly LayoutReport[]): QcCheck; // id 'empty-opening', warn
  // choreographyChecks: motion-gap, motion-busy, reading-time, empty-opening, overlap, out-of-frame, dropped-beats
  ```

Why: the benchmark's B1 render took its poster at the fixed 1.6 s, which on that video is the first scene's opening with only the Before terminal window up, about 30% of the media region; the owner's acceptance opens `video/poster.png` and judges it as a viewer. R-029 (the program lead's ruling, after R-026) sets the choice, a pure function of the timeline (`posterTime`, in DOM-free `timeline/motion.ts`), so one composition always gives one poster and a sound-only render that keeps the frames keeps it: (1) where the key number's count lands (the `count` whose metric changes the most, the earliest on a tie), 0.3 s on so its change in percent (which B4 fades in over 0.25 s) shows, passing over a count that lands while the next scene is entering; else (2) the hero scene once its accent has played (its phase plus 0.7 s) and the scene has settled, held inside the scene before its exit transition; else (3) the old 1.6 s rule. The number landing is the clearest single frame of a change: B4 draws it as the largest thing on screen with its change beside it, and it reads at thumbnail size where code and captures do not. Every candidate is a settled moment, so a morph mid-way is never the poster (B3's concern). On the scratch copy the benchmark's poster became the byte counter landed on 9,907 with −86% beside the reader steps' 28 and 10 (10.7 s in, after `s1`'s opening ends at 10.4 s), instead of the opening; `bugfix-cli-slugify`'s the fixed `slugify` after its morph; `ui-comment-composer`'s the composer with "280 characters left".

The opening problem is not caught by B1's `empty-frame`, which reads only settled frames: the stretch from a scene's entrance until it settles can hold a mostly empty frame for seconds of narration. `empty-opening` samples each card's and shot's opening every half second and measures what the scene visibly draws (`drawnBox`): components report the boxes of parts not yet shown (a terminal's After window is laid out from the start at opacity 0), so the layout items cannot answer how full the frame looks. On the scratch copy, the benchmark rendered with `--direction off` (B1's look) warned `empty-opening … s1 (20% of the media region for 6.2 s from 0.0 s)`; with the default director it passes, and of the five examples only `bugfix-cli-slugify` (a vertical before/after terminal) warns.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/poster.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutSampleFrames, posterFrame } from '../src/render/renderer.ts';
import { openingSpan, settledSpan } from '../src/timeline/cues.ts';
import { posterTime } from '../src/timeline/motion.ts';
import type {
  DirectionBeat,
  DirectionElement,
  Timeline,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const metric = (id: string, from: number, to: number): DirectionElement => ({
  id,
  kind: 'metric',
  rect,
  show: 'counter',
  name: id,
  from,
  to,
  decimals: 0,
});
const count = (element: string, t: number): DirectionBeat => ({
  verb: 'count',
  element,
  t,
  seconds: 1.6,
});
const counted = (element: DirectionElement, beat: DirectionBeat) => ({
  whole: false,
  elements: [element],
  beats: [beat],
});
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...(start > 0 ? { transition: { kind: 'fade', seconds: 0.45 } } : {}),
    ...extra,
  }) as TimelineScene;
const timeline = (scenes: TimelineScene[]) => {
  const duration = scenes.at(-1)!.end;
  return {
    scenes,
    transition: 0.45,
    fps: 30,
    frames: Math.round(duration * 30),
    duration,
  } as Timeline;
};

describe('the poster (R-029)', () => {
  const after = (t: number) => Math.round(t * 30);

  it('shows the key number where its count lands, its change in beside it, before the hero', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('bytes', 70406, 9907), count('bytes', 4)) }),
      scene('s2', 7.55, 12, { hero: true, phases: { hero: 1 } }),
    ]);
    expect(posterTime(t)).toBeCloseTo(4 + 1.6 + 0.3, 9);
    expect(posterFrame(t)).toBe(after(5.9));
  });

  it('picks the count that changes its metric the most', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 100, 90), count('a', 1)) }),
      scene('s2', 7.55, 14, { direction: counted(metric('b', 28, 10), count('b', 2)) }),
    ]);
    expect(posterTime(t)).toBeCloseTo(7.55 + 2 + 1.6 + 0.3, 9);
  });

  it('holds the moment before the next scene starts to enter', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 10, 1), count('a', 5.8)) }),
      scene('s2', 7.55, 12),
    ]);
    // The count lands at 7.4 s; s2 starts to enter at 7.55 s.
    expect(posterFrame(t)).toBe(Math.floor(7.55 * 30 - 1e-6));
  });

  it('passes over a count that lands while the next scene enters, for the hero after its accent', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 10, 1), count('a', 6.2)) }),
      scene('s2', 7.55, 12, { hero: true, phases: { hero: 1 } }),
    ]);
    // s2's callout has settled 0.6 s in; its accent has played 1.7 s in.
    expect(posterTime(t)).toBeCloseTo(7.55 + 1 + 0.7, 9);
  });

  it('waits for a hero still moving, and holds it inside its scene before the next one enters', () => {
    const moving = timeline([
      scene('s1', 0, 8, {
        hero: true,
        phases: { hero: 0.5 },
        direction: {
          whole: false,
          elements: [{ id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' }],
          beats: [{ verb: 'reveal', element: 'l', style: 'rise', t: 3.5, seconds: 0.5 }],
        },
      }),
      scene('s2', 7.55, 12),
    ]);
    // Its label rises in by 4 s, after the accent (1.2 s): the poster waits for the scene to settle.
    expect(posterTime(moving)).toBeCloseTo(4, 9);
    const late = timeline([
      scene('s1', 0, 8, { hero: true, phases: { hero: 7.2 } }),
      scene('s2', 7.55, 12),
    ]);
    // The accent would end at 7.9 s, after s2 starts to enter at 7.55 s.
    expect(posterFrame(late)).toBe(Math.floor(7.55 * 30 - 1e-6));
  });

  it('falls back to 1.6 s in, or a third of a very short video', () => {
    expect(posterFrame(timeline([scene('s1', 0, 8)]))).toBe(48);
    expect(posterFrame(timeline([scene('s1', 0, 3)]))).toBe(30);
  });
});

describe('an opening’s samples', () => {
  const terminal = {
    kind: 'terminal',
    command: 'node scripts/measure.js',
    before: 'request bytes: 70406',
    output: 'request bytes: 9907',
  } as const;

  it('cover a scene from its entrance until it settles, every half second', () => {
    const t = timeline([scene('s1', 0, 5, { visual: terminal }), scene('s2', 4.55, 9)]);
    const [from, to] = openingSpan(t, 0)!;
    expect(from).toBe(0);
    expect(to).toBeCloseTo(settledSpan(t, 0)![0], 9);
    expect(to - from).toBeLessThanOrEqual(4);
    const frames = layoutSampleFrames(t);
    for (let at = from; at < to - 1e-6; at += 0.5) expect(frames).toContain(Math.round(at * 30));
  });

  it('spread eight samples over a long opening, and take none of a scene settled as it enters', () => {
    const long = timeline([scene('s1', 0, 30, { visual: terminal })]);
    const [from, to] = openingSpan(long, 0)!;
    const step = (to - from) / 8;
    expect(step).toBeGreaterThan(0.5);
    // The scene's own samples at 35% and 70% of the way through stay as they were.
    const timed = new Set([0.35, 0.7].map((k) => Math.round(k * 30 * 30)));
    const inside = layoutSampleFrames(long).filter(
      (f) => f / 30 >= from && f / 30 < to - 1e-6 && !timed.has(f),
    );
    expect(inside).toEqual(Array.from({ length: 8 }, (_, k) => Math.round((from + k * step) * 30)));
    // A callout has risen in 0.6 s, before a 0.9 s zoom has brought it in.
    const quick = timeline([
      scene('s1', 0, 4),
      scene('s2', 3.55, 8, { transition: { kind: 'zoom', seconds: 0.9 } }),
    ]);
    expect(openingSpan(quick, 1)).toBeUndefined();
  });
});
```

(B4's `metric` element may carry more fields, such as `unit` or `delta`; add the merged required ones to `metric(…)`.)

In `packages/video/test/choreography.test.ts`, add `emptyOpeningCheck,` to the `../src/choreography.ts` import; in the test "come in one order, out-of-frame the only one that fails", insert `'empty-opening',` after `'reading-time',` in the expected ids; and append:

```ts
describe('empty openings', () => {
  const media = computeRegions({ width: 1920, height: 1080, orientation: 'landscape' }).media;
  // A terminal whose after window comes in late: its opening lasts until it has settled.
  const terminal = {
    kind: 'terminal',
    command: 'node scripts/measure.js',
    before: 'request bytes: 70406',
    output: 'request bytes: 9907',
  } as const;
  const t = timeline([scene('s1', 0, 8, { visual: terminal }), outro(8)]);
  const at = (t0: number, share: number) =>
    ({
      frame: Math.round(t0 * 30),
      scene: 's1',
      items: [],
      imagesLoaded: true,
      content: { ...media, width: media.width * share },
    }) as LayoutReport;

  it('warn while a card shows little of itself under narration as it comes in', () => {
    // Half the window, a third of the region, from 0.5 s to 3 s; then the after window.
    const layouts = [0.5, 1, 1.5, 2, 2.5].map((t0) => at(t0, 0.3)).concat(at(3, 0.95));
    const check = emptyOpeningCheck(t, layouts);
    expect(check.status).toBe('warn');
    expect(check.message).toContain('s1 (30% of the media region for 2.5 s from 0.5 s)');
    // Filled from the start: nothing to say.
    expect(
      emptyOpeningCheck(
        t,
        layouts.map((r) => ({ ...r, content: media })),
      ).status,
    ).toBe('pass');
  });

  it('read only openings, only cards and shots, and pass reports without a drawn box', () => {
    // A capture keeps its own aspect ratio, as empty-frame leaves it.
    const capture = timeline([
      scene('s1', 0, 8, {
        visual: {
          kind: 'screenshot',
          image: { src: 'a.png', width: 1, height: 1 },
          device: 'desktop',
        },
      }),
    ]);
    const layouts = [0.5, 1, 1.5, 2].map((t0) => at(t0, 0.2));
    expect(emptyOpeningCheck(capture, layouts).status).toBe('pass');
    const old = layouts.map(({ content: _, ...r }) => r);
    expect(emptyOpeningCheck(t, old).message).toBe('No scene was measured while it came in.');
  });
});
```

In `tests/render/canvas.test.ts`, append:

```ts
describe.skipIf(!available)('what a scene visibly draws', () => {
  it('leaves out an element still to come, and counts it once it is in', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'reveal', element: 'out', style: 'rise', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const s3 = v.scene('s3');
    const reveal = s3.direction!.beats.find((b) => b.verb === 'reveal')!;
    const slot = s3.direction!.elements.find((e) => e.id === 'out')!.rect;
    const right = (r: { x: number; width: number }) => r.x + r.width;
    const before = (await v.report(v.frameAt('s3', reveal.t - 0.1))).content!;
    const after = (await v.report(v.frameAt('s3', reveal.t + reveal.seconds + 0.1))).content!;
    // Its slot is laid out from the start, but nothing of it is drawn before its reveal.
    expect(right(before)).toBeLessThan(slot.x);
    expect(right(after)).toBeGreaterThan(slot.x + slot.width / 2);
    for (const box of [before, after]) {
      expect(box.x).toBeGreaterThanOrEqual(regions.media.x - 0.5);
      expect(right(box)).toBeLessThanOrEqual(right(regions.media) + 0.5);
    }
  });
});
```

(`out` is the last of B2's three row elements, so before its reveal the drawn box ends left of its slot. The first version of `drawnBox` on the scratch copy counted the whole-stage `<svg>` of B5's flow layer and failed this test; `<svg>` is therefore a container, and only its shapes count.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/poster.test.ts packages/video/test/choreography.test.ts tests/render/canvas.test.ts`
Expected: FAIL — `posterTime`, `posterFrame`, `openingSpan`, and `emptyOpeningCheck` do not exist; the layout report has no `content`.

- [ ] **Step 3: The accent's length, shared, and the poster's moment (`timeline/motion.ts`, `runtime/camera.ts`)**

In `timeline/motion.ts`, replace

```ts
/** The hero's punch is over this long after its phase. */
export const PUNCH_OUT = 0.6;
```

with:

```ts
/** The hero's punch is over this long after its phase… */
export const PUNCH_OUT = 0.6;
/** …and its ring this long: the hero has had its accent. */
export const ACCENT_OUT = 0.7;
```

In `runtime/camera.ts`, import it (`import { ACCENT_OUT, type CameraPlan, PUNCH_OUT } from '../timeline/motion.ts';`), delete `const RING = 0.7;`, and in `heroAccent` replace both uses of `RING` with `ACCENT_OUT`. (B2's "flashes for under 0.2 s and rings once" test pins the same 0.7 s.)

In `timeline/motion.ts`, add `settledSpan` to the `./cues.ts` import (`import { type Span, settledAt, settledSpan, shotMotion, shotSettledAt } from './cues.ts';`) and append:

```ts
/** The poster shows a counter this long after its count lands, its change in percent come in. */
export const COUNTED = 0.3;

/**
 * When the poster is taken, in seconds (R-029): where the key number's count lands (the count that
 * changes its metric the most, the earliest on a tie), 0.3 s on so its change in percent shows;
 * else the hero scene once its accent has played and the scene has settled; else 1.6 s in, or a
 * third of the way for very short videos. Every moment is held inside its scene, before the next
 * one starts to enter; a count that lands during that entrance is passed over.
 */
export function posterTime(
  timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'duration'>,
): number {
  const half = 0.5 / timeline.fps;
  let key: { t: number; change: number } | undefined;
  timeline.scenes.forEach((s, i) => {
    const end = settledSpan(timeline, i)?.[1];
    if (end === undefined) return;
    for (const b of s.direction?.beats ?? []) {
      if (b.verb !== 'count') continue;
      const e = s.direction!.elements.find((x) => x.id === b.element);
      if (e?.kind !== 'metric' || e.from === undefined) continue;
      const lands = s.start + b.t + b.seconds;
      if (lands > end + 1e-6) continue;
      const change = Math.abs(e.to - e.from) / Math.max(Math.abs(e.from), 1e-9);
      if (!key || change > key.change + 1e-9)
        key = { t: Math.min(lands + COUNTED, end - half), change };
    }
  });
  if (key) return key.t;
  const index = timeline.scenes.findIndex((s) => s.hero && s.phases?.[HERO_PHASE] !== undefined);
  const hero = timeline.scenes[index];
  const span = settledSpan(timeline, index);
  if (hero && span) {
    const accent = hero.start + hero.phases![HERO_PHASE]! + ACCENT_OUT;
    return Math.max(hero.start, Math.min(Math.max(accent, span[0]), span[1] - half));
  }
  return Math.min(1.6, timeline.duration / 3);
}
```

(Half a frame before the next scene's entrance keeps the rounded frame inside the scene. The key number is the `count` whose metric changes most from `from` to `to`, as B4 counts it; a count-up shows one side, not the change, so it is not a candidate. If B4 merged the metric element without `from` on counted metrics, read its merged field.)

- [ ] **Step 4: Openings, and the poster's frame (`timeline/cues.ts`, `render/renderer.ts`)**

In `timeline/cues.ts`, insert before `settledFrame`'s doc comment:

```ts
/**
 * When scene `index` is on screen but still coming in, in seconds from the start of the video:
 * from the end of its entrance to where it has settled (see `settledSpan`). Absent when it has
 * settled by the time its entrance ends.
 */
export function openingSpan(
  timeline: Pick<Timeline, 'scenes' | 'transition'>,
  index: number,
): Span | undefined {
  const scene = timeline.scenes[index];
  const settled = settledSpan(timeline, index);
  if (!scene || !settled) return undefined;
  const from = scene.start + (index === 0 ? 0 : (scene.transition?.seconds ?? timeline.transition));
  return settled[0] - from > 1e-6 ? [from, settled[0]] : undefined;
}
```

In `render/renderer.ts`:

1. Imports: B1's `import { settledFrame } from '../timeline/cues.ts';` becomes `import { openingSpan, settledFrame } from '../timeline/cues.ts';`, and add `import { posterTime } from '../timeline/motion.ts';`.
2. In B1's `layoutSampleFrames`, replace the `timeline.scenes.forEach((s, i) => { … });` loop with:

   ```ts
     timeline.scenes.forEach((s, i) => {
       if (s.visual.kind === 'outro') return;
       const frame = settledFrame(timeline, i);
       if (frame !== undefined) frames.add(frame);
       // While it comes in: how full the frame is before the scene settles (empty-opening).
       const opening = openingSpan(timeline, i);
       if (!opening) return;
       const [from, to] = opening;
       const step = Math.max(OPENING_STEP, (to - from) / OPENING_SAMPLES);
       for (let t = from; t < to - 1e-6; t += step)
         frames.add(Math.min(last, Math.round(t * timeline.fps)));
     });
   ```

   and extend its doc comment's first sentence with ", and every half second of each story scene's opening (at most eight frames), where QC measures how much of the frame it fills while it comes in".
3. Insert after `layoutSampleFrames`:

```ts
/** A scene's opening is sampled this often… */
const OPENING_STEP = 0.5;
/** …at most this many times. */
const OPENING_SAMPLES = 8;

/** The frame the poster is taken at: `posterTime`'s moment (R-029), on the nearest frame. */
export function posterFrame(
  timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'frames' | 'duration'>,
): number {
  return Math.max(0, Math.min(timeline.frames - 1, Math.round(posterTime(timeline) * timeline.fps)));
}
```

4. In `RenderOptions`, give `posterFrame?: number;` the doc comment `/** The poster's frame (defaults to \`posterFrame\`). */`. In `renderComposition`, replace

   ```ts
     const posterFrame =
       options.posterFrame ??
       Math.min(total - 1, Math.round(Math.min(1.6, timeline.duration / 3) * timeline.fps));
   ```

   with `const posterAt = options.posterFrame ?? posterFrame(timeline);`, and `if (frame === posterFrame) poster = …` with `if (frame === posterAt) poster = await page.screenshot({ type: 'png' });`. (`RenderOptions.timeline` already picks `duration`, `scenes`, `transition`, `fps`, and `frames`.)

- [ ] **Step 5: What a scene visibly draws (`runtime/dom.ts`, `timeline/types.ts`, `runtime/stage.ts`)**

In `runtime/dom.ts`, add `import type { Rect } from '../timeline/types.ts';` at the top, and append:

```ts
/** A color with nothing to show: `transparent`, or an alpha of zero. */
const clear = (color: string) => color === 'transparent' || /,\s*0\)$/.test(color);

/** Whether an element paints a box of its own: a fill, an image, a shadow, or a border. */
function paints(style: CSSStyleDeclaration): boolean {
  return (
    !clear(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    style.boxShadow !== 'none' ||
    (['Top', 'Right', 'Bottom', 'Left'] as const).some(
      (side) =>
        Number.parseFloat(style[`border${side}Width`]) > 0 && !clear(style[`border${side}Color`]),
    )
  );
}

/**
 * Elements whose own box is what they draw: images and media, and SVG shapes. An `<svg>` is a
 * container like any other (a shot's flow layer spans the whole stage, its edges inside it).
 */
const DRAWN = new Set([
  'IMG',
  'CANVAS',
  'VIDEO',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'image',
  'use',
]);

/**
 * The box around what `root` visibly draws inside `clip`, in stage pixels: text, images, and boxes
 * with a fill, a border, or a shadow, at an opacity (its own times every ancestor's up to `root`)
 * above a tenth. Containers that draw nothing and parts not shown yet (an entrance still to come)
 * do not count, so this is what a viewer sees of the scene, not where its parts are laid out.
 */
export function drawnBox(root: HTMLElement, clip: Rect): Rect | undefined {
  let box: { left: number; top: number; right: number; bottom: number } | undefined;
  const add = (r: DOMRect) => {
    const left = Math.max(r.left, clip.x);
    const top = Math.max(r.top, clip.y);
    const right = Math.min(r.right, clip.x + clip.width);
    const bottom = Math.min(r.bottom, clip.y + clip.height);
    if (right <= left || bottom <= top) return;
    box = box
      ? {
          left: Math.min(box.left, left),
          top: Math.min(box.top, top),
          right: Math.max(box.right, right),
          bottom: Math.max(box.bottom, bottom),
        }
      : { left, top, right, bottom };
  };
  const range = document.createRange();
  const walk = (node: Element, opacity: number) => {
    const style = getComputedStyle(node);
    if (style.display === 'none') return;
    const shown = opacity * Number.parseFloat(style.opacity || '1');
    if (shown < 0.1) return;
    const visible = style.visibility !== 'hidden';
    if (DRAWN.has(node.tagName)) {
      if (visible) add(node.getBoundingClientRect());
      return;
    }
    if (visible && node !== root && paints(style)) add(node.getBoundingClientRect());
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element, shown);
      else if (visible && child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) add(r);
      }
    }
  };
  walk(root, 1);
  return (
    box && { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }
  );
}
```

(HTML tag names come back upper case and SVG ones lower case, as `DRAWN` lists them. It reads computed styles only at layout sample frames, a few dozen per video.)

In `timeline/types.ts`, add to `LayoutReport` after Task 3's `shot?: ShotReport;`:

```ts
  /**
   * The box around what the scene in front visibly draws in its region, as drawn (hidden parts
   * and empty containers left out): how much of the frame a viewer sees filled.
   */
  content?: Rect;
```

In `runtime/stage.ts`, add `drawnBox` to the `./dom.ts` import, and in `report()` add after Task 3's `shot: …,`:

```ts
      content: active ? drawnBox(active.media, clip ?? active.region) : undefined,
```

(`clip` is B2's: the viewport's region on the canvas, undefined without one, where the scene owns its region.)

- [ ] **Step 6: `empty-opening` (`density.ts`, `choreography.ts`, `index.ts`)**

In `packages/video/src/density.ts`, export B1's `CARDS` (`const CARDS` becomes `export const CARDS`; nothing else).

In `packages/video/src/choreography.ts`:

1. The `./density.ts` import becomes `import { CARDS, EMPTY_SHARE, leadKind, settledReports } from './density.ts';`; add `import { openingSpan } from './timeline/cues.ts';` after the `./timeline/build.ts` import, and `type TimelineScene,` to the `./timeline/types.ts` import.
2. Insert before `/** The choreography checks, in the order \`qc.json\` lists them. */`:

```ts
/**
 * Scenes whose frame the runtime fills: cards (as `empty-frame` holds them) and shots that lay
 * out elements.
 */
const fillsFrame = (scene: Pick<TimelineScene, 'visual' | 'direction'>) =>
  Boolean(scene.direction && !scene.direction.whole) ||
  (CARDS as ReadonlySet<string>).has(leadKind(scene));

/**
 * A card or a shot fills the frame while it comes in, not only once it has settled: no stretch of
 * its opening (from its entrance to its settled moment) covering 1.5 s or more of narration in
 * which what it visibly draws covers less than 40% of the media region, sampled every half second.
 */
export function emptyOpeningCheck(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const media = computeRegions(timeline).media;
  const stretches: Stretch[] = [];
  const shares = new Map<number, number>();
  let measured = 0;
  timeline.scenes.forEach((scene, i) => {
    if (scene.visual.kind === 'outro' || !fillsFrame(scene)) return;
    const opening = openingSpan(timeline, i);
    if (!opening) return;
    const samples = layouts
      .filter((r) => r.scene === scene.id && r.content !== undefined)
      .map((r) => ({
        t: r.frame / timeline.fps,
        share: area(clipBox(r.content!, media)) / area(media),
      }))
      .filter((s) => s.t >= opening[0] - 1e-6 && s.t < opening[1] - 1e-6)
      .sort((a, b) => a.t - b.t);
    if (samples.length) measured++;
    let from: { t: number; share: number } | undefined;
    for (const s of [...samples, { t: opening[1], share: 1 }]) {
      if (s.share < EMPTY_SHARE - 1e-9) {
        from ??= s;
        from = { t: from.t, share: Math.min(from.share, s.share) };
      } else if (from) {
        stretches.push({ start: from.t, end: s.t });
        shares.set(from.t, from.share);
        from = undefined;
      }
    }
  });
  const empty = spokenStills(timeline, stretches);
  if (!empty.length)
    return {
      id: 'empty-opening',
      status: 'pass',
      message: measured
        ? `Every card and shot fills at least ${Math.round(100 * EMPTY_SHARE)}% of the media region as it comes in.`
        : 'No scene was measured while it came in.',
    };
  const named = empty.map(
    (e) =>
      `${e.scene} (${Math.round(100 * (shares.get(e.at) ?? 0))}% of the media region for ${seconds(e.seconds)} from ${seconds(e.at)})`,
  );
  return {
    id: 'empty-opening',
    status: 'warn',
    message: `The frame stays mostly empty while ${listed(named)} comes in. Bring the scene's content in together, or open it on what it shows once settled.`,
  };
}

/** The part of `a` inside `b` (empty when they do not meet). */
function clipBox(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
```

3. In `choreographyChecks`, add `emptyOpeningCheck(timeline, layouts),` after `readingTimeCheck(timeline),`.

(B4 and B5 widened `leadKind`'s return beyond the visual kinds `CARDS` holds; the `ReadonlySet<string>` view reads the set without a type error, whatever B1–B5 merged. If B2–B5 merged an exported predicate for "a card the empty-frame check holds", use it instead.)

In `packages/video/src/index.ts`, add `emptyOpeningCheck,` to the `./choreography.ts` export block, `CARDS,` to B1's `./density.ts` block, and `posterFrame,` to the `./render/renderer.ts` block, and export `posterTime` from `./timeline/motion.ts` (`export { posterTime } from './timeline/motion.ts';`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/poster.test.ts packages/video/test/choreography.test.ts packages/video/test/density.test.ts packages/video/test/motion.test.ts packages/video/test/frames.test.ts tests/render/canvas.test.ts`
Expected: PASS (B1's `layoutSampleFrames` tests still find every settled frame and none for the outro; B2's accent test unchanged).

Run: `npm run typecheck && npm run lint`, then (in the background, and wait) `npm test`.
Expected: exit 0 and PASS.

- [ ] **Step 8: Commit**

```bash
npx biome check --write packages/video/src packages/video/test tests/render/canvas.test.ts
npm run lint && npm run typecheck
git add packages/video/src/timeline/motion.ts packages/video/src/runtime/camera.ts packages/video/src/timeline/cues.ts packages/video/src/render/renderer.ts packages/video/src/runtime/dom.ts packages/video/src/timeline/types.ts packages/video/src/runtime/stage.ts packages/video/src/density.ts packages/video/src/choreography.ts packages/video/src/index.ts packages/video/test/poster.test.ts packages/video/test/choreography.test.ts tests/render/canvas.test.ts
git commit -m "$(cat <<'EOF'
Take the poster where the key number lands, and warn on openings that leave the frame empty

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 5: The draft render — `covi render --run <id> --draft` into `video/draft/`

**Files:**
- Create: `packages/video/src/draft.ts`
- Modify: `packages/video/src/pipeline.ts` (imports; `ProduceVideoInput`, `ProduceVideoResult`; `produceVideo`; new `timelineGrounding`, `DraftInput`, `renderDraft`)
- Modify: `packages/video/src/sound.ts` (`masterVoice`, before `produceSound`)
- Modify: `packages/video/src/index.ts` (exports)
- Modify: `packages/core/src/run/run.ts` (`ArtifactKind`)
- Modify: `packages/cli/src/workflows.ts` (import; `WorkflowResult.video.draft`; `applyVideoResult`; `renderWorkflow`)
- Modify: `packages/cli/src/main.ts` (`RenderFlags`; the `render` command; `finish`)
- Modify: `packages/cli/src/ui.ts` (`printResult`)
- Create: `packages/video/test/draft.test.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/render/render.test.ts` (imports; a new `describe` before "the timing grammar (full pipeline)")

**Interfaces:**
- Consumes: everything in `produceVideo` up to `buildTimeline` (B2's direction planning and resolution, narration, fitting, staging); `renderComposition`, `RenderResult`, `posterFrame` (`render/renderer.ts`; Task 4 made R-029's choice the default); `runQc`, `withCheck` (`qc.ts`, now with Tasks 2–4's checks); `groundingCheck` (`grounding.ts`); `mixSound`, `writeWav` (`@covi/audio`, as `produceSound` uses them); `SoundInput`, `SAMPLE_RATE` (`sound.ts`); `applyVideoResult`, `artifact`, `baseResult`, `WorkflowResult` (`workflows.ts`); `printResult` (`ui.ts`).
- Produces:
  ```ts
  // packages/video/src/draft.ts
  export const DRAFT_DIR = 'video/draft';
  export const DRAFT_PATHS: { preview: 'video/draft/preview.mp4'; poster: 'video/draft/poster.png'; contactSheet: 'video/draft/contact-sheet.jpg'; qc: 'video/draft/qc.json'; timeline: 'video/draft/timeline.json'; composition: 'video/draft/composition'; master: 'video/draft/.master.wav' };
  export const DRAFT_FPS = 15;
  export const DRAFT_SCALE = 0.5;
  export function draftSpec(spec: VideoSpec): VideoSpec;
  // packages/video/src/sound.ts
  export function masterVoice(input: Pick<SoundInput, 'voice' | 'speech'> & { duration: number; placement: VideoSpec['music']['placement'] }, path: string): string | undefined;
  // packages/video/src/pipeline.ts
  // ProduceVideoInput gains:  draftRender?: boolean;
  // ProduceVideoResult gains: draft?: { width: number; height: number; fps: number };
  // packages/core/src/run/run.ts — ArtifactKind gains 'draft'
  // packages/cli/src/workflows.ts — WorkflowResult['video'] gains:
  draft?: { path: string; seconds?: number; qc?: string; width: number; height: number; fps: number };
  // renderWorkflow's options gain: draft?: boolean;
  // packages/cli/src/main.ts
  interface RenderFlags { run: string; storyboard?: string; workers?: string; draft?: boolean }
  ```

The draft is the same video, drawn smaller: its timeline is built by the same code at the draft's spec (half the width and height on even pixels, `min(15, fps)`), so it has the same scenes, beats, captions, and cues at the same moments, and every position at half (timing never reads the frame size or rate; positions follow the frame). It reuses the narration through the TTS cache, plays the voice alone (mastered as a mix is: no music, no effects, no model call), and writes only `video/draft/`, its poster included (Task 4's choice, the same moment as the video's): the storyboard, `speech.json`, `narration.wav`, captions, `narration.md`, the sound files, `video/composition/`, the video, its poster, contact sheet, `qc.json`, and `video/frames.json` stay as they were, and the run's outcome keeps describing the video. Its files are recorded with a new artifact kind, `draft`, because `covi ci` links the first `video` artifact it finds and must never link a preview. On the scratch copy the benchmark's draft took about 8 s where its video took about 17 s.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/draft.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav } from '@covi/audio';
import { resolveConfig, seedFrom } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { AssetCollector } from '../src/composition/build.ts';
import { defaultDirection, entrances, mergeDirection } from '../src/direction/director.ts';
import { resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { DRAFT_FPS, draftSpec } from '../src/draft.ts';
import { masterVoice, SAMPLE_RATE } from '../src/sound.ts';
import { orientationOf, resolveVideoSpec, type VideoSpec } from '../src/spec.ts';
import { type StoryboardInput, StoryboardSchema } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, pacingFor } from '../src/timeline/build.ts';
import type { Rect, Timeline } from '../src/timeline/types.ts';

const spec = (width: number, height: number, fps = 30): VideoSpec => ({
  ...resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width, height }),
  fps,
});

describe('the draft spec', () => {
  it('halves the size on even pixels and draws at 15 fps, and changes nothing else', () => {
    const full = spec(1920, 1080);
    expect(draftSpec(full)).toEqual({ ...full, width: 960, height: 540, fps: DRAFT_FPS });
    expect(draftSpec(spec(1080, 1920))).toMatchObject({ width: 540, height: 960 });
    expect(draftSpec(spec(1366, 768))).toMatchObject({ width: 682, height: 384 });
    // A video already slower than the draft keeps its own frame rate.
    expect(draftSpec(spec(1280, 720, 12)).fps).toBe(12);
  });
});

const title = 'Send only the ids';
const scenes: StoryboardInput['scenes'] = [
  {
    id: 's1',
    beat: 'problem',
    narration: 'The request carried every document, so the reader timed out.',
    visual: { kind: 'callout', tone: 'warning', title: 'Timed out' },
  },
  {
    id: 's2',
    beat: 'fix',
    eyebrow: 'The fix',
    narration: 'Now it sends only the ids, and the reader fetches each one.',
    hero: true,
    visual: {
      kind: 'code',
      path: 'src/request.js',
      lines: [
        { type: 'del', text: 'return send(docs);' },
        { type: 'add', text: 'return send(docs.map((d) => d.id));' },
      ],
      highlight: [1],
    },
  },
  {
    id: 's3',
    beat: 'summary',
    narration: 'Ready to merge.',
    visual: { kind: 'summary', verdict: 'looks-good', headline: 'Ids only', points: [] },
  },
];
const shots: DirectionInput['shots'] = [
  {
    scene: 's1',
    enter: 'cut',
    layout: 'row',
    elements: [
      { id: 'req', kind: 'node', label: 'Request' },
      { id: 'reader', kind: 'node', label: 'Reader' },
      { id: 'late', kind: 'label', text: 'Timed out', tone: 'warning' },
    ],
    beats: [
      { verb: 'reveal', element: 'reader', style: 'pop' },
      { verb: 'reveal', element: 'late', style: 'type', at: 'timed out' },
      { verb: 'camera', move: 'zoom', to: 'late' },
    ],
  },
];

/** The timeline the pipeline builds for one direction at one size, without narration. */
function build(at: VideoSpec): Timeline {
  const parsed = StoryboardSchema.parse({ title, template: 'bug-fix', scenes }).scenes;
  const seed = seedFrom(title);
  const plan = mergeDirection(
    DirectionSchema.parse({ shots }),
    defaultDirection({ scenes: parsed, seed, orientation: orientationOf(at.width, at.height) }),
  );
  const enter = entrances(plan, parsed, undefined, seed);
  const layout = layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(at), enter);
  const assets = new AssetCollector('/nonexistent');
  const staging = resolveDirection({
    plan,
    scenes: parsed,
    layout,
    spec: at,
    language: 'en',
    sources: directionSources({}),
    image: assets.image,
    seed,
    redact: (value) => value,
  });
  return buildTimeline({
    title,
    scenes: parsed,
    layout,
    spec: at,
    image: assets.image,
    entrances: enter,
    staging,
  });
}

/** Everything a viewer sees happen, and when. */
function choreography(t: Timeline) {
  return {
    duration: t.duration,
    captions: t.captions,
    cues: t.cues,
    scenes: t.scenes.map((s) => ({
      id: s.id,
      start: s.start,
      end: s.end,
      transition: s.transition,
      phases: s.phases,
      beats: s.direction?.beats,
      elements: s.direction?.elements.map((e) => [e.id, e.kind]),
    })),
  };
}

/** Every stop and slot, in the pixels of a frame `scale` times as large. */
const positions = (t: Timeline, scale: number) =>
  t.scenes
    .flatMap((s) => [
      ...(s.stop ? [s.stop.x, s.stop.y] : []),
      ...(s.direction?.elements ?? []).flatMap((e: { rect: Rect }) => [
        e.rect.x,
        e.rect.y,
        e.rect.width,
        e.rect.height,
      ]),
    ])
    .map((v) => v * scale);

describe('a draft', () => {
  for (const [width, height] of [
    [1920, 1080],
    [1080, 1920],
    [1366, 768],
  ] as const)
    it(`is the same video, scaled: the same moments, every position at half (${width}×${height})`, () => {
      const full = build(spec(width, height));
      const draft = build(draftSpec(spec(width, height)));
      expect(draft).toMatchObject({ orientation: full.orientation, fps: 15 });
      expect(draft.frames).toBe(Math.round(full.duration * 15));
      expect(choreography(draft)).toEqual(choreography(full));
      // An odd half (683) rounds down to even pixels, and positions follow the frame it draws.
      if (width % 4 || height % 4) return;
      const [big, small] = [positions(full, 1), positions(draft, 2)];
      expect(small).toHaveLength(big.length);
      for (const [i, v] of small.entries()) expect(v).toBeCloseTo(big[i]!, 1);
    });
});

describe('a draft’s sound', () => {
  it('masters the voice alone, and nothing without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-draft-'));
    try {
      const path = join(dir, 'master.wav');
      const silent = { speech: [], duration: 2, placement: 'continuous' as const };
      expect(masterVoice(silent, path)).toBeUndefined();
      expect(existsSync(path)).toBe(false);
      const voice = Float32Array.from({ length: 2 * SAMPLE_RATE }, (_, i) =>
        i < SAMPLE_RATE ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) : 0,
      );
      const speech: Array<[number, number]> = [[0, 1]];
      expect(masterVoice({ ...silent, voice, speech }, path)).toBe(path);
      const wav = readWav(path);
      expect(wav.sampleRate).toBe(SAMPLE_RATE);
      expect(wav.channels).toHaveLength(2);
      expect(wav.channels[0]!.length).toBe(2 * SAMPLE_RATE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

(These are the calls B2's `directed(…)` helper in `tests/render/canvas.test.ts` makes; if B2–B5 merged other signatures for `layoutScenes`, `defaultDirection`, `entrances`, or `resolveDirection`, copy that helper's calls.)

In `tests/cli.test.ts`, add before `it('declines a video for an internal change and still produces the review', …)`:

```ts
  it('refuses a draft render the way it refuses a render, and writes no draft', async () => {
    const dir = await example('bugfix-cli-slugify');
    const json = covi(['video', '--repo', dir, '--draft', '--force', '--json']).json() as {
      runId: string;
      runDir: string;
      artifacts: Record<string, string>;
    };
    expect(covi(['render', '--help']).stdout).toMatch(/--draft\s+render a fast draft/);
    writeFileSync(
      json.artifacts.direction!,
      JSON.stringify({ shots: [{ scene: 'nope', elements: [{ id: 'v', kind: 'visual' }] }] }),
    );
    const draft = covi(['render', '--repo', dir, '--run', json.runId, '--draft', '--json']);
    expect(draft.code).toBe(2);
    expect((draft.json() as { error: string }).error).toMatch(
      /video\/direction\.json does not fit this run/,
    );
    expect(existsSync(join(json.runDir, 'video', 'draft'))).toBe(false);
  });

  it('reports a draft render as a preview, never as the video', async () => {
    const session = {
      run: { id: 'run-1', has: async () => true, path: (rel: string) => `/run/${rel}` },
      language: { language: 'en' },
    } as unknown as Parameters<typeof applyVideoResult>[0];
    const result = baseResult('render');
    const produced = {
      video: '/run/video/draft/preview.mp4',
      duration: 36,
      qc: { status: 'warn', checks: [], measured: {} },
      narration: { enabled: true, provider: 'say', voice: 'Samantha', reason: '' },
      draft: { width: 960, height: 540, fps: 15 },
    } as unknown as Parameters<typeof applyVideoResult>[2];
    await applyVideoResult(session, result, produced);
    expect(result.video).toMatchObject({
      rendered: false,
      draft: { path: '/run/video/draft/preview.mp4', qc: 'warn', width: 960, fps: 15 },
    });
    expect(result.video!.reason).toContain('open video/draft/contact-sheet.jpg');
    expect(result.artifacts).toMatchObject({
      draftPreview: '/run/video/draft/preview.mp4',
      draftPoster: '/run/video/draft/poster.png',
      draftContactSheet: '/run/video/draft/contact-sheet.jpg',
      draftQc: '/run/video/draft/qc.json',
      draftTimeline: '/run/video/draft/timeline.json',
    });
    expect(result.artifacts.video).toBeUndefined();
  });
```

(The file already imports `existsSync`, `writeFileSync`, `join`, `applyVideoResult`, `baseResult`, `covi`, and has the `example(name)` helper.)

In `tests/render/render.test.ts`, add `import { createHash } from 'node:crypto';` after the `node:child_process` import and `posterFrame` to the existing `../../packages/video/src/render/renderer.ts` import (the file already imports `readdirSync`, `readFileSync`, `join`, `Media`, `Timeline`, `listExamples`, `materializeExample`, `available`, `fullRenders`, and `dirs`), and add before `describe.skipIf(!available || !fullRenders)('the timing grammar (full pipeline)', …)`:

```ts
describe.skipIf(!available || !fullRenders)('covi render --draft (full pipeline)', () => {
  /** Every file of a run but run.json and the draft, with its hash. */
  const files = (run: string) =>
    readdirSync(run, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => join(e.parentPath, e.name).slice(run.length + 1))
      .filter((rel) => rel !== 'run.json' && !rel.startsWith(join('video', 'draft')))
      .sort()
      .map(
        (rel) =>
          `${rel} ${createHash('sha256')
            .update(readFileSync(join(run, rel)))
            .digest('hex')}`,
      );

  it('drafts the benchmark beside its video: half size, 15 fps, the same moments', async () => {
    const dir = await materializeExample(
      (await listExamples()).find((e) => e.name === 'backend-slim-request')!,
    );
    dirs.push(dir);
    const covi = (args: string[]) =>
      JSON.parse(
        execFileSync('node', ['bin/covi.mjs', ...args, '--repo', dir, '--json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 600_000,
        }),
      );
    const video = covi(['video', '--standard']) as {
      runId: string;
      runDir: string;
      video: { rendered: boolean; reason: string };
    };
    expect(video.video.rendered).toBe(true);
    const run = video.runDir;
    const before = files(run);
    const outcome = () => JSON.parse(readFileSync(join(run, 'run.json'), 'utf8')).outcome.video;
    const rendered = outcome();

    const draft = covi(['render', '--run', video.runId, '--draft']) as {
      video: {
        rendered: boolean;
        draft: { qc: string; width: number; height: number; fps: number };
      };
    };
    expect(draft.video).toMatchObject({
      rendered: false,
      draft: { width: 960, height: 540, fps: 15 },
    });
    expect(draft.video.draft.qc).not.toBe('fail');
    // Nothing of the video was touched, and the run still describes the video.
    expect(files(run)).toEqual(before);
    expect(outcome()).toEqual(rendered);
    expect(readdirSync(join(run, 'video', 'draft')).sort()).toEqual([
      'composition',
      'contact-sheet.jpg',
      'poster.png',
      'preview.mp4',
      'qc.json',
      'timeline.json',
    ]);

    const media = await Media.locate();
    const probe = await media.probe(join(run, 'video', 'draft', 'preview.mp4'));
    expect(probe).toMatchObject({ width: 960, height: 540 });
    expect(probe.fps).toBeCloseTo(15, 2);
    if (video.video.reason.startsWith('narrated')) expect(probe.audioCodec).toBeTruthy();

    // A scaled view of the same video: the same moments and shots, every position at half.
    const read = (rel: string) => JSON.parse(readFileSync(join(run, rel), 'utf8')) as Timeline;
    const full = read('video/timeline.json');
    const half = read('video/draft/timeline.json');
    const moments = (t: Timeline) => ({
      duration: t.duration,
      captions: t.captions,
      cues: t.cues,
      scenes: t.scenes.map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        transition: s.transition,
        beats: s.direction?.beats,
        kinds: s.direction?.elements.map((e) => e.kind),
      })),
    });
    expect(moments(half)).toEqual(moments(full));
    const positions = (t: Timeline, k: number) =>
      t.scenes
        .flatMap((s) => [
          ...(s.stop ? [s.stop.x, s.stop.y] : []),
          ...(s.direction?.elements ?? []).flatMap((e) => [
            e.rect.x,
            e.rect.y,
            e.rect.width,
            e.rect.height,
          ]),
        ])
        .map((v) => v * k);
    const [big, small] = [positions(full, 1), positions(half, 2)];
    expect(small).toHaveLength(big.length);
    for (const [i, v] of small.entries()) expect(v).toBeCloseTo(big[i]!, 1);
    expect(half.mouth).toHaveLength(half.frames);
    // Its poster shows the video's moment.
    expect(
      Math.abs(posterFrame(half) / half.fps - posterFrame(full) / full.fps),
    ).toBeLessThanOrEqual(1 / 15 + 1e-9);

    // The draft is checked like the video, motion and all.
    const qc = JSON.parse(readFileSync(join(run, 'video', 'draft', 'qc.json'), 'utf8')) as {
      checks: Array<{ id: string; status: string }>;
    };
    for (const id of [
      'still',
      'motion-gap',
      'motion-busy',
      'reading-time',
      'empty-opening',
      'overlap',
      'out-of-frame',
      'dropped-beats',
    ])
      expect(
        qc.checks.find((c) => c.id === id),
        id,
      ).toMatchObject({ status: 'pass' });
  }, 900_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/draft.test.ts tests/cli.test.ts -t "draft"`
Expected: FAIL — `../src/draft.ts` and `masterVoice` do not exist; `covi render --help` has no `--draft`; `applyVideoResult` reports the preview as a video.

- [ ] **Step 3: Create `packages/video/src/draft.ts`**

```ts
import type { VideoSpec } from './spec.ts';

/*
 * The draft render (`covi render --run <id> --draft`, R-006): the same video at half size and
 * 15 fps, for an agent to look at before the real render. It is a scaled view, not another
 * video: timing never depends on the size or the frame rate, and every position scales with the
 * frame, so the full-size render of the same direction moves exactly the same way.
 */

/** Where a draft render writes, apart from the video's own files. */
export const DRAFT_DIR = 'video/draft';
export const DRAFT_PATHS = {
  preview: 'video/draft/preview.mp4',
  poster: 'video/draft/poster.png',
  contactSheet: 'video/draft/contact-sheet.jpg',
  qc: 'video/draft/qc.json',
  timeline: 'video/draft/timeline.json',
  composition: 'video/draft/composition',
  /** The voice, mastered, kept only until it is muxed into the preview. */
  master: 'video/draft/.master.wav',
} as const;

/** A draft draws at this frame rate (or the video's, when that is lower)… */
export const DRAFT_FPS = 15;
/** …and at this share of the video's width and height. */
export const DRAFT_SCALE = 0.5;

/** The draft's spec: half the size, on even pixels as 4:2:0 video needs, at 15 fps. */
export function draftSpec(spec: VideoSpec): VideoSpec {
  const half = (n: number) => Math.max(2, 2 * Math.floor((n * DRAFT_SCALE) / 2));
  return {
    ...spec,
    width: half(spec.width),
    height: half(spec.height),
    fps: Math.min(DRAFT_FPS, spec.fps),
  };
}
```

- [ ] **Step 4: The voice alone, mastered (`packages/video/src/sound.ts`)**

In `sound.ts`, insert before `/** Fits, renders, places, and mixes; writes \`video/music.wav\`, …` (the doc comment of `produceSound`):

```ts
/**
 * The voice alone, mastered as a mix is (no music, no effects), for a draft's preview: written to
 * `path` and returned, or nothing when no one speaks.
 */
export function masterVoice(
  input: Pick<SoundInput, 'voice' | 'speech'> & {
    duration: number;
    placement: VideoSpec['music']['placement'];
  },
  path: string,
): string | undefined {
  if (!input.voice) return undefined;
  const mixed = mixSound({
    sampleRate: SAMPLE_RATE,
    duration: input.duration,
    voice: input.voice,
    speech: input.speech,
    placement: input.placement,
    effects: [],
  });
  if (!mixed.master) return undefined;
  writeWav(path, mixed.master, SAMPLE_RATE, 'pcm16');
  return path;
}
```

(If A1 merged required `MixInput` fields, pass them the way `produceSound`'s `mix` helper does, with no music and no effects.)

- [ ] **Step 5: The draft branch of `produceVideo` (`packages/video/src/pipeline.ts`)**

1. Imports: add `import { DRAFT_PATHS, draftSpec } from './draft.ts';` after the `./direction/sources.ts` import, and `masterVoice,` to the `./sound.ts` import (after `draftScore,`).
2. `ProduceVideoInput`, after `direction?: 'auto' | 'off';`:

   ```ts
     /**
      * Render a draft instead (`covi render --draft`): the same video at half size and 15 fps, with
      * the voice alone, into `video/draft/`. The video's own files are left as they are.
      */
     draftRender?: boolean;
   ```

3. `ProduceVideoResult`, after `framesReused?: boolean;`:

   ```ts
     /** A draft render: `video` is `video/draft/preview.mp4`, and `qc` its checks. */
     draft?: { width: number; height: number; fps: number };
   ```

4. In `produceVideo`, replace `const { run, spec, logger } = input;` with:

   ```ts
     const { run, logger } = input;
     const draft = Boolean(input.draftRender);
     const spec = draft ? draftSpec(input.spec) : input.spec;
   ```

5. Replace `await run.writeJson('video/storyboard.json', storyboard, 'storyboard');` with:

   ```ts
     // A draft render leaves the storyboard as the agent wrote it.
     if (!draft) await run.writeJson('video/storyboard.json', storyboard, 'storyboard');
   ```

6. Replace `await run.writeJson('video/speech.json', speechRecord, 'narration');` with `if (!draft) await run.writeJson('video/speech.json', speechRecord, 'narration');`.
7. Wrap the `narration.wav` write and its record in `if (!draft) { … }` (the voice is still normalized and the mouth still measured):

   ```ts
       if (!draft) {
         await writeWav(run.path('video/narration.wav'), {
           sampleRate: SAMPLE_RATE,
           samples: Int16Array.from(voice, (v) =>
             Math.max(-32768, Math.min(32767, Math.round(v * 32768))),
           ),
         });
         await run.record('video/narration.wav', 'narration');
       }
   ```

8. Right after `const timeline: Timeline = buildTimeline({ … });` and before `await run.writeJson('video/timeline.json', …)`, add:

   ```ts
     if (draft)
       return renderDraft(input, {
         spec,
         timeline,
         images: assets.files,
         voice,
         speech: speechWindows,
         speechRecord: redact(speechRecord),
         media,
         result: { storyboard, drafted, narration, notes },
       });
   ```

9. In the final QC, replace the inline `groundingCheck(storyScenes(timeline.scenes).map(…), input.explanation)` argument of `withCheck` with `timelineGrounding(timeline, input.explanation)`.
10. Add after `produceVideo` (before `writeStoryboard`):

```ts
/** Whether every story scene of the timeline, and the explanation, rest on evidence. */
function timelineGrounding(timeline: Timeline, explanation: Explanation) {
  return groundingCheck(
    storyScenes(timeline.scenes).map((s) => ({
      id: s.id,
      narration: s.speech?.text ?? '',
      kind: s.visual.kind,
      evidenceIds: s.evidenceIds,
    })),
    explanation,
  );
}

/** What a draft render draws from: the timeline built at the draft's size, and the voice. */
interface DraftInput {
  spec: VideoSpec;
  timeline: Timeline;
  images: Map<string, string>;
  voice?: Float32Array;
  speech: SoundInput['speech'];
  speechRecord: SpeechRecord;
  media: Media;
  result: Pick<ProduceVideoResult, 'storyboard' | 'drafted' | 'narration' | 'notes'>;
}

/**
 * The draft render: its timeline, its composition, a preview with the voice alone, its contact
 * sheet, and its checks, all in `video/draft/`. Nothing of the video's own is written: not the
 * video, its sound, or `video/frames.json`, so the next real render knows what it already has.
 */
async function renderDraft(input: ProduceVideoInput, d: DraftInput): Promise<ProduceVideoResult> {
  const { run, logger } = input;
  const { spec, timeline, media } = d;
  await run.writeJson(DRAFT_PATHS.timeline, timeline, 'draft');
  const compositionDir = run.path(DRAFT_PATHS.composition);
  // An earlier draft's images may no longer be shown.
  await rm(compositionDir, { recursive: true, force: true });
  await writeComposition(compositionDir, timeline, d.images);
  const output = run.path(DRAFT_PATHS.preview);
  let rendered: Awaited<ReturnType<typeof renderComposition>>;
  try {
    const audio = masterVoice(
      {
        voice: d.voice,
        speech: d.speech,
        duration: timeline.duration,
        placement: spec.music.placement,
      },
      run.path(DRAFT_PATHS.master),
    );
    logger.step(
      `Rendering a draft: ${timeline.frames} frames at ${spec.width}×${spec.height}, ${spec.fps} fps`,
    );
    rendered = await renderComposition({
      compositionDir,
      output,
      timeline,
      media,
      audio,
      workers: input.workers,
    });
  } finally {
    await rm(run.path(DRAFT_PATHS.master), { force: true });
  }
  await run.record(DRAFT_PATHS.preview, 'draft');
  if (rendered.poster) await run.record(DRAFT_PATHS.poster, 'draft');
  if (rendered.contactSheet) await run.record(DRAFT_PATHS.contactSheet, 'draft');
  logger.step('Checking the draft');
  const qc = withCheck(
    await runQc({
      video: output,
      spec,
      timeline,
      layouts: rendered.layouts,
      narrated: Boolean(d.voice),
      media,
      speech: d.speechRecord,
    }),
    timelineGrounding(timeline, input.explanation),
  );
  await run.writeJson(DRAFT_PATHS.qc, qc, 'draft');
  // The draft's checks are for whoever revises it: they go to its qc.json, not the run's warnings.
  for (const check of qc.checks.filter((c) => c.status !== 'pass'))
    logger.warn(`Draft QC ${check.status}: ${check.message}`);
  return {
    ...d.result,
    video: output,
    poster: rendered.poster,
    contactSheet: rendered.contactSheet,
    duration: qc.measured.duration,
    qc,
    renderMs: rendered.renderMs,
    draft: { width: spec.width, height: spec.height, fps: spec.fps },
  };
}
```

(`rm`, `writeComposition`, `renderComposition`, `runQc`, `withCheck`, `groundingCheck`, `storyScenes`, `Media`, `SpeechRecord`, `SoundInput`, `VideoSpec`, `Explanation`, and `Timeline` are already imported by `pipeline.ts`; add any the merged file lacks. The draft runs after everything that validates the storyboard and the direction, so a refused direction writes nothing under `video/draft/`. `renderComposition` writes the poster and the contact sheet beside its output, `video/draft/poster.png` and `video/draft/contact-sheet.jpg`, the poster at Task 4's `posterFrame` of the draft's timeline: the video's moment.)

- [ ] **Step 6: Exports and the artifact kind**

In `packages/video/src/index.ts`, add after the `./choreography.ts` block:

```ts
export { DRAFT_DIR, DRAFT_FPS, DRAFT_PATHS, DRAFT_SCALE, draftSpec } from './draft.ts';
```

In `packages/core/src/run/run.ts`, add to `ArtifactKind` after `| 'qc'`:

```ts
  /** A draft render's files (`video/draft/`): a preview, never the video. */
  | 'draft'
```

- [ ] **Step 7: The CLI (`packages/cli/src/workflows.ts`, `main.ts`, `ui.ts`)**

`workflows.ts`:

1. Add `DRAFT_PATHS,` to the `@covi/video` import (first in the list).
2. In `WorkflowResult['video']`, after `framesReused?: boolean;`:

   ```ts
       /** `covi render --draft`: a preview in `video/draft/`; the video itself was not rendered. */
       draft?: {
         path: string;
         seconds?: number;
         qc?: string;
         width: number;
         height: number;
         fps: number;
       };
   ```

3. In `applyVideoResult`, after the `if (draft) { … return; }` block (the storyboard draft of `covi video --draft`), add:

   ```ts
     if (produced.draft && produced.video) {
       const { width, height, fps } = produced.draft;
       result.video = {
         rendered: false,
         reason: `Draft rendered at ${width}×${height}, ${fps} fps: open video/draft/contact-sheet.jpg and poster.png, read video/draft/qc.json, revise video/direction.json, then run \`covi render --run ${session.run.id}\` for the video.`,
         draft: {
           path: produced.video,
           seconds: produced.duration,
           qc: produced.qc?.status,
           width,
           height,
           fps,
         },
       };
       for (const [name, rel] of Object.entries({
         draftPreview: DRAFT_PATHS.preview,
         draftPoster: DRAFT_PATHS.poster,
         draftContactSheet: DRAFT_PATHS.contactSheet,
         draftQc: DRAFT_PATHS.qc,
         draftTimeline: DRAFT_PATHS.timeline,
       }))
         if (await session.run.has(rel)) artifact(session, result, name, rel);
       if (produced.qc?.status === 'fail')
         result.warnings.push('Draft QC failed; see video/draft/qc.json.');
       return;
     }
   ```

4. `renderWorkflow`'s options: add after `musicDefault?: boolean;`:

   ```ts
       /** `--draft`: a fast preview into `video/draft/` instead of the video. */
       draft?: boolean;
   ```

   and pass `draftRender: options.draft,` to `produceVideo` after `direction: session.config.video.direction,`.

`main.ts`:

1. Add above `function selection(`:

   ```ts
   /** `covi render`'s own options. */
   interface RenderFlags {
     run: string;
     storyboard?: string;
     workers?: string;
     draft?: boolean;
   }
   ```

2. In the `render` command, after `.option('--workers <n>', 'parallel render workers', int(1, 64))`, add:

   ```ts
       .option(
         '--draft',
         'render a fast draft (half size, 15 fps, the voice alone) into video/draft/ to check the motion; the video is left as it is',
       )
   ```

   change `.action(async (o: { run: string; storyboard?: string; workers?: string }, cmd: Command) => {` to `.action(async (o: RenderFlags, cmd: Command) => {`, and add `draft: Boolean(o.draft),` after `musicDefault,` in the `renderWorkflow` call.
3. In `finish`, replace `const video = result.video ? {` … `} : undefined;` with:

   ```ts
       // A draft is a preview: the run's outcome keeps describing the video.
       const video =
         result.video && !result.video.draft
           ? {
               rendered: result.video.rendered,
               reason: result.video.reason,
               path: result.video.path ? relative(s.run.dir, result.video.path) : undefined,
               seconds: result.video.seconds,
             }
           : undefined;
   ```

   (`updateOutcome` drops undefined fields, so a draft render leaves the outcome's `video` as the last real render left it.)

`ui.ts`, `printResult`: replace `: \`${c.dim('No video:')} ${result.video.reason}\`,` with:

```ts
        : result.video.draft
          ? `${c.green('Draft')} ${result.video.draft.path} ${c.dim(`(${result.video.draft.seconds?.toFixed(1)}s · QC ${result.video.draft.qc} · ${result.video.reason})`)}`
          : `${c.dim('No video:')} ${result.video.reason}`,
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/draft.test.ts tests/cli.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: exit 0.

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "render --draft"`
Expected: PASS (on the scratch copy about 30 s with a warm TTS cache).

- [ ] **Step 9: Draft the benchmark by hand and look at it**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/video.json"
RUN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runId)' "$RENDER/video.json")
time ./bin/covi.mjs render --repo "$RENDER/repo" --run "$RUN" --draft
```

Run the `covi video` line in the background and wait. Expected: the last command prints a `Draft …/video/draft/preview.mp4 (…s · QC pass · Draft rendered at 960×540, 15 fps: …)` line and takes well under the video's render time. Open `<runDir>/video/draft/contact-sheet.jpg` with the Read tool beside `<runDir>/video/contact-sheet.jpg`: the same tiles at the same moments, the draft's smaller but legible (scene labels readable, the counter and the pile visible in `s1`, the morph mid-way in `s2`); and `<runDir>/video/draft/poster.png` beside `<runDir>/video/poster.png`: the same moment, the byte counter landed on 9,907 with −86% (R-029). Record both timings and what the sheets show in the report, then `rm -rf "$RENDER"`.

- [ ] **Step 10: Commit**

```bash
npx biome check --write packages/video/src packages/core/src/run/run.ts packages/cli/src packages/video/test/draft.test.ts tests/cli.test.ts tests/render/render.test.ts
npm run lint && npm run typecheck
git add packages/video/src/draft.ts packages/video/src/pipeline.ts packages/video/src/sound.ts packages/video/src/index.ts packages/core/src/run/run.ts packages/cli/src/workflows.ts packages/cli/src/main.ts packages/cli/src/ui.ts packages/video/test/draft.test.ts tests/cli.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Render a fast draft of a run's video into video/draft/

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 6: Every render is checked for motion, and the benchmark's default render passes and has its poster

**Files:**
- Modify: `tests/render/render.test.ts` (B1's `covi video (full pipeline)` loop: its check-id assertion, and B4's `if (example === 'backend-slim-request') { … }` block)

**Interfaces:**
- Consumes: Tasks 1–5 (the camera fix, the seven checks in every `qc.json`, the shot report, the drawn box, `posterFrame`, which Task 5 imported into this file); `openingSpan` (Task 4) from `timeline/cues.ts`; B1's loop variables `example`, `result` (`runDir`, `video`), and `qc`; B4/B5's benchmark block.
- Produces: the full-pipeline render test asserts the seven motion check ids on every example's `qc.json`, that the benchmark's default render (`--standard`, English) passes `still`, `motion-gap`, `motion-busy`, `reading-time`, `empty-opening`, `overlap`, `out-of-frame`, and `dropped-beats`, and that its poster is the frame where its byte count lands (R-029), past its first scene's opening.

Measured on the scratch copy with Tasks 1–5 applied: the benchmark renders `pass` in English and Korean, its poster the byte counter landed on 9,907 with −86% (10.7 s in; the first scene's opening runs to 10.4 s); `ui-comment-composer`, `api-users-pagination`, `bugfix-cli-slugify`, `visual-pricing-cards`, and `backend-slim-request` (short-form) all render without an `overlap` warning or an `out-of-frame` failure. `bugfix-cli-slugify` warns `empty-opening` (s1, a vertical before/after terminal, 17% of the media region for 4.4 s while only its Before window is up), the condition the B1 benchmark render showed. `api-users-pagination` (s1, a 13 s morph shot whose two beats are 4.4 s apart) and `bugfix-cli-slugify` (the same s1) still warn `still`, now with "where only the camera's slow push-in moves", while `motion-gap` passes: the push-in counts as motion in the plan (spec §10) but is too slow to show on thin code text. Those are warnings for an agent's draft loop to fix with beats, not this PR's to remove.

- [ ] **Step 1: Pin the motion checks in the full-pipeline test**

In `tests/render/render.test.ts`, in B1's `covi video (full pipeline)` loop, replace the check-id assertion

```ts
      // Every render is checked for small text, empty frames, and monotony.
      …
      expect(qc.checks.map((c) => c.id)).toEqual(
        expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety']),
      );
```

with (keep B1's `qc` declaration between them as merged):

```ts
      // Every render is checked for small text, empty frames, monotony, and motion.
      …
      expect(qc.checks.map((c) => c.id)).toEqual(
        expect.arrayContaining([
          'text-size',
          'empty-frame',
          'monotony',
          'transition-variety',
          'motion-gap',
          'motion-busy',
          'reading-time',
          'empty-opening',
          'overlap',
          'out-of-frame',
          'dropped-beats',
        ]),
      );
```

Add `openingSpan,` to the file's existing `../../packages/video/src/timeline/cues.ts` import (DOM-free). Inside B4's `if (example === 'backend-slim-request') { … }` block (which B5 extended), after its last assertion, add:

```ts
        // The benchmark moves whenever it speaks and fills its frame as it comes in: every motion
        // check passes, and so does `still` (its first scene used to hold for 1.7 s).
        const motion = JSON.parse(
          readFileSync(join(result.runDir, 'video', 'qc.json'), 'utf8'),
        ) as { checks: Array<{ id: string; status: string; message: string }> };
        for (const id of [
          'still',
          'motion-gap',
          'motion-busy',
          'reading-time',
          'empty-opening',
          'overlap',
          'out-of-frame',
          'dropped-beats',
        ])
          expect(
            motion.checks.find((c) => c.id === id),
            id,
          ).toMatchObject({ status: 'pass' });
        // Its poster is where the byte count lands (R-029), the counter the largest thing on
        // screen, past s1's opening, which B1's render showed with only the Before window up.
        const drawn = JSON.parse(
          readFileSync(join(result.runDir, 'video', 'timeline.json'), 'utf8'),
        ) as Timeline;
        const counting = drawn.scenes.find((s) => s.direction?.beats.some((b) => b.verb === 'count'))!;
        const lands = counting.direction!.beats.find((b) => b.verb === 'count')!;
        expect(posterFrame(drawn)).toBe(
          Math.round((counting.start + lands.t + lands.seconds + 0.3) * drawn.fps),
        );
        expect(posterFrame(drawn) / drawn.fps).toBeGreaterThanOrEqual(
          openingSpan(drawn, 0)?.[1] ?? 0,
        );
        expect(existsSync(join(result.runDir, 'video', 'poster.png'))).toBe(true);
```

These pin what Tasks 1–5 achieved, so they pass once those tasks are in; to see them bite, temporarily set `steady: false` and drop `waits` from `early` in `timeline/motion.ts`, run Step 2's command filtered to `-t "renders backend-slim-request"`, watch `still` fail the assertion, and restore the file.

- [ ] **Step 2: Run the full-pipeline renders**

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "full pipeline"`
Expected: PASS — every example renders with QC not `fail` (so no `out-of-frame` failure anywhere), every `qc.json` lists the seven motion checks, the benchmark passes all eight and has its poster on its landed count, the timing-grammar render (pinned to `--direction off`) passes as before, and the draft test from Task 5 passes.

If the benchmark warns `still` or `motion-gap` here although Task 1's hand render passed, print the check's message (`npx vitest … --reporter verbose` shows the failing id) and compare `video/timeline.json`'s `s1` beats with the hand render's before changing any code; a change to the drafted storyboard since Task 1 is the likeliest cause.

- [ ] **Step 3: The benchmark in Korean, by hand**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --language ko --json > "$RENDER/ko.json"
node -e '
const fs = require("fs"), path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const qc = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "qc.json"), "utf8"));
console.log(r.runDir, qc.status);
for (const c of qc.checks) if (["still","motion-gap","motion-busy","reading-time","empty-opening","overlap","out-of-frame","dropped-beats"].includes(c.id) || c.status !== "pass") console.log(" ", c.id, c.status, c.message);
' "$RENDER/ko.json"
```

Run the `covi video` line in the background and wait. Expected (scratch copy): `pass`, the eight motion checks `pass`. Open `<runDir>/video/contact-sheet.jpg` and `<runDir>/video/poster.png` with the Read tool: `s1` stages the problem (pieces, a filling pile, the counter), the morph is mid-way in `s2`, nothing covers the captions or the narrator, and the poster shows the counter landed on 9,907 with −86% beside the reader steps' 28 and 10, not the opening. Record what the sheet shows, then `rm -rf "$RENDER"`.

- [ ] **Step 4: Commit**

```bash
npx biome check --write tests/render/render.test.ts
npm run lint && npm run typecheck
git add tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Check every rendered example for motion, and pin the benchmark's motion and poster

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 7: The skill's draft-and-critique loop, the documentation, and the full checks

**Files:**
- Modify: `skills/covi-video/SKILL.md` (`## Run it`: the command block, a **Draft, look, revise.** paragraph after B2–B5's **Direction.** paragraph, question 3 of **Review it yourself**; `## Output files`)
- Modify: `docs/video.md` (a `### Draft renders` subsection after B2's `### Direction and the canvas`; `### Composition and rendering`: the poster bullet; `### Quality checks`: the `still` row, seven new rows, the sampling note)
- Modify: `docs/cli.md` (`### covi render`: the options table and a paragraph)
- Modify: `docs/artifacts.md` (`### Video`: the intro sentence, the `video/poster.png` row, and the `video/draft/` rows)
- Modify: `AGENTS.md` (Run outputs tree)
- Modify: `CHANGELOG.md` (one line under `## [Unreleased]`, `### Added`)

**Interfaces:**
- Consumes: the behavior of Tasks 1–6, as documented below.
- Produces: documentation only. `skills/` is linked into `.claude/skills` and `.agents/skills`, so nothing needs regenerating (`npm run agents:check` confirms it). `## Run it` and `## Output files` are agent-only sections (left out of model prompts by `methodologyOf`), which is where the loop belongs: it is how an agent works with the CLI, not methodology a model applies. B7 writes the full direction methodology (when each verb fits, variety rules) and may move or extend this paragraph.

- [ ] **Step 1: `skills/covi-video/SKILL.md`**

In `## Run it`, in the first command block, insert before the line `covi render --run <id> --json                           # narrate, compose, render, check`:

```bash
covi render --run <id> --draft --json                   # a fast draft: look, revise, at most 3 times
```

After B2–B5's **Direction.** paragraph, add:

```markdown
**Draft, look, revise.** Before the real render, check the motion on a draft: `covi render --run <id> --draft --json` renders the same video at half size and 15 fps with the voice alone, in seconds, into `video/draft/`, and leaves the video's own files as they are. Open `video/draft/contact-sheet.jpg` and `video/draft/poster.png` (the poster Covi will use: where the key number's count lands, else the hero after its accent) and read `video/draft/qc.json`, then revise `video/direction.json` (with `"draft": false`) or the storyboard until the checks pass and the sheet and the poster read well:

- `motion-gap`: nothing moves for 1.5 s or more of narration; it names what ends the gap. Pin a beat to a phrase in that stretch with `at`, reveal an element sooner, or add a camera beat.
- `motion-busy`: more than 3 beats start within a second, or more than 2 camera moves within 2 s. Give each beat its own phrase, or drop one.
- `reading-time`: a label, node, packet, pile, or metric name leaves before it can be read (0.4 s plus 15 characters a second, 8 for CJK). Reveal it earlier or shorten it.
- `empty-opening`: a scene shows less than 40% of the frame for 1.5 s or more of narration while it comes in (a before window waiting for its after one). Bring its parts in together, or stage it as a shot that is full from the start.
- `overlap`: two elements of a shot collide. Choose another `layout`, or show fewer elements.
- `out-of-frame` (fails): an element is cut off by the frame. Show fewer lines or elements, or split the shot.
- `dropped-beats`: phrases put a beat out of order (a merge before its split), so it did not play. Quote phrases in the order the beats should play.
- `still`: the rendered picture froze under narration; "where only the camera's slow push-in moves" means the plan had nothing else there: give it a beat.

Stop after three draft rounds even if a warning remains, then render the video with `covi render --run <id> --json` and review it as below.
```

In **Review it yourself**, question 2, add after its first sentence: "Covi takes the poster (`video/poster.png`) where the key number's count lands, else on the hero once its accent has played and the scene has settled, else 1.6 s in: a video with neither gets a weak poster." In question 3, after the sentence about the `still` check, add: "`motion-gap` names the same from the plan, and what ends each gap."

In `## Output files`, add after `video/qc.json`: "and, from `covi render --draft`, `video/draft/` (`preview.mp4`, `poster.png`, `contact-sheet.jpg`, `qc.json`, `timeline.json`, `composition/`): a preview at half size and 15 fps, never the video."

- [ ] **Step 2: `docs/video.md`**

After B2's `### Direction and the canvas` section, add:

````markdown
### Draft renders

`covi render --run <id> --draft` renders the run's video as a draft: the same storyboard and direction at half the width and height (on even pixels) and 15 fps, with the voice alone, so an agent can check the motion in seconds before the real render.

```bash
covi render --run <id> --draft --json
# look at video/draft/contact-sheet.jpg, read video/draft/qc.json, revise video/direction.json
covi render --run <id> --json
```

- **A scaled view, not another video.** Timing never depends on the frame size or rate, and every position scales with the frame, so the draft has the same scenes, beats, captions, and cues at the same moments as the full-size render, and every stop and slot at half (an odd half, such as 683, rounds down to even pixels).
- **What it writes.** `video/draft/preview.mp4`, `video/draft/poster.png` (taken at the same moment as the video's poster), `video/draft/contact-sheet.jpg`, `video/draft/qc.json` (every check of the video's `qc.json`, motion included, except the music's), `video/draft/timeline.json`, and the composition that draws it, `video/draft/composition/`.
- **What it leaves alone.** The storyboard, `speech.json`, `narration.wav`, the captions, the sound files, `video/composition/`, the video, its poster, contact sheet, and `qc.json`, and `video/frames.json`: a draft never makes the next render redraw frames it already has. The run's recorded outcome keeps describing the video; the result says `video.rendered: false` and puts the draft under `video.draft`.
- **Sound.** The narration comes from the speech cache when the lines have not changed; the voice is mastered alone. No music is composed, rendered, or mixed, and no model is called; the real render places the music on the same moments.
- **Checks.** A draft that fails a check (`out-of-frame`) says so in its result; its warnings go to `video/draft/qc.json` and the log, not to the run's warnings.
````

In `### Composition and rendering`, replace the bullet "The poster (`video/poster.png`) is the frame at 1.6 s, or a third of the way in for very short videos." with:

```markdown
- The poster (`video/poster.png`) shows the change at its best, chosen from the timeline: where the key number's count lands (the count that changes its metric the most), 0.3 s on so its change in percent shows beside it, unless it lands while the next scene is entering; else the hero scene once its accent has played and it has settled (its phase plus 0.7 s, or later while its choreography runs); else 1.6 s in, or a third of the way for very short videos. Each moment is held before the next scene starts to enter. The same composition always gives the same poster, and a render that keeps its frames keeps it.
```

In `### Quality checks`, replace the `still` row with:

```markdown
| `still` | ffmpeg `freezedetect` on the media region (noise 0.001, at least 1.5 s) finds no freeze that covers 1.5 s or more of narration. Names the scene, and says when the plan moved nothing there but the camera's slow push-in | warn |
```

and add after B1's `transition-variety` row:

```markdown
| `motion-gap` | The timeline plans something moving through every stretch of narration: no stretch covering 1.5 s or more of it in which no entrance, element entering or playing its choreography, beat, or scene camera move (drift, push-in, the hero's punch) runs. Names the scene and what ends the gap | warn |
| `motion-busy` | No more than 3 beats start within any second, and no more than 2 camera moves (camera beats, and pans and zooms between stops) within any 2 s | warn, naming the scene and the moment |
| `reading-time` | Every word a shot writes on screen (labels, node and packet labels, pile and metric names) is shown, from its entrance or reveal until the next scene starts to enter, for at least 0.4 s plus its characters at 15 a second, or 8 for CJK characters | warn, naming the words, how long they show, and how long they want |
| `empty-opening` | While each card (as `empty-frame` holds them) or shot that lays out elements comes in, from its entrance until it settles, what it visibly draws covers at least 40% of the media region, but for stretches covering less than 1.5 s of narration. Sampled every half second (at most eight times a scene) and measured on what is drawn, so a part laid out but not shown yet does not count | warn, naming the scene, its share, and how long |
| `overlap` | Where each directed scene has settled, no two elements of its shot overlap by more than 4% of the smaller, unless one lies wholly inside the other (a packet on its node, a label set on a capture) | warn, naming the elements and their share |
| `out-of-frame` | Where each directed scene has settled, every element of its shot is drawn inside the region the scene owns, as its stop lays it out (the camera's own framing is not held against it), within 4 px at 1080p | fail |
| `dropped-beats` | Every beat the direction asked for plays: none was left out because phrases put it out of order (a merge before its split, a count-up after its count starts) | warn, naming the scene and the beat |
```

Extend the sampling paragraph (the one starting "Covi samples the layout checks…") with: "Each story scene's opening, from its entrance until it settles, is sampled every half second too (at most eight frames), and each sample carries the box around what the scene visibly draws, which `empty-opening` reads. On the canvas, a directed scene's report also carries each element's box where its stop lays it out, the camera's zoom and push-in undone; `overlap` and `out-of-frame` read it at settled frames, and only for shots that lay out elements (a storyboard visual shown alone is drawn as without direction). A `frames.json` written before Covi reported shots has none, and both checks pass, saying nothing was measured."

- [ ] **Step 3: `docs/cli.md`**

In `### covi render`, add to the options table after the `--workers <n>` row:

```markdown
| `--draft` | Render a fast draft into `video/draft/` instead of the video: half size, 15 fps, the voice alone, with its own poster and contact sheet. The video's own files and the run's outcome are left as they are. See [Draft renders](video.md#draft-renders). |
```

and after the paragraph that starts "`covi render` keeps the settings chosen when the storyboard was drafted", add:

```markdown
With `--draft`, `covi render` checks the storyboard and the direction exactly as a render does (a direction that does not fit the run exits 2 and writes no draft), then writes `video/draft/preview.mp4`, `poster.png`, `contact-sheet.jpg`, `qc.json`, and `timeline.json`. The result has `video.rendered: false` and a `video.draft` object (`path`, `seconds`, `qc`, `width`, `height`, `fps`), and its artifacts are `draftPreview`, `draftPoster`, `draftContactSheet`, `draftQc`, and `draftTimeline`. `covi video --draft` still means "write the drafts and stop".
```

- [ ] **Step 4: `docs/artifacts.md`**

In `### Video`, change the intro sentence to "Written by `covi video`, `covi render`, and `covi ci` when a video is rendered; `covi render --draft` writes only `video/draft/`. See [Video](video.md).", change the `video/poster.png` row's content from "A representative frame" to "The change at its best: where the key number's count lands, else the hero after its accent, else 1.6 s in", and add after the `video/qc.json` row:

```markdown
| `video/draft/preview.mp4` | `draft` | A draft of the video (`covi render --draft`): half size, 15 fps, the voice alone. Never the video |
| `video/draft/poster.png` | `draft` | The draft's poster, at the moment the video's poster is taken |
| `video/draft/contact-sheet.jpg` | `draft` | The draft's contact sheet, tiled like the video's |
| `video/draft/qc.json` | `draft` | The draft's checks: the video's, motion included, without the music's |
| `video/draft/timeline.json` | `draft` | The timeline the draft was drawn from: the video's moments, at the draft's size |
| `video/draft/composition/` | — | The composition that draws the draft (not recorded in `run.json`) |
```

- [ ] **Step 5: `AGENTS.md`**

In the Run outputs tree, replace the last line of the `video/` entry, `                       qc.json`, with:

```
                       qc.json, draft/ (covi render --draft: preview.mp4, poster.png, contact-sheet.jpg,
                       qc.json, timeline.json, composition/)
```

- [ ] **Step 6: `CHANGELOG.md`**

Under `## [Unreleased]`, in its `### Added` list, one line:

```markdown
- Draft and critique: `covi render --run <id> --draft` renders a fast half-size, 15 fps draft with the voice alone into `video/draft/` (preview, poster, contact sheet, QC, timeline) without touching the video; every QC report checks motion (`motion-gap`, `motion-busy`, `reading-time`, `empty-opening`, `overlap`, `dropped-beats` warn; `out-of-frame` fails); the poster shows the change at its best (where the key number lands, else the hero after its accent); a directed shot no longer holds still before its first beat; and the `covi-video` skill drafts, looks, and revises the direction at most three times before rendering.
```

- [ ] **Step 7: Run every check**

Run in the background and wait for each: `npm run check` (lint, typecheck, `agents:check`, `npm test`), then `npm run test:render`.
Expected: both PASS. If `npm run test:render` fails in a test this PR did not touch, check it against `main` before changing anything: a render test that fails on `main` too is not this PR's to fix, and the report says so.

- [ ] **Step 8: Commit**

```bash
git add skills/covi-video/SKILL.md docs/video.md docs/cli.md docs/artifacts.md AGENTS.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document the draft render, the motion checks, the poster, and the critique loop

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
## Self-review

Checked against the spec with fresh eyes, then fixed inline.

- **Spec coverage.** §10 draft render: `covi render --run <id> --draft` (R-006) at half size and 15 fps into `video/draft/` with `preview.mp4`, `contact-sheet.jpg`, `qc.json`, `timeline.json`, reusing cached narration, never touching the final render's files or `frames.json` → Task 5 (unit tests for the spec, the scaled timeline, and the voice master; CLI tests for the refusal and the result; a full-pipeline test that hashes every file of the run before and after). §10 motion QC in both draft and final `qc.json` → Tasks 2–4 (`runQc` serves both): `motion-gap` with the spec's intervals (transitions, camera moves, beats, component choreography via `settledAt` in `shotMotion`, the stop camera's push) → Tasks 1–2; `motion-busy` (> 3 beats in 1 s, > 2 camera moves in 2 s) → Task 2; `reading-time` (0.4 s + characters / 15, CJK / 8) → Task 2; `overlap` (> 4% of the smaller at settled frames, containment by design excluded) → Task 3; `out-of-frame` (fail, at a settled frame) → Task 3. R-023's dropped beats surfaced → Task 2 (`dropped-beats`). The skill's loop (render `--draft`, open the sheet, read the QC, revise `direction.json`, at most 3 rounds, then the final render) → Task 7. The lead's pointers: the benchmark's `still` cause fixed (Task 1) and its default render passing every motion check pinned (Task 6); "the same direction at full size gives the same choreography" → Task 5's scaled-view tests; reconciliation with `still` → Task 2 (one rule, `spokenStills`; `still` names push-only stretches). The lead's addition and R-029: a deterministic poster that shows the change at its best, in the draft and the final render → Task 4 (`posterTime`, pure and DOM-free, unit-tested on each branch: the key count landing ahead of a hero, the largest change among counts, a landing held before the next entrance, a count landing during that entrance passed over for the hero, a hero still settling and one clamped before its exit, the fixed rule), Task 5 (the draft's poster at the video's moment), Task 6 (the benchmark's poster on its landed byte count, past its first scene's opening); an opening that holds a mostly empty frame seen by motion QC → Task 4 (`empty-opening` on what is drawn, sampled through each opening). Docs (`docs/video.md` QC list, poster, and draft section, `docs/cli.md` `--draft`, `docs/artifacts.md`, AGENTS.md run outputs), CHANGELOG under `### Added`, `npm run check` and `npm run test:render` → Task 7. §4.7 spaced beats from 0.15 kept; §14 nothing new reaches the renderer from the agent (QC reads only resolved, redacted timelines and the runtime's own boxes).
- **Placeholders.** None: every code step carries its code. Steps that touch B2–B5 code name the merged function and say what to do when the merged body differs; Task 2's Step 0 branches on how B5 merged R-023 and gives the code for the case where it kept nothing on the timeline.
- **Type consistency.** `CameraPlan.steady`, `cameraPlan`, `ENTERED`, `PUNCH_OUT`, `MotionKind`, `MotionSpan`, `motionSpans` (Task 1, `timeline/motion.ts`); `ShotMotion`, `shotMotion` (Task 1, `timeline/cues.ts`); `STILL_SECONDS`, `Stretch`, `SpokenStill` (`scene`, `seconds`, `at`, `end`), `spokenStills`, `onlyCameraMoves`, `plannedStills`, `motionGapCheck`, `BUSY_BEATS`, `BUSY_MOVES`, `motionBusyCheck`, `READING`, `readingSeconds`, `readingTimeCheck`, `droppedBeatsCheck`, `DroppedBeat`, `SceneDirection.dropped`, `choreographyChecks(timeline)` (Task 2) widened to `choreographyChecks(timeline, layouts)` with `ChoreographyTimeline`, `OVERLAP_SHARE`, `overlapCheck`, `outOfFrameCheck`, `ShotReport`, `LayoutReport.shot`, `unview`, `ShotComponent.placed`, and the exported `settledReports` (Task 3); `ACCENT_OUT`, `COUNTED`, `posterTime`, `openingSpan`, `posterFrame`, `drawnBox`, `LayoutReport.content`, the exported `CARDS`, `emptyOpeningCheck`, and the seven-check `choreographyChecks` (Task 4); `DRAFT_DIR`, `DRAFT_PATHS` (with `poster`), `DRAFT_FPS`, `DRAFT_SCALE`, `draftSpec`, `masterVoice`, `ProduceVideoInput.draftRender`, `ProduceVideoResult.draft`, `ArtifactKind` `'draft'`, `WorkflowResult.video.draft`, `renderWorkflow`'s `draft`, `RenderFlags` (Task 5). Each later use matches its definition.
- **Verification of the plan itself.** Tasks 1–6 were applied to a scratch copy of the repository with B1–B5 applied (the mirror the B5 planner built from B2–B5's plans, with B1's merged `settledReports` and settled-frame sampling ported in), and every test in this plan passed there: the unit suites, `tests/cli.test.ts`, the canvas, morph, and flow render tests, and `COVI_TEST_RENDER=1` for the draft test; the full suite ran 1617 tests green and `biome check .` was clean. By hand: the benchmark rendered `pass` in English and Korean (before Task 1: `still` 1.7 s and 2.1 s in `s1`), its poster the byte counter landed on 9,907 with −86%, by R-029 (draft and final at the same moment); rendered with `--direction off` (B1's look) it warned `empty-opening` on `s1` at 20% for 6.2 s; its draft rendered 960×540 at 15 fps in about 8 s against about 17 s for the video, with identical timings, positions within 0.01 px of half, every pre-existing file of the run byte-identical, and a contact sheet that reads like the video's; five example videos rendered with no `overlap` warning and no `out-of-frame` failure, one `empty-opening` warning (`bugfix-cli-slugify`'s before/after terminal), and posters that show the change (the fixed `slugify` after its morph, the composer with its character count). The mirror is not B1–B5's merged code, so the pre-flight scan stands.
- **Review Focus.** Each of the five lines has its test in the owning task (Tasks 3, 5, 5, 5, 2).

## Rulings

- Ruling: the draft is `ProduceVideoInput.draftRender`, a branch of `produceVideo` after the timeline is built, ending in `renderDraft`, rather than a second pipeline — the storyboard, direction, narration, fitting, and resolution must be exactly the render's for the draft to show the same choreography — the branch keeps a few `if (!draft)` guards in `produceVideo`; a fourth would mean extracting the shared front half.
- Ruling: the draft's timeline is built by the same code at the draft's spec (`draftSpec`: half width and height floored to even pixels, `min(15, fps)`) instead of scaling a full-size timeline — positions come from the frame size everywhere, so nothing has to list the timeline's pixel fields, and timing never reads the size or rate; tests pin identical moments and positions at half within 0.05 px — a future layout rule that rounds to whole pixels could drift a pixel at half size, which the tests catch.
- Ruling: an odd half size (1366 → 683) floors to even pixels (682), so its positions are not exactly half; only its moments are pinned — 4:2:0 video needs even sizes — a custom odd-size video's draft is 0.15% narrower than half.
- Ruling: the draft plays the voice alone, mastered like a mix (`masterVoice`): no music composed, rendered, or mixed, no effects, no model call — the draft exists to judge choreography fast, and music fits the timeline (never the reverse), so the real render places it on the same moments — a viewer of the preview hears no music, and the draft's `qc.json` has no music checks.
- Ruling: the draft writes `preview.mp4`, `poster.png`, `contact-sheet.jpg`, `qc.json`, `timeline.json`, and its own `composition/` (removed and rewritten each time) — the spec's four files, the poster the lead asked for in both renders (so the agent judges it in its loop), and what renders them — none.
- Ruling: a draft writes none of the video's files (storyboard, `speech.json`, `narration.wav`, captions, `narration.md`, sound files, `video/composition/`, the video, poster, contact sheet, `qc.json`, `frames.json`) and leaves the run's outcome as it was — the spec's "never touches the final render's files or `frames.json`", and frame reuse keeps working after a draft — `run.json` still gains the draft's `video` stage and artifact records.
- Ruling: draft files are recorded with a new `ArtifactKind`, `'draft'` — `covi ci` links the first `video` artifact it finds, and a preview must never be linked as the review video — the kind list grows by one (a type; `run.json` has no schema for kinds).
- Ruling: a draft's QC warnings go to the logger and `video/draft/qc.json`, not to the run's warnings — run warnings describe the run's outputs, and an agent iterating three times would pile up stale ones — an agent reading only `run.json` warnings misses them; the skill says to read `video/draft/qc.json`.
- Ruling: `covi render --draft`'s result has `video.rendered: false` and `video.draft` (`path`, `seconds`, `qc`, `width`, `height`, `fps`), with artifacts `draftPreview`, `draftContactSheet`, `draftQc`, `draftTimeline` — `rendered` keeps meaning "the video was rendered" for every consumer — none.
- Ruling: the "writes only under `video/draft/`" test is a full-pipeline render test (it runs `bin/covi.mjs video` and `render --draft` and hashes the run), with a cheap CLI test pinning that a refused draft writes nothing — proving that nothing else changed needs a real render — it runs under `npm run test:render`, not in CI's `npm test`.
- Ruling: a directed scene whose shot has beats pushes in from its entrance (`ENTERED`) at an even pace (`CameraPlan.steady`), instead of waiting for the shot to settle — its beats wait on the line like a visual's pinned moments, which already push in from the entrance in 0.2.0; on the scratch copy an eased push from 0.5 s still froze 1.8 s in Korean, the even one passed both languages — the push is linear (at 2% over a scene, imperceptible as a change of pace), B2's and B3's tests that pinned no push during beats change, and `video.direction: off` is untouched (R-016).
- Ruling: beats without `at` keep starting at 0.15 of the line (spec §4.7); the camera carries the wait — changing the spaced slots would move every directed scene's beats and B2–B5's timing tests — long lines still open with 2 s before their first beat, now moving.
- Ruling: `cameraPlan` moves to DOM-free `timeline/motion.ts`, re-exported by `runtime/camera.ts`, and the runtime tsconfig includes the file — QC must read the plan the runtime draws with, and `runtime/camera.ts` imports `anim.ts`, which carries DOM types Node cannot compile — none.
- Ruling: `motion-gap` follows the spec's motion model, the scene camera's drift, push-in, and punch included — the spec lists the stop camera push; without it every card scene would warn (callouts and summaries settle in under 2 s) and the benchmark could not pass — the model is more lenient than the pixels where the push is too slow to see on thin text (on the scratch copy `api-users-pagination` and `bugfix-cli-slugify` warn `still` while `motion-gap` passes); `still` stays the measured truth.
- Ruling: `still` and `motion-gap` share one threshold (`STILL_SECONDS`, 1.5 s) and one narration rule (`spokenStills`), and `still` adds "where only the camera's slow push-in moves" when the plan has nothing else in a frozen stretch — the reconciliation the program asked for: one rule, two kinds of evidence, each pointing at the other's fix — both may warn about one stretch.
- Ruling: component choreography counts per element, from its reveal until it has entered and played its own (`shotMotion`, whose maximum `shotSettledAt` now is), and each beat as its own span — one span from 0 to `shotSettledAt` would hide every gap between beats — elements of the opening scene, in place at frame 0, still count as moving for their first 0.5 s.
- Ruling: `motion-busy` counts every resolved beat; camera moves are camera beats plus `pan` and `zoom` entrances between two stops — spec §10; push, wipe, and zoom-through entrances are slides, and without a canvas `pan` draws as a push — a hero's punch is not counted as a move.
- Ruling: `reading-time` holds only the words a shot writes (labels, node and packet labels, pile and metric names); code, output, and captures are read with the narration — 0.4 s + characters / 15 would ask 25 s of a 14-line hunk — fast-moving code is left to `narration-pace` and `text-size`.
- Ruling: reading time counts code points without whitespace, CJK characters (Hangul, kana, Han, by `isCjk`) at 8 a second and the rest at 15, character by character — spec "CJK: / 8"; a Korean label with a Latin word blends the two — none.
- Ruling: a word counts as visible from the later of its scene's entrance and its reveal's end until the next scene starts to enter; camera moves that leave it out of view are not subtracted — the timeline alone cannot see what the camera frames without the runtime's geometry — a label the camera zooms away from still counts as shown.
- Ruling: `overlap` and `out-of-frame` read each element's box where its stop lays it out (the camera's beats and push-in undone with `unview`), only at settled frames, and only for shots that lay out elements — a zoom crops the other elements by design and B2's default code zoom shows the start of lines wider than the view; holding those against the frame would fail sound videos — an agent's zoom that crops its own target is not flagged (the contact sheet shows it).
- Ruling: "containment by design" is one box wholly inside the other, within 4 design units — a packet on its node, a label set on a capture; partial overlaps are the collisions people see — a deliberate partial overlap warns.
- Ruling: both frame checks tolerate 4 design units (4 px at 1080p, 2 in the draft) — drawn boxes round, and the draft must judge like the video — a 3 px overhang passes.
- Ruling: a storyboard visual shown alone (`whole`) reports no shot — it is drawn exactly as without direction, and `text-fits`, `captions-clear-of-content`, and B1's checks cover it — a 0.2.0 component drawn past its region is not `out-of-frame`'s to catch.
- Ruling: dropped beats travel on the timeline as `SceneDirection.dropped` (left out when empty), read by `dropped-beats` (warn), beside B5's run warning and note — QC reads the timeline in both the draft and the final render, and an empty list keeps every frames key — if B5 merged another carrier, the pre-flight maps it (Task 2, Step 0).
- Ruling: the poster's frame follows R-029 (which superseded R-026's order) — `posterTime(timeline)` (pure, in DOM-free `timeline/motion.ts`; `posterFrame` puts it on the nearest frame): (1) where the key number's count lands, the `count` whose metric changes the most (the earliest on a tie), 0.3 s on so B4's change in percent shows, passing over a count that lands while the next scene is entering; else (2) the hero scene once its accent has played (phase + `ACCENT_OUT`, 0.7 s) and the scene has settled, held inside the scene half a frame before its exit transition; else (3) the old `Math.min(1.6, duration / 3)`; the same choice in the draft and the final render — the number landing is the clearest single frame of a change: B4 draws it as the largest thing on screen with its change beside it, and it reads at thumbnail size where code and captures do not; every candidate is a settled moment (B3's mid-morph concern holds), and a timeline-only choice keeps one composition to one poster when frames are reused — a UI change whose agent also counted an incidental number gets the number, not its hero, as its poster; this supersedes B3's "the poster stays at 1.6 s".
- Ruling: `empty-opening` measures what the scene visibly draws (`drawnBox`: text, images, SVG shapes, and boxes with a fill, border, or shadow, at a cumulative opacity above 0.1, clipped to the scene's region), not the layout items — components report parts laid out before they are shown (a terminal's After window at opacity 0), so the items would call the B1 poster frame full — `drawnBox` reads computed styles at every layout sample (a few dozen per video, milliseconds each), and a part drawn transparent by a means other than opacity (a clip-path wipe in progress) counts as drawn.
- Ruling: `empty-opening` holds the scenes `empty-frame` holds (B1's `CARDS` by lead kind) plus shots that lay out elements, through each scene's opening (from its entrance to `settledSpan`'s start), sampled every 0.5 s at most eight times, and warns when frames under 40% of the media region (B1's `EMPTY_SHARE`) cover 1.5 s or more of narration (`spokenStills`, `still`'s rule) — one emptiness threshold and one narration rule across the checks; captures, titles, and summaries keep the exemptions B1 gave them — an empty stretch shorter than the half-second sampling can be missed, and a long opening's eight samples are up to its length / 8 apart.
- Ruling: the hero's ring length becomes `ACCENT_OUT` in `timeline/motion.ts`, shared by the runtime's `heroAccent` and the poster — one value for "the accent has played" — none.
- Ruling: the loop lives in the skill's agent-only `## Run it` section, at most three rounds, with no configuration key — it is how an agent works, not a choice a person makes; CI and `covi video` without an agent never draft (parity) — B7 may move it into the direction methodology.
- Ruling: QC ids, messages, and CLI logs are English, with no catalog keys — as every QC message — none.
