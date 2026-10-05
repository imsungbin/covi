import { readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import {
  type Arrangement,
  AUDIBLE,
  AUDIO_ENGINE_VERSION,
  audibleSeconds,
  checkScoreReferences,
  clearOfSpeech,
  type DroppedEffect,
  dbfs,
  effectRecipe,
  effectTranspose,
  type FitTarget,
  fitMusic,
  loadMusicLibrary,
  MIN_MUSIC_SECONDS,
  type MixLevels,
  type MixResult,
  type MusicLibrary,
  mixSound,
  musicCacheKey,
  musicLength,
  type ParsedScore,
  type PlacedEffect,
  type Placement,
  parseScore,
  placeEffects,
  readWav,
  renderMusic,
  renderSfx,
  SCORE_LIMITS,
  ScoreError,
  scheduleArrangement,
  type Verdict,
  type WavData,
  writeWav,
} from '@covi/audio';
import {
  type Explanation,
  ensureSelfIgnored,
  type Logger,
  type ModelProvider,
  type Run,
  resourcePath,
  UsageError,
} from '@covi/core';
import type { VideoSpec } from './spec.ts';
import { composeScore } from './storyboard/compose.ts';
import type { Storyboard } from './storyboard/schema.ts';
import { heroScene, loadTemplates } from './templates.ts';
import { storyScenes, TRANSITION } from './timeline/build.ts';
import type { Timeline } from './timeline/types.ts';

/*
 * The sound stage: what music plays (the Covi theme, a score written for this video, or none),
 * fitted to the finished timeline, rendered (and cached), the effects for what happens on screen,
 * and the narration-first mix. Frames never depend on any of it, so changing only the sound
 * re-mixes the audio and re-muxes it into the video already rendered.
 */

export const SAMPLE_RATE = 48_000;
export const AUDIO_PATHS = {
  record: 'video/audio.json',
  music: 'video/music.wav',
  score: 'video/score.json',
  /** The master, kept only until it is muxed into the video. */
  master: 'video/.master.wav',
} as const;
const THEME = 'covi-theme';
const SEED = 1;

let cachedLibrary: MusicLibrary | undefined;

/** Covi's bundled music: patches, kits, effect recipes, and the theme, validated on load. */
export function musicLibrary(): MusicLibrary {
  cachedLibrary ??= loadMusicLibrary(resourcePath('templates', 'music'));
  return cachedLibrary;
}

/** `video/audio.json`: what the viewer hears, and the numbers QC checks. */
export interface AudioRecord {
  schemaVersion: 1;
  engine: string;
  /** The video's length in seconds. */
  duration: number;
  music: {
    use: VideoSpec['music']['use'];
    /** Where the music came from: the bundled theme, `video/score.json`, or none. */
    source: 'theme' | 'score' | 'none';
    reason: string;
    placement: Placement;
    id?: string;
    scoreBpm?: number;
    bpm?: number;
    key?: string;
    /** Video time of the first bar's downbeat (negative when the music starts mid-bar). */
    start?: number;
    sections?: Array<{ name: string; startBar: number; bars: number; start: number }>;
    /** The hero moment and its downbeat; `clear`: the downbeat plays at full level, clear of speech. */
    hero?: { moment: number; downbeat: number; clear?: boolean };
    logo?: { start: number; landing: number };
    /** The end of the last narration line, which the logo must follow. */
    lastLine?: number;
    /** The outro's settle moment, where the logo was asked to land. */
    outro?: number;
    fade?: { start: number; end: number };
    /** Peak of the music's last 10 ms (dBFS): the fade must reach silence. */
    tailDb?: number;
    /**
     * How much music the viewer hears outside the logo (from the logo's start to the end):
     * seconds of 0.25 s windows of the placed stem above the threshold, and their share of the
     * video.
     */
    audible?: { seconds: number; share: number; thresholdDbfs: number; window: number };
    fallbacks?: string[];
    /** The synthesizer or the mix failed; the video kept its voice and effects. */
    error?: string;
  };
  effects: { enabled: boolean; placed: PlacedEffect[]; dropped: DroppedEffect[] };
  levels: MixLevels;
}

export interface SoundInput {
  run: Run;
  spec: VideoSpec;
  timeline: Timeline;
  storyboard: Pick<Storyboard, 'template'>;
  /** The narration, mono at 48 kHz and normalized, when there is a voice. */
  voice?: Float32Array;
  /** Where the voice speaks, in seconds. */
  speech: Array<[number, number]>;
  /** The review's verdict, for the music's ending when the storyboard has no summary. */
  reviewVerdict?: Verdict;
  cacheDir: string;
  logger: Logger;
}

export interface SoundResult {
  record: AudioRecord;
  /** The master to mux, or undefined when nothing plays. */
  master?: string;
}

/**
 * The verdict the music ends on: the outro's (which the summary decides), else the summary
 * scene's, else the review's, else "looks good".
 */
export function musicVerdict(timeline: Pick<Timeline, 'scenes'>, review?: Verdict): Verdict {
  for (const scene of timeline.scenes)
    if (scene.visual.kind === 'outro' && scene.visual.verdict) return scene.visual.verdict;
  const summary = timeline.scenes.findLast((s) => s.visual.kind === 'summary')?.visual;
  return summary?.kind === 'summary' ? summary.verdict : (review ?? 'looks-good');
}

/** The hero moment: the hero scene's start plus the transition, the moment it has settled. */
export async function heroMoment(
  timeline: Pick<Timeline, 'scenes'>,
  template: string,
): Promise<number | undefined> {
  const hero = (await loadTemplates()).get(template)?.hero;
  const scenes = storyScenes(timeline.scenes);
  const index = heroScene(scenes, hero);
  return index === undefined ? undefined : scenes[index]!.start + TRANSITION;
}

/** The end of the last narration line; without a voice, the last story scene's start plus 0.45 s. */
export function lastLineEnd(
  timeline: Pick<Timeline, 'scenes'>,
  speech: ReadonlyArray<readonly [number, number]>,
): number {
  if (speech.length) return Math.max(...speech.map(([, end]) => end));
  return (storyScenes(timeline.scenes).at(-1)?.start ?? 0) + TRANSITION;
}

/** The moment the outro card settles, where the logo lands; undefined without an outro. */
export function outroMoment(timeline: Pick<Timeline, 'cues'>): number | undefined {
  return timeline.cues.find((c) => c.kind === 'outro')?.t;
}

/** What the music fits: the video's length, its payoff, its last line, its outro, and its verdict. */
async function fitTarget(
  timeline: Pick<Timeline, 'duration' | 'scenes' | 'cues'>,
  template: string,
  speech: SoundInput['speech'],
  review: Verdict | undefined,
): Promise<FitTarget> {
  const landing = outroMoment(timeline);
  return {
    duration: timeline.duration,
    hero: await heroMoment(timeline, template),
    lastLine: lastLineEnd(timeline, speech),
    ...(landing === undefined ? {} : { landing }),
    verdict: musicVerdict(timeline, review),
  };
}

const SCORE_HINT =
  'Run `covi schema score` for the format; skills/covi-video/references/music.md explains it.';

/**
 * Reads an agent-authored `video/score.json`. It is untrusted input: bounded in size, validated
 * against the schema, and allowed only the bundled patches and kits. Problems are usage errors.
 */
export async function readScoreFile(path: string, library: MusicLibrary): Promise<ParsedScore> {
  const hint = SCORE_HINT;
  const { size } = await stat(path);
  if (size > SCORE_LIMITS.fileBytes)
    throw new UsageError(
      `video/score.json is ${size} bytes; a score may be at most ${SCORE_LIMITS.fileBytes} bytes.`,
      hint,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`video/score.json is not valid JSON: ${(error as Error).message}`, hint);
  }
  try {
    const score = parseScore(raw);
    checkScoreReferences(score, library);
    return score;
  } catch (error) {
    if (error instanceof ScoreError)
      throw new UsageError(`video/score.json: ${error.message}`, hint);
    throw error;
  }
}

