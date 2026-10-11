import {
  area,
  CARDS,
  clip,
  type DensityTimeline,
  EMPTY_SHARE,
  leadKind,
  listed,
  settledReports,
} from './density.ts';
import type { QcCheck } from './qc.ts';
import { computeRegions } from './runtime/layout.ts';
import { OUTRO_ID, storyScenes } from './timeline/build.ts';
import { entranceSeconds, MORPH_SETTLE, openingSpan, shotSettledAt } from './timeline/cues.ts';
import { type MotionSpan, motionSpans } from './timeline/motion.ts';
import { morphReading, readingSeconds } from './timeline/reading.ts';
import {
  type DirectionElement,
  isCameraMove,
  type LayoutReport,
  type Rect,
  type Timeline,
  type TimelineScene,
} from './timeline/types.ts';

/*
 * Choreography checks: does something move whenever the narration speaks, without crowding the
 * moment; is every word on screen long enough to read; does a scene fill the frame while it comes
 * in; do a shot's elements keep clear of one another and of the frame's edges; and did every beat
 * asked for play. They warn: they judge pacing, not broken output; only an element the frame cuts
 * off fails.
 */

/** What the choreography checks read of a timeline: the same as the density checks. */
export type ChoreographyTimeline = DensityTimeline;

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
 * push-in: what `still` names when frozen pixels have no other cause (`motion-gap` names it too
 * when the push is a shot's steady one, waiting on its beats). A stretch the plan holds wholly
 * still is `motion-gap`'s alone to name, and a drift is never frozen (`STILL_NOISE`).
 */
export function onlyCameraMoves(
  timeline: Pick<Timeline, 'scenes' | 'transition'>,
  still: Pick<SpokenStill, 'at' | 'end'>,
): boolean {
  const moving = motionSpans(timeline).filter(
    (m) => m.span[0] < still.end - 1e-6 && m.span[1] > still.at + 1e-6,
  );
  return moving.length > 0 && moving.every((m) => m.kind === 'camera' && m.name === 'push');
}

/**
 * The motion `motion-gap` counts, ordered by start: every span `motionSpans` lists, but a shot's
 * steady push only once the shot has settled. Before then it keeps the frame from freezing while
 * the beats wait on the line; the wait itself is what the check names.
 */
function countedMotion(timeline: Pick<Timeline, 'scenes' | 'transition'>): MotionSpan[] {
  const scenes = new Map(timeline.scenes.map((s) => [s.id, s]));
  return motionSpans(timeline)
    .flatMap((m): MotionSpan[] => {
      const scene = scenes.get(m.scene);
      if (!m.steady || !scene) return [m];
      const from = Math.max(m.span[0], scene.start + shotSettledAt(scene));
      return from < m.span[1] - 1e-9 ? [{ ...m, span: [from, m.span[1]] }] : [];
    })
    .sort((a, b) => a.span[0] - b.span[0]);
}

/**
 * The stretches of the story in which the timeline plans nothing to move, as `motion-gap` counts
 * motion (a shot's steady push from its settle).
 */
export function plannedStills(timeline: Pick<Timeline, 'scenes' | 'transition'>): Stretch[] {
  const end = storyScenes(timeline.scenes).at(-1)?.end ?? 0;
  const out: Stretch[] = [];
  let at = 0;
  for (const { span } of countedMotion(timeline)) {
    if (span[0] >= end) break;
    if (span[0] > at + 1e-6) out.push({ start: at, end: span[0] });
    at = Math.max(at, span[1]);
  }
  if (at < end - 1e-6) out.push({ start: at, end });
  return out;
}

const seconds = (n: number) => `${n.toFixed(1)} s`;

/**
 * Something moves whenever the narration speaks: the timeline's own plan leaves no stretch of
 * 1.5 s or more of narration in which nothing moves. Motion is every scene's entrance (a camera
 * move between stops among them), its visual or shot elements entering and playing their own
 * choreography, its beats, and the scene camera: a capture's drift, the hero's punch, and the
 * push-in once the visual has settled. A shot's steady push, which runs from its entrance while
 * its beats wait on the line, counts only from when the shot has settled, so a wait between beats
 * is a gap. `still` measures the same on the rendered pixels.
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
  const spans = countedMotion(timeline);
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
  if (m.kind === 'entrance')
    return m.scene === OUTRO_ID ? 'the outro' : `the ${m.name} into ${m.scene}`;
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
    ...(i > 0 && s.stop && story[i - 1]!.stop && isCameraMove(s.transition?.kind ?? 'fade')
      ? [{ t: s.start, scene: s.id }]
      : []),
    ...(s.direction?.beats ?? []).flatMap((b) =>
      b.verb === 'camera' ? [{ t: s.start + b.t, scene: s.id }] : [],
    ),
  ]);
  const b = crowded(beats, BUSY_BEATS, 1);
  const m = crowded(moves, BUSY_MOVES, MOVE_WINDOW);
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
 * its characters at 15 a second (8 for CJK). The code a morph adds is held the same way from when
 * it has settled, for at most 2 s. Other code, output, and captures are read with the narration,
 * which `narration-pace` holds to its pace.
 */
export function readingTimeCheck(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck {
  const short: string[] = [];
  let checked = 0;
  timeline.scenes.forEach((scene, i) => {
    const d = scene.direction;
    if (!d || scene.visual.kind === 'outro') return;
    const enter = entranceSeconds(timeline, i);
    const leaves = scene.end - scene.start - entranceSeconds(timeline, i + 1);
    const hold = (text: string, from: number, wanted: number) => {
      checked++;
      const shown = Math.max(0, leaves - Math.max(enter, from));
      if (shown < wanted - 1e-6)
        short.push(`${text} in ${scene.id} for ${seconds(shown)} (${seconds(wanted)} wanted)`);
    };
    for (const e of d.elements) {
      if (e.kind === 'morph') {
        // The runtime plays an element's first morph; its added tokens then take their colors.
        const morph = d.beats.find((b) => b.verb === 'morph' && b.element === e.id);
        const wanted = morphReading(e.morph);
        if (morph && wanted > 0)
          hold(
            `the code that morph "${e.id}" adds`,
            morph.t + morph.seconds + MORPH_SETTLE,
            wanted,
          );
        continue;
      }
      const words = wordsOf(e)?.trim();
      if (!words) continue;
      const reveal = d.beats.find((b) => b.verb === 'reveal' && b.element === e.id);
      hold(`"${words}"`, reveal ? reveal.t + reveal.seconds : 0, readingSeconds(words));
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
    message: `Words leave the screen before they can be read: ${listed(short, '; ')}. Reveal or morph them earlier, shorten them, or give the scene a longer line.`,
  };
}

/**
 * Every beat the direction asked for plays: the resolver leaves out a beat it cannot play where
 * the direction put it (out of order, or without room) and says why, which this check repeats
 * with the beat's verb.
 */
export function droppedBeatsCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const dropped = storyScenes(timeline.scenes).flatMap((s) =>
    (s.direction?.dropped ?? []).map((b) => `a ${b.verb} in ${s.id}: ${b.reason}`),
  );
  if (!dropped.length)
    return { id: 'dropped-beats', status: 'pass', message: 'Every beat asked for plays.' };
  return {
    id: 'dropped-beats',
    status: 'warn',
    message: `Beats were left out: ${listed(dropped, '; ')}. Each reason says what to change: quote phrases in the order the beats should play, or give the beat room (a longer line or a larger slot).`,
  };
}

/**
 * Scenes whose frame the runtime fills: cards (as `empty-frame` holds them) and shots that lay
 * out elements.
 */
const fillsFrame = (scene: Pick<TimelineScene, 'visual' | 'direction'>) =>
  Boolean(scene.direction && !scene.direction.whole) || CARDS.has(leadKind(scene));

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
  // The smallest share each stretch fell to, by when it starts.
  const shares = new Map<number, number>();
  let measured = 0;
  timeline.scenes.forEach((scene, i) => {
    if (scene.visual.kind === 'outro' || !fillsFrame(scene)) return;
    const opening = openingSpan(timeline, i);
    if (!opening) return;
    const samples = layouts
      .filter((r) => r.scene === scene.id && r.content !== undefined)
      .map((r) => {
        const part = clip(r.content!, media);
        return { t: r.frame / timeline.fps, share: part ? area(part) / area(media) : 0 };
      })
      .filter((s) => s.t >= opening[0] - 1e-6 && s.t < opening[1] - 1e-6)
      .sort((a, b) => a.t - b.t);
    if (samples.length) measured++;
    let from: { t: number; share: number } | undefined;
    // Once settled, the frame is empty-frame's to judge: the opening's end closes a stretch.
    for (const s of [...samples, { t: opening[1], share: 1 }]) {
      if (s.share < EMPTY_SHARE - 1e-9)
        from = { t: from?.t ?? s.t, share: Math.min(from?.share ?? 1, s.share) };
      else if (from) {
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
/** A box within this many design units past an edge is inside it: the rounding of drawn boxes. */
const EDGE_UNITS = 4;

/**
 * Whether a packet rests on a node by design: the node is an end of one of the packet's trips,
 * where it sits on the edge's end, half over the node.
 */
function ridesTo(scene: TimelineScene, packet: string, node: string): boolean {
  return (scene.direction?.beats ?? []).some(
    (b) => b.verb === 'flow' && b.packet === packet && (b.from === node || b.to === node),
  );
}

/**
 * A shot's elements keep clear of one another where it has settled: no two of them overlap by
 * more than 4% of the smaller, except a packet and a node one of its trips starts or ends at,
 * which it rests against by design. What an element draws inside its own slot (a split's pieces,
 * a pile's items) is part of that element.
 */
export function overlapCheck(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  // The largest overlap of each pair, over the frames it was measured at.
  const hits = new Map<string, { scene: string; a: string; b: string; share: number }>();
  let measured = 0;
  for (const { scene, report } of settledReports(timeline, layouts)) {
    const elements = report.shot?.elements ?? [];
    if (elements.length > 1) measured++;
    for (const [i, a] of elements.entries())
      for (const b of elements.slice(i + 1)) {
        if (ridesTo(scene, a.id, b.id) || ridesTo(scene, b.id, a.id)) continue;
        const part = clip(a.rect, b.rect);
        const share = part ? area(part) / Math.max(1, Math.min(area(a.rect), area(b.rect))) : 0;
        const key = `${scene.id} ${a.id} ${b.id}`;
        if (share > OVERLAP_SHARE + 1e-9 && share > (hits.get(key)?.share ?? 0))
          hits.set(key, { scene: scene.id, a: a.id, b: b.id, share });
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
  const named = [...hits.values()].map(
    (h) => `"${h.a}" and "${h.b}" in ${h.scene} (${Math.round(100 * h.share)}%)`,
  );
  return {
    id: 'overlap',
    status: 'warn',
    message: `Elements collide: ${listed(named)}. Choose another \`layout\` for the shot, or fewer elements.`,
  };
}

/**
 * Where a shot has settled, every element is drawn inside the band its viewport closes to: the
 * scene's region's rows across the frame's width (the header and the captions sit above and
 * below; the sides hold nothing else). Elements are held where the stop lays them out: a camera
 * that zooms toward one element crops the others by design, and that framing is not held against
 * them. An element past the band is cut off by the frame or the viewport: broken output, so this
 * fails.
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
    const r = shot.region;
    const band = { x: 0, y: r.y, width: timeline.width, height: r.height };
    for (const e of shot.elements)
      if (!inside(e.rect, band, tolerance))
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

/** The choreography checks, in the order `qc.json` lists them. */
export function choreographyChecks(
  timeline: ChoreographyTimeline,
  layouts: readonly LayoutReport[],
): QcCheck[] {
  return [
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    emptyOpeningCheck(timeline, layouts),
    overlapCheck(timeline, layouts),
    outOfFrameCheck(timeline, layouts),
    droppedBeatsCheck(timeline),
  ];
}
