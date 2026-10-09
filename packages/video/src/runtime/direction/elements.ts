import type {
  DirectionBeat,
  DirectionElement,
  Rect,
  RevealStyle,
  TimelineScene,
} from '../../timeline/types.ts';
import { clamp, easeOutBack, easeOutCubic, rise, seg, typedPrefix } from '../anim.ts';
import { insetOf } from '../canvas.ts';
import { code, screenshot, terminal } from '../components/media.ts';
import {
  type Component,
  type ComponentContext,
  drawnFont,
  entered,
  type LayoutItem,
  overflows,
  rectOf,
  type SceneClock,
} from '../components/types.ts';
import { el, fitText, place } from '../dom.ts';
import { union } from '../narrator.ts';

/*
 * A directed scene's elements, drawn together as one component, so the stage treats a shot like a
 * visual. Code, output, and captures are drawn by the components that draw those visuals, each in
 * its slot; nodes and labels are the agent's short text, always set as text, never as markup.
 */

/** A shot, drawn: one component for the stage, and the storyboard visual's own when it keeps it. */
export interface ShotComponent extends Component {
  /** The component drawing the storyboard visual, when the shot keeps it. */
  visual?: Component;
  /** An element's box as last drawn, in stage pixels: what a camera beat aimed at it frames. */
  frame(id: string): Rect | undefined;
}

type Reveal = Extract<DirectionBeat, { verb: 'reveal' }>;

interface Part {
  component: Component;
  /** Types the element's text in (nodes and labels), for the `type` reveal. */
  type?(k: number): void;
}

interface Drawn extends Part {
  element: DirectionElement;
  layer: HTMLDivElement;
  reveal?: Reveal;
}

/** How far a card's shadow reaches past its box, in pixels (the theme's): a wipe uncovers it too. */
const SHADOW_REACH = 56;

export function mountShot(
  scene: TimelineScene,
  ctx: ComponentContext,
  drawVisual: (ctx: ComponentContext) => Component,
): ShotComponent {
  const direction = scene.direction!;
  const drawn: Drawn[] = direction.elements.map((element) => {
    // A full-stage layer per element, so components keep laying out in stage pixels.
    const layer = el('div', 'layer element', ctx.root);
    layer.dataset.element = element.id;
    const r = element.rect;
    layer.style.transformOrigin = `${(r.x + r.width / 2).toFixed(2)}px ${(r.y + r.height / 2).toFixed(2)}px`;
    const sub: ComponentContext = {
      ...ctx,
      root: layer,
      regions: { ...ctx.regions, media: r, full: r },
      // The visual keeps the scene's phases; other elements play from their reveal.
      phases: element.kind === 'visual' ? ctx.phases : {},
    };
    const reveal = direction.beats.find(
      (b): b is Reveal => b.verb === 'reveal' && b.element === element.id,
    );
    return { element, layer, ...(reveal ? { reveal } : {}), ...draw(element, sub, drawVisual) };
  });
  const shown = drawn.find((d) => d.element.kind === 'visual');
  const visual = shown?.component;
  // The stage maps a target and focus items through the camera when they come from layout. Only
  // the visual has either (a capture element shows no focus), so the shot takes its flag: what is
  // measured as drawn is never mapped again.
  const laidOut = Boolean(visual?.laidOut);
  let now = 0;
  return {
    ...(visual ? { visual } : {}),
    ...(laidOut ? { laidOut } : {}),
    update(clock) {
      now = clock.t;
      for (const d of drawn) {
        const { reveal } = d;
        if (reveal) appear(d, reveal.style, seg(clock.t, reveal.t, reveal.t + reveal.seconds), ctx);
        d.component.update(elementClock(d, clock));
      }
    },
    // An element not revealed yet is not on screen.
    report: () =>
      drawn.filter((d) => !d.reveal || now > d.reveal.t).flatMap((d) => d.component.report()),
    // Nothing to point at before the visual is revealed.
    target: (clock) =>
      shown?.reveal && clock.t <= shown.reveal.t ? undefined : visual?.target?.(clock),
    frame(id) {
      const d = drawn.find((x) => x.element.id === id);
      const boxes = (d?.component.report() ?? [])
        .filter((item) => item.role === 'media')
        .map((item) => item.rect);
      return boxes.length ? union(boxes) : undefined;
    },
  };
}

/**
 * The clock an element plays on. The visual keeps the scene's; an element revealed later plays its
 * own choreography from its reveal, in the time left (as `shotSettledAt` times it), and already in
 * place, since the reveal brings it in.
 */
function elementClock(d: Drawn, clock: SceneClock): SceneClock {
  if (!d.reveal || d.element.kind === 'visual') return clock;
  const t = clock.t - d.reveal.t;
  const duration = Math.max(0.1, clock.duration - d.reveal.t);
  return { ...clock, t, duration, p: clamp(t / duration), open: true };
}

