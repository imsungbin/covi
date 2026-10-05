import {
  boundsOf,
  clamp,
  corners,
  type Point,
  type Rect,
  r,
  rotate,
  smoothClosed,
  union,
} from './geometry.ts';
import { type TailOptions, tailParts, tailShape } from './tail.ts';
import { palette } from './tokens.ts';

/**
 * The Covi fox: a seated, full-body blue fox, after the Arctic fox's blue morph (a round face and
 * a short muzzle read as clever and honest, never sly). Code and video signs are built into the
 * body: < > chevrons in the ears and a play disc at the end of the tail, which the tail swings
 * out to point with. Every animation is a parameter, so the same function renders a static asset
 * or one frame of the narrator.
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

/** The face mask's arches over the eyes act as eyebrows: offsets in view-box units, + lowers. */
export interface Brow {
  left: number;
  right: number;
  /** Where the two arches meet between the eyes. */
  inner: number;
}

export interface FoxOptions extends TailOptions {
  expression?: Expression;
  /** Rendered width/height in px. */
  size?: number;
  /**
   * The part of the drawing the image shows, in view-box units: the 128×128 box by default.
   * Inline SVG shows a pointing tail past it; standalone images clip to it, so assets pass
   * `FOX_FRAME`.
   */
  frame?: Rect;
  /** 0 = eyes open, 1 = closed. */
  blink?: number;
  /** 0 = closed mouth, 1 = fully open (talking). */
  mouth?: number;
  /** Gaze direction, each axis in -1…1; the head turns a little with the eyes. */
  look?: { x: number; y: number };
  /** Head rotation in degrees (positive tilts clockwise). */
  tilt?: number;
  /** Ear rotation in degrees; positive turns ears outward (alert/back). */
  ears?: number;
  /** Eyebrow offsets; overrides the expression's brows axis by axis. */
  brow?: Partial<Brow>;
  /** Vertical offset of the whole fox in viewBox units (bounces). */
  bounce?: number;
  /** How far the head dips, in viewBox units (nods). */
  nod?: number;
  /** Whole-body lean in degrees about the feet; negative leans left. */
  lean?: number;
  /** Show the expression's prop (thought dots, badge). Defaults to true. */
  props?: boolean;
  /**
   * How far the prop has appeared, 0–1 (values a little above 1 overshoot a pop). Thought dots
   * appear one after another; badges scale in. Defaults to 1.
   */
  propReveal?: number;
  /** Cheek blush in the warm accent. */
  blush?: boolean;
  /** The background the fox sits on; on dark backgrounds the fur is lifted to keep contrast. */
  theme?: 'light' | 'dark';
  title?: string;
  /** Extra attributes for the root <svg>. */
  attributes?: Record<string, string>;
  colors?: Partial<FoxColors>;
}

export interface FoxColors {
  fur: string;
  /** The front paws. */
  socks: string;
  /** Face mask, bib, and the tail's disc. */
  mask: string;
  /** The < > chevrons inside the ears. */
  inner: string;
  ink: string;
  accent: string;
  highlight: string;
}

export const DEFAULT_FOX_COLORS: FoxColors = {
  fur: palette.cobalt,
  socks: palette.cobaltDeep,
  mask: palette.paper,
  inner: palette.paper,
  ink: palette.charcoal,
  accent: palette.accent,
  highlight: palette.white,
};

/** On dark backgrounds the fur takes the dark theme's lifted cobalt and the paws plain cobalt. */
export const DARK_FOX_COLORS: FoxColors = {
  ...DEFAULT_FOX_COLORS,
  fur: palette.cobaltLight,
  socks: palette.cobalt,
};

export function foxColors(options: Pick<FoxOptions, 'theme' | 'colors'> = {}): FoxColors {
  return {
    ...(options.theme === 'dark' ? DARK_FOX_COLORS : DEFAULT_FOX_COLORS),
    ...options.colors,
  };
}

