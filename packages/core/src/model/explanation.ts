import { z } from 'zod';

export const DEPTHS = ['brief', 'standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

/** Shape of `explanation.json`, authored by Covi's heuristics, a model, or a coding agent. */
export const ExplanationSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  depth: z.enum(DEPTHS),
  headline: z.string().min(3).max(200).describe('One sentence a reviewer can read in two seconds.'),
  summary: z
    .string()
    .min(1)
    .describe('A short paragraph at the right abstraction level, not a diff paraphrase.'),
  intent: z.strictObject({
    statement: z.string().min(1).describe('Why the change appears to exist.'),
    confidence: z.enum(['high', 'medium', 'low']),
    evidence: z.array(z.string()).default([]),
  }),
  behavior: z
    .strictObject({
      userVisible: z.boolean(),
      before: z.string().optional(),
      after: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  changes: z
    .array(
      z.strictObject({
        area: z.string().min(1),
        description: z.string().min(1),
        files: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  architecture: z.array(z.string()).default([]),
  details: z.array(z.string()).default([]),
  reviewerNotes: z
    .array(z.string())
    .default([])
    .describe('What a reviewer should know before reading the diff.'),
  readingOrder: z.array(z.strictObject({ path: z.string(), reason: z.string() })).default([]),
  ambiguities: z.array(z.string()).default([]),
  /** Who wrote it: set by Covi when it renders reports (agents may omit it). */
  generatedBy: z.strictObject({ provider: z.string(), model: z.string().optional() }).optional(),
});

export type ExplanationInput = z.input<typeof ExplanationSchema>;
export type Explanation = z.output<typeof ExplanationSchema>;
