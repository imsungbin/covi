import { LanguageSchema } from '@covi/core';
import { z } from 'zod';

/**
 * The storyboard is what a person, model, or agent authors: scenes with narration and a visual.
 * Timing is not authored; it is derived from the narration audio when the video renders.
 */

const RectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const PointSchema = z.strictObject({ x: z.number(), y: z.number() });

/** Images are paths relative to the run directory (e.g. `demo/screenshots/home-after.png`). */
const ImageRefSchema = z.strictObject({ path: z.string().min(1), label: z.string().optional() });

export const EXPRESSION_VALUES = [
  'neutral',
  'explaining',
  'thinking',
  'reviewing',
  'warning',
  'success',
] as const;

export const VisualSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('title'),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    eyebrow: z.string().optional(),
    meta: z.array(z.string()).default([]),
  }),
  z.strictObject({
    kind: z.literal('change-map'),
    areas: z
      .array(
        z.strictObject({
          name: z.string(),
          surface: z.string().optional(),
          additions: z.number().int().min(0),
          deletions: z.number().int().min(0),
          files: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.strictObject({
    kind: z.literal('code'),
    path: z.string().min(1),
    language: z.string().optional(),
    lines: z
      .array(
        z.strictObject({
          type: z.enum(['add', 'del', 'context']),
          text: z.string(),
          number: z.number().int().optional(),
        }),
      )
      .min(1)
      .max(40),
    highlight: z
      .array(z.number().int().min(0))
      .default([])
      .describe('Indexes into lines to emphasize.'),
    caption: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('screenshot'),
    image: ImageRefSchema,
    focus: RectSchema.optional().describe('Region in image pixels to zoom toward.'),
    click: PointSchema.optional(),
    label: z.string().optional(),
    device: z.enum(['desktop', 'mobile']).default('desktop'),
  }),
  z.strictObject({
    kind: z.literal('before-after'),
    before: ImageRefSchema,
    after: ImageRefSchema,
    layout: z.enum(['split', 'stack', 'wipe']).optional(),
    focus: RectSchema.optional(),
    labels: z
      .strictObject({ before: z.string(), after: z.string() })
      .default({ before: 'Before', after: 'After' }),
  }),
  z.strictObject({
    kind: z.literal('interaction'),
    steps: z
      .array(
        z.strictObject({
          image: ImageRefSchema,
          click: PointSchema.optional(),
          focus: RectSchema.optional(),
          label: z.string().optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.strictObject({
    kind: z.literal('terminal'),
    title: z.string().optional(),
    command: z.string(),
    output: z.string(),
    before: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('api'),
    method: z.string().default('GET'),
    path: z.string(),
    before: z.strictObject({ status: z.number().int(), body: z.string() }).optional(),
    after: z.strictObject({ status: z.number().int(), body: z.string() }),
  }),
  z.strictObject({
    kind: z.literal('findings'),
    findings: z
      .array(
        z.strictObject({
          title: z.string(),
          certainty: z.enum(['confirmed', 'likely', 'risk', 'question']),
          severity: z.enum(['high', 'medium', 'low']),
          location: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .min(1)
      .max(3),
  }),
  z.strictObject({
    kind: z.literal('callout'),
    tone: z.enum(['info', 'warning', 'success']).default('info'),
    title: z.string(),
    body: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('diagram'),
    nodes: z
      .array(
        z.strictObject({
          id: z.string(),
          label: z.string(),
          changed: z.boolean().default(false),
          detail: z.string().optional(),
        }),
      )
      .min(2)
      .max(8),
    edges: z
      .array(z.strictObject({ from: z.string(), to: z.string(), label: z.string().optional() }))
      .default([]),
  }),
  z.strictObject({
    kind: z.literal('summary'),
    verdict: z.enum(['looks-good', 'needs-attention', 'needs-changes']),
    headline: z.string(),
    points: z.array(z.string()).max(4).default([]),
    stats: z
      .strictObject({
        files: z.number().int(),
        additions: z.number().int(),
        deletions: z.number().int(),
      })
      .optional(),
  }),
]);

export type Visual = z.output<typeof VisualSchema>;
export type VisualKind = Visual['kind'];

export const SceneSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  beat: z.string().min(1).describe('The story beat this scene plays (from the template).'),
  eyebrow: z
    .string()
    .max(40)
    .optional()
    .describe('Short section label, e.g. "Before" or "Worth a look".'),
  heading: z.string().max(90).optional(),
  narration: z.string().max(600).describe('What Covi says. Also used for captions.'),
  say: z
    .string()
    .max(600)
    .optional()
    .describe(
      'Spoken form when it differs from the caption text: identifiers, paths, and names a voice would misread. Covi still spells out acronyms and applies video.narration.pronunciations to it before synthesis.',
    ),
  visual: VisualSchema,
  expression: z.enum(EXPRESSION_VALUES).optional(),
  minSeconds: z.number().min(1).max(30).optional(),
  optional: z.boolean().optional().describe('May be dropped to fit the target duration.'),
});

export type Scene = z.output<typeof SceneSchema>;

export const StoryboardSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  /** The language of the narration and on-screen text. Absent: detected from the narration. */
  language: LanguageSchema.optional().describe(
    'Language of the narration and on-screen text: en, ko, ja, or zh (Simplified Chinese). Omit it to let Covi detect the language from the narration.',
  ),
  title: z.string().min(1),
  template: z.string().min(1),
  /** True for Covi's heuristic draft; an agent or model sets false after rewriting it. */
  draft: z.boolean().default(false),
  scenes: z.array(SceneSchema).min(2).max(14),
});

export type Storyboard = z.output<typeof StoryboardSchema>;
export type StoryboardInput = z.input<typeof StoryboardSchema>;
