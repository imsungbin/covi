import type { Span } from '../../timeline/cues.ts';
import type { DirectionElement } from '../../timeline/types.ts';
import { easeInOutCubic, lerp, rise, seg } from '../anim.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  type LayoutItem,
  overflows,
  rectOf,
} from '../components/types.ts';
import { el, fitText, place, svg } from '../dom.ts';
import {
  COMPARE_RISE,
  type CountSpan,
  compareLands,
  countProgress,
  deltaWindow,
  drawnShow,
  formatNumber,
  formatPercent,
  tickValue,
  valueCentering,
} from '../numbers.ts';
import { TEXT_FLOOR } from '../sizing.ts';

/*
 * A measured number, drawn: a counter (the value large, ticking from before to after), bars on one
 * scale, or the two values side by side. Every value and unit comes from the run's evidence and
 * every derived number is Covi's; all text is set as text. Sizes are fitted once, at mount, to the
 * widest value a count shows, and every frame is a pure function of the element's clock.
 */

type MetricElement = Extract<DirectionElement, { kind: 'metric' }>;

/** Sizes in design units: as large as fits, at least the floor while it fits there. */
interface Sizes {
  max: number;
  floor: number;
  /** What text too long to fit at the floor shrinks to rather than being cut off. */
  fallback: number;
}

/** The counter's value, in design units: as large as fits, and at least the floor while it fits. */
export const COUNTER_FONT = { max: 300, floor: 120, fallback: 48 } as const;
/** A compare's two values. */
const COMPARE_FONT = { max: 160, floor: 64, fallback: 36 } as const;
/** Bars' captions and values: body text, shrinking below its floor only to stay whole. */
const BARS_FALLBACK = 20;
/** The share of the bars' width their tracks keep beside the captions and values. */
const TRACK_SHARE = 0.35;

export function metric(e: MetricElement, ctx: ComponentContext, span: Span): Component {
  // The element's own beat is its count; `[0, 0]` means nothing counts.
  const count = span[1] > span[0] ? { t: span[0], seconds: span[1] - span[0] } : undefined;
  // Bars and a compare need the value before; one value alone is drawn as a counter.
  const show = drawnShow(e);
  if (show === 'bars' && e.from !== undefined) return bars(e, e.from, ctx, count);
  if (show === 'compare' && e.from !== undefined) return compare(e, e.from, ctx, count);
  return counter(e, ctx, count);
}

/** The card a metric is drawn on: its whole slot, its parts centered in it. */
function card(e: MetricElement, ctx: ComponentContext, className: string): HTMLDivElement {
  const box = el('div', `mcard ${className}`, ctx.root);
  place(box, e.rect);
  return box;
}

/**
 * The metric's name, set as text and fitted to the card's width on one line; one too long for
 * that at the floor wraps onto a second line rather than being cut short.
 */
function nameOf(e: MetricElement, box: HTMLElement, ctx: ComponentContext): HTMLDivElement {
  const name = el('div', 'mname', box, e.name);
  const style = getComputedStyle(box);
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const tall = ctx.timeline.orientation === 'vertical';
  const maxWidth = box.clientWidth - padding;
  fitText(name, { max: ctx.u(tall ? 48 : 44), min: ctx.u(TEXT_FLOOR.body), maxWidth });
  if (name.scrollWidth > maxWidth + 1) name.classList.add('wrap');
  return name;
}

/** The change in percent, Covi's, under the values; none without one. */
const deltaOf = (e: MetricElement, box: HTMLElement) =>
  e.delta === undefined ? undefined : el('div', 'mdelta', box, formatPercent(e.delta));

/** How a value is printed: its decimals, then its unit (`%` set close, a word after a space). */
const printer =
  (e: MetricElement, withUnit: boolean) =>
  (v: number): string => {
    const unit = withUnit && e.unit ? `${e.unit === '%' ? '' : ' '}${e.unit}` : '';
    return `${formatNumber(v, e.decimals)}${unit}`;
  };

/** Sizes in pixels. */
const scaled = (sizes: Sizes, u: (n: number) => number): Sizes => ({
  max: u(sizes.max),
  floor: u(sizes.floor),
  fallback: u(sizes.fallback),
});

/**
 * The largest size in [min, max], to half a pixel, at which `fits` holds once `apply` has set it;
 * `min` when none does.
 */
function largest(
  apply: (size: number) => void,
  fits: () => boolean,
  min: number,
  max: number,
): number {
  apply(max);
  if (fits()) return max;
  let lo = min;
  let hi = max;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    apply(mid);
    if (fits()) lo = mid;
    else hi = mid;
  }
  apply(lo);
  return lo;
}

/** The size that fits, up to `max`: at least the floor while it fits there, else the fallback. */
function fitSize(apply: (size: number) => void, fits: () => boolean, sizes: Sizes): number {
  const size = largest(apply, fits, sizes.floor, sizes.max);
  return fits() ? size : largest(apply, fits, sizes.fallback, sizes.floor);
}

