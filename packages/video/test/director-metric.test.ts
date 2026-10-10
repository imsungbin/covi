import { buildEvidence, type Demonstration, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { COUNTER_STEPS, keyMetric, metricChange, metricShot } from '../src/direction/metric.ts';
import { planDirection } from '../src/direction/plan.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const command = (before: string | undefined, after: string, cmd = 'node scripts/measure.js') => ({
  name: 'Measure the review request',
  command: cmd,
  ...(before === undefined ? {} : { before: { exitCode: 0, output: before } }),
  after: { exitCode: 0, output: after },
  changed: true,
});
const measured = (...commands: Array<ReturnType<typeof command>>) => {
  const demo = {
    commands,
    shots: [],
    requests: [],
    skipped: [],
    findings: [],
  } as unknown as Demonstration;
  const evidence = indexEvidence(buildEvidence({ demo }));
  return { evidence, sources: directionSources({ demo, evidence }) };
};
const BENCHMARK = measured(
  command(
    'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1',
    'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0',
  ),
);
const NARRATION =
  "Here's the same command before and after the change. It now prints request bytes: 9907.";
const terminal = (cmd = 'node scripts/measure.js') => ({
  kind: 'terminal',
  command: cmd,
  output: 'request bytes: 9907',
  before: 'request bytes: 70406',
});
const scene = (id: string, visual: unknown, narration = NARRATION): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual });

