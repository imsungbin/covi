import type {
  ChangeSide,
  DirectionBeat,
  DirectionElement,
  Point,
  Rect,
  SceneDirection,
} from '../../timeline/types.ts';
import { clamp, easeInOutCubic, easeOutCubic, seg } from '../anim.ts';
import {
  type Component,
  type ComponentContext,
  type LayoutItem,
  rectOf,
} from '../components/types.ts';
import { el, fitText, svg } from '../dom.ts';
import { formatNumber } from '../numbers.ts';
import {
  arrowHead,
  center,
  edgeRoute,
  type Fan,
  fanOut,
  type Leg,
  legPoint,
  legProgress,
  pointAlong,
  routeLength,
  textBoxRect,
} from '../routes.ts';
import { TEXT_FLOOR } from '../sizing.ts';
import { textItem, visible } from './metric.ts';

/*
 * Flow verbs, drawn: edges between nodes with packets travelling them, and splits that fan a
 * packet or a node into pieces and merges that pull them back together. Every position is a pure
 * function of the clock (geometry from `routes.ts`), and all text is set as text.
 */

type PacketElement = Extract<DirectionElement, { kind: 'packet' }>;
type NodeElement = Extract<DirectionElement, { kind: 'node' }>;
type Flow = Extract<DirectionBeat, { verb: 'flow' }>;

/** A beat's span on an element's own clock, in seconds. */
export interface BeatSpan {
  t: number;
  seconds: number;
}

/** A split, on its element's clock: how many pieces, what they are, and which side counted them. */
export interface SplitSpan extends BeatSpan {
  count: number;
  name: string;
  side: ChangeSide;
}

/** A merge, on its element's clock, and what a split merges into when the run measured it. */
export interface MergeSpan extends BeatSpan {
  into?: { count: number; name: string; side: ChangeSide };
}

/** What one element does in a shot's flow verbs, on its own clock. */
export interface FlowSpans {
  split?: SplitSpan;
  merge?: MergeSpan;
  /** A packet's trips along edges, in time order. */
  legs: Leg[];
}

/** The drawn box of every node in a shot, which edges join and packets travel between. */
export function nodeBoxes(direction: SceneDirection, ctx: ComponentContext): Map<string, Rect> {
  const tall = ctx.timeline.orientation === 'vertical';
  const boxes = new Map<string, Rect>();
  for (const e of direction.elements)
    if (e.kind === 'node') boxes.set(e.id, textBoxRect(e.rect, ctx.regions.unit, tall));
  return boxes;
}

/**
 * What element `id` does in the shot's flow verbs, on its own clock: `time` takes seconds since
 * the scene started onto it (the stage's `elementTime`, which starts it at the element's reveal).
 */
export function flowSpans(
  direction: SceneDirection,
  id: string,
  boxes: ReadonlyMap<string, Rect>,
  time: (t: number) => number,
): FlowSpans {
  const on = (b: BeatSpan): BeatSpan => ({
    t: time(b.t),
    seconds: time(b.t + b.seconds) - time(b.t),
  });
  const spans: FlowSpans = { legs: [] };
  for (const b of direction.beats) {
    if (b.verb === 'split' && b.element === id)
      spans.split = { ...on(b), count: b.count, name: b.name, side: b.side };
    else if (b.verb === 'merge' && b.element === id)
      spans.merge = { ...on(b), ...(b.into ? { into: b.into } : {}) };
    else if (b.verb === 'flow' && b.packet === id) {
      const from = boxes.get(b.from);
      const to = boxes.get(b.to);
      if (from && to) spans.legs.push({ ...on(b), route: edgeRoute(from, to) });
    }
  }
  return spans;
}

const points = (route: readonly Point[]) =>
  route.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

/**
 * The edges a shot's flows travel, under every element: each is drawn in by the first flow along
 * it, behind its packet, and keeps its arrowhead once drawn. A flow without a packet sends a dot.
 * Edges and dots run on the scene's clock.
 */
