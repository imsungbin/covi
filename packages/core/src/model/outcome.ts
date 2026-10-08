import { z } from 'zod';
import { RUN_ID_PATTERN } from '../run/paths.ts';
import { CERTAINTIES } from './finding.ts';

/** Where a change stood when its outcome was collected. */
export const OUTCOME_STATES = ['open', 'merged', 'closed'] as const;
/** What became of a finding by the last review of its change. */
export const FINDING_FATES = ['present', 'addressed', 'superseded'] as const;
export const OUTCOME_PLATFORMS = ['github', 'gitlab'] as const;

export type OutcomeState = (typeof OUTCOME_STATES)[number];
export type FindingFate = (typeof FINDING_FATES)[number];
export type OutcomePlatform = (typeof OUTCOME_PLATFORMS)[number];

/**
 * Bounds for data read back from a platform or from a comment that people with write access can
 * edit: nothing larger is decoded, kept, or read.
 */
export const OUTCOME_LIMITS = {
  /** Findings a ledger (and so an outcome file) tracks per change. */
  findings: 60,
  /** Characters of an encoded ledger Covi decodes (so at most 9,000 decoded bytes). */
  ledgerChars: 12_000,
  /** Outcome files read for a report or the calibration hint, newest first. */
  files: 200,
  /** Bytes of one outcome file. */
  fileBytes: 256 * 1024,
} as const;

const hex = (length: number) => z.string().regex(new RegExp(`^[0-9a-f]{${length}}$`));
const Head = hex(7);
const Count = z.number().int().min(0).max(1_000_000);
const RunId = z.string().max(80).regex(RUN_ID_PATTERN);
const Url = z
  .string()
  .max(2000)
  .regex(/^https?:\/\/\S+$/);
const Timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
/**
 * `owner/repo` on GitHub, `group/…/project` on GitLab. Reports and file lookups use it, and it
 * comes from the platform or a flag, so it may only be a path with no `.` or `..` segment.
 */
const Repository = z
  .string()
  .max(200)
  .regex(/^(?!\.\.?(?:\/|$))(?!.*\/\.\.?(?:\/|$))[\w.-]+(?:\/[\w.-]+)+$/);

/** One finding in a comment's ledger. Short keys: the ledger rides along in every comment. */
export const LedgerEntrySchema = z.strictObject({
  /** `outcomeKey`: the finding across pushes. */
  k: hex(12),
  /** Its latest certainty. */
  c: z.enum(CERTAINTIES),
  /** `areaKey`: where it sits, to tell a reworded finding from a fixed one. */
  a: hex(8),
  /** First and last head (7 hex) where it was reported. */
  f: Head,
  l: Head,
  /** Gone from the latest review: `a` addressed (after a push), `s` superseded (reworded). */
  x: z.enum(['a', 's']).optional(),
});

/** What Covi reported on one change, push by push, carried in its comment. */
export const LedgerSchema = z.strictObject({
  v: z.literal(1),
  /** The run that last updated the comment; the outcome file is named after it. */
  run: RunId,
  head: Head,
  findings: z.array(LedgerEntrySchema).max(OUTCOME_LIMITS.findings),
});

export type LedgerEntry = z.output<typeof LedgerEntrySchema>;
export type Ledger = z.output<typeof LedgerSchema>;

export const OutcomeFindingSchema = z.strictObject({
  key: hex(12),
  certainty: z.enum(CERTAINTIES),
  firstHead: Head,
  lastHead: Head,
  fate: z.enum(FINDING_FATES),
  thumbs: z
    .strictObject({ up: Count, down: Count })
    .optional()
    .describe("Reactions on the finding's inline anchor comment, when it has one."),
  replies: Count.optional().describe("Replies in the anchor's thread."),
});

/** `.covi/outcomes/<run-id>.json`: what became of one change Covi commented on. */
export const OutcomeFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: RunId.describe('The run whose review the comment showed last.'),
  collectedAt: Timestamp,
  head: Head.describe('The commit Covi reviewed last (7 characters).'),
  change: z.strictObject({
    platform: z.enum(OUTCOME_PLATFORMS),
    repository: Repository,
    number: z.number().int().positive(),
    url: Url.optional(),
    state: z.enum(OUTCOME_STATES),
    closedAt: Timestamp.optional(),
    revertedBy: z
      .strictObject({ sha: z.string().regex(/^[0-9a-f]{7,64}$/), url: Url.optional() })
      .optional(),
  }),
  comment: z.strictObject({
    id: z.string().regex(/^\d{1,20}$/),
    url: Url.optional(),
    rating: z.strictObject({ up: Count, down: Count }),
    replies: Count,
  }),
  findings: z.array(OutcomeFindingSchema).max(OUTCOME_LIMITS.findings),
});

export type OutcomeFinding = z.output<typeof OutcomeFindingSchema>;
export type OutcomeFile = z.output<typeof OutcomeFileSchema>;

/** What a platform adapter reports about one change; core turns it into an outcome file. */
export interface ChangeSignals {
  platform: OutcomePlatform;
  repository: string;
  number: number;
  url?: string;
  state: OutcomeState;
  closedAt?: string;
  revertedBy?: { sha: string; url?: string };
  /** Covi's summary comment, when the change has one. */
  comment?: { id: string; url?: string; body: string; up: number; down: number; replies: number };
  /** Inline anchor comments Covi posted, one per finding key. */
  anchors: Array<{ key: string; id: string; up: number; down: number; replies: number }>;
}