interface TailRest {
  reach: number;
  aim: number;
  curl: number;
  lift: number;
  puff: number;
}

interface ExpressionShape {
  eyes: 'round' | 'focus' | 'wide' | 'happy';
  mouth: 'smile' | 'flat' | 'open' | 'o' | 'grin';
  brow: Brow;
  tilt: number;
  ears: number;
  look: { x: number; y: number };
  tail: TailRest;
}

const CURLED: TailRest = { reach: 0, aim: 140, curl: 0, lift: 0, puff: 0 };

// No expression narrows the eyes: round eyes under arched brows keep the fox honest, not sly.
const SHAPES: Record<Expression, ExpressionShape> = {
  neutral: {
    eyes: 'round',
    mouth: 'smile',
    brow: { left: 0, right: 0, inner: 0 },
    tilt: 0,
    ears: 0,
    look: { x: 0, y: 0 },
    tail: CURLED,
  },
  explaining: {
    eyes: 'round',
    mouth: 'open',
    brow: { left: -1, right: -1, inner: -0.6 },
    tilt: -3,
    ears: -2,
    look: { x: 0.15, y: 0 },
    tail: CURLED,
  },
  thinking: {
    eyes: 'round',
    mouth: 'flat',
    brow: { left: -2.6, right: 0.6, inner: 0 },
    tilt: -7,
    ears: 3,
    look: { x: 0.65, y: -0.75 },
    tail: CURLED,
  },
  reviewing: {
    eyes: 'focus',
    mouth: 'flat',
    brow: { left: 1.2, right: 1.2, inner: 1.6 },
    tilt: 3,
    ears: -4,
    look: { x: -0.55, y: 0.5 },
    tail: { ...CURLED, reach: 1, aim: 140 },
  },
  warning: {
    eyes: 'wide',
    mouth: 'o',
    brow: { left: -2.4, right: -2.4, inner: -2.2 },
    tilt: 0,
    ears: 7,
    look: { x: 0, y: 0 },
    tail: { ...CURLED, puff: 1 },
  },
  success: {
    eyes: 'happy',
    mouth: 'grin',
    brow: { left: -1, right: -1, inner: -0.6 },
    tilt: 3,
    ears: -4,
    look: { x: 0, y: 0 },
    tail: CURLED,
  },
};

/** The resting pose an expression starts from; animations move relative to it. */
export function restingPose(expression: Expression): {
  tilt: number;
  ears: number;
  look: { x: number; y: number };
  brow: Brow;
} & TailRest {
  const { tilt, ears, look, brow, tail } = SHAPES[expression];
  return { tilt, ears, look, brow, ...tail };
}

const HEAD =
  'M70 20 C86 20 100 28 103 42 C104.5 49 106 55 110 61 C104.5 64 100 66 97.5 68.5 C92 75.5 82 79.5 70 79.5 C58 79.5 48 75.5 42.5 68.5 C40 66 35.5 64 30 61 C34 55 35.5 49 37 42 C40 28 54 20 70 20 Z';
const BODY =
  'M54 72 C47 82 43.5 93 41.5 103 C39.5 113 41 121.5 50 122 L90 122 C99 121.5 100.5 113 98.5 103 C96.5 93 93 82 86 72 Z';
const BIB = 'M56.5 73 C55.5 84 60 94 70 101 C80 94 84.5 84 83.5 73 Z';
const SOCKS = [
  'M60 102 C60 100.6 68 100.6 68 102 L68.6 117.6 C68.6 123.2 59.4 123.2 59.4 117.6 Z',
  'M72 102 C72 100.6 80 100.6 80 102 L80.6 117.6 C80.6 123.2 71.4 123.2 71.4 117.6 Z',
];
const NOSE = 'M65.8 59 Q70 56.9 74.2 59 Q73.3 62.8 70 63.8 Q66.7 62.8 65.8 59 Z';
const EAR = 'M37 42 C34.5 31 33.5 20 34.5 11.5 C35 6.5 39 5 42.5 7.8 C49 13 56 19 63 25.5 Z';
const CHEVRON = 'M46.8 15 L41.2 21.8 L47.2 28.6';

