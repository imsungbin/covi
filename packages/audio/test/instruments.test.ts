import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/dsp/prng.ts';
import { hashOf } from '../src/hash.ts';
import { noteSeconds, renderNote } from '../src/synth/instruments.ts';
import { loadKits, loadPatches } from '../src/synth/patches.ts';

const SR = 48000;
const MUSIC = join(import.meta.dirname, '..', '..', '..', 'templates', 'music');
const PATCH_DIR = join(MUSIC, 'patches');
const patches = loadPatches([PATCH_DIR]);
const kits = loadKits([join(MUSIC, 'kits')]);

const MELODIC = [
  'bell',
  'celesta',
  'clarinet',
  'e-piano',
  'flute',
  'glass-pluck',
  'glockenspiel',
  'kalimba',
  'marimba',
  'pizzicato',
  'round-bass',
  'soft-pad',
  'sub-bass',
];
const DRUMS = [
  'clap-soft',
  'crash-soft',
  'hat-open-soft',
  'hat-soft',
  'kick-felt',
  'kick-soft',
  'rim-soft',
  'shaker-soft',
  'snap-soft',
  'snare-brush',
  'snare-soft',
  'tom-soft',
  'woodblock-hi',
  'woodblock-lo',
];

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'covi-patches-'));
  return dir;
}

/**
 * Dominant frequency of 4096 Hann-windowed samples from 50 ms in: a scan over DFT bins up to 8 kHz,
 * refined in 0.5 Hz steps around the peak (Goertzel magnitudes, exact at any frequency).
 */
