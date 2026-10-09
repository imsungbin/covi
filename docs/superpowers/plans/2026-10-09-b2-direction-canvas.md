# PR B2 — Direction file and canvas stage (the foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent can direct a review video with a bounded, schema-validated `video/direction.json` (verbs `place`, `reveal`, `camera`), every video is drawn on one large canvas whose camera pans and zooms between scene stops, and a deterministic default director gives runs without an agent the same motion; `video.direction: off` renders exactly as 0.2.0.

**Architecture:** A new Node module `packages/video/src/direction/` validates the direction against the storyboard and `evidence.json`, merges it over the default director's shots, decides each scene's entrance before timing (a shot's `enter` shapes the overlap like a storyboard `transition`, R-008), and after timing resolves every shot into concrete, redacted content (code lines, command output, images, labels) laid out in stop-local slots, with beats timed to narration phrases. The resolved `SceneStaging` (a `stop` and a `direction`) rides on each `TimelineScene`. The browser runtime adds `runtime/canvas.ts` (pure camera math) and `runtime/direction/elements.ts` (shot elements), and the stage translates each scene's media layer by its stop minus the camera, clips it to the scene's region, and moves a dot grid with the camera. Header, narrator, captions, progress, and the hero accent stay in screen space.

**Tech Stack:** TypeScript on Node 22.18+ (no build step), Zod 4, Vitest 5, Playwright Chromium, ffmpeg; browser runtime bundled by esbuild.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` — §4 (direction file), §5 (canvas stage), §14 (security), §3, §15–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-006, R-008, R-009, R-012–R-016 bind this PR). Code worktree: `~/projects/covi-direction`, branch `direction-canvas`, started from the latest `main` after B1 (density checks) merged.

## Global Constraints

Every task's requirements include these. Values are copied from the spec, the rulings, and `AGENTS.md`.

- TypeScript on Node 22.18+, run without a build step: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Dependency direction: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Nothing imports `cli`. `core`, `brand`, and `audio` import no other Covi package. Browser runtime files (`packages/video/src/runtime/**`) import only DOM-free shared files (`timeline/types.ts`, `timeline/cues.ts`, `runtime/*`, `@covi/brand`); Node code never imports a runtime file that uses DOM types (`runtime/layout.ts` is DOM-free and already shared).
- Runtime: every visual property is a pure function of the frame time. No `Date`, no `Math.random` (seeded helpers only: `seededRandom` from `@covi/core` in Node, `seeded` in `runtime/anim.ts`), no CSS transitions or animations. All text is set with `textContent` (or `el(…, text)`), never `innerHTML`, except code lines through `highlightLine`, which escapes.
- Schemas: Zod, every object `z.strictObject` (unknown keys rejected), enums wherever a choice exists, every list, string, number, and duration bounded. `video/direction.json` is `schemaVersion: 1`. `video/timeline.json` stays `version: 1` (fields are additive). Never change any `version` field anywhere. The storyboard schema stays unchanged (`TRANSITION_KINDS` keeps its five kinds).
- `DIRECTION_LIMITS` (exported, single source; tests import it): `fileBytes 262144 · shots 24 · elementsPerShot 8 · beatsPerShot 12 · id /^[a-z][a-z0-9-]{0,23}$/ · labelChars 32 · phraseChars 200 (as sync) · zoom [1, 2.5] · lines: from/to ints within the hunk, span ≤ 40 · drawnItems 12 · evidence ids per element ≤ 4 (EVIDENCE_LIMITS.id length each)`.
- Labels (`node.label`, `label.text`): 1–32 characters after trim, from the allowlist — Unicode letters and marks (`\p{L}\p{M}`), spaces, and `-–—·,.'’:()/&+?!`. No digits (`\p{Nd}`), no `<>{}[]"\`=@#$%^*|~;_`, no control characters. Strings containing `://` or starting with `www.` are rejected. Labels pass through the run's `Redactor`. The agent never authors executable code, CSS, HTML, selectors, or URLs for the renderer; element content comes only from evidence ids.
- Validation of an authored direction: exit 2 (`UsageError`), all problems listed at once. A direction with `"draft": true` is not validated against the current storyboard: the default director re-derives it at render (R-009).
- Everything resolved is redacted (`run.redactor.redactDeep`) before it is written into `timeline.json` or the composition.
- Direction never changes scene timing, except that a shot's `enter` is the scene's entrance kind and so shapes the overlap exactly like a storyboard `transition` does (R-008).
- Canvas: each story scene is a stop, a frame-sized region in world coordinates placed along a deterministic path seeded by the timeline seed (R-014): mostly to the right, turning down every 2–4 stops; the hero's stop is offset so the camera must pull back to reach it; stops are separated by a gap of 0.25 frame widths. `TimelineScene.stop: { x, y }` records it (absent when `video.direction` is `off`).
- Entrances: `TransitionKind` gains `pan` (0.7 s) and `zoom` (0.9 s), lengths in `@covi/brand` `motion.transitions`. Default rotation (when neither shot nor storyboard sets one): the hero → `zoom`; before/after captures → `wipe`; a scene showing the same evidence as the previous → `cut`; otherwise alternate `pan` and `push`; the outro keeps `fade`.
- Configuration: `video.direction`: `auto` (default) | `off`. `off` renders exactly as 0.2.0 did: no canvas, no direction (R-016). Flag `--direction auto|off` on `covi video` and `covi render`. CI and `--json` runs without an agent get the default director (interactive/non-interactive parity).
- `covi video --draft` also writes `video/direction.json` with `"draft": true` (R-006). `covi render` reads it.
- QC checks this program adds warn; only `out-of-frame` (B6) and `music-jump` (A1) fail (R-007).
- Text for people goes through `templates/i18n/{en,ko,ja,zh}.yml`; validation messages and CLI logs stay in English (as storyboard validation messages are). This PR adds no fixed on-screen strings.
- Commits: default git identity (never Claude as author or co-author); concise English message ending with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Each task leaves `npm run check` green.
- Long commands (`npm test`, `npm run check`, renders) run in the background; wait for them to finish before reporting.

## B1 names this plan builds on

B1 (density checks) merges before this PR starts. Its plan is `~/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b1-density-checks.md`; this plan uses its names. Read B1's merged code first; where a name differs from its plan, use the merged name and keep the behavior described here:

- `LayoutItem` (in `packages/video/src/timeline/types.ts`) has `font?: number` (px as drawn, including the camera's scale) and `text?: 'code' | 'body' | 'meta'`.
- `packages/video/src/density.ts` has `leadKind(scene: Pick<TimelineScene, 'visual'>): string` ("for B2 to extend"), `monotonyCheck`, `transitionVarietyCheck` (counts `s.transition?.kind ?? 'fade'`, so new kinds count by themselves), `emptyFrameCheck` (cards only, read through a `CARDS` set of visual kinds), `textSizeCheck`, and `densityChecks`, all `warn` (R-007), run by `runQc`. They read layout reports only at each story scene's settled frame: `settledSpan`/`settledFrame` in `timeline/cues.ts` (after the entrance and `settledAt` of the visual, before the next entrance), which the renderer samples.
- `drawnFont(node)` in `runtime/components/types.ts` measures the font as drawn from the DOM (`getBoundingClientRect().width / offsetWidth`), so an ancestor's transform (the canvas camera's scale) is included by itself.
- B1's `covi video (full pipeline)` render loop in `tests/render/render.test.ts` includes `backend-slim-request` (`--standard`) and reads each run's `runDir`.
- `examples/backend-slim-request/` exists (the benchmark, R-005).

## Review Focus

The five inputs or conditions the spec implies that a person will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **A storyboard rewritten after `covi video --draft`, with `video/direction.json` still `"draft": true` and naming scenes that no longer exist** — `covi render` must render (the default director re-derives the shots), never fail. Test: Task 6, `direction-plan.test.ts` "ignores a stale draft".
2. **Editing only a scene's `evidenceIds` (citations) and re-rendering** — the default director must make the same choices, so the frames are reused (the sound test's `framesReused` depends on it). Test: Task 4, `director.test.ts` "reads what scenes show, never what they cite".
3. **A secret inside a diff hunk that a `code` element shows** — it must be masked in the resolved timeline before the composition is written. Test: Task 5, `direction-resolve.test.ts` "redacts everything it resolves".
4. **A Korean or Japanese label in an English video** — the composition must embed the CJK font slices the label needs, or a Linux runner draws boxes. Test: Task 1, `staging.test.ts` "embeds the CJK fonts a label needs".
5. **A camera zoom of up to 2.5× inside a stop** — content pushed past the media region must be clipped and reported clipped, so `captions-clear-of-content` (a fail) and the narrator check never see it. Test: Task 8, `tests/render/canvas.test.ts` "clips what the camera magnifies to the scene's region".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/video/src/timeline/types.ts` | 1 | `TransitionKind` + `pan`/`zoom`, `CAMERA_TRANSITIONS`, `Stop`, `DirectionElement`, `DirectionBeat`, `SceneDirection`, `SceneStaging`, `TimelineScene.stop`/`.direction` |
| `packages/brand/src/tokens.ts` | 1 | `motion.transitions.pan` 0.7, `.zoom` 0.9 |
| `packages/video/src/runtime/transitions.ts` | 1 | `pan`/`zoom` drawn like `push`/`zoom-through` when there is no canvas |
| `packages/video/src/timeline/cues.ts` | 1, 8, 10 | whoosh for `pan`/`zoom`; `shotSettledAt`; B1's `settledSpan` reads it |
| `packages/video/src/timeline/build.ts` | 1, 5 | entrances through `sceneTransition`/`layoutScenes`/`fitToDuration`/`buildTimeline`; staging attached; `phraseMoment` |
| `packages/video/src/direction/schema.ts` | 2 | Zod schema, `DIRECTION_LIMITS`, label allowlist, `readDirectionFile`, `DIRECTION_PATH` |
| `packages/video/src/direction/sources.ts` | 3 | evidence id → hunk lines, command output, capture image; `hunkView` |
| `packages/video/src/direction/refs.ts` | 3 | `directionProblems`: scenes, ids, kinds, evidence, sides, lines, phrases |
| `packages/video/src/direction/director.ts` | 4 | `defaultDirection`, `entrances` (rotation), `mergeDirection` |
| `packages/video/src/direction/stops.ts` | 5 | `canvasStops` |
| `packages/video/src/direction/layout.ts` | 5 | `elementSlots`, `shotRegion` |
| `packages/video/src/direction/resolve.ts` | 5 | `resolveDirection`, `directionImages` |
| `packages/video/src/direction/plan.ts` | 6 | `planDirection`: read → validate → merge → entrances |
| `packages/video/src/grounding.ts` | 5 | `sceneEvidence` counts shot elements |
| `packages/video/src/pipeline.ts` | 6 | wiring |
| `packages/core/src/config/schema.ts`, `config/resolve.ts` | 6 | `video.direction`, `COVI_VIDEO_DIRECTION` |
| `packages/cli/src/main.ts`, `workflows.ts` | 2, 6 | `covi schema direction`, `--direction`, passing the setting, the artifact |
| `packages/video/src/runtime/layout.ts` | 7 | `gridSpacing` |
| `packages/video/src/runtime/canvas.ts` | 7 | camera math (pure) |
| `packages/video/src/runtime/camera.ts` | 8 | camera plan reads the shot's settle time |
| `packages/video/src/runtime/stage.ts` | 8, 9 | canvas layers, camera between stops, clip, grid, report |
| `packages/video/src/runtime/styles.ts` | 8, 9 | `.canvas-grid`, `.dlabel`, `.dnode` |
| `packages/video/src/runtime/direction/elements.ts` | 9 | `mountShot`, node and label elements, reveals |
| `packages/video/src/density.ts` (B1) | 10 | `leadKind` reads a shot's first element; `empty-frame` filters by it |
| `tests/direction-security.test.ts` | 2, 3, 9 | the acceptance security test (§14) |
| `tests/render/canvas.test.ts` | 8, 9 | canvas render tests |
| `tests/render/render.test.ts` | 6, 10 | the timing-grammar render pins `--direction off`; every full-pipeline example renders on the canvas |
| docs, `AGENTS.md`, skill, CHANGELOG | 11 | documentation |

---
### Task 1: Timeline grammar for the canvas — entrances `pan` and `zoom`, stops, and resolved shots on the timeline

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (the `TransitionKind` union at line 29; `TimelineScene` at lines 171–201)
- Modify: `packages/brand/src/tokens.ts:159-175` (`motion.transitions` and its comment)
- Modify: `packages/video/src/runtime/transitions.ts:36-80` (`entering`, `leaving`)
- Modify: `packages/video/src/timeline/cues.ts:631-641` (`WHOOSH` and the `buildCues` comment)
- Modify: `packages/video/src/timeline/build.ts` (`sceneTransition` lines 65–69, `layoutScenes` 274–349, `fitToDuration` 364–393, `BuildTimelineInput` 414–426, `buildTimeline` 433–526)
- Test: `packages/video/test/timeline-grammar.test.ts`, `packages/video/test/pacing.test.ts`, `packages/video/test/motion.test.ts`, `packages/video/test/cues-hero.test.ts`
- Create: `packages/video/test/staging.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  ```ts
  // packages/video/src/timeline/types.ts
  export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through' | 'pan' | 'zoom';
  export const CAMERA_TRANSITIONS = ['pan', 'zoom'] as const satisfies readonly TransitionKind[];
  export interface Stop { x: number; y: number }
  export type RevealStyle = 'rise' | 'pop' | 'wipe' | 'type';
  export type CameraMove = 'zoom' | 'pan' | 'follow';
  export type DirectionElement =
    | { id: string; kind: 'visual'; rect: Rect }
    | { id: string; kind: 'code'; rect: Rect; visual: Extract<TimelineVisual, { kind: 'code' }> }
    | { id: string; kind: 'output'; rect: Rect; visual: Extract<TimelineVisual, { kind: 'terminal' }> }
    | { id: string; kind: 'capture'; rect: Rect; visual: Extract<TimelineVisual, { kind: 'screenshot' }> }
    | { id: string; kind: 'node'; rect: Rect; label: string }
    | { id: string; kind: 'label'; rect: Rect; text: string; tone: 'neutral' | 'warning' | 'success' };
  export type DirectionBeat =
    | { verb: 'reveal'; element: string; style: RevealStyle; t: number; seconds: number }
    | { verb: 'camera'; move: CameraMove; to: string; zoom?: number; t: number; seconds: number };
  export interface SceneDirection { whole: boolean; elements: DirectionElement[]; beats: DirectionBeat[] }
  export interface SceneStaging { stop: Stop; direction: SceneDirection }
  // TimelineScene gains: stop?: Stop; direction?: SceneDirection;

  // packages/video/src/timeline/build.ts
  export function sceneTransition(scene: Pick<Scene, 'transition' | 'hero'>, entrance?: TransitionKind): SceneTransition;
  export function layoutScenes(scenes, speech, extraHold?, language?, pacing?, entrances?: ReadonlyMap<string, TransitionKind>): Layout;
  export function fitToDuration(storyboard, speech, spec, language?, pacing?, entrances?: ReadonlyMap<string, TransitionKind>): FitResult;
  // BuildTimelineInput gains:
  //   entrances?: ReadonlyMap<string, TransitionKind>;      // keyed by scene id
  //   staging?: ReadonlyArray<SceneStaging | undefined>;    // aligned with `scenes`
  ```

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/timeline-grammar.test.ts`, add `CAMERA_TRANSITIONS` to the imports (`import { CAMERA_TRANSITIONS } from '../src/timeline/types.ts';`) and replace the last line of the first test (`expect(Object.keys(motion.transitions).sort()).toEqual([...TRANSITION_KINDS].sort());`) with:

```ts
    expect(Object.keys(motion.transitions).sort()).toEqual(
      [...TRANSITION_KINDS, ...CAMERA_TRANSITIONS].sort(),
    );
```

and add this test to the same `describe('transitions in the timeline', …)`:

```ts
  it('take the entrance direction gives over the scene’s own transition and the hero default', () => {
    expect(sceneTransition({ hero: true }, 'zoom')).toEqual({ kind: 'zoom', seconds: 0.9 });
    expect(sceneTransition({ transition: 'push' }, 'pan')).toEqual({ kind: 'pan', seconds: 0.7 });
    expect(sceneTransition({ transition: 'wipe' }, undefined)).toEqual({
      kind: 'wipe',
      seconds: 0.55,
    });
  });
```

In `packages/video/test/pacing.test.ts`, add `import { CAMERA_TRANSITIONS } from '../src/timeline/types.ts';` and, inside `describe('the timing grammar', …)` after the first test:

```ts
  it('times a camera move between stops like any transition, by its own length', () => {
    for (const kind of CAMERA_TRANSITIONS) {
      const entrances = new Map([['s2', kind]]);
      const [a, b] = layoutScenes(three(), lines, new Map(), 'en', TIGHT, entrances).scenes;
      const d = motion.transitions[kind];
      expect(b!.start, kind).toBeCloseTo(cutStart(a!.speechEnd, a!.speechEnd + LINE_GAP, d), 3);
      expect(a!.end, kind).toBeCloseTo(b!.start + d, 3);
      // Longer than a fade: the scene before a camera move ends at most 0.35 + 0.4·d after its line.
      expect(a!.end - a!.speechEnd, kind).toBeLessThanOrEqual(LINE_GAP + 0.4 * d + 1e-9);
    }
    const storyboard = {
      schemaVersion: 1,
      title: 'T',
      template: 't',
      draft: false,
      scenes: three(),
    } as Storyboard;
    const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' });
    const zoom = new Map([['s3', 'zoom' as const]]);
    expect(fitToDuration(storyboard, lines, spec, 'en', TIGHT, zoom).layout).toEqual(
      layoutScenes(three(), lines, new Map(), 'en', TIGHT, zoom),
    );
  });
```

In `packages/video/test/motion.test.ts`, inside `describe('scene transitions', …)`:

```ts
  it('draw a camera move like the move it resembles when there is no canvas', () => {
    for (const k of [0, 0.3, 0.7, 1]) {
      expect(entering('pan', k, U, W)).toEqual(entering('push', k, U, W));
      expect(leaving('pan', k, U, W)).toEqual(leaving('push', k, U, W));
      expect(entering('zoom', k, U, W)).toEqual(entering('zoom-through', k, U, W));
      expect(leaving('zoom', k, U, W)).toEqual(leaving('zoom-through', k, U, W));
    }
  });
```

In `packages/video/test/cues-hero.test.ts`, inside `describe('transition whooshes', …)`:

```ts
  it('sound mid-move when the camera pans or zooms to the next stop', () => {
    const cues = buildCues([
      scene('a', 0, 4),
      scene('b', 4, 8, { transition: { kind: 'pan', seconds: 0.7 } }),
      scene('c', 8, 12, { transition: { kind: 'zoom', seconds: 0.9 } }),
    ]);
    expect(cues.map((c) => [c.kind, c.scene, c.detail, +c.t.toFixed(6)])).toEqual([
      ['transition', 'b', 'pan', 4.35],
      ['transition', 'c', 'zoom', 8.45],
    ]);
  });
```

Create `packages/video/test/staging.test.ts`:

```ts
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, OUTRO_ID, pacingFor } from '../src/timeline/build.ts';
import type { SceneStaging, TransitionKind } from '../src/timeline/types.ts';

const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const scenes = ['s1', 's2', 's3'].map(
  (id) => ({ id, beat: id, narration: 'A short line here.', visual: callout }) as Scene,
);
const image = () => ({ src: 'a.png', width: 1, height: 1 });
const staged = (text: string, x: number): SceneStaging => ({
  stop: { x, y: 0 },
  direction: {
    whole: false,
    elements: [
      { id: 'note', kind: 'label', rect: { x: 0, y: 0, width: 100, height: 40 }, text, tone: 'neutral' },
    ],
    beats: [],
  },
});

describe('a timeline with direction', () => {
  const entrances = new Map<string, TransitionKind>([
    ['s2', 'pan'],
    ['s3', 'zoom'],
  ]);
  const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec), entrances);
  const timeline = buildTimeline({
    title: 'T',
    scenes,
    layout,
    spec,
    image,
    entrances,
    staging: [staged('One', 0), staged('Two', 2400), staged('요청', 4800)],
  });

  it('gives each story scene its stop, shot, and entrance; the outro stays off the canvas', () => {
    const [s1, s2, s3] = timeline.scenes;
    expect(s1).toMatchObject({ stop: { x: 0, y: 0 } });
    expect(s1!.transition).toBeUndefined();
    expect(s2).toMatchObject({ stop: { x: 2400, y: 0 }, transition: { kind: 'pan', seconds: 0.7 } });
    expect(s3!.transition).toEqual({ kind: 'zoom', seconds: 0.9 });
    expect(s2!.direction!.elements[0]).toMatchObject({ kind: 'label', text: 'Two' });
    const outro = timeline.scenes.at(-1)!;
    expect(outro.id).toBe(OUTRO_ID);
    expect(outro).not.toHaveProperty('stop');
    expect(outro).not.toHaveProperty('direction');
    expect(timeline.cues.filter((c) => c.kind === 'transition').map((c) => c.detail)).toEqual([
      'pan',
      'zoom',
    ]);
  });

  it('embeds the CJK fonts a label needs, even in an English video', () => {
    expect(timeline.language).toBe('en');
    expect(timeline.fonts.cjk).toEqual(['ko']);
  });

  it('leaves a timeline without direction as it was', () => {
    const plain = buildTimeline({
      title: 'T',
      scenes,
      layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
      spec,
      image,
    });
    expect(plain.scenes.some((s) => 'stop' in s || 'direction' in s)).toBe(false);
    expect(plain.scenes[1]!.transition).toEqual({ kind: 'fade', seconds: 0.45 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/timeline-grammar.test.ts packages/video/test/pacing.test.ts packages/video/test/motion.test.ts packages/video/test/cues-hero.test.ts packages/video/test/staging.test.ts`
Expected: FAIL — `CAMERA_TRANSITIONS` is not exported, `sceneTransition` ignores its second argument, `motion.transitions.pan` is undefined, and `buildTimeline` has no `staging`.

- [ ] **Step 3: Implement**

`packages/video/src/timeline/types.ts` — replace the `TransitionKind` line and add, right after it:

```ts
/** How a scene enters: the transition into it (see `motion.transitions` for their lengths). */
export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through' | 'pan' | 'zoom';

/**
 * Entrances that move the canvas camera from the scene before to this scene's stop: `pan` glides
 * there, `zoom` pulls back to show both stops and pushes into the next. Only direction gives them.
 */
export const CAMERA_TRANSITIONS = ['pan', 'zoom'] as const satisfies readonly TransitionKind[];

/** A scene's stop on the canvas: the top-left corner of its frame-sized region, in world pixels. */
export interface Stop {
  x: number;
  y: number;
}

/** How a revealed element enters. */
export type RevealStyle = 'rise' | 'pop' | 'wipe' | 'type';
/** How a camera beat moves inside a stop. */
export type CameraMove = 'zoom' | 'pan' | 'follow';

/**
 * An element of a directed scene, resolved: content from the run's evidence (never from the
 * agent, labels excepted) and its slot in stop-local stage pixels. Code, output, and captures are
 * drawn by the components that draw those visuals, inside their slot.
 */
export type DirectionElement =
  | { id: string; kind: 'visual'; rect: Rect }
  | { id: string; kind: 'code'; rect: Rect; visual: Extract<TimelineVisual, { kind: 'code' }> }
  | {
      id: string;
      kind: 'output';
      rect: Rect;
      visual: Extract<TimelineVisual, { kind: 'terminal' }>;
    }
  | {
      id: string;
      kind: 'capture';
      rect: Rect;
      visual: Extract<TimelineVisual, { kind: 'screenshot' }>;
    }
  | { id: string; kind: 'node'; rect: Rect; label: string }
  | {
      id: string;
      kind: 'label';
      rect: Rect;
      text: string;
      tone: 'neutral' | 'warning' | 'success';
    };

/** A beat, resolved: when it starts (seconds since the scene started) and how long it takes. */
export type DirectionBeat =
  | { verb: 'reveal'; element: string; style: RevealStyle; t: number; seconds: number }
  | { verb: 'camera'; move: CameraMove; to: string; zoom?: number; t: number; seconds: number };

/** A scene's shot, resolved. */
export interface SceneDirection {
  /** The shot shows only the storyboard's visual, laid out exactly as it is without direction. */
  whole: boolean;
  elements: DirectionElement[];
  /** In time order. */
  beats: DirectionBeat[];
}

/** What direction adds to a story scene: its stop on the canvas and its resolved shot. */
export interface SceneStaging {
  stop: Stop;
  direction: SceneDirection;
}
```

`DirectionElement` refers to `TimelineVisual`, which is declared later in the file; type aliases are hoisted, so that is fine. In `interface TimelineScene`, after `cues?`:

```ts
  /** Its stop on the canvas; absent when `video.direction` is off (no canvas) and on the outro. */
  stop?: Stop;
  /** Its shot: from `video/direction.json` or Covi's default director, resolved. */
  direction?: SceneDirection;
```

`packages/brand/src/tokens.ts` — replace the `transitions` comment and line:

```ts
  /**
   * Each scene transition's length in seconds; a cut has none. The storyboard's kinds stay under
   * 0.625 s, so the scene before them ends at most 0.6 s after its line (see the video timeline).
   * The canvas camera's moves take longer: a pan glides to the next stop, and a zoom pulls back to
   * show both stops and pushes into the next one.
   */
  transitions: {
    fade: 0.45,
    cut: 0,
    push: 0.5,
    wipe: 0.55,
    'zoom-through': 0.6,
    pan: 0.7,
    zoom: 0.9,
  },
```

`packages/video/src/runtime/transitions.ts` — in `entering`, make `push` and `zoom-through` take the camera kinds too:

```ts
    // Without a canvas (a timeline with no stops), a camera move draws as the move it resembles.
    case 'push':
    case 'pan': {
      const e = easeInOutCubic(k);
      return { ...REST, x: (1 - e) * width };
    }
```

```ts
    case 'zoom-through':
    case 'zoom': {
      const e = easeOutCubic(k);
      return { ...REST, opacity: e, scale: 0.92 + 0.08 * e };
    }
```

and in `leaving`:

```ts
    case 'push':
    case 'pan':
      return { ...REST, x: -easeInOutCubic(k) * width };
    case 'zoom-through':
    case 'zoom': {
      const e = easeInCubic(k);
      return { ...REST, opacity: 1 - e, scale: 1 + 0.12 * e };
    }
```

`packages/video/src/timeline/cues.ts`:

```ts
/** Transitions that move the picture, and so get a whoosh: the camera's moves between stops too. */
const WHOOSH: ReadonlySet<TransitionKind> = new Set(['push', 'wipe', 'zoom-through', 'pan', 'zoom']);
```

and in the `buildCues` comment, change "for a scene that pushes, wipes, or zooms through" to "for a scene that pushes, wipes, or zooms through, or that the camera pans or zooms to".

`packages/video/src/timeline/build.ts`:

1. Add `type SceneStaging` and `type TransitionKind` to the import from `./types.ts`.
2. Replace `sceneTransition`:

```ts
/**
 * How a scene enters: the entrance direction gave it, else its own transition, else zoom-through
 * into the hero, else a fade.
 */
export function sceneTransition(
  scene: Pick<Scene, 'transition' | 'hero'>,
  entrance?: TransitionKind,
): SceneTransition {
  const kind = entrance ?? scene.transition ?? (scene.hero ? 'zoom-through' : 'fade');
  return { kind, seconds: motion.transitions[kind] };
}
```

3. `layoutScenes` gains a last parameter `entrances: ReadonlyMap<string, TransitionKind> = new Map()` (document it in the function comment: "`entrances`, by scene id, are the entrances direction gave (R-008): they shape the overlap like a storyboard `transition`") and its `const { seconds } = sceneTransition(scene);` becomes `const { seconds } = sceneTransition(scene, entrances.get(id));`.
4. `fitToDuration` gains a last parameter `entrances: ReadonlyMap<string, TransitionKind> = new Map()` and passes it to both `layoutScenes` calls: `layoutScenes(scenes, speech, new Map(), language, pacing, entrances)`.
5. `BuildTimelineInput` gains:

```ts
  /** The entrances direction gave, by scene id (see `layoutScenes`). */
  entrances?: ReadonlyMap<string, TransitionKind>;
  /** Each story scene's stop and resolved shot, aligned with `scenes`; absent: no canvas. */
  staging?: ReadonlyArray<SceneStaging | undefined>;
```

6. In `buildTimeline`'s scene map, use the entrance and attach the staging:

```ts
    const transition = i > 0 ? sceneTransition(scene, input.entrances?.get(timing.id)) : undefined;
    const staged = input.staging?.[i];
```

and add `...(staged ? { stop: staged.stop, direction: staged.direction } : {}),` after the `cues` spread in the returned scene object. The CJK font detection a few lines below already serializes `scenes`, so a label's script now selects its font slices.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/timeline-grammar.test.ts packages/video/test/pacing.test.ts packages/video/test/motion.test.ts packages/video/test/cues-hero.test.ts packages/video/test/staging.test.ts`
Expected: PASS.

Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS. The storyboard's `TRANSITION_KINDS` still lists five kinds (`grammar.test.ts` pins it), so an agent's storyboard cannot ask for `pan` or `zoom`; only direction can.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/timeline packages/brand/src/tokens.ts packages/video/src/runtime/transitions.ts packages/video/test
git commit -m "$(cat <<'EOF'
Add pan and zoom entrances, stops, and resolved shots to the timeline

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 2: The direction file — schema, `DIRECTION_LIMITS`, the label allowlist, and `covi schema direction`

**Files:**
- Create: `packages/video/src/direction/schema.ts`
- Modify: `packages/video/src/index.ts` (exports)
- Modify: `packages/cli/src/main.ts:1378-1405` (`covi schema`: the argument help and the `schemas` map)
- Create: `packages/video/test/direction-schema.test.ts`
- Create: `tests/direction-security.test.ts`
- Modify: `tests/cli.test.ts:369-388` (`prints JSON schemas, …`)

**Interfaces:**
- Consumes: `TRANSITION_KINDS` (`packages/video/src/storyboard/schema.ts`), `CAMERA_TRANSITIONS` (Task 1), `EVIDENCE_LIMITS`, `parseOrThrow`, `UsageError` (`@covi/core`).
- Produces:
  ```ts
  // packages/video/src/direction/schema.ts
  export const DIRECTION_PATH = 'video/direction.json';
  export const DIRECTION_HINT: string;
  export const DIRECTION_LIMITS: { fileBytes: 262144; shots: 24; elementsPerShot: 8; beatsPerShot: 12;
    idChars: 24; labelChars: 32; phraseChars: 200; sceneIdChars: 64; zoom: { min: 1; max: 2.5 };
    lineSpan: 40; drawnItems: 12; evidencePerElement: 4 };
  export const DIRECTION_ID: RegExp;               // /^[a-z][a-z0-9-]{0,23}$/
  export const ENTRANCE_KINDS: readonly ['fade','cut','push','wipe','zoom-through','pan','zoom'];
  export const SHOT_LAYOUTS: readonly ['auto','single','row','column','split'];
  export const REVEAL_STYLES: readonly ['rise','pop','wipe','type'];
  export const CAMERA_MOVES: readonly ['zoom','pan','follow'];
  export const LABEL_TONES: readonly ['neutral','warning','success'];
  export const LabelSchema: z.ZodType<string>;
  export const ShotElementSchema, ShotBeatSchema, ShotSchema, DirectionSchema;
  export type Direction = z.output<typeof DirectionSchema>;   // { schemaVersion: 1; draft: boolean; shots: Shot[] }
  export type DirectionInput = z.input<typeof DirectionSchema>;
  export type Shot = z.output<typeof ShotSchema>;              // { scene; enter?; layout?; elements; beats }
  export type ShotElement = z.output<typeof ShotElementSchema>;
  export type ShotBeat = z.output<typeof ShotBeatSchema>;
  export type ShotLayout = (typeof SHOT_LAYOUTS)[number];
  /** The run's direction file, or undefined when there is none. Throws UsageError (exit 2). */
  export function readDirectionFile(path: string): Promise<Direction | undefined>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-schema.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DIRECTION_LIMITS,
  type DirectionInput,
  DirectionSchema,
  LabelSchema,
  readDirectionFile,
} from '../src/direction/schema.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const shot = (extra: Record<string, unknown> = {}) => ({
  scene: 's3',
  elements: [{ id: 'visual', kind: 'visual' }],
  ...extra,
});
const valid: DirectionInput = {
  schemaVersion: 1,
  shots: [
    {
      scene: 's3',
      enter: 'pan',
      layout: 'row',
      elements: [
        { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:12', side: 'head' },
        { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
        { id: 'page', kind: 'capture', evidence: 'screenshot:home-after' },
        { id: 'reader', kind: 'node', label: 'Reader worker', evidence: ['diff-hunk:src/r.js:3'] },
        { id: 'warn', kind: 'label', text: 'Timed out', tone: 'warning' },
      ],
      beats: [
        { verb: 'place', element: 'req' },
        { verb: 'reveal', element: 'warn', style: 'pop', at: 'only ten kilobytes' },
        { verb: 'camera', move: 'zoom', to: 'req', zoom: 1.6, at: 'ten kilobytes' },
      ],
    },
  ],
};
const issues = (value: unknown) => {
  const parsed = DirectionSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};

describe('the direction schema', () => {
  it('accepts every B2 element and verb, and fills its defaults', () => {
    const parsed = DirectionSchema.parse(valid);
    expect(parsed.draft).toBe(false);
    expect(DirectionSchema.parse({ shots: [shot()] })).toEqual({
      schemaVersion: 1,
      draft: false,
      shots: [{ scene: 's3', elements: [{ id: 'visual', kind: 'visual' }], beats: [] }],
    });
  });

  it('rejects unknown keys everywhere: no CSS, HTML, URLs, or code for the renderer', () => {
    expect(issues({ ...valid, style: 'x' })).not.toEqual([]);
    expect(issues({ shots: [shot({ css: 'color: red' })] })).not.toEqual([]);
    for (const key of ['html', 'src', 'href', 'style', 'onClick', 'script', 'value'])
      expect(
        issues({ shots: [shot({ elements: [{ id: 'a', kind: 'label', text: 'Hi', [key]: 'x' }] })] }),
        key,
      ).not.toEqual([]);
    expect(
      issues({ shots: [shot({ beats: [{ verb: 'camera', move: 'zoom', to: 'visual', easing: 'x' }] })] }),
    ).not.toEqual([]);
  });

  it('rejects kinds and verbs this PR does not draw', () => {
    for (const kind of ['metric', 'morph', 'packet', 'pile', 'html', 'iframe'])
      expect(issues({ shots: [shot({ elements: [{ id: 'a', kind }] })] }), kind).not.toEqual([]);
    for (const verb of ['morph', 'count', 'flow', 'eval'])
      expect(issues({ shots: [shot({ beats: [{ verb, element: 'visual' }] })] }), verb).not.toEqual(
        [],
      );
    // `place` means "from the shot's start": a phrase would mean nothing on it.
    expect(
      issues({ shots: [shot({ beats: [{ verb: 'place', element: 'visual', at: 'x' }] })] }),
    ).not.toEqual([]);
  });

  it('bounds every list at its limit', () => {
    const shots = (n: number) => Array.from({ length: n }, (_, i) => shot({ scene: `s${i + 1}` }));
    expect(issues({ shots: shots(DIRECTION_LIMITS.shots) })).toEqual([]);
    expect(issues({ shots: shots(DIRECTION_LIMITS.shots + 1) })).not.toEqual([]);
    const labels = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `l${i}`, kind: 'label', text: 'Hi' }));
    expect(issues({ shots: [shot({ elements: labels(DIRECTION_LIMITS.elementsPerShot) })] })).toEqual(
      [],
    );
    expect(
      issues({ shots: [shot({ elements: labels(DIRECTION_LIMITS.elementsPerShot + 1) })] }),
    ).not.toEqual([]);
    expect(issues({ shots: [shot({ elements: [] })] })).not.toEqual([]);
    const beats = (n: number) =>
      Array.from({ length: n }, () => ({ verb: 'reveal', element: 'visual' }));
    expect(issues({ shots: [shot({ beats: beats(DIRECTION_LIMITS.beatsPerShot) })] })).toEqual([]);
    expect(issues({ shots: [shot({ beats: beats(DIRECTION_LIMITS.beatsPerShot + 1) })] })).not.toEqual(
      [],
    );
    const node = (n: number) => ({
      id: 'n',
      kind: 'node',
      label: 'Reader',
      evidence: Array.from({ length: n }, (_, i) => `diff-hunk:a.js:${i + 1}`),
    });
    expect(issues({ shots: [shot({ elements: [node(4)] })] })).toEqual([]);
    expect(issues({ shots: [shot({ elements: [node(5)] })] })).not.toEqual([]);
  });

  it('bounds ids, phrases, zoom, and line ranges', () => {
    for (const id of ['a', 'req-1', 'a'.repeat(24)])
      expect(issues({ shots: [shot({ elements: [{ id, kind: 'visual' }] })] }), id).toEqual([]);
    for (const id of ['', '1a', 'A', 'a_b', 'a'.repeat(25), '<b>'])
      expect(issues({ shots: [shot({ elements: [{ id, kind: 'visual' }] })] }), id).not.toEqual([]);
    const at = (phrase: string) =>
      issues({ shots: [shot({ beats: [{ verb: 'reveal', element: 'visual', at: phrase }] })] });
    expect(at('x'.repeat(DIRECTION_LIMITS.phraseChars))).toEqual([]);
    expect(at('x'.repeat(DIRECTION_LIMITS.phraseChars + 1))).not.toEqual([]);
    expect(at('   ')).not.toEqual([]);
    const zoom = (z: number) =>
      issues({ shots: [shot({ beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: z }] })] });
    expect(zoom(1)).toEqual([]);
    expect(zoom(2.5)).toEqual([]);
    expect(zoom(0.99)).not.toEqual([]);
    expect(zoom(2.51)).not.toEqual([]);
    const lines = (l: unknown) =>
      issues({
        shots: [shot({ elements: [{ id: 'c', kind: 'code', evidence: 'diff-hunk:a.js:1', lines: l }] })],
      });
    expect(lines([1, 40])).toEqual([]);
    expect(lines([1, 41])).not.toEqual([]);
    expect(lines([5, 4])).not.toEqual([]);
    expect(lines([0, 3])).not.toEqual([]);
    expect(lines([1.5, 3])).not.toEqual([]);
    expect(lines([1])).not.toEqual([]);
    expect(issues({ shots: [shot({ scene: 'S3' })] })).not.toEqual([]);
    expect(issues({ shots: [shot({ scene: 'a'.repeat(65) })] })).not.toEqual([]);
  });
});

describe('labels', () => {
  const ok = (text: string) => LabelSchema.safeParse(text).success;

  it('take letters of any script, spaces, and a little punctuation, trimmed', () => {
    for (const text of [
      'Slow path',
      'Tom & Jerry (it’s fine)',
      'e—mail · ok?',
      'Before: slow',
      'café / naïve',
      '요청이 너무 큼',
      'タイムアウト',
      '超时',
      'a'.repeat(32),
    ])
      expect(ok(text), text).toBe(true);
    expect(LabelSchema.parse('  Slow path  ')).toBe('Slow path');
  });

  it('refuse digits, markup, links, schemes, and control characters', () => {
    for (const text of [
      '',
      '   ',
      'a'.repeat(33),
      '10x faster',
      'v1',
      '٣ items',
      'x²',
      '<script>alert(1)</script>',
      'javascript:alert(document)',
      'JavaScript : void',
      'vbscript:msgbox',
      'data:text/html',
      'x onerror=alert',
      'see https://evil.example',
      'ftp://host',
      'www.evil.example',
      '{{template}}',
      '"quoted"',
      'a;b',
      'a_b',
      'tab\there',
      'new\nline',
      'nul\u0000',
    ])
      expect(ok(text), JSON.stringify(text)).toBe(false);
  });
});

describe('reading video/direction.json', () => {
  const file = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'covi-direction-'));
    dirs.push(dir);
    const path = join(dir, 'direction.json');
    writeFileSync(path, content);
    return path;
  };

  it('reads nothing when the run has no direction', async () => {
    expect(await readDirectionFile(join(tmpdir(), 'covi-missing', 'direction.json'))).toBeUndefined();
  });

  it('parses a valid file', async () => {
    expect(await readDirectionFile(file(JSON.stringify(valid)))).toMatchObject({
      schemaVersion: 1,
      shots: [{ scene: 's3', enter: 'pan' }],
    });
  });

  it('refuses a file over the size limit before parsing it, and invalid JSON', async () => {
    const big = file(`{"shots":[],"pad":"${'x'.repeat(DIRECTION_LIMITS.fileBytes)}"}`);
    await expect(readDirectionFile(big)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/at most 262144 bytes/),
    });
    await expect(readDirectionFile(file('{ nope'))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/not valid JSON/),
    });
  });

  it('lists every schema problem at once', async () => {
    const broken = {
      shots: [
        shot({ scene: 'S1' }),
        shot({ elements: [{ id: 'x', kind: 'label', text: '10 times' }] }),
        shot({ beats: [{ verb: 'camera', move: 'spin', to: 'visual' }] }),
      ],
    };
    const error = await readDirectionFile(file(JSON.stringify(broken))).catch((e: Error) => e);
    expect(error).toMatchObject({ exitCode: 2 });
    const message = (error as Error).message;
    expect(message).toMatch(/video\/direction\.json is invalid/);
    expect(message).toMatch(/shots\.0\.scene/);
    expect(message).toMatch(/shots\.1\.elements\.0\.text/);
    expect(message).toMatch(/shots\.2\.beats\.0\.move/);
  });
});
```

Create `tests/direction-security.test.ts` (Tasks 3 and 9 add to it):

```ts
import { describe, expect, it } from 'vitest';
import { DIRECTION_LIMITS, DirectionSchema } from '../packages/video/src/direction/schema.ts';

/*
 * A direction file is untrusted: an agent writes it, and the repository it read can steer the
 * agent. These tests are the acceptance check of spec §14: oversized lists, script-like strings,
 * URLs, unknown evidence ids, and made-up numbers are rejected, and a label that passes
 * validation reaches the page only as text.
 */

const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;
const withLabel = (text: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'note', kind: 'label', text }] }],
});
const withNode = (label: string) => ({
  shots: [{ scene: 's1', elements: [{ id: 'node', kind: 'node', label }] }],
});

describe('a hostile direction file', () => {
  it('cannot grow past its bounds', () => {
    const shot = (i: number) => ({ scene: `s${i}`, elements: [{ id: 'v', kind: 'visual' }] });
    expect(rejected({ shots: Array.from({ length: DIRECTION_LIMITS.shots + 1 }, (_, i) => shot(i)) })).toBe(
      true,
    );
    expect(
      rejected({
        shots: [
          {
            scene: 's1',
            elements: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, kind: 'visual' })),
          },
        ],
      }),
    ).toBe(true);
    expect(rejected(withLabel('x'.repeat(DIRECTION_LIMITS.labelChars + 1)))).toBe(true);
  });

  it('cannot smuggle markup, script, or links through a label or a node', () => {
    for (const text of [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      'x onerror=alert(1)',
      '"><svg onload=alert(1)>',
      'https://evil.example/x',
      'www.evil.example',
      '{{constructor}}',
      'a`b`',
    ]) {
      expect(rejected(withLabel(text)), text).toBe(true);
      expect(rejected(withNode(text)), text).toBe(true);
    }
  });

  it('cannot make up numbers: no digits in labels, no value on a metric', () => {
    expect(rejected(withLabel('Ten times faster'))).toBe(false);
    for (const text of ['10x faster', '-85%', '1,024 bytes', '٣ reads', 'Step ²'])
      expect(rejected(withLabel(text)), text).toBe(true);
    expect(
      rejected({
        shots: [
          {
            scene: 's1',
            elements: [{ id: 'm', kind: 'metric', evidence: 'metric:terminal-1:bytes', value: 42 }],
          },
        ],
      }),
    ).toBe(true);
  });

  it('cannot hand the renderer styles, markup, or addresses through any key', () => {
    for (const extra of [{ css: 'x' }, { html: '<b>' }, { url: 'https://x' }, { selector: '#a' }])
      expect(
        rejected({ shots: [{ scene: 's1', elements: [{ id: 'v', kind: 'visual', ...extra }] }] }),
      ).toBe(true);
  });
});
```

In `tests/cli.test.ts`, inside `it('prints JSON schemas, templates, skills, and examples', …)`, after the `score` assertions and before `expect(covi(['schema', 'nope']).code).toBe(2);`:

```ts
    const direction = covi(['schema', 'direction']).json() as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(direction.properties)).toEqual(['schemaVersion', 'draft', 'shots']);
    expect(direction.additionalProperties).toBe(false);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-schema.test.ts tests/direction-security.test.ts`
Expected: FAIL — `Cannot find module '../src/direction/schema.ts'`.

- [ ] **Step 3: Implement**

Create `packages/video/src/direction/schema.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { EVIDENCE_LIMITS, parseOrThrow, UsageError } from '@covi/core';
import { z } from 'zod';
import { TRANSITION_KINDS } from '../storyboard/schema.ts';
import { CAMERA_TRANSITIONS } from '../timeline/types.ts';

/*
 * `video/direction.json`: how the video shows what the storyboard says. Evidence decides what is
 * shown; the agent decides how. The file is untrusted input (an agent writes it, and the
 * repository it read can steer the agent), so every list, string, and number is bounded, every
 * object is strict, content comes only from evidence ids, and the only text an agent writes is a
 * short label from an allowlist.
 */

/** Where the run keeps it; the agent writes it there, as it does the score. */
export const DIRECTION_PATH = 'video/direction.json';

export const DIRECTION_HINT =
  'Run `covi schema direction` for the format, and `covi evidence --run <id>` for the ids a shot may cite.';

/** Every bound on a direction file, in one place. */
export const DIRECTION_LIMITS = {
  fileBytes: 262_144,
  shots: 24,
  elementsPerShot: 8,
  beatsPerShot: 12,
  idChars: 24,
  labelChars: 32,
  /** As a storyboard `sync` phrase. */
  phraseChars: 200,
  /** Storyboard scene ids have no length limit of their own; a shot names one of at most this. */
  sceneIdChars: 64,
  zoom: { min: 1, max: 2.5 },
  /** Lines a code element may show. */
  lineSpan: 40,
  /** Items a pile or a split draws at most (later verbs); the counter shows the true value. */
  drawnItems: 12,
  evidencePerElement: 4,
} as const;

/** An element id: a lowercase letter, then up to 23 lowercase letters, digits, or dashes. */
export const DIRECTION_ID = /^[a-z][a-z0-9-]{0,23}$/;

/** How a scene can enter: the storyboard's transitions and the camera's moves between stops. */
export const ENTRANCE_KINDS = [...TRANSITION_KINDS, ...CAMERA_TRANSITIONS] as const;
export const SHOT_LAYOUTS = ['auto', 'single', 'row', 'column', 'split'] as const;
export const REVEAL_STYLES = ['rise', 'pop', 'wipe', 'type'] as const;
export const CAMERA_MOVES = ['zoom', 'pan', 'follow'] as const;
export const LABEL_TONES = ['neutral', 'warning', 'success'] as const;

export type ShotLayout = (typeof SHOT_LAYOUTS)[number];

/** Letters and marks of any script, spaces, and a little punctuation: no digits and no markup. */
const LABEL_CHARS = /^[\p{L}\p{M} \-–—·,.'’:()/&+?!]+$/u;
/** Script-running URL schemes, which the allowed characters could otherwise spell. */
const SCRIPT_SCHEME = /\b(?:javascript|vbscript|data)\s*:/i;

/**
 * Text an agent writes for the screen (a node's name, a label). Numbers must come from evidence,
 * so a label has no digits; it has no markup or link characters either, and the runtime sets it
 * as text anyway. Number words cannot be policed in code (R-012): the methodology forbids them.
 */
export const LabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(DIRECTION_LIMITS.labelChars)
  .regex(
    LABEL_CHARS,
    "a label is letters, spaces, and - – — · , . ' ’ : ( ) / & + ? ! only: no digits, markup, or symbols",
  )
  .refine(
    (text) => !text.includes('://') && !/^www\./i.test(text) && !SCRIPT_SCHEME.test(text),
    'a label holds no links',
  );

const SceneRefSchema = z
  .string()
  .min(1)
  .max(DIRECTION_LIMITS.sceneIdChars)
  .regex(/^[a-z0-9-]+$/, 'a storyboard scene id');
const ElementIdSchema = z
  .string()
  .regex(DIRECTION_ID, 'an element id is a lowercase letter, then up to 23 lowercase letters, digits, or dashes');
const EvidenceRefSchema = z.string().min(1).max(EVIDENCE_LIMITS.id);
const PhraseSchema = z
  .string()
  .trim()
  .min(1)
  .max(DIRECTION_LIMITS.phraseChars)
  .describe(
    "A phrase quoted verbatim from the scene's narration that occurs exactly once: the beat lands as it is spoken. Without it, beats are spread through the line in order.",
  );
const LineSchema = z.number().int().min(1).max(100_000);
const LinesSchema = z
  .tuple([LineSchema, LineSchema])
  .refine(([from, to]) => from <= to, 'lines are [from, to] with from ≤ to')
  .refine(
    ([from, to]) => to - from + 1 <= DIRECTION_LIMITS.lineSpan,
    `a code element shows at most ${DIRECTION_LIMITS.lineSpan} lines`,
  )
  .describe('1-based [from, to] within the lines of the side shown.');

export const ShotElementSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ id: ElementIdSchema, kind: z.literal('visual') })
    .describe("The scene's storyboard visual, drawn as it is without direction."),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('code'),
    evidence: EvidenceRefSchema.describe('A diff-hunk: id from `covi evidence --run <id>`.'),
    side: z
      .enum(['head', 'base', 'diff'])
      .optional()
      .describe('head (default): the lines after the change; base: before it; diff: both, marked.'),
    lines: LinesSchema.optional(),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('output'),
    evidence: EvidenceRefSchema.describe(
      "A terminal: id: a demo command's output, or the app's start-up log.",
    ),
    side: z
      .enum(['head', 'base'])
      .optional()
      .describe('head (default): the output after the change; base: before it.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('capture'),
    evidence: EvidenceRefSchema.describe('A screenshot: id.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('node'),
    label: LabelSchema,
    evidence: z
      .array(EvidenceRefSchema)
      .max(DIRECTION_LIMITS.evidencePerElement)
      .optional()
      .describe('Evidence ids the node stands for.'),
  }),
  z.strictObject({
    id: ElementIdSchema,
    kind: z.literal('label'),
    text: LabelSchema,
    tone: z.enum(LABEL_TONES).optional(),
  }),
]);

export const ShotBeatSchema = z.discriminatedUnion('verb', [
  z
    .strictObject({ verb: z.literal('place'), element: ElementIdSchema })
    .describe("The element sits in place from the shot's start (the default, made explicit)."),
  z.strictObject({
    verb: z.literal('reveal'),
    element: ElementIdSchema,
    style: z.enum(REVEAL_STYLES).optional().describe('rise (default), pop, wipe, or type.'),
    at: PhraseSchema.optional(),
  }),
  z.strictObject({
    verb: z.literal('camera'),
    move: z
      .enum(CAMERA_MOVES)
      .describe('zoom: frame the element; pan: center it at the same scale; follow: frame what it highlights.'),
    to: ElementIdSchema,
    zoom: z
      .number()
      .min(DIRECTION_LIMITS.zoom.min)
      .max(DIRECTION_LIMITS.zoom.max)
      .optional()
      .describe('1–2.5; default: fit the element to the region.'),
    at: PhraseSchema.optional(),
  }),
]);

export const ShotSchema = z.strictObject({
  scene: SceneRefSchema.describe('The storyboard scene this shot directs (at most one shot each).'),
  enter: z.enum(ENTRANCE_KINDS).optional().describe(
    "How the scene enters: pan or zoom (the camera travels the canvas), or a storyboard transition. Default: the scene's own transition, else Covi's rotation.",
  ),
  layout: z.enum(SHOT_LAYOUTS).optional().describe('auto (default), single, row, column, or split.'),
  elements: z.array(ShotElementSchema).min(1).max(DIRECTION_LIMITS.elementsPerShot),
  beats: z.array(ShotBeatSchema).max(DIRECTION_LIMITS.beatsPerShot).default([]),
});

export const DirectionSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  /** True for Covi's default director; an agent sets false after rewriting it. */
  draft: z
    .boolean()
    .default(false)
    .describe("true: Covi's draft, derived again at render; set false once you have rewritten it."),
  shots: z.array(ShotSchema).max(DIRECTION_LIMITS.shots),
});

export type Direction = z.output<typeof DirectionSchema>;
export type DirectionInput = z.input<typeof DirectionSchema>;
export type Shot = z.output<typeof ShotSchema>;
export type ShotElement = z.output<typeof ShotElementSchema>;
export type ShotBeat = z.output<typeof ShotBeatSchema>;

/**
 * Reads the run's direction file, or nothing when the run has none. Its size is bounded before it
 * is parsed, and every schema problem is listed at once (exit 2).
 */
export async function readDirectionFile(path: string): Promise<Direction | undefined> {
  let size: number;
  try {
    ({ size } = await stat(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (size > DIRECTION_LIMITS.fileBytes)
    throw new UsageError(
      `video/direction.json is ${size} bytes; a direction may be at most ${DIRECTION_LIMITS.fileBytes} bytes.`,
      DIRECTION_HINT,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new UsageError(
      `video/direction.json is not valid JSON: ${(error as Error).message}`,
      DIRECTION_HINT,
    );
  }
  return parseOrThrow(DirectionSchema, raw, 'video/direction.json', DIRECTION_HINT);
}
```

Biome will reflow the long lines; run `npx biome format --write packages/video/src/direction/schema.ts` after writing it.

In `packages/video/src/index.ts`, add (in alphabetical position by path, after the `./composition/…` exports):

```ts
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
```

In `packages/cli/src/main.ts`, import `DirectionSchema` from `@covi/video` (next to `StoryboardSchema`), add `direction` to the argument help (`'explanation | findings | storyboard | direction | score | demo-plan | config | evidence | subject | outcome'`), and add `direction: DirectionSchema,` to the `schemas` map after `storyboard`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-schema.test.ts tests/direction-security.test.ts tests/cli.test.ts -t "schema|direction|hostile|labels|reading"`
Expected: PASS. Then `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/direction/schema.ts packages/video/src/index.ts packages/cli/src/main.ts packages/video/test/direction-schema.test.ts tests/direction-security.test.ts tests/cli.test.ts
git commit -m "$(cat <<'EOF'
Add the direction file schema and covi schema direction

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 3: What a shot may show — evidence sources and reference checks

**Files:**
- Create: `packages/video/src/direction/sources.ts`
- Create: `packages/video/src/direction/refs.ts`
- Create: `packages/video/test/direction-refs.test.ts`
- Modify: `tests/direction-security.test.ts` (unknown and mistyped evidence ids)

**Interfaces:**
- Consumes: `Direction`, `ShotElement` (Task 2); `findPhrase`, `parseEmphasis` (`packages/video/src/storyboard/grammar.ts`); `evidenceId`, `EvidenceIndex`, `EvidenceKind`, `DiffLine`, `Hunk`, `Demonstration` (`@covi/core`).
- Produces:
  ```ts
  // packages/video/src/direction/sources.ts
  export interface HunkSource { path: string; language?: string; lines: readonly DiffLine[] }
  export interface CommandSource { name: string; command: string; output: string; before?: string }
  export interface CaptureSource { path: string; device: 'desktop' | 'mobile' }
  export interface DirectionSources {
    hunk(id: string): HunkSource | undefined;
    command(id: string): CommandSource | undefined;
    capture(id: string): CaptureSource | undefined;
  }
  export interface SourcesInput {
    files?: ReadonlyArray<{ path: string; language?: string; hunks: readonly Hunk[] }>;
    demo?: Pick<Demonstration, 'commands' | 'shots'>;
    evidence?: EvidenceIndex;
    appLogs?: Partial<Record<'base' | 'head', string>>;
    redact?: (text: string) => string;
  }
  export function directionSources(input: SourcesInput): DirectionSources;
  export type CodeSide = 'head' | 'base' | 'diff';
  export function hunkView(lines: readonly DiffLine[], side: CodeSide): DiffLine[];

  // packages/video/src/direction/refs.ts
  export function directionProblems(
    direction: Pick<Direction, 'shots'>,
    scenes: ReadonlyArray<Pick<Scene, 'id' | 'narration'>>,
    evidence: EvidenceIndex | undefined,
    sources: DirectionSources,
  ): string[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-refs.test.ts`:

```ts
import { buildEvidence, type Demonstration, type Hunk, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { directionProblems } from '../src/direction/refs.ts';
import { DirectionSchema, type DirectionInput } from '../src/direction/schema.ts';
import { directionSources, hunkView } from '../src/direction/sources.ts';

const hunk: Hunk = {
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  lines: [
    { kind: 'context', text: 'function build(docs) {', oldLine: 10, newLine: 10 },
    { kind: 'del', text: '  return { docs };', oldLine: 11 },
    { kind: 'add', text: '  return { ids: docs.map((d) => d.id) };', newLine: 11 },
    { kind: 'context', text: '}', oldLine: 12, newLine: 12 },
  ],
};
const deleteOnly: Hunk = {
  oldStart: 40,
  oldLines: 1,
  newStart: 39,
  newLines: 0,
  lines: [{ kind: 'del', text: 'legacy();', oldLine: 40 }],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk, deleteOnly] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node scripts/measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
    {
      name: 'version',
      command: 'node -v',
      after: { exitCode: 0, output: 'v22' },
      changed: false,
    },
  ],
  shots: [
    {
      id: 'home',
      kind: 'page',
      name: '/',
      viewport: 'mobile',
      after: { path: 'demo/screenshots/home-after.png' },
    },
  ],
} as unknown as Pick<Demonstration, 'commands' | 'shots'>;
const evidence = indexEvidence(
  buildEvidence({
    diff: files,
    demo: { ...demo, requests: [], skipped: [], findings: [] } as unknown as Demonstration,
    fileSha: () => '0'.repeat(64),
  }),
);
const sources = directionSources({ files, demo, evidence });
const scenes = [
  { id: 's1', narration: 'The request carried every document.' },
  { id: 's2', narration: 'Now it sends [[only the ids]], and the ids are small.' },
];
const problems = (direction: DirectionInput) =>
  directionProblems(DirectionSchema.parse(direction), scenes, evidence, sources);

describe('evidence sources', () => {
  it('find a hunk, a command, and a capture by the ids the registry wrote', () => {
    expect(sources.hunk('diff-hunk:src/request.js:10')).toMatchObject({
      path: 'src/request.js',
      language: 'javascript',
    });
    expect(sources.command('terminal:1')).toEqual({
      name: 'measure',
      command: 'node scripts/measure.js',
      output: 'request bytes: 9000',
      before: 'request bytes: 120000',
    });
    expect(sources.command('terminal:2')).not.toHaveProperty('before');
    expect(sources.capture('screenshot:home-after')).toEqual({
      path: 'demo/screenshots/home-after.png',
      device: 'mobile',
    });
    // Wrong kinds find nothing.
    expect(sources.hunk('terminal:1')).toBeUndefined();
    expect(sources.command('diff-hunk:src/request.js:10')).toBeUndefined();
    expect(sources.capture('terminal:1')).toBeUndefined();
  });

  it('show a hunk from either side, or both', () => {
    expect(hunkView(hunk.lines, 'head').map((l) => l.kind)).toEqual(['context', 'add', 'context']);
    expect(hunkView(hunk.lines, 'base').map((l) => l.kind)).toEqual(['context', 'del', 'context']);
    expect(hunkView(hunk.lines, 'diff')).toHaveLength(4);
  });

  it('read the app start-up log for terminal:app-start ids', () => {
    const withLog = indexEvidence(
      buildEvidence({
        fileSha: (path) => (path === 'demo/app-head.log' ? '1'.repeat(64) : undefined),
      }),
    );
    const logged = directionSources({ evidence: withLog, appLogs: { head: 'EADDRINUSE :3000' } });
    expect(logged.command('terminal:app-start-head')).toEqual({
      name: 'app-start · head',
      command: '',
      output: 'EADDRINUSE :3000',
    });
  });
});

describe('direction references', () => {
  it('accept a direction that names real scenes, elements, evidence, and phrases', () => {
    expect(
      problems({
        shots: [
          {
            scene: 's2',
            elements: [
              { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:10', lines: [1, 3] },
              { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
              { id: 'page', kind: 'capture', evidence: 'screenshot:home-after' },
              { id: 'n', kind: 'node', label: 'Reader', evidence: ['terminal:2'] },
            ],
            beats: [
              { verb: 'reveal', element: 'out', at: 'only the ids' },
              { verb: 'camera', move: 'zoom', to: 'req' },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('name the shot, element, and beat of every problem, all at once', () => {
    const found = problems({
      shots: [
        { scene: 's9', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's1',
          layout: 'single',
          elements: [
            { id: 'a', kind: 'visual' },
            { id: 'a', kind: 'label', text: 'Twice' },
          ],
        },
        { scene: 's1', elements: [{ id: 'v', kind: 'visual' }] },
        {
          scene: 's2',
          elements: [
            { id: 'c', kind: 'code', evidence: 'diff-hunk:nope.js:1' },
            { id: 'd', kind: 'code', evidence: 'terminal:1' },
            { id: 'e', kind: 'code', evidence: 'diff-hunk:src/request.js:39' },
            { id: 'f', kind: 'code', evidence: 'diff-hunk:src/request.js:10', lines: [2, 4] },
            { id: 'g', kind: 'output', evidence: 'terminal:2', side: 'base' },
            { id: 'h', kind: 'capture', evidence: 'diff-hunk:src/request.js:10' },
            { id: 'i', kind: 'node', label: 'Reader', evidence: ['made-up:1'] },
          ],
          beats: [
            { verb: 'reveal', element: 'zz' },
            { verb: 'camera', move: 'pan', to: 'c', at: 'not in the line' },
            { verb: 'reveal', element: 'c', at: 'the ids' },
          ],
        },
      ],
    });
    expect(found).toEqual([
      'shot 1 (scene s9): the storyboard has no scene "s9" (it has: s1, s2)',
      'shot 2 (scene s1): layout "single" shows one element, and the shot has 2',
      'shot 2 (scene s1): element id "a" is used twice',
      'shot 3 (scene s1): scene s1 already has a shot; give each scene at most one',
      'shot 4 (scene s2), element c: cites "diff-hunk:nope.js:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 4 (scene s2), element d: a code element shows a diff-hunk: item, and "terminal:1" is a terminal',
      'shot 4 (scene s2), element e: the hunk has no head lines; show side "base" or "diff"',
      'shot 4 (scene s2), element f: lines [2, 4] run past the 3 lines of its head side',
      'shot 4 (scene s2), element g: side "base": "terminal:2" ran only after the change',
      'shot 4 (scene s2), element h: a capture element shows a screenshot: item, and "diff-hunk:src/request.js:10" is a diff-hunk',
      'shot 4 (scene s2), element i: cites "made-up:1", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 4 (scene s2), beat 1 (reveal): the shot has no element "zz" (it has: c, d, e, f, g, h, i)',
      'shot 4 (scene s2), beat 2 (camera) quotes "not in the line", which is not in the scene\'s narration',
      'shot 4 (scene s2), beat 3 (reveal) quotes "the ids", which appears 2 times in the scene\'s narration; quote enough words to make it unique',
    ]);
  });

  it('cannot check evidence the run does not have', () => {
    expect(
      directionProblems(
        DirectionSchema.parse({
          shots: [{ scene: 's1', elements: [{ id: 'p', kind: 'capture', evidence: 'screenshot:x' }] }],
        }),
        scenes,
        undefined,
        directionSources({}),
      ),
    ).toEqual([
      'shot 1 (scene s1), element p: cites "screenshot:x", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
    ]);
  });
});
```

Note: the delete-only hunk's id is `diff-hunk:src/request.js:39` (its `newStart`). Append to `tests/direction-security.test.ts`:

```ts
import { indexEvidence } from '@covi/core';
import { directionProblems } from '../packages/video/src/direction/refs.ts';
import { directionSources } from '../packages/video/src/direction/sources.ts';

describe('a direction citing evidence the run does not have', () => {
  it('is refused, element by element, before anything renders', () => {
    const evidence = indexEvidence({ items: [] });
    const direction = DirectionSchema.parse({
      shots: [
        {
          scene: 's1',
          elements: [
            { id: 'a', kind: 'code', evidence: 'diff-hunk:../../etc/passwd:1' },
            { id: 'b', kind: 'capture', evidence: 'screenshot:../../secret' },
            { id: 'c', kind: 'output', evidence: 'terminal:999' },
            { id: 'd', kind: 'node', label: 'Made up', evidence: ['metric:x:y'] },
          ],
        },
      ],
    });
    const found = directionProblems(
      direction,
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    expect(found).toHaveLength(4);
    for (const line of found) expect(line).toMatch(/which the run's evidence does not have/);
  });
});
```

(Move the new imports to the top of the file with the others.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-refs.test.ts tests/direction-security.test.ts`
Expected: FAIL — `Cannot find module '../src/direction/refs.ts'`.

- [ ] **Step 3: Implement**

Create `packages/video/src/direction/sources.ts`:

```ts
import {
  type DiffLine,
  type Demonstration,
  type EvidenceIndex,
  evidenceId,
  type Hunk,
} from '@covi/core';

/*
 * What direction elements may show, looked up by the evidence id they cite. A shot's content
 * comes only from here: the run's diff, its demo commands and start-up logs, and its captures.
 */

export interface HunkSource {
  /** The changed file's path, and its language for highlighting. */
  path: string;
  language?: string;
  lines: readonly DiffLine[];
}

export interface CommandSource {
  name: string;
  /** Empty for the app's start-up log, which is output without a command. */
  command: string;
  /** The output after the change (head). */
  output: string;
  /** The output before it, when the command ran at base too. */
  before?: string;
}

export interface CaptureSource {
  /** Run-relative path of the image. */
  path: string;
  device: 'desktop' | 'mobile';
}

export interface DirectionSources {
  hunk(id: string): HunkSource | undefined;
  command(id: string): CommandSource | undefined;
  capture(id: string): CaptureSource | undefined;
}

export interface SourcesInput {
  /** The change's files with their hunks. */
  files?: ReadonlyArray<{ path: string; language?: string; hunks: readonly Hunk[] }>;
  demo?: Pick<Demonstration, 'commands' | 'shots'>;
  evidence?: EvidenceIndex;
  /** The app's start-up logs (`demo/app-<revision>.log`), when the run has them. */
  appLogs?: Partial<Record<'base' | 'head', string>>;
  /** The redaction the registry's ids went through, so a hunk's id is computed as it wrote it. */
  redact?: (text: string) => string;
}

export type CodeSide = 'head' | 'base' | 'diff';

/** A hunk's lines as one side shows them: head (context and added), base (context and deleted), or diff (all). */
export function hunkView(lines: readonly DiffLine[], side: CodeSide): DiffLine[] {
  if (side === 'diff') return [...lines];
  const changed = side === 'head' ? 'add' : 'del';
  return lines.filter((l) => l.kind === 'context' || l.kind === changed);
}

export function directionSources(input: SourcesInput): DirectionSources {
  const redact = input.redact ?? ((text: string) => text);
  const hunks = new Map<string, HunkSource>();
  for (const file of input.files ?? [])
    for (const hunk of file.hunks)
      hunks.set(redact(evidenceId.hunk(file.path, hunk.newStart)), {
        path: file.path,
        ...(file.language ? { language: file.language } : {}),
        lines: hunk.lines,
      });
  const item = (id: string) => input.evidence?.find(id);
  return {
    hunk(id) {
      const found = item(id);
      return found?.kind === 'diff-hunk' ? hunks.get(found.id) : undefined;
    },
    command(id) {
      const found = item(id);
      if (found?.kind !== 'terminal') return undefined;
      const start = /^terminal:app-start-(base|head)$/.exec(found.id);
      if (start) {
        const log = input.appLogs?.[start[1] as 'base' | 'head'];
        return log === undefined ? undefined : { name: found.label, command: '', output: log };
      }
      const n = /^terminal:(\d+)$/.exec(found.id);
      const c = n ? input.demo?.commands[Number(n[1]) - 1] : undefined;
      if (!c) return undefined;
      return {
        name: c.name,
        command: c.command,
        output: c.after.output,
        ...(c.before ? { before: c.before.output } : {}),
      };
    },
    capture(id) {
      const found = item(id);
      if (found?.kind !== 'screenshot') return undefined;
      const shot = input.demo?.shots.find(
        (s) => s.before?.path === found.path || s.after?.path === found.path,
      );
      return { path: found.path, device: shot?.viewport === 'mobile' ? 'mobile' : 'desktop' };
    },
  };
}
```

Create `packages/video/src/direction/refs.ts`:

```ts
import type { EvidenceIndex, EvidenceKind } from '@covi/core';
import { findPhrase, parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { Direction, ShotElement } from './schema.ts';
import { type DirectionSources, hunkView } from './sources.ts';

/**
 * What the schema alone cannot check, as lines that name the shot, element, and beat: shots name
 * storyboard scenes (one each), beats name elements of their shot, every cited id is in the run's
 * evidence with the kind its element shows, a requested side exists, lines lie within the side
 * shown, and every `at` is quoted from the scene's narration exactly once (as `sync` phrases are).
 */
export function directionProblems(
  direction: Pick<Direction, 'shots'>,
  scenes: ReadonlyArray<Pick<Scene, 'id' | 'narration'>>,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const problems: string[] = [];
  const byId = new Map(scenes.map((s, i) => [s.id ?? `s${i + 1}`, s]));
  const directed = new Set<string>();
  direction.shots.forEach((shot, i) => {
    const where = `shot ${i + 1} (scene ${shot.scene})`;
    const scene = byId.get(shot.scene);
    if (!scene) {
      problems.push(
        `${where}: the storyboard has no scene "${shot.scene}" (it has: ${[...byId.keys()].join(', ')})`,
      );
      return;
    }
    if (directed.has(shot.scene))
      problems.push(`${where}: scene ${shot.scene} already has a shot; give each scene at most one`);
    directed.add(shot.scene);
    if (shot.layout === 'single' && shot.elements.length > 1)
      problems.push(
        `${where}: layout "single" shows one element, and the shot has ${shot.elements.length}`,
      );
    const ids = new Set<string>();
    for (const element of shot.elements) {
      if (ids.has(element.id)) problems.push(`${where}: element id "${element.id}" is used twice`);
      ids.add(element.id);
      for (const problem of elementProblems(element, evidence, sources))
        problems.push(`${where}, element ${element.id}: ${problem}`);
    }
    const text = parseEmphasis(scene.narration).text;
    shot.beats.forEach((beat, k) => {
      const name = `${where}, beat ${k + 1} (${beat.verb})`;
      const target = beat.verb === 'camera' ? beat.to : beat.element;
      if (!ids.has(target))
        problems.push(`${name}: the shot has no element "${target}" (it has: ${[...ids].join(', ')})`);
      if (beat.verb === 'place' || beat.at === undefined) return;
      const at = findPhrase(text, beat.at);
      if (at.count === 0)
        problems.push(`${name} quotes "${beat.at}", which is not in the scene's narration`);
      else if (at.count > 1)
        problems.push(
          `${name} quotes "${beat.at}", which appears ${at.count} times in the scene's narration; quote enough words to make it unique`,
        );
    });
  });
  return problems;
}

const UNKNOWN = "which the run's evidence does not have (`covi evidence --run <id>` lists it)";

function elementProblems(
  element: ShotElement,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const out: string[] = [];
  /** Whether `id` is in the run's evidence as a `kind` item; says why not. */
  const cites = (id: string, kind: EvidenceKind, what: string) => {
    const item = evidence?.find(id);
    if (!item) out.push(`cites "${id}", ${UNKNOWN}`);
    else if (item.kind !== kind)
      out.push(`${what} shows a ${kind}: item, and "${id}" is a ${item.kind}`);
    return item?.kind === kind;
  };
  switch (element.kind) {
    case 'code': {
      if (!cites(element.evidence, 'diff-hunk', 'a code element')) break;
      const hunk = sources.hunk(element.evidence);
      if (!hunk) {
        out.push(`Covi cannot find hunk "${element.evidence}" in the run's diff`);
        break;
      }
      const side = element.side ?? 'head';
      const view = hunkView(hunk.lines, side);
      if (!view.length)
        out.push(
          `the hunk has no ${side} lines; show side "${side === 'head' ? 'base' : 'head'}" or "diff"`,
        );
      else if (element.lines && element.lines[1] > view.length)
        out.push(
          `lines [${element.lines[0]}, ${element.lines[1]}] run past the ${view.length} lines of its ${side} side`,
        );
      break;
    }
    case 'output': {
      if (!cites(element.evidence, 'terminal', 'an output element')) break;
      const command = sources.command(element.evidence);
      if (!command) out.push(`the run has no output for "${element.evidence}"`);
      else if ((element.side ?? 'head') === 'base' && command.before === undefined)
        out.push(`side "base": "${element.evidence}" ran only after the change`);
      break;
    }
    case 'capture':
      if (cites(element.evidence, 'screenshot', 'a capture element') && !sources.capture(element.evidence))
        out.push(`the run has no image for "${element.evidence}"`);
      break;
    case 'node':
      for (const id of element.evidence ?? [])
        if (!evidence?.find(id)) out.push(`cites "${id}", ${UNKNOWN}`);
      break;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-refs.test.ts tests/direction-security.test.ts`
Expected: PASS. Then `npm run typecheck && npm run lint`.

If `buildEvidence` in the test drops the screenshot item (it needs `fileSha` to return a digest for `demo/screenshots/home-after.png`), the test's `fileSha: () => '0'.repeat(64)` provides one; keep it.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/direction/sources.ts packages/video/src/direction/refs.ts packages/video/test/direction-refs.test.ts tests/direction-security.test.ts
git commit -m "$(cat <<'EOF'
Check a direction against the storyboard and the run's evidence

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 4: The default director — shots, the entrance rotation, and merging an agent's shots

**Files:**
- Create: `packages/video/src/direction/director.ts`
- Create: `packages/video/test/director.test.ts`
- Modify: `tests/examples.test.ts` (one new test per example)

**Interfaces:**
- Consumes: `Direction`, `Shot`, `ShotBeat` (Task 2); `directionProblems`, `directionSources` (Task 3); `sceneEvidence` (`packages/video/src/grounding.ts`), `highlightGroups` (`storyboard/grammar.ts`), `TransitionKind` (Task 1).
- Produces:
  ```ts
  // packages/video/src/direction/director.ts
  export const CODE_ZOOM = 1.25;
  export interface DirectorInput { scenes: readonly Scene[]; evidence?: EvidenceIndex; seed: number }
  export function defaultDirection(input: DirectorInput): Direction;            // draft: true
  export function entrances(
    plan: Pick<Direction, 'shots'>,
    scenes: readonly Scene[],
    evidence: EvidenceIndex | undefined,
    seed: number,
  ): Map<string, TransitionKind>;                                               // every scene after the first
  export function mergeDirection(authored: Direction | undefined, drafted: Direction): Direction;
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/director.test.ts`:

```ts
import { type EvidenceItem, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  CODE_ZOOM,
  defaultDirection,
  entrances,
  mergeDirection,
} from '../src/direction/director.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const item = (id: string, kind: EvidenceItem['kind'], path: string, extra: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id,
  kind,
  path,
  revision: 'head',
  sha256: '0'.repeat(64),
  label: id,
  ...extra,
});
const evidence = indexEvidence({
  items: [
    item('diff-hunk:src/cart.ts:10', 'diff-hunk', 'diff.patch', {
      revision: 'both',
      location: { path: 'src/cart.ts', line: 10, endLine: 14, side: 'head' },
    }),
    item('screenshot:cart-after', 'screenshot', 'demo/screenshots/cart-after.png'),
    item('screenshot:cart-before', 'screenshot', 'demo/screenshots/cart-before.png', {
      revision: 'base',
    }),
  ],
});
const scene = (id: string, visual: unknown, extra: Record<string, unknown> = {}): Scene =>
  SceneSchema.parse({ id, beat: id, narration: `Scene ${id} says one thing.`, visual, ...extra });
const callout = { kind: 'callout', title: 'C' };
const capture = { kind: 'screenshot', image: { path: 'demo/screenshots/cart-after.png' } };
const compare = {
  kind: 'before-after',
  before: { path: 'demo/screenshots/cart-before.png' },
  after: { path: 'demo/screenshots/cart-after.png' },
};
const code = {
  kind: 'code',
  path: 'src/cart.ts',
  lines: [
    { type: 'del', text: 'qty = qty - 1;', number: 10 },
    { type: 'add', text: 'qty = Math.max(0, qty - 1);', number: 10 },
  ],
  highlight: [1],
};
const kinds = (scenes: Scene[], seed = 0) =>
  defaultDirection({ scenes, evidence, seed }).shots.map((s) => s.enter);

describe('the default director', () => {
  it('keeps every scene’s visual, and alternates pan and push from where the seed says', () => {
    const four = ['s1', 's2', 's3', 's4'].map((id) => scene(id, callout));
    const plan = defaultDirection({ scenes: four, evidence, seed: 0 });
    expect(plan).toMatchObject({ schemaVersion: 1, draft: true });
    for (const shot of plan.shots)
      expect(shot.elements).toEqual([{ id: 'visual', kind: 'visual' }]);
    expect(kinds(four, 0)).toEqual([undefined, 'pan', 'push', 'pan']);
    expect(kinds(four, 1)).toEqual([undefined, 'push', 'pan', 'push']);
  });

  it('zooms into the hero, wipes a before/after, and cuts to a scene showing the same capture', () => {
    const scenes = [
      scene('s1', callout),
      scene('s2', capture),
      scene('s3', capture),
      scene('s4', compare),
      scene('s5', callout, { hero: true }),
      scene('s6', callout),
    ];
    expect(kinds(scenes, 0)).toEqual([undefined, 'pan', 'cut', 'wipe', 'zoom', 'push']);
  });

  it('leaves a transition the storyboard chose, and lets an agent’s shot choose its own', () => {
    const scenes = [
      scene('s1', callout),
      scene('s2', callout, { transition: 'fade' }),
      scene('s3', callout),
    ];
    const drafted = defaultDirection({ scenes, evidence, seed: 0 });
    expect(drafted.shots[1]).not.toHaveProperty('enter');
    expect([...entrances(drafted, scenes, evidence, 0)]).toEqual([
      ['s2', 'fade'],
      ['s3', 'pan'],
    ]);
    const authored = DirectionSchema.parse({
      shots: [{ scene: 's3', enter: 'zoom', elements: [{ id: 'visual', kind: 'visual' }] }],
    });
    const merged = mergeDirection(authored, drafted);
    expect(merged.draft).toBe(false);
    expect(merged.shots.map((s) => s.scene).sort()).toEqual(['s1', 's2', 's3']);
    expect(entrances(merged, scenes, evidence, 0).get('s3')).toBe('zoom');
    // A draft the agent never rewrote is Covi's own: it is derived again.
    expect(mergeDirection({ ...authored, draft: true }, drafted)).toBe(drafted);
    expect(mergeDirection(undefined, drafted)).toBe(drafted);
  });

  it('zooms toward the lines a code scene highlights, as they light', () => {
    const pinned = scene('s2', code, {
      narration: 'The fix clamps the quantity at zero.',
      sync: { highlight1: 'clamps the quantity' },
    });
    const [, shot] = defaultDirection({ scenes: [scene('s1', callout), pinned], evidence, seed: 0 })
      .shots;
    expect(shot!.beats).toEqual([
      { verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM, at: 'clamps the quantity' },
    ]);
    const unpinned = defaultDirection({ scenes: [scene('s1', code)], evidence, seed: 0 }).shots[0]!;
    expect(unpinned.beats).toEqual([{ verb: 'camera', move: 'zoom', to: 'visual', zoom: CODE_ZOOM }]);
    // Captures already move their own camera inside their frame.
    expect(defaultDirection({ scenes: [scene('s1', capture)], evidence, seed: 0 }).shots[0]!.beats).toEqual(
      [],
    );
  });

  it('reads what scenes show, never what they cite, so editing citations never moves a frame', () => {
    const scenes = [scene('s1', callout), scene('s2', callout), scene('s3', code)];
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['diff-hunk:src/cart.ts:10'] }));
    expect(defaultDirection({ scenes: cited, evidence, seed: 7 })).toEqual(
      defaultDirection({ scenes, evidence, seed: 7 }),
    );
  });

  it('is deterministic, and passes Covi’s own checks', () => {
    const scenes = [scene('s1', callout), scene('s2', code), scene('s3', capture, { hero: true })];
    const plan = defaultDirection({ scenes, evidence, seed: 3 });
    expect(defaultDirection({ scenes, evidence, seed: 3 })).toEqual(plan);
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });
});
```

In `tests/examples.test.ts`, add to the imports: `seedFrom` (from `@covi/core`), and

```ts
import { defaultDirection, entrances } from '../packages/video/src/direction/director.ts';
import { directionProblems } from '../packages/video/src/direction/refs.ts';
import { directionSources } from '../packages/video/src/direction/sources.ts';
```

and inside `describe(example.name, …)`, after the `drafts valid storyboards …` test:

```ts
      it('directs its drafted storyboards with shots Covi’s own checks accept', async () => {
        const { change, context, review, explanation, config } = await analyzeExample(example.name);
        const templates = await loadTemplates();
        const evidence = indexEvidence(buildEvidence({ diff: change.files }));
        const sources = directionSources({ files: change.files, evidence });
        for (const mode of ['short', 'standard'] as const) {
          const storyboard = draftStoryboard({
            change,
            context,
            explanation,
            review,
            spec: resolveVideoSpec(config, { mode }),
            templates,
          });
          const seed = seedFrom(storyboard.title);
          const plan = defaultDirection({ scenes: storyboard.scenes, evidence, seed });
          expect(plan.shots.map((s) => s.scene)).toEqual(storyboard.scenes.map((s) => s.id));
          expect(directionProblems(plan, storyboard.scenes, evidence, sources)).toEqual([]);
          expect(defaultDirection({ scenes: storyboard.scenes, evidence, seed })).toEqual(plan);
          // No entrance takes more than 60% of the story's moves (B1's transition-variety check).
          const moves = [...entrances(plan, storyboard.scenes, evidence, seed).values()];
          if (moves.length >= 4)
            for (const kind of new Set(moves))
              expect(moves.filter((k) => k === kind).length / moves.length, kind).toBeLessThanOrEqual(0.6);
        }
      });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/director.test.ts`
Expected: FAIL — `Cannot find module '../src/direction/director.ts'`.

- [ ] **Step 3: Implement**

Create `packages/video/src/direction/director.ts`:

```ts
import type { EvidenceIndex } from '@covi/core';
import { sceneEvidence } from '../grounding.ts';
import { highlightGroups } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { TransitionKind } from '../timeline/types.ts';
import type { Direction, Shot, ShotBeat } from './schema.ts';

