import {
  type DemoCommandResult,
  type DemoRequestResult,
  type DemoShot,
  demoPath,
  type Flow,
  flowKept,
  type ObservedScreen,
  type Rect,
  SUBJECT_LIMITS,
  type Subject,
  type SubjectFlowObservation,
  type SubjectImage,
  type SubjectObservation,
  screenPath,
} from '@covi/core';
import { VIEWPORT_PRESETS, type ViewportName } from './browser.ts';
import type { PageScan } from './elements.ts';

/**
 * A page captured at head. Its image is the head crop of the page scenario `id`, and `window` is
 * where that crop sits in the full capture, in image pixels.
 */
export interface SubjectPage {
  /** The page scenario id, which is also its shot's id. */
  id: string;
  title?: string;
  viewport: ViewportName;
  scan: PageScan;
  window: Rect;
}

/** A flow frame taken at head; what it shows is the viewport at the scan's scroll position. */
export interface SubjectFrame {
  image: string;
  scan: PageScan;
}

export interface SubjectFlowRun {
  flow: Flow;
  viewport: ViewportName;
  /** Each step's label (from its trace step), by step index. */
  labels: Array<string | undefined>;
  passed: boolean;
  secret: boolean;
  /** Its head frames, in order. */
  frames: SubjectFrame[];
}

/** What the head revision showed in one run, as the subject model takes it. */
export interface SubjectCaptures {
  revision: string;
  pages: SubjectPage[];
  flows: SubjectFlowRun[];
  requests: DemoRequestResult[];
  commands: DemoCommandResult[];
}

/** At most this many new elements make one focus; more is a redesign, not a region. */
const MAX_FOCUS_ELEMENTS = 3;
/** CSS pixels around a focus, as flows pad the element they act on. */
const FOCUS_PAD = 12;

const scaled = (r: Rect, s: number): Rect => ({
  x: r.x * s,
  y: r.y * s,
  width: r.width * s,
  height: r.height * s,
});
const scaleOf = (viewport: ViewportName) => VIEWPORT_PRESETS[viewport].deviceScaleFactor;

/** A page's image: always its head crop, so a base image is never indexed. */
export const subjectPageImage = (page: SubjectPage) => demoPath.pageCrop(page.id, 'after');

/** What a frame shows of the page, in image pixels: the viewport where it was scrolled to. */
export function frameWindow(viewport: ViewportName, scroll: PageScan['scroll']): Rect {
  const v = VIEWPORT_PRESETS[viewport];
  const s = v.deviceScaleFactor;
  return { x: scroll.x * s, y: scroll.y * s, width: v.width * s, height: v.height * s };
}

/**
 * An element's box inside an image that shows `window` of the page, in that image's pixels.
 * Undefined when less than half of it is in the picture: a zoom on a sliver points at nothing.
 */
