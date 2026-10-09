import type { FoxOptions } from '@covi/brand';
import type { Phases } from '../../timeline/cues.ts';
import type { LayoutItem, Rect, Timeline } from '../../timeline/types.ts';
import { seg } from '../anim.ts';
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
  /** The video's first scene: already in place at frame 0, so the first frame shows the subject. */
  open: boolean;
}

export interface ComponentContext {
  timeline: Timeline;
  regions: Regions;
  /** Scales a design unit (1080-based) to pixels. */
  u: (n: number) => number;
  /** The scene's media layer (absolutely positioned children use stage coordinates). */
  root: HTMLElement;
  /** The scene's phases (seconds since it started) by name; empty when nothing is synced. */
  phases: Phases;
  /** The large fox of the scene before, which this scene may take over (the outro does). */
  previousFox?: { fox: LargeFox; sceneStart: number };
}

/** A large fox a card draws itself (title and summary), which the next scene can take over. */
export interface LargeFox {
  /** Its box at rest, in stage pixels. */
  rect: Rect;
  /** The element that draws it: hidden once another scene has taken the fox. */
  element: HTMLElement;
  /** How it is posed at a moment of its own scene (`t` in seconds since the scene started). */
  pose(clock: Pick<SceneClock, 't' | 'frame' | 'fox'>): FoxOptions;
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
  /** The large fox it draws, for the next scene to take over. */
  fox?: LargeFox;
  /**
   * Whether the scene fades and rises in as a whole (default). The outro brings in its own parts,
   * so the fox it takes over never fades.
   */
  entrance?: boolean;
  /**
   * Applies the camera's push-in itself (cards whose large fox the outro may take over, so the
   * fox must stay put); without it the stage scales the scene's media layer.
   */
  camera?(push: number): void;
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

/**
 * A node's font size as drawn, in stage pixels: its computed size scaled by the transforms around
 * it (the camera's push), measured from its box. QC's text-size check reads it.
 */
export function drawnFont(node: HTMLElement): number {
  const font = Number.parseFloat(getComputedStyle(node).fontSize) || 0;
  const width = node.offsetWidth;
  return width > 0 ? (font * node.getBoundingClientRect().width) / width : font;
}

/** The smallest drawn font of these nodes: what a layout item with several texts reports. */
export function smallestFont(nodes: readonly HTMLElement[]): number {
  return Math.min(...nodes.map(drawnFont));
}

/** Entrance progress over [start, end]; the opening scene is already in place at frame 0. */
export function entered(clock: Pick<SceneClock, 't' | 'open'>, start: number, end: number): number {
  return clock.open ? 1 : seg(clock.t, start, end);
}
