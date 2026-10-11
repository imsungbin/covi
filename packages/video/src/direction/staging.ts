import type { EvidenceIndex, EvidenceItem } from '@covi/core';
import type { Scene } from '../storyboard/schema.ts';
import { commandMetrics, type MetricShotElement, mostChanged } from './metric.ts';
import {
  DIRECTION_LIMITS,
  LabelSchema,
  type Shot,
  type ShotBeat,
  type ShotElement,
} from './schema.ts';

/*
 * The default director's flows: a diagram's nodes with something travelling each edge, and a
 * terminal scene's measured counts staged beside its key number: the request that splits into
 * chunks and merges into one, the reads that pile up. Pure and deterministic; every count comes
 * from metric evidence and every word from the storyboard or the run.
 */

type Staged = Pick<Shot, 'layout' | 'elements' | 'beats'>;

/** The largest count the director stages as pieces or a pile; larger numbers stay a counter's. */
export const STAGED_COUNT_MAX = 99;

/**
 * A metric that counts things a viewer can see as items: whole and unitless at both revisions,
 * changed, at least two on one side, and at most 99.
 */
export function isStagedCount(item: Pick<EvidenceItem, 'kind' | 'metric'>): boolean {
  const m = item.metric;
  if (item.kind !== 'metric' || !m || m.unit || m.base === undefined || m.head === undefined)
    return false;
  const { base, head } = m;
  const most = Math.max(base, head);
  return (
    Number.isInteger(base) &&
    Number.isInteger(head) &&
    Math.min(base, head) >= 0 &&
    base !== head &&
    most >= 2 &&
    most <= STAGED_COUNT_MAX
  );
}

/**
 * A terminal scene's counts, staged beside the key number its metric shot shows: the count that
 * goes from one to many (or many to one) is a packet, named as the output named that count, that
 * splits into its pieces, and merges back into one when the change leaves one; the count that
 * changed most of the rest is a pile, before above after. They take the place of the command's
 * output, whose numbers they show. Nothing when the command counted nothing else.
 */
export function countShot(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
  measured: Staged,
): Staged | undefined {
  const key = measured.elements.find((e): e is MetricShotElement => e.kind === 'metric');
  if (!key) return undefined;
  const counts = commandMetrics(scene, evidence).filter(
    (item) => item.id !== key.evidence && isStagedCount(item),
  );
  const split = mostChanged(
    counts.filter((item) => Math.min(item.metric!.base!, item.metric!.head!) === 1),
  );
  const pile = mostChanged(counts.filter((item) => item !== split));
  if (!split && !pile) return undefined;
  const elements: ShotElement[] = [key];
  const beats: ShotBeat[] = [];
  // Many to one: the request splits as it was, then merges into what it became.
  const merges = split !== undefined && split.metric!.base! > split.metric!.head!;
  if (split) {
    // Named by what it splits into, as the run's output called it: a pill with no words reads as
    // an empty shape. A name that is no label (digits, symbols) leaves it unlabeled.
    const label = LabelSchema.safeParse(split.label);
    elements.push({
      id: 'packet',
      kind: 'packet',
      ...(label.success ? { label: label.data } : {}),
    });
    beats.push({
      verb: 'split',
      element: 'packet',
      count: split.id,
      side: merges ? 'base' : 'head',
    });
  }
  if (pile) {
    elements.push({ id: 'pile', kind: 'pile', evidence: pile.id });
    beats.push({ verb: 'stack', element: 'pile' });
  }
  if (merges) beats.push({ verb: 'merge', element: 'packet' });
  return { layout: 'split', elements, beats: [...beats, ...measured.beats] };
}

/**
 * A diagram scene as nodes with something travelling each of its edges, in order (as many as a
 * shot has beats): its nodes' names are the storyboard's own, and their details are left out (a
 * drafted area's line counts: a shot draws numbers only from metric evidence). Nothing, so the
 * scene keeps its diagram, when a name is not a label (digits, symbols, too long), when it singles
 * out some nodes as changed or words an edge (a node carries no emphasis and a flow no words, and
 * Covi never discards either), when it has more nodes than a shot has elements, or when no edge
 * joins two of its nodes.
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
