import { motion, themes, typography } from '@covi/brand';
import { type Language, seedFrom, t } from '@covi/core';
import { buildCaptions, type CaptionOptions, captionOptionsFor, phraseTime } from '../captions.ts';
import { cjkFontsFor, withCjkFamilies } from '../composition/fonts.ts';
import { orientationOf, timingPreset, type VideoSpec } from '../spec.ts';
import { findPhrase, parseEmphasis, stripEmphasis } from '../storyboard/grammar.ts';
import type { Scene, Storyboard, Visual } from '../storyboard/schema.ts';
import { heroScene } from '../templates.ts';
import { SPEECH_RATE, speechUnits } from '../text.ts';
import { buildCues } from './cues.ts';
import {
  type CaptionCue,
  type Expression,
  HERO_PHASE,
  type ImageAsset,
  type SceneTransition,
  type Timeline,
  type TimelineLabels,
  type TimelineScene,
  type TimelineVisual,
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

/** How a scene enters: its own transition, else zoom-through into the hero, else a fade. */
export function sceneTransition(scene: Pick<Scene, 'transition' | 'hero'>): SceneTransition {
  const kind = scene.transition ?? (scene.hero ? 'zoom-through' : 'fade');
  return { kind, seconds: motion.transitions[kind] };
}

/** A line's caption window: its speech, at least 0.9 s long so a short line's cue can be read. */
function captionWindow(speech: { text: string; start: number; end: number }) {
  return { ...speech, end: Math.max(speech.end, speech.start + 0.9) };
}

/**
 * The moments a scene's visual pins to, in seconds since the scene started: each `sync` phrase
 * placed in the line's caption window with the captions' own split, and the hero's `hero` (its
 * `sync.hero` phrase, else the start of its line). `text` is the narration without markup, the
 * line the captions show, even when the voice reads `say`: the speech is timed only as a whole,
 * so the captions' split of the narration is the one measure of when a phrase is heard, phrases
 * are validated against the narration, and a visual pinned to it lands with its caption.
 */
export function scenePhases(
  scene: Pick<Scene, 'sync' | 'hero'>,
  text: string,
  timing: SceneTiming,
  options: CaptionOptions,
): Record<string, number> | undefined {
  const phases: Record<string, number> = {};
  const caption = captionWindow({ text, start: timing.speechStart, end: timing.speechEnd });
  for (const [name, phrase] of Object.entries(scene.sync ?? {})) {
    const span = findPhrase(text, phrase);
    // Redaction can rewrite a line after it was validated: a phrase it hid, or made ambiguous,
    // pins nothing.
    if (span.count !== 1) continue;
    const time = phraseTime(caption, span, options);
    if (time) phases[name] = round(time.start - timing.start);
  }
  if (scene.hero && phases[HERO_PHASE] === undefined)
    phases[HERO_PHASE] = round(timing.speechStart - timing.start);
  return Object.keys(phases).length ? phases : undefined;
}
/** The pause between one line and the next at an ordinary scene change. */
export const LINE_GAP = 0.35;
/** At most this share of a transition plays over the end of the line before it… */
const OVER_LINE = 0.5;
/** …and the next line starts this far into it: the picture arrives with the words. */
const INTO_LINE = 0.6;
/** The hero holds its picture this long after its line before the next scene takes over. */
export const HERO_HOLD = 0.4;
/** Without the outro, the last scene lingers this long after its last word, then the hold. */
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

/**
 * When the transition into the next scene starts: as late as it can while the next line still
 * starts within its first 60%, and never with more than half of it over the line before. With
 * lines `LINE_GAP` apart, the scene before ends at most 0.35 + 0.4·d after its line.
 */
export function cutStart(lineEnd: number, nextLine: number, seconds: number): number {
  return Math.max(lineEnd - OVER_LINE * seconds, nextLine - INTO_LINE * seconds);
}

/** The outro's length by timing preset: a little longer for walkthroughs than for feeds. */
export const OUTRO_SECONDS = { short: 2.4, standard: 2.8 } as const;
/** The outro's scene id: storyboard ids are lowercase letters, digits, and dashes, so none is it. */
export const OUTRO_ID = 'covi:outro';

/**
 * How a video breathes around its narration. Everything here comes from the kind of video and
 * the story, never from the music, so changing only the sound keeps every frame.
 */
export interface Pacing {
  /** Seconds before the first scene's line: at most 0.3, so the hook is heard by 0.5 s. */
  firstLead: number;
  /** The template's payoff beats, in priority order: the first scene playing one is the hero. */
  hero?: readonly string[];
  /** Seconds from the hero scene settling (its start plus the transition) to its line. */
  heroBreath?: number;
  /**
   * Extra lead before the line after the hook, the line after the hero, the summary's line, and a
   * line that ends a long stretch of talk.
   */
  breath?: number;
  /** Seconds of talk after which the next scene change takes a breath. */
  chapter?: number;
  /** Seconds of the branded outro after the last scene; without it, the last scene holds 1 s. */
  outro?: number;
}

/** Tight timing: lines follow one another, and the video holds its last scene (no outro). */
export const TIGHT: Pacing = { firstLead: 0.2 };

/**
 * Narrated standard reviews breathe: the hook is heard at once, then the music opens in a breath
 * before the second line; the hero scene settles before its line so the music's lift lands clear
 * of speech, and the line after it breathes again; the verdict lands before the summary's line;
 * and long stretches of talk pause at a scene change. A music placement that plays only around
 * the narration (bookends) is heard in exactly these breaths.
 */
const BREATHING = { firstLead: 0.3, heroBreath: 1.4, breath: 1.25, chapter: 24 } as const;

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
      return 1.5;
    case 'summary':
      return 3.4;
    case 'code':
      return 2;
    case 'before-after':
      return 2.5;
    case 'interaction':
      return 1.2 * visual.steps.length;
    case 'terminal':
      return visual.before ? 4.4 : 3.4;
    case 'api':
      return visual.before ? 4.6 : 3.6;
    case 'findings':
      return 2 + 0.4 * visual.findings.length;
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
 * Narration-first timing, line by line. Lines are `LINE_GAP` apart at an ordinary scene change,
 * and the transition into each scene starts where `cutStart` puts it. A scene stays up for its
 * visual's minimum, and the next line waits for it; the hero holds `HERO_HOLD` after its line. A
 * breath belongs to the scene after it: the transition starts as at any scene change and the new
 * picture holds the breath, so no scene outstays its line by more than 0.6 s. The video ends with
 * the outro or a short hold.
 */
export function layoutScenes(
  scenes: readonly Scene[],
  speech: ReadonlyMap<string, number>,
  extraHold: ReadonlyMap<string, number> = new Map(),
  language: Language = 'en',
  pacing: Pacing = TIGHT,
): Layout {
  // The hero: a scene marked `hero`, else the template's payoff beats (for its breath).
  const hero = heroScene(scenes, pacing.hero);
  const summary = findLastIndex(scenes, (s) => s.visual.kind === 'summary');
  const minimum = (s: Scene) => s.minSeconds ?? minSecondsFor(s.visual);
  const out: SceneTiming[] = [];
  // When the line after the latest breath (or a pause as long as one) started.
  let breathed = 0;
  scenes.forEach((scene, i) => {
    const id = scene.id ?? `s${i + 1}`;
    const talk =
      speech.get(id) ?? estimateSpeech(stripEmphasis(scene.say ?? scene.narration), language);
    if (i === 0) {
      out.push({
        id,
        start: 0,
        end: 0,
        speechStart: pacing.firstLead,
        speechEnd: pacing.firstLead + talk,
      });
      breathed = pacing.firstLead;
      return;
    }
    const previous = out[i - 1]!;
    const before = scenes[i - 1]!;
    const { seconds } = sceneTransition(scene);
    // Where the line before ends for the cut: the hero, and any hold asked for, stay a little.
    const lineEnd =
      previous.speechEnd + (before.hero ? HERO_HOLD : 0) + (extraHold.get(previous.id) ?? 0);
    const nextLine = lineEnd + LINE_GAP;
    const start = Math.max(
      cutStart(lineEnd, nextLine, seconds),
      previous.start + minimum(before) - seconds,
    );
    let lead = Math.max(nextLine - start, INTO_LINE * seconds);
    if (i === hero && pacing.heroBreath !== undefined)
      lead = Math.max(lead, seconds + pacing.heroBreath);
    else if (pacing.breath) {
      const chapter = pacing.chapter !== undefined && start + lead - breathed > pacing.chapter;
      const afterHero = hero !== undefined && i === hero + 1;
      if (i === 1 || afterHero || i === summary || chapter) lead += pacing.breath;
    }
    previous.end = start + seconds;
    if (start + lead - previous.speechEnd >= BREATH_GAP) breathed = start + lead;
    out.push({ id, start, end: 0, speechStart: start + lead, speechEnd: start + lead + talk });
  });
  const last = out.at(-1);
  if (last) {
    const scene = scenes.at(-1)!;
    const tail =
      (pacing.outro ? LAST_TAIL : TAIL) +
      (scene.hero ? HERO_HOLD : 0) +
      (extraHold.get(last.id) ?? 0);
    last.end = Math.max(last.start + minimum(scene), last.speechEnd + tail);
  }
  const timed = out.map((s) => ({
    id: s.id,
    start: round(s.start),
    end: round(s.end),
    speechStart: round(s.speechStart),
    speechEnd: round(s.speechEnd),
  }));
  const end = timed.at(-1)?.end ?? 0;
  if (pacing.outro && timed.length) {
    // The outro enters like any scene, overlapping the last one by its fade.
    const outro = { start: round(end - TRANSITION), end: round(end - TRANSITION + pacing.outro) };
    return { scenes: timed, outro, duration: outro.end };
  }
  return { scenes: timed, duration: round(end + HOLD) };
}

export interface FitResult {
  scenes: Scene[];
  layout: Layout;
  /** Suggested speech tempo when the narration itself is too long (1 = unchanged). */
  tempo: number;
  notes: string[];
}

/**
 * Fits the storyboard under the spec's duration window without touching the story's required
 * beats or its hero. The window is an upper bound: a video is as long as its narration needs,
 * so a short one is never padded. The pacing (breaths and the outro) counts toward the length.
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
  const { max } = spec.duration;

  while (layout.duration > max && scenes.length > 3) {
    const index = findLastIndex(scenes, (s) => Boolean(s.optional) && !s.hero);
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
  return { scenes, layout, tempo, notes };
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
  const captionOptions = { ...captionOptionsFor(orientation), language };
  const scenes: TimelineScene[] = input.scenes.map((scene, i) => {
    const timing = layout.scenes[i]!;
    const visual = toTimelineVisual(scene.visual, input.image);
    // The markup only marks the caption's emphasis: speech, captions, and reports get the text.
    const text = parseEmphasis(scene.narration).text;
    const phases = scenePhases(scene, text, timing, captionOptions);
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
      speech: text.trim() ? { start: timing.speechStart, end: timing.speechEnd, text } : undefined,
      ...(i > 0 ? { transition: sceneTransition(scene) } : {}),
      ...(phases ? { phases } : {}),
      ...(scene.hero ? { hero: true } : {}),
      ...(scene.camera === 'static' ? { camera: 'static' as const } : {}),
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
      transition: { kind: 'fade', seconds: TRANSITION },
    });
  }
  const captions: CaptionCue[] = spec.captions
    ? buildCaptions(
        scenes.filter((s) => s.speech).map((s) => captionWindow(s.speech!)),
        captionOptions,
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
    case 'title': {
      const { background, ...rest } = visual;
      return background
        ? { ...rest, background: { ...image(background.path), label: background.label } }
        : rest;
    }
    default:
      return visual as TimelineVisual;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
