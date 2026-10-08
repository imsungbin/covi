import { z } from 'zod';

/**
 * Evidence is what diffing or running the software produced, each piece with an id that is stable
 * within a run. Findings, explanation statements, and video scenes cite these ids, and Covi checks
 * every citation against the run's `evidence.json`.
 */
export const EVIDENCE_KINDS = [
  'diff-hunk',
  'screenshot',
  'recording',
  'trace',
  'terminal',
  'http',
  'pixel-diff',
  'test-run',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** `<kind>:<name>`, optionally narrowed to a part: `trace:<trace>#n2`, `pixel-diff:<scenario>#end.r1`. */
export const EVIDENCE_ID = new RegExp(`^(${EVIDENCE_KINDS.join('|')}):\\S`);

export const EVIDENCE_LIMITS = {
  items: 20_000,
  refs: 1_000,
  id: 400,
  label: 200,
  /** Ids one claim may cite. */
  cites: 20,
} as const;

/**
 * What a claim cites. Plain strings here: the registry, not a pattern, decides what is evidence,
 * so a model that writes prose in this list loses that citation, not its whole analysis.
 */
export const EvidenceIdsSchema = z
  .array(z.string().min(1).max(EVIDENCE_LIMITS.id))
  .max(EVIDENCE_LIMITS.cites)
  .describe(
    "Ids from the run's evidence.json that support this claim (`covi evidence --run <id>` lists them).",
  );

/**
 * A model's answer with every `evidenceIds` list cut to what `EvidenceIdsSchema` accepts: entries
 * that are not ids of an allowed length are dropped, and the rest kept up to the cap. Structured
 * outputs do not enforce lengths, and one over-long list should cost citations, not the analysis.
 */
export function withinCitationLimits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withinCitationLimits);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      key === 'evidenceIds' && Array.isArray(v)
        ? v
            .filter((id) => typeof id === 'string' && id && id.length <= EVIDENCE_LIMITS.id)
            .slice(0, EVIDENCE_LIMITS.cites)
        : withinCitationLimits(v),
    ]),
  );
}

const ItemIdSchema = z.string().max(EVIDENCE_LIMITS.id).regex(EVIDENCE_ID);

export const EvidenceItemSchema = z.strictObject({
  id: ItemIdSchema,
  kind: z.enum(EVIDENCE_KINDS),
  /** The run-relative file that holds it. */
  path: z.string().min(1).max(EVIDENCE_LIMITS.id),
  revision: z.enum(['base', 'head', 'both']),
  /** The file's sha256, or, for an item inside a shared file (a hunk, a request), its own text's. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Language-neutral: names, paths, viewports, and revisions; redacted when written. */
  label: z.string().max(EVIDENCE_LIMITS.label),
  /** Where a diff hunk sits: its head lines, or its base lines when it only deletes. */
  location: z
    .strictObject({
      path: z.string().min(1),
      line: z.number().int().positive(),
      endLine: z.number().int().positive(),
      side: z.enum(['base', 'head']),
    })
    .optional(),
  /** Citable parts, as full ids: a trace's steps, requests, and messages; a pixel diff's regions. */
  refs: z.array(ItemIdSchema).max(EVIDENCE_LIMITS.refs).optional(),
});

/** `evidence.json`. */
export const EvidenceFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z.array(EvidenceItemSchema).max(EVIDENCE_LIMITS.items),
});

export type EvidenceItem = z.output<typeof EvidenceItemSchema>;
export type EvidenceFile = z.output<typeof EvidenceFileSchema>;