function dominantFreq(buf: Float32Array, sr: number): number {
  const n = 4096;
  const start = Math.round(0.05 * sr);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++)
    x[i] = buf[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const mag = (f: number) => {
    const c = 2 * Math.cos((2 * Math.PI * f) / sr);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const s0 = x[i]! + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  const bin = sr / n;
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

const peakOf = (bufs: Float32Array[]) =>
  Math.max(...bufs.map((b) => b.reduce((p, v) => Math.max(p, Math.abs(v)), 0)));
const rmsOf = (b: Float32Array) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);

describe('patch library', () => {
  it('loads every shipped patch, melodic and drum', () => {
    expect([...patches.keys()].sort()).toEqual([...MELODIC, ...DRUMS].sort());
    for (const id of MELODIC) expect(patches.get(id)!.algo, id).not.toBe('drum');
    for (const id of DRUMS) expect(patches.get(id)!.algo, id).toBe('drum');
  });

  it('loads both kits, and every kit voice is a drum patch', () => {
    expect([...kits.keys()].sort()).toEqual(['soft-acoustic', 'soft-electro']);
    for (const [id, kit] of kits) {
      for (const voice of ['kick', 'hat', 'crash'])
        expect(kit.voices[voice], `${id}.${voice}`).toBeDefined();
      for (const [voice, patchId] of Object.entries(kit.voices))
        expect(patches.get(patchId)?.algo, `${id}.${voice} → ${patchId}`).toBe('drum');
    }
    expect(kits.get('soft-electro')!.voices.shaker).toBeDefined();
    expect(kits.get('soft-acoustic')!.voices.woodblock).toBeDefined();
  });

  it('reports the file of an invalid patch', () => {
    const d = tempDir();
    writeFileSync(
      join(d, 'broken.yml'),
      'algo: subtractive\noscs: []\namp: { a: 0, d: 0, s: 1, r: 0 }\n',
    );
    expect(() => loadPatches([d])).toThrow(/broken\.yml/);
  });

  it('requires an id to match its file name', () => {
    const d = tempDir();
    writeFileSync(join(d, 'named.yml'), 'id: other\nalgo: drum\nkind: rim\n');
    expect(() => loadPatches([d])).toThrow(/must match the file name "named"/);
  });

  it('lets later directories override earlier ones, reading .yaml files too', () => {
    const d = tempDir();
    writeFileSync(
      join(d, 'marimba.yaml'),
      'algo: subtractive\noscs: [{ wave: square }]\namp: { a: 0.002, d: 0.1, s: 0.7, r: 0.05 }\n',
    );
    const merged = loadPatches([PATCH_DIR, d]);
    expect(merged.get('marimba')!.algo).toBe('subtractive');
    expect(merged.size).toBe(patches.size);
  });
});

describe('renderNote', () => {
  it('is deterministic for a seed (marimba C4, seed 7)', () => {
    const note = { midi: 60, velocity: 0.8, duration: 0.5 };
    const [aL, aR] = renderNote(patches.get('marimba')!, note, SR, mulberry32(7));
    const [bL, bR] = renderNote(patches.get('marimba')!, note, SR, mulberry32(7));
    expect(hashOf(aL, aR)).toBe(hashOf(bL, bR));
  });

  it('plays A4 in tune on glass-pluck, pizzicato and e-piano', () => {
    for (const id of ['glass-pluck', 'pizzicato', 'e-piano']) {
      const [l] = renderNote(
        patches.get(id)!,
        { midi: 69, velocity: 0.8, duration: 0.4 },
        SR,
        mulberry32(1),
      );
      const f = dominantFreq(l!, SR);
      expect(Math.abs(f - 440) / 440, `${id}: ${f.toFixed(1)} Hz`).toBeLessThanOrEqual(0.015);
    }
  });

  it('renders every shipped patch as finite stereo audio with peak ≤ 1 at velocity 1', () => {
    for (const [id, patch] of patches) {
      const pitches = patch.algo === 'drum' ? [60] : [36, 60, 84];
      for (const midi of pitches) {
        const out = renderNote(patch, { midi, velocity: 1, duration: 0.6 }, SR, mulberry32(3));
        expect(out, id).toHaveLength(2);
        expect(out[0]!.length, id).toBe(out[1]!.length);
        expect(
          out.every((c) => c.every((v) => Number.isFinite(v))),
          `${id} @${midi} finite`,
        ).toBe(true);
        const p = peakOf(out);
        expect(p, `${id} @${midi} peak`).toBeLessThanOrEqual(1);
        expect(p, `${id} @${midi} audible`).toBeGreaterThan(0.02);
      }
    }
  });

  it('starts silent and ends silent (no clicks at the edges)', () => {
    for (const [id, patch] of patches) {
      const out = renderNote(patch, { midi: 60, velocity: 1, duration: 0.3 }, SR, mulberry32(3));
      for (const ch of out) {
        expect(Math.abs(ch[0]!), `${id} first sample`).toBeLessThan(0.02);
        expect(Math.abs(ch[ch.length - 1]!), `${id} last sample`).toBeLessThan(0.01);
      }
    }
  });

  it('knows how long every shipped patch sounds before rendering it', () => {
    // A low rate keeps it fast; the length is a property of the note, not of the rate.
    const sr = 8000;
    for (const patch of patches.values())
      for (const midi of [0, 36, 60, 96])
        for (const duration of [0.02, 0.6]) {
          const note = { midi, velocity: 0.8, duration };
          const rendered = renderNote(patch, note, sr, mulberry32(3))[0]!.length;
          expect(
            Math.abs(Math.round(noteSeconds(patch, note) * sr) - rendered),
            `${patch.id} ${midi} ${duration}`,
          ).toBeLessThanOrEqual(1);
        }
  });

  it('includes the release tail after the gate', () => {
    const pad = patches.get('soft-pad')!;
    const [l] = renderNote(pad, { midi: 62, velocity: 0.8, duration: 1 }, SR, mulberry32(1));
    expect(l!.length).toBeGreaterThan(1.2 * SR);
    expect(rmsOf(l!.subarray(Math.round(1.02 * SR), Math.round(1.12 * SR)))).toBeGreaterThan(0.001);
  });

  it('velocity scales the level', () => {
    const marimba = patches.get('marimba')!;
    const [soft] = renderNote(
      marimba,
      { midi: 64, velocity: 0.35, duration: 0.5 },
      SR,
      mulberry32(1),
    );
    const [hard] = renderNote(marimba, { midi: 64, velocity: 1, duration: 0.5 }, SR, mulberry32(1));
    expect(rmsOf(hard!)).toBeGreaterThan(2 * rmsOf(soft!));
  });
});
