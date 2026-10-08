import type { MutationSummary, Rect } from '@covi/core';
import type { Page, Request } from 'playwright';
import { mergeRegions } from './regions.ts';
import type { TraceCollector } from './trace.ts';

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
      if (state.targets.size < 200) state.targets.add(el);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener('load', () => { state.on = true; });
})();`;

/** Reads and resets the changes since the last call; boxes in CSS pixels, relative to the viewport. */
const TAKE_MUTATIONS = `(() => {
  const state = window.__coviMutations;
  if (!state) return { count: 0, rects: [] };
  const rects = [];
  for (const el of state.targets) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  const out = { count: state.count, rects };
  state.count = 0;
  state.targets.clear();
  return out;
})()`;

/** DOM changes since the last call, as merged regions in image pixels. */
export async function collectMutations(page: Page, scale: number): Promise<MutationSummary> {
  const taken = (await page.evaluate(TAKE_MUTATIONS).catch(() => undefined)) as
    | { count: number; rects: Rect[] }
    | undefined;
  if (!taken) return { count: 0, regions: [] };
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
