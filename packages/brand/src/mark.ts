import { type FoxColors, foxColors } from './mascot.ts';

/**
 * The fox mark: the head alone, for icons and the horizontal logo. Its head has wider cheek tufts
 * than the full fox, so the silhouette still reads as a fox when small, and its detail steps down
 * with size because what reads at 64 px turns to noise at 16:
 *
 * - micro (24 px and below): no ear chevrons; bigger eyes and nose.
 * - small (32–48 px): the < > chevrons in the ears.
 * - full (64 px and up): eye highlights and the smile as well.
 */
export const MARK_LEVELS = ['micro', 'small', 'full'] as const;
export type MarkLevel = (typeof MARK_LEVELS)[number];

export function markLevel(size: number): MarkLevel {
  return size <= 24 ? 'micro' : size <= 48 ? 'small' : 'full';
}

export interface MarkOptions {
  /** Rendered width/height in px (default 32). */
  size?: number;
  /** Detail level; defaults to the level for `size`. */
  level?: MarkLevel;
  /** The background the mark sits on; on dark backgrounds the fur is lifted. */
  theme?: 'light' | 'dark';
  /** Fur color (shorthand for `colors.fur`). */
  color?: string;
  /** Draws the mark on a rounded tile of this color (app icons and avatars). */
  background?: string;
  colors?: Partial<FoxColors>;
  title?: string;
}

const HEAD =
  'M70 21 C85 21 98 28 101 41 C103 49 108.5 54.5 118 58.5 C110.5 63.5 104.5 66 100.5 70 C94.5 77.5 82.5 82 70 82 C57.5 82 45.5 77.5 39.5 70 C35.5 66 29.5 63.5 22 58.5 C31.5 54.5 37 49 39 41 C42 28 55 21 70 21 Z';
const EAR = 'M37.5 43 C34.5 30 32.5 15 33.5 5.5 C34 1.5 38 0 41.5 2.8 C49 9 56.5 17 63.5 25 Z';
const MASK =
  'M26.5 59 C33 56 37.5 51 41 46.5 C44.5 41 50 38.8 55.5 38.8 C61 38.8 65 41 70 43.2 C75 41 79 38.8 84.5 38.8 C90 38.8 95.5 41 99 46.5 C102.5 51 107 56 113.5 59 C107.5 61.8 102.5 64.5 98.5 68 C92.5 74.5 82 78.5 70 78.5 C58 78.5 47.5 74.5 41.5 68 C37.5 64.5 32.5 61.8 26.5 59 Z';
const CHEVRON = 'M46.8 15 L41.2 21.8 L47.2 28.6';
const NOSE = 'M65.2 59.2 Q70 56.8 74.8 59.2 Q73.8 63.6 70 64.8 Q66.2 63.6 65.2 59.2 Z';

type Box = [number, number, number, number];

interface Detail {
  head: string;
  ear: string;
  mask: string;
  eye: { rx: number; ry: number; y: number };
  nose: string;
  chevron: number;
  /** Frames the head alone. */
  frame: Box;
}

const SHAPE = { head: HEAD, ear: EAR, mask: MASK, frame: [21, -8, 98, 98] as Box };
const DETAIL: Record<MarkLevel, Detail> = {
  // At 16–24 px a few pixels decide the species: taller ears and wider cheek tufts keep it a fox.
  micro: {
    head: 'M70 21 C85 21 98 28 101 41 C103 49 109.5 54 121 58 C112 63.5 105 66 100.5 70 C94.5 77.5 82.5 82 70 82 C57.5 82 45.5 77.5 39.5 70 C35 66 28 63.5 19 58 C30.5 54 37 49 39 41 C42 28 55 21 70 21 Z',
    ear: 'M38 43 C35 29 32.5 11 33 0.5 C33.4 -3.2 37 -4.4 40.2 -1.8 C48 5 56.5 15 64 25 Z',
    mask: 'M23.5 58.6 C33 56 37.5 51 41 46.5 C44.5 41 50 38.8 55.5 38.8 C61 38.8 65 41 70 43.2 C75 41 79 38.8 84.5 38.8 C90 38.8 95.5 41 99 46.5 C102.5 51 107 56 116.5 58.6 C108 61.8 102.5 64.5 98.5 68 C92.5 74.5 82 78.5 70 78.5 C58 78.5 47.5 74.5 41.5 68 C37.5 64.5 32 61.8 23.5 58.6 Z',
    eye: { rx: 6.4, ry: 7.6, y: 53 },
    nose: 'M63.5 61 Q70 57.5 76.5 61 Q75 67 70 68.5 Q65 67 63.5 61 Z',
    chevron: 0,
    frame: [18, -7, 104, 104],
  },
  small: { ...SHAPE, eye: { rx: 5.4, ry: 6.6, y: 52 }, nose: NOSE, chevron: 4.6 },
  full: { ...SHAPE, eye: { rx: 4.9, ry: 6, y: 51.5 }, nose: NOSE, chevron: 4 },
};

/** A tile adds a rounded square around the head, which shrinks to leave the icon's margin. */
const TILE: Box = [18, -10, 104, 104];

/** The mark's markup and the view box that frames it (for lockups that place it themselves). */
export function markParts(options: MarkOptions = {}): {
  viewBox: [number, number, number, number];
  body: string;
} {
  const level = options.level ?? markLevel(options.size ?? 32);
  const c = foxColors({
    theme: options.theme,
    colors: { ...options.colors, ...(options.color ? { fur: options.color } : {}) },
  });
  const d = DETAIL[level];
  const ear = (side: -1 | 1) => {
    const mirror = side === 1 ? ' transform="translate(140 0) scale(-1 1)"' : '';
    const chevron = d.chevron
      ? `<path d="${CHEVRON}" fill="none" stroke="${c.inner}" stroke-width="${d.chevron}" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
    return `<g${mirror}><path d="${d.ear}" fill="${c.fur}" stroke="${c.fur}" stroke-width="2.4" stroke-linejoin="round"/>${chevron}</g>`;
  };
  const eyes = [55, 85]
    .map(
      (x) =>
        `<ellipse cx="${x}" cy="${d.eye.y}" rx="${d.eye.rx}" ry="${d.eye.ry}" fill="${c.ink}"/>`,
    )
    .join('');
  const full = level === 'full';
  const head = [
    ear(-1),
    ear(1),
    `<path d="${d.head}" fill="${c.fur}"/>`,
    `<path d="${d.mask}" fill="${c.mask}"/>`,
    eyes,
    full
      ? `<circle cx="56.7" cy="49.2" r="1.8" fill="${c.highlight}"/><circle cx="86.7" cy="49.2" r="1.8" fill="${c.highlight}"/>`
      : '',
    `<path d="${d.nose}" fill="${c.ink}"/>`,
    full
      ? `<path d="M66 67.4 Q70 71 74 67.4" fill="none" stroke="${c.ink}" stroke-width="2.2" stroke-linecap="round"/>`
      : '',
  ].join('');
  if (!options.background) return { viewBox: d.frame, body: head };
  const [x, y, w] = TILE;
  return {
    viewBox: TILE,
    body: `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="24" fill="${options.background}"/><g transform="translate(70 42) scale(0.8) translate(-70 -42)">${head}</g>`,
  };
}

/** The mark as a standalone SVG. */
export function foxMarkSvg(options: MarkOptions = {}): string {
  const size = options.size ?? 32;
  const { viewBox, body } = markParts({ ...options, size });
  const title = (options.title ?? 'Covi').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${size}" height="${size}" role="img"><title>${title}</title>${body}</svg>`;
}
