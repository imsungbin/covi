import type { Scene } from '../storyboard/schema.ts';
import { DIRECTION_LIMITS, LabelSchema, type Shot, type ShotBeat } from './schema.ts';

/*
 * The default director's flows: a diagram's nodes with something travelling each edge. Pure and
 * deterministic; every word comes from the storyboard.
 */

type Staged = Pick<Shot, 'layout' | 'elements' | 'beats'>;

/**
 * A diagram scene as nodes with something travelling each of its edges, in order: its nodes'
 * names are the storyboard's own, and their details are left out (a drafted area's line counts:
 * a shot draws numbers only from metric evidence). Nothing, so the scene keeps its diagram, when a
 * name is not a label (digits, symbols, too long), when it singles out some nodes as changed or
 * words an edge (a node carries no emphasis and a flow no words, and Covi never discards either),
 * when it has more nodes than a shot has elements, or when no edge joins two of its nodes.
 */
export function diagramShot(scene: Pick<Scene, 'visual'>): Staged | undefined {
  const v = scene.visual;
  if (v.kind !== 'diagram' || v.nodes.length > DIRECTION_LIMITS.elementsPerShot) return undefined;
  const changed = v.nodes.filter((n) => n.changed).length;
  if ((changed > 0 && changed < v.nodes.length) || v.edges.some((e) => e.label !== undefined))
    return undefined;
  const labels = v.nodes.flatMap((n) => {
    const label = LabelSchema.safeParse(n.label);
    return label.success ? [label.data] : [];
  });
  if (labels.length < v.nodes.length) return undefined;
  const ids = new Map(v.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const flows = v.edges
    .flatMap((e): ShotBeat[] => {
      const from = ids.get(e.from);
      const to = ids.get(e.to);
      return from && to && from !== to ? [{ verb: 'flow', from, to }] : [];
    })
    .slice(0, DIRECTION_LIMITS.beatsPerShot);
  if (!flows.length) return undefined;
  return {
    elements: labels.map((label, i) => ({ id: `n${i + 1}`, kind: 'node', label })),
    beats: flows,
  };
}