export function inImage(box: Rect, window: Rect): Rect | undefined {
  const left = Math.max(box.x, window.x);
  const top = Math.max(box.y, window.y);
  const right = Math.min(box.x + box.width, window.x + window.width);
  const bottom = Math.min(box.y + box.height, window.y + window.height);
  if (right <= left || bottom <= top) return undefined;
  if ((right - left) * (bottom - top) < 0.5 * box.width * box.height) return undefined;
  return {
    x: Math.round(left - window.x),
    y: Math.round(top - window.y),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

function screenOf(scan: PageScan, viewport: ViewportName, title?: string): ObservedScreen {
  const s = scaleOf(viewport);
  const { width, height } = VIEWPORT_PRESETS[viewport];
  return {
    path: scan.path,
    ...(title ? { title } : {}),
    viewport,
    size: { width, height },
    elements: scan.elements.map((e) => ({
      selector: e.selector,
      key: e.key,
      ...(e.role ? { role: e.role } : {}),
      ...(e.label ? { label: e.label } : {}),
      ...(e.secret ? { secret: true } : {}),
      box: scaled(e.box, s),
    })),
  };
}

function flowOf(run: SubjectFlowRun, labelled: boolean): SubjectFlowObservation {
  return {
    name: run.flow.name,
    path: run.flow.path,
    viewport: run.viewport,
    steps: run.flow.steps.map((action, i) => {
      const label = labelled ? run.labels[i] : undefined;
      return { action, ...(label ? { label } : {}) };
    }),
    passed: run.passed,
    ...(run.secret ? { secret: true } : {}),
  };
}

/**
 * The observation the model merges. Flow frames come before page loads, so where a page load put
 * an element is what the model keeps. A flow the model will not keep (it failed, typed a secret,
 * or is not one Covi would replay) gives it nothing it saw: no step labels and no frames, since
 * either may hold what it typed. Commands keep their name and exit code, never the command.
 */
export function subjectObservation(captures: SubjectCaptures): SubjectObservation {
  // A field any scan of this run marked secret makes a flow that types into it secret.
  const secretSelectors = new Set(
    [
      ...captures.pages.map((p) => p.scan),
      ...captures.flows.flatMap((f) => f.frames.map((x) => x.scan)),
    ].flatMap((scan) => scan.elements.filter((e) => e.secret).map((e) => e.selector)),
  );
  const flows = captures.flows.map((run) => ({
    run,
    kept: flowKept(flowOf(run, false), secretSelectors) === 'kept',
  }));
  return {
    revision: captures.revision,
    screens: [
      ...flows.flatMap(({ run, kept }) =>
        kept ? run.frames.map((f) => screenOf(f.scan, run.viewport)) : [],
      ),
      ...captures.pages.map((p) => screenOf(p.scan, p.viewport, p.title)),
    ],
    flows: flows.map(({ run, kept }) => flowOf(run, kept)),
    commands: [
      ...captures.commands.map((c) => ({
        kind: 'cli' as const,
        name: c.name,
        exitCode: c.after.exitCode,
      })),
      ...captures.requests.map((r) => ({
        kind: 'http' as const,
        name: r.name,
        method: r.method.toUpperCase(),
        path: r.path,
        status: r.after.status,
      })),
    ],
  };
}

/**
 * Where each element of the model is in each head image this run took: what a storyboard's
 * `subject:<screen>#<element>` resolves to. Each box is placed by that image's own crop offset or
 * scroll. Images of screens the model does not have are skipped.
 */
export function subjectImages(
  model: Subject,
  captures: Pick<SubjectCaptures, 'pages' | 'flows'>,
): SubjectImage[] {
  const shown = [
    ...captures.pages.map((p) => ({
      path: subjectPageImage(p),
      viewport: p.viewport,
      scan: p.scan,
      window: p.window,
    })),
    ...captures.flows.flatMap((run) =>
      run.frames.map((f) => ({
        path: f.image,
        viewport: run.viewport,
        scan: f.scan,
        window: frameWindow(run.viewport, f.scan.scroll),
      })),
    ),
  ];
  const images: SubjectImage[] = [];
  for (const s of shown.slice(0, SUBJECT_LIMITS.images)) {
    const path = screenPath(s.scan.path);
    const screen = path ? model.screens.find((x) => x.path === path) : undefined;
    if (!screen) continue;
    const scale = scaleOf(s.viewport);
    const elements = s.scan.elements.flatMap((e) => {
      const key = screen.elements.find((x) => x.selector === e.selector)?.key;
      const rect = key ? inImage(scaled(e.box, scale), s.window) : undefined;
      return key && rect ? [{ key, ...rect }] : [];
    });
    images.push({
      path: s.path,
      screen: screen.key,
      viewport: s.viewport,
      elements: elements.slice(0, SUBJECT_LIMITS.elements),
    });
  }
  return images;
}

/**
 * A focus for a page capture no pixel diff located: the elements new since the model last saw
 * this screen at this viewport. Undefined when the model never saw it there, nothing is new, more
 * than three things are, or the region would cover more than half the picture.
 */
export function subjectFocus(
  before: Subject,
  page: SubjectPage,
  size: { width: number; height: number },
): Rect | undefined {
  const path = screenPath(page.scan.path);
  const known = path ? before.screens.find((s) => s.path === path) : undefined;
  if (!known?.viewports.some((v) => v.name === page.viewport)) return undefined;
  const selectors = new Set(known.elements.map((e) => e.selector));
  const added = page.scan.elements.filter((e) => !selectors.has(e.selector));
  if (!added.length || added.length > MAX_FOCUS_ELEMENTS) return undefined;
  const scale = scaleOf(page.viewport);
  const rects = added
    .map((e) => inImage(scaled(e.box, scale), page.window))
    .filter((r): r is Rect => r !== undefined);
  if (!rects.length) return undefined;
  const pad = FOCUS_PAD * scale;
  const x = Math.max(0, Math.min(...rects.map((r) => r.x)) - pad);
  const y = Math.max(0, Math.min(...rects.map((r) => r.y)) - pad);
  const right = Math.min(size.width, Math.max(...rects.map((r) => r.x + r.width)) + pad);
  const bottom = Math.min(size.height, Math.max(...rects.map((r) => r.y + r.height)) + pad);
  const rect = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
  };
  return rect.width * rect.height <= 0.5 * size.width * size.height ? rect : undefined;
}

/**
 * Gives the model's focus to page shots taken at head only (the app ran at head only, or base
 * could not be captured), and returns their ids. A shot compared with base is left alone: its
 * pixel diff, or the lack of one, already says where the change is, and the model would point at
 * elements this change did not touch.
 */
export function focusShots(before: Subject, pages: SubjectPage[], shots: DemoShot[]): string[] {
  const focused: string[] = [];
  for (const shot of shots) {
    if (shot.kind !== 'page' || shot.before || shot.diff || shot.focus || !shot.after) continue;
    const page = pages.find((p) => p.id === shot.id);
    const focus = page && subjectFocus(before, page, shot.after);
    if (!focus) continue;
    shot.focus = focus;
    focused.push(shot.id);
  }
  return focused;
}
