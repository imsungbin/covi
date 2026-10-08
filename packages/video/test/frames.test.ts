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
import type { TimelineScene } from '../src/timeline/types.ts';

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
