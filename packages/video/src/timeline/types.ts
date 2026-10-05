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
  | { kind: 'title'; title: string; subtitle?: string; eyebrow?: string; meta: string[] }
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
      highlight: number[];
      caption?: string;
    }
  | {
      kind: 'screenshot';
      image: ImageAsset;
      focus?: Rect;
      click?: Point;
      label?: string;
      device: 'desktop' | 'mobile';
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
      steps: Array<{ image: ImageAsset; click?: Point; focus?: Rect; label?: string }>;
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
    };

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
}

export interface CaptionCue {
  start: number;
  end: number;
  lines: string[];
}

/** The brand theme, carried into the composition so the runtime draws with the same tokens. */
export type TimelineTheme = Theme;

/** The video's language (`en`, `ko`, `ja`, or `zh` for Simplified Chinese). */
export type TimelineLanguage = 'en' | 'ko' | 'ja' | 'zh';

export interface Timeline {
  version: 1;
  /** Language of the narration, captions, and labels; sets `<html lang>` and line breaking. */
  language: TimelineLanguage;
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
}

export interface LayoutReport {
  frame: number;
  scene?: string;
  captions?: Rect;
  /** A caption line is wider than its box. */
  captionOverflow?: boolean;
  items: LayoutItem[];
  narrator?: Rect;
  imagesLoaded: boolean;
}

/** The API a composition page exposes on `window.covi`. */
export interface CompositionApi {
  ready: Promise<void>;
  seek(frame: number): void;
  layout(): LayoutReport;
}