/** Control points of the shapes, for bounds (a Bézier curve lies inside its control points). */
const EAR_POINTS: Point[] = [
  [37, 42],
  [34.5, 31],
  [33.5, 20],
  [34.5, 11.5],
  [35, 6.5],
  [39, 5],
  [42.5, 7.8],
  [49, 13],
  [56, 19],
  [63, 25.5],
];
const HEAD_BOX: Rect = { x: 30, y: 20, width: 80, height: 59.5 };
const BODY_BOX: Rect = { x: 40.5, y: 72, width: 59, height: 51.2 };
/** Head turns pivot under the chin; the whole body leans about the feet. */
const NECK: Point = [70, 74];
const FEET: Point = [70, 122];
const EAR_PIVOT = { left: [50, 32] as Point, right: [90, 32] as Point };

function ear(side: -1 | 1, turn: number, c: FoxColors): string {
  // The left ear is drawn and mirrored about the fox's center line (x = 70) for the right.
  const mirror = side === 1 ? ' translate(140 0) scale(-1 1)' : '';
  const pivot = side === 1 ? EAR_PIVOT.right : EAR_PIVOT.left;
  const t = turn ? `rotate(${r(turn * side)} ${pivot[0]} ${pivot[1]})` : '';
  return `<g transform="${(t + mirror).trim()}"><path d="${EAR}" fill="${c.fur}" stroke="${c.fur}" stroke-width="2.4" stroke-linejoin="round"/><path d="${CHEVRON}" fill="none" stroke="${c.inner}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

/** The face mask; its arches over the eyes double as eyebrows. */
function mask({ left: bl, right: br, inner: bi }: Brow): string {
  return [
    'M33.5 61',
    `C38 56.5 40 ${r(50.5 + bl * 0.4)} 43.5 ${r(46 + bl * 0.7)}`,
    `C47 ${r(40.5 + bl)} 52 ${r(39 + bl)} 56 ${r(39 + bl)}`,
    `C61 ${r(39 + bl * 0.8 + bi * 0.4)} 65 ${r(42 + bi)} 70 ${r(45.5 + bi)}`,
    `C75 ${r(42 + bi)} 79 ${r(39 + br * 0.8 + bi * 0.4)} 84 ${r(39 + br)}`,
    `C88 ${r(39 + br)} 93 ${r(40.5 + br)} 96.5 ${r(46 + br * 0.7)}`,
    `C100 ${r(50.5 + br * 0.4)} 102 56.5 106.5 61`,
    'C102 63 98 64.5 95 67 C90 73 81 76 70 76 C59 76 50 73 45 67 C42 64.5 38 63 33.5 61 Z',
  ].join(' ');
}

const EYE_X = { left: 55, right: 85 };
const EYE_Y = 51.5;

function eyes(
  shape: ExpressionShape['eyes'],
  blink: number,
  look: { x: number; y: number },
  c: FoxColors,
): string {
  const lx = look.x * 2.4;
  const ly = look.y * 2.1;
  if (shape === 'happy' || blink >= 0.98) {
    // Closed eyes: gentle arcs (smiling when happy, flat when blinking).
    const d =
      shape === 'happy'
        ? (x: number) => `M${x - 5} ${EYE_Y + 2} Q${x} ${EYE_Y - 4.6} ${x + 5} ${EYE_Y + 2}`
        : (x: number) =>
            `M${x - 4.6} ${EYE_Y + 0.6} Q${x} ${EYE_Y + 2.6} ${x + 4.6} ${EYE_Y + 0.6}`;
    return `<g fill="none" stroke="${c.ink}" stroke-width="2.8" stroke-linecap="round"><path d="${d(EYE_X.left)}"/><path d="${d(EYE_X.right)}"/></g>`;
  }
  const base =
    shape === 'wide'
      ? { rx: 5.2, ry: 6.6 }
      : shape === 'focus'
        ? { rx: 4.5, ry: 5.3 }
        : { rx: 4.7, ry: 5.8 };
  const ry = r(Math.max(0.6, base.ry * (1 - blink)));
  const eye = (x: number) =>
    `<ellipse cx="${r(x + lx)}" cy="${r(EYE_Y + ly)}" rx="${base.rx}" ry="${ry}" fill="${c.ink}"/>` +
    (ry > 2.2
      ? `<circle cx="${r(x + lx + 1.6)}" cy="${r(EYE_Y + ly - ry * 0.38)}" r="1.7" fill="${c.highlight}"/>`
      : '');
  return eye(EYE_X.left) + eye(EYE_X.right);
}

function mouth(shape: ExpressionShape['mouth'], open: number, c: FoxColors): string {
  const y = 66.4;
  if (open > 0.05) {
    // Talking: an open smile whose depth follows the voice amplitude.
    const w = 4 + open * 2;
    const depth = y + 2.6 + open * 7;
    return `<path d="M${r(70 - w)} ${y} Q70 ${r(depth)} ${r(70 + w)} ${y} Q70 ${r(y + 0.9)} ${r(70 - w)} ${y} Z" fill="${c.ink}"/>`;
  }
  const stroke = `fill="none" stroke="${c.ink}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"`;
  switch (shape) {
    case 'flat':
      return `<path d="M66.6 67.4 L73.4 67.4" ${stroke}/>`;
    case 'o':
      return `<ellipse cx="70" cy="68" rx="2.5" ry="3.1" fill="${c.ink}"/>`;
    case 'grin':
      return `<path d="M64.6 65.8 Q70 73.6 75.4 65.8 Z" fill="${c.ink}" stroke="${c.ink}" stroke-width="1" stroke-linejoin="round"/>`;
    case 'open':
      return `<path d="M65.8 66 Q70 71.6 74.2 66 Q70 67 65.8 66 Z" fill="${c.ink}"/>`;
    default:
      return `<path d="M66 66.4 Q70 70 74 66.4" ${stroke}/>`;
  }
}

/** Scales a prop about its center as it appears (fully shown at 1). */
function reveal(body: string, cx: number, cy: number, k: number): string {
  if (k >= 0.999 && k <= 1.001) return body;
  if (k <= 0.001) return '';
  return `<g transform="translate(${cx} ${cy}) scale(${r(k)}) translate(${-cx} ${-cy})">${body}</g>`;
}

const THOUGHT_DOTS: Array<[number, number, number]> = [
  [106, 33, 2.8],
  [113, 22.5, 3.9],
  [121, 10.5, 5.1],
];
const BADGE = { x: 116, y: 20, r: 10 };

function prop(expression: Expression, c: FoxColors, k: number): string {
  switch (expression) {
    case 'thinking': {
      // Three thought dots, appearing one after another.
      const shown = THOUGHT_DOTS.map(([x, y, radius], i) => {
        const d = clamp(k * 3 - i);
        return d > 0.001 ? `<circle cx="${x}" cy="${y}" r="${r(radius * d)}"/>` : '';
      }).join('');
      return shown ? `<g fill="${c.fur}">${shown}</g>` : '';
    }
    case 'warning':
      return reveal(
        `<g><circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r}" fill="${c.accent}"/><path d="M116 14 L116 21.4" stroke="${c.highlight}" stroke-width="3.1" stroke-linecap="round"/><circle cx="116" cy="26" r="1.85" fill="${c.highlight}"/></g>`,
        BADGE.x,
        BADGE.y,
        k,
      );
    case 'success':
      return reveal(
        `<g><circle cx="${BADGE.x}" cy="${BADGE.y}" r="${BADGE.r}" fill="${c.fur}" stroke="${c.highlight}" stroke-width="2.4"/><path d="M111.4 20.4 L114.8 23.8 L121 16.8" fill="none" stroke="${c.highlight}" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/></g>`,
        BADGE.x,
        BADGE.y,
        k,
      );
    default:
      return '';
  }
}

