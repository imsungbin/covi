import { describe, expect, it } from 'vitest';
import { settledAt, shotMotion, shotSettledAt } from '../src/timeline/cues.ts';
import { motionSpans, PUNCH_OUT } from '../src/timeline/motion.ts';
import type { TimelineScene, TimelineVisual } from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'C' };
const capture: TimelineVisual = {
  kind: 'screenshot',
  image: { src: 'a.png', width: 10, height: 10 },
  device: 'desktop',
};
const scene = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: callout,
    expression: 'explaining',
    narrator: true,
    speech: { start: start + 0.3, end: end - 0.5, text: 'x' },
    ...extra,
  }) as TimelineScene;
const round = (spans: ReturnType<typeof motionSpans>) =>
  spans.map((m) => [m.scene, m.kind, m.name, ...m.span.map((v) => Math.round(v * 1000) / 1000)]);

describe('motion spans', () => {
  it('list each scene’s entrance, its shot’s elements and beats, and the camera', () => {
    const s1 = scene('s1', 0, 6, {
      direction: {
        whole: false,
        elements: [
          { id: 'n', kind: 'node', rect, label: 'Reader' },
          { id: 'l', kind: 'label', rect, text: 'Late', tone: 'warning' },
        ],
        beats: [
          { verb: 'reveal', element: 'l', style: 'pop', t: 2, seconds: 0.5 },
          { verb: 'camera', move: 'zoom', to: 'l', t: 3, seconds: 0.8 },
        ],
      },
    });
    const s2 = scene('s2', 5.3, 10, { transition: { kind: 'pan', seconds: 0.7 } });
    const spans = motionSpans({ scenes: [s1, s2], transition: 0.45 });
    // Only the shot whose beats wait on its line pushes in steadily from its entrance.
    expect(spans.filter((m) => m.steady).map((m) => [m.scene, m.name])).toEqual([['s1', 'push']]);
    expect(round(spans)).toEqual([
      ['s1', 'element', 'n', 0, 0.5],
      ['s1', 'camera', 'push', 0.5, 6],
      ['s1', 'beat', 'reveal', 2, 2.5],
      ['s1', 'element', 'l', 2, 2.5],
      ['s1', 'beat', 'camera', 3, 3.8],
      ['s2', 'entrance', 'pan', 5.3, 6],
      ['s2', 'element', 'callout', 5.3, 5.9],
      ['s2', 'camera', 'push', 5.9, 10],
    ]);
  });

  it('drift through a capture from its start, punch on the hero, and hold a static scene', () => {
    const drifting = scene('a', 0, 4, { visual: capture, hero: true, phases: { hero: 1 } });
    expect(round(motionSpans({ scenes: [drifting], transition: 0.45 }))).toContainEqual([
      'a',
      'camera',
      'drift',
      0,
      4,
    ]);
    expect(round(motionSpans({ scenes: [drifting], transition: 0.45 }))).toContainEqual([
      'a',
      'camera',
      'punch',
      1,
      1 + PUNCH_OUT,
    ]);
    const still = scene('a', 0, 4, { camera: 'static' });
    expect(motionSpans({ scenes: [still], transition: 0.45 }).map((m) => m.kind)).toEqual([
      'element',
    ]);
  });

  it('give the outro its entrance only', () => {
    const outro = scene('covi:outro', 4, 7, { visual: { kind: 'outro' }, speech: undefined });
    const spans = motionSpans({ scenes: [scene('s1', 0, 4.45), outro], transition: 0.45 });
    expect(round(spans.filter((m) => m.scene === 'covi:outro'))).toEqual([
      ['covi:outro', 'entrance', 'fade', 4, 4.45],
    ]);
  });

  it('settle a shot where its last part has moved', () => {
    const code = {
      kind: 'code' as const,
      path: 'a.js',
      lines: [{ type: 'add' as const, text: 'b' }],
      highlight: [],
    };
    const s = scene('s', 0, 6, {
      direction: {
        whole: false,
        elements: [
          { id: 'c', kind: 'code', rect, visual: code },
          {
            id: 'm',
            kind: 'morph',
            rect,
            morph: { path: 'a.js', base: [], head: [], rows: [], tokens: [] },
          },
        ],
        beats: [
          { verb: 'reveal', element: 'c', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'morph', element: 'm', t: 2, seconds: 1.6 },
        ],
      },
    });
    const parts = shotMotion(s);
    expect(parts.find((p) => p.name === 'c')!.span).toEqual([1, 1 + settledAt(code, 5)]);
    // A morph's added tokens keep their color half a second after it.
    expect(parts.find((p) => p.name === 'morph')!.span).toEqual([2, 4.1]);
    expect(shotSettledAt(s)).toBeCloseTo(4.1, 9);
  });

  it('move a metric on the beat its value lands on, else as it enters', () => {
    const metric = (id: string, show: 'counter' | 'compare') => ({
      id,
      kind: 'metric' as const,
      rect,
      show,
      name: 'request bytes',
      from: 70406,
      to: 9907,
      decimals: 0,
      delta: -86,
    });
    const s = scene('s', 0, 6, {
      direction: {
        whole: false,
        elements: [metric('a', 'counter'), metric('b', 'compare')],
        beats: [
          { verb: 'reveal', element: 'a', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'reveal', element: 'b', style: 'rise', t: 1, seconds: 0.5 },
          { verb: 'count', element: 'a', t: 2, seconds: 1.6 },
        ],
      },
    });
    const parts = shotMotion(s);
    // The counter waits for its count, which lasts until the value is centered with its change.
    expect(parts.find((p) => p.name === 'a')!.span).toEqual([1, 1.5]);
    expect(parts.find((p) => p.name === 'count')!.span[1]).toBeCloseTo(3.6 + 0.3, 9);
    // The compare lands on its own: arrow, after value, then its change.
    expect(parts.find((p) => p.name === 'b')!.span[1]).toBeCloseTo(1 + 0.6 + 0.3 + 0.3, 9);
    expect(shotSettledAt(s)).toBeCloseTo(3.9, 9);
  });
});
