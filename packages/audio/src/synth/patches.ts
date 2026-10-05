/*
 * Patches are data: YAML presets over a handful of instrument algorithms, so agents can add sounds
 * without writing code. Kits map drum voice names (kick, snare, hat, …) to drum patches.
 *
 * Covi's presets live in templates/music/patches and templates/music/kits (`.yml`). The loaders
 * read the directories they are given; later directories override earlier ones by id.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');
const Seconds = z.number().min(0).max(30);

export const AdsrSchema = z.strictObject({
  a: Seconds,
  d: Seconds,
  s: z.number().min(0).max(1),
  r: Seconds,
});

export const VibratoSchema = z.strictObject({
  /** LFO rate in Hz. */
  rate: z.number().positive().max(20),
  /** Depth in cents (peak). */
  depth: z.number().min(0).max(200),
  /** Seconds before the vibrato starts. */
  delay: Seconds.default(0),
  /** Seconds to fade the vibrato in after the delay. */
  fade: Seconds.default(0.15),
});

export const ChorusSchema = z.strictObject({
  depth: z.number().min(0).max(1),
  rate: z.number().positive().max(10),
  mix: z.number().min(0).max(1),
});

const base = {
  id: Id,
  description: z.string().optional(),
  /** Output gain in dB. */
  gain: z.number().min(-60).max(12).default(0),
  /** Stereo position −1..1. */
  pan: z.number().min(-1).max(1).default(0),
  /** Transposition in semitones. */
  transpose: z.number().int().min(-48).max(48).default(0),
  /** Track-level effects a score applies by default to a track using this patch. */
  fx: z.strictObject({ chorus: ChorusSchema.optional() }).optional(),
};

const OscSchema = z.strictObject({
  wave: z.enum(['sine', 'triangle', 'saw', 'square', 'pulse']),
  duty: z.number().min(0.02).max(0.98).default(0.5),
  /** Detune in cents. */
  detune: z.number().min(-100).max(100).default(0),
  octave: z.number().int().min(-3).max(3).default(0),
  semi: z.number().min(-24).max(24).default(0),
  level: z.number().min(0).max(2).default(1),
  pan: z.number().min(-1).max(1).default(0),
});

const FilterSchema = z.strictObject({
  type: z.enum(['lowpass', 'highpass', 'bandpass']).default('lowpass'),
  /** Base cutoff in Hz at C4. */
  cutoff: z.number().positive().max(20000),
  q: z.number().min(0.1).max(12).default(Math.SQRT1_2),
  /** Octaves added to the cutoff at the filter envelope's peak. */
  env: z.number().min(-8).max(8).default(0),
  /** 0..1: how far the cutoff follows the note (1 = fully). */
  keytrack: z.number().min(-1).max(2).default(0),
  /** Octaves of cutoff change per unit of velocity above 0.8. */
  velocity: z.number().min(-4).max(8).default(0),
  /** Filter envelope; defaults to the amp envelope. */
  adsr: AdsrSchema.optional(),
});

export const SubtractivePatchSchema = z.strictObject({
  ...base,
  algo: z.literal('subtractive'),
  oscs: z.array(OscSchema).min(1).max(4),
  /** White-noise level mixed with the oscillators. */
  noise: z.number().min(0).max(1).default(0),
  filter: FilterSchema.optional(),
  /** Static highpass (Hz) after the filter, e.g. to keep a bass out of the sub-rumble. */
  highpass: z.number().positive().max(2000).optional(),
  amp: AdsrSchema,
  vibrato: VibratoSchema.optional(),
  /** 0..1 gentle tanh saturation. */
  drive: z.number().min(0).max(1).default(0),
});

const BodySchema = z.strictObject({
  freq: z.number().positive(),
  q: z.number().positive().default(1.5),
  gain: z.number().min(-24).max(18),
});

