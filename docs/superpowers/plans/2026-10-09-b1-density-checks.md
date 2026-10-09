# B1 Density and Monotony Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Video cards size their type to their content and fill the frame, QC warns on small text, empty frames, monotonous scenes, and monotonous transitions, and `examples/backend-slim-request/` becomes the benchmark change for B2–B7 and A2.

**Architecture:** One pure token module (`packages/video/src/runtime/sizing.ts`) holds the type floors, the code ceiling, and the 60% card fill; the browser runtime sizes every card with it and reports each layout item's drawn font and text class, and a new QC module (`packages/video/src/density.ts`) holds rendered frames to the same numbers. QC reads sizes and emptiness only at each story scene's settled frame (`settledSpan`/`settledFrame` in `timeline/cues.ts`), which the renderer now samples. The benchmark example is a small Node service whose own code computes the numbers its demo command prints.

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, no build), Vitest, Playwright Chromium (render tests), ffmpeg, Biome, Zod.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` (B1 is §8; also §2, §14–§18). Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-005, R-007).

**Worktree:** `~/projects/covi-direction`, branch `density-checks` (from `main` at aeef1fa, v0.2.0). All paths below are relative to it.

## Global Constraints

- TypeScript on Node 22.18+, run without a build: `.ts` import extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Video components (`packages/video/src/runtime/`): every visual property is a pure function of the frame time. No `Date`, no `Math.random`, no CSS transitions or animations. Text is set with `textContent`. `runtime/sizing.ts` is imported by both the runtime and Node QC, so it uses no DOM and no Node APIs.
- Thresholds are in design units: 1 unit = 1/1080 of the frame's short side (`computeRegions(timeline).unit` pixels). "24 px at 1080p" = 24 units.
- Code and terminal text: from 24 up to 44 units (landscape and square) / 48 units (vertical); a short block renders large. Cards grow to use the media region: centered, ≥ 60% of its area when content allows.
- QC, all `warn` (R-007): `text-size` (code < 24 or body < 28 units at a settled frame), `empty-frame` (settled content bounding box < 40% of the media region), `monotony` (more than 2 consecutive story scenes of the same lead kind; outro excluded), `transition-variety` (one kind > 60% of story transitions, only when there are ≥ 4).
- `LayoutItem` gains `font?: number` (px as drawn, the camera's scale included) and `text?: 'code' | 'body' | 'meta'` (meta = chips, file paths, small labels; exempt). Additive only; `frames.json` keeps `schemaVersion: 1`.
- Benchmark: `examples/backend-slim-request/` (R-005), with fixture documents and code written for Covi; its demo command `node scripts/measure.js` prints exactly `request bytes: <n>`, `chunks: <n>`, `reader steps: <n>`, `timeouts: <n>`, computed by the example's own code at each revision. Never copy anything from the private 0.2.0 reference render.
- Dependency direction unchanged (`brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`).
- QC messages are English, like every existing QC message. No new text drawn in videos, so no catalog keys.
- Never change any `version` field. CHANGELOG: one line under `## [Unreleased]`.
- Commits: default git identity, never Claude as author or co-author; every message is concise English and ends with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push.
- Long commands (full `npm test`, `npm run check`, `npm run test:render`, `covi video`) run in the background; wait for them to finish before reporting.
- Before each commit: `npx biome check --write <changed files>` then `npm run lint` and `npm run typecheck`.

## Review Focus

1. **16:9 frames.** The compose-based render tests all run at 360×640 (9:16). A short code block at 640×360 must reach the 44-unit ceiling and its card fill ≥ 60% of the media region, and QC must pass it. Pinned in Task 4 (the short-code test loops over both sizes).
2. **Korean text at the raised body sizes.** Callout bodies and finding notes now draw at 28/32 units, and Korean breaks only between words (`word-break: keep-all`). Korean cards must still fit (`text-fits` pass) and meet the floor. Pinned in Task 5 (the body-text test renders en and ko).
3. **Layout reports without the new fields.** A `frames.json` from a render before this change, or a caller passing its own `layoutFrames` with no settled frame, has reports with no `font` and no settled frame. The density checks must pass, say nothing was measured, and never throw. Pinned in Task 3.
4. **A scene too short to settle before the next one enters** (a terminal whose after-run prints late in a short scene). Its settled frame must still fall inside the scene, at the moment it starts to leave, and QC must read it there. Pinned in Task 1 (span and frame) and Task 2 (`text-size` reads it).
5. **Timelines whose scenes lack a transition kind** (written before kinds existed) and the outro's own fade. `transition-variety` counts a missing kind as a fade and never counts the outro. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/video/src/runtime/sizing.ts` (create) | Type floors, the code ceiling, the code fallback, the 60% card fill; `codeFont`, `cardHeight`. Pure, shared by the runtime and QC. |
| `packages/video/src/density.ts` (create) | The four QC checks and `densityChecks`, plus `leadKind` for B2 to extend. |
| `packages/video/test/density.test.ts` (create) | Unit tests for sizing, settled frames, and the four checks. |
| `packages/video/src/timeline/types.ts` | `LayoutItem.font`, `LayoutItem.text`. |
| `packages/video/src/timeline/cues.ts` | `settledSpan`, `settledFrame`. |
| `packages/video/src/render/renderer.ts` | `layoutSampleFrames`: the default layout samples plus one settled frame per story scene. |
| `packages/video/src/qc.ts`, `packages/video/src/index.ts` | Run and export the density checks. |
| `packages/video/src/runtime/components/types.ts` | `drawnFont`, `smallestFont`. |
| `packages/video/src/runtime/components/media.ts` | Code, terminal, API, findings, change map, callout, diagram: sizes, card fill, reported fonts and classes. |
| `packages/video/src/runtime/components/cards.ts`, `runtime/stage.ts`, `runtime/styles.ts` | Title and summary reports, the scene heading's floor, centered card content. |
| `tests/render/render.test.ts` | `compose` options, `settled` helper, render tests for sizes and fill, the benchmark in the full-pipeline list. |
| `examples/backend-slim-request/**` (create) | The benchmark change. |
| `tests/examples.test.ts`, `tests/cli.test.ts`, `tests/__snapshots__/english-baseline.test.ts.snap` | Six examples. |
| `docs/video.md`, `docs/getting-started.md`, `docs/contributing.md`, `README.md`, `skills/covi-video/SKILL.md`, `CHANGELOG.md` | Documentation. |

### Text classes, per component (what each layout item reports)

| Component | `code` | `body` | `meta` (exempt, not measured) |
|---|---|---|---|
| code | the lines | the caption (its own item) | file path and language in the head |
| terminal | command and output | — | the title bar label |
| api | request line, response bodies | — | panel titles, status badges |
| findings | — | finding title and note (one item per card, smallest of the two) | certainty and severity chips, the location path |
| callout | — | title and body (smallest) | the icon |
| diagram | — | node labels | node details, edge labels |
| change-map | — | area names | `+N −N` counts, surface chips |
| title (no capture) | — | the title | eyebrow chip, meta chips |
| summary | — | headline and points (smallest) | verdict badge, stat labels |
| scene header | — | the heading | the eyebrow |
| screenshot, interaction, before-after, title over a capture | — | — | glosses, step labels, before/after chips, browser URL |
| outro | not reported: Covi's own branded card, not a story scene | | |

Why: the floors protect what a viewer must read to follow the story. Chips, paths, counts, and edge labels are secondary by design and stay small so they stay out of the way; their fit is still checked by `text-fits`.

---

### Task 1: Sizing tokens, layout item fields, and settled frames

**Files:**
- Create: `packages/video/src/runtime/sizing.ts`
- Modify: `packages/video/src/timeline/types.ts:298-304` (`LayoutItem`)
- Modify: `packages/video/src/timeline/cues.ts` (imports; add after `settledAt`, which ends at line 613)
- Modify: `packages/video/src/render/renderer.ts:7-14` (imports), `:128-152` (add `layoutSampleFrames` after `contactSheetFrames`), `:262-269` (default layout frames)
- Test: `packages/video/test/density.test.ts` (create)

**Interfaces:**
- Consumes: `settledAt(visual, duration, phases)` (existing, `timeline/cues.ts`); `Timeline`, `TimelineScene`, `Rect` (existing types).
- Produces:
  - `packages/video/src/runtime/sizing.ts`: `TEXT_FLOOR: { readonly code: 24; readonly body: 28 }`, `CODE_FALLBACK = 13`, `CARD_FILL = 0.6`, `codeCeiling(orientation: Timeline['orientation']): number` (48 vertical, else 44), `codeFont(fit: number, orientation: Timeline['orientation'], unit: number): number` (px), `cardHeight(region: Rect, width: number, content: number): number` (px).
  - `LayoutItem.font?: number`, `LayoutItem.text?: 'code' | 'body' | 'meta'`.
  - `timeline/cues.ts`: `settledSpan(timeline: Pick<Timeline, 'scenes' | 'transition'>, index: number): Span | undefined` (absolute seconds), `settledFrame(timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'frames'>, index: number): number | undefined`.
  - `render/renderer.ts`: `layoutSampleFrames(timeline: Pick<Timeline, 'fps' | 'frames' | 'scenes' | 'transition'>): number[]` (sorted).

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/density.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutSampleFrames } from '../src/render/renderer.ts';
import {
  CARD_FILL,
  CODE_FALLBACK,
  cardHeight,
  codeCeiling,
  codeFont,
  TEXT_FLOOR,
} from '../src/runtime/sizing.ts';
import { settledAt, settledFrame, settledSpan } from '../src/timeline/cues.ts';
import type {
  SceneTransition,
  Timeline,
  TimelineScene,
  TimelineVisual,
} from '../src/timeline/types.ts';

const code: TimelineVisual = {
  kind: 'code',
  path: 'a.js',
  lines: [{ type: 'add', text: 'x' }],
  highlight: [],
};
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const terminal: TimelineVisual = {
  kind: 'terminal',
  command: 'node scripts/measure.js',
  before: 'chunks: 4',
  output: 'chunks: 1',
};

function scene(
  id: string,
  start: number,
  end: number,
  visual: TimelineVisual,
  transition?: SceneTransition,
): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
    ...(transition ? { transition } : {}),
  };
}

/** A timeline of these scenes at 30 fps, `width` × `height`. */
function video(width: number, height: number, scenes: TimelineScene[]): Timeline {
  return {
    width,
    height,
    fps: 30,
    frames: Math.ceil(scenes.at(-1)!.end * 30),
    transition: 0.45,
    orientation: width > height ? 'landscape' : width < height ? 'vertical' : 'square',
    scenes,
  } as Timeline;
}

describe('type and card sizes', () => {
  it('grow code to the ceiling when it fits, and below the floor only when it must', () => {
    expect(TEXT_FLOOR).toEqual({ code: 24, body: 28 });
    expect(codeCeiling('landscape')).toBe(44);
    expect(codeCeiling('square')).toBe(44);
    expect(codeCeiling('vertical')).toBe(48);
    expect(codeFont(100, 'landscape', 1)).toBe(44);
    expect(codeFont(100, 'vertical', 2)).toBe(96);
    expect(codeFont(30, 'landscape', 1)).toBe(30);
    expect(codeFont(10, 'landscape', 1)).toBe(CODE_FALLBACK);
  });

  it('grow a short card until it fills 60% of the region, never past the region', () => {
    const region = { x: 0, y: 0, width: 1000, height: 500 };
    expect(CARD_FILL).toBe(0.6);
    expect(cardHeight(region, 1000, 100)).toBeCloseTo(300, 9);
    expect(cardHeight(region, 1000, 420)).toBe(420);
    // Half as wide, it would need 600 to cover 60%: the region has 500.
    expect(cardHeight(region, 500, 100)).toBe(500);
    expect(cardHeight(region, 1000, 900)).toBe(500);
  });
});

