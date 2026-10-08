import { LANGUAGE_NAME } from '@covi/core';
import { localeLanguage, type SpeechRecord, unspokenAcronyms } from './narration/speech.ts';
import { suggestedVoice } from './narration/tts.ts';
import type { Media } from './render/ffmpeg.ts';
import { computeRegions } from './runtime/layout.ts';
import { type AudioRecord, musicLibrary } from './sound.ts';
import type { VideoSpec } from './spec.ts';
import { CAPTION_SPEED_LIMIT, captionCharacters, PACE_LIMIT, speechUnits } from './text.ts';
import { storyScenes } from './timeline/build.ts';
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
    truePeak?: number;
    meanVolume?: number;
  };
}

export interface QcInput {
  video: string;
  spec: VideoSpec;
  timeline: Timeline;
  layouts: readonly LayoutReport[];
  /** The video has a voice (narration was synthesized). */
  narrated: boolean;
  media: Media;
  /** `video/speech.json`: the text each scene's voice was given. */
  speech?: SpeechRecord;
  /** `video/audio.json`: the music, the effects, and the levels of the mix. */
  audio?: AudioRecord;
}

/** What ffmpeg measured on the video's audio stream. */
export interface AudioMeasure {
  stream: boolean;
  /** Integrated loudness (LUFS). */
  integrated?: number;
  /** True peak (dBTP). */
  truePeak?: number;
  /** The loudest sample (dBFS), to tell a silent stream. */
  maxVolume?: number;
  meanVolume?: number;
}

/** Loudness targets of the master: a narrated video, and music without narration. */
const LOUDNESS = { narrated: -16, music: -20 } as const;

/**
 * The audio stream: present and not silent whenever narration, music, or effects play; at the
 * target loudness (±1 LU passes, ±2 warns); and with headroom (a true peak at or below −1 dBTP;
 * above −0.5 fails).
 */
export function audioCheck(
  m: AudioMeasure,
  sound: { narrated: boolean; music: boolean; effects: boolean; narrationRequested: boolean },
): QcCheck {
  const missingVoice =
    sound.narrationRequested && !sound.narrated
      ? 'Narration was requested but no speech engine was available; captions carry the story.'
      : undefined;
  if (!sound.narrated && !sound.music && !sound.effects)
    return missingVoice
      ? { id: 'audio', status: 'warn', message: missingVoice }
      : {
          id: 'audio',
          status: 'pass',
          message:
            'No sound: narration, music, and sound effects are off, so there is no audio track.',
        };
  if (!m.stream)
    return {
      id: 'audio',
      status: 'fail',
      message: 'Sound was mixed but the video has no audio stream.',
    };
  if (m.maxVolume === undefined || !(m.maxVolume > -60))
    return { id: 'audio', status: 'fail', message: 'The audio track is silent.' };
  const ranks: QcStatus[] = [];
  const parts: string[] = [];
  const target = sound.narrated ? LOUDNESS.narrated : sound.music ? LOUDNESS.music : undefined;
  if (target !== undefined && m.integrated !== undefined && Number.isFinite(m.integrated)) {
    const off = Math.abs(m.integrated - target);
    ranks.push(off <= 1 ? 'pass' : off <= 2 ? 'warn' : 'fail');
    parts.push(`${m.integrated.toFixed(1)} LUFS (target ${target})`);
  } else if (m.integrated !== undefined && Number.isFinite(m.integrated)) {
    parts.push(`${m.integrated.toFixed(1)} LUFS (effects only, no target)`);
  }
  if (m.truePeak !== undefined && Number.isFinite(m.truePeak)) {
    ranks.push(m.truePeak <= -1 ? 'pass' : m.truePeak <= -0.5 ? 'warn' : 'fail');
    parts.push(`true peak ${m.truePeak.toFixed(1)} dBTP`);
  }
  if (missingVoice) ranks.push('warn');
  const status = worst(ranks);
  const heard = [
    sound.narrated && 'narration',
    sound.music && 'music',
    sound.effects && 'sound effects',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    id: 'audio',
    status,
    message: `${missingVoice ? `${missingVoice} ` : ''}${heard[0]!.toUpperCase()}${heard.slice(1)} at ${parts.join(', ')}.`,
  };
}

