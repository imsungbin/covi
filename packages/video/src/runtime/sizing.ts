import type { Rect, Timeline } from '../timeline/types.ts';

/*
 * How large text and cards are drawn, in design units (1/1080 of the frame's short side). The
 * runtime sizes cards with these, and QC holds the rendered frames to the same numbers. No DOM and
 * no Node APIs: the runtime bundles this file and Node QC imports it.
 */

/** The smallest text a viewer reads comfortably at 1080p: code and terminal text, and body text. */
export const TEXT_FLOOR = { code: 24, body: 28 } as const;

/**
 * Code too long or too tall to fit at the floor shrinks to this rather than being cut off (the
 * smallest terminal text 0.2.0 drew); QC's `text-size` then names the scene.
 */
export const CODE_FALLBACK = 13;

/** A card covers at least this share of the media region; short content sits in its middle. */
export const CARD_FILL = 0.6;

/** Code and terminal text grow to this when the block is short: a short block renders large. */
export function codeCeiling(orientation: Timeline['orientation']): number {
  return orientation === 'vertical' ? 48 : 44;
}

/** Code or terminal text in pixels: the size that fits, between the fallback and the ceiling. */
export function codeFont(fit: number, orientation: Timeline['orientation'], unit: number): number {
  return Math.min(codeCeiling(orientation) * unit, Math.max(CODE_FALLBACK * unit, fit));
}

/**
 * A card's height in `region`: its content's, grown until a card `width` wide covers CARD_FILL of
 * the region, and never taller than the region.
 */
export function cardHeight(region: Rect, width: number, content: number): number {
  const fill = (CARD_FILL * region.width * region.height) / Math.max(1, width);
  return Math.min(region.height, Math.max(content, fill));
}
