import { decimalsOf, evidenceId, METRIC_LIMITS, metricSource } from '@covi/core';
import { percentChange } from '../runtime/numbers.ts';
import type { DirectionElement, Rect, TimelineLabels } from '../timeline/types.ts';
import { shown } from './echo.ts';
import type { ShotElement } from './schema.ts';
import type { MetricSource } from './sources.ts';

/*
 * Metric elements: what a shot may ask of a measured number, and the number as the video draws it.
 * Values and units come from the run's evidence; the change in percent is Covi's.
 */

export type MetricShotElement = Extract<ShotElement, { kind: 'metric' }>;

/**
 * A change of a hundredfold or more says more as its two values than as a percentage, whose digits
 * would outgrow the card.
 */
const DELTA_MAX = 10_000;

/** The sides a metric has, as a message names them: `a head value`, `a base and a head value`. */
function sides(metric: MetricSource): string {
  const has = [
    ...(metric.base === undefined ? [] : ['base']),
    ...(metric.head === undefined ? [] : ['head']),
  ];
  return `${has.join(' and ')} value`;
}

/** Bars are lengths from zero on one scale: a value that changes sign has no such pair. */
const changesSign = (metric: MetricSource) =>
  metric.base !== undefined && metric.head !== undefined && metric.base * metric.head < 0;

/** What a metric element asks of its metric that the metric does not have, as problems. */
export function metricProblems(element: MetricShotElement, metric: MetricSource): string[] {
  const out: string[] = [];
  const cited = shown(element.evidence);
  const show = element.show ?? 'counter';
  const both = metric.base !== undefined && metric.head !== undefined;
  if (show !== 'counter' && element.side)
    out.push(`show "${show}" draws both sides; leave "side" out`);
  else if (element.side && metric[element.side] === undefined)
    out.push(`side "${element.side}": "${cited}" has only a ${sides(metric)}`);
  if (show !== 'counter' && !both)
    out.push(
      `show "${show}" needs a base and a head value, and "${cited}" has only a ${sides(metric)}`,
    );
  else if (show === 'bars' && changesSign(metric))
    out.push(
      `show "bars" draws both values as lengths from zero, and "${cited}" changes sign; show "compare" or "counter"`,
    );
  return out;
}

/**
 * Why a `count` beat cannot tick a metric element from its base value to its head value, or
 * nothing when it can. That a count names a metric element, once, is `ACTS_ON`'s check.
 */
export function countProblem(
  element: MetricShotElement,
  metric: MetricSource | undefined,
): string | undefined {
  if (element.side)
    return `count ticks from base to head, and "${element.id}" shows only its ${element.side} side`;
  if (metric && (metric.base === undefined || metric.head === undefined))
    return `count needs a base and a head value, and "${shown(element.evidence)}" has only a ${sides(metric)}`;
  return undefined;
}

/** The diff's totals carry Covi's own words for them, which the video says in its language. */
const DIFF_TOTALS = new Map<string, keyof TimelineLabels['stats']>([
  [evidenceId.metric(metricSource.diff(), 'files'), 'files'],
  [evidenceId.metric(metricSource.diff(), 'additions'), 'added'],
  [evidenceId.metric(metricSource.diff(), 'deletions'), 'removed'],
]);

/**
 * What a metric is called on screen: the diff's totals in the video's words, else what the output
 * printed.
 */
function metricName(metric: MetricSource, labels: Pick<TimelineLabels, 'stats'>): string {
  const total = DIFF_TOTALS.get(metric.id);
  return total ? labels.stats[total] : metric.name;
}

/**
 * A metric element as the video draws it: a counter shows its one side, or ticks from base to head
 * when the metric has both; bars and compare show both. Nothing when the metric lacks what the
 * element shows, or its bars would cross zero (a validated direction never does). The change in
 * percent is left out from zero, and when it is too large to read as one.
 */
export function resolveMetric(
  e: MetricShotElement,
  metric: MetricSource | undefined,
  rect: Rect,
  labels: Pick<TimelineLabels, 'stats'>,
): Extract<DirectionElement, { kind: 'metric' }> | undefined {
  if (!metric) return undefined;
  const show = e.show ?? 'counter';
  const both = metric.base !== undefined && metric.head !== undefined;
  let from: number | undefined;
  let to: number | undefined;
  if (show !== 'counter') {
    if (!both || (show === 'bars' && changesSign(metric))) return undefined;
    from = metric.base;
    to = metric.head;
  } else if (e.side) to = metric[e.side];
  else if (both) {
    from = metric.base;
    to = metric.head;
  } else to = metric.head ?? metric.base;
  if (to === undefined) return undefined;
  const decimals = Math.min(
    METRIC_LIMITS.decimals,
    Math.max(decimalsOf(to), from === undefined ? 0 : decimalsOf(from)),
  );
  const change = from === undefined ? undefined : percentChange(from, to);
  const delta = change !== undefined && Math.abs(change) < DELTA_MAX ? change : undefined;
  return {
    id: e.id,
    kind: 'metric',
    rect,
    show,
    name: e.label ?? metricName(metric, labels),
    ...(metric.unit ? { unit: metric.unit } : {}),
    ...(from === undefined ? {} : { from }),
    to,
    decimals,
    ...(delta === undefined ? {} : { delta }),
  };
}
