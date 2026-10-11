import { buildEvidence, type Demonstration, indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { metricShot } from '../src/direction/metric.ts';
import { planDirection } from '../src/direction/plan.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import {
  countShot,
  diagramShot,
  isStagedCount,
  STAGED_COUNT_MAX,
} from '../src/direction/staging.ts';
import { type Scene, SceneSchema } from '../src/storyboard/schema.ts';

const scene = (id: string, visual: unknown, narration = 'One line.'): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual });

const diagram = (nodes: Array<[string, string]>, edges: Array<[string, string]>) => ({
  kind: 'diagram',
  nodes: nodes.map(([id, label]) => ({ id, label })),
  edges: edges.map(([from, to]) => ({ from, to })),
});

describe('the default director’s diagrams', () => {
  it('turn a diagram into its nodes, with something travelling each edge in order', () => {
    const v = diagram(
      [
        ['api', 'src/api'],
        ['db', ' Store '],
        ['w', 'Reader worker'],
      ],
      [
        ['api', 'w'],
        ['w', 'db'],
        ['w', 'w'],
        ['api', 'gone'],
      ],
    );
    expect(diagramShot(scene('s1', v))).toEqual({
      elements: [
        { id: 'n1', kind: 'node', label: 'src/api' },
        { id: 'n2', kind: 'node', label: 'Store' },
        { id: 'n3', kind: 'node', label: 'Reader worker' },
      ],
      beats: [
        { verb: 'flow', from: 'n1', to: 'n3' },
        { verb: 'flow', from: 'n3', to: 'n2' },
      ],
    });
  });

  it('keep a diagram whose names are not labels, or whose edges join nothing', () => {
    const named = (label: string) =>
      diagramShot(
        scene(
          's1',
          diagram(
            [
              ['a', label],
              ['b', 'Store'],
            ],
            [['a', 'b']],
          ),
        ),
      );
    expect(named('v2 API')).toBeUndefined();
    expect(named('src/my_module')).toBeUndefined();
    expect(named('x'.repeat(33))).toBeUndefined();
    expect(
      diagramShot(
        scene(
          's1',
          diagram(
            [
              ['a', 'A'],
              ['b', 'B'],
            ],
            [],
          ),
        ),
      ),
    ).toBeUndefined();
    expect(diagramShot(scene('s1', { kind: 'callout', title: 'C' }))).toBeUndefined();
  });

  it('keep a diagram that singles out what changed, or words its edges', () => {
    const nodes = [
      { id: 'input', label: 'Text box' },
      { id: 'counter', label: 'Counter', changed: true },
    ];
    const edge = { from: 'input', to: 'counter' };
    const shot = (visual: object) => diagramShot(scene('s1', { kind: 'diagram', ...visual }));
    expect(shot({ nodes, edges: [edge] })).toBeUndefined();
    expect(
      shot({
        nodes: nodes.map((n) => ({ ...n, changed: false })),
        edges: [{ ...edge, label: 'feeds' }],
      }),
    ).toBeUndefined();
    expect(shot({ nodes: nodes.map((n) => ({ ...n, changed: false })), edges: [edge] })).toEqual({
      elements: [
        { id: 'n1', kind: 'node', label: 'Text box' },
        { id: 'n2', kind: 'node', label: 'Counter' },
      ],
      beats: [{ verb: 'flow', from: 'n1', to: 'n2' }],
    });
  });

  it('stage a drafted diagram: every area changed, its line counts left out', () => {
    const v = {
      kind: 'diagram',
      nodes: [
        { id: 'n0', label: 'packages/video', changed: true, detail: '+12 −3' },
        { id: 'n1', label: 'packages/core', changed: true, detail: '+4 −1' },
      ],
      edges: [{ from: 'n0', to: 'n1' }],
    };
    expect(diagramShot(scene('s1', v))).toEqual({
      elements: [
        { id: 'n1', kind: 'node', label: 'packages/video' },
        { id: 'n2', kind: 'node', label: 'packages/core' },
      ],
      beats: [{ verb: 'flow', from: 'n1', to: 'n2' }],
    });
  });

  it('keep a diagram with more nodes than a shot has elements', () => {
    // Built past the storyboard's own bound, which equals a shot's today, so the director's holds.
    const visual = (count: number) =>
      ({
        kind: 'diagram',
        nodes: Array.from({ length: count }, (_, i) => ({
          id: `k${i}`,
          label: `Node ${'abcdefghi'[i]}`,
          changed: false,
        })),
        edges: [{ from: 'k0', to: 'k1' }],
      }) satisfies Scene['visual'];
    const most = DIRECTION_LIMITS.elementsPerShot;
    expect(diagramShot({ visual: visual(most + 1) })).toBeUndefined();
    expect(diagramShot({ visual: visual(most) })!.elements).toHaveLength(most);
  });

  it('send at most twelve things along a diagram’s edges', () => {
    const nodes = Array.from({ length: 8 }, (_, i): [string, string] => [
      `k${i}`,
      `Node ${'abcdefgh'[i]}`,
    ]);
    const edges = Array.from({ length: 16 }, (_, i): [string, string] => [
      `k${i % 8}`,
      `k${(i + 1) % 8}`,
    ]);
    expect(diagramShot(scene('s1', diagram(nodes, edges)))!.beats).toHaveLength(
      DIRECTION_LIMITS.beatsPerShot,
    );
  });

  it('direct a diagram scene with shots Covi’s own checks accept', () => {
    const scenes = [
      scene('s1', { kind: 'callout', title: 'C' }, 'One.'),
      scene(
        's2',
        diagram(
          [
            ['a', 'Request builder'],
            ['b', 'Reader'],
          ],
          [['a', 'b']],
        ),
        'Two.',
      ),
    ];
    const evidence = indexEvidence({ items: [] });
    const plan = defaultDirection({ scenes, evidence, seed: 1 });
    expect(plan.shots[1]!.beats).toEqual([{ verb: 'flow', from: 'n1', to: 'n2' }]);
    expect(DirectionSchema.parse(plan)).toEqual(plan);
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });
});

