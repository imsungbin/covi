import { describe, expect, it } from 'vitest';
import { type Arrangement, type FitScore, fitMusic, MIN_MUSIC_SECONDS } from '../src/music/fit.ts';

/** 100 bpm in 4/4: a bar is 2.4 s, the logo's pickup (three quarters of a beat) 0.45 s. */
function score(overrides: Partial<FitScore['form']> & { introBars?: number } = {}): FitScore {
  const { introBars = 1, ...form } = overrides;
  return {
    bpm: 100,
    meter: 4,
    sections: {
      intro: { bars: introBars },
      a: { bars: 4 },
      b: { bars: 4 },
      lift: { bars: 2 },
      resolved: { bars: 2 },
      open: { bars: 2 },
      minor: { bars: 2 },
    },
    form: {
      intro: 'intro',
      loop: ['a', 'b'],
      hero: 'lift',
      ending: { 'looks-good': 'resolved', 'needs-attention': 'open', 'needs-changes': 'minor' },
      ...form,
    },
  };
}

const pickup = (a: Arrangement) => (0.75 * a.bar) / a.meter;

/** Invariants every arrangement keeps. */
function check(a: Arrangement, d: number, lastLine: number): void {
  expect(a.start).toBeLessThanOrEqual(0);
  expect(a.start).toBeGreaterThan(-a.bar);
  let bar = 0;
  for (const s of a.sections) {
    expect(s.startBar, s.name).toBe(bar);
    expect(s.bars, s.name).toBeGreaterThan(0);
    bar += s.bars;
  }
  expect(bar).toBe(a.totalBars);
  const ending = a.sections.at(-1)!;
  expect(ending.name).toBe(a.ending);
  expect(a.start + ending.startBar * a.bar).toBeCloseTo(a.markers.logo.landing, 9);
  expect(a.markers.logo.start).toBeCloseTo(a.markers.logo.landing - pickup(a), 9);
  expect(a.markers.logo.start).toBeGreaterThanOrEqual(lastLine + 0.1 - 1e-9);
  expect(a.markers.fade).toEqual({ start: d - 0.5, end: d });
  expect(a.barTimes).toHaveLength(a.totalBars);
  expect(a.beatTimes).toHaveLength(a.totalBars * a.meter);
  expect(a.barTimes[3]).toBeCloseTo(a.start + 3 * a.bar, 9);
}

