import type { DirectionElement, MetricShow } from '../timeline/types.ts';

/*
 * How a video draws and derives numbers, and when a metric's parts land. Covi's own formatting,
 * not `Intl`: the same digits on every machine and in every language Covi speaks (en, ko, ja, zh
 * all group thousands with commas and write a point for decimals). DOM-free: the runtime bundles
 * it, and Node times a scene's settled span with the same moments.
 */

type MetricElement = Extract<DirectionElement, { kind: 'metric' }>;

/** Without a count, a compare's after value lands this many seconds into its element's clock… */
export const COMPARE_LANDS = 0.6;
/** …rising into place over this long, after the arrow has come in over as long before it. */
export const COMPARE_RISE = 0.3;
/** A metric's change in percent fades in over this long, once its value has landed. */
export const DELTA_FADE = 0.3;
/**
 * A counted value is held at the widest value's width while it counts, so it never moves
 * sideways; once it has landed, its box eases to its own width over this long, so it ends centered.
 */
export const VALUE_CENTER = 0.3;

/** A value as drawn: digits grouped by three, `decimals` after the point, a real minus sign. */
export function formatNumber(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole = '0', fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';
  return `${sign}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/**
 * The change from `from` to `to` in percent, as Covi draws it: whole percents from 10% up, one
 * decimal below. Undefined when `from` is 0, where no percentage means anything.
 */
export function percentChange(from: number, to: number): number | undefined {
  if (from === 0) return undefined;
  const percent = ((to - from) / Math.abs(from)) * 100;
  const rounded = Math.abs(percent) >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  return rounded || 0;
}

/** A change in percent as drawn: `−86%`, `+4.5%`, `0%`. */
export function formatPercent(percent: number): string {
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(percent), Number.isInteger(percent) ? 0 : 1)}%`;
}

/** A count beat, in seconds of the clock its element is drawn with. */
export interface CountSpan {
  t: number;
  seconds: number;
}

/** How far a count has come at `t`, eased out: quick at first, settling onto the value. */
export function countProgress(t: number, count: CountSpan | undefined): number {
  if (!count) return 1;
  const k = Math.min(1, Math.max(0, (t - count.t) / Math.max(1e-6, count.seconds)));
  return 1 - (1 - k) ** 3;
}

/** The value a count shows `progress` (0–1) of the way from `from` to `to`, as printed. */
export function tickValue(from: number, to: number, progress: number, decimals: number): number {
  if (progress >= 1) return to;
  if (progress <= 0) return from;
  return Number((from + (to - from) * progress).toFixed(decimals)) || 0;
}

/** How a metric is drawn: bars and a compare need the value before, so one value alone counts. */
export function drawnShow(e: Pick<MetricElement, 'show' | 'from'>): MetricShow {
  return e.from === undefined ? 'counter' : e.show;
}

/** When a compare's after value lands, on its element's clock: as its count starts, if any. */
export function compareLands(count: CountSpan | undefined): number {
  return count ? count.t : COMPARE_LANDS;
}

/** When a metric's value has landed: its count's end, a compare's after value in, else at once. */
export function valueLanded(show: MetricShow, count: CountSpan | undefined): number {
  const end = count ? count.t + count.seconds : 0;
  return show === 'compare' ? Math.max(end, compareLands(count) + COMPARE_RISE) : end;
}

/**
 * When a metric's change in percent fades in, on its element's clock: once its value has landed.
 * None when nothing lands later (a counter or bars without a count): it comes in with the card.
 */
export function deltaWindow(
  show: MetricShow,
  count: CountSpan | undefined,
): readonly [number, number] | undefined {
  if (!count && show !== 'compare') return undefined;
  const at = valueLanded(show, count);
  return [at, at + DELTA_FADE];
}

/**
 * When a counter's value eases from the widest value's width to its own, on its element's clock:
 * once it has landed. None when nothing counts (it is drawn at its own width from the start), and
 * for bars and a compare, whose values keep their columns.
 */
export function valueCentering(
  e: Pick<MetricElement, 'show' | 'from'>,
  count: CountSpan | undefined,
): readonly [number, number] | undefined {
  if (!count || e.from === undefined || drawnShow(e) !== 'counter') return undefined;
  const at = valueLanded('counter', count);
  return [at, at + VALUE_CENTER];
}

/**
 * When all a metric draws is in place, on its element's clock: its value, then its change, and a
 * counted value centered.
 */
export function metricSettled(
  e: Pick<MetricElement, 'show' | 'from' | 'delta'>,
  count: CountSpan | undefined,
): number {
  const show = drawnShow(e);
  const fade = e.delta === undefined ? undefined : deltaWindow(show, count);
  const centering = valueCentering(e, count);
  return Math.max(fade ? fade[1] : valueLanded(show, count), centering ? centering[1] : 0);
}
