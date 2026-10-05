import { LANGUAGE_NAME, wordCount } from '@covi/core';
import { localeLanguage, type SpeechRecord, unspokenAcronyms } from './narration/speech.ts';
import { suggestedVoice } from './narration/tts.ts';
import type { Media } from './render/ffmpeg.ts';
import type { VideoSpec } from './spec.ts';
import type { LayoutReport, Rect, Timeline } from './timeline/types.ts';

export type QcStatus = 'pass' | 'warn' | 'fail';

export interface QcCheck {
  id: string;
  status: QcStatus;
  message: string;
}

export interface QcReport {
  status: QcStatus;
  checks: QcCheck[];
  measured: {
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
    loudness?: number;
    meanVolume?: number;
  };
}

export interface QcInput {
  video: string;
  spec: VideoSpec;
  timeline: Timeline;
  layouts: readonly LayoutReport[];
  narrated: boolean;
  media: Media;
  /** `video/speech.json`: the text each scene's voice was given. */
  speech?: SpeechRecord;
}

function intersects(a: Rect, b: Rect, tolerance = 2): boolean {
  return (
    a.x + tolerance < b.x + b.width &&
    b.x + tolerance < a.x + a.width &&
    a.y + tolerance < b.y + b.height &&
    b.y + tolerance < a.y + a.height
  );
}

function within(inner: Rect, outer: Rect, tolerance = 4): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

/** Layout checks run on reports sampled during rendering; they need no video file. */
export function layoutChecks(timeline: Timeline, layouts: readonly LayoutReport[]): QcCheck[] {
  const checks: QcCheck[] = [];
  const frame = { x: 0, y: 0, width: timeline.width, height: timeline.height };
  const covered: string[] = [];
  const outside: number[] = [];
  const overflow = new Set<string>();
  const narratorOverlap = new Set<string>();
  let imagesLoaded = true;
  for (const report of layouts) {
    imagesLoaded &&= report.imagesLoaded;
    if (report.captions) {
      if (!within(report.captions, frame)) outside.push(report.frame);
      for (const item of report.items) {
        if (item.role !== 'text' && intersects(report.captions, item.rect))
          covered.push(`${report.scene ?? '?'}@${report.frame}`);
      }
    }
    for (const item of report.items) if (item.overflow) overflow.add(report.scene ?? '?');
    if (report.narrator) {
      for (const item of report.items)
        if (item.role !== 'text' && intersects(report.narrator, item.rect, 6))
          narratorOverlap.add(report.scene ?? '?');
    }
  }
  checks.push(
    covered.length
      ? {
          id: 'captions-clear-of-content',
          status: 'fail',
          message: `Captions cover demonstrated content in ${covered.slice(0, 3).join(', ')}.`,
        }
      : {
          id: 'captions-clear-of-content',
          status: 'pass',
          message: 'Captions never cover demonstrated content.',
        },
  );
  checks.push(
    outside.length
      ? {
          id: 'captions-in-frame',
          status: 'fail',
          message: `Captions leave the frame at frames ${outside.slice(0, 3).join(', ')}.`,
        }
      : { id: 'captions-in-frame', status: 'pass', message: 'Captions stay inside the safe area.' },
  );
  checks.push(
    overflow.size
      ? {
          id: 'text-fits',
          status: 'warn',
          message: `Text is clipped in scene(s) ${[...overflow].join(', ')}; shorten the storyboard text.`,
        }
      : { id: 'text-fits', status: 'pass', message: 'All text fits its box.' },
  );
  checks.push(
    narratorOverlap.size
      ? {
          id: 'narrator-clear-of-content',
          status: 'warn',
          message: `The narrator overlaps content in scene(s) ${[...narratorOverlap].join(', ')}.`,
        }
      : {
          id: 'narrator-clear-of-content',
          status: 'pass',
          message: 'The narrator never covers the product.',
        },
  );
  checks.push(
    imagesLoaded
      ? { id: 'images', status: 'pass', message: 'Every image loaded.' }
      : {
          id: 'images',
          status: 'fail',
          message: 'At least one image failed to load in the composition.',
        },
  );
  return checks;
}