/** A cached render, when the file holds all of it: the sample rate, two channels, every sample. */
export function readCachedMusic(file: string, samples: number): Float32Array[] | undefined {
  let cached: WavData;
  try {
    cached = readWav(file);
  } catch {
    return undefined; // missing or unreadable: render it again
  }
  const whole =
    cached.sampleRate === SAMPLE_RATE &&
    cached.channels.length === 2 &&
    cached.channels.every((c) => c.length === samples);
  return whole ? cached.channels : undefined;
}

/**
 * Stores a render whole or not at all: written beside the entry, then renamed over it, so an
 * interrupted write or two renders of the same music never leave a short entry behind. The cache
 * only saves time, so a full disk or a locked file costs the cache, never the video's music.
 */
export async function writeCachedMusic(file: string, music: Float32Array[]): Promise<boolean> {
  const partial = `${file}.${process.pid}-${threadId}.partial`;
  try {
    writeWav(partial, music, SAMPLE_RATE, 'float32');
    await rename(partial, file);
    return true;
  } catch {
    await rm(partial, { force: true }).catch(() => undefined);
    return false;
  }
}

/** Renders the arrangement, or reads it from the cache when nothing it depends on changed. */
async function renderCached(
  score: ParsedScore,
  arrangement: Arrangement,
  library: MusicLibrary,
  input: { cacheDir: string; target: FitTarget },
): Promise<Float32Array[]> {
  const { target } = input;
  const key = musicCacheKey({
    score: score.source,
    fingerprint: library.fingerprint,
    duration: arrangement.duration,
    hero: target.hero,
    lastLine: target.lastLine,
    landing: target.landing,
    verdict: target.verdict,
    seed: SEED,
    sampleRate: SAMPLE_RATE,
  });
  const file = join(input.cacheDir, 'music', `${key}.wav`);
  const cached = readCachedMusic(file, musicLength(arrangement.duration, SAMPLE_RATE));
  if (cached) return cached;
  const music = renderMusic(score, arrangement, library, {
    sampleRate: SAMPLE_RATE,
    seed: SEED,
    verdict: target.verdict,
  });
  // Caching is best-effort: an unwritable cache costs time on the next render, not this music.
  const ignored = await ensureSelfIgnored(input.cacheDir).then(
    () => true,
    () => false,
  );
  if (ignored) await writeCachedMusic(file, music);
  return music;
}

