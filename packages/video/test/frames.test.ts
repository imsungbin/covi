import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canReuseFrames, framesKey } from '../src/render/renderer.ts';

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
