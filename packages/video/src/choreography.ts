import { listed } from './density.ts';
import type { QcCheck } from './qc.ts';
import { isCjk } from './text.ts';
import { OUTRO_ID, storyScenes } from './timeline/build.ts';
import { entranceSeconds, keptTokens, MORPH_SETTLE, shotSettledAt } from './timeline/cues.ts';
import { type MotionSpan, motionSpans } from './timeline/motion.ts';
import {
  type DirectionElement,
  isCameraMove,
  type MorphVisual,
  type Timeline,
} from './timeline/types.ts';

/*
 * Choreography checks: does something move whenever the narration speaks, without crowding the
 * moment; is every word on screen long enough to read; and did every beat asked for play. They
 * warn: they judge pacing, not broken output.
 */

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

/** Reading time: a fixed glance, then characters at 15 a second, or 8 for CJK characters. */
export const READING = { glance: 0.4, latin: 15, cjk: 8 } as const;
/** The code a morph adds is held at most this long (s): a long hunk is read with the narration. */
export const MORPH_READING = 2;

/** How long `text` takes to read, in seconds: whitespace is free. */
export function readingSeconds(text: string): number {
  let latin = 0;
  let cjk = 0;
  for (const char of text) {
    if (/\s/u.test(char)) continue;
    if (isCjk(char)) cjk++;
    else latin++;
  }
  return READING.glance + latin / READING.latin + cjk / READING.cjk;
}

/** The words a shot's element puts on screen for the viewer to read, if any. */
function wordsOf(e: DirectionElement): string | undefined {
  if (e.kind === 'label') return e.text;
  if (e.kind === 'node') return e.label;
  if (e.kind === 'packet') return e.label;
  if (e.kind === 'pile' || e.kind === 'metric') return e.name;
  return undefined;
}

/** The code a morph adds: the head's tokens it does not keep, its markers for elided runs aside. */
function addedCode(morph: MorphVisual): string {
  const kept = keptTokens(morph).head;
  return morph.head
    .flatMap((row, r) =>
      row.type === 'elided'
        ? []
        : row.tokens.flatMap((t, i) => (kept.has(`${r}:${i}`) ? [] : [t.text])),
    )
    .join('');
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
        const added = addedCode(e.morph);
        if (morph && added.trim())
          hold(
            `the code that morph "${e.id}" adds`,
            morph.t + morph.seconds + MORPH_SETTLE,
            Math.min(MORPH_READING, readingSeconds(added)),
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

/** The choreography checks, in the order `qc.json` lists them. */
export function choreographyChecks(timeline: Pick<Timeline, 'scenes' | 'transition'>): QcCheck[] {
  return [
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    droppedBeatsCheck(timeline),
  ];
}