function draw(
  element: DirectionElement,
  ctx: ComponentContext,
  drawVisual: (ctx: ComponentContext) => Component,
): Part {
  switch (element.kind) {
    case 'visual':
      return { component: drawVisual(ctx) };
    case 'code':
      return { component: code(element.visual, ctx) };
    case 'output':
      return { component: terminal(element.visual, ctx) };
    case 'capture':
      return { component: screenshot(element.visual, ctx) };
    case 'node':
      return textBox(element.label, element.rect, 'node dnode', ctx);
    case 'label':
      return textBox(element.text, element.rect, 'dlabel', ctx, toneColor(element.tone, ctx));
  }
}

/** A label's color by tone: the theme's own, as callouts use them. */
function toneColor(
  tone: Extract<DirectionElement, { kind: 'label' }>['tone'],
  ctx: ComponentContext,
): string | undefined {
  const theme = ctx.timeline.theme;
  return tone === 'warning' ? theme.accent : tone === 'success' ? theme.success : undefined;
}

/**
 * A box of an agent's short text (a node's name, a label), centered in its slot and sized to it,
 * with the text fitted between 28 and 40 units (48 on tall frames) and set as text.
 */
function textBox(
  text: string,
  slot: Rect,
  className: string,
  ctx: ComponentContext,
  color?: string,
): Part {
  const u = ctx.u;
  const tall = ctx.timeline.orientation === 'vertical';
  const width = Math.min(slot.width, u(tall ? 760 : 520));
  const height = Math.min(slot.height, u(tall ? 220 : 170));
  const box = el('div', className, ctx.root);
  place(box, {
    x: slot.x + (slot.width - width) / 2,
    y: slot.y + (slot.height - height) / 2,
    width,
    height,
  });
  // The tone marks the box; the text keeps the theme's color, which reads on any tint.
  if (color) Object.assign(box.style, { borderColor: color, background: `${color}1f` });
  const label = el('div', 'nlabel', box, text);
  // Fitted to the box's content area, whatever padding and border its class gives it. Words are
  // kept whole while fitting, so a long one shrinks the text rather than breaking (a word that may
  // break anywhere never overflows); one that does not fit even at the smallest size breaks after
  // all. A pixel to spare, since the scroll width is rounded.
  const style = getComputedStyle(box);
  const px = (a: string, b: string) => Number.parseFloat(a) + Number.parseFloat(b);
  label.style.overflowWrap = 'normal';
  const size = fitText(label, {
    max: u(tall ? 48 : 40),
    min: u(28),
    maxWidth: box.clientWidth - px(style.paddingLeft, style.paddingRight) - 2,
    maxHeight: box.clientHeight - px(style.paddingTop, style.paddingBottom),
  });
  label.style.overflowWrap = '';
  // The box's own size sets how far text may hang below it before it counts as cut off.
  box.style.fontSize = `${size}px`;
  return {
    component: {
      // In with the scene, as a diagram's nodes come in; a reveal has it in place already.
      update: (clock) => rise(box, entered(clock, 0.1, 0.5), u(18)),
      report: (): LayoutItem[] => [
        { role: 'media', rect: rectOf(box) },
        // The box clips the text and centers it safely, so text that does not fit overflows it.
        {
          role: 'text',
          rect: rectOf(label),
          overflow: overflows(box),
          font: drawnFont(label),
          text: 'body',
        },
      ],
    },
    type(k) {
      const typed = typedPrefix(text, k);
      if (label.textContent !== typed) label.textContent = typed;
    },
  };
}

/** How a revealed element looks `k` (0–1) of the way through its reveal. */
function appear(d: Drawn, style: RevealStyle, k: number, ctx: ComponentContext): void {
  const { layer } = d;
  if (style === 'type' && d.type) {
    layer.style.opacity = k > 0 ? '1' : '0';
    d.type(k);
    return;
  }
  if (style === 'pop') {
    layer.style.opacity = clamp(k * 3).toFixed(3);
    layer.style.transform = k >= 1 ? '' : `scale(${(0.86 + 0.14 * easeOutBack(k)).toFixed(4)})`;
    return;
  }
  if (style === 'wipe') {
    // Uncovered left to right over the frame's height, the edge sweeping the slot and its shadow.
    const r = d.element.rect;
    const { width, height } = ctx.timeline;
    const edge = r.x - SHADOW_REACH + (r.width + 2 * SHADOW_REACH) * easeOutCubic(k);
    layer.style.opacity = k > 0 ? '1' : '0';
    layer.style.clipPath =
      k >= 1 ? '' : insetOf({ x: 0, y: 0, width: edge, height }, width, height);
    return;
  }
  rise(layer, k, ctx.u(28));
}
