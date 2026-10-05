import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANIMATIONS,
  assetFiles,
  blendPoses,
  EXPRESSIONS,
  FOX_FRAME,
  foxBounds,
  foxMarkSvg,
  foxPose,
  foxSvg,
  logoSvg,
  markLevel,
  palette,
  type Rect,
  restingPose,
  TAIL_AIM_RANGE,
  tailShape,
} from '../src/index.ts';

type P = readonly [number, number];

function wellFormed(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  const tags = [...svg.matchAll(/<(\/?)([a-z]+)[^>]*?(\/?)>/g)];
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of tags) {
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
}

const count = (svg: string, color: string) => svg.split(color).length - 1;

/** Samples an SVG path of M, L, C, and Z commands into a polygon. */
function polygon(d: string): P[] {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g)!;
  const out: P[] = [];
  let at: P = [0, 0];
  let i = 0;
  let command = '';
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLCZ]/.test(tokens[i]!)) command = tokens[i++]!;
    if (command === 'Z') continue;
    if (command === 'C') {
      const [c1, c2, end]: P[] = [
        [num(), num()],
        [num(), num()],
        [num(), num()],
      ];
      for (let s = 1; s <= 12; s++) {
        const t = s / 12;
        const u = 1 - t;
        out.push([
          u ** 3 * at[0] + 3 * u * u * t * c1![0] + 3 * u * t * t * c2![0] + t ** 3 * end![0],
          u ** 3 * at[1] + 3 * u * u * t * c1![1] + 3 * u * t * t * c2![1] + t ** 3 * end![1],
        ]);
      }
      at = end!;
    } else {
      at = [num(), num()];
      out.push(at);
    }
  }
  return out;
}

function inside(p: P, poly: readonly P[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Distance from a circle's edge to a polygon's outline (negative when they overlap). */
function clearance(center: P, radius: number, poly: readonly P[]): number {
  if (inside(center, poly)) return -radius;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    best = Math.min(best, Math.hypot(center[0] - a[0] - t * dx, center[1] - a[1] - t * dy));
  }
  return best - radius;
}

function selfIntersects(poly: readonly P[]): boolean {
  const side = (p: P, q: P, r: P) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const n = poly.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  return false;
}

// The drawn silhouettes, read back from the SVG the fox is rendered with.
const neutral = foxSvg();
const HEAD = polygon(/d="(M70 20 C[^"]+)"/.exec(neutral)![1]!);
const BODY = polygon(/d="(M54 72 C[^"]+)"/.exec(neutral)![1]!);

