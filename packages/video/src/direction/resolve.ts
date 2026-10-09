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
import { codeLineText, type Direction, type Shot, type ShotElement } from './schema.ts';
import { type CodeSide, type DirectionSources, hunkView } from './sources.ts';
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
  /** Their timing, matched to them by scene id. */
  layout: Layout;
  spec: Pick<VideoSpec, 'width' | 'height'>;
  language: Language;
  /**
   * What elements may show. Hunks must come from the run's `diff.patch`, which is redacted as a
   * whole: code lines are redacted one by one here, and a secret split over lines (a key's body)
   * matches no pattern line by line.
   */
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
  redact: <T>(value: T) => T;
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
    redact: input.redact,
  };
  const timings = new Map(input.layout.scenes.map((t) => [t.id, t]));
  const staged = input.scenes.map((scene, i): SceneStaging => {
    const id = scene.id ?? `s${i + 1}`;
    const timing = timings.get(id);
    const stop = stops[i];
    // Beats timed against another scene's line would land on the wrong words: refuse instead.
    if (!timing || !stop) throw new Error(`Story scene ${i + 1} has no timing in the layout.`);
    const shot = shots.get(id) ?? visualOnly(id);
    return { stop, direction: resolveShot(shot, scene, timing, ctx) };
  });
  return input.redact(staged);
}

/**
 * What of a shot is on screen once it is resolved, for grounding (`sceneEvidence`): the elements
 * that resolved, or nothing when the scene shows its storyboard visual alone (no shot, a shot of
 * just the visual, or a shot none of whose content the run has), so the visual's evidence counts.
 */
export function shownShot(
  shot: Pick<Shot, 'elements'> | undefined,
  direction: Pick<SceneDirection, 'whole' | 'elements'>,
): Pick<Shot, 'elements'> | undefined {
  if (!shot || direction.whole) return undefined;
  const shown = new Map(direction.elements.map((e) => [e.id, e.kind]));
  return { elements: shot.elements.filter((e) => shown.get(e.id) === e.kind) };
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
  // Beats move only what the shot shows: when nothing is left, none of them has a target.
  const kept = new Set(elements.map((e) => e.id));
  // Content a validated shot cites is in the run; should all of it be gone, the visual stays.
  if (!elements.length) {
    whole = true;
    elements = [
      { id: 'visual', kind: 'visual', rect: shotRegion(true, scene.visual, ctx.regions) },
    ];
  }
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
      const side = e.side ?? 'head';
      const view = hunkView(hunk.lines, side);
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
          lines: shown.map((l) => codeLine(l, side, ctx.redact)),
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
          // Redacted whole before it is cut: a cut can split a secret, or the lines of a key,
          // into pieces no pattern matches.
          output: clipLines(ctx.redact(text), tall ? 8 : 12, ctx.language),
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

/**
 * A diff line as the code component draws it: tabs as two spaces and cut (`codeLineText`), as a
 * drafted code visual's are, and numbered as the side shows the file: base lines by the old file,
 * head lines by the new one, a diff's deleted lines old and the rest new. Redacted before the cut,
 * so a cut never splits a secret on the line.
 */
function codeLine(l: DiffLine, side: CodeSide, redact: <T>(value: T) => T): CodeLine {
  const old = side === 'base' || (side === 'diff' && l.kind === 'del');
  const number = old ? l.oldLine : l.newLine;
  return {
    type: l.kind,
    text: codeLineText(redact(l.text)),
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
 * The camera never aims at an element that is not in place yet: a beat toward a revealed element
 * starts once its (first) reveal is done.
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
  /** A beat from `start`, kept inside the scene. */
  const moment = (verb: keyof typeof BEAT_SECONDS, start: number) => {
    const t = round(Math.min(Math.max(0, start), Math.max(0, duration - 0.1)));
    return { t, seconds: round(Math.min(BEAT_SECONDS[verb], Math.max(0.1, duration - t))) };
  };
  const beats = live.flatMap((beat, i): DirectionBeat[] => {
    const target = beat.verb === 'camera' ? beat.to : beat.element;
    if (!kept.has(target)) return [];
    const pinned = beat.at === undefined ? undefined : phraseMoment(text, beat.at, timing, options);
    const spaced = from + span * (SPACED_FROM + ((1 - SPACED_FROM) * i) / live.length);
    const { t, seconds } = moment(beat.verb, pinned ?? spaced);
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
  const inPlace = new Map<string, number>();
  for (const b of [...beats].sort((a, b) => a.t - b.t))
    if (b.verb === 'reveal' && !inPlace.has(b.element)) inPlace.set(b.element, b.t + b.seconds);
  const aimed = beats.map((b) => {
    const ready = b.verb === 'camera' ? inPlace.get(b.to) : undefined;
    return ready === undefined || b.t >= ready ? b : { ...b, ...moment('camera', ready) };
  });
  // Stable: beats at the same moment keep the order the agent wrote.
  return aimed.sort((a, b) => a.t - b.t);
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
