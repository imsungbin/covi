import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav, tickTimes } from '@covi/audio';
import { DEFAULT_CONFIG, Redactor, Run, silentLogger } from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIO_PATHS, type AudioRecord, produceSound } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Timeline, TimelineCue } from '../src/timeline/types.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SR = 48_000;
const cue = (t: number, kind: TimelineCue['kind'], extra: Partial<TimelineCue> = {}) =>
  ({ t, kind, scene: 's1', ...extra }) as TimelineCue;

/** Effects alone (no voice, no music), so the master is the effects as placed, only limited. */
async function effectsOnly(cues: TimelineCue[]) {
  const root = mkdtempSync(join(tmpdir(), 'covi-motion-'));
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
  const timeline = {
    duration: 8,
    scenes: [
      {
        id: 's1',
        beat: 'proof',
        eyebrow: 'Proof',
        start: 0,
        end: 8,
        visual: { kind: 'callout', tone: 'info', title: 'x' },
        expression: 'explaining',
        narrator: true,
      },
    ],
    cues,
  } as unknown as Timeline;
  const result = await produceSound(
    {
      run,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      timeline,
      storyboard: { template: 'quick-review' },
      speech: [],
      cacheDir: join(root, '.covi', 'cache'),
      logger: silentLogger,
    },
    { source: 'none', reason: 'Music is off.' },
  );
  return { run, result };
}

/** Peak of a stretch of a channel. */
function peak(c: Float32Array, from: number, to: number): number {
  let p = 0;
  for (let i = Math.round(from * SR); i < Math.round(to * SR); i++)
    p = Math.max(p, Math.abs(c[i]!));
  return p;
}

describe('the sounds of motion', () => {
  it("play a counter as one train of ticks, each where the count's number steps", async () => {
    const { run, result } = await effectsOnly([cue(2, 'count', { seconds: 1.6 })]);
    expect(result.record.effects.placed).toEqual([
      expect.objectContaining({ t: 2, kind: 'count', recipe: 'tick', seconds: 1.6, ticks: 10 }),
    ]);
    const master = readWav(result.master!).channels[0]!;
    const times = tickTimes(1.6).map((t) => 2 + t);
    const loudest = peak(master, 0, 8);
    for (const t of times)
      expect(peak(master, t, t + 0.02), `tick at ${t}`).toBeGreaterThan(loudest / 4);
    // Between the last two ticks, after the one before has died away, nothing plays.
    expect(peak(master, times.at(-2)! + 0.1, times.at(-1)! - 0.01)).toBeLessThan(loudest / 1000);
    const written = JSON.parse(readFileSync(run.path(AUDIO_PATHS.record), 'utf8')) as AudioRecord;
    expect(written.effects.placed[0]).toMatchObject({ seconds: 1.6, ticks: 10 });
  });

  it('play the camera, a merge, and an appearance with their own recipes', async () => {
    const { result } = await effectsOnly([
      cue(1, 'camera', { detail: 'zoom' }),
      cue(3, 'merge'),
      cue(5, 'appear'),
    ]);
    expect(result.record.effects.placed.map((p) => [p.kind, p.recipe])).toEqual([
      ['camera', 'camera'],
      ['merge', 'thump'],
      ['appear', 'accent'],
    ]);
    expect(result.record.engine).toBe('covi-audio-5');
  });

  it('record a second counter that would tick over the first as dropped, with the reason', async () => {
    const { result } = await effectsOnly([
      cue(2, 'count', { seconds: 1.6 }),
      cue(2.5, 'count', { seconds: 1.6 }),
    ]);
    expect(result.record.effects.placed.map((p) => p.t)).toEqual([2]);
    expect(result.record.effects.dropped).toEqual([
      expect.objectContaining({ t: 2.5, kind: 'count', reason: 'while another counter ticks' }),
    ]);
  });
});
