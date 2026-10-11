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
export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through' | 'pan' | 'zoom';

/**
 * Entrances that move the canvas camera from the scene before to this scene's stop: `pan` glides
 * there, `zoom` pulls back to show both stops and pushes into the next. Only direction gives them.
 */
export const CAMERA_TRANSITIONS = ['pan', 'zoom'] as const satisfies readonly TransitionKind[];
export type CameraKind = (typeof CAMERA_TRANSITIONS)[number];

export function isCameraMove(kind: TransitionKind): kind is CameraKind {
  return (CAMERA_TRANSITIONS as readonly TransitionKind[]).includes(kind);
}

/** A scene's stop on the canvas: the top-left corner of its frame-sized region, in world pixels. */
export interface Stop {
  x: number;
  y: number;
}

/** How a revealed element enters. */
export type RevealStyle = 'rise' | 'pop' | 'wipe' | 'type';
/** How a camera beat moves inside a stop. */
export type CameraMove = 'zoom' | 'pan' | 'follow';
/** How a metric element draws its number: large and counting, as bars, or before beside after. */
export type MetricShow = 'counter' | 'bars' | 'compare';

/**
 * The verbs that stage a flow: a packet travelling an edge, one thing breaking into pieces and
 * the pieces pulling back together, a pile stacking up. A shot with any of them leads as a flow;
 * a count-up only counts a counter up from zero, so its shot leads with the counter, as with a
 * count.
 */
export const FLOW_VERBS = ['flow', 'split', 'merge', 'stack'] as const;

/** Which side of the change a count is from: before it (base) or after it (head). */
export type ChangeSide = 'base' | 'head';

/** One row of a pile: the count of one side, drawn as up to twelve items and the true number. */
export interface PileRow {
  side: ChangeSide;
  count: number;
}

/** A code token's syntax color: a `tk-` class of the code panel. */
export type TokenTone = 'keyword' | 'string' | 'number' | 'comment' | 'fn' | 'type' | 'prop';

/** A token of a line a morph moves: its text (a whitespace run is layout only) and its color. */
export interface MorphToken {
  text: string;
  tone?: TokenTone;
}

/** A row of a morph's base or head layout: a line of the hunk, or a run of lines it leaves out. */
export interface MorphRow {
  type: 'context' | 'del' | 'add' | 'elided';
  /** The line's number on its side; none for an elided run. */
  number?: number;
  /** The line's tokens; an elided run has one, its marker ("… 4 lines"). */
  tokens: MorphToken[];
}

/**
 * A hunk as a morph draws it: its lines before the change (`base`) and after it (`head`), at most
 * 14 rows a side (18 on tall frames), and what moves between them. `rows` links a base row to the
 * head row it becomes (context lines, replaced lines, and elided runs on both sides); `tokens`
 * links a token that stays, as `[baseRow, baseToken, headRow, headToken]`. A token in no link is
 * removed (base) or added (head).
 */
export interface MorphVisual {
  path: string;
  language?: string;
  base: MorphRow[];
  head: MorphRow[];
  rows: Array<[number, number]>;
  tokens: Array<[number, number, number, number]>;
}

/**
 * An element of a directed scene, resolved: content from the run's evidence (never from the
 * agent, labels excepted) and its slot in stop-local stage pixels. Code, output, and captures are
 * drawn by the components that draw those visuals, inside their slot; a morph and a metric by
 * their own.
 */
export type DirectionElement =
  | { id: string; kind: 'visual'; rect: Rect }
  | { id: string; kind: 'code'; rect: Rect; visual: Extract<TimelineVisual, { kind: 'code' }> }
  | {
      id: string;
      kind: 'output';
      rect: Rect;
      visual: Extract<TimelineVisual, { kind: 'terminal' }>;
    }
  | {
      id: string;
      kind: 'capture';
      rect: Rect;
      visual: Extract<TimelineVisual, { kind: 'screenshot' }>;
    }
  | { id: string; kind: 'morph'; rect: Rect; morph: MorphVisual }
  | {
      id: string;
      kind: 'metric';
      rect: Rect;
      show: MetricShow;
      /** What the number is: the agent's label, else what the run's output called it. */
      name: string;
      unit?: string;
      /** The value before the change: where a count starts, the first bar, a compare's left. */
      from?: number;
      /** The value drawn last: after the change, or the one side a counter shows. */
      to: number;
      /** Digits after the point, the same for every value drawn. */
      decimals: number;
      /**
       * Covi's change from `from` to `to` in percent, rounded for display; absent without a
       * nonzero `from`, and for a change of 10,000% or more, too large to read as a percentage.
       */
      delta?: number;
    }
  | { id: string; kind: 'node'; rect: Rect; label: string }
  /** A packet: a pill that travels edges between nodes, or sits in its slot; it can split. */
  | { id: string; kind: 'packet'; rect: Rect; label?: string }
  /** A pile: a measured count of each side, stacked as items, with its true number. */
  | { id: string; kind: 'pile'; rect: Rect; name: string; rows: PileRow[] }
  | {
      id: string;
      kind: 'label';
      rect: Rect;
      text: string;
      tone: 'neutral' | 'warning' | 'success';
    };