describe('fitMusic', () => {
  it('puts the hero section on a downbeat exactly at the hero moment', () => {
    const a = fitMusic(score(), {
      duration: 30,
      hero: 10.45,
      lastLine: 28.5,
      verdict: 'looks-good',
    })!;
    check(a, 30, 28.5);
    const lift = a.sections.find((s) => s.name === 'lift')!;
    expect(a.start + lift.startBar * a.bar).toBeCloseTo(10.45, 9);
    expect(a.markers.hero).toEqual({ moment: 10.45, downbeat: expect.closeTo(10.45, 9) });
    expect(Math.abs(a.bpm / 100 - 1)).toBeLessThanOrEqual(0.06);
    expect(a.markers.logo.landing).toBeLessThanOrEqual(30 - 0.8 + 1e-9);
    expect(a.sections[0]!.name).toBe('intro');
    expect(a.fallbacks).toEqual([]);
    // Loops cycle around the hero: a b … lift … then the ending for the verdict.
    expect(a.sections.map((s) => s.name)).toEqual(
      expect.arrayContaining(['a', 'lift', 'resolved']),
    );
    expect(a.ending).toBe('resolved');
  });

  it('ends with the section for the verdict', () => {
    const fit = (verdict: 'looks-good' | 'needs-attention' | 'needs-changes') =>
      fitMusic(score(), { duration: 30, hero: 10.45, lastLine: 28.5, verdict })!.ending;
    expect([fit('looks-good'), fit('needs-attention'), fit('needs-changes')]).toEqual([
      'resolved',
      'open',
      'minor',
    ]);
    expect(
      fitMusic(score({ ending: 'resolved' }), {
        duration: 30,
        lastLine: 28.5,
        verdict: 'needs-changes',
      })!.ending,
    ).toBe('resolved');
  });

  it('keeps the logo after the last line and the landing clear of the end', () => {
    for (let d = 12; d <= 120; d += 3.7) {
      for (const heroAt of [undefined, 0.25, 0.5, 0.75]) {
        const lastLine = d - 1.5;
        const hero = heroAt === undefined ? undefined : 0.45 + heroAt * (lastLine - 4);
        const a = fitMusic(score(), { duration: d, hero, lastLine, verdict: 'looks-good' })!;
        check(a, d, lastLine);
        expect(a.markers.logo.landing, `D ${d}`).toBeLessThanOrEqual(d - 0.8 + 1e-9);
      }
    }
  });

  it('prefers the landing near one second before the end', () => {
    const a = fitMusic(score(), { duration: 40, lastLine: 30, verdict: 'looks-good' })!;
    expect(a.markers.logo.landing).toBeCloseTo(39, 9);
    expect(a.bpm).toBe(100);
  });

  it('allows ±10% when ±6% cannot reach the hero, and says so', () => {
    const a = fitMusic(score(), {
      duration: 20,
      hero: 11.2,
      lastLine: 18.5,
      verdict: 'looks-good',
    })!;
    check(a, 20, 18.5);
    const deviation = Math.abs(a.bpm / 100 - 1);
    expect(deviation).toBeGreaterThan(0.06);
    expect(deviation).toBeLessThanOrEqual(0.1);
    expect(a.markers.hero!.downbeat).toBeCloseTo(11.2, 9);
    expect(a.fallbacks.join(' ')).toMatch(/tempo/);
  });

  it('puts the hero on the nearest bar when no tempo within ±10% reaches it', () => {
    const a = fitMusic(score(), {
      duration: 20,
      hero: 15.7,
      lastLine: 18.5,
      verdict: 'looks-good',
    })!;
    check(a, 20, 18.5);
    expect(a.bpm).toBe(100);
    expect(Math.abs(a.markers.hero!.downbeat - 15.7)).toBeLessThanOrEqual(a.bar / 2);
    expect(a.markers.hero!.downbeat).not.toBeCloseTo(15.7, 3);
    expect(a.fallbacks.join(' ')).toMatch(/hero/);
  });

  it('keeps the score tempo exactly without a hero', () => {
    for (const target of [
      { duration: 30, lastLine: 28.5, verdict: 'looks-good' as const },
      { duration: 30, hero: 10, lastLine: 28.5, verdict: 'looks-good' as const },
    ]) {
      const a = fitMusic(score({ hero: undefined }), target)!;
      check(a, 30, 28.5);
      expect(a.bpm).toBe(100);
      expect(a.markers.hero).toBeUndefined();
      expect(a.sections.map((s) => s.name)).not.toContain('lift');
    }
  });

  it('drops the intro when the hero comes too early for it', () => {
    const a = fitMusic(score({ introBars: 2 }), {
      duration: 30,
      hero: 0.45,
      lastLine: 28.5,
      verdict: 'looks-good',
    })!;
    check(a, 30, 28.5);
    // One bar before the hero downbeat: too short for a two-bar intro, so a loop fills it.
    expect(a.sections.slice(0, 2).map((s) => [s.name, s.bars])).toEqual([
      ['a', 1],
      ['lift', 2],
    ]);
    expect(a.sections.map((s) => s.name)).not.toContain('intro');
    const kept = fitMusic(score({ introBars: 1 }), {
      duration: 30,
      hero: 0.45,
      lastLine: 28.5,
      verdict: 'looks-good',
    })!;
    expect(kept.sections[0]).toEqual({ name: 'intro', startBar: 0, bars: 1 });
  });

  it('lands the logo exactly where the outro settles, with the hero still on its downbeat', () => {
    // The last line ends at 36.5 s; the outro starts 0.35 s later and settles 1 s after that.
    const outro = { start: 36.85, settle: 37.85, end: 39.65 };
    const a = fitMusic(score(), {
      duration: outro.end,
      hero: 12.45,
      lastLine: 36.5,
      landing: outro.settle,
      verdict: 'looks-good',
    })!;
    expect(a.markers.logo.landing).toBe(outro.settle);
    expect(a.markers.hero!.downbeat).toBeCloseTo(12.45, 9);
    expect(Math.abs(a.bpm / 100 - 1)).toBeLessThanOrEqual(0.06);
    expect(a.markers.logo.start).toBeGreaterThanOrEqual(36.5 + 0.1);
    expect(a.fallbacks).toEqual([]);
    // The ending rings over the outro, then fades: 45% of its ring, from 0.5 s to 1 s.
    expect(a.markers.fade.start).toBeCloseTo(outro.end - 0.45 * (outro.end - outro.settle), 9);
    expect(a.markers.fade.end).toBe(outro.end);
    const ending = a.sections.at(-1)!;
    expect(a.start + ending.startBar * a.bar).toBeCloseTo(outro.settle, 9);
  });

  it('keeps the score tempo exactly with a landing and no hero', () => {
    const a = fitMusic(score({ hero: undefined }), {
      duration: 30,
      lastLine: 27,
      landing: 28.2,
      verdict: 'needs-changes',
    })!;
    expect(a.bpm).toBe(100);
    expect(a.markers.logo.landing).toBe(28.2);
    expect(a.ending).toBe('minor');
  });

  it('gives up a landing the last line leaves no room for, and says so', () => {
    const a = fitMusic(score(), {
      duration: 30,
      hero: 10.45,
      lastLine: 28,
      landing: 28.2,
      verdict: 'looks-good',
    })!;
    expect(a.markers.logo.start).toBeGreaterThanOrEqual(28.1 - 1e-9);
    expect(a.fallbacks[0]).toMatch(/cannot land on the outro at 28\.20 s/);
  });

  it('renders no music for videos under 8 seconds', () => {
    expect(MIN_MUSIC_SECONDS).toBe(8);
    expect(
      fitMusic(score(), { duration: 6, hero: 2, lastLine: 4.5, verdict: 'looks-good' }),
    ).toBeUndefined();
  });

  it.each([30, 120])('fits a %i s video', (d) => {
    const lastLine = d - 1.5;
    const a = fitMusic(score(), {
      duration: d,
      hero: d * 0.4,
      lastLine,
      verdict: 'needs-attention',
    })!;
    check(a, d, lastLine);
    expect(Math.abs(a.bpm / 100 - 1)).toBeLessThanOrEqual(0.06);
    expect(a.markers.hero!.downbeat).toBeCloseTo(d * 0.4, 9);
    // The ending rings past the end of the video, which fades it out.
    expect(a.start + a.totalBars * a.bar).toBeGreaterThan(d);
  });
});
