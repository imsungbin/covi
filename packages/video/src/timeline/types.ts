import type { Theme } from '@covi/brand';
/**
 * The timeline is the contract between Node (which plans and times everything) and the browser
 * runtime (which only draws a given frame). It is plain JSON so a composition can be inspected,
 * re-rendered, or debugged without re-running the pipeline.
 */

export type Expression =
  | 'neutral'
  | 'explaining'
  | 'thinking'
  | 'reviewing'
  | 'warning'
  | 'success';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** How a scene enters: the transition into it (see `motion.transitions` for their lengths). */
export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through';

/** The phase every hero scene has: its `sync.hero` phrase, else the start of its line. */
export const HERO_PHASE = 'hero';

/** The transition into a scene, resolved: its kind and its length in seconds. */
export interface SceneTransition {
  kind: TransitionKind;
  seconds: number;
}

/** Highlighted lines that light together, and the phase that lights them. */
export interface HighlightGroup {
  /** Indexes into the code's lines. */
  lines: number[];
  /** Its own `sync` name, else `highlight<N>` for the N-th entry of `highlight`. */
  phase: string;
}

/** A region of a capture the camera visits, in image pixels, with its gloss and its phase. */
export interface FrameMark {
  focus: Rect;
  /** A short gloss shown under the frame while the camera is on this mark. */
  label?: string;
  /** Its own `sync` name, else `mark<N>`, counting the marks of the whole visual. */
  phase: string;
}

/** The sound cues a storyboard scene can ask for itself (the verdict and the outro are Covi's). */
export type SceneCueKind = 'click' | 'reveal' | 'finding' | 'transition' | 'riser' | 'hero';

/** An image placed in the composition, with its natural pixel size (needed for focus math). */
export interface ImageAsset {
  src: string;
  width: number;
  height: number;
  label?: string;
}

export interface CodeLine {
  type: 'add' | 'del' | 'context';
  text: string;
  number?: number;
}

export interface FindingCard {
  title: string;
  certainty: 'confirmed' | 'likely' | 'risk' | 'question';
  severity: 'high' | 'medium' | 'low';
  location?: string;
  note?: string;
}

export type TimelineVisual =
  | {
      kind: 'title';
      title: string;
      subtitle?: string;
      eyebrow?: string;
      meta: string[];
      /** A capture the title is set over (a cold open). */
      background?: ImageAsset;
    }
  | {
      kind: 'change-map';
      areas: Array<{
        name: string;
        surface?: string;
        additions: number;
        deletions: number;
        files: number;
      }>;
    }
  | {
      kind: 'code';
      path: string;
      language?: string;
      lines: CodeLine[];
      /** Every highlighted line (indexes into `lines`). */
      highlight: number[];
      /** Lines that light together and their phases, when the storyboard grouped them. */
      groups?: HighlightGroup[];
      caption?: string;
      /** The old code first, then the deleted lines struck to ghosts and the added ones typed in. */
      mode?: 'morph';
    }
  | {
      kind: 'screenshot';
      image: ImageAsset;
      focus?: Rect;
      click?: Point;
      label?: string;
      device: 'desktop' | 'mobile';
      /** Regions the camera visits in turn; without them, `focus` is the one region. */
      marks?: FrameMark[];
    }
  | {
      kind: 'before-after';
      before: ImageAsset;
      after: ImageAsset;
      layout: 'split' | 'stack' | 'wipe';
      focus?: Rect;
      labels: { before: string; after: string };
    }
  | {
      kind: 'interaction';
      steps: Array<{
        image: ImageAsset;
        click?: Point;
        focus?: Rect;
        label?: string;
        marks?: FrameMark[];
      }>;
    }
  | { kind: 'terminal'; title?: string; command: string; output: string; before?: string }
  | {
      kind: 'api';
      method: string;
      path: string;
      before?: { status: number; body: string };
      after: { status: number; body: string };
    }
  | { kind: 'findings'; findings: FindingCard[] }
  | { kind: 'callout'; tone: 'info' | 'warning' | 'success'; title: string; body?: string }
  | {
      kind: 'diagram';
      nodes: Array<{ id: string; label: string; changed: boolean; detail?: string }>;
      edges: Array<{ from: string; to: string; label?: string }>;
    }
  | {
      kind: 'summary';
      verdict: 'looks-good' | 'needs-attention' | 'needs-changes';
      headline: string;
      points: string[];
      stats?: { files: number; additions: number; deletions: number };
    }
  /**
   * Covi's branded outro, which Covi adds after the last scene (storyboards cannot ask for it):
   * the fox and the logo, the review's verdict, and the sign-off line.
   */
  | { kind: 'outro'; verdict?: 'looks-good' | 'needs-attention' | 'needs-changes' };

export interface TimelineScene {
  id: string;
  beat: string;
  eyebrow: string;
  heading?: string;
  start: number;
  end: number;
  visual: TimelineVisual;
  expression: Expression;
  /** Hide the corner narrator (title and summary scenes feature the fox themselves). */
  narrator: boolean;
  speech?: { start: number; end: number; text: string };
  /**
   * How the scene enters, and for how long. The first scene has none. Timelines written before
   * transitions had kinds lack it: every scene faded in over `Timeline.transition`.
   */
  transition?: SceneTransition;
  /**
   * Moments the visual pins to, in seconds since the scene started, by phase name: the
   * storyboard's `sync` phrases resolved against the speech, and the hero's `hero`.
   */
  phases?: Record<string, number>;
  /** The scene where the change clicks (storyboard `hero: true`). */
  hero?: boolean;
  /** The storyboard asked the picture to hold still: no drift, no linger. */
  camera?: 'static';
  /** The evidence the scene rests on (ids in the run's evidence.json); contact sheets name it. */
  evidenceIds?: string[];
  /** The storyboard's own sound cues, at seconds since the scene started. */
  cues?: Array<{ at: number; kind: SceneCueKind }>;
}