/** Timing checks on the timeline itself (caption reading speed, narration pace). */
export function timingChecks(timeline: Timeline): QcCheck[] {
  const checks: QcCheck[] = [];
  const fast = timeline.captions.filter(
    (c) => c.lines.join(' ').length / Math.max(0.01, c.end - c.start) > 24,
  );
  const short = timeline.captions.filter((c) => c.end - c.start < 0.7);
  const overlapping = timeline.captions.filter(
    (c, i) => i > 0 && c.start < timeline.captions[i - 1]!.end - 0.001,
  );
  if (overlapping.length)
    checks.push({
      id: 'caption-timing',
      status: 'fail',
      message: `${overlapping.length} caption cue(s) overlap.`,
    });
  else if (fast.length || short.length) {
    checks.push({
      id: 'caption-timing',
      status: 'warn',
      message: `${fast.length + short.length} caption cue(s) flash by too quickly to read comfortably.`,
    });
  } else
    checks.push({
      id: 'caption-timing',
      status: 'pass',
      message: `${timeline.captions.length} caption cues, all readable.`,
    });

  const rushed = timeline.scenes.filter(
    (s) =>
      s.speech && wordCount(s.speech.text) / Math.max(0.1, s.speech.end - s.speech.start) > 4.2,
  );
  checks.push(
    rushed.length
      ? {
          id: 'narration-pace',
          status: 'warn',
          message: `Narration is rushed in scene(s) ${rushed.map((s) => s.id).join(', ')}.`,
        }
      : { id: 'narration-pace', status: 'pass', message: 'Narration pace is natural.' },
  );
  return checks;
}

/**
 * Checks on what the voice was given. Voices for Korean, Japanese, and Chinese misread Latin
 * acronyms, and a voice for one language reads another badly; neither shows in the frames.
 */
export function speechChecks(speech: SpeechRecord | undefined): QcCheck[] {
  if (!speech?.narrated)
    return [
      { id: 'speech-acronyms', status: 'pass', message: 'No narration; nothing is spoken.' },
      { id: 'voice-language', status: 'pass', message: 'No narration; no voice to check.' },
    ];
  const name = LANGUAGE_NAME[speech.language];
  const checks: QcCheck[] = [];
  if (speech.language === 'en') {
    checks.push({
      id: 'speech-acronyms',
      status: 'pass',
      message: 'English voices spell acronyms themselves.',
    });
  } else {
    const found = speech.scenes
      .map((s) => ({ id: s.id, tokens: unspokenAcronyms(s.spoken) }))
      .filter((s) => s.tokens.length);
    checks.push(
      found.length
        ? {
            id: 'speech-acronyms',
            status: 'warn',
            message: `The ${name} voice is given Latin acronyms it may misread: ${found
              .map((s) => `${s.tokens.map((t) => `"${t}"`).join(', ')} in scene ${s.id}`)
              .join(
                '; ',
              )}. Write the spoken form in the scene's \`say\`, or add them to video.narration.pronunciations.`,
          }
        : {
            id: 'speech-acronyms',
            status: 'pass',
            message: `Every acronym reaches the ${name} voice spelled out.`,
          },
    );
  }
  const voice = speech.voice;
  const speaks = localeLanguage(voice?.locale);
  if (!voice?.locale || !speaks)
    checks.push({
      id: 'voice-language',
      status: 'pass',
      message: `Voice language not checked: ${voice ? `${voice.provider} voices are multilingual` : 'no voice'}.`,
    });
  else if (speaks !== speech.language) {
    const example = suggestedVoice(voice.provider, speech.language);
    checks.push({
      id: 'voice-language',
      status: 'warn',
      message: `The voice ${voice.name} speaks ${voice.locale}, but the narration is ${name}. Choose a ${name} voice with --voice${example ? ` (for example ${example})` : ''} or video.narration.voice.`,
    });
  } else
    checks.push({
      id: 'voice-language',
      status: 'pass',
      message: `The voice ${voice.name} (${voice.locale}) speaks ${name}.`,
    });
  return checks;
}

