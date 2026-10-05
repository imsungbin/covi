import { describe, expect, it } from 'vitest';
import type { ReviewContext } from '../src/model/context.ts';
import type { Explanation } from '../src/model/explanation.ts';
import type { Review } from '../src/model/finding.ts';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.ts';

/** Removes fenced blocks and code spans, where GitHub and GitLab render text literally. */
function outsideCode(markdown: string): string {
  return markdown.replace(/(`{3,})[^\n]*\n[\s\S]*?\n\1/g, '').replace(/`[^`\n]*`/g, '');
}

describe('renderComment', () => {
  // Everything below can come from a pull request (titles, code, descriptions) or, in the
  // workflow_run pattern, from an artifact the pull request's own workflow produced.
  const hostile = '[login](https://evil.example) <img src=x onerror=alert(1)> @everyone | x';
  const review = {
    schemaVersion: 1,
    verdict: 'needs-attention',
    summary: hostile,
    findings: [
      {
        id: 'f1',
        title: `Title ${hostile}`,
        certainty: 'likely',
        severity: 'medium',
        category: 'correctness',
        location: { path: 'src/a`b|c.ts', line: 3 },
        evidence: 'line\n```\n<script>alert(1)</script>\n```',
        explanation: `Because ${hostile}`,
        suggestion: `Try ${hostile}`,
        source: { kind: 'rule', id: 'x' },
      },
    ],
    notVerified: [hostile],
    checked: [],
    omitted: [],
    generatedBy: { provider: 'x](javascript:alert(1)) <b>bold</b>', model: '@admin' },
  } as unknown as Review;
  const explanation = {
    headline: hostile,
    summary: hostile,
    changes: [{ area: hostile, description: hostile, files: [] }],
  } as unknown as Explanation;
  const context = {
    change: { base: { sha: '<script>alert(1)</script>' }, head: { sha: 'a1b2c3d4e5f6a7b8' } },
  } as unknown as ReviewContext;

  const body = renderComment(review, explanation, context, {
    artifacts: 'javascript:alert(1)',
    run: 'https://ci.example/run/1',
  });

  it('starts with the marker used to find and update the comment', () => {
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('cannot inject HTML, links, table cells, or mentions', () => {
    // Escaped characters (\< \[ \]) render literally; only unescaped ones could form markup.
    const text = outsideCode(body).replace(/<\/?(details|summary|sub)>|<!-- covi:review -->/g, '');
    expect(text).not.toMatch(/(?<!\\)<(img|script|b)\b/i);
    expect(text).not.toMatch(/(?<!\\)\]\((https:\/\/evil|javascript:)/);
    expect(text).not.toMatch(/@everyone|@admin/);
    // Each finding row keeps exactly its three cells.
    const row = body.split('\n').find((l) => l.includes('Likely issue'))!;
    expect(row.replace(/\\\|/g, '').split('|').length - 2).toBe(3);
  });

  it('keeps evidence inside a fence it cannot close', () => {
    const fences = body.match(/^`{3,}$/gm)!;
    const outer = fences[0]!;
    expect(outer.length).toBeGreaterThan(3);
    expect(fences.at(-1)).toBe(outer);
    for (const inner of fences.slice(1, -1)) expect(inner.length).toBeLessThan(outer.length);
  });

  it('prints only hex revisions and only http(s) links', () => {
    expect(body).toContain('unknown…a1b2c3d');
    expect(body).toContain('[artifacts](#)');
    expect(body).toContain('[run](https://ci.example/run/1)');
  });
});
