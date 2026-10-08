import { describe, expect, it } from 'vitest';
import {
  blendCamera,
  center,
  frameCamera,
  lerpRect,
  MARK_ZOOM,
  markProgress,
  marksCamera,
} from '../src/runtime/framing.ts';
import { markTiming } from '../src/timeline/cues.ts';

// A 1000×500 image resting in a 500×250 viewport: half size, filling it.
const g = {
  image: { width: 1000, height: 500 },
  base: { x: 0, y: 0, width: 500, height: 250 },
  viewport: { width: 500, height: 250 },
};
const A = { x: 0, y: 0, width: 100, height: 50 };
const B = { x: 900, y: 450, width: 100, height: 50 };

describe('the frame camera', () => {
  it('rests on the whole image, and zooms toward a focus, kept inside the image', () => {
    expect(frameCamera(g, undefined, 0)).toEqual({ z: 1, ox: 0, oy: 0 });
    expect(frameCamera(g, A, 0, MARK_ZOOM)).toEqual({ z: 1, ox: 0, oy: 0 });
    expect(frameCamera(g, A, 1, MARK_ZOOM)).toEqual({ z: 1.6, ox: 0, oy: 0 });
    expect(frameCamera(g, B, 1, MARK_ZOOM)).toEqual({ z: 1.6, ox: -300, oy: -150 });
  });

  it('blends two cameras and two regions', () => {
    expect(blendCamera({ z: 1.6, ox: 0, oy: 0 }, { z: 1.6, ox: -300, oy: -150 }, 0.5)).toEqual({
      z: 1.6,
      ox: -150,
      oy: -75,
    });
    expect(lerpRect(A, B, 0.25)).toEqual({ x: 225, y: 112.5, width: 100, height: 50 });
    expect(center(A)).toEqual({ x: 50, y: 25 });
  });
});

describe('a tour of marks', () => {
  const timing = markTiming(0, 4, [undefined, undefined]);

  it('knows which mark the camera is leaving and reaching', () => {
    expect(markProgress(timing, 0.5)).toEqual({ from: -1, to: 0, k: 0 });
    expect(markProgress(timing, 2)).toEqual({ from: -1, to: 0, k: 1 });
    const panning = markProgress(timing, 2.34);
    expect([panning.from, panning.to]).toEqual([0, 1]);
    expect(panning.k).toBeCloseTo(0.5, 9);
    expect(markProgress(timing, 3.5)).toEqual({ from: 0, to: 1, k: 1 });
  });

  it('rests, zooms to the first mark, then pans to the next with the ring', () => {
    expect(marksCamera(g, [A, B], timing, 0.5).camera).toEqual({ z: 1, ox: 0, oy: 0 });
    expect(marksCamera(g, [A, B], timing, 2).camera).toEqual({ z: 1.6, ox: 0, oy: 0 });
    const half = marksCamera(g, [A, B], timing, 2.34);
    expect(half.camera.z).toBeCloseTo(1.6, 9);
    expect(half.camera.ox).toBeCloseTo(-150, 6);
    expect(half.camera.oy).toBeCloseTo(-75, 6);
    expect(half.focus.x).toBeCloseTo(450, 6);
    expect(half.focus.y).toBeCloseTo(225, 6);
    expect(marksCamera(g, [A, B], timing, 3.5).camera).toEqual({ z: 1.6, ox: -300, oy: -150 });
  });

  it('zooms one mark as far as a focus does', () => {
    const one = markTiming(0, 4, [undefined]);
    expect(marksCamera(g, [A], one, 3).camera.z).toBeCloseTo(1.9, 9);
  });

  it('zooms a step’s marks no further than a step’s focus', () => {
    // An interaction step's focus zooms to 1.5×: one mark matches it, and a tour never exceeds it.
    const one = markTiming(0, 4, [undefined]);
    expect(marksCamera(g, [A], one, 3, 1.5).camera.z).toBeCloseTo(1.5, 9);
    expect(marksCamera(g, [A, B], timing, 3.5, 1.5).camera.z).toBeCloseTo(1.5, 9);
  });
});