export const KsPatchSchema = z.strictObject({
  ...base,
  algo: z.literal('ks'),
  damping: z.number().min(0).max(1).default(0.4),
  brightness: z.number().min(0).max(1).default(0.5),
  pluckPos: z.number().min(0.02).max(0.5).default(0.18),
  /** T60 of the fundamental at C4 in seconds. */
  decay: z.number().positive().max(20).default(1),
  /** 0..1: how much shorter the decay gets per octave up. */
  keyDecay: z.number().min(0).max(1).default(0.35),
  /** Seconds over which a lowpass opens after the pluck (a soft, finger-like attack). */
  attackSoft: Seconds.default(0.012),
  /** Peaking EQ resonances imitating an instrument body. */
  body: z.array(BodySchema).default([]),
  lowpass: z.number().positive().max(20000).optional(),
  amp: z
    .strictObject({ a: Seconds.default(0.002), r: Seconds.default(0.08) })
    .default({ a: 0.002, r: 0.08 }),
});

const PartialSchema = z.strictObject({
  ratio: z.number().positive(),
  gain: z.number().min(0),
  decay: z.number().positive(),
});

export const ModalPatchSchema = z.strictObject({
  ...base,
  algo: z.literal('modal'),
  /** Partials relative to the note; `decay` is T60 at C4. */
  partials: z.array(PartialSchema).min(1).max(12),
  strike: z
    .strictObject({
      noise: z.number().min(0).max(2).default(0),
      ms: z.number().positive().max(20).default(1),
      freq: z.number().positive().default(3000),
      q: z.number().positive().default(0.8),
    })
    .default({ noise: 0, ms: 1, freq: 3000, q: 0.8 }),
  /** 0..1: how much shorter decays get per octave up. */
  keyDecay: z.number().min(0).max(1).default(0.3),
  /** Play at this fixed frequency regardless of the note (woodblocks, knocks). */
  fixedFreq: z.number().positive().optional(),
  /** How much velocity brightens the upper partials (0..1). */
  hardness: z.number().min(0).max(1).default(0.5),
  lowpass: z.number().positive().max(20000).optional(),
  amp: z.strictObject({ r: Seconds.default(0.1) }).default({ r: 0.1 }),
});

const FmOpSchema = z.strictObject({
  ratio: z.number().positive().max(32),
  index: z.number().min(0).max(20),
  indexDecay: z.number().positive().max(20),
  indexSustain: z.number().min(0).max(1).default(0),
  feedback: z.number().min(0).max(1.5).default(0),
  carrier: z.number().positive().max(16).default(1),
  level: z.number().min(0).max(2).default(1),
  detune: z.number().min(-100).max(100).default(0),
  /** Optional per-operator amplitude T60 (s), e.g. a fast-dying tine. */
  decay: z.number().positive().max(30).optional(),
});

export const FmPatchSchema = z.strictObject({
  ...base,
  algo: z.literal('fm'),
  ops: z.array(FmOpSchema).min(1).max(4),
  amp: AdsrSchema,
  /** How strongly velocity scales the modulation index (0..1). */
  velocityIndex: z.number().min(0).max(1).default(0.5),
  /** 0..1: decay shortening per octave up (applied to the amp decay/release). */
  keyDecay: z.number().min(0).max(1).default(0.2),
  lowpass: z.number().positive().max(20000).optional(),
});

export const WindPatchSchema = z.strictObject({
  ...base,
  algo: z.literal('wind'),
  /** Relative levels of harmonics 1..n. */
  harmonics: z.array(z.number().min(0)).min(1).max(16),
  /** Continuous breath-noise level. */
  breath: z.number().min(0).max(1).default(0.05),
  /** Noise burst at the attack ("chiff"). */
  chiff: z.number().min(0).max(1).default(0.1),
  /** Cents below pitch at the attack, gliding up over ~70 ms. */
  scoop: z.number().min(0).max(100).default(0),
  vibrato: VibratoSchema.optional(),
  /** Amplitude modulation depth riding on the vibrato (0..1). */
  tremolo: z.number().min(0).max(1).default(0),
  amp: AdsrSchema,
  lowpass: z.number().positive().max(20000).default(8000),
});

export const DRUM_KINDS = [
  'kick',
  'snare',
  'clap',
  'hat',
  'shaker',
  'woodblock',
  'tom',
  'rim',
  'crash-soft',
] as const;

