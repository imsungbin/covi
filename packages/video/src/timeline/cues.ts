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

/**
 * Windows that follow a pinned moment `at`, given as offsets from it. A phrase late in the line
 * would carry them past `end` (the scene, or the step, is cut there), so they are compressed
 * together until the last one ends by `end`: the event still starts on its word, and nothing
 * that follows it is dropped.
 */
function fit<const T extends readonly Span[]>(
  at: number,
  end: number,
  offsets: T,
): { [K in keyof T]: Span } {
  const length = Math.max(...offsets.map(([, to]) => to));
  const k = length > 0 ? Math.min(1, Math.max(0, end - at) / length) : 1;
  return offsets.map(([from, to]) => [at + from * k, at + to * k]) as { [K in keyof T]: Span };
}

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
  const [zoomIn, spot]: readonly [Span, Span] =
    zoom === undefined
      ? [
          [duration * 0.22, duration * 0.48],
          [duration * 0.3, duration * 0.5],
        ]
      : fit(zoom, duration, [
          [0, duration * 0.26],
          [duration * 0.08, duration * 0.28],
        ]);
  return {
    zoom: zoomIn,
    spot,
    move:
      click === undefined
        ? [duration * 0.42, duration * 0.62]
        : [Math.max(0, click - duration * 0.2), click],
    press:
      click === undefined
        ? [duration * 0.62, duration * 0.8]
        : fit(click, duration, [[0, duration * 0.18]])[0],
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
    const pointer = interactionPointer(slot);
    const inSlot = (t: number | undefined) =>
      t !== undefined && t >= start && t < end ? t : undefined;
    const zoom = inSlot(phases.zoom);
    const [zoomIn, spot]: readonly [Span, Span] =
      zoom === undefined
        ? [
            [start + slot * 0.15, start + slot * 0.45],
            [start + slot * 0.2, start + slot * 0.45],
          ]
        : fit(zoom, end, [
            [0, slot * 0.3],
            [slot * 0.05, slot * 0.3],
          ]);
    // The press lands at the click phase or at the pointer's own moment; the travel ends there.
    const press = inSlot(phases.click) ?? start + pointer.press[0];
    return {
      start,
      end,
      zoom: zoomIn,
      spot,
      move: [Math.max(start, press - (pointer.move[1] - pointer.move[0])), press],
      press: fit(press, end, [[0, pointer.press[1] - pointer.press[0]]])[0],
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
    if (at === undefined) {
      const reveal: Span = [duration * 0.25, duration * 0.7];
      return {
        reveal,
        label: [duration * 0.3, duration * 0.5],
        focus: reveal,
        spot: [duration * 0.7, duration * 0.85],
      };
    }
    const [reveal, label, spot] = fit(at, duration, [
      [0, duration * 0.45],
      [duration * 0.05, duration * 0.25],
      [duration * 0.45, duration * 0.6],
    ]);
    return { reveal, label, focus: reveal, spot };
  }
  if (at === undefined) {
    const reveal: Span = [0.35, 0.85];
    return {
      reveal,
      label: [reveal[0] + 0.05, reveal[1]],
      focus: [duration * 0.4, duration * 0.62],
      spot: [duration * 0.45, duration * 0.62],
    };
  }
  const [reveal, label, focus, spot] = fit(at, duration, [
    [0, 0.5],
    [0.05, 0.5],
    [0.5, 0.5 + duration * 0.22],
    [0.5 + duration * 0.05, 0.5 + duration * 0.22],
  ]);
  return { reveal, label, focus, spot };
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
  if (after !== undefined && spans.length)
    spans[spans.length - 1] = fit(after, duration, [[0, 0.5]])[0];
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
      return Math.max(
        0.5,
        s.reveal[1],
        s.label[1],
        visual.focus ? Math.max(s.focus[1], s.spot[1]) : 0,
      );
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

/** The summary's verdict badge rises into view. */
export function verdictEntrance(): Span {
  return [0.3, 0.7];
}

/**
 * When the outro card settles: the fox has landed, the wordmark is written, and the ▶ over its
 * i lands. The music's sonic logo lands on this moment, so it never depends on the music.
 */
export function outroSettle(): number {
  return 1;
}

/**
 * Every moment with a sound, in time order. Scene transitions, code, and terminals have none. The
 * outro's moment is where the music's logo lands, or, without music, its own sign-off sound.
 */
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
          if (v.steps[i]!.click)
            cues.push({ t: at(step.press[0]), kind: 'click', scene: scene.id });
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
      case 'summary':
        cues.push({
          t: at(verdictEntrance()[0]),
          kind: 'verdict',
          scene: scene.id,
          detail: v.verdict,
        });
        break;
      case 'outro':
        cues.push({
          t: at(outroSettle()),
          kind: 'outro',
          scene: scene.id,
          ...(v.verdict ? { detail: v.verdict } : {}),
        });
        break;
      default:
        break;
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}