/** Fits, renders, places, and mixes; writes `video/music.wav`, `video/audio.json`, and the master. */
export async function produceSound(
  input: SoundInput,
  source: { score?: ParsedScore; source: AudioRecord['music']['source']; reason: string },
): Promise<SoundResult> {
  const { run, spec, timeline, logger } = input;
  const library = musicLibrary();
  const duration = timeline.duration;
  const target = await fitTarget(
    timeline,
    input.storyboard.template,
    input.speech,
    input.reviewVerdict,
  );
  const music: AudioRecord['music'] = {
    use: spec.music.use,
    source: source.source,
    reason: source.reason,
    placement: spec.music.placement,
  };
  let rendered: Float32Array[] | undefined;
  let key: ParsedScore['key'] | undefined;
  if (source.score && duration < MIN_MUSIC_SECONDS) {
    music.source = 'none';
    music.reason = `The video is shorter than ${MIN_MUSIC_SECONDS} s, too short for music.`;
  } else if (source.score) {
    const score = source.score;
    try {
      const arrangement = fitMusic(score, target)!;
      logger.step(
        `Mixing narration, music (${score.id} at ${arrangement.bpm.toFixed(1)} bpm), and sound effects`,
      );
      rendered = await renderCached(score, arrangement, library, {
        cacheDir: input.cacheDir,
        target,
      });
      key = score.key;
      Object.assign(music, {
        id: score.id,
        scoreBpm: score.bpm,
        bpm: round(arrangement.bpm, 3),
        key: score.keyName,
        start: round(arrangement.start, 4),
        sections: arrangement.sections.map((s) => ({
          ...s,
          start: round(arrangement.start + s.startBar * arrangement.bar, 4),
        })),
        ...(arrangement.markers.hero
          ? {
              hero: {
                moment: round(arrangement.markers.hero.moment, 4),
                downbeat: round(arrangement.markers.hero.downbeat, 4),
              },
            }
          : {}),
        logo: {
          start: round(arrangement.markers.logo.start, 4),
          landing: round(arrangement.markers.logo.landing, 4),
        },
        lastLine: round(target.lastLine, 4),
        ...(target.landing === undefined ? {} : { outro: round(target.landing, 4) }),
        fade: {
          start: round(arrangement.markers.fade.start, 4),
          end: round(arrangement.markers.fade.end, 4),
        },
        fallbacks: arrangement.fallbacks,
      });
    } catch (error) {
      // An agent's score fails as a usage error before it gets here; anything now is Covi's own.
      if (error instanceof UsageError) throw error;
      rendered = undefined;
      music.error = (error as Error).message;
      run.warn(
        `Rendering the music failed (${music.error}); the video keeps its voice and sound effects.`,
      );
    }
  } else {
    logger.step('Mixing narration and sound effects');
  }

  const effects: AudioRecord['effects'] = { enabled: spec.soundEffects, placed: [], dropped: [] };
  const sounds: Array<{ t: number; audio: Float32Array[]; gainDb: number }> = [];
  if (spec.soundEffects) {
    // With music, the music's sonic logo lands on the outro; its own sign-off would clash.
    const logo = Boolean(rendered);
    const placed = placeEffects(
      timeline.cues.filter((c) => !(logo && c.kind === 'outro')),
      library.soundEffects,
    );
    effects.placed = placed.placed.map((p) => ({ ...p, t: round(p.t, 4) }));
    effects.dropped = placed.dropped.map((d) => ({ ...d, t: round(d.t, 4) }));
    for (const cue of logo ? timeline.cues.filter((c) => c.kind === 'outro') : [])
      effects.dropped.push({
        t: round(cue.t, 4),
        kind: cue.kind,
        recipe: effectRecipe(cue, library.soundEffects).recipe,
        reason: "the music's sonic logo signs off instead",
      });
    const transpose = key ? effectTranspose(key) : 0;
    const renders = new Map<string, Float32Array[]>();
    for (const p of placed.placed) {
      const recipe = library.recipes.get(p.recipe)!;
      let audio = renders.get(p.recipe);
      if (!audio) {
        audio = renderSfx(recipe, library.patches, {
          sampleRate: SAMPLE_RATE,
          seed: SEED,
          transpose,
        });
        renders.set(p.recipe, audio);
      }
      // A sting starts early enough that its landing meets the cue.
      sounds.push({ t: Math.max(0, p.t - recipe.anchor), audio, gainDb: p.gainDb });
    }
  }

  const mix = (layers: { music?: Float32Array[]; effects: typeof sounds }) =>
    mixSound({
      sampleRate: SAMPLE_RATE,
      duration,
      voice: input.voice,
      speech: input.speech,
      placement: spec.music.placement,
      ...layers,
    });
  let mixed: MixResult;
  try {
    mixed = mix({ music: rendered, effects: sounds });
  } catch (error) {
    // Never lose the narration to the music: master the voice alone and say what failed.
    music.error = (error as Error).message;
    run.warn(
      `Mixing the music and sound effects failed (${music.error}); the video keeps the voice alone.`,
    );
    rendered = undefined;
    effects.dropped.push(...effects.placed.map((p) => ({ ...p, reason: 'the mix failed' })));
    effects.placed = [];
    mixed = mix({ effects: [] });
  }
  if (rendered && !mixed.music) {
    music.error = 'the rendered music is silent';
    run.warn('The rendered music is silent; the video keeps its voice and sound effects.');
  }
  if (mixed.music) {
    const tail = mixed.music.map((c) => c.subarray(Math.max(0, c.length - SAMPLE_RATE / 100)));
    // Exact silence has no level in dB; −120 dBFS stands for it (JSON has no −Infinity).
    music.tailDb = round(Math.max(-120, ...tail.map((c) => dbfs(peakOf(c)))), 2);
    // What the viewer hears of the music besides the logo: the breaths, the openings, the bed.
    const seconds = audibleSeconds(mixed.music, SAMPLE_RATE, music.logo?.start ?? duration);
    music.audible = {
      seconds,
      share: round(seconds / duration, 4),
      thresholdDbfs: AUDIBLE.thresholdDbfs,
      window: AUDIBLE.window,
    };
    // Whether the lift is heard at full level: speech (and the ramps around it) holds it down.
    if (music.hero)
      music.hero.clear = clearOfSpeech(
        music.hero.downbeat,
        input.voice ? input.speech : [],
        spec.music.placement,
      );
    writeWav(run.path(AUDIO_PATHS.music), mixed.music, SAMPLE_RATE, 'pcm16');
    await run.record(AUDIO_PATHS.music, 'audio');
  } else {
    // A stem from an earlier render would describe music this video no longer has.
    await run.discard(AUDIO_PATHS.music);
    // The record describes the video as it is: chosen music that failed plays as none.
    if (music.error) music.reason = `${music.reason} It could not be played: ${music.error}.`;
    music.source = 'none';
  }
  let master: string | undefined;
  if (mixed.master) {
    master = run.path(AUDIO_PATHS.master);
    writeWav(master, mixed.master, SAMPLE_RATE, 'pcm16');
  }
  const record: AudioRecord = {
    schemaVersion: 1,
    engine: AUDIO_ENGINE_VERSION,
    duration,
    music,
    effects,
    levels: roundLevels(mixed.levels),
  };
  await run.writeJson(AUDIO_PATHS.record, record, 'audio');
  return { record, master };
}

