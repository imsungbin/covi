import { z } from 'zod';

/*
 * The SFX recipe format: a fixed-length sound built from layered generators. Each layer is
 * rendered, peak-normalised to 0 dBFS, then scaled by its `gain` (dB), offset by `delay` (s) and
 * panned (`pan`, or [from, to] for a sweep); the mix gets optional reverb/delay and is
 * peak-normalised to −3 dBFS.
 *
 * Generators: tone, noise-sweep, fm, modal, pluck, notes (instrument patches for jingles).
 * Frequencies accept Hz or note names (E6). Only pitches written as note names (and notes-layer
 * `midi`) follow a transposition; see ../sfx/recipes.ts.
 *
 * A recipe is bounded (layers, notes, seconds) so it cannot make the synthesizer do unbounded work.
 */

const NOTE_RE = /^[A-Ga-g](##|#|bb|b|x)?-?\d+$/;

/** Hz, or a note name like A4 / F#5. */
export const FreqSchema = z.union([
  z.number().positive().max(24000),
  z.string().regex(NOTE_RE, 'expected Hz or a note name like A4'),
]);

/** Attack (linear) – hold – decay (exponential to exactly 0), in seconds. */
export const SfxEnvSchema = z.strictObject({
  a: z.number().min(0).max(10).default(0.002),
  h: z.number().min(0).max(10).default(0),
  d: z.number().min(0.001).max(20),
});

const PanSchema = z.union([
  z.number().min(-1).max(1),
  z.tuple([z.number().min(-1).max(1), z.number().min(-1).max(1)]),
]);

const common = {
  /** Layer level in dB relative to a full-scale layer. */
  gain: z.number().min(-60).max(24).default(0),
  /** Start offset in seconds. */
  delay: z.number().min(0).max(10).default(0),
  /** Stereo position, or [from, to] to sweep across the layer. */
  pan: PanSchema.default(0),
};

const Unit = z.number().min(0).max(1);

export const ToneLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('tone'),
  wave: z.enum(['sine', 'triangle', 'saw', 'square', 'pulse']).default('sine'),
  duty: z.number().min(0.05).max(0.95).default(0.5),
  from: FreqSchema,
  /** Exponential glide target. */
  to: FreqSchema.optional(),
  /** Glide time in seconds (default: the whole envelope). */
  glide: z.number().positive().max(10).optional(),
  env: SfxEnvSchema,
  /** Vibrato: rate Hz, depth cents. */
  vibrato: z
    .strictObject({ rate: z.number().positive().max(40), depth: z.number().min(0).max(1200) })
    .optional(),
});

export const NoiseSweepLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('noise-sweep'),
  color: z.enum(['white', 'pink']).default('pink'),
  filter: z.enum(['lowpass', 'highpass', 'bandpass']).default('bandpass'),
  /** Cutoff/centre at the start (Hz). */
  from: z.number().positive().max(22000),
  /** Cutoff/centre at the end (Hz), exponential sweep. */
  to: z.number().positive().max(22000).optional(),
  q: z.number().min(0.1).max(20).default(0.9),
  env: SfxEnvSchema,
});

export const FmLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('fm'),
  freq: FreqSchema,
  ratio: z.number().positive().max(32),
  index: z.number().min(0).max(20),
  indexDecay: z.number().positive().max(10).default(0.2),
  feedback: z.number().min(0).max(1.5).default(0),
  env: SfxEnvSchema,
});

export const ModalLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('modal'),
  freq: FreqSchema,
  partials: z
    .array(
      z.strictObject({
        ratio: z.number().positive(),
        gain: z.number().min(0),
        decay: z.number().positive(),
      }),
    )
    .min(1)
    .max(16),
  strike: z
    .strictObject({
      noise: z.number().min(0).max(2).default(0.2),
      ms: z.number().positive().max(20).default(1),
    })
    .default({ noise: 0.2, ms: 1 }),
});

export const PluckLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('pluck'),
  freq: FreqSchema,
  damping: Unit.default(0.4),
  brightness: Unit.default(0.5),
  pluckPos: z.number().min(0.02).max(0.5).default(0.2),
  /** T60 in seconds (default from damping). */
  decay: z.number().positive().max(20).optional(),
});

export const SfxNoteSchema = z
  .strictObject({
    note: z.string().regex(NOTE_RE).optional(),
    midi: z.number().int().min(0).max(127).optional(),
    /** Onset in seconds from the layer start. */
    at: z.number().min(0).max(10),
    /** Gate length in seconds (the patch's release follows). */
    dur: z.number().positive().max(10),
    patch: z.string().min(1),
    velocity: z.number().min(0).max(1).default(0.8),
  })
  .superRefine((n, ctx) => {
    if ((n.note === undefined) === (n.midi === undefined))
      ctx.addIssue({ code: 'custom', message: 'a note needs exactly one of `note` or `midi`' });
  });

export const NotesLayerSchema = z.strictObject({
  ...common,
  gen: z.literal('notes'),
  notes: z.array(SfxNoteSchema).min(1).max(32),
});

export const SfxLayerSchema = z.discriminatedUnion('gen', [
  ToneLayerSchema,
  NoiseSweepLayerSchema,
  FmLayerSchema,
  ModalLayerSchema,
  PluckLayerSchema,
  NotesLayerSchema,
]);

export const SfxRecipeSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case'),
  description: z.string().optional(),
  license: z.string().optional(),
  /** Exact length of the rendered sound in seconds. */
  duration: z.number().min(0.01).max(10),
  /**
   * The moment of the sound that lands on its cue, in seconds from its start: a sting whose
   * pickup leads into a landing starts that much before the cue. Default 0.
   */
  anchor: z.number().min(0).max(2).default(0),
  layers: z.array(SfxLayerSchema).min(1).max(12),
  fx: z
    .strictObject({
      reverb: z
        .strictObject({
          size: Unit.default(0.5),
          damp: Unit.default(0.5),
          mix: Unit.default(0.2),
          width: Unit.default(1),
        })
        .optional(),
      delay: z
        .strictObject({
          time: z.number().positive().max(2),
          feedback: z.number().min(0).max(0.9).default(0.3),
          mix: Unit.default(0.2),
          lowpass: z.number().positive().max(20000).default(6000),
        })
        .optional(),
    })
    .optional(),
});

export type SfxEnv = z.output<typeof SfxEnvSchema>;
export type SfxLayer = z.output<typeof SfxLayerSchema>;
export type SfxRecipe = z.output<typeof SfxRecipeSchema>;