/** How far the camera zooms toward the lines a code scene highlights. */
export const CODE_ZOOM = 1.25;

export interface DirectorInput {
  /** The storyboard's scenes as they will be drawn (redacted), with their ids. */
  scenes: readonly Scene[];
  evidence?: EvidenceIndex;
  /** The timeline's seed (from the title): a different change starts the rotation differently. */
  seed: number;
}

const sceneId = (scene: Pick<Scene, 'id'>, i: number) => scene.id ?? `s${i + 1}`;

/**
 * Covi's own direction, for every run without an agent's (CI and `--json` runs get the same
 * motion as interactive ones): each scene keeps its storyboard visual, a code scene that
 * highlights lines zooms toward them as they light, and each scene after the first gets its
 * entrance from the rotation unless the storyboard set its `transition`. Pure and deterministic.
 * It never invents content: what it adds later (morphs, metrics, flows) comes from evidence too.
 */
export function defaultDirection(input: DirectorInput): Direction {
  const shots: Shot[] = input.scenes.map((scene, i) => ({
    scene: sceneId(scene, i),
    elements: [{ id: 'visual', kind: 'visual' }],
    beats: cameraBeats(scene),
  }));
  const entered = entrances({ shots }, input.scenes, input.evidence, input.seed);
  input.scenes.forEach((scene, i) => {
    const kind = entered.get(sceneId(scene, i));
    // A transition the storyboard chose stays the storyboard's: the shot does not repeat it.
    if (kind && !scene.transition) shots[i]!.enter = kind;
  });
  return { schemaVersion: 1, draft: true, shots };
}

