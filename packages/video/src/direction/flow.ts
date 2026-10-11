import type { EvidenceIndex } from '@covi/core';
import { EDGE_MIN, type NodeFanCount, nodeBoxRect } from '../runtime/routes.ts';
import type {
  ChangeSide,
  DirectionBeat,
  DirectionElement,
  Rect,
  TimelineLabels,
} from '../timeline/types.ts';
import { shown } from './echo.ts';
import { elementSlots } from './layout.ts';
import { metricName, sides } from './metric.ts';
import type { Shot, ShotBeat, ShotElement } from './schema.ts';
import { type DirectionSources, type MetricSource, UNKNOWN_EVIDENCE } from './sources.ts';

/*
 * Flow verbs in the direction file: which elements a beat names, what flows, splits, merges,
 * stacks, and count-ups may ask of a shot's elements, and the counts they draw, which come only
 * from metric evidence, so a direction can never state a number of its own.
 */

export type PileShotElement = Extract<ShotElement, { kind: 'pile' }>;
type FlowBeat = Extract<ShotBeat, { verb: 'flow' }>;
type SplitBeat = Extract<ShotBeat, { verb: 'split' }>;
type MergeBeat = Extract<ShotBeat, { verb: 'merge' }>;
type CountUpBeat = Extract<ShotBeat, { verb: 'count-up' }>;

/**
 * Every element a beat names, as written or resolved: its element, a camera's target, or a flow's
 * nodes and packet.
 */
export function beatTargets(beat: ShotBeat | DirectionBeat): string[] {
  if (beat.verb === 'camera') return [beat.to];
  if (beat.verb === 'flow')
    return [beat.from, beat.to, ...(beat.packet === undefined ? [] : [beat.packet])];
  return [beat.element];
}

/**
 * Slots for a shot's elements, aligned with them: each gets its slot for the shot's layout, except
 * a packet one of `beats` (the resolved ones, in time order) carries, which travels between nodes;
 * its box is the drawn box of the node its first flow leaves (`fans`: the split that fans out of
 * that node, which moves it). A packet whose trips were all left out takes a slot of
 * its own, as one no flow carries does, rather than rest on that node's name. In a shot that asks
 * for a flow, a node's slot keeps clear of the slots beside it, so that the edge between two nodes
 * side by side is at least `EDGE_MIN` long: a node's box fills a narrow slot, and the gap between
 * slots alone would leave an edge that its arrowhead all but covers. Its text, its split, and the
 * edges that join it are all laid out in that slot.
 */
export function flowSlots(
  shot: Pick<Shot, 'elements' | 'layout' | 'beats'>,
  beats: readonly DirectionBeat[],
  region: Rect,
  orientation: 'vertical' | 'landscape' | 'square',
  gap: number,
  unit: number,
  fans: ReadonlyMap<string, Pick<NodeFanCount, 'count' | 'rests'>> = new Map(),
): Rect[] {
  // The node each travelling packet leaves first.
  const leaves = new Map<string, string>();
  for (const b of beats)
    if (b.verb === 'flow' && b.packet !== undefined && !leaves.has(b.packet))
      leaves.set(b.packet, b.from);
  const placed = shot.elements.filter((e) => !leaves.has(e.id));
  const slots = elementSlots(
    placed.map((e) => e.kind),
    shot.layout ?? 'auto',
    region,
    orientation,
    gap,
  );
  const clear = shot.beats.some((b) => b.verb === 'flow')
    ? Math.max(0, (EDGE_MIN * unit - gap) / 2)
    : 0;
  const slotOf = new Map(
    placed.map((e, i) => [e.id, e.kind === 'node' ? inset(slots[i]!, clear) : slots[i]!]),
  );
  return shot.elements.map((e) => {
    const own = slotOf.get(e.id);
    if (own) return own;
    const from = leaves.get(e.id)!;
    const slot = slotOf.get(from);
    const fan = fans.get(from);
    return slot
      ? nodeBoxRect(slot, unit, orientation === 'vertical', fan?.count, fan?.rests)
      : region;
  });
}

/** `r` with `by` pixels taken off each side. */
const inset = (r: Rect, by: number): Rect => ({
  x: r.x + by,
  y: r.y + by,
  width: Math.max(0, r.width - 2 * by),
  height: Math.max(0, r.height - 2 * by),
});

/**
 * Why `metric`'s `side` cannot give a whole count of at least `min`, or nothing when it can: a
 * pile draws items (none is a count too), a split breaks into pieces (at least one).
 */
