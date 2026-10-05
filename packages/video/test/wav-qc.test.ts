import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mixTakes,
  mouthEnvelope,
  readWav,
  SAMPLE_RATE,
  syntheticMouth,
  writeWav,
} from '../src/narration/wav.ts';
import { layoutChecks, timingChecks } from '../src/qc.ts';
import type { LayoutReport, Timeline } from '../src/timeline/types.ts';

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('wav', () => {
  it('round-trips PCM and mixes takes at their start times', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-wav-'));
    const tone = new Int16Array(SAMPLE_RATE / 10).map((_, i) =>
      Math.round(Math.sin(i / 10) * 12000),
    );
    const path = join(dir, 'tone.wav');
    await writeWav(path, { sampleRate: SAMPLE_RATE, samples: tone });
    const back = await readWav(path);
    expect(back.samples).toEqual(tone);
    const mix = mixTakes([{ pcm: back, start: 0.5 }], 1);
    expect(mix.samples.length).toBe(SAMPLE_RATE);
    expect(mix.samples[SAMPLE_RATE / 2 - 1]).toBe(0);
    expect(mix.samples[SAMPLE_RATE / 2 + 5]).toBe(tone[5]);
  });

  it('derives mouth movement from the voice track and stays closed in silence', () => {
    const samples = new Int16Array(SAMPLE_RATE);
    for (let i = SAMPLE_RATE / 2; i < SAMPLE_RATE; i++)
      samples[i] = Math.round(Math.sin(i / 7) * 9000);
    const mouth = mouthEnvelope({ sampleRate: SAMPLE_RATE, samples }, 30, 30);
    expect(mouth.slice(0, 14).every((v) => v === 0)).toBe(true);
    expect(Math.max(...mouth.slice(16))).toBeGreaterThan(0.5);
    expect(mouth.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('synthesizes a talking rhythm only inside speech windows', () => {
    const mouth = syntheticMouth([{ start: 1, end: 2 }], 10, 30);
    expect(mouth.slice(0, 10).every((v) => v === 0)).toBe(true);
    expect(mouth.slice(10, 20).some((v) => v > 0.3)).toBe(true);
    expect(mouth.slice(21).every((v) => v === 0)).toBe(true);
  });
});

const timeline = { width: 1080, height: 1920, captions: [], scenes: [] } as unknown as Timeline;

describe('QC', () => {
  it('fails when captions cover demonstrated content, passes when they do not', () => {
    const report = (captionsY: number): LayoutReport => ({
      frame: 10,
      scene: 's2',
      captions: { x: 100, y: captionsY, width: 800, height: 120 },
      items: [{ role: 'media', rect: { x: 72, y: 372, width: 936, height: 1000 } }],
      imagesLoaded: true,
    });
    expect(
      layoutChecks(timeline, [report(1400)]).find((c) => c.id === 'captions-clear-of-content')!
        .status,
    ).toBe('pass');
    expect(
      layoutChecks(timeline, [report(1300)]).find((c) => c.id === 'captions-clear-of-content')!
        .status,
    ).toBe('fail');
  });

  it('flags clipped text, captions outside the frame, and failed images', () => {
    const checks = layoutChecks(timeline, [
      {
        frame: 1,
        scene: 's1',
        captions: { x: 100, y: 1880, width: 800, height: 120 },
        items: [{ role: 'text', rect: { x: 0, y: 0, width: 10, height: 10 }, overflow: true }],
        imagesLoaded: false,
      },
    ]);
    const status = Object.fromEntries(checks.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({
      'captions-in-frame': 'fail',
      'text-fits': 'warn',
      images: 'fail',
    });
  });

  it('checks caption overlap and narration pace', () => {
    const t = {
      ...timeline,
      captions: [
        { start: 0, end: 2, lines: ['a'] },
        { start: 1.5, end: 3, lines: ['b'] },
      ],
      scenes: [
        { id: 's1', speech: { start: 0, end: 1, text: 'one two three four five six seven' } },
      ],
    } as unknown as Timeline;
    const status = Object.fromEntries(timingChecks(t).map((c) => [c.id, c.status]));
    expect(status).toEqual({ 'caption-timing': 'fail', 'narration-pace': 'warn' });
  });
});