/**
 * A code scene that highlights lines zooms toward them, on the phrase that lights its first group
 * (or all of them), else spread through its line. Captures move their own camera inside their
 * frame (marks, focus), so a stage zoom would compound it; they get none.
 */
function cameraBeats(scene: Scene): ShotBeat[] {
  const v = scene.visual;
  if (v.kind !== 'code' || !v.highlight.length) return [];
  const sync = scene.sync ?? {};
  const phase = [highlightGroups(v.highlight)[0]?.phase, 'highlight'].find(
    (name): name is string => name !== undefined && Object.hasOwn(sync, name),
  );
  return [
    {
      verb: 'camera',
      move: 'zoom',
      to: 'visual',
      zoom: CODE_ZOOM,
      ...(phase ? { at: sync[phase]! } : {}),
    },
  ];
}

/**
 * How each scene after the first enters: its shot's `enter`, else its storyboard `transition`,
 * else the rotation. The hero zooms (the camera pulls back to reach its stop); a before/after
 * wipes; a scene that shows what the one before showed cuts (the same subject continues); the
 * rest alternate pan and push, the seed picking which comes first, so no kind takes much more than
 * half of the moves. Scenes are read for what they show, never for what they cite: editing
 * citations never moves a frame.
 */
export function entrances(
  plan: Pick<Direction, 'shots'>,
  scenes: readonly Scene[],
  evidence: EvidenceIndex | undefined,
  seed: number,
): Map<string, TransitionKind> {
  const enter = new Map(plan.shots.map((s) => [s.scene, s.enter]));
  const shows = (scene: Scene) => (evidence ? sceneEvidence({ visual: scene.visual }, evidence) : []);
  const out = new Map<string, TransitionKind>();
  // The kind the alternation used last: the first scene it reaches takes the other one.
  let last: 'pan' | 'push' = seed % 2 === 0 ? 'push' : 'pan';
  let before = scenes[0] ? shows(scenes[0]) : [];
  const rotate = (scene: Scene, now: readonly string[]): TransitionKind => {
    if (scene.hero) return 'zoom';
    if (scene.visual.kind === 'before-after') return 'wipe';
    if (now.some((id) => before.includes(id))) return 'cut';
    return last === 'pan' ? 'push' : 'pan';
  };
  scenes.forEach((scene, i) => {
    if (i === 0) return;
    const now = shows(scene);
    const kind = enter.get(sceneId(scene, i)) ?? scene.transition ?? rotate(scene, now);
    if (kind === 'pan' || kind === 'push') last = kind;
    out.set(sceneId(scene, i), kind);
    before = now;
  });
  return out;
}

