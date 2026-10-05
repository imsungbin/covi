import { motion, themes, typography } from '@covi/brand';
import { type Language, seedFrom, t } from '@covi/core';
import { buildCaptions, captionOptionsFor } from '../captions.ts';
import { cjkFontsFor, withCjkFamilies } from '../composition/fonts.ts';
import { orientationOf, timingPreset, type VideoSpec } from '../spec.ts';
import type { Scene, Storyboard, Visual } from '../storyboard/schema.ts';
import { heroScene } from '../templates.ts';
import { SPEECH_RATE, speechUnits } from '../text.ts';
import { buildCues } from './cues.ts';
import type {
  CaptionCue,
  Expression,
  ImageAsset,
  Timeline,
  TimelineLabels,
  TimelineScene,
  TimelineVisual,
} from './types.ts';

/** The labels a video draws, from the message catalog of its language. */
export function timelineLabels(language: Language): TimelineLabels {
  const say = (key: string) => t(language, `video.label.${key}`);
  return {
    verdict: {
      'looks-good': say('verdict.looks-good'),
      'needs-attention': say('verdict.needs-attention'),
      'needs-changes': say('verdict.needs-changes'),
    },
    certainty: {
      confirmed: say('certainty.confirmed'),
      likely: say('certainty.likely'),
      risk: say('certainty.risk'),
      question: say('certainty.question'),
    },
    severity: {
      high: say('severity.high'),
      medium: say('severity.medium'),
      low: say('severity.low'),
    },
    stats: { files: say('stats.files'), added: say('stats.added'), removed: say('stats.removed') },
    before: say('before'),
    after: say('after'),
    response: say('response'),
    terminal: say('terminal'),
    signOff: say('signOff'),
  };
}

/** Scenes overlap by the brand's transition length. */
export const TRANSITION = motion.transition;
const LEAD_IN = 0.3;
const TAIL = 0.5;
/** Before the outro, the last scene lingers a moment after its last word. */
const LAST_TAIL = 0.8;
/**
 * Without the outro, the video holds its last scene this long: room for the sonic logo's pickup
 * after the last line, whatever the music; frames never depend on the music choice.
 */
const HOLD = 1;
/** A pause between two lines at least this long already breathes (bookends music rises in it). */
const BREATH_GAP = 1.5;

/** The outro's length by timing preset: a little longer for walkthroughs than for feeds. */
export const OUTRO_SECONDS = { short: 2.4, standard: 2.8 } as const;
/** The outro's scene id: storyboard ids are lowercase letters, digits, and dashes, so none is it. */
export const OUTRO_ID = 'covi:outro';

/**
 * How a video breathes around its narration. Everything here comes from the kind of video and
 * the story, never from the music, so changing only the sound keeps every frame.
 */
export interface Pacing {
  /** Seconds before the first scene's line. */
  firstLead: number;
  /** The template's payoff beats, in priority order: the first scene playing one is the hero. */
  hero?: readonly string[];
  /** Seconds from the hero scene settling (its start plus the transition) to its line. */
  heroBreath?: number;
  /** Extra lead before the summary's line, and before a line that ends a long stretch of talk. */
  breath?: number;
  /** Seconds of talk after which the next scene change takes a breath. */
  chapter?: number;
  /** Seconds of the branded outro after the last scene; without it, the last scene holds 1 s. */
  outro?: number;
}

/** Tight timing: lines follow one another, and the video holds its last scene (no outro). */
export const TIGHT: Pacing = { firstLead: 0.2 };

/**
 * Narrated standard reviews breathe: the title card holds while the music opens, the hero scene
 * settles before its line so the music's lift lands clear of speech, the verdict lands before the
 * summary's line, and long stretches of talk pause at a scene change. A music placement that
 * plays only around the narration (bookends) is heard in exactly these breaths.
 */
const BREATHING = { firstLead: 2, heroBreath: 1.4, breath: 1.25, chapter: 24 } as const;

