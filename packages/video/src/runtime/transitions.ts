import type {
  SceneTransition,
  Timeline,
  TimelineScene,
  TransitionKind,
} from '../timeline/types.ts';
import { easeInCubic, easeInOutCubic, easeOutCubic } from './anim.ts';

/*
 * How a scene looks while a transition brings it in or takes it away: pure functions of the
 * transition's progress, so any frame can be drawn on its own. The incoming scene is drawn over
 * the outgoing one (it comes later in the page).
 */

/** A scene's opacity, offset (px), scale, and how much of each side is clipped (0–1). */
export interface Look {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  clipRight: number;
  clipLeft: number;
}

export const REST: Look = { opacity: 1, x: 0, y: 0, scale: 1, clipRight: 0, clipLeft: 0 };

/** How a scene enters: as the timeline says, or as every scene did before kinds (a fade). */
export function transitionOf(
  scene: Pick<TimelineScene, 'transition'>,
  timeline: Pick<Timeline, 'transition'>,
): SceneTransition {
  return scene.transition ?? { kind: 'fade', seconds: timeline.transition };
}

/** The incoming scene, `k` (0–1) of the way through the transition that brings it in. */
export function entering(kind: TransitionKind, k: number, unit: number, width: number): Look {
  switch (kind) {
    case 'cut':
      return REST;
    case 'push': {
      const e = easeInOutCubic(k);
      return { ...REST, x: (1 - e) * width };
    }
    case 'wipe': {
      const e = easeInOutCubic(k);
      return { ...REST, clipRight: 1 - e };
    }
    case 'zoom-through': {
      const e = easeOutCubic(k);
      return { ...REST, opacity: e, scale: 0.92 + 0.08 * e };
    }
    default: {
      const e = easeOutCubic(k);
      return { ...REST, opacity: e, y: (1 - e) * 26 * unit };
    }
  }
}

/** The outgoing scene, `k` of the way through the next scene's transition. */
export function leaving(kind: TransitionKind, k: number, unit: number, width: number): Look {
  switch (kind) {
    case 'cut':
      // The incoming scene covers it; then it is gone.
      return k >= 1 ? { ...REST, opacity: 0 } : REST;
    case 'wipe':
      // Scenes have no background of their own, so the old one gives way exactly where the new
      // one has come: their clips meet at the wipe's edge.
      return { ...REST, opacity: k >= 1 ? 0 : 1, clipLeft: easeInOutCubic(k) };
    case 'push':
      return { ...REST, x: -easeInOutCubic(k) * width };
    case 'zoom-through': {
      const e = easeInCubic(k);
      return { ...REST, opacity: 1 - e, scale: 1 + 0.12 * e };
    }
    default: {
      const e = easeInOutCubic(k);
      return { ...REST, opacity: 1 - e, y: -e * 14 * unit };
    }
  }
}

const inset = (v: number) => (v > 0 ? `${(v * 100).toFixed(3)}%` : '0');

/** An entrance and an exit at once, as the scene root's CSS. */
export function sceneStyle(
  enter: Look,
  leave: Look,
): { opacity: string; transform: string; clipPath: string } {
  const scale = enter.scale * leave.scale;
  const right = Math.max(enter.clipRight, leave.clipRight);
  const left = Math.max(enter.clipLeft, leave.clipLeft);
  return {
    opacity: Math.min(enter.opacity, leave.opacity).toFixed(4),
    transform: `translate(${(enter.x + leave.x).toFixed(2)}px, ${(enter.y + leave.y).toFixed(2)}px)${
      scale === 1 ? '' : ` scale(${scale.toFixed(4)})`
    }`,
    clipPath: right > 0 || left > 0 ? `inset(0 ${inset(right)} 0 ${inset(left)})` : '',
  };
}
