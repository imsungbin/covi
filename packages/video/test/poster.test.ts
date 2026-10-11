import { describe, expect, it } from 'vitest';
import { layoutSampleFrames, posterFrame } from '../src/render/renderer.ts';
import { openingSpan, settledSpan } from '../src/timeline/cues.ts';
import { posterTime } from '../src/timeline/motion.ts';
import type {
  DirectionBeat,
  DirectionElement,
  Timeline,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const metric = (id: string, from: number, to: number): DirectionElement => ({
  id,
  kind: 'metric',
  rect,
  show: 'counter',
  name: id,
  from,
  to,
  decimals: 0,
});
const count = (element: string, t: number): DirectionBeat => ({
  verb: 'count',
  element,
  t,
  seconds: 1.6,
});
const counted = (element: DirectionElement, beat: DirectionBeat) => ({
  whole: false,
  elements: [element],
  beats: [beat],
});
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...(start > 0 ? { transition: { kind: 'fade', seconds: 0.45 } } : {}),
    ...extra,
  }) as TimelineScene;
const timeline = (scenes: TimelineScene[]) => {
  const duration = scenes.at(-1)!.end;
  return {
    scenes,
    transition: 0.45,
    fps: 30,
    frames: Math.round(duration * 30),
    duration,
  } as Timeline;
};

describe('the poster', () => {
  const after = (t: number) => Math.round(t * 30);

  it('shows the key number where its count lands, its change in beside it, before the hero', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('bytes', 70406, 9907), count('bytes', 4)) }),
      scene('s2', 7.55, 12, { hero: true, phases: { hero: 1 } }),
    ]);
    // Landed at 5.6 s, then centred over 0.3 s.
    expect(posterTime(t)).toBeCloseTo(4 + 1.6 + 0.3, 9);
    expect(posterFrame(t)).toBe(after(5.9));
  });

  it('picks the count that changes its metric the most, as the director measures change', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 100, 90), count('a', 1)) }),
      scene('s2', 7.55, 14, { direction: counted(metric('b', 28, 10), count('b', 2)) }),
    ]);
    expect(posterTime(t)).toBeCloseTo(7.55 + 2 + 1.6 + 0.3, 9);
    // One timeout gone does not outrank a request seven times smaller.
    const fold = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 1, 0), count('a', 1)) }),
      scene('s2', 7.55, 14, { direction: counted(metric('b', 70406, 9907), count('b', 2)) }),
    ]);
    expect(posterTime(fold)).toBeCloseTo(7.55 + 2 + 1.6 + 0.3, 9);
    // Two counts that change their metrics alike: the earlier one.
    const tie = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 10, 1), count('a', 1)) }),
      scene('s2', 7.55, 14, { direction: counted(metric('b', 10, 1), count('b', 2)) }),
    ]);
    expect(posterTime(tie)).toBeCloseTo(1 + 1.6 + 0.3, 9);
  });

  it('holds the moment before the next scene starts to enter', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 10, 1), count('a', 5.8)) }),
      scene('s2', 7.55, 12),
    ]);
    // The count lands at 7.4 s; s2 starts to enter at 7.55 s.
    expect(posterTime(t)).toBeCloseTo(7.55, 9);
    expect(posterFrame(t)).toBe(Math.floor(7.55 * 30 - 1e-6));
  });

  it('holds a count that lands while its scene still enters until the entrance is done', () => {
    const t = timeline([
      scene('s1', 0, 4),
      scene('s2', 3.55, 9, {
        transition: { kind: 'zoom', seconds: 0.9 },
        direction: counted(metric('a', 10, 1), { ...count('a', 0), seconds: 0.2 }),
      }),
    ]);
    // Landed and centred 0.5 s in, during the 0.9 s zoom that brings s2 in.
    expect(posterTime(t)).toBeCloseTo(3.55 + 0.9, 9);
    expect(posterFrame(t)).toBe(Math.ceil((3.55 + 0.9) * 30 - 1e-6));
  });

  it('passes over a count that lands while the next scene enters, for the hero after its accent', () => {
    const t = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 10, 1), count('a', 6.2)) }),
      scene('s2', 7.55, 12, { hero: true, phases: { hero: 1 } }),
    ]);
    // s2's callout has settled 0.6 s in; its accent has played 1.7 s in.
    expect(posterTime(t)).toBeCloseTo(7.55 + 1 + 0.7, 9);
    expect(posterFrame(t)).toBe(Math.ceil((7.55 + 1 + 0.7) * 30 - 1e-6));
  });

  it('waits for a hero still moving, and holds it inside its scene before the next one enters', () => {
    const moving = timeline([
      scene('s1', 0, 8, {
        hero: true,
        phases: { hero: 0.5 },
        direction: {
          whole: false,
          elements: [{ id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' }],
          beats: [{ verb: 'reveal', element: 'l', style: 'rise', t: 3.5, seconds: 0.5 }],
        },
      }),
      scene('s2', 7.55, 12),
    ]);
    // Its label rises in by 4 s, after the accent (1.2 s): the poster waits for the scene to settle.
    expect(posterTime(moving)).toBeCloseTo(4, 9);
    const late = timeline([
      scene('s1', 0, 8, { hero: true, phases: { hero: 7.2 } }),
      scene('s2', 7.55, 12),
    ]);
    // The accent would end at 7.9 s, after s2 starts to enter at 7.55 s.
    expect(posterFrame(late)).toBe(Math.floor(7.55 * 30 - 1e-6));
  });

  it('falls back to 1.6 s in, or a third of a very short video', () => {
    expect(posterFrame(timeline([scene('s1', 0, 8)]))).toBe(48);
    expect(posterFrame(timeline([scene('s1', 0, 3)]))).toBe(30);
    // A count that changes nothing shows no change.
    const same = timeline([
      scene('s1', 0, 8, { direction: counted(metric('a', 5, 5), count('a', 1)) }),
    ]);
    expect(posterFrame(same)).toBe(48);
  });
});

