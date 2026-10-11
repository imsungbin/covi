import type { DirectionBeat, DirectionElement, Point, Rect } from '../timeline/types.ts';

/*
 * Where flows travel and piles stack: edge routes between node boxes, a packet's place along
 * them, a split's fan and the node it fans out of, and a pile's grid. Pure and DOM-free, so the
 * runtime draws with them, the camera follows with them, and Node checks and tests them.
 */

// `anim.ts` has these too, but it carries DOM types, and Node and tests/ import this file.
const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Items a pile or a split draws at most; the number beside them is the true count. */
export const DRAWN_ITEMS = 12;
/** Items in one line of a pile or a fan. */
export const PER_LINE = 6;
/** The smallest a pile's items are drawn, in design units: smaller, they read as dots. */
export const PILE_ITEM_MIN = 24;
/** How wide an edge is drawn, in design units. */
export const EDGE_STROKE = 4;
/** An edge's arrowhead, in design units… */
export const ARROW_HEAD = 18;
/**
 * …and the shortest edge between two nodes a flow joins: three arrowheads, so the dot that
 * travels it is seen to move, not covered by the arrowhead it arrives at.
 */
export const EDGE_MIN = 3 * ARROW_HEAD;

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * A node's or a label's box in its slot, as the runtime draws it: centered, at most 520 × 170
 * design units (760 × 220 on tall frames).
 */
export function textBoxRect(slot: Rect, unit: number, tall: boolean): Rect {
  const width = Math.min(slot.width, (tall ? 760 : 520) * unit);
  const height = Math.min(slot.height, (tall ? 220 : 170) * unit);
  return {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  };
}

/**
 * The path an edge takes from box `a` to box `b`, border to border: straight across when the
 * boxes share a row or a column, else with one elbow (out of `a`'s side that faces `b`, along to
 * above or below `b`'s center, then into `b`). Boxes that overlap join center to center.
 */
export function edgeRoute(a: Rect, b: Rect): Point[] {
  const ca = center(a);
  const cb = center(b);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const row = bottom > top;
  const column = right > left;
  if (row && column) return [ca, cb];
  if (row) {
    const y = (top + bottom) / 2;
    return cb.x > ca.x
      ? [
          { x: a.x + a.width, y },
          { x: b.x, y },
        ]
      : [
          { x: a.x, y },
          { x: b.x + b.width, y },
        ];
  }
  if (column) {
    const x = (left + right) / 2;
    return cb.y > ca.y
      ? [
          { x, y: a.y + a.height },
          { x, y: b.y },
        ]
      : [
          { x, y: a.y },
          { x, y: b.y + b.height },
        ];
  }
  return [
    { x: cb.x > ca.x ? a.x + a.width : a.x, y: ca.y },
    { x: cb.x, y: ca.y },
    { x: cb.x, y: cb.y > ca.y ? b.y : b.y + b.height },
  ];
}

export function routeLength(route: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++)
    length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  return length;
}

/** The point `k` (0–1) of the way along a route, by distance. */
export function pointAlong(route: readonly Point[], k: number): Point {
  let left = clamp(k) * routeLength(route);
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= length || i === route.length - 1) {
      const f = length ? Math.min(1, left / length) : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= length;
  }
  return route[0]!;
}

/** The triangle of an arrowhead `size` long at a route's end, pointing the way it arrives. */
export function arrowHead(route: readonly Point[], size: number): Point[] {
  const tip = route.at(-1)!;
  const from = route.at(-2) ?? tip;
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const dx = (tip.x - from.x) / length;
  const dy = (tip.y - from.y) / length;
  const back = { x: tip.x - dx * size, y: tip.y - dy * size };
  const half = size * 0.6;
  return [
    tip,
    { x: back.x - dy * half, y: back.y + dx * half },
    { x: back.x + dy * half, y: back.y - dx * half },
  ];
}

/** A packet's trip along one edge: from `t` (seconds) for `seconds`. */
export interface Leg {
  t: number;
  seconds: number;
  route: readonly Point[];
}

/** How far through a trip a packet is at `t`, eased in and out. */
export function legProgress(leg: Pick<Leg, 't' | 'seconds'>, t: number): number {
  return easeInOutCubic(clamp((t - leg.t) / Math.max(leg.seconds, 1e-6)));
}

/**
 * Where a packet's center is at `t`: at the start of its first trip before it leaves, along each
 * trip as it travels, and where the last one ended after it arrives. Without trips, at `rest`.
 */
