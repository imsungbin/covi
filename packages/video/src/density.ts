import type { QcCheck } from './qc.ts';
import { computeRegions } from './runtime/layout.ts';
import { union } from './runtime/narrator.ts';
import { TEXT_FLOOR } from './runtime/sizing.ts';
import { settledFrame, settledSpan } from './timeline/cues.ts';
import type { LayoutReport, Rect, Timeline, TimelineScene } from './timeline/types.ts';

/*
 * Density checks on the rendered layout: is the text large enough to read, and does the content
 * use the frame. They warn rather than fail: they judge taste, not broken output (R-007).
 */

/** What the density checks read of a timeline. */
export type DensityTimeline = Pick<
  Timeline,
  'scenes' | 'transition' | 'fps' | 'width' | 'height' | 'orientation'
>;

/** Text this far under its floor, in design units, still passes: the rounding of drawn boxes. */
const SIZE_TOLERANCE = 0.1;

/** A card scene whose content covers less of the media region than this reads as empty. */
export const EMPTY_SHARE = 0.4;

/**
 * Visuals whose size the runtime chooses, which the empty-frame check holds to the frame. A
 * capture keeps its image's aspect ratio, and title and summary cards are laid out around the fox.
 */
const CARDS: ReadonlySet<TimelineScene['visual']['kind']> = new Set([
  'code',
  'terminal',
  'api',
  'findings',
  'change-map',
  'callout',
  'diagram',
]);

const percent = (share: number) => `${Math.round(100 * share)}%`;

/** The first three of `names`, and an ellipsis for the rest. */
const listed = (names: readonly string[]) =>
  `${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}`;

/** Reports sampled while a story scene had settled and was alone on screen. */
function settledReports(
  timeline: Pick<Timeline, 'scenes' | 'transition' | 'fps'>,
  layouts: readonly LayoutReport[],
): Array<{ scene: TimelineScene; report: LayoutReport }> {
  // The frame count clamps only a last scene too short to settle, and the last scene lingers.
  const unclamped = { ...timeline, frames: Number.POSITIVE_INFINITY };
  const out: Array<{ scene: TimelineScene; report: LayoutReport }> = [];
  for (const report of layouts) {
    const index = timeline.scenes.findIndex((s) => s.id === report.scene);
    const scene = timeline.scenes[index];
    if (!scene || scene.visual.kind === 'outro') continue;
    const [from, to] = settledSpan(timeline, index)!;
    const t = report.frame / timeline.fps;
    // The renderer's sample of a span shorter than a frame lies just before it.
    const sampled = report.frame === settledFrame(unclamped, index);
    if (sampled || (t >= from - 1e-6 && t <= to + 1e-6)) out.push({ scene, report });
  }
  return out;
}

/** A size in design units to a tenth, so text just under its floor is not named at the floor. */
const units = (size: number) => Math.round(10 * size) / 10;

/**
 * Code and terminal text at least 24 px and body text at least 28 px at 1080p, as drawn at the
 * settled frames, relative to the frame's short side. Chips, file paths, and small labels are
 * exempt.
 */
export function textSizeCheck(
  timeline: DensityTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const { unit } = computeRegions(timeline);
  let measured = 0;
  // The smallest text of each kind in each scene, in design units.
  const small = new Map<string, { scene: string; text: 'code' | 'body'; size: number }>();
  for (const { scene, report } of settledReports(timeline, layouts)) {
    for (const item of report.items) {
      if (item.font === undefined || (item.text !== 'code' && item.text !== 'body')) continue;
      measured++;
      const size = item.font / unit;
      if (size >= TEXT_FLOOR[item.text] - SIZE_TOLERANCE) continue;
      const key = `${scene.id} ${item.text}`;
      const seen = small.get(key);
      if (!seen || size < seen.size) small.set(key, { scene: scene.id, text: item.text, size });
    }
  }
  if (!small.size)
    return {
      id: 'text-size',
      status: 'pass',
      message: measured
        ? `Code is at least ${TEXT_FLOOR.code} px and body text at least ${TEXT_FLOOR.body} px at 1080p wherever a scene has settled.`
        : 'No code or body text was measured at a settled frame.',
    };
  const named = listed(
    [...small.values()].map((s) => `${s.text} at ${units(s.size)} px in ${s.scene}`),
  );
  return {
    id: 'text-size',
    status: 'warn',
    message: `Text is too small to read at 1080p: ${named} (code at least ${TEXT_FLOOR.code} px, body at least ${TEXT_FLOOR.body} px). Show fewer or shorter lines, or split the scene.`,
  };
}

const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);

/** The part of `a` inside `b`, if any. */
function clip(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined;
}

/**
 * Every card scene's content (the boxes it reports inside the media region, together) covers at
 * least 40% of the media region at its fullest settled frame. Captures, title and summary cards,
 * and the outro are not checked.
 */
export function emptyFrameCheck(
  timeline: DensityTimeline,
  layouts: readonly LayoutReport[],
): QcCheck {
  const media = computeRegions(timeline).media;
  const best = new Map<string, number>();
  for (const { scene, report } of settledReports(timeline, layouts)) {
    if (!CARDS.has(scene.visual.kind)) continue;
    // Boxes mostly inside the region: the header's heading above it is not content.
    const inside = report.items.flatMap((item) => {
      const part = clip(item.rect, media);
      return part && area(part) >= 0.5 * area(item.rect) ? [part] : [];
    });
    const share = inside.length ? area(union(inside)) / area(media) : 0;
    best.set(scene.id, Math.max(best.get(scene.id) ?? 0, share));
  }
  const empty = [...best].filter(([, share]) => share < EMPTY_SHARE - 1e-9);
  if (!empty.length)
    return {
      id: 'empty-frame',
      status: 'pass',
      message: best.size
        ? `Every card scene's content fills at least ${percent(EMPTY_SHARE)} of the media region.`
        : 'No card scene was measured at a settled frame.',
    };
  const named = listed(empty.map(([id, share]) => `${id} (${percent(share)})`));
  return {
    id: 'empty-frame',
    status: 'warn',
    message: `Content fills little of the frame in ${named}; at least ${percent(EMPTY_SHARE)} of the media region wanted. Show more of the subject in the scene, or merge it with the next.`,
  };
}