describe('settled frames', () => {
  const t = video(1920, 1080, [
    scene('s1', 0, 4, code),
    scene('s2', 3.5, 8, callout, { kind: 'push', seconds: 0.5 }),
    scene('s3', 8, 10, callout, { kind: 'cut', seconds: 0 }),
    scene('covi:outro', 9.55, 12, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
  ]);

  it('start once the entrance and the choreography are done, and end where the next scene enters', () => {
    expect(settledSpan(t, 0)).toEqual([settledAt(code, 4), 3.5]);
    const [from, to] = settledSpan(t, 1)!;
    expect(from).toBeCloseTo(3.5 + 0.6, 9);
    expect(to).toBe(8);
    expect(settledSpan(t, 2)).toEqual([8.6, 9.55]);
    expect(settledSpan(t, 9)).toBeUndefined();
    expect(settledFrame(t, 1)).toBe(123);
    expect(settledFrame(t, 2)).toBe(258);
  });

  it('fall back to the moment a scene starts to leave when it is too short to settle', () => {
    const short = video(1920, 1080, [
      scene('s1', 0, 4, callout),
      scene('s2', 3.5, 6, terminal, { kind: 'push', seconds: 0.5 }),
      scene('s3', 5.55, 9, callout, { kind: 'fade', seconds: 0.45 }),
    ]);
    // The after run prints 2.25 s in; s2 has 2.05 s before s3 fades in.
    expect(settledAt(terminal, 2.5)).toBeCloseTo(2.25, 9);
    const [from, to] = settledSpan(short, 1)!;
    expect(from).toBeCloseTo(5.55, 9);
    expect(to).toBeCloseTo(5.55, 9);
    // The last frame before s3 enters, still inside s2.
    expect(settledFrame(short, 1)).toBe(166);
  });

  it('are sampled for every story scene, beside 35% and 70% of every scene', () => {
    const frames = layoutSampleFrames(t);
    for (const i of [0, 1, 2]) expect(frames).toContain(settledFrame(t, i));
    // The outro is Covi's own card: sampled at 35% and 70% only.
    expect(frames).not.toContain(settledFrame(t, 3));
    expect(frames).toContain(Math.round((3.5 + 4.5 * 0.35) * 30));
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/density.test.ts`
Expected: FAIL: `Failed to load url ../src/runtime/sizing.ts` (or `layoutSampleFrames is not exported`).

- [ ] **Step 3: Create `packages/video/src/runtime/sizing.ts`**

```ts
import type { Rect, Timeline } from '../timeline/types.ts';

/*
 * How large text and cards are drawn, in design units (1/1080 of the frame's short side). The
 * runtime sizes cards with these, and QC holds the rendered frames to the same numbers. No DOM and
 * no Node APIs: the runtime bundles this file and Node QC imports it.
 */

/** The smallest text a viewer reads comfortably at 1080p: code and terminal text, and body text. */
export const TEXT_FLOOR = { code: 24, body: 28 } as const;

/**
 * Code too long or too tall to fit at the floor shrinks to this rather than being cut off (the
 * smallest terminal text 0.2.0 drew); QC's `text-size` then names the scene.
 */
export const CODE_FALLBACK = 13;

/** A card covers at least this share of the media region; short content sits in its middle. */
export const CARD_FILL = 0.6;

/** Code and terminal text grow to this when the block is short: a short block renders large. */
export function codeCeiling(orientation: Timeline['orientation']): number {
  return orientation === 'vertical' ? 48 : 44;
}

/** Code or terminal text in pixels: the size that fits, between the fallback and the ceiling. */
export function codeFont(fit: number, orientation: Timeline['orientation'], unit: number): number {
  return Math.min(codeCeiling(orientation) * unit, Math.max(CODE_FALLBACK * unit, fit));
}

/**
 * A card's height in `region`: its content's, grown until a card `width` wide covers CARD_FILL of
 * the region, and never taller than the region.
 */
export function cardHeight(region: Rect, width: number, content: number): number {
  const fill = (CARD_FILL * region.width * region.height) / Math.max(1, width);
  return Math.min(region.height, Math.max(content, fill));
}
```

- [ ] **Step 4: Add the layout item fields**

In `packages/video/src/timeline/types.ts`, replace:

```ts
/** Boxes reported by the runtime at sampled frames, used by QC. */
export interface LayoutItem {
  role: 'media' | 'text' | 'focus';
  rect: Rect;
  /** Text that does not fit its box. */
  overflow?: boolean;
}
```

with:

```ts
/** Boxes reported by the runtime at sampled frames, used by QC. */
export interface LayoutItem {
  role: 'media' | 'text' | 'focus';
  rect: Rect;
  /** Text that does not fit its box. */
  overflow?: boolean;
  /**
   * The size of the item's smallest text that QC holds to a floor, in stage pixels as drawn (the
   * camera's scale included). Absent: the item has no such text.
   */
  font?: number;
  /**
   * What that text is: `code` (code, terminal output, request lines and response bodies), `body`
   * (headings, titles, notes, labels a viewer must read), or `meta` (chips, file paths, small
   * labels), which QC does not hold to a floor.
   */
  text?: 'code' | 'body' | 'meta';
}
```

- [ ] **Step 5: Add `settledSpan` and `settledFrame` to `packages/video/src/timeline/cues.ts`**

Add `type Timeline,` to the import block from `./types.ts` (keep it sorted: after `type HighlightGroup,`). Then insert after the closing brace of `settledAt` (before `/** The summary's verdict badge rises into view. */`):

```ts
/**
 * When scene `index` has settled and is alone on screen, in seconds from the start of the video:
 * from the end of its entrance and its choreography to where the next scene starts to enter. A
 * scene too short to settle before it leaves gives the moment it starts to leave.
 */
export function settledSpan(
  timeline: Pick<Timeline, 'scenes' | 'transition'>,
  index: number,
): Span | undefined {
  const scene = timeline.scenes[index];
  if (!scene) return undefined;
  const enter = index === 0 ? 0 : (scene.transition?.seconds ?? timeline.transition);
  const next = timeline.scenes[index + 1];
  const leave = next ? (next.transition?.seconds ?? timeline.transition) : 0;
  const to = scene.end - leave;
  const done =
    scene.start + Math.max(enter, settledAt(scene.visual, scene.end - scene.start, scene.phases));
  return [Math.min(done, to), to];
}

/**
 * The frame QC reads a settled scene at: the first frame of its settled span, or, when the span is
 * shorter than a frame, the last frame before the next scene enters (at its very end, the next
 * scene is the one on screen).
 */
export function settledFrame(
  timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'frames'>,
  index: number,
): number | undefined {
  const span = settledSpan(timeline, index);
  if (!span) return undefined;
  const first = Math.ceil(span[0] * timeline.fps - 1e-6);
  const last = Math.floor(span[1] * timeline.fps - 1e-6);
  return Math.max(0, Math.min(timeline.frames - 1, first, last));
}
```

- [ ] **Step 6: Sample the settled frames in the renderer**

In `packages/video/src/render/renderer.ts`, add an import after the `../timeline/types.ts` import block:

```ts
import { settledFrame } from '../timeline/cues.ts';
```

Insert after `contactSheetFrames` (after its closing brace, before `/** Contact sheet columns: …`):

```ts
/**
 * Frames the layout checks read: 35% and 70% of the way through every scene, and the frame where
 * each story scene has settled, at which QC measures text sizes and how much of the frame the
 * content fills. The outro is Covi's own card, so it is not held to those checks.
 */
export function layoutSampleFrames(
  timeline: Pick<Timeline, 'fps' | 'frames' | 'scenes' | 'transition'>,
): number[] {
  const last = Math.max(0, timeline.frames - 1);
  const frames = new Set(
    timeline.scenes.flatMap((s) =>
      [0.35, 0.7].map((k) =>
        Math.min(last, Math.round((s.start + (s.end - s.start) * k) * timeline.fps)),
      ),
    ),
  );
  timeline.scenes.forEach((s, i) => {
    if (s.visual.kind === 'outro') return;
    const frame = settledFrame(timeline, i);
    if (frame !== undefined) frames.add(frame);
  });
  return [...frames].sort((a, b) => a - b);
}
```

In `renderComposition`, replace:

```ts
  const layoutFrames = new Set(
    options.layoutFrames ??
      timeline.scenes.flatMap((s) =>
        [0.35, 0.7].map((k) =>
          Math.min(total - 1, Math.round((s.start + (s.end - s.start) * k) * timeline.fps)),
        ),
      ),
  );
```

with:

```ts
  const layoutFrames = new Set(options.layoutFrames ?? layoutSampleFrames(timeline));
```

Also update the `layoutFrames` option's doc comment in `RenderOptions` to: `/** Frames to sample for layout QC (defaults to \`layoutSampleFrames\`). */`

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/density.test.ts packages/video/test/cues.test.ts packages/video/test/sheet.test.ts`
Expected: PASS (all).

Run: `npm run typecheck`
Expected: exit 0 (the runtime config compiles `sizing.ts` too).

- [ ] **Step 8: Commit**

```bash
npx biome check --write packages/video/src/runtime/sizing.ts packages/video/src/timeline packages/video/src/render/renderer.ts packages/video/test/density.test.ts
npm run lint
git add packages/video/src/runtime/sizing.ts packages/video/src/timeline/types.ts packages/video/src/timeline/cues.ts packages/video/src/render/renderer.ts packages/video/test/density.test.ts
git commit -m "$(cat <<'EOF'
Sample every story scene where it has settled for layout QC

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 2: The `text-size` and `empty-frame` checks

**Files:**
- Create: `packages/video/src/density.ts`
- Modify: `packages/video/src/index.ts` (export block after the `./qc.ts` exports)
- Test: `packages/video/test/density.test.ts` (imports; append two `describe` blocks)

**Interfaces:**
- Consumes: `TEXT_FLOOR` (Task 1, `runtime/sizing.ts`); `settledSpan`, `settledFrame` (Task 1, `timeline/cues.ts`); `computeRegions` (existing, `runtime/layout.ts`); `QcCheck` (existing, `qc.ts`).
- Produces (in `packages/video/src/density.ts`, exported from `@covi/video`):
  - `type DensityTimeline = Pick<Timeline, 'scenes' | 'transition' | 'fps' | 'width' | 'height' | 'orientation'>`
  - `EMPTY_SHARE = 0.4`
  - `textSizeCheck(timeline: DensityTimeline, layouts: readonly LayoutReport[]): QcCheck` (id `text-size`)
  - `emptyFrameCheck(timeline: DensityTimeline, layouts: readonly LayoutReport[]): QcCheck` (id `empty-frame`)

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/density.test.ts`, replace the import block with:

```ts
import { describe, expect, it } from 'vitest';
import { emptyFrameCheck, textSizeCheck } from '../src/density.ts';
import { layoutSampleFrames } from '../src/render/renderer.ts';
import {
  CARD_FILL,
  CODE_FALLBACK,
  cardHeight,
  codeCeiling,
  codeFont,
  TEXT_FLOOR,
} from '../src/runtime/sizing.ts';
import { settledAt, settledFrame, settledSpan } from '../src/timeline/cues.ts';
import type {
  LayoutItem,
  LayoutReport,
  SceneTransition,
  Timeline,
  TimelineScene,
  TimelineVisual,
} from '../src/timeline/types.ts';
```

Append after the `settled frames` describe block:

```ts
const findings: TimelineVisual = {
  kind: 'findings',
  findings: [{ title: 'F', certainty: 'risk', severity: 'low' }],
};

/** A code scene, a findings scene that pushes in, and the outro, at `width` × `height`. */
const story = (width = 1920, height = 1080) =>
  video(width, height, [
    scene('s1', 0, 4, code),
    scene('s2', 3.5, 8, findings, { kind: 'push', seconds: 0.5 }),
    scene('covi:outro', 7.55, 10, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
  ]);
const at = (t: Timeline, id: string) => settledFrame(t, t.scenes.findIndex((s) => s.id === id))!;
const report = (frame: number, scene: string, items: LayoutItem[]): LayoutReport => ({
  frame,
  scene,
  items,
  imagesLoaded: true,
});
/** A band across the landscape media region at 1080p (1728 × 662 from 96, 206), `height` tall. */
const band = (height: number) => ({ x: 96, y: 206 + (662 - height) / 2, width: 1728, height });
const codeAt = (font: number, rect = band(420)): LayoutItem => ({
  role: 'media',
  rect,
  font,
  text: 'code',
});
const bodyAt = (font: number): LayoutItem => ({ role: 'text', rect: band(420), font, text: 'body' });

describe('the text-size check', () => {
  it('passes code at 24 px and body text at 28 px at 1080p, and names smaller text', () => {
    const t = story();
    const ok = textSizeCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(24)]),
      report(at(t, 's2'), 's2', [bodyAt(28)]),
    ]);
    expect(ok).toMatchObject({ id: 'text-size', status: 'pass' });
    const small = textSizeCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(19)]),
      report(at(t, 's2'), 's2', [bodyAt(23)]),
    ]);
    expect(small.status).toBe('warn');
    expect(small.message).toMatch(/code at 19 px in s1/);
    expect(small.message).toMatch(/body at 23 px in s2/);
  });

  it('measures against the frame’s short side', () => {
    // At 4K a design unit is 2 px; at 360 × 640 it is a third of one.
    const k4 = story(3840, 2160);
    expect(textSizeCheck(k4, [report(at(k4, 's1'), 's1', [codeAt(40)])]).status).toBe('warn');
    expect(textSizeCheck(k4, [report(at(k4, 's1'), 's1', [codeAt(48)])]).status).toBe('pass');
    const phone = story(360, 640);
    expect(textSizeCheck(phone, [report(at(phone, 's1'), 's1', [codeAt(8)])]).status).toBe('pass');
    expect(textSizeCheck(phone, [report(at(phone, 's1'), 's1', [codeAt(7)])]).status).toBe('warn');
  });

  it('reads settled frames of story scenes only, and never holds chips or paths to a floor', () => {
    const t = story();
    const tiny = codeAt(6);
    const check = textSizeCheck(t, [
      // Still entering.
      report(3, 's1', [tiny]),
      report(at(t, 's1'), 's1', [{ ...tiny, text: 'meta' }, { role: 'media', rect: tiny.rect }]),
      report(280, 'covi:outro', [tiny]),
    ]);
    expect(check.status).toBe('pass');
  });

  it('reads a scene too short to settle at the moment it starts to leave', () => {
    const t = video(1920, 1080, [
      scene('s1', 0, 4, callout),
      scene('s2', 3.5, 6, terminal, { kind: 'push', seconds: 0.5 }),
      scene('s3', 5.55, 9, callout, { kind: 'fade', seconds: 0.45 }),
    ]);
    const check = textSizeCheck(t, [report(166, 's2', [codeAt(10)])]);
    expect(check.status).toBe('warn');
    expect(check.message).toMatch(/in s2/);
  });
});

describe('the empty-frame check', () => {
  it('warns when a card scene’s content covers under 40% of the media region', () => {
    const t = story();
    const thin = emptyFrameCheck(t, [report(at(t, 's1'), 's1', [codeAt(44, band(180))])]);
    expect(thin).toMatchObject({ id: 'empty-frame', status: 'warn' });
    expect(thin.message).toMatch(/s1 \(27%\)/);
    const full = emptyFrameCheck(t, [report(at(t, 's1'), 's1', [codeAt(44, band(400))])]);
    expect(full.status).toBe('pass');
  });

  it('counts only content inside the media region, at the fullest settled frame', () => {
    const t = story();
    const heading: LayoutItem = {
      role: 'text',
      rect: { x: 96, y: 74, width: 900, height: 110 },
      font: 42,
      text: 'body',
    };
    // The header's heading sits above the region: it does not stretch the content's box.
    const withHeading = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [heading, codeAt(44, band(180))]),
    ]);
    expect(withHeading.status).toBe('warn');
    // One settled frame where the content fills the frame is enough (90 is 3 s in, still settled).
    const later = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [codeAt(44, band(180))]),
      report(90, 's1', [codeAt(44, band(420))]),
    ]);
    expect(later.status).toBe('pass');
  });

  it('leaves captures and the title and summary cards to their own layout', () => {
    const t = video(1920, 1080, [
      scene('s1', 0, 4, {
        kind: 'screenshot',
        image: { src: 'a.png', width: 390, height: 844 },
        device: 'mobile',
      }),
      scene(
        's2',
        3.5,
        8,
        { kind: 'summary', verdict: 'looks-good', headline: 'H', points: [] },
        { kind: 'push', seconds: 0.5 },
      ),
    ]);
    // A phone capture in a landscape frame is narrow by its aspect ratio, not by choice.
    const narrow: LayoutItem = { role: 'media', rect: { x: 807, y: 206, width: 306, height: 662 } };
    const check = emptyFrameCheck(t, [
      report(at(t, 's1'), 's1', [narrow]),
      report(at(t, 's2'), 's2', [narrow]),
    ]);
    expect(check.status).toBe('pass');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/density.test.ts`
Expected: FAIL: `Failed to load url ../src/density.ts`.

- [ ] **Step 3: Create `packages/video/src/density.ts`**

```ts
import type { QcCheck } from './qc.ts';
import { computeRegions } from './runtime/layout.ts';
import { TEXT_FLOOR } from './runtime/sizing.ts';
import { settledSpan } from './timeline/cues.ts';
import type { LayoutReport, Rect, Timeline, TimelineScene } from './timeline/types.ts';

/*
 * Density checks on the rendered layout: is the text large enough to read, and does the content
 * use the frame. They warn rather than fail: they judge taste, not broken output (R-007).
 */

/** What the density checks read of a timeline. */
export type DensityTimeline = Pick<
  Timeline,
  'scenes' | 'transition' | 'fps' | 'width' | 'height' | 'orientation'
>;

/** Text this far under its floor, in design units, still passes: drawn sizes carry rounding. */
const SIZE_TOLERANCE = 0.5;

/** A card scene whose content covers less of the media region than this reads as empty. */
export const EMPTY_SHARE = 0.4;

/**
 * Visuals whose size the runtime chooses, which the empty-frame check holds to the frame. A
 * capture keeps its image's aspect ratio, and title and summary cards are laid out around the fox.
 */
const CARDS: ReadonlySet<TimelineScene['visual']['kind']> = new Set([
  'code',
  'terminal',
  'api',
  'findings',
  'change-map',
  'callout',
  'diagram',
]);

const percent = (share: number) => `${Math.round(100 * share)}%`;

/** Reports sampled while a story scene had settled and was alone on screen. */
function settledReports(
  timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps'>,
  layouts: readonly LayoutReport[],
): Array<{ scene: TimelineScene; report: LayoutReport }> {
  const out: Array<{ scene: TimelineScene; report: LayoutReport }> = [];
  for (const report of layouts) {
    const index = timeline.scenes.findIndex((s) => s.id === report.scene);
    const scene = timeline.scenes[index];
    if (!scene || scene.visual.kind === 'outro') continue;
    const [from, to] = settledSpan(timeline, index)!;
    const t = report.frame / timeline.fps;
    // A span shorter than a frame is read at the frame just before it.
    if (t >= from - 1 / timeline.fps - 1e-6 && t <= to + 1e-6) out.push({ scene, report });
  }
  return out;
}

/**
 * Code and terminal text at least 24 px and body text at least 28 px at 1080p, as drawn at the
 * settled frames, relative to the frame's short side. Chips, file paths, and small labels are
 * exempt.
 */
export function textSizeCheck(
  timeline: DensityTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const { unit } = computeRegions(timeline);
  let measured = 0;
  // The smallest text of each kind in each scene, in design units.
  const small = new Map<string, { scene: string; text: 'code' | 'body'; size: number }>();
  for (const { scene, report } of settledReports(timeline, layouts)) {
    for (const item of report.items) {
      if (item.font === undefined || (item.text !== 'code' && item.text !== 'body')) continue;
      measured++;
      const size = item.font / unit;
      if (size >= TEXT_FLOOR[item.text] - SIZE_TOLERANCE) continue;
      const key = `${scene.id} ${item.text}`;
      const seen = small.get(key);
      if (!seen || size < seen.size) small.set(key, { scene: scene.id, text: item.text, size });
    }
  }
  if (!small.size)
    return {
      id: 'text-size',
      status: 'pass',
      message: measured
        ? `Code is at least ${TEXT_FLOOR.code} px and body text at least ${TEXT_FLOOR.body} px at 1080p wherever a scene has settled.`
        : 'No code or body text was measured at a settled frame.',
    };
  const list = [...small.values()];
  return {
    id: 'text-size',
    status: 'warn',
    message: `Text is too small to read at 1080p: ${list
      .slice(0, 3)
      .map((s) => `${s.text} at ${Math.round(s.size)} px in ${s.scene}`)
      .join(', ')}${list.length > 3 ? ', …' : ''} (code at least ${TEXT_FLOOR.code} px, body at least ${TEXT_FLOOR.body} px). Show fewer or shorter lines, or split the scene.`,
  };
}

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);

/** The part of `a` inside `b`, if any. */
function clip(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Every card scene's content (the boxes it reports inside the media region, together) covers at
 * least 40% of the media region at its fullest settled frame. Captures, title and summary cards,
 * and the outro are not checked.
 */
export function emptyFrameCheck(
  timeline: DensityTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const media = computeRegions(timeline).media;
  const best = new Map<string, number>();
  for (const { scene, report } of settledReports(timeline, layouts)) {
    if (!CARDS.has(scene.visual.kind)) continue;
    // Boxes mostly inside the region: the header's heading above it is not content.
    const inside = report.items.flatMap((item) => {
      const part = clip(item.rect, media);
      return part && area(part) >= 0.5 * area(item.rect) ? [part] : [];
    });
    const share = inside.length ? area(union(inside)) / area(media) : 0;
    best.set(scene.id, Math.max(best.get(scene.id) ?? 0, share));
  }
  const empty = [...best].filter(([, share]) => share < EMPTY_SHARE - 1e-9);
  if (!empty.length)
    return {
      id: 'empty-frame',
      status: 'pass',
      message: best.size
        ? `Every card scene's content fills at least ${percent(EMPTY_SHARE)} of the media region.`
        : 'No card scene was measured at a settled frame.',
    };
  return {
    id: 'empty-frame',
    status: 'warn',
    message: `Content fills little of the frame in ${empty
      .slice(0, 3)
      .map(([id, share]) => `${id} (${percent(share)})`)
      .join(', ')}${empty.length > 3 ? ', …' : ''}; at least ${percent(EMPTY_SHARE)} of the media region wanted. Show more of the subject in the scene, or merge it with the next.`,
  };
}
```

- [ ] **Step 4: Export the checks**

In `packages/video/src/index.ts`, add after the `} from './qc.ts';` export block:

```ts
export {
  type DensityTimeline,
  EMPTY_SHARE,
  emptyFrameCheck,
  textSizeCheck,
} from './density.ts';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/density.test.ts`
Expected: PASS (all describes).

- [ ] **Step 6: Commit**

```bash
npx biome check --write packages/video/src/density.ts packages/video/src/index.ts packages/video/test/density.test.ts
npm run lint && npm run typecheck
git add packages/video/src/density.ts packages/video/src/index.ts packages/video/test/density.test.ts
git commit -m "$(cat <<'EOF'
Warn on text too small to read and on empty frames

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 3: The `monotony` and `transition-variety` checks, in every QC report

**Files:**
- Modify: `packages/video/src/density.ts` (imports; append)
- Modify: `packages/video/src/qc.ts:1-10` (import), `:823-827` (`runQc`)
- Modify: `packages/video/src/index.ts` (the `./density.ts` export block)
- Modify: `tests/render/render.test.ts:140-148` (the first render test)
- Test: `packages/video/test/density.test.ts`

**Interfaces:**
- Consumes: `textSizeCheck`, `emptyFrameCheck`, `DensityTimeline` (Task 2); `storyScenes` (existing, `timeline/build.ts`).
- Produces (in `packages/video/src/density.ts`, exported from `@covi/video`):
  - `MAX_RUN = 2`, `TRANSITION_SHARE = 0.6`, `TRANSITION_MIN = 4`
  - `leadKind(scene: Pick<TimelineScene, 'visual'>): string` (B2 refines it with direction shots)
  - `monotonyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck` (id `monotony`)
  - `transitionVarietyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck` (id `transition-variety`)
  - `densityChecks(timeline: DensityTimeline, layouts: readonly LayoutReport[]): QcCheck[]` → ids in order `text-size`, `empty-frame`, `monotony`, `transition-variety`
  - `runQc` includes them after `layoutChecks`.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/density.test.ts`, change the density import to:

```ts
import {
  densityChecks,
  emptyFrameCheck,
  monotonyCheck,
  textSizeCheck,
  transitionVarietyCheck,
} from '../src/density.ts';
```

and add `TransitionKind,` to the type import from `../src/timeline/types.ts` (after `TimelineVisual,`). Append:

```ts
describe('the monotony check', () => {
  const summary: TimelineVisual = {
    kind: 'summary',
    verdict: 'looks-good',
    headline: 'H',
    points: [],
  };
  /** Story scenes of these visuals, three seconds each, then the outro. */
  const kinds = (...visuals: TimelineVisual[]) =>
    ({
      scenes: [
        ...visuals.map((v, i) => scene(`s${i + 1}`, i * 3, i * 3 + 3, v)),
        scene('covi:outro', visuals.length * 3, visuals.length * 3 + 2, { kind: 'outro' }),
      ],
    }) as Pick<Timeline, 'scenes'>;

  it('warns at three scenes of one kind in a row, naming them', () => {
    const check = monotonyCheck(kinds(code, code, code, callout));
    expect(check).toMatchObject({ id: 'monotony', status: 'warn' });
    expect(check.message).toMatch(/3 code scenes in a row \(s1–s3\)/);
  });

  it('passes two of a kind with something else between them', () => {
    expect(monotonyCheck(kinds(code, code, callout, code, code)).status).toBe('pass');
    expect(monotonyCheck(kinds(callout, summary, summary)).status).toBe('pass');
  });

  it('compares visual kinds exactly', () => {
    expect(monotonyCheck(kinds(code, terminal, code, terminal)).status).toBe('pass');
  });
});

describe('the transition-variety check', () => {
  /** A first scene, then one entering with each kind (none: a timeline from before kinds). */
  const entering = (...list: Array<TransitionKind | undefined>) =>
    ({
      scenes: [
        scene('s0', 0, 3, callout),
        ...list.map((kind, i) =>
          scene(
            `s${i + 1}`,
            (i + 1) * 3,
            (i + 1) * 3 + 3,
            callout,
            kind ? { kind, seconds: 0.45 } : undefined,
          ),
        ),
        scene('covi:outro', 30, 32, { kind: 'outro' }, { kind: 'fade', seconds: 0.45 }),
      ],
    }) as Pick<Timeline, 'scenes'>;

  it('warns when one kind covers more than 60% of four or more story transitions', () => {
    const check = transitionVarietyCheck(entering('fade', 'fade', 'fade', 'push'));
    expect(check).toMatchObject({ id: 'transition-variety', status: 'warn' });
    expect(check.message).toMatch(/3 of 4 story transitions are fade \(75%\)/);
  });

  it('passes at 60%, and below four transitions', () => {
    expect(transitionVarietyCheck(entering('fade', 'fade', 'fade', 'push', 'cut')).status).toBe(
      'pass',
    );
    const few = transitionVarietyCheck(entering('fade', 'fade', 'fade'));
    expect(few.status).toBe('pass');
    // The outro's fade is not a story transition: three, not four.
    expect(few.message).toMatch(/^3 story transition/);
  });

  it('counts a scene without a kind as a fade', () => {
    expect(transitionVarietyCheck(entering(undefined, undefined, 'push', 'cut')).status).toBe(
      'pass',
    );
    expect(transitionVarietyCheck(entering(undefined, undefined, undefined, 'push')).status).toBe(
      'warn',
    );
  });
});

describe('the density checks', () => {
  it('run in order, and pass quietly on reports that measured nothing', () => {
    const t = story();
    const ids = densityChecks(t, []).map((c) => c.id);
    expect(ids).toEqual(['text-size', 'empty-frame', 'monotony', 'transition-variety']);
    // Layouts from before fonts were reported, or sampled at no settled frame.
    const old = densityChecks(t, [
      report(3, 's1', [{ role: 'media', rect: band(180) }]),
      report(at(t, 's2'), 's2', [{ role: 'text', rect: band(420) }]),
    ]);
    expect(old.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(old[0]!.message).toMatch(/No code or body text was measured/);
  });
});
```

In `tests/render/render.test.ts`, in the test `renders a composition to H.264 with captions inside the safe area`, after:

```ts
    const failing = qc.checks.filter((c) => c.status === 'fail' && c.id !== 'duration');
    expect(failing).toEqual([]);
```

add:

```ts
    // Every render is checked for small text, empty frames, and monotony.
    expect(qc.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety']),
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/density.test.ts`
Expected: FAIL: `monotonyCheck is not a function` (or a missing-export error).

- [ ] **Step 3: Add the checks to `packages/video/src/density.ts`**

Add to its imports: `import { storyScenes } from './timeline/build.ts';` (sorted after `./runtime/sizing.ts`). Update the file's top comment to:

```ts
/*
 * Density and monotony checks: is the text large enough to read, does the content use the frame,
 * and does the picture vary from scene to scene. They warn rather than fail: they judge taste,
 * not broken output (R-007).
 */
```

Append:

```ts
/** At most this many story scenes of one kind in a row; more read as a slide deck. */
export const MAX_RUN = 2;
/** One transition kind may cover at most this share of the story's transitions… */
export const TRANSITION_SHARE = 0.6;
/** …once there are at least this many. */
export const TRANSITION_MIN = 4;

/** The kind of picture a scene leads with: its visual's kind. */
export function leadKind(scene: Pick<TimelineScene, 'visual'>): string {
  return scene.visual.kind;
}

/** No more than two story scenes in a row lead with the same kind of visual. */
export function monotonyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const story = storyScenes(timeline.scenes);
  const runs: Array<{ kind: string; from: string; to: string; length: number }> = [];
  let start = 0;
  for (let i = 1; i <= story.length; i++) {
    if (i < story.length && leadKind(story[i]!) === leadKind(story[start]!)) continue;
    if (i - start > MAX_RUN)
      runs.push({
        kind: leadKind(story[start]!),
        from: story[start]!.id,
        to: story[i - 1]!.id,
        length: i - start,
      });
    start = i;
  }
  if (!runs.length)
    return {
      id: 'monotony',
      status: 'pass',
      message: `No more than ${MAX_RUN} scenes of one kind in a row.`,
    };
  return {
    id: 'monotony',
    status: 'warn',
    message: `${runs
      .slice(0, 3)
      .map((r) => `${r.length} ${r.kind} scenes in a row (${r.from}–${r.to})`)
      .join(
        '; ',
      )}${runs.length > 3 ? '; …' : ''}: at most ${MAX_RUN} of one kind in a row. Put a different picture between them: the output, a capture, or the code it explains.`,
  };
}

/**
 * With four or more story transitions (into each story scene after the first; the outro's is
 * Covi's), no one kind covers more than 60% of them. A scene without a kind faded in.
 */
export function transitionVarietyCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const kinds = storyScenes(timeline.scenes)
    .slice(1)
    .map((s) => s.transition?.kind ?? 'fade');
  if (kinds.length < TRANSITION_MIN)
    return {
      id: 'transition-variety',
      status: 'pass',
      message: `${kinds.length} story transition(s); variety is checked from ${TRANSITION_MIN}.`,
    };
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
  const share = n / kinds.length;
  return share > TRANSITION_SHARE + 1e-9
    ? {
        id: 'transition-variety',
        status: 'warn',
        message: `${n} of ${kinds.length} story transitions are ${top} (${percent(share)}): at most ${percent(TRANSITION_SHARE)} of one kind. Set \`transition\` on scenes: cut when the same subject continues, push for the next step, wipe from before to after.`,
      }
    : {
        id: 'transition-variety',
        status: 'pass',
        message: `No transition kind covers more than ${percent(TRANSITION_SHARE)} of the ${kinds.length} story transitions (most: ${top}, ${percent(share)}).`,
      };
}

/** The density and monotony checks, in the order `qc.json` lists them. */
export function densityChecks(
  timeline: DensityTimeline,
  layouts: readonly LayoutReport[],
): QcCheck[] {
  return [
    textSizeCheck(timeline, layouts),
    emptyFrameCheck(timeline, layouts),
    monotonyCheck(timeline),
    transitionVarietyCheck(timeline),
  ];
}
```

- [ ] **Step 4: Run the density checks in every QC report**

In `packages/video/src/qc.ts`, add `import { densityChecks } from './density.ts';` to the imports (`biome check --write` puts it in order). In `runQc`, replace:

```ts
  checks.push(
    ...layoutChecks(input.timeline, input.layouts),
    ...timingChecks(input.timeline, input.speech),
```

with:

```ts
  checks.push(
    ...layoutChecks(input.timeline, input.layouts),
    ...densityChecks(input.timeline, input.layouts),
    ...timingChecks(input.timeline, input.speech),
```

In `packages/video/src/index.ts`, replace the `./density.ts` export block with:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/density.test.ts packages/video/test/qc-grammar.test.ts packages/video/test/wav-qc.test.ts`
Expected: PASS.

Run: `npx vitest run tests/render/render.test.ts -t "renders a composition to H.264"`
Expected: PASS (needs Chromium and ffmpeg; if they are missing the test is skipped: say so in the report).

- [ ] **Step 6: Commit**

```bash
npx biome check --write packages/video/src/density.ts packages/video/src/qc.ts packages/video/src/index.ts packages/video/test/density.test.ts tests/render/render.test.ts
npm run lint && npm run typecheck
git add packages/video/src/density.ts packages/video/src/qc.ts packages/video/src/index.ts packages/video/test/density.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Warn on monotonous scenes and transitions in every QC report

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 4: Code, terminal, and API text sized to its block; their cards fill the frame

**Files:**
- Modify: `packages/video/src/runtime/components/types.ts` (append after `overflows`)
- Modify: `packages/video/src/runtime/components/media.ts:18` (imports), `code` (`:463-578`), `terminalWindow` and `terminal` (`:584-678`), `api` (`:711-788`)
- Test: `tests/render/render.test.ts` (imports; `compose`; three new tests inside `describe.skipIf(!available)('rendering', …)` after the test `times an edge by its place in the list, also after an edge it cannot draw`)

**Interfaces:**
- Consumes: `codeFont`, `cardHeight`, `CARD_FILL` (Task 1); `settledFrame` (Task 1); `densityChecks` (Task 3).
- Produces:
  - `packages/video/src/runtime/components/types.ts`: `drawnFont(node: HTMLElement): number` (px as drawn), `smallestFont(nodes: readonly HTMLElement[]): number`.
  - Layout items: the code panel `{ role: 'media', font, text: 'code' }`, the code caption `{ role: 'text', font, text: 'body' }`, each terminal window `{ role: 'media', font, text: 'code' }`, the API request line and each response panel `{ role: 'media', font, text: 'code' }`.
  - Test helpers in `tests/render/render.test.ts`: `compose(browser, scenes, redact?, options?: { language?: 'en' | 'ko' | 'ja' | 'zh'; width?: number; height?: number })` (default 360×640, English) and `settled(c: Awaited<ReturnType<typeof compose>>, id: string): Promise<LayoutReport>`.

- [ ] **Step 1: Give `compose` a size and a language, and add the `settled` helper**

In `tests/render/render.test.ts`:

1. Add `densityChecks,` to the `@covi/video` import list (sorted after `buildTimeline,`), and `settledFrame,` to the `../../packages/video/src/timeline/cues.ts` import list (after `screenshotMarks,`).
2. Replace the `compose` doc comment and signature, and the lines that use the size and language, so it reads:

```ts
  /**
   * Builds a composition from storyboard scenes (360×640 in English unless `options` says
   * otherwise), with one 640×400 capture at demo/a.png, and opens it. `look` seeks to a frame and
   * evaluates `body`, a function body over `scene` (that scene's root element). `redact` rewrites
   * every narration after validation, as the redactor can, so a phrase it hides pins nothing.
   */
  async function compose(
    browser: Browser,
    scenes: StoryboardInput['scenes'],
    redact?: (narration: string) => string,
    options: { language?: 'en' | 'ko' | 'ja' | 'zh'; width?: number; height?: number } = {},
  ) {
    const { width = 360, height = 640, language = 'en' } = options;
```

Then, inside `compose`:
- `resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', width: 360, height: 640 })` → `{ mode: 'custom', width, height }`
- `StoryboardSchema.parse({ ...storyboard, scenes })` → `StoryboardSchema.parse({ ...storyboard, language, scenes })`
- `layoutScenes(parsed, new Map(), new Map(), 'en', pacingFor(spec))` → `layoutScenes(parsed, new Map(), new Map(), language, pacingFor(spec))`
- in `buildTimeline({ … })` add `language,` after `image: assets.image,`
- `browser.newPage({ viewport: { width: 360, height: 640 } })` (the composition page, not the capture page) → `browser.newPage({ viewport: { width, height } })`

3. After the `cart` constant, add:

```ts
  /** A scene's layout report at its settled frame, where QC measures sizes and emptiness. */
  async function settled(c: Awaited<ReturnType<typeof compose>>, id: string) {
    const frame = settledFrame(
      c.timeline,
      c.timeline.scenes.findIndex((s) => s.id === id),
    )!;
    await c.look(frame, id, 'return null;');
    return c.report();
  }
```

- [ ] **Step 2: Write the failing render tests**

Add inside the `rendering` describe, after the test `times an edge by its place in the list, also after an edge it cannot draw`:

```ts
  it('renders a short code block large, in a card that fills the frame', async () => {
    const browser = await chromium.launch();
    try {
      for (const size of [{}, { width: 640, height: 360 }]) {
        const c = await compose(browser, storyboard.scenes, undefined, size);
        const report = await settled(c, 's2');
        const { unit, media } = computeRegions(c.timeline);
        const card = report.items.find((i) => i.text === 'code')!;
        // Two short lines reach the ceiling: 48 units in 9:16, 44 in 16:9 (the camera may have
        // begun to push in).
        const ceiling = c.timeline.orientation === 'vertical' ? 48 : 44;
        expect(card.font! / unit).toBeGreaterThanOrEqual(ceiling - 0.5);
        expect(card.font! / unit).toBeLessThan(ceiling * 1.07);
        const share = (card.rect.width * card.rect.height) / (media.width * media.height);
        expect(share).toBeGreaterThan(0.59);
        const checks = densityChecks(c.timeline, [report]);
        expect(checks.find((x) => x.id === 'text-size')!.status).toBe('pass');
        expect(checks.find((x) => x.id === 'empty-frame')!.status).toBe('pass');
        expect(c.errors).toEqual([]);
      }
    } finally {
      await browser.close();
    }
  });

  it('shrinks code under the floor only when its lines need it, and QC names the scene', async () => {
    const browser = await chromium.launch();
    try {
      const long = 'const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);';
      const c = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'fix',
          narration: 'The total now counts the quantity of every item.',
          visual: {
            kind: 'code',
            path: 'src/cart.js',
            language: 'javascript',
            lines: [
              { type: 'del', text: long.replace(' * item.quantity', '') },
              { type: 'add', text: long },
            ],
            highlight: [1],
          },
        },
        storyboard.scenes[2]!,
      ]);
      const report = await settled(c, 's2');
      const { unit } = computeRegions(c.timeline);
      const card = report.items.find((i) => i.text === 'code')!;
      expect(card.font! / unit).toBeLessThan(24);
      expect(card.font! / unit).toBeGreaterThanOrEqual(13 - 0.5);
      const size = densityChecks(c.timeline, [report]).find((x) => x.id === 'text-size')!;
      expect(size.status).toBe('warn');
      expect(size.message).toMatch(/code at \d+ px in s2/);
    } finally {
      await browser.close();
    }
  });

  it('draws a before and an after terminal at one readable size, and API bodies large', async () => {
    const browser = await chromium.launch();
    try {
      const c = await compose(browser, [
        cart,
        {
          id: 's2',
          beat: 'proof',
          narration: 'The request shrinks from seventy kilobytes to ten.',
          visual: {
            kind: 'terminal',
            command: 'node scripts/measure.js',
            before: 'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1',
            output: 'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0',
          },
        },
        {
          id: 's3',
          beat: 'exchange',
          narration: 'The response lists the documents.',
          visual: {
            kind: 'api',
            method: 'GET',
            path: '/api/reviews/1',
            after: { status: 200, body: '{\n  "refs": 6,\n  "chunks": 1\n}' },
          },
        },
        { ...storyboard.scenes[2]!, id: 's4' },
      ]);
      const { unit } = computeRegions(c.timeline);
      const terminal = await settled(c, 's2');
      const windows = terminal.items.filter((i) => i.text === 'code');
      expect(windows).toHaveLength(2);
      expect(windows[0]!.font).toBeCloseTo(windows[1]!.font!, 3);
      expect(windows[0]!.font! / unit).toBeGreaterThanOrEqual(24);
      const api = await settled(c, 's3');
      const bodies = api.items.filter((i) => i.text === 'code');
      expect(bodies).toHaveLength(2);
      for (const item of bodies) expect(item.font! / unit).toBeGreaterThanOrEqual(24);
      const checks = densityChecks(c.timeline, [terminal, api]);
      expect(checks.find((x) => x.id === 'text-size')!.status).toBe('pass');
      expect(checks.find((x) => x.id === 'empty-frame')!.status).toBe('pass');
      expect(c.errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/render/render.test.ts -t "short code block large|under the floor|one readable size"`
Expected: FAIL: `card` is undefined (no item reports `text: 'code'` yet), so `Cannot read properties of undefined (reading 'font')`.

- [ ] **Step 4: Add `drawnFont` and `smallestFont`**

Append to `packages/video/src/runtime/components/types.ts` after `overflows`:

```ts
/**
 * A node's font size as drawn, in stage pixels: its computed size scaled by the transforms around
 * it (the camera's push), measured from its box. QC's text-size check reads it.
 */
export function drawnFont(node: HTMLElement): number {
  const font = Number.parseFloat(getComputedStyle(node).fontSize) || 0;
  const width = node.offsetWidth;
  return width > 0 ? (font * node.getBoundingClientRect().width) / width : font;
}

/** The smallest drawn font of these nodes: what a layout item with several texts reports. */
export function smallestFont(nodes: readonly HTMLElement[]): number {
  return Math.min(...nodes.map(drawnFont));
}
```

- [ ] **Step 5: Size the code card**

In `packages/video/src/runtime/components/media.ts`:

- Change the anim import to `import { easeOutCubic, fade, lerp, rise, seg, typedPrefix } from '../anim.ts';` (`clamp` is no longer used once Steps 5–7 are done).
- Add `import { CARD_FILL, cardHeight, codeFont } from '../sizing.ts';` after the `../narrator.ts` import.
- Add `drawnFont,` to the `./types.ts` import list (Task 5 adds `smallestFont`).

In `code`, replace:

```ts
  const band = v.caption ? ctx.u(vertical ? 96 : 72) : 0;
```

with:

```ts
  const band = v.caption ? ctx.u(vertical ? 96 : 88) : 0;
```

Replace:

```ts
  const font = clamp(Math.min(fontByWidth, fontByHeight), ctx.u(16), ctx.u(34));
  body.style.fontSize = `${font}px`;
  const height = Math.min(box.height, v.lines.length * font * 1.55 + font * 1.2 + ctx.u(66));
```

with:

```ts
  const font = codeFont(
    Math.min(fontByWidth, fontByHeight),
    ctx.timeline.orientation,
    ctx.regions.unit,
  );
  body.style.fontSize = `${font}px`;
  // A short block still gets a card that fills most of the region, its lines in the middle.
  const natural = Math.min(box.height, v.lines.length * font * 1.55 + font * 1.2 + ctx.u(66));
  const height = cardHeight(box, box.width, natural);
  body.style.paddingTop = `${ctx.u(14) + (height - natural) / 2}px`;
```

Replace the caption's `fontSize: \`${ctx.u(vertical ? 28 : 23)}px\`,` with `fontSize: \`${ctx.u(28)}px\`,`.

Replace the code component's `report`:

```ts
    report: () => [
      { role: 'media', rect: rectOf(panel) },
      ...(caption
        ? [{ role: 'text' as const, rect: rectOf(caption), overflow: overflows(caption) }]
        : []),
    ],
```

with:

```ts
    report: () => [
      { role: 'media', rect: rectOf(panel), font: drawnFont(body), text: 'code' },
      ...(caption
        ? [
            {
              role: 'text' as const,
              rect: rectOf(caption),
              overflow: overflows(caption),
              font: drawnFont(caption),
              text: 'body' as const,
            },
          ]
        : []),
    ],
```

- [ ] **Step 6: Size the terminal windows together**

Replace the whole `terminalWindow` function and the `terminal` function (from `function terminalWindow(` through the end of `export function terminal(…) { … }`) with:

```ts
/**
 * The size of terminal text: one for every window, so a before and an after compare at one scale,
 * and as large as the longest line and the most lines allow in a window's slot.
 */
function terminalFont(
  slot: Rect,
  command: string,
  outputs: readonly string[],
  ctx: ComponentContext,
): number {
  const lines = outputs.map((o) => o.split('\n'));
  const longest = Math.max(command.length + 2, ...lines.flat().map((l) => l.length), 24);
  const most = Math.max(...lines.map((l) => l.length));
  return codeFont(
    Math.min(
      (slot.width - ctx.u(40)) / (longest * 0.61),
      (slot.height - ctx.u(70)) / ((most + 1.5) * 1.5),
    ),
    ctx.timeline.orientation,
    ctx.regions.unit,
  );
}

function terminalWindow(
  parent: HTMLElement,
  rect: Rect,
  label: string,
  command: string,
  output: string,
  font: number,
  ctx: ComponentContext,
) {
  const win = el('div', 'term mono', parent);
  Object.assign(win.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px` });
  const head = el('div', 'term-head', win);
  for (const color of ['#FF5F57', '#FEBC2E', '#28C840']) el('i', '', head).style.background = color;
  el('span', 'label', head, label);
  const body = el('div', 'term-body', win);
  const lines = output.split('\n');
  body.style.fontSize = `${font}px`;
  // The window fits its content, grown to fill most of the region (a terminal keeps its text at
  // the top, as terminals do), and is centered in its slot.
  const contentHeight = (lines.length + 1) * font * 1.5 + ctx.u(32) + ctx.u(44);
  const height = Math.min(
    rect.height,
    Math.max(contentHeight, CARD_FILL * ctx.regions.media.height),
  );
  win.style.height = `${height}px`;
  win.style.top = `${rect.y + (rect.height - height) / 2}px`;
  const prompt = el('div', '', body);
  prompt.innerHTML = '<span class="prompt">$ </span><span class="cmd"></span>';
  const cmd = prompt.querySelector('.cmd') as HTMLSpanElement;
  const outLines = lines.map((l) => el('div', 'out', body, l || ' '));
  return {
    win,
    body,
    play(t: number, start: number) {
      const typed = Math.floor(command.length * seg(t, start, start + 0.6));
      cmd.textContent = command.slice(0, typed);
      for (const [i, line] of outLines.entries())
        fade(
          line,
          seg(t, start + TYPE_TO_OUTPUT + i * 0.06, start + TYPE_TO_OUTPUT + 0.15 + i * 0.06),
        );
    },
  };
}

export function terminal(v: V<'terminal'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const gap = ctx.u(26);
  const labels = ctx.timeline.labels;
  const windows: Array<ReturnType<typeof terminalWindow>> = [];
  if (v.before !== undefined) {
    const vertical = ctx.timeline.orientation !== 'landscape';
    const a = vertical
      ? { ...box, height: (box.height - gap) / 2 }
      : { ...box, width: (box.width - gap) / 2 };
    const b = vertical ? { ...a, y: box.y + a.height + gap } : { ...a, x: box.x + a.width + gap };
    const font = terminalFont(a, v.command, [v.before, v.output], ctx);
    windows.push(
      terminalWindow(ctx.root, a, labels?.before ?? 'Before', v.command, v.before, font, ctx),
      terminalWindow(ctx.root, b, labels?.after ?? 'After', v.command, v.output, font, ctx),
    );
  } else {
    const font = terminalFont(box, v.command, [v.output], ctx);
    const label = v.title ?? labels?.terminal ?? 'Terminal';
    windows.push(terminalWindow(ctx.root, box, label, v.command, v.output, font, ctx));
  }
  return {
    update(clock) {
      const { t, duration } = clock;
      const starts = terminalStarts(duration, windows.length, ctx.phases);
      windows.forEach((w, i) => {
        const start = starts[i]!;
        // The first window is up from the start; a phase only moves when its command is typed.
        rise(w.win, i === 0 ? entered(clock, 0, 0.5) : seg(t, start - 0.2, start + 0.3), ctx.u(24));
        w.play(t, start);
      });
    },
    report: () =>
      windows.map((w) => ({
        role: 'media' as const,
        rect: rectOf(w.win),
        font: drawnFont(w.body),
        text: 'code' as const,
      })),
  };
}
```

- [ ] **Step 7: Size the API bodies**

In `api`, replace `const panels: HTMLDivElement[] = [];` with:

```ts
  const panels: HTMLDivElement[] = [];
  const bodies: HTMLPreElement[] = [];
```

Replace:

```ts
    const pre = el('pre', 'mono', panel);
    const longest = Math.max(24, ...lines.map((l) => l.length));
    pre.style.fontSize = `${clamp(Math.min((rect.width - ctx.u(44)) / (longest * 0.61), (rect.height - ctx.u(80)) / (lines.length * 1.5 + 1)), ctx.u(13), ctx.u(24))}px`;
```

with:

```ts
    const pre = el('pre', 'mono', panel);
    bodies.push(pre);
    const longest = Math.max(24, ...lines.map((l) => l.length));
    const fit = Math.min(
      (rect.width - ctx.u(44)) / (longest * 0.61),
      (rect.height - ctx.u(80)) / (lines.length * 1.5 + 1),
    );
    pre.style.fontSize = `${codeFont(fit, ctx.timeline.orientation, ctx.regions.unit)}px`;
```

Replace the api `report`:

```ts
    report: () => [
      { role: 'media', rect: rectOf(req) },
      ...panels.map((p) => ({ role: 'media' as const, rect: rectOf(p) })),
    ],
```

with:

```ts
    report: () => [
      { role: 'media', rect: rectOf(req), font: drawnFont(req), text: 'code' },
      ...panels.map((p, i) => ({
        role: 'media' as const,
        rect: rectOf(p),
        font: drawnFont(bodies[i]!),
        text: 'code' as const,
      })),
    ],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/render/render.test.ts -t "short code block large|under the floor|one readable size"`
Expected: PASS.

Run: `npx vitest run tests/render/render.test.ts` (in the background; the full-pipeline describes are skipped without `COVI_TEST_RENDER=1`)
Expected: PASS: the morph, caption, marks, diagram, determinism, and CJK tests still pass with the larger code and cards.

- [ ] **Step 9: Commit**

```bash
npx biome check --write packages/video/src/runtime/components/types.ts packages/video/src/runtime/components/media.ts tests/render/render.test.ts
npm run lint && npm run typecheck
git add packages/video/src/runtime/components/types.ts packages/video/src/runtime/components/media.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Size code, terminal, and API text to its block and let their cards fill the frame

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 5: Body text held to 28 px; findings, callouts, diagrams, and change maps fill the frame

**Files:**
- Modify: `packages/video/src/runtime/components/media.ts` (`screenshot` report `:159-165`, `interaction` report `:393-396`, `findings` `:801-860`, `changeMap` `:866-910`, `callout` `:916-950`, `diagram` `:956-1061`)
- Modify: `packages/video/src/runtime/components/cards.ts` (imports `:7-14`, `title` report `:87`, `summary` points `:170-181` and report `:275`)
- Modify: `packages/video/src/runtime/stage.ts:25-33` (imports), `:239-248` (heading)
- Modify: `packages/video/src/runtime/styles.ts` (`.finding .body`, `.callout`)
- Test: `tests/render/render.test.ts` (one new test after the Task 4 tests)

**Interfaces:**
- Consumes: `drawnFont`, `smallestFont` (Task 4); `cardHeight`, `CARD_FILL` (Task 1); `compose(…, options)`, `settled` (Task 4); `densityChecks` (Task 3); `layoutChecks` (existing).
- Produces: layout items carrying `font` and `text` for every component in the "Text classes" table (body items: scene heading, title heading, summary panel, callout card, each finding card, each diagram node, each change-map row; meta items: screenshot gloss, interaction label, diagram edge labels).

- [ ] **Step 1: Write the failing render test**

Add inside the `rendering` describe, after the test `draws a before and an after terminal at one readable size, and API bodies large`:

```ts
  it('holds body text to 28 px and grows short cards to fill the frame, in Korean too', async () => {
    const browser = await chromium.launch();
    try {
      const words = {
        en: {
          problem: 'One reader call ran past its step budget.',
          heading: 'Why the reader timed out',
          title: 'The reader timed out',
          body: 'One chunk took nine steps; the budget is eight.',
          review: 'One thing to check before merging.',
          finding: 'Nothing tests a document that changed',
          note: 'The size check throws, but no test reaches it.',
        },
        ko: {
          problem: '리더 호출 하나가 단계 예산을 넘겼습니다.',
          heading: '리더가 멈춘 이유',
          title: '리더가 시간 초과로 멈췄습니다',
          body: '청크 하나가 아홉 단계를 썼고, 예산은 여덟 단계입니다.',
          review: '병합 전에 확인할 것이 하나 있습니다.',
          finding: '바뀐 문서를 다루는 테스트가 없습니다',
          note: '크기 검사가 예외를 던지지만, 그 경로를 지나는 테스트는 없습니다.',
        },
      } as const;
      for (const language of ['en', 'ko'] as const) {
        const w = words[language];
        const c = await compose(
          browser,
          [
            {
              id: 's1',
              beat: 'problem',
              eyebrow: 'Problem',
              heading: w.heading,
              narration: w.problem,
              visual: { kind: 'callout', tone: 'warning', title: w.title, body: w.body },
            },
            {
              id: 's2',
              beat: 'review',
              eyebrow: 'Review',
              narration: w.review,
              visual: {
                kind: 'findings',
                findings: [
                  {
                    title: w.finding,
                    certainty: 'risk',
                    severity: 'low',
                    location: 'src/reader.js:24',
                    note: w.note,
                  },
                ],
              },
            },
            {
              id: 's3',
              beat: 'architecture',
              eyebrow: 'How it flows',
              narration: 'The builder sends a list, and the reader fetches each document.',
              visual: {
                kind: 'diagram',
                nodes: [
                  { id: 'builder', label: 'Request builder' },
                  { id: 'reader', label: 'Reader worker', changed: true },
                  { id: 'store', label: 'Document store' },
                ],
                edges: [
                  { from: 'builder', to: 'reader', label: 'list' },
                  { from: 'reader', to: 'store', label: 'fetch' },
                ],
              },
            },
            {
              id: 's4',
              beat: 'map',
              eyebrow: 'Where',
              narration: 'Two areas changed, the source and its tests.',
              visual: {
                kind: 'change-map',
                areas: [
                  { name: 'src', additions: 20, deletions: 12, files: 2 },
                  { name: 'test', additions: 30, deletions: 10, files: 2 },
                ],
              },
            },
            { ...storyboard.scenes[2]!, id: 's5' },
          ],
          undefined,
          { language },
        );
        const reports: LayoutReport[] = [];
        for (const id of ['s1', 's2', 's3', 's4', 's5']) reports.push(await settled(c, id));
        const { unit } = computeRegions(c.timeline);
        const body = reports.flatMap((r) => r.items.filter((i) => i.text === 'body'));
        // The heading and the callout, the finding, three nodes, two areas, and the summary.
        expect(body.length, language).toBeGreaterThanOrEqual(9);
        for (const item of body) expect(item.font! / unit, language).toBeGreaterThanOrEqual(27.5);
        const checks = [...layoutChecks(c.timeline, reports), ...densityChecks(c.timeline, reports)];
        const status = Object.fromEntries(checks.map((x) => [x.id, x.status]));
        expect(status, language).toMatchObject({
          'text-fits': 'pass',
          'text-size': 'pass',
          'empty-frame': 'pass',
        });
        expect(c.errors).toEqual([]);
      }
    } finally {
      await browser.close();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/render/render.test.ts -t "body text to 28 px"`
Expected: FAIL: `expected 0 to be greater than or equal to 9` (no item reports `text: 'body'` yet).

- [ ] **Step 3: Findings: the note at the floor, cards grown to fill the frame**

In `packages/video/src/runtime/components/media.ts`, add `smallestFont,` to the `./types.ts` import list (sorted). In `findings`, replace:

```ts
    if (f.location)
      el('div', 'loc mono', body, f.location).style.fontSize = `${ctx.u(vertical ? 22 : 20)}px`;
    if (f.note) el('div', 'note', body, f.note).style.fontSize = `${ctx.u(vertical ? 27 : 23)}px`;
    return { card, body };
  });
  // Cards size to their content and the stack is centered in the media region.
  const heights = cards.map(({ card }) => Math.min(maxCard, card.offsetHeight));
  const total = heights.reduce((a, b) => a + b, 0) + gap * (cards.length - 1);
  let y = box.y + Math.max(0, (box.height - total) / 2);
  cards.forEach(({ card }, i) => {
    card.style.top = `${y}px`;
    y += heights[i]! + gap;
  });
```

with:

```ts
    if (f.location)
      el('div', 'loc mono', body, f.location).style.fontSize = `${ctx.u(vertical ? 22 : 20)}px`;
    const note = f.note ? el('div', 'note', body, f.note) : undefined;
    if (note) note.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
    return { card, body, read: note ? [title, note] : [title] };
  });
  // Cards size to their content, then grow alike until the stack fills most of the region, each
  // card's text in its middle; the stack is centered in the region.
  const natural = cards.map(({ card }) => Math.min(maxCard, card.offsetHeight));
  const sum = natural.reduce((a, b) => a + b, 0) + gap * (cards.length - 1);
  const grow = Math.max(0, (cardHeight(box, box.width, sum) - sum) / cards.length);
  const heights = natural.map((h) => Math.min(maxCard, h + grow));
  const total = heights.reduce((a, b) => a + b, 0) + gap * (cards.length - 1);
  let y = box.y + Math.max(0, (box.height - total) / 2);
  cards.forEach(({ card }, i) => {
    Object.assign(card.style, { top: `${y}px`, height: `${heights[i]}px` });
    y += heights[i]! + gap;
  });
```

Replace the findings `report`:

```ts
    report: () =>
      cards.map(({ card, body }) => ({
        role: 'text' as const,
        rect: rectOf(card),
        overflow: overflows(body),
      })),
```

with:

```ts
    report: () =>
      cards.map(({ card, body, read }) => ({
        role: 'text' as const,
        rect: rectOf(card),
        overflow: overflows(body),
        font: smallestFont(read),
        text: 'body' as const,
      })),
```

In `packages/video/src/runtime/styles.ts`, replace:

```ts
.finding .body { padding: ${u(20)} ${u(26)}; display: flex; flex-direction: column; gap: ${u(10)}; min-width: 0; }
```

with:

```ts
.finding .body { padding: ${u(20)} ${u(26)}; display: flex; flex-direction: column; justify-content: center; gap: ${u(10)}; min-width: 0; }
```

- [ ] **Step 4: Change map: area names at the floor, rows grown toward the frame**

In `changeMap`, replace:

```ts
  const rows = v.areas.slice(0, 6);
  const rowHeight = Math.min(
    ctx.u(ctx.timeline.orientation === 'vertical' ? 150 : 96),
    box.height / rows.length,
  );
```

with:

```ts
  const vertical = ctx.timeline.orientation === 'vertical';
  const rows = v.areas.slice(0, 6);
  // Rows grow, up to twice their height, until the map fills most of the region.
  const base = ctx.u(vertical ? 150 : 96);
  const rowHeight = Math.min(
    box.height / rows.length,
    Math.max(base, (CARD_FILL * box.height) / rows.length),
    base * 2,
  );
```

Replace:

```ts
    const name = el('div', 'name mono', row, area.name);
    name.style.fontSize = `${ctx.u(ctx.timeline.orientation === 'vertical' ? 28 : 24)}px`;
    name.style.width = `${box.width * (ctx.timeline.orientation === 'vertical' ? 0.42 : 0.3)}px`;
```

with:

```ts
    const name = el('div', 'name mono', row, area.name);
    name.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
    name.style.width = `${box.width * (vertical ? 0.42 : 0.3)}px`;
```

Change `return { row, plus, minus };` to `return { row, name, plus, minus };`, and replace the change-map `report`:

```ts
    report: () => items.map(({ row }) => ({ role: 'media' as const, rect: rectOf(row) })),
```

with:

```ts
    report: () =>
      items.map(({ row, name }) => ({
        role: 'media' as const,
        rect: rectOf(row),
        font: drawnFont(name),
        text: 'body' as const,
      })),
```

- [ ] **Step 5: Callout: the body at the floor, the card grown to fill the frame**

Replace the whole `callout` function with:

```ts
export function callout(v: V<'callout'>, ctx: ComponentContext): Component {
  const box = ctx.regions.media;
  const theme = ctx.timeline.theme;
  const vertical = ctx.timeline.orientation === 'vertical';
  const tone = { info: theme.primary, warning: theme.accent, success: theme.success }[v.tone];
  const card = el('div', 'callout card', ctx.root);
  const width = Math.min(box.width, ctx.u(vertical ? 940 : 1400));
  Object.assign(card.style, { left: `${box.x + (box.width - width) / 2}px`, width: `${width}px` });
  const icon = el(
    'div',
    'icon',
    card,
    v.tone === 'success' ? '✓' : v.tone === 'warning' ? '!' : 'i',
  );
  const size = ctx.u(96);
  Object.assign(icon.style, {
    width: `${size}px`,
    height: `${size}px`,
    background: tone,
    fontSize: `${size * 0.5}px`,
  });
  const title = el('div', 'ctitle', card, v.title);
  title.style.fontSize = `${ctx.u(vertical ? 46 : 40)}px`;
  const body = v.body ? el('div', 'cbody', card, v.body) : undefined;
  if (body) body.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
  // The card fills most of the region, its content in the middle.
  const height = cardHeight(box, width, card.offsetHeight);
  Object.assign(card.style, {
    height: `${height}px`,
    top: `${box.y + (box.height - height) / 2}px`,
  });
  return {
    update(clock) {
      const e = easeOutCubic(entered(clock, 0, 0.55));
      card.style.opacity = String(e.toFixed(3));
      card.style.transform = `scale(${lerp(0.94, 1, e).toFixed(4)})`;
      icon.style.transform = `scale(${lerp(0.6, 1, easeOutCubic(entered(clock, 0.15, 0.6))).toFixed(4)})`;
    },
    report: () => [
      {
        role: 'text',
        rect: rectOf(card),
        overflow: overflows(card),
        font: smallestFont(body ? [title, body] : [title]),
        text: 'body',
      },
    ],
  };
}
```

In `styles.ts`, replace:

```ts
.callout { position: absolute; display: flex; flex-direction: column; align-items: center; text-align: center; gap: ${u(18)}; padding: ${u(46)}; }
```

with:

```ts
.callout { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: ${u(18)}; padding: ${u(46)}; }
```

- [ ] **Step 6: Diagram: node labels at the floor, nodes grown toward the frame**

In `diagram`, replace:

```ts
  const nodeW = (box.width - gapX * (perRow - 1)) / perRow;
  const nodeH = Math.min(ctx.u(170), (box.height - gapY * (rowsCount - 1)) / rowsCount);
```

with:

```ts
  const nodeW = (box.width - gapX * (perRow - 1)) / perRow;
  // Nodes grow from 170 units toward filling most of the region, never taller than wide.
  const nodeH = Math.min(
    (box.height - gapY * (rowsCount - 1)) / rowsCount,
    nodeW,
    Math.max(ctx.u(170), (CARD_FILL * box.height - gapY * (rowsCount - 1)) / rowsCount),
  );
```

Replace:

```ts
  const nodes = v.nodes.map((n, i) => {
```

with:

```ts
  const nodeLabels: HTMLElement[] = [];
  const nodes = v.nodes.map((n, i) => {
```

Replace:

```ts
    const label = el('div', 'nlabel mono', node, n.label);
    label.style.fontSize = `${ctx.u(vertical ? 28 : 24)}px`;
```

with:

```ts
    const label = el('div', 'nlabel mono', node, n.label);
    label.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
    nodeLabels.push(label);
```

Replace the diagram `report`:

```ts
    report: () => [
      ...nodes.map((n) => ({ role: 'text' as const, rect: rectOf(n), overflow: overflows(n) })),
      ...edges.flatMap(({ label }) =>
        label ? [{ role: 'text' as const, rect: rectOf(label), overflow: overflows(label) }] : [],
      ),
    ],
```

with:

```ts
    report: () => [
      ...nodes.map((n, i) => ({
        role: 'text' as const,
        rect: rectOf(n),
        overflow: overflows(n),
        font: drawnFont(nodeLabels[i]!),
        text: 'body' as const,
      })),
      ...edges.flatMap(({ label }) =>
        label
          ? [
              {
                role: 'text' as const,
                rect: rectOf(label),
                overflow: overflows(label),
                text: 'meta' as const,
              },
            ]
          : [],
      ),
    ],
```

- [ ] **Step 7: Mark glosses and step labels as meta**

In `screenshot`'s marks `report`, replace:

```ts
        ? [{ role: 'text' as const, rect: rectOf(gloss), overflow: overflows(gloss) }]
```

with:

```ts
        ? [
            {
              role: 'text' as const,
              rect: rectOf(gloss),
              overflow: overflows(gloss),
              text: 'meta' as const,
            },
          ]
```

In `interaction`'s `report`, replace:

```ts
      { role: 'text' as const, rect: rectOf(label), overflow: overflows(label) },
```

with:

```ts
      { role: 'text' as const, rect: rectOf(label), overflow: overflows(label), text: 'meta' as const },
```

- [ ] **Step 8: Title, summary, and the scene heading**

In `packages/video/src/runtime/components/cards.ts`, add `drawnFont,` and `smallestFont,` to the `./types.ts` import list (sorted). Replace the `title` report:

```ts
    report: () => [{ role: 'text', rect: rectOf(heading), overflow: overflows(heading) }],
```

with:

```ts
    report: () => [
      {
        role: 'text',
        rect: rectOf(heading),
        overflow: overflows(heading),
        font: drawnFont(heading),
        text: 'body',
      },
    ],
```

In `summary`, replace:

```ts
    el('span', '', row, p).style.fontSize = `${ctx.u(vertical ? 32 : 27)}px`;
    return row;
```

with:

```ts
    el('span', '', row, p);
    // On the row, so the drawn size can be read from a box (the tick sets its own size).
    row.style.fontSize = `${ctx.u(vertical ? 32 : 28)}px`;
    return row;
```

and replace the summary `report`:

```ts
    report: () => [{ role: 'text', rect: rectOf(panel), overflow: overflows(panel) }],
```

with:

```ts
    report: () => [
      {
        role: 'text',
        rect: rectOf(panel),
        overflow: overflows(panel),
        font: smallestFont([headline, ...points]),
        text: 'body',
      },
    ],
```

In `packages/video/src/runtime/stage.ts`, add `drawnFont,` to the `./components/types.ts` import list (sorted, before `type LayoutItem,`). In `mount`, replace:

```ts
          fitText(h, {
            max: u(t.orientation === 'vertical' ? 50 : 42),
            min: u(26),
```

with:

```ts
          fitText(h, {
            max: u(t.orientation === 'vertical' ? 50 : 42),
            min: u(28),
```

and replace:

```ts
          if (lines.length) heading = { role: 'text', rect: union(lines), overflow: overflows(h) };
```

with:

```ts
          if (lines.length)
            heading = {
              role: 'text',
              rect: union(lines),
              overflow: overflows(h),
              font: drawnFont(h),
              text: 'body',
            };
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/render/render.test.ts -t "body text to 28 px"`
Expected: PASS for `en` and `ko`.

Run: `npx vitest run tests/render/render.test.ts packages/video/test` (in the background)
Expected: PASS: the diagram edge-label test (its long label still clips, its nodes are taller), the title-over-capture heading test, and the CJK tests still pass.

- [ ] **Step 10: Commit**

```bash
npx biome check --write packages/video/src/runtime tests/render/render.test.ts
npm run lint && npm run typecheck
git add packages/video/src/runtime tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Hold body text to 28 px and grow short cards to fill the frame

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 6: The `backend-slim-request` benchmark example

**Files:**
- Create: `examples/backend-slim-request/change.yml`
- Create: `examples/backend-slim-request/base/package.json`, `base/.covi/config.yml`, `base/src/documents.js`, `base/src/store.js`, `base/src/request.js`, `base/src/reader.js`, `base/scripts/measure.js`, `base/test/request.test.js`, `base/test/reader.test.js`
- Create: `examples/backend-slim-request/head/src/request.js`, `head/src/reader.js`, `head/scripts/measure.js`, `head/test/request.test.js`, `head/test/reader.test.js`
- Modify: `tests/examples.test.ts:62-70`, `tests/cli.test.ts:392`, `tests/__snapshots__/english-baseline.test.ts.snap` (new entries only)
- Modify: `docs/getting-started.md:159-172`, `docs/contributing.md:134`, `README.md:167`

**Interfaces:**
- Consumes: `listExamples`, `materializeExample`, `ExampleSchema` (existing, `packages/cli/src/examples.ts`).
- Produces: the example `backend-slim-request` (branch `fix/slim-review-request`), whose demo command prints, at base, `request bytes: 70406` / `chunks: 4` / `reader steps: 28` / `timeouts: 1` and, at head, `request bytes: 9907` / `chunks: 1` / `reader steps: 10` / `timeouts: 0` (request bytes −86%). Its expectations: intent `bug-fix`, demonstration `high`, video `true`, template `bug-fix`, rules `[]`, verdict `looks-good` (measured by running Covi's heuristic analysis on a prototype of exactly these files while writing this plan; Step 6 re-checks).

Biome ignores `examples/*/base` and `examples/*/head`: write these files exactly as below (2 spaces, single quotes, semicolons).

- [ ] **Step 1: Write the base tree**

`examples/backend-slim-request/base/package.json`:

```json
{
  "name": "review-pipeline",
  "version": "2.4.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

`examples/backend-slim-request/base/.covi/config.yml`:

```yaml
demo:
  commands:
    - name: Measure the review request
      run: node scripts/measure.js
test:
  command: node --test
video:
  mode: standard
```

`examples/backend-slim-request/base/src/documents.js`:

```js
/**
 * Fixture documents for the review pipeline. They are generated rather than stored, so the
 * repository stays small, and every character follows from a document's position, so every run
 * builds the same documents.
 */

const SENTENCES = [
  'Retries back off exponentially and stop after the fifth attempt.',
  'Every change to this policy needs a second reviewer.',
  'Sessions expire after thirty minutes without activity.',
  'Rate limits apply per account, not per address.',
  'Audit entries are kept for a year and then archived.',
  'Search indexes rebuild overnight from the primary store.',
  'Digest emails go out at nine in the morning, local time.',
  'Owners confirm the summary before a document is published.',
  'Defaults are documented next to the field they apply to.',
  'A record that fails validation comes back with its errors.',
  'Workers take queued jobs in the order they arrived.',
  'Budgets are reviewed at the end of every quarter.',
];

const TITLES = [
  'Payment retries',
  'Session cookies',
  'Rate limits',
  'Audit log retention',
  'Search index rebuilds',
  'Email digests',
];

/** About how long each document's body is, in bytes. */
const SIZES = [13800, 9200, 11400, 7600, 11900, 5400];

/** Numbered sections of policy text, `bytes` long or a little more. */
function prose(seed, bytes) {
  const sections = [];
  let size = 0;
  for (let n = 1; size < bytes; n++) {
    const text = `${n}. ${SENTENCES[(seed + n * 5) % SENTENCES.length]} ${SENTENCES[(seed + n * 7 + 3) % SENTENCES.length]}`;
    sections.push(text);
    size += text.length + 1;
  }
  return sections.join('\n');
}

/** The documents a review covers. */
export function fixtureDocuments() {
  return TITLES.map((title, i) => ({
    id: `doc-${String(i + 1).padStart(3, '0')}`,
    title,
    body: prose(i * 3, SIZES[i]),
  }));
}

/** What the reader is asked to check: the guide every review request carries. */
export function reviewGuide() {
  return prose(11, 9300);
}
```

`examples/backend-slim-request/base/src/store.js`:

```js
/** The document store: the request builder and the reader both look documents up here. */
export function createStore(documents) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  return {
    ids: () => [...byId.keys()],
    get(id) {
      const document = byId.get(id);
      if (!document) throw new Error(`Unknown document: ${id}`);
      return document;
    },
  };
}
```

`examples/backend-slim-request/base/src/request.js`:

```js
import { reviewGuide } from './documents.js';

/** The largest message the reader worker accepts, in bytes. */
export const CHUNK_LIMIT = 24 * 1024;

export function messageBytes(message) {
  return Buffer.byteLength(JSON.stringify(message));
}

/**
 * Splits a review into messages under CHUNK_LIMIT: the guide goes in the first one, then each
 * item joins the current message while it still fits.
 */
function chunk(review, key, items) {
  const messages = [{ kind: 'review', review, part: 1, guide: reviewGuide(), [key]: [] }];
  for (const item of items) {
    let current = messages.at(-1);
    const grown = { ...current, [key]: [...current[key], item] };
    if (messageBytes(grown) > CHUNK_LIMIT && (current.guide || current[key].length)) {
      current = { kind: 'review', review, part: messages.length + 1, [key]: [] };
      messages.push(current);
    }
    current[key].push(item);
  }
  return messages.map((message) => ({ ...message, parts: messages.length }));
}

/** The messages that ask the reader to review these documents, each document in full. */
export function buildReviewRequest(store, ids) {
  return chunk(
    'review-1',
    'documents',
    ids.map((id) => store.get(id)),
  );
}
```

`examples/backend-slim-request/base/src/reader.js`:

```js
import { messageBytes } from './request.js';

/** The reader parses a message 4 KB per step. */
export const PAGE_BYTES = 4096;
/** Steps one call may take before the worker gives up on it. */
export const STEP_BUDGET = 8;

/**
 * Runs the reader worker over a review's messages, one call each: it parses the message, indexes
 * every document in it, and merges the part with the ones before it.
 */
export function runReader(messages) {
  let steps = 0;
  let timeouts = 0;
  const call = (cost) => {
    steps += cost;
    if (cost > STEP_BUDGET) timeouts++;
  };
  for (const message of messages) {
    const parse = Math.ceil(messageBytes(message) / PAGE_BYTES);
    call(parse + message.documents.length + (message.part > 1 ? 1 : 0));
  }
  return { steps, timeouts };
}
```

`examples/backend-slim-request/base/scripts/measure.js`:

```js
// Builds the request for the fixture review, runs the reader over it, and prints what it measured.
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());
const messages = buildReviewRequest(store, store.ids());
const { steps, timeouts } = runReader(messages);

console.log(`request bytes: ${messages.reduce((n, m) => n + messageBytes(m), 0)}`);
console.log(`chunks: ${messages.length}`);
console.log(`reader steps: ${steps}`);
console.log(`timeouts: ${timeouts}`);
```

`examples/backend-slim-request/base/test/request.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { buildReviewRequest, CHUNK_LIMIT, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());

test('splits the review into messages under the chunk limit', () => {
  const messages = buildReviewRequest(store, store.ids());
  assert.ok(messages.length > 1);
  for (const message of messages) assert.ok(messageBytes(message) <= CHUNK_LIMIT);
  assert.deepEqual(
    messages.map((m) => [m.part, m.parts]),
    messages.map((_, i) => [i + 1, messages.length]),
  );
});

test('carries every document in full, in order', () => {
  const sent = buildReviewRequest(store, store.ids()).flatMap((m) => m.documents);
  assert.deepEqual(sent, store.ids().map((id) => store.get(id)));
});
```

`examples/backend-slim-request/base/test/reader.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest } from '../src/request.js';
import { createStore } from '../src/store.js';

test('reads every message, counting its steps', () => {
  const store = createStore(fixtureDocuments());
  const messages = buildReviewRequest(store, store.ids());
  const { steps } = runReader(messages);
  assert.ok(steps >= messages.length + fixtureDocuments().length);
});

test('builds the same documents every time', () => {
  assert.deepEqual(fixtureDocuments(), fixtureDocuments());
});
```

- [ ] **Step 2: Run the base tree**

Run: `cd examples/backend-slim-request/base && node --test && node scripts/measure.js; cd -`
Expected: `# pass 4`, `# fail 0`, then exactly:

```
request bytes: 70406
chunks: 4
reader steps: 28
timeouts: 1
```

- [ ] **Step 3: Write the head overlay**

`examples/backend-slim-request/head/src/request.js`:

```js
import { reviewGuide } from './documents.js';

/** The largest message the reader worker accepts, in bytes. */
export const CHUNK_LIMIT = 24 * 1024;

export function messageBytes(message) {
  return Buffer.byteLength(JSON.stringify(message));
}

/**
 * Splits a review into messages under CHUNK_LIMIT: the guide goes in the first one, then each
 * item joins the current message while it still fits.
 */
function chunk(review, key, items) {
  const messages = [{ kind: 'review', review, part: 1, guide: reviewGuide(), [key]: [] }];
  for (const item of items) {
    let current = messages.at(-1);
    const grown = { ...current, [key]: [...current[key], item] };
    if (messageBytes(grown) > CHUNK_LIMIT && (current.guide || current[key].length)) {
      current = { kind: 'review', review, part: messages.length + 1, [key]: [] };
      messages.push(current);
    }
    current[key].push(item);
  }
  return messages.map((message) => ({ ...message, parts: messages.length }));
}

/**
 * The messages that ask the reader to review these documents: which ones, by id, title, and
 * size. The reader fetches each document from the store itself.
 */
export function buildReviewRequest(store, ids) {
  return chunk(
    'review-1',
    'refs',
    ids.map((id) => {
      const { title, body } = store.get(id);
      return { id, title, bytes: Buffer.byteLength(body) };
    }),
  );
}
```

`examples/backend-slim-request/head/src/reader.js`:

```js
import { messageBytes } from './request.js';

/** The reader parses a message 4 KB per step. */
export const PAGE_BYTES = 4096;
/** Steps one call may take before the worker gives up on it. */
export const STEP_BUDGET = 8;

/**
 * Runs the reader worker over a review's messages. Each message is one call: it parses the list
 * of documents and merges the part with the ones before it. Then the reader fetches each document
 * from the store, one call and one step each, since the store hands it over already parsed.
 */
export function runReader(messages, store) {
  let steps = 0;
  let timeouts = 0;
  const call = (cost) => {
    steps += cost;
    if (cost > STEP_BUDGET) timeouts++;
  };
  for (const message of messages) {
    const parse = Math.ceil(messageBytes(message) / PAGE_BYTES);
    call(parse + 1 + (message.part > 1 ? 1 : 0));
    for (const ref of message.refs) {
      const document = store.get(ref.id);
      if (Buffer.byteLength(document.body) !== ref.bytes)
        throw new Error(`${ref.id} changed after the request was built`);
      call(1);
    }
  }
  return { steps, timeouts };
}
```

`examples/backend-slim-request/head/scripts/measure.js`: the base file with one line changed, `const { steps, timeouts } = runReader(messages);` → `const { steps, timeouts } = runReader(messages, store);`:

```js
// Builds the request for the fixture review, runs the reader over it, and prints what it measured.
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());
const messages = buildReviewRequest(store, store.ids());
const { steps, timeouts } = runReader(messages, store);

console.log(`request bytes: ${messages.reduce((n, m) => n + messageBytes(m), 0)}`);
console.log(`chunks: ${messages.length}`);
console.log(`reader steps: ${steps}`);
console.log(`timeouts: ${timeouts}`);
```

`examples/backend-slim-request/head/test/request.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { buildReviewRequest, CHUNK_LIMIT, messageBytes } from '../src/request.js';
import { createStore } from '../src/store.js';

const store = createStore(fixtureDocuments());

test('asks for each document by id, title, and size', () => {
  const [message] = buildReviewRequest(store, store.ids());
  assert.deepEqual(
    message.refs,
    fixtureDocuments().map((d) => ({ id: d.id, title: d.title, bytes: Buffer.byteLength(d.body) })),
  );
});

test('leaves the documents out, so the review fits in one message', () => {
  const messages = buildReviewRequest(store, store.ids());
  assert.equal(messages.length, 1);
  assert.ok(messageBytes(messages[0]) <= CHUNK_LIMIT);
  assert.ok(!JSON.stringify(messages).includes(fixtureDocuments()[0].body));
});
```

`examples/backend-slim-request/head/test/reader.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDocuments } from '../src/documents.js';
import { runReader } from '../src/reader.js';
import { buildReviewRequest } from '../src/request.js';
import { createStore } from '../src/store.js';

test('fetches each document itself, every call within the step budget', () => {
  const store = createStore(fixtureDocuments());
  const { steps, timeouts } = runReader(buildReviewRequest(store, store.ids()), store);
  assert.equal(timeouts, 0);
  assert.ok(steps >= fixtureDocuments().length);
});

test('stops at a document that changed after the request was built', () => {
  const store = createStore(fixtureDocuments());
  const messages = buildReviewRequest(store, store.ids());
  const changed = fixtureDocuments().map((d, i) => (i === 0 ? { ...d, body: `${d.body} More.` } : d));
  assert.throws(() => runReader(messages, createStore(changed)), /doc-001 changed/);
});

test('builds the same documents every time', () => {
  assert.deepEqual(fixtureDocuments(), fixtureDocuments());
});
```

- [ ] **Step 4: Run the head revision**

Run:

```bash
HEAD_TREE=$(mktemp -d)
cp -R examples/backend-slim-request/base/. "$HEAD_TREE" && cp -R examples/backend-slim-request/head/. "$HEAD_TREE"
(cd "$HEAD_TREE" && node --test && node scripts/measure.js)
rm -rf "$HEAD_TREE"
```

Expected: `# pass 5`, `# fail 0`, then exactly:

```
request bytes: 9907
chunks: 1
reader steps: 10
timeouts: 0
```

- [ ] **Step 5: Write `change.yml` and list the example**

`examples/backend-slim-request/change.yml`:

```yaml
title: Send document references instead of full documents to the reader
description: A backend change with nothing to see. The review request embedded every document in full, so it was split into chunks at the size limit and the reader worker timed out on one of them. Now the request lists each document's id, title, and size, and the reader fetches each document itself. `node scripts/measure.js` prints the request's size, its chunks, the reader's steps, and its timeouts at both revisions. It is the benchmark for review videos of changes without a UI.
branch: fix/slim-review-request
commits:
  - message: "fix(review): send document references so the reader fetches each document itself"
expect:
  intent: bug-fix
  demonstration: high
  video: true
  template: bug-fix
  rules: []
  verdict: looks-good
```

In `tests/examples.test.ts`, replace:

```ts
  it('ships the five reference scenarios', () => {
    expect(examples.map((e) => e.name)).toEqual([
      'api-users-pagination',
      'bugfix-cli-slugify',
```

with:

```ts
  it('ships the six reference scenarios', () => {
    expect(examples.map((e) => e.name)).toEqual([
      'api-users-pagination',
      'backend-slim-request',
      'bugfix-cli-slugify',
```

In `tests/cli.test.ts`, replace `expect(covi(['examples', '--json']).json()).toHaveLength(5);` with `expect(covi(['examples', '--json']).json()).toHaveLength(6);`.

- [ ] **Step 6: Confirm the expectations are what Covi decides**

Run: `npx vitest run tests/examples.test.ts`
Expected: PASS, including `backend-slim-request > is understood, reviewed, and judged as expected` and `drafts valid storyboards for short and standard videos`.

Then check Covi's own words on a real repository:

```bash
EX=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$EX/repo"
./bin/covi.mjs review --repo "$EX/repo" --json > "$EX/review.json"
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(JSON.stringify({ verdict: r.review?.verdict ?? r.verdict, findings: (r.review?.findings ?? r.findings ?? []).length }))' "$EX/review.json"
```

Expected: verdict `looks-good`, 0 findings (if the result object nests these differently, read `.covi/runs/<id>/review.json` in the repository instead). If any expectation differs from what Covi decides, set `change.yml` to Covi's actual value, unless a rule finding is right about the example's own code: then fix the example code and rerun Steps 2, 4, and 6. Record any change in the report as a ruling. Then `rm -rf "$EX"`.

- [ ] **Step 7: Write the English baseline snapshots for the new example**

Run: `CI= npx vitest run tests/english-baseline.test.ts`
Expected: PASS, with `Snapshots  N written` (new entries for `backend-slim-request` only).

Run: `git diff --numstat tests/__snapshots__/english-baseline.test.ts.snap`
Expected: deletions `0` (only added lines). If any existing snapshot changed, stop and investigate: this task must not change other examples' output.

- [ ] **Step 8: Update the documents that enumerate examples**

`README.md`: `covi examples                                           # the five example changes` → `covi examples                                           # the six example changes`.

`docs/contributing.md`: `Add your example's name to the list in the test named "ships the five reference scenarios".` → `… "ships the six reference scenarios".`

`docs/getting-started.md`: `Covi ships five realistic example changes.` → `Covi ships six realistic example changes.`; in the console listing, after the `api-users-pagination` entry's `expect:` line, insert:

```console
backend-slim-request       Send document references instead of full documents to the reader
                           expect: bug-fix, demo high, video yes
```

and after the paragraph that ends `It explains why and suggests \`--force\`.`, add:

```markdown
The `backend-slim-request` example is a backend change with nothing to see: Covi demonstrates it by running `node scripts/measure.js` at both revisions, which prints the request's size, its chunks, the reader's steps, and its timeouts.
```

- [ ] **Step 9: Run the affected suites**

Run: `npx vitest run tests/examples.test.ts tests/cli.test.ts tests/english-baseline.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npm run lint && npm run typecheck
git add examples/backend-slim-request tests/examples.test.ts tests/cli.test.ts tests/__snapshots__/english-baseline.test.ts.snap README.md docs/contributing.md docs/getting-started.md
git commit -m "$(cat <<'EOF'
Add the backend-slim-request benchmark example

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 7: Render the benchmark and check the new QC entries

**Files:**
- Modify: `tests/render/render.test.ts` (the `covi video (full pipeline)` describe, `:1153-1172`)

**Interfaces:**
- Consumes: the example (Task 6); the four checks in `runQc` (Task 3); the component sizing (Tasks 4–5).
- Produces: the benchmark in the full-pipeline render list, its `qc.json` asserted to carry `text-size`, `empty-frame`, `monotony`, and `transition-variety`.

- [ ] **Step 1: Render the example once, by hand**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/video.json"
```

Run the `covi video` line in the background (it captures the demo at both revisions, synthesizes narration with the system voice, and renders 1080p; several minutes) and wait for it to exit. Then:

```bash
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const qc = JSON.parse(fs.readFileSync(require("path").join(r.runDir, "video", "qc.json"), "utf8"));
console.log(r.runDir, r.video.rendered, qc.status);
for (const c of qc.checks.filter((c) => ["text-size", "empty-frame", "monotony", "transition-variety", "text-fits", "captions-clear-of-content"].includes(c.id)))
  console.log(c.id, c.status, c.message);
' "$RENDER/video.json"
```

Expected: `rendered` true, `qc.status` not `fail`, and one line each for `text-size`, `empty-frame`, `monotony`, and `transition-variety` (`pass` or `warn`), plus `text-fits` and `captions-clear-of-content` passing.

- [ ] **Step 2: Look at it as a viewer**

Open `<runDir>/video/contact-sheet.jpg` and `<runDir>/video/poster.png` with the Read tool. Check: the terminal before/after shows the measured numbers in large type (around 44 px tall at 1080p), the code card fills most of the frame, no card sits in a thin band, nothing overlaps the captions or the narrator. Record in the report what each of the four new checks said and what the sheet shows.

If the render shows a defect in this branch's sizing (clipped text, a card over the captions, text under the floor that the checks missed), write a failing render test in `tests/render/render.test.ts` that reproduces it with `compose`, fix the owning component, and commit that fix separately before Step 3.

- [ ] **Step 3: Add the benchmark to the full-pipeline render tests**

In `tests/render/render.test.ts`, replace the `covi video (full pipeline)` describe with:

```ts
describe.skipIf(!available || !fullRenders)('covi video (full pipeline)', () => {
  for (const [example, flags] of [
    ['ui-comment-composer', ['--short', '--duration', '30s']],
    ['api-users-pagination', ['--standard']],
    // The benchmark for changes with nothing to see: a command's output before and after, and code.
    ['backend-slim-request', ['--standard']],
  ] as const) {
    it(`renders ${example}`, async () => {
      const dir = await materializeExample((await listExamples()).find((e) => e.name === example)!);
      dirs.push(dir);
      const out = execFileSync(
        'node',
        ['bin/covi.mjs', 'video', '--repo', dir, ...flags, '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 },
      );
      const result = JSON.parse(out) as {
        runDir: string;
        video: { rendered: boolean; qc: string; seconds: number };
      };
      expect(result.video.rendered).toBe(true);
      expect(result.video.qc).not.toBe('fail');
      // Every render is checked for small text, empty frames, and monotony.
      const qc = JSON.parse(readFileSync(join(result.runDir, 'video', 'qc.json'), 'utf8')) as {
        checks: Array<{ id: string }>;
      };
      expect(qc.checks.map((c) => c.id)).toEqual(
        expect.arrayContaining(['text-size', 'empty-frame', 'monotony', 'transition-variety']),
      );
    }, 600_000);
  }
});
```

- [ ] **Step 4: Run it**

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "renders backend-slim-request"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm -rf "$RENDER"
npx biome check --write tests/render/render.test.ts
npm run lint && npm run typecheck
git add tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Render the benchmark example in the full-pipeline tests

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 8: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md:638-650`
- Modify: `skills/covi-video/SKILL.md:51-58` (the self-review list), `:94` (the code-lines rule), the storyboard rules list
- Modify: `CHANGELOG.md:9` (under `## [Unreleased]`)

**Interfaces:**
- Consumes: everything above (check ids, thresholds, the benchmark's name).
- Produces: documentation only.

- [ ] **Step 1: Document the checks in `docs/video.md`**

In the QC table, after the `narrator-clear-of-content` row, insert:

```markdown
| `text-size` | Where each story scene has settled, code and terminal text is at least 24 px and body text (headings, titles, notes, node labels, area names) at least 28 px at 1080p, measured as drawn and relative to the frame's short side. Chips, file paths, counts, and edge labels are exempt | warn, naming the scene, the kind of text, and its size |
| `empty-frame` | Where each card scene (code, terminal, API, findings, change map, callout, diagram) has settled, its content covers at least 40% of the media region. Captures keep their own aspect ratio, and title and summary cards are not checked | warn, naming the scene and its share |
| `monotony` | No more than two story scenes in a row show the same kind of visual (the outro is not counted) | warn, naming each run |
| `transition-variety` | With four or more story transitions (into each story scene after the first), no one kind covers more than 60% of them | warn, naming the kind and its share |
```

Replace `Covi samples the layout checks at two frames per scene, 35% and 70% of the way through.` with:

```markdown
Covi samples the layout checks at two frames per scene, 35% and 70% of the way through, and once more where each story scene has settled: its entrance and choreography are done and the next scene has not begun to enter. `text-size` and `empty-frame` read only settled frames.

Cards size their text to their content: code and terminal text is as large as its lines allow, from 24 px up to 44 px at 1080p (48 px in 9:16), and shrinks below 24 px (to 13 at least) only when its lines would not fit otherwise, which `text-size` reports. Code, terminal, API, findings, and callout cards cover at least 60% of the media region, with short content in their middle; diagram nodes and change-map rows grow toward it.
```

- [ ] **Step 2: Update the `covi-video` skill**

In `skills/covi-video/SKILL.md`, in the numbered self-review list under **Review it yourself**, append to item 4 (after `trade cards for captured evidence.`):

```markdown
 `monotony` warns when more than two scenes in a row show the same kind of visual, and `transition-variety` when one kind of transition covers more than 60% of the scene changes (with four or more).
```

Insert a new item 5 and renumber the grounding item to 6:

```markdown
5. Can a viewer read every line at a glance? `text-size` names each scene whose code is under 24 px or whose body text is under 28 px at 1080p, and `empty-frame` each card scene whose content fills less than 40% of the frame. Show fewer and shorter lines, put more of the subject in the scene, or merge a thin scene into the next.
```

Replace the **Code lines must fit.** bullet with:

```markdown
- **Code lines must fit.** Code renders as large as its lines allow, up to 48 px at 1080p in 9:16 (44 in 16:9), and QC's `text-size` warns under 24 px. That means lines of about 54 characters at most in 9:16 (about 108 in 16:9), and about 24 lines in 9:16 (14 in 16:9): Covi sizes the code to fit most of its lines, so longer lines make all of them smaller, and a line longer than most is cut off with an ellipsis. Choose lines that fit.
```

In the **Storyboard rules** list, after the **Transitions** bullet, add:

```markdown
- **Vary the picture.** No more than two scenes of one kind in a row (two code cards, then the output or a capture), and no one transition for more than 60% of the scene changes: `cut` when the same subject continues, `push` for the next step, `wipe` from before to after. QC's `monotony` and `transition-variety` warn otherwise.
```

- [ ] **Step 3: Add the changelog line**

In `CHANGELOG.md`, under `## [Unreleased]` (one blank line before and after), add:

```markdown
- Video cards size their text to their content and fill the frame (code and terminal text up to 44 px at 1080p, 48 in 9:16), QC warns on text under 24 px (code) or 28 px (body), empty frames, more than two scenes of one kind in a row, and one transition kind over 60%, and `examples/backend-slim-request` is the benchmark for videos of changes without a UI.
```

- [ ] **Step 4: Run every check**

Run (in the background, and wait): `npm run check`
Expected: exit 0 (lint, typecheck, agents check, and the whole `npm test`).

Run (in the background, and wait; it renders several videos): `npm run test:render`
Expected: PASS, including `the timing grammar (full pipeline) > renders a storyboard that uses every timing field`, which requires every check except `still` to pass: its storyboard has five different transitions, no repeated kind, a three-line code card (card-filled), and only exempt captures, so the new checks pass there. If one of the new checks warns in that test, read its message: a sizing bug gets fixed in the component (with a render test); an honest warning about that test's storyboard gets the storyboard fixed, never the check loosened. Report either way.

- [ ] **Step 5: Commit**

```bash
git add docs/video.md skills/covi-video/SKILL.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document the density and monotony checks

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

## Self-review

- **Spec coverage (§8, owner's scope):** type sized to content (code/terminal 24 → 44/48, short block large): Tasks 1, 4. Cards use the frame (≥ 60% when content allows, centered): Tasks 1, 4, 5. `LayoutItem.font`/`text`: Task 1, reported in Tasks 4–5. `text-size`, `empty-frame` (settled frames): Tasks 1–2. `monotony` (3+ consecutive story scenes, outro excluded), `transition-variety` (> 60%, ≥ 4): Task 3. All warn (R-007): Tasks 2–3. Benchmark example (base tree, head overlay, `change.yml`, demo command with the four exact lines, test command and tests at both revisions, numbers from its own code, ~85% fewer bytes): Task 6. Render once and check `qc.json`: Task 7. Docs, skill, CHANGELOG, `npm run check`, `npm run test:render`: Task 8. §15's "QC checks over rendered layouts" render tests: Tasks 4, 5, 7. §14 security: no new agent-authored input; the runtime still sets text with `textContent`.
- **Placeholders:** none; every code step carries the code. Task 6 Step 6 tells the implementer what to do if Covi's decision differs, with the measured expectation already filled in.
- **Type consistency:** `codeFont(fit, orientation, unit)`, `cardHeight(region, width, content)`, `CARD_FILL`, `TEXT_FLOOR`, `CODE_FALLBACK` (Task 1) are used with those signatures in Tasks 4–5; `settledSpan`/`settledFrame` (Task 1) in Task 2 and the render tests; `DensityTimeline`, `textSizeCheck`, `emptyFrameCheck` (Task 2) and `densityChecks` (Task 3) in Tasks 4–5; `drawnFont`/`smallestFont` (Task 4) in Task 5; `compose(…, options)` and `settled` (Task 4) in Task 5.
- **Review Focus:** each of the five lines has its test in the owning task (Task 4 loop over sizes; Task 5 en/ko; Task 3 "measured nothing"; Tasks 1–2 short scene; Task 3 missing kinds and the outro).

## Rulings

- Ruling: the code floor is a target, not a clamp: text that cannot fit at 24 units shrinks to 13 (the smallest terminal text 0.2.0 drew) and `text-size` warns — clipping lines would hide the change, and storyboards may hold 40 lines of code — a video can ship with small code after a warning.
- Ruling: cards reach 60% of the media region by construction (code, terminal, API, findings, callout; diagram nodes and change-map rows grow within caps), short code is centered in its card, and a terminal keeps its text at the top; `empty-frame` verifies, as `captions-clear-of-content` verifies the caption layout — the owner asked that cards use the frame, and §8 says the card grows to use the media region — a one-line code scene now shows as one large line in a large card instead of being flagged; B3 and B7 make such scenes richer.
- Ruling: text classes as in the "Text classes, per component" table; a layout item reports the smallest checked font among its texts (a finding card: the smaller of title and note) — `LayoutItem` carries one `font`, and adding items would change the narrator and caption checks — two body sizes in one card are reported as one.
- Ruling: `text-size` and `empty-frame` read only reports inside a story scene's settled span, and the renderer samples one more frame per story scene at `settledFrame` — entrances fade and scale, so sizes mid-entrance are not what a viewer reads — one more `layout()` call per scene per render.
- Ruling: `empty-frame` checks card kinds only (code, terminal, api, findings, change-map, callout, diagram); captures, title over a capture, title and summary cards, and the outro are exempt — a capture's size follows its image's aspect ratio, and title and summary cards are laid out around the fox — a small capture is not flagged.
- Ruling: `monotony` compares visual kinds exactly, so code and terminal are different kinds; `leadKind` is exported for B2 to refine with direction shots — the owner's words are "same visual kind" — alternating dark code and terminal cards do not warn; a family map is a one-line change.
- Ruling: story transitions are the transitions into story scenes after the first; a scene without a kind counts as a fade; the outro's own fade is never counted — timelines from before kinds faded every scene in — none expected.
- Ruling: before and after terminal windows share one font size — they are read side by side as a comparison — the shorter side may be smaller than it could be alone.
- Ruling: body text raised to the floor: callout body 28 (16:9) / 32 (9:16), finding note 28/32, code caption 28 in both (its band grows from 72 to 88 units in 16:9), diagram node label 28/32, change-map area name 28/32, summary points 28 in 16:9, scene heading fit floor 28 (was 26); callout width 1400 units in 16:9 (was 1100) so 60% is reachable without a card taller than wide — every text a viewer must read reaches 28 px — some long headings clip at two lines one size sooner (`text-fits` warns).
- Ruling: diagram nodes grow toward 60% of the region but never taller than wide, keeping two per row in 9:16; change-map rows grow to at most twice their base height — taller boxes would read as empty, and the edge-label render test pins the diagram grid — a two-node 9:16 diagram fills about 42% and a one-area change map still warns.
- Ruling: the benchmark's commit is `fix(review): …` and its config sets `video.mode: standard`; Covi decides intent bug-fix, demonstration high (a configured demo command), video yes, template bug-fix, no rules, looks-good (measured by running Covi's analysis on a prototype of these exact files) — the reader timing out is the bug the change fixes, and §17 renders the benchmark at 16:9 — if the owner wanted a performance story, the commit type is a one-word change (the template becomes cli-change).
- Ruling: the example's model: the reader parses 4 KB per step, a call over 8 steps times out, a 24 KB chunk limit, and a fetched document costs one step because the store hands it over parsed; base 70406 bytes / 4 chunks / 28 steps / 1 timeout, head 9907 / 1 / 10 / 0 (−86% bytes) — simple, deterministic, and every number is computed by the example's own code — none; the numbers are the example's.
- Ruling: the benchmark joins the full-pipeline render tests — B2–B7 and A2 iterate on it — `npm run test:render` takes a few minutes longer.
- Ruling: QC messages stay English literals, like every existing QC message — `qc.json` is a developer artifact, and the catalogs carry text drawn in videos and written in comments — localizing QC would be a later, separate pass.
- Ruling: the CHANGELOG line goes directly under `## [Unreleased]` without a subsection — one line per PR, as the program's process says — the release PR regroups it.
