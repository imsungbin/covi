import {
  type CodeLine,
  type FrameMark,
  HERO_PHASE,
  type HighlightGroup,
  type TimelineCue,
  type TimelineScene,
  type TimelineVisual,
  type TransitionKind,
} from './types.ts';

type CodeVisual = Extract<TimelineVisual, { kind: 'code' }>;

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
 * A phase by name. Own properties only: phases are a plain object, so a name such as
 * "constructor" would otherwise find Object.prototype's when the storyboard pinned no such phase.
 * A phase redaction removed is simply absent, so whatever it would have pinned keeps its default.
 */
export function phaseAt(phases: Phases, name: string): number | undefined {
  return Object.hasOwn(phases, name) ? phases[name] : undefined;
}

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

export interface MarkTiming {
  /** When the camera starts toward this mark. */
  start: number;
  /** The camera's move to it: zooming in to the first, panning to each next. */
  pan: Span;
}

/**
 * When each mark takes the camera, between `from` and `to` (a screenshot's scene or an
 * interaction step's slot): at its pinned moment (a pin outside the window is no pin), else the
 * k-th of n (from 0) at 22% + 58%·k/n of the time, the first at 22% and every one before 80%;
 * marks between pinned ones share the time between them. The first mark zooms in over 26% of the
 * time, as a single focus does; each later one pans over at most 0.6 s. No move runs past the next
 * mark's start, and marks never run backwards.
 */
export function markTiming(
  from: number,
  to: number,
  pinned: ReadonlyArray<number | undefined>,
): MarkTiming[] {
  const count = pinned.length;
  const length = to - from;
  const own = pinned.map((t) => (t !== undefined && t >= from && t < to ? t : undefined));
  const starts = own.some((t) => t !== undefined)
    ? own.map((t, k) => {
        if (t !== undefined) return t;
        let i = k - 1;
        while (i >= 0 && own[i] === undefined) i--;
        let j = k + 1;
        while (j < count && own[j] === undefined) j++;
        const a = i < 0 ? from : own[i]!;
        const b = j >= count ? to : own[j]!;
        return a + ((b - a) * (k - i)) / (j - i);
      })
    : own.map((_, k) => from + length * (0.22 + (0.58 * k) / count));
  for (let k = 1; k < count; k++) starts[k] = Math.max(starts[k]!, starts[k - 1]!);
  return starts.map((start, k) => {
    const next = starts[k + 1] ?? to;
    const move =
      k === 0 ? Math.min(length * 0.26, next - start) : Math.min(0.6, 0.7 * (next - start));
    return { start, pan: [start, start + move] as Span };
  });
}

/**
 * The pointer's travel to a click after marks: it leaves the last mark only once the camera has
 * reached it, and a click pinned before then makes it jump rather than run backwards.
 */
function travelFrom(last: MarkTiming, press: number, travel: number): Span {
  return [Math.min(press, Math.max(last.pan[1], press - travel)), press];
}

export interface MarksTiming {
  marks: MarkTiming[];
  /** The focus ring fades in as the camera reaches the first mark, then follows the camera. */
  spot: Span;
  /** A click: the pointer travels from the last mark, then presses. */
  move: Span;
  press: Span;
}

/**
 * A screenshot with marks: each at its own phase (the first also at `zoom`), and a click after the
 * last one, at its `click` phase or once the camera has rested on the last mark.
 */
