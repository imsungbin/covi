import { palette } from './tokens.ts';

/**
 * The Covi fox: a cobalt fox head built from a handful of shapes (two ears, a head, a face mask,
 * eyes, a nose, a mouth). Every animation is a parameter, so the same function renders a static
 * asset or one frame of a talking, blinking narrator.
 */
export const EXPRESSIONS = [
  'neutral',
  'explaining',
  'thinking',
  'reviewing',
  'warning',
  'success',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export interface FoxOptions {
  expression?: Expression;
  /** Rendered width/height in px (the viewBox is always 128×128). */
  size?: number;
  /** 0 = eyes open, 1 = closed. */
  blink?: number;
  /** 0 = closed mouth, 1 = fully open (talking). */
  mouth?: number;
  /** Gaze direction, each axis in -1…1. */
  look?: { x: number; y: number };
  /** Head rotation in degrees (positive tilts clockwise). */
  tilt?: number;
  /** Ear rotation in degrees; positive turns ears outward (alert/back). */
  ears?: number;
  /** Vertical offset in viewBox units (bounces, nods). */
  bounce?: number;
  /** Show the expression's prop (magnifier, thought dots, badge). Defaults to true. */
  props?: boolean;
  /**
   * How far the prop has appeared, 0–1 (values a little above 1 overshoot a pop). Thought dots
   * appear one after another; badges and the magnifier scale in. Defaults to 1.
   */
  propReveal?: number;
  /** Cheek blush in the warm accent. */
  blush?: boolean;
  title?: string;
  /** Extra attributes for the root <svg>. */
  attributes?: Record<string, string>;
  colors?: Partial<FoxColors>;
}

export interface FoxColors {
  fur: string;
  mask: string;
  inner: string;
  ink: string;
  accent: string;
  highlight: string;
}

export const DEFAULT_FOX_COLORS: FoxColors = {
  fur: palette.cobalt,
  mask: palette.paper,
  inner: palette.sky,
  ink: palette.charcoal,
  accent: palette.accent,
  highlight: palette.white,
};

const r = (n: number) => Math.round(n * 100) / 100;

interface ExpressionShape {
  eyes: 'round' | 'narrow' | 'wide' | 'happy';
  mouth: 'smile' | 'flat' | 'open' | 'o' | 'grin';
  tilt: number;
  ears: number;
  look: { x: number; y: number };
}

/** The resting pose an expression starts from; animations move relative to it. */
export function restingPose(expression: Expression): {
  tilt: number;
  ears: number;
  look: { x: number; y: number };
} {
  const { tilt, ears, look } = SHAPES[expression];
  return { tilt, ears, look };
}

const SHAPES: Record<Expression, ExpressionShape> = {
  neutral: { eyes: 'round', mouth: 'smile', tilt: 0, ears: 0, look: { x: 0, y: 0 } },
  explaining: { eyes: 'round', mouth: 'open', tilt: -3, ears: -2, look: { x: 0.2, y: 0 } },
  thinking: { eyes: 'round', mouth: 'flat', tilt: -7, ears: 3, look: { x: 0.7, y: -0.7 } },
  reviewing: { eyes: 'narrow', mouth: 'flat', tilt: 2, ears: -3, look: { x: 0.35, y: 0.15 } },
  warning: { eyes: 'wide', mouth: 'o', tilt: 0, ears: 9, look: { x: 0, y: 0 } },
  success: { eyes: 'happy', mouth: 'grin', tilt: 3, ears: -4, look: { x: 0, y: 0 } },
};

function ear(side: -1 | 1, rotation: number, c: FoxColors): string {
  // Left ear defined once and mirrored; rotation pivots at the ear's base.
  const pivot = side === -1 ? '40 46' : '88 46';
  const outer = 'M22 52 L30 10 Q31.5 6 35 8.5 L60 34 Z';
  const inner = 'M29 44 L33.5 19 Q34.5 16.5 36.5 18 L51 33 Z';
  const mirror = side === 1 ? ' translate(128 0) scale(-1 1)' : '';
  const turn = rotation ? ` rotate(${r(rotation * side)} ${pivot})` : '';
  return `<g transform="${(turn + mirror).trim()}"><path d="${outer}" fill="${c.fur}" stroke="${c.fur}" stroke-width="3" stroke-linejoin="round"/><path d="${inner}" fill="${c.inner}"/></g>`;
}

function eyes(
  shape: ExpressionShape['eyes'],
  blink: number,
  look: { x: number; y: number },
  c: FoxColors,
): string {
  const lx = r(look.x * 2.2);
  const ly = r(look.y * 2);
  if (shape === 'happy' || blink >= 0.98) {
    // Closed eyes: gentle arcs (smiling when happy, flat when blinking).
    const d =
      shape === 'happy'
        ? (x: number) => `M${x - 5.5} 66 Q${x} 59.5 ${x + 5.5} 66`
        : (x: number) => `M${x - 5} 64.5 Q${x} 66.5 ${x + 5} 64.5`;
    return `<g fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"><path d="${d(47)}"/><path d="${d(81)}"/></g>`;
  }
  const base =
    shape === 'wide'
      ? { rx: 5.6, ry: 7.4 }
      : shape === 'narrow'
        ? { rx: 5.2, ry: 4.4 }
        : { rx: 5, ry: 6.6 };
  const ry = r(Math.max(0.6, base.ry * (1 - blink)));
  const eye = (x: number) =>
    `<ellipse cx="${r(x + lx)}" cy="${r(64 + ly)}" rx="${base.rx}" ry="${ry}" fill="${c.ink}"/>` +
    (ry > 2
      ? `<circle cx="${r(x + lx + 1.7)}" cy="${r(64 + ly - ry * 0.38)}" r="1.7" fill="${c.highlight}"/>`
      : '');
  return eye(47) + eye(81);
}

function mouth(shape: ExpressionShape['mouth'], open: number, c: FoxColors): string {
  if (open > 0.05) {
    // Talking: an open smile whose depth follows the voice amplitude.
    const w = r(4.2 + open * 1.6);
    const depth = r(98.6 + 2.4 + open * 7.2);
    return `<path d="M${r(64 - w)} 98.6 Q64 ${depth} ${r(64 + w)} 98.6 Q64 ${r(98.6 + 0.8)} ${r(64 - w)} 98.6 Z" fill="${c.ink}"/>`;
  }
  const stroke = `fill="none" stroke="${c.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`;
  switch (shape) {
    case 'flat':
      return `<path d="M60 100.5 L68 100.5" ${stroke}/>`;
    case 'o':
      return `<ellipse cx="64" cy="101.5" rx="3" ry="3.6" fill="${c.ink}"/>`;
    case 'grin':
      return `<path d="M56.5 98.5 Q64 106.5 71.5 98.5 Z" fill="${c.ink}"/>`;
    case 'open':
      return `<path d="M59.4 98.8 Q64 105.6 68.6 98.8 Q64 99.8 59.4 98.8 Z" fill="${c.ink}"/>`;
    default:
      return `<path d="M58 99 Q61 102.2 64 99 Q67 102.2 70 99" ${stroke}/>`;
  }
}

/** Scales a prop about its center as it appears (fully shown at 1). */
function reveal(body: string, cx: number, cy: number, k: number): string {
  if (k >= 0.999 && k <= 1.001) return body;
  if (k <= 0.001) return '';
  return `<g transform="translate(${cx} ${cy}) scale(${r(k)}) translate(${-cx} ${-cy})">${body}</g>`;
}

function prop(expression: Expression, c: FoxColors, k: number): string {
  switch (expression) {
    case 'thinking': {
      // Three thought dots, appearing one after another.
      const dots: Array<[number, number, number]> = [
        [104, 30, 3],
        [112, 20, 4.2],
        [121, 8.5, 5.4],
      ];
      const shown = dots
        .map(([x, y, radius], i) => {
          const d = Math.min(1, Math.max(0, k * 3 - i));
          return d > 0.001 ? `<circle cx="${x}" cy="${y}" r="${r(radius * d)}"/>` : '';
        })
        .join('');
      return shown ? `<g fill="${c.fur}">${shown}</g>` : '';
    }
    case 'reviewing':
      return reveal(
        `<g fill="none" stroke="${c.ink}" stroke-linecap="round"><circle cx="81" cy="64" r="11.5" stroke-width="3.2" fill="${c.highlight}" fill-opacity="0.18"/><path d="M89.5 73 L101 86" stroke-width="5"/></g>`,
        81,
        64,
        k,
      );
    case 'warning':
      return reveal(
        `<g><circle cx="108" cy="20" r="11" fill="${c.accent}"/><path d="M108 13.5 L108 21.5" stroke="${c.highlight}" stroke-width="3.2" stroke-linecap="round"/><circle cx="108" cy="26.6" r="1.9" fill="${c.highlight}"/></g>`,
        108,
        20,
        k,
      );
    case 'success':
      return reveal(
        `<g><circle cx="108" cy="20" r="11" fill="${c.fur}" stroke="${c.highlight}" stroke-width="2.5"/><path d="M103 20.5 L106.6 24 L113.4 16.5" fill="none" stroke="${c.highlight}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`,
        108,
        20,
        k,
      );
    default:
      return '';
  }
}

export function foxSvg(options: FoxOptions = {}): string {
  const expression = options.expression ?? 'neutral';
  const shape = SHAPES[expression];
  const c = { ...DEFAULT_FOX_COLORS, ...options.colors };
  const tilt = options.tilt ?? shape.tilt;
  const earTurn = options.ears ?? shape.ears;
  const look = options.look ?? shape.look;
  const blink = Math.min(1, Math.max(0, options.blink ?? 0));
  const open = Math.min(1, Math.max(0, options.mouth ?? 0));
  const size = options.size ?? 128;
  const bounce = options.bounce ?? 0;
  const showProps = options.props ?? true;
  const propK = Math.max(0, options.propReveal ?? 1);

  const head =
    'M26 54 C27 37 44 30 64 30 C84 30 101 37 102 54 L115 74 L100 80 C96 97 80 110 64 111 C48 110 32 97 28 80 L13 74 Z';
  const mask =
    'M15.5 74.5 L28 80 C32 97 48 110 64 111 C80 110 96 97 100 80 L112.5 74.5 C100 69 86 71 76.5 79 C71.5 83.5 68 87 64 87 C60 87 56.5 83.5 51.5 79 C42 71 28 69 15.5 74.5 Z';
  const nose = 'M58.2 88.6 Q64 85.6 69.8 88.6 Q68.6 93.8 64 95.4 Q59.4 93.8 58.2 88.6 Z';
  const blush = options.blush ?? true;

  const attrs = Object.entries({ ...options.attributes })
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');
  const title = options.title ?? `Covi the fox (${expression})`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" role="img"${attrs}>`,
    `<title>${title.replace(/</g, '&lt;')}</title>`,
    `<g transform="translate(0 ${r(bounce)}) rotate(${r(tilt)} 64 80)">`,
    ear(-1, earTurn, c),
    ear(1, earTurn, c),
    `<path d="${head}" fill="${c.fur}" stroke="${c.fur}" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="${mask}" fill="${c.mask}"/>`,
    blush
      ? `<g fill="${c.accent}" opacity="0.28"><ellipse cx="34" cy="85" rx="6" ry="3.6"/><ellipse cx="94" cy="85" rx="6" ry="3.6"/></g>`
      : '',
    eyes(shape.eyes, blink, look, c),
    `<path d="${nose}" fill="${c.ink}"/>`,
    mouth(shape.mouth, open, c),
    showProps && expression !== 'thinking' ? prop(expression, c, propK) : '',
    '</g>',
    showProps && expression === 'thinking' ? prop(expression, c, propK) : '',
    '</svg>',
  ].join('');
}