export function mountFlows(
  direction: SceneDirection,
  ctx: ComponentContext,
  boxes: ReadonlyMap<string, Rect>,
): { update(t: number): void } {
  const flows = direction.beats.filter((b): b is Flow => b.verb === 'flow');
  if (!flows.length) return { update() {} };
  const layer = el('div', 'layer flows', ctx.root);
  const canvas = svg('svg', { width: ctx.timeline.width, height: ctx.timeline.height }, layer);
  const color = ctx.timeline.theme.primary;
  const dotSize = ctx.u(26);
  const edges = new Map<
    string,
    { path: SVGPathElement; head: SVGPolygonElement; length: number; first: Flow }
  >();
  const dots: Array<{ dot: HTMLDivElement; flow: Flow; route: Point[] }> = [];
  for (const b of flows) {
    const from = boxes.get(b.from);
    const to = boxes.get(b.to);
    if (!from || !to) continue;
    const route = edgeRoute(from, to);
    const key = `${b.from}>${b.to}`;
    if (!edges.has(key)) {
      const length = routeLength(route);
      const path = svg(
        'path',
        {
          d: points(route),
          fill: 'none',
          stroke: color,
          'stroke-width': ctx.u(4).toFixed(2),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'stroke-dasharray': length.toFixed(2),
        },
        canvas,
      );
      const head = svg(
        'polygon',
        {
          points: arrowHead(route, ctx.u(18))
            .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(' '),
          fill: color,
        },
        canvas,
      );
      edges.set(key, { path, head, length, first: b });
    }
    if (!b.packet) {
      const dot = el('div', 'fdot', layer);
      Object.assign(dot.style, { width: `${dotSize}px`, height: `${dotSize}px` });
      dots.push({ dot, flow: b, route });
    }
  }
  return {
    update(t) {
      for (const { path, head, length, first } of edges.values()) {
        const k = legProgress(first, t);
        path.setAttribute('stroke-dashoffset', (length * (1 - k)).toFixed(2));
        head.style.opacity = seg(k, 0.85, 1).toFixed(3);
      }
      for (const { dot, flow, route } of dots) {
        const p = pointAlong(route, legProgress(flow, t));
        dot.style.transform = `translate(${(p.x - dotSize / 2).toFixed(2)}px, ${(p.y - dotSize / 2).toFixed(2)}px)`;
        const end = flow.t + flow.seconds;
        dot.style.opacity =
          t < flow.t ? '0' : (1 - seg(t, end - 0.15 * flow.seconds, end)).toFixed(3);
      }
    },
  };
}

const boxAt = (c: Point, width: number, height: number): Rect => ({
  x: c.x - width / 2,
  y: c.y - height / 2,
  width,
  height,
});

/** A count's caption, measured once fitted, so it can be centered under a source that moves. */
interface Badge {
  badge: HTMLDivElement;
  parts: HTMLElement[];
  width: number;
  height: number;
}

/** A split's captions: its count, and what it merges into, which takes its place once merged. */
interface Badges {
  before: Badge;
  into?: Badge;
  /** The taller of the two: how far down the captions reach. */
  height: number;
}

/**
 * A count as a caption: the side it was measured on, what it counts, and the number, at most
 * `room` wide. The name shrinks to the body floor to stay on one line, then wraps onto a second;
 * one too long even for that is cut short, where QC reads it as overflowing.
 */
function countBadge(
  side: ChangeSide,
  name: string,
  count: number,
  room: number,
  ctx: ComponentContext,
): Badge {
  const labels = ctx.timeline.labels;
  const badge = el('div', 'fbadge', ctx.root);
  const caption = el(
    'div',
    'fside',
    badge,
    side === 'base' ? (labels?.before ?? 'Before') : (labels?.after ?? 'After'),
  );
  const line = el('div', 'fline', badge);
  const what = el('div', 'fname', line, name);
  const num = el('div', 'fnum', line, formatNumber(count, 0));
  // Fitted at its natural width, on one line; then held to the room, where the name gives way.
  fitText(badge, { max: ctx.u(30), min: ctx.u(TEXT_FLOOR.body), maxWidth: room });
  badge.style.maxWidth = `${room}px`;
  if (what.scrollWidth > what.clientWidth + 1) what.classList.add('wrap');
  // Unrounded and untransformed, so the caption centers exactly.
  const style = getComputedStyle(badge);
  return {
    badge,
    parts: [caption, what, num],
    width: Number.parseFloat(style.width) || badge.offsetWidth,
    height: Number.parseFloat(style.height) || badge.offsetHeight,
  };
}

