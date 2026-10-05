import { aimAngle, clampAim, type FoxOptions, foxBounds, tailParts, tailShape } from '@covi/brand';
import type { Rect } from '../timeline/types.ts';

/**
 * Geometry for the corner narrator, kept free of the DOM so it can be tested: mapping between the
 * fox's view-box units and stage pixels, and choosing where its tail may point.
 */

/** The narrator's box on the stage, and the bob and spring-in scale it carries this frame. */
export interface NarratorPlacement {
  x: number;
  y: number;
  size: number;
  bob?: number;
  /** Scale about the box's center. */
  scale?: number;
}

const VIEW_BOX = 128;

/** View-box units → stage pixels, through the narrator's placement and transform. */
export function toStage(r: Rect, p: NarratorPlacement): Rect {
  const unit = p.size / VIEW_BOX;
  const s = p.scale ?? 1;
  const c = p.size / 2;
  return {
    x: p.x + c + (r.x * unit - c) * s,
    y: p.y + c + (r.y * unit - c) * s + (p.bob ?? 0),
    width: r.width * unit * s,
    height: r.height * unit * s,
  };
}

/** Stage pixels → view-box units, for the untransformed box. */
export function toFox(r: Rect, p: NarratorPlacement): Rect {
  const unit = p.size / VIEW_BOX;
  return {
    x: (r.x - p.x) / unit,
    y: (r.y - p.y) / unit,
    width: r.width / unit,
    height: r.height / unit,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function union(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Poses checked on the tail's way out, from mid-swing to fully extended, close enough that the tip
 * moves less than the margin callers keep around text between two of them. Near rest the tail
 * stays in the narrator's box, which the layout keeps clear, and no aim could move it anyway.
 */
const SWEEP = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

/** True when the tail, reaching out at `angle`, would touch anything in `keepOut`. */
export function reachesInto(angle: number, keepOut: readonly Rect[]): boolean {
  return SWEEP.some((reach) =>
    tailParts(tailShape({ reach, aim: angle })).some((part) =>
      keepOut.some((k) => overlaps(part, k)),
    ),
  );
}

/**
 * How far the tail may turn away from its target to stay clear, in degrees. Past it, an arrow
 * would point at something else, so the tail stays curled and the eyes point; it fades back over
 * the last stretch so the tail never snaps between the two.
 */
const MAX_DETOUR = 45;
const DETOUR_FADE = 15;

/**
 * Where the tail points: `desired` (degrees) when it can reach out that way without touching
 * anything in `keepOut` (view-box units), else the nearest direction that can. When none can
 * within `MAX_DETOUR`, the tail stays curled (reach 0) and the narrator points with its eyes.
 */
export function clearAim(
  desired: number,
  keepOut: readonly Rect[],
): { aim: number; reach: number } {
  const want = clampAim(desired);
  if (!reachesInto(want, keepOut)) return { aim: want, reach: 1 };
  for (let step = 3; step <= MAX_DETOUR; step += 3) {
    for (const sign of [-1, 1]) {
      const angle = clampAim(want + sign * step);
      if (reachesInto(angle, keepOut)) continue;
      // Narrow down to the edge of the clear range, so the aim follows a moving target smoothly.
      let clear = angle;
      let blocked = clampAim(want + sign * (step - 3));
      for (let i = 0; i < 8; i++) {
        const mid = (clear + blocked) / 2;
        if (reachesInto(mid, keepOut)) blocked = mid;
        else clear = mid;
      }
      const detour = Math.abs(clear - want);
      return { aim: clear, reach: Math.min(1, Math.max(0, (MAX_DETOUR - detour) / DETOUR_FADE)) };
    }
  }
  return { aim: want, reach: 0 };
}

/**
 * The pose with its tail kept off everything in `keepOut` (stage pixels), as drawn at
 * `placement`. When the tail would touch something, it eases back toward rest just far enough:
 * this holds for every motion (pointing, the alert's puff and lift, wags), not only the aim
 * `clearAim` chose. Rest stays inside the narrator's box, which the layout keeps clear.
 */
export function fitTail(
  fox: FoxOptions,
  keepOut: readonly Rect[],
  placement: NarratorPlacement,
): FoxOptions {
  const touches = (o: FoxOptions) =>
    foxBounds(o).tail.some((part) => {
      const box = toStage(part, placement);
      return keepOut.some((k) => overlaps(box, k));
    });
  if (!touches(fox)) return fox;
  const toward = (s: number): FoxOptions => ({
    ...fox,
    reach: (fox.reach ?? 0) * s,
    curl: (fox.curl ?? 0) * s,
    lift: (fox.lift ?? 0) * s,
    wag: (fox.wag ?? 0) * s,
    puff: (fox.puff ?? 0) * s,
  });
  let clear = 0;
  let blocked = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (clear + blocked) / 2;
    if (touches(toward(mid))) blocked = mid;
    else clear = mid;
  }
  return toward(clear);
}

/** The tail's aim toward a point in view-box units (the tip turns to face it). */
export function aimAt(point: { x: number; y: number }): number {
  return aimAngle(point);
}

/** The fox's actual shape on the stage for a pose, as boxes in stage pixels. */
export function narratorParts(fox: FoxOptions, p: NarratorPlacement): Rect[] {
  return foxBounds(fox).parts.map((part) => toStage(part, p));
}