/** A minimal silhouette for favicons and small icons (no facial detail below ~24px). */
export function foxMarkSvg(
  options: { size?: number; color?: string; background?: string } = {},
): string {
  const size = options.size ?? 32;
  const fur = options.color ?? palette.cobalt;
  const bg = options.background;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}" role="img"><title>Covi</title>`,
    bg ? `<rect width="128" height="128" rx="28" fill="${bg}"/>` : '',
    `<path d="M22 52 L30 10 Q31.5 6 35 8.5 L60 34 Z M106 52 L98 10 Q96.5 6 93 8.5 L68 34 Z" fill="${fur}" stroke="${fur}" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M26 54 C27 37 44 30 64 30 C84 30 101 37 102 54 L115 74 L100 80 C96 97 80 110 64 111 C48 110 32 97 28 80 L13 74 Z" fill="${fur}"/>`,
    `<path d="M15.5 74.5 L28 80 C32 97 48 110 64 111 C80 110 96 97 100 80 L112.5 74.5 C100 69 86 71 76.5 79 C71.5 83.5 68 87 64 87 C60 87 56.5 83.5 51.5 79 C42 71 28 69 15.5 74.5 Z" fill="${palette.paper}"/>`,
    `<ellipse cx="47" cy="64" rx="6" ry="7.5" fill="${palette.charcoal}"/><ellipse cx="81" cy="64" rx="6" ry="7.5" fill="${palette.charcoal}"/>`,
    `<path d="M57 88 Q64 84.5 71 88 Q69.5 94.5 64 96.5 Q58.5 94.5 57 88 Z" fill="${palette.charcoal}"/>`,
    '</svg>',
  ].join('');
}

/** Fox mark plus the lowercase wordmark. */
export function logoSvg(options: { height?: number; theme?: 'light' | 'dark' } = {}): string {
  const height = options.height ?? 64;
  const ink = options.theme === 'dark' ? palette.paper : palette.charcoal;
  const width = Math.round(height * 3.4);
  const fox = foxSvg({ size: 128, expression: 'neutral', props: false })
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '')
    .replace(/<title>.*?<\/title>/, '');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 435 128" width="${width}" height="${height}" role="img"><title>Covi</title>`,
    `<g>${fox}</g>`,
    `<text x="140" y="96" font-family="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="92" font-weight="700" letter-spacing="-3" fill="${ink}">covi</text>`,
    '</svg>',
  ].join('');
}
