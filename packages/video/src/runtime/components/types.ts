import type { LayoutItem, Rect, Timeline } from '../../timeline/types.ts';
import type { Regions } from '../layout.ts';

export type { LayoutItem, Rect };

export interface SceneClock {
  /** Seconds since the scene started. */
  t: number;
  duration: number;
  /** t / duration, 0–1. */
  p: number;
  frame: number;
  /** Narrator state, for components that draw the fox themselves. */
  fox: { mouth: number; blink: number };
}

export interface ComponentContext {
  timeline: Timeline;
  regions: Regions;
  /** Scales a design unit (1080-based) to pixels. */
  u: (n: number) => number;
  /** The scene's media layer (absolutely positioned children use stage coordinates). */
  root: HTMLElement;
}

export interface Component {
  update(clock: SceneClock): void;
  /** Boxes used by QC to verify captions never cover the product and text never overflows. */
  report(): LayoutItem[];
  /**
   * The highlighted part the narrator's tail points at (a focus box, highlighted lines, a click
   * point, a finding), in stage pixels; called after `update` with the same clock. Without one
   * the narrator points the way its eyes look.
   */
  target?(clock: SceneClock): Rect | undefined;
  /** Whether the component wants the scene header (title and summary draw their own). */
  header?: boolean;
}

export function rectOf(node: Element): Rect {
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * True when text does not fit its box. Vertical overflow tolerates a fraction of the font size:
 * descenders legitimately extend below tight line boxes without being clipped.
 */
export function overflows(node: HTMLElement): boolean {
  const font = Number.parseFloat(getComputedStyle(node).fontSize) || 16;
  return (
    node.scrollWidth > node.clientWidth + 2 ||
    node.scrollHeight > node.clientHeight + Math.max(2, font * 0.3)
  );
}
