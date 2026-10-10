import { indexEvidence } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { defaultDirection } from '../src/direction/director.ts';
import { directionProblems } from '../src/direction/refs.ts';
import { DIRECTION_LIMITS } from '../src/direction/schema.ts';
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
        ['db', 'Store'],
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
    expect(directionProblems(plan, scenes, evidence, directionSources({ evidence }))).toEqual([]);
  });
});
