import { seededRandom } from '@covi/core';
import type { Stop } from '../timeline/types.ts';

/** Stops are a quarter of a frame width apart. */
export const STOP_GAP = 0.25;
/** The hero's stop sits this share of a frame lower than the path would put it. */
export const HERO_DROP = 0.5;

/**
 * Where each story scene's stop sits on the canvas: a path that runs to the right and turns down
 * after 2–4 steps, so a row holds 3–5 stops (the seed decides where, so a different change travels
 * differently), with the hero's stop dropped off the row so the camera pulls back to reach it. The
 * drop never reaches into the frame of a stop below (the path turns down under the last stop of a
 * row), so no two stops' frames overlap, and no later stop moves. Coordinates are multiples of the
 * dot grid (`grid` px), so at every stop the canvas's dots line up with the stage's.
 */
export function canvasStops(input: {
  count: number;
  hero?: number;
  seed: number;
  width: number;
  height: number;
  grid: number;
}): Stop[] {
  const { width, height, grid } = input;
  const random = seededRandom(input.seed);
  const turn = () => 2 + Math.floor(random() * 3);
  const snap = (v: number) => Math.round(v / grid) * grid;
  const gap = STOP_GAP * width;
  const stops: Stop[] = [];
  let x = 0;
  let y = 0;
  let run = 0;
  let turnAfter = turn();
  for (let i = 0; i < input.count; i++) {
    if (i > 0) {
      if (run >= turnAfter) {
        y += height + gap;
        run = 0;
        turnAfter = turn();
      } else {
        x += width + gap;
        run++;
      }
    }
    stops.push({ x: snap(x), y: snap(y) });
  }
  const hero = input.hero === undefined ? undefined : stops[input.hero];
  if (hero) hero.y += heroDrop(hero, stops, input);
  return stops;
}

/** How far the hero drops: `HERO_DROP` of a frame, or as far as the frame of a stop below allows. */
function heroDrop(
  hero: Stop,
  stops: readonly Stop[],
  frame: { width: number; height: number; grid: number },
): number {
  const { width, height, grid } = frame;
  const below = stops.filter((s) => s.y > hero.y && s.x < hero.x + width && hero.x < s.x + width);
  const room = Math.min(...below.map((s) => s.y - hero.y - height));
  // Whole grid steps, so the dropped stop stays on the grid; a hair of slack absorbs float error.
  const steps = (v: number) => Math.floor(v / grid + 1e-9) * grid;
  return Math.max(0, Math.min(Math.round((HERO_DROP * height) / grid) * grid, steps(room)));
}
