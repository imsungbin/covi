import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWav } from '@covi/audio';
import { afterEach, describe, expect, it } from 'vitest';
import { readCachedMusic, SAMPLE_RATE, writeCachedMusic } from '../src/sound.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function dir(): string {
  const root = mkdtempSync(join(tmpdir(), 'covi-music-cache-'));
  roots.push(root);
  return root;
}

const music = (samples: number) =>
  [0, 1].map((c) => Float32Array.from({ length: samples }, (_, i) => Math.sin(i / 7 + c) * 0.25));

describe('the music cache', () => {
  it('stores a render whole and reads it back', async () => {
    const root = dir();
    const file = join(root, 'music', 'key.wav');
    const render = music(4800);
    await writeCachedMusic(file, render);
    const read = readCachedMusic(file, 4800)!;
    expect(read).toHaveLength(2);
    expect(read[0]).toEqual(render[0]);
    expect(read[1]).toEqual(render[1]);
    // Nothing is left beside the entry.
    expect(readdirSync(join(root, 'music'))).toEqual(['key.wav']);
  });

  it('keeps the render when the cache cannot be written, and leaves nothing behind', async () => {
    const root = dir();
    // The cache's directory is a file: nothing can be written under it.
    writeFileSync(join(root, 'music'), 'not a directory');
    expect(await writeCachedMusic(join(root, 'music', 'key.wav'), music(480))).toBe(false);
    // The entry's place is taken by a directory: the rename fails after the write.
    mkdirSync(join(root, 'taken.wav', 'inside'), { recursive: true });
    expect(await writeCachedMusic(join(root, 'taken.wav'), music(480))).toBe(false);
    expect(readdirSync(root).sort()).toEqual(['music', 'taken.wav']);
  });

  it('renders again rather than trust an entry that is short, damaged, or not this music', async () => {
    const root = dir();
    const file = join(root, 'key.wav');
    await writeCachedMusic(file, music(4800));
    // An interrupted write: the header promises more samples than the file holds.
    const whole = readFileSync(file);
    writeFileSync(file, whole.subarray(0, whole.length - 1000));
    expect(readCachedMusic(file, 4800)).toBeUndefined();
    // Another length, another rate, one channel, garbage, or nothing at all.
    await writeCachedMusic(file, music(4800));
    expect(readCachedMusic(file, 4801)).toBeUndefined();
    writeWav(file, music(4800), 44_100, 'float32');
    expect(readCachedMusic(file, 4800)).toBeUndefined();
    writeWav(file, music(4800).slice(0, 1), SAMPLE_RATE, 'float32');
    expect(readCachedMusic(file, 4800)).toBeUndefined();
    writeFileSync(file, 'not a wav');
    expect(readCachedMusic(file, 4800)).toBeUndefined();
    expect(readCachedMusic(join(root, 'missing.wav'), 4800)).toBeUndefined();
  });
});
