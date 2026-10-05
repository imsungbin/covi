import { listOf, t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import type { ReviewContext } from '../model/context.ts';
import type { Explanation } from '../model/explanation.ts';
import type { Finding, Review } from '../model/finding.ts';
import { escapeMarkdownKeepCode, fence } from '../util/text.ts';

/**
 * Text in these reports comes from the change (titles, paths, branch names, code) or from a model
 * that read it, and review.md also becomes the CI job summary. Escape it so it renders as text:
 * no links, images, HTML, or headings it did not ask for. Inline `code` stays code.
 */
const md = (text: string) => escapeMarkdownKeepCode(text);

/** A code span for a path or command that cannot be closed or broken by its content. */
const code = (text: string) => `\`${text.replace(/`/g, "'").replace(/\r?\n/g, ' ')}\``;

function footer(context: ReviewContext | undefined, provider: string, language: Language): string {
  if (!context) return `<sub>${t(language, 'report.footer', { provider: md(provider) })}.</sub>`;
  const { base, head } = context.change;
  return `<sub>${t(language, 'report.footerChange', {
    provider: md(provider),
    base: md(base.ref),
    baseSha: code(base.sha.slice(0, 7)),
    head: md(head.ref),
    headSha: code(head.sha.slice(0, 7)),
  })}</sub>`;
}

/** The language a report is written in: what the authored file declares, else the run's. */
export function reportLanguage(
  fallback: Language,
  ...declared: Array<{ language?: Language } | undefined>
): Language {
  return declared.find((d) => d?.language)?.language ?? fallback;
}

export function renderExplanation(
  e: Explanation,
  context?: ReviewContext,
  language: Language = e.language ?? 'en',
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `report.explanation.${key}`, params);
  const out: string[] = [`# ${md(e.headline)}`, '', md(e.summary), ''];
  const evidence = e.intent.evidence.length
    ? say('evidence', {
        evidence:
          language === 'en'
            ? e.intent.evidence.map(md).join('; ')
            : listOf(language, e.intent.evidence.map(md)),
      })
    : '';
  out.push(
    `${say('why')} ${md(e.intent.statement)} ${say('confidence', {
      confidence: t(language, `confidence.${e.intent.confidence}`),
      evidence,
    })}`,
    '',
  );
  if (e.behavior && (e.behavior.before || e.behavior.after || e.behavior.notes)) {
    out.push(`## ${say('behavior')}`, '');
    out.push(`- ${say('userVisible', { answer: say(e.behavior.userVisible ? 'yes' : 'no') })}`);
    if (e.behavior.before) out.push(`- ${say('before')} ${md(e.behavior.before)}`);
    if (e.behavior.after) out.push(`- ${say('after')} ${md(e.behavior.after)}`);
    if (e.behavior.notes) out.push(`- ${md(e.behavior.notes)}`);
    out.push('');
  }
  if (e.changes.length) {
    out.push(`## ${say('changes')}`, '');
    for (const c of e.changes) out.push(`- **${md(c.area)}**: ${md(c.description)}`);
    out.push('');
  }
  if (e.architecture.length) {
    out.push(`## ${say('architecture')}`, '');
    for (const a of e.architecture) out.push(`- ${md(a)}`);
    out.push('');
  }
  if (e.details.length) {
    out.push(`## ${say('details')}`, '');
    for (const d of e.details) out.push(`- ${md(d)}`);
    out.push('');
  }
  if (e.reviewerNotes.length) {
    out.push(`## ${say('reviewerNotes')}`, '');
    for (const n of e.reviewerNotes) out.push(`- ${md(n)}`);
    out.push('');
  }
  if (e.readingOrder.length) {
    out.push(`## ${say('readingOrder')}`, '');
    for (const [i, step] of e.readingOrder.entries())
      out.push(`${i + 1}. ${code(step.path)}: ${md(step.reason)}`);
    out.push('');
  }
  if (e.ambiguities.length) {
    out.push(`## ${say('ambiguities')}`, '');
    for (const a of e.ambiguities) out.push(`- ${md(a)}`);
    out.push('');
  }
  out.push('---', footer(context, e.generatedBy?.provider ?? 'agent', language), '');
  return out.join('\n');
}

export function locationText(f: Pick<Finding, 'location'>): string {
  if (!f.location) return '';
  return f.location.line ? `${f.location.path}:${f.location.line}` : f.location.path;
}

