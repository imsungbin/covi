import type { DirectionBeat, Point, Rect, SceneDirection } from '../timeline/types.ts';

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
 * each a little smaller than `source` (a packet), the lines shrunk to fit `room` px wide. A packet
 * breaks apart in place (`drop` 0); a node stays, and its pieces fan out `drop` px below its center.
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

/** A node that splits, laid out in its slot: its box, its pieces fanned out, and its count. */
export interface SplitLayout {
  box: Rect;
  /** Where the pieces leave the box and merge back into it: the middle of its side facing them. */
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

/** A node split's sizes, in design units. */
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
 * Where a node that splits into `count` pieces is drawn in its slot, so that neither its pieces
 * nor its count cover its box (and its label) or leave the slot. Of three arrangements, the one
 * that shows the pieces largest (the first on a tie): under the box with the count under them (a
 * tall slot), under the box with the count beside them (a shorter one), or to the right of the box
 * with the count beside them (a wide, short slot, such as a column's). Under the box, the box
 * takes the top of the slot, cut down toward two lines of label if the pieces need the room;
 * beside it, the box stays where it is unsplit unless the pieces need the room, and then moves
 * left. The pieces shrink to the room they have. In a slot with room for none of them, the box
 * gives way to small pieces under it (see `arrangedSplit`, which the resolver asks first).
 */
export function splitLayout(slot: Rect, unit: number, tall: boolean, count: number): SplitLayout {
  const { best, squeezed } = splitArrangements(slot, unit, tall, count);
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
): SplitLayout | undefined {
  return splitArrangements(slot, unit, tall, count).best;
}

/** A node split's best arrangement in its slot, if any has room, and the one when none has. */
function splitArrangements(
  slot: Rect,
  unit: number,
  tall: boolean,
  count: number,
): { best: SplitLayout | undefined; squeezed: () => SplitLayout } {
  const u = (n: number) => n * unit;
  const whole = textBoxRect(slot, unit, tall);
  const gap = u(SPLIT.gap);
  const margin = u(SPLIT.margin);
  const wide = slot.width - 2 * margin;
  const piece = { width: u(SPLIT.piece.width), height: u(SPLIT.piece.height) };
  const captionHeight = Math.min(u(SPLIT.caption.height), slot.height);
  const boxMin = Math.min(u(SPLIT.box), whole.height);
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
  const candidates: SplitLayout[] = [];

  // Under the box, the count under the pieces.
  const room = slot.height - 2 * gap - captionHeight;
  const height = Math.min(
    whole.height,
    Math.max(boxMin, room - extent(fanned(wide, tallest)).height),
  );
  if (room - height > 0) {
    const fan = fanned(wide, room - height);
    const block = extent(fan).height;
    const top =
      slot.y + Math.max(0, (slot.height - (height + 2 * gap + block + captionHeight)) / 2);
    const origin = { x: whole.x + whole.width / 2, y: top + height };
    const caption = { x: slot.x + margin, y: origin.y + 2 * gap + block, width: wide };
    candidates.push(
      laid(
        { ...whole, y: top, height },
        origin,
        fan,
        { x: origin.x, y: origin.y + gap + block / 2 },
        { ...caption, height: captionHeight },
        false,
      ),
    );
  }

  // Under the box, the count beside the pieces: a row as tall as the count.
  const rowCaption = Math.min(u(SPLIT.caption.width), 0.45 * wide);
  const rowBox = Math.min(whole.height, slot.height - gap - captionHeight);
  if (rowBox >= boxMin && rowCaption >= u(SPLIT.captionMin)) {
    const across = wide - gap - rowCaption;
    const top = slot.y + (slot.height - (rowBox + gap + captionHeight)) / 2;
    const origin = { x: whole.x + whole.width / 2, y: top + rowBox };
    const row = origin.y + gap;
    // The pieces end where the count starts.
    const fan = fanned(across, captionHeight);
    candidates.push(
      laid(
        { ...whole, y: top, height: rowBox },
        origin,
        fan,
        { x: slot.x + margin + across - extent(fan).width / 2, y: row + captionHeight / 2 },
        { x: slot.x + margin + across + gap, y: row, width: rowCaption, height: captionHeight },
        true,
      ),
    );
  }

  // To the right of the box, the count beside the pieces. The box stays where it is unsplit while
  // that leaves room for the pieces at half their size; else it moves left, then narrows.
  const right = slot.x + slot.width - margin;
  const need = 2 * gap + u(SPLIT.caption.width) + 0.5 * extent(fanned(Infinity, slot.height)).width;
  const short = need - (right - (whole.x + whole.width));
  const move = Math.max(0, Math.min(short, whole.x - (slot.x + margin)));
  const narrow = Math.max(0, Math.min(short - move, whole.width - u(SPLIT.boxWidth)));
  const box = { ...whole, x: whole.x - move, width: whole.width - narrow };
  const origin = { x: box.x + box.width, y: box.y + box.height / 2 };
  const across = right - origin.x - 2 * gap;
  const sideCaption = Math.min(u(SPLIT.caption.width), 0.45 * across);
  if (sideCaption >= u(SPLIT.captionMin)) {
    const fan = fanned(across - sideCaption, slot.height);
    const block = extent(fan).width;
    const x = origin.x + 2 * gap + block;
    const caption = { x, y: slot.y + (slot.height - captionHeight) / 2, width: right - x };
    candidates.push(
      laid(
        box,
        origin,
        fan,
        { x: origin.x + gap + block / 2, y: origin.y },
        { ...caption, height: captionHeight },
        true,
      ),
    );
  }

  const best = candidates.reduce<SplitLayout | undefined>(
    (a, b) => (a && shown(a) >= shown(b) - 1e-9 ? a : b),
    undefined,
  );
  // A slot with room for none: the box gives way to small pieces and the count under it.
  const squeezed = () => {
    const fan = fanned(wide, SPLIT.scale * tallest);
    const block = extent(fan).height;
    const height = Math.max(0, Math.min(whole.height, room - block));
    const bottom = { x: whole.x + whole.width / 2, y: slot.y + height };
    return laid(
      { ...whole, y: slot.y, height },
      bottom,
      fan,
      { x: bottom.x, y: bottom.y + gap + block / 2 },
      { x: slot.x + margin, y: bottom.y + 2 * gap + block, width: wide, height: captionHeight },
      false,
    );
  };
  return { best, squeezed };
}

/**
 * The node a packet rests against when its split starts (`beats` in time order): where its last
 * trip before then ended, or, before its first trip, the node that trip leaves. None while it
 * travels, nor for a packet no flow carries: it breaks apart in place.
 */
export function restingAt(
  beats: readonly DirectionBeat[],
  split: { element: string; t: number },
): string | undefined {
  let at: string | undefined;
  for (const b of beats) {
    if (b.verb !== 'flow' || b.packet !== split.element) continue;
    if (split.t < b.t) return at ?? b.from;
    if (split.t < b.t + b.seconds) return undefined;
    at = b.to;
  }
  return at;
}

/**
 * The nodes a shot's splits fan out of, each with the count and the element of its split: a node
 * that splits, and a node a packet rests against when it splits, whose pieces fan out in that
 * node's slot rather than over its label. The first split to reach a node takes it (a resolved
 * direction has no other).
 */
export function nodeFans(
  direction: Pick<SceneDirection, 'elements' | 'beats'>,
): Map<string, { count: number; element: string }> {
  const kinds = new Map(direction.elements.map((e) => [e.id, e.kind]));
  const fans = new Map<string, { count: number; element: string }>();
  for (const b of direction.beats) {
    if (b.verb !== 'split') continue;
    const kind = kinds.get(b.element);
    const node =
      kind === 'node' ? b.element : kind === 'packet' ? restingAt(direction.beats, b) : undefined;
    if (node !== undefined && !fans.has(node))
      fans.set(node, { count: b.count, element: b.element });
  }
  return fans;
}

/**
 * A node's box, as both its text and the edges that join it are drawn: `textBoxRect`'s, or, when
 * a split of `count` pieces fans out of it, the box its `splitLayout` leaves it.
 */
export function nodeBoxRect(slot: Rect, unit: number, tall: boolean, count?: number): Rect {
  return count === undefined
    ? textBoxRect(slot, unit, tall)
    : splitLayout(slot, unit, tall, count).box;
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
