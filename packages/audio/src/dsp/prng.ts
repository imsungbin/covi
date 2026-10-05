/** A seeded random source returning floats uniformly distributed in [0, 1). */
export type Rng = () => number;

/** Mulberry32: tiny, fast, seeded 32-bit PRNG. The only randomness the synthesizer may use. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit seed (FNV-1a) derived from a list of parts, e.g. `seedFrom(seed, 'pad', 17)`. */
export function seedFrom(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f; // part separator, so ('ab', 'c') differs from ('a', 'bc')
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
