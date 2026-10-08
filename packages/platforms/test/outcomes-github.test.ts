import {
  anchorMarker,
  buildOutcome,
  type Finding,
  mergeLedger,
  normalizeFinding,
  outcomeKey,
  renderLedger,
} from '@covi/core';
import { describe, expect, it } from 'vitest';
import { BudgetExhaustedError, RequestBudget } from '../src/http.ts';
import { GitHubCollector } from '../src/outcomes/github.ts';
import { findRevert, quotesComment } from '../src/outcomes/signals.ts';
import { fixtureFetch } from './fixtures.ts';

const finding = (title: string, certainty: Finding['certainty']): Finding =>
  normalizeFinding(
    {
      title,
      certainty,
      severity: 'medium',
      category: 'correctness',
      evidence: 'x',
      explanation: 'y',
      location: { path: 'src/cart.ts', line: 3 },
    },
    { kind: 'model' },
  );
const discount = finding('Total ignores discounts', 'likely');
const ledger = mergeLedger(undefined, {
  runId: '20261001-090000-ci-aaaaaaa',
  head: 'a'.repeat(40),
  findings: [discount, finding('No test covers the discount path', 'risk')],
})!;
const forged = mergeLedger(undefined, {
  runId: '20261001-080000-ci-fffffff',
  head: 'f'.repeat(40),
  findings: [],
})!;
const quiet = mergeLedger(undefined, {
  runId: '20261001-090001-local-aaaaaaa',
  head: 'a'.repeat(40),
  findings: [finding('No test covers the discount path', 'risk')],
})!;
const replace = {
  '{{LEDGER}}': renderLedger(ledger),
  '{{FORGED}}': renderLedger(forged),
  '{{QUIET}}': renderLedger(quiet),
  '{{ANCHOR}}': anchorMarker(outcomeKey(discount)),
};
const API = 'https://api.github.com/repos/acme/shop';
const USER = 'GET https://api.github.com/user';
/** A workflow token cannot read /user, so Covi is `github-actions[bot]`. */
const workflowToken = { [USER]: { status: 403, fixture: 'github/user-forbidden.json' } };
/** A person's token reads /user: Covi is that person (`covi-runner`, id 77). */
const personalToken = { [USER]: { fixture: 'github/user.json' } };
const collector = (fetch: ReturnType<typeof fixtureFetch>['fetch'], max = 50) =>
  new GitHubCollector({
    token: 't',
    repository: 'acme/shop',
    fetch,
    budget: new RequestBudget(max),
  });
const pathsOf = (calls: Array<{ url: string }>) => calls.map((c) => new URL(c.url).pathname);

