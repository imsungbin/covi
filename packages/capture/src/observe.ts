import type { MutationSummary, Rect } from '@covi/core';
import type { Page, Request } from 'playwright';
import { mergeRegions } from './regions.ts';
import type { TraceCollector } from './trace.ts';

/** The init script remembers at most this many changed elements. */
const MAX_TARGETS = 200;

/**
 * Counts DOM changes once the page has loaded and remembers which elements changed (at most 200).
 * Changes inside <head>, Covi's own style tag among them, are not the app's behavior. Written as a
 * string because this package compiles without DOM types.
 */
export const MUTATION_SCRIPT = `(() => {
  if (window.__coviMutations) return;
  const state = { count: 0, targets: new Set(), on: false };
  window.__coviMutations = state;
  new MutationObserver((records) => {
    if (!state.on) return;
    for (const record of records) {
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!el || el === document.documentElement || (document.head && document.head.contains(el))) continue;
      state.count++;
      if (state.targets.size < ${MAX_TARGETS}) state.targets.add(el);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener('load', () => { state.on = true; });
})();`;

/**
 * Reads and resets the changes since the last call; boxes in CSS pixels, relative to the viewport.
 * The page can replace `state.targets`, so the loop stops after as many entries as the init script
 * keeps: whatever else is there never gets serialized into Node.
 */
export const TAKE_MUTATIONS = `(() => {
  const state = window.__coviMutations;
  if (!state) return { count: 0, rects: [] };
  const rects = [];
  let seen = 0;
  for (const el of state.targets) {
    if (++seen > ${MAX_TARGETS}) break;
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  const out = { count: state.count, rects };
  state.count = 0;
  state.targets.clear();
  return out;
})()`;

/** A trace sums its steps' counts; past this a page is only trying to overflow the sum. */
const MAX_COUNT = 1e9;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/**
 * Checks what `TAKE_MUTATIONS` returned. The page can overwrite `window.__coviMutations`, so the
 * result is page input: the count becomes a whole number up to 1e9 (0 when it is not a finite
 * number), and a box is kept only when its four fields are finite, clipped to the frame, at most
 * 200 of them. Boxes stay in CSS pixels.
 */
export function parseMutations(
  raw: unknown,
  frame: { width: number; height: number },
): { count: number; rects: Rect[] } {
  const taken = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const count = finite(taken.count) ? clamp(Math.floor(taken.count), MAX_COUNT) : 0;
  const listed: unknown[] = Array.isArray(taken.rects) ? taken.rects.slice(0, MAX_TARGETS) : [];
  const rects = listed.flatMap((r): Rect[] => {
    const { x, y, width, height } = (r ?? {}) as Record<string, unknown>;
    if (!(finite(x) && finite(y) && finite(width) && finite(height))) return [];
    const left = clamp(x, frame.width);
    const top = clamp(y, frame.height);
    const right = clamp(x + width, frame.width);
    const bottom = clamp(y + height, frame.height);
    return right > left && bottom > top
      ? [{ x: left, y: top, width: right - left, height: bottom - top }]
      : [];
  });
  return { count, rects };
}

/**
 * DOM changes since the last call, as merged regions in image pixels. `frame` is the screenshot's
 * size in CSS pixels: changes outside it are not in the picture.
 */
export async function collectMutations(
  page: Page,
  scale: number,
  frame: { width: number; height: number },
): Promise<MutationSummary> {
  const taken = parseMutations(await page.evaluate(TAKE_MUTATIONS).catch(() => undefined), frame);
  return { count: taken.count, regions: mergeRegions(taken.rects, { scale }) };
}

function elapsed(request: Request): number | undefined {
  const end = request.timing().responseEnd;
  return end >= 0 ? end : undefined;
}

/** Feeds a page's requests, console messages, and errors into a trace. Call before navigating. */
export async function observe(page: Page, trace: TraceCollector): Promise<void> {
  await page.addInitScript(MUTATION_SCRIPT);
  page.on('request', (request) =>
    trace.request(request, {
      method: request.method(),
      url: request.url(),
      type: request.resourceType(),
    }),
  );
  page.on('requestfinished', (request) => {
    request.response().then(
      (response) =>
        trace.response(request, { status: response?.status(), durationMs: elapsed(request) }),
      () => trace.response(request, { durationMs: elapsed(request) }),
    );
  });
  page.on('requestfailed', (request) =>
    trace.response(request, {
      failure: request.failure()?.errorText ?? 'failed',
      durationMs: elapsed(request),
    }),
  );
  page.on('console', (message) =>
    trace.console({ level: message.type(), text: message.text(), location: message.location() }),
  );
  page.on('pageerror', (error) =>
    trace.console({ level: 'error', source: 'pageerror', text: error.message }),
  );
}