describe('the default director’s metrics', () => {
  it('measures a change by its fold, so a one-unit count never outranks a large measured change', () => {
    expect(metricChange(70406, 9907)).toBeGreaterThan(metricChange(1, 0));
    expect(metricChange(28, 10)).toBeGreaterThan(metricChange(4, 1));
    expect(metricChange(4, 1)).toBeGreaterThan(metricChange(1, 0));
    expect(metricChange(9907, 70406)).toBe(metricChange(70406, 9907));
    expect(metricChange(0, 0)).toBe(0);
    expect(metricChange(5, 5)).toBe(0);
    expect(keyMetric(scene('s1', terminal()), BENCHMARK.evidence)?.id).toBe(
      'metric:terminal-1:request-bytes',
    );
  });

  it('counts a value that changes sign as a change, through zero', () => {
    expect(metricChange(-5, 5)).toBe(2 * Math.log1p(5));
    expect(metricChange(5, -5)).toBe(metricChange(-5, 5));
    expect(metricChange(-5, 0)).toBe(metricChange(5, 0));
    const flipped = measured(command('margin: -5 ms\nchunks: 4', 'margin: 5 ms\nchunks: 3'));
    expect(keyMetric(scene('s1', terminal()), flipped.evidence)?.id).toBe(
      'metric:terminal-1:margin',
    );
  });

  it('counts down the request bytes of the benchmark, landing as the narration names them', () => {
    const shot = metricShot(scene('s1', terminal()), BENCHMARK.evidence, 'landscape');
    expect(shot).toEqual({
      layout: 'row',
      elements: [
        {
          id: 'metric',
          kind: 'metric',
          evidence: 'metric:terminal-1:request-bytes',
          show: 'counter',
        },
        { id: 'visual', kind: 'visual' },
      ],
      beats: [{ verb: 'count', element: 'metric', at: 'request bytes' }],
    });
    // Stacked above the output in a tall frame, so both keep their size.
    expect(metricShot(scene('s1', terminal()), BENCHMARK.evidence, 'vertical')?.layout).toBe(
      'column',
    );
  });

  it(`compares a change of fewer than ${COUNTER_STEPS} steps instead of ticking it`, () => {
    const small = measured(command('timeouts: 1', 'timeouts: 0'));
    expect(
      metricShot(
        scene('s1', terminal(), 'It now prints timeouts: 0.'),
        small.evidence,
        'landscape',
      ),
    ).toEqual({
      layout: 'row',
      elements: [
        { id: 'metric', kind: 'metric', evidence: 'metric:terminal-1:timeouts', show: 'compare' },
        { id: 'visual', kind: 'visual' },
      ],
      beats: [{ verb: 'reveal', element: 'metric', style: 'pop', at: 'timeouts' }],
    });
  });

  it(`counts the steps as printed, so ${COUNTER_STEPS} tenths tick even when the difference rounds below`, () => {
    // 2.3 − 1.3 is 0.9999999999999998 in floating point: ten printable steps all the same.
    const tenths = measured(command('build time: 1.3 s', 'build time: 2.3 s'));
    const shot = metricShot(
      scene('s1', terminal(), 'It builds in 2.3 s.'),
      tenths.evidence,
      'landscape',
    );
    expect(shot?.elements[0]).toMatchObject({ show: 'counter' });
    expect(shot?.beats).toEqual([{ verb: 'count', element: 'metric', at: '2.3' }]);
    const nine = measured(command('build time: 1.4 s', 'build time: 2.3 s'));
    expect(
      metricShot(scene('s1', terminal()), nine.evidence, 'landscape')?.elements[0],
    ).toMatchObject({ show: 'compare' });
  });

  it('lands on the value when the narration never names the metric, and spreads the count when it says neither', () => {
    const value = metricShot(
      scene('s1', terminal(), 'It sends 9907 bytes now.'),
      BENCHMARK.evidence,
      'landscape',
    );
    expect(value?.beats).toEqual([{ verb: 'count', element: 'metric', at: '9907' }]);
    const drawn = metricShot(
      scene('s1', terminal(), 'It sends 9,907 bytes now.'),
      BENCHMARK.evidence,
      'landscape',
    );
    expect(drawn?.beats).toEqual([{ verb: 'count', element: 'metric', at: '9,907' }]);
    const neither = metricShot(
      scene('s1', terminal(), 'The request is much smaller now.'),
      BENCHMARK.evidence,
      'landscape',
    );
    expect(neither?.beats).toEqual([{ verb: 'count', element: 'metric' }]);
    // A phrase said twice cannot say where to land.
    const twice = metricShot(
      scene('s1', terminal(), 'The request bytes were huge; request bytes: 9907 now.'),
      BENCHMARK.evidence,
      'landscape',
    );
    expect(twice?.beats).toEqual([{ verb: 'count', element: 'metric', at: '9907' }]);
  });

  it('lands only on the whole number or name, never inside another one', () => {
    const beat = (before: string, after: string, narration: string) =>
      metricShot(
        scene('s1', terminal(), narration),
        measured(command(before, after)).evidence,
        'landscape',
      )?.beats[0];
    const pop = { verb: 'reveal', element: 'metric', style: 'pop' };
    // Each would land as the narration says something else: "9" in "19", "0" in "10", "5" in
    // "0.5", "time" in "runtime".
    expect(beat('retries: 1', 'retries: 9', 'Now it gives up after 19 seconds.')).toEqual(pop);
    expect(beat('timeouts: 3', 'timeouts: 0', 'Ten runs took 10 seconds.')).toEqual(pop);
    expect(beat('chunks: 50', 'chunks: 5', 'It now waits 0.5 s.')).toEqual({
      verb: 'count',
      element: 'metric',
    });
    expect(beat('time: 120 ms', 'time: 80 ms', 'The runtime is shorter.')).toEqual({
      verb: 'count',
      element: 'metric',
    });
    expect(beat('chunks: 50', 'chunks: 5', 'It now waits .5 s.')).toEqual({
      verb: 'count',
      element: 'metric',
    });
    // Whole, it lands, wherever the line puts it.
    for (const line of ['It gives up after 9 tries now.', '9 tries, then it gives up.', 'Tries: 9'])
      expect(beat('retries: 1', 'retries: 9', line), line).toEqual({ ...pop, at: '9' });
    // A Korean particle follows a word or number with no space: still the whole of it.
    const korean = (narration: string) =>
      metricShot(scene('s1', terminal(), narration), BENCHMARK.evidence, 'landscape')?.beats;
    expect(korean('이제 9907을 보냅니다.')).toEqual([
      { verb: 'count', element: 'metric', at: '9907' },
    ]);
    expect(korean('이제 request bytes를 줄였습니다.')).toEqual([
      { verb: 'count', element: 'metric', at: 'request bytes' },
    ]);
  });

  it('finds the name whatever its case, and quotes it as the narration says it', () => {
    const scenes = [scene('s1', terminal(), 'Request bytes drop sharply.')];
    const plan = defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 });
    // The counts it measured besides stage before it.
    expect(plan.shots[0]!.beats).toEqual([
      { verb: 'split', element: 'packet', count: 'metric:terminal-1:chunks', side: 'base' },
      { verb: 'stack', element: 'pile' },
      { verb: 'merge', element: 'packet' },
      { verb: 'count', element: 'metric', at: 'Request bytes' },
    ]);
    expect(directionProblems(plan, scenes, BENCHMARK.evidence, BENCHMARK.sources)).toEqual([]);
    expect(DirectionSchema.parse(plan)).toEqual(plan);
    // Said twice in any case, it says nowhere in particular: the value decides.
    const twice = metricShot(
      scene('s1', terminal(), 'Request bytes were huge; request bytes: 9907 now.'),
      BENCHMARK.evidence,
      'landscape',
    );
    expect(twice?.beats).toEqual([{ verb: 'count', element: 'metric', at: '9907' }]);
  });

  it('lands the Korean benchmark draft on the name it prints', () => {
    // The Korean storyboard Covi drafts for the benchmark's terminal scene.
    const narration =
      '버그 수정입니다: review의 Send document references so the reader fetches each document itself. 같은 명령을 변경 전과 후에 실행했습니다. 이제 request bytes: 9907을 출력합니다.';
    expect(metricShot(scene('s1', terminal(), narration), BENCHMARK.evidence, 'landscape')).toEqual(
      {
        layout: 'row',
        elements: [
          {
            id: 'metric',
            kind: 'metric',
            evidence: 'metric:terminal-1:request-bytes',
            show: 'counter',
          },
          { id: 'visual', kind: 'visual' },
        ],
        beats: [{ verb: 'count', element: 'metric', at: 'request bytes' }],
      },
    );
  });

  it('shows no metric when nothing measured changed, or one side is missing', () => {
    const none = (
      evidence: ReturnType<typeof measured>['evidence'],
      visual: unknown = terminal(),
    ) => metricShot(scene('s1', visual), evidence, 'landscape');
    expect(none(measured(command(undefined, 'request bytes: 9907')).evidence)).toBeUndefined();
    expect(none(measured(command('bytes: 5', 'bytes: 5')).evidence)).toBeUndefined();
    expect(none(measured(command('ok', 'done')).evidence)).toBeUndefined();
    expect(none(BENCHMARK.evidence, { kind: 'callout', title: 'C' })).toBeUndefined();
    expect(none(BENCHMARK.evidence, terminal('npm run other'))).toBeUndefined();
    expect(metricShot(scene('s1', terminal()), undefined, 'landscape')).toBeUndefined();
  });

  it('directs the benchmark with shots Covi’s own checks accept, the same way every time', () => {
    const scenes = [
      scene('s1', terminal()),
      scene('s2', { kind: 'callout', title: 'Done' }, 'Done.'),
    ];
    const plan = defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 });
    expect(plan.shots[0]).toMatchObject({
      scene: 's1',
      layout: 'split',
      elements: [{ kind: 'metric' }, { kind: 'packet' }, { kind: 'pile' }],
    });
    expect(plan.shots[1]!.elements).toEqual([{ id: 'visual', kind: 'visual' }]);
    expect(directionProblems(plan, scenes, BENCHMARK.evidence, BENCHMARK.sources)).toEqual([]);
    expect(DirectionSchema.parse(plan)).toEqual(plan);
    expect(defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(plan);
    // Editing what a scene cites never moves a frame.
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['metric:terminal-1:chunks'] }));
    expect(defaultDirection({ scenes: cited, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(
      plan,
    );
    const tall = planDirection({
      mode: 'auto',
      authored: scenes,
      scenes,
      evidence: BENCHMARK.evidence,
      sources: BENCHMARK.sources,
      seed: 3,
      orientation: 'vertical',
    });
    expect(tall.plan!.shots[0]!.layout).toBe('split');
    expect(DirectionSchema.parse(tall.draft)).toEqual(tall.draft);
  });

  it('gives a terminal scene whose id no shot can name no metric, and keeps the others in step', () => {
    const long = 'a'.repeat(DIRECTION_LIMITS.sceneIdChars + 1);
    const scenes = [
      scene('s1', { kind: 'callout', title: 'Start' }, 'Start.'),
      scene(long, terminal()),
      scene('s3', terminal()),
    ];
    const plan = defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 });
    expect(plan.shots.map((s) => s.scene)).toEqual(['s1', 's3']);
    expect(plan.shots[1]).toMatchObject({
      elements: [{ kind: 'metric' }, { kind: 'packet' }, { kind: 'pile' }],
    });
    expect(plan.shots[1]!.enter).toBeDefined();
    expect(DirectionSchema.parse(plan)).toEqual(plan);
  });
});
