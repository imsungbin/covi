import type { CoviConfig } from '../config/schema.ts';
import type { Git } from '../git/git.ts';
import { RevisionReader } from '../git/reader.ts';
import { hasMessage, t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import { type CodeChange, reviewableFiles } from '../model/change.ts';
import type { ReviewContext } from '../model/context.ts';
import {
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
import { RULES } from './rules/index.ts';
import type { Rule, RuleContext } from './rules/types.ts';

export interface RuleRunResult {
  findings: Finding[];
  checked: string[];
  errors: Array<{ rule: string; message: string }>;
}

export async function runRules(
  change: CodeChange,
  context: ReviewContext,
  options: {
    git: Git;
    config: CoviConfig;
    logger?: Logger;
    rules?: readonly Rule[];
    /** The language findings are written in. Default: English. */
    language?: Language;
  },
): Promise<RuleRunResult> {
  const language = options.language ?? 'en';
  const logger = options.logger ?? silentLogger;
  const disabled = new Set(options.config.review.disableRules);
  const rules = (options.rules ?? RULES).filter((r) => !disabled.has(r.id));
  const ctx = {
    change,
    context,
    config: options.config,
    reader: new RevisionReader(options.git, change),
    files: reviewableFiles(change),
    language,
  };
  const findings: Finding[] = [];
  const errors: RuleRunResult['errors'] = [];
  for (const rule of rules) {
    try {
      const source = { kind: 'rule', id: rule.id } as const;
      const inputs = await rule.run(ctx);
      const ids = language === 'en' ? [] : await englishIds(rule, ctx, inputs.length);
      for (const [i, input] of inputs.entries())
        findings.push(normalizeFinding(ids[i] ? { ...input, id: ids[i] } : input, source));
    } catch (error) {
      const message = (error as Error).message;
      logger.debug(`Rule ${rule.id} failed: ${message}`);
      errors.push({ rule: rule.id, message });
    }
  }
  const unique = [...new Map(findings.map((f) => [f.id, f])).values()].sort(compareFindings);
  // What each rule checks, in the run's language (a rule outside the catalog keeps its own words).
  const checked = rules.map((r) =>
    hasMessage(language, `rule.${r.id}.checks`) ? t(language, `rule.${r.id}.checks`) : r.checks,
  );
  return { findings: unique, checked, errors };
}

/**
 * The ids a rule's findings have in English. An id hashes the finding's title, and SARIF and GitLab
 * track findings across runs by id, so a finding must keep its id whatever language the run writes
 * in. Rules are pure, so running one again in English yields the same findings in the same order
 * (the reader caches what it reads); if not, the findings keep the ids of their own titles.
 */
async function englishIds(rule: Rule, ctx: RuleContext, count: number): Promise<string[]> {
  const english = await Promise.resolve()
    .then(() => rule.run({ ...ctx, language: 'en' }))
    .catch(() => []);
  if (english.length !== count) return [];
  return english.map((f) => normalizeFinding(f, { kind: 'rule', id: rule.id }).id);
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
  /** The language of the review's own text. Default: English. */
  language?: Language;
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

  const language = input.language ?? 'en';
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `review.${key}`, params);
  const notVerified = [...(input.authored?.notVerified ?? [])];
  if (!input.tests) {
    notVerified.push(
      input.testsNote ??
        (input.config.test.command ? say('testsNotRunEnable') : say('testsNotConfigured')),
    );
  } else if (!input.tests.passed) {
    notVerified.push(
      input.tests.timedOut
        ? say('testsTimedOut')
        : say('testsFailed', { code: String(input.tests.exitCode) }),
    );
  }
  const demo = input.context.demonstration;
  if (!input.demonstrated && demo.value !== 'none' && demo.value !== 'low') {
    notVerified.push(say('notDemonstrated'));
  }
  if (input.generatedBy.provider === 'heuristic' && authored.length === 0) {
    notVerified.push(say('rulesOnly'));
  }

  const checked = [...new Set([...(input.authored?.checked ?? []), ...input.checked])];
  const verdict = deriveVerdict(findings);
  const summary =
    input.authored?.summary ?? summarizeFindings(findings, omitted.length, input.tests, language);

  return {
    review: {
      schemaVersion: 1,
      ...(language === 'en' ? {} : { language }),
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
  language: Language = 'en',
): string {
  const testNote = tests ? t(language, tests.passed ? 'review.testsPass' : 'review.testsFail') : '';
  if (findings.length === 0) return t(language, 'review.noIssues', { tests: testNote });
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.certainty, (counts.get(f.certainty) ?? 0) + 1);
  const parts = (['confirmed', 'likely', 'risk', 'question'] as const)
    .filter((c) => counts.get(c))
    .map((c) => t(language, `certaintyCount.${c}`, { count: counts.get(c)! }));
  const extra = omitted ? t(language, 'review.omitted', { count: omitted }) : '';
  const stop = language === 'ja' || language === 'zh' ? '。' : '.';
  const separator = language === 'ja' || language === 'zh' ? '、' : ', ';
  return `${capitalize(parts.join(separator))}${extra}${stop}${testNote}`;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
