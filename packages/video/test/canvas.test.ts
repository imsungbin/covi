import { describe, expect, it } from 'vitest';
import { easeInOutCubic } from '../src/runtime/anim.ts';
import {
  beatView,
  between,
  type CameraStep,
  clampView,
  clipRect,
  drawnRect,
  featherOf,
  follower,
  gridStyle,
  insetOf,
  layerTransform,
  lerpRect,
  pullBack,
  restView,
  toWorld,
  unview,
  viewAt,
  withPush,
} from '../src/runtime/canvas.ts';
import { clearance, computeRegions, gridSpacing } from '../src/runtime/layout.ts';
import { isCameraMove, type Point } from '../src/timeline/types.ts';

const { media } = computeRegions({ width: 1920, height: 1080, orientation: 'landscape' });
const pivot = { x: media.x + media.width / 2, y: media.y + media.height / 2 };
const stop = { x: 2400, y: 1560 };
const TRANSFORM = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/;
/** Where a stop-local point lands on screen under a layer transform (origin 0 0). */
const screen = (transform: string, p: Point): Point => {
  const m = TRANSFORM.exec(transform)!;
  const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { x: tx + s * p.x, y: ty + s * p.y };
};

describe('the canvas camera', () => {
  it('draws a stop at rest as it is, wherever the stop sits', () => {
    expect(layerTransform(toWorld(restView(pivot), stop), stop, pivot)).toBe(
      'translate(0.00px, 0.00px) scale(1.00000)',
    );
    // A frame whose dots are not whole pixels apart: float error at rest prints no sign.
    const small = computeRegions({ width: 1366, height: 768, orientation: 'landscape' });
    const center = {
      x: small.media.x + small.media.width / 2,
      y: small.media.y + small.media.height / 2,
    };
    const grid = gridSpacing(small.unit);
    const far = { x: 240 * grid, y: 52 * grid };
    expect(layerTransform(toWorld(restView(center), far), far, center)).toBe(
      'translate(0.00px, 0.00px) scale(1.00000)',
    );
  });

  it('pushes in about the media region’s center, as the camera did without a canvas', () => {
    const view = clampView(withPush(restView(pivot), 0.02), media, pivot);
    const t = layerTransform(toWorld(view, stop), stop, pivot);
    const corner = { x: media.x, y: media.y };
    expect(screen(t, pivot).x).toBeCloseTo(pivot.x, 1);
    expect(screen(t, corner).x).toBeCloseTo(pivot.x + 1.02 * (corner.x - pivot.x), 1);
    expect(screen(t, corner).y).toBeCloseTo(pivot.y + 1.02 * (corner.y - pivot.y), 1);
  });

  it('draws a box laid out in a stop where the camera draws its layer', () => {
    const box = { x: 300, y: 400, width: 120, height: 60 };
    const rest = drawnRect(box, toWorld(restView(pivot), stop), stop, pivot);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(rest[key]).toBeCloseTo(box[key], 6);
    const view = toWorld(beatView('zoom', box, 2, restView(pivot), media, pivot), stop);
    const t = layerTransform(view, stop, pivot);
    const drawn = drawnRect(box, view, stop, pivot);
    expect(drawn.x).toBeCloseTo(screen(t, box).x, 1);
    expect(drawn.y).toBeCloseTo(screen(t, box).y, 1);
    expect(drawn.width).toBeCloseTo(240, 6);
    expect(drawn.height).toBeCloseTo(120, 6);
  });

  it('zooms a beat onto its target, fits it when no zoom is given, and never shows past the region', () => {
    const target = { x: 800, y: 450, width: 200, height: 100 };
    const from = restView(pivot);
    expect(beatView('zoom', target, 2, from, media, pivot)).toEqual({ x: 900, y: 500, scale: 2 });
    expect(beatView('zoom', target, undefined, from, media, pivot).scale).toBe(2.5);
    // A target at the region's corner: the view stops where the region's edge meets the frame's.
    const corner = beatView(
      'zoom',
      { x: media.x, y: media.y, width: 100, height: 50 },
      2,
      from,
      media,
      pivot,
    );
    const t = layerTransform(toWorld(corner, stop), stop, pivot);
    expect(screen(t, { x: media.x, y: media.y }).x).toBeCloseTo(media.x, 6);
    expect(screen(t, { x: media.x, y: media.y }).y).toBeCloseTo(media.y, 6);
    // A target wider than the view shows its start: code reads from the left.
    const rows = { x: media.x, y: 400, width: media.width, height: 60 };
    const wide = beatView('zoom', rows, 1.25, from, media, pivot);
    const w = layerTransform(toWorld(wide, stop), stop, pivot);
    expect(screen(w, { x: rows.x, y: rows.y }).x).toBeCloseTo(media.x, 6);
    // Pan keeps the scale the camera has.
    expect(beatView('pan', target, undefined, { x: 900, y: 500, scale: 2 }, media, pivot)).toEqual({
      x: 900,
      y: 500,
      scale: 2,
    });
  });

  it('chains beats: each eases from where the one before has the camera', () => {
    const rest = restView(pivot);
    const a = { x: 900, y: 500, scale: 2 };
    const b = { x: 700, y: 520, scale: 1.25 };
    const steps: CameraStep[] = [
      { t: 1, seconds: 1, to: a },
      { t: 1.5, seconds: 1, to: b },
    ];
    expect(viewAt(steps, 0.5, rest)).toEqual(rest);
    const halfway = viewAt(steps, 1.5, rest);
    expect(halfway.scale).toBeCloseTo(1 + easeInOutCubic(0.5) * 1, 9);
    // The second beat starts from the first one's view at 1.5 s, not from its target, and eases
    // away from it while the first finishes underneath: by 2 s the first has arrived.
    const later = viewAt(steps, 2, rest);
    expect(later.scale).toBeCloseTo(a.scale + (b.scale - a.scale) * easeInOutCubic(0.5), 9);
    expect(viewAt(steps, 2.6, rest)).toEqual(b);
  });

  it('hands over between overlapping beats without a jump or a dead stop', () => {
    const rest = restView(pivot);
    // The first beat is at full speed when the second starts; at 1× a view's pixel is a frame's.
    const steps: CameraStep[] = [
      { t: 1, seconds: 1, to: { x: pivot.x + 40, y: pivot.y, scale: 1 } },
      { t: 1.5, seconds: 1, to: { x: pivot.x + 40, y: pivot.y + 40, scale: 1 } },
    ];
    const frames = Array.from({ length: 2.4 * 30 }, (_, i) => viewAt(steps, 0.6 + i / 30, rest));
    // How far each frame lands from where the camera would be had it kept its speed.
    const jumps = frames
      .slice(2)
      .map((v, i) =>
        Math.hypot(
          v.x - 2 * frames[i + 1]!.x + frames[i]!.x,
          v.y - 2 * frames[i + 1]!.y + frames[i]!.y,
        ),
      );
    expect(Math.max(...jumps)).toBeLessThan(1);
    // At the hand-over the camera keeps the first beat's speed (its top speed, three times the
    // average at the middle of its ease), rather than starting again from rest.
    const at = (t: number) => viewAt(steps, t, rest).x;
    const before = (at(1.5) - at(1.5 - 1e-4)) / 1e-4;
    const after = (at(1.5 + 1e-4) - at(1.5)) / 1e-4;
    expect(before).toBeCloseTo(40 * 3, 1);
    expect(after).toBeCloseTo(before, 1);
  });

  it('keeps up with a moving target once a follow beat has eased in, until the next has too', () => {
    const rest = restView(pivot);
    // A target drifting down 100 px a second, framed at 2×.
    const moving = (t: number) => ({ x: 900, y: 500 + 100 * t, scale: 2 });
    const later = { x: 700, y: 520, scale: 1.25 };
    const steps: CameraStep[] = [
      { t: 1, seconds: 1, to: moving },
      { t: 4, seconds: 1, to: later },
    ];
    expect(viewAt(steps, 0.5, rest)).toEqual(rest);
    // Halfway through its ease, the camera is halfway to where the target is by then.
    const easing = viewAt(steps, 1.5, rest);
    expect(easing.y).toBeCloseTo(rest.y + easeInOutCubic(0.5) * (moving(1.5).y - rest.y), 9);
    // Eased in, it sits on the target at every moment.
    for (const t of [2, 2.7, 3.9]) expect(viewAt(steps, t, rest)).toEqual(moving(t));
    // The next beat starts from where the target has got to, which the follow keeps up with
    // while the next beat eases in, so the camera hands over at the target's speed.
    const next = viewAt(steps, 4.5, rest);
    expect(next.y).toBeCloseTo(moving(4.5).y + easeInOutCubic(0.5) * (later.y - moving(4.5).y), 9);
    const speed = (viewAt(steps, 4 + 1e-4, rest).y - viewAt(steps, 4 - 1e-4, rest).y) / 2e-4;
    expect(speed).toBeCloseTo(100, 1);
  });

  it('follows a moving target at one scale: the zoom given, else what fits every box it takes', () => {
    const bounds = { x: 800, y: 400, width: 200, height: 300 };
    const fit = beatView('zoom', bounds, undefined, restView(pivot), media, pivot).scale;
    const fitted = follower(bounds, undefined, media, pivot);
    for (const height of [20, 150, 300]) expect(fitted({ ...bounds, height }).scale).toBe(fit);
    const zoomed = follower(bounds, 1.6, media, pivot);
    expect(zoomed({ ...bounds, height: 20 }).scale).toBe(1.6);
    // Clear of its clamps, it frames as a beat does: a target that fits centered, one wider than
    // the view from its start.
    const small = { x: 940, y: 527, width: 40, height: 20 };
    const wide = { x: 420, y: 527, width: 1800, height: 20 };
    for (const target of [small, wide])
      expect(zoomed(target)).toEqual(
        beatView('follow', target, 1.6, restView(pivot), media, pivot),
      );
  });

  it('keeps a followed card whole across the frame, its top row in the region, at a modest zoom', () => {
    for (const orientation of ['landscape', 'vertical'] as const) {
      const [width, height] = orientation === 'landscape' ? [1920, 1080] : [1080, 1920];
      const r = computeRegions({ width, height, orientation }).media;
      const p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      // A code card as wide as the region, its changed lines travelling down it and growing.
      const card = { x: r.x, y: r.y + 20, width: r.width, height: r.height - 40 };
      const first = { x: r.x + 60, y: r.y + 0.4 * r.height, width: 0.6 * r.width, height: 40 };
      const last = {
        x: r.x + 60,
        y: r.y + 0.5 * r.height,
        width: 0.7 * r.width,
        height: 0.3 * r.height,
      };
      const bounds = {
        x: first.x,
        y: first.y,
        width: last.width,
        height: last.y + last.height - first.y,
      };
      const frame = follower(bounds, 1.25, r, p, { rect: card, width, push: 0.02 });
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        const lines = lerpRect(first, last, k);
        const view = frame(lines);
        // Held back to where the card fits the frame under the push-in, which may magnify it 2%.
        expect(view.scale).toBeCloseTo(width / card.width / 1.02, 9);
        for (const push of [0, 0.02]) {
          const pushed = withPush(view, push);
          const drawn = drawnRect(card, pushed, { x: 0, y: 0 }, p);
          expect(drawn.x, orientation).toBeGreaterThanOrEqual(-1e-6);
          expect(drawn.x + drawn.width, orientation).toBeLessThanOrEqual(width + 1e-6);
          expect(drawn.y, orientation).toBeGreaterThanOrEqual(r.y - 1e-6);
          const shown = drawnRect(lines, pushed, { x: 0, y: 0 }, p);
          expect(shown.y + shown.height, orientation).toBeLessThanOrEqual(r.y + r.height + 1e-6);
        }
      }
      // It still follows the lines as they move down the card.
      expect(frame(last).y).toBeGreaterThan(frame(first).y + 1);
    }
  });

  it('follows at the zoom given when its card fits, and leaves a close-up of the lines alone', () => {
    const p = pivot;
    const lines = { x: 900, y: 560, width: 120, height: 40 };
    const keep = (rect: typeof lines) => ({ rect, width: 1920, push: 0.02 });
    // A card narrow enough to fit at 1.25×, its top row well clear of the lines.
    const narrow = { x: 800, y: media.y + 200, width: 400, height: 300 };
    const fits = follower(lines, 1.25, media, p, keep(narrow));
    expect(fits(lines).scale).toBe(1.25);
    // A zoom far past what keeps a wide card whole is a close-up: framed as without a card.
    const wide = { ...media };
    expect(follower(lines, 2.5, media, p, keep(wide))(lines)).toEqual(
      follower(lines, 2.5, media, p)(lines),
    );
  });

  it('eases from the card held whole to a close-up of the lines as the zoom asked grows', () => {
    const card = { x: media.x, y: media.y + 20, width: media.width, height: media.height - 40 };
    const lines = { x: media.x + 60, y: media.y + 0.45 * media.height, width: 1000, height: 40 };
    const keep = { rect: card, width: 1920, push: 0.02 };
    const whole = 1920 / media.width / 1.02;
    const zooms = Array.from({ length: 151 }, (_, i) => 1 + i / 100);
    const views = zooms.map((zoom) => follower(lines, zoom, media, pivot, keep)(lines));
    // At the zoom asked while the card fits, held whole up to a quarter more than it allows, and
    // a close-up from 1.6 times that on.
    for (const [i, zoom] of zooms.entries()) {
      if (zoom <= 1.25 * whole) expect(views[i]!.scale).toBeCloseTo(Math.min(zoom, whole), 9);
      if (zoom >= 1.6 * whole) expect(views[i]).toEqual(follower(lines, zoom, media, pivot)(lines));
    }
    // In between it eases from one framing to the other, about 300 px apart here: a step of 0.01
    // in the zoom asked moves the view at most 21 px and 0.04, where flipping from one framing to
    // the other between 1.36 and 1.37 moved it 214 px and 0.28 at once.
    for (const [i, v] of views.entries()) {
      if (i === 0) continue;
      const was = views[i - 1]!;
      expect(Math.abs(v.scale - was.scale), `zoom ${zooms[i]}`).toBeLessThan(0.05);
      expect(Math.hypot(v.x - was.x, v.y - was.y), `zoom ${zooms[i]}`).toBeLessThan(25);
    }
  });

  it('eases into its clamps: the camera slows down rather than stopping dead, inside the region', () => {
    const frame = follower(media, 2, media, pivot);
    /** How much the speed changes from one step to the next, at most. */
    const jerk = (v: number[]) =>
      Math.max(...v.slice(2).map((x, i) => Math.abs(x - 2 * v[i + 1]! + v[i]!)));
    // A target growing down from a fixed top, a pixel a step, until it is twice the view's height:
    // centered while it fits, then showing its start (from a top where both stay clear of the
    // region's edges).
    const top = pivot.y - 85;
    const grown = Array.from(
      { length: 700 },
      (_, i) => frame({ x: pivot.x, y: top, width: 10, height: 10 + i }).y,
    );
    expect(grown[0]).toBe(top + 5);
    expect(grown.at(-1)).toBe(top + media.height / 4);
    expect(jerk(grown)).toBeLessThan(0.01);
    // A target sliding right, a pixel a step, past where the view meets the region's edge.
    const edge = media.x + media.width - (media.x + media.width - pivot.x) / 2;
    const slid = Array.from(
      { length: 1000 },
      (_, i) => frame({ x: pivot.x + i, y: pivot.y, width: 10, height: 10 }).x,
    );
    expect(Math.max(...slid)).toBeLessThanOrEqual(edge);
    expect(slid.at(-1)).toBe(edge);
    expect(jerk(slid)).toBeLessThan(0.01);
  });

  it('pans and zooms between stops, continuous at both ends', () => {
    const a = toWorld(restView(pivot), { x: 0, y: 0 });
    const b = toWorld(restView(pivot), { x: 2400, y: 0 });
    for (const kind of ['pan', 'zoom'] as const) {
      expect(between(kind, a, b, 0, 0.4)).toEqual(a);
      expect(between(kind, a, b, 1, 0.4)).toEqual(b);
      expect(between(kind, a, b, 0.5, 0.4).x).toBeCloseTo((a.x + b.x) / 2, 9);
    }
    expect(between('pan', a, b, 0.5, 0.4).scale).toBe(1);
    expect(between('zoom', a, b, 0.5, 0.4).scale).toBeCloseTo(0.4, 9);
    // A zoom pulls back as it travels: the dip's depth follows the travel's ease, in proportion to
    // it at first, so the camera never pulls back before it moves, and both peak at the middle.
    for (const k of [0.25, 0.5, 0.75]) {
      const view = between('zoom', a, b, k, 0.4);
      const travel = (view.x - a.x) / (b.x - a.x);
      expect(travel).toBeCloseTo(easeInOutCubic(k), 9);
      expect((1 - view.scale) / (1 - 0.4)).toBeCloseTo(4 * travel * (1 - travel), 9);
    }
    // A quarter of the way through the move (6% of the travel), it has pulled back under a
    // quarter of the way, where the clock pulled it back half of the way.
    expect(1 - between('zoom', a, b, 0.25, 0.4).scale).toBeLessThan(0.25 * (1 - 0.4));
    // Pulled back far enough for both stops' regions to fit at once.
    const back = pullBack({ x: 0, y: 0 }, { x: 2400, y: 0 }, media);
    expect(back).toBeCloseTo(media.width / (2400 + media.width), 9);
    expect(pullBack({ x: 0, y: 0 }, { x: 0, y: 0 }, media)).toBe(1);
  });

  it('zooms between stops at a pace a frame can follow, wherever the next stop sits', () => {
    // The landscape media region, a 0.9 s zoom at 30 fps, and the stops the path lays out: the
    // next in a row (a quarter of a frame apart), the first of the next row, and a hero dropped
    // half a frame below that.
    const [W, H] = [1920, 1080];
    const gap = 0.25 * W;
    const frames = 0.9 * 30;
    for (const [to, most] of [
      [{ x: W + gap, y: 0 }, 0.1],
      [{ x: 0, y: H + gap }, 0.11],
      [{ x: 0, y: 1.5 * H + gap }, 0.115],
    ] as const) {
      const back = pullBack({ x: 0, y: 0 }, to, media) * 0.92;
      const [a, b] = [restView(pivot), toWorld(restView(pivot), to)];
      const scales = Array.from(
        { length: frames + 1 },
        (_, i) => between('zoom', a, b, i / frames, back).scale,
      );
      const steps = scales.slice(1).map((s, i) => Math.abs(s - scales[i]!));
      const turns = scales.slice(2).map((s, i) => Math.abs(s - 2 * scales[i + 1]! + scales[i]!));
      // Measured: 0.088, 0.104, and 0.111 a frame at the fastest (the clock's dip: 0.071, 0.085,
      // 0.090), turning round at the trough by 0.06 at most.
      expect(Math.max(...steps), `${to.x},${to.y}`).toBeLessThan(most);
      expect(Math.max(...turns), `${to.x},${to.y}`).toBeLessThan(0.065);
    }
  });

  it('knows which entrances move the camera', () => {
    expect(isCameraMove('pan')).toBe(true);
    expect(isCameraMove('zoom')).toBe(true);
    for (const kind of ['fade', 'cut', 'push', 'wipe', 'zoom-through'] as const)
      expect(isCameraMove(kind)).toBe(false);
  });
});