function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
}

function round(n: number, digits: number): number {
  if (!Number.isFinite(n)) return n;
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

function roundLevels(levels: MixLevels): MixLevels {
  const r = (n: number | undefined) => (n === undefined ? undefined : round(n, 2));
  return {
    ...(levels.voiceLufs === undefined ? {} : { voiceLufs: r(levels.voiceLufs) }),
    ...(levels.musicBelowVoiceDb === undefined
      ? {}
      : { musicBelowVoiceDb: r(levels.musicBelowVoiceDb) }),
    ...(levels.effectsBelowVoiceDb === undefined
      ? {}
      : { effectsBelowVoiceDb: r(levels.effectsBelowVoiceDb) }),
    ...(levels.master
      ? {
          master: {
            integrated: r(levels.master.integrated)!,
            truePeak: r(levels.master.truePeak)!,
          },
        }
      : {}),
  };
}

/** The theme as a parsed score. */
export function themeScore(): ParsedScore {
  return parseScore(musicLibrary().scores.get(THEME));
}

/**
 * The score Covi drafts for `--draft --music compose`: the theme, marked as a draft, for an agent
 * to rewrite. `draft` stays true until someone writes the score.
 */
export function draftScore(): Record<string, unknown> {
  // A deep copy: whoever edits the draft must not edit the library's cached theme.
  const { id, ...rest } = structuredClone(musicLibrary().scores.get(THEME)) as Record<
    string,
    unknown
  >;
  return { schemaVersion: 1, id, draft: true, ...rest };
}

export type MusicSource = {
  score?: ParsedScore;
  source: AudioRecord['music']['source'];
  reason: string;
};

export interface MusicSourceInput {
  run: Run;
  spec: VideoSpec;
  timeline: Timeline;
  storyboard: Pick<Storyboard, 'template'>;
  /** Writes the score when the music is composed and no score is in the run. */
  provider?: ModelProvider;
  explanation?: Pick<Explanation, 'headline' | 'summary'>;
  reviewVerdict?: Verdict;
  speech: SoundInput['speech'];
  logger: Logger;
}

/** What the music fits, for a source being chosen. */
function musicTarget(input: MusicSourceInput): Promise<FitTarget> {
  return fitTarget(input.timeline, input.storyboard.template, input.speech, input.reviewVerdict);
}

/**
 * Fits and schedules a score for this video without rendering it, so a score too dense to play
 * fails (with a ScoreError) before anything is synthesized.
 */
function checkPlayable(score: ParsedScore, target: FitTarget, library: MusicLibrary): void {
  const arrangement = fitMusic(score, target);
  if (arrangement) scheduleArrangement(score, arrangement, library, target.verdict);
}

/**
 * What music plays. `compose` plays the run's `video/score.json` (an agent wrote it; an invalid
 * one is a usage error, never silently replaced), else asks the model provider to write one, else
 * uses the theme and says so. A model's score that fails validation falls back to the theme too.
 */
export async function resolveMusic(input: MusicSourceInput): Promise<MusicSource> {
  const { run, spec } = input;
  if (spec.music.use === 'none')
    return {
      source: 'none',
      reason: 'Music is off (--music none, video.music.use, or the request).',
    };
  if (spec.music.use === 'theme')
    return { score: themeScore(), source: 'theme', reason: 'The Covi theme.' };
  const library = musicLibrary();
  if (await run.has(AUDIO_PATHS.score)) {
    const score = await readScoreFile(run.path(AUDIO_PATHS.score), library);
    try {
      checkPlayable(score, await musicTarget(input), library);
    } catch (error) {
      if (error instanceof ScoreError)
        throw new UsageError(`video/score.json: ${error.message}`, SCORE_HINT);
      throw error;
    }
    if (score.draft)
      run.warn(
        'video/score.json is still the draft Covi wrote (the Covi theme): compose it, then set "draft": false.',
      );
    return {
      score,
      source: 'score',
      reason: score.draft ? 'video/score.json, still the draft' : 'video/score.json',
    };
  }
  if (input.provider) {
    const provider = input.provider;
    input.logger.step(`Composing music with ${provider.id}`);
    try {
      const target = await musicTarget(input);
      const raw = await composeScore(
        provider,
        {
          explanation: input.explanation ?? { headline: '', summary: '' },
          template: input.storyboard.template,
          spec,
          timeline: input.timeline,
          verdict: target.verdict,
          hero: target.hero,
          lastLine: target.lastLine,
          landing: target.landing,
          library,
        },
        (text) => run.redactor.redact(text),
      );
      const score = parseScore(raw);
      checkScoreReferences(score, library);
      checkPlayable(score, target, library);
      await run.writeJson(AUDIO_PATHS.score, raw, 'audio');
      return { score, source: 'score', reason: `Composed for this video by ${provider.id}.` };
    } catch (error) {
      const reason = `Composing music with ${provider.id} failed (${(error as Error).message.split('\n')[0]}); used the Covi theme.`;
      run.warn(reason);
      return { score: themeScore(), source: 'theme', reason };
    }
  }
  const reason = 'Composed music needs an agent or a model; used the Covi theme.';
  run.warn(reason);
  return { score: themeScore(), source: 'theme', reason };
}
