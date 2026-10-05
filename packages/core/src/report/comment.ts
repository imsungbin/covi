import { t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import type { ReviewContext } from '../model/context.ts';
import type { Explanation } from '../model/explanation.ts';
import type { Finding, Review } from '../model/finding.ts';
import { escapeMarkdownKeepCode, fence, truncate } from '../util/text.ts';

/** Hidden marker used to find and update Covi's own comment instead of posting duplicates. */
export const COMMENT_MARKER = '<!-- covi:review -->';
const MAX_COMMENT = 60_000;

export interface CommentLinks {
  video?: { url: string; seconds?: number; markdown?: string };
  artifacts?: string;
  run?: string;
}

const SEVERITY_ICON: Record<Finding['severity'], string> = { high: '🔴', medium: '🟠', low: '🔵' };
const VERDICT_ICON: Record<Review['verdict'], string> = {
  'looks-good': '✅',
  'needs-attention': '⚠️',
  'needs-changes': '⛔',
};

function inline(text: string, max = 300): string {
  return escapeMarkdownKeepCode(truncate(text, max));
}

/** A code span safe inside a table cell: GFM splits cells on `|` even within code spans. */
function codeSpan(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\n/g, ' ').replace(/\|/g, '\\|')}\``;
}

/**
 * Renders the pull/merge request comment. Every dynamic string is escaped: titles, evidence, and
 * paths can originate from untrusted pull request content, so the comment must not be able to
 * inject links, HTML, or @-mentions.
 */
export function renderComment(
  review: Review,
  explanation: Explanation,
  context: ReviewContext,
  links: CommentLinks = {},
  language: Language = explanation.language ?? review.language ?? 'en',
): string {
  const say = (key: string, params?: Record<string, string | number>) =>
    t(language, `comment.${key}`, params);
  const out: string[] = [COMMENT_MARKER];
  out.push(
    `### ${VERDICT_ICON[review.verdict]} ${say('heading', { verdict: t(language, `verdict.${review.verdict}`) })}`,
    '',
  );
  out.push(`**${inline(explanation.headline, 200)}**`, '');
  out.push(inline(explanation.summary, 700), '');

  if (links.video) {
    const duration = links.video.seconds ? ` (${Math.round(links.video.seconds)}s)` : '';
    out.push(
      links.video.markdown ?? `▶️ [${say('watch', { duration })}](${safeUrl(links.video.url)})`,
      '',
    );
  }

  if (review.findings.length) {
    out.push(`| | ${say('finding')} | ${say('where')} |`, '|---|---|---|');
    for (const f of review.findings) {
      const where = f.location
        ? codeSpan(f.location.line ? `${f.location.path}:${f.location.line}` : f.location.path)
        : '';
      out.push(
        `| ${SEVERITY_ICON[f.severity]} ${t(language, `certainty.${f.certainty}`)} | ${inline(f.title, 160)} | ${where} |`,
      );
    }
    out.push('');
    out.push(`<details><summary>${say('details')}</summary>`, '');
    for (const f of review.findings) {
      out.push(`**${inline(f.title, 160)}**: ${inline(f.explanation, 500)}`, '');
      out.push(fence(truncate(f.evidence, 800)), '');
      if (f.suggestion) out.push(`${say('suggestion')} ${inline(f.suggestion, 300)}`, '');
    }
    out.push('</details>', '');
  } else {
    out.push(`${inline(review.summary, 300)}`, '');
  }

  if (explanation.changes.length) {
    out.push(`<details><summary>${say('changes')}</summary>`, '');
    for (const c of explanation.changes.slice(0, 10))
      out.push(`- **${inline(c.area, 80)}**: ${inline(c.description, 300)}`);
    out.push('', '</details>', '');
  }
  if (review.notVerified.length) {
    out.push(`<details><summary>${say('notVerified')}</summary>`, '');
    for (const n of review.notVerified) out.push(`- ${inline(n, 300)}`);
    out.push('', '</details>', '');
  }

  // In the workflow_run pattern these files come from an untrusted artifact: only hex SHAs are
  // printed, and the provider name is escaped like any other text.
  const sha = (value: unknown) =>
    typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value) ? value.slice(0, 7) : 'unknown';
  const meta = [
    `${sha(context.change?.base?.sha)}…${sha(context.change?.head?.sha)}`,
    inline([review.generatedBy.provider, review.generatedBy.model].filter(Boolean).join(' · '), 80),
  ];
  if (links.artifacts) meta.push(`[${say('artifacts')}](${safeUrl(links.artifacts)})`);
  if (links.run) meta.push(`[${say('run')}](${safeUrl(links.run)})`);
  out.push(`<sub>Covi · ${meta.join(' · ')}</sub>`);
  const body = out.join('\n');
  return body.length > MAX_COMMENT
    ? `${body.slice(0, MAX_COMMENT - 40)}\n\n${say('truncated')}`
    : body;
}

/** Only http(s) URLs without characters that could break out of Markdown link syntax. */
export function safeUrl(url: string): string {
  if (!/^https?:\/\/[^\s()<>"'`]+$/.test(url)) return '#';
  return url;
}
