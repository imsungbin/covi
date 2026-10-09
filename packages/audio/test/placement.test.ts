import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/dsp/prng.ts';
import { dbfs } from '../src/loudness.ts';
import {
  BED_DB,
  clearOfSpeech,
  duckAmount,
  mergeSpeech,
  PLACEMENT,
  placementEnvelope,
  placementLevels,
  rampSeconds,
  swellingPauses,
} from '../src/placement.ts';

const SR = 1000; // a coarse rate keeps the arithmetic readable
const at = (levels: ArrayLike<number>, t: number) => levels[Math.round(t * SR)]!;
const SPEECH: Array<[number, number]> = [
  [2, 4],
  [10, 12],
];

describe('music placement', () => {
  it('matches the table: a ducked bed by default, bookends around the narration', () => {
    expect(PLACEMENT.continuous).toEqual({
      speechDb: -15,
      gapDb: -8,
      endsDb: -6,
      down: 1.2,
      up: 1.5,
      gapRamp: 'cosine',
      hold: 0.5,
      maxStepDb: 5,
    });
    expect(PLACEMENT.bookends).toEqual({
      speechDb: -40,
      gapDb: -11,
      endsDb: -11,
      down: 1.2,
      up: 1.5,
      gapRamp: 'linear',
      hold: null,
      maxStepDb: 5,
    });
    expect(BED_DB).toBe(PLACEMENT.continuous.speechDb);
  });

  it('lengthens a ramp until no second of it moves more than the step', () => {
    expect(rampSeconds(4, 1.2, 5, 'cosine')).toBe(1.2);
    // A raised cosine of D dB over T s moves D·sin(π/2T) in its steepest second.
    expect(rampSeconds(7, 1.2, 5, 'cosine')).toBeCloseTo(1.974, 3);
    expect(rampSeconds(7, 2.5, 5, 'cosine')).toBe(2.5);
    expect(rampSeconds(29, 1.5, 5, 'linear')).toBeCloseTo(5.8, 9);
  });

  it('ducks the bed under speech, swells in a long pause, and rises at the ends', () => {
    const lv = placementLevels(SPEECH, 'continuous', { duration: 16, sampleRate: SR });
    expect(lv.length).toBe(16 * SR);
    expect(at(lv, 0.5)).toBeCloseTo(-6, 9);
    // Halfway through the 1.2 s pre-roll into the first line, down by the time it starts.
    expect(at(lv, 1.4)).toBeCloseTo(-10.5, 1);
    expect(at(lv, 2)).toBeCloseTo(-15, 9);
    expect(at(lv, 3)).toBeCloseTo(-15, 9);
    // A 6 s pause rises over the lengthened ramp (1.974 s), holds, and comes back down.
    expect(at(lv, 4 + 1.974 / 2)).toBeCloseTo(-11.5, 1);
    expect(at(lv, 7)).toBeCloseTo(-8, 9);
    expect(at(lv, 10)).toBeCloseTo(-15, 9);
    // Halfway through the 1.5 s recovery after the last line.
    expect(at(lv, 12.75)).toBeCloseTo(-10.5, 1);
    expect(at(lv, 14)).toBeCloseTo(-6, 9);
    expect(
      dbfs(placementEnvelope(SPEECH, 'continuous', { duration: 16, sampleRate: SR })[3 * SR]!),
    ).toBeCloseTo(-15, 4);
  });

  it('keeps a pause down unless it can reach the gap level and hold it for half a second', () => {
    const short: Array<[number, number]> = [
      [2, 4],
      [8, 10],
    ];
    expect(
      at(placementLevels(short, 'continuous', { duration: 12, sampleRate: SR }), 6),
    ).toBeCloseTo(-15, 9);
    expect(swellingPauses(short, 'continuous')).toEqual([]);
    expect(swellingPauses(SPEECH, 'continuous')).toEqual([[4, 10]]);
  });

  it('never moves more than maxStepDb within a second between the first line and the last', () => {
    const random = mulberry32(7);
    for (const placement of ['continuous', 'bookends'] as const) {
      const p = PLACEMENT[placement];
      for (let trial = 0; trial < 40; trial++) {
        const speech: Array<[number, number]> = [];
        for (let t = 0.3 + random() * 2; t < 50; ) {
          const end = Math.min(56, t + 0.3 + random() * 5);
          speech.push([t, end]);
          t = end + 0.1 + random() * 7;
        }
        const lv = placementLevels(speech, placement, { duration: 60, sampleRate: SR });
        const first = Math.ceil(speech[0]![0] * SR);
        const last = Math.floor(speech.at(-1)![1] * SR);
        let worst = 0;
        for (let i = first; i + SR <= last; i++)
          worst = Math.max(worst, Math.abs(lv[i + SR]! - lv[i]!));
        expect(worst, `${placement} trial ${trial}`).toBeLessThanOrEqual(p.maxStepDb + 1e-6);
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (const v of lv) {
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
        expect(low).toBeGreaterThanOrEqual(p.speechDb - 1e-9);
        expect(high).toBeLessThanOrEqual(Math.max(p.gapDb, p.endsDb) + 1e-9);
        // Down whenever someone speaks.
        for (const [s, e] of speech)
          expect(at(lv, (s + e) / 2), `${placement} line ${s}`).toBeCloseTo(p.speechDb, 9);
      }
    }
  });

  it('swells bookends only as far as 5 dB per second reaches between lines', () => {
    const lv = placementLevels(
      [
        [2, 4],
        [5.2, 7],
        [15, 17],
      ],
      'bookends',
      { duration: 20, sampleRate: SR },
    );
    expect(at(lv, 0.5)).toBeCloseTo(-11, 9);
    expect(at(lv, 3)).toBeCloseTo(-40, 9);
    // A 1.2 s breath rises 3 dB and falls again; an 8 s pause reaches −20 in its middle.
    expect(at(lv, 4.6)).toBeCloseTo(-37, 6);
    expect(at(lv, 11)).toBeCloseTo(-20, 6);
    // Out of the last line over 1.5 s, raised cosine: −40 + 29·0.5 halfway.
    expect(at(lv, 17.75)).toBeCloseTo(-25.5, 1);
    expect(at(lv, 19)).toBeCloseTo(-11, 9);
  });

  it('keeps the ramps between lines out of the opening and the ending', () => {
    // Each 5.8 s bookends ramp would reach past the first line and the last; it stops at them.
    const lv = placementLevels(
      [
        [2, 4],
        [4.5, 5],
      ],
      'bookends',
      { duration: 8, sampleRate: SR },
    );
    expect(at(lv, 0.5)).toBeCloseTo(-11, 9);
    expect(at(lv, 4.25)).toBeCloseTo(-38.75, 6);
    expect(at(lv, 7)).toBeCloseTo(-11, 9);
  });

  it('holds the ends level throughout without narration', () => {
    for (const placement of ['continuous', 'bookends'] as const) {
      const lv = placementLevels([], placement, { duration: 3, sampleRate: SR });
      expect(Math.min(...lv)).toBe(PLACEMENT[placement].endsDb);
      expect(Math.max(...lv)).toBe(PLACEMENT[placement].endsDb);
    }
  });

  it('holds the ends level when every line falls before the video or after it', () => {
    const options = { duration: 10, sampleRate: SR };
    const outside: Array<Array<[number, number]>> = [
      [
        [-5, -4],
        [-3, -2],
      ],
      [
        [12, 13],
        [15, 16],
      ],
    ];
    for (const placement of ['continuous', 'bookends'] as const)
      for (const speech of outside)
        expect(placementLevels(speech, placement, options), `${placement} ${speech}`).toEqual(
          placementLevels([], placement, options),
        );
  });

  it('takes speech unsorted, overlapping, empty, or past either end', () => {
    const messy: Array<[number, number]> = [
      [10, 12],
      [2, 3],
      [2.5, 4],
      [6, 6],
      [-1, 0.2],
      [15, 30],
      [Number.NaN, 5],
    ];
    const clean: Array<[number, number]> = [
      [-1, 0.2],
      [2, 4],
      [10, 12],
      [15, 30],
    ];
    const a = placementLevels(messy, 'continuous', { duration: 20, sampleRate: SR });
    const b = placementLevels(clean, 'continuous', { duration: 20, sampleRate: SR });
    expect(a.length).toBe(20 * SR);
    expect([...a].every(Number.isFinite)).toBe(true);
    expect(a).toEqual(b);
  });

  it('knows when the music plays at a pause’s full level', () => {
    expect(clearOfSpeech(7, SPEECH, 'continuous')).toBe(true);
    expect(clearOfSpeech(3, SPEECH, 'continuous')).toBe(false);
    expect(clearOfSpeech(4.5, SPEECH, 'continuous')).toBe(false);
    expect(clearOfSpeech(0.5, SPEECH, 'continuous')).toBe(true);
    expect(clearOfSpeech(14, SPEECH, 'continuous')).toBe(true);
    expect(
      clearOfSpeech(
        6,
        [
          [2, 4],
          [8, 10],
        ],
        'continuous',
      ),
    ).toBe(false);
    expect(
      clearOfSpeech(
        4.6,
        [
          [2, 4],
          [5.2, 7],
        ],
        'bookends',
      ),
    ).toBe(false);
    expect(clearOfSpeech(2, [], 'bookends')).toBe(true);
  });

  it('says how far the music is ducked, for the carve to follow', () => {
    const lv = placementLevels(SPEECH, 'continuous', { duration: 16, sampleRate: SR });
    const duck = duckAmount(lv, 'continuous');
    expect(duck[3 * SR]).toBe(1);
    expect(duck[7 * SR]).toBe(0);
    expect(duck[Math.round(0.5 * SR)]).toBe(0);
    expect(duck[Math.round((4 + 1.974 / 2) * SR)]).toBeCloseTo(0.5, 2);
  });

  it('merges overlapping and nearby speech', () => {
    expect(
      mergeSpeech(
        [
          [5, 6],
          [1, 2],
          [2.3, 3],
          [2.5, 2.8],
        ],
        0.6,
      ),
    ).toEqual([
      [1, 3],
      [5, 6],
    ]);
  });
});