/**
 * A moment with a sound: a click, the before/after reveal, a finding card landing, the verdict,
 * a scene moving in, or the hero (its riser and its hit). Timing comes from `timeline/cues.ts`,
 * which the runtime draws with too. Cues exist whether or not sound effects are on, so nothing in
 * the timeline depends on the sound choices.
 */
export interface TimelineCue {
  /** Seconds from the start of the video (a riser's is where it starts to swell). */
  t: number;
  /** `outro`: the outro card settles, where the music's sonic logo lands. */
  kind: 'click' | 'reveal' | 'finding' | 'verdict' | 'outro' | 'transition' | 'riser' | 'hero';
  /** The scene id. */
  scene: string;
  /**
   * `high` for a high-severity finding; the verdict for a verdict or outro cue; the transition's
   * kind for a whoosh.
   */
  detail?: string;
}

/** The key phrase in a caption line: where it is in the line and when it is spoken. */
export interface CaptionEmphasis {
  /** Index into the cue's `lines`. */
  line: number;
  /** UTF-16 offsets into that line: the phrase is `line.slice(from, to)`. */
  from: number;
  to: number;
  /** When its first character is spoken and when its last one has been, in seconds. */
  start: number;
  end: number;
}

export interface CaptionCue {
  start: number;
  end: number;
  lines: string[];
  /** The line's `[[…]]` phrase, split across lines (and cues) when it wraps. */
  emphasis?: CaptionEmphasis[];
}

/**
 * The brand theme, carried into the composition so the runtime draws with the same tokens.
 * Timelines written before `captionMark` existed lack it.
 */
export type TimelineTheme = Omit<Theme, 'captionMark'> & { captionMark?: string };

/** The video's language (`en`, `ko`, `ja`, or `zh` for Simplified Chinese). */
export type TimelineLanguage = 'en' | 'ko' | 'ja' | 'zh';

/** Fixed words the runtime draws, in the video's language. */
export interface TimelineLabels {
  verdict: Record<'looks-good' | 'needs-attention' | 'needs-changes', string>;
  certainty: Record<'confirmed' | 'likely' | 'risk' | 'question', string>;
  severity: Record<'high' | 'medium' | 'low', string>;
  stats: { files: string; added: string; removed: string };
  before: string;
  after: string;
  response: string;
  terminal: string;
  /** The outro's sign-off line ("Reviewed with Covi"). Older timelines lack it. */
  signOff?: string;
}

export interface Timeline {
  version: 1;
  /** Language of the narration, captions, and labels; sets `<html lang>` and line breaking. */
  language: TimelineLanguage;
  /** Fixed words the runtime draws (verdicts, stats, Before/After), in `language`. */
  labels?: TimelineLabels;
  title: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  frames: number;
  orientation: 'vertical' | 'landscape' | 'square';
  theme: TimelineTheme;
  fonts: {
    sans: string;
    mono: string;
    /** CJK fonts the composition embeds (only the slices its text uses), in fallback order. */
    cjk?: Array<Exclude<TimelineLanguage, 'en'>>;
  };
  mascot: boolean;
  transition: number;
  scenes: TimelineScene[];
  captions: CaptionCue[];
  /** Moments with a sound, in time order (see TimelineCue). */
  cues: TimelineCue[];
  /** Mouth openness per frame (0–1), derived from narration audio or speech timing. */
  mouth: number[];
  /** Seed for deterministic micro-motion (blinks). */
  seed: number;
}

/** Boxes reported by the runtime at sampled frames, used by QC. */
export interface LayoutItem {
  role: 'media' | 'text' | 'focus';
  rect: Rect;
  /** Text that does not fit its box. */
  overflow?: boolean;
  /**
   * The size of the item's smallest text that QC holds to a floor, in stage pixels as drawn (the
   * camera's scale included). Absent: the item has no such text.
   */
  font?: number;
  /**
   * What that text is: `code` (code, terminal output, request lines and response bodies), `body`
   * (headings, titles, notes, labels a viewer must read), or `meta` (chips, file paths, small
   * labels), which QC does not hold to a floor.
   */
  text?: 'code' | 'body' | 'meta';
}

export interface LayoutReport {
  frame: number;
  scene?: string;
  captions?: Rect;
  /** A caption line is wider than its box. */
  captionOverflow?: boolean;
  items: LayoutItem[];
  /** The narrator fox's bounds as drawn, its tail included (which can reach past its box). */
  narrator?: Rect;
  /** Boxes covering the narrator's shapes, tighter than `narrator` when the tail points. */
  narratorParts?: Rect[];
  /** The scene header's lines of text. */
  headerText?: Rect[];
  imagesLoaded: boolean;
  /** Font families with a declared face that failed to load. */
  fontsFailed?: string[];
}

/** The API a composition page exposes on `window.covi`. */
export interface CompositionApi {
  ready: Promise<void>;
  seek(frame: number): void;
  layout(): LayoutReport;
}
