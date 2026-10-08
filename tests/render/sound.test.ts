import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fitMusic,
  integratedLoudness,
  loadMusicLibrary,
  parseScore,
  renderMusic,
  writeWav,
} from '@covi/audio';
import { afterAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../../packages/cli/src/examples.ts';
import { canRenderVideo, fullRenders } from '../helpers/env.ts';

const available = await canRenderVideo();
const root = join(import.meta.dirname, '..', '..');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface Result {
  runId: string;
  runDir: string;
  video: {
    rendered: boolean;
    qc: string;
    seconds: number;
    music?: { use: string; source: string; hint?: string };
    framesReused?: boolean;
  };
}

interface Audio {
  music: { logo?: { start: number; landing: number }; outro?: number };
  effects: {
    placed: Array<{ t: number; kind: string; recipe: string }>;
    dropped: Array<{ t: number; kind: string; reason: string }>;
  };
  levels: { master: { integrated: number } };
}

interface Qc {
  status: string;
  measured: { loudness?: number; truePeak?: number };
  checks: Array<{ id: string; status: string; message: string }>;
}

function covi(args: string[]): { result: Result; ms: number } {
  const started = performance.now();
  const out = execFileSync('node', ['bin/covi.mjs', ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  });
  return { result: JSON.parse(out) as Result, ms: performance.now() - started };
}

async function example(name: string): Promise<string> {
  const dir = await materializeExample((await listExamples()).find((e) => e.name === name)!);
  dirs.push(dir);
  return dir;
}

const read = <T>(run: string, rel: string) => JSON.parse(readFileSync(join(run, rel), 'utf8')) as T;

/** Integrated loudness of a file as ffmpeg's ebur128 measures it. */
function ffmpegLoudness(file: string): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  return Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary')))![1]);
}

