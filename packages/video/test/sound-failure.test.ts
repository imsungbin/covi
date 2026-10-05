import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, Redactor, Run, silentLogger } from '@covi/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { produceSound, themeScore } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Timeline } from '../src/timeline/types.ts';

// The mix fails whenever it is given music or effects, as an internal failure would.
vi.mock('@covi/audio', async (original) => {
  const audio = await original<typeof import('@covi/audio')>();
  return {
    ...audio,
    mixSound: (input: Parameters<typeof audio.mixSound>[0]) => {
      if (input.music || input.effects.length) throw new Error('mixer exploded');
      return audio.mixSound(input);
    },
  };
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const timeline = {
  duration: 10,
  scenes: [
    {
      id: 's1',
      beat: 'summary',
      eyebrow: 'Summary',
      start: 0,
      end: 9,
      visual: { kind: 'summary', verdict: 'looks-good', headline: 'h', points: [] },
      expression: 'success',
      narrator: false,
      speech: { start: 0.3, end: 7.5, text: 'x' },
    },
  ],
  cues: [{ t: 0.3, kind: 'verdict', scene: 's1', detail: 'looks-good' }],
} as unknown as Timeline;

describe('produceSound when the mix fails', () => {
  it('keeps the voice alone, mastered, and says what failed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'covi-mixfail-'));
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
    const voice = new Float32Array(10 * 48_000);
    for (let i = Math.round(0.3 * 48_000); i < Math.round(7.5 * 48_000); i++)
      voice[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 48_000);
    const result = await produceSound(
      {
        run,
        spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'short' }),
        timeline,
        storyboard: { template: 'quick-review' },
        voice,
        speech: [[0.3, 7.5]],
        cacheDir: join(root, '.covi', 'cache'),
        logger: silentLogger,
      },
      { score: themeScore(), source: 'theme', reason: 'The Covi theme.' },
    );
    expect(result.master).toBeDefined();
    expect(result.record.music.error).toMatch(/mixer exploded/);
    // The record describes the video as it is: the theme was chosen, but no music plays.
    expect(result.record.music).toMatchObject({ use: 'theme', source: 'none' });
    expect(result.record.music.reason).toMatch(/could not be played/);
    expect(result.record.levels.master!.integrated).toBeCloseTo(-16, 0);
    expect(result.record.levels.musicBelowVoiceDb).toBeUndefined();
    expect(run.manifest.warnings.join(' ')).toMatch(/keeps the voice alone/);
    expect(await run.has('video/music.wav')).toBe(false);
  });
});
