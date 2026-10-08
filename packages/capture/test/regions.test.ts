import { describe, expect, it } from 'vitest';
import { changedRegions, MAX_REGIONS, mergeRegions } from '../src/regions.ts';

const RED = [255, 0, 0, 255];

/** A pixelmatch-style diff image: white, with changed pixels painted pure red. */
function diffImage(width: number, height: number, blocks: Array<[number, number, number, number]>) {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const [x0, y0, w, h] of blocks)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) data.set(RED, (y * width + x) * 4);
  return { data, width, height };
}

describe('changedRegions', () => {
  it('finds separate areas of change with exact pixel bounds', () => {
    expect(
      changedRegions(
        diffImage(200, 120, [
          [10, 10, 20, 20],
          [150, 80, 30, 25],
        ]),
      ),
    ).toEqual([
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 150, y: 80, width: 30, height: 25 },
    ]);
  });

  it('joins changes that sit close together into one region', () => {
    expect(
      changedRegions(
        diffImage(200, 120, [
          [10, 10, 20, 20],
          [34, 12, 10, 10],
        ]),
      ),
    ).toEqual([{ x: 10, y: 10, width: 34, height: 20 }]);
  });

  it('finds nothing in an unchanged image', () => {
    expect(changedRegions(diffImage(64, 64, []))).toEqual([]);
  });
});

describe('mergeRegions', () => {
  it('scales CSS pixels to image pixels, clamps at the edges, and drops empty boxes', () => {
    expect(
      mergeRegions(
        [
          { x: -5, y: 10, width: 20, height: 5 },
          { x: 0, y: 0, width: 0, height: 9 },
        ],
        { scale: 2 },
      ),
    ).toEqual([{ x: 0, y: 20, width: 30, height: 10 }]);
  });

  it('merges overlapping or nearly touching boxes', () => {
    expect(
      mergeRegions(
        [
          { x: 0, y: 0, width: 10, height: 10 },
          { x: 14, y: 0, width: 10, height: 10 },
          { x: 100, y: 100, width: 5, height: 5 },
        ],
        { gap: 8 },
      ),
    ).toEqual([
      { x: 0, y: 0, width: 24, height: 10 },
      { x: 100, y: 100, width: 5, height: 5 },
    ]);
  });

  it('keeps at most max boxes, still covering every input', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => ({
      x: i * 100,
      y: 0,
      width: 10,
      height: 10,
    }));
    const merged = mergeRegions(boxes, { gap: 0 });
    expect(merged).toHaveLength(MAX_REGIONS);
    for (const b of boxes)
      expect(merged.some((m) => m.x <= b.x && m.x + m.width >= b.x + b.width)).toBe(true);
  });

  it('gives the same result for the same boxes in any order', () => {
    const boxes = [
      { x: 50, y: 50, width: 5, height: 5 },
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 300, y: 0, width: 5, height: 5 },
    ];
    expect(mergeRegions(boxes, { max: 2 })).toEqual(mergeRegions([...boxes].reverse(), { max: 2 }));
  });
});
