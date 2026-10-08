import { describe, expect, it } from 'vitest';
import { indexEvidence } from '../src/evidence/cite.ts';
import type { ReviewContext } from '../src/model/context.ts';
import type { Explanation } from '../src/model/explanation.ts';
import type { Review } from '../src/model/finding.ts';
import { COMMENT_MARKER, renderComment } from '../src/report/comment.ts';
import { renderReview } from '../src/report/markdown.ts';

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

describe('evidence footnotes', () => {
  const zero = '0'.repeat(64);
  const finding = {
    id: 'f1',
    title: 'Quantity goes negative',
    certainty: 'confirmed',
    severity: 'high',
    category: 'correctness',
    location: { path: 'src/cart.ts', line: 12 },
    evidence: 'qty - 1',
    explanation: 'Totals go below zero.',
    source: { kind: 'agent' },
    evidenceIds: [
      'diff-hunk:src/cart.ts:10',
      'recording:flow-post-head',
      'trace:flow-post-head#n2',
      'http:1',
      'trace:gone',
    ],
  };
  const review = {
    schemaVersion: 1,
    verdict: 'needs-changes',
    summary: 's',
    findings: [finding],
    dismissed: [],
    checked: [],
    notVerified: [],
    generatedBy: { provider: 'agent' },
  } as unknown as Review;
  const explanation = {
    headline: 'Clamp quantities',
    summary: 's',
    changes: [],
  } as unknown as Explanation;
  const context = {
    change: { base: { ref: 'main', sha: 'a1b2c3d' }, head: { ref: 'fix', sha: 'e4f5a6b' } },
  } as unknown as ReviewContext;
  const evidence = indexEvidence({
    items: [
      {
        id: 'diff-hunk:src/cart.ts:10',
        kind: 'diff-hunk',
        path: 'diff.patch',
        revision: 'both',
        sha256: zero,
        label: 'src/cart.ts:10-14',
        location: { path: 'src/cart.ts', line: 10, endLine: 14, side: 'head' },
      },
      {
        id: 'recording:flow-post-head',
        kind: 'recording',
        path: 'demo/recordings/flow-post-head.mp4',
        revision: 'head',
        sha256: zero,
        label: 'Post (desktop) · head',
      },
      {
        id: 'trace:flow-post-head',
        kind: 'trace',
        path: 'demo/traces/flow-post-head.json',
        revision: 'head',
        sha256: zero,
        label: 'Post (desktop) · head',
        refs: ['trace:flow-post-head#n2'],
      },
      {
        id: 'http:1',
        kind: 'http',
        path: 'demo/captures.json',
        revision: 'both',
        sha256: zero,
        label: 'GET /api/cart',
      },
    ],
  });

  it('names the file and lines of a hunk and the file of a capture', () => {
    expect(renderComment(review, explanation, context, {}, 'en', evidence)).toContain(
      'Cited evidence: `src/cart.ts:10-14` · `flow-post-head.mp4` · `flow-post-head.json#n2` · `GET /api/cart` · `trace:gone`',
    );
    expect(renderReview(review, explanation, context, 'en', evidence)).toContain(
      'Cited evidence: `src/cart.ts:10-14` · `demo/recordings/flow-post-head.mp4` · `demo/traces/flow-post-head.json#n2` · `GET /api/cart` · `trace:gone`',
    );
    // Without a registry (a run made before Covi kept one), the ids still show, as code.
    expect(renderComment(review, explanation, context, {}, 'en')).toContain(
      'Cited evidence: `diff-hunk:src/cart.ts:10` · `recording:flow-post-head`',
    );
    expect(renderComment(review, explanation, context, {}, 'ko', evidence)).toContain(
      '인용한 근거:',
    );
  });

  it('finds an id cited as written in a registry that redacted it', () => {
    const redact = (text: string) => text.replace(/sk-\w+/g, '[redacted]');
    const redacted = indexEvidence(
      {
        items: [
          {
            id: 'trace:[redacted]-head',
            kind: 'trace',
            path: 'demo/traces/[redacted]-head.json',
            revision: 'head',
            sha256: zero,
            label: 'x',
            refs: ['trace:[redacted]-head#n2'],
          },
        ],
      },
      redact,
    );
    const cited = {
      ...review,
      findings: [{ ...finding, evidenceIds: ['trace:sk-live1-head#n2', 'trace:sk-live1-head'] }],
    } as unknown as Review;
    expect(renderReview(cited, explanation, context, 'en', redacted)).toContain(
      'Cited evidence: `demo/traces/[redacted]-head.json#n2` · `demo/traces/[redacted]-head.json`',
    );
  });

  it('links captures where the platform serves run files one by one', () => {
    const body = renderComment(
      review,
      explanation,
      context,
      { files: 'https://gitlab.example/acme/shop/-/jobs/9/artifacts/file/run/' },
      'en',
      evidence,
    );
    expect(body).toContain(
      '[`flow-post-head.mp4`](https://gitlab.example/acme/shop/-/jobs/9/artifacts/file/run/demo/recordings/flow-post-head.mp4)',
    );
    // A hunk or a request is not a file of its own: no link.
    expect(body).toContain(' `src/cart.ts:10-14` ');
  });

  it('cannot be turned into links, HTML, or mentions by a hostile evidence.json', () => {
    const hostile = indexEvidence({
      items: [
        {
          id: 'recording:x',
          kind: 'recording',
          path: '../../x)<img src=x onerror=alert(1)>.mp4',
          revision: 'head',
          sha256: zero,
          label: 'x',
        },
        {
          id: 'diff-hunk:a:1',
          kind: 'diff-hunk',
          path: 'diff.patch',
          revision: 'both',
          sha256: zero,
          label: '`@everyone` [x](https://evil.example)\n# heading <b>bold</b>',
          location: { path: 'a', line: 1, endLine: 1, side: 'head' },
        },
      ],
    });
    const cited = {
      ...review,
      findings: [
        { ...finding, evidenceIds: ['recording:x', 'diff-hunk:a:1', '`](javascript:alert(1))'] },
      ],
    } as unknown as Review;
    for (const files of ['javascript:alert(1)//', 'https://ci.example/files/']) {
      const body = renderComment(cited, explanation, context, { files }, 'en', hostile);
      expect(outsideCode(body)).not.toMatch(
        /<img|<b>|@everyone|javascript|evil\.example|^# heading/m,
      );
      expect(body).not.toContain('](https://ci.example/files/../');
    }
  });
});
