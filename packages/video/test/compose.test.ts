import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScore, ScoreSchema } from '@covi/audio';
import {
  DEFAULT_CONFIG,
  type GenerateRequest,
  type ModelProvider,
  Redactor,
  Run,
  silentLogger,
} from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import { draftScore, musicLibrary, resolveMusic } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import { composeScore, musicMethodology } from '../src/storyboard/compose.ts';
import type { Timeline, TimelineScene } from '../src/timeline/types.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const scene = (
  id: string,
  beat: string,
  start: number,
  end: number,
  visual: TimelineScene['visual'],
) =>
  ({
    id,
    beat,
    eyebrow: beat,
    start,
    end,
    visual,
    expression: 'explaining',
    narrator: true,
    speech: { start: start + 0.3, end: end - 0.5, text: 'x' },
  }) as TimelineScene;

const timeline = {
  duration: 30,
  scenes: [
    scene('s1', 'context', 0, 6, { kind: 'title', title: 'T', meta: [] }),
    scene('s2', 'fix', 5.55, 16, { kind: 'callout', tone: 'info', title: 'C' }),
    scene('s3', 'summary', 15.55, 29, {
      kind: 'summary',
      verdict: 'needs-attention',
      headline: 'H',
      points: [],
    }),
  ],
  cues: [],
} as unknown as Timeline;

/** A provider that answers with `answer` and remembers what it was asked. */
function stub(answer: () => unknown): ModelProvider & { requests: GenerateRequest<unknown>[] } {
  const requests: GenerateRequest<unknown>[] = [];
  return {
    id: 'anthropic',
    requests,
    async generate<T>(request: GenerateRequest<T>): Promise<T> {
      requests.push(request as GenerateRequest<unknown>);
      return request.schema.parse(answer());
    },
  };
}

const composed = (): Record<string, unknown> => {
  const theme = draftScore();
  return { ...theme, id: 'composed-fix', draft: false, bpm: 104 };
};

async function run(): Promise<Run> {
  const root = mkdtempSync(join(tmpdir(), 'covi-music-'));
  roots.push(root);
  const created = await Run.create({
    root,
    workflow: 'video',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: '0.0.0-test',
    redactor: new Redactor({ literals: ['tok-secret-123'] }),
  });
  mkdirSync(created.path('video'), { recursive: true });
  return created;
}

const spec = (music: 'theme' | 'compose' | 'none') => resolveVideoSpec(DEFAULT_CONFIG, { music });

const input = async (music: 'theme' | 'compose' | 'none', provider?: ModelProvider) => ({
  run: await run(),
  spec: spec(music),
  timeline,
  storyboard: { template: 'bug-fix' },
  provider,
  explanation: { headline: 'Fix the cart (tok-secret-123)', summary: 'Clamp at zero.' },
  speech: timeline.scenes.map((s) => [s.speech!.start, s.speech!.end] as [number, number]),
  logger: silentLogger,
});

describe('the music methodology', () => {
  it('keeps the methodology and leaves the agent-only steps out of model prompts', async () => {
    const text = await musicMethodology();
    expect(text).toContain('## Music serves the narration');
    expect(text).toContain('## The sonic logo');
    expect(text).toContain('## The score format');
    expect(text).not.toContain('## Run it');
    expect(text).not.toContain('## Output files');
  });
});

describe('composeScore', () => {
  it('asks for a score with the scenes, the hero, the verdict, and the instruments, redacted', async () => {
    const provider = stub(composed);
    const score = await composeScore(
      provider,
      {
        explanation: { headline: 'Fix the cart (tok-secret-123)', summary: 'Clamp at zero.' },
        template: 'bug-fix',
        spec: spec('compose'),
        timeline,
        verdict: 'needs-attention',
        hero: 6,
        lastLine: 28.5,
        library: musicLibrary(),
      },
      (text) => new Redactor({ literals: ['tok-secret-123'] }).redact(text),
    );
    expect(score.id).toBe('composed-fix');
    const [request] = provider.requests;
    expect(request!.purpose).toBe('music');
    expect(request!.schema).toBe(ScoreSchema);
    expect(request!.system).toContain('## Mood by kind of change');
    expect(request!.prompt).toContain(
      'Hero moment (the payoff, where the hero section starts): 6 s.',
    );
    expect(request!.prompt).toContain('Review verdict: needs-attention');
    expect(request!.prompt).toContain('"beat": "fix"');
    expect(request!.prompt).toContain('- soft-pad:');
    expect(request!.prompt).toContain('- soft-acoustic:');
    expect(request!.prompt).toContain('"id":"covi-theme"');
    expect(request!.prompt).not.toContain('tok-secret-123');
  });
});