export async function runQc(input: QcInput): Promise<QcReport> {
  const { spec, media, video } = input;
  const checks: QcCheck[] = [];
  const probe = await media.probe(video);
  const measured: QcReport['measured'] = {
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
  };

  const formatOk =
    probe.width === spec.width &&
    probe.height === spec.height &&
    Math.abs((probe.fps ?? 0) - spec.fps) < 0.01;
  checks.push(
    formatOk && probe.pixFmt === 'yuv420p'
      ? {
          id: 'format',
          status: 'pass',
          message: `${probe.width}×${probe.height} at ${spec.fps} fps, ${probe.videoCodec}/${probe.pixFmt}.`,
        }
      : {
          id: 'format',
          status: 'fail',
          message: `Expected ${spec.width}×${spec.height}@${spec.fps} yuv420p, got ${probe.width}×${probe.height}@${probe.fps?.toFixed(2)} ${probe.pixFmt}.`,
        },
  );

  const { min, max } = spec.duration;
  const d = probe.duration;
  if (d >= min - 0.5 && d <= max + 0.5)
    checks.push({
      id: 'duration',
      status: 'pass',
      message: `${d.toFixed(1)}s (target ${Math.round(spec.duration.target)}s).`,
    });
  else
    checks.push({
      id: 'duration',
      status: d > max * 1.5 || d < min * 0.5 ? 'fail' : 'warn',
      message: `${d.toFixed(1)}s is outside ${Math.round(min)}–${Math.round(max)}s.`,
    });

  if (input.narrated) {
    if (!probe.audioCodec)
      checks.push({
        id: 'audio',
        status: 'fail',
        message: 'Narration was produced but the video has no audio stream.',
      });
    else {
      const stats = await media.analyze([
        '-i',
        video,
        '-vn',
        '-af',
        'ebur128=framelog=quiet,volumedetect',
        '-f',
        'null',
        '-',
      ]);
      const loudness = Number(
        /I:\s*(-?[\d.]+) LUFS/.exec(stats.slice(stats.lastIndexOf('Summary')))?.[1],
      );
      const mean = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(stats)?.[1]);
      measured.loudness = Number.isFinite(loudness) ? loudness : undefined;
      measured.meanVolume = Number.isFinite(mean) ? mean : undefined;
      if (!Number.isFinite(mean) || mean < -50)
        checks.push({ id: 'audio', status: 'fail', message: 'The audio track is silent.' });
      else if (Number.isFinite(loudness) && (loudness < -26 || loudness > -12)) {
        checks.push({
          id: 'audio',
          status: 'warn',
          message: `Integrated loudness ${loudness.toFixed(1)} LUFS is outside −26…−12.`,
        });
      } else
        checks.push({
          id: 'audio',
          status: 'pass',
          message: `Narration present at ${Number.isFinite(loudness) ? `${loudness.toFixed(1)} LUFS` : `${mean} dB mean`}.`,
        });
    }
  } else {
    checks.push(
      input.spec.narration.enabled
        ? {
            id: 'audio',
            status: 'warn',
            message:
              'Narration was requested but no speech engine was available; captions carry the story.',
          }
        : {
            id: 'audio',
            status: 'pass',
            message: 'No narration requested; captions carry the story.',
          },
    );
  }

  const black = await media.analyze([
    '-i',
    video,
    '-an',
    '-vf',
    'blackdetect=d=0.4:pix_th=0.05',
    '-f',
    'null',
    '-',
  ]);
  const blackSegments = black.match(/black_start/g)?.length ?? 0;
  checks.push(
    blackSegments
      ? {
          id: 'black-frames',
          status: 'warn',
          message: `${blackSegments} stretch(es) of black frames.`,
        }
      : { id: 'black-frames', status: 'pass', message: 'No black frames.' },
  );

  checks.push(
    ...layoutChecks(input.timeline, input.layouts),
    ...timingChecks(input.timeline),
    ...speechChecks(input.speech),
  );
  const status: QcStatus = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return { status, checks, measured };
}