const within = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const direction = (from: P, to: P) => {
  const a = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
  return (a + 360) % 360;
};
/** Where the play mark points: from the middle of its back edge to its tip. */
const markDirection = (mark: readonly P[]) => {
  const [backTop, tip, backBottom] = mark as [P, P, P];
  return direction([(backTop[0] + backBottom[0]) / 2, (backTop[1] + backBottom[1]) / 2], tip);
};
const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('fox mascot', () => {
  it('renders every expression as well-formed, deterministic SVG', () => {
    for (const expression of EXPRESSIONS) {
      const svg = foxSvg({ expression });
      wellFormed(svg);
      expect(foxSvg({ expression })).toBe(svg);
      expect(svg).toContain(palette.cobalt);
      expect(svg).toContain(`Covi the fox (${expression})`);
    }
  });

  it('is cobalt, not a conventional orange fox: the warm accent stays a small accent', () => {
    for (const expression of EXPRESSIONS)
      for (const theme of ['light', 'dark'] as const) {
        const svg = foxSvg({ expression, theme });
        const fur = theme === 'dark' ? palette.cobaltLight : palette.cobalt;
        expect(count(svg, fur), `${expression} (${theme})`).toBeGreaterThan(
          count(svg, palette.accent),
        );
      }
  });

  it('draws only with the palette: cobalt fur and deep socks, paper mask, charcoal features', () => {
    const tokens = new Set<string>(Object.values(palette));
    for (const theme of ['light', 'dark'] as const)
      for (const expression of EXPRESSIONS) {
        const colors = foxSvg({ expression, theme }).match(/#[0-9A-F]{6}/gi) ?? [];
        for (const color of colors) expect(tokens, color).toContain(color.toUpperCase());
      }
    expect(foxSvg()).toContain(palette.cobaltDeep);
    expect(foxSvg({ theme: 'dark' })).toContain(palette.cobaltLight);
    expect(foxSvg({ theme: 'dark' })).not.toContain(palette.cobaltDeep);
    // Flat shapes only.
    expect(foxSvg({ expression: 'warning' })).not.toMatch(/Gradient|<pattern|<filter/);
  });

  it('animates through parameters (blink, talk, gaze) and clamps them', () => {
    const open = foxSvg({ blink: 0 });
    const closed = foxSvg({ blink: 1 });
    expect(open).not.toBe(closed);
    expect(closed).toContain('stroke-linecap="round"');
    expect(foxSvg({ mouth: 2 })).toBe(foxSvg({ mouth: 1 }));
    expect(foxSvg({ look: { x: 1, y: 0 } })).not.toBe(foxSvg({ look: { x: -1, y: 0 } }));
    expect(foxSvg({ reach: 3, aim: 130 })).toBe(foxSvg({ reach: 1, aim: 130 }));
  });

  it('keeps every expression honest: round eyes, never narrowed', () => {
    for (const expression of EXPRESSIONS) {
      for (const [, rx, ry] of foxSvg({ expression }).matchAll(
        /<ellipse cx="[\d.]+" cy="5[\d.]+" rx="([\d.]+)" ry="([\d.]+)"/g,
      ))
        expect(Number(ry), expression).toBeGreaterThan(Number(rx));
    }
    expect(restingPose('thinking').brow.left).toBeLessThan(restingPose('thinking').brow.right);
    expect(foxSvg({ expression: 'reviewing' })).not.toContain('fill-opacity');
  });

  it('escapes titles and attributes', () => {
    const svg = foxSvg({ title: '<script>', attributes: { 'data-x': 'a"b' } });
    expect(svg).toContain('&lt;script>');
    expect(svg).toContain('data-x="a&quot;b"');
  });

  it('frames every expression, pointing tail included, in the asset frame', () => {
    for (const expression of EXPRESSIONS)
      expect(within(foxBounds({ expression }), FOX_FRAME), expression).toBe(true);
    expect(foxSvg({ frame: FOX_FRAME })).toContain('viewBox="-20 -12 154 154"');
  });

  it('keeps generated assets in sync with the mascot code', () => {
    for (const [name, content] of Object.entries(assetFiles())) {
      expect(
        readFileSync(join(import.meta.dirname, '../../../assets/covi', name), 'utf8'),
        `assets/covi/${name} is stale; run npm run assets`,
      ).toBe(content);
    }
    expect(Object.keys(assetFiles())).not.toContain('fox-mark-inverse.svg');
  });
});

describe('the tail rig', () => {
  const grid = (lo: number, hi: number, n: number) =>
    Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  const poses = grid(TAIL_AIM_RANGE.min, TAIL_AIM_RANGE.max, 5).flatMap((aim) =>
    grid(0, 1, 5).flatMap((reach) =>
      grid(-1, 1, 3).flatMap((curl) =>
        grid(0, 1, 3).flatMap((lift) =>
          grid(-1, 1, 3).flatMap((wag) =>
            [0, 1].map((puff) => ({ aim, reach, curl, lift, wag, puff })),
          ),
        ),
      ),
    ),
  );

  it('draws a clean shape for every combination of its parameters', () => {
    for (const pose of poses) {
      const tail = tailShape(pose);
      const label = JSON.stringify(pose);
      // The inner edge never folds: the radius of curvature stays above the half-width.
      tail.curvature.forEach((k, i) => {
        expect(((Math.abs(k) * Math.PI) / 180) * tail.widths[i]!, label).toBeLessThan(1);
      });
      expect(selfIntersects(tail.outline), label).toBe(false);
      // The base is hidden behind the body.
      expect(inside(tail.outline[0]!, BODY) && inside(tail.outline.at(-1)!, BODY), label).toBe(
        true,
      );
      // The disc sits in the cap, fully visible beside the head and body.
      expect(tail.disc, label).toBeLessThan(tail.cap.radius);
      expect(clearance(tail.cap.center, tail.disc, HEAD), label).toBeGreaterThanOrEqual(0);
      expect(clearance(tail.cap.center, tail.disc, BODY), label).toBeGreaterThanOrEqual(0);
      for (const p of tail.outline) expect(Number.isFinite(p[0] + p[1]), label).toBe(true);
    }
  });

  it('closes the tail with a round cap, concentric with the disc', () => {
    for (const pose of poses.filter((_, i) => i % 7 === 0)) {
      const { outline, cap } = tailShape(pose);
      const side = (outline.length - 11) / 2;
      for (const p of outline.slice(side - 1, side + 12))
        expect(Math.hypot(p[0] - cap.center[0], p[1] - cap.center[1])).toBeCloseTo(cap.radius, 6);
    }
  });

  it('keeps the play mark upright at rest and turns it into an arrow at the aim', () => {
    for (const wag of [-1, 0, 1])
      for (const curl of [-1, 0, 1]) {
        const mark = tailShape({ reach: 0, wag, curl }).mark;
        expect(markDirection(mark)).toBeCloseTo(0, 6);
        expect(mark).toHaveLength(4);
      }
    for (const aim of [105, 130, 160, 200, 240]) {
      const tail = tailShape({ reach: 1, aim });
      expect(angleGap(tail.tip, aim)).toBeLessThan(1);
      expect(angleGap(markDirection(tail.mark), aim)).toBeLessThan(1);
      // Extended, the mark is longer than it is wide and notched at the back: an arrowhead.
      const [backTop, tip, backBottom, notch] = tail.mark as [P, P, P, P];
      const length = Math.hypot(tip[0] - notch[0], tip[1] - notch[1]);
      expect(Math.hypot(backTop[0] - backBottom[0], backTop[1] - backBottom[1])).toBeLessThan(
        Math.hypot(
          tip[0] - (backTop[0] + backBottom[0]) / 2,
          tip[1] - (backTop[1] + backBottom[1]) / 2,
        ),
      );
      expect(length).toBeGreaterThan(0);
    }
  });

  it('turns the extended tip toward a target point', () => {
    for (const target of [
      { x: -150, y: 400 },
      { x: -300, y: 160 },
      { x: -80, y: 30 },
    ]) {
      const tail = tailShape({ reach: 1, aim: target });
      expect(angleGap(tail.tip, direction(tail.cap.center, [target.x, target.y]))).toBeLessThan(
        1.5,
      );
    }
    // A target out of the tail's reach (to the fox's right) gets the nearest reachable direction.
    expect(tailShape({ reach: 1, aim: 20 }).tip).toBeCloseTo(TAIL_AIM_RANGE.min, 0);
  });

  it('stays within the room its start and end take while it reaches out', () => {
    for (const aim of [100, 130, 160, 200]) {
      const ends = [tailShape({ aim, reach: 0 }), tailShape({ aim, reach: 1 })].flatMap(
        (t) => t.outline,
      );
      const left = Math.min(...ends.map((p) => p[0]));
      for (const reach of grid(0, 1, 21)) {
        const x = Math.min(...tailShape({ aim, reach }).outline.map((p) => p[0]));
        expect(x, `aim ${aim} reach ${reach}`).toBeGreaterThan(left - 5);
      }
    }
  });
});

describe('foxBounds', () => {
  it('covers everything drawn, including a tail that reaches past the box', () => {
    for (const options of [
      {},
      { expression: 'reviewing' as const },
      { reach: 1, aim: 180, lean: -1.5, bounce: -3 },
      { expression: 'warning' as const, puff: 1, lift: 0.6, tilt: 4 },
    ]) {
      const b = foxBounds(options);
      const tail = tailShape(options);
      for (const [x, y] of tail.outline) {
        expect(x).toBeGreaterThanOrEqual(b.x - 0.5);
        expect(y).toBeGreaterThanOrEqual(b.y - 0.5);
      }
      expect(b.parts.some((p) => within(p, b))).toBe(true);
    }
    expect(foxBounds({ reach: 1, aim: 160 }).x).toBeLessThan(-10);
    // At rest only the outer curl of the tail grazes the box's edge.
    expect(foxBounds().x).toBeGreaterThan(-3.5);
  });

  it('describes a pointing fox with parts tighter than its overall box', () => {
    const b = foxBounds({ reach: 1, aim: 150 });
    // Empty space above the outstretched tail is in the overall box but in no part.
    const empty: P = [-8, 40];
    expect(empty[0] > b.x && empty[1] > b.y).toBe(true);
    for (const p of b.parts)
      expect(
        empty[0] >= p.x &&
          empty[0] <= p.x + p.width &&
          empty[1] >= p.y &&
          empty[1] <= p.y + p.height,
      ).toBe(false);
  });

  it('is deterministic', () => {
    expect(foxBounds({ reach: 0.6, aim: 140, wag: 0.3 })).toEqual(
      foxBounds({ reach: 0.6, aim: 140, wag: 0.3 }),
    );
  });
});

describe('marks and logo', () => {
  it('steps detail down with size', () => {
    expect([16, 24, 32, 48, 64, 256].map(markLevel)).toEqual([
      'micro',
      'micro',
      'small',
      'small',
      'full',
      'full',
    ]);
    const chevrons = (svg: string) => count(svg, 'M46.8 15');
    const micro = foxMarkSvg({ size: 16 });
    const small = foxMarkSvg({ size: 32 });
    const full = foxMarkSvg({ size: 64 });
    for (const svg of [micro, small, full]) wellFormed(svg);
    // 24 px and below: no chevrons, and bigger eyes.
    expect(chevrons(micro)).toBe(0);
    expect(chevrons(small)).toBe(2);
    const eye = (svg: string) => Number(/<ellipse [^>]*rx="([\d.]+)"/.exec(svg)![1]);
    expect(eye(micro)).toBeGreaterThan(eye(small));
    // 64 px and up: eye highlights and the smile.
    expect(count(small, palette.white)).toBe(0);
    expect(count(full, palette.white)).toBe(2);
    expect(full).toContain('M66 67.4 Q70 71 74 67.4');
    expect(foxMarkSvg({ size: 64, level: 'micro' })).toBe(
      foxMarkSvg({ size: 16 }).replace(/width="16" height="16"/, 'width="64" height="64"'),
    );
  });

  it('draws app tiles on sky and charcoal', () => {
    const sky = foxMarkSvg({ size: 128, background: palette.sky });
    const charcoal = foxMarkSvg({ size: 128, background: palette.charcoal, theme: 'dark' });
    wellFormed(sky);
    expect(sky).toContain(`fill="${palette.sky}"`);
    expect(sky).toContain(palette.cobalt);
    expect(charcoal).toContain(`fill="${palette.charcoal}"`);
    expect(charcoal).toContain(palette.cobaltLight);
  });

  it('sets the wordmark in outlines with a ▶ dotting the i', () => {
    for (const layout of ['horizontal', 'stacked'] as const) {
      const light = logoSvg({ layout });
      const dark = logoSvg({ layout, theme: 'dark' });
      wellFormed(light);
      wellFormed(dark);
      expect(light).not.toContain('<text');
      expect(light).toContain(`fill="${palette.charcoal}"`);
      expect(dark).toContain(`fill="${palette.paper}"`);
      // The ▶ is cobalt, lifted on dark backgrounds.
      expect(light).toMatch(
        new RegExp(`L[^"]+Z" fill="${palette.cobalt}" stroke="${palette.cobalt}"`),
      );
      expect(dark).toMatch(
        new RegExp(`L[^"]+Z" fill="${palette.cobaltLight}" stroke="${palette.cobaltLight}"`),
      );
    }
    expect(logoSvg({ height: 64 })).toMatch(/width="\d+" height="64"/);
    // The stacked logo carries the whole fox; the horizontal one the head mark.
    expect(logoSvg({ layout: 'stacked' })).toContain('M54 72');
    expect(logoSvg()).not.toContain('M54 72');
  });
});

describe('foxPose (the narrator animations)', () => {
  const base = {
    t: 2,
    time: 10,
    mouth: 0,
    blink: 0,
    gaze: { x: -0.7, y: 0.45 },
    pointing: false,
  };

  it('names all seven animations', () => {
    expect(ANIMATIONS).toEqual(['blink', 'talk', 'look', 'think', 'alert', 'approve', 'point']);
  });

  it('is a pure function of time', () => {
    const input = { ...base, expression: 'warning' as const, t: 0.2, seed: 3 };
    expect(foxPose(input)).toEqual(foxPose(input));
    expect(foxSvg(foxPose(input).fox)).toBe(foxSvg(foxPose(input).fox));
  });

  it('blinks, talks, and looks at the content', () => {
    const pose = foxPose({ ...base, expression: 'explaining', mouth: 0.6, blink: 0.5 });
    expect(pose.active).toEqual(expect.arrayContaining(['blink', 'talk', 'look']));
    expect(pose.fox.look).toEqual({ x: -0.7, y: 0.45 });
  });

  it('flicks the tail on loud syllables and sways it a little on a seeded phase', () => {
    const quiet = foxPose({ ...base, expression: 'explaining' });
    const loud = foxPose({ ...base, expression: 'explaining', mouth: 1 });
    expect(loud.fox.curl).toBeGreaterThan(quiet.fox.curl!);
    const sway = (seed: number) =>
      [0, 0.5, 1, 1.5].map(
        (time) => foxPose({ ...base, expression: 'neutral', time, seed }).fox.wag,
      );
    expect(new Set(sway(1)).size).toBeGreaterThan(1);
    expect(sway(1)).not.toEqual(sway(2));
    for (const w of sway(1)) expect(Math.abs(w!)).toBeLessThan(0.2);
  });

  it('thinks: sways, looks away, and shows thought dots one by one', () => {
    const early = foxPose({ ...base, expression: 'thinking', t: 0.6 });
    const late = foxPose({ ...base, expression: 'thinking', t: 2 });
    expect(late.active).toContain('think');
    expect(early.fox.propReveal).toBeLessThan(late.fox.propReveal!);
    expect(late.fox.look!.y).toBeLessThan(0); // up and away, not at the content
    expect((foxSvg(early.fox).match(/<circle/g) ?? []).length).toBeLessThan(
      (foxSvg(late.fox).match(/<circle/g) ?? []).length,
    );
    expect(foxPose({ ...base, expression: 'thinking', pointing: true }).fox.reach).toBe(0);
  });

  it('alerts: ears flick, the badge pops in, and the tail puffs up and lifts', () => {
    const start = foxPose({ ...base, expression: 'warning', t: 0.05 });
    const later = foxPose({ ...base, expression: 'warning', t: 2 });
    expect(start.active).toContain('alert');
    expect(start.fox.propReveal).toBeLessThan(1);
    expect(later.fox.propReveal).toBe(1);
    expect(start.fox.ears).not.toBe(later.fox.ears);
    expect(start.fox.puff).toBeLessThan(later.fox.puff!);
    expect(later.fox.puff).toBe(1);
    expect(later.fox.lift).toBeGreaterThan(0);
    expect(foxPose({ ...base, expression: 'warning', t: 0 }).fox.puff).toBe(0);
  });

  it('approves: nods twice and wags while the check badge appears', () => {
    const frames = [0.3, 0.45, 0.6, 0.75].map((t) =>
      foxPose({ ...base, expression: 'success', t }),
    );
    expect(frames[0]!.active).toContain('approve');
    expect(new Set(frames.map((p) => p.fox.nod!.toFixed(2))).size).toBeGreaterThan(2);
    expect(new Set(frames.map((p) => p.fox.wag!.toFixed(2))).size).toBeGreaterThan(2);
    expect(foxPose({ ...base, expression: 'success', t: 3 }).fox.nod).toBeCloseTo(0, 1);
  });

  it('points: the tail reaches out toward the highlighted content once it is on screen', () => {
    const before = foxPose({ ...base, expression: 'reviewing', t: 0.3, pointing: true });
    const after = foxPose({ ...base, expression: 'reviewing', t: 2, pointing: true, aim: 125 });
    expect(before.active).not.toContain('point');
    expect(before.fox.reach).toBe(0);
    expect(after.active).toContain('point');
    expect(after.fox.reach).toBe(1);
    expect(after.fox.aim).toBe(125);
    // The body only leans a little now that the tail points.
    expect(Math.abs(after.fox.lean!)).toBeLessThanOrEqual(2);
    // Without an aim, the tail points the way the eyes look.
    const gaze = foxPose({ ...base, expression: 'explaining', pointing: true });
    expect(angleGap(gaze.fox.aim as number, direction([0, 0], [-0.7, 0.45]))).toBeLessThan(0.01);
    // Layouts with no room keep the tail curled.
    expect(foxPose({ ...base, expression: 'explaining', pointing: true, reach: 0 }).fox.reach).toBe(
      0,
    );
    expect(foxPose({ ...base, expression: 'reviewing', t: 2 }).fox.reach).toBe(0);
  });

  it('moves the tail continuously: nearby moments give nearby shapes', () => {
    const outlineAt = (expression: (typeof EXPRESSIONS)[number], pointing: boolean, t: number) =>
      tailShape(foxPose({ ...base, expression, t, time: 5 + t, pointing, aim: 125, seed: 7 }).fox)
        .outline;
    const distance = (a: readonly P[], b: readonly P[]) =>
      Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1])));
    const h = 1 / 60;
    for (const expression of EXPRESSIONS)
      for (const pointing of [false, true])
        for (let t = 0; t <= 3; t += h) {
          const now = outlineAt(expression, pointing, t);
          const step = distance(now, outlineAt(expression, pointing, t + h));
          const half = distance(now, outlineAt(expression, pointing, t + h / 2));
          const label = `${expression} pointing=${pointing} t=${t.toFixed(3)}`;
          // A swing is fast at most; a pop would not shrink when the time step does.
          expect(step, label).toBeLessThan(6);
          expect(half, label).toBeLessThan(0.65 * step + 0.05);
        }
  });

  it('eases between poses across a cut instead of popping', () => {
    const pointing = foxPose({ ...base, expression: 'reviewing', pointing: true, aim: 120 });
    const resting = foxPose({ ...base, expression: 'success', t: 0 });
    expect(blendPoses(pointing, resting, 0).fox.reach).toBe(1);
    expect(blendPoses(pointing, resting, 1).fox.reach).toBe(0);
    let previous: readonly P[] | undefined;
    for (let w = 0; w <= 1.0001; w += 0.02) {
      const pose = blendPoses(pointing, resting, w);
      expect(pose.fox.expression).toBe(w < 0.5 ? 'reviewing' : 'success');
      const outline = tailShape(pose.fox).outline;
      if (previous)
        expect(
          Math.max(
            ...outline.map((p, i) => Math.hypot(p[0] - previous![i]![0], p[1] - previous![i]![1])),
          ),
        ).toBeLessThan(6);
      previous = outline;
    }
    // The outgoing prop shrinks away before the new one appears.
    expect(blendPoses(pointing, resting, 0.5).fox.propReveal).toBe(0);
  });
});
