import type { EvidenceIndex } from '../evidence/cite.ts';
import { t } from '../i18n/catalog.ts';
import type { Language } from '../i18n/language.ts';
import type { ReviewContext } from '../model/context.ts';
import type { Explanation } from '../model/explanation.ts';
import { type Finding, isBlockingCandidate, type Review } from '../model/finding.ts';
import type { Ledger } from '../model/outcome.ts';
import { anchorMarker, outcomeKey, renderLedger } from '../outcomes/ledger.ts';
import { escapeMarkdownKeepCode, fence, truncate } from '../util/text.ts';
import { evidenceRefs } from './evidence.ts';

/** Hidden marker used to find and update Covi's own comment instead of posting duplicates. */
export const COMMENT_MARKER = '<!-- covi:review -->';
const MAX_COMMENT = 60_000;

export interface CommentLinks {
  video?: { url: string; seconds?: number; markdown?: string };
  artifacts?: string;
  run?: string;
  /**
   * Base URL of the run's files (`<files><run-relative path>`), where the platform serves them one
   * by one (GitLab job artifacts). Without it, cited captures are named, not linked.
   */
  files?: string;
}

export interface CommentExtras {
  /** What Covi reported on the change, push by push, for `covi outcomes collect` to read back. */
  ledger?: Ledger;
  /** End with "Was this useful? 👍 👎". Only a posted comment can be reacted to, not `comment.md`. */
  rating?: boolean;
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

/** Run-relative paths that cannot leave the run or break out of a URL. */
const SAFE_RUN_PATH = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function runFileUrl(base: string | undefined, path: string): string | undefined {
  if (!base || !SAFE_RUN_PATH.test(path)) return undefined;
  const url = safeUrl(`${base}${path}`);
  return url === '#' ? undefined : url;
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
  evidence?: EvidenceIndex,
  extras: CommentExtras = {},
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
      const cited = evidenceRefs(f.evidenceIds, evidence, {
        style: 'name',
        link: (path) => runFileUrl(links.files, path),
      });
      if (cited.length) out.push(say('cited', { refs: cited.join(' · ') }), '');
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
  // The rating line and the ledger survive truncation: outcomes are counted from them.
  const tail = `${extras.rating ? `\n\n${say('rate')}` : ''}${extras.ledger ? `\n${renderLedger(extras.ledger)}` : ''}`;
  const max = MAX_COMMENT - tail.length;
  return `${body.length > max ? `${cutClosed(body, max - 40)}\n\n${say('truncated')}` : body}${tail}`;
}

/**
 * Cuts the comment without leaving a code block or `<details>` open, so the notice and the rating
 * line after it render as text rather than as code or collapsed. A cut code block is left out.
 */
function cutClosed(markdown: string, max: number): string {
  let cut = markdown.slice(0, max);
  let fence: { ticks: string; at: number } | undefined;
  let details = false;
  let at = 0;
  for (const line of cut.split('\n')) {
    if (fence) {
      if (line === fence.ticks) fence = undefined;
    } else {
      const ticks = /^`{3,}/.exec(line)?.[0];
      if (ticks) fence = { ticks, at };
      else if (line.startsWith('<details>')) details = true;
      else if (line === '</details>') details = false;
    }
    at += line.length + 1;
  }
  if (fence) cut = cut.slice(0, fence.at);
  return details ? `${cut}\n\n</details>` : cut;
}

/** Only http(s) URLs without characters that could break out of Markdown link syntax. */
export function safeUrl(url: string): string {
  if (!/^https?:\/\/[^\s()<>"'`]+$/.test(url)) return '#';
  return url;
}

/** One finding posted as an inline comment that people can react to. */
export interface AnchorDraft {
  key: string;
  path: string;
  line: number;
  body: string;
}

/** Each anchor is a notification, so a run posts at most this many. */
export const MAX_ANCHORS = 10;

/**
 * Inline anchors for the findings that can block (confirmed and likely) and point at a line. The
 * hidden marker carries the finding's outcome key, so a later push finds its anchor again.
 */
export function anchorsFor(findings: readonly Finding[], language: Language): AnchorDraft[] {
  const out: AnchorDraft[] = [];
  for (const f of findings) {
    if (out.length >= MAX_ANCHORS) break;
    if (!isBlockingCandidate(f) || !f.location?.line) continue;
    const key = outcomeKey(f);
    if (out.some((a) => a.key === key)) continue;
    out.push({
      key,
      path: f.location.path,
      line: f.location.line,
      body: [
        anchorMarker(key),
        `**Covi · ${t(language, `certainty.${f.certainty}`)}**: ${inline(f.title, 160)}`,
        '',
        inline(f.explanation, 500),
        '',
        `<sub>${t(language, 'comment.anchorRate')}</sub>`,
      ].join('\n'),
    });
  }
  return out;
}