export function legPoint(legs: readonly Leg[], t: number, rest: Point): Point {
  if (!legs.length) return rest;
  let at = legs[0]!.route[0]!;
  for (const leg of legs) {
    if (t < leg.t) break;
    at = pointAlong(leg.route, legProgress(leg, t));
  }
  return at;
}

/** A split's pieces: their size, and their centers' offsets from the source's center. */
export interface Fan {
  width: number;
  height: number;
  offsets: Point[];
}

/**
 * Where the pieces of a split sit when it has fanned out: at most twelve, in lines of up to six,
 * each a little smaller than `source` (a packet), the lines shrunk to fit `room` px wide, centered
 * on their origin (`drop` 0), or fanned out `drop` px below it.
 */
export function fanOut(
  count: number,
  source: { width: number; height: number },
  room: number,
  drop: number,
): Fan {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const columns = Math.max(1, Math.min(n, PER_LINE));
  const lines = Math.ceil(n / columns);
  const step = 1.3;
  const fit = Math.min(1, room / (source.width * 0.6 * (step * (columns - 1) + 1)));
  const width = source.width * 0.6 * fit;
  const height = source.height * 0.7 * fit;
  const offsets = Array.from({ length: n }, (_, i) => {
    const line = Math.floor(i / columns);
    const inLine = Math.min(columns, n - line * columns);
    const x = ((i % columns) - (inLine - 1) / 2) * width * step;
    const y =
      drop > 0 ? drop + height * (0.5 + 1.5 * line) : (line - (lines - 1) / 2) * height * 1.5;
    return { x, y };
  });
  return { width, height, offsets };
}

/** A fan's pieces `k` (0–1) of the way from `origin` to fanned out, as the runtime draws them. */
export function fanBoxes(fan: Fan, origin: Point, k: number): Rect[] {
  return fan.offsets.map((o) => ({
    x: origin.x + o.x * k - fan.width / 2,
    y: origin.y + o.y * k - fan.height / 2,
    width: fan.width,
    height: fan.height,
  }));
}

/** A packet's pill, in design units: its height (taller on tall frames), and its widths. */
const PILL = { height: 64, tallHeight: 72, least: 150, most: 420 } as const;

/** How tall a packet's pill is drawn. */
export function pillHeight(unit: number, tall: boolean): number {
  return (tall ? PILL.tallHeight : PILL.height) * unit;
}

/** The widths a packet's pill is drawn between, as wide as its label: in `slot`, at most its width. */
export function pillWidths(slot: Rect, unit: number): { least: number; most: number } {
  const most = Math.min(slot.width, PILL.most * unit);
  return { least: Math.min(most, PILL.least * unit), most };
}

/** How much room a fan's pieces cover around its origin. */
function extent(fan: Fan): { width: number; height: number } {
  if (!fan.offsets.length) return { width: 0, height: 0 };
  const xs = fan.offsets.map((o) => o.x);
  const ys = fan.offsets.map((o) => o.y);
  return {
    width: Math.max(...xs) - Math.min(...xs) + fan.width,
    height: Math.max(...ys) - Math.min(...ys) + fan.height,
  };
}

/** A split laid out in a slot: the box it fans out of, its pieces fanned out, and its count. */
export interface SplitLayout {
  box: Rect;
  /**
   * Where the pieces come out and merge back into: the middle of the box's side facing them, or,
   * for a packet's pieces, just past it (and past where the packet rests), so they never cross the
   * packet's label.
   */
  origin: Point;
  /** The pieces fanned out: their size, and their centers' offsets from `origin`. */
  fan: Fan;
  /** The room the count's caption is fitted to. */
  caption: Rect;
  /**
   * The count sits beside the pieces (at the left of its room, level with them), else under them
   * (centered across its room, at its top).
   */
  beside: boolean;
}

/** A split's sizes, in design units. */
const SPLIT = {
  /** Its pieces are a packet's, whatever the node's size. */
  piece: { width: 150, height: 64 },
  /** Between the box, the pieces, and the count. */
  gap: 16,
  /** Kept clear inside the slot's sides. */
  margin: 16,
  /** The least a box is cut to: two lines of a label at the body floor, and its padding… */
  box: 96,
  /** …and narrowed to, beside its pieces. */
  boxWidth: 280,
  /** The count's room: its side above its name, on two lines at most, beside the number. */
  caption: { width: 380, height: 120 },
  /** The least width the count gets beside the pieces. */
  captionMin: 160,
  /** The share of their size pieces are drawn at in a slot with room for no arrangement. */
  scale: 0.25,
} as const;

