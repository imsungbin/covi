import { EvidenceIdsSchema, LanguageSchema } from '@covi/core';
import { z } from 'zod';
import type { SceneCueKind, TransitionKind } from '../timeline/types.ts';
import { storyboardIssues } from './grammar.ts';

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

/** A phase name, as `sync` keys are written (bounded: names are untrusted input). */
const PhaseNameSchema = z
  .string()
  .max(32)
  .regex(/^[a-z]+\d*$/);

/** A region the camera visits; 1–3 of them make a screenshot (or a step) a short tour. */
const MarksSchema = z
  .array(
    z.strictObject({
      focus: RectSchema.describe('Region in image pixels the camera moves to.'),
      label: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('A short gloss shown under the frame while the camera is on this mark.'),
      sync: PhaseNameSchema.optional().describe(
        "The phase that brings this mark on: a key of the scene's `sync` (or `hero` on the hero scene). Default: mark<N>, counting the marks of the visual.",
      ),
    }),
  )
  .min(1)
  .max(3);

/** The sound cues a scene can place itself. */
export const CUE_KINDS = [
  'click',
  'reveal',
  'finding',
  'transition',
  'riser',
  'hero',
] as const satisfies readonly SceneCueKind[];

export const EXPRESSION_VALUES = [
  'neutral',
  'explaining',
  'thinking',
  'reviewing',
  'warning',
  'success',
] as const;

/** How a scene can enter (the transition into it). */
export const TRANSITION_KINDS = [
  'fade',
  'cut',
  'push',
  'wipe',
  'zoom-through',
] as const satisfies readonly TransitionKind[];

export const VisualSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('title'),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    eyebrow: z.string().optional(),
    meta: z.array(z.string()).default([]),
    background: ImageRefSchema.optional().describe(
      'A captured image (run-relative path) to set the title over, so the first frame already shows the subject.',
    ),
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
      .array(
        z.union([
          z.number().int().min(0),
          z.strictObject({
            lines: z.union([
              z.number().int().min(0),
              z.array(z.number().int().min(0)).min(1).max(8),
            ]),
            sync: PhaseNameSchema.optional().describe(
              "The phase that lights these lines together: a key of the scene's `sync` (or `hero`). Default: highlight<N>.",
            ),
          }),
        ]),
      )
      .max(40)
      .default([])
      .describe('Indexes into lines to emphasize, or groups of them that light together.'),
    caption: z.string().max(160).optional().describe('A short line shown under the code.'),
    mode: z
      .enum(['diff', 'morph'])
      .optional()
      .describe(
        'diff (default): the lines as a diff. morph: the old code first; at the `morph` phase the deleted lines are struck to ghosts and the added lines type in where they were.',
      ),
  }),
  z.strictObject({
    kind: z.literal('screenshot'),
    image: ImageRefSchema,
    focus: RectSchema.optional().describe('Region in image pixels to zoom toward.'),
    click: PointSchema.optional(),
    label: z.string().optional(),
    device: z.enum(['desktop', 'mobile']).default('desktop'),
    marks: MarksSchema.optional().describe(
      'Up to three regions the camera visits in turn, each with an optional gloss. `focus` is the one-mark shorthand; never set both.',
    ),
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
          marks: MarksSchema.optional(),
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
      .array(
        z.strictObject({ from: z.string(), to: z.string(), label: z.string().max(40).optional() }),
      )
      .max(16)
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
  narration: z
    .string()
    .max(600)
    .describe(
      'What Covi says. Also used for captions. Mark the key phrase with [[…]] (at most one per line): the caption sweeps it as it is spoken; the voice and reports never see the brackets.',
    ),
  say: z
    .string()
    .max(600)
    .optional()
    .describe(
      'Spoken form when it differs from the caption text: identifiers, paths, and names a voice would misread. Covi still spells out acronyms and applies video.narration.pronunciations to it before synthesis.',
    ),
  visual: VisualSchema,
  evidenceIds: EvidenceIdsSchema.optional().describe(
    "Ids from the run's evidence.json (`covi evidence --run <id>`) this scene rests on. A scene that shows a capture, code from the diff, a request, a command, or findings cites them without listing them.",
  ),
  expression: z.enum(EXPRESSION_VALUES).optional(),
  minSeconds: z.number().min(1).max(30).optional(),
  optional: z.boolean().optional().describe('May be dropped to fit the target duration.'),
  sync: z
    .record(PhaseNameSchema, z.string().min(1).max(200))
    .optional()
    .describe(
      'Pins a moment of the visual to when a phrase of `narration` is spoken: phase name → a phrase that appears exactly once in the narration. Screenshot: zoom, click, mark1…. Interaction: step2…stepN, zoom or click for the step showing then, and mark1… counting the marks of all steps. Code: highlight, highlight1… for each `highlight` entry, and morph. Before-after: reveal. Findings: finding1…. Terminal: output. API: after. The hero scene: hero. A highlight group or a mark can name its own phase with `sync`.',
    ),
  transition: z
    .enum(TRANSITION_KINDS)
    .optional()
    .describe(
      'How the scene enters: fade (default), cut, push (slides left), wipe (reveals left to right), or zoom-through (the default for the hero). The first scene has none.',
    ),
  hero: z
    .boolean()
    .optional()
    .describe(
      'The one scene where the change clicks: it holds 0.4 s after its line, enters with zoom-through, plays the hero accent, and carries the music lift.',
    ),
  camera: z
    .enum(['drift', 'static'])
    .optional()
    .describe(
      'drift (default): captures drift slowly, and a visual that has finished pushes in while its line continues. static: the picture holds still.',
    ),
  cues: z
    .array(
      z.strictObject({
        at: z.union([PhaseNameSchema, z.number().min(0).max(30)]),
        kind: z.enum(CUE_KINDS),
      }),
    )
    .max(4)
    .optional()
    .describe(
      "Sound effects of the scene's own: at a phase it pins (a `sync` key, or `hero`) or seconds into the scene. A riser ends at `at`; riser and hero belong to the hero scene. Covi already sounds clicks, reveals, findings, the verdict, whooshes, and the hero.",
    ),
});

export type Scene = z.output<typeof SceneSchema>;

export const StoryboardSchema = z
  .strictObject({
    schemaVersion: z.literal(1).default(1),
    /** The language of the narration and on-screen text. Absent: detected from the narration. */
    language: LanguageSchema.optional().describe(
      'Language of the narration and on-screen text: en, ko, ja, or zh (Simplified Chinese). Omit it to let Covi detect the language from the narration.',
    ),
    title: z.string().min(1),
    template: z.string().min(1),
    /** True for Covi's heuristic draft; an agent or model sets false after rewriting it. */
    draft: z.boolean().default(false),
    scenes: z.array(SceneSchema).min(2).max(24),
  })
  .superRefine((storyboard, ctx) => {
    for (const issue of storyboardIssues(storyboard))
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

export type Storyboard = z.output<typeof StoryboardSchema>;
export type StoryboardInput = z.input<typeof StoryboardSchema>;
