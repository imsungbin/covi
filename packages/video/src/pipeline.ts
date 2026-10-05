import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeVoice } from '@covi/audio';
import {
  type CodeChange,
  type Demonstration,
  type Explanation,
  exists,
  LANGUAGE_NAME,
  type Language,
  type Logger,
  type ModelProvider,
  parseOrThrow,
  type Review,
  type ReviewContext,
  type Run,
  UsageError,
} from '@covi/core';
import { toSrt, toVtt } from './captions.ts';
import { AssetCollector, writeComposition } from './composition/build.ts';
import {
  type Pronunciations,
  resolveSpeechLanguage,
  type SpeechRecord,
  speakScenes,
} from './narration/speech.ts';
import { chooseTts, synthesizeTake, type Take } from './narration/tts.ts';
import {
  mixTakes,
  mouthEnvelope,
  readWav,
  SAMPLE_RATE,
  syntheticMouth,
  writeWav,
} from './narration/wav.ts';
import { type QcReport, runQc } from './qc.ts';
import { Media } from './render/ffmpeg.ts';
import {
  canReuseFrames,
  type FramesRecord,
  framesKey,
  remuxAudio,
  renderComposition,
} from './render/renderer.ts';
import {
  AUDIO_PATHS,
  type AudioRecord,
  draftScore,
  produceSound,
  resolveMusic,
  type SoundInput,
} from './sound.ts';
import type { VideoSpec } from './spec.ts';
import { draftStoryboard } from './storyboard/draft.ts';
import { refineNarration } from './storyboard/model.ts';
import { type Storyboard, StoryboardSchema } from './storyboard/schema.ts';
import { loadTemplates } from './templates.ts';
import { buildTimeline, fitToDuration, pacingFor, storyScenes } from './timeline/build.ts';
import type { Timeline } from './timeline/types.ts';

export interface VideoDecision {
  render: boolean;
  reason: string;
}

/** Covi does not make a video just because it can: only when seeing the change helps a reviewer. */
export function decideVideo(
  context: ReviewContext,
  options: { when: 'auto' | 'always' | 'never'; force?: boolean },
): VideoDecision {
  if (options.force) return { render: true, reason: 'requested explicitly (--force)' };
  if (options.when === 'never') return { render: false, reason: 'video.when is "never"' };
  if (options.when === 'always') return { render: true, reason: 'video.when is "always"' };
  const demo = context.demonstration;
  if (demo.recommendation === 'video')
    return { render: true, reason: demo.reasons[0] ?? 'the change has behavior worth seeing' };
  if (demo.recommendation === 'screenshots') {
    return {
      render: false,
      reason:
        'A before/after screenshot shows this small visual change better than a video. Pass --force to render one anyway.',
    };
  }
  return {
    render: false,
    reason: `${demo.reasons.at(-1) ?? 'Nothing user-visible changes.'} The explanation and review cover it better than a video. Pass --force to render an explainer anyway.`,
  };
}

export interface ProduceVideoInput {
  run: Run;
  change: CodeChange;
  context: ReviewContext;
  explanation: Explanation;
  review: Review;
  demo?: Demonstration;
  spec: VideoSpec;
  /** An agent-authored storyboard (validated). When absent, Covi drafts one. */
  storyboard?: unknown;
  template?: string;
  provider?: ModelProvider;
  cacheDir: string;
  logger: Logger;
  /** Stop after writing storyboard.json so an agent can refine it. */
  draftOnly?: boolean;
  workers?: number;
  /** The language Covi writes in for this run: drafted narration and labels. Default: English. */
  language?: Language;
  /**
   * The language settings that apply to speech: `flag` from --language (or COVI_LANGUAGE), and
   * `configured` from configuration when it names a language rather than `auto`.
   */
  languageSettings?: { flag?: Language; configured?: Language };
  /** video.narration.pronunciations: how the voice should say particular words. */
  pronunciations?: Pronunciations;
}

export interface ProduceVideoResult {
  storyboard: Storyboard;
  drafted: boolean;
  video?: string;
  poster?: string;
  contactSheet?: string;
  duration?: number;
  qc?: QcReport;
  narration: {
    enabled: boolean;
    provider?: string;
    voice?: string;
    reason: string;
    /** The language the narration is spoken in, and why. */
    language?: Language;
    languageSource?: string;
  };
  notes: string[];
  renderMs?: number;
  /** `video/audio.json`: the music, the effects, and the levels of the mix. */
  audio?: AudioRecord;
  /** Only the sound changed: the frames already rendered were kept and the new sound muxed in. */
  framesReused?: boolean;
}