/** Whether `fits` holds with each of `texts` set on `nodes`: a count shows none wider. */
const each = (nodes: readonly HTMLElement[], texts: readonly string[], fits: () => boolean) => () =>
  texts.every((text) => {
    for (const node of nodes) node.textContent = text;
    return fits();
  });

/** The used width of `nodes` with each of `texts` set, unrounded and untransformed, in pixels. */
function widthsOf(nodes: readonly HTMLElement[], texts: readonly string[]): number[] {
  return texts.map((text) => {
    for (const node of nodes) node.textContent = text;
    return Math.ceil((Number.parseFloat(getComputedStyle(nodes[0]!).width) || 0) * 100) / 100;
  });
}

/**
 * Holds `nodes` at the width of the widest of `texts`, so a count moves neither them nor what is
 * beside them: digits are tabular, so no value a count passes through is wider than its two ends.
 */
function holdWidth(nodes: readonly HTMLElement[], texts: readonly string[]): void {
  const widest = Math.max(...widthsOf(nodes, texts));
  for (const node of nodes) node.style.minWidth = `${widest}px`;
}

/** The value shown at `t`: ticking from `from` to `to` during a count, else `to`. */
function shownValue(e: MetricElement, from: number | undefined, t: number, count?: CountSpan) {
  return from === undefined || !count
    ? e.to
    : tickValue(from, e.to, countProgress(t, count), e.decimals);
}

/** A change's opacity at `t`: fading in over its window, or in with the card without one. */
const deltaOpacity = (t: number, window: readonly [number, number] | undefined) =>
  (window ? seg(t, ...window) : 1).toFixed(3);

/** A text box as QC reads it: body text, its size as drawn. */
const textItem = (node: HTMLElement): LayoutItem => ({
  role: 'text',
  rect: rectOf(node),
  overflow: overflows(node),
  font: drawnFont(node),
  text: 'body',
});

const visible = (node: HTMLElement) => Number.parseFloat(node.style.opacity || '1') > 0;

/** The change's text item, once it is on screen. */
const shownDelta = (delta: HTMLElement | undefined): LayoutItem[] =>
  delta && visible(delta) ? [textItem(delta)] : [];

function counter(e: MetricElement, ctx: ComponentContext, count?: CountSpan): Component {
  const u = ctx.u;
  const box = card(e, ctx, 'mcounter');
  const name = nameOf(e, box, ctx);
  const row = el('div', 'mrow', box);
  const value = el('span', 'mvalue', row);
  const unit = e.unit ? el('span', 'munit', row, e.unit) : undefined;
  const delta = deltaOf(e, box);
  // The unit is its own text beside the value.
  const print = printer(e, false);
  const printed = [...(e.from === undefined ? [] : [e.from]), e.to].map(print);
  fitSize(
    (size) => {
      row.style.fontSize = `${size}px`;
      // The unit stays body text however small the value has to be drawn.
      if (unit) unit.style.fontSize = `${Math.max(u(TEXT_FLOOR.body), 0.38 * size)}px`;
      if (delta) delta.style.fontSize = `${Math.max(u(36), 0.28 * size)}px`;
    },
    each(
      [value],
      printed,
      () =>
        row.scrollWidth <= row.clientWidth + 1 &&
        row.scrollHeight <= 0.55 * e.rect.height + 1 &&
        box.scrollHeight <= box.clientHeight + 1,
    ),
    scaled(COUNTER_FONT, u),
  );
  // Held at the widest value while it counts, then eased to the landed value's own width: its
  // digits are set to the right of the box, and the row is centered.
  const widths = widthsOf([value], printed);
  const widest = Math.max(...widths);
  const own = widths.at(-1)!;
  const centering = valueCentering(e, count);
  const fade = deltaWindow('counter', count);
  let shown = '';
  let held = '';
  return {
    update(clock) {
      const now = print(shownValue(e, e.from, clock.t, count));
      if (now !== shown) value.textContent = shown = now;
      const k = centering ? easeInOutCubic(seg(clock.t, ...centering)) : 1;
      const width = `${lerp(widest, own, k).toFixed(2)}px`;
      if (width !== held) value.style.minWidth = held = width;
      if (delta) delta.style.opacity = deltaOpacity(clock.t, fade);
    },
    report: () => [
      { role: 'media', rect: rectOf(box) },
      textItem(name),
      // The value's row at the value's size: what the largest-text checks read.
      { ...textItem(row), font: drawnFont(value) },
      ...(unit ? [textItem(unit)] : []),
      ...shownDelta(delta),
    ],
  };
}

