import {
  buildEvidence,
  DEFAULT_CONFIG,
  type Demonstration,
  type Hunk,
  indexEvidence,
  Redactor,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { captionOptionsFor } from '../src/captions.ts';
import {
  countProblem,
  type MetricShotElement,
  metricProblems,
  resolveMetric,
} from '../src/direction/metric.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { BEAT_SECONDS, resolveDirection } from '../src/direction/resolve.ts';
import { type DirectionInput, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources, type MetricSource } from '../src/direction/sources.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';
import { layoutScenes, pacingFor, phraseMoment, timelineLabels } from '../src/timeline/build.ts';

const hunk: Hunk = {
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
  lines: [
    { kind: 'del', text: 'send(docs);', oldLine: 1 },
    { kind: 'add', text: 'send(ids);', newLine: 1 },
  ],
};
const files = [{ path: 'src/request.js', hunks: [hunk] }];
const demo = {
  commands: [
    {
      name: 'Measure the review request',
      command: 'node scripts/measure.js',
      before: { exitCode: 0, output: 'request bytes: 70406\nchunks: 4\nratio: 0.25\nretries: 0' },
      after: {
        exitCode: 0,
        output: 'request bytes: 9907\nchunks: 1\nratio: 0.125\nretries: 2\ncache hits: 3',
      },
      changed: true,
    },
  ],
  shots: [],
  requests: [],
  skipped: [],
  findings: [],
} as unknown as Demonstration;
const evidence = indexEvidence(buildEvidence({ diff: files, demo }));
const sources = directionSources({ files, demo, evidence });
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
    visual: {
      kind: 'terminal',
      command: 'node scripts/measure.js',
      output: 'request bytes: 9907',
      before: 'request bytes: 70406',
    },
  }),
];
const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
const layout = layoutScenes(scenes, new Map(), new Map(), 'en', pacingFor(spec));
const shot = (elements: unknown[], beats: unknown[] = []) =>
  ({ shots: [{ scene: 's2', elements, beats }] }) as DirectionInput;
const metric = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'metric',
  evidence: `metric:terminal-1:${name}`,
  ...extra,
});
const problems = (direction: DirectionInput) =>
  directionProblems(DirectionSchema.parse(direction), scenes, evidence, sources);
const resolve = (
  direction: DirectionInput,
  language: 'en' | 'ko' = 'en',
  redactor = new Redactor(),
) =>
  resolveDirection({
    plan: DirectionSchema.parse(direction),
    scenes,
    layout,
    spec,
    language,
    sources,
    image: () => ({ src: '', width: 1, height: 1 }),
    seed: 5,
    redact: (value) => redactor.redactDeep(value),
  });
const rejected = (value: unknown) => !DirectionSchema.safeParse(value).success;