export function renderReview(
  review: Review,
  explanation?: Explanation,
  context?: ReviewContext,
  language: Language = review.language ?? explanation?.language ?? 'en',
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `report.review.${key}`, params);
  const title = explanation?.headline ?? (context ? context.intent.summary : say('untitled'));
  const out: string[] = [
    `# ${say('title', { title: md(title) })}`,
    '',
    `**${t(language, `verdict.${review.verdict}`)}**: ${md(review.summary)}`,
    '',
  ];
  if (review.findings.length) {
    out.push(`## ${say('findings')}`, '');
    review.findings.forEach((f, i) => {
      out.push(`### ${i + 1}. ${md(f.title)}`, '');
      const where = locationText(f);
      out.push(
        `**${t(language, `certainty.${f.certainty}`)}** · ${t(language, `severity.${f.severity}`)} · ${t(language, `category.${f.category}`)}${where ? ` · ${code(where)}` : ''}`,
        '',
      );
      out.push(md(f.explanation), '');
      out.push(say('evidence'), '', fence(f.evidence), '');
      if (f.suggestion) out.push(`${say('suggestion')} ${md(f.suggestion)}`, '');
    });
  }
  if (review.tests) {
    const tests = review.tests;
    out.push(`## ${say('tests')}`, '');
    out.push(
      say('testsResult', {
        command: code(tests.command),
        result: tests.passed
          ? say('testsPassed')
          : tests.timedOut
            ? say('testsTimedOut')
            : say('testsFailed', { code: String(tests.exitCode) }),
        seconds: (tests.durationMs / 1000).toFixed(1),
      }),
      '',
    );
    if (!tests.passed && tests.outputTail)
      out.push(fence(tests.outputTail.split('\n').slice(-30).join('\n')), '');
  }
  if (review.checked.length) {
    out.push(
      `## ${say('checked')}`,
      '',
      `<details><summary>${t(language, 'count.checks', { count: review.checked.length })}</summary>`,
      '',
    );
    for (const c of review.checked) out.push(`- ${md(c)}`);
    out.push('', '</details>', '');
  }
  if (review.notVerified.length) {
    out.push(`## ${say('notVerified')}`, '');
    for (const n of review.notVerified) out.push(`- ${md(n)}`);
    out.push('');
  }
  if (review.dismissed.length) {
    out.push(`## ${say('dismissed')}`, '');
    for (const d of review.dismissed) out.push(`- ${code(d.id)}: ${md(d.reason)}`);
    out.push('');
  }
  out.push('---', footer(context, review.generatedBy.provider, language), '');
  return out.join('\n');
}

export type SummaryFormat = 'markdown' | 'text';

/** A compact summary for pull/merge request descriptions, changelogs, or chat. */
export function renderSummary(
  e: Explanation,
  review: Review | undefined,
  context: ReviewContext,
  format: SummaryFormat = 'markdown',
  language: Language = e.language ?? 'en',
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `report.summary.${key}`, params);
  const lower = (s: string) => (language === 'en' ? s.toLowerCase() : s);
  if (format === 'text') {
    const verdict = review
      ? say('textVerdict', {
          verdict: lower(t(language, `verdict.${review.verdict}`)),
          findings: review.findings.length
            ? say('textFindings', {
                findings: t(language, 'count.findings', { count: review.findings.length }),
              })
            : '',
        })
      : '';
    const headline = language === 'ja' || language === 'zh' ? `${e.headline}。` : `${e.headline}.`;
    return `${headline} ${e.summary}${verdict}\n`;
  }
  const out = [`## ${md(e.headline)}`, '', md(e.summary), ''];
  if (e.changes.length) {
    out.push(say('changes'), '');
    for (const c of e.changes.slice(0, 6)) out.push(`- **${md(c.area)}**: ${md(c.description)}`);
    out.push('');
  }
  const focus: string[] = [];
  if (review)
    for (const f of review.findings.slice(0, 3))
      focus.push(`${md(f.title)} (${lower(t(language, `certainty.${f.certainty}`))})`);
  if (focus.length === 0)
    for (const step of e.readingOrder.slice(0, 2))
      focus.push(`${code(step.path)}: ${md(step.reason)}`);
  if (focus.length) {
    out.push(say('focus'), '');
    for (const f of focus) out.push(`- ${f}`);
    out.push('');
  }
  const tests = context.tests;
  out.push(say('testing'), '');
  if (review?.tests)
    out.push(
      `- ${say(review.tests.passed ? 'commandPasses' : 'commandFails', { command: code(review.tests.command) })}`,
    );
  if (tests.addedTestCases || tests.changedTestFiles.length)
    out.push(
      `- ${say('testsAdded', {
        cases: t(language, 'count.testCases', { count: tests.addedTestCases }),
        files: t(language, 'count.testFiles', { count: tests.changedTestFiles.length }),
      })}`,
    );
  else out.push(`- ${say('noTestChanges')}`);
  out.push('');
  return out.join('\n');
}
