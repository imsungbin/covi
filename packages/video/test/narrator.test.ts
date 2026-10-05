import { type FoxOptions, foxBounds, foxPose, tailParts, tailShape } from '@covi/brand';
import { describe, expect, it } from 'vitest';
import { layoutChecks } from '../src/qc.ts';
import { computeRegions } from '../src/runtime/layout.ts';
import {
  clearAim,
  fitTail,
  narratorParts,
  overlaps,
  reachesInto,
  toFox,
  toStage,
  union,
} from '../src/runtime/narrator.ts';
import type { LayoutReport, Rect, Timeline } from '../src/timeline/types.ts';

const SIZES = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
} as const;

const timelineOf = (orientation: keyof typeof SIZES) =>
  ({ ...SIZES[orientation], orientation, captions: [], scenes: [] }) as unknown as Timeline;

const below = (a: Rect, b: Rect) => a.y + a.height <= b.y;

describe('the narrator slot', () => {
  it('fills the column beside the header, between the progress bar and the media region', () => {
    const expected = { vertical: 190, square: 150, landscape: 142 };
    for (const orientation of ['vertical', 'square', 'landscape'] as const) {
      const r = computeRegions({ ...SIZES[orientation], orientation });
      const n = {
        x: r.narrator.x,
        y: r.narrator.y,
        width: r.narrator.size,
        height: r.narrator.size,
      };
      expect(r.narrator.size / r.unit, orientation).toBeCloseTo(expected[orientation], 6);
      // In the column beside the header (the whole column on vertical and square video),
      // nudged 4 view-box units into the side margin so the resting tail, padding included,
      // stays out of the header's column.
      const unit = r.narrator.size / 128;
      const column = r.media.x + r.media.width - (r.header.x + r.header.width);
      expect(n.width >= column - 0.01 || orientation === 'landscape', orientation).toBe(true);
      expect(n.x + n.width, orientation).toBeCloseTo(r.media.x + r.media.width + 4 * unit, 6);
      const resting = foxBounds().x;
      expect(n.x + resting * unit, orientation).toBeGreaterThan(r.header.x + r.header.width);
      // At least 8 units clear of the progress bar and the media region.
      expect(below(r.progress, { ...n, y: n.y - 8 * r.unit }), orientation).toBe(true);
      expect(below({ ...n, height: n.height + 8 * r.unit }, r.media), orientation).toBe(true);
      expect(overlaps(n, r.captions), orientation).toBe(false);
    }
  });

  it('maps between view-box units and stage pixels', () => {
    const placement = { x: 818, y: 96, size: 190 };
    const box = { x: 10, y: 20, width: 30, height: 40 };
    const there = toFox(toStage(box, placement), placement);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(there[key]).toBeCloseTo(box[key], 9);
    // The spring-in scale is about the box's center, and the bob moves it down.
    const scaled = toStage(
      { x: 64, y: 64, width: 0, height: 0 },
      { ...placement, scale: 0.9, bob: 2 },
    );
    expect(scaled.x).toBeCloseTo(818 + 95, 9);
    expect(scaled.y).toBeCloseTo(96 + 95 + 2, 9);
  });
});

describe('where the tail points', () => {
  it('points where it was asked when nothing is in the way', () => {
    expect(clearAim(125, [])).toEqual({ aim: 125, reach: 1 });
    expect(clearAim(10, []).aim).toBe(100); // out of reach: the nearest reachable direction
  });

  it('takes the nearest direction that keeps it off text, on its way out too', () => {
    // A word of text anywhere around where the tail reaches out, kept at the stage's margin.
    const margin = 4;
    let detoured = 0;
    for (let x = -46; x <= 14; x += 6)
      for (let y = 54; y <= 144; y += 6) {
        const text = { x, y, width: 8, height: 8 };
        const room = {
          x: x - margin,
          y: y - margin,
          width: 8 + 2 * margin,
          height: 8 + 2 * margin,
        };
        const { aim, reach } = clearAim(150, [room]);
        if (reach === 0) continue;
        const label = `text at ${x},${y}`;
        expect(reachesInto(aim, [room]), label).toBe(false);
        for (let k = 0.5; k <= 1.0001; k += 0.025)
          expect(
            tailParts(tailShape({ reach: k, aim })).some((part) => overlaps(part, text)),
            `${label}, reach ${k.toFixed(3)}`,
          ).toBe(false);
        expect(Math.abs(aim - 150), label).toBeLessThanOrEqual(45);
        if (aim === 150) continue;
        detoured++;
        // It turns just far enough: a degree closer to the target would touch the text.
        expect(reachesInto(aim + Math.sign(150 - aim), [room]), label).toBe(true);
      }
    expect(detoured).toBeGreaterThan(0);
  });

  it('stays curled rather than point far from the target', () => {
    // A line of header text across the whole way out: clearing it would point somewhere else.
    const text = { x: -60, y: 90, width: 50, height: 12 };
    expect(clearAim(150, [text]).reach).toBe(0);
  });

  it('stays curled when every direction is blocked', () => {
    const wall = { x: -200, y: -200, width: 225, height: 600 };
    expect(clearAim(130, [wall])).toEqual({ aim: 130, reach: 0 });
    expect(
      foxPose({
        expression: 'explaining',
        t: 3,
        time: 3,
        mouth: 0,
        blink: 0,
        gaze: { x: -0.5, y: 0.8 },
        pointing: true,
        aim: 130,
        reach: 0,
      }).fox.reach,
    ).toBe(0);
  });
});

