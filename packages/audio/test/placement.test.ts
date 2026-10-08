import { describe, expect, it } from 'vitest';
import { dbfs } from '../src/loudness.ts';
import { clearOfSpeech, mergeSpeech, PLACEMENT, placementEnvelope } from '../src/placement.ts';

const SR = 1000; // a coarse rate keeps the arithmetic readable
const at = (env: Float32Array, t: number) => dbfs(env[Math.round(t * SR)]!);

describe('music placement', () => {
  it('matches the table: continuous for feed formats, bookends for standard reviews', () => {
    expect(PLACEMENT.continuous).toEqual({
      speechDb: -20,
      elsewhereDb: -11,
      minGap: 0.6,
      down: 0.06,
      up: 0.3,
    });
    expect(PLACEMENT.bookends).toEqual({
      speechDb: -40,
      elsewhereDb: -11,
      minGap: 1.2,
      down: 0.06,
      up: 0.3,
    });
  });

  it('sits under speech, and at the "elsewhere" level before the first and after the last line', () => {
    const env = placementEnvelope(
      [
        [1, 3],
        [5, 7],
      ],
      'continuous',
      { duration: 10, sampleRate: SR },
    );
    expect(at(env, 0.5)).toBeCloseTo(-11, 5);
    expect(at(env, 2)).toBeCloseTo(-20, 5);
    expect(at(env, 4)).toBeCloseTo(-11, 5);
    expect(at(env, 6)).toBeCloseTo(-20, 5);
    expect(at(env, 9)).toBeCloseTo(-11, 5);
    expect(env.length).toBe(10 * SR);
  });

  it('starts ducking 60 ms before speech and releases over 300 ms after it', () => {
    const env = placementEnvelope([[1, 3]], 'continuous', { duration: 5, sampleRate: SR });
    expect(at(env, 1)).toBeCloseTo(-20, 5);
    expect(at(env, 0.97)).toBeCloseTo(-15.5, 1);
    expect(at(env, 0.93)).toBeCloseTo(-11, 5);
    expect(at(env, 3.15)).toBeCloseTo(-15.5, 1);
    expect(at(env, 3.31)).toBeCloseTo(-11, 5);
  });

  it('keeps short gaps ducked: only gaps from minGap up swell', () => {
    const short = placementEnvelope(
      [
        [1, 2],
        [2.5, 3],
      ],
      'continuous',
      { duration: 4, sampleRate: SR },
    );
    expect(at(short, 2.25)).toBeCloseTo(-20, 5);
    const long = placementEnvelope(
      [
        [1, 2],
        [2.7, 3],
      ],
      'continuous',
      { duration: 4, sampleRate: SR },
    );
    expect(at(long, 2.3)).toBeGreaterThan(-20);
  });

  it('keeps music effectively off under speech for bookends, swelling only in long gaps', () => {
    const env = placementEnvelope(
      [
        [1, 3],
        [4, 6],
        [8, 9],
      ],
      'bookends',
      { duration: 10, sampleRate: SR },
    );
    expect(at(env, 0.5)).toBeCloseTo(-11, 5);
    expect(at(env, 2)).toBeCloseTo(-40, 5);
    // 1 s between lines is less than the 1.2 s that swells.
    expect(at(env, 3.5)).toBeCloseTo(-40, 5);
    expect(at(env, 7)).toBeCloseTo(-11, 5);
    expect(at(env, 9.7)).toBeCloseTo(-11, 5);
  });

  it('holds the "elsewhere" level throughout without narration', () => {
    const env = placementEnvelope([], 'bookends', { duration: 3, sampleRate: SR });
    expect(Math.min(...env)).toBeCloseTo(Math.max(...env), 9);
    expect(at(env, 1.5)).toBeCloseTo(-11, 5);
  });

  it('rises in a bookends breath within 0.3 s, in time for a hero settling 0.5 s after a line', () => {
    const env = placementEnvelope(
      [
        [1, 3],
        [5, 7],
      ],
      'bookends',
      { duration: 8, sampleRate: SR },
    );
    expect(at(env, 3.15)).toBeLessThan(-20);
    expect(at(env, 3.3)).toBeCloseTo(-11, 5);
    expect(at(env, 3.5)).toBeCloseTo(-11, 5);
  });

  it('knows when music plays at full level, clear of speech and its ramps', () => {
    const speech: Array<[number, number]> = [
      [1, 3],
      [5, 7],
    ];
    expect(clearOfSpeech(2, speech, 'bookends')).toBe(false);
    expect(clearOfSpeech(3.2, speech, 'bookends')).toBe(false);
    expect(clearOfSpeech(3.3, speech, 'bookends')).toBe(true);
    expect(clearOfSpeech(4.9, speech, 'bookends')).toBe(true);
    expect(clearOfSpeech(4.95, speech, 'bookends')).toBe(false);
    expect(clearOfSpeech(0.5, speech, 'bookends')).toBe(true);
    // A gap too short to rise in counts as speech.
    expect(
      clearOfSpeech(
        3.4,
        [
          [1, 3],
          [3.8, 6],
        ],
        'bookends',
      ),
    ).toBe(false);
    expect(
      clearOfSpeech(
        3.45,
        [
          [1, 3],
          [3.8, 6],
        ],
        'continuous',
      ),
    ).toBe(true);
    expect(clearOfSpeech(2, [], 'bookends')).toBe(true);
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