/**
 * Where a packet that splits against a node rests: on the node box's side where the trip that
 * brought it ends (or where the trip that takes it on starts), as the runtime routes edges
 * (`edgeRoute`), a pill at most `width` wide.
 */
export interface Resting {
  /** The box of the node at the other end of that trip. */
  other: Rect;
  /** It arrived by that trip, else it waits for it to leave. */
  arrives: boolean;
  /** The widest its pill is drawn. */
  width: number;
}

/**
 * Where a node that splits into `count` pieces is drawn in its slot, so that neither its pieces
 * nor its count cover its box (and its label) or leave the slot. Of three arrangements, the one
 * that shows the pieces largest (the first on a tie): under the box with the count under them (a
 * tall slot), under the box with the count beside them (a shorter one), or to the right of the box
 * with the count beside them (a wide, short slot, such as a column's). Under the box, the box
 * takes the top of the slot, cut down toward two lines of label if the pieces need the room;
 * beside it, the box stays where it is unsplit unless the pieces need the room, and then moves
 * left. The pieces shrink to the room they have. In a slot with room for none of them, the box
 * gives way to small pieces under it (see `arrangedSplit`, which the resolver asks first).
 *
 * When the split is a packet's that `rests` against the node, its pieces come out past the box
 * and keep off the pill and its label. Known where it rests (`Resting`), an arrangement is kept
 * only if no piece meets the pill as it fans out, nor the count's room, and neither meets the leg
 * of the trip that brings the pill to the box (or takes it on), which is drawn under them; under
 * the box, the pieces may also go half a pill's height lower, past a pill on its bottom side.
 * Where it rests is not known (`true`: the trip's other node also has a packet resting against
 * it, whose box moves with its own pill), the pieces go under the box only, half a pill's height
 * lower, which keeps off a pill resting anywhere on the box's sides or on its middle.
 */
export function splitLayout(
  slot: Rect,
  unit: number,
  tall: boolean,
  count: number,
  rests: boolean | Resting = false,
): SplitLayout {
  const { best, squeezed } = splitArrangements(
    slot,
    unit,
    count,
    nodeSplitting(slot, unit, tall, rests),
  );
  return best ?? squeezed();
}

/**
 * `splitLayout`'s arrangement when the slot has room for one, else nothing: a direction never
 * splits there (its split is left out), so its pieces never cover the node's label.
 */
export function arrangedSplit(
  slot: Rect,
  unit: number,
  tall: boolean,
  count: number,
  rests: boolean | Resting = false,
): SplitLayout | undefined {
  return splitArrangements(slot, unit, count, nodeSplitting(slot, unit, tall, rests)).best;
}

/**
 * Where a packet that splits in its own slot (no node to rest against) is drawn, its pill
 * `width` wide (at most its widest there, as the resolver measures it): laid out as a node's
 * split is, the pill for the box, which keeps its size (its label is measured), centered in the
 * slot and moved up, or left, to make room. Its pieces come out past the pill's side, so they
 * never cross its label, and the pill rests there for the whole shot. A slot shorter than the pill
 * has no arrangement; in a slot with room for none, the pill keeps the slot's top and its small
 * pieces go under it.
 */
export function packetSplit(
  slot: Rect,
  unit: number,
  tall: boolean,
  count: number,
  width = pillWidths(slot, unit).most,
): SplitLayout {
  const { best, squeezed } = splitArrangements(
    slot,
    unit,
    count,
    pillSplitting(slot, unit, tall, width),
  );
  return best ?? squeezed();
}

/**
 * `packetSplit`'s arrangement for the widest pill its slot draws, when the slot has room for one,
 * else nothing: a direction never splits it there (its split is left out). A pill as wide as its
 * label is narrower, so it has room too.
 */
export function arrangedPacketSplit(
  slot: Rect,
  unit: number,
  tall: boolean,
  count: number,
): SplitLayout | undefined {
  return splitArrangements(
    slot,
    unit,
    count,
    pillSplitting(slot, unit, tall, pillWidths(slot, unit).most),
  ).best;
}