describe('metrics in the direction file', () => {
  it('accept a metric element and a count beat, and nothing that states a number', () => {
    expect(
      rejected(
        shot(
          [
            metric('a', 'request-bytes'),
            metric('b', 'ratio', { show: 'bars' }),
            metric('c', 'chunks', { show: 'counter', side: 'base', label: 'Chunks' }),
          ],
          [{ verb: 'count', element: 'a', at: 'request bytes' }],
        ),
      ),
    ).toBe(false);
    for (const extra of [
      { value: 42 },
      { base: 1 },
      { head: 2 },
      { from: 1 },
      { to: 2 },
      { delta: -86 },
      { unit: 'KB' },
      { decimals: 2 },
      { show: 'pie' },
      { side: 'both' },
      { label: '86% smaller' },
    ])
      expect(rejected(shot([metric('a', 'request-bytes', extra)])), JSON.stringify(extra)).toBe(
        true,
      );
    for (const extra of [{ to: 5 }, { value: 9907 }, { seconds: 2 }])
      expect(
        rejected(shot([metric('a', 'request-bytes')], [{ verb: 'count', element: 'a', ...extra }])),
        JSON.stringify(extra),
      ).toBe(true);
  });

  it('pass Covi’s checks when the metric has what the shot asks of it', () => {
    expect(
      problems(
        shot(
          [metric('bytes', 'request-bytes'), { id: 'visual', kind: 'visual' }],
          [{ verb: 'count', element: 'bytes', at: 'request bytes' }],
        ),
      ),
    ).toEqual([]);
  });

  it('name every problem with a metric or a count, all at once', () => {
    expect(
      problems(
        shot(
          [
            { id: 'a', kind: 'metric', evidence: 'terminal:1' },
            metric('b', 'nope'),
            metric('c', 'cache-hits', { show: 'bars' }),
            metric('d', 'cache-hits', { side: 'base' }),
            metric('e', 'chunks', { show: 'compare', side: 'head' }),
            metric('f', 'chunks', { side: 'base' }),
            { id: 'g', kind: 'label', text: 'Smaller' },
          ],
          [
            { verb: 'count', element: 'g' },
            { verb: 'count', element: 'f' },
            { verb: 'count', element: 'c' },
            { verb: 'count', element: 'h' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), element a: a metric element shows a metric: item, and "terminal:1" is a terminal',
      'shot 1 (scene s2), element b: cites "metric:terminal-1:nope", which the run\'s evidence does not have (`covi evidence --run <id>` lists it)',
      'shot 1 (scene s2), element c: show "bars" needs a base and a head value, and "metric:terminal-1:cache-hits" has only a head value',
      'shot 1 (scene s2), element d: side "base": "metric:terminal-1:cache-hits" has only a head value',
      'shot 1 (scene s2), element e: show "compare" draws both sides; leave "side" out',
      'shot 1 (scene s2), beat 1 (count): count acts on a metric element, and "g" is a label',
      'shot 1 (scene s2), beat 2 (count): count ticks from base to head, and "f" shows only its base side',
      'shot 1 (scene s2), beat 3 (count): count needs a base and a head value, and "metric:terminal-1:cache-hits" has only a head value',
      'shot 1 (scene s2), beat 4 (count): the shot has no element "h" (it has: a, b, c, d, e, f, g)',
    ]);
    expect(
      problems(
        shot(
          [metric('bytes', 'request-bytes')],
          [
            { verb: 'count', element: 'bytes' },
            { verb: 'count', element: 'bytes' },
          ],
        ),
      ),
    ).toEqual([
      'shot 1 (scene s2), beat 2 (count): "bytes" already counts at an earlier beat; it counts once',
    ]);
  });

  it('copy values and units from evidence, and derive the change themselves', () => {
    const [, s2] = resolve(
      shot([
        metric('bytes', 'request-bytes'),
        metric('ratio', 'ratio', { show: 'bars' }),
        metric('cache', 'cache-hits'),
        metric('chunks', 'chunks', { side: 'base' }),
        metric('retries', 'retries', { show: 'compare' }),
        { id: 'adds', kind: 'metric', evidence: 'metric:diff:additions' },
        metric('size', 'request-bytes', { label: 'Request size' }),
      ]),
    );
    const byId = new Map(s2!.direction.elements.map((e) => [e.id, e]));
    expect(byId.get('bytes')).toEqual({
      id: 'bytes',
      kind: 'metric',
      rect: expect.any(Object),
      show: 'counter',
      name: 'request bytes',
      from: 70406,
      to: 9907,
      decimals: 0,
      delta: -86,
    });
    expect(byId.get('ratio')).toMatchObject({
      show: 'bars',
      from: 0.25,
      to: 0.125,
      decimals: 3,
      delta: -50,
    });
    // One side only: nothing to count from, and no change to draw.
    expect(byId.get('cache')).toMatchObject({ show: 'counter', to: 3 });
    expect(byId.get('cache')).not.toHaveProperty('from');
    expect(byId.get('cache')).not.toHaveProperty('delta');
    expect(byId.get('chunks')).toMatchObject({ to: 4 });
    expect(byId.get('chunks')).not.toHaveProperty('from');
    // From zero there is no percentage.
    expect(byId.get('retries')).toMatchObject({ show: 'compare', from: 0, to: 2 });
    expect(byId.get('retries')).not.toHaveProperty('delta');
    // The diff's totals in the video's own words; an agent's label over the output's name.
    expect(byId.get('adds')).toMatchObject({ name: timelineLabels('en').stats.added, to: 1 });
    expect(byId.get('size')).toMatchObject({ name: 'Request size' });
    const [, ko] = resolve(
      shot([{ id: 'adds', kind: 'metric', evidence: 'metric:diff:additions' }]),
      'ko',
    );
    expect(ko!.direction.elements[0]).toMatchObject({ name: timelineLabels('ko').stats.added });
  });

  it('land a count on its phrase, and start one without a phrase at its spaced slot', () => {
    const [, s2] = resolve(
      shot(
        [metric('bytes', 'request-bytes'), metric('ratio', 'ratio')],
        [
          { verb: 'count', element: 'bytes', at: 'request bytes' },
          { verb: 'count', element: 'ratio' },
        ],
      ),
    );
    const timing = layout.scenes[1]!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const moment = phraseMoment(NARRATION, 'request bytes', timing, options)!;
    const counts = s2!.direction.beats.filter((b) => b.verb === 'count');
    const bytes = counts.find((b) => b.element === 'bytes')!;
    const ratio = counts.find((b) => b.element === 'ratio')!;
    expect(moment).toBeGreaterThan(BEAT_SECONDS.count);
    // It ticks in the moments before the phrase, so the number lands as it is said.
    expect(bytes.t).toBeCloseTo(moment - BEAT_SECONDS.count, 2);
    expect(bytes.t + bytes.seconds).toBeCloseTo(moment, 2);
    const speech = timing.speechEnd - timing.speechStart;
    const lead = timing.speechStart - timing.start;
    expect(ratio.t).toBeCloseTo(lead + speech * (0.15 + 0.85 / 2), 2);
    expect(ratio.seconds).toBeCloseTo(
      Math.min(BEAT_SECONDS.count, timing.end - timing.start - ratio.t),
      2,
    );
  });

  it('tick for a moment at least when the phrase comes early, from the scene’s start', () => {
    const [, s2] = resolve(
      shot(
        [metric('bytes', 'request-bytes')],
        [{ verb: 'count', element: 'bytes', at: 'Here is the same command' }],
      ),
    );
    const timing = layout.scenes[1]!;
    const options = { ...captionOptionsFor('landscape'), language: 'en' as const };
    const early = phraseMoment(NARRATION, 'Here is the same command', timing, options)!;
    expect(early).toBeLessThan(BEAT_SECONDS.count);
    expect(s2!.direction.beats).toEqual([
      { verb: 'count', element: 'bytes', t: 0, seconds: expect.any(Number) },
    ]);
    expect(s2!.direction.beats[0]!.seconds).toBeCloseTo(Math.max(0.6, early), 2);
  });

  it('wait for their metric’s reveal: a count never ticks on a card still out of sight', () => {
    const [, s2] = resolve(
      shot(
        [metric('bytes', 'request-bytes')],
        [
          { verb: 'reveal', element: 'bytes', at: 'request bytes' },
          { verb: 'count', element: 'bytes', at: 'request bytes' },
        ],
      ),
    );
    const [reveal, count] = s2!.direction.beats;
    expect(reveal).toMatchObject({ verb: 'reveal', element: 'bytes' });
    expect(count).toMatchObject({ verb: 'count', element: 'bytes' });
    expect(count!.t).toBeCloseTo(reveal!.t + reveal!.seconds, 3);
    expect(count!.seconds).toBe(BEAT_SECONDS.count);
  });

  it('drop a count on a metric that shows one value: it has nothing to tick', () => {
    // Straight into the resolver, as if it had slipped past the checks.
    const [, s2] = resolve(
      shot([metric('chunks', 'chunks', { side: 'base' })], [{ verb: 'count', element: 'chunks' }]),
    );
    expect(s2!.direction.beats).toEqual([]);
  });

  it('redact what they resolve', () => {
    const [, s2] = resolve(
      shot([metric('size', 'request-bytes', { label: 'zebracorn size' })]),
      'en',
      new Redactor({ literals: ['zebracorn'] }),
    );
    expect(JSON.stringify(s2)).not.toContain('zebracorn');
  });
});

describe('a metric element on its own', () => {
  const rect = { x: 0, y: 0, width: 400, height: 300 };
  const labels = timelineLabels('en');
  const source = (base: number | undefined, head: number | undefined): MetricSource => ({
    id: 'metric:terminal-1:x',
    name: 'x',
    ...(base === undefined ? {} : { base }),
    ...(head === undefined ? {} : { head }),
  });
  const element = (extra: Partial<MetricShotElement> = {}): MetricShotElement => ({
    id: 'x',
    kind: 'metric',
    evidence: 'metric:terminal-1:x',
    ...extra,
  });

  it('refuses bars across zero: lengths from zero cannot draw a change of sign', () => {
    expect(metricProblems(element({ show: 'bars' }), source(-5, 3))).toEqual([
      'show "bars" draws both values as lengths from zero, and "metric:terminal-1:x" changes sign; show "compare" or "counter"',
    ]);
    expect(resolveMetric(element({ show: 'bars' }), source(-5, 3), rect, labels)).toBeUndefined();
    // Zero has no sign, and a compare or a counter draws a change of sign as it is.
    expect(metricProblems(element({ show: 'bars' }), source(0, 3))).toEqual([]);
    expect(metricProblems(element({ show: 'bars' }), source(-5, -3))).toEqual([]);
    expect(metricProblems(element({ show: 'compare' }), source(-5, 3))).toEqual([]);
    expect(resolveMetric(element({ show: 'compare' }), source(-5, 3), rect, labels)).toMatchObject({
      from: -5,
      to: 3,
      delta: 160,
    });
  });

  it('leaves out a change too large to read as a percentage', () => {
    expect(resolveMetric(element(), source(1, 100.99), rect, labels)).toMatchObject({
      delta: 9999,
    });
    for (const [base, head] of [
      [1, 101],
      [-1, -101],
      [0.001, 70406],
    ] as const)
      expect(
        resolveMetric(element(), source(base, head), rect, labels),
        `${base} → ${head}`,
      ).not.toHaveProperty('delta');
  });

  it('echoes a cited id escaped and bounded', () => {
    const hostile = `metric:\u001b[2J‮${'x'.repeat(380)}`;
    const found = [
      ...metricProblems(element({ evidence: hostile, show: 'bars' }), source(undefined, 1)),
      ...metricProblems(element({ evidence: hostile, side: 'base' }), source(undefined, 1)),
      countProblem(element({ evidence: hostile }), source(undefined, 1))!,
    ];
    expect(found).toHaveLength(3);
    for (const line of found) {
      expect(line).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(line).toContain('"metric:\\u001b[2J\\u202exxx');
      expect(line.length).toBeLessThan(260);
    }
  });
});