interface Resolved {
  expression: Expression;
  shape: ExpressionShape;
  tilt: number;
  ears: number;
  look: { x: number; y: number };
  brow: Brow;
  tail: TailOptions;
  bounce: number;
  lean: number;
  /** The head's shift toward the gaze, plus the nod. */
  head: { x: number; y: number };
  props: boolean;
  propReveal: number;
}

function resolve(options: FoxOptions): Resolved {
  const expression = options.expression ?? 'neutral';
  const shape = SHAPES[expression];
  const look = options.look ?? shape.look;
  return {
    expression,
    shape,
    tilt: options.tilt ?? shape.tilt,
    ears: options.ears ?? shape.ears,
    look,
    brow: { ...shape.brow, ...options.brow },
    tail: {
      reach: options.reach ?? shape.tail.reach,
      aim: options.aim ?? shape.tail.aim,
      curl: options.curl ?? shape.tail.curl,
      lift: options.lift ?? shape.tail.lift,
      wag: options.wag ?? 0,
      puff: options.puff ?? shape.tail.puff,
    },
    bounce: options.bounce ?? 0,
    lean: options.lean ?? 0,
    // A small head shift toward the gaze keeps looking from being eyes-only.
    head: { x: look.x * 0.9, y: (options.nod ?? 0) + look.y * 0.5 },
    props: options.props ?? true,
    propReveal: Math.max(0, options.propReveal ?? 1),
  };
}

