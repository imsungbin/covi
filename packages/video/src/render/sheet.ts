import type { Timeline } from '../timeline/types.ts';

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
  const cited = ids.length
    ? `${ids.slice(0, 2).join(' · ')}${ids.length > 2 ? ` +${ids.length - 2}` : ''}`
    : '—';
  const text = `${scene.id} · ${cited}`;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/**
 * Adds the label strip over the frame's bottom edge, sized to survive the sheet's downscaling.
 * A string, because this package compiles without DOM types; the label goes in as text only.
 */
export function showLabelScript(label: string, width: number): string {
  const px = Math.max(12, Math.round(width * 0.028));
  const style = `position:fixed;left:0;right:0;bottom:0;padding:${Math.round(px / 2)}px ${px}px;font:600 ${px}px/1.25 ui-monospace,Menlo,monospace;color:#fff;background:rgba(15,23,42,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2147483647`;
  return `(() => { const el = document.createElement('div'); el.id = ${JSON.stringify(LABEL_ID)}; el.textContent = ${JSON.stringify(label)}; el.setAttribute('style', ${JSON.stringify(style)}); document.body.append(el); })()`;
}

export const HIDE_LABEL_SCRIPT = `document.getElementById(${JSON.stringify(LABEL_ID)})?.remove()`;
