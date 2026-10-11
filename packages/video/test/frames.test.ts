import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canReuseFrames,
  contactSheetFrames,
  framesKey,
  sheetColumns,
} from '../src/render/renderer.ts';
import { COMPARE_RISE, DELTA_FADE } from '../src/runtime/numbers.ts';
import { settledFrame } from '../src/timeline/cues.ts';
import type { DirectionElement, SceneDirection, TimelineScene } from '../src/timeline/types.ts';

type Metric = Extract<DirectionElement, { kind: 'metric' }>;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A composition directory like the one writeComposition makes. */
function composition(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'covi-frames-'));
  roots.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const base = {
  'index.html': '<html></html>',
  'runtime.js': 'runtime',
  'timeline.json': '{"frames":30}',
  'assets/fonts/inter.woff2': 'font',
  'assets/img/a.png': 'image',
};

describe('the frames key', () => {
  it('is the same for the same composition, wherever it is', async () => {
    expect(await framesKey(composition(base))).toBe(await framesKey(composition(base)));
  });

  it('changes with the timeline, the page, the runtime, and every asset', async () => {
    const key = await framesKey(composition(base));
    for (const [path, content] of [
      ['timeline.json', '{"frames":31}'],
      ['index.html', '<html> </html>'],
      ['runtime.js', 'runtime 2'],
      ['assets/img/a.png', 'other image'],
      ['assets/img/b.png', 'a new image'],
    ] as const)
      expect(await framesKey(composition({ ...base, [path]: content })), path).not.toBe(key);
  });
});

describe('reusing frames', () => {
  it('happens only when the key matches and the video is there', () => {
    expect(canReuseFrames({ key: 'k' }, 'k', true)).toBe(true);
    expect(canReuseFrames({ key: 'k' }, 'k', false)).toBe(false);
    expect(canReuseFrames({ key: 'k' }, 'other', true)).toBe(false);
    expect(canReuseFrames(undefined, 'k', true)).toBe(false);
  });
});

