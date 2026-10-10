import { describe, expect, it } from 'vitest';
import { leadKind, monotonyCheck } from '../src/density.ts';
import { DELTA_FADE, VALUE_CENTER } from '../src/runtime/numbers.ts';
import { metricSettledAt, shotSettledAt } from '../src/timeline/cues.ts';
import type {
  DirectionBeat,
  DirectionElement,
  SceneDirection,
  TimelineScene,
} from '../src/timeline/types.ts';

const rect = { x: 0, y: 0, width: 10, height: 10 };
const scene = (id: string, start: number, direction?: SceneDirection): TimelineScene =>
  ({
    id,
    beat: id,
    eyebrow: id,
    start,
    end: start + 6,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...(direction ? { direction } : {}),
  }) as TimelineScene;
const shot = (elements: DirectionElement[], beats: DirectionBeat[] = []): SceneDirection => ({
  whole: false,
  elements,
  beats,
});
const a: DirectionElement = { id: 'a', kind: 'node', rect, label: 'Builder' };
const b: DirectionElement = { id: 'b', kind: 'node', rect, label: 'Reader' };
const p: DirectionElement = { id: 'p', kind: 'packet', rect };
const flow: DirectionBeat = { verb: 'flow', from: 'a', to: 'b', packet: 'p', t: 1, seconds: 1.2 };

describe('flows on the timeline', () => {
  it('lead as a flow when a beat stages one, whatever comes first', () => {
    expect(leadKind(scene('s', 0, shot([a, b, p])))).toBe('diagram');
    expect(leadKind(scene('s', 0, shot([a, b, p], [flow])))).toBe('flow');
    expect(leadKind(scene('s', 0, shot([p])))).toBe('flow');
    const split: DirectionBeat = {
      verb: 'split',
      element: 'p',
      count: 4,
      name: 'chunks',
      side: 'base',
      t: 1,
      seconds: 0.9,
    };
    const counter: DirectionElement = {
      id: 'm',
      kind: 'metric',
      rect,
      show: 'counter',
      name: 'request bytes',
      from: 70406,
      to: 9907,
      decimals: 0,
    };
    // The key number first, but the scene stages a flow: it reads as one.
    expect(leadKind(scene('s', 0, shot([counter, p], [split])))).toBe('flow');
    // Three staged scenes in a row are a run like any other.
    expect(
      monotonyCheck({
        scenes: [0, 6, 12].map((t, i) => scene(`s${i}`, t, shot([a, b, p], [flow]))),
      }).status,
    ).toBe('warn');
  });

  it('settle half a second after a packet enters, and once its flows have ended', () => {
    const reveal: DirectionBeat = {
      verb: 'reveal',
      element: 'p',
      style: 'pop',
      t: 0.5,
      seconds: 0.5,
    };
    expect(shotSettledAt(scene('s', 0, shot([a, b, p], [reveal])))).toBeCloseTo(1, 9);
    expect(shotSettledAt(scene('s', 0, shot([a, b, p], [reveal, flow])))).toBeCloseTo(2.2, 9);
  });
});

describe('piles on the timeline', () => {
  const pile: DirectionElement = {
    id: 'r',
    kind: 'pile',
    rect,
    name: 'reader steps',
    rows: [
      { side: 'base', count: 28 },
      { side: 'head', count: 10 },
    ],
  };
  it('lead as a flow, and settle once their stack has filled them', () => {
    expect(leadKind(scene('s', 0, shot([pile])))).toBe('flow');
    const stack: DirectionBeat = { verb: 'stack', element: 'r', t: 2, seconds: 1.8 };
    expect(shotSettledAt(scene('s', 0, shot([pile])))).toBeCloseTo(0.5, 9);
    expect(shotSettledAt(scene('s', 0, shot([pile], [stack])))).toBeCloseTo(3.8, 9);
  });
});

describe('count-ups on the timeline', () => {
  const counter: Extract<DirectionElement, { kind: 'metric' }> = {
    id: 'm',
    kind: 'metric',
    rect,
    show: 'counter',
    name: 'request bytes',
    from: 70406,
    to: 9907,
    decimals: 0,
    delta: -86,
  };
  const up: DirectionBeat = { verb: 'count-up', element: 'm', value: 70406, t: 1, seconds: 1.6 };
  it('settle a counter once its count-up has landed and its change has faded in', () => {
    expect(metricSettledAt(shot([counter], [up]), counter)).toBeCloseTo(2.6 + DELTA_FADE, 9);
    // On the element's clock, from its reveal.
    const reveal: DirectionBeat = {
      verb: 'reveal',
      element: 'm',
      style: 'pop',
      t: 0.5,
      seconds: 0.5,
    };
    expect(metricSettledAt(shot([counter], [reveal, up]), counter)).toBeCloseTo(
      2.6 + DELTA_FADE,
      9,
    );
    // A count after it lands the value and centers it.
    const count: DirectionBeat = { verb: 'count', element: 'm', t: 3, seconds: 1.6 };
    expect(metricSettledAt(shot([counter], [up, count]), counter)).toBeCloseTo(
      4.6 + Math.max(VALUE_CENTER, DELTA_FADE),
      9,
    );
  });
});
