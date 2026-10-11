import { type DiffLine, type Language, t } from '@covi/core';
import { type CaptionOptions, captionOptionsFor } from '../captions.ts';
import { computeRegions, gridSpacing, type Regions } from '../runtime/layout.ts';
import {
  arrangedPacketSplit,
  arrangedSplit,
  type NodeSplit,
  nodeSplits,
  restingAt,
} from '../runtime/routes.ts';
import { orientationOf, type VideoSpec } from '../spec.ts';
import { clipLines } from '../storyboard/draft.ts';
import { parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import {
  type Layout,
  phraseMoment,
  type SceneTiming,
  scenePhases,
  timelineLabels,
} from '../timeline/build.ts';
import { MORPH_SETTLE, settledAt } from '../timeline/cues.ts';
import { ENTERED } from '../timeline/motion.ts';
import { morphReading } from '../timeline/reading.ts';
import {
  type CodeLine,
  type DirectionBeat,
  type DirectionElement,
  type DroppedBeat,
  FLOW_VERBS,
  type ImageAsset,
  type Rect,
  type SceneDirection,
  type SceneStaging,
  type TimelineLabels,
} from '../timeline/types.ts';
import {
  beatTargets,
  countUpValue,
  flowSlots,
  mergeInto,
  resolvePile,
  splitCount,
} from './flow.ts';
import { shotRegion } from './layout.ts';
import { resolveMetric } from './metric.ts';
import { codeLineText, type Direction, type Shot, type ShotElement } from './schema.ts';
import { type CodeSide, type DirectionSources, hunkView } from './sources.ts';
import { canvasStops } from './stops.ts';
import { morphHunk } from './tokens.ts';

/** How long each verb takes, in seconds. */
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
/**
 * A count (or a count-up) that lands on its phrase ticks for at least this long, even near the
 * scene's start or after a late reveal.
 */
const COUNT_MIN = 0.6;
/** A morph that has to land sooner for the code it adds to be read plays at least this long. */
const MORPH_MIN = 0.6;
/** Code elements show at most this many lines (wide, tall frames), as morphs do a side. */
export const CODE_LINES = { landscape: 14, vertical: 18 } as const;
/** Beats without a phrase start this far into the line, then spread evenly through the rest. */
const SPACED_FROM = 0.15;
/** Moments and lengths to the millisecond, so a beat's timing reads the same everywhere. */
const round = (n: number) => Math.round(n * 1000) / 1000;

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
  /** The fixed words the video draws in its language: a diff total's name. */
  labels: TimelineLabels;
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
    labels: timelineLabels(input.language),
    redact: input.redact,
  };
  const timings = new Map(input.layout.scenes.map((t, k) => [t.id, k]));
  const staged = input.scenes.map((scene, i): SceneStaging => {
    const id = scene.id ?? `s${i + 1}`;
    const k = timings.get(id);
    const timing = k === undefined ? undefined : input.layout.scenes[k];
    const stop = stops[i];
    // Beats timed against another scene's line would land on the wrong words: refuse instead.
    if (k === undefined || !timing || !stop)
      throw new Error(`Story scene ${i + 1} has no timing in the layout.`);
    // The shot is alone on screen until the next scene, or the outro, starts to come in.
    const next = input.layout.scenes[k + 1]?.start ?? input.layout.outro?.start ?? timing.end;
    // It has landed once its entrance is over (the scene before it has gone) and its elements
    // have risen into place.
    const before = input.layout.scenes[k - 1];
    const entered = Math.max(ENTERED, before ? before.end - timing.start : 0);
    const shot = shots.get(id) ?? visualOnly(id);
    return {
      stop,
      direction: resolveShot(shot, scene, timing, { settle: next - timing.start, entered }, ctx),
    };
  });
  return input.redact(staged);
}

/**
 * What of a shot is on screen once it is resolved, for grounding (`sceneEvidence`): the elements
 * that resolved and the splits that draw their counts, or nothing when the scene shows its
 * storyboard visual alone (no shot, a shot of just the visual, or a shot none of whose content the
 * run has), so the visual's evidence counts.
 */
