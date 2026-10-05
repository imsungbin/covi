import type { Rng } from './prng.ts';

/** Noise sources. Each factory returns a generator producing one sample per call. */
export const noise = {
  /** Uniform white noise in [−1, 1). */
  white(rng: Rng): () => number {
    return () => rng() * 2 - 1;
  },

  /** Pink (−3 dB/octave) noise, Voss–McCartney with 16 rows plus a white row. RMS ≈ 0.5. */
  pink(rng: Rng): () => number {
    const ROWS = 16;
    const rows = new Float64Array(ROWS);
    let running = 0;
    for (let i = 0; i < ROWS; i++) {
      rows[i] = rng() * 2 - 1;
      running += rows[i]!;
    }
    let counter = 0;
    const scale = 3.5 / (ROWS + 1);
    return () => {
      counter = (counter + 1) & 0xffff;
      if (counter !== 0) {
        const k = 31 - Math.clz32(counter & -counter); // index of the lowest set bit
        if (k < ROWS) {
          running -= rows[k]!;
          rows[k] = rng() * 2 - 1;
          running += rows[k]!;
        }
      }
      return (running + rng() * 2 - 1) * scale;
    };
  },
};