/**
 * The pacing of a video: breaths for narrated standard reviews (short-form keeps its tight timing),
 * and the outro unless it is off. `narrated` says whether a voice actually speaks: a video whose
 * narration could not be synthesized is paced as captions only.
 */
export function pacingFor(
  spec: Pick<VideoSpec, 'mode' | 'width' | 'height' | 'narration' | 'outro'>,
  hero?: readonly string[],
  narrated = spec.narration.enabled,
): Pacing {
  const preset = timingPreset(spec);
  const breathe = narrated && preset === 'standard';
  return {
    ...(breathe ? { ...BREATHING, ...(hero ? { hero } : {}) } : TIGHT),
    // Specs saved before the outro existed have no setting; the outro is on by default.
    ...(spec.outro === false ? {} : { outro: OUTRO_SECONDS[preset] }),
  };
}

/** The least time a visual needs on screen to be read, regardless of narration length. */
export function minSecondsFor(visual: Visual): number {
  switch (visual.kind) {
    case 'title':
      return 2.6;
    case 'summary':
      return 3.4;
    case 'code':
      return 3.4 + Math.min(1.4, visual.lines.length * 0.07);
    case 'before-after':
      return 4.2;
    case 'interaction':
      return Math.max(3.6, visual.steps.length * 1.7);
    case 'terminal':
      return visual.before ? 4.4 : 3.4;
    case 'api':
      return visual.before ? 4.6 : 3.6;
    case 'findings':
      return 3.2 + visual.findings.length * 0.6;
    case 'diagram':
      return 3.8;
    default:
      return 3;
  }
}

/** Speaking time estimated from text when no audio exists (2.5 words per second in English). */
export function estimateSpeech(text: string, language: Language = 'en'): number {
  const units = speechUnits(text, language);
  return units === 0 ? 0 : units / SPEECH_RATE[language] + 0.25;
}

export interface SceneTiming {
  id: string;
  start: number;
  end: number;
  speechStart: number;
  speechEnd: number;
}

export interface Layout {
  scenes: SceneTiming[];
  /** The branded outro, after the last scene (overlapping it by the transition). */
  outro?: { start: number; end: number };
  duration: number;
}

/**
 * Narration-first timing: each scene lasts as long as its speech (plus breathing room) or its
 * visual minimum, and the video ends with the outro or a short hold.
 */
export function layoutScenes(
  scenes: readonly Scene[],
  speech: ReadonlyMap<string, number>,
  extraHold: ReadonlyMap<string, number> = new Map(),
  language: Language = 'en',
  pacing: Pacing = TIGHT,
): Layout {
  const hero = pacing.hero ? heroScene(scenes, pacing.hero) : undefined;
  const summary = findLastIndex(scenes, (s) => s.visual.kind === 'summary');
  const out: SceneTiming[] = [];
  let start = 0;
  // When the line after the latest breath (or a pause as long as one) started.
  let breathed = 0;
  scenes.forEach((scene, i) => {
    const id = scene.id ?? `s${i + 1}`;
    const talk = speech.get(id) ?? estimateSpeech(scene.say ?? scene.narration, language);
    let lead = i === 0 ? pacing.firstLead : LEAD_IN;
    if (i === hero && pacing.heroBreath !== undefined)
      lead = Math.max(lead, TRANSITION + pacing.heroBreath);
    else if (i > 0 && pacing.breath) {
      const chapter = pacing.chapter !== undefined && start + lead - breathed > pacing.chapter;
      if (i === summary || chapter) lead += pacing.breath;
    }
    const tail = i === scenes.length - 1 && pacing.outro ? LAST_TAIL : TAIL;
    const minimum = scene.minSeconds ?? minSecondsFor(scene.visual);
    const length = Math.max(minimum, lead + talk + tail) + (extraHold.get(id) ?? 0);
    const previous = out.at(-1);
    if (!previous || start + lead - previous.speechEnd >= BREATH_GAP) breathed = start + lead;
    out.push({
      id,
      start: round(start),
      end: round(start + length),
      speechStart: round(start + lead),
      speechEnd: round(start + lead + talk),
    });
    start += length - (i < scenes.length - 1 ? TRANSITION : 0);
  });
  const end = out.at(-1)?.end ?? 0;
  if (pacing.outro && out.length) {
    // The outro enters like any scene, overlapping the last one by the transition.
    const outro = { start: round(end - TRANSITION), end: round(end - TRANSITION + pacing.outro) };
    return { scenes: out, outro, duration: outro.end };
  }
  return { scenes: out, duration: round(end + HOLD) };
}