describe('the contact sheet', () => {
  const s = (id: string, start: number, end: number, extra: Partial<TimelineScene> = {}) =>
    ({ id, start, end, ...extra }) as TimelineScene;

  it('samples the opening, each scene, each transition, and the hero accent', () => {
    const frames = contactSheetFrames({
      fps: 30,
      frames: 300,
      transition: 0.45,
      scenes: [
        s('s1', 0, 3.45),
        s('s2', 3, 7, {
          transition: { kind: 'fade', seconds: 0.45 },
          hero: true,
          phases: { hero: 1 },
        }),
        s('s3', 7, 9, { transition: { kind: 'cut', seconds: 0 } }),
        s('covi:outro', 8.55, 10, { transition: { kind: 'fade', seconds: 0.45 } }),
      ],
    });
    // 0.3 s; middles 1.725, 5, 8, 9.275; transitions 3.225 and 8.775 (a cut has none); hero 4.1.
    expect(frames).toEqual([9, 52, 97, 123, 150, 240, 263, 278]);
  });

  it('samples the middle of every morph, where its tokens are on their way', () => {
    const frames = contactSheetFrames({
      fps: 30,
      frames: 300,
      transition: 0.45,
      scenes: [
        s('s1', 0, 4),
        s('s2', 4, 10, {
          transition: { kind: 'cut', seconds: 0 },
          direction: {
            whole: false,
            elements: [],
            beats: [
              { verb: 'camera', move: 'follow', to: 'm', t: 1, seconds: 0.8 },
              { verb: 'morph', element: 'm', t: 2, seconds: 1.6 },
            ],
          },
        }),
      ],
    });
    // 0.3 s; middles 2 and 7; the morph 4 + 2 + 0.8 s in. A camera beat gets no tile.
    expect(frames).toEqual([9, 60, 204, 210]);
  });

  describe('where every count lands', () => {
    const metric = (id: string, extra: Partial<Metric> = {}): Metric => ({
      id,
      kind: 'metric',
      rect: { x: 0, y: 0, width: 400, height: 300 },
      show: 'counter',
      name: 'request bytes',
      from: 70406,
      to: 9907,
      decimals: 0,
      ...extra,
    });
    const count = (element: string, t: number, seconds: number) =>
      ({ verb: 'count', element, t, seconds }) as const;
    const sheet = (
      elements: Metric[],
      beats: SceneDirection['beats'],
      next: Partial<TimelineScene> = { transition: { kind: 'cut', seconds: 0 } },
    ) => {
      const timeline = {
        fps: 30,
        frames: 400,
        transition: 0.45,
        scenes: [
          s('s1', 0, 4),
          s('s2', 4, 10, {
            transition: { kind: 'cut', seconds: 0 },
            direction: { whole: false, elements, beats },
          }),
          s('s3', 10, 13, next),
        ],
      };
      return { timeline, frames: contactSheetFrames(timeline) };
    };

    it('tiles the scene where its metric has settled: value landed, centered, change faded in', () => {
      // 0.3 s; middles 2, 7, and 11.5; the count lands 4 + 1 + 1.6 s in, settled 0.3 s later.
      const { timeline, frames } = sheet([metric('m', { delta: -86 })], [count('m', 1, 1.6)]);
      expect(frames).toEqual([9, 60, 207, 210, 345]);
      expect(frames).toContain(settledFrame(timeline, 1));
      // Bars without a change settle as their count ends; a compare counted quicker than its
      // after value rises settles once it has risen and its change has faded in.
      expect(sheet([metric('m', { show: 'bars' })], [count('m', 1, 1.6)]).frames).toContain(198);
      expect(
        sheet([metric('m', { show: 'compare', delta: -86 })], [count('m', 1, 0.2)]).frames,
      ).toContain(Math.ceil((4 + 1 + COMPARE_RISE + DELTA_FADE) * 30 - 1e-6));
    });

    it('tiles where a counter that only counts up lands, and once when a count follows', () => {
      const up = { verb: 'count-up', element: 'm', value: 9907, t: 1, seconds: 1.6 } as const;
      // Landed 4 + 1 + 1.6 s in, its change faded in 0.3 s later, as a count would.
      expect(sheet([metric('m', { delta: -86 })], [up]).frames).toEqual([9, 60, 207, 210, 345]);
      // The count lands it 4 + 3 + 1.6 s in, centered and faded in 0.3 s later: one tile.
      expect(sheet([metric('m', { delta: -86 })], [up, count('m', 3, 1.6)]).frames).toEqual([
        9, 60, 210, 267, 345,
      ]);
    });

    it('keeps the tile inside its scene, before the next one enters', () => {
      const { frames } = sheet([metric('m', { delta: -86 })], [count('m', 5, 1)], {
        transition: { kind: 'fade', seconds: 0.45 },
      });
      // Settled 10.3 s in, past where s3 starts to enter (9.55 s): the last frame before it.
      expect(frames).toContain(286);
      expect(frames.some((f) => f > 286 && f < 300)).toBe(false);
    });

    it('tiles a count landing on another tile once, and two counts twice', () => {
      // Bars without a change settle as their count ends, 4 + 1 + 2 s in: the scene's middle.
      expect(sheet([metric('m', { show: 'bars' })], [count('m', 1, 2)]).frames).toEqual([
        9, 60, 210, 345,
      ]);
      const two = sheet(
        [metric('a', { show: 'bars' }), metric('b', { show: 'bars' })],
        [count('a', 0.5, 1), count('b', 3, 1)],
      ).frames;
      expect(two).toEqual([9, 60, 165, 210, 240, 345]);
    });
  });

  it('samples transitions of timelines written before they had kinds', () => {
    const frames = contactSheetFrames({
      fps: 10,
      frames: 60,
      transition: 0.4,
      scenes: [s('s1', 0, 3.4), s('s2', 3, 6)],
    });
    expect(frames).toEqual([3, 17, 32, 45]);
  });

  it('tiles six narrow columns for vertical video, and three or four wide ones otherwise', () => {
    expect(sheetColumns(8, true)).toBe(6);
    expect(sheetColumns(8, false)).toBe(3);
    expect(sheetColumns(20, false)).toBe(4);
    expect(sheetColumns(2, false)).toBe(2);
  });
});