function worst(statuses: readonly QcStatus[]): QcStatus {
  return statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass';
}

/** Music a viewer should hear outside the logo: at least 3 s, or 5% of the video when that is more. */
export function audibleMusicWanted(duration: number): number {
  return Math.max(3, 0.05 * duration);
}

/**
 * The duration window is an upper bound: Covi never pads a video to fill it, so a short video
 * passes. It warns past the maximum, fails past 1.5× it, and warns under the window only when
 * someone asked for that length.
 */
export function durationCheck(seconds: number, window: VideoSpec['duration']): QcCheck {
  const { min, max, target } = window;
  if (seconds > max + 0.5)
    return {
      id: 'duration',
      status: seconds > max * 1.5 ? 'fail' : 'warn',
      message: `${seconds.toFixed(1)}s is longer than the ${Math.round(max)}s maximum.`,
    };
  if (!window.auto && seconds < min - 0.5)
    return {
      id: 'duration',
      status: 'warn',
      message: `${seconds.toFixed(1)}s is shorter than the ${Math.round(target)}s asked for (${Math.round(min)}–${Math.round(max)}s). Covi does not pad a video: give it more to say.`,
    };
  return {
    id: 'duration',
    status: 'pass',
    message: `${seconds.toFixed(1)}s (up to ${Math.round(max)}s; target ${Math.round(target)}s).`,
  };
}

/** How long the picture may freeze under narration before the scene reads as a slide (s). */
export const STILL_SECONDS = 1.5;
/** ffmpeg freezedetect's noise tolerance: −60 dB, its default. A 2% drift is never frozen. */
export const STILL_NOISE = 0.001;

/** A stretch of video whose media region did not change. */
export interface Freeze {
  start: number;
  end: number;
}

