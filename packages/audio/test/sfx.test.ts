import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashOf } from '../src/hash.ts';
import { type SfxRecipe, SfxRecipeSchema } from '../src/schema/sfx.ts';
import { loadSfxRecipes, readSfxRecipe, renderSfx } from '../src/sfx/recipes.ts';
import { loadPatches } from '../src/synth/patches.ts';

const SR = 48000;
const patches = loadPatches([
  join(import.meta.dirname, '..', '..', '..', 'templates', 'music', 'patches'),
]);
const recipe = (raw: unknown): SfxRecipe => SfxRecipeSchema.parse(raw);

/** One layer per generator kind (a smoke test for the engine, not a designed sound). */
const ALL = recipe({
  id: 'all-generators',
  duration: 1.2,
  layers: [
    {
      gen: 'tone',
      wave: 'triangle',
      from: 'A4',
      to: 'A5',
      env: { a: 0.005, h: 0.05, d: 0.2 },
      vibrato: { rate: 8, depth: 20 },
      gain: -6,
    },
    {
      gen: 'noise-sweep',
      color: 'white',
      filter: 'highpass',
      from: 2000,
      to: 8000,
      q: 0.8,
      env: { a: 0.05, d: 0.3 },
      gain: -12,
      pan: [-0.8, 0.8],
    },
    {
      gen: 'fm',
      freq: 'C6',
      ratio: 3.5,
      index: 2,
      indexDecay: 0.2,
      env: { a: 0.002, d: 0.6 },
      gain: -10,
      delay: 0.2,
    },
    {
      gen: 'modal',
      freq: 880,
      partials: [
        { ratio: 1, gain: 1, decay: 0.4 },
        { ratio: 2.76, gain: 0.3, decay: 0.2 },
      ],
      strike: { noise: 0.2, ms: 0.5 },
      delay: 0.3,
      gain: -8,
    },
    { gen: 'pluck', freq: 'E3', damping: 0.4, brightness: 0.6, delay: 0.4, gain: -6 },
    {
      gen: 'notes',
      notes: [
        { note: 'C5', at: 0.5, dur: 0.2, patch: 'marimba' },
        { midi: 79, at: 0.7, dur: 0.2, patch: 'glockenspiel', velocity: 0.6 },
      ],
      gain: -4,
    },
  ],
  fx: {
    reverb: { size: 0.5, damp: 0.5, mix: 0.2, width: 1 },
    delay: { time: 0.12, feedback: 0.3, mix: 0.15, lowpass: 6000 },
  },
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'covi-sfx-'));
  return dir;
}

const peakDb = (buf: Float32Array[]) =>
  20 * Math.log10(Math.max(...buf.map((c) => c.reduce((p, v) => Math.max(p, Math.abs(v)), 0))));
const rms = (x: Float32Array, a: number, b: number) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, b - a));
};

/** Time (s) of the first sample after t−20 ms that clearly rises above what came just before. */
function onsetNear(x: Float32Array, t: number): number {
  const at = Math.round(t * SR);
  const pre = rms(x, at - Math.round(0.03 * SR), at - Math.round(0.02 * SR));
  const threshold = Math.max(1e-3, 4 * pre);
  for (let i = at - Math.round(0.02 * SR); i < at + Math.round(0.05 * SR); i++)
    if (Math.abs(x[i]!) > threshold) return i / SR;
  return Number.POSITIVE_INFINITY;
}

/**
 * Dominant frequency of 4096 Hann-windowed samples from 50 ms in: a scan over DFT bins up to 8 kHz,
 * refined in 0.5 Hz steps around the peak (Goertzel magnitudes, exact at any frequency).
 */