/** The fox's shapes without the surrounding <svg> (for lockups that place it themselves). */
export function foxMarkup(options: FoxOptions = {}): string {
  const o = resolve(options);
  const c = foxColors(options);
  const blink = clamp(options.blink ?? 0);
  const open = clamp(options.mouth ?? 0);
  const blush = options.blush ?? true;
  const tail = tailShape(o.tail);
  return [
    `<g transform="translate(0 ${r(o.bounce)}) rotate(${r(o.lean)} ${FEET[0]} ${FEET[1]})">`,
    // The tail goes first: its base is hidden behind the body.
    `<path d="${smoothClosed(tail.outline)}" fill="${c.fur}"/>`,
    `<circle cx="${r(tail.cap.center[0])}" cy="${r(tail.cap.center[1])}" r="${r(tail.disc)}" fill="${c.mask}"/>`,
    `<path d="M${tail.mark.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L')} Z" fill="${c.fur}" stroke="${c.fur}" stroke-width="2.2" stroke-linejoin="round"/>`,
    `<path d="${BODY}" fill="${c.fur}"/>`,
    `<path d="${BIB}" fill="${c.mask}"/>`,
    `<g fill="${c.socks}">${SOCKS.map((d) => `<path d="${d}"/>`).join('')}</g>`,
    `<g transform="translate(${r(o.head.x)} ${r(o.head.y)}) rotate(${r(o.tilt)} ${NECK[0]} ${NECK[1]})">`,
    ear(-1, o.ears, c),
    ear(1, o.ears, c),
    `<path d="${HEAD}" fill="${c.fur}"/>`,
    `<path d="${mask(o.brow)}" fill="${c.mask}"/>`,
    blush
      ? `<g fill="${c.accent}" opacity="0.3"><ellipse cx="46" cy="61.5" rx="4.6" ry="2.8"/><ellipse cx="94" cy="61.5" rx="4.6" ry="2.8"/></g>`
      : '',
    eyes(o.shape.eyes, blink, o.look, c),
    `<path d="${NOSE}" fill="${c.ink}"/>`,
    mouth(o.shape.mouth, open, c),
    o.props && o.expression !== 'thinking' ? prop(o.expression, c, o.propReveal) : '',
    '</g>',
    '</g>',
    // Thought dots float beside the head, outside its motion.
    o.props && o.expression === 'thinking' ? prop(o.expression, c, o.propReveal) : '',
  ].join('');
}

