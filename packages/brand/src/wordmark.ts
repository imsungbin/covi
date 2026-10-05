import { r } from './geometry.ts';

/**
 * Outlines of the lowercase wordmark "covi", so the logo draws the same everywhere without live
 * text. Source: Inter by Rasmus Andersson (SIL Open Font License 1.1), as shipped in
 * @fontsource-variable/inter 5.3.0 (files/inter-latin-wght-normal.woff2), instanced at wght 700.
 * Paths are in font units (2048 per em) with y pointing down and the baseline at 0, rounded to a
 * tenth of a unit. The o–v kerning is the value Chromium applies to that font.
 */
const INTER_BOLD = {
  unitsPerEm: 2048,
  xHeight: 1118,
  glyphs: {
    c: {
      advance: 1205,
      d: 'M627.6 21.8Q459.4 21.8 336.8 -50.4Q214.2 -122.7 147.8 -252.4Q81.3 -382.2 81.3 -554.2Q81.3 -727.5 147.8 -857.5Q214.2 -987.5 336.8 -1059.7Q459.4 -1132 627.6 -1132Q727.5 -1132 811.4 -1106.1Q895.2 -1080.3 960.1 -1032.1Q1025 -984 1067 -915.2Q1108.9 -846.3 1124.9 -760.4L846 -708.1Q836.7 -751.7 817.9 -786.3Q799.1 -821 772 -845.6Q744.9 -870.2 709.4 -883.1Q673.9 -895.9 630.8 -895.9Q550.7 -895.9 496.5 -852.8Q442.3 -809.7 414.6 -733.1Q386.9 -656.4 386.9 -555.2Q386.9 -455.5 414.6 -378.5Q442.3 -301.6 496.5 -257.9Q550.7 -214.2 630.8 -214.2Q674.4 -214.2 710.3 -227.6Q746.3 -241 774.1 -266.3Q802 -291.7 820.8 -328Q839.6 -364.4 848.3 -409.4L1126.7 -357.7Q1111.2 -269.2 1069 -199.4Q1026.9 -129.5 962 -79.9Q897.2 -30.3 812.5 -4.2Q727.9 21.8 627.6 21.8Z',
    },
    o: {
      advance: 1256,
      d: 'M628.1 21.8Q459.9 21.8 337.1 -50.4Q214.2 -122.7 147.8 -252.4Q81.3 -382.2 81.3 -554.2Q81.3 -727.5 147.8 -857.5Q214.2 -987.5 337.1 -1059.7Q459.9 -1132 628.1 -1132Q796.8 -1132 919.3 -1059.7Q1041.9 -987.5 1108.3 -857.5Q1174.8 -727.5 1174.8 -554.2Q1174.8 -382.2 1108.3 -252.4Q1041.9 -122.7 919.3 -50.4Q796.8 21.8 628.1 21.8Z M628.1 -214.2Q708.2 -214.2 762 -258.7Q815.8 -303.2 842.7 -380.4Q869.6 -457.7 869.6 -555.2Q869.6 -653.8 842.7 -730.7Q815.8 -807.6 762 -851.8Q708.2 -895.9 628.1 -895.9Q548 -895.9 494.3 -851.8Q440.7 -807.6 413.8 -730.9Q386.9 -654.3 386.9 -555.2Q386.9 -457.7 413.8 -380.4Q440.7 -303.2 494.3 -258.7Q548 -214.2 628.1 -214.2Z',
    },
    v: {
      advance: 1228,
      d: 'M442.7 0 31.3 -1118H349.8L537.6 -537.6Q572.4 -429.2 597.8 -318.1Q623.2 -206.9 650 -88.3H585.7Q612 -206.9 637.1 -317.8Q662.3 -428.7 696 -537.6L881.6 -1118H1196.9L784.5 0Z',
    },
    i: {
      advance: 555,
      d: 'M127.8 0V-1118H427.6V0Z',
      /** The dot's box, which the wordmark fills with a ▶ instead. */
      dot: { x: 113.2, y: -1571.9, width: 329.3, height: 308.2 },
    },
  },
  kerning: { ov: -36.7 } as Record<string, number>,
  /** Letter-spacing: about −0.032 em, a little tighter than the font's default. */
  tracking: -66,
};

type Letter = keyof typeof INTER_BOLD.glyphs;
const WORD: Letter[] = ['c', 'o', 'v', 'i'];

export interface Wordmark {
  /** SVG markup in font units (y down, baseline at 0). */
  body: string;
  width: number;
  /** Top of the ▶ over the i, and just below the round letters (font units, y down). */
  top: number;
  bottom: number;
  xHeight: number;
}

/** The word "covi" in Inter Bold outlines, with a ▶ in `accent` where the i's dot was. */
export function wordmark(colors: { ink: string; accent: string }): Wordmark {
  let x = 0;
  let stem = 0;
  const parts: string[] = [];
  WORD.forEach((letter, i) => {
    const glyph = INTER_BOLD.glyphs[letter];
    parts.push(`<path transform="translate(${r(x)} 0)" d="${glyph.d}" fill="${colors.ink}"/>`);
    stem = x;
    const next = WORD[i + 1];
    if (next) x += glyph.advance + (INTER_BOLD.kerning[letter + next] ?? 0) + INTER_BOLD.tracking;
  });
  // The play mark fills the dot's height band, optically a little larger, and sits over the
  // stem nudged left so its point does not hang past it. Round joins match the fox's ▶.
  const dot = INTER_BOLD.glyphs.i.dot;
  const h = dot.height * 0.98;
  const w = h * 0.92;
  const cx = stem + dot.x + dot.width / 2 - h * 0.06;
  const cy = dot.y + dot.height / 2;
  const play = [
    [cx - w / 2, cy - h / 2],
    [cx + w / 2, cy],
    [cx - w / 2, cy + h / 2],
  ] as const;
  const stroke = h * 0.2;
  parts.push(
    `<path d="M${play.map(([px, py]) => `${r(px)} ${r(py)}`).join(' L')} Z" fill="${colors.accent}" stroke="${colors.accent}" stroke-width="${r(stroke)}" stroke-linejoin="round"/>`,
  );
  return {
    body: parts.join(''),
    width: x + INTER_BOLD.glyphs.i.advance,
    top: Math.floor(cy - h / 2 - stroke / 2),
    bottom: 40,
    xHeight: INTER_BOLD.xHeight,
  };
}