export interface FitResult {
  scenes: Scene[];
  layout: Layout;
  extraHold: Map<string, number>;
  /** Suggested speech tempo when the narration itself is too long (1 = unchanged). */
  tempo: number;
  notes: string[];
}

/**
 * Fits the storyboard into the spec's duration window without touching the story's required
 * beats. The pacing (breaths and the outro) is part of the length it fits.
 */
export function fitToDuration(
  storyboard: Storyboard,
  speech: ReadonlyMap<string, number>,
  spec: VideoSpec,
  language: Language = 'en',
  pacing: Pacing = pacingFor(spec),
): FitResult {
  const notes: string[] = [];
  let scenes = [...storyboard.scenes];
  let layout = layoutScenes(scenes, speech, new Map(), language, pacing);
  const { min, max } = spec.duration;

  while (layout.duration > max && scenes.length > 3) {
    const index = findLastIndex(scenes, (s) => Boolean(s.optional));
    if (index === -1) break;
    notes.push(`Dropped optional scene "${scenes[index]!.beat}" to fit ${Math.round(max)}s.`);
    scenes = scenes.filter((_, i) => i !== index);
    layout = layoutScenes(scenes, speech, new Map(), language, pacing);
  }
  let tempo = 1;
  if (layout.duration > max) {
    tempo = Math.min(1.15, layout.duration / max);
    notes.push(
      `Narration runs ${Math.round(layout.duration)}s for a ${Math.round(max)}s maximum; speeding speech up ${Math.round((tempo - 1) * 100)}%.`,
    );
  }

  const extraHold = new Map<string, number>();
  if (layout.duration < min) {
    // Give visual scenes more time rather than padding silence at the end.
    const visual = layout.scenes.filter(
      (_, i) => !['title', 'summary'].includes(scenes[i]!.visual.kind),
    );
    // Standard reviews have room to linger on evidence; short-form keeps holds tight.
    const cap = spec.duration.target > 45 ? 7 : 3;
    // A hold long enough to breathe in stands in for a pause after long talk, so the layout can
    // come out shorter than the holds add: top it up again until it reaches the minimum.
    for (let pass = 0; pass < 3 && layout.duration < min - 1e-6; pass++) {
      const gap = (min - layout.duration) / Math.max(1, visual.length);
      for (const s of visual) extraHold.set(s.id, Math.min(cap, (extraHold.get(s.id) ?? 0) + gap));
      layout = layoutScenes(scenes, speech, extraHold, language, pacing);
    }
    notes.push(`Extended visual holds to reach the ${Math.round(min)}s minimum.`);
  }
  return { scenes, layout, extraHold, tempo, notes };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i]!)) return i;
  return -1;
}

const NO_NARRATOR = new Set<TimelineVisual['kind']>(['title', 'summary', 'outro']);

type Verdict = Extract<TimelineVisual, { kind: 'summary' }>['verdict'];

export interface BuildTimelineInput {
  title: string;
  scenes: readonly Scene[];
  layout: Layout;
  spec: VideoSpec;
  /** Resolves a run-relative image path to its composition asset. */
  image: (path: string) => ImageAsset;
  mouth?: number[];
  /** The narration's language: line breaking, reading speed, fonts. Default: English. */
  language?: Language;
  /** The review's verdict, for the outro when the storyboard has no summary. */
  verdict?: Verdict;
}