export function screenshotMarks(
  duration: number,
  marks: readonly Pick<FrameMark, 'phase'>[],
  phases: Phases = {},
): MarksTiming {
  const timing = markTiming(
    0,
    duration,
    marks.map((m, k) => phaseAt(phases, m.phase) ?? (k === 0 ? phases.zoom : undefined)),
  );
  const first = timing[0]!;
  const last = timing.at(-1)!;
  // A last mark pinned late would carry the default click past the scene's end, where it would be
  // heard over the next scene and never seen.
  const at = Math.min(
    duration,
    phases.click ?? Math.max(duration * 0.62, last.pan[1] + duration * 0.15),
  );
  return {
    marks: timing,
    spot: [first.start + (first.pan[1] - first.start) * 0.3, first.pan[1]],
    move: travelFrom(last, at, duration * 0.15),
    press: fit(at, duration, [[0, duration * 0.18]])[0],
  };
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
  /** The step's marks, when it has them: `zoom` and `spot` then follow its first mark. */
  marks?: MarkTiming[];
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
  marks?: ReadonlyArray<readonly Pick<FrameMark, 'phase'>[] | undefined>,
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
    const own = marks?.[i];
    if (own?.length) {
      // A step with marks tours them; its click comes after the last, the pointer leaving it.
      const timing = markTiming(
        start,
        end,
        own.map((m, k) => phaseAt(phases, m.phase) ?? (k === 0 ? zoom : undefined)),
      );
      const first = timing[0]!;
      const last = timing.at(-1)!;
      const press = Math.min(
        end,
        inSlot(phases.click) ?? Math.max(start + pointer.press[0], last.pan[1] + slot * 0.1),
      );
      return {
        start,
        end,
        zoom: first.pan,
        spot: [first.start + (first.pan[1] - first.start) * 0.3, first.pan[1]],
        move: travelFrom(last, press, pointer.move[1] - pointer.move[0]),
        press: fit(press, end, [[0, pointer.press[1] - pointer.press[0]]])[0],
        marks: timing,
      };
    }
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
 * When each highlighted line (by index into the code's lines) starts to light up: its group's
 * phase (`highlight<N>` for the N-th entry of `highlight`, or the name the group gave itself),
 * lines of a group 0.05 s apart; else the `highlight` phase with later lines following 0.05 s per
 * line; else from `from` (a morph's highlights wait for its typing); else a third of the way in.
 */
export function highlightStarts(
  duration: number,
  highlight: readonly number[],
  phases: Phases = {},
  groups?: readonly HighlightGroup[],
  from?: number,
): Map<number, number> {
  const first = Math.min(...highlight);
  const all = phases.highlight;
  const starts = new Map<number, number>();
  const list =
    groups ?? highlight.map((line, n) => ({ lines: [line], phase: `highlight${n + 1}` }));
  for (const group of list) {
    const own = phaseAt(phases, group.phase);
    group.lines.forEach((line, k) => {
      starts.set(
        line,
        own !== undefined
          ? own + k * 0.05
          : all !== undefined
            ? all + (line - first) * 0.05
            : from !== undefined
              ? from + (line - first) * 0.05
              : duration * 0.32 + line * 0.05,
      );
    });
  }
  return starts;
}

/** Deleted lines are struck through, then fade to ghosts, over this long. */
export const MORPH_STRIKE = 0.35;

/** A line types at 60 characters a second, in 0.2–0.6 s; characters, not UTF-16 units. */
export function typeSeconds(text: string): number {
  return Math.min(0.6, Math.max(0.2, [...text].length / 60));
}

export interface MorphTiming {
  strike: Span;
  /** Each added line, by index into the code's lines: it opens, then types, over this window. */
  typing: Map<number, Span>;
  /** When the last of it is done. */
  end: number;
}

/**
 * A morph: at its `morph` phase (else a quarter into the scene) the deleted lines are struck, and
 * 0.25 s later the added lines type in where they were, 0.12 s apart. A late phrase compresses
 * all of it, so it ends with the scene.
 */
export function morphTiming(
  duration: number,
  lines: readonly Pick<CodeLine, 'type' | 'text'>[],
  phases: Phases = {},
): MorphTiming {
  const at = phaseAt(phases, 'morph') ?? duration * 0.25;
  const added = lines.flatMap((line, i) => (line.type === 'add' ? [i] : []));
  const offsets: Span[] = [
    [0, MORPH_STRIKE],
    ...added.map((i, k): Span => {
      const start = 0.25 + k * 0.12;
      return [start, start + typeSeconds(lines[i]!.text)];
    }),
  ];
  const spans = fit(at, duration, offsets);
  return {
    strike: spans[0]!,
    typing: new Map(added.map((i, k): [number, Span] => [i, spans[k + 1]!])),
    end: Math.max(...spans.map(([, end]) => end)),
  };
}

/**
 * When each highlighted line of a code visual lights up, a morph's after its typing, but early
 * enough to sweep in before the scene ends (a late morph ends with the scene).
 */
export function codeHighlights(
  visual: Pick<CodeVisual, 'lines' | 'highlight' | 'groups' | 'mode'>,
  duration: number,
  phases: Phases = {},
): Map<number, number> {
  const from =
    visual.mode === 'morph'
      ? Math.min(morphTiming(duration, visual.lines, phases).end + 0.1, duration - HIGHLIGHT_SWEEP)
      : undefined;
  return highlightStarts(duration, visual.highlight, phases, visual.groups, from);
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
 * Diagram edge `index` draws itself from node to node. `index` counts every entry of the visual's
 * `edges`, also one naming a node the diagram lacks (it is not drawn, but keeps its place):
 * settledAt and the runtime must both count this way, so a label is timed the same in both.
 */
export function edgeEntrance(index: number): Span {
  return [0.8 + index * 0.12, 1.5 + index * 0.12];
}

/** An edge's label fades in as its line arrives. */
export function edgeLabelEntrance(index: number): Span {
  return [1.3 + index * 0.12, 1.7 + index * 0.12];
}

/**
 * When a visual's choreography is done, in seconds since the scene started: from then on it
 * would hold still, so the camera lingers on it while its line continues.
 */
export function settledAt(visual: TimelineVisual, duration: number, phases: Phases = {}): number {
  switch (visual.kind) {
    case 'screenshot': {
      if (visual.marks?.length) {
        const s = screenshotMarks(duration, visual.marks, phases);
        return Math.max(0.55, s.marks.at(-1)!.pan[1], s.spot[1], visual.click ? s.press[1] : 0);
      }
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
      const last = interactionTiming(
        duration,
        visual.steps.length,
        phases,
        visual.steps.map((s) => s.marks),
      ).at(-1)!;
      const step = visual.steps.at(-1)!;
      return Math.max(
        last.start + 0.45,
        last.marks ? last.marks.at(-1)!.pan[1] : 0,
        step.focus ? Math.max(last.zoom[1], last.spot[1]) : 0,
        step.click ? last.press[1] : 0,
      );
    }
    case 'code':
      return Math.max(
        0.5 + visual.lines.length * 0.035,
        visual.mode === 'morph' ? morphTiming(duration, visual.lines, phases).end : 0,
        ...[...codeHighlights(visual, duration, phases).values()].map(
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
        visual.edges.length ? edgeEntrance(visual.edges.length - 1)[1] : 0,
        ...visual.edges.flatMap((e, i) => (e.label ? [edgeLabelEntrance(i)[1]] : [])),
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

/** The riser swells for this long into the hero's phase, where the hit lands. */
export const RISER_LEAD = 0.8;

/** Transitions that move the picture, and so get a whoosh. */
const WHOOSH: ReadonlySet<TransitionKind> = new Set(['push', 'wipe', 'zoom-through']);

/**
 * Every moment with a sound, in time order. A whoosh plays mid-move for a scene that pushes,
 * wipes, or zooms through (unless the riser into the hero carries that move); the hero's hit
 * lands at its phase, the riser swelling into it from 0.8 s before (left out before the video
 * starts); and a scene's own cues play where they ask (a riser ends there; one past the scene's
 * end is not played, and one repeating Covi's is merged). Fades, cuts, code, and terminals make no
 * sound. The outro's moment is where the music's logo lands, or, without music, its own sign-off.
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
            t: at(
              (v.marks?.length
                ? screenshotMarks(duration, v.marks, phases)
                : screenshotTiming(duration, phases)
              ).press[0],
            ),
            kind: 'click',
            scene: scene.id,
          });
        break;
      case 'interaction':
        interactionTiming(
          duration,
          v.steps.length,
          phases,
          v.steps.map((s) => s.marks),
        ).forEach((step, i) => {
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
    // The hero: a riser swells into its phase, where the hit lands with the accent.
    const hero = scene.hero ? phaseAt(phases, HERO_PHASE) : undefined;
    const hit = hero === undefined ? undefined : at(hero);
    const riser = hit === undefined ? undefined : hit - RISER_LEAD;
    const rises = riser !== undefined && riser >= 0;
    if (hit !== undefined) {
      cues.push({ t: hit, kind: 'hero', scene: scene.id });
      if (rises) cues.push({ t: riser, kind: 'riser', scene: scene.id });
    }
    // A scene that moves in gets a whoosh mid-move, unless the riser already carries the move.
    const move = scene.transition;
    if (move && WHOOSH.has(move.kind)) {
      const t = scene.start + move.seconds / 2;
      const carried = rises && hit !== undefined && t >= riser && t <= hit;
      if (!carried) cues.push({ t, kind: 'transition', scene: scene.id, detail: move.kind });
    }
    // The storyboard's own cues: a riser ends at its moment.
    for (const cue of scene.cues ?? []) {
      if (cue.at > duration + 1e-6) continue;
      const t = at(cue.at) - (cue.kind === 'riser' ? RISER_LEAD : 0);
      if (t < 0) continue;
      const repeats = cues.some(
        (c) => c.scene === scene.id && c.kind === cue.kind && Math.abs(c.t - t) < 1e-6,
      );
      if (!repeats) cues.push({ t, kind: cue.kind, scene: scene.id });
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}
