import type { CoviConfig } from '../config/schema.ts';
import type { Git } from '../git/git.ts';
import { RevisionReader } from '../git/reader.ts';
import { type CodeChange, reviewableFiles } from '../model/change.ts';
import type { ReviewContext } from '../model/context.ts';
import {
  CERTAINTY_LABEL,
  compareFindings,
  deriveVerdict,
  type Finding,
  type FindingsFile,
  type GeneratedBy,
  isBlockingCandidate,
  normalizeFinding,
  type Review,
  type TestRunResult,
} from '../model/finding.ts';
import { type Logger, silentLogger } from '../util/log.ts';
import { plural } from '../util/text.ts';
import { RULES } from './rules/index.ts';
import type { Rule } from './rules/types.ts';

export interface RuleRunResult {
  findings: Finding[];
  checked: string[];
  errors: Array<{ rule: string; message: string }>;
}

export async function runRules(
  change: CodeChange,
  context: ReviewContext,
  options: { git: Git; config: CoviConfig; logger?: Logger; rules?: readonly Rule[] },
): Promise<RuleRunResult> {
  const logger = options.logger ?? silentLogger;
  const disabled = new Set(options.config.review.disableRules);
  const rules = (options.rules ?? RULES).filter((r) => !disabled.has(r.id));
  const ctx = {
    change,
    context,
    config: options.config,
    reader: new RevisionReader(options.git, change),
    files: reviewableFiles(change),
  };
  const findings: Finding[] = [];
  const errors: RuleRunResult['errors'] = [];
  for (const rule of rules) {
    try {
      for (const input of await rule.run(ctx))
        findings.push(normalizeFinding(input, { kind: 'rule', id: rule.id }));
    } catch (error) {
      const message = (error as Error).message;
      logger.debug(`Rule ${rule.id} failed: ${message}`);
      errors.push({ rule: rule.id, message });
    }
  }
  const unique = [...new Map(findings.map((f) => [f.id, f])).values()].sort(compareFindings);
  return { findings: unique, checked: rules.map((r) => r.checks), errors };
}

export interface BuildReviewInput {
  ruleFindings: readonly Finding[];
  /** Findings authored by a model or a coding agent (findings.json). */
  authored?: FindingsFile;
  authoredSource?: 'model' | 'agent';
  checked: readonly string[];
  config: CoviConfig;
  context: ReviewContext;
  tests?: TestRunResult;
  /** Why tests did not run when Covi declined to run them (replaces the default note). */
  testsNote?: string;
  demonstrated?: boolean;
  generatedBy: GeneratedBy;
}

export interface BuiltReview {
  review: Review;
  /** Lower-priority findings beyond review.maxFindings (listed under `omitted` in review.json). */
  omitted: Finding[];
}

function near(a: Finding, b: Finding): boolean {
  if (!a.location || !b.location || a.location.path !== b.location.path) return false;
  if (a.location.line === undefined || b.location.line === undefined)
    return a.category === b.category;
  return Math.abs(a.location.line - b.location.line) <= 3 && a.category === b.category;
}

/** Merges rule findings with authored findings, applies dismissals, caps, and derives the verdict. */
export function buildReview(input: BuildReviewInput): BuiltReview {
  const dismissed = input.authored?.dismissed ?? [];
  const dismissedIds = new Set(dismissed.map((d) => d.id));
  const authored = (input.authored?.findings ?? []).map((f) =>
    normalizeFinding(f, { kind: input.authoredSource ?? 'agent' }),
  );
  const rules = input.ruleFindings.filter(
    (f) => !dismissedIds.has(f.id) && !authored.some((a) => near(a, f)),
  );
  const focus = new Set(input.config.review.focus);
  // Blocking candidates first; within each group, categories the repository asked to focus on.
  const rank = (f: Finding) => (isBlockingCandidate(f) ? 0 : 2) + (focus.has(f.category) ? 0 : 1);
  const all = [...authored, ...rules].sort((a, b) => rank(a) - rank(b) || compareFindings(a, b));
  const max = input.config.review.maxFindings;
  const findings = all.slice(0, max);
  const omitted = all.slice(max);

  const notVerified = [...(input.authored?.notVerified ?? [])];
  if (!input.tests) {
    notVerified.push(
      input.testsNote ??
        (input.config.test.command
          ? 'Tests were not run (enable review.runTests or pass --run-tests).'
          : 'Tests were not run (no test.command is configured).'),
    );
  } else if (!input.tests.passed) {
    notVerified.push(
      `The test command ${input.tests.timedOut ? 'timed out' : `failed (exit ${input.tests.exitCode})`}.`,
    );
  }
  const demo = input.context.demonstration;
  if (!input.demonstrated && demo.value !== 'none' && demo.value !== 'low') {
    notVerified.push(
      'User-visible behavior was not demonstrated; it was reviewed from the code only.',
    );
  }
  if (input.generatedBy.provider === 'heuristic' && authored.length === 0) {
    notVerified.push(
      'Logic was checked by Covi’s built-in rules only. Run Covi from a coding agent or configure a model provider for a reasoning review.',
    );
  }

  const checked = [...new Set([...(input.authored?.checked ?? []), ...input.checked])];
  const verdict = deriveVerdict(findings);
  const summary =
    input.authored?.summary ?? summarizeFindings(findings, omitted.length, input.tests);

  return {
    review: {
      schemaVersion: 1,
      verdict,
      summary,
      findings,
      dismissed,
      checked,
      notVerified,
      tests: input.tests,
      generatedBy: input.generatedBy,
    },
    omitted,
  };
}

export function summarizeFindings(
  findings: readonly Finding[],
  omitted: number,
  tests?: TestRunResult,
): string {
  const testNote = tests ? (tests.passed ? ' Tests pass.' : ' Tests did not pass.') : '';
  if (findings.length === 0) return `No issues found in the areas Covi checked.${testNote}`;
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.certainty, (counts.get(f.certainty) ?? 0) + 1);
  const parts = (['confirmed', 'likely', 'risk', 'question'] as const)
    .filter((c) => counts.get(c))
    .map((c) => plural(counts.get(c)!, CERTAINTY_LABEL[c].toLowerCase(), pluralLabel(c)));
  const extra = omitted
    ? ` (${omitted} lower-priority ${omitted === 1 ? 'note' : 'notes'} under "omitted" in review.json)`
    : '';
  return `${capitalize(parts.join(', '))}${extra}.${testNote}`;
}

function pluralLabel(c: string): string {
  return (
    {
      confirmed: 'confirmed issues',
      likely: 'likely issues',
      risk: 'risks worth checking',
      question: 'questions',
    }[c] ?? `${c}s`
  );
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