/** What a split fans out of, for `splitArrangements`. */
interface Splitting {
  /** The box at its full size, centered in the slot. */
  whole: Rect;
  /** A pill keeps its size; a node's box is cut and narrowed to make room. */
  fixed: boolean;
  /** Half the height of a packet resting against the box, when one does; else 0. */
  clear: number;
  /**
   * For a given box, where that pill is, at its widest, and the leg of its trip that meets the
   * box, as wide as the edge is drawn: unknown, the pill may be anywhere on its sides.
   */
  resting?: (box: Rect) => Rect[];
}

function nodeSplitting(
  slot: Rect,
  unit: number,
  tall: boolean,
  rests: boolean | Resting,
): Splitting {
  const whole = textBoxRect(slot, unit, tall);
  if (rests === false) return { whole, fixed: false, clear: 0 };
  const height = pillHeight(unit, tall);
  if (rests === true) return { whole, fixed: false, clear: height / 2 };
  const { other, arrives, width } = rests;
  const half = (EDGE_STROKE / 2) * unit;
  return {
    whole,
    fixed: false,
    clear: height / 2,
    resting(box) {
      const route = arrives ? edgeRoute(other, box) : edgeRoute(box, other);
      const [at, far] = arrives ? [route.at(-1)!, route.at(-2)!] : [route[0]!, route[1]!];
      return [
        { x: at.x - width / 2, y: at.y - height / 2, width, height },
        {
          x: Math.min(at.x, far.x) - half,
          y: Math.min(at.y, far.y) - half,
          width: Math.abs(far.x - at.x) + 2 * half,
          height: Math.abs(far.y - at.y) + 2 * half,
        },
      ];
    },
  };
}

function pillSplitting(slot: Rect, unit: number, tall: boolean, width: number): Splitting {
  const height = pillHeight(unit, tall);
  return {
    whole: {
      x: slot.x + (slot.width - width) / 2,
      y: slot.y + (slot.height - height) / 2,
      width,
      height,
    },
    fixed: true,
    clear: 0,
  };
}

/** Whether boxes `a` and `b` both lie wholly on one side of `r`: so does every box between them. */
function sameSide(a: Rect, b: Rect, r: Rect): boolean {
  const e = 1e-9;
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  return (
    (a.y >= bottom - e && b.y >= bottom - e) ||
    (a.y + a.height <= r.y + e && b.y + b.height <= r.y + e) ||
    (a.x >= right - e && b.x >= right - e) ||
    (a.x + a.width <= r.x + e && b.x + b.width <= r.x + e)
  );
}

/**
 * A layout whose pieces keep off each of `boxes` from where they come out to fanned out (they
 * move in a straight line, so the poses between keep to the same side) and whose count's room
 * does too.
 */
function keepsOff(l: SplitLayout, boxes: readonly Rect[]): boolean {
  const from = fanBoxes(l.fan, l.origin, 0);
  const to = fanBoxes(l.fan, l.origin, 1);
  return boxes.every(
    (r) => sameSide(l.caption, l.caption, r) && from.every((a, i) => sameSide(a, to[i]!, r)),
  );
}