describe('the tail as drawn', () => {
  const r = computeRegions(timelineOf('vertical'));
  const placement = { ...r.narrator, bob: 1, scale: 1 };
  /** A line of heading text that runs to the edge of the header's column. */
  const heading = {
    x: r.header.x,
    y: r.narrator.y + 70 * (r.narrator.size / 128),
    width: r.header.width,
    height: 57,
  };
  const touches = (fox: FoxOptions, rects: Rect[]) =>
    foxBounds(fox).tail.some((part) => rects.some((k) => overlaps(toStage(part, placement), k)));
  const alert = foxPose({
    expression: 'warning',
    t: 0.6,
    time: 4,
    mouth: 0,
    blink: 0,
    gaze: { x: -0.5, y: 0.8 },
    pointing: false,
  }).fox;

  it('leaves the box only into empty space, whatever the tail is doing', () => {
    // The alert's puffed, lifted tail swings out past the box...
    expect(touches(alert, [heading])).toBe(true);
    // ...so beside text it eases back toward rest just far enough.
    const fitted = fitTail(alert, [heading], placement);
    expect(touches(fitted, [heading])).toBe(false);
    expect(fitted.puff).toBeGreaterThan(0);
    expect(fitted.puff).toBeLessThan(alert.puff!);
    expect(
      touches({ ...fitted, puff: fitted.puff! * 1.1, lift: fitted.lift! * 1.1 }, [heading]),
    ).toBe(true);
    // With room to spare it is left alone.
    expect(fitTail(alert, [], placement)).toBe(alert);
  });

  it('changes smoothly as the room changes', () => {
    let previous: number | undefined;
    for (let dx = 0; dx <= 40; dx += 1) {
      const text = { ...heading, width: heading.width - dx };
      const puff = fitTail(alert, [text], placement).puff!;
      if (previous !== undefined) expect(Math.abs(puff - previous)).toBeLessThan(0.15);
      previous = puff;
    }
  });
});

describe('QC: the narrator with its tail', () => {
  const timeline = timelineOf('vertical');
  const r = computeRegions(timeline);
  const placement = { ...r.narrator };
  const pose = (aim: number, reach = 1) =>
    foxPose({
      expression: 'reviewing',
      t: 3,
      time: 3,
      mouth: 0,
      blink: 0,
      gaze: { x: -0.5, y: 0.8 },
      pointing: true,
      aim,
      reach,
    }).fox;
  const report = (fox: FoxOptions, extra: Partial<LayoutReport> = {}): LayoutReport => {
    const parts = narratorParts(fox, placement);
    return {
      frame: 30,
      scene: 's2',
      items: [{ role: 'media', rect: { ...r.media, y: r.media.y + 100, height: 600 } }],
      narrator: union(parts),
      narratorParts: parts,
      imagesLoaded: true,
      ...extra,
    };
  };
  const check = (reports: LayoutReport[]) =>
    layoutChecks(timeline, reports).find((c) => c.id === 'narrator-clear-of-content')!;
  const tip = () => narratorParts(pose(150), placement).reduce((a, b) => (a.x < b.x ? a : b));

  it('measures the fox as drawn, tail included, not its box', () => {
    expect(report(pose(150)).narrator!.x).toBeLessThan(r.narrator.x - 10); // past the box
    expect(check([report(pose(150))]).status).toBe('pass');
  });

  it('warns when the tail covers header text, captions, or the media region', () => {
    const end = tip();
    const header = check([report(pose(150), { headerText: [{ ...end, width: end.width / 2 }] })]);
    expect(header.status).toBe('warn');
    expect(header.message).toContain('header text in scene(s) s2');
    expect(check([report(pose(150), { captions: end })]).message).toContain('captions');
    // A tail hanging down into the media region, even where it is empty.
    const low = check([
      report(pose(150), {
        narratorParts: [{ ...end, y: r.media.y + 4 }],
        narrator: end,
        items: [],
      }),
    ]);
    expect(low.status).toBe('warn');
    expect(low.message).toContain('the media region');
  });

  it('passes when the narrator kept its tail off the text it would have covered', () => {
    const end = tip();
    const text = { ...end, x: end.x - 40, width: 60 };
    expect(check([report(pose(150), { headerText: [text] })]).status).toBe('warn');
    const keepOut = [text].map((rect) => {
      const box = toFox(rect, placement);
      return { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 };
    });
    const { aim, reach } = clearAim(150, keepOut);
    const fox = fitTail(pose(aim, reach), [text], placement);
    expect(check([report(fox, { headerText: [text] })]).status).toBe('pass');
  });
});
