import { z } from 'zod';
import { hasUnprintable } from '../util/text.ts';

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
  'metric',
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

/** Bounds on measured numbers (`metric` items), and on reading them from a run's text. */
export const METRIC_LIMITS = {
  /** Metrics one source (a command, a response, a step, the diff, the test run) gives. */
  perSource: 50,
  /** Metrics one run gives. */
  perRun: 500,
  /** A metric's name in its id: a slug. */
  nameChars: 40,
  /** What the output called it, as kept in the item's label. */
  labelChars: 60,
  /** Values stay below this in magnitude, with at most `decimals` digits after the point. */
  magnitude: 1e15,
  decimals: 6,
  /** How deep numeric leaves of JSON output are read. */
  jsonDepth: 4,
  /** Characters of one text read for metrics, and the longest line read. */
  textChars: 100_000,
  lineChars: 200,
} as const;

/** Digits after the point, as JavaScript writes the number (an exponent counts as too many). */
export function decimalsOf(value: number): number {
  const text = String(value);
  if (/e/i.test(text)) return Number.POSITIVE_INFINITY;
  return text.split('.')[1]?.length ?? 0;
}

/** A value a metric may hold: finite, below 1e15 in magnitude, at most six decimals. */
export function isMetricValue(value: number): boolean {
  return (
    Number.isFinite(value) &&
    Math.abs(value) < METRIC_LIMITS.magnitude &&
    decimalsOf(value) <= METRIC_LIMITS.decimals
  );
}

/** A metric's name in its id: lowercase letters, digits, and dashes. */
export const METRIC_NAME = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** A unit: up to 8 letters of any script, or `%`. */
export const METRIC_UNIT = /^(?:%|\p{L}{1,8})$/u;

const MetricValueSchema = z
  .number()
  .refine(isMetricValue, 'a finite number below 1e15 in magnitude, with at most 6 decimals');

/**
 * A number Covi measured in the run's own output: a command's, a response's, a step's pixels, the
 * diff's, or the test run's. Base and head pair by source and name. Values are never written by an
 * agent: a direction or a finding cites the item, and Covi draws what it holds.
 */
export const EvidenceMetricSchema = z
  .strictObject({
    name: z.string().regex(METRIC_NAME),
    unit: z.string().regex(METRIC_UNIT).optional(),
    base: MetricValueSchema.optional(),
    head: MetricValueSchema.optional(),
  })
  .refine(
    (m) => m.base !== undefined || m.head !== undefined,
    'a metric has a base or a head value',
  );

export const EvidenceItemSchema = z
  .strictObject({
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
    /** A `metric` item's values. */
    metric: EvidenceMetricSchema.optional(),
  })
  .refine(
    (item) => (item.kind === 'metric') === (item.metric !== undefined),
    'a metric item carries its values, and only a metric item does',
  )
  // A metric's label is shown with its values, in prompts, reports, and videos.
  .refine(
    (item) => item.kind !== 'metric' || !hasUnprintable(item.label),
    'a metric item has a printable label',
  );

/** `evidence.json`. */
export const EvidenceFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z.array(EvidenceItemSchema).max(EVIDENCE_LIMITS.items),
});

export type EvidenceItem = z.output<typeof EvidenceItemSchema>;
export type EvidenceFile = z.output<typeof EvidenceFileSchema>;
export type EvidenceMetric = z.output<typeof EvidenceMetricSchema>;
