import type { Rect, Timeline } from '../timeline/types.ts';

const LABEL_ID = 'covi-sheet-label';
const MAX_LABEL = 96;

/**
 * A contact sheet tile's label: the scene the frame shows (the incoming one during a transition)
 * and the evidence it cites, or `—` for none. Ids only, so the label needs no translation.
 */
export function sheetLabel(timeline: Pick<Timeline, 'fps' | 'scenes'>, frame: number): string {
  const t = frame / timeline.fps;
  const scene = timeline.scenes.findLast((s) => s.start <= t) ?? timeline.scenes[0];
  if (!scene) return '';
  const ids = scene.evidenceIds ?? [];
  // The count comes first: a long id is cut by the strip's ellipsis, never the count.
  const cited = ids.length
    ? [...(ids.length > 2 ? [`+${ids.length - 2}`] : []), ...ids.slice(0, 2)].join(' · ')
    : '—';
  const text = `${scene.id} · ${cited}`;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/** The label's type size and band height for a frame `width` wide, sized to survive the sheet's
 * downscaling. The band is even, so a tile stacked from it stays a valid 4:2:0 picture. */
function band(width: number): { px: number; pad: number; height: number } {
  const px = Math.max(12, Math.round(width * 0.028));
  const pad = Math.round(px / 2);
  return { px, pad, height: 2 * Math.ceil((Math.round(px * 1.25) + 2 * pad) / 2) };
}

/**
 * A contact sheet tile: the frame exactly as the video shows it, and the label in a band below
 * it, so the label never covers the product or the captions the sheet is read to judge.
 */
export function tileLayout(width: number, height: number): { frame: Rect; label: Rect } {
  return {
    frame: { x: 0, y: 0, width, height },
    label: { x: 0, y: height, width, height: band(width).height },
  };
}

/**
 * Draws the label at the top of the page on an opaque band, to be shot on its own (clipped to
 * the band) and stacked under the frame. A string, because this package compiles without DOM
 * types; the label goes in as text only.
 */
export function showLabelScript(label: string, width: number): string {
  const { px, pad, height } = band(width);
  const style = `position:fixed;left:0;top:0;width:100%;height:${height}px;box-sizing:border-box;padding:${pad}px ${px}px;font:600 ${px}px/1.25 ui-monospace,Menlo,monospace;color:#fff;background:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2147483647`;
  return `(() => { const el = document.createElement('div'); el.id = ${JSON.stringify(LABEL_ID)}; el.textContent = ${JSON.stringify(label)}; el.setAttribute('style', ${JSON.stringify(style)}); document.body.append(el); })()`;
}

export const HIDE_LABEL_SCRIPT = `document.getElementById(${JSON.stringify(LABEL_ID)})?.remove()`;