describe('the canvas viewport', () => {
  it('clips to a region, and keeps only the part of a box inside it', () => {
    expect(insetOf({ x: 10, y: 20, width: 100, height: 50 }, 200, 100)).toBe(
      'inset(20.00px 90.00px 30.00px 10.00px)',
    );
    const clip = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipRect({ x: 50, y: 80, width: 100, height: 40 }, clip)).toEqual({
      x: 50,
      y: 80,
      width: 50,
      height: 20,
    });
    expect(clipRect({ x: 150, y: 0, width: 10, height: 10 }, clip)).toBeUndefined();
    expect(lerpRect(clip, { x: 100, y: 0, width: 300, height: 100 }, 0.5)).toEqual({
      x: 50,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it('feathers a clip past its top and bottom edges, never past the frame', () => {
    const clip = { x: 0, y: 100, width: 200, height: 50 };
    expect(featherOf(clip, 10, 200, 300)).toEqual({
      clip: 'inset(90.00px 0.00px 140.00px 0.00px)',
      mask: 'linear-gradient(to bottom, transparent 90.00px, #000 100.00px, #000 150.00px, transparent 160.00px)',
    });
    // At the frame's edges there is no room to fade into.
    expect(featherOf({ ...clip, y: 4, height: 290 }, 10, 200, 300)).toEqual({
      clip: 'inset(0.00px 0.00px 0.00px 0.00px)',
      mask: 'linear-gradient(to bottom, transparent 0.00px, #000 4.00px, #000 294.00px, transparent 300.00px)',
    });
  });

  it('feathers no further than the room the layout leaves around a band, in every orientation', () => {
    for (const [width, height, orientation, units] of [
      [1920, 1080, 'landscape', 16],
      [1080, 1920, 'vertical', 36],
      [1080, 1080, 'square', 18],
    ] as const) {
      const r = computeRegions({ width, height, orientation });
      const below = (b: { y: number; height: number }) => b.y + b.height;
      // The media region under the header and the full frame of a card without one under the
      // progress bar, each above the captions.
      const gaps = [
        r.media.y - below(r.header),
        r.captions.y - below(r.media),
        r.full.y - below(r.progress),
        r.captions.y - below(r.full),
      ];
      expect(clearance(r), orientation).toBeCloseTo(Math.min(...gaps), 9);
      expect(clearance(r) / r.unit, orientation).toBeCloseTo(units, 9);
    }
  });

  it('moves the dots with the camera, and lines them up with the stage’s at a stop', () => {
    const at = toWorld(restView(pivot), { x: 2400, y: 1560 });
    expect(gridStyle(at, pivot, 30)).toEqual({
      position: '0.00px 0.00px',
      size: '30.000px 30.000px',
    });
    expect(gridStyle({ ...at, x: at.x + 10 }, pivot, 30).position).toBe('20.00px 0.00px');
    expect(gridStyle({ ...at, scale: 2 }, pivot, 30).size).toBe('60.000px 60.000px');
  });
});

describe('undoing the camera', () => {
  it('puts a box drawn through a view back where its stop lays it out', () => {
    const view = { x: pivot.x + 120, y: pivot.y - 40, scale: 1.6 };
    const laid = { x: 300, y: 260, width: 200, height: 90 };
    // What layerTransform draws: stop point p at pivot + scale · (p − view).
    const drawn = {
      x: pivot.x + view.scale * (laid.x - view.x),
      y: pivot.y + view.scale * (laid.y - view.y),
      width: laid.width * view.scale,
      height: laid.height * view.scale,
    };
    const back = unview(drawn, view, pivot);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(back[k]).toBeCloseTo(laid[k], 9);
    expect(unview(laid, restView(pivot), pivot)).toEqual(laid);
    // The inverse of drawnRect, wherever the stop sits.
    const through = drawnRect(laid, toWorld(view, stop), stop, pivot);
    for (const k of ['x', 'y', 'width', 'height'] as const)
      expect(unview(through, view, pivot)[k]).toBeCloseTo(laid[k], 9);
  });
});

describe('camera edge cases', () => {
  it('cuts on a beat of no length: the view before it, then its target, never NaN', () => {
    const rest = restView(pivot);
    const to = { x: 900, y: 500, scale: 2 };
    const steps: CameraStep[] = [{ t: 1, seconds: 0, to }];
    expect(viewAt(steps, 0.99, rest)).toEqual(rest);
    expect(viewAt(steps, 1, rest)).toEqual(rest);
    expect(viewAt(steps, 1 + 1 / 30, rest)).toEqual(to);
    expect(viewAt(steps, 5, rest)).toEqual(to);
  });

  it('lands a beat of the shortest length the resolver writes within its frames, never past', () => {
    // The resolver keeps every beat at least 0.1 s long: three frames at 30 fps.
    const rest = restView(pivot);
    const to = { x: 900, y: 500, scale: 2 };
    const steps: CameraStep[] = [{ t: 1, seconds: 0.1, to }];
    const frames = [0, 1, 2, 3, 4].map((i) => viewAt(steps, 1 + i / 30, rest));
    expect(frames[0]).toEqual(rest);
    for (const [i, v] of frames.entries()) {
      for (const key of ['x', 'y', 'scale'] as const) {
        expect(Number.isFinite(v[key])).toBe(true);
        // Every frame lies between where the camera was and where the beat takes it.
        const [lo, hi] = [Math.min(rest[key], to[key]), Math.max(rest[key], to[key])];
        expect(v[key]).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v[key]).toBeLessThanOrEqual(hi + 1e-9);
      }
      if (i > 0 && i < 4) expect(v.scale).toBeGreaterThan(frames[i - 1]!.scale);
    }
    expect(viewAt(steps, 1 + 3 / 30 + 1e-9, rest)).toEqual(to);
  });

  it('leaves a view that pulls back alone: between stops it shows past the region', () => {
    const back = { x: pivot.x + 900, y: pivot.y - 300, scale: 0.4 };
    expect(clampView(back, media, pivot)).toEqual(back);
    expect(clampView({ ...back, scale: 0.999 }, media, pivot)).toEqual({ ...back, scale: 0.999 });
    // At 1× and above it is held inside the region.
    expect(clampView({ ...back, scale: 1 }, media, pivot)).toEqual(restView(pivot));
    // A beat never frames below 1×, so a stop's own camera never pulls back past its region.
    const target = { x: media.x, y: media.y, width: 100, height: 50 };
    expect(beatView('zoom', target, 0.5, restView(pivot), media, pivot)).toEqual(restView(pivot));
    expect(follower(target, 0.5, media, pivot)(target).scale).toBe(1);
  });
});
