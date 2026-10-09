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

/** A code card's size in its region: the text, the card, and the room above its first line. */
export interface CodeCard {
  font: number;
  height: number;
  /** The card's top edge, centered in the region. */
  top: number;
  /** Above the first line: the card's own padding, and half of what a short block leaves free. */
  padding: number;
}

/**
 * How a code card of `rows` rows with these lines sits in `box`. Its text is sized by the typical
 * (90th percentile) line, so one long line does not shrink everything (longer lines end in an
 * ellipsis rather than wrapping), and a short block still gets a card that fills most of the
 * region, its lines in the middle.
 */
export function codeCard(
  lines: readonly string[],
  rows: number,
  box: Rect,
  orientation: Timeline['orientation'],
  unit: number,
): CodeCard {
  const u = (n: number) => n * unit;
  const lengths = lines.map((line) => line.length + 7).sort((a, b) => a - b);
  const typical = Math.max(28, lengths[Math.floor((lengths.length - 1) * 0.9)] ?? 28);
  const fontByWidth = (box.width - u(40)) / (typical * 0.61);
  const fontByHeight = (box.height - u(90)) / (rows * 1.55 + 1.2);
  const font = codeFont(Math.min(fontByWidth, fontByHeight), orientation, unit);
  const natural = Math.min(box.height, rows * font * 1.55 + font * 1.2 + u(66));
  const height = cardHeight(box, box.width, natural);
  return {
    font,
    height,
    top: box.y + (box.height - height) / 2,
    padding: u(14) + (height - natural) / 2,
  };
}