function countOn(
  id: string,
  metric: MetricSource,
  side: ChangeSide,
  min: number,
  what: string,
): string | undefined {
  const value = metric[side];
  if (value === undefined) return `side "${side}": "${shown(id)}" has only a ${sides(metric)}`;
  if (!Number.isInteger(value) || value < min)
    return `"${shown(id)}" is ${value} at ${side}; ${what}`;
  return undefined;
}

/** The sides a pile shows: the one it asks for, else each one its metric has. */
function pileSides(element: PileShotElement, metric: MetricSource): ChangeSide[] {
  if (element.side) return [element.side];
  return (['base', 'head'] as const).filter((side) => metric[side] !== undefined);
}

/** What a pile asks of its metric that the metric does not have, as problems. */
export function pileProblems(element: PileShotElement, metric: MetricSource): string[] {
  return pileSides(element, metric).flatMap((side) => {
    const problem = countOn(
      element.evidence,
      metric,
      side,
      0,
      'a pile draws a whole number of items, zero or more',
    );
    return problem ? [problem] : [];
  });
}

/**
 * What beat `index` of a shot asks of the elements it names that they cannot do, as problems:
 * a flow runs between two nodes and carries a packet from where it last arrived; a split breaks a
 * packet or a node into a measured, whole number of pieces; a merge pulls a split back together,
 * or collapses a pile; a count-up raises a counter to a side it shows. Each acts on an element
 * once. (A stack's element kind, and that it stacks once, `refs.ts` checks through `ACTS_ON`.)
 */
export function flowBeatProblems(
  shot: Pick<Shot, 'elements' | 'beats'>,
  index: number,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const beat = shot.beats[index]!;
  const before = shot.beats.slice(0, index);
  const kind = (id: string) => shot.elements.find((e) => e.id === id)?.kind;
  const again = (verb: ShotBeat['verb'], id: string) =>
    before.some((b) => b.verb === verb && 'element' in b && b.element === id);
  const once = (verb: string, id: string) =>
    `"${id}" already ${verb} at an earlier beat; it ${verb} once`;
  switch (beat.verb) {
    case 'flow': {
      const out: string[] = [];
      for (const end of [beat.from, beat.to])
        if (kind(end) !== 'node')
          out.push(`flow runs between nodes, and "${end}" is a ${kind(end)}`);
      if (beat.from === beat.to)
        out.push(`flow runs between two different nodes, and both ends are "${beat.from}"`);
      if (beat.packet !== undefined) {
        if (kind(beat.packet) !== 'packet')
          out.push(`flow carries a packet, and "${beat.packet}" is a ${kind(beat.packet)}`);
        const last = before.findLastIndex((b) => b.verb === 'flow' && b.packet === beat.packet);
        const arrived = last === -1 ? undefined : (before[last] as FlowBeat).to;
        if (arrived !== undefined && arrived !== beat.from)
          out.push(
            `"${beat.packet}" is at "${arrived}" after beat ${last + 1}; its next flow leaves from there`,
          );
      }
      return out;
    }
    case 'split': {
      const out: string[] = [];
      const k = kind(beat.element);
      if (k !== 'packet' && k !== 'node')
        out.push(`split breaks a packet or a node, and "${beat.element}" is a ${k}`);
      else if (again('split', beat.element)) out.push(once('splits', beat.element));
      out.push(...splitCountProblems(beat, evidence, sources));
      return out;
    }
    case 'merge': {
      const k = kind(beat.element);
      if (k !== 'pile' && k !== 'packet' && k !== 'node')
        return [`merge collapses a split or a pile, and "${beat.element}" is a ${k}`];
      if (k !== 'pile' && !again('split', beat.element))
        return [
          `merge pulls a split back together, and nothing splits "${beat.element}" before it`,
        ];
      return again('merge', beat.element) ? [once('merges', beat.element)] : [];
    }
    case 'count-up':
      return countUpProblems(beat, shot, again('count-up', beat.element), sources);
    default:
      return [];
  }
}

/** What a split's count cannot give: it cites a metric with a whole count of at least one. */
function splitCountProblems(
  beat: SplitBeat,
  evidence: EvidenceIndex | undefined,
  sources: DirectionSources,
): string[] {
  const item = evidence?.find(beat.count);
  if (!item) return [`cites "${shown(beat.count)}", ${UNKNOWN_EVIDENCE}`];
  if (item.kind !== 'metric')
    return [`split counts a metric: item, and "${shown(beat.count)}" is a ${item.kind}`];
  // A metric item always carries its values (the registry's schema), so it has a source.
  const metric = sources.metric(beat.count);
  const problem =
    metric &&
    countOn(
      beat.count,
      metric,
      beat.side,
      1,
      'a split breaks into a whole number of pieces, one or more',
    );
  return problem ? [problem] : [];
}

