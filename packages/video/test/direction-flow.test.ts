import {
  buildEvidence,
  DEFAULT_CONFIG,
  type Demonstration,
  indexEvidence,
  Redactor,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { captionOptionsFor } from '../src/captions.ts';
import { elementSlots } from '../src/direction/layout.ts';
import { directionProblems } from '../src/direction/refs.ts';
import {
  BEAT_SECONDS,
  droppedBeatNotes,
  resolveDirection,
  shownShot,
} from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { sceneEvidence } from '../src/grounding.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import { arrangedSplit, EDGE_MIN, nodeBoxRect, textBoxRect } from '../src/runtime/routes.ts';
import { orientationOf, resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor, phraseMoment } from '../src/timeline/build.ts';
import type { Rect, SceneDirection } from '../src/timeline/types.ts';

const demo = {
  commands: [
    {
      name: 'Measure the review request',
      command: 'node scripts/measure.js',
      before: {
        exitCode: 0,
        output: 'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1\nratio: 0.25',
      },
      after: {
        exitCode: 0,
        output:
          'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0\nratio: 0.125\ncache hits: 3',
      },
      changed: true,
    },
  ],
  shots: [],
  requests: [],
  skipped: [],
  findings: [],
} as unknown as Demonstration;
const evidence = indexEvidence(buildEvidence({ demo }));
const sources = directionSources({ demo, evidence });
const NARRATION =
  'Here is the same command before and after the change, and it now prints request bytes: 9907.';
const scenes: Scene[] = [
  SceneSchema.parse({
    id: 's1',
    beat: 's1',
    narration: 'The request carried every document.',
    visual: { kind: 'callout', title: 'Before' },
  }),
  SceneSchema.parse({
    id: 's2',
    beat: 's2',
    narration: NARRATION,
    minSeconds: 8,
    visual: { kind: 'terminal', command: 'node scripts/measure.js', output: 'request bytes: 9907' },
  }),
];
const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
const regions = computeRegions({ ...spec, orientation: 'landscape' });
const id = (name: string) => `metric:terminal-1:${name}`;
const shot = (elements: unknown[], beats: unknown[] = []) =>
  ({ shots: [{ scene: 's2', elements, beats }] }) as DirectionInput;
const problems = (direction: DirectionInput) =>
  directionProblems(DirectionSchema.parse(direction), scenes, evidence, sources);
const resolve = (direction: DirectionInput, redactor = new Redactor()) =>
  resolveDirection({
    plan: DirectionSchema.parse(direction),
    scenes,
    layout,
    spec,
    language: 'en',
    sources,
    image: () => ({ src: '', width: 1, height: 1 }),
    seed: 5,
    redact: (value) => redactor.redactDeep(value),
  });
const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;
/** When s2's flow verbs must end by: half a second before the outro starts to come in. */
const LIMIT = layout.outro!.start - layout.scenes[1]!.start - 0.5;

const node = (name: string, label = 'Reader') => ({ id: name, kind: 'node', label });
const STAGE = [
  node('a', 'Request builder'),
  node('b'),
  { id: 'p', kind: 'packet', label: 'Request' },
  { id: 'r', kind: 'pile', evidence: id('reader-steps') },
  { id: 'm', kind: 'metric', evidence: id('request-bytes') },
];
/**
 * A square frame split for seven nodes: the six beside the first are rows too short for a node's
 * pieces and its count beside its label.
 */
const CROWD = [
  node('a', 'Request builder'),
  node('b'),
  node('c', 'Cache'),
  node('d', 'Writer'),
  node('e', 'Queue'),
  node('f', 'Store'),
  node('g', 'Index'),
  { id: 'p', kind: 'packet', label: 'Request' },
];
const SQUARE = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'custom', width: 1080, height: 1080 });
const crowded = (beats: unknown[]) => {
  const plan = DirectionSchema.parse({
    shots: [{ scene: 's2', layout: 'split', elements: CROWD, beats }],
  });
  const direction = resolveDirection({
    plan,
    scenes,
    layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(SQUARE)),
    spec: SQUARE,
    language: 'en',
    sources,
    image: () => ({ src: '', width: 1, height: 1 }),
    seed: 5,
    redact: (value) => value,
  })[1]!.direction;
  return { shot: plan.shots[0]!, direction };
};
/**
 * A node's slot in a landscape shot that asks for a flow: clear of the slots beside it, so the
 * edge between two side by side is at least `EDGE_MIN` long.
 */
const flowing = (slot: Rect, unit = regions.unit): Rect => {
  const by = ((EDGE_MIN - 28) / 2) * unit;
  return {
    x: slot.x + by,
    y: slot.y + by,
    width: slot.width - 2 * by,
    height: slot.height - 2 * by,
  };
};
/** Where each beat ends. */
const ends = (beats: ReadonlyArray<{ t: number; seconds: number }>) =>
  beats.map((b) => b.t + b.seconds);