function countBadges(
  split: SplitSpan,
  merge: MergeSpan | undefined,
  room: number,
  ctx: ComponentContext,
): Badges {
  const before = countBadge(split.side, split.name, split.count, room, ctx);
  const into =
    merge?.into && countBadge(merge.into.side, merge.into.name, merge.into.count, room, ctx);
  return {
    before,
    ...(into ? { into } : {}),
    height: Math.max(before.height, into?.height ?? 0),
  };
}

/**
 * How far below its source's center a split's count sits: under its pieces as they are when
 * fanned out (the last are the lowest), so it never moves while they do.
 */
const captionAt = (fan: Fan, gap: number) => (fan.offsets.at(-1)?.y ?? 0) + fan.height / 2 + gap;

/** A split's pieces and the count under them, around a source that may move. */
interface Pieces {
  /** How far the pieces have spread (0 at the source, 1 fanned out). */
  spread(t: number): number;
  /** How much of the source shows: a packet breaks apart into its pieces, a node stays. */
  source(t: number): number;
  update(t: number, origin: Point): void;
  boxes(t: number, origin: Point): Rect[];
  report(): LayoutItem[];
}

/**
 * The pieces a split fans out of a source (`stays`: a node, which emits them below itself; else a
 * packet, which breaks apart in place), and the count they stand for, captioned with the side it
 * was measured on. A merge pulls them back into the source.
 */
function pieces(
  split: SplitSpan,
  merge: MergeSpan | undefined,
  fan: Fan,
  stays: boolean,
  badges: Badges,
  ctx: ComponentContext,
): Pieces {
  const nodes = fan.offsets.map(() => {
    const node = el('div', 'fpiece', ctx.root);
    Object.assign(node.style, { width: `${fan.width}px`, height: `${fan.height}px` });
    return node;
  });
  const { before, into } = badges;
  const below = captionAt(fan, ctx.u(stays ? 14 : 10));
  const spread = (t: number) =>
    easeOutCubic(seg(t, split.t, split.t + split.seconds)) *
    (1 - (merge ? easeInOutCubic(seg(t, merge.t, merge.t + merge.seconds)) : 0));
  const live = (t: number) => t >= split.t && !(merge && t >= merge.t + merge.seconds);
  return {
    spread,
    source(t) {
      if (stays) return 1;
      const gone = seg(t, split.t, split.t + 0.3 * split.seconds);
      const back = merge ? seg(t, merge.t + 0.6 * merge.seconds, merge.t + merge.seconds) : 0;
      return Math.max(1 - gone, back);
    },
    update(t, origin) {
      const k = spread(t);
      const on = live(t);
      nodes.forEach((piece, i) => {
        const o = fan.offsets[i]!;
        const x = origin.x + o.x * k - fan.width / 2;
        const y = origin.y + o.y * k - fan.height / 2;
        piece.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        piece.style.opacity = on ? '1' : '0';
      });
      const fadeOut = merge ? 1 - seg(t, merge.t, merge.t + 0.4 * merge.seconds) : 1;
      for (const [b, opacity] of [
        [before, seg(t, split.t + 0.6 * split.seconds, split.t + split.seconds) * fadeOut],
        ...(into && merge
          ? [[into, seg(t, merge.t + 0.6 * merge.seconds, merge.t + merge.seconds)] as const]
          : []),
      ] as const) {
        b.badge.style.transform = `translate(${(origin.x - b.width / 2).toFixed(2)}px, ${(origin.y + below).toFixed(2)}px)`;
        b.badge.style.opacity = opacity.toFixed(3);
      }
    },
    boxes(t, origin) {
      if (!live(t)) return [];
      const k = spread(t);
      return fan.offsets.map((o) =>
        boxAt({ x: origin.x + o.x * k, y: origin.y + o.y * k }, fan.width, fan.height),
      );
    },
    report: () => [
      ...nodes.filter(visible).map((piece) => ({ role: 'media' as const, rect: rectOf(piece) })),
      ...[before, ...(into ? [into] : [])].flatMap((b) =>
        visible(b.badge) ? b.parts.map(textItem) : [],
      ),
    ],
  };
}

