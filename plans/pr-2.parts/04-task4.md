### Task 4: Phase-aware choreography for components and sound cues

Every timing window that a component draws with, and that `buildCues` places a sound at, moves to its phase when the scene has one and keeps today's fraction when it does not. The windows live in `timeline/cues.ts` (shared by the runtime and the sound stage), so a synced click is drawn and heard on the same word. `settledAt` (used by the camera in Task 6) says when a visual's choreography is done.

**Files:**
- Modify: `packages/video/src/timeline/cues.ts` (rewrite; old exports kept)
- Modify: `packages/video/src/runtime/components/types.ts` (`ComponentContext.phases`)
- Modify: `packages/video/src/runtime/components/frame.ts` (`choreograph` takes a timing)
- Modify: `packages/video/src/runtime/components/media.ts` (screenshot, before-after, wipe, interaction, code, terminal, api, findings)
- Modify: `packages/video/src/runtime/stage.ts` (pass `phases` into the context)
- Test: `packages/video/test/cues.test.ts` (extend)

**Interfaces:**
- Consumes: `TimelineScene.phases` (Task 3).
- Produces (in `timeline/cues.ts`; PR 3 builds on these):
  - `type Phases = Readonly<Record<string, number>>`
  - `interface ScreenshotTiming { zoom: Span; spot: Span; move: Span; press: Span }`; `screenshotTiming(duration: number, phases?: Phases): ScreenshotTiming`; `screenshotPointer(duration, phases?)` (kept)
  - `interface StepTiming { start: number; end: number; zoom: Span; spot: Span; move: Span; press: Span }`; `interactionTiming(duration: number, steps: number, phases?: Phases): StepTiming[]`; `activeStep(steps: readonly StepTiming[], t: number): number`; `interactionSlot`, `interactionPointer` (kept)
  - `HIGHLIGHT_SWEEP = 0.4`; `highlightStarts(duration: number, highlight: readonly number[], phases?: Phases): Map<number, number>` (line index → start)
  - `interface BeforeAfterTiming { reveal: Span; label: Span; focus: Span; spot: Span }`; `beforeAfterTiming(layout, duration, phases?): BeforeAfterTiming`; `beforeAfterReveal(layout, duration, phases?)` (kept)
  - `findingEntrance(index: number, phases?: Phases): Span`; `findingLanding(index: number, phases?: Phases): number`
  - `TYPE_TO_OUTPUT = 0.7`; `terminalStarts(duration: number, windows: number, phases?: Phases): number[]`
  - `apiPanels(duration: number, panels: number, phases?: Phases): Span[]`
  - `settledAt(visual: TimelineVisual, duration: number, phases?: Phases): number`
  - `ComponentContext.phases: Phases` (required; the stage passes `scene.phases ?? {}`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/video/test/cues.test.ts` (and extend its import from `../src/timeline/cues.ts` with `activeStep`, `apiPanels`, `beforeAfterTiming`, `highlightStarts`, `interactionTiming`, `screenshotTiming`, `settledAt`, `terminalStarts`):

```ts
/** Spans compared within floating-point error. */
const close = (span: readonly number[], expected: readonly number[]) => {
  expect(span.length).toBe(expected.length);
  expected.forEach((e, i) => expect(span[i]).toBeCloseTo(e, 9));
};

describe('phases move events to the words', () => {
  it('pin a screenshot zoom and click, keeping each event as long as before', () => {
    const plain = screenshotTiming(4);
    close(plain.zoom, [0.88, 1.92]);
    close(plain.spot, [1.2, 2]);
    close(plain.move, [1.68, 2.48]);
    close(plain.press, [2.48, 3.2]);
    const pinned = screenshotTiming(4, { zoom: 0.5, click: 3 });
    close(pinned.zoom, [0.5, 0.5 + 4 * 0.26]);
    close(pinned.press, [3, 3 + 4 * 0.18]);
    close(pinned.move, [3 - 4 * 0.2, 3]);
    expect(screenshotPointer(4, { click: 3 }).press[0]).toBe(3);
  });

  it('start interaction steps at their phases and share the rest of the time', () => {
    const even = interactionTiming(6, 3);
    close(
      even.map((s) => s.start),
      [0, 2, 4],
    );
    close(even[1]!.press, [2 + 2 * 0.6, 2 + 2 * 0.85]);
    const pinned = interactionTiming(8, 4, { step3: 5 });
    close(
      pinned.map((s) => s.start),
      [0, 2.5, 5, 6.5],
    );
    expect(activeStep(pinned, 4.99)).toBe(1);
    expect(activeStep(pinned, 5)).toBe(2);
    // A click phase acts on the step showing at that moment.
    const clicked = interactionTiming(6, 3, { click: 3 });
    close(clicked[1]!.press, [3, 3.5]);
    close(clicked[0]!.press, [1.2, 1.7]);
  });

  it('light highlighted lines at their phases', () => {
    const plain = highlightStarts(5, [1, 3]);
    expect(plain.get(1)).toBeCloseTo(5 * 0.32 + 0.05, 9);
    expect(plain.get(3)).toBeCloseTo(5 * 0.32 + 0.15, 9);
    const all = highlightStarts(5, [1, 3], { highlight: 2 });
    expect(all.get(1)).toBeCloseTo(2, 9);
    expect(all.get(3)).toBeCloseTo(2.1, 9);
    const each = highlightStarts(5, [1, 3], { highlight: 2, highlight2: 4 });
    expect(each.get(3)).toBe(4);
  });

  it('reveal the after state at its phase, then focus on it', () => {
    const plain = beforeAfterTiming('split', 5);
    close(plain.reveal, [0.35, 0.85]);
    close(plain.focus, [2, 3.1]);
    const pinned = beforeAfterTiming('split', 5, { reveal: 2 });
    close(pinned.reveal, [2, 2.5]);
    close(pinned.focus, [2.5, 3.6]);
    close(beforeAfterTiming('wipe', 4, { reveal: 1 }).reveal, [1, 2.8]);
    close(beforeAfterTiming('wipe', 4).label, [1.2, 2]);
    expect(beforeAfterReveal('wipe', 4)).toEqual(beforeAfterTiming('wipe', 4).reveal);
  });

  it('bring a finding card, terminal output, and an API response in at their phases', () => {
    close(findingEntrance(1, { finding2: 3 }), [3, 3.55]);
    close(findingEntrance(0, { finding2: 3 }), [0.15, 0.7]);
    close(terminalStarts(5, 1), [0.2]);
    close(terminalStarts(5, 2), [0.2, 2.1]);
    close(terminalStarts(5, 1, { output: 2 }), [1.3]);
    close(apiPanels(4, 2)[1]!, [1.25, 1.75]);
    close(apiPanels(4, 2, { after: 3 })[1]!, [3, 3.5]);
    close(apiPanels(4, 1, { after: 3 })[0]!, [3, 3.5]);
  });

  it('know when each visual has settled', () => {
    const line = { type: 'add', text: 'x' } as const;
    const click = { kind: 'screenshot', image, device: 'desktop', click: { x: 1, y: 1 } } as const;
    const focused = { ...click, focus: { x: 0, y: 0, width: 5, height: 5 } };
    expect(settledAt({ kind: 'callout', tone: 'info', title: 'C' }, 4)).toBe(0.6);
    expect(settledAt(click, 4)).toBeCloseTo(3.2, 9);
    expect(settledAt(focused, 4, { click: 1 })).toBeCloseTo(2, 9);
    expect(
      settledAt({ kind: 'code', path: 'a', lines: [line, line, line, line], highlight: [3] }, 4),
    ).toBeCloseTo(4 * 0.32 + 0.15 + 0.4, 9);
    const finding = { title: 'x', certainty: 'risk', severity: 'low' } as const;
    expect(
      settledAt({ kind: 'findings', findings: [finding, finding] }, 5, { finding2: 3 }),
    ).toBeCloseTo(3.55, 9);
    expect(settledAt({ kind: 'terminal', command: 'x', output: 'a\nb\nc' }, 5)).toBeCloseTo(
      0.2 + 0.7 + 0.15 + 2 * 0.06,
      9,
    );
  });

  it('sound each moment where its phase put it', () => {
    const finding = { title: 'x', certainty: 'likely', severity: 'low' } as const;
    const cues = buildCues([
      {
        ...scene('a', 2, 6, { kind: 'screenshot', image, device: 'desktop', click: { x: 1, y: 1 } }),
        phases: { click: 1 },
      },
      {
        ...scene('b', 6, 11, {
          kind: 'before-after',
          before: image,
          after: image,
          layout: 'split',
          labels: { before: 'Before', after: 'After' },
        }),
        phases: { reveal: 2 },
      },
      {
        ...scene('f', 11, 16, { kind: 'findings', findings: [finding, finding] }),
        phases: { finding2: 3 },
      },
    ]);
    expect(cues.map((c) => [c.kind, +c.t.toFixed(6)])).toEqual([
      ['click', 3],
      ['reveal', 8],
      ['finding', +(11 + findingLanding(0)).toFixed(6)],
      ['finding', +(11 + findingLanding(1, { finding2: 3 })).toFixed(6)],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/cues.test.ts
```

Expected: FAIL (`screenshotTiming is not a function`, and the other new exports missing). The existing cue tests still pass.

- [ ] **Step 3: Rewrite `packages/video/src/timeline/cues.ts`**

Replace the file's content up to (not including) `/** The summary's verdict badge rises into view. */` with:

```ts
import type { TimelineCue, TimelineScene, TimelineVisual } from './types.ts';

/*
 * When things happen on screen, as pure functions of a scene's length and its phases. The browser
 * runtime draws with these windows and the sound engine places effects at the same moments, so a
 * click is heard when it is seen. No DOM and no Node APIs: the runtime bundles this file.
 *
 * Every window is [start, end] in seconds since the scene started. A phase (a moment the
 * storyboard pinned to a spoken phrase, see TimelineScene.phases) moves its event to that moment
 * and keeps its length; without one, events keep their place as fractions of the scene.
 */

export type Span = readonly [number, number];

/** Moments in a scene by phase name, in seconds since the scene started. */
export type Phases = Readonly<Record<string, number>>;

export interface ScreenshotTiming {
  zoom: Span;
  spot: Span;
  move: Span;
  press: Span;
}

/** A screenshot zooms toward its focus and spotlights it; the pointer travels, then presses. */
export function screenshotTiming(duration: number, phases: Phases = {}): ScreenshotTiming {
  const zoom = phases.zoom;
  const click = phases.click;
  return {
    zoom: zoom === undefined ? [duration * 0.22, duration * 0.48] : [zoom, zoom + duration * 0.26],
    spot:
      zoom === undefined
        ? [duration * 0.3, duration * 0.5]
        : [zoom + duration * 0.08, zoom + duration * 0.28],
    move:
      click === undefined
        ? [duration * 0.42, duration * 0.62]
        : [Math.max(0, click - duration * 0.2), click],
    press:
      click === undefined ? [duration * 0.62, duration * 0.8] : [click, click + duration * 0.18],
  };
}

/** A screenshot's pointer travels to the click point, then presses. */
export function screenshotPointer(duration: number, phases?: Phases): { move: Span; press: Span } {
  const { move, press } = screenshotTiming(duration, phases);
  return { move, press };
}

/** Each interaction step gets an equal share of the scene. */
export function interactionSlot(duration: number, steps: number): number {
  return duration / Math.max(1, steps);
}

/** An interaction step's pointer, within the step's slot. */
export function interactionPointer(slot: number): { move: Span; press: Span } {
  return {
    move: [slot * 0.25, slot * 0.6],
    press: [slot * 0.6, slot * 0.85],
  };
}

export interface StepTiming {
  start: number;
  end: number;
  zoom: Span;
  spot: Span;
  move: Span;
  press: Span;
}

/**
 * When each interaction step shows and what happens in it. Step N starts at its `step<N>` phase
 * (the first step with the scene); steps without one share the time between their pinned
 * neighbors. Within its slot a step zooms, then clicks, at fixed fractions, unless a `zoom` or
 * `click` phase falls in the slot.
 */
export function interactionTiming(
  duration: number,
  steps: number,
  phases: Phases = {},
): StepTiming[] {
  const count = Math.max(1, steps);
  const bounds: Array<number | undefined> = Array.from({ length: count + 1 }, (_, i) =>
    i === 0 ? 0 : i === count ? duration : phases[`step${i + 1}`],
  );
  for (let i = 1; i < count; i++) {
    if (bounds[i] !== undefined) continue;
    let next = i + 1;
    while (bounds[next] === undefined) next++;
    const from = bounds[i - 1]!;
    bounds[i] = from + (bounds[next]! - from) / (next - i + 1);
  }
  return Array.from({ length: count }, (_, i) => {
    const start = bounds[i]!;
    const end = bounds[i + 1]!;
    const slot = end - start;
    const inSlot = (t: number | undefined) =>
      t !== undefined && t >= start && t < end ? t : undefined;
    const zoom = inSlot(phases.zoom);
    const click = inSlot(phases.click);
    return {
      start,
      end,
      zoom: zoom === undefined ? [start + slot * 0.15, start + slot * 0.45] : [zoom, zoom + slot * 0.3],
      spot:
        zoom === undefined
          ? [start + slot * 0.2, start + slot * 0.45]
          : [zoom + slot * 0.05, zoom + slot * 0.3],
      move:
        click === undefined
          ? [start + slot * 0.25, start + slot * 0.6]
          : [Math.max(start, click - slot * 0.35), click],
      press:
        click === undefined
          ? [start + slot * 0.6, start + slot * 0.85]
          : [click, click + slot * 0.25],
    };
  });
}

/** The step showing at `t`: the last one that has started. */
export function activeStep(steps: readonly StepTiming[], t: number): number {
  let i = 0;
  while (i + 1 < steps.length && t >= steps[i + 1]!.start) i++;
  return i;
}

/** How long a highlighted line takes to sweep in. */
export const HIGHLIGHT_SWEEP = 0.4;

/**
 * When each highlighted line (by index into the code's lines) starts to light up: its own
 * `highlight<N>` phase (N counts the entries of `highlight`), else the `highlight` phase with
 * later lines following 0.05 s per line, else a third of the way into the scene.
 */
export function highlightStarts(
  duration: number,
  highlight: readonly number[],
  phases: Phases = {},
): Map<number, number> {
  const first = Math.min(...highlight);
  const all = phases.highlight;
  const starts = new Map<number, number>();
  highlight.forEach((line, n) => {
    const own = phases[`highlight${n + 1}`];
    starts.set(
      line,
      own ?? (all !== undefined ? all + (line - first) * 0.05 : duration * 0.32 + line * 0.05),
    );
  });
  return starts;
}

export interface BeforeAfterTiming {
  /** The after state appears (a wipe uncovers it). */
  reveal: Span;
  /** The "after" label comes in. */
  label: Span;
  /** The camera moves toward the focus. */
  focus: Span;
  /** The focus is spotlit. */
  spot: Span;
}

/**
 * The after state appears next to the before state, at its `reveal` phase or, without one, just
 * after the before panel (a wipe uncovers it across most of the scene); then the camera finds
 * the focus.
 */
export function beforeAfterTiming(
  layout: 'split' | 'stack' | 'wipe',
  duration: number,
  phases: Phases = {},
): BeforeAfterTiming {
  const at = phases.reveal;
  if (layout === 'wipe') {
    const reveal: Span =
      at === undefined ? [duration * 0.25, duration * 0.7] : [at, at + duration * 0.45];
    return {
      reveal,
      label:
        at === undefined
          ? [duration * 0.3, duration * 0.5]
          : [at + duration * 0.05, at + duration * 0.25],
      focus: reveal,
      spot:
        at === undefined
          ? [duration * 0.7, duration * 0.85]
          : [reveal[1], reveal[1] + duration * 0.15],
    };
  }
  const reveal: Span = at === undefined ? [0.35, 0.85] : [at, at + 0.5];
  return {
    reveal,
    label: [reveal[0] + 0.05, reveal[1]],
    focus:
      at === undefined
        ? [duration * 0.4, duration * 0.62]
        : [reveal[1], reveal[1] + duration * 0.22],
    spot:
      at === undefined
        ? [duration * 0.45, duration * 0.62]
        : [reveal[1] + duration * 0.05, reveal[1] + duration * 0.22],
  };
}

/** When the after state appears next to the before state. */
export function beforeAfterReveal(
  layout: 'split' | 'stack' | 'wipe',
  duration: number,
  phases?: Phases,
): Span {
  return beforeAfterTiming(layout, duration, phases).reveal;
}

/** Finding cards slide in one after another, or each at its `finding<N>` phase. */
export function findingEntrance(index: number, phases: Phases = {}): Span {
  const at = phases[`finding${index + 1}`];
  return at === undefined ? [0.15 + index * 0.45, 0.7 + index * 0.45] : [at, at + 0.55];
}

/** Ease-out travel covered at the landing: the card reads as arrived at 90%. */
const LANDED = 1 - Math.cbrt(0.1);

/** The moment finding card `index` lands. */
export function findingLanding(index: number, phases?: Phases): number {
  const [start, end] = findingEntrance(index, phases);
  return start + (end - start) * LANDED;
}

/** A terminal types its command, then prints its output this long after it started typing. */
export const TYPE_TO_OUTPUT = 0.7;

/**
 * When each terminal window starts typing its command: the last window prints its output at the
 * `output` phase; without one, the first types at 0.2 s and a second (the after run) at 42%.
 */
export function terminalStarts(duration: number, windows: number, phases: Phases = {}): number[] {
  const output = phases.output;
  const pinned = output === undefined ? undefined : Math.max(0, output - TYPE_TO_OUTPUT);
  if (windows < 2) return [pinned ?? 0.2];
  return [0.2, pinned === undefined ? Math.max(1.4, duration * 0.42) : Math.max(0.2, pinned)];
}

/** When each API panel rises: the before panel (when there is one), then the after panel. */
export function apiPanels(duration: number, panels: number, phases: Phases = {}): Span[] {
  const step = Math.max(0.6, duration * 0.25);
  const spans: Span[] = Array.from({ length: panels }, (_, i) => [
    0.25 + i * step,
    0.75 + i * step,
  ]);
  const after = phases.after;
  if (after !== undefined && spans.length) spans[spans.length - 1] = [after, after + 0.5];
  return spans;
}

/**
 * When a visual's choreography is done, in seconds since the scene started: from then on it
 * would hold still, so the camera lingers on it while its line continues.
 */
export function settledAt(visual: TimelineVisual, duration: number, phases: Phases = {}): number {
  switch (visual.kind) {
    case 'screenshot': {
      const s = screenshotTiming(duration, phases);
      return Math.max(
        0.55,
        visual.focus ? Math.max(s.zoom[1], s.spot[1]) : 0,
        visual.click ? s.press[1] : 0,
      );
    }
    case 'before-after': {
      const s = beforeAfterTiming(visual.layout, duration, phases);
      return Math.max(0.5, s.reveal[1], s.label[1], visual.focus ? Math.max(s.focus[1], s.spot[1]) : 0);
    }
    case 'interaction': {
      const last = interactionTiming(duration, visual.steps.length, phases).at(-1)!;
      const step = visual.steps.at(-1)!;
      return Math.max(
        last.start + 0.45,
        step.focus ? Math.max(last.zoom[1], last.spot[1]) : 0,
        step.click ? last.press[1] : 0,
      );
    }
    case 'code':
      return Math.max(
        0.5 + visual.lines.length * 0.035,
        ...[...highlightStarts(duration, visual.highlight, phases).values()].map(
          (start) => start + HIGHLIGHT_SWEEP,
        ),
      );
    case 'terminal': {
      const start = terminalStarts(duration, visual.before === undefined ? 1 : 2, phases).at(-1)!;
      return start + TYPE_TO_OUTPUT + 0.15 + (visual.output.split('\n').length - 1) * 0.06;
    }
    case 'api':
      return apiPanels(duration, visual.before ? 2 : 1, phases).at(-1)![1];
    case 'findings':
      return Math.max(...visual.findings.map((_, i) => findingEntrance(i, phases)[1]));
    case 'change-map':
      return 1.1 + (Math.min(6, visual.areas.length) - 1) * 0.12;
    case 'diagram':
      return Math.max(
        0.5 + (visual.nodes.length - 1) * 0.1,
        visual.edges.length ? 1.5 + (visual.edges.length - 1) * 0.12 : 0,
      );
    case 'callout':
      return 0.6;
    case 'title':
      return 0.9 + visual.meta.length * 0.08;
    case 'summary':
      return Math.max(1.6, 1 + (visual.points.length - 1) * 0.15);
    case 'outro':
      return outroSettle();
  }
}
```

Then, in `buildCues`, use the phases:

```ts
export function buildCues(scenes: readonly TimelineScene[]): TimelineCue[] {
  const cues: TimelineCue[] = [];
  for (const scene of scenes) {
    const v = scene.visual;
    const duration = scene.end - scene.start;
    const phases = scene.phases ?? {};
    const at = (t: number) => scene.start + t;
    switch (v.kind) {
      case 'screenshot':
        if (v.click)
          cues.push({
            t: at(screenshotTiming(duration, phases).press[0]),
            kind: 'click',
            scene: scene.id,
          });
        break;
      case 'interaction':
        interactionTiming(duration, v.steps.length, phases).forEach((step, i) => {
          if (v.steps[i]!.click) cues.push({ t: at(step.press[0]), kind: 'click', scene: scene.id });
        });
        break;
      case 'before-after':
        cues.push({
          t: at(beforeAfterTiming(v.layout, duration, phases).reveal[0]),
          kind: 'reveal',
          scene: scene.id,
        });
        break;
      case 'findings':
        v.findings.forEach((f, i) => {
          cues.push({
            t: at(findingLanding(i, phases)),
            kind: 'finding',
            scene: scene.id,
            ...(f.severity === 'high' ? { detail: 'high' } : {}),
          });
        });
        break;
      // summary and outro cases unchanged
```

(Keep the `summary`, `outro`, and `default` cases and the final sort exactly as they are.) `verdictEntrance` and `outroSettle` stay where they are; `settledAt` calls `outroSettle`, which is a hoisted function declaration, so its position in the file does not matter.

- [ ] **Step 4: Pass the phases into components**

In `packages/video/src/runtime/components/types.ts`, add `import type { Phases } from '../../timeline/cues.ts';` and, in `ComponentContext`, after `root`:

```ts
  /** The scene's phases (seconds since it started) by name; empty when nothing is synced. */
  phases: Phases;
```

In `packages/video/src/runtime/stage.ts`, in `mount`, add `phases: scene.phases ?? {},` to the `ctx` object literal (after `root,`).

In `packages/video/src/runtime/components/frame.ts`, replace `import { screenshotPointer } from '../../timeline/cues.ts';` with `import type { ScreenshotTiming } from '../../timeline/cues.ts';` and replace `choreograph` with:

```ts
/** Standard choreography for a single screenshot: settle, zoom to focus, then point and click. */
export function choreograph(
  frame: Frame,
  focus: Rect | undefined,
  click: Point | undefined,
  t: number,
  timing: ScreenshotTiming,
): void {
  frame.setCamera(focus, seg(t, ...timing.zoom));
  frame.spotlight(focus, focus ? seg(t, ...timing.spot) : 0);
  frame.pointer(click, seg(t, ...timing.move), seg(t, ...timing.press));
}
```

- [ ] **Step 5: Draw with the phase-aware windows in `packages/video/src/runtime/components/media.ts`**

Replace the import from `../../timeline/cues.ts` with:

```ts
import {
  activeStep,
  apiPanels,
  beforeAfterTiming,
  findingEntrance,
  HIGHLIGHT_SWEEP,
  highlightStarts,
  interactionTiming,
  screenshotTiming,
  terminalStarts,
} from '../../timeline/cues.ts';
```

Then replace these `update` (and, for the interaction, `target`) bodies; everything else in each component stays.

Screenshot:

```ts
    update({ t, duration }) {
      rise(frame.root, seg(t, 0, 0.55), ctx.u(28));
      choreograph(frame, v.focus, v.click, t, screenshotTiming(duration, ctx.phases));
    },
```

Before/after (split and stack):

```ts
    update({ t, duration }) {
      const timing = beforeAfterTiming(v.layout, duration, ctx.phases);
      rise(frames[0]!.root, seg(t, 0, 0.5), ctx.u(24));
      rise(labels[0]!, seg(t, 0.05, 0.5), ctx.u(10));
      rise(frames[1]!.root, seg(t, ...timing.reveal), ctx.u(24));
      rise(labels[1]!, seg(t, ...timing.label), ctx.u(10));
      const k = seg(t, ...timing.focus);
      for (const f of frames) {
        f.setCamera(v.focus, k * 0.6, 1.6);
        f.spotlight(v.focus, v.focus ? seg(t, ...timing.spot) : 0);
      }
    },
```

Wipe (in `wipe`): add `const timing = beforeAfterTiming('wipe', duration, ctx.phases);` as the first line of `update`, and change three lines:

```ts
      const w = easeOutCubic(seg(t, ...timing.reveal));
      // …
      fade(labels[1]!, seg(t, ...timing.label));
      after.spotlight(v.focus, v.focus ? seg(t, ...timing.spot) : 0);
```

Interaction (replace the returned object's `update` and `target`):

```ts
    update({ t, duration }) {
      const timing = interactionTiming(duration, v.steps.length, ctx.phases);
      const active = activeStep(timing, t);
      const since = t - timing[active]!.start;
      frames.forEach((f, i) => {
        const step = timing[i]!;
        // The previous step stays underneath while the next one fades in on top.
        if (i === active)
          f.root.style.opacity = String(
            easeOutCubic(i === 0 ? seg(t, 0, 0.45) : seg(t, step.start, step.start + 0.3)).toFixed(3),
          );
        else f.root.style.opacity = i === active - 1 && since < 0.3 ? '1' : '0';
        if (i !== active) {
          f.hideOverlays();
          return;
        }
        const shown = v.steps[i]!;
        f.setCamera(shown.focus, seg(t, ...step.zoom) * 0.7, 1.5);
        f.spotlight(shown.focus, shown.focus ? seg(t, ...step.spot) * 0.8 : 0);
        f.pointer(shown.click, seg(t, ...step.move), seg(t, ...step.press));
      });
      const shown = v.steps[active]!;
      label.textContent = `${active + 1}/${v.steps.length}${shown.label ? `  ${shown.label}` : ''}`;
      fade(label, seg(since, 0, 0.3));
    },
    report: () => frameItems(frames.slice(0, 1)),
    target({ t, duration }) {
      const timing = interactionTiming(duration, v.steps.length, ctx.phases);
      // Each step's camera recomputed for this moment, so no frame depends on an earlier one.
      const of = (i: number) => {
        const shown = v.steps[i]!;
        const camera = frames[i]!.cameraFor(shown.focus, seg(t, ...timing[i]!.zoom) * 0.7, 1.5);
        return frameTarget(frames[i]!, shown.focus, shown.click, camera);
      };
      const active = activeStep(timing, t);
      const now = of(active);
      const prev = active > 0 ? of(active - 1) : undefined;
      // Glide from the previous step's target to this one's, so the tail never jumps at a cut.
      const start = timing[active]!.start;
      const k = easeOutCubic(seg(t, start, start + 0.4));
      if (!prev || !now || k >= 1) return now ?? prev;
      return {
        x: lerp(prev.x, now.x, k),
        y: lerp(prev.y, now.y, k),
        width: lerp(prev.width, now.width, k),
        height: lerp(prev.height, now.height, k),
      };
    },
```

Code:

```ts
    update({ t, duration }) {
      rise(panel, seg(t, 0, 0.5), ctx.u(30));
      const starts = highlightStarts(duration, v.highlight, ctx.phases);
      rows.forEach(({ row, hl }, i) => {
        fade(row, seg(t, 0.15 + i * 0.035, 0.45 + i * 0.035));
        if (hl) {
          const start = starts.get(i) ?? duration * 0.32 + i * 0.05;
          const k = easeOutCubic(seg(t, start, start + HIGHLIGHT_SWEEP));
          hl.style.transform = `scaleX(${k.toFixed(4)})`;
          hl.style.opacity = String(k.toFixed(3));
        }
      });
    },
```

Terminal:

```ts
    update({ t, duration }) {
      const starts = terminalStarts(duration, windows.length, ctx.phases);
      windows.forEach((w, i) => {
        const start = starts[i]!;
        // The first window is up from the start; a phase only moves when its command is typed.
        rise(w.win, i === 0 ? seg(t, 0, 0.5) : seg(t, start - 0.2, start + 0.3), ctx.u(24));
        w.play(t, start);
      });
    },
```

API:

```ts
    update({ t, duration }) {
      rise(req, seg(t, 0, 0.4), ctx.u(16));
      const spans = apiPanels(duration, panels.length, ctx.phases);
      panels.forEach((p, i) => rise(p, seg(t, ...spans[i]!), ctx.u(24)));
    },
```

Findings: in `update`, change the entrance line to `const e = easeOutCubic(seg(t, ...findingEntrance(i, ctx.phases)));`.

- [ ] **Step 6: Run the tests, the typecheck (runtime included), and the render tests that exist today**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/cues.test.ts packages/video/test
cd "$WT" && npm run typecheck
cd "$WT" && npx vitest run tests/render/render.test.ts
cd "$WT" && npx biome check --write packages/video/src/timeline/cues.ts packages/video/src/runtime packages/video/test/cues.test.ts
```

Expected: all PASS. The render tests (Chromium and ffmpeg are installed) still render and pass: without phases every window equals today's.

- [ ] **Step 7: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src/timeline/cues.ts packages/video/src/runtime packages/video/test/cues.test.ts && git commit -F - <<'EOF'
Move zooms, clicks, steps, highlights, and reveals to their phases

The timing windows that components draw with and that sound cues use
now move to a scene's synced phases and keep their old fractions
otherwise, so a click is seen and heard on its word. settledAt says when
a visual's choreography is done.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