describe('an opening’s samples', () => {
  const terminal = {
    kind: 'terminal',
    command: 'node scripts/measure.js',
    before: 'request bytes: 70406',
    output: 'request bytes: 9907',
  } as const;

  it('cover a scene from the end of its entrance until it settles, every half second', () => {
    const t = timeline([scene('s1', 0, 5, { visual: terminal }), scene('s2', 4.55, 9)]);
    const [from, to] = openingSpan(t, 0)!;
    expect(from).toBe(0);
    expect(to).toBeCloseTo(settledSpan(t, 0)![0], 9);
    expect(to - from).toBeLessThanOrEqual(4);
    const frames = layoutSampleFrames(t);
    for (let at = from; at < to - 1e-6; at += 0.5) expect(frames).toContain(Math.round(at * 30));
    // A later scene's opening starts once its entrance is done, on the first frame after it.
    const [enters] = openingSpan(t, 1)!;
    expect(enters).toBeCloseTo(4.55 + 0.45, 9);
    expect(frames).toContain(Math.ceil(enters * 30 - 1e-6));
  });

  it('spread eight samples over a long opening, and take none of a scene settled as it enters', () => {
    const long = timeline([scene('s1', 0, 30, { visual: terminal })]);
    const [from, to] = openingSpan(long, 0)!;
    const step = (to - from) / 8;
    expect(step).toBeGreaterThan(0.5);
    // The scene's own samples at 35% and 70% of the way through stay as they were.
    const timed = new Set([0.35, 0.7].map((k) => Math.round(k * 30 * 30)));
    const inside = layoutSampleFrames(long).filter(
      (f) => f / 30 >= from && f / 30 < to - 1e-6 && !timed.has(f),
    );
    expect(inside).toEqual(Array.from({ length: 8 }, (_, k) => Math.round((from + k * step) * 30)));
    // A callout has risen in 0.6 s, before a 0.9 s zoom has brought it in.
    const quick = timeline([
      scene('s1', 0, 4),
      scene('s2', 3.55, 8, { transition: { kind: 'zoom', seconds: 0.9 } }),
    ]);
    expect(openingSpan(quick, 1)).toBeUndefined();
  });
});