const STORY = [
  { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
  { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
  { verb: 'stack', element: 'r' },
  { verb: 'merge', element: 'p' },
  { verb: 'count-up', element: 'm', side: 'base', at: 'before and after' },
  { verb: 'count', element: 'm', at: 'request bytes' },
];

describe('flow verbs in the direction file', () => {
  it('accept packets, piles, and every flow verb, and nothing that states a number', () => {
    expect(rejected(shot(STAGE, STORY))).toBe(false);
    const pile = (extra: Record<string, unknown>) =>
      shot([{ id: 'r', kind: 'pile', evidence: id('reader-steps'), ...extra }]);
    for (const extra of [
      { count: 28 },
      { value: 28 },
      { items: 12 },
      { side: 'both' },
      { label: '28 steps' },
    ])
      expect(rejected(pile(extra)), JSON.stringify(extra)).toBe(true);
    for (const extra of [{ count: 4 }, { label: '10x request' }])
      expect(rejected(shot([{ id: 'p', kind: 'packet', ...extra }])), JSON.stringify(extra)).toBe(
        true,
      );
    const beat = (b: Record<string, unknown>) => shot(STAGE, [b]);
    for (const b of [
      { verb: 'split', element: 'p', count: 4, side: 'base' },
      { verb: 'split', element: 'p', count: id('chunks'), side: 'base', pieces: 4 },
      { verb: 'split', element: 'p', count: id('chunks') },
      { verb: 'flow', from: 'a', to: 'b', path: 'M0 0' },
      { verb: 'merge', element: 'p', count: 1 },
      { verb: 'stack', element: 'r', count: 28 },
      { verb: 'count-up', element: 'm' },
      { verb: 'count-up', element: 'm', side: 'base', to: 5 },
    ])
      expect(rejected(beat(b)), JSON.stringify(b)).toBe(true);
  });

  it('pass Covi’s checks when each beat has what it asks of its elements', () => {
    expect(problems(shot(STAGE, STORY))).toEqual([]);
  });

  it('name every problem with a flow, a split, a merge, or a stack, all at once', () => {
    expect(
      problems(
        shot(
          [
            node('a'),
            node('b'),
            { id: 'p', kind: 'packet' },
            { id: 'q', kind: 'packet' },
            { id: 's', kind: 'pile', evidence: id('ratio') },
            { id: 't', kind: 'pile', evidence: id('cache-hits'), side: 'base' },
            { id: 'l', kind: 'label', text: 'Slow' },
          ],
          [
            { verb: 'flow', from: 'a', to: 'p' },
            { verb: 'flow', from: 'a', to: 'a' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'l' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'q' },
            { verb: 'flow', from: 'a', to: 'b', packet: 'q' },
            { verb: 'split', element: 'l', count: id('chunks'), side: 'base' },
            { verb: 'split', element: 'p', count: 'terminal:1', side: 'base' },
            { verb: 'split', element: 'q', count: id('ratio'), side: 'base' },
            { verb: 'split', element: 'a', count: id('timeouts'), side: 'head' },
            { verb: 'split', element: 'a', count: id('chunks'), side: 'base' },
            { verb: 'merge', element: 'b' },
            { verb: 'stack', element: 'p' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), element s: "metric:terminal-1:ratio" is 0.25 at base; a pile draws a whole number of items, zero or more',
      'shot 1 (scene s2), element s: "metric:terminal-1:ratio" is 0.125 at head; a pile draws a whole number of items, zero or more',
      'shot 1 (scene s2), element t: side "base": "metric:terminal-1:cache-hits" has only a head value',
      'shot 1 (scene s2), beat 1 (flow): flow runs between nodes, and "p" is a packet',
      'shot 1 (scene s2), beat 2 (flow): flow runs between two different nodes, and both ends are "a"',
      'shot 1 (scene s2), beat 3 (flow): flow carries a packet, and "l" is a label',
      'shot 1 (scene s2), beat 5 (flow): "q" is at "b" after beat 4; its next flow leaves from there',
      'shot 1 (scene s2), beat 6 (split): split breaks a packet or a node, and "l" is a label',
      'shot 1 (scene s2), beat 7 (split): split counts a metric: item, and "terminal:1" is a terminal',
      'shot 1 (scene s2), beat 8 (split): "metric:terminal-1:ratio" is 0.25 at base; a split breaks into a whole number of pieces, one or more',
      'shot 1 (scene s2), beat 9 (split): "metric:terminal-1:timeouts" is 0 at head; a split breaks into a whole number of pieces, one or more',
      'shot 1 (scene s2), beat 10 (split): "a" already splits at an earlier beat; it splits once',
      'shot 1 (scene s2), beat 11 (merge): merge pulls a split back together, and nothing splits "b" before it',
      'shot 1 (scene s2), beat 12 (stack): stack acts on a pile element, and "p" is a packet',
    ]);
  });

  it('name every problem with a merge, a stack, or a count-up, and with a beat naming no element', () => {
    expect(
      problems(
        shot(
          [
            { id: 'p', kind: 'packet' },
            { id: 'r', kind: 'pile', evidence: id('reader-steps') },
            { id: 'l', kind: 'label', text: 'Slow' },
            { id: 'm', kind: 'metric', evidence: id('request-bytes') },
            { id: 'n', kind: 'metric', evidence: id('chunks'), side: 'base' },
            { id: 'o', kind: 'metric', evidence: id('chunks'), show: 'bars' },
            { id: 'k', kind: 'metric', evidence: id('reader-steps') },
          ],
          [
            { verb: 'merge', element: 'l' },
            { verb: 'stack', element: 'r' },
            { verb: 'stack', element: 'r' },
            { verb: 'merge', element: 'r' },
            { verb: 'merge', element: 'r' },
            { verb: 'count-up', element: 'r', side: 'base' },
            { verb: 'count-up', element: 'o', side: 'head' },
            { verb: 'count-up', element: 'n', side: 'head' },
            { verb: 'count-up', element: 'm', side: 'head' },
            { verb: 'count-up', element: 'k', side: 'base' },
            { verb: 'count', element: 'm' },
            { verb: 'flow', from: 'zz', to: 'p', packet: 'p' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), beat 1 (merge): merge collapses a split or a pile, and "l" is a label',
      'shot 1 (scene s2), beat 3 (stack): "r" already stacks at an earlier beat; it stacks once',
      'shot 1 (scene s2), beat 5 (merge): "r" already merges at an earlier beat; it merges once',
      'shot 1 (scene s2), beat 6 (count-up): count-up counts a metric up, and "r" is a pile',
      'shot 1 (scene s2), beat 7 (count-up): count-up counts up a counter, and "o" shows "bars"',
      'shot 1 (scene s2), beat 8 (count-up): "n" shows its base value; count up to side "base"',
      'shot 1 (scene s2), beat 9 (count-up): "m" counts from its base value; count up to side "base", where the count starts',
      'shot 1 (scene s2), beat 10 (count-up): "k" shows its head value; count up to side "head"',
      'shot 1 (scene s2), beat 12 (flow): the shot has no element "zz" (it has: p, r, l, m, n, o, k)',
    ]);
  });

  it('resolve piles, splits, flows, and count-ups from the evidence, the riding packet without a slot', () => {
    const [, s2] = resolve(
      shot(
        [
          ...STAGE,
          { id: 'h', kind: 'pile', evidence: id('reader-steps'), side: 'head', label: 'Reads' },
        ],
        STORY,
      ),
    );
    const byId = new Map(s2!.direction.elements.map((e) => [e.id, e]));
    expect(byId.get('r')).toMatchObject({
      kind: 'pile',
      name: 'reader steps',
      rows: [
        { side: 'base', count: 28 },
        { side: 'head', count: 10 },
      ],
    });
    expect(byId.get('h')).toMatchObject({ name: 'Reads', rows: [{ side: 'head', count: 10 }] });
    expect(byId.get('p')).toMatchObject({ kind: 'packet', label: 'Request' });
    // The packet rides the edge: it starts on the node it leaves, and the rest share the slots.
    expect(byId.get('p')!.rect).toEqual(textBoxRect(byId.get('a')!.rect, regions.unit, false));
    const slots = elementSlots(
      ['node', 'node', 'pile', 'metric', 'pile'],
      'auto',
      regions.media,
      'landscape',
      28 * regions.unit,
    );
    expect(['a', 'b', 'r', 'm', 'h'].map((e) => byId.get(e)!.rect)).toEqual([
      flowing(slots[0]!),
      flowing(slots[1]!),
      ...slots.slice(2),
    ]);
    const beats = s2!.direction.beats;
    expect(beats.find((b) => b.verb === 'split')).toMatchObject({
      element: 'p',
      count: 4,
      name: 'chunks',
      side: 'base',
      seconds: BEAT_SECONDS.split,
    });
    expect(beats.find((b) => b.verb === 'flow')).toMatchObject({
      from: 'a',
      to: 'b',
      packet: 'p',
      seconds: BEAT_SECONDS.flow,
    });
    expect(beats.find((b) => b.verb === 'stack')).toMatchObject({ element: 'r', seconds: 1.8 });
    expect(beats.find((b) => b.verb === 'merge')).toMatchObject({ element: 'p' });
    // A count-up lands on its phrase, like a count, and before the count starts.
    const up = beats.find((b) => b.verb === 'count-up')!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const moment = phraseMoment(NARRATION, 'before and after', layout.scenes[1]!, options)!;
    expect(up).toMatchObject({ element: 'm', value: 70406 });
    expect(up.t + up.seconds).toBeCloseTo(moment, 2);
    expect(up.t).toBeLessThan(beats.find((b) => b.verb === 'count')!.t);
    expect(s2!.direction).not.toHaveProperty('dropped');
  });

  it('make way for a count: flow verbs without a phrase end as it starts, when there is room', () => {
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const timing = layout.scenes[1]!;
    const said = (phrase: string) => phraseMoment(NARRATION, phrase, timing, options)!;
    // Where the spacing starts: no beat without a phrase starts before it.
    const first =
      timing.speechStart - timing.start + 0.15 * (timing.speechEnd - timing.speechStart);
    // The default director's staging of the benchmark: spaced, the merge and the stack would
    // still be moving while the request bytes count down.
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'stack', element: 'r' },
        { verb: 'merge', element: 'p' },
        { verb: 'count', element: 'm', at: 'request bytes' },
      ]),
    );
    const beats = s2!.direction.beats;
    const count = beats.find((b) => b.verb === 'count')!;
    // The number counts alone, landing as the narration names it.
    expect(count.t + count.seconds).toBeCloseTo(said('request bytes'), 2);
    expect(beats.at(-1)).toBe(count);
    for (const b of beats.slice(0, -1))
      expect(b.t + b.seconds, b.verb).toBeLessThanOrEqual(count.t + 1e-6);
    // The packet still merges after it splits, and nothing starts before the spacing does.
    const split = beats.find((b) => b.verb === 'split')!;
    expect(beats.find((b) => b.verb === 'merge')!.t).toBeGreaterThanOrEqual(
      split.t + split.seconds - 1e-6,
    );
    for (const b of beats) expect(b.t).toBeGreaterThanOrEqual(first - 1e-3);
    expect(s2!.direction).not.toHaveProperty('dropped');
    // A stack a phrase placed stays on its phrase, while the count ticks.
    const stackOf = (beats: unknown[]) =>
      resolve(shot(STAGE, beats))[1]!.direction.beats.find((b) => b.verb === 'stack')!;
    expect(
      stackOf([
        { verb: 'stack', element: 'r', at: 'request bytes' },
        { verb: 'count', element: 'm', at: 'request bytes' },
      ]).t,
    ).toBeCloseTo(said('request bytes'), 3);
    // A stack still stacking while the count ticks, which would have to start before the spacing
    // does to end in time, stays where the spacing put it.
    const crossed = stackOf([
      { verb: 'stack', element: 'r' },
      { verb: 'count', element: 'm', at: 'before and after' },
    ]);
    expect(crossed.t).toBeCloseTo(first, 3);
    const landed = said('before and after');
    expect(crossed.t).toBeLessThan(landed);
    expect(crossed.t + crossed.seconds).toBeGreaterThan(landed - BEAT_SECONDS.count);
    // Nor before what it acts on is in place: ending as the count starts, this stack would start
    // before its pile is revealed, so it keeps its spaced slot, after the reveal.
    const waits = resolve(
      shot(STAGE, [
        { verb: 'reveal', element: 'r', at: 'before and after' },
        { verb: 'stack', element: 'r' },
        { verb: 'count', element: 'm', at: 'request bytes' },
      ]),
    )[1]!.direction.beats;
    const shown = ends(waits.filter((b) => b.verb === 'reveal'))[0]!;
    const early = said('request bytes') - BEAT_SECONDS.count - BEAT_SECONDS.stack;
    expect(early).toBeGreaterThan(first);
    expect(early).toBeLessThan(shown);
    const spaced =
      timing.speechStart -
      timing.start +
      (timing.speechEnd - timing.speechStart) * (0.15 + 0.85 / 3);
    expect(spaced).toBeGreaterThan(shown);
    expect(waits.find((b) => b.verb === 'stack')!.t).toBeCloseTo(spaced, 3);
    // Nor does one make way into another count: between the two, the stack and the merge keep
    // their spaced slots.
    const [, twice] = resolve(
      shot(
        [...STAGE, { id: 'm2', kind: 'metric', evidence: id('timeouts') }],
        [
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'count', element: 'm2', at: 'the change' },
          { verb: 'stack', element: 'r' },
          { verb: 'merge', element: 'p' },
          { verb: 'count', element: 'm', at: 'request bytes' },
        ],
      ),
    );
    const slot = (i: number) =>
      timing.speechStart -
      timing.start +
      (timing.speechEnd - timing.speechStart) * (0.15 + (0.85 * i) / 5);
    const of = (verb: string) => twice!.direction.beats.find((b) => b.verb === verb)!;
    expect(of('stack').t).toBeCloseTo(slot(2), 3);
    expect(of('merge').t).toBeCloseTo(slot(3), 3);
    expect(twice!.direction).not.toHaveProperty('dropped');
  });

  it('land a count or a count-up without a phrase half a second before the scene moves on', () => {
    // The benchmark's staging on a line that never says the number, as in a short square video:
    // spaced, the count would still tick as the outro comes in (8.97 s), and the frame QC reads
    // the scene settled at would show it mid-count.
    const staged = (last: object) =>
      resolve(
        shot(STAGE, [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'stack', element: 'r' },
          { verb: 'merge', element: 'p' },
          last,
        ]),
      )[1]!.direction;
    for (const last of [
      { verb: 'count', element: 'm' },
      { verb: 'count-up', element: 'm', side: 'base' },
    ]) {
      const d = staged(last);
      const number = d.beats.at(-1)!;
      expect(number.verb).toBe(last.verb);
      expect(number.t + number.seconds).toBeCloseTo(LIMIT, 3);
      expect(number.seconds).toBe(BEAT_SECONDS[last.verb as 'count' | 'count-up']);
      // The flow verbs still make way: the number ticks alone, after all of them.
      for (const b of d.beats.slice(0, -1))
        expect(b.t + b.seconds, b.verb).toBeLessThanOrEqual(number.t + 1e-6);
      expect(d).not.toHaveProperty('dropped');
    }
    // One spaced early enough keeps its slot.
    const early = resolve(
      shot(STAGE, [
        { verb: 'count', element: 'm' },
        { verb: 'stack', element: 'r' },
      ]),
    )[1]!.direction.beats.find((b) => b.verb === 'count')!;
    const timing = layout.scenes[1]!;
    expect(early.t).toBeCloseTo(
      timing.speechStart - timing.start + 0.15 * (timing.speechEnd - timing.speechStart),
      3,
    );
  });

  it('land a count without a phrase by the limit on a short line, at its full length', () => {
    // So short a line that the count's spaced slot starts within its length of the scene's end,
    // where the slot alone would have cut it short.
    const short = [
      scenes[0]!,
      SceneSchema.parse({
        id: 's2',
        beat: 's2',
        narration: 'It prints fewer bytes now.',
        visual: scenes[1]!.visual,
      }),
    ];
    const timed = layoutScenes(short, new Map(), new Map(), 'en', pacingFor(spec));
    const limit = timed.outro!.start - timed.scenes[1]!.start - 0.5;
    for (const last of [
      { verb: 'count', element: 'm' },
      { verb: 'count-up', element: 'm', side: 'base' },
    ]) {
      const [, s2] = resolveDirection({
        plan: DirectionSchema.parse(
          shot(STAGE, [
            { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
            { verb: 'stack', element: 'r' },
            { verb: 'merge', element: 'p' },
            last,
          ]),
        ),
        scenes: short,
        layout: timed,
        spec,
        language: 'en',
        sources,
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      });
      const number = s2!.direction.beats.find((b) => b.verb === last.verb)!;
      expect(number.seconds).toBe(BEAT_SECONDS[last.verb as 'count' | 'count-up']);
      expect(number.t + number.seconds).toBeCloseTo(limit, 3);
    }
  });

  it('start a count without a phrase no earlier than it may, though it then lands late', () => {
    // The counter is revealed on a late phrase: its count waits for the reveal, even where that
    // lands it after the limit.
    const d = resolve(
      shot(STAGE, [
        { verb: 'reveal', element: 'm', at: 'request bytes' },
        { verb: 'count', element: 'm' },
      ]),
    )[1]!.direction;
    const reveal = d.beats.find((b) => b.verb === 'reveal')!;
    const count = d.beats.find((b) => b.verb === 'count')!;
    expect(reveal.t + reveal.seconds).toBeGreaterThan(LIMIT - BEAT_SECONDS.count);
    expect(count.t).toBeCloseTo(reveal.t + reveal.seconds, 3);
    expect(count.t + count.seconds).toBeGreaterThan(LIMIT);
  });

  it('stretch flows, splits, merges, and stacks toward the next beat, up to three times their length', () => {
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'stack', element: 'r' },
        { verb: 'merge', element: 'p' },
      ]),
    );
    const beats = s2!.direction.beats;
    beats.forEach((b, i) => {
      const own = BEAT_SECONDS[b.verb as 'split' | 'stack' | 'merge'];
      // The last beat keeps its own length: the shot settles before the next scene comes in.
      const next = beats[i + 1];
      const room = next ? Math.min(next.t - 0.15, LIMIT) - b.t : 0;
      expect(b.seconds, b.verb).toBeCloseTo(Math.min(3 * own, Math.max(own, room)), 3);
    });
    expect(beats[0]!.seconds).toBeGreaterThan(BEAT_SECONDS.split);
    expect(beats.at(-1)!.seconds).toBe(BEAT_SECONDS.merge);
    for (const end of ends(beats)) expect(end).toBeLessThanOrEqual(LIMIT + 1e-6);
  });

  it('end every flow verb half a second before the scene moves on, shortened if need be', () => {
    // Three trips, a split and its merge, then a stack at the last spaced slot, which would run
    // to the very end of the scene: the outro would come in over a pile still stacking.
    const [, s2] = resolve(
      shot(
        [
          node('a', 'Request builder'),
          node('b'),
          node('c', 'Cache'),
          node('d', 'Writer'),
          { id: 'p', kind: 'packet' },
          { id: 'r', kind: 'pile', evidence: id('reader-steps') },
        ],
        [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'flow', from: 'b', to: 'c', packet: 'p' },
          { verb: 'flow', from: 'c', to: 'd', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'merge', element: 'p' },
          { verb: 'stack', element: 'r' },
        ],
      ),
    );
    const beats = s2!.direction.beats;
    expect(beats.map((b) => b.verb)).toEqual(['flow', 'flow', 'flow', 'split', 'merge', 'stack']);
    expect(s2!.direction).not.toHaveProperty('dropped');
    for (const end of ends(beats)) expect(end).toBeLessThanOrEqual(LIMIT + 1e-6);
    const stack = beats.at(-1)!;
    expect(stack.t + stack.seconds).toBeCloseTo(LIMIT, 3);
    expect(stack.seconds).toBeLessThan(BEAT_SECONDS.stack);
    expect(stack.seconds).toBeGreaterThanOrEqual(0.6);
    // The packet's trips, its split, and its merge play one after another, never overlapping.
    const own = beats.slice(0, 5);
    own.slice(1).forEach((b, i) => {
      expect(b.t).toBeGreaterThanOrEqual(ends(own)[i]! - 1e-6);
    });
  });

  it('caption what a split merges into only when the run measured exactly one', () => {
    const merged = (count: string, side: 'base' | 'head') =>
      resolve(
        shot(STAGE, [
          { verb: 'split', element: 'p', count: id(count), side },
          { verb: 'merge', element: 'p' },
        ]),
      )[1]!.direction.beats.find((b) => b.verb === 'merge');
    expect(merged('chunks', 'base')).toMatchObject({
      into: { count: 1, name: 'chunks', side: 'head' },
    });
    expect(merged('reader-steps', 'base')).not.toHaveProperty('into');
    expect(merged('chunks', 'head')).not.toHaveProperty('into');
  });

  it('drop a merge timed before its split, and a count-up timed after its count, saying why', () => {
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base', at: 'request bytes' },
        { verb: 'merge', element: 'p', at: 'Here is the same command' },
        { verb: 'count', element: 'm' },
        { verb: 'count-up', element: 'm', side: 'base', at: 'request bytes' },
      ]),
    );
    expect(s2!.direction.beats.map((b) => b.verb).sort()).toEqual(['count', 'split']);
    expect(s2!.direction.dropped).toEqual([
      {
        verb: 'merge',
        element: 'p',
        reason: expect.stringMatching(/^the merge of "p" at \d+\.\d s comes before its split$/),
      },
      {
        verb: 'count-up',
        element: 'm',
        reason: expect.stringMatching(
          /^the count-up of "m" lands at \d+\.\d s, after its count starts$/,
        ),
      },
    ]);
    // The render warns and notes each one, naming the shot and the beat.
    const plan = DirectionSchema.parse(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base', at: 'request bytes' },
        { verb: 'merge', element: 'p', at: 'Here is the same command' },
      ]),
    );
    const staging = resolve(plan);
    expect(droppedBeatNotes(plan, scenes, staging)).toEqual([
      expect.stringMatching(
        /^Direction: shot 1 \(scene s2\) leaves out a merge: the merge of "p" at \d+\.\d s comes before its split\.$/,
      ),
    ]);
    // A shot the agent did not write is Covi's: its number in the merged plan names nothing the
    // agent can find, so the scene names it.
    for (const authored of [
      undefined,
      DirectionSchema.parse({
        shots: [{ scene: 's1', elements: [{ id: 'visual', kind: 'visual' }], beats: [] }],
      }),
    ])
      expect(droppedBeatNotes(authored, scenes, staging)).toEqual([
        expect.stringMatching(/^Direction: Covi's shot for scene s2 leaves out a merge: /),
      ]);
    expect(
      droppedBeatNotes(
        DirectionSchema.parse(shot(STAGE, STORY)),
        scenes,
        resolve(shot(STAGE, STORY)),
      ),
    ).toEqual([]);
  });

  it('redact what they resolve, and count what a split shows as the scene’s evidence', () => {
    const [, s2] = resolve(
      shot([{ id: 'r', kind: 'pile', evidence: id('reader-steps'), label: 'zebracorn steps' }]),
      new Redactor({ literals: ['zebracorn'] }),
    );
    expect(JSON.stringify(s2)).not.toContain('zebracorn');
    const plan = DirectionSchema.parse(shot(STAGE, STORY)).shots[0]!;
    expect(sceneEvidence(scenes[1]!, evidence, [], plan)).toEqual([
      id('reader-steps'),
      id('request-bytes'),
      id('chunks'),
    ]);
  });

  it('ground a scene in the splits that resolved, as the render does', () => {
    const plan = DirectionSchema.parse(shot(STAGE, STORY)).shots[0]!;
    const [, s2] = resolve(shot(STAGE, STORY));
    const shown = shownShot(plan, s2!.direction);
    expect(shown?.beats).toEqual([plan.beats[1]]);
    expect(sceneEvidence(scenes[1]!, evidence, [], shown)).toEqual([
      id('reader-steps'),
      id('request-bytes'),
      id('chunks'),
    ]);
    // A split that was left out (its slot has no room) draws no count, so it grounds nothing.
    const left = crowded([{ verb: 'split', element: 'c', count: id('chunks'), side: 'base' }]);
    expect(left.direction.dropped).toHaveLength(1);
    expect(sceneEvidence(scenes[1]!, evidence, [], left.shot)).toEqual([id('chunks')]);
    expect(shownShot(left.shot, left.direction)?.beats).toEqual([]);
    expect(sceneEvidence(scenes[1]!, evidence, [], shownShot(left.shot, left.direction))).toEqual(
      [],
    );
  });

  it('wait for the reveals of what they act on, a flow for both its nodes and its packet', () => {
    const [, s2] = resolve(
      shot(STAGE, [
        { verb: 'reveal', element: 'b', at: 'the change' },
        { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
        { verb: 'reveal', element: 'r', at: 'request bytes' },
        { verb: 'stack', element: 'r' },
      ]),
    );
    const beats = s2!.direction.beats;
    const end = (element: string) => {
      const reveal = beats.find((b) => b.verb === 'reveal' && b.element === element)!;
      return reveal.t + reveal.seconds;
    };
    expect(beats.find((b) => b.verb === 'flow')!.t).toBeCloseTo(end('b'), 3);
    expect(beats.find((b) => b.verb === 'stack')!.t).toBeCloseTo(end('r'), 3);
    // A flow waits for the last of its nodes and its packet to be revealed, whichever it is.
    const flowAfter = (phrases: Record<'a' | 'b' | 'p', string>) => {
      const d = resolve(
        shot(STAGE, [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          ...(['a', 'b', 'p'] as const).map((e) => ({
            verb: 'reveal',
            element: e,
            at: phrases[e],
          })),
        ]),
      )[1]!.direction;
      const reveal = (e: string) => d.beats.find((b) => b.verb === 'reveal' && b.element === e)!;
      return { flow: d.beats.find((b) => b.verb === 'flow')!, reveal };
    };
    const lastPacket = flowAfter({ a: 'before and after', b: 'the change', p: 'it now prints' });
    expect(lastPacket.flow.t).toBeCloseTo(ends([lastPacket.reveal('p')])[0]!, 3);
    const lastNode = flowAfter({ a: 'before and after', b: 'it now prints', p: 'the change' });
    expect(lastNode.flow.t).toBeCloseTo(ends([lastNode.reveal('b')])[0]!, 3);
    // A split, a merge, and a count-up wait for theirs, a count-up without a phrase no longer.
    const acts = resolve(
      shot(STAGE, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'merge', element: 'p' },
        { verb: 'count-up', element: 'm', side: 'head' },
        { verb: 'reveal', element: 'p', at: 'the change' },
        { verb: 'reveal', element: 'm', at: 'it now prints' },
      ]),
    )[1]!.direction.beats;
    const at = (verb: string) => acts.find((b) => b.verb === verb)!;
    const revealed = (e: string) =>
      ends([acts.find((b) => b.verb === 'reveal' && b.element === e)!])[0]!;
    expect(at('split').t).toBeCloseTo(revealed('p'), 3);
    expect(at('merge').t).toBeCloseTo(at('split').t + at('split').seconds, 3);
    expect(at('count-up').t).toBeCloseTo(revealed('m'), 3);
  });

  it('keep each element’s flow verbs in the order written, after the reveals they wait for', () => {
    const three = [node('a', 'Request builder'), node('b'), node('c', 'Cache')];
    const trips = (phrase: string) =>
      resolve(
        shot(
          [...three, node('d', 'Writer'), { id: 'p', kind: 'packet' }],
          [
            { verb: 'reveal', element: 'p', at: phrase },
            { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
            { verb: 'flow', from: 'b', to: 'c', packet: 'p' },
            { verb: 'flow', from: 'c', to: 'd', packet: 'p' },
          ],
        ),
      )[1]!.direction;
    // Revealed late, the packet still makes each trip, one after another.
    const late = trips('the change');
    const legs = late.beats.filter((b) => b.verb === 'flow');
    expect(legs.map((b) => b.verb === 'flow' && b.to)).toEqual(['b', 'c', 'd']);
    expect(legs[0]!.t).toBeCloseTo(ends(late.beats.filter((b) => b.verb === 'reveal'))[0]!, 3);
    legs.slice(1).forEach((b, i) => {
      expect(b.t).toBeCloseTo(ends(legs)[i]!, 3);
    });
    expect(late).not.toHaveProperty('dropped');
    // Revealed later still, the trips that no longer fit before the scene moves on are left out,
    // the ones after them too.
    const later = trips('request bytes');
    expect(
      later.beats.filter((b) => b.verb === 'flow').map((b) => b.verb === 'flow' && b.to),
    ).toEqual(['b']);
    expect(later.dropped).toEqual([
      {
        verb: 'flow',
        element: 'p',
        reason: 'the flow of "p" has no room to end 0.5 s before the scene moves on at 8.9 s',
      },
      {
        verb: 'flow',
        element: 'p',
        reason: 'the flow of "p" follows a trip of "p" that was left out',
      },
    ]);
    // A split and its merge after a late reveal: the merge follows the split.
    const pulled = resolve(
      shot(STAGE, [
        { verb: 'reveal', element: 'p', at: 'it now prints' },
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'merge', element: 'p' },
      ]),
    )[1]!.direction;
    const split = pulled.beats.find((b) => b.verb === 'split')!;
    expect(pulled.beats.find((b) => b.verb === 'merge')!.t).toBeCloseTo(split.t + split.seconds, 3);
    expect(pulled).not.toHaveProperty('dropped');
    // Phrases close together in the written order never drop a trip: each waits its turn.
    const words = resolve(
      shot(
        [...three, node('d', 'Writer'), { id: 'p', kind: 'packet' }],
        [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p', at: 'is' },
          { verb: 'flow', from: 'b', to: 'c', packet: 'p', at: 'same' },
          { verb: 'flow', from: 'c', to: 'd', packet: 'p', at: 'command' },
        ],
      ),
    )[1]!.direction;
    expect(words.beats.map((b) => b.verb === 'flow' && b.to)).toEqual(['b', 'c', 'd']);
    words.beats.slice(1).forEach((b, i) => {
      expect(b.t).toBeCloseTo(ends(words.beats)[i]!, 3);
    });
    expect(words).not.toHaveProperty('dropped');
  });

  it('leave out a merge or a stack with no room to end before the scene moves on', () => {
    const d = resolve(
      shot(STAGE, [
        { verb: 'reveal', element: 'p', at: 'request bytes' },
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'merge', element: 'p' },
        { verb: 'reveal', element: 'r', at: '9907' },
        { verb: 'stack', element: 'r' },
      ]),
    )[1]!.direction;
    // The split plays once the packet is in, ending in time; nothing after it fits.
    const split = d.beats.find((b) => b.verb === 'split')!;
    const reveal = d.beats.find((b) => b.verb === 'reveal' && b.element === 'p')!;
    expect(split.t).toBeCloseTo(reveal.t + reveal.seconds, 3);
    expect(split.t + split.seconds).toBeLessThanOrEqual(LIMIT + 1e-6);
    expect(d.beats.map((b) => b.verb)).toEqual(['reveal', 'split', 'reveal']);
    const late = 'has no room to end 0.5 s before the scene moves on at 8.9 s';
    expect(d.dropped).toEqual([
      { verb: 'merge', element: 'p', reason: `the merge of "p" ${late}` },
      { verb: 'stack', element: 'r', reason: `the stack of "r" ${late}` },
    ]);
  });

  it('end flow verbs before the next scene comes in, when one follows', () => {
    const three = [
      ...scenes,
      SceneSchema.parse({
        id: 's3',
        beat: 's3',
        narration: 'The reader now takes ten steps.',
        visual: { kind: 'callout', title: 'After' },
      }),
    ];
    const timed = layoutScenes(three, new Map(), new Map(), 'en', pacingFor(spec));
    const [, s2] = resolveDirection({
      plan: DirectionSchema.parse(
        shot(STAGE, [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'merge', element: 'p' },
          { verb: 'stack', element: 'r' },
        ]),
      ),
      scenes: three,
      layout: timed,
      spec,
      language: 'en',
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (value) => value,
    });
    // Half a second before s3 starts to come in, which is before s2 ends.
    const limit = timed.scenes[2]!.start - timed.scenes[1]!.start - 0.5;
    expect(timed.scenes[2]!.start).toBeLessThan(timed.scenes[1]!.end);
    const beats = s2!.direction.beats;
    for (const end of ends(beats)) expect(end).toBeLessThanOrEqual(limit + 1e-6);
    expect(Math.max(...ends(beats))).toBeCloseTo(limit, 3);
  });

  it('give a flow verb on a line’s last word its least length, though the scene cuts away soon after', () => {
    // So short a last word, with a cut straight after the line, that the scene ends less than
    // 0.6 s after the word starts: the stack on it must still take 0.6 s, started earlier.
    const cut = [
      scenes[0]!,
      SceneSchema.parse({
        id: 's2',
        beat: 's2',
        narration: 'The reader now takes plan B.',
        visual: { kind: 'callout', title: 'After' },
      }),
      SceneSchema.parse({
        id: 's3',
        beat: 's3',
        narration: 'The reader now takes ten steps.',
        transition: 'cut',
        visual: { kind: 'callout', title: 'Then' },
      }),
    ];
    const timed = layoutScenes(cut, new Map(), new Map(), 'en', pacingFor(spec));
    const s2 = timed.scenes[1]!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const word = phraseMoment('The reader now takes plan B.', 'B', s2, options)!;
    expect(s2.end - s2.start - word).toBeLessThan(0.6);
    const [, staged] = resolveDirection({
      plan: DirectionSchema.parse(shot(STAGE, [{ verb: 'stack', element: 'r', at: 'B' }])),
      scenes: cut,
      layout: timed,
      spec,
      language: 'en',
      sources,
      image: () => ({ src: '', width: 1, height: 1 }),
      seed: 5,
      redact: (value) => value,
    });
    const limit = timed.scenes[2]!.start - s2.start - 0.5;
    const stack = staged!.direction.beats.find((b) => b.verb === 'stack')!;
    expect(stack.seconds).toBe(0.6);
    expect(stack.t + stack.seconds).toBeCloseTo(limit, 3);
  });

  it('keep a packet that split beside a node there until it merges back', () => {
    const d = resolve(
      shot(
        [node('a', 'Request builder'), node('b'), node('c', 'Cache'), { id: 'p', kind: 'packet' }],
        [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'flow', from: 'b', to: 'c', packet: 'p' },
          { verb: 'merge', element: 'p' },
        ],
      ),
    )[1]!.direction;
    expect(d.beats.map((b) => b.verb)).toEqual(['flow', 'split', 'merge']);
    expect(d.dropped).toEqual([
      {
        verb: 'flow',
        element: 'p',
        reason: expect.stringMatching(
          /^the flow of "p" at \d+\.\d s leaves while "p" is split; merge it first$/,
        ),
      },
    ]);
    // Merged first, it travels on.
    const merged = resolve(
      shot(
        [node('a', 'Request builder'), node('b'), node('c', 'Cache'), { id: 'p', kind: 'packet' }],
        [
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
          { verb: 'merge', element: 'p' },
          { verb: 'flow', from: 'b', to: 'c', packet: 'p' },
        ],
      ),
    )[1]!.direction;
    expect(merged.beats.map((b) => b.verb)).toEqual(['flow', 'split', 'merge', 'flow']);
    expect(merged).not.toHaveProperty('dropped');
  });

  it('give a packet whose trips are all left out a slot of its own, clear of the node it would leave', () => {
    const elements = [
      node('a', 'Request builder'),
      node('b'),
      { id: 'p', kind: 'packet', label: 'Request' },
    ];
    // Where a packet no flow carries goes: beside the nodes (a flow asked for, they keep an
    // edge's room), in a slot of its own.
    const [a, b, own] = elementSlots(
      ['node', 'node', 'packet'],
      'auto',
      regions.media,
      'landscape',
      28 * regions.unit,
    ) as [Rect, Rect, Rect];
    const alone = [flowing(a), flowing(b), own];
    const overlaps = (a: Rect, b: Rect) =>
      Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
      Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
    const placed = (d: SceneDirection) => new Map(d.elements.map((e) => [e.id, e.rect]));
    // Revealed too late for its trip, the packet never leaves: its trip is left out, and it rests
    // in its own slot rather than on the name of the node it would have left.
    const late = resolve(
      shot(elements, [
        { verb: 'reveal', element: 'p', at: '9907' },
        { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
      ]),
    )[1]!.direction;
    expect(late.beats.map((b) => b.verb)).toEqual(['reveal']);
    expect(late.dropped).toEqual([
      {
        verb: 'flow',
        element: 'p',
        reason: expect.stringMatching(/^the flow of "p" has no room to end 0\.5 s before/),
      },
    ]);
    const lateAt = placed(late);
    expect(['a', 'b', 'p'].map((e) => lateAt.get(e))).toEqual(alone);
    expect(overlaps(lateAt.get('p')!, textBoxRect(lateAt.get('a')!, regions.unit, false))).toBe(
      false,
    );
    // Split before its trip and never merged, it cannot travel: the trip is left out, it breaks
    // apart in its own slot, and the node it would have rested against keeps the room for a
    // split of its own.
    const split = resolve(
      shot(elements, [
        { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
        { verb: 'split', element: 'a', count: id('reader-steps'), side: 'head' },
      ]),
    )[1]!.direction;
    expect(split.beats.map((b) => b.verb === 'split' && b.element)).toEqual(['p', 'a']);
    expect(split.dropped).toEqual([
      {
        verb: 'flow',
        element: 'p',
        reason: expect.stringMatching(/leaves while "p" is split; merge it first$/),
      },
    ]);
    const splitAt = placed(split);
    expect(['a', 'b', 'p'].map((e) => splitAt.get(e))).toEqual(alone);
    for (const box of [
      textBoxRect(splitAt.get('a')!, regions.unit, false),
      nodeBoxRect(splitAt.get('a')!, regions.unit, false, 10),
    ])
      expect(overlaps(splitAt.get('p')!, box)).toBe(false);
  });

  it('let a trip left out for a split that then has no room travel after all', () => {
    // The packet arrives at "c", splits there, and travels on: its split has no room beside the
    // name of "c", so it never splits, and its next trip carries it whole.
    const d = crowded([
      { verb: 'flow', from: 'a', to: 'c', packet: 'p' },
      { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
      { verb: 'flow', from: 'c', to: 'd', packet: 'p' },
    ]).direction;
    expect(d.beats.map((b) => b.verb === 'flow' && b.to)).toEqual(['c', 'd']);
    expect(d.dropped).toEqual([
      {
        verb: 'split',
        element: 'p',
        reason: 'the slot of node "c", where "p" rests, has no room beside its label for 4 pieces',
      },
    ]);
  });

  it('start a packet that rides from a node that splits on the box the split leaves it', () => {
    const [, s2] = resolve(
      shot(
        [node('a', 'Request builder'), node('b'), { id: 'p', kind: 'packet', label: 'Request' }],
        [
          { verb: 'split', element: 'a', count: id('chunks'), side: 'base' },
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
        ],
      ),
    );
    const byId = new Map(s2!.direction.elements.map((e) => [e.id, e]));
    const box = nodeBoxRect(byId.get('a')!.rect, regions.unit, false, 4);
    expect(box).not.toEqual(textBoxRect(byId.get('a')!.rect, regions.unit, false));
    expect(byId.get('p')!.rect).toEqual(box);
  });

  it('keep nodes a flow joins an edge’s room apart, where their boxes would fill their slots', () => {
    // Square and tall frames give side-by-side nodes slots no wider than their boxes: the gap
    // between the slots alone would leave an edge the arrowhead all but covers.
    const narrow = (spec: typeof SQUARE, count: number, beats: unknown[]) => {
      const plan = DirectionSchema.parse({
        shots: [
          {
            scene: 's2',
            elements: CROWD.slice(0, count),
            beats,
          },
        ],
      });
      const r = computeRegions({ ...spec, orientation: orientationOf(spec.width, spec.height) });
      const d = resolveDirection({
        plan,
        scenes,
        layout: layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec)),
        spec,
        language: 'en',
        sources,
        image: () => ({ src: '', width: 1, height: 1 }),
        seed: 5,
        redact: (value) => value,
      })[1]!.direction;
      const tall = spec.height > spec.width;
      return { d, r, boxes: d.elements.map((e) => textBoxRect(e.rect, r.unit, tall)) };
    };
    /** The room between two boxes side by side, or one above the other. */
    const between = (a: Rect, b: Rect) =>
      Math.max(
        b.x - (a.x + a.width),
        a.x - (b.x + b.width),
        b.y - (a.y + a.height),
        a.y - (b.y + b.height),
      );
    const TALL = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'custom', width: 1080, height: 1920 });
    for (const spec of [SQUARE, TALL])
      for (const count of [2, 4]) {
        const flows = [
          { verb: 'flow', from: 'a', to: 'b' },
          ...(count > 2 ? [{ verb: 'flow', from: 'c', to: 'd' }] : []),
        ];
        const { d, r, boxes } = narrow(spec, count, flows);
        expect(d.beats.filter((b) => b.verb === 'flow')).toHaveLength(flows.length);
        for (const [i, a] of boxes.entries())
          for (const b of boxes.slice(i + 1))
            expect(
              between(a, b) / r.unit,
              `${spec.width}×${spec.height}, ${count} nodes`,
            ).toBeGreaterThanOrEqual(EDGE_MIN - 1e-6);
        // Without a flow there is no edge to make room for: the nodes keep their slots.
        const still = narrow(spec, count, []);
        expect(still.d.elements.map((e) => e.rect)).toEqual(
          elementSlots(
            Array(count).fill('node'),
            'auto',
            still.r.media,
            orientationOf(spec.width, spec.height),
            28 * still.r.unit,
          ),
        );
      }
  });

  it('leave out a node’s split, or a resting packet’s, when the slot has no room for its pieces', () => {
    const squareRegions = computeRegions({ ...SQUARE, orientation: 'square' });
    const slots = elementSlots(
      Array(7).fill('node'),
      'split',
      squareRegions.media,
      'square',
      28 * squareRegions.unit,
    );
    expect(arrangedSplit(slots[2]!, squareRegions.unit, false, 4)).toBeUndefined();
    const own = crowded([
      { verb: 'split', element: 'c', count: id('chunks'), side: 'base' },
      { verb: 'merge', element: 'c' },
    ]).direction;
    expect(own.beats).toEqual([]);
    expect(own.dropped).toEqual([
      {
        verb: 'split',
        element: 'c',
        reason: 'the slot of node "c" has no room beside its label for 4 pieces',
      },
      {
        verb: 'merge',
        element: 'c',
        reason: 'the merge of "c" pulls back a split that was left out',
      },
    ]);
    // A packet that has arrived splits beside the node it rests against, in that node's slot.
    const arrived = [
      { verb: 'flow', from: 'a', to: 'c', packet: 'p' },
      { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
    ];
    const roomy = resolve(
      shot([node('a', 'Request builder'), node('c'), { id: 'p', kind: 'packet' }], arrived),
    )[1]!.direction;
    expect(roomy.beats.map((b) => b.verb)).toEqual(['flow', 'split']);
    expect(roomy).not.toHaveProperty('dropped');
    const cramped = crowded(arrived).direction;
    expect(cramped.beats.map((b) => b.verb)).toEqual(['flow']);
    expect(cramped.dropped).toEqual([
      {
        verb: 'split',
        element: 'p',
        reason: 'the slot of node "c", where "p" rests, has no room beside its label for 4 pieces',
      },
    ]);
  });

  it('make room for one split at a node: its own, or the first packet’s to rest there', () => {
    const [, s2] = resolve(
      shot(
        [node('a', 'Request builder'), node('b'), { id: 'p', kind: 'packet' }],
        [
          { verb: 'split', element: 'b', count: id('reader-steps'), side: 'head' },
          { verb: 'flow', from: 'a', to: 'b', packet: 'p' },
          { verb: 'split', element: 'p', count: id('chunks'), side: 'base' },
        ],
      ),
    );
    expect(s2!.direction.beats.map((b) => b.verb)).toEqual(['split', 'flow']);
    expect(s2!.direction.dropped).toEqual([
      {
        verb: 'split',
        element: 'p',
        reason: 'node "b", where "p" rests, already makes room for the split of "b"',
      },
    ]);
  });
});