/** The scenes of the story itself: the timeline's scenes without Covi's outro. */
export function storyScenes<S extends Pick<TimelineScene, 'visual'>>(scenes: readonly S[]): S[] {
  return scenes.filter((s) => s.visual.kind !== 'outro');
}

export function buildTimeline(input: BuildTimelineInput): Timeline {
  const { spec, layout } = input;
  const language = input.language ?? 'en';
  const orientation = orientationOf(spec.width, spec.height);
  const frames = Math.round(layout.duration * spec.fps);
  const scenes: TimelineScene[] = input.scenes.map((scene, i) => {
    const timing = layout.scenes[i]!;
    const visual = toTimelineVisual(scene.visual, input.image);
    return {
      id: timing.id,
      beat: scene.beat,
      eyebrow: scene.eyebrow ?? scene.beat,
      heading: scene.heading,
      start: timing.start,
      end: timing.end,
      visual,
      expression: (scene.expression ?? 'explaining') as Expression,
      narrator: spec.mascot && !NO_NARRATOR.has(visual.kind),
      speech: scene.narration
        ? { start: timing.speechStart, end: timing.speechEnd, text: scene.narration }
        : undefined,
    };
  });
  if (layout.outro) {
    // The summary's verdict, else the review's: the same one the music ends on.
    const summary = scenes.findLast((s) => s.visual.kind === 'summary')?.visual;
    const verdict = summary?.kind === 'summary' ? summary.verdict : input.verdict;
    scenes.push({
      id: OUTRO_ID,
      beat: 'outro',
      eyebrow: '',
      start: layout.outro.start,
      end: layout.outro.end,
      visual: { kind: 'outro', ...(verdict ? { verdict } : {}) },
      expression: 'neutral',
      narrator: false,
    });
  }
  const captions: CaptionCue[] = spec.captions
    ? buildCaptions(
        scenes
          .filter((s) => s.speech)
          .map((s) => ({
            text: s.speech!.text,
            start: s.speech!.start,
            end: Math.max(s.speech!.end, s.speech!.start + 0.9),
          })),
        { ...captionOptionsFor(orientation), language },
      )
    : [];
  // Fonts follow the text that will be drawn, so CJK in a code excerpt is covered too.
  const labels = timelineLabels(language);
  const cjk = cjkFontsFor(JSON.stringify([input.title, scenes, captions, labels]), language);
  return {
    version: 1,
    language,
    labels,
    title: input.title,
    width: spec.width,
    height: spec.height,
    fps: spec.fps,
    duration: layout.duration,
    frames,
    orientation,
    theme: themes[spec.theme],
    fonts: {
      sans: withCjkFamilies(typography.sans, cjk),
      mono: withCjkFamilies(typography.mono, cjk),
      ...(cjk.length ? { cjk } : {}),
    },
    mascot: spec.mascot,
    transition: TRANSITION,
    scenes,
    captions,
    cues: buildCues(scenes),
    mouth: input.mouth ?? [],
    seed: seedFrom(input.title),
  };
}

function toTimelineVisual(visual: Visual, image: (path: string) => ImageAsset): TimelineVisual {
  switch (visual.kind) {
    case 'screenshot':
      return {
        kind: 'screenshot',
        image: { ...image(visual.image.path), label: visual.image.label },
        focus: visual.focus,
        click: visual.click,
        label: visual.label,
        device: visual.device,
      };
    case 'before-after':
      return {
        kind: 'before-after',
        before: image(visual.before.path),
        after: image(visual.after.path),
        layout: visual.layout ?? 'split',
        focus: visual.focus,
        labels: visual.labels,
      };
    case 'interaction':
      return {
        kind: 'interaction',
        steps: visual.steps.map((s) => ({
          image: image(s.image.path),
          click: s.click,
          focus: s.focus,
          label: s.label,
        })),
      };
    default:
      return visual as TimelineVisual;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
