import type { FindingInput } from './finding.ts';

/**
 * What the Demonstrate phase captured. Paths are relative to the run directory; image coordinates
 * are in image pixels so later stages (video focus, cursor emphasis) can place overlays exactly.
 */
export interface ImageRef {
  path: string;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DemoShot {
  id: string;
  kind: 'page' | 'flow-step';
  /** URL path for pages, step label for flows. */
  name: string;
  flow?: string;
  step?: number;
  viewport: 'desktop' | 'tablet' | 'mobile';
  before?: ImageRef;
  after?: ImageRef;
  /** Pixel comparison of before/after (same viewport). */
  diff?: { path?: string; changedRatio: number; bounds?: Rect };
  click?: { x: number; y: number };
  focus?: Rect;
  label?: string;
}

export interface DemoCommandResult {
  name: string;
  command: string;
  before?: { exitCode: number | null; output: string };
  after: { exitCode: number | null; output: string };
  changed: boolean;
}

export interface DemoRequestResult {
  name: string;
  method: string;
  path: string;
  before?: { status: number; body: string; contentType?: string };
  after: { status: number; body: string; contentType?: string };
  changed: boolean;
  /** Human-readable description of a JSON shape change, when one was observed. */
  shapeChange?: string;
}

export interface Demonstration {
  schemaVersion: 1;
  app?: { mode: 'static' | 'command' | 'url'; revisions: Array<'base' | 'head'> };
  shots: DemoShot[];
  commands: DemoCommandResult[];
  requests: DemoRequestResult[];
  /** Things Covi decided not to (or could not) demonstrate, with the reason. */
  skipped: Array<{ what: string; reason: string }>;
  /** Findings observed while running the software (e.g. an API response shape changed). */
  findings: FindingInput[];
}