describe('GitHubCollector', () => {
  const merged = {
    [`GET ${API}/pulls/7`]: { fixture: 'github/pull-7-merged.json' },
    [`GET ${API}/issues/7/comments?per_page=100`]: {
      fixture: 'github/issue-comments-7-page-1.json',
      headers: {
        link: '<https://api.github.com/repositories/9/issues/7/comments?per_page=100&page=2>; rel="next"',
      },
    },
    'GET https://api.github.com/repositories/9/issues/7/comments?per_page=100&page=2': {
      fixture: 'github/issue-comments-7-page-2.json',
    },
    [`GET ${API}/pulls/7/comments?per_page=100`]: { fixture: 'github/review-comments-7.json' },
    [`GET ${API}/pulls/comments/301/reactions?per_page=100`]: {
      fixture: 'github/reactions-301.json',
    },
    [`GET ${API}/commits?sha=main&since=2026-10-02T09%3A00%3A00Z&per_page=100`]: {
      fixture: 'github/commits-main-since.json',
    },
  };

  it('collects state, reactions, quote replies, anchors, and a revert from saved responses', async () => {
    const api = fixtureFetch({ ...merged, ...workflowToken }, replace);
    const signals = await collector(api.fetch).collect(7);
    expect(signals).toEqual({
      platform: 'github',
      repository: 'acme/shop',
      number: 7,
      url: 'https://github.com/acme/shop/pull/7',
      state: 'merged',
      closedAt: '2026-10-02T09:00:00Z',
      author: '5',
      revertedBy: {
        sha: '3333333333333333333333333333333333333333',
        url: 'https://github.com/acme/shop/commit/3333333333333333333333333333333333333333',
      },
      // The bot's comment on page 2, not the marker the author pasted on page 1. Another app's
      // quote is not a reply.
      comment: {
        id: '201',
        url: 'https://github.com/acme/shop/pull/7#issuecomment-201',
        body: expect.stringContaining(renderLedger(ledger)),
        up: 2,
        down: 1,
        replies: 1,
      },
      // The bot's anchor, not the author's or another app's; its thread has one reply. Each vote
      // names its user, and reactions other than 👍 and 👎 are left out.
      anchors: [
        {
          key: outcomeKey(discount),
          id: '301',
          reactions: [
            { user: '6', vote: 'down' },
            { user: '7', vote: 'down' },
            { user: '5', vote: 'up' },
          ],
          replies: 1,
        },
      ],
    });
    // The author's own 👍 on the anchor does not count.
    expect(buildOutcome(signals, '2026-10-09T12:00:00.000Z').outcome).toMatchObject({
      runId: '20261001-090000-ci-aaaaaaa',
      findings: [
        { key: outcomeKey(discount), thumbs: { up: 0, down: 2 } },
        { certainty: 'risk', fate: 'present' },
      ],
    });
    expect(api.calls.every((c) => c.headers.authorization === 'Bearer t')).toBe(true);
    expect(api.calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('stops when the request budget runs out', async () => {
    const api = fixtureFetch({ ...merged, ...workflowToken }, replace);
    await expect(collector(api.fetch, 4).collect(7)).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(api.calls).toHaveLength(4);
  });

  it("takes the recorded comment among Covi's own, and skips anchors when no finding could have one", async () => {
    const commits = `${API}/commits?sha=main&since=2026-10-02T09%3A00%3A00Z&per_page=100`;
    const api = fixtureFetch(
      {
        [`GET ${API}/pulls/7`]: { fixture: 'github/pull-7-merged.json' },
        [`GET ${API}/issues/7/comments?per_page=100`]: {
          fixture: 'github/issue-comments-7-own.json',
        },
        ...personalToken,
        // A cycle of commit pages: a revert is looked for in at most three of them.
        [`GET ${commits}`]: { json: [], headers: { link: `<${commits}>; rel="next"` } },
      },
      replace,
    );
    const signals = await collector(api.fetch).collect(7, { commentId: '402' });
    expect(signals.comment).toMatchObject({ id: '402', up: 1 });
    expect(signals.revertedBy).toBeUndefined();
    // Its ledger lists no confirmed or likely finding, so review comments are not listed.
    expect(pathsOf(api.calls)).toEqual([
      '/repos/acme/shop/pulls/7',
      '/repos/acme/shop/issues/7/comments',
      '/user',
      '/repos/acme/shop/commits',
      '/repos/acme/shop/commits',
      '/repos/acme/shop/commits',
    ]);
    // Without a recorded id, Covi's first comment.
    const again = fixtureFetch(
      {
        [`GET ${API}/pulls/8`]: { fixture: 'github/pull-8-open.json' },
        [`GET ${API}/issues/8/comments?per_page=100`]: {
          fixture: 'github/issue-comments-7-own.json',
        },
        [`GET ${API}/pulls/8/comments?per_page=100`]: { json: [] },
        ...personalToken,
      },
      replace,
    );
    expect((await collector(again.fetch).collect(8)).comment?.id).toBe('401');
  });

  it('skips a change Covi never commented on, even when its comment id or marker is pasted', async () => {
    const api = fixtureFetch(
      {
        [`GET ${API}/pulls/7`]: { fixture: 'github/pull-7-merged.json' },
        [`GET ${API}/issues/7/comments?per_page=100`]: {
          fixture: 'github/issue-comments-7-page-1.json',
        },
        ...workflowToken,
      },
      replace,
    );
    // 102 is the author's comment with a pasted marker and ledger: neither the hint nor the
    // marker makes it Covi's.
    const signals = await collector(api.fetch).collect(7, { commentId: '102' });
    expect(signals.comment).toBeUndefined();
    expect(signals.anchors).toEqual([]);
    expect(buildOutcome(signals, '2026-10-09T12:00:00.000Z').skipped).toBe(
      'Covi has not commented on it',
    );
    expect(pathsOf(api.calls)).toEqual([
      '/repos/acme/shop/pulls/7',
      '/repos/acme/shop/issues/7/comments',
      '/user',
    ]);
  });

  it("does not take another app's comment as Covi's", async () => {
    const api = fixtureFetch(
      {
        [`GET ${API}/pulls/8`]: { fixture: 'github/pull-8-open.json' },
        [`GET ${API}/issues/8/comments?per_page=100`]: {
          json: [
            {
              id: 501,
              body: `<!-- covi:review -->\n${renderLedger(ledger)}`,
              created_at: '2026-10-01T09:00:00Z',
              user: { login: 'some-app[bot]', id: 900, type: 'Bot' },
            },
          ],
        },
        ...workflowToken,
      },
      replace,
    );
    expect((await collector(api.fetch).collect(8)).comment).toBeUndefined();
  });

  it('reads an open pull request without looking for anchors or reverts', async () => {
    const api = fixtureFetch({
      [`GET ${API}/pulls/8`]: { fixture: 'github/pull-8-open.json' },
      [`GET ${API}/issues/8/comments?per_page=100`]: { json: [] },
    });
    expect(await collector(api.fetch).collect(8)).toEqual({
      platform: 'github',
      repository: 'acme/shop',
      number: 8,
      url: 'https://github.com/acme/shop/pull/8',
      state: 'open',
      author: '5',
      anchors: [],
    });
    // No marked comment, so it never needs to ask who Covi is.
    expect(api.calls).toHaveLength(2);
  });

  it('lists recently closed pull requests', async () => {
    const api = fixtureFetch({
      [`GET ${API}/pulls?state=closed&sort=updated&direction=desc&per_page=2`]: {
        fixture: 'github/pulls-closed.json',
      },
    });
    expect(await collector(api.fetch).recent(2)).toEqual([9, 7]);
    expect(await collector(api.fetch).recent(0)).toEqual([]);
    expect(api.calls).toHaveLength(1);
  });

  it('refuses a repository or number that is not one', async () => {
    const { fetch } = fixtureFetch({});
    const budget = new RequestBudget(1);
    expect(
      () => new GitHubCollector({ token: 't', repository: 'acme/../user', fetch, budget }),
    ).toThrow(/repository/);
    expect(() => new GitHubCollector({ token: 't', repository: 'acme', fetch, budget })).toThrow(
      /repository/,
    );
    await expect(collector(fetch).collect(0)).rejects.toThrow(/number/);
    await expect(collector(fetch).collect(1.5)).rejects.toThrow(/number/);
  });
});

describe('outcome signals', () => {
  it('finds git and platform reverts, not a merely similar number', () => {
    const merge = '1'.repeat(40);
    const reverts = { shas: [merge], mentions: ['Reverts acme/shop#7'] };
    expect(
      findRevert(
        [
          { sha: 'a1', message: 'docs: see acme/shop#70', url: 'u1' },
          {
            sha: 'a2',
            message: `Revert "fix"\n\nThis reverts commit ${merge.slice(0, 12)}.`,
            url: 'u2',
          },
        ],
        reverts,
      ),
    ).toEqual({ sha: 'a2', url: 'u2' });
    expect(
      findRevert([{ sha: 'b1', message: 'Reverts acme/shop#7\n\nBroke checkout.' }], reverts),
    ).toEqual({ sha: 'b1' });
    expect(findRevert([{ sha: 'c1', message: 'Reverts acme/shop#70' }], reverts)).toBeUndefined();
    expect(
      findRevert([{ sha: 'd1', message: `This reverts commit ${'2'.repeat(40)}.` }], reverts),
    ).toBeUndefined();
  });

  it("counts a quote of Covi's comment as a reply, not a passing mention", () => {
    const comment = '<!-- covi:review -->\n**Cart totals ignore discounts in one path**: details';
    expect(
      quotesComment(
        '> **Cart totals ignore discounts in one path**\n\nDead code; removed.',
        comment,
      ),
    ).toBe(true);
    expect(quotesComment('Covi says cart totals ignore discounts in one path.', comment)).toBe(
      false,
    );
    expect(quotesComment('> ok', comment)).toBe(false);
    expect(quotesComment('> Something nobody wrote in that comment', comment)).toBe(false);
  });
});