/** The agent's shots, with the default director's for every scene it leaves out. */
export function mergeDirection(authored: Direction | undefined, drafted: Direction): Direction {
  if (!authored || authored.draft) return drafted;
  const own = new Set(authored.shots.map((s) => s.scene));
  return {
    schemaVersion: 1,
    draft: false,
    shots: [...authored.shots, ...drafted.shots.filter((s) => !own.has(s.scene))],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/director.test.ts tests/examples.test.ts`
Expected: PASS. If the examples' 60% assertion fails, print the moves (`console.log(example.name, mode, moves)`) and check the rotation rules above against them before touching the assertion: a drafted storyboard that cuts most of the time means the "same evidence" rule is too broad, which the transition-variety check would flag in every such video.

Then `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/direction/director.ts packages/video/test/director.test.ts tests/examples.test.ts
git commit -m "$(cat <<'EOF'
Add the default director and its entrance rotation

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 5: Resolving a direction — stops on the canvas, element slots, content from evidence, beats on phrases

**Files:**
- Modify: `packages/video/src/runtime/layout.ts` (add `gridSpacing`; DOM-free, shared with Node)
- Create: `packages/video/src/direction/stops.ts`
- Create: `packages/video/src/direction/layout.ts`
- Create: `packages/video/src/direction/resolve.ts`
- Modify: `packages/video/src/timeline/build.ts:86-106` (extract `phraseMoment` from `scenePhases`)
- Modify: `packages/video/src/storyboard/draft.ts:1224` (export `clipLines`)
- Modify: `packages/video/src/grounding.ts:41-74` (`sceneEvidence` counts a shot's elements)
- Create: `packages/video/test/direction-resolve.test.ts`
- Modify: `packages/video/test/grounding.test.ts`

**Interfaces:**
- Consumes: `Direction`, `Shot`, `ShotElement`, `ShotLayout` (Task 2); `DirectionSources`, `hunkView` (Task 3); `SceneStaging`, `SceneDirection`, `DirectionElement`, `DirectionBeat`, `Stop` (Task 1); `Layout`, `SceneTiming` (`timeline/build.ts`); `computeRegions`, `Regions` (`runtime/layout.ts`); `seededRandom` (`@covi/core`).
- Produces:
  ```ts
  // packages/video/src/runtime/layout.ts
  /** The stage's dot grid spacing in px (30 design units, as the stylesheet rounds it). */
  export function gridSpacing(unit: number): number;

  // packages/video/src/direction/stops.ts
  export const STOP_GAP = 0.25;   // frame widths
  export const HERO_DROP = 0.5;   // frame heights
  export function canvasStops(input: {
    count: number; hero?: number; seed: number; width: number; height: number; grid: number;
  }): Stop[];

  // packages/video/src/direction/layout.ts
  export function headerless(visual: { kind: string; background?: unknown }): boolean;
  export function shotRegion(whole: boolean, visual: { kind: string; background?: unknown }, regions: Regions): Rect;
  export function elementSlots(
    kinds: readonly ShotElement['kind'][], layout: ShotLayout, region: Rect,
    orientation: 'vertical' | 'landscape' | 'square', gap: number,
  ): Rect[];

  // packages/video/src/timeline/build.ts
  export function phraseMoment(text: string, phrase: string, timing: SceneTiming, options: CaptionOptions): number | undefined;

  // packages/video/src/direction/resolve.ts
  export const BEAT_SECONDS: { reveal: 0.5; camera: 0.8 };
  export const CODE_LINES: { landscape: 14; vertical: 18 };
  export interface ResolveInput {
    plan: Pick<Direction, 'shots'>;
    scenes: readonly Scene[];          // as fitted (redacted), ids filled
    layout: Layout;                    // aligned with scenes
    spec: Pick<VideoSpec, 'width' | 'height'>;
    language: Language;
    sources: DirectionSources;
    image: (path: string) => ImageAsset;
    seed: number;
    redact: <T>(value: T) => T;
  }
  export function resolveDirection(input: ResolveInput): SceneStaging[];   // aligned with scenes, redacted
  export function directionImages(plan: Pick<Direction, 'shots'>, sources: DirectionSources): string[];

  // packages/video/src/grounding.ts
  export function sceneEvidence(
    scene: Pick<Scene, 'visual' | 'evidenceIds'>, index: EvidenceIndex,
    findings?: ReadonlyArray<Pick<Finding, 'title' | 'evidenceIds'>>,
    shot?: Pick<Shot, 'elements'>,
  ): string[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-resolve.test.ts`:

```ts
import {
  buildEvidence,
  DEFAULT_CONFIG,
  type Demonstration,
  type Hunk,
  indexEvidence,
  Redactor,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { captionOptionsFor } from '../src/captions.ts';
import { elementSlots, shotRegion } from '../src/direction/layout.ts';
import { BEAT_SECONDS, directionImages, resolveDirection } from '../src/direction/resolve.ts';
import { DirectionSchema, type DirectionInput } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { canvasStops, HERO_DROP, STOP_GAP } from '../src/direction/stops.ts';
import { computeRegions, gridSpacing } from '../src/runtime/layout.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor, phraseMoment } from '../src/timeline/build.ts';

const W = 1920;
const H = 1080;
const grid = gridSpacing(1);

describe('stops on the canvas', () => {
  const stops = canvasStops({ count: 14, seed: 42, width: W, height: H, grid });

  it('run to the right and turn down every 2–4 stops, a quarter frame apart', () => {
    expect(stops[0]).toEqual({ x: 0, y: 0 });
    let run = 0;
    for (let i = 1; i < stops.length; i++) {
      const dx = stops[i]!.x - stops[i - 1]!.x;
      const dy = stops[i]!.y - stops[i - 1]!.y;
      if (dy === 0) {
        expect(Math.abs(dx - W * (1 + STOP_GAP))).toBeLessThanOrEqual(grid);
        run++;
      } else {
        expect(dx).toBe(0);
        expect(Math.abs(dy - (H + STOP_GAP * W))).toBeLessThanOrEqual(grid);
        expect(run).toBeGreaterThanOrEqual(2);
        expect(run).toBeLessThanOrEqual(4);
        run = 0;
      }
    }
  });

  it('sit on the stage’s dot grid, the same for the same seed and different for others', () => {
    for (const s of stops) {
      expect(Math.abs(s.x / grid - Math.round(s.x / grid))).toBeLessThan(1e-9);
      expect(Math.abs(s.y / grid - Math.round(s.y / grid))).toBeLessThan(1e-9);
    }
    expect(canvasStops({ count: 14, seed: 42, width: W, height: H, grid })).toEqual(stops);
    const paths = new Set(
      Array.from({ length: 8 }, (_, seed) =>
        JSON.stringify(canvasStops({ count: 14, seed, width: W, height: H, grid })),
      ),
    );
    expect(paths.size).toBeGreaterThan(1);
  });

  it('drop the hero’s stop off the row, so the camera pulls back to reach it', () => {
    const plain = canvasStops({ count: 6, seed: 9, width: W, height: H, grid });
    const hero = canvasStops({ count: 6, hero: 3, seed: 9, width: W, height: H, grid });
    expect(hero[3]!.x).toBe(plain[3]!.x);
    expect(Math.abs(hero[3]!.y - plain[3]!.y - HERO_DROP * H)).toBeLessThanOrEqual(grid);
    expect(hero[4]).toEqual(plain[4]);
  });
});

describe('element slots', () => {
  const region = { x: 0, y: 0, width: 1000, height: 600 };
  it('weigh a row by kind: code takes three parts to a label’s one', () => {
    const [a, b] = elementSlots(['code', 'label'], 'row', region, 'landscape', 20);
    expect(a).toEqual({ x: 0, y: 0, width: 735, height: 600 });
    expect(b).toEqual({ x: 755, y: 0, width: 245, height: 600 });
  });
  it('stack a column, split in two, and lay out a grid for four or more', () => {
    expect(elementSlots(['code', 'code'], 'column', region, 'landscape', 20)[1]).toEqual({
      x: 0,
      y: 310,
      width: 1000,
      height: 290,
    });
    const split = elementSlots(['visual', 'node', 'node'], 'split', region, 'landscape', 20);
    expect(split[0]).toEqual({ x: 0, y: 0, width: 490, height: 600 });
    expect(split[1]).toEqual({ x: 510, y: 0, width: 490, height: 290 });
    expect(split[2]).toEqual({ x: 510, y: 310, width: 490, height: 290 });
    const vertical = elementSlots(['visual', 'label'], 'split', region, 'vertical', 20);
    expect(vertical[1]).toEqual({ x: 0, y: 310, width: 1000, height: 290 });
    const four = elementSlots(['node', 'node', 'node', 'node'], 'auto', region, 'landscape', 20);
    expect(four.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [510, 0],
      [0, 310],
      [510, 310],
    ]);
    expect(elementSlots(['visual'], 'auto', region, 'landscape', 20)).toEqual([region]);
    expect(elementSlots(['code', 'label'], 'auto', region, 'landscape', 20)[0]!.width).toBe(490);
  });
  it('give the visual alone its own region: a card without a header fills the frame', () => {
    const regions = computeRegions({ width: W, height: H, orientation: 'landscape' });
    expect(shotRegion(true, { kind: 'summary' }, regions)).toEqual(regions.full);
    expect(shotRegion(true, { kind: 'title' }, regions)).toEqual(regions.full);
    expect(shotRegion(true, { kind: 'title', background: {} }, regions)).toEqual(regions.media);
    expect(shotRegion(false, { kind: 'summary' }, regions)).toEqual(regions.media);
    expect(shotRegion(true, { kind: 'code' }, regions)).toEqual(regions.media);
  });
});

// A run with one hunk (holding a secret), one demo command run before and after, and one capture.
const SECRET = 'hunter2-shh-secret';
const hunk: Hunk = {
  oldStart: 10,
  oldLines: 2,
  newStart: 10,
  newLines: 2,
  lines: [
    { kind: 'context', text: '\tconst token = load();', oldLine: 10, newLine: 10 },
    { kind: 'del', text: `send(docs, "${SECRET}");`, oldLine: 11 },
    { kind: 'add', text: 'send(ids);', newLine: 11 },
  ],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node scripts/measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
  ],
  shots: [{ id: 'home', kind: 'page', name: '/', viewport: 'desktop', after: { path: 'demo/home.png' } }],
} as unknown as Pick<Demonstration, 'commands' | 'shots'>;
const evidence = indexEvidence(
  buildEvidence({
    diff: files,
    demo: { ...demo, requests: [], skipped: [], findings: [] } as unknown as Demonstration,
    fileSha: () => '0'.repeat(64),
  }),
);
const sources = directionSources({ files, demo, evidence });
const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const scene = (id: string, narration: string, visual: unknown, extra = {}): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual, ...extra });
const scenes = [
  scene('s1', 'The request carried every document.', { kind: 'callout', title: 'Before' }),
  scene('s2', 'Now it sends [[only the ids]], and the reader fetches each one.', {
    kind: 'callout',
    title: 'After',
  }),
  scene('s3', 'That is the change.', { kind: 'summary', verdict: 'looks-good', headline: 'H' }),
];
const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
const redactor = new Redactor({ literals: [SECRET] });
const resolve = (direction: DirectionInput) =>
  resolveDirection({
    plan: DirectionSchema.parse(direction),
    scenes,
    layout,
    spec,
    language: 'en',
    sources,
    image: (path) => ({ src: `assets/${path}`, width: 800, height: 600 }),
    seed: 5,
    redact: (value) => redactor.redactDeep(value),
  });

describe('resolving a direction', () => {
  const staging = resolve({
    shots: [
      {
        scene: 's2',
        layout: 'row',
        elements: [
          { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:10', side: 'diff' },
          { id: 'out', kind: 'output', evidence: 'terminal:1', side: 'base' },
          { id: 'page', kind: 'capture', evidence: 'screenshot:home' },
          { id: 'reader', kind: 'node', label: 'Reader' },
          { id: 'note', kind: 'label', text: 'Much smaller', tone: 'success' },
        ],
        beats: [
          { verb: 'place', element: 'req' },
          { verb: 'camera', move: 'zoom', to: 'req', zoom: 1.5 },
          { verb: 'reveal', element: 'note', style: 'pop', at: 'only the ids' },
          { verb: 'reveal', element: 'reader', at: 'a phrase redaction removed' },
        ],
      },
    ],
  });
  const [s1, s2, s3] = staging;

  it('gives every story scene a stop, and the scenes without a shot their visual alone', () => {
    expect(staging).toHaveLength(3);
    expect(s1!.stop).toEqual({ x: 0, y: 0 });
    expect(s2!.stop.x).toBeGreaterThan(0);
    expect(s1!.direction).toEqual({
      whole: true,
      elements: [{ id: 'visual', kind: 'visual', rect: computeRegions({ ...spec, orientation: 'landscape' }).media }],
      beats: [],
    });
    expect(s3!.direction.elements[0]!.rect).toEqual(
      computeRegions({ ...spec, orientation: 'landscape' }).full,
    );
  });

  it('takes each element’s content from the evidence it cites', () => {
    const [req, out, page, reader, note] = s2!.direction.elements;
    expect(s2!.direction.whole).toBe(false);
    expect(req).toMatchObject({
      kind: 'code',
      visual: {
        kind: 'code',
        path: 'src/request.js',
        language: 'javascript',
        highlight: [],
        lines: [
          { type: 'context', text: '  const token = load();', number: 10 },
          { type: 'del', number: 11 },
          { type: 'add', text: 'send(ids);', number: 11 },
        ],
      },
    });
    expect(out).toMatchObject({
      kind: 'output',
      visual: { kind: 'terminal', title: 'measure', command: 'node scripts/measure.js', output: 'request bytes: 120000' },
    });
    expect(page).toMatchObject({
      kind: 'capture',
      visual: { kind: 'screenshot', image: { src: 'assets/demo/home.png' }, device: 'desktop' },
    });
    expect(reader).toMatchObject({ kind: 'node', label: 'Reader' });
    expect(note).toMatchObject({ kind: 'label', text: 'Much smaller', tone: 'success' });
    // Slots fill the media region in a row, left to right.
    const xs = s2!.direction.elements.map((e) => e.rect.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('redacts everything it resolves', () => {
    expect(JSON.stringify(staging)).not.toContain(SECRET);
    expect(JSON.stringify(staging)).toContain('[REDACTED]');
  });

  it('times beats on their phrases, spreads the rest through the line, and drops place', () => {
    const timing = layout.scenes[1]!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const text = 'Now it sends only the ids, and the reader fetches each one.';
    const beats = s2!.direction.beats;
    expect(beats.map((b) => b.verb)).toEqual(['camera', 'reveal', 'reveal']);
    const pop = beats.find((b) => b.verb === 'reveal' && b.element === 'note')!;
    expect(pop).toMatchObject({ style: 'pop', seconds: BEAT_SECONDS.reveal });
    expect(pop.t).toBe(phraseMoment(text, 'only the ids', timing, options));
    // Unpinned (or pinned to a phrase the line lost) beats take evenly spaced slots from 0.15.
    const speech = timing.speechEnd - timing.speechStart;
    const lead = timing.speechStart - timing.start;
    const camera = beats.find((b) => b.verb === 'camera')!;
    expect(camera).toMatchObject({ move: 'zoom', to: 'req', zoom: 1.5, seconds: BEAT_SECONDS.camera });
    expect(camera.t).toBeCloseTo(lead + speech * 0.15, 3);
    const lost = beats.find((b) => b.verb === 'reveal' && b.element === 'reader')!;
    expect(lost.t).toBeCloseTo(lead + speech * (0.15 + (0.85 * 2) / 3), 3);
    expect(lost.style).toBe('rise');
    // In time order.
    expect(beats.map((b) => b.t)).toEqual([...beats.map((b) => b.t)].sort((a, b) => a - b));
  });

  it('lists the run images a shot shows, for the composition', () => {
    expect(
      directionImages(
        DirectionSchema.parse({
          shots: [{ scene: 's2', elements: [{ id: 'p', kind: 'capture', evidence: 'screenshot:home' }] }],
        }),
        sources,
      ),
    ).toEqual(['demo/home.png']);
  });

  it('keeps at most 14 lines of a long hunk, around its changes', () => {
    const long: Hunk = {
      oldStart: 1,
      oldLines: 30,
      newStart: 1,
      newLines: 31,
      lines: [
        ...Array.from({ length: 20 }, (_, i) => ({ kind: 'context' as const, text: `c${i}`, oldLine: i + 1, newLine: i + 1 })),
        { kind: 'add' as const, text: 'added();', newLine: 21 },
        ...Array.from({ length: 10 }, (_, i) => ({ kind: 'context' as const, text: `d${i}`, oldLine: 21 + i, newLine: 22 + i })),
      ],
    };
    const longFiles = [{ path: 'a.js', hunks: [long] }];
    const longEvidence = indexEvidence(buildEvidence({ diff: longFiles }));
    const [only] = resolveDirection({
      plan: DirectionSchema.parse({
        shots: [{ scene: 's1', elements: [{ id: 'c', kind: 'code', evidence: 'diff-hunk:a.js:1' }] }],
      }),
      scenes: [scenes[0]!],
      layout: { ...layout, scenes: [layout.scenes[0]!] },
      spec,
      language: 'en',
      sources: directionSources({ files: longFiles, evidence: longEvidence }),
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (v) => v,
    });
    const code = only!.direction.elements[0]!;
    if (code.kind !== 'code') throw new Error('expected code');
    expect(code.visual.lines).toHaveLength(14);
    expect(code.visual.lines.some((l) => l.text === 'added();')).toBe(true);
  });
});
```

In `packages/video/test/grounding.test.ts`, add `import { DirectionSchema } from '../src/direction/schema.ts';` and, in the `describe` that tests `sceneEvidence`, this test:

```ts
  it('counts what a shot shows: its elements’ evidence, and the visual only when the shot keeps it', () => {
    const scene = { visual: visual({ kind: 'screenshot', image: { path: 'demo/screenshots/cart-desktop-after.png' } }) };
    const shot = (elements: unknown[]) =>
      DirectionSchema.parse({ shots: [{ scene: 's1', elements }] }).shots[0]!;
    expect(
      sceneEvidence(scene, index, [], shot([
        { id: 'v', kind: 'visual' },
        { id: 'c', kind: 'code', evidence: 'diff-hunk:src/cart.ts:10' },
      ])),
    ).toEqual(['screenshot:cart-desktop-after', 'diff-hunk:src/cart.ts:10']);
    // A shot without the visual replaces it: the capture is not on screen.
    expect(
      sceneEvidence(scene, index, [], shot([
        { id: 'o', kind: 'output', evidence: 'terminal:1' },
        { id: 'n', kind: 'node', label: 'Cart', evidence: ['http:1', 'not-in-the-run:1'] },
      ])),
    ).toEqual(['terminal:1', 'http:1']);
    // Citations always count.
    expect(
      sceneEvidence({ ...scene, evidenceIds: ['http:1'] }, index, [], shot([{ id: 'l', kind: 'label', text: 'Cart' }])),
    ).toEqual(['http:1']);
  });
```

(If that `describe` is not the one holding the other `sceneEvidence` tests, put it next to them; `visual` and `index` are the file's own helpers.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-resolve.test.ts packages/video/test/grounding.test.ts`
Expected: FAIL — missing modules `stops.ts`, `layout.ts`, `resolve.ts`, and `gridSpacing`/`phraseMoment` exports.

- [ ] **Step 3: Implement**

`packages/video/src/runtime/layout.ts` — append:

```ts
/**
 * The stage's dot grid spacing in px: 30 design units, rounded as the stylesheet writes it, so
 * the canvas's grid and the stage's line up exactly.
 */
export function gridSpacing(unit: number): number {
  return Number((30 * unit).toFixed(2));
}
```

`packages/video/src/timeline/build.ts` — add `type CaptionOptions` is already imported; extract the phrase timing out of `scenePhases`:

```ts
/**
 * When a phrase of a line is heard, in seconds since its scene started: its place in the line's
 * caption window, split as the captions split it. Nothing when the phrase is not in the line
 * exactly once: redaction can rewrite a line after it was validated.
 */
export function phraseMoment(
  text: string,
  phrase: string,
  timing: SceneTiming,
  options: CaptionOptions,
): number | undefined {
  const span = findPhrase(text, phrase);
  if (span.count !== 1) return undefined;
  const caption = captionWindow({ text, start: timing.speechStart, end: timing.speechEnd });
  const time = phraseTime(caption, span, options);
  return time ? round(time.start - timing.start) : undefined;
}
```

and in `scenePhases`, replace the loop body (and drop its now unused `caption` constant):

```ts
  for (const [name, phrase] of Object.entries(scene.sync ?? {})) {
    const at = phraseMoment(text, phrase, timing, options);
    if (at !== undefined) phases[name] = at;
  }
```

`SceneTiming` is declared further down the file; interfaces are hoisted, so the order is fine.

`packages/video/src/storyboard/draft.ts:1224` — `function clipLines(` becomes `export function clipLines(`.

Create `packages/video/src/direction/stops.ts`:

```ts
import { seededRandom } from '@covi/core';
import type { Stop } from '../timeline/types.ts';

/** Stops are a quarter of a frame width apart. */
export const STOP_GAP = 0.25;
/** The hero's stop sits this share of a frame lower than the path would put it. */
export const HERO_DROP = 0.5;

/**
 * Where each story scene's stop sits on the canvas: a path that runs to the right and turns down
 * every 2–4 stops (the seed decides where, so a different change travels differently), with the
 * hero's stop dropped off the row so the camera pulls back to reach it. Coordinates are multiples
 * of the dot grid (`grid` px), so at every stop the canvas's dots line up with the stage's.
 */
export function canvasStops(input: {
  count: number;
  hero?: number;
  seed: number;
  width: number;
  height: number;
  grid: number;
}): Stop[] {
  const { width, height, grid } = input;
  const random = seededRandom(input.seed);
  const turn = () => 2 + Math.floor(random() * 3);
  const snap = (v: number) => Math.round(v / grid) * grid;
  const gap = STOP_GAP * width;
  const stops: Stop[] = [];
  let x = 0;
  let y = 0;
  let run = 0;
  let turnAfter = turn();
  for (let i = 0; i < input.count; i++) {
    if (i > 0) {
      if (run >= turnAfter) {
        y += height + gap;
        run = 0;
        turnAfter = turn();
      } else {
        x += width + gap;
        run++;
      }
    }
    const drop = i === input.hero ? HERO_DROP * height : 0;
    stops.push({ x: snap(x), y: snap(y + drop) });
  }
  return stops;
}
```

Check against the test: after a turn `run` restarts at 0 and counts rightward moves, so the next turn comes after 2–4 of them; the first stop starts a row (run 0).

Create `packages/video/src/direction/layout.ts`:

```ts
import type { Regions } from '../runtime/layout.ts';
import type { Rect } from '../timeline/types.ts';
import type { ShotElement, ShotLayout } from './schema.ts';

/** How much room each kind takes along a row or a column. */
const WEIGHT: Record<ShotElement['kind'], number> = {
  visual: 3,
  code: 3,
  output: 3,
  capture: 3,
  node: 2,
  label: 1,
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const round = (r: Rect): Rect => ({ x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) });

/** Cards that draw their own header (a title without a capture, the summary) fill the frame. */
export function headerless(visual: { kind: string; background?: unknown }): boolean {
  return visual.kind === 'summary' || (visual.kind === 'title' && visual.background === undefined);
}

/**
 * The region a shot lays out in. The storyboard visual alone keeps the region it has without
 * direction; any other shot keeps the scene header, so it uses the media region.
 */
export function shotRegion(
  whole: boolean,
  visual: { kind: string; background?: unknown },
  regions: Regions,
): Rect {
  return whole && headerless(visual) ? regions.full : regions.media;
}

/** Splits `region` along one axis into parts sized by weight, `gap` apart. */
function along(region: Rect, weights: readonly number[], axis: 'x' | 'y', gap: number): Rect[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const span = (axis === 'x' ? region.width : region.height) - gap * (weights.length - 1);
  let at = axis === 'x' ? region.x : region.y;
  return weights.map((w) => {
    const size = (span * w) / total;
    const rect =
      axis === 'x'
        ? { x: at, y: region.y, width: size, height: region.height }
        : { x: region.x, y: at, width: region.width, height: size };
    at += size + gap;
    return rect;
  });
}

/**
 * Deterministic slots for a shot's elements, in stop-local stage pixels. `auto` picks from the
 * count: one fills the region, two split it, three line up (a row on wide frames, a column on
 * tall ones), and more make a grid of two columns on tall frames or two rows on wide ones.
 */
export function elementSlots(
  kinds: readonly ShotElement['kind'][],
  layout: ShotLayout,
  region: Rect,
  orientation: 'vertical' | 'landscape' | 'square',
  gap: number,
): Rect[] {
  const n = kinds.length;
  const tall = orientation === 'vertical';
  const weights = kinds.map((k) => WEIGHT[k]);
  const resolved =
    layout !== 'auto'
      ? layout
      : n === 1
        ? 'single'
        : n === 2
          ? 'split'
          : n === 3
            ? tall
              ? 'column'
              : 'row'
            : 'grid';
  let slots: Rect[];
  if (resolved === 'single') slots = kinds.map(() => region);
  else if (resolved === 'row') slots = along(region, weights, 'x', gap);
  else if (resolved === 'column') slots = along(region, weights, 'y', gap);
  else if (resolved === 'split') {
    const [first, rest] = along(region, [1, 1], tall ? 'y' : 'x', gap) as [Rect, Rect];
    slots = [first, ...(n > 1 ? along(rest, weights.slice(1), tall ? 'x' : 'y', gap) : [])];
  } else {
    const columns = tall ? 2 : Math.ceil(n / 2);
    const rows = Math.ceil(n / columns);
    const lines = along(region, Array(rows).fill(1), 'y', gap);
    slots = kinds.map((_, i) => along(lines[Math.floor(i / columns)]!, Array(columns).fill(1), 'x', gap)[i % columns]!);
  }
  return slots.map(round);
}
```

Check against the tests: a row of `code` + `label` in 1000 px with a 20 px gap has 980 px to share 3:1 (735 and 245); a split of three on a wide frame puts the first in the left half (490) and stacks the other two in the right half; on a tall frame the split is top and bottom, and the rest line up across the bottom half. Note the vertical test expects the second element of a two-element split at `y: 310` with full width: with two elements, the rest is one element and `along(rest, [w], 'x', gap)` returns `rest` itself. Four nodes on a wide frame: two rows of two.

Create `packages/video/src/direction/resolve.ts`:

```ts
import type { DiffLine, Language } from '@covi/core';
import { type CaptionOptions, captionOptionsFor } from '../captions.ts';
import { computeRegions, gridSpacing, type Regions } from '../runtime/layout.ts';
import { orientationOf, type VideoSpec } from '../spec.ts';
import { clipLines } from '../storyboard/draft.ts';
import { parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import { type Layout, phraseMoment, type SceneTiming } from '../timeline/build.ts';
import type {
  CodeLine,
  DirectionBeat,
  DirectionElement,
  ImageAsset,
  Rect,
  SceneDirection,
  SceneStaging,
} from '../timeline/types.ts';
import { elementSlots, shotRegion } from './layout.ts';
import type { Direction, Shot, ShotElement } from './schema.ts';
import { type DirectionSources, hunkView } from './sources.ts';
import { canvasStops } from './stops.ts';

/** How long each verb takes, in seconds. */
export const BEAT_SECONDS = { reveal: 0.5, camera: 0.8 } as const;
/** Code elements show at most this many lines (wide, tall frames), as the morph's elision will. */
export const CODE_LINES = { landscape: 14, vertical: 18 } as const;
/** Beats without a phrase start this far into the line, then spread evenly through the rest. */
const SPACED_FROM = 0.15;

export interface ResolveInput {
  plan: Pick<Direction, 'shots'>;
  /** The story's scenes as fitted (redacted, the lines the captions show), with their ids. */
  scenes: readonly Scene[];
  /** Their timing, aligned with `scenes`. */
  layout: Layout;
  spec: Pick<VideoSpec, 'width' | 'height'>;
  language: Language;
  sources: DirectionSources;
  /** Resolves a run-relative image path to its composition asset (prepared beforehand). */
  image: (path: string) => ImageAsset;
  /** The timeline's seed. */
  seed: number;
  /** The run's redaction: everything resolved passes through it. */
  redact: <T>(value: T) => T;
}

interface Context {
  regions: Regions;
  orientation: 'vertical' | 'landscape' | 'square';
  options: CaptionOptions;
  sources: DirectionSources;
  image: (path: string) => ImageAsset;
  language: Language;
}

/**
 * Every story scene's stop and shot, aligned with `scenes`: elements with their content from the
 * evidence they cite and their slots, beats at the moments their phrases are heard. A scene
 * without a shot shows its visual alone. Everything is redacted before it is returned.
 */
export function resolveDirection(input: ResolveInput): SceneStaging[] {
  const { width, height } = input.spec;
  const orientation = orientationOf(width, height);
  const regions = computeRegions({ width, height, orientation });
  const hero = input.scenes.findIndex((s) => s.hero);
  const stops = canvasStops({
    count: input.scenes.length,
    ...(hero === -1 ? {} : { hero }),
    seed: input.seed,
    width,
    height,
    grid: gridSpacing(regions.unit),
  });
  const shots = new Map(input.plan.shots.map((s) => [s.scene, s]));
  const ctx: Context = {
    regions,
    orientation,
    options: { ...captionOptionsFor(orientation), language: input.language },
    sources: input.sources,
    image: input.image,
    language: input.language,
  };
  const staged = input.scenes.map((scene, i): SceneStaging => {
    const id = scene.id ?? `s${i + 1}`;
    const shot = shots.get(id) ?? visualOnly(id);
    return { stop: stops[i]!, direction: resolveShot(shot, scene, input.layout.scenes[i]!, ctx) };
  });
  return input.redact(staged);
}

/** A scene without a shot shows its storyboard visual, as without direction. */
const visualOnly = (scene: string): Shot => ({
  scene,
  elements: [{ id: 'visual', kind: 'visual' }],
  beats: [],
});

function resolveShot(shot: Shot, scene: Scene, timing: SceneTiming, ctx: Context): SceneDirection {
  const revealed = new Set(shot.beats.flatMap((b) => (b.verb === 'reveal' ? [b.element] : [])));
  let whole =
    shot.elements.length === 1 &&
    shot.elements[0]!.kind === 'visual' &&
    !revealed.has(shot.elements[0]!.id);
  const region = shotRegion(whole, scene.visual, ctx.regions);
  const slots = elementSlots(
    shot.elements.map((e) => e.kind),
    shot.layout ?? 'auto',
    region,
    ctx.orientation,
    28 * ctx.regions.unit,
  );
  let elements = shot.elements.flatMap((e, k) => {
    const resolved = element(e, slots[k]!, ctx);
    return resolved ? [resolved] : [];
  });
  // Content a validated shot cites is in the run; should all of it be gone, the visual stays.
  if (!elements.length) {
    whole = true;
    elements = [{ id: 'visual', kind: 'visual', rect: shotRegion(true, scene.visual, ctx.regions) }];
  }
  const kept = new Set(elements.map((e) => e.id));
  return { whole, elements, beats: timeBeats(shot, scene, timing, ctx.options, kept) };
}

function element(e: ShotElement, rect: Rect, ctx: Context): DirectionElement | undefined {
  const tall = ctx.orientation === 'vertical';
  switch (e.kind) {
    case 'visual':
      return { id: e.id, kind: 'visual', rect };
    case 'code': {
      const hunk = ctx.sources.hunk(e.evidence);
      if (!hunk) return undefined;
      const view = hunkView(hunk.lines, e.side ?? 'head');
      const shown = e.lines
        ? view.slice(e.lines[0] - 1, e.lines[1])
        : codeWindow(view, tall ? CODE_LINES.vertical : CODE_LINES.landscape);
      if (!shown.length) return undefined;
      return {
        id: e.id,
        kind: 'code',
        rect,
        visual: {
          kind: 'code',
          path: hunk.path,
          ...(hunk.language ? { language: hunk.language } : {}),
          lines: shown.map(codeLine),
          highlight: [],
        },
      };
    }
    case 'output': {
      const command = ctx.sources.command(e.evidence);
      const text = (e.side ?? 'head') === 'base' ? command?.before : command?.output;
      if (!command || text === undefined) return undefined;
      return {
        id: e.id,
        kind: 'output',
        rect,
        visual: {
          kind: 'terminal',
          ...(command.name ? { title: command.name } : {}),
          command: command.command,
          output: clipLines(text, tall ? 8 : 12, ctx.language),
        },
      };
    }
    case 'capture': {
      const capture = ctx.sources.capture(e.evidence);
      if (!capture) return undefined;
      return {
        id: e.id,
        kind: 'capture',
        rect,
        visual: { kind: 'screenshot', image: ctx.image(capture.path), device: capture.device },
      };
    }
    case 'node':
      return { id: e.id, kind: 'node', rect, label: e.label };
    case 'label':
      return { id: e.id, kind: 'label', rect, text: e.text, tone: e.tone ?? 'neutral' };
  }
}

/** A diff line as the code component draws it (tabs as two spaces, cut at 96 characters). */
function codeLine(l: DiffLine): CodeLine {
  const number = l.kind === 'del' ? l.oldLine : l.newLine;
  return {
    type: l.kind,
    text: l.text.replace(/\t/g, '  ').slice(0, 96),
    ...(number === undefined ? {} : { number }),
  };
}

/** The `max` lines with the most changed lines among them, the earliest such window on a tie. */
function codeWindow(view: readonly DiffLine[], max: number): DiffLine[] {
  if (view.length <= max) return [...view];
  let best = 0;
  let most = -1;
  for (let start = 0; start + max <= view.length; start++) {
    const changed = view.slice(start, start + max).filter((l) => l.kind !== 'context').length;
    if (changed > most) {
      best = start;
      most = changed;
    }
  }
  return view.slice(best, best + max);
}

/**
 * Beats with their moments (seconds since the scene started), in time order: `at` lands on its
 * phrase as the captions time it; a beat without one, or whose phrase redaction removed, takes an
 * evenly spaced slot over the line from 0.15 of it (over the scene when it has no line). `place`
 * is the default made explicit, so it resolves to nothing; beats on elements that are gone drop.
 */
function timeBeats(
  shot: Shot,
  scene: Scene,
  timing: SceneTiming,
  options: CaptionOptions,
  kept: ReadonlySet<string>,
): DirectionBeat[] {
  const duration = timing.end - timing.start;
  const text = parseEmphasis(scene.narration).text;
  const live = shot.beats.filter((b) => b.verb !== 'place');
  const spoken = timing.speechEnd > timing.speechStart;
  const from = spoken ? timing.speechStart - timing.start : 0;
  const span = spoken ? timing.speechEnd - timing.speechStart : duration;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const beats = live.flatMap((beat, i): DirectionBeat[] => {
    const target = beat.verb === 'camera' ? beat.to : beat.element;
    if (!kept.has(target)) return [];
    const pinned = beat.at === undefined ? undefined : phraseMoment(text, beat.at, timing, options);
    const spaced = from + span * (SPACED_FROM + ((1 - SPACED_FROM) * i) / live.length);
    const t = round(Math.min(Math.max(0, pinned ?? spaced), Math.max(0, duration - 0.1)));
    const seconds = round(Math.min(BEAT_SECONDS[beat.verb], Math.max(0.1, duration - t)));
    return beat.verb === 'reveal'
      ? [{ verb: 'reveal', element: beat.element, style: beat.style ?? 'rise', t, seconds }]
      : [
          {
            verb: 'camera',
            move: beat.move,
            to: beat.to,
            ...(beat.zoom === undefined ? {} : { zoom: beat.zoom }),
            t,
            seconds,
          },
        ];
  });
  // Stable: beats at the same moment keep the order the agent wrote.
  return beats.sort((a, b) => a.t - b.t);
}

/** The run images a direction shows (its captures), for the composition to prepare. */
export function directionImages(
  plan: Pick<Direction, 'shots'>,
  sources: DirectionSources,
): string[] {
  const paths = plan.shots.flatMap((s) =>
    s.elements.flatMap((e) => (e.kind === 'capture' ? [sources.capture(e.evidence)?.path] : [])),
  );
  return [...new Set(paths.filter((p): p is string => p !== undefined))];
}
```

Check the spacing against the test: three live beats (camera, reveal note, reveal reader), so slots are at 0.15, 0.15 + 0.85/3, and 0.15 + 0.85·2/3 of the line; the camera (index 0) takes the first, the pinned reveal its phrase, and the reader reveal (index 2, phrase lost) the third.

`packages/video/src/grounding.ts` — add `import type { Shot } from './direction/schema.ts';` and replace `sceneEvidence` with the two functions below (the visual-specific body moves unchanged into `visualEvidence`). A cited id inside a shot is stored as the registry holds it (`item.id`), like every other id the timeline records.

```ts
/**
 * The evidence a scene rests on: the ids it cites, then what is on screen from the run. Without
 * direction, or when its shot keeps the storyboard visual, that is what the visual shows (the
 * captured images, the diff hunks of its code, the request, command, or findings on screen); a
 * shot adds what its elements cite, and a shot without the visual replaces it.
 */
export function sceneEvidence(
  scene: Pick<Scene, 'visual' | 'evidenceIds'>,
  index: EvidenceIndex,
  findings: ReadonlyArray<Pick<Finding, 'title' | 'evidenceIds'>> = [],
  shot?: Pick<Shot, 'elements'>,
): string[] {
  const ids = [...(scene.evidenceIds ?? [])];
  if (!shot || shot.elements.some((e) => e.kind === 'visual'))
    ids.push(...visualEvidence(scene.visual, index, findings));
  for (const e of shot?.elements ?? []) {
    const cited = e.kind === 'node' ? (e.evidence ?? []) : 'evidence' in e ? [e.evidence] : [];
    for (const id of cited) {
      const item = index.find(id);
      if (item) ids.push(item.id);
    }
  }
  return [...new Set(ids)].slice(0, EVIDENCE_LIMITS.cites);
}

/** What a visual shows from the run: its images, the hunks of its code, its request, command, or findings. */
function visualEvidence(
  v: Visual,
  index: EvidenceIndex,
  findings: ReadonlyArray<Pick<Finding, 'title' | 'evidenceIds'>>,
): string[] {
  const ids: string[] = [];
  const labelled = (kind: string, label: string) =>
    index.items
      .filter((i) => i.kind === kind && i.label === truncate(label, EVIDENCE_LIMITS.label))
      .map((i) => i.id);
  if (v.kind === 'code') {
    const lines = v.lines.flatMap((l) => (l.number === undefined ? [] : [l.number]));
    ids.push(
      ...hunksAt(index, {
        path: v.path,
        line: lines.length ? Math.min(...lines) : undefined,
        endLine: lines.length ? Math.max(...lines) : undefined,
      }),
    );
  } else if (v.kind === 'terminal') ids.push(...labelled('terminal', v.command));
  else if (v.kind === 'api') ids.push(...labelled('http', `${v.method} ${v.path}`));
  else if (v.kind === 'findings')
    // A finding may cite what the run no longer has; the scene cites only what it does.
    for (const card of v.findings)
      ids.push(
        ...(findings.find((f) => f.title === card.title)?.evidenceIds ?? []).filter((id) =>
          index.find(id),
        ),
      );
  const images = new Set(visualImages(v));
  ids.push(...index.items.filter((i) => images.has(i.path)).map((i) => i.id));
  return ids;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-resolve.test.ts packages/video/test/grounding.test.ts packages/video/test/timeline-grammar.test.ts packages/video/test/phrases.test.ts`
Expected: PASS (`phrases.test.ts` and `timeline-grammar.test.ts` pin `scenePhases`, which now uses `phraseMoment`).

Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it).

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/runtime/layout.ts packages/video/src/direction packages/video/src/timeline/build.ts packages/video/src/storyboard/draft.ts packages/video/src/grounding.ts packages/video/test/direction-resolve.test.ts packages/video/test/grounding.test.ts
git commit -m "$(cat <<'EOF'
Resolve a direction into stops, slots, evidence content, and timed beats

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 6: Wire direction into the product — `video.direction`, `--direction`, the pipeline, and `covi video --draft`

**Files:**
- Create: `packages/video/src/direction/plan.ts`
- Modify: `packages/video/src/pipeline.ts` (`ProduceVideoInput`; stage 1 storyboard; a new direction step before `video/storyboard.json` is written; the draft return; the image check; both `fitToDuration` calls; the evidence ids; `buildTimeline`)
- Modify: `packages/video/src/index.ts` (exports)
- Modify: `packages/core/src/config/schema.ts` (input schema `video`, `CoviConfig.video`, `DEFAULT_CONFIG.video`)
- Modify: `packages/core/src/config/resolve.ts:108-136` (`configFromEnv`: `COVI_VIDEO_DIRECTION`)
- Modify: `packages/cli/src/main.ts` (`addVideo` lines 317–364, `explicitConfig` lines 225–271)
- Modify: `packages/cli/src/workflows.ts` (`videoWorkflow` ~927, `renderWorkflow` ~1049, `applyVideoResult` ~963)
- Create: `packages/video/test/direction-plan.test.ts`
- Modify: `packages/core/test/config.test.ts`, `tests/cli.test.ts`, `tests/redaction.test.ts`
- Modify: `tests/render/render.test.ts:1312` (the timing-grammar render pins `--direction off`)

**Interfaces:**
- Consumes: `readDirectionFile`, `DIRECTION_PATH`, `DIRECTION_HINT`, `Direction` (Task 2); `directionSources`, `directionProblems` (Task 3); `defaultDirection`, `entrances`, `mergeDirection` (Task 4); `resolveDirection`, `directionImages` (Task 5); `sceneEvidence(…, shot)` (Task 5); `fitToDuration(…, entrances)`, `buildTimeline({ entrances, staging })` (Task 1).
- Produces:
  ```ts
  // packages/video/src/direction/plan.ts
  export type DirectionMode = 'auto' | 'off';
  export interface PlanInput {
    mode: DirectionMode; file?: Direction; authored: readonly Scene[]; scenes: readonly Scene[];
    evidence?: EvidenceIndex; sources: DirectionSources; seed: number;
  }
  export interface DirectionPlan { draft?: Direction; plan?: Direction; entrances: Map<string, TransitionKind> }
  export function planDirection(input: PlanInput): DirectionPlan;   // throws UsageError (exit 2)

  // packages/video/src/pipeline.ts — ProduceVideoInput gains
  direction?: 'auto' | 'off';   // default 'auto'

  // packages/core: CoviConfig['video'] gains `direction: 'auto' | 'off'` (default 'auto');
  // env COVI_VIDEO_DIRECTION; CLI flag --direction <auto|off> on every command addVideo builds
  // (covi video, covi render, covi ci); the result's artifacts gain `direction` when the run has the file.
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-plan.test.ts`:

```ts
import { indexEvidence, UsageError } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { planDirection } from '../src/direction/plan.ts';
import { DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const scene = (id: string, narration: string): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual: { kind: 'callout', title: 'C' } });
// The storyboard as the agent wrote it, and as redaction left it for drawing.
const authored = [
  scene('s1', 'It sent every document.'),
  scene('s2', 'Now it sends the ids of hunter2.'),
  scene('s3', 'Done.'),
];
const drawn = authored.map((s) => ({ ...s, narration: s.narration.replace('hunter2', '[REDACTED]') }));
const evidence = indexEvidence({ items: [] });
const base = { authored, scenes: drawn, evidence, sources: directionSources({ evidence }), seed: 2 };

describe('planning the direction', () => {
  it('renders as 0.2.0 did when direction is off: no shots, no entrances, nothing read', () => {
    const file = DirectionSchema.parse({
      shots: [{ scene: 'nope', elements: [{ id: 'v', kind: 'visual' }] }],
    });
    expect(planDirection({ ...base, mode: 'off', file })).toEqual({ entrances: new Map() });
  });

  it('directs every scene by default, and drafts that direction for the agent', () => {
    const planned = planDirection({ ...base, mode: 'auto' });
    expect(planned.draft).toMatchObject({ schemaVersion: 1, draft: true });
    expect(planned.plan).toBe(planned.draft);
    expect([...planned.entrances.keys()]).toEqual(['s2', 's3']);
  });

  it('puts the agent’s shots over Covi’s, checking phrases against the line as written', () => {
    const file = DirectionSchema.parse({
      shots: [
        {
          scene: 's2',
          enter: 'zoom',
          elements: [{ id: 'note', kind: 'label', text: 'Ids only' }],
          beats: [{ verb: 'reveal', element: 'note', at: 'the ids of hunter2' }],
        },
      ],
    });
    const planned = planDirection({ ...base, mode: 'auto', file });
    expect(planned.plan!.draft).toBe(false);
    expect(planned.plan!.shots).toHaveLength(3);
    expect(planned.plan!.shots.find((s) => s.scene === 's2')).toEqual(file.shots[0]);
    expect(planned.entrances.get('s2')).toBe('zoom');
  });

  it('refuses an agent’s direction that does not fit the run, listing every problem (exit 2)', () => {
    const file = DirectionSchema.parse({
      shots: [
        { scene: 's9', elements: [{ id: 'v', kind: 'visual' }] },
        { scene: 's2', elements: [{ id: 'c', kind: 'capture', evidence: 'screenshot:none' }] },
      ],
    });
    let error: unknown;
    try {
      planDirection({ ...base, mode: 'auto', file });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).exitCode).toBe(2);
    expect((error as Error).message).toMatch(
      /^video\/direction\.json does not fit this run:\n {2}shot 1 \(scene s9\)[^\n]*\n {2}shot 2 \(scene s2\), element c/,
    );
  });

  it('ignores a stale draft: a rewritten storyboard never fails on Covi’s own direction', () => {
    const stale = DirectionSchema.parse({
      draft: true,
      shots: [{ scene: 'gone', elements: [{ id: 'v', kind: 'visual' }] }],
    });
    const planned = planDirection({ ...base, mode: 'auto', file: stale });
    expect(planned.plan!.shots.map((s) => s.scene)).toEqual(['s1', 's2', 's3']);
    expect(planned.plan!.draft).toBe(true);
  });
});
```

In `packages/core/test/config.test.ts`, add:

```ts
describe('video direction', () => {
  it('directs on the canvas by default; the file, COVI_VIDEO_DIRECTION, and flags can turn it off', () => {
    const { config, provenance } = resolveConfig([]);
    expect(config.video.direction).toBe('auto');
    expect(provenance['video.direction']).toBe('global');
    // YAML 1.2: an unquoted `off` is the string, not false.
    const parsed = parseYamlConfig('video:\n  direction: off\n', '.covi/config.yml');
    const repo = resolveConfig([{ name: 'repository', source: '.covi/config.yml', values: parsed }]);
    expect(repo.config.video.direction).toBe('off');
    expect(repo.provenance['video.direction']).toBe('repository (.covi/config.yml)');
    expect(configFromEnv({ COVI_VIDEO_DIRECTION: 'off' })).toMatchObject({
      video: { direction: 'off' },
    });
    expect(() => configFromEnv({ COVI_VIDEO_DIRECTION: 'sometimes' })).toThrow(
      /video\.direction: expected one of "auto", "off"/,
    );
  });
});
```

In `tests/cli.test.ts`, add inside `describe('covi CLI', …)`:

```ts
  it('drafts the direction with the storyboard, and refuses one that does not fit the run', async () => {
    const dir = await example('bugfix-cli-slugify');
    const draft = covi(['video', '--repo', dir, '--draft', '--force', '--json']);
    expect(draft.code).toBe(0);
    const json = draft.json() as { runId: string; artifacts: Record<string, string> };
    const direction = JSON.parse(readFileSync(json.artifacts.direction!, 'utf8')) as {
      draft: boolean;
      shots: Array<{ scene: string }>;
    };
    const storyboard = JSON.parse(readFileSync(json.artifacts.storyboard!, 'utf8')) as {
      scenes: Array<{ id: string }>;
    };
    expect(direction.draft).toBe(true);
    expect(direction.shots.map((s) => s.scene)).toEqual(storyboard.scenes.map((s) => s.id));
    // An agent's direction naming a scene the storyboard does not have stops the render (exit 2)
    // before anything is narrated or drawn.
    writeFileSync(
      json.artifacts.direction!,
      JSON.stringify({ shots: [{ scene: 'nope', elements: [{ id: 'v', kind: 'visual' }] }] }),
    );
    const render = covi(['render', '--repo', dir, '--run', json.runId, '--json']);
    expect(render.code).toBe(2);
    expect((render.json() as { error: string }).error).toMatch(
      /video\/direction\.json does not fit this run:\n {2}shot 1 \(scene nope\)/,
    );
    // With direction off, nothing is drafted.
    const off = covi(['video', '--repo', dir, '--draft', '--force', '--direction', 'off', '--json']);
    expect((off.json() as { artifacts: Record<string, string> }).artifacts.direction).toBeUndefined();
  });
```

In `tests/redaction.test.ts`, after `expect(text).toMatch(/ghp_\S*(redacted|•|\*)/i);`:

```ts
    // The drafted direction is written beside the storyboard, redacted too.
    const direction = readFileSync(run.path('video/direction.json'), 'utf8');
    expect(JSON.parse(direction)).toMatchObject({ draft: true });
    expect(direction).not.toContain(TOKEN);
```

(add `readFileSync` to its `node:fs` import).

In `tests/render/render.test.ts`, in `it('renders a storyboard that uses every timing field', …)`, change the render call to pin 0.2.0's timing grammar (zoom-through into the hero), which `video.direction: off` keeps (R-016); `tests/render/canvas.test.ts` covers the canvas:

```ts
    // This test pins 0.2.0's timing grammar (zoom-through into the hero, its music lift 0.6 s
    // in), which `--direction off` keeps; tests/render/canvas.test.ts covers the canvas.
    const rendered = covi(['render', '--repo', repo, '--run', draft.runId, '--direction', 'off']);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-plan.test.ts packages/core/test/config.test.ts tests/redaction.test.ts && npx vitest run tests/cli.test.ts -t "drafts the direction"`
Expected: FAIL — `plan.ts` is missing, `config.video.direction` is undefined, no `video/direction.json` is drafted, and `--direction` is an unknown option.

- [ ] **Step 3: Implement**

Create `packages/video/src/direction/plan.ts`:

```ts
import { type EvidenceIndex, UsageError } from '@covi/core';
import type { Scene } from '../storyboard/schema.ts';
import type { TransitionKind } from '../timeline/types.ts';
import { defaultDirection, entrances, mergeDirection } from './director.ts';
import { directionProblems } from './refs.ts';
import { DIRECTION_HINT, type Direction } from './schema.ts';
import type { DirectionSources } from './sources.ts';

/** `video.direction`: direct on the canvas, or render as 0.2.0 did. */
export type DirectionMode = 'auto' | 'off';

export interface PlanInput {
  mode: DirectionMode;
  /** The run's `video/direction.json` as read; undefined when it has none. */
  file?: Direction;
  /** The storyboard's scenes as written (before redaction): `at` phrases are checked against them, as `sync` phrases are. */
  authored: readonly Scene[];
  /** The scenes as they will be drawn (redacted): the default director reads them. */
  scenes: readonly Scene[];
  evidence?: EvidenceIndex;
  sources: DirectionSources;
  seed: number;
}

export interface DirectionPlan {
  /** Covi's own direction (`"draft": true`), for `covi video --draft` to write; absent when off. */
  draft?: Direction;
  /** The shots to render: the agent's over Covi's; absent when off. */
  plan?: Direction;
  /** How each scene after the first enters; empty when off (each keeps its own transition). */
  entrances: Map<string, TransitionKind>;
}

/**
 * What directs this video. Off: nothing (0.2.0's rendering). Otherwise Covi's default director,
 * with the agent's shots over it when the run has a direction the agent rewrote (`"draft": false`);
 * that one must fit the run, and every problem is listed at once (exit 2). A direction still marked
 * as Covi's draft is derived again instead of checked, so a stale draft never blocks a render.
 */
export function planDirection(input: PlanInput): DirectionPlan {
  if (input.mode === 'off') return { entrances: new Map() };
  const draft = defaultDirection({
    scenes: input.scenes,
    evidence: input.evidence,
    seed: input.seed,
  });
  const own = input.file && !input.file.draft ? input.file : undefined;
  if (own) {
    const problems = directionProblems(own, input.authored, input.evidence, input.sources);
    if (problems.length)
      throw new UsageError(
        `video/direction.json does not fit this run:\n  ${problems.join('\n  ')}`,
        DIRECTION_HINT,
      );
  }
  const plan = mergeDirection(own, draft);
  return { draft, plan, entrances: entrances(plan, input.scenes, input.evidence, input.seed) };
}
```

`packages/video/src/pipeline.ts`:

1. Imports: add `demoPath` and `seedFrom` to the `@covi/core` import, and

```ts
import { planDirection } from './direction/plan.ts';
import { directionImages, resolveDirection } from './direction/resolve.ts';
import { DIRECTION_PATH, readDirectionFile } from './direction/schema.ts';
import { directionSources } from './direction/sources.ts';
```

2. `ProduceVideoInput` gains, after `subject`:

```ts
  /**
   * `video.direction`: direct the video on the canvas, from the run's `video/direction.json` and
   * Covi's default director (`auto`, the default), or render it as 0.2.0 did (`off`).
   */
  direction?: 'auto' | 'off';
```

3. Stage 1 keeps the scenes as written. Declare `let authored: Scene[];` next to `let drafted = false;`, and in the `if (input.storyboard)` branch replace the parse and the redaction with:

```ts
    const parsed = parseOrThrow(
      StoryboardSchema,
      input.storyboard,
      'storyboard.json',
      'Run `covi schema storyboard` for the format.',
    );
    // As written: direction phrases are checked against the line the agent quoted, like `sync`.
    authored = parsed.scenes.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` }));
    storyboard = redact({ ...parsed, scenes: authored });