describe.skipIf(!available || !fullRenders)('sound', () => {
  it('synthesizes a 35 s theme in under 10 s, and measures loudness as ffmpeg does', () => {
    const library = loadMusicLibrary(join(root, 'templates', 'music'));
    const score = parseScore(library.scores.get('covi-theme'));
    const arrangement = fitMusic(score, {
      duration: 35,
      hero: 12.45,
      lastLine: 33.5,
      verdict: 'looks-good',
    })!;
    const started = performance.now();
    const music = renderMusic(score, arrangement, library, { verdict: 'looks-good' });
    expect(performance.now() - started).toBeLessThan(10_000);
    const dir = mkdtempSync(join(tmpdir(), 'covi-sound-'));
    dirs.push(dir);
    writeWav(join(dir, 'theme.wav'), music, 48_000, 'pcm16');
    const ours = integratedLoudness(music, 48_000);
    expect(Math.abs(ours - ffmpegLoudness(join(dir, 'theme.wav')))).toBeLessThanOrEqual(0.3);
  }, 120_000);

  it('renders a short video with the theme at −16 LUFS, then re-mixes only the audio', async () => {
    const repo = await example('ui-comment-composer');
    const full = covi(['video', '--repo', repo, '--short', '--duration', '30s']);
    expect(full.result.video).toMatchObject({
      rendered: true,
      music: { use: 'theme', source: 'theme' },
    });
    expect(full.result.video.music!.hint).toMatch(/--music none/);
    expect(full.result.video.qc).not.toBe('fail');
    const run = full.result.runDir;
    const qc = read<Qc>(run, 'video/qc.json');
    // Scenes that show captures cite them, every cited id is in the run, and QC checked grounding.
    const evidence = new Set(
      read<{ items: Array<{ id: string }> }>(run, 'evidence.json').items.map((i) => i.id),
    );
    const timeline = read<{
      scenes: Array<{ visual: { kind: string }; evidenceIds?: string[] }>;
    }>(run, 'video/timeline.json');
    const shown = timeline.scenes.filter((s) =>
      ['screenshot', 'before-after', 'interaction'].includes(s.visual.kind),
    );
    expect(shown.length).toBeGreaterThan(0);
    for (const s of shown) expect(s.evidenceIds?.length).toBeGreaterThan(0);
    for (const id of timeline.scenes.flatMap((s) => s.evidenceIds ?? []))
      expect(evidence.has(id), id).toBe(true);
    expect(qc.checks.find((c) => c.id === 'grounding')).toBeDefined();
    expect(Math.abs(qc.measured.loudness! + 16)).toBeLessThanOrEqual(1);
    for (const id of ['audio', 'music-under-speech', 'music-fit', 'music-audible', 'sound-effects'])
      expect(qc.checks.find((c) => c.id === id)?.status, id).toBe('pass');
    // Our master's loudness agrees with ffmpeg's, measured on the video itself.
    const audio = read<Audio>(run, 'video/audio.json');
    expect(
      Math.abs(audio.levels.master.integrated - ffmpegLoudness(join(run, 'video/covi-review.mp4'))),
    ).toBeLessThanOrEqual(0.3);
    // The logo lands as the outro settles; the outro's own sign-off gives way to it.
    expect(audio.music.logo!.landing).toBeCloseTo(audio.music.outro!, 3);
    expect(audio.effects.dropped.map((d) => d.kind)).toContain('outro');

    const remix = covi(['render', '--repo', repo, '--run', full.result.runId, '--music', 'none']);
    expect(remix.result.video).toMatchObject({
      rendered: true,
      framesReused: true,
      music: { use: 'none', source: 'none' },
    });
    expect(remix.ms).toBeLessThan(full.ms * 0.5);
    expect(read<Qc>(run, 'video/qc.json').status).not.toBe('fail');
    // Without music, the outro signs off with its own sting, on the same moment.
    const remixed = read<Audio>(run, 'video/audio.json');
    const outro = remixed.effects.placed.find((p) => p.kind === 'outro');
    expect(outro?.recipe).toMatch(/^outro-/);
    expect(outro!.t).toBeCloseTo(audio.music.outro!, 3);
  }, 900_000);

  it('keeps the music around the narration of a standard review', async () => {
    const repo = await example('api-users-pagination');
    const { result } = covi(['video', '--repo', repo, '--standard']);
    expect(result.video.rendered).toBe(true);
    const audio = read<{ music: { placement: string } }>(result.runDir, 'video/audio.json');
    expect(audio.music.placement).toBe('bookends');
    const qc = read<Qc>(result.runDir, 'video/qc.json');
    expect(qc.checks.find((c) => c.id === 'music-under-speech')?.status).toBe('pass');
    // The music opens before the first line and is heard in the breaths, not only in the logo.
    expect(qc.checks.find((c) => c.id === 'music-audible')?.status).toBe('pass');
    expect(qc.status).not.toBe('fail');
  }, 900_000);

  it('renders a score composed for the video', async () => {
    const repo = await example('bugfix-cli-slugify');
    const draft = covi([
      'video',
      '--repo',
      repo,
      '--short',
      '--duration',
      '30s',
      '--music',
      'compose',
      '--draft',
      '--force',
    ]);
    // The draft starts from the theme, for the agent (here, the fixture) to rewrite.
    expect(
      read<{ id: string; draft: boolean }>(draft.result.runDir, 'video/score.json'),
    ).toMatchObject({ id: 'covi-theme', draft: true });
    copyFileSync(
      join(import.meta.dirname, 'fixtures', 'score.json'),
      join(draft.result.runDir, 'video', 'score.json'),
    );
    const { result } = covi(['render', '--repo', repo, '--run', draft.result.runId]);
    expect(result.video).toMatchObject({
      rendered: true,
      music: { use: 'compose', source: 'score' },
    });
    const audio = read<{ music: { id: string } }>(result.runDir, 'video/audio.json');
    expect(audio.music.id).toBe('crisp-cli');
    expect(read<Qc>(result.runDir, 'video/qc.json').status).not.toBe('fail');
  }, 900_000);
});