export const DrumPatchSchema = z.strictObject({
  ...base,
  algo: z.literal('drum'),
  kind: z.enum(DRUM_KINDS),
  /** Main pitch in Hz (body/start frequency). */
  freq: z.number().positive().max(20000).optional(),
  /** End frequency of a pitch sweep in Hz. */
  freqEnd: z.number().positive().max(20000).optional(),
  /** Time constant of the pitch sweep (s). */
  pitchDecay: z.number().positive().max(2).optional(),
  /** Main amplitude decay (s, ≈ T60). */
  decay: z.number().positive().max(8).optional(),
  /** Attack time (s). */
  attack: z.number().min(0).max(0.2).optional(),
  /** Level of the transient click. */
  click: z.number().min(0).max(2).optional(),
  /** Level of the noise component. */
  noise: z.number().min(0).max(2).optional(),
  /** Level of the tonal component. */
  tone: z.number().min(0).max(2).optional(),
  /** Filter centre / cutoff for the noise (Hz). */
  color: z.number().positive().max(20000).optional(),
  q: z.number().positive().max(20).optional(),
  /** Clap bursts. */
  bursts: z.number().int().min(1).max(6).optional(),
  /** Seconds between clap bursts. */
  spacing: z.number().positive().max(0.1).optional(),
  drive: z.number().min(0).max(1).optional(),
  lowpass: z.number().positive().max(20000).optional(),
  /** Stereo width of noise components (0..1). */
  width: z.number().min(0).max(1).optional(),
});

export const PatchSchema = z.discriminatedUnion('algo', [
  SubtractivePatchSchema,
  KsPatchSchema,
  ModalPatchSchema,
  FmPatchSchema,
  WindPatchSchema,
  DrumPatchSchema,
]);

export type Patch = z.output<typeof PatchSchema>;
export type SubtractivePatch = z.output<typeof SubtractivePatchSchema>;
export type KsPatch = z.output<typeof KsPatchSchema>;
export type ModalPatch = z.output<typeof ModalPatchSchema>;
export type FmPatch = z.output<typeof FmPatchSchema>;
export type WindPatch = z.output<typeof WindPatchSchema>;
export type DrumPatch = z.output<typeof DrumPatchSchema>;
export type DrumKind = (typeof DRUM_KINDS)[number];

export const KitSchema = z.strictObject({
  id: Id,
  description: z.string().optional(),
  /**
   * Voice name (kick, snare, clap, hat, openhat, shaker, rim, woodblock, tom, crash, …) → drum
   * patch id.
   */
  voices: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), Id),
});

export type Kit = z.output<typeof KitSchema>;

const DATA_FILE = /\.ya?ml$/;

/** The `.yml` and `.yaml` files in `dir`, sorted; none when the directory does not exist. */
function dataFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => DATA_FILE.test(f))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Parse one YAML data file (`what` names its kind in errors). The id defaults to, and must match,
 * the file name without its extension.
 */
export function readDataFile<T extends { id: string }>(
  file: string,
  schema: z.ZodType<T>,
  what: string,
): T {
  const stem = basename(file).replace(DATA_FILE, '');
  let raw: unknown;
  try {
    raw = parse(readFileSync(file, 'utf8')) ?? {};
  } catch (error) {
    throw new Error(`invalid ${what} ${file}: ${(error as Error).message}`);
  }
  const data =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) && !('id' in raw)
      ? { ...raw, id: stem }
      : raw;
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(`invalid ${what} ${file}:\n${z.prettifyError(parsed.error)}`);
  if (parsed.data.id !== stem)
    throw new Error(
      `invalid ${what} ${file}: id "${parsed.data.id}" must match the file name "${stem}"`,
    );
  return parsed.data;
}

/** Load every data file in `dirs`; later directories override earlier ones by id. */
export function loadDataDirs<T extends { id: string }>(
  dirs: string[],
  schema: z.ZodType<T>,
  what: string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const dir of dirs) {
    for (const file of dataFiles(dir)) {
      const item = readDataFile(file, schema, what);
      out.set(item.id, item);
    }
  }
  return out;
}

/** Load every patch in `dirs`; later directories override earlier ones by id. */
export function loadPatches(dirs: string[]): Map<string, Patch> {
  return loadDataDirs(dirs, PatchSchema, 'patch');
}

/** Load every kit in `dirs`; later directories override earlier ones by id. */
export function loadKits(dirs: string[]): Map<string, Kit> {
  return loadDataDirs(dirs, KitSchema, 'kit');
}