```

and at the end of the `else` branch (after the refinement `try`/`catch`): `authored = storyboard.scenes;`.

4. After the `placed.problems` check and before `await run.writeJson('video/storyboard.json', storyboard, 'storyboard');`:

```ts
  // Direction: the agent's shots, checked against the storyboard and the evidence, over Covi's
  // default director's; none when video.direction is off. Entrances are decided before timing:
  // a shot's `enter` shapes the overlap like a storyboard transition (R-008).
  const directionMode = input.direction ?? 'auto';
  const sources = directionSources({
    files: input.change.files,
    demo: input.demo,
    evidence: input.evidence,
    appLogs: await appLogs(run),
    redact: (text) => run.redactor.redact(text),
  });
  const seed = seedFrom(storyboard.title);
  const directionFile =
    directionMode === 'auto' ? await readDirectionFile(run.path(DIRECTION_PATH)) : undefined;
  const directed = planDirection({
    mode: directionMode,
    file: directionFile,
    authored,
    scenes: storyboard.scenes,
    evidence: input.evidence,
    sources,
    seed,
  });
  // Labels and phrases are agent text: redacted like the storyboard they are matched against.
  const plan = directed.plan && redact(directed.plan);
```

5. In the `if (input.draftOnly)` block, before `return`:

```ts
    // Covi's direction, for the agent to rewrite (and mark "draft": false) before `covi render`;
    // a direction the agent already wrote stays as it is.
    if (directed.draft && !(directionFile && !directionFile.draft))
      await run.writeJson(DIRECTION_PATH, directed.draft, 'storyboard');