function dominantFreq(buf: Float32Array): number {
  const n = 4096;
  const start = Math.round(0.05 * SR);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++)
    x[i] = buf[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const mag = (f: number) => {
    const c = 2 * Math.cos((2 * Math.PI * f) / SR);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = x[i]! + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  const bin = SR / n;
  let best = 0;
  let bestF = 0;
  for (let k = 2; k * bin < 8000; k++) {
    const m = mag(k * bin);
    if (m > best) [best, bestF] = [m, k * bin];
  }
  for (let f = bestF - bin; f <= bestF + bin; f += 0.5) {
    const m = mag(f);
    if (m > best) [best, bestF] = [m, f];
  }
  return bestF;
}

const within = (f: number, target: number) => Math.abs(f - target) / target <= 0.015;

describe('generators', () => {
  it('render finite stereo audio of exactly duration·sr, at −3 dBFS, deterministically', () => {
    expect(new Set(ALL.layers.map((l) => l.gen))).toEqual(
      new Set(['tone', 'noise-sweep', 'fm', 'modal', 'pluck', 'notes']),
    );
    const a = renderSfx(ALL, patches);
    const b = renderSfx(ALL, patches);
    const [L, R] = a as [Float32Array, Float32Array];
    expect(a).toHaveLength(2);
    expect(L.length).toBe(Math.round(1.2 * SR));
    expect(R.length).toBe(L.length);
    expect(a.every((c) => c.every((v) => Number.isFinite(v)))).toBe(true);
    expect(Math.abs(peakDb(a) + 3)).toBeLessThanOrEqual(0.1);
    expect(hashOf(...a)).toBe(hashOf(...b));
    expect(Math.abs(L[0]!)).toBeLessThan(0.05);
    expect(Math.abs(L[L.length - 1]!)).toBeLessThan(1e-3);
  });

  it('normalises every layer on its own', () => {
    for (const layer of ALL.layers) {
      const solo = renderSfx({ ...ALL, layers: [layer], fx: undefined }, patches);
      expect(peakDb(solo), layer.gen).toBeCloseTo(-3, 1);
    }
  });

  it('places notes at their `at` offsets', () => {
    const r = recipe({
      id: 'onsets',
      duration: 0.8,
      layers: [
        {
          gen: 'notes',
          notes: [
            { note: 'C6', at: 0.1, dur: 0.1, patch: 'marimba' },
            { note: 'G6', at: 0.4, dur: 0.1, patch: 'marimba' },
          ],
        },
      ],
    });
    const [l] = renderSfx(r, patches);
    expect(rms(l!, 0, Math.round(0.098 * SR))).toBeLessThan(1e-6);
    for (const t of [0.1, 0.4])
      expect(Math.abs(onsetNear(l!, t) - t), `onset near ${t}`).toBeLessThanOrEqual(0.01);
  });

  it('delays a layer by `delay` seconds', () => {
    const r = recipe({
      id: 'late',
      duration: 0.5,
      layers: [{ gen: 'tone', from: 440, env: { a: 0.005, d: 0.2 }, delay: 0.2 }],
    });
    const [l] = renderSfx(r, patches);
    expect(rms(l!, 0, Math.round(0.2 * SR))).toBe(0);
    expect(rms(l!, Math.round(0.2 * SR), Math.round(0.3 * SR))).toBeGreaterThan(0.05);
  });

  it('changes noise with the seed but not the level', () => {
    const r = recipe({
      id: 'whoosh',
      duration: 0.6,
      layers: [{ gen: 'noise-sweep', from: 400, to: 4000, env: { a: 0.2, d: 0.35 } }],
    });
    const a = renderSfx(r, patches, { seed: 1 });
    const b = renderSfx(r, patches, { seed: 2 });
    expect(hashOf(a[0]!)).not.toBe(hashOf(b[0]!));
    expect(peakDb(b)).toBeCloseTo(-3, 1);
  });

  it('fails on a notes layer that names an unknown patch', () => {
    const r = recipe({
      id: 'missing',
      duration: 0.3,
      layers: [{ gen: 'notes', notes: [{ note: 'C5', at: 0, dur: 0.1, patch: 'nope' }] }],
    });
    expect(() => renderSfx(r, patches)).toThrow(/unknown patch "nope"/);
  });
});

describe('transposition', () => {
  const toneOf = (from: string | number) =>
    recipe({
      id: 'beep',
      duration: 0.4,
      layers: [{ gen: 'tone', from, env: { a: 0.005, h: 0.3, d: 0.05 } }],
    });

  it('shifts pitches written as note names', () => {
    expect(within(dominantFreq(renderSfx(toneOf('C5'), patches)[0]!), 523.25)).toBe(true);
    const up = dominantFreq(renderSfx(toneOf('C5'), patches, { transpose: 3 })[0]!);
    expect(within(up, 622.25), `${up} Hz`).toBe(true);
  });

  it('never shifts pitches written in Hz', () => {
    const f = dominantFreq(renderSfx(toneOf(523.25), patches, { transpose: 3 })[0]!);
    expect(within(f, 523.25), `${f} Hz`).toBe(true);
  });

  it('shifts notes-layer notes, written as names or MIDI numbers', () => {
    for (const note of [{ note: 'A4' }, { midi: 69 }]) {
      const r = recipe({
        id: 'jingle',
        duration: 0.5,
        layers: [{ gen: 'notes', notes: [{ ...note, at: 0, dur: 0.3, patch: 'marimba' }] }],
      });
      const f = dominantFreq(renderSfx(r, patches, { transpose: 3 })[0]!);
      expect(within(f, 523.25), `${JSON.stringify(note)}: ${f} Hz`).toBe(true);
    }
  });
});

describe('recipe files', () => {
  it('reports the file of an invalid recipe', () => {
    const d = tempDir();
    writeFileSync(join(d, 'bad.yml'), 'duration: 0.5\nlayers:\n  - { gen: laser, from: 440 }\n');
    expect(() => loadSfxRecipes([d])).toThrow(/bad\.yml/);
  });

  it('defaults the id to the file name, and later directories override earlier ones', () => {
    const a = tempDir();
    const body = (hz: number) =>
      `duration: 0.2\nlayers:\n  - { gen: tone, from: ${hz}, env: { d: 0.1 } }\n`;
    writeFileSync(join(a, 'ding.yml'), body(880));
    const b = mkdtempSync(join(a, 'override-'));
    writeFileSync(join(b, 'ding.yaml'), body(440));
    expect(readSfxRecipe(join(a, 'ding.yml')).id).toBe('ding');
    const loaded = loadSfxRecipes([a, b]).get('ding')!;
    expect(loaded.layers[0]).toMatchObject({ gen: 'tone', from: 440 });
  });

  it('bounds a recipe to 12 layers and a notes layer to 32 notes', () => {
    const layer = { gen: 'tone', from: 440, env: { d: 0.1 } };
    const ok = { id: 'big', duration: 1, layers: Array.from({ length: 12 }, () => layer) };
    expect(SfxRecipeSchema.safeParse(ok).success).toBe(true);
    const tooMany = { ...ok, layers: [...ok.layers, layer] };
    expect(SfxRecipeSchema.safeParse(tooMany).success).toBe(false);
    const notes = Array.from({ length: 33 }, (_, i) => ({
      midi: 60,
      at: i * 0.01,
      dur: 0.1,
      patch: 'bell',
    }));
    const tooLong = { id: 'long', duration: 1, layers: [{ gen: 'notes', notes }] };
    expect(SfxRecipeSchema.safeParse(tooLong).success).toBe(false);
    const fits = { ...tooLong, layers: [{ gen: 'notes', notes: notes.slice(0, 32) }] };
    expect(SfxRecipeSchema.safeParse(fits).success).toBe(true);
  });
});