/** A split's best arrangement in its slot, if any has room, and the one when none has. */
function splitArrangements(
  slot: Rect,
  unit: number,
  count: number,
  { whole, fixed, clear, resting }: Splitting,
): { best: SplitLayout | undefined; squeezed: () => SplitLayout } {
  const u = (n: number) => n * unit;
  // A packet's pieces come out past the box (and the pill resting across it), off its label.
  const past = fixed || clear > 0;
  const gap = u(SPLIT.gap);
  const margin = u(SPLIT.margin);
  const wide = slot.width - 2 * margin;
  const piece = { width: u(SPLIT.piece.width), height: u(SPLIT.piece.height) };
  const captionHeight = Math.min(u(SPLIT.caption.height), slot.height);
  const boxMin = fixed ? whole.height : Math.min(u(SPLIT.box), whole.height);
  const boxWidth = fixed ? whole.width : u(SPLIT.boxWidth);
  // How tall the pieces' lines are at full size, before any fitting to a width.
  const lines = Math.ceil(Math.min(Math.max(0, Math.floor(count)), DRAWN_ITEMS) / PER_LINE);
  const tallest = lines ? piece.height * 0.7 * (1.5 * (lines - 1) + 1) : 0;
  /** The pieces at most `height` tall and `width` wide. */
  const fanned = (width: number, height: number) => {
    const k = tallest ? Math.min(1, height / tallest) : 1;
    return fanOut(count, { width: piece.width * k, height: piece.height * k }, width, 0);
  };
  /** A layout's pieces as a share of their full size. */
  const shown = (l: SplitLayout) => (l.fan.offsets.length ? l.fan.width / (0.6 * piece.width) : 1);
  /** The layout with the pieces' block centered at `at`. */
  const laid = (box: Rect, origin: Point, fan: Fan, at: Point, caption: Rect, beside: boolean) => ({
    box,
    origin,
    fan: {
      ...fan,
      offsets: fan.offsets.map((o) => ({ x: o.x + at.x - origin.x, y: o.y + at.y - origin.y })),
    },
    caption,
    beside,
  });

  /** The arrangements with `clear` kept between the box and the pieces under it. */
  const arrange = (clear: number, right: boolean): SplitLayout[] => {
    const candidates: SplitLayout[] = [];
    /** Where pieces come out under a box whose bottom middle is `bottom`. */
    const under = (bottom: Point, fan: Fan) =>
      past ? { x: bottom.x, y: bottom.y + clear + fan.height / 2 } : bottom;

    // Under the box, the count under the pieces.
    const room = slot.height - 2 * gap - clear - captionHeight;
    const height = Math.min(
      whole.height,
      Math.max(boxMin, room - extent(fanned(wide, tallest)).height),
    );
    if (room - height > 0) {
      const fan = fanned(wide, room - height);
      const block = extent(fan).height;
      const top =
        slot.y +
        Math.max(0, (slot.height - (height + 2 * gap + clear + block + captionHeight)) / 2);
      const bottom = { x: whole.x + whole.width / 2, y: top + height };
      const below = bottom.y + clear;
      const caption = { x: slot.x + margin, y: below + 2 * gap + block, width: wide };
      candidates.push(
        laid(
          { ...whole, y: top, height },
          under(bottom, fan),
          fan,
          { x: bottom.x, y: below + gap + block / 2 },
          { ...caption, height: captionHeight },
          false,
        ),
      );
    }

    // Under the box, the count beside the pieces: a row as tall as the count.
    const rowCaption = Math.min(u(SPLIT.caption.width), 0.45 * wide);
    const rowBox = Math.min(whole.height, slot.height - gap - clear - captionHeight);
    if (rowBox >= boxMin && rowCaption >= u(SPLIT.captionMin)) {
      const across = wide - gap - rowCaption;
      const top = slot.y + (slot.height - (rowBox + gap + clear + captionHeight)) / 2;
      const bottom = { x: whole.x + whole.width / 2, y: top + rowBox };
      const row = bottom.y + clear + gap;
      // The pieces end where the count starts.
      const fan = fanned(across, captionHeight);
      candidates.push(
        laid(
          { ...whole, y: top, height: rowBox },
          under(bottom, fan),
          fan,
          { x: slot.x + margin + across - extent(fan).width / 2, y: row + captionHeight / 2 },
          { x: slot.x + margin + across + gap, y: row, width: rowCaption, height: captionHeight },
          true,
        ),
      );
    }

    // To the right of the box, the count beside the pieces. The box stays where it is unsplit
    // while that leaves room for the pieces at half their size; else it moves left, then narrows.
    const end = slot.x + slot.width - margin;
    const need =
      2 * gap + u(SPLIT.caption.width) + 0.5 * extent(fanned(Infinity, slot.height)).width;
    const short = need - (end - (whole.x + whole.width));
    const move = Math.max(0, Math.min(short, whole.x - (slot.x + margin)));
    const narrow = Math.max(0, Math.min(short - move, whole.width - boxWidth));
    const box = { ...whole, x: whole.x - move, width: whole.width - narrow };
    const side = { x: box.x + box.width, y: box.y + box.height / 2 };
    const across = end - side.x - 2 * gap;
    const sideCaption = Math.min(u(SPLIT.caption.width), 0.45 * across);
    if (right && sideCaption >= u(SPLIT.captionMin)) {
      const fan = fanned(across - sideCaption, slot.height);
      const block = extent(fan).width;
      const x = side.x + 2 * gap + block;
      const caption = { x, y: slot.y + (slot.height - captionHeight) / 2, width: end - x };
      candidates.push(
        laid(
          box,
          past ? { x: side.x + fan.width / 2, y: side.y } : side,
          fan,
          { x: side.x + gap + block / 2, y: side.y },
          { ...caption, height: captionHeight },
          true,
        ),
      );
    }
    return candidates;
  };

  // A pill taller than its slot has no room at all. Where a resting pill is known, every
  // arrangement that keeps off it and the edge it rests at counts, the pieces right under the box
  // first; where it is not, only the ones under the box, past half a pill's height (which keep
  // off it wherever it is).
  const candidates =
    fixed && whole.height > slot.height + 1e-9
      ? []
      : resting
        ? [...arrange(0, true), ...arrange(clear, false)].filter((l) => keepsOff(l, resting(l.box)))
        : arrange(clear, clear === 0);
  const best = candidates.reduce<SplitLayout | undefined>(
    (a, b) => (a && shown(a) >= shown(b) - 1e-9 ? a : b),
    undefined,
  );
  // A slot with room for none: a node's box gives way to small pieces and the count under it.
  const squeezed = () => {
    const fan = fanned(wide, SPLIT.scale * tallest);
    const block = extent(fan).height;
    const room = slot.height - 2 * gap - clear - captionHeight;
    const height = fixed ? whole.height : Math.max(0, Math.min(whole.height, room - block));
    const bottom = { x: whole.x + whole.width / 2, y: slot.y + height };
    const below = bottom.y + clear;
    return laid(
      { ...whole, y: slot.y, height },
      past ? { x: bottom.x, y: below + fan.height / 2 } : bottom,
      fan,
      { x: bottom.x, y: below + gap + block / 2 },
      { x: slot.x + margin, y: below + 2 * gap + block, width: wide, height: captionHeight },
      false,
    );
  };
  return { best, squeezed };
}

