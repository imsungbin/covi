/*
 * Procedural sound effects: render a recipe (../schema/sfx.ts) into a stereo buffer of exactly
 * round(duration · sr) samples, peak-normalised to −3 dBFS. Deterministic for a given seed.
 *
 * Transposition: `transpose` (integer semitones) shifts every pitch written as a note name — tone
 * `from`/`to`, the `freq` of fm, modal and pluck layers, a notes layer's `note` — and every
 * notes-layer `midi`, so a jingle can follow the music's key. Pitches written in Hz are unpitched
 * sound design (whooshes, knocks, ticks) and are never transposed.
 */
import { ahd, fadeIn, fadeOut } from '../dsp/env.ts';
import { Svf } from '../dsp/filter.ts';
import { fm2 } from '../dsp/fm.ts';
import { delay, panGains, peakAbs, reverb, stereo } from '../dsp/fx.ts';
import { karplusStrong } from '../dsp/ks.ts';
import { modal } from '../dsp/modal.ts';
import { noise } from '../dsp/noise.ts';
import { Osc } from '../dsp/osc.ts';
import { mulberry32, type Rng, seedFrom } from '../dsp/prng.ts';
import { midiToFreq, noteToMidi } from '../music/theory.ts';
import { type SfxEnv, type SfxLayer, type SfxRecipe, SfxRecipeSchema } from '../schema/sfx.ts';
import { renderNote } from '../synth/instruments.ts';
import { loadDataDirs, type Patch, readDataFile } from '../synth/patches.ts';

const TARGET_PEAK = 10 ** (-3 / 20);
const TWO_PI = 2 * Math.PI;

export interface SfxRenderOptions {
  sampleRate?: number;
  seed?: number;
  /** Semitones added to every pitch written as a note name or MIDI number; default 0. */
  transpose?: number;
}

/** A layer pitch in Hz: Hz as written, or a note name after transposition. */
type Pitch = (f: number | string) => number;

const envSeconds = (e: SfxEnv) => e.a + e.h + e.d;

function tone(
  l: Extract<SfxLayer, { gen: 'tone' }>,
  maxDur: number,
  sr: number,
  hz: Pitch,
): Float32Array {
  const n = Math.max(1, Math.round(Math.min(envSeconds(l.env), maxDur) * sr));
  const env = ahd(l.env.a, l.env.h, l.env.d, sr, n);
  const f0 = hz(l.from);
  const f1 = l.to !== undefined ? hz(l.to) : f0;
  const glide = Math.max(1, (l.glide ?? envSeconds(l.env)) * sr);
  const ratio = Math.log(f1 / f0);
  const osc = new Osc(l.wave, 0, l.duty);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let f = f0 * Math.exp(ratio * Math.min(1, i / glide));
    if (l.vibrato)
      f *= 2 ** ((l.vibrato.depth * Math.sin((TWO_PI * l.vibrato.rate * i) / sr)) / 1200);
    out[i] = osc.next(f, sr) * env[i]!;
  }
  return out;
}

function noiseSweep(
  l: Extract<SfxLayer, { gen: 'noise-sweep' }>,
  maxDur: number,
  sr: number,
  rng: Rng,
): Float32Array {
  const n = Math.max(1, Math.round(Math.min(envSeconds(l.env), maxDur) * sr));
  const env = ahd(l.env.a, l.env.h, l.env.d, sr, n);
  const src = l.color === 'white' ? noise.white(rng) : noise.pink(rng);
  const f0 = l.from;
  const f1 = l.to ?? l.from;
  const svf = new Svf(sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 16) {
    svf.set(f0 * (f1 / f0) ** (i / n), l.q);
    const end = Math.min(n, i + 16);
    for (let j = i; j < end; j++) {
      const x = src();
      const y =
        l.filter === 'lowpass' ? svf.lp(x) : l.filter === 'highpass' ? svf.hp(x) : svf.bp(x) / l.q;
      out[j] = y * env[j]!;
    }
  }
  return out;
}

function fmLayer(
  l: Extract<SfxLayer, { gen: 'fm' }>,
  maxDur: number,
  sr: number,
  hz: Pitch,
): Float32Array {
  const n = Math.max(1, Math.round(Math.min(envSeconds(l.env), maxDur) * sr));
  const env = ahd(l.env.a, l.env.h, l.env.d, sr, n);
  return fm2(
    hz(l.freq),
    n / sr,
    { ratio: l.ratio, index: l.index, indexDecay: l.indexDecay, feedback: l.feedback },
    env,
    sr,
  );
}

function modalLayer(
  l: Extract<SfxLayer, { gen: 'modal' }>,
  maxDur: number,
  sr: number,
  rng: Rng,
  hz: Pitch,
): Float32Array {
  const len = Math.min(maxDur, Math.max(...l.partials.map((p) => p.decay)) * 1.25 + 0.01);
  const out = modal(
    hz(l.freq),
    len,
    l.partials,
    sr,
    { noise: l.strike.noise, ms: l.strike.ms },
    rng,
  );
  return fadeOut(out, 0.004, sr);
}