/** `video/frames.json`, next to the video whose frames it describes. */
const FRAMES = 'video/frames.json';

export async function produceVideo(input: ProduceVideoInput): Promise<ProduceVideoResult> {
  const { run, spec, logger } = input;
  const notes: string[] = [];
  await mkdir(run.path('video'), { recursive: true });

  // 1. Storyboard: authored, or drafted from evidence (optionally polished by a model).
  // Everything downstream (narration audio, captions, frames, the composition) is drawn from the
  // storyboard, so redacting it here keeps secrets in code excerpts or output out of the video.
  const redact = <T>(value: T): T => run.redactor.redactDeep(value);
  let storyboard: Storyboard;
  let drafted = false;
  if (input.storyboard) {
    storyboard = parseOrThrow(
      StoryboardSchema,
      input.storyboard,
      'storyboard.json',
      'Run `covi schema storyboard` for the format.',
    );
    storyboard = redact({
      ...storyboard,
      scenes: storyboard.scenes.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` })),
    });
  } else {
    logger.step('Drafting the storyboard');
    // A language named in the request ("a Korean video") wins over the run's language.
    const draftLanguage = spec.language ?? input.language ?? 'en';
    storyboard = redact(
      draftStoryboard({
        ...input,
        templates: await loadTemplates(),
        templateId: input.template,
        language: draftLanguage,
      }),
    );
    drafted = true;
    if (input.provider) {
      try {
        storyboard = redact(
          await refineNarration(
            input.provider,
            storyboard,
            { ...input, language: draftLanguage },
            (text) => run.redactor.redact(text),
          ),
        );
        notes.push(`Narration refined by ${input.provider.id}.`);
      } catch (error) {
        run.warn(
          `Narration refinement failed; using the drafted narration (${(error as Error).message}).`,
        );
      }
    }
  }
  await run.writeJson('video/storyboard.json', storyboard, 'storyboard');
  if (input.draftOnly) {
    // Composed music starts from the theme, for the agent to rewrite before `covi render`.
    if (spec.music.use === 'compose' && !(await run.has(AUDIO_PATHS.score)))
      await run.writeJson(AUDIO_PATHS.score, draftScore(), 'audio');
    return { storyboard, drafted, narration: { enabled: false, reason: 'draft only' }, notes };
  }

  const missing: string[] = [];
  const imagePaths = new Set<string>();
  for (const scene of storyboard.scenes) {
    const v = scene.visual;
    const paths =
      v.kind === 'screenshot'
        ? [v.image.path]
        : v.kind === 'before-after'
          ? [v.before.path, v.after.path]
          : v.kind === 'interaction'
            ? v.steps.map((s) => s.image.path)
            : [];
    for (const p of paths) {
      let full: string;
      try {
        full = run.path(p);
      } catch {
        throw new UsageError(
          `storyboard.json references an image outside the run directory: ${p}`,
          'Image paths are relative to the run directory, e.g. demo/screenshots/home-desktop-after.png.',
        );
      }
      imagePaths.add(p);
      if (!(await exists(full))) missing.push(p);
    }
  }
  if (missing.length)
    throw new Error(
      `storyboard.json references missing images: ${missing.join(', ')} (paths are relative to the run directory)`,
    );

  const media = await Media.locate();

  // 2. Narration-first timing: synthesize and measure each take. The voice reads the scene's
  // spoken form, normalized for its language (acronyms spelled out, pronunciations applied);
  // captions keep the narration as written.
  const said = storyboard.scenes.map((s) => (s.say ?? s.narration).trim());
  let speechLanguage = resolveSpeechLanguage({
    flag: input.languageSettings?.flag ?? spec.language,
    storyboard: storyboard.language,
    text: said,
    configured: input.languageSettings?.configured,
  });
  const tts = await chooseTts(spec.narration, process.env, speechLanguage.language);
  // A voice someone chose can name the language when nothing else does; Covi's own pick cannot.
  if (speechLanguage.fallback && spec.narration.voice && tts.provider?.locale)
    speechLanguage = resolveSpeechLanguage({ text: said, voiceLocale: tts.provider.locale });
  const { language } = speechLanguage;
  const spoken = speakScenes(storyboard.scenes, {
    language,
    pronunciations: input.pronunciations,
    redact: (text) => run.redactor.redact(text),
  });
  const narration: ProduceVideoResult['narration'] = {
    enabled: Boolean(tts.provider),
    provider: tts.provider?.id,
    voice: tts.provider?.voice,
    reason: tts.reason,
    language,
    languageSource: speechLanguage.source,
  };
  if (spec.narration.enabled && !tts.provider)
    run.warn(`Narration requested but unavailable: ${tts.reason}. Rendering with captions only.`);
  const takes = new Map<string, Take>();
  const synthesizeAll = async (tempo: number) => {
    takes.clear();
    if (!tts.provider) return;
    logger.step(
      `Narrating in ${LANGUAGE_NAME[language]} with ${tts.provider.id} (${tts.provider.voice})`,
    );
    try {
      for (const scene of spoken) {
        const text = scene.spoken.trim();
        if (!text) continue;
        takes.set(
          scene.id,
          await synthesizeTake(tts.provider, text, {
            rate: spec.narration.rate,
            cacheDir: input.cacheDir,
            media,
            tempo,
          }),
        );
      }
    } catch (error) {
      run.warn(
        `Speech synthesis failed (${(error as Error).message}); rendering with captions only.`,
      );
      narration.enabled = false;
      narration.reason = 'speech synthesis failed';
      takes.clear();
    }
  };
  await synthesizeAll(1);
  const speech = () => new Map([...takes].map(([id, take]) => [id, take.duration]));
  // Breaths and the outro come from the kind of video and the story, never from the music; a
  // video whose voice could not be synthesized is paced as captions only.
  const hero = (await loadTemplates()).get(storyboard.template)?.hero;
  const pacing = () => pacingFor(spec, hero, takes.size > 0);
  let fit = fitToDuration(storyboard, speech(), spec, language, pacing());
  if (fit.tempo > 1.02 && takes.size) {
    await synthesizeAll(fit.tempo);
    fit = fitToDuration(storyboard, speech(), spec, language, pacing());
  }
  notes.push(...fit.notes);
  for (const n of fit.notes) logger.info(n);
  const speechRecord: SpeechRecord = {
    schemaVersion: 1,
    narrated: takes.size > 0,
    language,
    source: speechLanguage.source,
    voice: tts.provider
      ? { provider: tts.provider.id, name: tts.provider.voice, locale: tts.provider.locale }
      : undefined,
    scenes: spoken,
  };
  await run.writeJson('video/speech.json', speechRecord, 'narration');

  // 3. The voice stem (at −16 LUFS) and the narrator's mouth movement, from the voice alone.
  const frames = Math.round(fit.layout.duration * spec.fps);
  let voice: Float32Array | undefined;
  const speechWindows: SoundInput['speech'] = [];
  let mouth: number[];
  if (takes.size) {
    const spoken = fit.layout.scenes.filter((s) => takes.has(s.id));
    const placed = await Promise.all(
      spoken.map(async (s) => ({
        pcm: await readWav(takes.get(s.id)!.file),
        start: s.speechStart,
      })),
    );
    for (const s of spoken) speechWindows.push([s.speechStart, s.speechEnd]);
    const mix = mixTakes(placed, fit.layout.duration, SAMPLE_RATE);
    voice = normalizeVoice(
      Float32Array.from(mix.samples, (v) => v / 32768),
      SAMPLE_RATE,
    );
    await writeWav(run.path('video/narration.wav'), {
      sampleRate: SAMPLE_RATE,
      samples: Int16Array.from(voice, (v) =>
        Math.max(-32768, Math.min(32767, Math.round(v * 32768))),
      ),
    });
    await run.record('video/narration.wav', 'narration');
    mouth = mouthEnvelope(mix, spec.fps, frames);
  } else {
    mouth = syntheticMouth(
      fit.layout.scenes.map((s) => ({ start: s.speechStart, end: s.speechEnd })),
      spec.fps,
      frames,
    );
  }

  // 4. Timeline, captions, composition.
  const assets = new AssetCollector(run.dir);
  await assets.prepare(imagePaths);
  const timeline: Timeline = buildTimeline({
    title: storyboard.title,
    scenes: fit.scenes,
    layout: fit.layout,
    spec,
    image: assets.image,
    mouth,
    language,
    verdict: input.review.verdict,
  });
  await run.writeJson('video/timeline.json', timeline, 'timeline');
  if (timeline.captions.length) {
    await run.writeText('video/captions.vtt', toVtt(timeline.captions), 'captions');
    await run.writeText('video/captions.srt', toSrt(timeline.captions), 'captions');
  }
  await run.writeText(
    'video/narration.md',
    `# ${storyboard.title}\n\n${storyScenes(timeline.scenes)
      .map(
        (s) =>
          `**${s.id} · ${s.eyebrow}** (${s.start.toFixed(1)}–${s.end.toFixed(1)}s)\n\n${s.speech?.text ?? '_(no narration)_'}\n`,
      )
      .join('\n')}`,
    'narration',
  );

  // 5. Sound: the music fitted to the finished timeline, the effects, and the mix.
  const sound = await produceSound(
    {
      run,
      spec,
      timeline,
      storyboard,
      voice,
      speech: speechWindows,
      reviewVerdict: input.review.verdict,
      cacheDir: input.cacheDir,
      logger,
    },
    await resolveMusic({
      run,
      spec,
      timeline,
      storyboard,
      provider: input.provider,
      explanation: input.explanation,
      reviewVerdict: input.review.verdict,
      speech: speechWindows,
      logger,
    }),
  );

  // 6. Composition.
  const compositionDir = run.path('video/composition');
  await writeComposition(compositionDir, timeline, assets.files);
  await run.record('video/composition/index.html', 'composition');

  // 7. Render, or keep the frames when only the sound changed.
  const output = run.path('video/covi-review.mp4');
  const key = await framesKey(compositionDir);
  const previous = (await run.has(FRAMES)) ? await run.readJson<FramesRecord>(FRAMES) : undefined;
  let layouts: FramesRecord['layouts'];
  let poster: string | undefined;
  let contactSheet: string | undefined;
  let renderMs: number | undefined;
  const framesReused = canReuseFrames(previous, key, await exists(output));
  try {
    if (framesReused) {
      logger.step('Reusing the rendered frames; muxing the new sound');
      await remuxAudio({ video: output, audio: sound.master, duration: timeline.duration, media });
      layouts = previous!.layouts;
      if (await exists(run.path('video/poster.png'))) poster = run.path('video/poster.png');
      if (await exists(run.path('video/contact-sheet.jpg')))
        contactSheet = run.path('video/contact-sheet.jpg');
      notes.push('Reused the rendered frames; only the audio changed.');
    } else {
      // The old key no longer describes the video once a new render starts.
      await rm(run.path(FRAMES), { force: true });
      logger.step(`Rendering ${timeline.frames} frames at ${spec.width}×${spec.height}`);
      let lastShown = 0;
      const rendered = await renderComposition({
        compositionDir,
        output,
        timeline,
        media,
        audio: sound.master,
        workers: input.workers,
        onProgress: (done, total) => {
          const pct = Math.floor((done / total) * 100);
          if (pct >= lastShown + 25 || done === total) {
            lastShown = pct;
            logger.info(`  rendered ${done}/${total} frames`);
          }
        },
      });
      layouts = rendered.layouts;
      poster = rendered.poster;
      contactSheet = rendered.contactSheet;
      renderMs = rendered.renderMs;
      await run.writeJson(
        FRAMES,
        { schemaVersion: 1, key, frames: timeline.frames, layouts } satisfies FramesRecord,
        'composition',
      );
    }
  } finally {
    await rm(run.path(AUDIO_PATHS.master), { force: true });
  }
  await run.record('video/covi-review.mp4', 'video');
  if (poster) await run.record('video/poster.png', 'poster');
  if (contactSheet) await run.record('video/contact-sheet.jpg', 'contact-sheet');

  // 8. Check.
  logger.step('Checking the video');
  const qc = await runQc({
    video: output,
    spec,
    timeline,
    layouts,
    narrated: Boolean(voice),
    media,
    speech: await run.readJson<SpeechRecord>('video/speech.json'),
    audio: sound.record,
  });
  await run.writeJson('video/qc.json', qc, 'qc');
  for (const check of qc.checks.filter((c) => c.status !== 'pass'))
    run.warn(`Video QC ${check.status}: ${check.message}`);

  return {
    storyboard,
    drafted,
    video: output,
    poster,
    contactSheet,
    duration: qc.measured.duration,
    qc,
    narration,
    notes,
    renderMs,
    audio: sound.record,
    framesReused,
  };
}

/** Writes a storyboard JSON file for agents to start from (used by `covi video --draft`). */
export async function writeStoryboard(path: string, storyboard: Storyboard): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(storyboard, null, 2)}\n`);
}