type Flow = Extract<DirectionBeat, { verb: 'flow' }>;

/** A shot's elements (a node's rect is its slot) and its beats, in time order. */
type FlowShot = { elements: readonly DirectionElement[]; beats: readonly DirectionBeat[] };

/**
 * The trip that puts a packet against a node when its split starts (`beats` in time order): its
 * last trip before then (it arrived), or, before its first trip, that trip (it waits to leave).
 * None while it travels, nor for a packet no flow carries.
 */
export function restingTrip(
  beats: readonly DirectionBeat[],
  split: { element: string; t: number },
): { trip: Flow; arrives: boolean } | undefined {
  let last: Flow | undefined;
  for (const b of beats) {
    if (b.verb !== 'flow' || b.packet !== split.element) continue;
    if (split.t < b.t) return last ? { trip: last, arrives: true } : { trip: b, arrives: false };
    if (split.t < b.t + b.seconds) return undefined;
    last = b;
  }
  return last && { trip: last, arrives: true };
}

/**
 * The node a packet rests against when its split starts (`beats` in time order): where its last
 * trip before then ended, or, before its first trip, the node that trip leaves. None while it
 * travels, nor for a packet no flow carries: it splits in its own slot (`packetSplit`).
 */
export function restingAt(
  beats: readonly DirectionBeat[],
  split: { element: string; t: number },
): string | undefined {
  const rest = restingTrip(beats, split);
  return rest && (rest.arrives ? rest.trip.to : rest.trip.from);
}

/** A split that fans out of a node: how many pieces, what splits, and whether it is a packet. */
export interface NodeFanCount {
  count: number;
  element: string;
  /** A packet that rests against the node splits, rather than the node itself. */
  rests: boolean;
}

/**
 * The nodes a shot's splits fan out of, each with the count and the element of its split: a node
 * that splits, and a node a packet rests against when it splits, whose pieces fan out in that
 * node's slot rather than over its label. The first split to reach a node takes it (a resolved
 * direction has no other).
 */
export function nodeFans(direction: FlowShot): Map<string, NodeFanCount> {
  const kinds = new Map(direction.elements.map((e) => [e.id, e.kind]));
  const fans = new Map<string, NodeFanCount>();
  for (const b of direction.beats) {
    if (b.verb !== 'split') continue;
    const kind = kinds.get(b.element);
    const node =
      kind === 'node' ? b.element : kind === 'packet' ? restingAt(direction.beats, b) : undefined;
    if (node !== undefined && !fans.has(node))
      fans.set(node, { count: b.count, element: b.element, rests: node !== b.element });
  }
  return fans;
}

