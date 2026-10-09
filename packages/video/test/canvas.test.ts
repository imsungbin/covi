import { describe, expect, it } from 'vitest';
import { easeInOutCubic } from '../src/runtime/anim.ts';
import {
  beatView,
  between,
  type CameraStep,
  clampView,
  clipRect,
  drawnRect,
  gridStyle,
  insetOf,
  isCameraMove,
  layerTransform,
  lerpRect,
  pullBack,
  restView,
  toWorld,
  viewAt,
  withPush,
} from '../src/runtime/canvas.ts';
import { computeRegions, gridSpacing } from '../src/runtime/layout.ts';
import type { Point } from '../src/timeline/types.ts';

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

  it('chains beats: each eases from where the one before left the camera', () => {
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
    // The second beat starts from the first one's view at 1.5 s, not from its target.
    const later = viewAt(steps, 2, rest);
    expect(later.scale).toBeCloseTo(halfway.scale + (b.scale - halfway.scale) * 0.5, 9);
    expect(viewAt(steps, 2.6, rest)).toEqual(b);
  });

  it('keeps up with a moving target once a follow beat has eased in, until the next beat', () => {
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
    // The next beat starts from where the target had got to.
    const next = viewAt(steps, 4.5, rest);
    expect(next.y).toBeCloseTo(moving(4).y + easeInOutCubic(0.5) * (later.y - moving(4).y), 9);
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
    // Pulled back far enough for both stops' regions to fit at once.
    const back = pullBack({ x: 0, y: 0 }, { x: 2400, y: 0 }, media);
    expect(back).toBeCloseTo(media.width / (2400 + media.width), 9);
    expect(pullBack({ x: 0, y: 0 }, { x: 0, y: 0 }, media)).toBe(1);
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