export function shownShot(
  shot: (Pick<Shot, 'elements'> & Partial<Pick<Shot, 'beats'>>) | undefined,
  direction: Pick<SceneDirection, 'whole' | 'elements' | 'beats'>,
): Pick<Shot, 'elements' | 'beats'> | undefined {
  if (!shot || direction.whole) return undefined;
  const shown = new Map(direction.elements.map((e) => [e.id, e.kind]));
  // An element splits once, so its split in the plan is the one that resolved.
  const splits = new Set(direction.beats.flatMap((b) => (b.verb === 'split' ? [b.element] : [])));
  return {
    elements: shot.elements.filter((e) => shown.get(e.id) === e.kind),
    beats: (shot.beats ?? []).filter((b) => b.verb === 'split' && splits.has(b.element)),
  };
}

/**
 * What the render says of each beat a direction asked for that cannot play: the shot (its number
 * in the file the agent wrote, `authored`, and its scene; or Covi's own shot for the scene), the
 * beat's verb, and why, which names what it acts on. The run warns with each, and notes it.
 */
export function droppedBeatNotes(
  authored: Pick<Direction, 'shots'> | undefined,
  scenes: readonly Pick<Scene, 'id'>[],
  staging: readonly SceneStaging[],
): string[] {
  return staging.flatMap((s, i) => {
    const id = scenes[i]?.id ?? `s${i + 1}`;
    const shot = authored?.shots.findIndex((x) => x.scene === id) ?? -1;
    const which = shot === -1 ? `Covi's shot for scene ${id}` : `shot ${shot + 1} (scene ${id})`;
    return (s.direction.dropped ?? []).map(
      (d) => `Direction: ${which} leaves out a ${d.verb}: ${d.reason}.`,
    );
  });
}

/** A morph element no `morph` beat names morphs anyway, as if the shot ended with one. */
function withMorphs(shot: Shot): Shot {
  const named = new Set(shot.beats.flatMap((b) => (b.verb === 'morph' ? [b.element] : [])));
  const implicit = shot.elements.flatMap((e) =>
    e.kind === 'morph' && !named.has(e.id) ? [{ verb: 'morph' as const, element: e.id }] : [],
  );
  return implicit.length ? { ...shot, beats: [...shot.beats, ...implicit] } : shot;
}

/** A scene without a shot shows its storyboard visual, as without direction. */
const visualOnly = (scene: string): Shot => ({
  scene,
  elements: [{ id: 'visual', kind: 'visual' }],
  beats: [],
});

/** When a shot has landed and when it starts to leave, in seconds since its scene started. */
interface ShotSpan {
  entered: number;
  settle: number;
}

