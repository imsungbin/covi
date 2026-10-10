import { type DiffLine, type Language, t } from '@covi/core';
import { type CaptionOptions, captionOptionsFor } from '../captions.ts';
import { computeRegions, gridSpacing, type Regions } from '../runtime/layout.ts';
import { arrangedSplit, nodeFans, restingAt } from '../runtime/routes.ts';
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
import { settledAt } from '../timeline/cues.ts';
import type {
  CodeLine,
  DirectionBeat,
  DirectionElement,
  DroppedBeat,
  ImageAsset,
  Rect,
  SceneDirection,
  SceneStaging,
  TimelineLabels,
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
/** Code elements show at most this many lines (wide, tall frames), as morphs do a side. */
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
 * in the file, and its scene), the beat (its verb and element: each acts on an element once), and
 * why. The run warns with each, and notes it.
 */
export function droppedBeatNotes(
  plan: Pick<Direction, 'shots'>,
  scenes: readonly Pick<Scene, 'id'>[],
  staging: readonly SceneStaging[],
): string[] {
  return staging.flatMap((s, i) => {
    const id = scenes[i]?.id ?? `s${i + 1}`;
    const shot = plan.shots.findIndex((x) => x.scene === id) + 1;
    return (s.direction.dropped ?? []).map(
      (d) =>
        `Direction: shot ${shot} (scene ${id}) leaves out its ${d.verb} of "${d.element}": ${d.reason}.`,
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

function resolveShot(given: Shot, scene: Scene, timing: SceneTiming, ctx: Context): SceneDirection {
  const shot = withMorphs(given);
  const revealed = new Set(shot.beats.flatMap((b) => (b.verb === 'reveal' ? [b.element] : [])));
  let whole =
    shot.elements.length === 1 &&
    shot.elements[0]!.kind === 'visual' &&
    !revealed.has(shot.elements[0]!.id);
  const region = shotRegion(whole, scene.visual, ctx.regions);
  const gap = 28 * ctx.regions.unit;
  const slots = flowSlots(shot, region, ctx.orientation, gap, ctx.regions.unit);
  let elements = shot.elements.flatMap((e, k) => {
    const resolved = element(e, slots[k]!, ctx);
    return resolved ? [resolved] : [];
  });
  // Beats move only what the shot shows: when nothing is left, none of them has a target.
  const shown = elements;
  // Content a validated shot cites is in the run; should all of it be gone, the visual stays.
  if (!elements.length) {
    whole = true;
    elements = [
      { id: 'visual', kind: 'visual', rect: shotRegion(true, scene.visual, ctx.regions) },
    ];
  }
  // A count ticks from one value to another: on a metric showing one value it has nothing to do.
  const countable = new Set(
    elements.flatMap((e) => (e.kind === 'metric' && e.from !== undefined ? [e.id] : [])),
  );
  const timed = timeBeats(shot, scene, timing, ctx.options, shown, ctx).filter(
    (b) => b.verb !== 'count' || countable.has(b.element),
  );
  const roomy = fanRoom(timed, elements, ctx);
  const ordered = flowOrder(roomy.beats, elements);
  const beats = stretchFlows(ordered.beats);
  const dropped = [...roomy.dropped, ...ordered.dropped];
  // A packet riding from a node a split fans out of starts on the box the split leaves that node.
  const fans = new Map([...nodeFans({ elements, beats })].map(([id, fan]) => [id, fan.count]));
  if (fans.size) {
    const riding = flowSlots(shot, region, ctx.orientation, gap, ctx.regions.unit, fans);
    const at = new Map(shot.elements.map((e, k) => [e.id, riding[k]!]));
    elements = elements.map((e) => (e.kind === 'packet' ? { ...e, rect: at.get(e.id)! } : e));
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
 * evenly spaced slot over the line from 0.15 of it (over the scene when it has no line). A count
 * or a count-up with `at` ticks in the moments before its phrase instead, so the number on screen
 * lands as it is said; a count without one never lands before the terminals beside it have typed
 * their output, where its number comes from. `place` is the default made explicit, so it resolves
 * to nothing; beats on elements that are gone drop. Nothing plays on an element that is not in
 * place yet: a beat that moves the camera toward, acts on, or (a flow) travels between or carries
 * a revealed element starts once its (first) reveal is done (the latest of them, for a flow); a
 * count or a count-up that waited is shortened (to `COUNT_MIN` at the least) to land on its phrase
 * still.
 */
function timeBeats(
  shot: Shot,
  scene: Scene,
  timing: SceneTiming,
  options: CaptionOptions,
  shown: readonly DirectionElement[],
  ctx: Pick<Context, 'sources' | 'labels'>,
): DirectionBeat[] {
  const duration = timing.end - timing.start;
  const text = parseEmphasis(scene.narration).text;
  const kept = new Set(shown.map((e) => e.id));
  const live = shot.beats.filter((b) => b.verb !== 'place');
  const spoken = timing.speechEnd > timing.speechStart;
  const from = spoken ? timing.speechStart - timing.start : 0;
  const span = spoken ? timing.speechEnd - timing.speechStart : duration;
  const round = (n: number) => Math.round(n * 1000) / 1000;
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
  const beats = live.flatMap((beat, i): DirectionBeat[] => {
    if (!beatTargets(beat).every((id) => kept.has(id))) return [];
    const pinned = beat.at === undefined ? undefined : phraseMoment(text, beat.at, timing, options);
    const spaced = from + span * (SPACED_FROM + ((1 - SPACED_FROM) * i) / live.length);
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
  });
  const firstReveal = new Map<string, DirectionBeat>();
  for (const b of [...beats].sort((a, b) => a.t - b.t))
    if (b.verb === 'reveal' && !firstReveal.has(b.element)) firstReveal.set(b.element, b);
  const typed = typedAt(shown, scene, timing, options, (id) => firstReveal.get(id)?.t ?? 0);
  /** When element `id` is in place: once its first reveal is done, else from the start. */
  const ready = (id: string) => {
    const reveal = firstReveal.get(id);
    return reveal ? reveal.t + reveal.seconds : 0;
  };
  const aimed = beats.map((b) => {
    if (b.verb === 'reveal') return b;
    const start = Math.max(...resolvedTargets(b).map(ready));
    const at = lands.get(b);
    if (at !== undefined && (b.verb === 'count' || b.verb === 'count-up'))
      return b.t >= start ? b : { ...b, ...landing(at, start, b.verb) };
    // A count without a phrase waits for its number to be typed; a count-up shows the value
    // before it, which no terminal types.
    const begin = Math.max(start, b.verb === 'count' ? typed - BEAT_SECONDS.count : 0);
    return b.t >= begin ? b : { ...b, ...moment(b.verb, begin) };
  });
  // Stable: beats at the same moment keep the order the agent wrote.
  return aimed.sort((a, b) => a.t - b.t);
}

/** The elements a resolved beat moves the camera toward, acts on, travels between, or carries. */
function resolvedTargets(b: DirectionBeat): string[] {
  if (b.verb === 'camera') return [b.to];
  if (b.verb === 'flow') return [b.from, b.to, ...(b.packet === undefined ? [] : [b.packet])];
  return [b.element];
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
 * The splits that fan out of a node and have room to: a node's own, and a packet's that rests
 * against a node when it splits, whose pieces fan out in that node's slot rather than over its
 * label. A split whose slot has no arrangement for its pieces beside the label, or whose node
 * another split fans out of already (the first in time takes it), is left out, and said why.
 */
function fanRoom(
  beats: DirectionBeat[],
  elements: readonly DirectionElement[],
  ctx: Pick<Context, 'regions' | 'orientation'>,
): { beats: DirectionBeat[]; dropped: DroppedBeat[] } {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const taken = new Map<string, string>();
  const dropped: DroppedBeat[] = [];
  const kept = beats.filter((b) => {
    if (b.verb !== 'split') return true;
    const kind = byId.get(b.element)?.kind;
    const node = kind === 'node' ? b.element : kind === 'packet' ? restingAt(beats, b) : undefined;
    const slot = node === undefined ? undefined : byId.get(node)?.rect;
    if (node === undefined || !slot) return true;
    const where =
      node === b.element ? `node "${node}"` : `node "${node}", where "${b.element}" rests,`;
    const by = taken.get(node);
    let reason: string | undefined;
    if (by !== undefined) reason = `${where} already makes room for the split of "${by}"`;
    else if (!arrangedSplit(slot, ctx.regions.unit, ctx.orientation === 'vertical', b.count))
      reason = `the slot of ${where} has no room beside its label for ${piecesText(b.count)}`;
    if (reason === undefined) {
      taken.set(node, b.element);
      return true;
    }
    dropped.push({ verb: b.verb, element: b.element, reason });
    return false;
  });
  return { beats: kept, dropped };
}

/**
 * The flow beats that still make sense once timed: a merge after the split it pulls back (a pile
 * merges any time), and a count-up that has landed by the time its counter's count starts (which
 * then ticks from where the count-up ended). Phrases can put beats out of the written order; the
 * ones that cannot play are left out, and said why.
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
  /** Why a beat cannot play where it was timed, as the beat left out; nothing when it can. */
  const out = (b: DirectionBeat): DroppedBeat | undefined => {
    if (b.verb === 'merge' && !piles.has(b.element)) {
      const at = split.get(b.element);
      const reason =
        at === undefined
          ? `the merge of "${b.element}" pulls back a split that was left out`
          : at >= b.t
            ? `the merge of "${b.element}" at ${b.t.toFixed(1)} s comes before its split`
            : undefined;
      return reason === undefined ? undefined : { verb: b.verb, element: b.element, reason };
    }
    const at = b.verb === 'count-up' ? count.get(b.element) : undefined;
    if (b.verb === 'count-up' && at !== undefined && b.t + b.seconds > at + 1e-9)
      return {
        verb: b.verb,
        element: b.element,
        reason: `the count-up of "${b.element}" lands at ${(b.t + b.seconds).toFixed(1)} s, after its count starts`,
      };
    return undefined;
  };
  const dropped: DroppedBeat[] = [];
  const kept = beats.filter((b) => {
    const left = out(b);
    if (left) dropped.push(left);
    return !left;
  });
  return { beats: kept, dropped };
}

/** Flow verbs that may take longer than their own length. */
const STRETCHES: ReadonlySet<DirectionBeat['verb']> = new Set(['flow', 'split', 'merge', 'stack']);
/** A stretched beat ends this long before the next one starts… */
const STRETCH_GAP = 0.15;
/** …and takes at most this many times its own length. */
const STRETCH_MAX = 3;

/**
 * Flows, splits, merges, and stacks take the time until the next beat starts, up to three times
 * their own length, so a staged story keeps moving between its beats instead of freezing. The last
 * beat keeps its own length: the shot settles before the next scene comes in.
 */
function stretchFlows(beats: DirectionBeat[]): DirectionBeat[] {
  return beats.map((b, i) => {
    const next = beats[i + 1];
    if (!STRETCHES.has(b.verb) || !next) return b;
    const own = BEAT_SECONDS[b.verb];
    const room = next.t - STRETCH_GAP - b.t;
    const seconds =
      Math.round(Math.min(STRETCH_MAX * own, Math.max(b.seconds, room)) * 1000) / 1000;
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
