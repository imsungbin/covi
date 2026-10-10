import {
  decimalsOf,
  type EvidenceIndex,
  type EvidenceItem,
  escapeRegExp,
  evidenceId,
  METRIC_LIMITS,
  metricSource,
} from '@covi/core';
import { sceneEvidence } from '../grounding.ts';
import { formatNumber, percentChange } from '../runtime/numbers.ts';
import type { Orientation } from '../spec.ts';
import { findPhrase, parseEmphasis } from '../storyboard/grammar.ts';
import type { Scene } from '../storyboard/schema.ts';
import type { DirectionElement, Rect, TimelineLabels } from '../timeline/types.ts';
import { shown } from './echo.ts';
import type { Shot, ShotElement } from './schema.ts';
import { type MetricSource, terminalNumber } from './sources.ts';

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
export function sides(metric: MetricSource): string {
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
 * nothing when it can. That a count names a metric element, once, is `ACTS_ON`'s check; a side on
 * bars or a compare, which draw both, is `metricProblems`'.
 */
export function countProblem(
  element: MetricShotElement,
  metric: MetricSource | undefined,
): string | undefined {
  if (element.side && (element.show ?? 'counter') === 'counter')
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
export function metricName(metric: MetricSource, labels: Pick<TimelineLabels, 'stats'>): string {
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

/** A counter needs at least this many printable steps between its values to tick; fewer compare. */
export const COUNTER_STEPS = 10;

/** A value on a log scale that keeps its sign, so a change through zero spans both sides. */
const signedLog = (v: number) => Math.sign(v) * Math.log1p(Math.abs(v));

/**
 * How much a metric changed, for choosing the one to show: how many times larger or smaller its
 * magnitude became, each plus one (a fold change with a pseudocount), so `1 → 0` (one timeout
 * gone) does not outrank `70406 → 9907` (the request shrank sevenfold). A value that changes sign
 * travels through zero, so `−5 → 5` is a change, not none.
 */
export function metricChange(base: number, head: number): number {
  return Math.abs(signedLog(head) - signedLog(base));
}

/**
 * The metrics a terminal scene's command measured, in the registry's order: none for a scene that
 * shows no command. Read from what the scene shows, never from what it cites.
 */
export function commandMetrics(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
): EvidenceItem[] {
  if (scene.visual.kind !== 'terminal' || !evidence) return [];
  const prefixes = sceneEvidence({ visual: scene.visual }, evidence).flatMap((id) => {
    const n = terminalNumber(id);
    return n === undefined ? [] : [evidenceId.metric(metricSource.terminal(n), '')];
  });
  return evidence.items.filter(
    (item) => item.kind === 'metric' && prefixes.some((p) => item.id.startsWith(p)),
  );
}

/**
 * The metric among `items` that changed most between base and head (the earliest on a tie), or
 * nothing: none was measured at both revisions, or none changed.
 */
export function mostChanged(items: readonly EvidenceItem[]): EvidenceItem | undefined {
  let best: EvidenceItem | undefined;
  let most = 0;
  for (const item of items) {
    const m = item.metric;
    if (m?.base === undefined || m.head === undefined) continue;
    const change = metricChange(m.base, m.head);
    if (change > most) {
      best = item;
      most = change;
    }
  }
  return best;
}

/**
 * The metric a terminal scene's command measured that changed most (see `mostChanged`), or
 * nothing, also for a scene that shows no command. Read from what the scene shows, never from
 * what it cites.
 */
export function keyMetric(
  scene: Pick<Scene, 'visual'>,
  evidence: EvidenceIndex | undefined,
): EvidenceItem | undefined {
  return mostChanged(commandMetrics(scene, evidence));
}

/**
 * The default director's shot for a terminal scene with a key metric: the number beside the
 * output it came from (above it in a tall frame), counted so it lands as the narration names it,
 * or, when the change has too few steps to tick, revealed as a before/after comparison.
 */
export function metricShot(
  scene: Pick<Scene, 'visual' | 'narration'>,
  evidence: EvidenceIndex | undefined,
  orientation: Orientation,
): Pick<Shot, 'layout' | 'elements' | 'beats'> | undefined {
  const item = keyMetric(scene, evidence);
  const m = item?.metric;
  if (!item || m?.base === undefined || m.head === undefined) return undefined;
  const decimals = Math.min(
    METRIC_LIMITS.decimals,
    Math.max(decimalsOf(m.base), decimalsOf(m.head)),
  );
  // Printed values are whole steps apart; rounding keeps floating point (2.3 − 1.3 is
  // 0.9999999999999998) from losing one.
  const steps = Math.round(Math.abs(m.head - m.base) * 10 ** decimals);
  const show = steps >= COUNTER_STEPS ? 'counter' : 'compare';
  // Where the narration says it: its printed name, else its value as drawn or as printed.
  const text = parseEmphasis(scene.narration).text;
  const at =
    spoken(text, item.label, NAME_RUNS_ON) ??
    spoken(text, formatNumber(m.head, decimals), VALUE_RUNS_ON) ??
    spoken(text, String(m.head), VALUE_RUNS_ON);
  const elements: ShotElement[] = [
    { id: 'metric', kind: 'metric', evidence: item.id, show },
    { id: 'visual', kind: 'visual' },
  ];
  return {
    layout: orientation === 'vertical' ? 'column' : 'row',
    elements,
    beats: [
      show === 'counter'
        ? { verb: 'count', element: 'metric', ...(at ? { at } : {}) }
        : { verb: 'reveal', element: 'metric', style: 'pop', ...(at ? { at } : {}) },
    ],
  };
}

/** Whether the text around a phrase found at `[start, end)` runs on from it. */
type RunsOn = (text: string, start: number, end: number) => boolean;

const WORDLIKE = /[A-Za-z0-9]/;

/**
 * A name runs on into a letter or digit beside its own (`time` in `runtime`). ASCII only: a Korean
 * particle follows a word with no space (`bytes를`) and leaves it whole.
 */
const NAME_RUNS_ON: RunsOn = (text, start, end) =>
  (WORDLIKE.test(text.charAt(start)) && WORDLIKE.test(text.charAt(start - 1))) ||
  (WORDLIKE.test(text.charAt(end - 1)) && WORDLIKE.test(text.charAt(end)));

/**
 * A value runs on into a digit beside it, or into a separator that joins it to one: `9` in `19`
 * or `9,907`, `5` in `0.5`.
 */
const VALUE_RUNS_ON: RunsOn = (text, start, end) =>
  /\d/.test(text.charAt(start - 1)) ||
  (/[.,]/.test(text.charAt(start - 1)) && /\d/.test(text.charAt(start))) ||
  /\d/.test(text.charAt(end)) ||
  (/[.,]/.test(text.charAt(end)) && /\d/.test(text.charAt(end + 1)));

/**
 * The phrase as the narration says it, when the narration says it once (in any case) and as a
 * whole, not as part of another number or word: a beat pinned there lands as the narration says
 * the metric, not something else. Whitespace is quoted as one space, as the checks compare it.
 */
function spoken(text: string, phrase: string, runsOn: RunsOn): string | undefined {
  const words = phrase.split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  const pattern = new RegExp(words.map(escapeRegExp).join('\\s+'), 'giu');
  const found: RegExpExecArray[] = [];
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    found.push(m);
    // Overlapping occurrences count, as the checks count them.
    pattern.lastIndex = m.index + String.fromCodePoint(text.codePointAt(m.index)!).length;
  }
  const m = found.length === 1 ? found[0]! : undefined;
  if (!m || runsOn(text, m.index, m.index + m[0].length)) return undefined;
  const quoted = m[0].replace(/\s+/g, ' ');
  return findPhrase(text, quoted).count === 1 ? quoted : undefined;
}