function bars(e: MetricElement, from: number, ctx: ComponentContext, count?: CountSpan): Component {
  const u = ctx.u;
  const labels = ctx.timeline.labels;
  const box = card(e, ctx, 'mbars');
  const name = nameOf(e, box, ctx);
  // One grid for both rows, so the two tracks start and end together.
  const grid = el('div', 'mgrid', box);
  const row = (caption: string, tone: string) => {
    const cap = el('div', `mcap ${tone}`, grid, caption);
    const track = el('div', 'mtrack', grid);
    const fill = el('div', `mfill ${tone}`, track);
    const num = el('div', `mnum ${tone}`, grid);
    return { cap, track, fill, num };
  };
  const base = row(labels?.before ?? 'Before', 'base');
  const head = row(labels?.after ?? 'After', 'head');
  const delta = deltaOf(e, box);
  const print = printer(e, true);
  const printed = [from, e.to].map(print);
  const nums = [base.num, head.num];
  const most = u(ctx.timeline.orientation === 'vertical' ? 52 : 48);
  fitSize(
    (size) => {
      box.style.fontSize = `${size}px`;
    },
    each(
      nums,
      printed,
      () =>
        base.track.clientWidth >= TRACK_SHARE * grid.clientWidth &&
        box.scrollHeight <= box.clientHeight + 1,
    ),
    {
      max: Math.min(most, Math.max(u(TEXT_FLOOR.body), e.rect.height / 9)),
      floor: u(TEXT_FLOOR.body),
      fallback: u(BARS_FALLBACK),
    },
  );
  // The values' column fits the wider value, so a count never moves the tracks.
  holdWidth(nums, printed);
  // One scale for both: the larger magnitude fills the track.
  const scale = Math.max(Math.abs(from), Math.abs(e.to)) || 1;
  const width = (v: number) => `${((100 * Math.abs(v)) / scale).toFixed(3)}%`;
  base.fill.style.width = width(from);
  base.num.textContent = printed[0]!;
  const fade = deltaWindow('bars', count);
  let shown = '';
  return {
    update(clock) {
      // The bar moves smoothly; its number steps through printable values.
      const k = countProgress(clock.t, count);
      head.fill.style.width = width(k >= 1 ? e.to : from + (e.to - from) * k);
      const now = print(shownValue(e, from, clock.t, count));
      if (now !== shown) head.num.textContent = shown = now;
      if (delta) delta.style.opacity = deltaOpacity(clock.t, fade);
    },
    report: () => [
      { role: 'media', rect: rectOf(box) },
      textItem(name),
      ...[base, head].flatMap((r) => [textItem(r.cap), textItem(r.num)]),
      ...shownDelta(delta),
    ],
  };
}

function compare(
  e: MetricElement,
  from: number,
  ctx: ComponentContext,
  count?: CountSpan,
): Component {
  const u = ctx.u;
  const labels = ctx.timeline.labels;
  const box = card(e, ctx, 'mcompare');
  const name = nameOf(e, box, ctx);
  const pair = el('div', 'mpair', box);
  const side = (caption: string, tone: string) => {
    const s = el('div', `mside ${tone}`, pair);
    const cap = el('div', 'mcap', s, caption);
    const num = el('div', 'mnum', s);
    return { s, cap, num };
  };
  const base = side(labels?.before ?? 'Before', 'base');
  // A shape, not a glyph: the embedded font has no arrow, and a fallback face varies by machine.
  const arrow = el('div', 'marrow', pair);
  const icon = svg('svg', { viewBox: '0 0 48 24', 'aria-hidden': 'true' }, arrow);
  svg('path', { d: 'M3 12h40M31 3l12 9-12 9' }, icon);
  const head = side(labels?.after ?? 'After', 'head');
  const delta = deltaOf(e, box);
  const print = printer(e, true);
  const printed = [from, e.to].map(print);
  const nums = [base.num, head.num];
  fitSize(
    (size) => {
      for (const n of nums) n.style.fontSize = `${size}px`;
      // The arrow sits on the values' line, whatever their captions above them.
      const w = Math.max(u(48), 0.6 * size);
      arrow.style.height = `${(1.05 * size).toFixed(2)}px`;
      icon.style.width = `${w.toFixed(2)}px`;
      icon.style.height = `${(w / 2).toFixed(2)}px`;
      if (delta) delta.style.fontSize = `${Math.max(u(36), 0.45 * size)}px`;
    },
    each(
      nums,
      printed,
      () =>
        pair.scrollWidth <= pair.clientWidth + 1 &&
        base.num.scrollHeight <= 0.4 * e.rect.height + 1 &&
        box.scrollHeight <= box.clientHeight + 1,
    ),
    scaled(COMPARE_FONT, u),
  );
  holdWidth(nums, printed);
  base.num.textContent = printed[0]!;
  // The arrow comes in, then the after value lands: on its count, or COMPARE_LANDS in.
  const lands = compareLands(count);
  const fade = deltaWindow('compare', count);
  let shown = '';
  return {
    update(clock) {
      const t = clock.t;
      const now = print(shownValue(e, from, t, count));
      if (now !== shown) head.num.textContent = shown = now;
      arrow.style.opacity = seg(t, lands - COMPARE_RISE, lands).toFixed(3);
      rise(head.s, seg(t, lands, lands + COMPARE_RISE), u(24));
      if (delta) delta.style.opacity = deltaOpacity(t, fade);
    },
    report: () => [
      { role: 'media', rect: rectOf(box) },
      textItem(name),
      textItem(base.cap),
      textItem(base.num),
      // The after side is reported once it has begun to land.
      ...(visible(head.s) ? [textItem(head.cap), textItem(head.num)] : []),
      ...shownDelta(delta),
    ],
  };
}
