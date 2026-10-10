import { indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS, DirectionSchema } from '../src/direction/schema.ts';
import { directionSources } from '../src/direction/sources.ts';
import { diagramShot } from '../src/direction/staging.ts';
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
