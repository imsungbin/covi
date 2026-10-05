import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CodeChange,
  type Demonstration,
  type Explanation,
  exists,
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
import { renderComposition } from './render/renderer.ts';
import type { VideoSpec } from './spec.ts';
import { draftStoryboard } from './storyboard/draft.ts';
import { refineNarration } from './storyboard/model.ts';
import { type Storyboard, StoryboardSchema } from './storyboard/schema.ts';
import { loadTemplates } from './templates.ts';
import { buildTimeline, fitToDuration } from './timeline/build.ts';
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
}

export interface ProduceVideoResult {
  storyboard: Storyboard;
  drafted: boolean;
  video?: string;
  poster?: string;
  contactSheet?: string;
  duration?: number;
  qc?: QcReport;
  narration: { enabled: boolean; provider?: string; voice?: string; reason: string };
  notes: string[];
  renderMs?: number;
}

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
    storyboard = redact(
      draftStoryboard({
        ...input,
        templates: await loadTemplates(),
        templateId: input.template,
      }),
    );
    drafted = true;
    if (input.provider) {
      try {
        storyboard = redact(
          await refineNarration(input.provider, storyboard, input, (text) =>
            run.redactor.redact(text),
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

  // 2. Narration-first timing: synthesize and measure each take.
  const tts = await chooseTts(spec.narration);
  const narration: ProduceVideoResult['narration'] = {
    enabled: Boolean(tts.provider),
    provider: tts.provider?.id,
    voice: tts.provider?.voice,
    reason: tts.reason,
  };
  if (spec.narration.enabled && !tts.provider)
    run.warn(`Narration requested but unavailable: ${tts.reason}. Rendering with captions only.`);
  const takes = new Map<string, Take>();
  const synthesizeAll = async (tempo: number) => {
    takes.clear();
    if (!tts.provider) return;
    logger.step(`Narrating with ${tts.provider.id} (${tts.provider.voice})`);
    try {
      for (const scene of storyboard.scenes) {
        const text = (scene.say ?? scene.narration).trim();
        if (!text) continue;
        takes.set(
          scene.id!,
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
  let fit = fitToDuration(storyboard, speech(), spec);
  if (fit.tempo > 1.02 && takes.size) {
    await synthesizeAll(fit.tempo);
    fit = fitToDuration(storyboard, speech(), spec);
  }
  notes.push(...fit.notes);
  for (const n of fit.notes) logger.info(n);

  // 3. Audio track and the narrator's mouth movement.
  const frames = Math.round(fit.layout.duration * spec.fps);
  let audio: string | undefined;
  let mouth: number[];
  if (takes.size) {
    const placed = await Promise.all(
      fit.layout.scenes
        .filter((s) => takes.has(s.id))
        .map(async (s) => ({ pcm: await readWav(takes.get(s.id)!.file), start: s.speechStart })),
    );
    const mix = mixTakes(placed, fit.layout.duration, SAMPLE_RATE);
    audio = run.path('video/narration.wav');
    await writeWav(audio, mix);
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
  });
  await run.writeJson('video/timeline.json', timeline, 'timeline');
  if (timeline.captions.length) {
    await run.writeText('video/captions.vtt', toVtt(timeline.captions), 'captions');
    await run.writeText('video/captions.srt', toSrt(timeline.captions), 'captions');
  }
  await run.writeText(
    'video/narration.md',
    `# ${storyboard.title}\n\n${timeline.scenes.map((s) => `**${s.id} · ${s.eyebrow}** (${s.start.toFixed(1)}–${s.end.toFixed(1)}s)\n\n${s.speech?.text ?? '_(no narration)_'}\n`).join('\n')}`,
    'narration',
  );
  const compositionDir = run.path('video/composition');
  await writeComposition(compositionDir, timeline, assets.files);
  await run.record('video/composition/index.html', 'composition');

  // 5. Render and check.
  logger.step(`Rendering ${timeline.frames} frames at ${spec.width}×${spec.height}`);
  const output = run.path('video/covi-review.mp4');
  let lastShown = 0;
  const rendered = await renderComposition({
    compositionDir,
    output,
    timeline,
    media,
    audio,
    workers: input.workers,
    onProgress: (done, total) => {
      const pct = Math.floor((done / total) * 100);
      if (pct >= lastShown + 25 || done === total) {
        lastShown = pct;
        logger.info(`  rendered ${done}/${total} frames`);
      }
    },
  });
  await run.record('video/covi-review.mp4', 'video');
  if (rendered.poster) await run.record('video/poster.png', 'poster');
  if (rendered.contactSheet) await run.record('video/contact-sheet.jpg', 'contact-sheet');

  logger.step('Checking the video');
  const qc = await runQc({
    video: output,
    spec,
    timeline,
    layouts: rendered.layouts,
    narrated: Boolean(audio),
    media,
  });
  await run.writeJson('video/qc.json', qc, 'qc');
  for (const check of qc.checks.filter((c) => c.status !== 'pass'))
    run.warn(`Video QC ${check.status}: ${check.message}`);

  return {
    storyboard,
    drafted,
    video: output,
    poster: rendered.poster,
    contactSheet: rendered.contactSheet,
    duration: qc.measured.duration,
    qc,
    narration,
    notes,
    renderMs: rendered.renderMs,
  };
}

/** Writes a storyboard JSON file for agents to start from (used by `covi video --draft`). */
export async function writeStoryboard(path: string, storyboard: Storyboard): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${JSON.stringify(storyboard, null, 2)}\n`);
}
