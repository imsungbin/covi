import type { CodeChange } from '../model/change.ts';
import type { ReviewContext } from '../model/context.ts';
import { CERTAINTY_LABEL, type Finding } from '../model/finding.ts';
import type { Redactor } from '../security/redact.ts';
import { joinList, plural } from '../util/text.ts';
import { renderDiffDigest } from './digest.ts';
import { locationText } from './markdown.ts';

export interface BriefOptions {
  runDir: string;
  runId: string;
  redactor: Redactor;
  maxDiffChars: number;
  /** Agents get next-step instructions; models get only the material. */
  audience?: 'agent' | 'model';
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
  const out: string[] = [];
  out.push(`# Covi brief: ${intent.summary}`, '');
  out.push(
    `Run \`${options.runId}\` · ${change.repository.name} · ${change.base.ref} \`${change.base.sha.slice(0, 7)}\` → ${change.head.ref} \`${change.head.sha.slice(0, 7)}\` · ${plural(change.stats.files, 'file')}, +${change.stats.additions} −${change.stats.deletions} · size ${size.class}`,
    '',
  );
  if (change.metadata.title || change.metadata.description) {
    out.push('## Author description', '');
    if (change.metadata.title)
      out.push(`**${options.redactor.redact(change.metadata.title)}**`, '');
    if (change.metadata.description)
      out.push(options.redactor.redact(change.metadata.description.slice(0, 4000)), '');
    out.push(
      '> The description is the author’s claim, not evidence. Verify it against the code.',
      '',
    );
  }
  if (change.commits.length) {
    out.push('## Commits', '');
    for (const c of change.commits.slice(0, 15))
      out.push(`- \`${c.sha.slice(0, 7)}\` ${options.redactor.redact(c.subject)}`);
    if (change.commits.length > 15) out.push(`- …and ${change.commits.length - 15} more`);
    out.push('');
  }

  out.push('## What Covi determined', '');
  out.push(
    `- **Intent:** ${intent.kind} (${intent.confidence} confidence). ${intent.evidence.slice(0, 3).join('; ') || 'No direct evidence.'}`,
  );
  if (intent.ambiguity) out.push(`- **Ambiguity:** ${intent.ambiguity}`);
  out.push(
    `- **Areas:** ${context.areas.map((a) => `${a.name} (${a.surfaces.join(', ') || 'internal'})`).join('; ')}`,
  );
  const surfaceList = Object.entries(context.surfaces).map(
    ([s, files]) => `${s} (${files?.length})`,
  );
  if (surfaceList.length) out.push(`- **Surfaces:** ${surfaceList.join(', ')}`);
  out.push(
    `- **Demonstration value:** ${demonstration.value}${demonstration.kinds.length ? ` (${demonstration.kinds.join(', ')})` : ''} → ${demonstration.recommendation}. ${demonstration.reasons[0] ?? ''}`,
  );
  out.push(
    `- **Can run the app:** ${demonstration.runnable.available ? `yes (${demonstration.runnable.mode ?? 'commands'})` : 'no'}${demonstration.runnable.suggestions.length ? `; suggested config: ${demonstration.runnable.suggestions.join('; ')}` : ''}`,
  );
  const t = context.tests;
  out.push(
    `- **Tests:** ${t.changedTestFiles.length ? `${plural(t.changedTestFiles.length, 'test file')} changed (+${t.addedTestCases} cases)` : 'no test changes'}${t.frameworks.length ? `; frameworks: ${t.frameworks.join(', ')}` : ''}`,
  );
  if (context.dependencies.length)
    out.push(
      `- **Dependencies:** ${joinList(context.dependencies.slice(0, 6).map((d) => `${d.name} ${d.change}${d.to ? ` ${d.to}` : ''}`))}`,
    );
  if (context.envVars.length)
    out.push(
      `- **Environment variables:** ${joinList(context.envVars.map((e) => `${e.name} (${e.change})`))}`,
    );
  if (context.data.length)
    out.push(
      `- **Data changes:** ${context.data
        .slice(0, 5)
        .map((d) => d.statement)
        .join('; ')}`,
    );
  out.push('');

  if (context.signals.length || ruleFindings.length) {
    out.push('## Signals worth checking', '');
    for (const f of ruleFindings) {
      out.push(
        `- **[${f.id}]** ${CERTAINTY_LABEL[f.certainty]} · ${f.severity}: ${f.title}${locationText(f) ? ` (\`${locationText(f)}\`)` : ''}`,
      );
    }
    for (const s of context.signals)
      out.push(`- ${s.message}${s.path ? ` (\`${s.path}${s.line ? `:${s.line}` : ''}\`)` : ''}`);
    out.push(
      '',
      'Rule findings are evidence-based but shallow. Confirm or dismiss each one (with a reason) in findings.json.',
      '',
    );
  }

  if (context.readingOrder.length) {
    out.push('## Suggested reading order', '');
    for (const [i, s] of context.readingOrder.entries())
      out.push(`${i + 1}. \`${s.path}\`: ${s.reason}`);
    out.push('');
  }

  const digest = renderDiffDigest(change, context, {
    maxChars: options.maxDiffChars,
    redactor: options.redactor,
  });
  out.push('## Diff (prioritized)', '');
  out.push(digest.text);
  if (digest.omitted.length) {
    out.push('Not inlined:', '');
    for (const o of digest.omitted) out.push(`- \`${o.path}\`: ${o.reason}`);
    out.push('');
  }

  if (options.audience === 'model') return out.join('\n');
  out.push('## Next steps for the agent', '');
  out.push(`Artifacts live in \`${options.runDir}\`.`);
  out.push('');
  out.push(
    '1. Read the surrounding code for the files above; the diff alone is not enough context.',
  );
  out.push(
    '2. Write `explanation.json` (schema: `covi schema explanation`) and `findings.json` (schema: `covi schema findings`) into the run directory.',
  );
  out.push(
    `3. Run \`covi report --run ${options.runId}\` to validate them and render the Markdown reports.`,
  );
  out.push('');
  return out.join('\n');
}