const command = (before: string, after: string) => ({
  name: 'Measure the review request',
  command: 'node scripts/measure.js',
  before: { exitCode: 0, output: before },
  after: { exitCode: 0, output: after },
  changed: true,
});
const measured = (before: string, after: string) => {
  const demo = {
    commands: [command(before, after)],
    shots: [],
    requests: [],
    skipped: [],
    findings: [],
  } as unknown as Demonstration;
  const evidence = indexEvidence(buildEvidence({ demo }));
  return { evidence, sources: directionSources({ demo, evidence }) };
};
const BENCHMARK = measured(
  'request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1',
  'request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0',
);
const NARRATION =
  "Here's the same command before and after the change. It now prints request bytes: 9907.";
const terminal = {
  kind: 'terminal',
  command: 'node scripts/measure.js',
  output: 'request bytes: 9907',
  before: 'request bytes: 70406',
};
const said = (id: string, visual: unknown, narration = NARRATION): Scene =>
  SceneSchema.parse({ id, beat: id, narration, visual });
const staged = (evidence: (typeof BENCHMARK)['evidence']) => {
  const s = said('s1', terminal);
  return countShot(s, evidence, metricShot(s, evidence, 'landscape')!);
};

describe('the default director’s counts', () => {
  it('counts only whole, unitless counts that changed, up to 99', () => {
    const count = (metric: Record<string, unknown>) =>
      isStagedCount({ kind: 'metric', metric: { name: 'n', ...metric } });
    expect(count({ base: 4, head: 1 })).toBe(true);
    expect(count({ base: 28, head: 10 })).toBe(true);
    expect(count({ base: 0, head: STAGED_COUNT_MAX })).toBe(true);
    for (const metric of [
      { base: 1, head: 0 },
      { base: 12, head: 12 },
      { base: 0.25, head: 0.125 },
      { base: 100, head: 4 },
      { base: 4, head: 1, unit: 'ms' },
      { head: 4 },
      { base: -2, head: 3 },
    ])
      expect(count(metric), JSON.stringify(metric)).toBe(false);
    expect(isStagedCount({ kind: 'terminal' })).toBe(false);
  });

  it('stages the benchmark’s request splitting into its chunks and its reads piling up, beside the counter', () => {
    expect(staged(BENCHMARK.evidence)).toEqual({
      layout: 'split',
      elements: [
        {
          id: 'metric',
          kind: 'metric',
          evidence: 'metric:terminal-1:request-bytes',
          show: 'counter',
        },
        { id: 'packet', kind: 'packet' },
        { id: 'pile', kind: 'pile', evidence: 'metric:terminal-1:reader-steps' },
      ],
      beats: [
        { verb: 'split', element: 'packet', count: 'metric:terminal-1:chunks', side: 'base' },
        { verb: 'stack', element: 'pile' },
        { verb: 'merge', element: 'packet' },
        { verb: 'count', element: 'metric', at: 'request bytes' },
      ],
    });
  });

  it('splits one into many after the change, without a merge, and piles up a count alone', () => {
    const fanned = measured('request bytes: 9000\nworkers: 1', 'request bytes: 1000\nworkers: 3');
    expect(staged(fanned.evidence)).toEqual({
      layout: 'split',
      elements: [
        {
          id: 'metric',
          kind: 'metric',
          evidence: 'metric:terminal-1:request-bytes',
          show: 'counter',
        },
        { id: 'packet', kind: 'packet' },
      ],
      beats: [
        { verb: 'split', element: 'packet', count: 'metric:terminal-1:workers', side: 'head' },
        { verb: 'count', element: 'metric', at: 'request bytes' },
      ],
    });
    const piled = measured('request bytes: 9000\nretries: 8', 'request bytes: 1000\nretries: 2');
    expect(staged(piled.evidence)?.elements.map((e) => e.kind)).toEqual(['metric', 'pile']);
  });

  it('keeps the counter beside the output when the command counted nothing else', () => {
    const plain = measured('request bytes: 70406\ntimeouts: 1', 'request bytes: 9907\ntimeouts: 0');
    expect(staged(plain.evidence)).toBeUndefined();
    const [shot] = defaultDirection({
      scenes: [said('s1', terminal)],
      evidence: plain.evidence,
      seed: 3,
    }).shots;
    expect(shot!.elements.map((e) => e.kind)).toEqual(['metric', 'visual']);
  });

  it('directs the benchmark with shots Covi’s own checks accept, the same every time, whatever it cites', () => {
    const scenes = [said('s1', terminal), said('s2', { kind: 'callout', title: 'Done' }, 'Done.')];
    const plan = defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 });
    expect(plan.shots[0]!.beats.map((b) => b.verb)).toEqual(['split', 'stack', 'merge', 'count']);
    expect(directionProblems(plan, scenes, BENCHMARK.evidence, BENCHMARK.sources)).toEqual([]);
    expect(defaultDirection({ scenes, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(plan);
    const cited = scenes.map((s) => ({ ...s, evidenceIds: ['metric:terminal-1:chunks'] }));
    expect(defaultDirection({ scenes: cited, evidence: BENCHMARK.evidence, seed: 3 })).toEqual(
      plan,
    );
    // A tall frame splits the same way: the counter above, the packet and the pile below it.
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
  });
});