/** A frame with room for every expression's resting pose, the pointing tail included. */
export const FOX_FRAME: Rect = { x: -20, y: -12, width: 154, height: 154 };

export function foxSvg(options: FoxOptions = {}): string {
  const size = options.size ?? 128;
  const f = options.frame ?? { x: 0, y: 0, width: 128, height: 128 };
  const attrs = Object.entries({ ...options.attributes })
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`)
    .join('');
  const title = options.title ?? `Covi the fox (${options.expression ?? 'neutral'})`;
  return [
    // A pointing tail reaches past the frame; inline SVG shows it instead of clipping it.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.x} ${f.y} ${f.width} ${f.height}" width="${size}" height="${size}" overflow="visible" role="img"${attrs}>`,
    `<title>${title.replace(/</g, '&lt;')}</title>`,
    foxMarkup(options),
    '</svg>',
  ].join('');
}

export interface FoxBounds extends Rect {
  /** Boxes that cover the fox's shapes, tighter than the overall box when the tail points. */
  parts: Rect[];
  /** The parts that cover the tail, the one part that reaches out of the box. */
  tail: Rect[];
}

const transformed = (b: Rect, f: (p: Point) => Point): Rect => boundsOf(corners(b).map(f));
const padded = (b: Rect, by: number): Rect => ({
  x: b.x - by,
  y: b.y - by,
  width: b.width + 2 * by,
  height: b.height + 2 * by,
});

/**
 * Where the fox actually is for a pose, in view-box units: the tail can reach past the 128×128
 * box when it points, so layout checks use these instead of the box.
 */
export function foxBounds(options: FoxOptions = {}): FoxBounds {
  const o = resolve(options);
  // The same transforms as the drawing: the head turns about the neck and shifts, inside the
  // whole body's lean about the feet and its bounce.
  const whole = (p: Point): Point => {
    const q = rotate(p, o.lean, FEET);
    return [q[0], q[1] + o.bounce];
  };
  const head = (p: Point): Point => {
    const q = rotate(p, o.tilt, NECK);
    return whole([q[0] + o.head.x, q[1] + o.head.y]);
  };
  const earBox = (side: -1 | 1) => {
    const pivot = side === 1 ? EAR_PIVOT.right : EAR_PIVOT.left;
    return padded(
      boundsOf(
        EAR_POINTS.map((p): Point => (side === 1 ? [140 - p[0], p[1]] : p)).map((p) =>
          rotate(p, o.ears * side, pivot),
        ),
      ),
      1.2,
    );
  };
  const tail = tailParts(tailShape(o.tail)).map((b) => transformed(b, whole));
  const parts: Rect[] = [
    transformed(BODY_BOX, whole),
    transformed(union([HEAD_BOX, earBox(-1), earBox(1)]), head),
    ...tail,
  ];
  if (o.props && o.propReveal > 0.001) {
    if (o.expression === 'thinking') {
      const dots = THOUGHT_DOTS.map(([x, y, radius]) => ({
        x: x - radius,
        y: y - radius,
        width: 2 * radius,
        height: 2 * radius,
      }));
      parts.push(union(dots));
    } else if (o.expression === 'warning' || o.expression === 'success') {
      const k = Math.max(1, o.propReveal);
      const radius = BADGE.r * k + 1.2;
      parts.push(
        transformed(
          { x: BADGE.x - radius, y: BADGE.y - radius, width: 2 * radius, height: 2 * radius },
          head,
        ),
      );
    }
  }
  return { ...union(parts), parts, tail };
}