/** ffmpeg `freezedetect` output → frozen stretches; one still frozen at the end runs to `duration`. */
export function parseFreezes(stderr: string, duration: number): Freeze[] {
  const freezes: Freeze[] = [];
  let open: number | undefined;
  for (const m of stderr.matchAll(/lavfi\.freezedetect\.freeze_(start|end):\s*(-?[\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === 'start') open = t;
    else if (open !== undefined) {
      freezes.push({ start: open, end: t });
      open = undefined;
    }
  }
  if (open !== undefined) freezes.push({ start: open, end: duration });
  return freezes;
}

/** The media region as an ffmpeg crop (`w:h:x:y`), on even pixels for 4:2:0 video. */
export function mediaCrop(timeline: Pick<Timeline, 'width' | 'height' | 'orientation'>): string {
  const m = computeRegions(timeline).media;
  const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2);
  const x = even(m.x);
  const y = even(m.y);
  const w = even(Math.min(m.width, timeline.width - x));
  const h = even(Math.min(m.height, timeline.height - y));
  return `${w}:${h}:${x}:${y}`;
}

/**
 * The picture keeps moving while the narration speaks: a freeze of the media region that covers
 * 1.5 s or more of the lines (summed over the lines it spans) is a still, named by its scene.
 */
export function stillCheck(
  timeline: Pick<Timeline, 'scenes'>,
  freezes: readonly Freeze[],
): QcCheck {
  const stills: Array<{ scene: string; seconds: number; at: number }> = [];
  for (const f of freezes) {
    let spoken = 0;
    let scene: string | undefined;
    for (const s of storyScenes(timeline.scenes)) {
      if (!s.speech) continue;
      const overlap = Math.min(f.end, s.speech.end) - Math.max(f.start, s.speech.start);
      if (overlap <= 0) continue;
      spoken += overlap;
      scene ??= s.id;
    }
    if (scene && spoken >= STILL_SECONDS - 1e-6)
      stills.push({ scene, seconds: spoken, at: f.start });
  }
  if (!stills.length)
    return {
      id: 'still',
      status: 'pass',
      message: 'The picture keeps moving while the narration speaks.',
    };
  return {
    id: 'still',
    status: 'warn',
    message: `The picture holds still while the narration continues in ${stills
      .slice(0, 3)
      .map((s) => `${s.scene} (${s.seconds.toFixed(1)} s from ${s.at.toFixed(1)} s)`)
      .join(
        ', ',
      )}${stills.length > 3 ? ', …' : ''}. Split the scene, sync its visual to the line, or let the camera drift.`,
  };
}

/**
 * Runs `freezedetect` on the media region of the rendered video and checks it. The filter needs
 * ffmpeg 4.2 or newer; when it cannot run, the gate is skipped with a warning, so a diagnostic
 * never fails the render.
 */
export async function measureStill(
  media: Pick<Media, 'analyze'>,
  video: string,
  timeline: Pick<Timeline, 'scenes' | 'width' | 'height' | 'orientation'>,
  duration: number,
): Promise<QcCheck> {
  let frozen: string;
  try {
    frozen = await media.analyze([
      ...['-i', video, '-an'],
      ...['-vf', `crop=${mediaCrop(timeline)},freezedetect=n=${STILL_NOISE}:d=${STILL_SECONDS}`],
      ...['-f', 'null', '-'],
    ]);
  } catch (error) {
    return {
      id: 'still',
      status: 'warn',
      message: `Could not measure still pictures (ffmpeg 4.2 or newer has freezedetect): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return stillCheck(timeline, parseFreezes(frozen, duration));
}

/** The first line is heard within half a second: the hook comes first. */
export const HOOK_SECONDS = 0.5;

export function hookCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const first = storyScenes(timeline.scenes).find((s) => s.speech)?.speech;
  if (!first) return { id: 'hook', status: 'pass', message: 'No narration.' };
  return first.start <= HOOK_SECONDS + 1e-6
    ? {
        id: 'hook',
        status: 'pass',
        message: `The first line starts at ${first.start.toFixed(2)} s.`,
      }
    : {
        id: 'hook',
        status: 'warn',
        message: `The first line starts at ${first.start.toFixed(2)} s; the hook should be heard by ${HOOK_SECONDS} s.`,
      };
}

/** Narration should fill most of the story: below this share the pictures wait on silence. */
export const SPEECH_SHARE = 0.7;

export function speechShareCheck(timeline: Pick<Timeline, 'scenes'>): QcCheck {
  const story = storyScenes(timeline.scenes);
  const end = story.at(-1)?.end ?? 0;
  const spoken = story.reduce(
    (n, s) => n + (s.speech ? Math.max(0, s.speech.end - s.speech.start) : 0),
    0,
  );
  if (spoken <= 0 || end <= 0)
    return { id: 'speech-share', status: 'pass', message: 'No narration.' };
  const share = `${Math.round((100 * spoken) / end)}%`;
  return spoken / end < SPEECH_SHARE - 1e-9
    ? {
        id: 'speech-share',
        status: 'warn',
        message: `Narration fills ${share} of the story before the outro (70% wanted): the pictures wait on silence. Cut holds, or give quiet scenes a line.`,
      }
    : {
        id: 'speech-share',
        status: 'pass',
        message: `Narration fills ${share} of the story before the outro.`,
      };
}

/**
 * Checks on the mix itself, read from `video/audio.json`: the music under the narration, the
 * music's fit to the picture (the logo after the last line, the landing before the end, the hero
 * on its downbeat, the tempo, a silent end), how much of the music is heard at all, and the
 * effects' spacing and level.
 */
export function soundChecks(
  record: AudioRecord,
  limits: { fps: number; minSpacing: number; maxPerSecond: number },
): QcCheck[] {
  const checks: QcCheck[] = [];
  const music = record.music;
  const below = record.levels.musicBelowVoiceDb;
  if (below === undefined)
    checks.push({
      id: 'music-under-speech',
      status: 'pass',
      message: 'No music plays under the narration.',
    });
  else {
    const continuous = music.placement === 'continuous';
    const status: QcStatus = continuous
      ? below >= 18
        ? 'pass'
        : below >= 12
          ? 'warn'
          : 'fail'
      : below >= 30
        ? 'pass'
        : 'warn';
    checks.push({
      id: 'music-under-speech',
      status,
      message: `Music sits ${below.toFixed(1)} dB under the voice where it speaks (${music.placement}: ${continuous ? 'at least 18' : 'at least 30'} dB; WCAG 1.4.7 asks for 20).`,
    });
  }

  if (music.error)
    checks.push({
      id: 'music-fit',
      status: 'warn',
      message: `The music could not be rendered (${music.error}); the video kept its voice and sound effects.`,
    });
  else if (music.bpm === undefined || !music.logo)
    checks.push({ id: 'music-fit', status: 'pass', message: `No music: ${music.reason}` });
  else {
    const fails: string[] = [];
    const warns: string[] = [];
    const lastLine = music.lastLine ?? 0;
    if (music.logo.start < lastLine + 0.1 - 1e-6)
      fails.push(
        `the logo starts at ${music.logo.start.toFixed(2)} s, over the last line (ends ${lastLine.toFixed(2)} s)`,
      );
    if (music.logo.landing > record.duration - 0.8 + 1e-6)
      warns.push(
        `the logo lands ${(record.duration - music.logo.landing).toFixed(2)} s before the end (0.8 s wanted)`,
      );
    if (
      music.outro !== undefined &&
      Math.abs(music.logo.landing - music.outro) > 1 / limits.fps + 1e-6
    )
      warns.push(
        music.fallbacks?.find((f) => /outro/.test(f)) ??
          `the logo lands ${(music.logo.landing - music.outro).toFixed(2)} s off the outro`,
      );
    if (music.hero && Math.abs(music.hero.downbeat - music.hero.moment) > 1 / limits.fps + 1e-6)
      warns.push(
        music.fallbacks?.find((f) => /hero/.test(f)) ??
          `the hero downbeat is ${(music.hero.downbeat - music.hero.moment).toFixed(2)} s off the payoff`,
      );
    const tempo = music.scoreBpm ? music.bpm / music.scoreBpm - 1 : 0;
    if (Math.abs(tempo) > 0.06 + 1e-9)
      warns.push(`the tempo moved ${(tempo * 100).toFixed(1)}% from the score's, beyond ±6%`);
    if ((music.tailDb ?? -120) > -60)
      fails.push(
        `the music's last 10 ms peak at ${music.tailDb!.toFixed(1)} dBFS (below −60 wanted)`,
      );
    checks.push(
      fails.length || warns.length
        ? {
            id: 'music-fit',
            status: fails.length ? 'fail' : 'warn',
            message: `Music fit: ${[...fails, ...warns].join('; ')}.`,
          }
        : {
            id: 'music-fit',
            status: 'pass',
            message: `${music.id} at ${music.bpm.toFixed(1)} bpm (score ${music.scoreBpm}): the logo follows the last line and lands ${music.outro === undefined ? '' : 'as the outro settles, '}${(record.duration - music.logo.landing).toFixed(2)} s before the end${music.hero ? '; the hero is on its downbeat' : ''}.`,
          },
    );
  }

  checks.push(musicAudibleCheck(record));

  const effects = record.effects;
  if (!effects.enabled)
    checks.push({ id: 'sound-effects', status: 'pass', message: 'Sound effects are off.' });
  else {
    const times = effects.placed.map((p) => p.t).sort((a, b) => a - b);
    const crowded = times.some((t, i) => i > 0 && t - times[i - 1]! < limits.minSpacing - 1e-6);
    const max = limits.maxPerSecond;
    const dense = times.some((t, i) => i >= max && t - times[i - max]! < 1 - 1e-6);
    const level = record.levels.effectsBelowVoiceDb;
    const quiet: QcStatus =
      level === undefined ? 'pass' : level >= 6 ? 'pass' : level >= 3 ? 'warn' : 'fail';
    const status = crowded || dense ? 'fail' : quiet;
    // With music, the outro's sign-off gives way to the music's own logo: not a crowding drop.
    const logo = effects.dropped.filter((d) => d.kind === 'outro').length;
    checks.push({
      id: 'sound-effects',
      status,
      message: crowded
        ? `Two effects are closer than ${limits.minSpacing} s.`
        : dense
          ? `More than ${max} effects play within one second.`
          : `${effects.placed.length} effect(s) placed, ${effects.dropped.length - logo} dropped to keep them apart${logo ? "; the music's sonic logo marks the outro" : ''}${level === undefined ? '' : `; their peaks sit ${level.toFixed(1)} dB under the voice's (at least 6 wanted)`}.`,
    });
  }
  return checks;
}

/**
 * Whether the music asked for is heard: timing alone passes music that sits inaudibly under the
 * voice. Warns when it is heard for less than 3 s (or 5% of the video) outside the logo, or when
 * the hero's downbeat falls under speech where bookends hold the music down.
 */
function musicAudibleCheck(record: AudioRecord): QcCheck {
  const music = record.music;
  if (music.use === 'none')
    return { id: 'music-audible', status: 'pass', message: 'Music is off.' };
  if (!music.audible)
    return { id: 'music-audible', status: 'pass', message: `No music to hear: ${music.reason}` };
  const { seconds } = music.audible;
  const wanted = audibleMusicWanted(record.duration);
  const share = `${(100 * music.audible.share).toFixed(1)}% of the video`;
  const problems: string[] = [];
  if (seconds < wanted - 1e-9)
    problems.push(
      `the music is heard for ${seconds.toFixed(2)} s outside the logo (${share}; at least ${wanted.toFixed(2)} s wanted)`,
    );
  if (music.placement === 'bookends' && music.hero && music.hero.clear === false)
    problems.push(
      `the hero downbeat at ${music.hero.downbeat.toFixed(2)} s falls under speech, where bookends hold the music down`,
    );
  if (problems.length)
    return {
      id: 'music-audible',
      status: 'warn',
      message: `Music audibility: ${problems.join('; ')}.${music.placement === 'bookends' ? ' Bookends play music only around the narration: leave it room to breathe, or choose --music-placement continuous.' : ''}`,
    };
  const hero = music.hero?.clear ? '; the hero downbeat is clear of speech' : '';
  return {
    id: 'music-audible',
    status: 'pass',
    message: `The music is heard for ${seconds.toFixed(2)} s outside the logo (${share}; at least ${wanted.toFixed(2)} s wanted)${hero}.`,
  };
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
  const regions = computeRegions(timeline);
  const covered: string[] = [];
  const outside: number[] = [];
  const spilled: number[] = [];
  const overflow = new Set<string>();
  const narratorOverlap = new Map<string, Set<string>>();
  let imagesLoaded = true;
  const fontsFailed = new Set<string>();
  for (const report of layouts) {
    imagesLoaded &&= report.imagesLoaded;
    for (const family of report.fontsFailed ?? []) fontsFailed.add(family);
    if (report.captions) {
      if (!within(report.captions, frame)) outside.push(report.frame);
      if (report.captionOverflow) spilled.push(report.frame);
      for (const item of report.items) {
        if (item.role !== 'text' && intersects(report.captions, item.rect))
          covered.push(`${report.scene ?? '?'}@${report.frame}`);
      }
    }
    for (const item of report.items) if (item.overflow) overflow.add(report.scene ?? '?');
    // The fox's real shapes: its tail can reach past its box, but only into empty space.
    const fox = report.narratorParts ?? (report.narrator ? [report.narrator] : []);
    const covers = (rects: readonly Rect[], what: string) => {
      if (fox.some((part) => rects.some((rect) => intersects(part, rect)))) {
        const scenes = narratorOverlap.get(what) ?? new Set<string>();
        scenes.add(report.scene ?? '?');
        narratorOverlap.set(what, scenes);
      }
    };
    covers(
      report.items.map((item) => item.rect),
      'demonstrated content',
    );
    covers([regions.media], 'the media region');
    covers(report.captions ? [report.captions] : [], 'captions');
    covers(report.headerText ?? [], 'header text');
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
      : spilled.length
        ? {
            id: 'captions-in-frame',
            status: 'fail',
            message: `A caption line is wider than the caption box at frames ${spilled.slice(0, 3).join(', ')}.`,
          }
        : {
            id: 'captions-in-frame',
            status: 'pass',
            message: 'Captions stay inside the safe area.',
          },
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
          message: `The narrator covers ${[...narratorOverlap]
            .map(([what, scenes]) => `${what} in scene(s) ${[...scenes].join(', ')}`)
            .join('; ')}.`,
        }
      : {
          id: 'narrator-clear-of-content',
          status: 'pass',
          message: 'The narrator, tail included, never covers the product, captions, or headers.',
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
  checks.push(
    fontsFailed.size
      ? {
          id: 'fonts',
          status: 'fail',
          message: `The bundled font ${[...fontsFailed].join(', ')} did not load, so text fell back to this machine's fonts (boxes where it has none).`,
        }
      : { id: 'fonts', status: 'pass', message: 'Every bundled font loaded.' },
  );
  return checks;
}

/**
 * Timing checks on the timeline itself: caption reading speed and narration pace, in the units
 * and limits of the video's language, then the hook and the speech share. Pace counts the text
 * the voice was given when it is known.
 */
export function timingChecks(timeline: Timeline, speech?: SpeechRecord): QcCheck[] {
  const checks: QcCheck[] = [];
  const language = timeline.language ?? 'en';
  const fast = timeline.captions.filter(
    (c) =>
      captionCharacters(c.lines, language) / Math.max(0.01, c.end - c.start) >
      CAPTION_SPEED_LIMIT[language],
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

  const spoken = new Map(speech?.scenes.map((s) => [s.id, s.spoken]));
  const rushed = timeline.scenes.filter(
    (s) =>
      s.speech &&
      speechUnits(spoken.get(s.id) ?? s.speech.text, language) /
        Math.max(0.1, s.speech.end - s.speech.start) >
        PACE_LIMIT[language],
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
  checks.push(hookCheck(timeline), speechShareCheck(timeline));
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
  if (voice?.provider === 'system' && !voice.locale && speech.language !== 'en')
    checks.push({
      id: 'voice-language',
      status: 'warn',
      message: `Covi could not read the system voice list, so it could not confirm that ${voice.name} speaks ${name}. Check the narration, or choose a voice with --voice.`,
    });
  else if (!voice?.locale || !speaks)
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

  checks.push(durationCheck(probe.duration, spec.duration));

  const audioMeasure: AudioMeasure = { stream: Boolean(probe.audioCodec) };
  if (probe.audioCodec) {
    const stats = await media.analyze([
      ...['-i', video, '-vn', '-af', 'ebur128=framelog=quiet:peak=true,volumedetect'],
      ...['-f', 'null', '-'],
    ]);
    const summary = stats.slice(stats.lastIndexOf('Summary'));
    const number = (re: RegExp, text = summary) => {
      const n = Number(re.exec(text)?.[1]);
      return Number.isFinite(n) ? n : undefined;
    };
    audioMeasure.integrated = number(/I:\s*(-?[\d.]+) LUFS/);
    audioMeasure.truePeak = number(/Peak:\s*(-?[\d.]+) dBFS/);
    audioMeasure.maxVolume = number(/max_volume:\s*(-?[\d.]+) dB/, stats);
    audioMeasure.meanVolume = number(/mean_volume:\s*(-?[\d.]+) dB/, stats);
    measured.loudness = audioMeasure.integrated;
    measured.truePeak = audioMeasure.truePeak;
    measured.meanVolume = audioMeasure.meanVolume;
  }
  const record = input.audio;
  checks.push(
    audioCheck(audioMeasure, {
      narrated: input.narrated,
      music: Boolean(record?.levels && record.music.bpm !== undefined && !record.music.error),
      effects: Boolean(record?.effects.placed.length),
      narrationRequested: input.spec.narration.enabled,
    }),
  );
  if (record) {
    const { minSpacing, maxPerSecond } = musicLibrary().soundEffects;
    checks.push(...soundChecks(record, { fps: spec.fps, minSpacing, maxPerSecond }));
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
  checks.push(await measureStill(media, video, input.timeline, probe.duration));

  checks.push(
    ...layoutChecks(input.timeline, input.layouts),
    ...timingChecks(input.timeline, input.speech),
    ...speechChecks(input.speech),
  );
  const status: QcStatus = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return { status, checks, measured };
}
