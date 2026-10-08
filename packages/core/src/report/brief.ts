import { listOf, t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import type { CodeChange } from '../model/change.ts';
import type { ReviewContext } from '../model/context.ts';
import type { Finding } from '../model/finding.ts';
import type { Redactor } from '../security/redact.ts';
import { renderDiffDigest } from './digest.ts';
import { locationText } from './markdown.ts';

export interface BriefOptions {
  runDir: string;
  runId: string;
  redactor: Redactor;
  maxDiffChars: number;
  /** Agents get next-step instructions; models get only the material. */
  audience?: 'agent' | 'model';
  /** The language agents should write in; the brief itself is written in it too. */
  language?: Language;
}

/**
 * The agent-facing brief: what Covi determined deterministically, what deserves attention, and the
 * prioritized diff. A coding agent reads this before applying the review/explain skills.
 */
export function renderBrief(
  change: CodeChange,
  context: ReviewContext,
  ruleFindings: readonly Finding[],
  options: BriefOptions,
): string {
  const { intent, demonstration, size } = context;
  const language = options.language ?? 'en';
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `brief.${key}`, params);
  const out: string[] = [];
  out.push(`# ${say('title', { summary: intent.summary })}`, '');
  out.push(
    say('header', {
      runId: `\`${options.runId}\``,
      repository: change.repository.name,
      base: change.base.ref,
      baseSha: `\`${change.base.sha.slice(0, 7)}\``,
      head: change.head.ref,
      headSha: `\`${change.head.sha.slice(0, 7)}\``,
      files: t(language, 'count.files', { count: change.stats.files }),
      additions: change.stats.additions,
      deletions: change.stats.deletions,
      size: size.class,
    }),
    '',
  );
  if (language !== 'en' && options.audience !== 'model')
    out.push(
      say('language', { language: t(language, `languageName.${language}`), code: language }),
      '',
    );
  if (change.metadata.title || change.metadata.description) {
    out.push(`## ${say('authorDescription')}`, '');
    if (change.metadata.title)
      out.push(`**${options.redactor.redact(change.metadata.title)}**`, '');
    if (change.metadata.description)
      out.push(options.redactor.redact(change.metadata.description.slice(0, 4000)), '');
    out.push(say('claim'), '');
  }
  if (change.commits.length) {
    out.push(`## ${say('commits')}`, '');
    for (const c of change.commits.slice(0, 15))
      out.push(`- \`${c.sha.slice(0, 7)}\` ${options.redactor.redact(c.subject)}`);
    if (change.commits.length > 15)
      out.push(`- ${say('moreCommits', { count: change.commits.length - 15 })}`);
    out.push('');
  }

  out.push(`## ${say('determined')}`, '');
  out.push(
    `- ${say('intent', {
      kind: intent.kind,
      confidence: t(language, `confidence.${intent.confidence}`),
      evidence: intent.evidence.slice(0, 3).join('; ') || say('noEvidence'),
    })}`,
  );
  if (intent.ambiguity) out.push(`- ${say('ambiguity', { text: intent.ambiguity })}`);
  out.push(
    `- ${say('areas', {
      areas: context.areas
        .map((a) => `${a.name} (${a.surfaces.join(', ') || say('internal')})`)
        .join('; '),
    })}`,
  );
  const surfaceList = Object.entries(context.surfaces).map(
    ([s, files]) => `${s} (${files?.length})`,
  );
  if (surfaceList.length) out.push(`- ${say('surfaces', { surfaces: surfaceList.join(', ') })}`);
  out.push(
    `- ${say('demonstration', {
      value: demonstration.value,
      kinds: demonstration.kinds.length ? ` (${demonstration.kinds.join(', ')})` : '',
      recommendation: demonstration.recommendation,
      reason: demonstration.reasons[0] ?? '',
    })}`,
  );
  out.push(
    `- ${say('runnable', {
      answer: demonstration.runnable.available
        ? say('runnableYes', { mode: demonstration.runnable.mode ?? say('commands') })
        : say('runnableNo'),
      suggestions: demonstration.runnable.suggestions.length
        ? say('suggestedConfig', { config: demonstration.runnable.suggestions.join('; ') })
        : '',
    })}`,
  );
  const tests = context.tests;
  out.push(
    `- ${say('tests', {
      tests: tests.changedTestFiles.length
        ? say('testChanges', {
            files: t(language, 'count.testFiles', { count: tests.changedTestFiles.length }),
            cases: tests.addedTestCases,
          })
        : say('noTestChanges'),
      frameworks: tests.frameworks.length
        ? say('frameworks', { frameworks: tests.frameworks.join(', ') })
        : '',
    })}`,
  );
  if (context.dependencies.length)
    out.push(
      `- ${say('dependencies', {
        list: listOf(
          language,
          context.dependencies
            .slice(0, 6)
            .map((d) => `${d.name} ${d.change}${d.to ? ` ${d.to}` : ''}`),
        ),
      })}`,
    );
  if (context.envVars.length)
    out.push(
      `- ${say('envVars', {
        list: listOf(
          language,
          context.envVars.map((e) => `${e.name} (${e.change})`),
        ),
      })}`,
    );
  if (context.data.length)
    out.push(
      `- ${say('data', {
        list: context.data
          .slice(0, 5)
          .map((d) => d.statement)
          .join('; '),
      })}`,
    );
  out.push('');

  if (context.signals.length || ruleFindings.length) {
    out.push(`## ${say('signals')}`, '');
    for (const f of ruleFindings) {
      out.push(
        `- **[${f.id}]** ${t(language, `certainty.${f.certainty}`)} · ${t(language, `severity.${f.severity}`)}: ${f.title}${locationText(f) ? ` (\`${locationText(f)}\`)` : ''}`,
      );
    }
    for (const s of context.signals)
      out.push(`- ${s.message}${s.path ? ` (\`${s.path}${s.line ? `:${s.line}` : ''}\`)` : ''}`);
    out.push('', say('ruleNote'), '');
  }

  if (context.readingOrder.length) {
    out.push(`## ${say('readingOrder')}`, '');
    for (const [i, s] of context.readingOrder.entries())
      out.push(`${i + 1}. \`${s.path}\`: ${s.reason}`);
    out.push('');
  }

  const digest = renderDiffDigest(change, context, {
    maxChars: options.maxDiffChars,
    redactor: options.redactor,
  });
  out.push(`## ${say('diff')}`, '');
  out.push(digest.text);
  if (digest.omitted.length) {
    out.push(say('notInlined'), '');
    for (const o of digest.omitted) out.push(`- \`${o.path}\`: ${o.reason}`);
    out.push('');
  }

  if (options.audience === 'model') return out.join('\n');
  out.push(`## ${say('nextSteps')}`, '');
  out.push(say('artifacts', { dir: `\`${options.runDir}\`` }));
  out.push('');
  out.push(say('step1'));
  out.push(say('step2'));
  out.push(say('cite', { runId: options.runId }));
  out.push(say('step3', { runId: options.runId }));
  out.push('');
  return out.join('\n');
}