/**
 * A packet: a pill (with the agent's label, set as text) resting in its slot a little above the
 * middle, or travelling its edges; split, it breaks into its pieces, and merged, it is whole again.
 * `follow` is where it is at any moment, so the camera can keep it framed.
 */
export function packet(e: PacketElement, ctx: ComponentContext, spans: FlowSpans): Component {
  const u = ctx.u;
  const tall = ctx.timeline.orientation === 'vertical';
  const pill = el('div', 'fpacket', ctx.root);
  const label = e.label === undefined ? undefined : el('div', 'nlabel', pill, e.label);
  const height = u(tall ? 72 : 64);
  // As wide as its label, at most its slot's width and 420 units; a label too long for that at the
  // floor is cut short, where QC reads it as overflowing. The pill's padding and border are inside
  // its width, and a pixel to spare, since the scroll width is rounded.
  const frame = u(2 * 24 + 2 * 3);
  const most = Math.min(e.rect.width, u(420));
  if (label) fitText(label, { max: u(36), min: u(TEXT_FLOOR.body), maxWidth: most - frame });
  const width = Math.min(most, Math.max(u(150), (label ? label.scrollWidth + 1 : 0) + frame));
  Object.assign(pill.style, { width: `${width}px`, height: `${height}px` });
  const rest = { x: e.rect.x + e.rect.width / 2, y: e.rect.y + e.rect.height * 0.4 };
  const at = (t: number) => legPoint(spans.legs, t, rest);
  const room = e.rect.width - u(32);
  const split = spans.split
    ? pieces(
        spans.split,
        spans.merge,
        fanOut(spans.split.count, { width, height }, room, 0),
        false,
        countBadges(spans.split, spans.merge, room, ctx),
        ctx,
      )
    : undefined;
  return {
    update(clock) {
      const c = at(clock.t);
      const whole = split ? split.source(clock.t) : 1;
      pill.style.transform = `translate(${(c.x - width / 2).toFixed(2)}px, ${(c.y - height / 2).toFixed(2)}px)`;
      pill.style.opacity = whole.toFixed(3);
      split?.update(clock.t, c);
    },
    report: () => [
      ...(visible(pill)
        ? [{ role: 'media' as const, rect: rectOf(pill) }, ...(label ? [textItem(label)] : [])]
        : []),
      ...(split?.report() ?? []),
    ],
    follow(t) {
      const c = at(t);
      const boxes = [boxAt(c, width, height), ...(split?.boxes(t, c) ?? [])];
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    },
  };
}

/**
 * A node that splits: its box stays, and its pieces fan out below it and merge back into it. The
 * pieces and their count stay inside the node's slot: where it has no room for them below the
 * box (a grid's bottom row), they rise over the box rather than run into the captions.
 */
export function nodeSplit(
  node: Component,
  e: NodeElement,
  ctx: ComponentContext,
  spans: FlowSpans & { split: SplitSpan },
): Component {
  const u = ctx.u;
  const box = textBoxRect(e.rect, ctx.regions.unit, ctx.timeline.orientation === 'vertical');
  const origin = center(box);
  const room = e.rect.width - u(32);
  const badges = countBadges(spans.split, spans.merge, room, ctx);
  // Its pieces are packet-sized, whatever the node's size, and start just below it.
  const below = fanOut(
    spans.split.count,
    { width: u(150), height: u(64) },
    room,
    box.height / 2 + u(16),
  );
  const top = origin.y + (below.offsets[0]?.y ?? 0) - below.height / 2;
  const bottom = origin.y + captionAt(below, u(14)) + badges.height;
  const lift = clamp(bottom - (e.rect.y + e.rect.height), 0, Math.max(0, top - e.rect.y));
  const fan = { ...below, offsets: below.offsets.map((o) => ({ x: o.x, y: o.y - lift })) };
  const split = pieces(spans.split, spans.merge, fan, true, badges, ctx);
  return {
    update(clock) {
      node.update(clock);
      split.update(clock.t, origin);
    },
    report: () => [...node.report(), ...split.report()],
  };
}
