import { motion, themes, typography } from '@covi/brand';
import { type Language, seedFrom, t } from '@covi/core';
import { buildCaptions, captionOptionsFor } from '../captions.ts';
import { cjkFontsFor, withCjkFamilies } from '../composition/fonts.ts';
import { orientationOf, type VideoSpec } from '../spec.ts';
import type { Scene, Storyboard, Visual } from '../storyboard/schema.ts';
import { SPEECH_RATE, speechUnits } from '../text.ts';
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
  };
}

/** Scenes overlap by the brand's transition length. */
export const TRANSITION = motion.transition;
const LEAD_IN = 0.3;
const TAIL = 0.5;
const OUTRO = 0.4;

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
  duration: number;
}

/** Narration-first timing: each scene lasts as long as its speech (plus breathing room) or its visual minimum. */
export function layoutScenes(
  scenes: readonly Scene[],
  speech: ReadonlyMap<string, number>,
  extraHold: ReadonlyMap<string, number> = new Map(),
  language: Language = 'en',
): Layout {
  const out: SceneTiming[] = [];
  let start = 0;
  scenes.forEach((scene, i) => {
    const id = scene.id ?? `s${i + 1}`;
    const talk = speech.get(id) ?? estimateSpeech(scene.say ?? scene.narration, language);
    const lead = i === 0 ? 0.2 : LEAD_IN;
    const minimum = scene.minSeconds ?? minSecondsFor(scene.visual);
    const length = Math.max(minimum, lead + talk + TAIL) + (extraHold.get(id) ?? 0);
    out.push({
      id,
      start: round(start),
      end: round(start + length),
      speechStart: round(start + lead),
      speechEnd: round(start + lead + talk),
    });
    start += length - (i < scenes.length - 1 ? TRANSITION : 0);
  });
  return { scenes: out, duration: round((out.at(-1)?.end ?? 0) + OUTRO) };
}

export interface FitResult {
  scenes: Scene[];
  layout: Layout;
  extraHold: Map<string, number>;
  /** Suggested speech tempo when the narration itself is too long (1 = unchanged). */
  tempo: number;
  notes: string[];
}

/** Fits the storyboard into the spec's duration window without touching the story's required beats. */
export function fitToDuration(
  storyboard: Storyboard,
  speech: ReadonlyMap<string, number>,
  spec: VideoSpec,
  language: Language = 'en',
): FitResult {
  const notes: string[] = [];
  let scenes = [...storyboard.scenes];
  let layout = layoutScenes(scenes, speech, new Map(), language);
  const { min, max } = spec.duration;

  while (layout.duration > max && scenes.length > 3) {
    const index = findLastIndex(scenes, (s) => Boolean(s.optional));
    if (index === -1) break;
    notes.push(`Dropped optional scene "${scenes[index]!.beat}" to fit ${Math.round(max)}s.`);
    scenes = scenes.filter((_, i) => i !== index);
    layout = layoutScenes(scenes, speech, new Map(), language);
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
    const gap = min - layout.duration;
    // Standard reviews have room to linger on evidence; short-form keeps holds tight.
    const cap = spec.duration.target > 45 ? 7 : 3;
    for (const s of visual) extraHold.set(s.id, Math.min(cap, gap / Math.max(1, visual.length)));
    layout = layoutScenes(scenes, speech, extraHold, language);
    notes.push(`Extended visual holds to reach the ${Math.round(min)}s minimum.`);
  }
  return { scenes, layout, extraHold, tempo, notes };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i]!)) return i;
  return -1;
}

const NO_NARRATOR = new Set<TimelineVisual['kind']>(['title', 'summary']);

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
  const cjk = cjkFontsFor(JSON.stringify([input.title, scenes, captions]), language);
  return {
    version: 1,
    language,
    labels: timelineLabels(language),
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