function resolveShot(
  given: Shot,
  scene: Scene,
  timing: SceneTiming,
  { settle, entered }: ShotSpan,
  ctx: Context,
): SceneDirection {
  const shot = withMorphs(given);
  const revealed = new Set(shot.beats.flatMap((b) => (b.verb === 'reveal' ? [b.element] : [])));
  let whole =
    shot.elements.length === 1 &&
    shot.elements[0]!.kind === 'visual' &&
    !revealed.has(shot.elements[0]!.id);
  const region = shotRegion(whole, scene.visual, ctx.regions);
  const gap = 28 * ctx.regions.unit;
  // What an element shows does not depend on where it goes, and where a packet goes depends on
  // which of its trips play: elements are placed once the beats are timed.
  const resolved = shot.elements.map((e) => element(e, region, ctx));
  // Beats move only what the shot shows: when nothing is left, none of them has a target.
  const shown = resolved.filter((e) => e !== undefined);
  // A count ticks from one value to another: on a metric showing one value it has nothing to do.
  const countable = new Set(
    shown.flatMap((e) => (e.kind === 'metric' && e.from !== undefined ? [e.id] : [])),
  );
  const limit = settle - SETTLE_LEAD;
  const timed = timeBeats(shot, scene, timing, ctx.options, shown, ctx, { settle, entered });
  const counted = timed.beats.filter((b) => b.verb !== 'count' || countable.has(b.element));
  /** The shown elements in the slots `beats` leave them (`fans`: see `flowSlots`). */
  const placed = (beats: readonly DirectionBeat[], fans?: ReadonlyMap<string, NodeSplit>) => {
    const slots = flowSlots(shot, beats, region, ctx.orientation, gap, ctx.regions.unit, fans);
    return resolved.flatMap((e, k) => (e ? [{ ...e, rect: slots[k]! }] : []));
  };
  // Which packets travel decides the layout, and the layout which splits have room. A trip that
  // leaves while its packet is split is left out, so a packet left with no trip takes a slot of
  // its own; on that layout, splits find their room, and a trip left out only for a split that
  // then has no room travels after all, for a packet that rides anyway. The second pass cannot
  // change which packets ride or what the layout reserved: a packet that rides on no trip keeps
  // its slot, and its trips stay left out as they were, even once its split is left out too.
  const first = travelsWhole(counted);
  const travelling = first.beats;
  let elements = placed(travelling);
  const roomy = fanRoom(travelling, elements, ctx);
  const room = new Set(roomy.beats);
  const rides = new Set(
    travelling.flatMap((b) => (b.verb === 'flow' && b.packet !== undefined ? [b.packet] : [])),
  );
  const grounded = (b: DirectionBeat) =>
    b.verb === 'flow' && b.packet !== undefined && !rides.has(b.packet);
  const second = travelsWhole(
    counted.filter((b) => (b.verb !== 'split' || room.has(b)) && !grounded(b)),
  );
  const travels: Pass = {
    beats: second.beats,
    dropped: [
      ...second.dropped,
      ...first.dropped.filter((d) => d.verb === 'flow' && !rides.has(d.element)),
    ],
  };
  const ordered = flowOrder(travels.beats, elements);
  const beats = stretchFlows(ordered.beats, limit);
  const dropped = [timed, roomy, travels, ordered].flatMap((pass) => pass.dropped);
  // A packet riding from a node a split fans out of starts on the box the split leaves that node.
  const fans = nodeSplits({ elements, beats }, ctx.regions.unit, ctx.orientation === 'vertical');
  if (fans.size) elements = placed(beats, fans);
  // Content a validated shot cites is in the run; should all of it be gone, the visual stays.
  if (!elements.length) {
    whole = true;
    elements = [
      { id: 'visual', kind: 'visual', rect: shotRegion(true, scene.visual, ctx.regions) },
    ];
  }
  return { whole, elements, beats, ...(dropped.length ? { dropped } : {}) };
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
    case 'morph': {
      const hunk = ctx.sources.hunk(e.evidence);
      if (!hunk) return undefined;
      // Each line is redacted whole before it is split, so no secret survives split into tokens.
      const morph = morphHunk(
        hunk.lines.map((l) => ({ ...l, text: ctx.redact(l.text) })),
        {
          max: tall ? CODE_LINES.vertical : CODE_LINES.landscape,
          ...(hunk.language ? { language: hunk.language } : {}),
          elided: (count) => t(ctx.language, 'video.elided', { count }),
        },
      );
      if (!morph) return undefined;
      return {
        id: e.id,
        kind: 'morph',
        rect,
        morph: {
          path: hunk.path,
          ...(hunk.language ? { language: hunk.language } : {}),
          ...morph,
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
    case 'metric':
      return resolveMetric(e, ctx.sources.metric(e.evidence), rect, ctx.labels);
    case 'packet':
      return {
        id: e.id,
        kind: 'packet',
        rect,
        ...(e.label === undefined ? {} : { label: e.label }),
      };
    case 'pile':
      return resolvePile(e, ctx.sources.metric(e.evidence), rect, ctx.labels);
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
 * evenly spaced slot over the line from 0.15 of it (over the scene when it has no line), and a
 * flow verb without one from when the shot has landed (`entered`), or its line has started if that
 * is later, so a staged story fills the line's opening rather than wait on it. A count
 * or a count-up with `at` ticks in the moments before its phrase instead, so the number on screen
 * lands as it is said; a count without one never lands before the terminals beside it have typed
 * their output, where its number comes from, and one spaced to land after `limit` (a count-up
 * too) starts earlier to land by it. `place` is the default made explicit, so it resolves
 * to nothing; beats on elements that are gone drop. Nothing plays on an element that is not in
 * place yet: a beat that moves the camera toward, acts on, or (a flow) travels between or carries
 * a revealed element starts once its (first) reveal is done (the latest of them, for a flow); a
 * count or a count-up that waited is shortened (to `COUNT_MIN` at the least) to land on its phrase
 * still. A morph lands early enough for the code it adds to be read before the scene moves on
 * (`legible`). Flow verbs without a phrase make way for counts (`makeWay`), then keep each
 * element's written order and end by `limit` (`sequenced`); the ones that cannot are left out,
 * and said why.
 */
function timeBeats(
  shot: Shot,
  scene: Scene,
  timing: SceneTiming,
  options: CaptionOptions,
  shown: readonly DirectionElement[],
  ctx: Pick<Context, 'sources' | 'labels'>,
  { settle, entered }: ShotSpan,
): Pass {
  const limit = settle - SETTLE_LEAD;
  const duration = timing.end - timing.start;
  const text = parseEmphasis(scene.narration).text;
  const kept = new Set(shown.map((e) => e.id));
  const live = shot.beats.filter((b) => b.verb !== 'place');
  const spoken = timing.speechEnd > timing.speechStart;
  const from = spoken ? timing.speechStart - timing.start : 0;
  const span = spoken ? timing.speechEnd - timing.speechStart : duration;
  // Where the spacing starts: 0.15 into the line, and for flow verbs as the shot lands, never
  // later than the others start.
  const first = from + span * SPACED_FROM;
  const flowFirst = Math.min(first, Math.max(from, entered));
  /** A beat from `start` lasting `seconds`, kept inside the scene. */
  const inside = (start: number, seconds: number) => {
    const t = round(Math.min(Math.max(0, start), Math.max(0, duration - 0.1)));
    return { t, seconds: round(Math.min(seconds, Math.max(0.1, duration - t))) };
  };
  const moment = (verb: keyof typeof BEAT_SECONDS, start: number) =>
    inside(start, BEAT_SECONDS[verb]);
  /**
   * A count (or a count-up) that lands at `at`: it starts its length before, never before the
   * scene does or `ready`, and ticks at least `COUNT_MIN`.
   */
  const landing = (at: number, ready = 0, verb: 'count' | 'count-up' = 'count') => {
    const start = Math.max(ready, at - BEAT_SECONDS[verb]);
    return inside(start, Math.max(COUNT_MIN, at - start));
  };
  // Where each count or count-up with a phrase lands, for when it has to wait for its reveal.
  const lands = new Map<DirectionBeat, number>();
  // The beats a phrase placed, rather than the spacing.
  const phrased = new Set<DirectionBeat>();
  const beats = live.flatMap((beat, i): DirectionBeat[] => {
    if (!beatTargets(beat).every((id) => kept.has(id))) return [];
    const pinned = beat.at === undefined ? undefined : phraseMoment(text, beat.at, timing, options);
    const placed = timed(beat, i, pinned);
    if (pinned !== undefined) for (const b of placed) phrased.add(b);
    return placed;
  });
  /** Beat `i` with its moment: at its phrase (`pinned`), else at its spaced slot. */
  function timed(
    beat: (typeof live)[number],
    i: number,
    pinned: number | undefined,
  ): DirectionBeat[] {
    const start = STRETCHES.has(beat.verb) ? flowFirst : first;
    const spaced = start + ((from + span - start) * i) / live.length;
    if (beat.verb === 'count' || beat.verb === 'count-up') {
      const timed =
        pinned === undefined ? moment(beat.verb, spaced) : landing(pinned, 0, beat.verb);
      let landed: DirectionBeat;
      if (beat.verb === 'count') landed = { verb: 'count', element: beat.element, ...timed };
      else {
        const value = countUpValue(beat, shot, ctx.sources);
        if (value === undefined) return [];
        landed = { verb: 'count-up', element: beat.element, value, ...timed };
      }
      if (pinned !== undefined) lands.set(landed, pinned);
      return [landed];
    }
    const { t, seconds } = moment(beat.verb, pinned ?? spaced);
    if (beat.verb === 'reveal')
      return [{ verb: 'reveal', element: beat.element, style: beat.style ?? 'rise', t, seconds }];
    if (beat.verb === 'morph') return [{ verb: 'morph', element: beat.element, t, seconds }];
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
    return [
      {
        verb: 'camera',
        move: beat.move,
        to: beat.to,
        ...(beat.zoom === undefined ? {} : { zoom: beat.zoom }),
        t,
        seconds,
      },
    ];
  }
  const firstReveal = new Map<string, DirectionBeat>();
  for (const b of [...beats].sort((a, b) => a.t - b.t))
    if (b.verb === 'reveal' && !firstReveal.has(b.element)) firstReveal.set(b.element, b);
  const typed = typedAt(shown, scene, timing, options, (id) => firstReveal.get(id)?.t ?? 0);
  /** When element `id` is in place: once its first reveal is done, else from the start. */
  const ready = (id: string) => {
    const reveal = firstReveal.get(id);
    return reveal ? reveal.t + reveal.seconds : 0;
  };
  /**
   * A morph that would leave the code it adds on screen too briefly to read (`morphReading`, once
   * settled) before the scene starts to leave lands earlier: it starts just early enough, at its
   * own length, never before `floor` (what it morphs is in place, and the shot has landed); where
   * that is not enough, it is shortened as well, to `MORPH_MIN` at the least. Moved no further
   * than it falls short, a morph on a phrase stays as near it as it can. One with no room even so
   * stays where it was, and reading-time warns.
   */
  const legible = (b: Extract<DirectionBeat, { verb: 'morph' }>, floor: number) => {
    const e = shown.find((x) => x.id === b.element);
    if (e?.kind !== 'morph') return b;
    // To the millisecond, the deadline rounded down and the start up, so it is never a hair late.
    const by = Math.floor((settle - morphReading(e.morph) - MORPH_SETTLE) * 1000) / 1000;
    if (b.t + b.seconds <= by + 1e-9) return b;
    const earliest = Math.ceil(Math.max(floor, by - BEAT_SECONDS.morph) * 1000 - 1e-6) / 1000;
    const t = Math.min(b.t, earliest);
    const seconds = round(Math.min(BEAT_SECONDS.morph, by - t));
    return seconds < MORPH_MIN - 1e-9 ? b : { ...b, t, seconds };
  };
  const aimed = beats.map((b): Written => {
    const was = { phrased: phrased.has(b), ready: Math.max(...beatTargets(b).map(ready)) };
    if (b.verb === 'reveal') return { beat: b, ...was };
    const at = lands.get(b);
    if (at !== undefined && (b.verb === 'count' || b.verb === 'count-up'))
      return { beat: b.t >= was.ready ? b : { ...b, ...landing(at, was.ready, b.verb) }, ...was };
    // A count without a phrase waits for its number to be typed; a count-up shows the value
    // before it, which no terminal types. Spaced to land after `limit`, either starts earlier to
    // land by it, never before it may, so the scene settles on the number landed.
    const begin = Math.max(was.ready, b.verb === 'count' ? typed - BEAT_SECONDS.count : 0);
    // By its own length: a slot near the scene's end cut it short, and it is timed again at full.
    const latest = b.verb === 'count' || b.verb === 'count-up' ? limit - BEAT_SECONDS[b.verb] : b.t;
    const t = Math.max(begin, Math.min(b.t, latest));
    const beat = t === b.t ? b : { ...b, ...moment(b.verb, t) };
    if (beat.verb === 'morph') return { beat: legible(beat, Math.max(was.ready, entered)), ...was };
    return { beat, ...was };
  });
  const out = sequenced(makeWay(aimed, flowFirst), limit);
  // Stable: beats at the same moment keep the order the agent wrote.
  return { beats: out.beats.sort((a, b) => a.t - b.t), dropped: out.dropped };
}

/** A timed beat, in the order the agent wrote it: whether a phrase placed it, and when it may start. */
interface Written {
  beat: DirectionBeat;
  phrased: boolean;
  ready: number;
}

/**
 * Flow verbs without a phrase make way for the numbers: one that would still be moving while a
 * count or a count-up ticks starts earlier, to end as that one starts, so the number moves alone
 * as it lands. Never before `first` (where the spacing starts) or what it acts on is in place, nor
 * into another count; one with no room stays where the spacing put it. `sequenced` then keeps
 * each element's order, which can only move a beat back toward where it was.
 */
function makeWay(written: readonly Written[], first: number): Written[] {
  const ticks = written
    .flatMap(({ beat: b }) => (b.verb === 'count' || b.verb === 'count-up' ? [b] : []))
    .sort((a, b) => a.t - b.t);
  const during = (t: number, end: number) =>
    ticks.find((c) => c.t < end - 1e-9 && t < c.t + c.seconds - 1e-9);
  return written.map((w) => {
    const b = w.beat;
    if (w.phrased || !STRETCHES.has(b.verb)) return w;
    const tick = during(b.t, b.t + b.seconds);
    if (!tick) return w;
    const t = round(tick.t - b.seconds);
    if (t < Math.max(first, w.ready) - 1e-9 || during(t, tick.t)) return w;
    return { ...w, beat: { ...b, t } };
  });
}

/** What a pass over the timed beats keeps, and what it leaves out, said why. */
interface Pass {
  beats: DirectionBeat[];
  dropped: DroppedBeat[];
}

/** The beats `out` finds no reason to leave out, and the ones it does, in order. */
function sift(
  beats: readonly DirectionBeat[],
  out: (b: DirectionBeat) => DroppedBeat | undefined,
): Pass {
  const dropped: DroppedBeat[] = [];
  const kept = beats.filter((b) => {
    const left = out(b);
    if (left) dropped.push(left);
    return !left;
  });
  return { beats: kept, dropped };
}

/** Why a packet's trip is left out after one before it was: it would leave where it never got. */
const afterLost = (packet: string) =>
  `the flow of "${packet}" follows a trip of "${packet}" that was left out`;

/** The element a flow verb moves: a flow's packet (a dot is no element), else what it acts on. */
const moved = (b: DirectionBeat): string | undefined =>
  b.verb === 'flow' ? b.packet : b.verb === 'camera' ? undefined : b.element;

/** A flow verb as a reason names it. */
const named = (b: DirectionBeat): string =>
  b.verb === 'flow'
    ? b.packet === undefined
      ? `the flow from "${b.from}" to "${b.to}"`
      : `the flow of "${b.packet}"`
    : `the ${b.verb} of "${moved(b)}"`;

/**
 * Flow verbs (flows, splits, merges, stacks) in each element's written order, ending by `limit`:
 * one starts no earlier than the one written before it on the same element ends, so a packet's
 * trips play one after another and a merge after its split, unless phrases placed both and this
 * one first, which leaves it out. One that would end after `limit` is shortened, to `FLOW_MIN` at
 * the least, then started earlier, never before what it names is in place or the one before it
 * ends; one with no room even so is left out, and so are the later trips of a packet whose trip
 * was left out, which would leave from where it never arrived.
 */
function sequenced(written: readonly Written[], limit: number): Pass {
  // The last flow verb on each element: as it was timed (a phrase's moment), and as placed.
  const last = new Map<string, { written: Written; placed: DirectionBeat }>();
  const lost = new Set<string>();
  const beats: DirectionBeat[] = [];
  const dropped: DroppedBeat[] = [];
  for (const w of written) {
    const b = w.beat;
    if (!STRETCHES.has(b.verb)) {
      beats.push(b);
      continue;
    }
    const key = moved(b);
    const before = key === undefined ? undefined : last.get(key);
    const earliest = Math.max(w.ready, before ? before.placed.t + before.placed.seconds : 0);
    let t = Math.max(b.t, earliest);
    // By its own length: one near the scene's end was cut short, and it may move earlier.
    const seconds = Math.min(BEAT_SECONDS[b.verb], Math.max(FLOW_MIN, limit - t));
    let reason: string | undefined;
    if (key !== undefined && b.verb === 'flow' && lost.has(key)) reason = afterLost(key);
    // Phrases in the written order never drop a beat, however close: it waits its turn instead.
    else if (before?.written.phrased && w.phrased && b.t < before.written.beat.t) {
      const what = before.placed.verb === b.verb ? `previous ${b.verb}` : before.placed.verb;
      reason = `${named(b)} at ${b.t.toFixed(1)} s comes before its ${what}`;
    } else if (t + seconds > limit + 1e-9) {
      t = limit - seconds;
      if (t < earliest - 1e-9)
        reason = `${named(b)} has no room to end ${SETTLE_LEAD} s before the scene moves on at ${(limit + SETTLE_LEAD).toFixed(1)} s`;
    }
    if (reason !== undefined) {
      // Only a dot has no element: it is said by the node it leaves.
      const element = b.verb === 'flow' ? (b.packet ?? b.from) : moved(b)!;
      dropped.push({ verb: b.verb, element, reason });
      if (b.verb === 'flow' && key !== undefined) lost.add(key);
      continue;
    }
    const placed = { t: round(t), seconds: round(seconds) };
    const beat = placed.t === b.t && placed.seconds === b.seconds ? b : { ...b, ...placed };
    beats.push(beat);
    if (key !== undefined) last.set(key, { written: w, placed: beat });
  }
  return { beats, dropped };
}

/**
 * When every terminal a shot shows has typed its output, in seconds since the scene started, as
 * `shotSettledAt` times them: the storyboard visual on the scene's phases, an output element from
 * its reveal. 0 when the shot shows none.
 */
function typedAt(
  shown: readonly DirectionElement[],
  scene: Scene,
  timing: SceneTiming,
  options: CaptionOptions,
  revealedAt: (id: string) => number,
): number {
  const duration = timing.end - timing.start;
  const text = parseEmphasis(scene.narration).text;
  return Math.max(
    0,
    ...shown.map((e) => {
      if (e.kind === 'visual' && scene.visual.kind === 'terminal')
        return settledAt(scene.visual, duration, scenePhases(scene, text, timing, options));
      if (e.kind !== 'output') return 0;
      const at = revealedAt(e.id);
      return at + settledAt(e.visual, Math.max(0.1, duration - at));
    }),
  );
}

/** A number of pieces, in words: one piece, four pieces. */
const piecesText = (count: number) => `${count} ${count === 1 ? 'piece' : 'pieces'}`;

/**
 * The splits that have room to fan out: a node's own, a packet's that rests against a node when
 * it splits, whose pieces fan out in that node's slot rather than over its label, clear of the
 * pill where it rests and the edge it rests at (`nodeSplits`), and a packet's in its own slot,
 * past its pill. A split whose slot has no arrangement for its pieces beside the label, or whose
 * node another split fans out of already (the first in time takes it), is left out, and said why.
 */
function fanRoom(
  beats: readonly DirectionBeat[],
  elements: readonly DirectionElement[],
  ctx: Pick<Context, 'regions' | 'orientation'>,
): Pass {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const taken = new Map<string, string>();
  const { unit } = ctx.regions;
  const tall = ctx.orientation === 'vertical';
  // Where each resting packet's pill is, as the render lays its node out.
  const planned = nodeSplits({ elements, beats }, unit, tall);
  return sift(beats, (b) => {
    if (b.verb !== 'split') return undefined;
    const kind = byId.get(b.element)?.kind;
    const node = kind === 'node' ? b.element : kind === 'packet' ? restingAt(beats, b) : undefined;
    if (node === undefined) {
      const own = kind === 'packet' ? byId.get(b.element)?.rect : undefined;
      if (!own || arrangedPacketSplit(own, unit, tall, b.count)) return undefined;
      const reason = `the slot of packet "${b.element}" has no room beside its label for ${piecesText(b.count)}`;
      return { verb: b.verb, element: b.element, reason };
    }
    const slot = byId.get(node)?.rect;
    if (!slot) return undefined;
    const plan = planned.get(node);
    // A node an earlier split took and left out: its pill may be anywhere on the box's sides.
    const rests = node === b.element ? false : plan?.element === b.element ? plan.rests : true;
    const where = rests ? `node "${node}", where "${b.element}" rests,` : `node "${node}"`;
    const by = taken.get(node);
    let reason: string | undefined;
    if (by !== undefined) reason = `${where} already makes room for the split of "${by}"`;
    else if (!arrangedSplit(slot, unit, tall, b.count, rests))
      reason = `the slot of ${where} has no room beside its label for ${piecesText(b.count)}`;
    if (reason !== undefined) return { verb: b.verb, element: b.element, reason };
    taken.set(node, b.element);
    return undefined;
  });
}

/**
 * A packet travels whole: one that has split (among `beats`) and not merged back when its next
 * trip leaves stays where it is, so its pieces never cross to the next node, over its label. That
 * trip is left out, and so are the trips after it.
 */
function travelsWhole(beats: readonly DirectionBeat[]): Pass {
  const split = new Map(
    beats.flatMap((b) => (b.verb === 'split' ? [[b.element, b] as const] : [])),
  );
  const merge = new Map(
    beats.flatMap((b) => (b.verb === 'merge' ? [[b.element, b] as const] : [])),
  );
  const lost = new Set<string>();
  return sift(beats, (b) => {
    if (b.verb !== 'flow' || b.packet === undefined) return undefined;
    const s = split.get(b.packet);
    const m = merge.get(b.packet);
    let reason: string | undefined;
    if (lost.has(b.packet)) reason = afterLost(b.packet);
    else if (s && s.t <= b.t && !(m && m.t + m.seconds <= b.t + 1e-9))
      reason = `the flow of "${b.packet}" at ${b.t.toFixed(1)} s leaves while "${b.packet}" is split; merge it first`;
    if (reason === undefined) return undefined;
    lost.add(b.packet);
    return { verb: b.verb, element: b.packet, reason };
  });
}

/**
 * The flow beats that still make sense once timed: a merge with its split still there (a pile
 * merges any time), and a count-up that has landed by the time its counter's count starts (which
 * then ticks from where the count-up ended). The ones that cannot play are left out, and said why.
 */
function flowOrder(beats: readonly DirectionBeat[], elements: readonly DirectionElement[]): Pass {
  const piles = new Set(elements.flatMap((e) => (e.kind === 'pile' ? [e.id] : [])));
  const split = new Set(beats.flatMap((b) => (b.verb === 'split' ? [b.element] : [])));
  const count = new Map(
    beats.flatMap((b) => (b.verb === 'count' ? [[b.element, b.t] as const] : [])),
  );
  return sift(beats, (b) => {
    // `sequenced` keeps a merge after its split, so one without its split lost the split.
    if (b.verb === 'merge' && !piles.has(b.element) && !split.has(b.element))
      return {
        verb: b.verb,
        element: b.element,
        reason: `the merge of "${b.element}" pulls back a split that was left out`,
      };
    const at = b.verb === 'count-up' ? count.get(b.element) : undefined;
    if (b.verb === 'count-up' && at !== undefined && b.t + b.seconds > at + 1e-9)
      return {
        verb: b.verb,
        element: b.element,
        reason: `the count-up of "${b.element}" lands at ${(b.t + b.seconds).toFixed(1)} s, after its count starts`,
      };
    return undefined;
  });
}

/** Flow verbs, which may take longer than their own length, and end before the shot settles. */
const STRETCHES: ReadonlySet<DirectionBeat['verb']> = new Set(FLOW_VERBS);
/**
 * Flow verbs end at least this long before the scene starts to leave, so the frame QC reads it
 * settled at shows them done…
 */
const SETTLE_LEAD = 0.5;
/** …shortened for it to this many seconds at the least. */
const FLOW_MIN = 0.6;
/** A stretched beat ends this long before the next one starts… */
const STRETCH_GAP = 0.15;
/** …and takes at most this many times its own length. */
const STRETCH_MAX = 3;

/**
 * Flows, splits, merges, and stacks take the time until the next beat starts, up to three times
 * their own length and never past `limit`, so a staged story keeps moving between its beats
 * instead of freezing. The last beat keeps its own length: the shot settles before the next scene
 * comes in.
 */
function stretchFlows(beats: DirectionBeat[], limit: number): DirectionBeat[] {
  return beats.map((b, i) => {
    const next = beats[i + 1];
    if (!STRETCHES.has(b.verb) || !next) return b;
    const own = BEAT_SECONDS[b.verb];
    const room = Math.min(next.t - STRETCH_GAP, limit) - b.t;
    const seconds = round(Math.min(STRETCH_MAX * own, Math.max(b.seconds, room)));
    return seconds === b.seconds ? b : { ...b, seconds };
  });
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
