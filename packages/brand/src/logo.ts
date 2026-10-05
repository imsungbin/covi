import { r } from './geometry.ts';
import { markParts } from './mark.ts';
import { foxMarkup } from './mascot.ts';
import { palette } from './tokens.ts';
import { wordmark } from './wordmark.ts';

export interface LogoOptions {
  /** Rendered height in px; the width follows the lockup's proportions. */
  height?: number;
  /** Light backgrounds get a charcoal word; dark ones a paper word and the lifted cobalt. */
  theme?: 'light' | 'dark';
  /** `horizontal`: the head mark beside the word. `stacked`: the seated fox above it. */
  layout?: 'horizontal' | 'stacked';
}

/** Places a square drawing (its view box) into a square box of the logo. */
const nested = (
  viewBox: readonly number[],
  body: string,
  box: { x: number; y: number; size: number },
) =>
  `<g transform="translate(${r(box.x)} ${r(box.y)}) scale(${Math.round((box.size / viewBox[2]!) * 1e4) / 1e4}) translate(${-viewBox[0]!} ${-viewBox[1]!})">${body}</g>`;

/**
 * The Covi logo: the lowercase "covi" wordmark (Inter Bold outlines, its i dotted with a cobalt
 * ▶) with the fox. Everything is in the wordmark's font units, so the parts keep their proportions
 * at any size.
 */
export function logoSvg(options: LogoOptions = {}): string {
  const height = options.height ?? 64;
  const dark = options.theme === 'dark';
  const word = wordmark({
    ink: dark ? palette.paper : palette.charcoal,
    accent: dark ? palette.cobaltLight : palette.cobalt,
  });
  let viewBox: [number, number, number, number];
  let fox: string;
  let wordX: number;
  if (options.layout === 'stacked') {
    // The seated fox, centered over the word.
    const size = word.width * 1.364;
    const x = word.width / 2 - size / 2;
    const y = word.top - size * 1.02;
    fox = nested([0, 0, 128, 128], foxMarkup({ theme: options.theme }), { x, y, size });
    wordX = 0;
    viewBox = [Math.min(0, x), y, Math.max(word.width, size), word.bottom - y];
  } else {
    // The head mark, centered on the x-height and as tall as about two of them. The logo keeps
    // the mark plain (no smile or highlights) beside the word; small logos use the micro mark.
    const size = 1.9 * word.xHeight;
    const y = -word.xHeight / 2 - size / 2 - 40;
    const mark = markParts({ level: height <= 24 ? 'micro' : 'small', theme: options.theme });
    fox = nested(mark.viewBox, mark.body, { x: 0, y, size });
    wordX = size * 1.2;
    viewBox = [0, Math.min(y, word.top), wordX + word.width, 0];
    viewBox[3] = Math.max(y + size, word.bottom) - viewBox[1];
  }
  const width = Math.round((height * viewBox[2]) / viewBox[3]);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.map(r).join(' ')}" width="${width}" height="${height}" role="img"><title>Covi</title>`,
    fox,
    `<g transform="translate(${r(wordX)} 0)">${word.body}</g>`,
    '</svg>',
  ].join('');
}
