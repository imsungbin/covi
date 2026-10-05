import { z } from 'zod';
import type { Language } from '../i18n/language.ts';
import { LanguageSchema } from '../i18n/schema.ts';
import { shortHash } from '../util/hash.ts';

/**
 * Findings distinguish how sure Covi is (certainty) from how much it matters (severity).
 * Only confirmed and likely findings can fail a CI gate; risks and questions inform reviewers.
 */
export const CERTAINTIES = ['confirmed', 'likely', 'risk', 'question'] as const;
export const SEVERITIES = ['high', 'medium', 'low'] as const;
export const FINDING_CATEGORIES = [
  'correctness',
  'regression',
  'edge-case',
  'error-handling',
  'state',
  'concurrency',
  'security',
  'permissions',
  'api-compatibility',
  'data-integrity',
  'performance',
  'accessibility',
  'testing',
  'ui',
  'maintainability',
  'complexity',
  'intent-mismatch',
  'dependency',
  'configuration',
] as const;
export const FINDING_SOURCES = ['rule', 'model', 'agent', 'demo'] as const;

export type Certainty = (typeof CERTAINTIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  confirmed: 'Confirmed issue',
  likely: 'Likely issue',
  risk: 'Risk worth checking',
  question: 'Question',
};

export const LocationSchema = z.strictObject({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export const FindingSchema = z.strictObject({
  id: z.string().min(1).optional(),
  title: z.string().min(3).max(200),
  certainty: z.enum(CERTAINTIES),
  severity: z.enum(SEVERITIES),
  category: z.enum(FINDING_CATEGORIES),
  location: LocationSchema.optional(),
  evidence: z
    .string()
    .min(1)
    .describe(
      'Concrete support: quoted code, observed behavior, or references. No evidence, no finding.',
    ),
  explanation: z.string().min(1).describe('Why it matters to the reviewer.'),
  suggestion: z.string().optional(),
  source: z.strictObject({ kind: z.enum(FINDING_SOURCES), id: z.string().optional() }).optional(),
});

export type FindingInput = z.input<typeof FindingSchema>;

export interface Finding {
  id: string;
  title: string;
  certainty: Certainty;
  severity: Severity;
  category: FindingCategory;
  location?: { path: string; line?: number; endLine?: number };
  evidence: string;
  explanation: string;
  suggestion?: string;
  source: { kind: (typeof FINDING_SOURCES)[number]; id?: string };
}

export const DismissalSchema = z.strictObject({
  id: z.string().min(1),
  reason: z.string().min(3),
});

/** Shape of an agent- or model-authored `findings.json`. */
export const FindingsFileSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  language: LanguageSchema.optional().describe(
    'The language the findings are written in: en, ko, ja, or zh (Simplified Chinese).',
  ),
  summary: z.string().optional(),
  findings: z.array(FindingSchema).default([]),
  /** Rule findings the author examined and rejected, with the reason. */
  dismissed: z.array(DismissalSchema).default([]),
  checked: z.array(z.string()).default([]),
  notVerified: z.array(z.string()).default([]),
});

export type FindingsFile = z.output<typeof FindingsFileSchema>;

export type Verdict = 'looks-good' | 'needs-attention' | 'needs-changes';

export const VERDICT_LABEL: Record<Verdict, string> = {
  'looks-good': 'Looks good',
  'needs-attention': 'Needs attention',
  'needs-changes': 'Needs changes',
};

export interface TestRunResult {
  command: string;
  exitCode: number | null;
  passed: boolean;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
}

export interface Review {
  schemaVersion: 1;
  /** The language of the review's own text (summary, notes, rule findings). */
  language?: Language;
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  dismissed: Array<{ id: string; reason: string }>;
  checked: string[];
  notVerified: string[];
  tests?: TestRunResult;
  generatedBy: GeneratedBy;
}

export interface GeneratedBy {
  provider: string;
  model?: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const CERTAINTY_RANK: Record<Certainty, number> = { confirmed: 4, likely: 3, risk: 2, question: 1 };

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

export function compareFindings(a: Finding, b: Finding): number {
  const blocking = Number(isBlockingCandidate(b)) - Number(isBlockingCandidate(a));
  if (blocking) return blocking;
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    CERTAINTY_RANK[b.certainty] - CERTAINTY_RANK[a.certainty] ||
    (a.location?.path ?? '').localeCompare(b.location?.path ?? '') ||
    (a.location?.line ?? 0) - (b.location?.line ?? 0)
  );
}

/** Confirmed or likely findings are the only ones that can block (fail a gate). */
export function isBlockingCandidate(finding: Pick<Finding, 'certainty'>): boolean {
  return finding.certainty === 'confirmed' || finding.certainty === 'likely';
}

/**
 * A finding's id: its source and a hash of its title and location. SARIF and GitLab Code Quality
 * track findings across runs by this id, so findings Covi words itself hash their English title
 * in every language.
 */
export function findingId(
  source: string,
  title: string,
  location?: { path?: string; line?: number },
): string {
  return `${source}-${shortHash(title, location?.path, location?.line)}`;
}

export function normalizeFinding(input: FindingInput, defaultSource: Finding['source']): Finding {
  const parsed = FindingSchema.parse(input);
  const source = parsed.source ?? defaultSource;
  const id = parsed.id ?? findingId(source.id ?? source.kind, parsed.title, parsed.location);
  return { ...parsed, id, source };
}

export function deriveVerdict(findings: readonly Finding[]): Verdict {
  if (findings.some((f) => isBlockingCandidate(f) && f.severity === 'high')) return 'needs-changes';
  if (findings.some((f) => isBlockingCandidate(f) || f.severity !== 'low'))
    return 'needs-attention';
  return 'looks-good';
}

export type FailThreshold = 'none' | Severity;

/** Findings that fail the configured CI gate. */
export function gateFailures(findings: readonly Finding[], failOn: FailThreshold): Finding[] {
  if (failOn === 'none') return [];
  const min = SEVERITY_RANK[failOn];
  return findings.filter((f) => isBlockingCandidate(f) && SEVERITY_RANK[f.severity] >= min);
}

/** Validates a review.json read back from disk (e.g. an artifact from an untrusted CI job). */
export const ReviewFileSchema = z.object({
  schemaVersion: z.literal(1),
  language: LanguageSchema.optional(),
  verdict: z.enum(['looks-good', 'needs-attention', 'needs-changes']),
  summary: z.string(),
  findings: z.array(
    FindingSchema.extend({
      id: z.string(),
      source: z.strictObject({ kind: z.enum(FINDING_SOURCES), id: z.string().optional() }),
    }),
  ),
  dismissed: z.array(DismissalSchema).default([]),
  checked: z.array(z.string()).default([]),
  notVerified: z.array(z.string()).default([]),
  tests: z
    .object({
      command: z.string(),
      exitCode: z.number().nullable(),
      passed: z.boolean(),
      timedOut: z.boolean(),
      durationMs: z.number(),
      outputTail: z.string(),
    })
    .optional(),
  generatedBy: z.object({ provider: z.string(), model: z.string().optional() }),
});
