# PR B5 — Flow verbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backend change can be shown as a story: a direction's `node`s, `packet`s, and `pile`s, with the verbs `flow`, `split`, `merge`, `stack`, and `count-up`, draw a packet travelling an edge between nodes, one thing breaking into a measured number of pieces and pulling back into one, items piling up to a measured count, and a counter counting up from zero; Covi's default director turns diagram scenes into flows and stages a terminal scene's measured counts beside its key number, so the benchmark's request visibly splits into its 4 chunks and merges into 1 while its reader steps pile up, 28 before and 10 after.

**Architecture:** A DOM-free geometry module, `packages/video/src/runtime/routes.ts` (edge routes between node boxes, a packet's place along them, a split's fan, a pile's grid), is shared by the runtime, the camera's per-frame follow, Node, and tests. The runtime's `runtime/direction/flow.ts` draws a shot's edges and dots in a layer under its elements, packets as pills that travel or break into pieces, node splits, and piles; B4's counter gains `count-up`. The direction file gains `packet` and `pile` elements and the five verbs (strict, bounded, every count from `metric:` evidence, R-013), which `direction/flow.ts` checks and resolves (a packet a flow carries takes no slot; a merge or a count-up that phrases put out of order is dropped; flow verbs stretch toward the next beat). `direction/staging.ts` is the default director's: diagram scenes become nodes with a flow along each edge, and a terminal scene whose key metric B4 counts stages the command's other counts as a split packet and a pile in place of the raw output.

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, no build step), Zod 4, Vitest 5, Playwright Chromium, ffmpeg, Biome; the browser runtime is bundled by esbuild.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` — §9 (flow verbs), §4.2–§4.8 (the `node`, `packet`, and `pile` elements; the `flow`, `split`, `merge`, `stack`, and `count-up` verbs; validation, resolution, the default director), §5 (canvas), §8 (lead kinds: flow-verb shots count as `flow`), §14–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-007, R-012, R-013, R-015, R-016, R-017, R-019; R-020/R-021 for the pre-flight scan). Code worktree: `~/projects/covi-direction`, branch `flow-verbs`, started from the latest `main` after B1, B2, B3, and B4 merged.

## Global Constraints

Every task's requirements include these. Values are copied from the spec, the rulings, and `AGENTS.md`.

- TypeScript on Node 22.18+, run without a build step: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Dependency direction unchanged: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Browser runtime files (`packages/video/src/runtime/**`) import only DOM-free shared files (`timeline/types.ts`, `timeline/cues.ts`, `runtime/*`, `@covi/brand`) and never `@covi/core`. Node code and files under `tests/` import a runtime file only when it is DOM-free: `runtime/layout.ts`, B4's `runtime/numbers.ts`, and this PR's `runtime/routes.ts` (which therefore must not import `runtime/anim.ts`, whose helpers carry DOM types).
- Runtime: every visual property is a pure function of the frame time. No `Date`, no `Math.random`, no CSS transitions or animations, no `Intl`. All text is set with `textContent` (`el(…, text)`), never `innerHTML`.
- Spec §9 and §4.3, verbatim: edges are drawn between node rects (straight or one elbow); packets travel along the edge path with an ease; splits fan pieces out from the source's box; merges pull them back; piles stack items in a grid of up to 12, then the counter shows the real number; `flow` (`from`, `to` nodes, optional `packet`: a packet travels the edge between two nodes, edge drawn if absent); `split` (`element` packet or node, `count`: metric id, `side`: one thing breaks into N pieces); `merge` (`element`: a split result or pile: the pieces collapse into one); `stack` (`element` a pile: items pile up one by one to the metric's count); `count-up` (`element` a metric, `side`: counter counts from 0 to one side's value); `pile` (content: a `metric:` item's value; optional `label`); `packet` (optional `label`).
- R-013: counts drawn by `split`, `stack`, and `pile` come only from metric evidence. No field of the direction file holds a number; every object is `z.strictObject` (unknown keys rejected); every list, string, and number is bounded; `DIRECTION_LIMITS` stays the single bounds source (its `drawnItems: 12` now reads `DRAWN_ITEMS` from `runtime/routes.ts`, which the runtime also draws with). `video/direction.json` stays `schemaVersion: 1` and `video/timeline.json` stays `version: 1` (additive). Never change any `version` field.
- Labels (`packet.label`, `pile.label`) use B2's `LabelSchema` exactly as merged (R-015 allowlist, R-019 CJK punctuation and NFKC scheme checks). Everything resolved is redacted (`redactDeep`) before it reaches `timeline.json`.
- Text for people: no new catalog keys. The runtime captions sides with the timeline's existing `labels.before` / `labels.after`; a pile's and a split's names are the run's own words (the metric item's label, or the diff's totals in `labels.stats`, through B4's `metricName`); the default director's node names are the storyboard diagram's own labels. Validation messages, QC messages, and CLI logs stay English.
- QC checks this program adds warn; only `out-of-frame` (B6) and `music-jump` (A1) fail (R-007). This PR adds no QC check. `video.direction: off` renders exactly as 0.2.0 did (R-016).
- CHANGELOG: one line under `## [Unreleased]`, in its `### Added` subsection (R-017).
- Commits: default git identity (never Claude as author or co-author); concise English message ending with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Before each commit: `npx biome check --write <changed files>`, `npm run lint`, `npm run typecheck`. Each task leaves `npm run check` green.
- Long commands (full `npm test`, `npm run check`, `npm run test:render`, `covi video`) run in the background; wait for them to finish before reporting.

## B1–B4 names this plan builds on

B1–B4 merge before this PR starts. Plans: `~/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b1-density-checks.md`, `…-b2-direction-canvas.md`, `…-b3-code-morph.md`, `…-b4-metrics.md`. **Before Task 1, run a pre-flight scan of this plan against the merged `main`** (as R-020 and R-021 did for B2 and B4): where a merged name or signature differs from the list below, use the merged one, keep the behavior this plan describes, and record the difference in the task report.

- **B1:** `packages/video/src/density.ts` (`leadKind`, `LOOKS_LIKE`, `CARDS`, `monotonyCheck`, `emptyFrameCheck`); `settledSpan` / `settledFrame` in `timeline/cues.ts`; `drawnFont(node)` in `runtime/components/types.ts`; `LayoutItem.font` / `.text`; the benchmark `examples/backend-slim-request/`, whose demo command `node scripts/measure.js` prints `request bytes: 70406` / `chunks: 4` / `reader steps: 28` / `timeouts: 1` at base and `request bytes: 9907` / `chunks: 1` / `reader steps: 10` / `timeouts: 0` at head; B1's `covi video (full pipeline)` loop in `tests/render/render.test.ts` renders it.
- **B2:** `direction/schema.ts` (`DIRECTION_LIMITS`, `ShotElementSchema`, `ShotBeatSchema`, `LabelSchema`, `PhraseSchema`, `EvidenceRefSchema`, `ElementIdSchema`, `Shot`, `ShotElement`, `ShotBeat`, `DirectionInput`); `direction/sources.ts` (`directionSources`, `DirectionSources`); `direction/refs.ts` (`directionProblems`, the private `elementProblems` with `cites(…)` and `UNKNOWN`); `direction/layout.ts` (`WEIGHT`, `elementSlots`, `shotRegion`); `direction/resolve.ts` (`BEAT_SECONDS`, `Context`, `resolveShot`, `element`, `timeBeats`, `resolveDirection`); `direction/director.ts` (`DirectorInput`, `defaultDirection`, `sceneId`, `cameraBeats`); `direction/plan.ts` (`planDirection`); `grounding.ts` (`sceneEvidence(…, shot?)`); `timeline/types.ts` (`DirectionElement`, `DirectionBeat`, `SceneDirection`, `SceneStaging`, `Rect`, `Point`); `timeline/cues.ts` (`shotSettledAt`); `runtime/direction/elements.ts` (`mountShot`, the private `Drawn`, `draw`, `textBox`, `appear`); `tests/direction-security.test.ts`; `packages/video/test/direction-schema.test.ts` ("rejects kinds and verbs this PR does not draw").
- **B3:** `draw(element, ctx, drawVisual, span: readonly [number, number])`, where `mountShot` finds "the element's own beat" (the first beat that is neither `reveal` nor `camera` and names it) and passes its span on the element's reveal-shifted clock; `Component.follow?(t)`, `ShotComponent.track(id, t)`, and a `CameraStep` whose `to` may be a function of time, which `cameraSteps` uses for `camera follow`; `refs.ts`'s `ACTS_ON` table and its messages (`<verb> acts on a <kind> element, and "x" is a <actual>`; `"x" already <verb>s at an earlier beat; it <verb>s once`); `timeBeats` ending in an `if` chain (`reveal`, `morph`, …, then `camera`); `BEAT_SECONDS.morph`; the director's per-scene chain `morphShot(scene, i, input) ?? …`.
- **B4:** `MetricShow` and the `metric` `DirectionElement` (`show`, `name`, `unit?`, `from?`, `to`, `decimals`, `delta?`), the `count` `DirectionBeat`; `runtime/numbers.ts` (`CountSpan`, `countProgress`, `tickValue`, `formatNumber`, `COMPARE_LANDS`); `runtime/direction/metric.ts` (`metric(e, ctx, span)`, the private `counter`, `shownValue`, `deltaOpacity`); `direction/metric.ts` (`MetricShotElement`, the private `sides` and `metricName`, `metricProblems`, `countProblem`, `resolveMetric`, `metricChange`, `keyMetric`, `metricShot`); `DirectionSources.metric(id): MetricSource | undefined`; `ACTS_ON.count`; `resolve.ts`'s `COUNT_MIN`, `Context.labels`, the `count` landing on its phrase, and the `countable` filter in `resolveShot`; `director.ts`'s `measuredShot` and `DirectorInput.orientation`; `density.ts`'s `LeadKind`; B4's tests `packages/video/test/director-metric.test.ts` ("directs the benchmark with shots Covi's own checks accept…"), `packages/video/test/numbers.test.ts`, and `tests/cli.test.ts` ("drafts a counter for the benchmark's request bytes…"); B4's benchmark assertions in the full-pipeline render loop.

## Review Focus

The five inputs or conditions the spec implies that a person will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **Phrases that put beats out of the order they were written in** (an agent pins a `merge` to an earlier phrase than its `split`, or a `count-up` that lands after its counter's `count` has started) — the frames must not jump or glitch: the resolver drops the beat that cannot play. Test: Task 3, `direction-flow.test.ts` "drop a merge timed before its split, and a count-up timed after its count".
2. **A split or a pile citing a metric that is not a count** (a ratio of 0.25, zero pieces on the side asked, a side the metric lacks) — refused before rendering with a message naming the value and the side; never drawn as fractional items. Test: Task 3, "name every problem with a flow, a split, a merge, or a stack, all at once".
3. **A count larger than the twelve items Covi draws** (40 chunks) — twelve pieces, and the true count beside them. Tests: Task 1, `routes.test.ts` "fan a split into as many pieces as it counts, twelve at most…" and `tests/render/flow.test.ts` "draws at most twelve pieces, and the count it measured".
4. **A 9:16 video** — a pile's two rows fit their card with nothing overflowing, and the director's benchmark shot still puts the counter above the packet and the pile. Tests: Task 2, "fits two rows in a tall frame"; Task 5, "directs the benchmark … (a tall frame splits the same way)".
5. **Markup in a packet's label, a pile's name, or a split's name (the run's own words)** — drawn as text, no element created, no script run. Tests: Task 1, "sets the agent's label and the run's words as text"; Task 2, "sets a pile's name as text, whatever it holds"; Task 3, `tests/direction-security.test.ts` "cannot smuggle markup, script, or links through a packet or a pile".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/video/src/runtime/routes.ts` (create) | 1 | `DRAWN_ITEMS`, `PER_LINE`, `center`, `textBoxRect`, `edgeRoute`, `routeLength`, `pointAlong`, `arrowHead`, `Leg`, `legProgress`, `legPoint`, `Fan`, `fanOut`, `pileGrid`, `stackCount`, `stackRows` (DOM-free) |
| `packages/video/src/timeline/types.ts` | 1, 2 | `FLOW_VERBS`, `ChangeSide`, the `packet` element, `flow`/`split`/`merge` beats (1); `PileRow`, the `pile` element, `stack`/`count-up` beats (2) |
| `packages/video/src/runtime/direction/flow.ts` (create) | 1, 2 | `nodeBoxes`, `flowSpans`, `mountFlows`, `packet`, `nodeSplit` (1); `pile` (2) |
| `packages/video/src/runtime/direction/elements.ts` | 1, 2 | the flow layer, packets, node splits (1); piles, count-ups (2); `textBox` sized by `textBoxRect` (1) |
| `packages/video/src/runtime/styles.ts` | 1, 2 | `/* Flows */` (1), `/* Piles */` (2) |
| `packages/video/src/runtime/numbers.ts`, `runtime/direction/metric.ts` | 2 | `CountUpSpan`, `counterValue`; the counter counts up |
| `packages/video/src/timeline/cues.ts`, `density.ts` | 1, 2 | packets and piles settle; flow-verb shots lead as `flow` |
| `packages/video/src/direction/flow.ts` (create) | 3 | `beatTargets`, `ridingPackets`, `flowSlots`, `pileProblems`, `flowBeatProblems`, `resolvePile`, `splitCount`, `mergeInto`, `countUpValue` |
| `packages/video/src/direction/schema.ts`, `sources.ts`, `metric.ts`, `refs.ts`, `layout.ts`, `resolve.ts`, `grounding.ts` | 3 | the elements and verbs in the file, their checks, their resolution, the scene's evidence |
| `packages/video/src/direction/staging.ts` (create), `director.ts` | 4, 5 | `diagramShot` (4); `STAGED_COUNT_MAX`, `isStagedCount`, `countShot` (5) |
| `packages/video/src/direction/metric.ts` | 5 | `commandMetrics` (extracted from `keyMetric`) |
| tests (see each task) | 1–6 | unit, render, CLI, and full-pipeline tests |
| docs, `skills/covi-video/SKILL.md`, `CHANGELOG.md` | 7 | documentation |

---

### Task 1: Packets on edges — routes, flows, splits, and merges in the runtime

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (after B4's `MetricShow`; the `DirectionElement` and `DirectionBeat` unions)
- Create: `packages/video/src/runtime/routes.ts`
- Create: `packages/video/src/runtime/direction/flow.ts`
- Modify: `packages/video/src/runtime/direction/elements.ts` (imports, `mountShot`, `draw`, `textBox`)
- Modify: `packages/video/src/runtime/styles.ts` (a `/* Flows */` block at the end of the stylesheet)
- Modify: `packages/video/src/timeline/cues.ts` (`shotSettledAt`)
- Modify: `packages/video/src/density.ts` (`LeadKind`, `LOOKS_LIKE`, `leadKind`)
- Create: `packages/video/test/routes.test.ts`, `packages/video/test/flow-timeline.test.ts`, `tests/render/flow.test.ts`

**Interfaces:**
- Consumes: B2's `DirectionElement`, `DirectionBeat`, `SceneDirection`, `mountShot`, `draw`, `textBox`, `shotSettledAt`, `leadKind`; B3's `span` finder in `mountShot`, `Component.follow`, `ShotComponent.track`; B4's `LeadKind`, `LOOKS_LIKE.metric`, `formatNumber`; `easeInOutCubic`, `easeOutCubic`, `seg` (`runtime/anim.ts`); `el`, `fitText`, `svg` (`runtime/dom.ts`); `drawnFont`, `overflows`, `rectOf` (`components/types.ts`).
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts
  export const FLOW_VERBS: readonly ['flow', 'split', 'merge', 'stack', 'count-up'];
  export type ChangeSide = 'base' | 'head';
  // DirectionElement gains: | { id: string; kind: 'packet'; rect: Rect; label?: string }
  // DirectionBeat gains:
  //   | { verb: 'flow'; from: string; to: string; packet?: string; t: number; seconds: number }
  //   | { verb: 'split'; element: string; count: number; name: string; side: ChangeSide; t: number; seconds: number }
  //   | { verb: 'merge'; element: string; into?: { count: 1; name: string; side: ChangeSide }; t: number; seconds: number }

  // packages/video/src/runtime/routes.ts (DOM-free)
  export const DRAWN_ITEMS = 12;
  export const PER_LINE = 6;
  export function center(r: Rect): Point;
  export function textBoxRect(slot: Rect, unit: number, tall: boolean): Rect;   // B2's node/label box
  export function edgeRoute(a: Rect, b: Rect): Point[];                          // 2 points, or 3 with one elbow
  export function routeLength(route: readonly Point[]): number;
  export function pointAlong(route: readonly Point[], k: number): Point;
  export function arrowHead(route: readonly Point[], size: number): Point[];
  export interface Leg { t: number; seconds: number; route: readonly Point[] }
  export function legProgress(leg: Pick<Leg, 't' | 'seconds'>, t: number): number;   // eased in-out
  export function legPoint(legs: readonly Leg[], t: number, rest: Point): Point;
  export interface Fan { width: number; height: number; offsets: Point[] }
  export function fanOut(count: number, source: { width: number; height: number }, room: number, drop: number): Fan;
  export function pileGrid(count: number, box: { width: number; height: number }, gap: number): Rect[];
  export function stackCount(count: number, k: number): number;
  export function stackRows(k: number, rows: number): number[];

  // packages/video/src/runtime/direction/flow.ts
  export interface Span { t: number; seconds: number }
  export interface SplitSpan extends Span { count: number; name: string; side: ChangeSide }
  export interface MergeSpan extends Span { into?: { count: number; name: string; side: ChangeSide } }
  export interface FlowSpans { split?: SplitSpan; merge?: MergeSpan; legs: Leg[] }   // Task 2 adds `stack?: Span`
  export function nodeBoxes(direction: SceneDirection, ctx: ComponentContext): Map<string, Rect>;
  export function flowSpans(direction: SceneDirection, id: string, boxes: ReadonlyMap<string, Rect>, shift: number): FlowSpans;
  export function mountFlows(direction: SceneDirection, ctx: ComponentContext, boxes: ReadonlyMap<string, Rect>): { update(t: number): void };
  export function packet(e: PacketElement, ctx: ComponentContext, spans: FlowSpans): Component;   // with follow(t)
  export function nodeSplit(node: Component, e: NodeElement, ctx: ComponentContext, spans: FlowSpans & { split: SplitSpan }): Component;
  // DOM: `.layer.flows > svg > path + polygon` (one per edge) and `.fdot` (one per flow without a
  // packet), under the element layers; `.fpacket > .nlabel?`; `.fpiece` (one per drawn piece);
  // `.fbadge > .fside + .fline > (.fname, .fnum)` (the split's count; a second one for what it merges into).

  // packages/video/src/density.ts
  export type LeadKind = TimelineVisual['kind'] | 'metric' | 'flow';
  ```
  Meaning: a `flow` beat's packet travels the route from the `from` node's drawn box to the `to` node's (B2's `textBox` box, which `textBoxRect` computes for both); the first flow along each `from → to` pair draws that edge in behind its packet (or behind a dot when it carries none), and it stays. A `split` breaks a packet apart in place (it hides while split) or emits pieces below a node (which stays), `min(count, 12)` of them, captioned with the side, the name, and the true count. A `merge` pulls the pieces back; with `into`, the caption becomes what it merged into.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  arrowHead,
  DRAWN_ITEMS,
  edgeRoute,
  fanOut,
  legPoint,
  pileGrid,
  pointAlong,
  routeLength,
  stackCount,
  stackRows,
  textBoxRect,
} from '../src/runtime/routes.ts';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('flow routes', () => {
  it('size a node’s box as the runtime draws it, centered in its slot', () => {
    expect(textBoxRect(box(0, 0, 1000, 600), 1, false)).toEqual(box(240, 215, 520, 170));
    expect(textBoxRect(box(0, 0, 1000, 600), 1, true)).toEqual(box(120, 190, 760, 220));
    expect(textBoxRect(box(10, 20, 300, 100), 2, false)).toEqual(box(10, 20, 300, 100));
  });

  it('run straight between boxes that share a row or a column, border to border', () => {
    const a = box(0, 0, 100, 50);
    expect(edgeRoute(a, box(300, 10, 100, 50))).toEqual([
      { x: 100, y: 30 },
      { x: 300, y: 30 },
    ]);
    expect(edgeRoute(box(300, 10, 100, 50), a)).toEqual([
      { x: 300, y: 30 },
      { x: 100, y: 30 },
    ]);
    expect(edgeRoute(a, box(20, 200, 100, 50))).toEqual([
      { x: 60, y: 50 },
      { x: 60, y: 200 },
    ]);
    expect(edgeRoute(box(20, 200, 100, 50), a)).toEqual([
      { x: 60, y: 200 },
      { x: 60, y: 50 },
    ]);
  });

  it('turn once between boxes that share neither, and join overlapping boxes center to center', () => {
    const a = box(0, 0, 100, 50);
    const b = box(300, 200, 100, 50);
    expect(edgeRoute(a, b)).toEqual([
      { x: 100, y: 25 },
      { x: 350, y: 25 },
      { x: 350, y: 200 },
    ]);
    expect(edgeRoute(b, a)).toEqual([
      { x: 300, y: 225 },
      { x: 50, y: 225 },
      { x: 50, y: 50 },
    ]);
    expect(edgeRoute(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual([
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ]);
  });

  it('measure a route and find a point along it by distance', () => {
    const route = edgeRoute(box(0, 0, 100, 50), box(300, 200, 100, 50));
    expect(routeLength(route)).toBe(425);
    expect(pointAlong(route, 0)).toEqual({ x: 100, y: 25 });
    expect(pointAlong(route, 0.5)).toEqual({ x: 312.5, y: 25 });
    expect(pointAlong(route, 250 / 425)).toEqual({ x: 350, y: 25 });
    expect(pointAlong(route, 1)).toEqual({ x: 350, y: 200 });
    expect(pointAlong(route, 7)).toEqual({ x: 350, y: 200 });
  });

  it('point an arrowhead the way the route arrives', () => {
    expect(
      arrowHead(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        10,
      ),
    ).toEqual([
      { x: 100, y: 0 },
      { x: 90, y: 6 },
      { x: 90, y: -6 },
    ]);
  });

  it('carry a packet along its trips, eased, waiting where each one ends', () => {
    const legs = [
      {
        t: 1,
        seconds: 1,
        route: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      {
        t: 3,
        seconds: 1,
        route: [
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ];
    const rest = { x: -5, y: -5 };
    expect(legPoint(legs, 0.5, rest)).toEqual({ x: 0, y: 0 });
    expect(legPoint(legs, 1.5, rest)).toEqual({ x: 50, y: 0 });
    expect(legPoint(legs, 1.25, rest).x).toBeCloseTo(100 * 4 * 0.25 ** 3, 9);
    expect(legPoint(legs, 2.5, rest)).toEqual({ x: 100, y: 0 });
    expect(legPoint(legs, 3.5, rest)).toEqual({ x: 100, y: 50 });
    expect(legPoint(legs, 9, rest)).toEqual({ x: 100, y: 100 });
    expect(legPoint([], 2, rest)).toEqual(rest);
  });
});

describe('splits and piles', () => {
  it('fan a split into as many pieces as it counts, twelve at most, in lines of six', () => {
    const four = fanOut(4, { width: 150, height: 64 }, 1000, 0);
    expect(four.width).toBe(90);
    expect(four.height).toBeCloseTo(44.8, 9);
    expect(four.offsets.map((o) => [o.x, o.y])).toEqual([
      [-175.5, 0],
      [-58.5, 0],
      [58.5, 0],
      [175.5, 0],
    ]);
    const forty = fanOut(40, { width: 150, height: 64 }, 1000, 0);
    expect(forty.offsets).toHaveLength(DRAWN_ITEMS);
    expect(new Set(forty.offsets.map((o) => o.y.toFixed(3)))).toEqual(
      new Set(['-33.600', '33.600']),
    );
    expect(fanOut(0, { width: 150, height: 64 }, 1000, 0).offsets).toEqual([]);
  });

  it('shrink a fan to its room, and drop a node’s pieces below it', () => {
    const tight = fanOut(12, { width: 150, height: 64 }, 300, 0);
    const xs = tight.offsets.map((o) => o.x);
    expect(Math.max(...xs) - Math.min(...xs) + tight.width).toBeCloseTo(300, 9);
    const below = fanOut(3, { width: 200, height: 100 }, 1000, 60);
    expect(below.offsets.map((o) => [o.x, o.y])).toEqual([
      [-156, 95],
      [0, 95],
      [156, 95],
    ]);
  });

  it('lay a pile row out in two lines of six squares, the same size for any count', () => {
    const grid = pileGrid(28, { width: 330, height: 130 }, 10);
    expect(grid).toHaveLength(DRAWN_ITEMS);
    expect(grid[0]!.x).toBe(0);
    expect(grid[0]!.y).toBeCloseTo(40 / 3, 9);
    expect(grid[0]!.width).toBeCloseTo(280 / 6, 9);
    expect(grid[6]!.y).toBeCloseTo(70, 9);
    expect(grid[11]!.x).toBeCloseTo((5 * 340) / 6, 9);
    const four = pileGrid(4, { width: 330, height: 130 }, 10);
    expect(four.map((r) => r.y)).toEqual(Array(4).fill(grid[0]!.y));
    expect(four[3]).toEqual(grid[3]);
    expect(pileGrid(0, { width: 330, height: 130 }, 10)).toEqual([]);
    // A box wider than twelve need: the block sits in its middle.
    expect(pileGrid(1, { width: 600, height: 130 }, 10)[0]).toEqual({
      x: 95,
      y: 0,
      width: 60,
      height: 60,
    });
  });

  it('count a stack up to its true number, and fill rows one after another', () => {
    expect([0, 0.5, 0.99, 1].map((k) => stackCount(28, k))).toEqual([0, 14, 27, 28]);
    expect(stackRows(0.25, 2)).toEqual([0.5, 0]);
    expect(stackRows(0.75, 2)).toEqual([1, 0.5]);
    expect(stackRows(1, 1)).toEqual([1]);
  });
});
```

Create `packages/video/test/flow-timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { leadKind, monotonyCheck } from '../src/density.ts';
import { shotSettledAt } from '../src/timeline/cues.ts';
import type {
  DirectionBeat,
  DirectionElement,
  SceneDirection,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const scene = (id: string, start: number, direction?: SceneDirection): TimelineScene =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end: start + 6,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...(direction ? { direction } : {}),
  }) as TimelineScene;
const shot = (elements: DirectionElement[], beats: DirectionBeat[] = []): SceneDirection => ({
  whole: false,
  elements,
  beats,
});
const a: DirectionElement = { id: 'a', kind: 'node', rect, label: 'Builder' };
const b: DirectionElement = { id: 'b', kind: 'node', rect, label: 'Reader' };
const p: DirectionElement = { id: 'p', kind: 'packet', rect };
const flow: DirectionBeat = { verb: 'flow', from: 'a', to: 'b', packet: 'p', t: 1, seconds: 1.2 };

describe('flows on the timeline', () => {
  it('lead as a flow when a beat stages one, whatever comes first', () => {
    expect(leadKind(scene('s', 0, shot([a, b, p])))).toBe('diagram');
    expect(leadKind(scene('s', 0, shot([a, b, p], [flow])))).toBe('flow');
    expect(leadKind(scene('s', 0, shot([p])))).toBe('flow');
    const split: DirectionBeat = {
      verb: 'split',
      element: 'p',
      count: 4,
      name: 'chunks',
      side: 'base',
      t: 1,
      seconds: 0.9,
    };
    const counter: DirectionElement = {
      id: 'm',
      kind: 'metric',
      rect,
      show: 'counter',
      name: 'request bytes',
      from: 70406,
      to: 9907,
      decimals: 0,
    };
    // The key number first, but the scene stages a flow: it reads as one.
    expect(leadKind(scene('s', 0, shot([counter, p], [split])))).toBe('flow');
    // Three staged scenes in a row are a run like any other.
    expect(
      monotonyCheck({
        scenes: [0, 6, 12].map((t, i) => scene(`s${i}`, t, shot([a, b, p], [flow]))),
      }).status,
    ).toBe('warn');
  });

  it('settle half a second after a packet enters, and once its flows have ended', () => {
    const reveal: DirectionBeat = {
      verb: 'reveal',
      element: 'p',
      style: 'pop',
      t: 0.5,
      seconds: 0.5,
    };
    expect(shotSettledAt(scene('s', 0, shot([a, b, p], [reveal])))).toBeCloseTo(1, 9);
    expect(shotSettledAt(scene('s', 0, shot([a, b, p], [reveal, flow])))).toBeCloseTo(2.2, 9);
  });
});
```

Create `tests/render/flow.test.ts` (Task 2 appends a third `describe`):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@covi/core';
import {
  buildTimeline,
  type DirectionBeat,
  type DirectionElement,
  type LayoutReport,
  layoutScenes,
  pacingFor,
  type Rect,
  resolveVideoSpec,
  type SceneStaging,
  StoryboardSchema,
  writeComposition,
} from '@covi/video';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeRegions } from '../../packages/video/src/runtime/layout.ts';
import {
  edgeRoute,
  pointAlong,
  stackCount,
  stackRows,
} from '../../packages/video/src/runtime/routes.ts';
import { canUseBrowser } from '../helpers/env.ts';

/*
 * Flow verbs, drawn in Chromium from timelines built by hand (elements and beats as the resolver
 * writes them): packets travel edges between nodes, splits fan into as many pieces as their count
 * (twelve at most) and merges pull them back, piles stack up to their true number, and counters
 * count up. Files under tests/ are typechecked without DOM types, so the page reads its own
 * elements; `runtime/routes.ts` and `runtime/layout.ts` are DOM-free.
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

const LANDSCAPE = { width: 640, height: 360 };
const VERTICAL = { width: 360, height: 640 };
type Size = typeof LANDSCAPE;
type Point = { x: number; y: number };

/** The media region of a frame, and its two halves side by side (one above the other when tall). */
function regionsOf(size: Size) {
  const tall = size.height > size.width;
  const regions = computeRegions({ ...size, orientation: tall ? 'vertical' : 'landscape' });
  const m = regions.media;
  const gap = 28 * regions.unit;
  const half = tall ? (m.height - gap) / 2 : (m.width - gap) / 2;
  const left: Rect = tall ? { ...m, height: half } : { ...m, width: half };
  const right: Rect = tall
    ? { ...m, y: m.y + half + gap, height: half }
    : { ...m, x: m.x + half + gap, width: half };
  const pivot = { x: m.x + m.width / 2, y: m.y + m.height / 2 };
  return { regions, media: m, left, right, pivot };
}

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * A two-scene composition whose second scene stages `elements` with `beats` (seconds since that
 * scene started), opened in Chromium at `size`.
 */
async function staged(
  elements: (r: ReturnType<typeof regionsOf>) => DirectionElement[],
  beats: DirectionBeat[],
  size: Size = LANDSCAPE,
) {
  const dir = mkdtempSync(join(tmpdir(), 'covi-flow-'));
  dirs.push(dir);
  const r = regionsOf(size);
  const spec = resolveVideoSpec(resolveConfig([]).config, { mode: 'custom', ...size });
  const title = 'Send document references';
  const scenes = StoryboardSchema.parse({
    title,
    template: 'bug-fix',
    scenes: [
      {
        id: 's1',
        beat: 'a',
        narration: 'The request carried every document.',
        visual: { kind: 'callout', title: 'Before' },
      },
      {
        id: 's2',
        beat: 'b',
        narration: 'The request broke into chunks, and the reader took many steps to read them.',
        minSeconds: 7,
        visual: { kind: 'callout', title: 'After' },
      },
    ],
  }).scenes;
  const staging: SceneStaging[] = [
    {
      stop: { x: 0, y: 0 },
      direction: {
        whole: true,
        elements: [{ id: 'visual', kind: 'visual', rect: r.media }],
        beats: [],
      },
    },
    {
      stop: { x: Math.round(size.width * 1.25), y: 0 },
      direction: { whole: false, elements: elements(r), beats },
    },
  ];
  const timeline = buildTimeline({
    title,
    scenes,
    layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
    spec,
    image: () => ({ src: '', width: 1, height: 1 }),
    staging,
  });
  await writeComposition(join(dir, 'composition'), timeline, new Map());
  const page = await browser!.newPage({ viewport: size });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(dir, 'composition', 'index.html')}`);
  await page.waitForFunction('window.covi !== undefined');
  await page.evaluate('window.covi.ready');
  const s2 = timeline.scenes.find((s) => s.id === 's2')!;
  const frameAt = (seconds: number) => Math.round((s2.start + seconds) * timeline.fps);
  /** Seconds into s2 at a frame, as the runtime's clock has them. */
  const local = (frame: number) => frame / timeline.fps - s2.start;
  const seek = (frame: number, body: string) =>
    page.evaluate(`(() => { window.covi.seek(${frame}); ${body} })()`);
  const report = (frame: number) =>
    seek(frame, 'return window.covi.layout();') as Promise<LayoutReport>;
  const shot = async (frame: number) => {
    await page.evaluate(`window.covi.seek(${frame})`);
    return page.screenshot({ type: 'png' });
  };
  return { timeline, r, frameAt, local, seek, report, shot, errors };
}

type Staged = Awaited<ReturnType<typeof staged>>;

interface Drawn {
  /** Drawn boxes by selector, in screen pixels; the visible ones only for pieces and items. */
  nodes: Record<string, Rect>;
  packet: (Rect & { opacity: number; label: string | null; children: number }) | null;
  pieces: Rect[];
  badges: Array<{ opacity: number; side: string; name: string; num: string; children: number }>;
  edge: { offset: number; length: number; head: number } | null;
  dot: (Rect & { opacity: number }) | null;
  rows: Array<{ cap: string; items: number; num: string; numOpacity: number }>;
  pileName: string | null;
  value: string | null;
}

/** What scene s2 draws at a frame. */
const read = (v: Staged, frame: number) =>
  v.seek(
    frame,
    `const scene = document.querySelector('[data-scene="s2"]');
     const box = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
     const op = (n) => Number.parseFloat(n.style.opacity || '1');
     const nodes = {};
     for (const n of scene.querySelectorAll('[data-element] .dnode')) nodes[n.closest('[data-element]').dataset.element] = box(n);
     const pill = scene.querySelector('.fpacket');
     const path = scene.querySelector('.flows path');
     const head = scene.querySelector('.flows polygon');
     const dot = scene.querySelector('.fdot');
     return {
       nodes,
       packet: pill ? { ...box(pill), opacity: op(pill), label: pill.querySelector('.nlabel')?.textContent ?? null, children: pill.querySelector('.nlabel')?.children.length ?? 0 } : null,
       pieces: [...scene.querySelectorAll('.fpiece')].filter((n) => op(n) > 0).map(box),
       badges: [...scene.querySelectorAll('.fbadge')].map((badge) => ({ opacity: op(badge), side: badge.querySelector('.fside').textContent,
         name: badge.querySelector('.fname').textContent, num: badge.querySelector('.fnum').textContent, children: badge.querySelector('.fname').children.length })),
       edge: path ? { offset: Number(path.getAttribute('stroke-dashoffset')), length: Number(path.getAttribute('stroke-dasharray')), head: op(head) } : null,
       dot: dot ? { ...box(dot), opacity: op(dot) } : null,
       rows: [...scene.querySelectorAll('.prow')].map((row) => ({
         cap: row.querySelector('.pcap').textContent,
         items: [...row.querySelectorAll('.pitem')].filter((n) => op(n) > 0).length,
         num: row.querySelector('.pnum').textContent,
         numOpacity: op(row.querySelector('.pnum')),
       })),
       pileName: scene.querySelector('.pname')?.textContent ?? null,
       value: scene.querySelector('.mvalue')?.textContent ?? null,
     };`,
  ) as Promise<Drawn>;

/** Two nodes side by side, and (`packet`) a packet `p` that rides from the first, as resolved. */
const twoNodes =
  (packet = false) =>
  (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
    { id: 'a', kind: 'node', rect: r.left, label: 'Request builder' },
    { id: 'b', kind: 'node', rect: r.right, label: 'Reader' },
    ...(packet ? [{ id: 'p', kind: 'packet', rect: r.left } as const] : []),
  ];
const FLOW = { verb: 'flow', from: 'a', to: 'b', packet: 'p', t: 1, seconds: 1.2 } as const;
const chunks = (count: number, t = 1) =>
  ({ verb: 'split', element: 'q', count, name: 'chunks', side: 'base', t, seconds: 0.9 }) as const;
const alone = (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
  { id: 'q', kind: 'packet', rect: r.media },
];

describe.skipIf(!available)('packets on edges', () => {
  it('carries a packet along the edge between two nodes, eased, drawing the edge behind it', async () => {
    const v = await staged(twoNodes(true), [FLOW]);
    const route = (d: Drawn) => edgeRoute(d.nodes.a!, d.nodes.b!);
    const before = await read(v, v.frameAt(0.5));
    expect(near(center(before.packet!), route(before)[0]!)).toBeLessThan(1.5);
    expect(before.edge!.offset).toBeCloseTo(before.edge!.length, 1);
    expect(before.edge!.head).toBe(0);
    const frame = v.frameAt(FLOW.t + FLOW.seconds / 2);
    const mid = await read(v, frame);
    const k = (v.local(frame) - FLOW.t) / FLOW.seconds;
    const eased = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
    expect(near(center(mid.packet!), pointAlong(route(mid), eased))).toBeLessThan(1.5);
    expect(mid.edge!.offset / mid.edge!.length).toBeCloseTo(1 - eased, 2);
    const after = await read(v, v.frameAt(FLOW.t + FLOW.seconds + 0.3));
    expect(near(center(after.packet!), route(after).at(-1)!)).toBeLessThan(1.5);
    expect(after.edge).toMatchObject({ offset: 0, head: 1 });
    expect(v.errors).toEqual([]);
  });

  it('sends a dot when a flow carries no packet, and it is gone once it arrives', async () => {
    const v = await staged(twoNodes(), [{ verb: 'flow', from: 'a', to: 'b', t: 1, seconds: 1.2 }]);
    expect((await read(v, v.frameAt(0.5))).dot!.opacity).toBe(0);
    const mid = await read(v, v.frameAt(1.6));
    expect(mid.dot!.opacity).toBe(1);
    const route = edgeRoute(mid.nodes.a!, mid.nodes.b!);
    expect(center(mid.dot!).x).toBeGreaterThan(route[0]!.x);
    expect(center(mid.dot!).x).toBeLessThan(route.at(-1)!.x);
    expect((await read(v, v.frameAt(2.5))).dot!.opacity).toBe(0);
  });

  it('keeps a travelling packet in the middle of the frame when the camera follows it', async () => {
    const v = await staged(twoNodes(true), [
      { ...FLOW, seconds: 2 },
      { verb: 'camera', move: 'follow', to: 'p', zoom: 1.5, t: 1, seconds: 0.4 },
    ]);
    const layer = (frame: number) =>
      v.seek(
        frame,
        `return document.querySelector('[data-scene="s2"] > .stop-view > .layer').style.transform;`,
      );
    const seen: string[] = [];
    for (const t of [1.9, 2.4]) {
      const frame = v.frameAt(t);
      const drawn = await read(v, frame);
      // The packet has moved along the edge, and the camera with it.
      expect(near(center(drawn.packet!), v.r.pivot)).toBeLessThan(3);
      seen.push((await layer(frame)) as string);
    }
    expect(new Set(seen).size).toBe(2);
    expect(seen[0]).toMatch(/scale\(1\.5/);
  });
});

describe.skipIf(!available)('splits and merges', () => {
  it('breaks a packet into as many pieces as its count, with the true count under them', async () => {
    const v = await staged(alone, [chunks(4)]);
    const before = await read(v, v.frameAt(0.5));
    expect(before.pieces).toHaveLength(0);
    expect(before.packet!.opacity).toBe(1);
    expect(before.badges[0]!.opacity).toBe(0);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(4);
    expect(split.packet!.opacity).toBe(0);
    expect(split.badges).toEqual([
      { opacity: 1, side: 'Before', name: 'chunks', num: '4', children: 0 },
    ]);
    // Fanned out in a row around where the packet was.
    const xs = split.pieces.map((p) => center(p).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.abs((xs[0]! + xs.at(-1)!) / 2 - center(before.packet!).x)).toBeLessThan(1);
  });

  it('draws at most twelve pieces, and the count it measured', async () => {
    const v = await staged(alone, [chunks(40)]);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(12);
    expect(split.badges[0]!.num).toBe('40');
  });

  it('pulls the pieces back into one packet when it merges, captioned with the one it became', async () => {
    const v = await staged(alone, [
      chunks(4),
      {
        verb: 'merge',
        element: 'q',
        into: { count: 1, name: 'chunks', side: 'head' },
        t: 3,
        seconds: 0.8,
      },
    ]);
    const fanned = await read(v, v.frameAt(2.5));
    const merging = await read(v, v.frameAt(3.4));
    const spread = (d: Drawn) => center(d.pieces.at(-1)!).x - center(d.pieces[0]!).x;
    expect(spread(merging)).toBeLessThan(spread(fanned));
    const merged = await read(v, v.frameAt(4.1));
    expect(merged.pieces).toHaveLength(0);
    expect(merged.packet!.opacity).toBe(1);
    expect(merged.badges.map((b) => [b.opacity, b.side, b.name, b.num])).toEqual([
      [0, 'Before', 'chunks', '4'],
      [1, 'After', 'chunks', '1'],
    ]);
  });

  it('fans a node’s pieces out below it, the node staying where it is', async () => {
    const v = await staged(twoNodes(), [
      { verb: 'split', element: 'a', count: 3, name: 'jobs', side: 'head', t: 1, seconds: 0.9 },
    ]);
    const split = await read(v, v.frameAt(2.2));
    expect(split.pieces).toHaveLength(3);
    const node = split.nodes.a!;
    for (const piece of split.pieces) expect(piece.y).toBeGreaterThan(node.y + node.height);
    expect(split.badges[0]).toMatchObject({ side: 'After', name: 'jobs', num: '3' });
  });

  it('sets the agent’s label and the run’s words as text', async () => {
    const hostile = '<img src=x onerror="window.__pwned=1">';
    const v = await staged(
      (r) => [{ id: 'q', kind: 'packet', rect: r.media, label: hostile }],
      [{ ...chunks(2), name: hostile }],
    );
    const frame = v.frameAt(2.2);
    const drawn = await read(v, frame);
    expect(drawn.packet).toMatchObject({ label: hostile, children: 0 });
    expect(drawn.badges[0]).toMatchObject({ name: hostile, children: 0 });
    expect(
      await v.seek(
        frame,
        'return [window.__pwned ?? null, document.querySelectorAll("[data-element] img").length];',
      ),
    ).toEqual([null, 0]);
  });

  it('draws the same frame every time', async () => {
    const make = () => staged(twoNodes(true), [FLOW, { ...chunks(4, 2.4), element: 'p' }]);
    const [a, b] = [await make(), await make()];
    for (const t of [1.6, 2.8]) {
      const frame = a.frameAt(t);
      const first = await a.shot(frame);
      await a.shot(a.frameAt(0.2));
      expect((await a.shot(frame)).equals(first)).toBe(true);
      expect((await b.shot(frame)).equals(first)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/routes.test.ts packages/video/test/flow-timeline.test.ts tests/render/flow.test.ts`
Expected: FAIL — `Cannot find module '../src/runtime/routes.ts'`, and the timeline has no `packet` element or `flow` beat (typecheck).

- [ ] **Step 3: Timeline types (`packages/video/src/timeline/types.ts`)**

After B4's `export type MetricShow = …;` add:

```ts
/**
 * The verbs that stage a flow: a packet travelling an edge, one thing breaking into pieces and
 * the pieces pulling back together, a pile stacking up, a counter counting up from zero. A shot
 * with any of them leads as a flow.
 */
export const FLOW_VERBS = ['flow', 'split', 'merge', 'stack', 'count-up'] as const;

/** Which side of the change a count is from: before it (base) or after it (head). */
export type ChangeSide = 'base' | 'head';
```

Add this member to the `DirectionElement` union, after its `node` member:

```ts
  /** A packet: a pill that travels edges between nodes, or sits in its slot; it can split. */
  | { id: string; kind: 'packet'; rect: Rect; label?: string }
```

and these members to the `DirectionBeat` union, after B4's `count` member:

```ts
  | { verb: 'flow'; from: string; to: string; packet?: string; t: number; seconds: number }
  | {
      verb: 'split';
      element: string;
      /** The pieces it breaks into: a measured count, of which at most twelve are drawn. */
      count: number;
      /** What the pieces are, as the run's output called the count. */
      name: string;
      side: ChangeSide;
      t: number;
      seconds: number;
    }
  | {
      verb: 'merge';
      element: string;
      /** What a split merges into, when the run measured exactly one on the other side. */
      into?: { count: 1; name: string; side: ChangeSide };
      t: number;
      seconds: number;
    }
```

- [ ] **Step 4: Create `packages/video/src/runtime/routes.ts`**

```ts
import type { Point, Rect } from '../timeline/types.ts';

/*
 * Where flows travel and piles stack: edge routes between node boxes, a packet's place along
 * them, a split's fan, and a pile's grid. Pure and DOM-free, so the runtime draws with them, the
 * camera follows with them, and Node's tests check them.
 */

// `anim.ts` has these too, but it carries DOM types, and Node and tests/ import this file.
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Items a pile or a split draws at most; the number beside them is the true count. */
export const DRAWN_ITEMS = 12;
/** Items in one line of a pile or a fan. */
export const PER_LINE = 6;

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * A node's or a label's box in its slot, as the runtime draws it: centered, at most 520 × 170
 * design units (760 × 220 on tall frames).
 */
export function textBoxRect(slot: Rect, unit: number, tall: boolean): Rect {
  const width = Math.min(slot.width, (tall ? 760 : 520) * unit);
  const height = Math.min(slot.height, (tall ? 220 : 170) * unit);
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  };
}

/**
 * The path an edge takes from box `a` to box `b`, border to border: straight across when the
 * boxes share a row or a column, else with one elbow (out of `a`'s side that faces `b`, along to
 * above or below `b`'s center, then into `b`). Boxes that overlap join center to center.
 */
export function edgeRoute(a: Rect, b: Rect): Point[] {
  const ca = center(a);
  const cb = center(b);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const row = bottom > top;
  const column = right > left;
  if (row && column) return [ca, cb];
  if (row) {
    const y = (top + bottom) / 2;
    return cb.x > ca.x
      ? [
          { x: a.x + a.width, y },
          { x: b.x, y },
        ]
      : [
          { x: a.x, y },
          { x: b.x + b.width, y },
        ];
  }
  if (column) {
    const x = (left + right) / 2;
    return cb.y > ca.y
      ? [
          { x, y: a.y + a.height },
          { x, y: b.y },
        ]
      : [
          { x, y: a.y },
          { x, y: b.y + b.height },
        ];
  }
  return [
    { x: cb.x > ca.x ? a.x + a.width : a.x, y: ca.y },
    { x: cb.x, y: ca.y },
    { x: cb.x, y: cb.y > ca.y ? b.y : b.y + b.height },
  ];
}

export function routeLength(route: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++)
    length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  return length;
}

/** The point `k` (0–1) of the way along a route, by distance. */
export function pointAlong(route: readonly Point[], k: number): Point {
  let left = clamp(k) * routeLength(route);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || i === route.length - 1) {
      const f = length ? Math.min(1, left / length) : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= length;
  }
  return route[0]!;
}

/** The triangle of an arrowhead `size` long at a route's end, pointing the way it arrives. */
export function arrowHead(route: readonly Point[], size: number): Point[] {
  const tip = route.at(-1)!;
  const from = route.at(-2) ?? tip;
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const dx = (tip.x - from.x) / length;
  const dy = (tip.y - from.y) / length;
  const back = { x: tip.x - dx * size, y: tip.y - dy * size };
  const half = size * 0.6;
  return [
    tip,
    { x: back.x - dy * half, y: back.y + dx * half },
    { x: back.x + dy * half, y: back.y - dx * half },
  ];
}

/** A packet's trip along one edge: from `t` (seconds) for `seconds`. */
export interface Leg {
  t: number;
  seconds: number;
  route: readonly Point[];
}

/** How far through a trip a packet is at `t`, eased in and out. */
export function legProgress(leg: Pick<Leg, 't' | 'seconds'>, t: number): number {
  return easeInOutCubic(clamp((t - leg.t) / Math.max(leg.seconds, 1e-6)));
}

/**
 * Where a packet's center is at `t`: at the start of its first trip before it leaves, along each
 * trip as it travels, and where the last one ended after it arrives. Without trips, at `rest`.
 */
export function legPoint(legs: readonly Leg[], t: number, rest: Point): Point {
  if (!legs.length) return rest;
  let at = legs[0]!.route[0]!;
  for (const leg of legs) {
    if (t < leg.t) break;
    at = pointAlong(leg.route, legProgress(leg, t));
  }
  return at;
}

/** A split's pieces: their size, and their centers' offsets from the source's center. */
export interface Fan {
  width: number;
  height: number;
  offsets: Point[];
}

/**
 * Where the pieces of a split sit when it has fanned out: at most twelve, in lines of up to six,
 * each a little smaller than `source` (a packet), the lines shrunk to fit `room` px wide. A packet
 * breaks apart in place (`drop` 0); a node stays, and its pieces fan out `drop` px below its center.
 */
export function fanOut(
  count: number,
  source: { width: number; height: number },
  room: number,
  drop: number,
): Fan {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const columns = Math.max(1, Math.min(n, PER_LINE));
  const lines = Math.ceil(n / columns);
  const step = 1.3;
  const fit = Math.min(1, room / (source.width * 0.6 * (step * (columns - 1) + 1)));
  const width = source.width * 0.6 * fit;
  const height = source.height * 0.7 * fit;
  const offsets = Array.from({ length: n }, (_, i) => {
    const line = Math.floor(i / columns);
    const inLine = Math.min(columns, n - line * columns);
    const x = ((i % columns) - (inLine - 1) / 2) * width * step;
    const y =
      drop > 0 ? drop + height * (0.5 + 1.5 * line) : (line - (lines - 1) / 2) * height * 1.5;
    return { x, y };
  });
  return { width, height, offsets };
}

/**
 * A pile row's items in its grid box (box-relative): at most twelve squares in two lines of six,
 * filled left to right and top to bottom, sized so twelve would fit, the block centered.
 */
export function pileGrid(
  count: number,
  box: { width: number; height: number },
  gap: number,
): Rect[] {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const size = Math.max(
    0,
    Math.min((box.width - gap * (PER_LINE - 1)) / PER_LINE, (box.height - gap) / 2),
  );
  const left = (box.width - (PER_LINE * size + (PER_LINE - 1) * gap)) / 2;
  const top = (box.height - (2 * size + gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: left + (i % PER_LINE) * (size + gap),
    y: top + Math.floor(i / PER_LINE) * (size + gap),
    width: size,
    height: size,
  }));
}

/** The number a pile row shows `k` (0–1) of the way through its stack: up to the true count. */
export function stackCount(count: number, k: number): number {
  return Math.floor(count * clamp(k) + 1e-9);
}

/** Each row's progress `k` (0–1) of the way through one stack: rows fill one after another. */
export function stackRows(k: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => clamp(k * rows - i));
}
```

- [ ] **Step 5: Create `packages/video/src/runtime/direction/flow.ts`**

```ts
import type {
  ChangeSide,
  DirectionBeat,
  DirectionElement,
  Point,
  Rect,
  SceneDirection,
} from '../../timeline/types.ts';
import { easeInOutCubic, easeOutCubic, seg } from '../anim.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  type LayoutItem,
  overflows,
  rectOf,
} from '../components/types.ts';
import { el, fitText, svg } from '../dom.ts';
import { formatNumber } from '../numbers.ts';
import {
  arrowHead,
  center,
  edgeRoute,
  type Fan,
  fanOut,
  type Leg,
  legPoint,
  legProgress,
  pointAlong,
  routeLength,
  textBoxRect,
} from '../routes.ts';

/*
 * Flow verbs, drawn: edges between nodes with packets travelling them, and splits that fan a
 * packet or a node into pieces and merges that pull them back together. Every position is a pure
 * function of the clock (geometry from `routes.ts`), and all text is set as text.
 */

type PacketElement = Extract<DirectionElement, { kind: 'packet' }>;
type Flow = Extract<DirectionBeat, { verb: 'flow' }>;

/** A beat's span on an element's own clock. */
export interface Span {
  t: number;
  seconds: number;
}

/** A split, on its element's clock: how many pieces, what they are, and which side counted them. */
export interface SplitSpan extends Span {
  count: number;
  name: string;
  side: ChangeSide;
}

/** A merge, on its element's clock, and what a split merges into when the run measured it. */
export interface MergeSpan extends Span {
  into?: { count: number; name: string; side: ChangeSide };
}

/** What one element does in a shot's flow verbs, on its own clock. */
export interface FlowSpans {
  split?: SplitSpan;
  merge?: MergeSpan;
  /** A packet's trips along edges, in time order. */
  legs: Leg[];
}

/** The drawn box of every node in a shot, which edges join and packets travel between. */
export function nodeBoxes(direction: SceneDirection, ctx: ComponentContext): Map<string, Rect> {
  const tall = ctx.timeline.orientation === 'vertical';
  const boxes = new Map<string, Rect>();
  for (const e of direction.elements)
    if (e.kind === 'node') boxes.set(e.id, textBoxRect(e.rect, ctx.regions.unit, tall));
  return boxes;
}

/**
 * What element `id` does in the shot's flow verbs, moved onto its own clock (which starts at its
 * reveal, `shift` seconds into the scene, when it has one).
 */
export function flowSpans(
  direction: SceneDirection,
  id: string,
  boxes: ReadonlyMap<string, Rect>,
  shift: number,
): FlowSpans {
  const own = (b: Span): Span => ({ t: b.t - shift, seconds: b.seconds });
  const spans: FlowSpans = { legs: [] };
  for (const b of direction.beats) {
    if (b.verb === 'split' && b.element === id)
      spans.split = { ...own(b), count: b.count, name: b.name, side: b.side };
    else if (b.verb === 'merge' && b.element === id)
      spans.merge = { ...own(b), ...(b.into ? { into: b.into } : {}) };
    else if (b.verb === 'flow' && b.packet === id) {
      const from = boxes.get(b.from);
      const to = boxes.get(b.to);
      if (from && to) spans.legs.push({ ...own(b), route: edgeRoute(from, to) });
    }
  }
  return spans;
}

const points = (route: readonly Point[]) =>
  route.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/**
 * The edges a shot's flows travel, under every element: each is drawn in by the first flow along
 * it, behind its packet, and keeps its arrowhead once drawn. A flow without a packet sends a dot.
 */
export function mountFlows(
  direction: SceneDirection,
  ctx: ComponentContext,
  boxes: ReadonlyMap<string, Rect>,
): { update(t: number): void } {
  const layer = el('div', 'layer flows', ctx.root);
  const canvas = svg('svg', { width: ctx.timeline.width, height: ctx.timeline.height }, layer);
  const color = ctx.timeline.theme.primary;
  const dotSize = ctx.u(26);
  const edges = new Map<
    string,
    { path: SVGPathElement; head: SVGPolygonElement; length: number; first: Flow }
  >();
  const dots: Array<{ dot: HTMLDivElement; flow: Flow; route: Point[] }> = [];
  for (const b of direction.beats) {
    if (b.verb !== 'flow') continue;
    const from = boxes.get(b.from);
    const to = boxes.get(b.to);
    if (!from || !to) continue;
    const route = edgeRoute(from, to);
    const key = `${b.from}>${b.to}`;
    if (!edges.has(key)) {
      const length = routeLength(route);
      const path = svg(
        'path',
        {
          d: points(route),
          fill: 'none',
          stroke: color,
          'stroke-width': ctx.u(4).toFixed(2),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-dasharray': length.toFixed(2),
        },
        canvas,
      );
      const head = svg(
        'polygon',
        {
          points: arrowHead(route, ctx.u(18))
            .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(' '),
          fill: color,
        },
        canvas,
      );
      edges.set(key, { path, head, length, first: b });
    }
    if (!b.packet) {
      const dot = el('div', 'fdot', layer);
      Object.assign(dot.style, { width: `${dotSize}px`, height: `${dotSize}px` });
      dots.push({ dot, flow: b, route });
    }
  }
  return {
    update(t) {
      for (const { path, head, length, first } of edges.values()) {
        const k = legProgress(first, t);
        path.setAttribute('stroke-dashoffset', (length * (1 - k)).toFixed(2));
        head.style.opacity = seg(k, 0.85, 1).toFixed(3);
      }
      for (const { dot, flow, route } of dots) {
        const p = pointAlong(route, legProgress(flow, t));
        dot.style.transform = `translate(${(p.x - dotSize / 2).toFixed(2)}px, ${(p.y - dotSize / 2).toFixed(2)}px)`;
        const end = flow.t + flow.seconds;
        dot.style.opacity =
          t < flow.t ? '0' : (1 - seg(t, end - 0.15 * flow.seconds, end)).toFixed(3);
      }
    },
  };
}

/** A text item as QC reads it: body text, its size as drawn. */
const textItem = (node: HTMLElement): LayoutItem => ({
  role: 'text',
  rect: rectOf(node),
  overflow: overflows(node),
  font: drawnFont(node),
  text: 'body',
});

const shown = (node: HTMLElement) => Number.parseFloat(node.style.opacity || '1') > 0;

const boxAt = (c: Point, width: number, height: number): Rect => ({
  x: c.x - width / 2,
  y: c.y - height / 2,
  width,
  height,
});

/** A split's pieces and the count under them, around a source that may move. */
interface Pieces {
  /** How far the pieces have spread (0 at the source, 1 fanned out). */
  spread(t: number): number;
  /** How much of the source shows: a packet breaks apart into its pieces, a node stays. */
  source(t: number): number;
  update(t: number, origin: Point): void;
  boxes(t: number, origin: Point): Rect[];
  report(): LayoutItem[];
}

/** A count as a caption: the side it was measured on, what it counts, and the number. */
function countBadge(
  side: ChangeSide,
  name: string,
  count: number,
  ctx: ComponentContext,
): { badge: HTMLDivElement; parts: HTMLElement[]; width: number } {
  const labels = ctx.timeline.labels;
  const badge = el('div', 'fbadge', ctx.root);
  const caption = el(
    'div',
    'fside',
    badge,
    side === 'base' ? (labels?.before ?? 'Before') : (labels?.after ?? 'After'),
  );
  const line = el('div', 'fline', badge);
  const parts = [
    caption,
    el('span', 'fname', line, name),
    el('span', 'fnum', line, formatNumber(count, 0)),
  ];
  badge.style.fontSize = `${ctx.u(30)}px`;
  return { badge, parts, width: badge.offsetWidth };
}

/**
 * The pieces a split fans out of a source (`stays`: a node, which emits them below itself; else a
 * packet, which breaks apart in place), and the count they stand for, captioned with the side it
 * was measured on. A merge pulls them back into the source.
 */
function pieces(
  split: SplitSpan,
  merge: MergeSpan | undefined,
  size: { width: number; height: number },
  room: number,
  drop: number,
  ctx: ComponentContext,
): Pieces {
  const stays = drop > 0;
  const u = ctx.u;
  const fan: Fan = fanOut(split.count, size, room, drop);
  const nodes = fan.offsets.map(() => {
    const node = el('div', 'fpiece', ctx.root);
    Object.assign(node.style, { width: `${fan.width}px`, height: `${fan.height}px` });
    return node;
  });
  const before = countBadge(split.side, split.name, split.count, ctx);
  // What it merges into takes the caption's place once the pieces are back.
  const into = merge?.into && countBadge(merge.into.side, merge.into.name, merge.into.count, ctx);
  // The count sits under the pieces as they are when fanned out, so it never moves while they do.
  const below = Math.max(0, ...fan.offsets.map((o) => o.y)) + fan.height / 2 + u(stays ? 14 : 10);
  const spread = (t: number) =>
    easeOutCubic(seg(t, split.t, split.t + split.seconds)) *
    (1 - (merge ? easeInOutCubic(seg(t, merge.t, merge.t + merge.seconds)) : 0));
  const live = (t: number) => t >= split.t && !(merge && t >= merge.t + merge.seconds);
  return {
    spread,
    source(t) {
      if (stays) return 1;
      const gone = seg(t, split.t, split.t + 0.3 * split.seconds);
      const back = merge ? seg(t, merge.t + 0.6 * merge.seconds, merge.t + merge.seconds) : 0;
      return Math.max(1 - gone, back);
    },
    update(t, origin) {
      const k = spread(t);
      const on = live(t);
      nodes.forEach((piece, i) => {
        const o = fan.offsets[i]!;
        const x = origin.x + o.x * k - fan.width / 2;
        const y = origin.y + o.y * k - fan.height / 2;
        piece.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        piece.style.opacity = on ? '1' : '0';
      });
      const fadeOut = merge ? 1 - seg(t, merge.t, merge.t + 0.4 * merge.seconds) : 1;
      for (const [b, opacity] of [
        [before, seg(t, split.t + 0.6 * split.seconds, split.t + split.seconds) * fadeOut],
        ...(into && merge
          ? [[into, seg(t, merge.t + 0.6 * merge.seconds, merge.t + merge.seconds)] as const]
          : []),
      ] as const) {
        b.badge.style.transform = `translate(${(origin.x - b.width / 2).toFixed(2)}px, ${(origin.y + below).toFixed(2)}px)`;
        b.badge.style.opacity = opacity.toFixed(3);
      }
    },
    boxes(t, origin) {
      if (!live(t)) return [];
      const k = spread(t);
      return fan.offsets.map((o) =>
        boxAt({ x: origin.x + o.x * k, y: origin.y + o.y * k }, fan.width, fan.height),
      );
    },
    report: () => [
      ...nodes.filter(shown).map((piece) => ({ role: 'media' as const, rect: rectOf(piece) })),
      ...[before, ...(into ? [into] : [])].flatMap((b) =>
        shown(b.badge) ? b.parts.map(textItem) : [],
      ),
    ],
  };
}

/**
 * A packet: a pill (with the agent's label, set as text) resting in its slot a little above the
 * middle, or travelling its edges; split, it breaks into its pieces, and merged, it is whole again.
 * `follow` is where it is at any moment, so the camera can keep it framed.
 */
export function packet(e: PacketElement, ctx: ComponentContext, spans: FlowSpans): Component {
  const u = ctx.u;
  const tall = ctx.timeline.orientation === 'vertical';
  const pill = el('div', 'fpacket', ctx.root);
  const label = e.label === undefined ? undefined : el('div', 'nlabel', pill, e.label);
  const height = u(tall ? 72 : 64);
  if (label)
    fitText(label, { max: u(36), min: u(28), maxWidth: Math.min(e.rect.width, u(420)) - u(48) });
  const width = Math.max(u(150), (label?.scrollWidth ?? 0) + u(48));
  Object.assign(pill.style, { width: `${width}px`, height: `${height}px` });
  const rest = { x: e.rect.x + e.rect.width / 2, y: e.rect.y + e.rect.height * 0.4 };
  const at = (t: number) => legPoint(spans.legs, t, rest);
  const split = spans.split
    ? pieces(spans.split, spans.merge, { width, height }, e.rect.width - u(32), 0, ctx)
    : undefined;
  return {
    update(clock) {
      const c = at(clock.t);
      const whole = split ? split.source(clock.t) : 1;
      pill.style.transform = `translate(${(c.x - width / 2).toFixed(2)}px, ${(c.y - height / 2).toFixed(2)}px)`;
      pill.style.opacity = whole.toFixed(3);
      split?.update(clock.t, c);
    },
    report: () => [
      ...(shown(pill)
        ? [{ role: 'media' as const, rect: rectOf(pill) }, ...(label ? [textItem(label)] : [])]
        : []),
      ...(split?.report() ?? []),
    ],
    follow(t) {
      const c = at(t);
      const boxes = [boxAt(c, width, height), ...(split?.boxes(t, c) ?? [])];
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    },
  };
}

/** A node that splits: its box stays, and its pieces fan out below it and merge back into it. */
export function nodeSplit(
  node: Component,
  e: Extract<DirectionElement, { kind: 'node' }>,
  ctx: ComponentContext,
  spans: FlowSpans & { split: SplitSpan },
): Component {
  const u = ctx.u;
  const box = textBoxRect(e.rect, ctx.regions.unit, ctx.timeline.orientation === 'vertical');
  // Its pieces are packet-sized, whatever the node's size, and start just below it.
  const size = { width: u(150), height: u(64) };
  const split = pieces(
    spans.split,
    spans.merge,
    size,
    e.rect.width - u(32),
    box.height / 2 + u(16),
    ctx,
  );
  const origin = center(box);
  return {
    update(clock) {
      node.update(clock);
      split.update(clock.t, origin);
    },
    report: () => [...node.report(), ...split.report()],
  };
}
```

How it stays a pure function of the frame: node boxes come from the resolved rects (`textBoxRect`), a packet's size is measured once at mount (fonts loaded, nothing transformed), and everything `update` sets derives from those numbers and the clock; `follow(t)` computes the packet's box (and its pieces') from the same math, so B3's camera `follow` can frame it at any frame without touching the DOM.

- [ ] **Step 6: Draw packets, edges, and node splits in a shot (`packages/video/src/runtime/direction/elements.ts`)**

1. Imports — after the `../narrator.ts` import add:

```ts
import { textBoxRect } from '../routes.ts';
import { type FlowSpans, flowSpans, mountFlows, nodeBoxes, nodeSplit, packet } from './flow.ts';
```

2. In `mountShot`, right after `const direction = scene.direction!;`:

```ts
  // Flows first: the edges go under every element, joining the nodes as they are drawn.
  const boxes = nodeBoxes(direction, ctx);
  const flows = mountFlows(direction, ctx, boxes);
```

3. B3's own-beat lookup takes only the verbs whose span `draw` passes as `span` (a morph's, a count's); an element's flow verbs reach it through `FlowSpans`, since one element can have several (a split and a merge). Replace its predicate:

```ts
    const beat = direction.beats.find(
      (b) => (b.verb === 'morph' || b.verb === 'count') && b.element === element.id,
    );
```

(The old predicate, "neither `reveal` nor `camera`", no longer typechecks: a `flow` beat has no `element`.)

4. Right after `const shift = reveal ? reveal.t : 0;`:

```ts
    // A packet travels over the nodes it joins.
    if (element.kind === 'packet') layer.style.zIndex = '2';
```

5. The `draw(element, sub, drawVisual, span)` call gains a fifth argument, `flowSpans(direction, element.id, boxes, shift)`.
6. In the returned component's `update`, right after `now = clock.t;`: `flows.update(clock.t);` (edges and dots run on the scene's clock).
7. `draw` gains a fifth parameter `spans: FlowSpans`, a `packet` case, and a `node` case that splits:

```ts
    case 'packet':
      return { component: packet(element, ctx, spans) };
    case 'node': {
      const part = textBox(element.label, element.rect, 'node dnode', ctx);
      const { split } = spans;
      return split
        ? { ...part, component: nodeSplit(part.component, element, ctx, { ...spans, split }) }
        : part;
    }
```

(replacing the old one-line `node` case).

8. In `textBox`, replace the `width`/`height` lines and the `place(box, { … })` call with one computation the flows share:

```ts
  // The box edges join and packets travel to (see `nodeBoxes`): one computation for both.
  const rect = textBoxRect(slot, ctx.regions.unit, tall);
  const { width, height } = rect;
  const box = el('div', className, ctx.root);
  place(box, rect);
```

(`width` and `height` are still used by the `fitText` call below; the result is the same box as before.)

- [ ] **Step 7: Styles (`packages/video/src/runtime/styles.ts`)**

At the very end of the stylesheet template (after B4's `/* Metrics */` block), add:

```css
/* Flows */
.flows svg { position: absolute; left: 0; top: 0; overflow: visible; }
.fdot { position: absolute; left: 0; top: 0; border-radius: 50%; background: ${c.primary}; box-shadow: ${c.shadow}; }
.fpacket { position: absolute; left: 0; top: 0; display: flex; align-items: center; justify-content: center; padding: 0 ${u(24)};
  border-radius: 999px; border: ${u(3)} solid ${c.primary}; background: ${c.primarySoft}; color: ${c.text}; box-shadow: ${c.shadow}; white-space: nowrap; }
.fpacket .nlabel { font-weight: 720; line-height: 1.1; }
.fpiece { position: absolute; left: 0; top: 0; border-radius: ${u(12)}; background: ${c.primary}; box-shadow: ${c.shadow}; }
.fbadge { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: ${u(4)}; white-space: nowrap; }
.fbadge .fside { color: ${c.textMuted}; font-weight: 650; line-height: 1.15; }
.fbadge .fline { display: flex; align-items: baseline; gap: ${u(12)}; }
.fbadge .fname { color: ${c.text}; font-weight: 700; line-height: 1.15; }
.fbadge .fnum { color: ${c.primary}; font-weight: 800; font-size: 1.35em; line-height: 1.05; font-variant-numeric: tabular-nums; }
```

(These lines go inside the template literal exactly as written; `u` and `c` are the stylesheet's own helpers. No rule is unscoped against B3's `.mlive`/`.mbar`/`.mmark`/`.mnum` or B4's `.mcard` names.)

- [ ] **Step 8: Settling and lead kind**

`packages/video/src/timeline/cues.ts` — in `shotSettledAt`'s element map, right after B4's `metric` line:

```ts
    // A packet is in place half a second after it enters; its verbs end with the beats.
    if (e.kind === 'packet') return at + 0.5;
```

`packages/video/src/density.ts`:

1. The `./timeline/types.ts` import becomes a value import that adds `FLOW_VERBS` (keep the others as `type` imports).
2. Replace B4's `LeadKind` with:

```ts
/** What a scene leads with: a visual's kind, `metric` for a measured number, or `flow`. */
export type LeadKind = TimelineVisual['kind'] | 'metric' | 'flow';

/** Beats that stage a flow: a shot with one leads as `flow`, whatever its first element. */
const FLOWING: ReadonlySet<string> = new Set(FLOW_VERBS);
```

3. Add `packet: 'flow',` to `LOOKS_LIKE`.
4. Make `leadKind`'s first line:

```ts
  if (scene.direction?.beats.some((b) => FLOWING.has(b.verb))) return 'flow';
```

`CARDS` does not gain `flow`: a flow shot is judged by its motion (B6), and a row of nodes is sparse by design.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/routes.test.ts packages/video/test/flow-timeline.test.ts packages/video/test/density-direction.test.ts packages/video/test/motion.test.ts tests/render/flow.test.ts tests/render/canvas.test.ts`
Expected: PASS (B2's canvas tests confirm node and label boxes did not move). Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS.

(Prototyped on a scratch copy of B2 + B3's prototype + B4's runtime: all 9 render tests here passed in Chromium at 640×360; the packet stayed within 1.5 px of its route, and a followed packet within 3 px of the media center at 1.5×.)

- [ ] **Step 10: Commit**

```bash
npx biome check --write packages/video/src packages/video/test tests/render/flow.test.ts
npm run lint && npm run typecheck
git add packages/video/src/timeline packages/video/src/runtime packages/video/src/density.ts packages/video/test/routes.test.ts packages/video/test/flow-timeline.test.ts tests/render/flow.test.ts
git commit -m "$(cat <<'EOF'
Draw packets travelling edges, and splits and merges, on the canvas

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 2: Piles that stack, and counters that count up

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (`PileRow`; the `pile` element; the `stack` and `count-up` beats)
- Modify: `packages/video/src/runtime/direction/flow.ts` (header, imports, `FlowSpans.stack`, `flowSpans`, `pile`)
- Modify: `packages/video/src/runtime/numbers.ts` (append `CountUpSpan`, `counterValue`)
- Modify: `packages/video/src/runtime/direction/metric.ts` (B4's: `metric`, `counter`)
- Modify: `packages/video/src/runtime/direction/elements.ts` (the count-up span; `pile` and `metric` cases)
- Modify: `packages/video/src/runtime/styles.ts` (a `/* Piles */` block after `/* Flows */`)
- Modify: `packages/video/src/timeline/cues.ts`, `packages/video/src/density.ts`
- Test: `packages/video/test/numbers.test.ts` (B4's), `packages/video/test/flow-timeline.test.ts`, `tests/render/flow.test.ts`

**Interfaces:**
- Consumes: Task 1's `FlowSpans`, `flowSpans`, `pileGrid`, `stackCount`, `stackRows`, `DRAWN_ITEMS`, `ChangeSide`; B4's `metric(e, ctx, span)`, `counter`, `tickValue`, `countProgress`, `CountSpan`, `deltaOpacity`; `place`, `fitText`, `el` (`dom.ts`); `easeOutBack` (`anim.ts`).
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts
  export interface PileRow { side: ChangeSide; count: number }
  // DirectionElement gains: | { id: string; kind: 'pile'; rect: Rect; name: string; rows: PileRow[] }
  // DirectionBeat gains:
  //   | { verb: 'stack'; element: string; t: number; seconds: number }
  //   | { verb: 'count-up'; element: string; value: number; t: number; seconds: number }

  // packages/video/src/runtime/direction/flow.ts
  // FlowSpans gains `stack?: Span`
  export function pile(e: PileElement, ctx: ComponentContext, spans: FlowSpans): Component;
  // DOM: `.pcard > .pname + .prow × rows > (.pcap, .pgrid > .pitem.<side> × min(count, 12), .pnum)`.

  // packages/video/src/runtime/numbers.ts
  export interface CountUpSpan extends CountSpan { value: number }
  export function counterValue(e: { from?: number; to: number; decimals: number }, t: number, count?: CountSpan, up?: CountUpSpan): number;

  // packages/video/src/runtime/direction/metric.ts (B4's, widened)
  export function metric(e: MetricElement, ctx: ComponentContext, span: readonly [number, number], up?: CountUpSpan): Component;
  ```
  Meaning: a pile shows one row per side it was resolved with (before above after), each captioned with the timeline's Before/After word, up to twelve items and the true number. Without a `stack` it is full from the start; a `stack` fills the rows one after the other, item by item, the number counting up with them and landing on the true count; a `merge` gathers each row onto its first item and fades the numbers. A `count-up` raises a counter from 0 to its `value`; with a later `count`, the counter holds that value and then ticks from `from` to `to` as in B4.

- [ ] **Step 1: Write the failing tests**

Append to `packages/video/test/numbers.test.ts` (B4's), adding `counterValue` to its `../src/runtime/numbers.ts` import:

```ts
describe('counting up', () => {
  it('rise from zero to one side, hold it, then tick from before to after', () => {
    const bytes = { from: 70406, to: 9907, decimals: 0 };
    const up = { t: 1, seconds: 2, value: 70406 };
    const count = { t: 4, seconds: 1 };
    expect(counterValue(bytes, 0.5, count, up)).toBe(0);
    expect(counterValue(bytes, 2, count, up)).toBe(Math.round(70406 * 0.875));
    expect(counterValue(bytes, 3.5, count, up)).toBe(70406);
    expect(counterValue(bytes, 9, count, up)).toBe(9907);
    // Without a count-up, as B4 drew it: from before the count, to after it.
    expect(counterValue(bytes, 0.5, count)).toBe(70406);
    expect(counterValue(bytes, 9)).toBe(9907);
    // One value, counted up and held.
    expect(
      counterValue({ to: 28, decimals: 0 }, 0.5, undefined, { t: 1, seconds: 1, value: 28 }),
    ).toBe(0);
    expect(
      counterValue({ to: 28, decimals: 0 }, 5, undefined, { t: 1, seconds: 1, value: 28 }),
    ).toBe(28);
  });
});
```

Append to `packages/video/test/flow-timeline.test.ts`:

```ts
describe('piles on the timeline', () => {
  const pile: DirectionElement = {
    id: 'r',
    kind: 'pile',
    rect,
    name: 'reader steps',
    rows: [
      { side: 'base', count: 28 },
      { side: 'head', count: 10 },
    ],
  };
  it('lead as a flow, and settle once their stack has filled them', () => {
    expect(leadKind(scene('s', 0, shot([pile])))).toBe('flow');
    const stack: DirectionBeat = { verb: 'stack', element: 'r', t: 2, seconds: 1.8 };
    expect(shotSettledAt(scene('s', 0, shot([pile])))).toBeCloseTo(0.5, 9);
    expect(shotSettledAt(scene('s', 0, shot([pile], [stack])))).toBeCloseTo(3.8, 9);
  });
});
```

Append to `tests/render/flow.test.ts`:

```ts
const READS = (r: ReturnType<typeof regionsOf>): DirectionElement[] => [
  {
    id: 'reads',
    kind: 'pile',
    rect: r.media,
    name: 'reader steps',
    rows: [
      { side: 'base', count: 28 },
      { side: 'head', count: 10 },
    ],
  },
];
const STACK = { verb: 'stack', element: 'reads', t: 1, seconds: 1.8 } as const;

describe.skipIf(!available)('piles and count-ups', () => {
  it('stacks a pile item by item, before then after, the number counting up to the true count', async () => {
    const v = await staged(READS, [STACK]);
    expect((await read(v, v.frameAt(0.5))).rows).toEqual([
      { cap: 'Before', items: 0, num: '0', numOpacity: 1 },
      { cap: 'After', items: 0, num: '0', numOpacity: 1 },
    ]);
    const frame = v.frameAt(STACK.t + STACK.seconds / 4);
    const [base, head] = stackRows((v.local(frame) - STACK.t) / STACK.seconds, 2);
    const mid = await read(v, frame);
    const visible = (k: number, n: number) =>
      Array.from({ length: n }, (_, j) => j).filter((j) => k * n > j).length;
    expect(mid.rows.map((r) => r.items)).toEqual([visible(base!, 12), visible(head!, 10)]);
    expect(mid.rows.map((r) => r.num)).toEqual([
      String(stackCount(28, base!)),
      String(stackCount(10, head!)),
    ]);
    expect(mid.rows[0]!.items).toBeGreaterThan(0);
    expect(mid.rows[0]!.items).toBeLessThan(12);
    const done = await read(v, v.frameAt(STACK.t + STACK.seconds + 0.2));
    expect(done.rows.map((r) => [r.items, r.num])).toEqual([
      [12, '28'],
      [10, '10'],
    ]);
    expect(done.pileName).toBe('reader steps');
    // Body text, at least 28 units, and nothing overflows.
    const items = (await v.report(v.frameAt(3))).items.filter((i) => i.role === 'text');
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const item of items) {
      expect(item.overflow).toBe(false);
      expect(item.font! / v.r.regions.unit).toBeGreaterThanOrEqual(28 - 0.1);
    }
    expect(v.errors).toEqual([]);
  });

  it('shows a pile with no stack whole from the start, and collapses it when it merges', async () => {
    const v = await staged(READS, [{ verb: 'merge', element: 'reads', t: 2, seconds: 0.8 }]);
    expect((await read(v, v.frameAt(0.3))).rows.map((r) => [r.items, r.num])).toEqual([
      [12, '28'],
      [10, '10'],
    ]);
    const merged = await read(v, v.frameAt(3.1));
    expect(merged.rows.map((r) => [r.items, r.numOpacity])).toEqual([
      [1, 0],
      [1, 0],
    ]);
  });

  it('fits two rows in a tall frame', async () => {
    const v = await staged(READS, [STACK], VERTICAL);
    const frame = v.frameAt(3);
    const card = (await v.seek(
      frame,
      `const r = document.querySelector('.pcard').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };`,
    )) as Rect;
    const inside = (await v.seek(
      frame,
      `return [...document.querySelectorAll('.pitem')].map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });`,
    )) as Rect[];
    expect(inside).toHaveLength(22);
    for (const r of inside) {
      expect(r.x).toBeGreaterThanOrEqual(card.x - 1);
      expect(r.x + r.width).toBeLessThanOrEqual(card.x + card.width + 1);
      expect(r.y).toBeGreaterThanOrEqual(card.y - 1);
      expect(r.y + r.height).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    expect((await v.report(frame)).items.some((i) => i.overflow)).toBe(false);
  });

  it('sets a pile’s name as text, whatever it holds', async () => {
    const hostile = '<b onmouseover="window.__pwned=2">steps</b>';
    const v = await staged(
      (r) => [
        {
          id: 'reads',
          kind: 'pile',
          rect: r.media,
          name: hostile,
          rows: [{ side: 'head', count: 3 }],
        },
      ],
      [],
    );
    const frame = v.frameAt(1);
    expect((await read(v, frame)).pileName).toBe(hostile);
    expect(
      await v.seek(frame, 'return document.querySelectorAll("[data-element] b").length;'),
    ).toBe(0);
  });

  it('counts a counter up from zero, holds it, then counts it from before to after', async () => {
    const v = await staged(
      (r) => [
        {
          id: 'bytes',
          kind: 'metric',
          rect: r.media,
          show: 'counter',
          name: 'request bytes',
          from: 70406,
          to: 9907,
          decimals: 0,
          delta: -86,
        },
      ],
      [
        { verb: 'count-up', element: 'bytes', value: 70406, t: 0.5, seconds: 1.6 },
        { verb: 'count', element: 'bytes', t: 2.6, seconds: 1.6 },
      ],
    );
    expect((await read(v, v.frameAt(0.3))).value).toBe('0');
    const rising = Number((await read(v, v.frameAt(1.3))).value!.replace(/,/g, ''));
    expect(rising).toBeGreaterThan(0);
    expect(rising).toBeLessThan(70406);
    expect((await read(v, v.frameAt(2.3))).value).toBe('70,406');
    expect((await read(v, v.frameAt(4.5))).value).toBe('9,907');
  });

  it('counts a single value up from zero', async () => {
    const v = await staged(
      (r) => [
        {
          id: 'n',
          kind: 'metric',
          rect: r.media,
          show: 'counter',
          name: 'reader steps',
          to: 28,
          decimals: 0,
        },
      ],
      [{ verb: 'count-up', element: 'n', value: 28, t: 0.5, seconds: 1.6 }],
    );
    expect((await read(v, v.frameAt(0.3))).value).toBe('0');
    expect((await read(v, v.frameAt(2.5))).value).toBe('28');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/numbers.test.ts packages/video/test/flow-timeline.test.ts tests/render/flow.test.ts`
Expected: FAIL — `counterValue` is not exported, and the timeline has no `pile` element or `stack`/`count-up` beat (typecheck).

- [ ] **Step 3: Timeline types (`packages/video/src/timeline/types.ts`)**

After Task 1's `ChangeSide`:

```ts
/** One row of a pile: the count of one side, drawn as up to twelve items and the true number. */
export interface PileRow {
  side: ChangeSide;
  count: number;
}
```

`DirectionElement` gains, after Task 1's `packet` member:

```ts
  /** A pile: a measured count of each side, stacked as items, with its true number. */
  | { id: string; kind: 'pile'; rect: Rect; name: string; rows: PileRow[] }
```

and `DirectionBeat` gains, after Task 1's `merge` member:

```ts
  | { verb: 'stack'; element: string; t: number; seconds: number }
  | { verb: 'count-up'; element: string; value: number; t: number; seconds: number }
```

- [ ] **Step 4: Draw piles (`packages/video/src/runtime/direction/flow.ts`)**

1. The file's header comment becomes:

```ts
/*
 * Flow verbs, drawn: edges between nodes with packets travelling them, splits that fan a packet
 * or a node into pieces and merges that pull them back together, and piles that stack up to a
 * measured count. Every position is a pure function of the clock (geometry from `routes.ts`),
 * and all text is set as text.
 */
```

2. Imports: `easeOutBack` joins the `../anim.ts` import, `place` the `../dom.ts` import, and `pileGrid`, `stackCount`, `stackRows` the `../routes.ts` import. Below `type PacketElement = …;` add `type PileElement = Extract<DirectionElement, { kind: 'pile' }>;`.
3. `FlowSpans` gains `stack?: Span;` after `merge?: MergeSpan;`, and `flowSpans`' loop gains a branch after its `merge` branch:

```ts
    else if (b.verb === 'stack' && b.element === id) spans.stack = own(b);
```

4. Append at the end of the file:

```ts
/**
 * A pile: a card with what is counted (the run's own word for it, or the agent's label, set as
 * text) and a row per side, before above after, each up to twelve items and the true number. A
 * stack fills the rows one after the other, item by item, the number counting up with them; a
 * merge collapses each row into its first item.
 */
export function pile(e: PileElement, ctx: ComponentContext, spans: FlowSpans): Component {
  const u = ctx.u;
  const labels = ctx.timeline.labels;
  const card = el('div', 'pcard', ctx.root);
  place(card, e.rect);
  const name = el('div', 'pname', card, e.name);
  const rows = e.rows.map((r) => {
    const row = el('div', 'prow', card);
    const cap = el(
      'div',
      'pcap',
      row,
      r.side === 'base' ? (labels?.before ?? 'Before') : (labels?.after ?? 'After'),
    );
    const grid = el('div', 'pgrid', row);
    const num = el('div', 'pnum', row, formatNumber(r.count, 0));
    return { ...r, row, cap, grid, num };
  });
  const inner = card.clientWidth - 2 * u(32);
  fitText(name, { max: u(44), min: u(28), maxWidth: inner });
  const rowHeight = rows[0]?.row.clientHeight ?? 0;
  const numFont = Math.max(u(36), Math.min(u(72), 0.55 * rowHeight));
  for (const r of rows) {
    r.cap.style.fontSize = `${u(30)}px`;
    r.num.style.fontSize = `${numFont}px`;
    // The number's column fits the true count, so counting up never moves the items.
    r.num.style.minWidth = `${Math.ceil(r.num.scrollWidth) + 2}px`;
  }
  const items = rows.map((r) =>
    pileGrid(r.count, { width: r.grid.clientWidth, height: r.grid.clientHeight }, u(10)).map(
      (rect) => {
        const item = el('div', `pitem ${r.side}`, r.grid);
        place(item, rect);
        return { item, rect };
      },
    ),
  );
  let numsShown = true;
  return {
    update(clock) {
      const t = clock.t;
      const k = spans.stack ? seg(t, spans.stack.t, spans.stack.t + spans.stack.seconds) : 1;
      const km = spans.merge
        ? easeInOutCubic(seg(t, spans.merge.t, spans.merge.t + spans.merge.seconds))
        : 0;
      const progress = stackRows(k, rows.length);
      rows.forEach((r, i) => {
        const row = items[i]!;
        const n = row.length;
        // A merge gathers every item onto the row's first.
        const first = row[0]?.rect;
        row.forEach(({ item, rect }, j) => {
          const p = seg(progress[i]!, j / n, (j + 1) / n);
          const dx = (first!.x - rect.x) * km;
          const dy = (first!.y - rect.y) * km;
          const scale = p >= 1 ? 1 : 0.4 + 0.6 * easeOutBack(p);
          item.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
          const gone = j > 0 ? seg(km, 0.8, 1) : 0;
          item.style.opacity = (p > 0 ? Math.min(1, p * 3) * (1 - gone) : 0).toFixed(3);
        });
        const text = formatNumber(stackCount(r.count, progress[i]!), 0);
        if (r.num.textContent !== text) r.num.textContent = text;
        r.num.style.opacity = (1 - km).toFixed(3);
      });
      numsShown = km < 1;
    },
    report: () => [
      { role: 'media', rect: rectOf(card) },
      textItem(name),
      ...rows.flatMap((r) => [textItem(r.cap), ...(numsShown ? [textItem(r.num)] : [])]),
    ],
  };
}
```

- [ ] **Step 5: Count up (`packages/video/src/runtime/numbers.ts`, `runtime/direction/metric.ts`)**

Append to `packages/video/src/runtime/numbers.ts`:

```ts
/** A count-up: the counter rises from zero to `value` (one side of its metric) over the span. */
export interface CountUpSpan extends CountSpan {
  value: number;
}

/**
 * The value a counter shows at `t`. It rises from zero to its count-up's value while that counts
 * up, holds it, then ticks from `from` to `to` during its count; before either starts it shows
 * where the first one starts (zero for a count-up, `from` for a count), and without either, `to`.
 */
export function counterValue(
  e: { from?: number; to: number; decimals: number },
  t: number,
  count?: CountSpan,
  up?: CountUpSpan,
): number {
  const ticks = count && e.from !== undefined ? count : undefined;
  if (up && (!ticks || t < ticks.t))
    return tickValue(0, up.value, countProgress(t, up), e.decimals);
  if (ticks) return tickValue(e.from!, e.to, countProgress(t, ticks), e.decimals);
  return e.to;
}
```

In B4's `packages/video/src/runtime/direction/metric.ts`:

1. Add `type CountUpSpan` and `counterValue` to its `../numbers.ts` import.
2. `metric` gains a last parameter `up?: CountUpSpan` and passes it on: `return counter(e, ctx, count, up);` (bars and compares never count up; the direction file's checks refuse it).
3. `counter` gains a last parameter `up?: CountUpSpan`, and its `update` becomes:

```ts
    update(clock) {
      const now = formatNumber(counterValue(e, clock.t, count, up), e.decimals);
      if (now !== shown) value.textContent = shown = now;
      // The change shows once the number has landed: on its count, else on its count-up.
      if (delta) delta.style.opacity = deltaOpacity(clock.t, count ?? up).toFixed(3);
    },
```

(`counterValue` gives exactly B4's `shownValue` when there is no count-up; `shownValue` stays for bars and compares. The counter's size is fitted to `to` and `from`, and a count-up's value is one of them, so the size never changes.)

- [ ] **Step 6: Piles and count-ups in a shot (`packages/video/src/runtime/direction/elements.ts`)**

1. Imports: add `import type { CountUpSpan } from '../numbers.ts';` and `pile` to the `./flow.ts` import. Next to `type Reveal = …;` add `type CountUp = Extract<DirectionBeat, { verb: 'count-up' }>;`.
2. In `mountShot`'s element map, after Task 1's packet `zIndex` line:

```ts
    const up = direction.beats.find(
      (b): b is CountUp => b.verb === 'count-up' && b.element === element.id,
    );
    const countUp = up && { t: up.t - shift, seconds: up.seconds, value: up.value };
```

and the `draw(…)` call gains a sixth argument, `countUp`.
3. `draw` gains a sixth parameter `up?: CountUpSpan`; B4's `metric` case becomes `return { component: metric(element, ctx, span, up) };`, and a `pile` case joins Task 1's `packet` case:

```ts
    case 'pile':
      return { component: pile(element, ctx, spans) };
```

- [ ] **Step 7: Styles (`packages/video/src/runtime/styles.ts`)**

After Task 1's `/* Flows */` block:

```css
/* Piles */
.pcard { position: absolute; display: flex; flex-direction: column; gap: ${u(18)}; padding: ${u(28)} ${u(32)}; border-radius: ${u(28)};
  border: ${u(3)} solid ${c.line}; background: ${c.surface}; box-shadow: ${c.shadow}; overflow: hidden; }
.pcard .pname { flex: none; color: ${c.textMuted}; font-weight: 650; line-height: 1.2; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcard .prow { flex: 1 1 0; min-height: 0; display: flex; align-items: center; gap: ${u(18)}; }
.pcard .pcap { flex: none; color: ${c.textMuted}; font-weight: 650; white-space: nowrap; line-height: 1.15; }
.pcard .pgrid { position: relative; flex: 1 1 auto; align-self: stretch; min-width: 0; }
.pcard .pitem { position: absolute; border-radius: ${u(8)}; background: ${c.line}; transform-origin: center; }
.pcard .pitem.head { background: ${c.primary}; }
.pcard .pnum { flex: none; text-align: right; color: ${c.text}; font-weight: 800; line-height: 1.05; white-space: nowrap; font-variant-numeric: tabular-nums; }
```

(The before row's items take the theme's line color and the after row's its primary color, as B4's bars do.)

- [ ] **Step 8: Settling and lead kind**

`packages/video/src/timeline/cues.ts` — Task 1's packet line becomes:

```ts
    // A packet or a pile is in place half a second after it enters; its verbs end with the beats.
    if (e.kind === 'packet' || e.kind === 'pile') return at + 0.5;
```

`packages/video/src/density.ts` — add `pile: 'flow',` to `LOOKS_LIKE`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/numbers.test.ts packages/video/test/flow-timeline.test.ts tests/render/flow.test.ts tests/render/metric.test.ts`
Expected: PASS (B4's metric render tests confirm a counter without a count-up draws as before). Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS.

(Prototyped the same way as Task 1: the six render tests passed; at 1080p a two-row pile in a 850 × 423 slot draws 65-unit items and 72-unit numbers, and at 9:16 all 22 items stay inside the card.)

- [ ] **Step 10: Commit**

```bash
npx biome check --write packages/video/src packages/video/test tests/render/flow.test.ts
npm run lint && npm run typecheck
git add packages/video/src/timeline packages/video/src/runtime packages/video/src/density.ts packages/video/test tests/render/flow.test.ts
git commit -m "$(cat <<'EOF'
Draw piles that stack to a measured count, and counters that count up

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 3: The direction file speaks flows — schema, checks, resolution, and the scene's evidence

**Files:**
- Modify: `packages/video/src/direction/schema.ts` (`DIRECTION_LIMITS.drawnItems`; the `packet` and `pile` members of `ShotElementSchema`; the five verbs in `ShotBeatSchema`)
- Modify: `packages/video/src/direction/sources.ts` (`UNKNOWN_EVIDENCE`)
- Modify: `packages/video/src/direction/metric.ts` (B4's: export `sides` and `metricName`)
- Create: `packages/video/src/direction/flow.ts`
- Modify: `packages/video/src/direction/refs.ts` (imports, `ACTS_ON`, the beats loop, `elementProblems`)
- Modify: `packages/video/src/direction/layout.ts` (`WEIGHT`)
- Modify: `packages/video/src/direction/resolve.ts` (imports, `BEAT_SECONDS`, `resolveShot`, `element`, `timeBeats`, two new functions)
- Modify: `packages/video/src/grounding.ts` (`sceneEvidence`)
- Create: `packages/video/test/direction-flow.test.ts`
- Modify: `packages/video/test/direction-schema.test.ts`, `tests/direction-security.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2's timeline types; `DRAWN_ITEMS`, `textBoxRect` (`runtime/routes.ts`, DOM-free); B2's schema helpers, `elementSlots`, `directionProblems`, `resolveDirection`, `sceneEvidence`; B3's `ACTS_ON`; B4's `DirectionSources.metric`, `MetricSource`, `sides`, `metricName`, `COUNT_MIN`, the `count` landing.
- Produces:
  ```ts
  // packages/video/src/direction/schema.ts
  // DIRECTION_LIMITS.drawnItems is DRAWN_ITEMS (12), from runtime/routes.ts.
  // ShotElement gains:
  //   | { id; kind: 'packet'; label?: string }
  //   | { id; kind: 'pile'; evidence: string; side?: 'base' | 'head'; label?: string }
  // ShotBeat gains:
  //   | { verb: 'flow'; from: string; to: string; packet?: string; at?: string }
  //   | { verb: 'split'; element: string; count: string; side: 'base' | 'head'; at?: string }
  //   | { verb: 'merge'; element: string; at?: string }
  //   | { verb: 'stack'; element: string; at?: string }
  //   | { verb: 'count-up'; element: string; side: 'base' | 'head'; at?: string }

  // packages/video/src/direction/sources.ts
  export const UNKNOWN_EVIDENCE: string;   // refs.ts's former UNKNOWN, shared

  // packages/video/src/direction/flow.ts
  export type PileShotElement = Extract<ShotElement, { kind: 'pile' }>;
  export function beatTargets(beat: ShotBeat): string[];
  export function ridingPackets(shot: Pick<Shot, 'beats'>): Set<string>;
  export function flowSlots(shot: Pick<Shot, 'elements' | 'beats' | 'layout'>, region: Rect,
    orientation: 'vertical' | 'landscape' | 'square', gap: number, unit: number): Rect[];
  export function pileProblems(element: PileShotElement, metric: MetricSource): string[];
  export function flowBeatProblems(shot: Pick<Shot, 'elements' | 'beats'>, index: number,
    evidence: EvidenceIndex | undefined, sources: DirectionSources): string[];
  export function resolvePile(e: PileShotElement, metric: MetricSource | undefined, rect: Rect,
    labels: Pick<TimelineLabels, 'stats'>): Extract<DirectionElement, { kind: 'pile' }> | undefined;
  export function splitCount(beat: SplitBeat, metric: MetricSource | undefined,
    labels: Pick<TimelineLabels, 'stats'>): { count: number; name: string } | undefined;
  export function mergeInto(beat: MergeBeat, shot: Pick<Shot, 'beats'>, sources: DirectionSources,
    labels: Pick<TimelineLabels, 'stats'>): { count: 1; name: string; side: ChangeSide } | undefined;
  export function countUpValue(beat: CountUpBeat, shot: Pick<Shot, 'elements'>, sources: DirectionSources): number | undefined;

  // packages/video/src/direction/resolve.ts
  // BEAT_SECONDS gains flow 1.2, split 0.9, merge 0.8, stack 1.8, 'count-up' 1.6.

  // packages/video/src/grounding.ts
  export function sceneEvidence(scene, index, findings?, shot?: Pick<Shot, 'elements'> & Partial<Pick<Shot, 'beats'>>): string[];
  ```
  Rules the checks enforce (all problems at once, exit 2, as B2): a flow runs between two different nodes and its packet is a packet that leaves from where its last flow arrived; a split breaks a packet or a node into a whole count of at least one (its `count` a `metric:` item with that side); a merge pulls back a split made earlier in the shot, or collapses a pile; a stack fills a pile (B3's `ACTS_ON`); a count-up raises a counter to the side it shows (its one side; else base when a `count` follows, head when none does); each acts on an element once; a pile's metric gives whole counts of zero or more on the sides it shows. Resolution: a packet a flow carries takes no slot (its box is the node its first flow leaves); a pile gets a row per side; a split gets its count and name; a merge of a split gets `into` when the metric measured exactly one on the other side; a count-up lands on its phrase like a count and gets its value; a merge timed before its split and a count-up that has not landed when its counter's count starts are dropped; flows, splits, merges, and stacks stretch toward the next beat (ending 0.15 s before it), up to three times their length.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/direction-flow.test.ts`:

```ts
import {
  buildEvidence,
  DEFAULT_CONFIG,
  type Demonstration,
  indexEvidence,
  Redactor,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { captionOptionsFor } from '../src/captions.ts';
import { elementSlots } from '../src/direction/layout.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { BEAT_SECONDS, resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { sceneEvidence } from '../src/grounding.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import { textBoxRect } from '../src/runtime/routes.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor, phraseMoment } from '../src/timeline/build.ts';

const demo = {
  commands: [
    {
      name: 'Measure the review request',
      command: 'node scripts/measure.js',
      before: {
        exitCode: 0,
        output: 'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1\nratio: 0.25',
      },
      after: {
        exitCode: 0,
        output:
          'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0\nratio: 0.125\ncache hits: 3',
      },
      changed: true,
    },
  ],
  shots: [],
  requests: [],
  skipped: [],
  findings: [],
} as unknown as Demonstration;
const evidence = indexEvidence(buildEvidence({ demo }));
const sources = directionSources({ demo, evidence });
const NARRATION =
  'Here is the same command before and after the change, and it now prints request bytes: 9907.';
const scenes: Scene[] = [
  SceneSchema.parse({
    id: 's1',
    beat: 's1',
    narration: 'The request carried every document.',
    visual: { kind: 'callout', title: 'Before' },
  }),
  SceneSchema.parse({
    id: 's2',
    beat: 's2',
    narration: NARRATION,
    minSeconds: 8,
    visual: { kind: 'terminal', command: 'node scripts/measure.js', output: 'request bytes: 9907' },
  }),
];
const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
const regions = computeRegions({ ...spec, orientation: 'landscape' });
const id = (name: string) => `metric:terminal-1:${name}`;
const shot = (elements: unknown[], beats: unknown[] = []) =>
  ({ shots: [{ scene: 's2', elements, beats }] }) as DirectionInput;
const problems = (direction: DirectionInput) =>
  directionProblems(DirectionSchema.parse(direction), scenes, evidence, sources);
const resolve = (direction: DirectionInput, redactor = new Redactor()) =>
  resolveDirection({
    plan: DirectionSchema.parse(direction),
    scenes,
    layout,
    spec,
    language: 'en',
    sources,
    image: () => ({ src: '', width: 1, height: 1 }),
    seed: 5,
    redact: (value) => redactor.redactDeep(value),
  });
const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;

const node = (name: string, label = 'Reader') => ({ id: name, kind: 'node', label });
const STAGE = [
  node('a', 'Request builder'),
  node('b'),
  { id: 'p', kind: 'packet', label: 'Request' },
  { id: 'r', kind: 'pile', evidence: id('reader-steps') },
  { id: 'm', kind: 'metric', evidence: id('request-bytes') },
];
const STORY = [
  { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
  { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
  { verb: 'stack', element: 'r' },
  { verb: 'merge', element: 'p' },
  { verb: 'count-up', element: 'm', side: 'base', at: 'before and after' },
  { verb: 'count', element: 'm', at: 'request bytes' },
];

describe('flow verbs in the direction file', () => {
  it('accept packets, piles, and every flow verb, and nothing that states a number', () => {
    expect(rejected(shot(STAGE, STORY))).toBe(false);
    const pile = (extra: Record<string, unknown>) =>
      shot([{ id: 'r', kind: 'pile', evidence: id('reader-steps'), ...extra }]);
    for (const extra of [
      { count: 28 },
      { value: 28 },
      { items: 12 },
      { side: 'both' },
      { label: '28 steps' },
    ])
      expect(rejected(pile(extra)), JSON.stringify(extra)).toBe(true);
    for (const extra of [{ count: 4 }, { label: '10x request' }])
      expect(rejected(shot([{ id: 'p', kind: 'packet', ...extra }])), JSON.stringify(extra)).toBe(
        true,
      );
    const beat = (b: Record<string, unknown>) => shot(STAGE, [b]);
    for (const b of [
      { verb: 'split', element: 'p', count: 4, side: 'base' },
      { verb: 'split', element: 'p', count: id('chunks'), side: 'base', pieces: 4 },
      { verb: 'split', element: 'p', count: id('chunks') },
      { verb: 'flow', from: 'a', to: 'b', path: 'M0 0' },
      { verb: 'merge', element: 'p', count: 1 },
      { verb: 'stack', element: 'r', count: 28 },
      { verb: 'count-up', element: 'm' },
      { verb: 'count-up', element: 'm', side: 'base', to: 5 },
    ])
      expect(rejected(beat(b)), JSON.stringify(b)).toBe(true);
  });

  it('pass Covi’s checks when each beat has what it asks of its elements', () => {
    expect(problems(shot(STAGE, STORY))).toEqual([]);
  });

  it('name every problem with a flow, a split, a merge, or a stack, all at once', () => {
    expect(
      problems(
        shot(
          [
            node('a'),
            node('b'),
            { id: 'p', kind: 'packet' },
            { id: 'q', kind: 'packet' },
            { id: 's', kind: 'pile', evidence: id('ratio') },
            { id: 't', kind: 'pile', evidence: id('cache-hits'), side: 'base' },
            { id: 'l', kind: 'label', text: 'Slow' },
          ],
          [
            { verb: 'flow', from: 'a', to: 'p' },
            { verb: 'flow', from: 'a', to: 'a' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'l' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'q' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'q' },
            { verb: 'split', element: 'l', count: id('chunks'), side: 'base' },
            { verb: 'split', element: 'p', count: 'terminal:1', side: 'base' },
            { verb: 'split', element: 'q', count: id('ratio'), side: 'base' },
            { verb: 'split', element: 'a', count: id('timeouts'), side: 'head' },
            { verb: 'split', element: 'a', count: id('chunks'), side: 'base' },
            { verb: 'merge', element: 'b' },
            { verb: 'stack', element: 'p' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), element s: "metric:terminal-1:ratio" is 0.25 at base; a pile draws a whole number of items, zero or more',
      'shot 1 (scene s2), element s: "metric:terminal-1:ratio" is 0.125 at head; a pile draws a whole number of items, zero or more',
      'shot 1 (scene s2), element t: side "base": "metric:terminal-1:cache-hits" has only a head value',
      'shot 1 (scene s2), beat 1 (flow): flow runs between nodes, and "p" is a packet',
      'shot 1 (scene s2), beat 2 (flow): flow runs between two different nodes, and both ends are "a"',
      'shot 1 (scene s2), beat 3 (flow): flow carries a packet, and "l" is a label',
      'shot 1 (scene s2), beat 5 (flow): "q" is at "b" after beat 4; its next flow leaves from there',
      'shot 1 (scene s2), beat 6 (split): split breaks a packet or a node, and "l" is a label',
      'shot 1 (scene s2), beat 7 (split): split counts a metric: item, and "terminal:1" is a terminal',
      'shot 1 (scene s2), beat 8 (split): "metric:terminal-1:ratio" is 0.25 at base; a split breaks into a whole number of pieces, one or more',
      'shot 1 (scene s2), beat 9 (split): "metric:terminal-1:timeouts" is 0 at head; a split breaks into a whole number of pieces, one or more',
      'shot 1 (scene s2), beat 10 (split): "a" already splits at an earlier beat; it splits once',
      'shot 1 (scene s2), beat 11 (merge): merge pulls a split back together, and nothing splits "b" before it',
      'shot 1 (scene s2), beat 12 (stack): stack acts on a pile element, and "p" is a packet',
    ]);
  });

  it('name every problem with a merge, a stack, or a count-up, and with a beat naming no element', () => {
    expect(
      problems(
        shot(
          [
            { id: 'p', kind: 'packet' },
            { id: 'r', kind: 'pile', evidence: id('reader-steps') },
            { id: 'l', kind: 'label', text: 'Slow' },
            { id: 'm', kind: 'metric', evidence: id('request-bytes') },
            { id: 'n', kind: 'metric', evidence: id('chunks'), side: 'base' },
            { id: 'o', kind: 'metric', evidence: id('chunks'), show: 'bars' },
            { id: 'k', kind: 'metric', evidence: id('reader-steps') },
          ],
          [
            { verb: 'merge', element: 'l' },
            { verb: 'stack', element: 'r' },
            { verb: 'stack', element: 'r' },
            { verb: 'merge', element: 'r' },
            { verb: 'merge', element: 'r' },
            { verb: 'count-up', element: 'r', side: 'base' },
            { verb: 'count-up', element: 'o', side: 'head' },
            { verb: 'count-up', element: 'n', side: 'head' },
            { verb: 'count-up', element: 'm', side: 'head' },
            { verb: 'count-up', element: 'k', side: 'base' },
            { verb: 'count', element: 'm' },
            { verb: 'flow', from: 'zz', to: 'p', packet: 'p' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), beat 1 (merge): merge collapses a split or a pile, and "l" is a label',
      'shot 1 (scene s2), beat 3 (stack): "r" already stacks at an earlier beat; it stacks once',
      'shot 1 (scene s2), beat 5 (merge): "r" already merges at an earlier beat; it merges once',
      'shot 1 (scene s2), beat 6 (count-up): count-up counts a metric up, and "r" is a pile',
      'shot 1 (scene s2), beat 7 (count-up): count-up counts up a counter, and "o" shows "bars"',
      'shot 1 (scene s2), beat 8 (count-up): "n" shows its base value; count up to side "base"',
      'shot 1 (scene s2), beat 9 (count-up): "m" counts from its base value; count up to side "base", where the count starts',
      'shot 1 (scene s2), beat 10 (count-up): "k" shows its head value; count up to side "head"',
      'shot 1 (scene s2), beat 12 (flow): the shot has no element "zz" (it has: p, r, l, m, n, o, k)',
    ]);
  });

  it('resolve piles, splits, flows, and count-ups from the evidence, the riding packet without a slot', () => {
    const [, s2] = resolve(
      shot(
        [
          ...STAGE,
          { id: 'h', kind: 'pile', evidence: id('reader-steps'), side: 'head', label: 'Reads' },
        ],
        STORY,
      ),
    );
    const byId = new Map(s2!.direction.elements.map((e) => [e.id, e]));
    expect(byId.get('r')).toMatchObject({
      kind: 'pile',
      name: 'reader steps',
      rows: [
        { side: 'base', count: 28 },
        { side: 'head', count: 10 },
      ],
    });
    expect(byId.get('h')).toMatchObject({ name: 'Reads', rows: [{ side: 'head', count: 10 }] });
    expect(byId.get('p')).toMatchObject({ kind: 'packet', label: 'Request' });
    // The packet rides the edge: it starts on the node it leaves, and the rest share the slots.
    expect(byId.get('p')!.rect).toEqual(textBoxRect(byId.get('a')!.rect, regions.unit, false));
    const slots = elementSlots(
      ['node', 'node', 'pile', 'metric', 'pile'],
      'auto',
      regions.media,
      'landscape',
      28 * regions.unit,
    );
    expect(['a', 'b', 'r', 'm', 'h'].map((e) => byId.get(e)!.rect)).toEqual(slots);
    const beats = s2!.direction.beats;
    expect(beats.find((b) => b.verb === 'split')).toMatchObject({
      element: 'p',
      count: 4,
      name: 'chunks',
      side: 'base',
      seconds: BEAT_SECONDS.split,
    });
    expect(beats.find((b) => b.verb === 'flow')).toMatchObject({
      from: 'a',
      to: 'b',
      packet: 'p',
      seconds: BEAT_SECONDS.flow,
    });
    expect(beats.find((b) => b.verb === 'stack')).toMatchObject({ element: 'r', seconds: 1.8 });
    expect(beats.find((b) => b.verb === 'merge')).toMatchObject({ element: 'p' });
    // A count-up lands on its phrase, like a count, and before the count starts.
    const up = beats.find((b) => b.verb === 'count-up')!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const moment = phraseMoment(NARRATION, 'before and after', layout.scenes[1]!, options)!;
    expect(up).toMatchObject({ element: 'm', value: 70406 });
    expect(up.t + up.seconds).toBeCloseTo(moment, 2);
    expect(up.t).toBeLessThan(beats.find((b) => b.verb === 'count')!.t);
  });

  it('stretch flows, splits, merges, and stacks toward the next beat, up to three times their length', () => {
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'stack', element: 'r' },
        { verb: 'merge', element: 'p' },
      ]),
    );
    const beats = s2!.direction.beats;
    const end = layout.scenes[1]!.end - layout.scenes[1]!.start;
    beats.forEach((b, i) => {
      const own = BEAT_SECONDS[b.verb as 'split' | 'stack' | 'merge'];
      const room = (beats[i + 1]?.t ?? end) - 0.15 - b.t;
      expect(b.seconds, b.verb).toBeCloseTo(Math.min(3 * own, Math.max(own, room)), 3);
    });
    expect(beats[0]!.seconds).toBeGreaterThan(BEAT_SECONDS.split);
  });

  it('caption what a split merges into only when the run measured exactly one', () => {
    const merged = (count: string, side: 'base' | 'head') =>
      resolve(
        shot(STAGE, [
          { verb: 'split', element: 'p', count: id(count), side },
          { verb: 'merge', element: 'p' },
        ]),
      )[1]!.direction.beats.find((b) => b.verb === 'merge');
    expect(merged('chunks', 'base')).toMatchObject({
      into: { count: 1, name: 'chunks', side: 'head' },
    });
    expect(merged('reader-steps', 'base')).not.toHaveProperty('into');
    expect(merged('chunks', 'head')).not.toHaveProperty('into');
  });

  it('drop a merge timed before its split, and a count-up timed after its count', () => {
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base', at: 'request bytes' },
        { verb: 'merge', element: 'p', at: 'Here is the same command' },
        { verb: 'count', element: 'm' },
        { verb: 'count-up', element: 'm', side: 'base', at: 'request bytes' },
      ]),
    );
    expect(s2!.direction.beats.map((b) => b.verb).sort()).toEqual(['count', 'split']);
  });

  it('redact what they resolve, and count what a split shows as the scene’s evidence', () => {
    const [, s2] = resolve(
      shot([{ id: 'r', kind: 'pile', evidence: id('reader-steps'), label: 'zebracorn steps' }]),
      new Redactor({ literals: ['zebracorn'] }),
    );
    expect(JSON.stringify(s2)).not.toContain('zebracorn');
    const plan = DirectionSchema.parse(shot(STAGE, STORY)).shots[0]!;
    expect(sceneEvidence(scenes[1]!, evidence, [], plan)).toEqual([
      id('reader-steps'),
      id('request-bytes'),
      id('chunks'),
    ]);
  });
});
```

In `packages/video/test/direction-schema.test.ts`, in `it('rejects kinds and verbs this PR does not draw', …)`, remove `'packet'` and `'pile'` from the kinds list and `'flow'` from the verbs list (B3 and B4 removed theirs), leaving `['html', 'iframe']` and `['eval']`.

In `tests/direction-security.test.ts`, inside `describe('a hostile direction file', …)`, add:

```ts
  it('cannot state a count on a pile or a split: counts come only from the metric cited', () => {
    const staged = (elements: unknown[], beats: unknown[] = []) => ({
      shots: [{ scene: 's1', elements, beats }],
    });
    const pile = { id: 'r', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' };
    const packet = { id: 'p', kind: 'packet' };
    const split = { verb: 'split', element: 'p', count: 'metric:terminal-1:chunks', side: 'base' };
    expect(rejected(staged([pile, packet], [split, { verb: 'stack', element: 'r' }]))).toBe(false);
    for (const extra of [{ count: 28 }, { value: 28 }, { items: 12 }, { label: '28 reads' }])
      expect(rejected(staged([{ ...pile, ...extra }])), JSON.stringify(extra)).toBe(true);
    for (const beat of [
      { ...split, count: 4 },
      { ...split, pieces: 4 },
      { verb: 'stack', element: 'r', count: 28 },
      { verb: 'merge', element: 'p', into: 1 },
      { verb: 'count-up', element: 'm', side: 'head', value: 9907 },
      { verb: 'flow', from: 'a', to: 'b', d: 'M0 0 L9 9' },
    ])
      expect(rejected(staged([pile, packet], [beat])), JSON.stringify(beat)).toBe(true);
  });

  it('cannot smuggle markup, script, or links through a packet or a pile', () => {
    for (const text of ['<script>alert(1)</script>', 'javascript:alert(1)', 'https://evil.example'])
      for (const element of [
        { id: 'p', kind: 'packet', label: text },
        { id: 'r', kind: 'pile', evidence: 'metric:terminal-1:reader-steps', label: text },
      ])
        expect(rejected({ shots: [{ scene: 's1', elements: [element] }] }), text).toBe(true);
  });
```

and inside `describe('a direction citing evidence the run does not have', …)`:

```ts
  it('refuses a pile or a split that counts what the run never measured', () => {
    const evidence = indexEvidence({ items: [] });
    const found = directionProblems(
      DirectionSchema.parse({
        shots: [
          {
            scene: 's1',
            elements: [
              { id: 'r', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' },
              { id: 'p', kind: 'packet' },
            ],
            beats: [{ verb: 'split', element: 'p', count: '4', side: 'base' }],
          },
        ],
      }),
      [{ id: 's1', narration: 'One line.' }],
      evidence,
      directionSources({ evidence }),
    );
    expect(found).toEqual([
      'shot 1 (scene s1), element r: cites "metric:terminal-1:reader-steps", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s1), beat 1 (split): cites "4", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/direction-flow.test.ts packages/video/test/direction-schema.test.ts tests/direction-security.test.ts`
Expected: FAIL — the schema rejects `kind: 'packet'`, `kind: 'pile'`, and the five verbs.

- [ ] **Step 3: The schema (`packages/video/src/direction/schema.ts`)**

1. Add `import { DRAWN_ITEMS } from '../runtime/routes.ts';` (DOM-free), and in `DIRECTION_LIMITS` replace the `drawnItems` entry and its comment with:

```ts
  /** Items a pile or a split draws at most; the true count is drawn beside them. */
  drawnItems: DRAWN_ITEMS,
```

2. Add these members to `ShotElementSchema`'s list (after B4's `metric` member):

```ts
  z
    .strictObject({
      id: ElementIdSchema,
      kind: z.literal('packet'),
      label: LabelSchema.optional().describe("What travels, in the video's language (no digits)."),
    })
    .describe(
      'A packet: a pill a `flow` carries from node to node (else it sits in its slot); it can `split` into pieces and `merge` back.',
    ),
  z
    .strictObject({
      id: ElementIdSchema,
      kind: z.literal('pile'),
      evidence: EvidenceRefSchema.describe(
        'A metric: id whose value is a whole count: the pile draws that many items (twelve at most) and the true number.',
      ),
      side: z
        .enum(['base', 'head'])
        .optional()
        .describe(
          'One side only: base (before the change) or head (after). Default: a row for each side the metric has, before above after.',
        ),
      label: LabelSchema.optional().describe(
        "What is counted, in the video's language (no digits). Default: what the output called it.",
      ),
    })
    .describe('A pile of a measured count: `stack` piles it up item by item; `merge` collapses it.'),
```

3. Add these members to `ShotBeatSchema`'s list (after B4's `count` member):

```ts
  z
    .strictObject({
      verb: z.literal('flow'),
      from: ElementIdSchema.describe('The node it leaves.'),
      to: ElementIdSchema.describe('The node it reaches.'),
      packet: ElementIdSchema.optional().describe(
        'The packet it carries; without one, a dot travels. The edge is drawn as it goes.',
      ),
      at: PhraseSchema.optional(),
    })
    .describe('Something travels along the edge from one node to another.'),
  z
    .strictObject({
      verb: z.literal('split'),
      element: ElementIdSchema.describe('The packet or node that breaks apart.'),
      count: EvidenceRefSchema.describe(
        'A metric: id: how many pieces (twelve drawn at most; the true count is shown under them).',
      ),
      side: z
        .enum(['base', 'head'])
        .describe("Which of the metric's values: base (before the change) or head (after)."),
      at: PhraseSchema.optional(),
    })
    .describe('One thing breaks into as many pieces as a measured count.'),
  z
    .strictObject({ verb: z.literal('merge'), element: ElementIdSchema, at: PhraseSchema.optional() })
    .describe('The pieces of a split, or a pile, collapse into one.'),
  z
    .strictObject({ verb: z.literal('stack'), element: ElementIdSchema, at: PhraseSchema.optional() })
    .describe('A pile fills up item by item, its number counting up to the true count.'),
  z
    .strictObject({
      verb: z.literal('count-up'),
      element: ElementIdSchema.describe('A metric element drawn as a counter.'),
      side: z
        .enum(['base', 'head'])
        .describe('The value it counts up to: base (before the change) or head (after).'),
      at: PhraseSchema.optional(),
    })
    .describe(
      'A counter counts up from zero to one side of its metric. With `at`, it lands as the phrase is spoken.',
    ),
```

- [ ] **Step 4: Shared pieces (`sources.ts`, `metric.ts`)**

`packages/video/src/direction/sources.ts` — before `export interface MetricSource`:

```ts
/** How a check says an id is not in the run's evidence. */
export const UNKNOWN_EVIDENCE =
  "which the run's evidence does not have (`covi evidence --run <id>` lists it)";
```

B4's `packages/video/src/direction/metric.ts` — export `sides` and `metricName` (add `export` to both declarations; their bodies are unchanged).

- [ ] **Step 5: Create `packages/video/src/direction/flow.ts`**

```ts
import type { EvidenceIndex } from '@covi/core';
import { textBoxRect } from '../runtime/routes.ts';
import type { ChangeSide, DirectionElement, Rect, TimelineLabels } from '../timeline/types.ts';
import { elementSlots } from './layout.ts';
import { metricName, sides } from './metric.ts';
import type { Shot, ShotBeat, ShotElement } from './schema.ts';
import { type DirectionSources, type MetricSource, UNKNOWN_EVIDENCE } from './sources.ts';

/*
 * Flow verbs in the direction file: which elements a beat names, what flows, splits, merges,
 * stacks, and count-ups may ask of a shot's elements, and the counts they draw, which come only
 * from metric evidence (R-013).
 */

export type PileShotElement = Extract<ShotElement, { kind: 'pile' }>;
type FlowBeat = Extract<ShotBeat, { verb: 'flow' }>;
type SplitBeat = Extract<ShotBeat, { verb: 'split' }>;
type CountUpBeat = Extract<ShotBeat, { verb: 'count-up' }>;

/** Every element a beat names: its element, a camera's target, or a flow's nodes and packet. */
export function beatTargets(beat: ShotBeat): string[] {
  if (beat.verb === 'camera') return [beat.to];
  if (beat.verb === 'flow')
    return [beat.from, beat.to, ...(beat.packet === undefined ? [] : [beat.packet])];
  return [beat.element];
}

/** The packets a shot's flows carry: they ride the edges, so they take no slot of their own. */
export function ridingPackets(shot: Pick<Shot, 'beats'>): Set<string> {
  return new Set(
    shot.beats.flatMap((b) => (b.verb === 'flow' && b.packet !== undefined ? [b.packet] : [])),
  );
}

/**
 * Slots for a shot's elements, aligned with them: each gets its slot for the shot's layout, except
 * a packet a flow carries, which travels between nodes; its box is the drawn box of the node its
 * first flow leaves.
 */
export function flowSlots(
  shot: Pick<Shot, 'elements' | 'beats' | 'layout'>,
  region: Rect,
  orientation: 'vertical' | 'landscape' | 'square',
  gap: number,
  unit: number,
): Rect[] {
  const riders = ridingPackets(shot);
  const placed = shot.elements.filter((e) => !riders.has(e.id));
  const slots = elementSlots(
    placed.map((e) => e.kind),
    shot.layout ?? 'auto',
    region,
    orientation,
    gap,
  );
  const slotOf = new Map(placed.map((e, i) => [e.id, slots[i]!]));
  return shot.elements.map((e) => {
    const own = slotOf.get(e.id);
    if (own) return own;
    const first = shot.beats.find((b): b is FlowBeat => b.verb === 'flow' && b.packet === e.id);
    const from = first && slotOf.get(first.from);
    return from ? textBoxRect(from, unit, orientation === 'vertical') : region;
  });
}

/**
 * Why `metric`'s `side` cannot give a whole count of at least `min`, or nothing when it can: a
 * pile draws items (none is a count too), a split breaks into pieces (at least one).
 */
function countOn(
  id: string,
  metric: MetricSource,
  side: ChangeSide,
  min: number,
  what: string,
): string | undefined {
  const value = metric[side];
  if (value === undefined) return `side "${side}": "${id}" has only a ${sides(metric)}`;
  if (!Number.isInteger(value) || value < min) return `"${id}" is ${value} at ${side}; ${what}`;
  return undefined;
}

/** The sides a pile shows: the one it asks for, else each one its metric has. */
function pileSides(element: PileShotElement, metric: MetricSource): ChangeSide[] {
  if (element.side) return [element.side];
  return (['base', 'head'] as const).filter((side) => metric[side] !== undefined);
}

/** What a pile asks of its metric that the metric does not have, as problems. */
export function pileProblems(element: PileShotElement, metric: MetricSource): string[] {
  return pileSides(element, metric).flatMap((side) => {
    const problem = countOn(
      element.evidence,
      metric,
      side,
      0,
      'a pile draws a whole number of items, zero or more',
    );
    return problem ? [problem] : [];
  });
}

/**
 * What beat `index` of a shot asks of the elements it names that they cannot do, as problems:
 * a flow runs between two nodes and carries a packet from where it last arrived; a split breaks a
 * packet or a node into a measured, whole number of pieces; a merge pulls a split back together,
 * or collapses a pile; a count-up raises a counter to a side it shows. Each acts on an element
 * once. (A stack's element kind, and that it stacks once, `refs.ts` checks through `ACTS_ON`.)
 */
export function flowBeatProblems(
  shot: Pick<Shot, 'elements' | 'beats'>,
  index: number,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const beat = shot.beats[index]!;
  const before = shot.beats.slice(0, index);
  const element = (id: string) => shot.elements.find((e) => e.id === id);
  const kind = (id: string) => element(id)?.kind;
  const again = (verb: ShotBeat['verb'], id: string) =>
    before.some((b) => b.verb === verb && 'element' in b && b.element === id);
  const once = (verb: string, id: string) =>
    `"${id}" already ${verb} at an earlier beat; it ${verb} once`;
  switch (beat.verb) {
    case 'flow': {
      const out: string[] = [];
      for (const end of [beat.from, beat.to])
        if (kind(end) !== 'node')
          out.push(`flow runs between nodes, and "${end}" is a ${kind(end)}`);
      if (beat.from === beat.to)
        out.push(`flow runs between two different nodes, and both ends are "${beat.from}"`);
      if (beat.packet !== undefined) {
        if (kind(beat.packet) !== 'packet')
          out.push(`flow carries a packet, and "${beat.packet}" is a ${kind(beat.packet)}`);
        const last = before.findLastIndex((b) => b.verb === 'flow' && b.packet === beat.packet);
        const arrived = last === -1 ? undefined : (before[last] as FlowBeat).to;
        if (arrived !== undefined && arrived !== beat.from)
          out.push(
            `"${beat.packet}" is at "${arrived}" after beat ${last + 1}; its next flow leaves from there`,
          );
      }
      return out;
    }
    case 'split': {
      const out: string[] = [];
      const k = kind(beat.element);
      if (k !== 'packet' && k !== 'node')
        out.push(`split breaks a packet or a node, and "${beat.element}" is a ${k}`);
      else if (again('split', beat.element)) out.push(once('splits', beat.element));
      out.push(...splitCountProblems(beat, evidence, sources));
      return out;
    }
    case 'merge': {
      const k = kind(beat.element);
      if (k !== 'pile' && k !== 'packet' && k !== 'node')
        return [`merge collapses a split or a pile, and "${beat.element}" is a ${k}`];
      if (k !== 'pile' && !again('split', beat.element))
        return [
          `merge pulls a split back together, and nothing splits "${beat.element}" before it`,
        ];
      return again('merge', beat.element) ? [once('merges', beat.element)] : [];
    }
    case 'count-up':
      return countUpProblems(beat, shot, again('count-up', beat.element), sources);
    default:
      return [];
  }
}

/** What a split's count cannot give: it cites a metric with a whole count of at least one. */
function splitCountProblems(
  beat: SplitBeat,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const item = evidence?.find(beat.count);
  if (!item) return [`cites "${beat.count}", ${UNKNOWN_EVIDENCE}`];
  if (item.kind !== 'metric')
    return [`split counts a metric: item, and "${beat.count}" is a ${item.kind}`];
  const metric = sources.metric(beat.count);
  if (!metric) return [`the run has no values for "${beat.count}"`];
  const problem = countOn(
    beat.count,
    metric,
    beat.side,
    1,
    'a split breaks into a whole number of pieces, one or more',
  );
  return problem ? [problem] : [];
}

/**
 * What a count-up cannot do: it raises a counter (a metric element shown as one) from zero to a
 * side of its metric, once, ending on the value the counter shows: its one side, or, when it
 * shows both, the base value a count then ticks from, else the head value.
 */
function countUpProblems(
  beat: CountUpBeat,
  shot: Pick<Shot, 'elements' | 'beats'>,
  twice: boolean,
  sources: DirectionSources,
): string[] {
  const e = shot.elements.find((x) => x.id === beat.element);
  if (e?.kind !== 'metric')
    return [`count-up counts a metric up, and "${beat.element}" is a ${e?.kind}`];
  if ((e.show ?? 'counter') !== 'counter')
    return [`count-up counts up a counter, and "${e.id}" shows "${e.show}"`];
  if (twice) return [`"${e.id}" already counts up at an earlier beat; it counts up once`];
  const metric = sources.metric(e.evidence);
  // A metric the run does not have is the element's own problem, reported with it.
  if (!metric) return [];
  if (metric[beat.side] === undefined)
    return [`side "${beat.side}": "${e.evidence}" has only a ${sides(metric)}`];
  const both = !e.side && metric.base !== undefined && metric.head !== undefined;
  const shows = e.side ?? (both ? undefined : metric.head !== undefined ? 'head' : 'base');
  if (shows && beat.side !== shows)
    return [`"${e.id}" shows its ${shows} value; count up to side "${shows}"`];
  const counts = shot.beats.some((b) => b.verb === 'count' && b.element === e.id);
  if (both && counts && beat.side !== 'base')
    return [
      `"${e.id}" counts from its base value; count up to side "base", where the count starts`,
    ];
  if (both && !counts && beat.side !== 'head')
    return [`"${e.id}" shows its head value; count up to side "head"`];
  return [];
}

/** A pile as the video draws it: a row per side it shows, each a whole count; nothing without one. */
export function resolvePile(
  e: PileShotElement,
  metric: MetricSource | undefined,
  rect: Rect,
  labels: Pick<TimelineLabels, 'stats'>,
): Extract<DirectionElement, { kind: 'pile' }> | undefined {
  if (!metric) return undefined;
  const rows = pileSides(e, metric).flatMap((side) => {
    const count = metric[side];
    return count !== undefined && Number.isInteger(count) && count >= 0 ? [{ side, count }] : [];
  });
  if (!rows.length) return undefined;
  return { id: e.id, kind: 'pile', rect, name: e.label ?? metricName(metric, labels), rows };
}

/** A split's pieces: the metric's whole count on its side, and what the output called it. */
export function splitCount(
  beat: SplitBeat,
  metric: MetricSource | undefined,
  labels: Pick<TimelineLabels, 'stats'>,
): { count: number; name: string } | undefined {
  const count = metric?.[beat.side];
  if (!metric || count === undefined || !Number.isInteger(count) || count < 1) return undefined;
  return { count, name: metricName(metric, labels) };
}

/**
 * What a merge pulls a split back into, as the video captions it: one, when the split's metric
 * measured exactly one on its other side (four chunks before, one after); else nothing to say.
 */
export function mergeInto(
  beat: Extract<ShotBeat, { verb: 'merge' }>,
  shot: Pick<Shot, 'beats'>,
  sources: DirectionSources,
  labels: Pick<TimelineLabels, 'stats'>,
): { count: 1; name: string; side: ChangeSide } | undefined {
  const split = shot.beats.find(
    (b): b is SplitBeat => b.verb === 'split' && b.element === beat.element,
  );
  const metric = split && sources.metric(split.count);
  if (!split || !metric) return undefined;
  const side = split.side === 'base' ? 'head' : 'base';
  return metric[side] === 1 ? { count: 1, name: metricName(metric, labels), side } : undefined;
}

/** The value a count-up ends on: its side of the counter's metric. */
export function countUpValue(
  beat: CountUpBeat,
  shot: Pick<Shot, 'elements'>,
  sources: DirectionSources,
): number | undefined {
  const e = shot.elements.find((x) => x.id === beat.element);
  return e?.kind === 'metric' ? sources.metric(e.evidence)?.[beat.side] : undefined;
}
```

- [ ] **Step 6: Checks (`packages/video/src/direction/refs.ts`)**

1. Imports: add `import { beatTargets, flowBeatProblems, pileProblems } from './flow.ts';`, and `UNKNOWN_EVIDENCE as UNKNOWN` to the `./sources.ts` import; delete refs.ts's own `const UNKNOWN = "which the run's evidence …";` (the text moved to `sources.ts`, unchanged).
2. `ACTS_ON` gains `stack: 'pile',` (B3's messages then read `stack acts on a pile element, and "p" is a packet` and `"r" already stacks at an earlier beat; it stacks once`). `split`, `merge`, and `count-up` stay out of the table: a split acts on two kinds, a merge on three, and "count-ups" is not a word; `flowBeatProblems` checks them with the same wording.
3. In `directionProblems`' beats loop, replace B2's target lines (`const target = beat.verb === 'camera' ? beat.to : beat.element;` and the "the shot has no element" `if`) with:

```ts
      const targets = beatTargets(beat);
      const missing = targets.filter((id) => !ids.has(id));
      for (const id of missing)
        problems.push(`${name}: the shot has no element "${id}" (it has: ${[...ids].join(', ')})`);
      const target = targets[0]!;
```

(`target` keeps feeding B3's `ACTS_ON` block and B4's `count` block unchanged), and right after B4's `count` block:

```ts
      if (!missing.length)
        for (const problem of flowBeatProblems(shot, k, evidence, sources))
          problems.push(`${name}: ${problem}`);
```

4. In `elementProblems`' switch, after B4's `metric` case:

```ts
    case 'pile': {
      if (!cites(element.evidence, 'metric', 'a pile')) break;
      const metric = sources.metric(element.evidence);
      if (!metric) out.push(`the run has no values for "${element.evidence}"`);
      else out.push(...pileProblems(element, metric));
      break;
    }
```

- [ ] **Step 7: Resolution (`layout.ts`, `resolve.ts`, `grounding.ts`)**

`packages/video/src/direction/layout.ts` — `WEIGHT` gains `pile: 2,` (a pile shares a row with a number as a metric does) and `packet: 1,` (a pill in its own slot).

`packages/video/src/direction/resolve.ts`:

1. Imports: replace `import { elementSlots, shotRegion } from './layout.ts';` with `import { shotRegion } from './layout.ts';` and add:

```ts
import {
  beatTargets,
  countUpValue,
  flowSlots,
  mergeInto,
  resolvePile,
  splitCount,
} from './flow.ts';
```

2. `BEAT_SECONDS` becomes (B2's, B3's, and B4's entries kept):

```ts
export const BEAT_SECONDS = {
  reveal: 0.5,
  camera: 0.8,
  morph: 1.6,
  count: 1.6,
  flow: 1.2,
  split: 0.9,
  merge: 0.8,
  stack: 1.8,
  'count-up': 1.6,
} as const;
```

3. In `resolveShot`, replace the `const slots = elementSlots(…);` statement with:

```ts
  const slots = flowSlots(shot, region, ctx.orientation, 28 * ctx.regions.unit, ctx.regions.unit);
```

and B4's final lines (`const beats = timeBeats(…).filter(…); return { whole, elements, beats };`) with:

```ts
  const timed = timeBeats(shot, scene, timing, ctx.options, kept, ctx).filter(
    (b) => b.verb !== 'count' || countable.has(b.element),
  );
  return { whole, elements, beats: stretchFlows(flowOrder(timed, elements), timing) };
```

4. In `element`'s switch, after B4's `metric` case:

```ts
    case 'packet':
      return {
        id: e.id,
        kind: 'packet',
        rect,
        ...(e.label === undefined ? {} : { label: e.label }),
      };
    case 'pile':
      return resolvePile(e, ctx.sources.metric(e.evidence), rect, ctx.labels);
```

5. `timeBeats` gains a last parameter `ctx: Pick<Context, 'sources' | 'labels'>`. In its body, replace B2's target lines (`const target = …; if (!kept.has(target)) return [];`) with:

```ts
    if (!beatTargets(beat).every((id) => kept.has(id))) return [];
```

make B4's landing take a count-up too:

```ts
    const landing = beat.verb === 'count' || beat.verb === 'count-up' ? pinned : undefined;
    const start = landing !== undefined ? landing - BEAT_SECONDS[beat.verb] : (pinned ?? spaced);
```

and add these lines to the `if` chain, after B4's `count` line (before the closing `camera` return):

```ts
    if (beat.verb === 'flow')
      return [
        {
          verb: 'flow',
          from: beat.from,
          to: beat.to,
          ...(beat.packet === undefined ? {} : { packet: beat.packet }),
          t,
          seconds,
        },
      ];
    if (beat.verb === 'split') {
      const pieces = splitCount(beat, ctx.sources.metric(beat.count), ctx.labels);
      return pieces
        ? [{ verb: 'split', element: beat.element, ...pieces, side: beat.side, t, seconds }]
        : [];
    }
    if (beat.verb === 'merge') {
      const into = mergeInto(beat, shot, ctx.sources, ctx.labels);
      return [{ verb: 'merge', element: beat.element, ...(into ? { into } : {}), t, seconds }];
    }
    if (beat.verb === 'stack') return [{ verb: 'stack', element: beat.element, t, seconds }];
    if (beat.verb === 'count-up') {
      const value = countUpValue(beat, shot, ctx.sources);
      return value === undefined
        ? []
        : [{ verb: 'count-up', element: beat.element, value, t, seconds }];
    }
```

6. Before `/** The run images a direction shows (its captures), for the composition to prepare. */` add:

```ts
/**
 * The flow beats that still make sense once timed: a merge after the split it pulls back (a pile
 * merges any time), and a count-up that has landed by the time its counter's count starts (which
 * then ticks from where the count-up ended). Phrases can put beats out of the written order.
 */
function flowOrder(beats: DirectionBeat[], elements: readonly DirectionElement[]): DirectionBeat[] {
  const piles = new Set(elements.flatMap((e) => (e.kind === 'pile' ? [e.id] : [])));
  const split = new Map(
    beats.flatMap((b) => (b.verb === 'split' ? [[b.element, b.t] as const] : [])),
  );
  const count = new Map(
    beats.flatMap((b) => (b.verb === 'count' ? [[b.element, b.t] as const] : [])),
  );
  return beats.filter((b) => {
    if (b.verb === 'merge')
      return piles.has(b.element) || (split.get(b.element) ?? Number.POSITIVE_INFINITY) < b.t;
    if (b.verb === 'count-up')
      return b.t + b.seconds <= (count.get(b.element) ?? Number.POSITIVE_INFINITY) + 1e-9;
    return true;
  });
}

/** Flow verbs that may take longer than their own length. */
const STRETCHES: ReadonlySet<DirectionBeat['verb']> = new Set(['flow', 'split', 'merge', 'stack']);
/** A stretched beat ends this long before the next one starts… */
const STRETCH_GAP = 0.15;
/** …and takes at most this many times its own length. */
const STRETCH_MAX = 3;

/**
 * Flows, splits, merges, and stacks take the time until the next beat starts, up to three times
 * their own length, so a staged story keeps moving between its beats instead of freezing.
 */
function stretchFlows(beats: DirectionBeat[], timing: SceneTiming): DirectionBeat[] {
  const duration = timing.end - timing.start;
  return beats.map((b, i) => {
    if (!STRETCHES.has(b.verb)) return b;
    const next = beats[i + 1]?.t ?? duration;
    const room = Math.min(next - STRETCH_GAP, duration) - b.t;
    const own = BEAT_SECONDS[b.verb];
    const seconds =
      Math.round(Math.min(STRETCH_MAX * own, Math.max(b.seconds, room)) * 1000) / 1000;
    return seconds === b.seconds ? b : { ...b, seconds };
  });
}
```

`packages/video/src/grounding.ts` — `sceneEvidence`'s `shot` parameter becomes `shot?: Pick<Shot, 'elements'> & Partial<Pick<Shot, 'beats'>>` (B2's pipeline passes the whole shot), and its loop over the elements' citations becomes:

```ts
  // What its elements cite, and the counts its splits draw.
  const cited = [
    ...(shot?.elements ?? []).flatMap((e) =>
      e.kind === 'node' ? (e.evidence ?? []) : 'evidence' in e ? [e.evidence] : [],
    ),
    ...(shot?.beats ?? []).flatMap((b) => (b.verb === 'split' ? [b.count] : [])),
  ];
  for (const id of cited) {
    const item = index.find(id);
    if (item) ids.push(item.id);
  }
```

(A pile cites its metric as `evidence`, so B2's element rule counts it already.)

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/direction-flow.test.ts packages/video/test/direction-schema.test.ts packages/video/test/direction-refs.test.ts packages/video/test/direction-resolve.test.ts packages/video/test/direction-metric.test.ts packages/video/test/direction-morph.test.ts packages/video/test/grounding.test.ts tests/direction-security.test.ts`
Expected: PASS (the B2–B4 suites confirm nothing they pin moved). Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS. `covi schema direction` now lists the `packet` and `pile` elements and the five verbs (the CLI test pins only the top-level keys).

(Prototyped on the scratch copy with B4's Node side applied: the nine `direction-flow` tests and the security additions passed, the problem messages exactly as written above.)

- [ ] **Step 9: Commit**

```bash
npx biome check --write packages/video/src/direction packages/video/src/grounding.ts packages/video/test tests/direction-security.test.ts
npm run lint && npm run typecheck
git add packages/video/src/direction packages/video/src/grounding.ts packages/video/test tests/direction-security.test.ts
git commit -m "$(cat <<'EOF'
Let a direction stage flows, splits, merges, piles, and count-ups

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 4: The default director sends a diagram's flows

**Files:**
- Create: `packages/video/src/direction/staging.ts`
- Modify: `packages/video/src/direction/director.ts` (imports; the per-scene chain; `flowingShot`)
- Create: `packages/video/test/director-flow.test.ts`

**Interfaces:**
- Consumes: Task 3's `flow` beat and `node` checks; B2's `LabelSchema`, `DIRECTION_LIMITS`, `Shot`, `ShotBeat`, `defaultDirection`, `sceneId`, `directionProblems`; B3/B4's per-scene chain `morphShot(…) ?? measuredShot(…) ?? { …B2's shot… }`.
- Produces:
  ```ts
  // packages/video/src/direction/staging.ts
  export function diagramShot(scene: Pick<Scene, 'visual'>): Pick<Shot, 'layout' | 'elements' | 'beats'> | undefined;
  ```
  A storyboard `diagram` scene becomes nodes `n1`…`n8` with the diagram's own labels (every one must pass `LabelSchema`, else the scene keeps its diagram) and one `flow` per edge between two different nodes, in the diagram's order, at most 12, carrying no packet (a dot travels); the layout is B2's `auto`. A diagram without such an edge keeps its diagram.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/director-flow.test.ts` (Task 5 appends to it):

```ts
import { indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { diagramShot } from '../src/direction/staging.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const scene = (id: string, visual: unknown, narration = 'One line.'): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual });

const diagram = (nodes: Array<[string, string]>, edges: Array<[string, string]>) => ({
  kind: 'diagram',
  nodes: nodes.map(([id, label]) => ({ id, label })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe('the default director’s diagrams', () => {
  it('turn a diagram into its nodes, with something travelling each edge in order', () => {
    const v = diagram(
      [
        ['api', 'src/api'],
        ['db', 'Store'],
        ['w', 'Reader worker'],
      ],
      [
        ['api', 'w'],
        ['w', 'db'],
        ['w', 'w'],
        ['api', 'gone'],
      ],
    );
    expect(diagramShot(scene('s1', v))).toEqual({
      elements: [
        { id: 'n1', kind: 'node', label: 'src/api' },
        { id: 'n2', kind: 'node', label: 'Store' },
        { id: 'n3', kind: 'node', label: 'Reader worker' },
      ],
      beats: [
        { verb: 'flow', from: 'n1', to: 'n3' },
        { verb: 'flow', from: 'n3', to: 'n2' },
      ],
    });
  });

  it('keep a diagram whose names are not labels, or whose edges join nothing', () => {
    const named = (label: string) =>
      diagramShot(
        scene(
          's1',
          diagram(
            [
              ['a', label],
              ['b', 'Store'],
            ],
            [['a', 'b']],
          ),
        ),
      );
    expect(named('v2 API')).toBeUndefined();
    expect(named('src/my_module')).toBeUndefined();
    expect(named('x'.repeat(33))).toBeUndefined();
    expect(
      diagramShot(
        scene(
          's1',
          diagram(
            [
              ['a', 'A'],
              ['b', 'B'],
            ],
            [],
          ),
        ),
      ),
    ).toBeUndefined();
    expect(diagramShot(scene('s1', { kind: 'callout', title: 'C' }))).toBeUndefined();
  });

  it('send at most twelve things along a diagram’s edges', () => {
    const nodes = Array.from({ length: 8 }, (_, i): [string, string] => [
      `k${i}`,
      `Node ${'abcdefgh'[i]}`,
    ]);
    const edges = Array.from({ length: 16 }, (_, i): [string, string] => [
      `k${i % 8}`,
      `k${(i + 1) % 8}`,
    ]);
    expect(diagramShot(scene('s1', diagram(nodes, edges)))!.beats).toHaveLength(
      DIRECTION_LIMITS.beatsPerShot,
    );
  });

  it('direct a diagram scene with shots Covi’s own checks accept', () => {
    const scenes = [
      scene('s1', { kind: 'callout', title: 'C' }, 'One.'),
      scene(
        's2',
        diagram(
          [
            ['a', 'Request builder'],
            ['b', 'Reader'],
          ],
          [['a', 'b']],
        ),
        'Two.',
      ),
    ];
    const evidence = indexEvidence({ items: [] });
    const plan = defaultDirection({ scenes, evidence, seed: 1 });
    expect(plan.shots[1]!.beats).toEqual([{ verb: 'flow', from: 'n1', to: 'n2' }]);
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/director-flow.test.ts`
Expected: FAIL — `Cannot find module '../src/direction/staging.ts'`.

- [ ] **Step 3: Create `packages/video/src/direction/staging.ts`**

```ts
import type { Scene } from '../storyboard/schema.ts';
import { DIRECTION_LIMITS, LabelSchema, type Shot, type ShotBeat } from './schema.ts';

/*
 * The default director's flows: a diagram's nodes with something travelling each edge. Pure and
 * deterministic; every word comes from the storyboard.
 */

type Staged = Pick<Shot, 'layout' | 'elements' | 'beats'>;

/**
 * A diagram scene as nodes with something travelling each of its edges, in order: its nodes'
 * names are the storyboard's own. Nothing when a name is not a label (digits, symbols, too long),
 * or when no edge joins two of its nodes: the scene keeps its diagram.
 */
export function diagramShot(scene: Pick<Scene, 'visual'>): Staged | undefined {
  const v = scene.visual;
  if (v.kind !== 'diagram') return undefined;
  const labels = v.nodes.flatMap((n) => {
    const label = LabelSchema.safeParse(n.label);
    return label.success ? [label.data] : [];
  });
  if (labels.length < v.nodes.length) return undefined;
  const ids = new Map(v.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const flows = v.edges
    .flatMap((e): ShotBeat[] => {
      const from = ids.get(e.from);
      const to = ids.get(e.to);
      return from && to && from !== to ? [{ verb: 'flow', from, to }] : [];
    })
    .slice(0, DIRECTION_LIMITS.beatsPerShot);
  if (!flows.length) return undefined;
  return {
    elements: labels.map((label, i) => ({ id: `n${i + 1}`, kind: 'node', label })),
    beats: flows,
  };
}
```

- [ ] **Step 4: The director (`packages/video/src/direction/director.ts`)**

Add `import { diagramShot } from './staging.ts';`, and after B4's `measuredShot`:

```ts
/** A diagram scene's nodes, with something travelling each edge. */
function flowingShot(scene: Scene, i: number): Shot | undefined {
  const shot = diagramShot(scene);
  return shot && { scene: sceneId(scene, i), ...shot };
}
```

In `defaultDirection`'s per-scene chain, after `measuredShot(scene, i, input) ??` add `flowingShot(scene, i) ??` (no scene is both a code, a terminal, and a diagram scene; entrances are still decided afterwards by `entrances`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/director-flow.test.ts packages/video/test/director.test.ts tests/examples.test.ts`
Expected: PASS (B2's examples test "directs its drafted storyboards with shots Covi's own checks accept" now covers any drafted diagram scene too). Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS.

- [ ] **Step 6: Commit**

```bash
npx biome check --write packages/video/src/direction packages/video/test/director-flow.test.ts
npm run lint && npm run typecheck
git add packages/video/src/direction packages/video/test/director-flow.test.ts
git commit -m "$(cat <<'EOF'
Send something along each edge of a diagram scene by default

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 5: The default director stages a terminal scene's counts

**Files:**
- Modify: `packages/video/src/direction/metric.ts` (B4's: extract `commandMetrics` from `keyMetric`)
- Modify: `packages/video/src/direction/staging.ts` (header, imports; `STAGED_COUNT_MAX`, `isStagedCount`, `mostChanged`, `countShot`)
- Modify: `packages/video/src/direction/director.ts` (`measuredShot`)
- Modify: `packages/video/test/director-flow.test.ts`, `packages/video/test/director-metric.test.ts` (B4's), `tests/cli.test.ts` (B4's benchmark test)

**Interfaces:**
- Consumes: Task 3's `packet`, `pile`, `split`, `stack`, `merge` checks and resolution; B4's `metricShot`, `metricChange`, `keyMetric`, `measuredShot`, `MetricShotElement`; B2's `sceneEvidence`.
- Produces:
  ```ts
  // packages/video/src/direction/metric.ts
  export function commandMetrics(scene: Pick<Scene, 'visual'>, evidence: EvidenceIndex | undefined): EvidenceItem[];

  // packages/video/src/direction/staging.ts
  export const STAGED_COUNT_MAX = 99;
  export function isStagedCount(item: Pick<EvidenceItem, 'kind' | 'metric'>): boolean;
  export function countShot(scene: Pick<Scene, 'visual'>, evidence: EvidenceIndex | undefined,
    measured: Pick<Shot, 'layout' | 'elements' | 'beats'>): Pick<Shot, 'layout' | 'elements' | 'beats'> | undefined;
  ```
  The benchmark's terminal scene gets exactly: `{ layout: 'split', elements: [{ id: 'metric', kind: 'metric', evidence: 'metric:terminal-1:request-bytes', show: 'counter' }, { id: 'packet', kind: 'packet' }, { id: 'pile', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' }], beats: [{ verb: 'split', element: 'packet', count: 'metric:terminal-1:chunks', side: 'base' }, { verb: 'stack', element: 'pile' }, { verb: 'merge', element: 'packet' }, { verb: 'count', element: 'metric', at: 'request bytes' }] }` (verified by drafting the real example on a scratch copy: `covi video --draft` wrote that shot for scene `s1`, a morph for `s2`, and visuals for `s3` and `s4`).

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/director-flow.test.ts`, extend the imports to:

```ts
import { buildEvidence, type Demonstration, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { metricShot } from '../src/direction/metric.ts';
import { planDirection } from '../src/direction/plan.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import {
  countShot,
  diagramShot,
  isStagedCount,
  STAGED_COUNT_MAX,
} from '../src/direction/staging.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
```

and append:

```ts
const command = (before: string, after: string) => ({
  name: 'Measure the review request',
  command: 'node scripts/measure.js',
  before: { exitCode: 0, output: before },
  after: { exitCode: 0, output: after },
  changed: true,
});
const measured = (before: string, after: string) => {
  const demo = {
    commands: [command(before, after)],
    shots: [],
    requests: [],
    skipped: [],
    findings: [],
  } as unknown as Demonstration;
  const evidence = indexEvidence(buildEvidence({ demo }));
  return { evidence, sources: directionSources({ demo, evidence }) };
};
const BENCHMARK = measured(
  'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1',
  'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0',
);
const NARRATION =
  "Here's the same command before and after the change. It now prints request bytes: 9907.";
const terminal = {
  kind: 'terminal',
  command: 'node scripts/measure.js',
  output: 'request bytes: 9907',
  before: 'request bytes: 70406',
};
const said = (id: string, visual: unknown, narration = NARRATION): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual });
const staged = (evidence: (typeof BENCHMARK)['evidence']) => {
  const s = said('s1', terminal);
  return countShot(s, evidence, metricShot(s, evidence, 'landscape')!);
};

describe('the default director’s counts', () => {
  it('counts only whole, unitless counts that changed, up to 99', () => {
    const count = (metric: Record<string, unknown>) =>
      isStagedCount({ kind: 'metric', metric: { name: 'n', ...metric } });
    expect(count({ base: 4, head: 1 })).toBe(true);
    expect(count({ base: 28, head: 10 })).toBe(true);
    expect(count({ base: 0, head: STAGED_COUNT_MAX })).toBe(true);
    for (const metric of [
      { base: 1, head: 0 },
      { base: 12, head: 12 },
      { base: 0.25, head: 0.125 },
      { base: 100, head: 4 },
      { base: 4, head: 1, unit: 'ms' },
      { head: 4 },
      { base: -2, head: 3 },
    ])
      expect(count(metric), JSON.stringify(metric)).toBe(false);
    expect(isStagedCount({ kind: 'terminal' })).toBe(false);
  });

  it('stages the benchmark’s request splitting into its chunks and its reads piling up, beside the counter', () => {
    expect(staged(BENCHMARK.evidence)).toEqual({
      layout: 'split',
      elements: [
        {
          id: 'metric',
          kind: 'metric',
          evidence: 'metric:terminal-1:request-bytes',
          show: 'counter',
        },
        { id: 'packet', kind: 'packet' },
        { id: 'pile', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' },
      ],
      beats: [
        { verb: 'split', element: 'packet', count: 'metric:terminal-1:chunks', side: 'base' },
        { verb: 'stack', element: 'pile' },
        { verb: 'merge', element: 'packet' },
        { verb: 'count', element: 'metric', at: 'request bytes' },
      ],
    });
  });

  it('splits one into many after the change, without a merge, and piles up a count alone', () => {
    const fanned = measured('request bytes: 9000\nworkers: 1', 'request bytes: 1000\nworkers: 3');
    expect(staged(fanned.evidence)).toEqual({
      layout: 'split',
      elements: [
        {
          id: 'metric',
          kind: 'metric',
          evidence: 'metric:terminal-1:request-bytes',
          show: 'counter',
        },
        { id: 'packet', kind: 'packet' },
      ],
      beats: [
        { verb: 'split', element: 'packet', count: 'metric:terminal-1:workers', side: 'head' },
        { verb: 'count', element: 'metric', at: 'request bytes' },
      ],
    });
    const piled = measured('request bytes: 9000\nretries: 8', 'request bytes: 1000\nretries: 2');
    expect(staged(piled.evidence)?.elements.map((e) => e.kind)).toEqual(['metric', 'pile']);
  });

  it('keeps the counter beside the output when the command counted nothing else', () => {
    const plain = measured('request bytes: 70406\ntimeouts: 1', 'request bytes: 9907\ntimeouts: 0');
    expect(staged(plain.evidence)).toBeUndefined();
    const [shot] = defaultDirection({
      scenes: [said('s1', terminal)],
      evidence: plain.evidence,
      seed: 3,
    }).shots;
    expect(shot!.elements.map((e) => e.kind)).toEqual(['metric', 'visual']);
  });

  it('directs the benchmark with shots Covi’s own checks accept, the same every time, whatever it cites', () => {
    const scenes = [said('s1', terminal), said('s2', { kind: 'callout', title: 'Done' }, 'Done.')];
    const plan = defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 });
    expect(plan.shots[0]!.beats.map((b) => b.verb)).toEqual(['split', 'stack', 'merge', 'count']);
    expect(directionProblems(plan, scenes, BENCHMARK.evidence, BENCHMARK.sources)).toEqual([]);
    expect(defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(plan);
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['metric:terminal-1:chunks'] }));
    expect(defaultDirection({ scenes: cited, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(
      plan,
    );
    // A tall frame splits the same way: the counter above, the packet and the pile below it.
    const tall = planDirection({
      mode: 'auto',
      authored: scenes,
      scenes,
      evidence: BENCHMARK.evidence,
      sources: BENCHMARK.sources,
      seed: 3,
      orientation: 'vertical',
    });
    expect(tall.plan!.shots[0]!.layout).toBe('split');
  });
});
```

In B4's `packages/video/test/director-metric.test.ts`, in `it('directs the benchmark with shots Covi’s own checks accept, the same way every time', …)`, the benchmark's command also counted chunks and reader steps, so its terminal scene now stages them. Replace the first expectation and the last line:

```ts
    expect(plan.shots[0]).toMatchObject({
      scene: 's1',
      layout: 'split',
      elements: [{ kind: 'metric' }, { kind: 'packet' }, { kind: 'pile' }],
    });
```

```ts
    expect(tall.plan!.shots[0]!.layout).toBe('split');
```

(B4's `metricShot` tests stay as they are: `metricShot` itself is unchanged.)

In `tests/cli.test.ts`, replace B4's `it('drafts a counter for the benchmark’s request bytes, from the command it measured', …)` with:

```ts
  it('drafts a counter for the benchmark’s request bytes, and stages the counts beside it', async () => {
    const dir = await example('backend-slim-request');
    const draft = covi(['video', '--repo', dir, '--standard', '--draft', '--force', '--json']);
    expect(draft.code).toBe(0);
    const json = draft.json() as { artifacts: Record<string, string> };
    const storyboard = JSON.parse(readFileSync(json.artifacts.storyboard!, 'utf8')) as {
      scenes: Array<{ id: string; visual: { kind: string } }>;
    };
    const direction = JSON.parse(readFileSync(json.artifacts.direction!, 'utf8')) as {
      shots: Array<{ scene: string }>;
    };
    const terminal = storyboard.scenes.find((s) => s.visual.kind === 'terminal')!;
    // The problem shown, not told: the request splits into its chunks and merges into one, and
    // the reader's steps pile up, beside the request bytes counting down.
    expect(direction.shots.find((s) => s.scene === terminal.id)).toMatchObject({
      layout: 'split',
      elements: [
        { id: 'metric', kind: 'metric', evidence: 'metric:terminal-1:request-bytes', show: 'counter' },
        { id: 'packet', kind: 'packet' },
        { id: 'pile', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' },
      ],
      beats: [
        { verb: 'split', element: 'packet', count: 'metric:terminal-1:chunks', side: 'base' },
        { verb: 'stack', element: 'pile' },
        { verb: 'merge', element: 'packet' },
        { verb: 'count', element: 'metric', at: 'request bytes' },
      ],
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/director-flow.test.ts packages/video/test/director-metric.test.ts && npx vitest run tests/cli.test.ts -t "benchmark"`
Expected: FAIL — `countShot` and friends are not exported, and the drafted terminal shot is still B4's `[metric, visual]`.

- [ ] **Step 3: The command's metrics (`packages/video/src/direction/metric.ts`)**

Replace B4's `keyMetric` (and its doc comment) with the two functions below; `keyMetric` behaves exactly as before.

```ts
/**
 * The metrics a terminal scene's command measured, in the registry's order: none for a scene that
 * shows no command. Read from what the scene shows, never from what it cites.
 */
export function commandMetrics(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
): EvidenceItem[] {
  if (scene.visual.kind !== 'terminal' || !evidence) return [];
  const prefixes = sceneEvidence({ visual: scene.visual }, evidence).flatMap((id) => {
    const n = /^terminal:(\d+)$/.exec(id);
    return n ? [`metric:${metricSource.terminal(Number(n[1]))}:`] : [];
  });
  return evidence.items.filter(
    (item) => item.kind === 'metric' && prefixes.some((p) => item.id.startsWith(p)),
  );
}

/**
 * The metric a terminal scene's command measured that changed most between base and head (the
 * earliest on a tie), or nothing: a scene that shows no command, a command that printed nothing
 * measurable at both revisions, or nothing that changed.
 */
export function keyMetric(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
): EvidenceItem | undefined {
  let best: EvidenceItem | undefined;
  let most = 0;
  for (const item of commandMetrics(scene, evidence)) {
    const m = item.metric;
    if (m?.base === undefined || m.head === undefined) continue;
    const change = metricChange(m.base, m.head);
    if (change > most) {
      best = item;
      most = change;
    }
  }
  return best;
}
```

- [ ] **Step 4: Stage the counts (`packages/video/src/direction/staging.ts`)**

1. The header comment becomes:

```ts
/*
 * The default director's flows: a diagram's nodes with something travelling each edge, and a
 * terminal scene's measured counts staged beside its key number: the request that splits into
 * chunks and merges into one, the reads that pile up. Pure and deterministic; every count comes
 * from metric evidence (R-013) and every word from the storyboard or the run.
 */
```

2. The imports become:

```ts
import type { EvidenceIndex, EvidenceItem } from '@covi/core';
import type { Scene } from '../storyboard/schema.ts';
import { commandMetrics, metricChange } from './metric.ts';
import {
  DIRECTION_LIMITS,
  LabelSchema,
  type Shot,
  type ShotBeat,
  type ShotElement,
} from './schema.ts';
```

3. Before `diagramShot`'s doc comment, add:

```ts
/** The largest count the director stages as pieces or a pile; larger numbers stay a counter's. */
export const STAGED_COUNT_MAX = 99;

/**
 * A metric that counts things a viewer can see as items: whole and unitless at both revisions,
 * changed, at least two on one side, and at most 99.
 */
export function isStagedCount(item: Pick<EvidenceItem, 'kind' | 'metric'>): boolean {
  const m = item.metric;
  if (item.kind !== 'metric' || !m || m.unit || m.base === undefined || m.head === undefined)
    return false;
  const { base, head } = m;
  const most = Math.max(base, head);
  return (
    Number.isInteger(base) &&
    Number.isInteger(head) &&
    Math.min(base, head) >= 0 &&
    base !== head &&
    most >= 2 &&
    most <= STAGED_COUNT_MAX
  );
}

/** The item among `items` whose count changed most, the earliest on a tie. */
function mostChanged(items: readonly EvidenceItem[]): EvidenceItem | undefined {
  let best: EvidenceItem | undefined;
  let most = 0;
  for (const item of items) {
    const change = metricChange(item.metric!.base!, item.metric!.head!);
    if (change > most) {
      best = item;
      most = change;
    }
  }
  return best;
}

/**
 * A terminal scene's counts, staged beside the key number its metric shot shows: the count that
 * goes from one to many (or many to one) is a packet that splits into its pieces, and merges back
 * into one when the change leaves one; the count that changed most of the rest is a pile, before
 * above after. They take the place of the command's output, whose numbers they show. Nothing when
 * the command counted nothing else.
 */
export function countShot(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
  measured: Staged,
): Staged | undefined {
  const key = measured.elements.find(
    (e): e is Extract<ShotElement, { kind: 'metric' }> => e.kind === 'metric',
  );
  if (!key) return undefined;
  const counts = commandMetrics(scene, evidence).filter(
    (item) => item.id !== key.evidence && isStagedCount(item),
  );
  const split = mostChanged(
    counts.filter((item) => Math.min(item.metric!.base!, item.metric!.head!) === 1),
  );
  const pile = mostChanged(counts.filter((item) => item !== split));
  if (!split && !pile) return undefined;
  const elements: ShotElement[] = [key];
  const beats: ShotBeat[] = [];
  // Many to one: the request splits as it was, then merges into what it became.
  const merges = split !== undefined && split.metric!.base! > split.metric!.head!;
  if (split) {
    elements.push({ id: 'packet', kind: 'packet' });
    beats.push({
      verb: 'split',
      element: 'packet',
      count: split.id,
      side: merges ? 'base' : 'head',
    });
  }
  if (pile) {
    elements.push({ id: 'pile', kind: 'pile', evidence: pile.id });
    beats.push({ verb: 'stack', element: 'pile' });
  }
  if (merges) beats.push({ verb: 'merge', element: 'packet' });
  return { layout: 'split', elements, beats: [...beats, ...measured.beats] };
}
```

- [ ] **Step 5: The director (`packages/video/src/direction/director.ts`)**

The `./staging.ts` import becomes `import { countShot, diagramShot } from './staging.ts';`, and B4's `measuredShot` returns the staged shot when there is one:

```ts
/** A terminal scene whose command measured a change shows the biggest one as a number. */
function measuredShot(scene: Scene, i: number, input: DirectorInput): Shot | undefined {
  const shot = metricShot(scene, input.evidence, input.orientation ?? 'landscape');
  // Counts its command measured besides are staged next to the number: shown, not told.
  return shot && { scene: sceneId(scene, i), ...(countShot(scene, input.evidence, shot) ?? shot) };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/director-flow.test.ts packages/video/test/director-metric.test.ts packages/video/test/director.test.ts packages/video/test/direction-plan.test.ts tests/examples.test.ts && npx vitest run tests/cli.test.ts -t "benchmark|drafts the direction"`
Expected: PASS. Then `npm run typecheck && npm run lint`, and `npm test` in the background (wait for it): expected PASS.

- [ ] **Step 7: Commit**

```bash
npx biome check --write packages/video/src/direction packages/video/test tests/cli.test.ts
npm run lint && npm run typecheck
git add packages/video/src/direction packages/video/test tests/cli.test.ts
git commit -m "$(cat <<'EOF'
Stage a terminal scene's counts beside its key number by default

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 6: Render the benchmark — the problem staged, in English and Korean

**Files:**
- Modify: `tests/render/render.test.ts` (B4's `backend-slim-request` block in the `covi video (full pipeline)` loop)

**Interfaces:**
- Consumes: everything above; B4's benchmark block (its `index`, `scene`, `counter`, `frames`, and `settled` variables).
- Produces: the benchmark's full-pipeline render asserts the staged shot: elements `[metric, packet, pile]`; beats `split` (4 chunks, base), `stack`, `merge` (into 1 chunk, head), `count`; the pile's rows 28 and 10; and, as B4 already asserts, the counter is the largest text at the settled frame.

- [ ] **Step 1: Render the benchmark in English, by hand**

```bash
RENDER=$(mktemp -d)
./bin/covi.mjs examples create backend-slim-request --into "$RENDER/repo"
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --json > "$RENDER/video.json"
```

Run the `covi video` line in the background (demo at both revisions, narration, 1080p render) and wait for it to exit. Then:

```bash
node -e '
const fs = require("fs"), path = require("path");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const v = path.join(r.runDir, "video");
const t = JSON.parse(fs.readFileSync(path.join(v, "timeline.json"), "utf8"));
const qc = JSON.parse(fs.readFileSync(path.join(v, "qc.json"), "utf8"));
console.log(r.runDir, r.video.rendered, qc.status);
for (const s of t.scenes) {
  if (!s.direction) continue;
  console.log(s.id, s.start.toFixed(2), s.end.toFixed(2), s.direction.elements.map((e) => e.kind).join(","),
    "|", s.direction.beats.map((b) => `${b.verb}@${b.t.toFixed(2)}+${b.seconds}`).join(" "));
}
for (const c of qc.checks.filter((c) => c.status !== "pass")) console.log(c.id, c.status, c.message);
' "$RENDER/video.json"
```

Expected (as measured on a scratch copy): `rendered` true, `qc.status` not `fail`; `s1 … metric,packet,pile | split@… stack@… merge@… count@…` (the count landing on "request bytes" near the end of the line), `s2 … morph | camera@… morph@…`, `s3` and `s4` their visuals. The only non-pass QC line this PR may cause is `still` on `s1`'s opening (≈ 1.7 s before the first beat at 15% of the line: the first scene opens in place, and B2's push-in waits for the shot to settle); B6's motion checks own that pacing. Any other warning the render gives that names `s1` is this PR's to investigate.

- [ ] **Step 2: Look at it as a viewer**

```bash
RUN=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runDir)' "$RENDER/video.json")
read -r SPLIT STACK LANDED < <(node -e '
const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const s = t.scenes.find((s) => s.direction && s.direction.beats.some((b) => b.verb === "split"));
const at = (verb, k) => { const b = s.direction.beats.find((b) => b.verb === verb); return (s.start + b.t + k * b.seconds).toFixed(3); };
console.log(at("split", 1.05), at("stack", 0.5), at("count", 1.2));
' "$RUN/video/timeline.json")
for T in $SPLIT $STACK $LANDED; do ffmpeg -v error -y -ss "$T" -i "$RUN/video/covi-review.mp4" -frames:v 1 "$RENDER/at-$T.png"; done
```

Read the three frames, `$RUN/video/contact-sheet.jpg`, and `$RUN/video/poster.png` with the Read tool. Check: after the split, four pieces sit where the request was, captioned "Before · chunks 4"; mid-stack, the reader steps' before row is filling with its number counting up; once the count has landed, "9,907" (with "−86%") is the largest thing on screen, the request is one pill captioned "After · chunks 1", and the pile shows 12 items and "28" before, 10 items and "10" after. The contact sheet's `s1` tiles show the problem staged (pieces, a filling pile), not a callout or a block of terminal text. Nothing covers the captions or the narrator. Record what the frames show in the report.

If something is cut off, overlaps, or reads wrong, reproduce it in `tests/render/flow.test.ts` with `staged(…)` (a failing test), fix the owning code (`runtime/direction/flow.ts`, `runtime/routes.ts`, `direction/staging.ts`, or a `WEIGHT`), and commit that fix separately before Step 4.

- [ ] **Step 3: The same in Korean**

```bash
./bin/covi.mjs video --repo "$RENDER/repo" --standard --force --language ko --json > "$RENDER/video-ko.json"
```

Run it in the background and wait; repeat Steps 1–2 on `$RENDER/video-ko.json`. The captions read 변경 전 / 변경 후 (the catalog's Before/After) under the pieces and beside the pile's rows; "chunks" and "reader steps" stay the program's own words. Record the result (on the scratch copy the Korean `s1` ran 15 s, and only its opening ≈ 2.1 s held still).

- [ ] **Step 4: Pin it in the full-pipeline render test**

In `tests/render/render.test.ts`, inside B4's `if (example === 'backend-slim-request') { … }` block, after its last assertion:

```ts
        // The problem is staged, not told: the request splits into its four chunks and merges
        // into one, and the reader's steps pile up, 28 before and 10 after, beside the counter.
        const direction = scene.direction!;
        expect(direction.elements.map((e) => e.kind)).toEqual(['metric', 'packet', 'pile']);
        expect(direction.beats.map((b) => b.verb).sort()).toEqual([
          'count',
          'merge',
          'split',
          'stack',
        ]);
        expect(direction.beats.find((b) => b.verb === 'split')).toMatchObject({
          element: 'packet',
          count: 4,
          name: 'chunks',
          side: 'base',
        });
        expect(direction.beats.find((b) => b.verb === 'merge')).toMatchObject({
          into: { count: 1, name: 'chunks', side: 'head' },
        });
        expect(direction.elements.find((e) => e.kind === 'pile')).toMatchObject({
          name: 'reader steps',
          rows: [
            { side: 'base', count: 28 },
            { side: 'head', count: 10 },
          ],
        });
```

(B4's assertions in the same block stay: on the scratch render the counter drew at 231.6 units and the next largest text, the pile's numbers, at 72.)

- [ ] **Step 5: Run it**

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "renders backend-slim-request"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rm -rf "$RENDER"
npx biome check --write tests/render/render.test.ts
npm run lint && npm run typecheck
git add tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Check that the benchmark stages its problem with flow verbs

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 7: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md` (B2's "Direction and the canvas" section: **Elements**, **Beats**, **Numbers**, **Checks**, **The default director**)
- Modify: `docs/visual-system.md` ("How they move")
- Modify: `docs/security.md` (B2's "The direction file" subsection, B4's **Numbers only from evidence** bullet)
- Modify: `skills/covi-video/SKILL.md` (`## Run it`, B2's **Direction.** paragraph)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: the behavior of Tasks 1–6, as documented below.
- Produces: documentation only. `skills/` is linked into `.claude/skills` and `.agents/skills`, so nothing needs regenerating (`npm run agents:check` confirms it). The full direction methodology (when each verb fits, staging changes with no UI) is B7's; the skill change is a short pointer in an agent-only section.

- [ ] **Step 1: `docs/video.md`**

In B2's "Direction and the canvas" section:

- Append to the **Elements** bullet: `` `packet` (an optional `label`: a pill that a `flow` carries from node to node, or that sits in its slot; it can `split` and `merge`); and `pile` (a `metric:` id whose value is a whole count; `side` `base` or `head` for one row, else a row for each side the metric has, before above after; an optional `label`, else what the output called it): up to twelve items a row and the true number. ``
- Append to the **Beats** bullet: `` `flow` (`from` and `to` nodes, an optional `packet`: it travels the edge between them, eased, and the first flow along an edge draws it in behind it, straight when the nodes share a row or a column, else with one elbow; without a packet a dot travels); `split` (a packet or a node, `count`: a `metric:` id, `side`: it breaks into that many pieces, twelve drawn at most, captioned with the side, what they are, and the true count; a packet breaks apart in place, a node emits them below itself); `merge` (pulls a split back together, captioned with the one it became when the run measured exactly one on the other side; or collapses a pile onto its first items); `stack` (a pile fills up item by item, before then after, its number counting up to the true count); `count-up` (a counter counts up from 0 to one side of its metric, landing on its phrase like a `count`; the side it shows, or base when a `count` follows). Flows, splits, merges, and stacks stretch toward the next beat, up to three times their length, so a staged story keeps moving. ``
- Append to the **Numbers** bullet (B4's): `` A pile's and a split's counts come from `metric:` evidence too, and must be whole: a split of at least one, a pile of zero or more. ``
- Append to the **Checks** bullet's list of refusals: `` a flow between anything but two different nodes, or a packet that does not leave from where its last flow arrived; a split of anything but a packet or a node, or of a count that is not whole; a merge with no split before it; a stack on anything but a pile; a count-up on anything but a counter, or to a side it does not show; any of them twice on one element ``.
- Append to **The default director** bullet: `` A diagram scene becomes its nodes with something travelling each edge, in order (when every node's name is a label; otherwise it keeps its diagram). A terminal scene whose key number it counts stages the command's other counts beside it, in place of the output text, in a split layout (the counter on one half): a count that goes from many to one (or one to many) is a packet that splits into its pieces (and merges back into one), and the next count that changed most is a pile, before above after. Counts are whole, unitless, between 2 and 99, and measured at both revisions. It never writes a label: a timeout, a retry, or any other warning is the agent's to stage. ``

- [ ] **Step 2: `docs/visual-system.md`**

After B2's **The canvas.** bullet of "How they move", add:

```markdown
- **Flows.** Edges, packets, splits, and piles are pure functions of the frame too (`runtime/routes.ts` for the geometry, `runtime/direction/flow.ts` for the drawing): a packet eases along its edge's route, pieces fan out on an ease-out and merge back on an ease-in-out, and a pile's items pop in one by one while its number counts up. Edges and packets take the theme's primary color; a pile's before row the line color and its after row the primary color, as bars do. A `camera follow` on a packet keeps it framed at every frame.
```

- [ ] **Step 3: `docs/security.md`**

In B2's "The direction file" subsection, append to B4's **Numbers only from evidence.** bullet: `` A pile's items and a split's pieces are counts from `metric:` evidence as well, whole, and drawn twelve at most beside the true number; no field takes a count, and a merge draws "one" only when the run measured one. ``

- [ ] **Step 4: `skills/covi-video/SKILL.md`**

At the end of B2's **Direction.** paragraph in `## Run it` (after B3's and B4's sentences):

```markdown
To show what a change does where there is nothing to see, stage it: `node`s with `flow` beats between them (a `packet` travels the edge), `split` a packet into a measured count of pieces and `merge` it back, `stack` a `pile` of a measured count, `count-up` a counter. Every count is a `metric:` id; labels have no digits. Covi's own direction already stages a terminal scene's counts beside its key number.
```

- [ ] **Step 5: `CHANGELOG.md`**

Under `## [Unreleased]`, in its `### Added` list (add the heading if the section has none yet), one line:

```markdown
- Flow verbs: a direction's `node`s, `packet`s, and `pile`s, with `flow`, `split`, `merge`, `stack`, and `count-up` beats, show a backend change as a story (a packet travels between nodes, a request breaks into a measured number of pieces and merges back into one, reads pile up to a measured count, a counter counts up from zero), every count from metric evidence; Covi's default director sends something along each edge of a diagram and stages a terminal scene's counts beside its key number (the benchmark's request splits into 4 chunks and merges into 1 while its reader steps pile up, 28 before and 10 after).
```

- [ ] **Step 6: Run every check**

Run in the background and wait for each: `npm run check` (lint, typecheck, `agents:check`, `npm test`), then `npm run test:render`.
Expected: both PASS. If `npm run test:render` fails in a test this PR did not touch, check it against `main` before changing anything: a render test that fails on `main` too is not this PR's to fix, and the report says so.

- [ ] **Step 7: Commit**

```bash
git add docs skills/covi-video/SKILL.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document flow verbs and how videos stage a change with them

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

## Self-review

Checked against the spec with fresh eyes, then fixed inline.

- **Spec coverage.** §9: edges between node rects, straight or one elbow (Task 1, `edgeRoute`); packets travelling the edge path with an ease (Task 1, `legPoint`/`legProgress`, render test "carries a packet…"); splits fanning pieces out of the source's box and merges pulling them back (Task 1, `fanOut`, `pieces`); piles stacking items in a grid of up to 12, then the true number (Task 2, `pileGrid`, `stackCount`, `pile`); a `label` with `tone: warning` for a timeout (B2's label, unchanged; the default director deliberately writes none, see rulings; B7's methodology stages it). §4.2 `node` (B2), `packet`, `pile` (Tasks 1–3); §4.3 `flow`, `split`, `merge`, `stack`, `count-up` with their fields (Tasks 1–3); "Counts and numbers are never literal in the file … Drawn items cap at 12; the counter shows the true value" (Task 3 schema and security tests; `DRAWN_ITEMS`); §4.6 validation, all problems at once, kinds compatible, `from`/`to` are nodes, evidence kinds and sides (Task 3); §4.7 resolution, timing on phrases, everything redacted (Task 3, the redaction test); §4.8 default director: diagram scenes → nodes with flows (Task 4), split/merge/stack when a cited count changes (Task 5, read from what the scene shows, as B2 and B4 do); §8 flow-verb shots lead as `flow` (Task 1); §5 per-frame `camera follow` of a moving packet (Task 1, through B3's `follow`/`track`); §14 strict schema, bounds, label allowlist, textContent (Tasks 1–3); §15 render tests for flows, determinism (Tasks 1–2); §17 "the problem is shown, not told" (Task 6, en and ko); B7's later assertion that the benchmark's default direction uses a flow verb (Task 5's CLI test pins `split`, `stack`, `merge` on the real drafted storyboard).
- **Placeholders.** None: every code step carries its code, verbatim from a scratch copy where it ran. Steps that edit B2–B4 code name the exact lines and say to use the merged names after the pre-flight scan.
- **Type consistency.** `FLOW_VERBS`, `ChangeSide`, the `packet` element, the `flow`/`split`/`merge` beats (Task 1) and `PileRow`, the `pile` element, the `stack`/`count-up` beats (Task 2) are what Tasks 3–6 resolve, check, and assert; `routes.ts`'s `DRAWN_ITEMS`, `textBoxRect`, `edgeRoute`, `pointAlong`, `stackCount`, `stackRows` (Task 1) are used by the runtime, by `schema.ts` and `direction/flow.ts` (Task 3), and by the render tests; `FlowSpans`, `SplitSpan`, `MergeSpan`, `Span` (Tasks 1–2) match what `flowSpans` builds from the resolved beats; `CountUpSpan`, `counterValue` (Task 2) are what `elements.ts` and `metric.ts` pass; `beatTargets`, `ridingPackets`, `flowSlots`, `pileProblems`, `flowBeatProblems`, `resolvePile`, `splitCount`, `mergeInto`, `countUpValue` (Task 3) are the names `refs.ts` and `resolve.ts` import; `diagramShot` (Task 4) and `countShot`, `isStagedCount`, `STAGED_COUNT_MAX`, `commandMetrics` (Task 5) are the names the director and the tests import.
- **Verification of the plan itself.** A scratch copy was assembled from the B2 mirror, B1's pieces, and B3's prototype (the B3 planner's scratch), with B4's Tasks 1–5 applied from its plan text and its core prototype. Every B5 change in this plan was applied there and: `npm run typecheck` and `biome check` passed; `routes.test.ts` (10), `flow-timeline.test.ts` (3), `direction-flow.test.ts` (9), `director-flow.test.ts` (9), the security additions, the count-up test, and `tests/render/flow.test.ts` (15, in Chromium) passed; with Task 3's update to B2's "rejects kinds and verbs this PR does not draw" list, the whole suite passed (1,580 tests, Biome clean, both typecheck projects clean). `covi video --draft` on the real `backend-slim-request` example drafted exactly Task 5's shot for `s1` (with B3's morph on `s2`), and `covi render` gave 1080p renders in English and Korean whose frames showed the split ("Before · chunks 4"), the filling pile, the merged request ("After · chunks 1"), and "9,907 −86%" as the largest text; QC was `warn` only for `still` on `s1`'s opening. B4's own tests were not in that copy, so Task 5's edits to them (and Task 6's render assertion, whose counter and pile values were read from the scratch render's timeline and frames) were reasoned against B4's plan.
- **Review Focus.** Each of the five lines has its test in the owning task (Tasks 3; 3; 1; 2 and 5; 1, 2, and 3).

## Rulings

- Ruling: a `pile` cites its metric as `evidence` (like `metric`, `code`, and `output` elements), while `split` names its metric in `count` (the spec's field) — the element check (`cites`) and scene evidence work unchanged for piles, and the verb keeps the spec's field — two field names for "the metric a count comes from".
- Ruling: a pile without `side` shows a row for each side its metric has, before above after, captioned with the timeline's Before/After words; with `side`, one row — the honest default shows both and judges neither (fewer reads might be good or bad) — an agent who wants only the problem side writes `side: "base"`.
- Ruling: `split` and `count-up` require `side`; no default — every drawn number names the side it was measured on — the file is a few characters longer.
- Ruling: counts drawn as items must be whole: a split's at least one, a pile's zero or more, checked on the side(s) shown; a ratio or a one-sided metric is refused with the value and side named — pieces and items are things — fractional metrics can be shown only as counters.
- Ruling: at most twelve items are drawn (`DRAWN_ITEMS` in `runtime/routes.ts`, which `DIRECTION_LIMITS.drawnItems` now reads, so the runtime and the schema share one source), in lines of six, with the true count beside them — the spec's cap; the runtime cannot import the Zod schema module — none.
- Ruling: `merge` collapses a split made earlier in the shot (a packet's or a node's) or a pile, and carries no count; when the split's metric measured exactly one on its other side, the resolver captions the merged packet with that one (`into`: "After · chunks 1") — "collapses into one" may only be captioned when the run measured one — a merge of any other split ends without a caption.
- Ruling: a packet that a flow carries rides the edges and takes no slot; its resolved rect is the drawn box of the node its first flow leaves, and a packet's next flow must leave from where its last one arrived (checked) — no teleporting packets and no empty slot in a row of nodes — an agent must order a packet's flows.
- Ruling: edges exist only through flows: the first flow along a `from → to` pair draws that edge in behind its packet (or behind a dot when it carries none), with an arrowhead once drawn, and it stays — the spec's "edge drawn if absent"; there is no edge element to draw a static graph with — a node flow shows its graph only as it is travelled.
- Ruling: a packet breaks apart in place (it hides while split and returns whole after a merge); a node stays and emits packet-sized pieces below itself; pieces fan out on an ease-out and merge on an ease-in-out, fitted to the element's slot width — a request "breaks into chunks", a worker "sends jobs" — none.
- Ruling: a packet without flows rests in its slot at 40% of the slot's height, leaving room under it for a split's caption — the caption never collides with the slot below — the pill sits slightly above center.
- Ruling: a shot with any of the five verbs leads as `flow` (spec §8), `count-up` included; `packet` and `pile` elements look like `flow`; `flow` is not one of the `empty-frame` card kinds — flow shots are judged by their motion (B6), and a row of nodes is sparse by design — a sparse node flow is never flagged empty.
- Ruling: beat lengths: flow 1.2 s, split 0.9 s, merge 0.8 s, stack 1.8 s, count-up 1.6 s; a count-up lands on its phrase like B4's count; flows, splits, merges, and stacks stretch toward the next beat (ending 0.15 s before it), up to three times their length — on the scratch benchmark render this removed the mid-scene still (`still` had flagged 1.7 s between the split and the stack) — a beat's length now depends on the narration's spacing.
- Ruling: the resolver drops a merge timed before its split and a count-up that has not landed when its counter's count starts — phrases can reorder what the agent wrote, and a dropped beat is better than a frame that jumps — an agent's mistimed beat silently disappears (B6's draft render and motion QC show it).
- Ruling: a count-up acts on a counter only, once, and ends on the value the counter shows: its one side; base when a `count` follows (which then ticks from there); head when none does — the counter's story stays one continuous number — an agent cannot count up to a value the counter then jumps away from.
- Ruling: B3's own-beat `span` lookup now takes only `morph` and `count` beats; the flow verbs reach an element through `FlowSpans` (and a count-up through its own span) — one element can have several flow beats (split and merge, stack and merge, count-up and count), which one span cannot carry, and a `flow` beat has no `element` — two mechanisms side by side in `draw`.
- Ruling: the default director turns a diagram scene into nodes `n1`… with the storyboard diagram's own labels when every one passes `LabelSchema` (else it keeps the diagram), and one packet-less flow per edge in the diagram's order (at most 12) — it never invents or rewrites a name — the diagram's node details and edge labels are not shown in the flow version.
- Ruling: the default director stages a terminal scene's counts only when B4 gives it a key metric: among the command's other metrics that are whole, unitless, at both revisions, changed, and between 2 and 99 at their larger side, the one-to-many or many-to-one count that changed most becomes a packet that splits (on base and merges when head is 1; on head when base is 1), and the next most-changed count a pile with both rows; beats `split`, `stack`, `merge` come before B4's `count` — the owner's story (a request breaks into chunks, reads pile up, after the change it collapses into one) from evidence alone — commands that print only one count, or only sizes, keep B4's shot.
- Ruling: the staged shot replaces the terminal's output text: `[metric, packet, pile]` in B2's `split` layout in every orientation (the counter on one half; the packet and the pile share the other) — "the problem is shown, not told", and a fourth slot (a quarter of the media region) would leave the output text under its 24-unit floor — the command line itself is no longer on screen in that scene (its numbers are), and B4's two benchmark tests change (Task 5).
- Ruling: `STAGED_COUNT_MAX = 99` — a unitless number gives no other hint that it is a count rather than a size (request bytes are unitless too) — a count of 100 or more stays a counter's, and a small unitless size that changed (`response bytes: 512 → 300`) could be staged as a pile.
- Ruling: the default director writes no `label` (no "timed out") — a warning tone is a judgment, and its words would be Covi's invention or a metric's name — the benchmark's timeout (1 → 0) is not staged by default; B7's methodology teaches agents to stage it with a warning label.
- Ruling: B5 adds no QC check and no sound cue — B6 owns motion QC and A2 owns cues (`merge` → thump, `count-up` → tick, read from the resolved beats) — a first scene whose directed beats start at 15% of its line still holds until its first beat, and 0.2.0's `still` check can warn there (≈ 1.7 s on the benchmark) until B6.
- Ruling: shared pieces move rather than duplicate: refs.ts's "not in the run's evidence" text becomes `UNKNOWN_EVIDENCE` in `sources.ts`; B4's `sides` and `metricName` are exported; `commandMetrics` is extracted from B4's `keyMetric` (unchanged behavior) — Task 3's and Task 5's checks speak exactly as B2 and B4 do — none.
- Ruling: `runtime/routes.ts` keeps its own `clamp` and ease-in-out instead of importing `runtime/anim.ts` — `anim.ts` carries DOM types, and Node and `tests/` import `routes.ts` — two copies of a one-line ease.
- Ruling: the CHANGELOG line goes under `### Added` in `## [Unreleased]` (R-017) — the owner asked for Keep a Changelog — none.
