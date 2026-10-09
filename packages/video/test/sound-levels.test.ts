import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, Redactor, Run, silentLogger } from '@covi/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { produceSound, themeScore } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Timeline } from '../src/timeline/types.ts';

// The rendered music falls silent where a test asks, as a score with a long rest would.
const silence = vi.hoisted(() => ({ window: undefined as [number, number] | undefined }));
vi.mock('@covi/audio', async (original) => {
  const audio = await original<typeof import('@covi/audio')>();
  return {
    ...audio,
    mixSound: (input: Parameters<typeof audio.mixSound>[0]) => {
      const window = silence.window;
      if (!window || !input.music) return audio.mixSound(input);
      const [from, to] = window.map((t) => Math.round(t * input.sampleRate));
      const music = input.music.map((c) => Float32Array.from(c).fill(0, from, to));
      return audio.mixSound({ ...input, music });
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  silence.window = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SR = 48_000;
const SPEECH: Array<[number, number]> = [
  [0.3, 4.5],
  [5.1, 11],
];
const timeline = {
  duration: 12,
  scenes: [
    {
      id: 's1',
      beat: 'summary',
      eyebrow: 'Summary',
      start: 0,
      end: 11.5,
      visual: { kind: 'summary', verdict: 'looks-good', headline: 'h', points: [] },
      expression: 'success',
      narrator: false,
      speech: { start: 0.3, end: 11, text: 'x' },
    },
  ],
  cues: [],
} as unknown as Timeline;

async function sound(narrated: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'covi-levels-'));
  roots.push(root);
  const run = await Run.create({
    root,
    workflow: 'video',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: '0.0.0-test',
    redactor: new Redactor({}),
  });
  mkdirSync(run.path('video'), { recursive: true });
  const voice = new Float32Array(12 * SR);
  for (const [s, e] of SPEECH)
    for (let i = Math.round(s * SR); i < Math.round(e * SR); i++)
      voice[i] =
        0.2 *
        (0.55 + 0.45 * Math.sin((2 * Math.PI * 4.3 * i) / SR)) *
        Math.sin((2 * Math.PI * 220 * i) / SR);
  const result = await produceSound(
    {
      run,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      timeline,
      storyboard: { template: 'quick-review' },
      ...(narrated ? { voice, speech: SPEECH } : { speech: [] }),
      cacheDir: join(root, '.covi', 'cache'),
      logger: silentLogger,
    },
    { score: themeScore(), source: 'theme', reason: 'The Covi theme.' },
  );
  return { run, result };
}

/** Every number in a level, however deep. */
function numbers(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbers);
  return [value];
}

describe('the sound record', () => {
  it('lays a standard review on the continuous bed and records how the music moved', async () => {
    const { run, result } = await sound(true);
    const { music, levels } = result.record;
    expect(music.placement).toBe('continuous');
    expect(levels.musicJumps!.exempt[0]).toEqual([0, 1.3]);
    expect(levels.musicJumps!.exempt.at(-1)).toEqual([10.5, 12]);
    expect(levels.musicJumps!.maxDb).toBeLessThanOrEqual(6);
    expect(levels.musicRangeLu!).toBeGreaterThanOrEqual(0);
    expect(levels.musicRangeLu!).toBeLessThanOrEqual(8);
    // What QC reads holds numbers only: JSON has no −Infinity or NaN.
    const written = JSON.parse(readFileSync(run.path('video/audio.json'), 'utf8'));
    expect(JSON.stringify(written.levels)).not.toMatch(/null/);
    expect(written.levels.musicJumps.maxDb).toBe(levels.musicJumps!.maxDb);
  });

  it('measures nothing about the bed when no one speaks', async () => {
    const { result } = await sound(false);
    expect(result.record.levels.musicJumps).toBeUndefined();
    expect(result.record.levels.musicRangeLu).toBeUndefined();
  });

  it('keeps every level a number when the music falls silent in the middle of a line', async () => {
    silence.window = [6, 9.5];
    const { run } = await sound(true);
    const { levels } = JSON.parse(readFileSync(run.path('video/audio.json'), 'utf8'));
    // The fall to silence reads as a finite drop, and the range covers what still plays.
    expect(Number.isFinite(levels.musicJumps.maxDb)).toBe(true);
    expect(levels.musicJumps.maxDb).toBeGreaterThan(6);
    expect(Number.isFinite(levels.musicJumps.at)).toBe(true);
    expect(levels.musicRangeLu === undefined || Number.isFinite(levels.musicRangeLu)).toBe(true);
    for (const n of numbers(levels)) expect(Number.isFinite(n), JSON.stringify(levels)).toBe(true);
  });

  it('measures no level under the voice when the music is silent wherever someone speaks', async () => {
    silence.window = [0, 11.2];
    const { run, result } = await sound(true);
    expect(result.record.music.source).toBe('theme');
    const { levels } = JSON.parse(readFileSync(run.path('video/audio.json'), 'utf8'));
    expect(levels.musicBelowVoiceDb).toBeUndefined();
    expect(levels.musicRangeLu).toBeUndefined();
    for (const n of numbers(levels)) expect(Number.isFinite(n), JSON.stringify(levels)).toBe(true);
  });
});