/** A beat, resolved: when it starts (seconds since the scene started) and how long it takes. */
export type DirectionBeat =
  | { verb: 'reveal'; element: string; style: RevealStyle; t: number; seconds: number }
  | { verb: 'camera'; move: CameraMove; to: string; zoom?: number; t: number; seconds: number }
  | { verb: 'morph'; element: string; t: number; seconds: number }
  | { verb: 'count'; element: string; t: number; seconds: number }
  | { verb: 'flow'; from: string; to: string; packet?: string; t: number; seconds: number }
  | {
      verb: 'split';
      element: string;
      /** The pieces it breaks into: a measured count, of which at most twelve are drawn. */
      count: number;
      /** What the pieces are, as the run's output called the count. */
      name: string;
      side: ChangeSide;
      t: number;
      seconds: number;
    }
  | {
      verb: 'merge';
      element: string;
      /** What a split merges into, when the run measured exactly one on the other side. */
      into?: { count: 1; name: string; side: ChangeSide };
      t: number;
      seconds: number;
    }
  | { verb: 'stack'; element: string; t: number; seconds: number }
  | { verb: 'count-up'; element: string; value: number; t: number; seconds: number };

/** A beat the direction asked for that the resolver left out, and why. */
export interface DroppedBeat {
  verb: DirectionBeat['verb'];
  /** What it acted on. */
  element: string;
  /** Why, in a phrase the run's warning quotes after the beat's verb. */
  reason: string;
}

/** A scene's shot, resolved. */
export interface SceneDirection {
  /** The shot shows only the storyboard's visual, laid out exactly as it is without direction. */
  whole: boolean;
  elements: DirectionElement[];
  /** In time order. */
  beats: DirectionBeat[];
  /** Beats the direction asked for that cannot play where it put them; absent when none. */
  dropped?: DroppedBeat[];
}

/** What direction adds to a story scene: its stop on the canvas and its resolved shot. */
export interface SceneStaging {
  stop: Stop;
  direction: SceneDirection;
}

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
  /** Its stop on the canvas; absent when `video.direction` is off (no canvas) and on the outro. */
  stop?: Stop;
  /** Its shot: from `video/direction.json` or Covi's default director, resolved. */
  direction?: SceneDirection;
}

/**
 * A moment with a sound: a click, the before/after reveal, a finding card landing, the verdict,
 * a scene moving in, the hero (its riser and its hit), or a directed shot's motion (the camera
 * moving inside the scene, a counter counting, pieces merging, an element appearing). Timing comes
 * from `timeline/cues.ts`, which the runtime draws with too. Cues exist whether or not sound
 * effects are on, so nothing in the timeline depends on the sound choices.
 */
export interface TimelineCue {
  /** Seconds from the start of the video (a riser's is where it starts to swell). */
  t: number;
  /**
   * `outro`: the outro card settles, where the music's sonic logo lands. `camera`: the camera moves
   * inside a scene's stop (`t` mid-move). `count`: a counter counts (`t` its start, for `seconds`).
   * `merge`: merging pieces become one. `appear`: a shot's element appears.
   */
  kind:
    | 'click'
    | 'reveal'
    | 'finding'
    | 'verdict'
    | 'outro'
    | 'transition'
    | 'riser'
    | 'hero'
    | 'camera'
    | 'count'
    | 'merge'
    | 'appear';
  /** The scene id. */
  scene: string;
  /**
   * `high` for a high-severity finding; the verdict for a verdict or outro cue; the transition's
   * kind for a whoosh; the camera's move for a camera cue.
   */
  detail?: string;
  /** How long a counter counts (s): its ticks follow the count's ease over this time. */
  seconds?: number;
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
  /** Text that does not fit its box, or a pile whose items its card cannot draw at their least. */
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

/**
 * A directed scene's elements as its stop lays them out, the camera aside: each element's box
 * around all it draws, and the region the scene owns, in stage pixels (where they are on screen
 * when the camera is at rest).
 */
export interface ShotReport {
  region: Rect;
  elements: Array<{ id: string; rect: Rect }>;
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
  /** A directed scene's elements and region, while no camera move between stops is under way. */
  shot?: ShotReport;
  /**
   * The box around what the scene in front visibly draws in its region, as drawn (hidden parts
   * and empty containers left out): how much of the frame a viewer sees filled.
   */
  content?: Rect;
  /** Font families with a declared face that failed to load. */
  fontsFailed?: string[];
}

/** The API a composition page exposes on `window.covi`. */
export interface CompositionApi {
  ready: Promise<void>;
  seek(frame: number): void;
  layout(): LayoutReport;
}
