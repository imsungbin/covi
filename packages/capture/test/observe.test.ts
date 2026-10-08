import { describe, expect, it } from 'vitest';
import { parseMutations } from '../src/observe.ts';

const FRAME = { width: 390, height: 844 };

describe('parseMutations', () => {
  it('keeps honest changes, clipped to the frame', () => {
    const raw = {
      count: 3,
      rects: [
        { x: 10, y: 20, width: 100, height: 40 },
        { x: 300, y: 800, width: 200, height: 100 },
      ],
    };
    expect(parseMutations(raw, FRAME)).toEqual({
      count: 3,
      rects: [
        { x: 10, y: 20, width: 100, height: 40 },
        { x: 300, y: 800, width: 90, height: 44 },
      ],
    });
  });

  it('turns what a hostile page put in its place into a bounded, sane summary', () => {
    const rects = [
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: '10', height: 10 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 },
      null,
      7,
      { x: -50, y: -50, width: 20, height: 20 },
      ...Array.from({ length: 10_000 }, (_, i) => ({
        x: i % 400,
        y: i % 900,
        width: 1e308,
        height: 1e308,
      })),
    ];
    const parsed = parseMutations({ count: 'x', rects }, FRAME);
    expect(parsed.count).toBe(0);
    expect(parsed.rects.length).toBeGreaterThan(0);
    expect(parsed.rects.length).toBeLessThanOrEqual(200);
    for (const r of parsed.rects) {
      expect([r.x, r.y, r.width, r.height].every(Number.isFinite)).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
      expect(r.x + r.width).toBeLessThanOrEqual(FRAME.width);
      expect(r.y + r.height).toBeLessThanOrEqual(FRAME.height);
    }
  });

  it('counts whole, non-negative changes', () => {
    const count = (value: unknown) => parseMutations({ count: value, rects: [] }, FRAME).count;
    expect(count(4)).toBe(4);
    expect(count(2.7)).toBe(2);
    expect(count(-5)).toBe(0);
    expect(count(Number.NaN)).toBe(0);
    expect(count(Number.POSITIVE_INFINITY)).toBe(0);
    expect(count('12')).toBe(0);
  });

  it('reads anything but a count and a list of boxes as no changes', () => {
    for (const raw of [undefined, null, 42, 'changes', [], { count: 2, rects: 'all' }])
      expect(parseMutations(raw, FRAME).rects).toEqual([]);
    expect(parseMutations(null, FRAME)).toEqual({ count: 0, rects: [] });
  });
});