function pluckLayer(
  l: Extract<SfxLayer, { gen: 'pluck' }>,
  maxDur: number,
  sr: number,
  rng: Rng,
  hz: Pitch,
): Float32Array {
  const t60 = l.decay ?? 3.2 * 0.08 ** l.damping;
  const out = karplusStrong(
    hz(l.freq),
    Math.min(maxDur, t60 * 1.3),
    { damping: l.damping, brightness: l.brightness, pluckPos: l.pluckPos, decay: l.decay },
    sr,
    rng,
  );
  fadeIn(out, 0.001, sr);
  return fadeOut(out, 0.004, sr);
}

function notesLayer(
  l: Extract<SfxLayer, { gen: 'notes' }>,
  maxDur: number,
  sr: number,
  rng: Rng,
  patches: ReadonlyMap<string, Patch>,
  transpose: number,
): Float32Array[] {
  const n = Math.max(1, Math.round(maxDur * sr));
  const out = stereo(n);
  for (const note of l.notes) {
    const patch = patches.get(note.patch);
    if (!patch) throw new Error(`unknown patch "${note.patch}" in a notes layer`);
    const midi = (note.midi ?? noteToMidi(note.note!)) + transpose;
    const rendered = renderNote(
      patch,
      { midi, velocity: note.velocity, duration: note.dur },
      sr,
      mulberry32(Math.floor(rng() * 2 ** 32)),
    );
    const off = Math.round(note.at * sr);
    for (let c = 0; c < 2; c++) {
      const src = rendered[c]!;
      const dst = out[c]!;
      const end = Math.min(n, off + src.length);
      for (let i = off; i < end; i++) dst[i]! += src[i - off]!;
    }
  }
  for (const c of out) fadeOut(c, 0.004, sr);
  return out;
}

function renderLayer(
  layer: SfxLayer,
  maxDur: number,
  sr: number,
  rng: Rng,
  patches: ReadonlyMap<string, Patch>,
  transpose: number,
): Float32Array[] {
  const hz: Pitch = (f) => (typeof f === 'number' ? f : midiToFreq(noteToMidi(f) + transpose));
  switch (layer.gen) {
    case 'tone':
      return [tone(layer, maxDur, sr, hz)];
    case 'noise-sweep':
      return [noiseSweep(layer, maxDur, sr, rng)];
    case 'fm':
      return [fmLayer(layer, maxDur, sr, hz)];
    case 'modal':
      return [modalLayer(layer, maxDur, sr, rng, hz)];
    case 'pluck':
      return [pluckLayer(layer, maxDur, sr, rng, hz)];
    case 'notes':
      return notesLayer(layer, maxDur, sr, rng, patches, transpose);
  }
}

/**
 * Render a recipe: each layer is peak-normalised, scaled by its gain, delayed and panned; then
 * recipe fx, a 5 ms end fade and peak normalisation to −3 dBFS. Length = round(duration · sr).
 */
export function renderSfx(
  recipe: SfxRecipe,
  patches: ReadonlyMap<string, Patch>,
  opts: SfxRenderOptions = {},
): Float32Array[] {
  const sr = opts.sampleRate ?? 48000;
  const seed = opts.seed ?? 1;
  const transpose = opts.transpose ?? 0;
  const n = Math.max(1, Math.round(recipe.duration * sr));
  const out = stereo(n);
  const L = out[0]!;
  const R = out[1]!;
  recipe.layers.forEach((layer, index) => {
    const off = Math.round(layer.delay * sr);
    if (off >= n) return;
    const rng = mulberry32(seedFrom(seed, recipe.id, index));
    const buf = renderLayer(layer, (n - off) / sr, sr, rng, patches, transpose);
    const p = peakAbs(buf);
    if (!(p > 0)) return;
    const g = 10 ** (layer.gain / 20) / p;
    const [p0, p1]: [number, number] =
      typeof layer.pan === 'number' ? [layer.pan, layer.pan] : layer.pan;
    const bl = buf[0]!;
    const br = buf[1] ?? bl;
    const len = bl.length;
    const end = Math.min(n, off + len);
    let [gl, gr] = panGains(p0);
    for (let i = off; i < end; i++) {
      const k = i - off;
      if (p0 !== p1 && k % 32 === 0)
        [gl, gr] = panGains(p0 + ((p1 - p0) * k) / Math.max(1, len - 1));
      L[i]! += bl[k]! * g * gl;
      R[i]! += br[k]! * g * gr;
    }
  });
  if (recipe.fx?.delay) delay(out, { ...recipe.fx.delay, sr });
  if (recipe.fx?.reverb) reverb(out, { ...recipe.fx.reverb, sr });
  for (const c of out) fadeOut(c, 0.005, sr);
  const p = peakAbs(out);
  if (p > 0) {
    const g = TARGET_PEAK / p;
    for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= g;
  }
  return out;
}

/** Parse one recipe file (`.yml` or `.yaml`); the id defaults to, and must match, the file name. */
export function readSfxRecipe(file: string): SfxRecipe {
  return readDataFile(file, SfxRecipeSchema, 'sfx recipe');
}

/** Load every recipe in `dirs`; later directories override earlier ones by id. */
export function loadSfxRecipes(dirs: string[]): Map<string, SfxRecipe> {
  return loadDataDirs(dirs, SfxRecipeSchema, 'sfx recipe');
}