/**
 * What a count-up cannot do: it raises a counter (a metric element shown as one) from zero to a
 * side of its metric, once, ending on the value the counter shows: its one side, or, when it
 * shows both, the base value a count then ticks from, else the head value.
 */
function countUpProblems(
  beat: CountUpBeat,
  shot: Pick<Shot, 'elements' | 'beats'>,
  twice: boolean,
  sources: DirectionSources,
): string[] {
  const e = shot.elements.find((x) => x.id === beat.element);
  if (e?.kind !== 'metric')
    return [`count-up counts a metric up, and "${beat.element}" is a ${e?.kind}`];
  if ((e.show ?? 'counter') !== 'counter')
    return [`count-up counts up a counter, and "${e.id}" shows "${e.show}"`];
  if (twice) return [`"${e.id}" already counts up at an earlier beat; it counts up once`];
  const metric = sources.metric(e.evidence);
  // A metric the run does not have is the element's own problem, reported with it.
  if (!metric) return [];
  if (metric[beat.side] === undefined)
    return [`side "${beat.side}": "${shown(e.evidence)}" has only a ${sides(metric)}`];
  const both = !e.side && metric.base !== undefined && metric.head !== undefined;
  const shows = e.side ?? (both ? undefined : metric.head !== undefined ? 'head' : 'base');
  if (shows && beat.side !== shows)
    return [`"${e.id}" shows its ${shows} value; count up to side "${shows}"`];
  const counts = shot.beats.some((b) => b.verb === 'count' && b.element === e.id);
  if (both && counts && beat.side !== 'base')
    return [
      `"${e.id}" counts from its base value; count up to side "base", where the count starts`,
    ];
  if (both && !counts && beat.side !== 'head')
    return [`"${e.id}" shows its head value; count up to side "head"`];
  return [];
}

/** A pile as the video draws it: a row per side it shows, each a whole count; nothing without one. */
export function resolvePile(
  e: PileShotElement,
  metric: MetricSource | undefined,
  rect: Rect,
  labels: Pick<TimelineLabels, 'stats'>,
): Extract<DirectionElement, { kind: 'pile' }> | undefined {
  if (!metric) return undefined;
  const rows = pileSides(e, metric).flatMap((side) => {
    const count = metric[side];
    return count !== undefined && Number.isInteger(count) && count >= 0 ? [{ side, count }] : [];
  });
  if (!rows.length) return undefined;
  return { id: e.id, kind: 'pile', rect, name: e.label ?? metricName(metric, labels), rows };
}

/** A split's pieces: the metric's whole count on its side, and what the output called it. */
export function splitCount(
  beat: SplitBeat,
  metric: MetricSource | undefined,
  labels: Pick<TimelineLabels, 'stats'>,
): { count: number; name: string } | undefined {
  const count = metric?.[beat.side];
  if (!metric || count === undefined || !Number.isInteger(count) || count < 1) return undefined;
  return { count, name: metricName(metric, labels) };
}

/**
 * What a merge pulls a split back into, as the video captions it: one, when the split's metric
 * measured exactly one on its other side (four chunks before, one after); else nothing to say.
 */
export function mergeInto(
  beat: MergeBeat,
  shot: Pick<Shot, 'beats'>,
  sources: DirectionSources,
  labels: Pick<TimelineLabels, 'stats'>,
): { count: 1; name: string; side: ChangeSide } | undefined {
  const split = shot.beats.find(
    (b): b is SplitBeat => b.verb === 'split' && b.element === beat.element,
  );
  const metric = split && sources.metric(split.count);
  if (!split || !metric) return undefined;
  const side = split.side === 'base' ? 'head' : 'base';
  return metric[side] === 1 ? { count: 1, name: metricName(metric, labels), side } : undefined;
}

/** The value a count-up ends on: its side of the counter's metric. */
export function countUpValue(
  beat: CountUpBeat,
  shot: Pick<Shot, 'elements'>,
  sources: DirectionSources,
): number | undefined {
  const e = shot.elements.find((x) => x.id === beat.element);
  return e?.kind === 'metric' ? sources.metric(e.evidence)?.[beat.side] : undefined;
}
