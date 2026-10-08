import { posix } from 'node:path';
import { DEMO_PATHS, parseSubjectRef, type Rect, type SubjectSnapshot } from '@covi/core';
import type { Scene, Storyboard } from './schema.ts';

/** A focus once placed. A reference that reaches the timeline was never placed: a bug, not input. */
export function rectOf(focus: Rect | string | undefined): Rect | undefined {
  if (typeof focus === 'string') throw new Error(`Subject reference was not placed: ${focus}`);
  return focus;
}

/** The run-relative image a part of a visual shows: its own `after` or `image`, else its parent's. */
function imageOf(node: Record<string, unknown>, inherited: string | undefined): string | undefined {
  for (const key of ['after', 'image']) {
    const ref = node[key] as { path?: unknown } | undefined;
    if (ref && typeof ref.path === 'string') return ref.path;
  }
  return inherited;
}

/**
 * A copy of a visual with each string `focus`, at any depth (a step, a mark), replaced by what
 * `place` returns for it in the image nearest to it. Left as it was when `place` returns nothing.
 */
export function resolveFocusRefs(
  node: unknown,
  place: (ref: string, image: string | undefined) => Rect | undefined,
  image?: string,
): unknown {
  if (Array.isArray(node)) return node.map((n) => resolveFocusRefs(n, place, image));
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  const own = imageOf(obj, image);
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      key === 'focus' && typeof value === 'string'
        ? (place(value, own) ?? value)
        : resolveFocusRefs(value, place, own),
    ]),
  );
}

const LISTED = 20;

/** What exists, for a message: the first few, and how many more. */
const listed = (keys: readonly string[]) =>
  keys.length
    ? `${keys.slice(0, LISTED).join(', ')}${keys.length > LISTED ? `, and ${keys.length - LISTED} more` : ''}`
    : 'none';

/**
 * Where a reference points in one image: the element's box there, from the run's snapshot, or why
 * it cannot be placed. Only head captures are indexed: the model describes the head revision.
 */
export function placeSubjectRef(
  ref: string,
  image: string | undefined,
  snapshot: SubjectSnapshot | undefined,
): { rect: Rect } | { problem: string } {
  const parsed = parseSubjectRef(ref);
  if (!parsed) return { problem: 'not a subject reference (subject:<screen>#<element>)' };
  if (!snapshot)
    return {
      problem: `the run has no subject model (${DEMO_PATHS.subject}); demonstrate in this run first, or give a rect`,
    };
  const screens = snapshot.model.screens;
  const screen = screens.find((s) => s.key === parsed.screen);
  if (!screen)
    return {
      problem: `no screen "${parsed.screen}" in the subject model (screens: ${listed(screens.map((s) => s.key))})`,
    };
  if (!screen.elements.some((e) => e.key === parsed.element))
    return {
      problem: `no element "${parsed.element}" on screen "${screen.key}" (elements: ${listed(screen.elements.map((e) => e.key))})`,
    };
  // `./demo/…` names the same capture as `demo/…`.
  const path = image === undefined ? undefined : posix.normalize(image);
  const shown = snapshot.images.find((i) => i.path === path);
  if (!shown)
    return {
      problem: `${image ?? 'this visual'} is not a head capture this run indexed; references are placed in a page's after image or a flow frame (indexed: ${listed(snapshot.images.map((i) => i.path))})`,
    };
  if (shown.screen !== screen.key)
    return { problem: `${shown.path} shows screen "${shown.screen}", not "${screen.key}"` };
  const at = shown.elements.find((e) => e.key === parsed.element);
  if (!at)
    return {
      problem: `"${parsed.element}" is not in ${shown.path}: outside the capture, or not visible there (it shows: ${listed(shown.elements.map((e) => e.key))})`,
    };
  return { rect: { x: at.x, y: at.y, width: at.width, height: at.height } };
}

/** The storyboard with every reference placed, and a line per reference that could not be. */
export function resolveSubjectFocus(
  storyboard: Storyboard,
  snapshot: SubjectSnapshot | undefined,
): { storyboard: Storyboard; problems: string[] } {
  const problems: string[] = [];
  const scenes = storyboard.scenes.map((scene, i) => ({
    ...scene,
    visual: resolveFocusRefs(scene.visual, (ref, image) => {
      const placed = placeSubjectRef(ref, image, snapshot);
      if ('rect' in placed) return placed.rect;
      problems.push(`scene ${scene.id ?? `s${i + 1}`}: ${ref}: ${placed.problem}`);
      return undefined;
    }) as Scene['visual'],
  }));
  return { storyboard: { ...storyboard, scenes }, problems };
}