```

6. The image check loop iterates the direction's captures too: `for (const p of [...storyboardImages(storyboard), ...(plan ? directionImages(plan, sources) : [])]) {` (the body stays).
7. Both `fitToDuration(storyboard, speech(), spec, language, pacing())` calls gain `directed.entrances` as their last argument.
8. Scene evidence counts what each shot shows. Before `const timeline: Timeline = buildTimeline({`:

```ts
  const shots = new Map(plan?.shots.map((s) => [s.scene, s]));
  // Each story scene's stop and shot, resolved from the evidence and redacted.
  const staging = plan
    ? resolveDirection({
        plan,
        scenes: fit.scenes,
        layout: fit.layout,
        spec,
        language,
        sources,
        image: assets.image,
        seed,
        redact,
      })
    : undefined;
```

and in the `buildTimeline` input, the evidence mapping becomes `evidenceIds: redact(sceneEvidence(s, input.evidence!, input.review.findings, shots.get(s.id!)))`, and add `entrances: directed.entrances,` and `...(staging ? { staging } : {}),` to the input object.

9. At the bottom of the file:

```ts
/** The app's start-up logs, which `terminal:app-start-*` evidence shows. */
async function appLogs(run: Run): Promise<Partial<Record<'base' | 'head', string>>> {
  const logs: Partial<Record<'base' | 'head', string>> = {};
  for (const revision of ['base', 'head'] as const) {
    const rel = demoPath.appLog(revision);
    if (await run.has(rel)) logs[revision] = await run.readText(rel);
  }
  return logs;
}
```

`packages/video/src/index.ts` — add:

```ts
export { defaultDirection, entrances, mergeDirection } from './direction/director.ts';
export { type DirectionMode, type DirectionPlan, planDirection } from './direction/plan.ts';
export { directionProblems } from './direction/refs.ts';
export { directionImages, resolveDirection } from './direction/resolve.ts';
export { type DirectionSources, directionSources } from './direction/sources.ts';
```

`packages/core/src/config/schema.ts`:

- In the input schema's `video` object, after `outro`:

```ts
      direction: z
        .enum(['auto', 'off'])
        .optional()
        .describe(
          "auto (default): draw the video on Covi's canvas, directed by the run's video/direction.json and Covi's default director. off: render as Covi 0.2 did, with no canvas.",
        ),
```

- In `CoviConfig['video']`, after `outro: boolean;`:

```ts
    /** How the video is directed: on the canvas (auto), or as 0.2.0 rendered it (off). */
    direction: 'auto' | 'off';
```

- In `DEFAULT_CONFIG.video`, after `outro: true,`: `direction: 'auto',`.

`packages/core/src/config/resolve.ts` — in `configFromEnv`, after the `COVI_OUTRO` line:

```ts
  if (env.COVI_VIDEO_DIRECTION) set('video', 'direction', env.COVI_VIDEO_DIRECTION);
```

`packages/cli/src/main.ts`:

- `addVideo`, after the `--no-outro` option:

```ts
    .addOption(
      new Option(
        '--direction <mode>',
        "direct the video on the canvas: auto (the run's video/direction.json, else Covi's default director; the default) or off (no canvas, as Covi 0.2 rendered)",
      ).choices(['auto', 'off']),
    )
```

- `explicitConfig`, after the `outro` line: `set('video', 'direction', o.direction);`

`packages/cli/src/workflows.ts`:

- In both `produceVideo({ … })` calls (`videoWorkflow` and `renderWorkflow`), add `direction: session.config.video.direction,` (in `renderWorkflow` the session is `session` too).
- In `applyVideoResult`, after `artifact(session, result, 'storyboard', 'video/storyboard.json');`:

```ts
  if (await session.run.has('video/direction.json'))
    artifact(session, result, 'direction', 'video/direction.json');
```

The configuration docs and the run-output docs are updated in Task 11.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-plan.test.ts packages/core/test/config.test.ts tests/redaction.test.ts tests/cli.test.ts`
Expected: PASS.

Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS. From here on a full render (`COVI_TEST_RENDER=1`) draws every story scene with a stop and the rotation's entrances; until Task 8 the runtime draws `pan` and `zoom` with their no-canvas fallbacks, so nothing breaks in between.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/direction/plan.ts packages/video/src/pipeline.ts packages/video/src/index.ts packages/core/src/config packages/cli/src/main.ts packages/cli/src/workflows.ts packages/video/test/direction-plan.test.ts packages/core/test/config.test.ts tests/cli.test.ts tests/redaction.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Direct every video: video.direction, --direction, and the drafted direction.json

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 7: Canvas camera math (pure, DOM-free)

**Files:**
- Create: `packages/video/src/runtime/canvas.ts`
- Create: `packages/video/test/canvas.test.ts`

**Interfaces:**
- Consumes: `Point`, `Rect`, `Stop`, `TransitionKind`, `CameraMove`, `CAMERA_TRANSITIONS` (Task 1); `clamp`, `easeInOutCubic`, `lerp` (`runtime/anim.ts`).
- Produces (all exported from `packages/video/src/runtime/canvas.ts`; the stage uses them in Tasks 8–9):
  ```ts
  /** What the camera looks at: the point drawn at the pivot (the media region's center), and its magnification. */
  export interface View { x: number; y: number; scale: number }
  export type CameraKind = (typeof CAMERA_TRANSITIONS)[number];          // 'pan' | 'zoom'
  /** A camera beat inside a stop: from `t` (seconds since the scene started) for `seconds`, toward `to`. */
  export interface CameraStep { t: number; seconds: number; to: View }
  export const MAX_ZOOM = 2.5;
  export const PULL_MARGIN = 0.92;
  export function isCameraMove(kind: TransitionKind): kind is CameraKind;
  export function restView(pivot: Point): View;
  export function toWorld(view: View, stop: Stop): View;
  export function withPush(view: View, push: number): View;
  export function clampView(view: View, region: Rect, pivot: Point): View;
  export function beatView(move: CameraMove, target: Rect, zoom: number | undefined, from: View, region: Rect, pivot: Point): View;
  export function viewAt(steps: readonly CameraStep[], t: number, rest: View): View;
  export function pullBack(a: Stop, b: Stop, region: Rect): number;
  export function between(kind: CameraKind, from: View, to: View, k: number, back: number): View;
  export function layerTransform(view: View, stop: Stop, pivot: Point): string;
  export function lerpRect(a: Rect, b: Rect, k: number): Rect;
  export function insetOf(clip: Rect, width: number, height: number): string;
  export function clipRect(rect: Rect, clip: Rect): Rect | undefined;
  export function gridStyle(view: View, pivot: Point, spacing: number): { position: string; size: string };
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/canvas.test.ts` (package tests are not part of `tsc -p tsconfig.json`, so importing a runtime file is fine here; files under `tests/` must not import runtime files that use DOM types):

```ts
import { describe, expect, it } from 'vitest';
import { easeInOutCubic } from '../src/runtime/anim.ts';
import {
  beatView,
  between,
  type CameraStep,
  clampView,
  clipRect,
  gridStyle,
  insetOf,
  isCameraMove,
  layerTransform,
  lerpRect,
  pullBack,
  restView,
  toWorld,
  viewAt,
  withPush,
} from '../src/runtime/canvas.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import type { Point } from '../src/timeline/types.ts';

const { media } = computeRegions({ width: 1920, height: 1080, orientation: 'landscape' });
const pivot = { x: media.x + media.width / 2, y: media.y + media.height / 2 };
const stop = { x: 2400, y: 1560 };
const TRANSFORM = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/;
/** Where a stop-local point lands on screen under a layer transform (origin 0 0). */
const screen = (transform: string, p: Point): Point => {
  const m = TRANSFORM.exec(transform)!;
  const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { x: tx + s * p.x, y: ty + s * p.y };
};

describe('the canvas camera', () => {
  it('draws a stop at rest as it is, wherever the stop sits', () => {
    expect(layerTransform(toWorld(restView(pivot), stop), stop, pivot)).toBe(
      'translate(0.00px, 0.00px) scale(1.00000)',
    );
  });

  it('pushes in about the media region’s center, as the camera did without a canvas', () => {
    const view = clampView(withPush(restView(pivot), 0.02), media, pivot);
    const t = layerTransform(toWorld(view, stop), stop, pivot);
    const corner = { x: media.x, y: media.y };
    expect(screen(t, pivot).x).toBeCloseTo(pivot.x, 1);
    expect(screen(t, corner).x).toBeCloseTo(pivot.x + 1.02 * (corner.x - pivot.x), 1);
    expect(screen(t, corner).y).toBeCloseTo(pivot.y + 1.02 * (corner.y - pivot.y), 1);
  });

  it('zooms a beat onto its target, fits it when no zoom is given, and never shows past the region', () => {
    const target = { x: 800, y: 450, width: 200, height: 100 };
    const from = restView(pivot);
    expect(beatView('zoom', target, 2, from, media, pivot)).toEqual({ x: 900, y: 500, scale: 2 });
    expect(beatView('zoom', target, undefined, from, media, pivot).scale).toBe(2.5);
    // A target at the region's corner: the view stops where the region's edge meets the frame's.
    const corner = beatView('zoom', { x: media.x, y: media.y, width: 100, height: 50 }, 2, from, media, pivot);
    const t = layerTransform(toWorld(corner, stop), stop, pivot);
    expect(screen(t, { x: media.x, y: media.y }).x).toBeCloseTo(media.x, 6);
    expect(screen(t, { x: media.x, y: media.y }).y).toBeCloseTo(media.y, 6);
    // A target wider than the view shows its start: code reads from the left.
    const rows = { x: media.x, y: 400, width: media.width, height: 60 };
    const wide = beatView('zoom', rows, 1.25, from, media, pivot);
    const w = layerTransform(toWorld(wide, stop), stop, pivot);
    expect(screen(w, { x: rows.x, y: rows.y }).x).toBeCloseTo(media.x, 6);
    // Pan keeps the scale the camera has.
    expect(beatView('pan', target, undefined, { x: 900, y: 500, scale: 2 }, media, pivot)).toEqual({
      x: 900,
      y: 500,
      scale: 2,
    });
  });

  it('chains beats: each eases from where the one before left the camera', () => {
    const rest = restView(pivot);
    const a = { x: 900, y: 500, scale: 2 };
    const b = { x: 700, y: 520, scale: 1.25 };
    const steps: CameraStep[] = [
      { t: 1, seconds: 1, to: a },
      { t: 1.5, seconds: 1, to: b },
    ];
    expect(viewAt(steps, 0.5, rest)).toEqual(rest);
    const halfway = viewAt(steps, 1.5, rest);
    expect(halfway.scale).toBeCloseTo(1 + easeInOutCubic(0.5) * 1, 9);
    // The second beat starts from the first one's view at 1.5 s, not from its target.
    const later = viewAt(steps, 2, rest);
    expect(later.scale).toBeCloseTo(halfway.scale + (b.scale - halfway.scale) * 0.5, 9);
    expect(viewAt(steps, 2.6, rest)).toEqual(b);
  });

  it('pans and zooms between stops, continuous at both ends', () => {
    const a = toWorld(restView(pivot), { x: 0, y: 0 });
    const b = toWorld(restView(pivot), { x: 2400, y: 0 });
    for (const kind of ['pan', 'zoom'] as const) {
      expect(between(kind, a, b, 0, 0.4)).toEqual(a);
      expect(between(kind, a, b, 1, 0.4)).toEqual(b);
      expect(between(kind, a, b, 0.5, 0.4).x).toBeCloseTo((a.x + b.x) / 2, 9);
    }
    expect(between('pan', a, b, 0.5, 0.4).scale).toBe(1);
    expect(between('zoom', a, b, 0.5, 0.4).scale).toBeCloseTo(0.4, 9);
    // Pulled back far enough for both stops' regions to fit at once.
    const back = pullBack({ x: 0, y: 0 }, { x: 2400, y: 0 }, media);
    expect(back).toBeCloseTo(media.width / (2400 + media.width), 9);
    expect(pullBack({ x: 0, y: 0 }, { x: 0, y: 0 }, media)).toBe(1);
  });

  it('knows which entrances move the camera', () => {
    expect(isCameraMove('pan')).toBe(true);
    expect(isCameraMove('zoom')).toBe(true);
    for (const kind of ['fade', 'cut', 'push', 'wipe', 'zoom-through'] as const)
      expect(isCameraMove(kind)).toBe(false);
  });
});

describe('the canvas viewport', () => {
  it('clips to a region, and keeps only the part of a box inside it', () => {
    expect(insetOf({ x: 10, y: 20, width: 100, height: 50 }, 200, 100)).toBe(
      'inset(20.00px 90.00px 30.00px 10.00px)',
    );
    const clip = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipRect({ x: 50, y: 80, width: 100, height: 40 }, clip)).toEqual({
      x: 50,
      y: 80,
      width: 50,
      height: 20,
    });
    expect(clipRect({ x: 150, y: 0, width: 10, height: 10 }, clip)).toBeUndefined();
    expect(lerpRect(clip, { x: 100, y: 0, width: 300, height: 100 }, 0.5)).toEqual({
      x: 50,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('moves the dots with the camera, and lines them up with the stage’s at a stop', () => {
    const at = toWorld(restView(pivot), { x: 2400, y: 1560 });
    expect(gridStyle(at, pivot, 30)).toEqual({ position: '0.00px 0.00px', size: '30.000px 30.000px' });
    expect(gridStyle({ ...at, x: at.x + 10 }, pivot, 30).position).toBe('20.00px 0.00px');
    expect(gridStyle({ ...at, scale: 2 }, pivot, 30).size).toBe('60.000px 60.000px');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/canvas.test.ts`
Expected: FAIL — `Cannot find module '../src/runtime/canvas.ts'`.

- [ ] **Step 3: Implement**

Create `packages/video/src/runtime/canvas.ts`:

```ts
import type {
  CAMERA_TRANSITIONS,
  CameraMove,
  Point,
  Rect,
  Stop,
  TransitionKind,
} from '../timeline/types.ts';
import { clamp, easeInOutCubic, lerp } from './anim.ts';

/*
 * The canvas: every story scene sits at its stop, a frame-sized region of one large world, and
 * the camera travels between them. A view is what the camera looks at: the world point drawn at
 * the pivot (the media region's center, where the push-in always scaled from) and how much it
 * magnifies. Pure functions of their inputs, so any frame draws on its own.
 */

export interface View {
  x: number;
  y: number;
  scale: number;
}

export type CameraKind = (typeof CAMERA_TRANSITIONS)[number];

/** A camera beat inside a stop: from `t` (seconds since the scene started) for `seconds`, toward `to`. */
export interface CameraStep {
  t: number;
  seconds: number;
  to: View;
}

/** The most a camera beat magnifies. */
export const MAX_ZOOM = 2.5;
/** A fitted target fills this share of the region. */
const FIT = 0.9;
/** A zoom between stops pulls back a little further than both regions need, so they breathe. */
export const PULL_MARGIN = 0.92;

export function isCameraMove(kind: TransitionKind): kind is CameraKind {
  return kind === 'pan' || kind === 'zoom';
}

/** The view at rest in a stop, in stop-local coordinates: its own region, unmagnified. */
export function restView(pivot: Point): View {
  return { x: pivot.x, y: pivot.y, scale: 1 };
}

/** A stop-local view placed on the canvas. */
export function toWorld(view: View, stop: Stop): View {
  return { x: view.x + stop.x, y: view.y + stop.y, scale: view.scale };
}

/** The scene camera's push-in (drift, linger, the hero's punch) on top of a view. */
export function withPush(view: View, push: number): View {
  return { ...view, scale: view.scale * (1 + push) };
}

function lerpView(a: View, b: View, k: number): View {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), scale: lerp(a.scale, b.scale, k) };
}

/**
 * A magnified view moved just enough that what it shows stays inside `region`: a stop never shows
 * the empty canvas beside it. Views that pull back (between stops) are left alone.
 */
export function clampView(view: View, region: Rect, pivot: Point): View {
  if (view.scale < 1) return view;
  const axis = (f: number, start: number, size: number, p: number) =>
    clamp(f, start + (p - start) / view.scale, start + size - (start + size - p) / view.scale);
  return {
    x: axis(view.x, region.x, region.width, pivot.x),
    y: axis(view.y, region.y, region.height, pivot.y),
    scale: view.scale,
  };
}

/**
 * Where a camera beat takes the camera (stop-local): `zoom` and `follow` frame the target at the
 * beat's zoom, else fitted to the region (at most 2.5×); `pan` centers it at the scale the camera
 * already has. A target wider or taller than the view shows its start (code reads from the left).
 */
export function beatView(
  move: CameraMove,
  target: Rect,
  zoom: number | undefined,
  from: View,
  region: Rect,
  pivot: Point,
): View {
  const fitted = Math.min(region.width / target.width, region.height / target.height) * FIT;
  const scale = move === 'pan' ? from.scale : clamp(zoom ?? fitted, 1, MAX_ZOOM);
  const focus = (start: number, size: number, regionStart: number, regionSize: number, p: number) =>
    size * scale > regionSize ? start + (p - regionStart) / scale : start + size / 2;
  return clampView(
    {
      x: focus(target.x, target.width, region.x, region.width, pivot.x),
      y: focus(target.y, target.height, region.y, region.height, pivot.y),
      scale,
    },
    region,
    pivot,
  );
}

/**
 * The view at `t` (seconds since the scene started): each beat eases from where the camera was
 * when it started, which is where the beat before it had got to by then.
 */
export function viewAt(steps: readonly CameraStep[], t: number, rest: View): View {
  let view = rest;
  for (const [i, step] of steps.entries()) {
    if (t < step.t) break;
    const next = steps[i + 1];
    const until = next && next.t < t ? next.t : t;
    view = lerpView(view, step.to, easeInOutCubic(clamp((until - step.t) / Math.max(step.seconds, 1e-6))));
  }
  return view;
}

/** How far a zoom between two stops pulls back: both stops' regions fit in the region at once. */
export function pullBack(a: Stop, b: Stop, region: Rect): number {
  return Math.min(
    1,
    region.width / (Math.abs(b.x - a.x) + region.width),
    region.height / (Math.abs(b.y - a.y) + region.height),
  );
}

/**
 * The camera `k` (0–1) of the way from one stop's view to the next's (world coordinates). A pan
 * glides; a zoom glides too while it pulls back to `back` at the middle and pushes in again.
 */
export function between(kind: CameraKind, from: View, to: View, k: number, back: number): View {
  const view = lerpView(from, to, easeInOutCubic(clamp(k)));
  if (kind === 'pan') return view;
  const dip = Math.sin(Math.PI * clamp(k)) ** 2;
  return { ...view, scale: lerp(view.scale, back, dip) };
}

/** The CSS transform (origin 0 0) that draws a stop's layer as the camera sees it. */
export function layerTransform(view: View, stop: Stop, pivot: Point): string {
  const tx = pivot.x + view.scale * (stop.x - view.x);
  const ty = pivot.y + view.scale * (stop.y - view.y);
  return `translate(${(tx + 0).toFixed(2)}px, ${(ty + 0).toFixed(2)}px) scale(${view.scale.toFixed(5)})`;
}

export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    width: lerp(a.width, b.width, k),
    height: lerp(a.height, b.height, k),
  };
}

/** `clip-path` for a region of the frame. */
export function insetOf(clip: Rect, width: number, height: number): string {
  const px = (n: number) => `${Math.max(0, n).toFixed(2)}px`;
  return `inset(${px(clip.y)} ${px(width - clip.x - clip.width)} ${px(height - clip.y - clip.height)} ${px(clip.x)})`;
}

/** The part of a box inside the clip, or nothing when none of it is. */
export function clipRect(rect: Rect, clip: Rect): Rect | undefined {
  const x = Math.max(rect.x, clip.x);
  const y = Math.max(rect.y, clip.y);
  const right = Math.min(rect.x + rect.width, clip.x + clip.width);
  const bottom = Math.min(rect.y + rect.height, clip.y + clip.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/**
 * Where the canvas's dots sit for a view: they move and scale with the camera. Stops sit on the
 * grid, so at rest at any stop the dots line up with the stage's own.
 */
export function gridStyle(view: View, pivot: Point, spacing: number): { position: string; size: string } {
  const size = spacing * view.scale;
  const x = mod(pivot.x - view.scale * view.x, size);
  const y = mod(pivot.y - view.scale * view.y, size);
  // A remainder within rounding of the size is a whole tile: 0, not 29.999.
  const near = (v: number) => (size - v < 1e-6 ? 0 : v);
  return {
    position: `${near(x).toFixed(2)}px ${near(y).toFixed(2)}px`,
    size: `${size.toFixed(3)}px ${size.toFixed(3)}px`,
  };
}
```

(`(tx + 0).toFixed(2)` turns `-0` into `0`, so a rest transform reads `translate(0.00px, 0.00px)`.) `CAMERA_TRANSITIONS` is imported as a type only, for `typeof` in `CameraKind`; TypeScript allows that, and nothing extra is bundled.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/canvas.test.ts`
Expected: PASS. Then `npm run typecheck` (the runtime project typechecks `canvas.ts`) and `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/runtime/canvas.ts packages/video/test/canvas.test.ts
git commit -m "$(cat <<'EOF'
Add the canvas camera: views, beats, moves between stops, clip, and grid

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 8: The canvas stage — stops, camera moves between them, beats inside them, the clip, and the grid

**Files:**
- Modify: `packages/video/src/timeline/cues.ts` (add `shotSettledAt` before `verdictEntrance`)
- Modify: `packages/video/src/runtime/camera.ts:40-56` (`cameraPlan`)
- Modify: `packages/video/src/runtime/styles.ts:47` (`.canvas-grid`)
- Modify: `packages/video/src/runtime/stage.ts` (imports; `MountedScene`; fields and constructor; `mount`; `seek`; `report`; six new private methods)
- Modify: `packages/video/test/motion.test.ts`
- Create: `tests/render/canvas.test.ts`

**Interfaces:**
- Consumes: everything in `runtime/canvas.ts` (Task 7); `gridSpacing` (Task 5); `TimelineScene.stop`/`.direction`, `SceneDirection`, `DirectionElement` (Task 1); `defaultDirection`, `entrances`, `mergeDirection` (Task 4), `resolveDirection` (Task 5), `directionSources` (Task 3) — in the render test, to build directed timelines the way the pipeline does.
- Produces:
  ```ts
  // packages/video/src/timeline/cues.ts
  export function shotSettledAt(scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>): number;
  // packages/video/src/runtime/stage.ts — MountedScene gains (Task 9 adds `shot`)
  viewport?: HTMLDivElement; region: Rect; visual?: Component; steps: CameraStep[];
  // Stage private methods Task 9 relies on: travels(a, b), moveAt(i, time), stopView(m, time),
  // cameraAt(i, time), clipAt(i, time), cameraSteps(m), targetAt(m, element, t)
  // DOM: a scene with a stop is `.scene[data-scene] > .layer.stop-view > .layer` (the media layer,
  // transform-origin 0 0); the stage has one `.layer.canvas-grid` under the scenes.
  ```

A scene without a `stop` (every scene when `video.direction` is off, and the outro always) takes exactly the 0.2.0 path: no viewport, no grid, the push-in as `scale()` about the media region's center, and the old transition looks. The existing render tests are the guard for that (R-016); they must pass unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/motion.test.ts`, add `import { settledAt, shotSettledAt } from '../src/timeline/cues.ts';` and append:

```ts
describe('the camera in a directed scene', () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const base = {
    id: 's',
    beat: 's',
    eyebrow: 's',
    start: 0,
    end: 6,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    speech: { start: 0.3, end: 5, text: 'x' },
  } as TimelineScene;

  it('pushes in once the shot’s beats are done, not before', () => {
    expect(cameraPlan(base)!.settled).toBe(0.6);
    const directed: TimelineScene = {
      ...base,
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect }],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', t: 2, seconds: 0.8 }],
      },
    };
    expect(cameraPlan(directed)!.settled).toBeCloseTo(2.8, 9);
  });

  it('waits for every element’s own choreography from its reveal', () => {
    const code = {
      kind: 'code' as const,
      path: 'a.js',
      lines: [
        { type: 'del' as const, text: 'a' },
        { type: 'add' as const, text: 'b' },
      ],
      highlight: [],
    };
    const scene: TimelineScene = {
      ...base,
      direction: {
        whole: false,
        elements: [
          { id: 'c', kind: 'code', rect, visual: code },
          { id: 'l', kind: 'label', rect, text: 'Hi', tone: 'neutral' },
        ],
        beats: [
          { verb: 'reveal', element: 'l', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'reveal', element: 'c', style: 'rise', t: 2, seconds: 0.5 },
        ],
      },
    };
    // The code's lines have entered 0.57 s after its reveal; the label 0.5 s after its own.
    expect(shotSettledAt(scene)).toBeCloseTo(2 + settledAt(code, 4), 9);
    expect(shotSettledAt(base)).toBe(settledAt(base.visual, 6, undefined));
  });

  it('drifts across a capture shown alone, and holds it still beside other elements', () => {
    const capture = {
      ...base,
      visual: {
        kind: 'screenshot',
        image: { src: 'a.png', width: 10, height: 10 },
        device: 'desktop',
      },
    } as TimelineScene;
    const whole = { whole: true, elements: [{ id: 'visual', kind: 'visual' as const, rect }], beats: [] };
    expect(cameraPlan({ ...capture, direction: whole })!.drift).toBe(true);
    expect(cameraPlan({ ...capture, direction: { ...whole, whole: false } })!.drift).toBe(false);
  });
});
```

Create `tests/render/canvas.test.ts` (Task 9 adds a second `describe`):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig, seedFrom } from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  type LayoutReport,
  layoutChecks,
  layoutScenes,
  pacingFor,
  resolveVideoSpec,
  type StoryboardInput,
  StoryboardSchema,
  type TransitionKind,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultDirection,
  entrances,
  mergeDirection,
} from '../../packages/video/src/direction/director.ts';
import { resolveDirection } from '../../packages/video/src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../../packages/video/src/direction/schema.ts';
import { directionSources, type SourcesInput } from '../../packages/video/src/direction/sources.ts';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * The canvas, drawn in Chromium: scenes sit at stops, the camera pans and zooms between them and
 * moves inside a stop on its beats, and the viewport keeps what it magnifies inside the scene's
 * region. Files under tests/ are typechecked without DOM types, so the page reads its own
 * elements from scripts, and nothing here imports a runtime file.
 */

const available = await canUseBrowser();
const dirs: string[] = [];
let browser: Browser | undefined;
beforeAll(async () => {
  if (available) browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const W = 640;
const H = 360;
const regions = computeRegions({ width: W, height: H, orientation: 'landscape' });
const pivot = {
  x: regions.media.x + regions.media.width / 2,
  y: regions.media.y + regions.media.height / 2,
};

interface Drawn {
  id: string;
  display: string;
  opacity: string;
  transform: string | null;
  clip: string | null;
  header: string | null;
}

const TRANSFORM = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/;
/** A canvas layer's transform: its offset and scale. */
function camera(transform: string | null) {
  const m = TRANSFORM.exec(transform ?? '');
  if (!m) throw new Error(`not a canvas transform: ${transform}`);
  return { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) };
}
const insetTop = (clip: string | null) => Number(/inset\(([\d.]+)px/.exec(clip ?? '')![1]);

/**
 * Builds a directed 640×360 composition the way the pipeline does (default director, the given
 * shots over it, entrances, timing, resolution) and opens it. `off` builds it as 0.2.0 did.
 */
async function directed(
  scenes: StoryboardInput['scenes'],
  shots: DirectionInput['shots'] = [],
  options: { off?: boolean; sources?: SourcesInput } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-canvas-'));
  dirs.push(dir);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width: W, height: H });
  const title = 'Send only the ids';
  const parsed = StoryboardSchema.parse({ title, template: 'bug-fix', scenes }).scenes;
  const seed = seedFrom(title);
  const evidence = options.sources?.evidence;
  const sources = directionSources(options.sources ?? {});
  const plan = options.off
    ? undefined
    : mergeDirection(
        shots.length ? DirectionSchema.parse({ shots }) : undefined,
        defaultDirection({ scenes: parsed, evidence, seed }),
      );
  const enter = plan ? entrances(plan, parsed, evidence, seed) : new Map<string, TransitionKind>();
  const layout = layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(spec), enter);
  const assets = new AssetCollector(dir);
  const staging = plan
    ? resolveDirection({
        plan,
        scenes: parsed,
        layout,
        spec,
        language: 'en',
        sources,
        image: assets.image,
        seed,
        redact: (value) => value,
      })
    : undefined;
  const timeline = buildTimeline({
    title,
    scenes: parsed,
    layout,
    spec,
    image: assets.image,
    entrances: enter,
    ...(staging ? { staging } : {}),
  });
  const composition = join(dir, 'composition');
  await writeComposition(composition, timeline, assets.files);
  const page = await browser!.newPage({ viewport: { width: W, height: H } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(composition, 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const scene = (id: string) => timeline.scenes.find((s) => s.id === id)!;
  const frameAt = (id: string, seconds: number) =>
    Math.round((scene(id).start + seconds) * timeline.fps);
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const state = (frame: number) =>
    seek(
      frame,
      `return [...document.querySelectorAll('[data-scene]')].map((s) => ({
         id: s.dataset.scene,
         display: s.style.display,
         opacity: s.style.opacity,
         transform: s.querySelector(':scope > .stop-view > .layer')?.style.transform ?? null,
         clip: s.querySelector(':scope > .stop-view')?.style.clipPath ?? null,
         header: s.querySelector(':scope > .scene-header')?.style.opacity ?? null,
       }));`,
    ) as Promise<Drawn[]>;
  const of = (drawn: Drawn[], id: string) => drawn.find((d) => d.id === id)!;
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const grid = (frame: number) =>
    seek(
      frame,
      `const g = document.querySelector('.canvas-grid');
       return g ? { display: g.style.display, position: g.style.backgroundPosition, size: g.style.backgroundSize } : null;`,
    ) as Promise<{ display: string; position: string; size: string } | null>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, page, scene, frameAt, seek, state, of, report, grid, shot, errors };
}

const code = {
  kind: 'code',
  path: 'src/request.js',
  language: 'javascript',
  lines: [
    { type: 'context', text: 'function build(docs) {' },
    { type: 'del', text: '  return send(docs);' },
    { type: 'add', text: '  return send(docs.map((d) => d.id));' },
    { type: 'context', text: '}' },
  ],
  highlight: [2],
} satisfies StoryboardInput['scenes'][number]['visual'];
const story: StoryboardInput['scenes'] = [
  {
    id: 's1',
    beat: 'context',
    narration: 'The request carried every document.',
    visual: { kind: 'title', title: 'Send only the ids', meta: [] },
  },
  {
    id: 's2',
    beat: 'problem',
    eyebrow: 'Before',
    narration: 'So the reader timed out.',
    visual: { kind: 'callout', tone: 'warning', title: 'Timed out' },
  },
  {
    id: 's3',
    beat: 'fix',
    eyebrow: 'The fix',
    narration: 'Now it sends only the ids, and nothing else.',
    minSeconds: 6,
    visual: code,
  },
  {
    id: 's4',
    beat: 'summary',
    narration: 'Ready.',
    visual: { kind: 'summary', verdict: 'looks-good', headline: 'Ids only', points: [] },
  },
];
const moves: DirectionInput['shots'] = [
  { scene: 's2', enter: 'pan', elements: [{ id: 'visual', kind: 'visual' }] },
  {
    scene: 's3',
    enter: 'zoom',
    elements: [{ id: 'visual', kind: 'visual' }],
    beats: [{ verb: 'camera', move: 'zoom', to: 'visual', zoom: 1.5, at: 'and nothing else' }],
  },
];

describe.skipIf(!available)('the canvas', () => {
  it('pans from stop to stop: both pictures travel under one camera, the region passing between', async () => {
    const v = await directed(story, moves);
    const s1 = v.scene('s1');
    const s2 = v.scene('s2');
    expect(s2.transition).toEqual({ kind: 'pan', seconds: 0.7 });
    expect(s2.stop!.x).toBeGreaterThan(s1.stop!.x);
    const mid = await v.state(v.frameAt('s2', 0.35));
    const [a, b] = [v.of(mid, 's1'), v.of(mid, 's2')];
    expect([a.display, b.display]).toEqual(['block', 'block']);
    expect([Number(a.opacity), Number(b.opacity)]).toEqual([1, 1]);
    const [ca, cb] = [camera(a.transform), camera(b.transform)];
    expect(ca.tx).toBeLessThan(0);
    expect(cb.tx).toBeGreaterThan(0);
    // One camera: the stops keep their distance on screen, at the camera's scale.
    expect(cb.tx - ca.tx).toBeCloseTo((s2.stop!.x - s1.stop!.x) * cb.scale, 0);
    expect(ca.scale).toBeCloseTo(cb.scale, 4);
    // The title owns the full frame, the callout only the media region: the clip passes between.
    expect(insetTop(b.clip)).toBeGreaterThan(regions.full.y + 2);
    expect(insetTop(b.clip)).toBeLessThan(regions.media.y - 2);
    const rest = await v.state(v.frameAt('s2', 0.75));
    expect(v.of(rest, 's1').display).toBe('none');
    const settled = camera(v.of(rest, 's2').transform);
    expect(Math.abs(settled.tx)).toBeLessThan(1);
    expect(settled.scale).toBeCloseTo(1, 2);
    expect(insetTop(v.of(rest, 's2').clip)).toBeCloseTo(regions.media.y, 1);
    expect(v.errors).toEqual([]);
  });

  it('zooms out to show both stops, then into the next; only the old header fades', async () => {
    const v = await directed(story, moves);
    expect(v.scene('s3').transition).toEqual({ kind: 'zoom', seconds: 0.9 });
    const mid = await v.state(v.frameAt('s3', 0.45));
    const [a, b] = [camera(v.of(mid, 's2').transform), camera(v.of(mid, 's3').transform)];
    expect(a.scale).toBeCloseTo(b.scale, 4);
    expect(b.scale).toBeLessThan(0.75);
    expect(Number(v.of(mid, 's2').header)).toBeLessThan(1);
    expect(Number(v.of(mid, 's2').opacity)).toBe(1);
    const after = await v.state(v.frameAt('s3', 0.95));
    expect(camera(v.of(after, 's3').transform).scale).toBeCloseTo(1, 1);
    expect(v.of(after, 's3').header).toBe('');
  });

  it('zooms toward the highlighted line on its phrase', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    expect(beat).toMatchObject({ verb: 'camera', to: 'visual', zoom: 1.5 });
    const before = await v.state(v.frameAt('s3', beat.t - 0.05));
    expect(camera(v.of(before, 's3').transform).scale).toBeLessThan(1.1);
    const frame = v.frameAt('s3', beat.t + beat.seconds + 0.1);
    const zoomed = camera(v.of(await v.state(frame), 's3').transform);
    expect(zoomed.scale).toBeGreaterThan(1.45);
    expect(zoomed.scale).toBeLessThan(1.6);
    const row = (await v.seek(
      frame,
      `const r = document.querySelector('[data-scene="s3"] .ln.add').getBoundingClientRect();
       return { x: r.x, y: r.y, width: r.width, height: r.height };`,
    )) as { x: number; y: number; width: number; height: number };
    const m = regions.media;
    expect(row.y).toBeGreaterThanOrEqual(m.y - 1);
    expect(row.y + row.height).toBeLessThanOrEqual(m.y + m.height + 1);
    // Closer to the middle of the frame than it sits at rest.
    expect(Math.abs(row.y + row.height / 2 - pivot.y)).toBeLessThan(m.height / 4);
  });

  it('clips what the camera magnifies to the scene’s region, and reports it clipped', async () => {
    const v = await directed(story, moves);
    const s3 = v.scene('s3');
    const beat = s3.direction!.beats[0]!;
    const zoomed = await v.report(v.frameAt('s3', beat.t + beat.seconds + 0.1));
    const m = regions.media;
    expect(zoomed.items.length).toBeGreaterThan(0);
    for (const item of zoomed.items.filter((i) => i.role !== 'text')) {
      expect(item.rect.x).toBeGreaterThanOrEqual(m.x - 1);
      expect(item.rect.y).toBeGreaterThanOrEqual(m.y - 1);
      expect(item.rect.x + item.rect.width).toBeLessThanOrEqual(m.x + m.width + 1);
      expect(item.rect.y + item.rect.height).toBeLessThanOrEqual(m.y + m.height + 1);
    }
    const checks = layoutChecks(v.timeline, [zoomed]);
    expect(checks.find((c) => c.id === 'captions-clear-of-content')!.status).toBe('pass');
  });

  it('moves the canvas’s dots with the camera, lined up with the stage’s at rest', async () => {
    const v = await directed(story, moves);
    const at = (position: string) => Number(position.split('px')[0]);
    const rest = (await v.grid(v.frameAt('s2', 0.75)))!;
    const size = Number(rest.size.split('px')[0]);
    expect(rest.display).toBe('block');
    expect(Math.min(at(rest.position), size - at(rest.position))).toBeLessThan(0.5);
    const travelling = new Set<string>();
    for (const k of [0.2, 0.3, 0.4])
      travelling.add((await v.grid(v.frameAt('s2', 0.7 * k)))!.position);
    expect(travelling.size).toBe(3);
  });

  it('is deterministic: the same timeline renders the same frame bytes', async () => {
    const [a, b] = [await directed(story, moves), await directed(story, moves)];
    for (const [id, seconds] of [
      ['s2', 0.35],
      ['s3', 0.45],
    ] as const) {
      const frame = a.frameAt(id, seconds);
      expect((await a.shot(frame)).equals(await b.shot(frame))).toBe(true);
    }
  });

  it('with direction off, draws as 0.2.0 did: no canvas, no stops, the old transitions', async () => {
    const v = await directed(story, [], { off: true });
    expect(v.timeline.scenes.some((s) => s.stop || s.direction)).toBe(false);
    expect(v.scene('s2').transition!.kind).toBe('fade');
    const drawn = await v.state(v.frameAt('s2', 1));
    for (const d of drawn) expect(d.transform).toBeNull();
    const page = (await v.seek(
      v.frameAt('s2', 1),
      `return {
         canvas: document.querySelectorAll('.canvas-grid, .stop-view, [data-element]').length,
         origin: document.querySelector('[data-scene="s2"] > .layer').style.transformOrigin,
       };`,
    )) as { canvas: number; origin: string };
    expect(page.canvas).toBe(0);
    // The push-in scales about the media region's center, as it always has.
    const [ox, oy] = page.origin.split(' ').map((v) => Number.parseFloat(v));
    expect(ox).toBeCloseTo(pivot.x, 1);
    expect(oy).toBeCloseTo(pivot.y, 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/motion.test.ts tests/render/canvas.test.ts`
Expected: FAIL — `shotSettledAt` is not exported, and every canvas test throws `not a canvas transform: null` (there is no `.stop-view` yet).

- [ ] **Step 3: Implement**

`packages/video/src/timeline/cues.ts` — before `/** The summary's verdict badge rises into view. */`:

```ts
/**
 * When a directed scene's choreography is done: every element has entered and played its own (the
 * storyboard visual on the scene's phases, the others from their reveal), and every beat has ended.
 */
export function shotSettledAt(
  scene: Pick<TimelineScene, 'visual' | 'direction' | 'phases' | 'start' | 'end'>,
): number {
  const duration = scene.end - scene.start;
  const d = scene.direction;
  if (!d) return settledAt(scene.visual, duration, scene.phases);
  const revealedAt = (id: string) =>
    d.beats.find((b) => b.verb === 'reveal' && b.element === id)?.t ?? 0;
  const elements = d.elements.map((e) => {
    if (e.kind === 'visual') return settledAt(scene.visual, duration, scene.phases);
    const at = revealedAt(e.id);
    return e.kind === 'node' || e.kind === 'label'
      ? at + 0.5
      : at + settledAt(e.visual, Math.max(0.1, duration - at));
  });
  return Math.max(0, ...elements, ...d.beats.map((b) => b.t + b.seconds));
}
```

`packages/video/src/runtime/camera.ts`:

```ts
import { settledAt, shotSettledAt } from '../timeline/cues.ts';
```

and in `cameraPlan`:

```ts
  // A directed scene settles once its elements have played and its beats have ended.
  const settled = scene.direction ? shotSettledAt(scene) : settledAt(v, duration, scene.phases);
```

```ts
    // A shot that lays the capture out beside other elements holds it still: they move instead.
    drift:
      (!scene.direction || scene.direction.whole) &&
      (CAPTURES.has(v.kind) || (v.kind === 'title' && v.background !== undefined)),
```

`packages/video/src/runtime/styles.ts` — after the `.layer` rule:

```ts
.canvas-grid { background-color: ${c.background}; background-image: radial-gradient(circle at 1px 1px, ${dot} 1.2px, transparent 0); }
```

(the same dots as `#stage`; the stage sets their size and position every frame).

`packages/video/src/runtime/stage.ts`:

1. Imports — add `type DirectionElement` and `type Point` to the `../timeline/types.ts` import, `gridSpacing` to the `./layout.ts` import, and:

```ts
import {
  beatView,
  between,
  type CameraKind,
  type CameraStep,
  clampView,
  clipRect,
  gridStyle,
  insetOf,
  isCameraMove,
  layerTransform,
  lerpRect,
  PULL_MARGIN,
  pullBack,
  restView,
  toWorld,
  type View,
  viewAt,
  withPush,
} from './canvas.ts';
```

2. `interface MountedScene` — after `foxTaken?`:

```ts
  /** On the canvas: the viewport that clips the media layer to the region the scene owns. */
  viewport?: HTMLDivElement;
  /** The region the scene owns: the media region, or the full frame for a card without a header. */
  region: Rect;
  /** The component that draws the storyboard visual; absent when a shot replaces it. */
  visual?: Component;
  /** The camera's beats inside the stop, each toward its target. */
  steps: CameraStep[];
```

3. `class Stage` fields, after `accent`:

```ts
  /** The canvas's dot grid, which moves with the camera; absent without a canvas. */
  private grid?: HTMLDivElement;
  /** Where a view's focus is drawn: the media region's center, as the push-in always scaled from. */
  private readonly pivot: Point;
```

and in the constructor, right after `this.regions = computeRegions(timeline);`:

```ts
    const m = this.regions.media;
    this.pivot = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
```

4. `mount()` — after the progress bar loop:

```ts
    // The canvas's dots, under every scene: they travel with the camera (see `gridStyle`).
    if (t.scenes.some((s) => s.stop)) this.grid = el('div', 'layer canvas-grid', this.root);
```

In the scene loop, replace the media layer lines:

```ts
      // On the canvas the media layer sits in a viewport that clips it to the scene's region; the
      // camera moves the layer (from its origin), never the viewport.
      const viewport = scene.stop ? el('div', 'layer stop-view', root) : undefined;
      const media = el('div', 'layer', viewport ?? root);
      const center = { x: r.media.x + r.media.width / 2, y: r.media.y + r.media.height / 2 };
      media.style.transformOrigin = scene.stop
        ? '0 0'
        : `${center.x.toFixed(2)}px ${center.y.toFixed(2)}px`;
```

add to the object pushed into `this.scenes` (after `camera: cameraPlan(scene),`):

```ts
        ...(viewport ? { viewport } : {}),
        region: component.header === false ? r.full : r.media,
        visual: component,
        steps: [],
```

and after the scene loop, before the hero accent:

```ts
    // Camera beats aim at what their target shows when they end, measured before any frame.
    for (const m of this.scenes) m.steps = this.cameraSteps(m);
```

(The scene roots are still displayed and untransformed at this point, so measured rects are stage pixels — the stop's own coordinates.)

5. `seek()` — in the scene loop, replace the `next`/`leaveWith`/`enter`/`leave` lines:

```ts
      const enterWith = transitionOf(scene, t);
      const next = this.scenes[i + 1];
      const leaveWith = next ? transitionOf(next.scene, t) : undefined;
      // A camera move carries both pictures across the canvas: neither fades nor slides.
      const cameraIn = !first && this.travels(this.scenes[i - 1], m);
      const cameraOut = !last && this.travels(m, next);
      const enter =
        first || m.component.entrance === false || cameraIn
          ? REST
          : entering(enterWith.kind, seg(time, scene.start, scene.start + enterWith.seconds), unit, t.width);
      const leave =
        last || !leaveWith || cameraOut
          ? REST
          : leaving(leaveWith.kind, seg(time, scene.end - leaveWith.seconds, scene.end), unit, t.width);
```

replace the push lines:

```ts
      const push = m.camera ? cameraPush(local, m.camera) : 0;
      if (m.component.camera) m.component.camera(push);
      if (m.viewport && scene.stop) {
        m.media.style.transform = layerTransform(this.cameraAt(i, time), scene.stop, this.pivot);
        m.viewport.style.clipPath = insetOf(this.clipAt(i, time), t.width, t.height);
      } else if (!m.component.camera)
        m.media.style.transform = push > 1e-6 ? `scale(${(1 + push).toFixed(5)})` : '';
```

at the end of the `if (m.header) { … }` block, after the heading lines:

```ts
        // Across a camera move only the outgoing header fades; the picture travels.
        m.header.style.opacity =
          cameraOut && leaveWith
            ? (
                1 -
                easeInOutCubic(
                  seg(time, scene.end - leaveWith.seconds, scene.end - 0.4 * leaveWith.seconds),
                )
              ).toFixed(3)
            : '';
```

and after the scene loop, before `if (this.accent)`:

```ts
    if (this.grid) {
      const front = this.scenes.findLast((m) => m.viewport && m.root.style.display === 'block');
      if (front) {
        const { position, size } = gridStyle(
          this.cameraAt(front.index, time),
          this.pivot,
          gridSpacing(this.regions.unit),
        );
        Object.assign(this.grid.style, {
          display: 'block',
          backgroundPosition: position,
          backgroundSize: size,
          clipPath: insetOf(this.clipAt(front.index, time), t.width, t.height),
        });
      } else this.grid.style.display = 'none';
    }
```

6. `report()` — after `const active = …`:

```ts
    // On the canvas, what lies outside the viewport is not drawn, so it is not reported either.
    const clip = active?.viewport ? this.clipAt(active.index, time) : undefined;
    const drawn = (active?.component.report() ?? []).flatMap((item) => {
      if (!clip) return [item];
      const rect = clipRect(item.rect, clip);
      return rect ? [{ ...item, rect }] : [];
    });
```

and `items` becomes `active ? [...drawn, ...(active.heading ? [active.heading] : [])] : []`. B1's `LayoutItem.font` ("px as drawn, the camera's scale included") comes from `drawnFont`, which reads the scale an element is drawn at from the DOM (`getBoundingClientRect().width / offsetWidth`), so a canvas layer's camera scale is included without any change here: a 2× zoom reports twice the font size. B1's density checks read each scene at its settled frame (`settledSpan`), after its entrance, so a camera move between stops is never measured; Task 10 makes a directed scene settle after its beats too.

7. New private methods at the end of `class Stage`:

```ts
  /** Whether the camera travels the canvas from scene `a` to scene `b`: `b` enters by pan or zoom. */
  private travels(a: MountedScene | undefined, b: MountedScene | undefined): boolean {
    return Boolean(
      a?.scene.stop && b?.scene.stop && isCameraMove(transitionOf(b.scene, this.timeline).kind),
    );
  }

  /** The camera move scene `i` is part of at `time`: into it from the one before, or out to the next. */
  private moveAt(
    i: number,
    time: number,
  ): { from: MountedScene; to: MountedScene; kind: CameraKind; k: number } | undefined {
    const m = this.scenes[i]!;
    const pairs = [
      [this.scenes[i - 1], m],
      [m, this.scenes[i + 1]],
    ] as const;
    for (const [from, to] of pairs) {
      if (!from || !to || !this.travels(from, to)) continue;
      const { kind, seconds } = transitionOf(to.scene, this.timeline);
      if (time >= to.scene.start && time <= to.scene.start + seconds && isCameraMove(kind))
        return { from, to, kind, k: seg(time, to.scene.start, to.scene.start + seconds) };
    }
    return undefined;
  }

  /** Where the camera looks in a scene's own stop at `time` (world coordinates): beats, then push. */
  private stopView(m: MountedScene, time: number): View {
    const local = Math.max(0, time - m.scene.start);
    const push = m.camera && !m.component.camera ? cameraPush(local, m.camera) : 0;
    const view = viewAt(m.steps, local, restView(this.pivot));
    return toWorld(clampView(withPush(view, push), m.region, this.pivot), m.scene.stop!);
  }

  /** The camera that draws scene `i` at `time`: its stop's view, or the move it is part of. */
  private cameraAt(i: number, time: number): View {
    const move = this.moveAt(i, time);
    if (!move) return this.stopView(this.scenes[i]!, time);
    const { from, to } = move;
    const back = pullBack(from.scene.stop!, to.scene.stop!, this.regions.media) * PULL_MARGIN;
    return between(move.kind, this.stopView(from, time), this.stopView(to, time), move.k, back);
  }

  /** The region scene `i` is clipped to at `time`: its own, or one passing between two regions. */
  private clipAt(i: number, time: number): Rect {
    const move = this.moveAt(i, time);
    return move
      ? lerpRect(move.from.region, move.to.region, easeInOutCubic(move.k))
      : this.scenes[i]!.region;
  }

  /** The camera's beats in a directed scene, each toward its target as drawn when the beat ends. */
  private cameraSteps(m: MountedScene): CameraStep[] {
    const d = m.scene.direction;
    if (!d || !m.scene.stop) return [];
    const steps: CameraStep[] = [];
    let from = restView(this.pivot);
    for (const beat of d.beats) {
      if (beat.verb !== 'camera') continue;
      const element = d.elements.find((e) => e.id === beat.to);
      if (!element) continue;
      // A beat frames its target as drawn when it ends: what the visual highlights then (its
      // lines, its focus), or the element's box.
      const measured = this.targetAt(m, element, beat.t + beat.seconds);
      const target =
        measured && measured.width >= 1 && measured.height >= 1 ? measured : element.rect;
      const to = beatView(beat.move, target, beat.zoom, from, m.region, this.pivot);
      steps.push({ t: beat.t, seconds: beat.seconds, to });
      from = to;
    }
    return steps;
  }

  /** Where a beat's target is drawn `t` seconds in, in stage pixels (before any transform). */
  private targetAt(m: MountedScene, element: DirectionElement, t: number): Rect | undefined {
    const duration = m.scene.end - m.scene.start;
    const clock: SceneClock = {
      t,
      duration,
      p: clamp(t / duration),
      frame: Math.round((m.scene.start + t) * this.timeline.fps),
      fox: { mouth: 0, blink: 0 },
      open: m.index === 0,
    };
    m.component.update(clock);
    // Task 9 frames other elements by their drawn box; until then, by their slot.
    return element.kind === 'visual' ? m.visual?.target?.(clock) : undefined;
  }
```

Calling a component's `update` at mount with a later clock is safe: every component draws as a pure function of its clock, and `seek(0)` redraws everything before the first frame.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/motion.test.ts packages/video/test/canvas.test.ts tests/render/canvas.test.ts`
Expected: PASS.

Then `npm run typecheck && npx biome check --write packages/video tests/render/canvas.test.ts && npm run lint`, and in the background `npx vitest run tests/render/render.test.ts` (the existing render tests, which must pass unchanged — R-016) and `npm test`. Wait for both.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/timeline packages/video/src/runtime packages/video/test/motion.test.ts tests/render/canvas.test.ts
git commit -m "$(cat <<'EOF'
Draw videos on a canvas: stops, camera moves between them, and beats inside them

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 9: A shot's elements — code, output, captures, nodes, and labels in their slots; reveals; the camera on an element

**Files:**
- Create: `packages/video/src/runtime/direction/elements.ts`
- Modify: `packages/video/src/runtime/stage.ts` (mount a shot; `MountedScene.shot`; `targetAt` frames elements)
- Modify: `packages/video/src/runtime/styles.ts` (`.dlabel`)
- Modify: `tests/render/canvas.test.ts` (a second `describe`)
- Modify: `tests/direction-security.test.ts` (the render part of the acceptance test)

**Interfaces:**
- Consumes: `code`, `terminal`, `screenshot` (`runtime/components/media.ts`); `Component`, `ComponentContext`, `overflows`, `rectOf`, and B1's `drawnFont` (`components/types.ts`); `el`, `fitText`, `place` (`dom.ts`); `union` (`narrator.ts`); `insetOf` (Task 7); `DirectionElement`, `DirectionBeat`, `RevealStyle` (Task 1); the stage's `MountedScene`, `targetAt` (Task 8).
- Produces:
  ```ts
  // packages/video/src/runtime/direction/elements.ts
  export interface ShotComponent extends Component {
    /** The component drawing the storyboard visual, when the shot keeps it. */
    visual?: Component;
    /** An element's box as last drawn, in stage pixels: what a camera beat aimed at it frames. */
    frame(id: string): Rect | undefined;
  }
  export function mountShot(
    scene: TimelineScene, ctx: ComponentContext, drawVisual: (ctx: ComponentContext) => Component,
  ): ShotComponent;
  // DOM: each element is `.layer.element[data-element="<id>"]` inside the scene's media layer;
  // a node is `.node.dnode > .nlabel`, a label `.dlabel > .nlabel` (text set as text).
  ```

Behavior: a shot that lays out more than the storyboard visual (`direction.whole === false`) draws every element in a full-stage layer of its own, so components keep laying out in stage pixels; each component gets `regions.media` (and `full`) set to its slot. The visual element keeps the scene's phases; every other element plays its own choreography from its reveal (its clock shifted to the reveal, already in place: `open: true`), and the reveal style animates its layer: `rise` (opacity and a 28-unit rise), `pop` (from 86% with an overshoot), `wipe` (uncovered left to right), `type` (a node's or label's text typed in; other kinds rise). An element not revealed yet is not reported. Labels and nodes are set with `textContent` only; their text is fitted between 28 and 40 units (48 on tall frames), body-sized for B1's text-size check.

- [ ] **Step 1: Write the failing tests**

In `tests/render/canvas.test.ts`, extend the `@covi/core` import to `buildEvidence, type Demonstration, type Hunk, indexEvidence, resolveConfig, seedFrom`, and append:

```ts
// A run with one hunk and one demo command, for shots that show them.
const hunk: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { kind: 'del', text: 'send(docs);', oldLine: 1 },
    { kind: 'add', text: 'send(ids);', newLine: 1 },
  ],
};
const files = [{ path: 'src/request.js', language: 'javascript', hunks: [hunk] }];
const demo = {
  commands: [
    {
      name: 'measure',
      command: 'node measure.js',
      before: { exitCode: 0, output: 'request bytes: 120000' },
      after: { exitCode: 0, output: 'request bytes: 9000' },
      changed: true,
    },
  ],
  shots: [],
  requests: [],
  skipped: [],
  findings: [],
} as unknown as Demonstration;
const run: SourcesInput = {
  files,
  demo,
  evidence: indexEvidence(buildEvidence({ diff: files, demo })),
};
const elements: DirectionInput['shots'][number]['elements'] = [
  { id: 'req', kind: 'code', evidence: 'diff-hunk:src/request.js:1', side: 'diff' },
  { id: 'note', kind: 'label', text: 'Much smaller', tone: 'success' },
  { id: 'out', kind: 'output', evidence: 'terminal:1' },
];
const elementState = (v: Awaited<ReturnType<typeof directed>>, frame: number, id: string) =>
  v.seek(
    frame,
    `const e = document.querySelector('[data-element="${id}"]');
     const r = e.querySelector('.code, .term, .dlabel, .node').getBoundingClientRect();
     return {
       opacity: Number.parseFloat(e.style.opacity || '1'),
       transform: e.style.transform,
       clip: e.style.clipPath,
       text: e.querySelector('.nlabel')?.textContent ?? null,
       box: { x: r.x, y: r.y, width: r.width, height: r.height },
     };`,
  ) as Promise<{
    opacity: number;
    transform: string;
    clip: string;
    text: string | null;
    box: { x: number; y: number; width: number; height: number };
  }>;

describe.skipIf(!available)('a shot’s elements', () => {
  it('draws code, a label, and output from the run in their slots', async () => {
    const v = await directed(story, [{ scene: 's3', layout: 'row', elements }], { sources: run });
    const s3 = v.scene('s3');
    expect(s3.direction!.whole).toBe(false);
    const frame = v.frameAt('s3', 1.2);
    for (const element of s3.direction!.elements) {
      const drawn = await elementState(v, frame, element.id);
      const center = drawn.box.x + drawn.box.width / 2;
      expect(center, element.id).toBeGreaterThan(element.rect.x);
      expect(center, element.id).toBeLessThan(element.rect.x + element.rect.width);
    }
    expect((await elementState(v, frame, 'note')).text).toBe('Much smaller');
    const shown = (await v.seek(
      frame,
      `return [document.querySelector('[data-element="req"] .ln.add .txt').textContent,
               document.querySelector('[data-element="out"] .out').textContent];`,
    )) as string[];
    expect(shown).toEqual(['send(ids);', 'request bytes: 9000']);
    expect(v.errors).toEqual([]);
  });

  it('reveals an element on its phrase: absent before, popping in, then in place', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [{ verb: 'reveal', element: 'note', style: 'pop', at: 'and nothing else' }],
        },
      ],
      { sources: run },
    );
    const reveal = v.scene('s3').direction!.beats.find((b) => b.verb === 'reveal')!;
    const texts = async (frame: number) =>
      (await v.report(frame)).items.filter((i) => i.role === 'text').length;
    const before = v.frameAt('s3', reveal.t - 0.1);
    expect((await elementState(v, before, 'note')).opacity).toBe(0);
    const during = await elementState(v, v.frameAt('s3', reveal.t + reveal.seconds / 4), 'note');
    expect(during.opacity).toBeGreaterThan(0);
    expect(during.transform).toMatch(/scale\(0\.\d+\)/);
    const after = v.frameAt('s3', reveal.t + reveal.seconds + 0.1);
    expect(await elementState(v, after, 'note')).toMatchObject({ opacity: 1, transform: '' });
    // Not on screen, not reported: the label's text joins the report once it is revealed.
    expect(await texts(after)).toBeGreaterThan(await texts(before));
  });

  it('wipes and types elements in', async () => {
    const v = await directed(
      story,
      [
        {
          scene: 's3',
          layout: 'row',
          elements,
          beats: [
            { verb: 'reveal', element: 'out', style: 'wipe', at: 'only the ids' },
            { verb: 'reveal', element: 'note', style: 'type', at: 'and nothing else' },
          ],
        },
      ],
      { sources: run },
    );
    const beats = v.scene('s3').direction!.beats;
    const wipe = beats.find((b) => b.verb === 'reveal' && b.element === 'out')!;
    const type = beats.find((b) => b.verb === 'reveal' && b.element === 'note')!;
    expect((await elementState(v, v.frameAt('s3', wipe.t + wipe.seconds / 2), 'out')).clip).toMatch(
      /^inset\(/,
    );
    expect((await elementState(v, v.frameAt('s3', wipe.t + wipe.seconds + 0.1), 'out')).clip).toBe(
      '',
    );
    const typing = (await elementState(v, v.frameAt('s3', type.t + type.seconds / 2), 'note'))
      .text!;
    expect(typing.length).toBeGreaterThan(0);
    expect(typing.length).toBeLessThan('Much smaller'.length);
    expect('Much smaller'.startsWith(typing)).toBe(true);
    expect((await elementState(v, v.frameAt('s3', type.t + type.seconds + 0.1), 'note')).text).toBe(
      'Much smaller',
    );
  });

  it('moves the camera onto an element: the label lands in the middle of the frame', async () => {
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
    const beat = v.scene('s3').direction!.beats[0]!;
    const frame = v.frameAt('s3', beat.t + beat.seconds + 0.1);
    const { box } = await elementState(v, frame, 'note');
    expect(Math.abs(box.x + box.width / 2 - pivot.x)).toBeLessThan(3);
    expect(Math.abs(box.y + box.height / 2 - pivot.y)).toBeLessThan(3);
    expect(camera(v.of(await v.state(frame), 's3').transform).scale).toBeGreaterThan(1.5);
  });
});
```

In `tests/direction-security.test.ts`, add the imports

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@covi/core';
import {
  buildTimeline,
  layoutScenes,
  pacingFor,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { chromium } from 'playwright';
import { canUseBrowser } from './helpers/env.ts';
```

(merge `indexEvidence` into the `@covi/core` import from Task 3, `afterAll` into the `vitest` import, and `LabelSchema` into the schema import), and append:

```ts
describe.skipIf(!(await canUseBrowser()))('text from a direction, on the page', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('is drawn as text: no element, no script, exactly the characters it holds', async () => {
    // One label passes validation with characters markup would read (& ’ ( ) /). The others are
    // put straight into a timeline, as if they had slipped past the schema, and a code line from
    // the diff carries markup too.
    const passing = LabelSchema.parse('Tom & Jerry (it’s &amp / fine)');
    const smuggled = '<img src=x onerror="window.__pwned=1">';
    const script = '</script><script>window.__pwned=2</script>';
    const line = '<b onmouseover="window.__pwned=3">bold</b>';
    const dir = mkdtempSync(join(tmpdir(), 'covi-direction-security-'));
    dirs.push(dir);
    const spec = resolveVideoSpec(resolveConfig([]).config, {
      mode: 'custom',
      width: 640,
      height: 360,
    });
    const scenes = StoryboardSchema.parse({
      title: 'Security',
      template: 'bug-fix',
      scenes: [
        { id: 's1', beat: 'a', narration: 'One line.', visual: { kind: 'callout', title: 'A' } },
        {
          id: 's2',
          beat: 'b',
          narration: 'Another line here.',
          visual: { kind: 'callout', title: 'B' },
        },
      ],
    }).scenes;
    const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
    const slot = (x: number) => ({ x, y: 80, width: 140, height: 120 });
    const staging: SceneStaging[] = [
      {
        stop: { x: 0, y: 0 },
        direction: {
          whole: true,
          elements: [{ id: 'visual', kind: 'visual', rect: slot(40) }],
          beats: [],
        },
      },
      {
        stop: { x: 800, y: 0 },
        direction: {
          whole: false,
          elements: [
            { id: 'a', kind: 'label', rect: slot(20), text: passing, tone: 'neutral' },
            { id: 'b', kind: 'node', rect: slot(170), label: smuggled },
            { id: 'c', kind: 'label', rect: slot(320), text: script, tone: 'warning' },
            {
              id: 'd',
              kind: 'code',
              rect: slot(470),
              visual: {
                kind: 'code',
                path: 'x.js',
                lines: [{ type: 'add', text: line }],
                highlight: [],
              },
            },
          ],
          beats: [],
        },
      },
    ];
    const timeline = buildTimeline({
      title: 'Security',
      scenes,
      layout,
      spec,
      image: () => ({ src: '', width: 1, height: 1 }),
      staging,
    });
    const composition = join(dir, 'composition');
    await writeComposition(composition, timeline, new Map());
    // The timeline is inlined as JSON with every `<` escaped: it cannot close its script element.
    const html = readFileSync(join(composition, 'index.html'), 'utf8');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('</script><script>window');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`file://${join(composition, 'index.html')}`);
      await page.waitForFunction('window.covi !== undefined');
      await page.evaluate('window.covi.ready');
      const s2 = timeline.scenes.find((s) => s.id === 's2')!;
      const seen = (await page.evaluate(
        `(() => {
           window.covi.seek(${Math.round((s2.start + 1) * timeline.fps)});
           const labels = [...document.querySelectorAll('[data-element] .nlabel')];
           return {
             pwned: window.__pwned ?? null,
             scripts: document.querySelectorAll('script').length,
             injected: document.querySelectorAll('[data-element] img, [data-element] script, [data-element] b').length,
             texts: labels.map((n) => n.textContent),
             children: labels.map((n) => n.children.length),
             code: document.querySelector('[data-element="d"] .ln .txt').textContent,
           };
         })()`,
      )) as {
        pwned: unknown;
        scripts: number;
        injected: number;
        texts: string[];
        children: number[];
        code: string;
      };
      expect(seen).toEqual({
        pwned: null,
        scripts: 2,
        injected: 0,
        texts: [passing, smuggled, script],
        children: [0, 0, 0],
        code: line,
      });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/render/canvas.test.ts tests/direction-security.test.ts`
Expected: FAIL — the new tests find no `[data-element]` (the stage still draws only the storyboard visual).

- [ ] **Step 3: Implement**

Create `packages/video/src/runtime/direction/elements.ts`:

```ts
import type {
  DirectionBeat,
  DirectionElement,
  Rect,
  RevealStyle,
  TimelineScene,
} from '../../timeline/types.ts';
import { clamp, easeOutBack, easeOutCubic, rise, seg, typedPrefix } from '../anim.ts';
import { insetOf } from '../canvas.ts';
import { code, screenshot, terminal } from '../components/media.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  overflows,
  rectOf,
} from '../components/types.ts';
import { el, fitText, place } from '../dom.ts';
import { union } from '../narrator.ts';

/*
 * A directed scene's elements, drawn together as one component, so the stage treats a shot like a
 * visual. Code, output, and captures are drawn by the components that draw those visuals, each in
 * its slot; nodes and labels are the agent's short text, always set as text, never as markup.
 */

/** A shot, drawn: one component for the stage, and the storyboard visual's own when it keeps it. */
export interface ShotComponent extends Component {
  visual?: Component;
  /** An element's box as last drawn, in stage pixels: what a camera beat aimed at it frames. */
  frame(id: string): Rect | undefined;
}

type Reveal = Extract<DirectionBeat, { verb: 'reveal' }>;

interface Part {
  component: Component;
  /** Types the element's text in (nodes and labels), for the `type` reveal. */
  type?(k: number): void;
}

interface Drawn extends Part {
  element: DirectionElement;
  layer: HTMLDivElement;
  reveal?: Reveal;
}

export function mountShot(
  scene: TimelineScene,
  ctx: ComponentContext,
  drawVisual: (ctx: ComponentContext) => Component,
): ShotComponent {
  const direction = scene.direction!;
  const drawn: Drawn[] = direction.elements.map((element) => {
    // A full-stage layer per element, so components keep laying out in stage pixels.
    const layer = el('div', 'layer element', ctx.root);
    layer.dataset.element = element.id;
    const r = element.rect;
    layer.style.transformOrigin = `${(r.x + r.width / 2).toFixed(2)}px ${(r.y + r.height / 2).toFixed(2)}px`;
    const sub: ComponentContext = {
      ...ctx,
      root: layer,
      regions: { ...ctx.regions, media: r, full: r },
      // The visual keeps the scene's phases; other elements play from their reveal.
      phases: element.kind === 'visual' ? ctx.phases : {},
    };
    const reveal = direction.beats.find(
      (b): b is Reveal => b.verb === 'reveal' && b.element === element.id,
    );
    return { element, layer, ...(reveal ? { reveal } : {}), ...draw(element, sub, drawVisual) };
  });
  const visual = drawn.find((d) => d.element.kind === 'visual')?.component;
  let now = 0;
  return {
    ...(visual ? { visual } : {}),
    update(clock) {
      now = clock.t;
      for (const d of drawn) {
        const k = d.reveal ? seg(clock.t, d.reveal.t, d.reveal.t + d.reveal.seconds) : 1;
        appear(d, d.reveal?.style ?? 'rise', k, ctx);
        // An element revealed later plays its own choreography from then, already in place.
        d.component.update(
          d.reveal && d.element.kind !== 'visual'
            ? { ...clock, t: clock.t - d.reveal.t, open: true }
            : clock,
        );
      }
    },
    // An element not revealed yet is not on screen.
    report: () =>
      drawn.filter((d) => !d.reveal || now >= d.reveal.t).flatMap((d) => d.component.report()),
    target: (clock) => visual?.target?.(clock),
    frame(id) {
      const d = drawn.find((x) => x.element.id === id);
      const boxes = (d?.component.report() ?? [])
        .filter((item) => item.role === 'media')
        .map((item) => item.rect);
      return boxes.length ? union(boxes) : undefined;
    },
  };
}

function draw(
  element: DirectionElement,
  ctx: ComponentContext,
  drawVisual: (ctx: ComponentContext) => Component,
): Part {
  switch (element.kind) {
    case 'visual':
      return { component: drawVisual(ctx) };
    case 'code':
      return { component: code(element.visual, ctx) };
    case 'output':
      return { component: terminal(element.visual, ctx) };
    case 'capture':
      return { component: screenshot(element.visual, ctx) };
    case 'node':
      return textBox(element.label, element.rect, 'node dnode', ctx);
    case 'label':
      return textBox(element.text, element.rect, 'dlabel', ctx, toneColor(element.tone, ctx));
  }
}

/** A label's color by tone: the theme's own, as callouts use them. */
function toneColor(
  tone: Extract<DirectionElement, { kind: 'label' }>['tone'],
  ctx: ComponentContext,
): string | undefined {
  const theme = ctx.timeline.theme;
  return tone === 'warning' ? theme.accent : tone === 'success' ? theme.success : undefined;
}

/**
 * A box of an agent's short text (a node's name, a label), centered in its slot and sized to it,
 * with the text fitted between 28 and 40 units (48 on tall frames) and set as text.
 */
function textBox(
  text: string,
  slot: Rect,
  className: string,
  ctx: ComponentContext,
  color?: string,
): Part {
  const u = ctx.u;
  const tall = ctx.timeline.orientation === 'vertical';
  const width = Math.min(slot.width, u(tall ? 760 : 520));
  const height = Math.min(slot.height, u(tall ? 220 : 170));
  const box = el('div', className, ctx.root);
  place(box, {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  });
  if (color) Object.assign(box.style, { color, borderColor: color, background: `${color}1f` });
  const label = el('div', 'nlabel', box, text);
  fitText(label, {
    max: u(tall ? 48 : 40),
    min: u(28),
    maxWidth: width - u(32),
    maxHeight: height - u(24),
  });
  return {
    component: {
      update() {},
      report: () => [
        { role: 'media', rect: rectOf(box) },
        {
          role: 'text',
          rect: rectOf(label),
          overflow: overflows(label),
          font: drawnFont(label),
          text: 'body',
        },
      ],
    },
    type(k) {
      const typed = typedPrefix(text, k);
      if (label.textContent !== typed) label.textContent = typed;
    },
  };
}

/** How an element looks `k` (0–1) of the way through its reveal. */
function appear(d: Drawn, style: RevealStyle, k: number, ctx: ComponentContext): void {
  const { layer } = d;
  if (style === 'type' && d.type) {
    layer.style.opacity = k > 0 ? '1' : '0';
    d.type(k);
    return;
  }
  if (style === 'pop') {
    layer.style.opacity = clamp(k * 3).toFixed(3);
    layer.style.transform = k >= 1 ? '' : `scale(${(0.86 + 0.14 * easeOutBack(k)).toFixed(4)})`;
    return;
  }
  if (style === 'wipe') {
    const r = d.element.rect;
    layer.style.opacity = k > 0 ? '1' : '0';
    layer.style.clipPath =
      k >= 1
        ? ''
        : insetOf(
            { ...r, width: r.width * easeOutCubic(k) },
            ctx.timeline.width,
            ctx.timeline.height,
          );
    return;
  }
  rise(layer, k, ctx.u(28));
}
```

`drawnFont` is B1's (`runtime/components/types.ts`): a label's or node's text reports its drawn size as `body` text, like B1's diagram node labels, so `text-size` holds it to 28 units at its settled frame, the camera's scale included.

`packages/video/src/runtime/styles.ts` — after the `.node .ndetail` rule:

```ts
/* Direction */
.dlabel { position: absolute; display: flex; align-items: center; justify-content: center; text-align: center; overflow: hidden;
  padding: ${u(12)} ${u(22)}; border-radius: ${u(18)}; border: ${u(3)} solid ${c.line}; background: ${c.surface}; color: ${c.text}; box-shadow: ${c.shadow}; }
.dlabel .nlabel { font-weight: 720; line-height: 1.15; word-break: break-word; }
```

(A node reuses the diagram's `.node` and `.node .nlabel` styles.)

`packages/video/src/runtime/stage.ts`:

1. `import { mountShot, type ShotComponent } from './direction/elements.ts';`
2. `MountedScene` gains:

```ts
  /** The shot drawing its elements, when it lays out more than the storyboard visual. */
  shot?: ShotComponent;
```

3. In `mount()`, replace `const component = mountComponent(scene, ctx);` with:

```ts
      // A shot that lays out more than the storyboard visual draws its elements; one that shows the
      // visual alone draws it exactly as without direction.
      const shot =
        scene.direction && !scene.direction.whole
          ? mountShot(scene, ctx, (sub) => mountComponent(scene, sub))
          : undefined;
      const component = shot ?? mountComponent(scene, ctx);
```

and in the pushed object replace `visual: component,` with:

```ts
        ...(shot
          ? { shot, ...(shot.visual ? { visual: shot.visual } : {}) }
          : { visual: component }),
```

4. In `targetAt`, replace the last two lines with:

```ts
    return element.kind === 'visual' ? m.visual?.target?.(clock) : m.shot?.frame(element.id);
```

A camera beat on a label thus frames the label's box (fitted up to 2.5×), not its whole slot.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/render/canvas.test.ts tests/direction-security.test.ts`
Expected: PASS (11 canvas tests, 6 security tests).

Then `npm run typecheck && npx biome check --write packages/video tests && npm run lint`, and `npm test` in the background (wait for it).

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/runtime tests/render/canvas.test.ts tests/direction-security.test.ts
git commit -m "$(cat <<'EOF'
Draw a shot's elements in their slots, with reveals and the camera on an element

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 10: QC reads shots, and the benchmark renders on the canvas

**Files:**
- Modify: `packages/video/src/density.ts` (B1: `leadKind`; `emptyFrameCheck`'s card filter)
- Modify: `packages/video/src/timeline/cues.ts` (B1: `settledSpan` settles a directed scene after its beats)
- Create: `packages/video/test/density-direction.test.ts`
- Modify: `tests/render/render.test.ts` (B1's `covi video (full pipeline)` loop: every example is drawn on the canvas)

**Interfaces:**
- Consumes: B1's `leadKind`, `monotonyCheck`, `transitionVarietyCheck`, `emptyFrameCheck` (`packages/video/src/density.ts`) and `settledSpan` (`timeline/cues.ts`); `shotSettledAt` (Task 8); `DirectionElement` (Task 1).
- Produces:
  ```ts
  // packages/video/src/density.ts (signature widened; B1's callers keep working)
  export function leadKind(scene: Pick<TimelineScene, 'visual' | 'direction'>): TimelineVisual['kind'];
  ```

B1 defines `leadKind(scene: Pick<TimelineScene, 'visual'>): string` "for B2 to extend", counts transition kinds generically (`s.transition?.kind ?? 'fade'`, so `pan` and `zoom` count like any kind), and reads layout reports at each story scene's settled frame (`settledSpan`, after the entrance and the visual's choreography, before the next entrance). If B1 merged with other names, apply the same three changes to its names.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/density-direction.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { leadKind, monotonyCheck, transitionVarietyCheck } from '../src/density.ts';
import { settledAt, settledSpan, shotSettledAt } from '../src/timeline/cues.ts';
import type {
  DirectionElement,
  SceneDirection,
  TimelineScene,
  TimelineVisual,
  TransitionKind,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const codeVisual: Extract<TimelineVisual, { kind: 'code' }> = {
  kind: 'code',
  path: 'a.js',
  lines: [{ type: 'add', text: 'x' }],
  highlight: [],
};
const output: DirectionElement = {
  id: 'o',
  kind: 'output',
  rect,
  visual: { kind: 'terminal', command: 'node measure.js', output: 'request bytes: 9000' },
};
const label: DirectionElement = { id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' };
const shot = (...elements: DirectionElement[]): SceneDirection => ({
  whole: false,
  elements,
  beats: [],
});
const scene = (
  id: string,
  start: number,
  visual: TimelineVisual,
  extra: Partial<TimelineScene> = {},
): TimelineScene => ({
  id,
  beat: id,
  eyebrow: id,
  start,
  end: start + 4,
  visual,
  expression: 'explaining',
  narrator: true,
  ...extra,
});

describe('lead kinds with direction', () => {
  it('lead with the shot’s first element, counted as the visual it looks like', () => {
    expect(leadKind(scene('a', 0, callout))).toBe('callout');
    const whole = { whole: true, elements: [{ id: 'visual', kind: 'visual' as const, rect }], beats: [] };
    expect(leadKind(scene('a', 0, codeVisual, { direction: whole }))).toBe('code');
    const lead = (e: DirectionElement) => leadKind(scene('a', 0, callout, { direction: shot(e) }));
    expect(lead({ id: 'c', kind: 'code', rect, visual: codeVisual })).toBe('code');
    expect(lead(output)).toBe('terminal');
    expect(
      lead({
        id: 'p',
        kind: 'capture',
        rect,
        visual: { kind: 'screenshot', image: { src: 'a.png', width: 1, height: 1 }, device: 'desktop' },
      }),
    ).toBe('screenshot');
    expect(lead({ id: 'n', kind: 'node', rect, label: 'Reader' })).toBe('diagram');
    expect(lead(label)).toBe('callout');
  });

  it('let a shot break a run of one kind, or continue it', () => {
    const code = (id: string, start: number, extra: Partial<TimelineScene> = {}) =>
      scene(id, start, codeVisual, extra);
    // Three code scenes, the middle one leading with its output: no run of three.
    expect(
      monotonyCheck({ scenes: [code('a', 0), code('b', 4, { direction: shot(output) }), code('c', 8)] })
        .status,
    ).toBe('pass');
    // A callout, then two shots leading with labels: three callouts in a row.
    expect(
      monotonyCheck({
        scenes: [
          scene('a', 0, callout),
          code('b', 4, { direction: shot(label) }),
          code('c', 8, { direction: shot(label) }),
        ],
      }).status,
    ).toBe('warn');
  });
});

describe('transition variety on the canvas', () => {
  const moves = (...kinds: TransitionKind[]) => ({
    scenes: [
      scene('s0', 0, callout),
      ...kinds.map((kind, i) =>
        scene(`s${i + 1}`, 4 * (i + 1), callout, { transition: { kind, seconds: 0.7 } }),
      ),
    ],
  });
  it('counts pans and zooms like any other entrance', () => {
    expect(transitionVarietyCheck(moves('pan', 'pan', 'pan', 'push')).status).toBe('warn');
    expect(transitionVarietyCheck(moves('pan', 'push', 'pan', 'zoom')).status).toBe('pass');
  });
});

describe('the settled frame of a directed scene', () => {
  it('comes after its beats, so a camera move inside the stop is not measured mid-way', () => {
    const timeline = (s: TimelineScene) => ({ scenes: [s], transition: 0.45 });
    const plain = scene('a', 0, callout);
    const directed = scene('a', 0, callout, {
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect }],
        beats: [{ verb: 'camera', move: 'zoom', to: 'visual', t: 1.5, seconds: 0.8 }],
      },
    });
    expect(settledSpan(timeline(plain), 0)![0]).toBeCloseTo(settledAt(callout, 4), 9);
    expect(shotSettledAt(directed)).toBeCloseTo(2.3, 9);
    expect(settledSpan(timeline(directed), 0)![0]).toBeCloseTo(2.3, 9);
  });
});
```

In `tests/render/render.test.ts`, in B1's `covi video (full pipeline)` loop, after the `qc.checks` assertion, add (every example renders with Covi's default director, whose drafts set no transitions):

```ts
      // Drawn on the canvas by Covi's default director: every story scene at a stop, the camera
      // travelling between them, no fades, and no entrance taking more than 60% of the moves.
      const timeline = JSON.parse(
        readFileSync(join(result.runDir, 'video', 'timeline.json'), 'utf8'),
      ) as Timeline;
      const story = timeline.scenes.filter((s) => s.visual.kind !== 'outro');
      expect(story.every((s) => s.stop)).toBe(true);
      const moves = story.slice(1).map((s) => s.transition!.kind);
      expect(moves).not.toContain('fade');
      expect(moves.some((k) => k === 'pan' || k === 'zoom')).toBe(true);
      for (const kind of new Set(moves))
        expect(moves.filter((k) => k === kind).length / moves.length, kind).toBeLessThanOrEqual(0.6);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/density-direction.test.ts`
Expected: FAIL — `leadKind` ignores `direction` (the output-led shot reads `code`, the label-led shots read `code`), and `settledSpan` of the directed scene starts at the callout's 0.6 s instead of 2.3 s.

- [ ] **Step 3: Implement**

`packages/video/src/density.ts` — add `type DirectionElement` and `type TimelineVisual` to its `./timeline/types.ts` import, and replace `leadKind`:

```ts
/** What each element of a shot looks like on screen: the visual kind it reads as. */
const LOOKS_LIKE = {
  code: 'code',
  output: 'terminal',
  capture: 'screenshot',
  node: 'diagram',
  label: 'callout',
} as const satisfies Record<Exclude<DirectionElement['kind'], 'visual'>, TimelineVisual['kind']>;

/**
 * The kind of picture a scene leads with: its shot's first element, counted as the visual it
 * looks like (an output reads as a terminal), else its visual's kind.
 */
export function leadKind(scene: Pick<TimelineScene, 'visual' | 'direction'>): TimelineVisual['kind'] {
  const first = scene.direction?.elements[0];
  return !first || first.kind === 'visual' ? scene.visual.kind : LOOKS_LIKE[first.kind];
}
```

In `emptyFrameCheck`, the card filter reads the lead kind, so a shot that replaced its visual is judged by what it shows: `if (!CARDS.has(scene.visual.kind)) continue;` becomes `if (!CARDS.has(leadKind(scene))) continue;`.

`packages/video/src/timeline/cues.ts` — in B1's `settledSpan`, a directed scene has settled once its elements have played and its beats have ended. Replace `settledAt(scene.visual, scene.end - scene.start, scene.phases)` with `shotSettledAt(scene)` (it falls back to `settledAt` for a scene without direction, so every undirected timeline keeps its settled frames).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/density-direction.test.ts packages/video/test/density.test.ts`
Expected: PASS (B1's density tests unchanged).

Then `npm run typecheck && npx biome check --write packages/video tests/render/render.test.ts && npm run lint`.

- [ ] **Step 5: Render the benchmark with the default director and look at it**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/video.json"
```

Run the `covi video` line in the background (capture, narration, a 1080p render: several minutes) and wait for it to exit. Then:

```bash
node -e '
const fs = require("fs"), path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const t = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "timeline.json"), "utf8"));
const qc = JSON.parse(fs.readFileSync(path.join(r.runDir, "video", "qc.json"), "utf8"));
console.log(r.runDir, r.video.rendered, qc.status);
for (const s of t.scenes)
  console.log(s.id, s.visual.kind, s.transition ? s.transition.kind : "-", s.stop ? s.stop.x + "," + s.stop.y : "no stop",
    s.direction ? "whole=" + s.direction.whole + " beats=" + s.direction.beats.length : "");
for (const c of qc.checks.filter((c) => c.status !== "pass")) console.log(c.id, c.status, c.message);
' "$RENDER/video.json"
```

Expected: `rendered` true, `qc.status` not `fail`; every story scene has a stop and the outro has none; story transitions are `pan`, `push`, `zoom` (the hero), `cut`, or `wipe`, with no `fade` and none more than 60%; `captions-clear-of-content` and `text-fits` pass.

Open `<runDir>/video/contact-sheet.jpg` and `<runDir>/video/poster.png` with the Read tool and judge as a viewer. The tiles in the middle of each transition must show camera moves, not fades: in a pan, the outgoing picture leaving one side while the incoming one arrives from the other with the canvas's dots between them, both fully opaque; in the hero's zoom, both stops small on the canvas at once. Within a code scene that highlights lines, its middle tile is zoomed toward them with the start of the lines in view. Nothing covers the captions or the narrator. Record in the report the transition kinds, what the sheet shows, and each warning QC gave.

If the render shows a defect of this branch (content over the captions, a header that does not fade, a stop shown at the wrong place, a camera move that jumps), write a failing test in `tests/render/canvas.test.ts` that reproduces it with `directed(…)`, fix it, and commit that fix separately before Step 6.

- [ ] **Step 6: Run the full-pipeline renders**

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "full pipeline"`
Expected: PASS — every example renders on the canvas with QC not `fail`, the timing-grammar render (pinned to `--direction off`) passes as in 0.2.0, and the every-component render passes under the default director.

- [ ] **Step 7: Commit**

```bash
rm -rf "$RENDER"
git add packages/video/src/density.ts packages/video/src/timeline/cues.ts packages/video/test/density-direction.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Read shots in the density checks, and render every example on the canvas

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 11: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md` (the pipeline table, a new section after "Editing a storyboard before rendering", the Timing section's transition lengths, the Quality checks' sampling note)
- Modify: `docs/visual-system.md:223` (the `transitions` row) and the "How they move" list
- Modify: `docs/artifacts.md` (the Video table, "Files agents author", "Schema versions")
- Modify: `docs/security.md` (a new "The direction file" subsection after "The subject model")
- Modify: `docs/configuration.md` (the `video` table and its YAML example, the environment variables table)
- Modify: `AGENTS.md` (Architecture rules: "Artifacts are the interface"; "Using the CLI as a tool": `covi schema`; Run outputs tree; "Changing workflows safely": Schemas; Security model)
- Modify: `skills/covi-video/SKILL.md` (`## Run it`, `## Output files`)
- Modify: `CHANGELOG.md` (one line under `## [Unreleased]`)

**Interfaces:**
- Consumes: the behavior of Tasks 1–10, as documented below.
- Produces: documentation only. `skills/` is linked into `.claude/skills` and `.agents/skills`, so nothing needs regenerating (`npm run agents:check` confirms it).

The full methodology of direction (when each verb fits, variety rules, the critique loop) is PR B7's; this task documents what exists and gives the skill a short pointer. `## Run it` and `## Output files` are agent-only sections (left out of model prompts by `methodologyOf`), which is where the pointer belongs.

- [ ] **Step 1: `docs/video.md`**

In the pipeline table, after the `Storyboard` row:

```markdown
| Direction | Checks the run's `video/direction.json` against the storyboard and the evidence, puts its shots over Covi's default director's, and decides how each scene enters; with `--draft`, writes Covi's direction for the agent to rewrite. Nothing when `video.direction` is `off` | `video/direction.json` (with `--draft`) |
```

After the `### Editing a storyboard before rendering` section, add:

````markdown
### Direction and the canvas

Evidence decides what a video shows; direction decides how. Every video is drawn on one large canvas. Each story scene sits at its stop, a frame-sized region placed along a path that runs to the right and turns down every two to four stops (the title's seed picks where, so a different change travels differently), with the hero's stop dropped off the row. The camera travels between stops instead of fading: `pan` glides to the next stop (0.7 s), and `zoom` pulls back until both stops show, then pushes into the next (0.9 s). Inside a stop the push-in and the shot's `camera` beats move it. The header, the narrator, the captions, the progress bar, and the hero's flash stay where they are; the picture is clipped to the scene's region (the media region, or the whole frame for a card without a header), so a zoom never covers the captions or the narrator. The canvas's dots travel with the camera.

`video/direction.json` (optional, `schemaVersion: 1`, `covi schema direction`) directs the video shot by shot. Without one (in CI, in `--json` runs, or whenever the agent leaves a scene out), Covi's default director directs it, so every video moves the same way however it was made.

```json
{
  "schemaVersion": 1,
  "draft": false,
  "shots": [
    {
      "scene": "s3",
      "enter": "pan",
      "layout": "row",
      "elements": [
        { "id": "req", "kind": "code", "evidence": "diff-hunk:src/request.js:12", "side": "head" },
        { "id": "out", "kind": "output", "evidence": "terminal:1" },
        { "id": "note", "kind": "label", "text": "Ids only", "tone": "success" }
      ],
      "beats": [
        { "verb": "reveal", "element": "note", "style": "pop", "at": "only the ids" },
        { "verb": "camera", "move": "zoom", "to": "req", "at": "the request" }
      ]
    }
  ]
}
```

- **Shots.** At most one per storyboard scene, 24 at most; a scene without one gets the default director's. `enter` is how the scene enters: `pan` or `zoom`, or any storyboard transition. It shapes the timing exactly like a storyboard `transition`; nothing else in a direction moves a scene in time. `layout`: `auto` (the default), `single`, `row`, `column`, or `split`.
- **Elements** (1–8 a shot) take their content only from the run's evidence: `visual` (the scene's storyboard visual, drawn as without direction); `code` (a `diff-hunk:` id; `side` `head` (the default), `base`, or `diff`; `lines: [from, to]` within the side shown, at most 40; without it, the 14 lines richest in changes, 18 on tall frames); `output` (a `terminal:` id: a demo command's output at `head` or `base`, or the app's start-up log); `capture` (a `screenshot:` id); `node` (a short `label`, and up to four evidence ids it stands for); and `label` (`text`, with `tone` `neutral`, `warning`, or `success`). A shot without a `visual` element replaces the storyboard visual for that scene, and the scene's evidence is then what its elements cite.
- **Beats** (0–12 a shot): `place` (the element is there from the start: the default, made explicit); `reveal` (`style` `rise`, `pop`, `wipe`, or `type`); and `camera` (`move` `zoom`, `pan`, or `follow` toward an element; `zoom` 1–2.5, by default fitted). A beat's `at` quotes a phrase of the scene's narration that occurs exactly once, as a `sync` phrase does, and the beat lands as it is spoken; beats without one spread through the line from 15% of it. A camera beat aimed at the visual frames what the visual highlights then (its lines, its focus); `follow` frames its target the same way.
- **Labels** are the only text the agent writes: 1–32 characters of letters, marks, spaces, and `-–—·,.'’:()/&+?!`. No digits (numbers come from evidence), no markup, no links. They are redacted and drawn as text.
- **Checks.** `covi render` refuses (exit 2) a direction that names a scene the storyboard does not have, gives a scene two shots, cites evidence the run does not have or of the wrong kind, asks for a side the evidence lacks, quotes a phrase that is not in the line exactly once, or breaks a bound, and lists every problem at once. A file over 256 KB is refused before it is read.
- **Drafts.** `covi video --draft` writes Covi's direction beside the storyboard, with `"draft": true`. Rewrite it and set `"draft": false`: a direction still marked as Covi's draft is derived again at render from the storyboard as it is then, so a stale draft never blocks a render.
- **The default director** keeps every scene's visual, zooms a code scene 1.25× toward the lines it highlights as they light, and picks every entrance the storyboard left open: the hero zooms, a before/after wipes, a scene that shows what the one before it showed cuts, and the rest alternate pan and push. It reads what scenes show, never what they cite, so editing citations never moves a frame.
- **Off.** `video.direction: off` (`--direction off`, `COVI_VIDEO_DIRECTION=off`) draws the video as Covi 0.2 did: no canvas, no direction, and the storyboard's own transitions (a fade by default, zoom-through into the hero).
````

In `### Timing`, replace the transition lengths bullet with:

```markdown
- Transition lengths are the brand's `motion.transitions`: fade 0.45 s, cut 0, push 0.5 s, wipe 0.55 s, zoom-through 0.6 s, and the canvas camera's pan 0.7 s and zoom 0.9 s (only direction gives those; a scene before a zoom outlasts its line by up to 0.71 s). The first scene has none; the outro fades in over 0.45 s.
```

In `### Quality checks`, extend the sampling sentence ("Covi samples the layout checks at two frames per scene, 35% and 70% of the way through.") with: "On the canvas a frame reports only what lies inside the scene's region, as it is drawn."

- [ ] **Step 2: `docs/visual-system.md`**

Replace the `transitions` row of the motion table:

```markdown
| `transitions` | fade 0.45 s, cut 0, push 0.5 s, wipe 0.55 s, zoom-through 0.6 s, pan 0.7 s, zoom 0.9 s | Each scene transition's length. The storyboard's kinds stay under 0.625 s, so an ordinary scene ends at most 0.6 s after its line; the canvas camera's moves between stops take longer |
```

and add, after the **Transitions.** bullet of "How they move":

```markdown
- **The canvas.** Each story scene sits at its stop on one large canvas (`runtime/canvas.ts`, pure functions of the frame). `pan` glides the camera to the next stop and `zoom` pulls back until both stops show, then pushes in; both pictures stay fully opaque, and only the outgoing header fades. Inside a stop the push-in and the shot's camera beats move the camera; a beat frames its target (at most 2.5×) and never shows past the scene's region, which clips the picture so a zoom stays clear of the captions and the narrator. The dot grid moves with the camera and lines up with the stage's own at every stop. Without a canvas (`video.direction: off`), `pan` and `zoom` draw as `push` and `zoom-through`.
```

- [ ] **Step 3: `docs/artifacts.md`**

In the Video table, after the `video/storyboard.json` row:

```markdown
| `video/direction.json` | `storyboard` | How the video shows the storyboard, shot by shot: Covi's draft (`"draft": true`, written by `covi video --draft`) or the agent's. `covi render` reads it unless `video.direction` is `off`. See [Direction and the canvas](video.md#direction-and-the-canvas). |
```

and in the `video/timeline.json` row, after "the moments that carry a sound,", add "each story scene's stop on the canvas and its resolved shot (elements with their content and slots, beats with their moments),".

In "Files agents author", after the storyboard row:

```markdown
| `video/direction.json` in the run | `covi schema direction` | `covi render` (unless `video.direction` is `off`). At most 256 KB; elements show only evidence the run has, and labels are short text without digits; see [Direction and the canvas](video.md#direction-and-the-canvas). |
```

In "Schema versions", add `video/direction.json` to the list of files at 1 (after `video/storyboard.json`).

- [ ] **Step 4: `docs/security.md`**

After the `### The subject model` subsection:

```markdown
### The direction file

`video/direction.json` is agent input, and the agent read the repository, so Covi treats it like the repository: untrusted.

- **No code, styles, markup, or addresses.** Every object is strict (unknown keys fail), every choice an enum, every list, string, and number bounded (`DIRECTION_LIMITS`: 24 shots; 8 elements and 12 beats a shot; ids of at most 24 characters; phrases of at most 200; zoom 1–2.5; at most 40 code lines), and the file is at most 256 KB, sized before it is read.
- **Content only from evidence.** Code, output, and images come from the run's diff, its demo commands and start-up logs, and its screenshots, by evidence id; an id the run does not have, or of the wrong kind, is refused. An image can only be one of the run's own screenshots.
- **Labels from an allowlist.** The only text the agent writes is labels of at most 32 characters: letters, marks, spaces, and a little punctuation. No digits (so no made-up numbers), none of the characters markup and templates are made of (`<`, `>`, `{`, `}`, `[`, `]`, `"`, `=`, and the like), no control characters, and nothing containing `://`, starting with `www.`, or naming a `javascript:`, `vbscript:`, or `data:` scheme. Number words cannot be policed in code; the methodology forbids them.
- **Redacted, then drawn as text.** Everything a shot resolves to (code lines, output, labels) passes through the `Redactor` before it reaches `timeline.json` and the composition. The runtime sets text with `textContent`, and code lines go through the highlighter, which escapes them. `tests/direction-security.test.ts` renders hostile labels and checks that no element or script comes of them.
```

- [ ] **Step 5: `docs/configuration.md`**

In the `video` table, after the `outro` row:

```markdown
| `direction` | `auto`, `off` | `auto` | `auto`: draw the video on Covi's canvas, directed by the run's `video/direction.json` and Covi's default director (runs without an agent get the same motion). `off`: render as Covi 0.2 did, with no canvas. See [Direction and the canvas](video.md#direction-and-the-canvas). |
```

In the YAML example under it, add `  direction: auto   # auto | off` after `  outro: true`. In the environment variables table, after `COVI_OUTRO`:

```markdown
| `COVI_VIDEO_DIRECTION` | `video.direction`: `auto` or `off` |
```

- [ ] **Step 6: `AGENTS.md`**

- "Artifacts are the interface": the list of agent-authored inputs becomes "`explanation.json` and `findings.json` in the run, a demo plan passed with `--plan` (kept as `demo/plan.json`), `video/storyboard.json`, `video/direction.json`, and `video/score.json`", and the next sentence becomes "Findings, explanations, storyboard scenes, and direction elements cite evidence ids from `evidence.json`, which Covi derives from the run's own files."
- "Using the CLI as a tool": `covi schema <explanation|findings|storyboard|direction|score|demo-plan|config|evidence|subject|outcome>`.
- Run outputs tree: the `video/` line becomes `video/               decision.json, storyboard.json, direction.json (drafted, or the agent's), speech.json, timeline.json, narration.wav,`.
- "Changing workflows safely", Schemas: add `packages/video/src/direction/schema.ts` to the list of schema files.
- Security model, after the storyboard redaction bullet:

```markdown
- A direction file (`video/direction.json`; `packages/video/src/direction/`) is untrusted agent input: a strict, bounded schema (`DIRECTION_LIMITS`), content only from evidence ids the run has, labels from a character allowlist (no digits, markup, or links), everything resolved redacted, and text set with `textContent` in the runtime. Nothing in it is code, CSS, HTML, a selector, or a URL.
```

- [ ] **Step 7: `skills/covi-video/SKILL.md`**

In `## Run it`, after the paragraph that starts "Music never moves frames", add:

```markdown
**Direction.** Every video is drawn on Covi's canvas: each scene at its own stop, the camera panning and zooming between them. `covi video --draft` also writes `video/direction.json` (`"draft": true`): Covi's default direction, where every scene keeps its visual and gets an entrance. To direct a scene yourself (`covi schema direction`), give its shot elements from evidence ids only (`code` from a `diff-hunk:`, `output` from a `terminal:`, `capture` from a `screenshot:`), short labels without digits, and `reveal` or `camera` beats on phrases quoted from its narration; then set `"draft": false`, or Covi derives the draft again. `covi render` refuses a direction that does not fit the run and lists why. `--direction off` renders without the canvas.
```

In `## Output files`, add `video/direction.json` (Covi's draft direction, or yours) after `video/storyboard.json`.

- [ ] **Step 8: `CHANGELOG.md`**

Under `## [Unreleased]` (in its `### Added` list; add the heading if the section has none yet), one line:

```markdown
- Direction and the canvas: every video is drawn on one canvas whose camera pans and zooms between scene stops; an optional `video/direction.json` (`covi schema direction`) directs each scene with elements drawn only from evidence and `place`, `reveal`, and `camera` beats timed to its narration; Covi's default director gives runs without an agent the same motion; `video.direction: off` (`--direction off`) renders as 0.2.0 did.
```

- [ ] **Step 9: Run every check**

Run in the background and wait for each: `npm run check` (lint, typecheck, `agents:check`, `npm test`), then `npm run test:render`.
Expected: both PASS. If `npm run test:render` fails in a test this PR did not touch, check it against `main` before changing anything: a render test that fails on `main` too is not this PR's to fix, and the report says so.

- [ ] **Step 10: Commit**

```bash
git add docs AGENTS.md skills/covi-video/SKILL.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document direction and the canvas

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
## Self-review

Checked against the spec with fresh eyes, then fixed inline.

- **Spec coverage.** §4.1 shape → Task 2. §4.2 elements `visual`, `code`, `output`, `capture`, `node`, `label` → Tasks 2 (schema), 5 (content and slots), 9 (drawing); B3–B5 kinds are rejected until their PRs add them. §4.3 verbs `place`, `reveal`, `camera` (zoom, pan, follow) → Tasks 2, 5, 8, 9. §4.4 `DIRECTION_LIMITS` → Task 2. §4.5 labels → Task 2 (allowlist), 5 and 6 (redaction), 9 (text only). §4.6 validation (size, JSON, schema, references, evidence kinds, sides, lines, phrases, drafts not validated) → Tasks 2, 3, 6. §4.7 resolution and timing (content, slots, `at` → caption time, spaced beats from 0.15, redaction fallback, everything redacted, only `enter` touches timing) → Tasks 1, 5, 6. §4.8 default director (B2 parts: entrances, visual kept, camera beat where the visual has a target, never invents content) → Task 4. §4.9 `video.direction`, `--direction`, parity → Task 6. §5.1 stops → Task 5. §5.2 world layer, camera, screen-space overlays, viewport clip interpolated across a transition, push composed with beats, determinism → Tasks 7, 8. §5.3 `pan` 0.7 s, `zoom` 0.9 s in `motion.transitions`, default rotation, outro keeps `fade` → Tasks 1, 4. §14 and acceptance item 6 (`tests/direction-security.test.ts`) → Tasks 2, 3, 9; `docs/security.md` → Task 11. §3 module layout (`direction/schema|refs|resolve|director|stops|layout`, `runtime/canvas.ts`, `runtime/direction/elements.ts`) → Tasks 2–9, plus `sources.ts` and `plan.ts` for the evidence lookups and the pipeline's single entry point. §15 render tests (pan, zoom entrance, camera beat, determinism, `off` unchanged) → Task 8; benchmark → Task 10. The owner's scope list (AGENTS.md artifact list, `covi schema direction`, the security test, `off` = 0.2.0, storyboard schema unchanged, no `version` changes) → Tasks 2, 6, 8, 11.
- **Placeholders.** None: every code step carries its code; the B1-dependent steps name B1's planned functions and say what to do if the merged names differ.
- **Type consistency.** Names checked across tasks: `SceneStaging`/`SceneDirection`/`DirectionElement`/`DirectionBeat`/`Stop`/`CAMERA_TRANSITIONS` (Task 1); `DirectionSchema`/`Direction`/`Shot`/`ShotElement`/`ShotBeat`/`ShotLayout`/`DIRECTION_LIMITS`/`DIRECTION_PATH`/`DIRECTION_HINT`/`LabelSchema`/`readDirectionFile` (Task 2); `directionSources`/`DirectionSources`/`SourcesInput`/`hunkView` (Task 3); `defaultDirection`/`entrances`/`mergeDirection`/`CODE_ZOOM` (Task 4); `canvasStops`/`elementSlots`/`shotRegion`/`resolveDirection`/`directionImages`/`phraseMoment`/`gridSpacing` (Task 5); `planDirection` (Task 6); the canvas functions (Task 7); `shotSettledAt` (Task 8); `mountShot`/`ShotComponent` (Task 9); `leadKind` (Task 10).
- **Verification of the plan itself.** Tasks 1–9 and Task 10's density changes were applied to a scratch copy of the repository at aeef1fa (with B1's planned `density.ts` and `settledSpan` for Task 10), and every test in this plan passed there: the unit suites, `tests/examples.test.ts` with the director check over all five examples, the CLI tests, the canvas and security render tests, the existing `tests/render/render.test.ts` unchanged, and the four full-pipeline renders under `COVI_TEST_RENDER=1` (the two example renders and the every-component render under the default director, the timing-grammar render pinned to `--direction off`). An `api-users-pagination --standard` render showed the code scene zoomed toward its highlighted lines, the hero's zoom pulling back to both stops, and a pan between the findings and the summary. B1's code is not in that copy, so `drawnFont` in Task 9 and the B1 interplay were reasoned, not run.
- **Review Focus.** Each of the five lines has its test in the owning task (Tasks 6, 4, 5, 1, 8).

## Rulings

- Ruling: `place` takes no `at` (the schema rejects it) — the verb table defines `place` as "in place from the shot's start", so a phrase on it would mean nothing — an agent that writes one gets exit 2 with the path; "every beat may carry `at`" holds for every other verb.
- Ruling: labels also refuse the script-running schemes `javascript:`, `vbscript:`, and `data:`, besides `://` and `www.` — §14 requires `javascript:` to be rejected and the allowed characters can spell it — an honest label such as "Data: fresh" is refused.
- Ruling: labels keep the spec's exact punctuation, so CJK punctuation (、。・「」) is refused — the allowlist is the spec's (R-015) — Chinese and Japanese labels lose their punctuation; widening it later is a one-line change.
- Ruling: a shot names its scene with `^[a-z0-9-]{1,64}$` — storyboard ids have no length limit, but every string in the file must be bounded — a scene id longer than 64 characters cannot be directed and keeps the default director's shot.
- Ruling: `lines: [from, to]` index the lines of the side shown (head: context and added; base: context and deleted; diff: all) — "within the hunk" is ambiguous once a side drops lines — an agent counting raw hunk lines gets a different window or a clear "run past" error.
- Ruling: a code element without `lines` shows the 14 consecutive lines (18 on tall frames) richest in changes, earliest on a tie — B3's elision numbers, without its folding — long hunks lose their outer context until B3 elides properly.
- Ruling: an `output` element citing `terminal:app-start-<revision>` shows that log, titled with the item's label and with an empty command — the spec allows those ids and the log has no command line — its prompt line shows `$ ` with nothing typed.
- Ruling: slots weigh visual, code, output, and capture 3, node 2, label 1; `auto` is single (1), split (2), a row or a column on tall frames (3), a grid (4+), 28 units apart — deterministic, readable defaults the spec leaves open — B5/B7 may refine them; it is a data change.
- Ruling: in B2, `follow` frames its target like `zoom`; a camera beat aimed at the visual frames what its component highlights when the beat ends (`target()`, measured at mount), aimed at another element its drawn box — no element moves yet (morph and packet come in B3/B5) — B3/B5 must add per-frame following for moving targets.
- Ruling: the default director's only in-stop camera beats in B2 are on code scenes that highlight lines (1.25×, on the phrase that lights the first group, else spread) — captures already zoom their own frame to their marks and focus, and a stage zoom would compound it — fewer in-stop moves until B3–B5 add morphs, metrics, and flows.
- Ruling: the default director reads what scenes show (`sceneEvidence({ visual })`), never what they cite — the 0.2.0 sound test reuses frames after a citation edit, which needs the same entrances — two scenes an author cites as one subject but that show different evidence pan instead of cut.
- Ruling: the rotation's first pan-or-push comes from the seed's parity, and only a scene marked `hero: true` zooms (template hero beats change no entrance, as with zoom-through in 0.2.0) — different changes start differently while the same inputs repeat — none expected.
- Ruling: entrances are decided once, before fitting, like storyboard transitions (R-008); dropping an optional scene to fit does not recompute the rotation — one timing pass — two pans can end up adjacent after a drop.
- Ruling: `video.direction` is read from configuration at each command (flag, `COVI_VIDEO_DIRECTION`, files) and is not saved in `video/decision.json`'s spec — it is a rendering mode, not part of the requested video — `covi video --draft --direction off` followed by a plain `covi render` renders on the canvas unless `--direction off` is passed again.
- Ruling: the direction lives only in the run as `video/direction.json`, like the score, with no `--direction-file`; only `covi video --draft` writes it (R-006), never over an agent's file, and `covi render` never writes it — one place for agents to write, and a render never rewrites the agent's input — directing a storyboard kept elsewhere needs the file copied into the run.
- Ruling: `video/direction.json` is recorded with artifact kind `storyboard`, and the CLI result lists it as `artifacts.direction` — it is part of authoring the story, and a new `ArtifactKind` would ripple through core for no reader — `run.json` readers tell it apart by path, not kind.
- Ruling: `ProduceVideoInput.direction` defaults to `auto`, the configuration's default — one default for every entry point — library callers that render through the pipeline get the canvas unless they pass `off`.
- Ruling: the canvas is drawn per layer (each scene's media layer translated by its stop minus the camera, inside a clipping viewport in its own scene root) rather than as one world element — non-camera transitions keep 0.2.0's per-scene looks and z-order, and tests still find elements under `[data-scene]` — a world-level drawing (an edge between stops) would need a shared layer later.
- Ruling: only `pan` and `zoom` move the canvas camera; `push`, `wipe`, `cut`, `fade`, and `zoom-through` draw as in 0.2.0, each scene seen from its own stop — the storyboard's transitions keep their meaning — a push between two stops does not travel the canvas.
- Ruling: the outro has no stop and is drawn in screen space — it is not a story scene (§5.1), and the summary's fox handoff keeps its coordinates — none expected.
- Ruling: the canvas's dot grid moves with the camera, and stops sit on multiples of the grid spacing so rest frames match the stage's dots exactly — the canvas reads as one surface — the dots can shift by a fraction of a tile across a push or wipe between scenes whose push-in differs.
- Ruling: `pan` and `zoom` get the transition whoosh now (`WHOOSH`) — they are moving transitions like `push`; A2 adds in-stop camera beats, ticks, and thumps — default videos sound slightly different before A2 retunes effects.
- Ruling: on the canvas a layout report keeps only what lies inside the scene's clip (items clipped, fully hidden ones dropped) — what the clip hides is not drawn, and `captions-clear-of-content` fails a render — content overflowing its region is no longer reported over the captions, because it is not drawn there.
- Ruling: a zoom between stops pulls back to 92% of the scale at which both stops' media regions fit, on a sin² curve that peaks mid-move — "pull back to show both stops", with room around them — far-apart stops (a turn plus the hero's drop) look small at the middle of the move.
- Ruling: the timing-grammar full-pipeline render pins `--direction off`; every other existing render test runs unchanged (the every-component render passes under the default director) — that test asserts 0.2.0's defaults (zoom-through into the hero, the music lift 0.6 s in), which R-016 keeps under `off` — one existing test gains one flag.
- Ruling: a shot that shows the storyboard visual alone (`whole`) mounts the storyboard's component with the real regions, exactly as without direction — Covi's default direction then changes nothing but the camera and the entrances — none expected.
- Ruling: for monotony, a shot's lead element counts as the visual it looks like (code → code, output → terminal, capture → screenshot, node → diagram, label → callout), and `empty-frame` judges a shot by that kind too — the measured problem was six terminal-like cards in a row, whatever drew them — a label-led shot counts as a callout.
- Ruling: under a shot, a scene's evidence is its citations, plus its visual's when the shot keeps it, plus every id its elements cite that the run has — a replaced visual is not on screen — the contact sheet stops naming a replaced visual's capture.
- Ruling: a reveal takes 0.5 s and a camera beat 0.8 s; beats without `at` take evenly spaced slots from 15% of the line in file order, and resolved beats are sorted by time (stable) — the spec's "evenly spaced from 0.15", with lengths it leaves open — none expected.
- Ruling: validation messages are English literals like the storyboard's, and this PR adds no catalog keys — CLI-level text stays English (AGENTS.md), and nothing new is drawn on screen — none.