/** A split that fans out of a node, with where its packet rests when it is a packet's. */
export interface NodeSplit {
  count: number;
  element: string;
  rests: boolean | Resting;
}

/**
 * Every split that fans out of a node (`nodeFans`), with where a resting packet's pill is, so its
 * node's layout keeps off it and the edge it rests at: on the trip's other node's box as drawn,
 * which is known unless a packet rests against that node too (its box then moves with that pill;
 * the split keeps off a pill anywhere on the box's sides instead). The pill is at most as wide as
 * the box of the node its first trip leaves, unsplit, as the packet is drawn. Node slots are the
 * elements' rects.
 */
export function nodeSplits(
  direction: FlowShot,
  unit: number,
  tall: boolean,
): Map<string, NodeSplit> {
  const fans = nodeFans(direction);
  const slots = new Map(direction.elements.map((e) => [e.id, e.rect]));
  const resting = (fan: NodeFanCount): Resting | true => {
    const split = direction.beats.find(
      (b): b is Extract<DirectionBeat, { verb: 'split' }> =>
        b.verb === 'split' && b.element === fan.element,
    );
    const rest = split && restingTrip(direction.beats, split);
    const first = direction.beats.find(
      (b): b is Flow => b.verb === 'flow' && b.packet === fan.element,
    );
    if (!rest || !first) return true;
    const other = rest.arrives ? rest.trip.from : rest.trip.to;
    const slot = slots.get(other);
    const from = slots.get(first.from);
    const its = fans.get(other);
    if (!slot || !from || its?.rests) return true;
    return {
      other: nodeBoxRect(slot, unit, tall, its?.count),
      arrives: rest.arrives,
      width: pillWidths(textBoxRect(from, unit, tall), unit).most,
    };
  };
  return new Map(
    [...fans].map(([node, fan]) => [node, { ...fan, rests: fan.rests ? resting(fan) : false }]),
  );
}

/**
 * A node's box, as both its text and the edges that join it are drawn: `textBoxRect`'s, or, when
 * a split of `count` pieces fans out of it (a packet's that `rests` against it, or its own), the
 * box its `splitLayout` leaves it.
 */
export function nodeBoxRect(
  slot: Rect,
  unit: number,
  tall: boolean,
  count?: number,
  rests: boolean | Resting = false,
): Rect {
  return count === undefined
    ? textBoxRect(slot, unit, tall)
    : splitLayout(slot, unit, tall, count, rests).box;
}

/**
 * A pile row's items in its grid box (box-relative): at most twelve squares in two lines of six,
 * or in one line of twelve where a short, wide box would draw two lines smaller, filled left to
 * right and top to bottom, sized so twelve would fit, the block centered.
 */
export function pileGrid(
  count: number,
  box: { width: number; height: number },
  gap: number,
): Rect[] {
  const n = Math.max(0, Math.min(Math.floor(count), DRAWN_ITEMS));
  const two = Math.min((box.width - gap * (PER_LINE - 1)) / PER_LINE, (box.height - gap) / 2);
  const one = Math.min((box.width - gap * (DRAWN_ITEMS - 1)) / DRAWN_ITEMS, box.height);
  const lines = one > two ? 1 : 2;
  const perLine = lines === 1 ? DRAWN_ITEMS : PER_LINE;
  const size = Math.max(0, lines === 1 ? one : two);
  const left = (box.width - (perLine * size + (perLine - 1) * gap)) / 2;
  const top = (box.height - (lines * size + (lines - 1) * gap)) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: left + (i % perLine) * (size + gap),
    y: top + Math.floor(i / perLine) * (size + gap),
    width: size,
    height: size,
  }));
}

/**
 * The width a pile row's grid box needs for `pileGrid` to draw its items at `least` or larger: two
 * lines of six where the box is tall enough for two, else one line of twelve.
 */
export function pileGridWidth(height: number, least: number, gap: number): number {
  const perLine = height >= 2 * least + gap ? PER_LINE : DRAWN_ITEMS;
  return perLine * least + (perLine - 1) * gap;
}

/** The number a pile row shows `k` (0–1) of the way through its stack: up to the true count. */
export function stackCount(count: number, k: number): number {
  return Math.floor(count * clamp(k) + 1e-9);
}

/** Each row's progress `k` (0–1) of the way through one stack: rows fill one after another. */
export function stackRows(k: number, rows: number): number[] {
  return Array.from({ length: rows }, (_, i) => clamp(k * rows - i));
}