describe('resolveMusic', () => {
  it('plays nothing, or the theme, as chosen', async () => {
    expect(await resolveMusic(await input('none'))).toMatchObject({ source: 'none' });
    const theme = await resolveMusic(await input('theme'));
    expect(theme).toMatchObject({ source: 'theme' });
    expect(theme.score!.id).toBe('covi-theme');
  });

  it("plays the run's score when an agent wrote one", async () => {
    const i = await input('compose');
    writeFileSync(i.run.path('video/score.json'), JSON.stringify(composed()));
    const music = await resolveMusic(i);
    expect(music).toMatchObject({ source: 'score', reason: 'video/score.json' });
    expect(music.score!.id).toBe('composed-fix');
  });

  it('plays a draft score too, with a warning', async () => {
    const i = await input('compose');
    writeFileSync(i.run.path('video/score.json'), JSON.stringify(draftScore()));
    const music = await resolveMusic(i);
    expect(music.source).toBe('score');
    expect(i.run.manifest.warnings.join(' ')).toMatch(/still the draft/);
  });

  it('refuses an invalid score as a usage error, never replacing it', async () => {
    const bad = async (content: string) => {
      const i = await input('compose');
      writeFileSync(i.run.path('video/score.json'), content);
      return resolveMusic(i);
    };
    await expect(bad('{ not json')).rejects.toMatchObject({ exitCode: 2 });
    await expect(bad(JSON.stringify({ ...composed(), bpm: 300 }))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/bpm/),
      hint: expect.stringContaining('covi schema score'),
    });
    const theremin = composed() as { tracks: Record<string, { patch?: string }> };
    theremin.tracks.pad!.patch = 'theremin';
    await expect(bad(JSON.stringify(theremin))).rejects.toThrow(/unknown patch "theremin"/);
    await expect(bad(`{"id":"x","pad":"${'a'.repeat(70_000)}"}`)).rejects.toThrow(/at most 65536/);
  });

  it('refuses a score too dense to play as a usage error, before rendering it', async () => {
    // Every short kit voice on every 32nd note at 160 bpm, over the theme: more than 167 notes a
    // second, which is what Covi allows.
    const dense = composed() as {
      bpm: number;
      patterns: Record<string, unknown>;
      sections: Record<string, { play: string[] }>;
    };
    dense.bpm = 160;
    const voices = ['kick', 'snare', 'hat', 'shaker', 'woodblock', 'woodblock-lo', 'rim', 'snap'];
    dense.patterns.flood = {
      drums: Object.fromEntries(voices.map((v) => [v, 'x'.repeat(32)])),
      step: '1/32',
    };
    for (const section of Object.values(dense.sections)) section.play.push('flood');
    const i = await input('compose');
    writeFileSync(i.run.path('video/score.json'), JSON.stringify(dense));
    await expect(resolveMusic(i)).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringMatching(/^video\/score\.json: .*schedules more than 5000 notes/),
      hint: expect.stringContaining('covi schema score'),
    });
  });

  it('asks the model for a score when the run has none, and keeps it', async () => {
    const provider = stub(composed);
    const i = await input('compose', provider);
    const music = await resolveMusic(i);
    expect(music).toMatchObject({
      source: 'score',
      reason: 'Composed for this video by anthropic.',
    });
    const written = JSON.parse(readFileSync(i.run.path('video/score.json'), 'utf8'));
    expect(parseScore(written).id).toBe('composed-fix');
  });

  it('falls back to the theme when the model fails or writes something Covi cannot play', async () => {
    const failing = stub(() => {
      throw new Error('overloaded');
    });
    const i = await input('compose', failing);
    const music = await resolveMusic(i);
    expect(music).toMatchObject({ source: 'theme' });
    expect(music.reason).toMatch(/Composing music with anthropic failed \(overloaded\)/);
    expect(i.run.manifest.warnings.join(' ')).toMatch(/used the Covi theme/);

    const theremin = composed() as { tracks: Record<string, { patch?: string }> };
    theremin.tracks.pad!.patch = 'theremin';
    const j = await input(
      'compose',
      stub(() => theremin),
    );
    expect(await resolveMusic(j)).toMatchObject({ source: 'theme' });
    expect(await j.run.has('video/score.json')).toBe(false);
  });

  it('uses the theme and says so when nobody can write the score', async () => {
    const i = await input('compose');
    expect(await resolveMusic(i)).toMatchObject({
      source: 'theme',
      reason: 'Composed music needs an agent or a model; used the Covi theme.',
    });
  });
});

describe('draftScore', () => {
  it('is a copy: editing a draft leaves the bundled theme alone', () => {
    const draft = draftScore() as { tracks: Record<string, { patch?: string }> };
    draft.tracks.pad!.patch = 'theremin';
    expect((draftScore() as typeof draft).tracks.pad!.patch).toBe('soft-pad');
  });

  it('is the theme, marked as a draft, in the score format', () => {
    const draft = draftScore();
    expect(Object.keys(draft).slice(0, 3)).toEqual(['schemaVersion', 'id', 'draft']);
    expect(draft).toMatchObject({ schemaVersion: 1, id: 'covi-theme', draft: true });
    expect(parseScore(draft).draft).toBe(true);
  });
});
