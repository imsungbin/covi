import { buildOutcome, mergeLedger, renderLedger } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { RequestBudget } from '../src/http.ts';
import { GitLabCollector } from '../src/outcomes/gitlab.ts';
import { createCollector } from '../src/outcomes/index.ts';
import { fixtureFetch, type Reply } from './fixtures.ts';

const ledger = mergeLedger(undefined, {
  runId: '20261001-090000-ci-aaaaaaa',
  head: 'a'.repeat(40),
  findings: [],
})!;
const forged = mergeLedger(undefined, {
  runId: '20261001-110000-ci-fffffff',
  head: 'f'.repeat(40),
  findings: [],
})!;
const replace = { '{{LEDGER}}': renderLedger(ledger), '{{FORGED}}': renderLedger(forged) };
const BASE = 'https://gitlab.example/api/v4';
const PROJECT = `${BASE}/projects/acme%2Fshop`;
const MR = `${PROJECT}/merge_requests/12`;
const DISCUSSIONS = `GET ${MR}/discussions?per_page=100`;
const EMOJI_901 = `GET ${MR}/notes/901/award_emoji?per_page=100`;
const COMMITS = `GET ${PROJECT}/repository/commits?ref_name=main&since=2026-10-02T09%3A00%3A00.000Z&per_page=100`;
/** A project access token reads /user: Covi is its bot user (id 50). */
const projectToken = { [`GET ${BASE}/user`]: { fixture: 'gitlab/user.json' } };
/** A maintainer's own token: /user is a person (id 9), not the bot CI posts as. */
const personalToken = { [`GET ${BASE}/user`]: { fixture: 'gitlab/user-person.json' } };
const BOT = `GET ${BASE}/users/50`;
const collector = (fetch: ReturnType<typeof fixtureFetch>['fetch'], botUser?: string) =>
  new GitLabCollector({
    token: 'glpat',
    repository: 'acme/shop',
    apiUrl: BASE,
    fetch,
    budget: new RequestBudget(50),
    botUser,
  });
const merged: Record<string, Reply> = {
  [`GET ${MR}`]: { fixture: 'gitlab/mr-12-merged.json' },
  [DISCUSSIONS]: { fixture: 'gitlab/discussions-12.json' },
  [EMOJI_901]: { fixture: 'gitlab/award-emoji-901.json' },
  [COMMITS]: { fixture: 'gitlab/commits-main-since.json' },
};
const note = (id: number, author: number, body: string) => ({
  id,
  body,
  system: false,
  author: { id: author },
  created_at: '2026-10-01T09:00:00.000Z',
});
const mr = (fields: object): Reply => ({
  json: { iid: 12, web_url: 'https://gitlab.example/acme/shop/-/merge_requests/12', ...fields },
});

describe('GitLabCollector', () => {
  it('takes its own note over a newer pasted marker', async () => {
    const api = fixtureFetch({ ...merged, ...projectToken }, replace);
    const signals = await collector(api.fetch).collect(12);
    expect(signals).toEqual({
      platform: 'gitlab',
      repository: 'acme/shop',
      number: 12,
      url: 'https://gitlab.example/acme/shop/-/merge_requests/12',
      state: 'merged',
      closedAt: '2026-10-02T09:00:00.000Z',
      author: '5',
      revertedBy: {
        sha: '6666666666666666666666666666666666666666',
        url: 'https://gitlab.example/acme/shop/-/commit/6666666666666666666666666666666666666666',
      },
      // The author's own 👍 and the 🎉 do not count; the system note is not a reply.
      comment: {
        id: '901',
        url: 'https://gitlab.example/acme/shop/-/merge_requests/12#note_901',
        body: expect.stringContaining(renderLedger(ledger)),
        up: 1,
        down: 1,
        replies: 1,
      },
      // GitLab has no per-finding anchors in this version.
      anchors: [],
    });
    expect(buildOutcome(signals, '2026-10-09T12:00:00.000Z').outcome?.runId).toBe(ledger.run);
    expect(api.calls.every((c) => c.headers['PRIVATE-TOKEN'] === 'glpat')).toBe(true);
    expect(api.calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('skips the change when the token cannot say whose note it is', async () => {
    for (const status of [401, 403]) {
      const api = fixtureFetch(
        { ...merged, [`GET ${BASE}/user`]: { status, fixture: 'gitlab/user-unauthorized.json' } },
        replace,
      );
      const signals = await collector(api.fetch).collect(12);
      expect(signals.comment).toBeUndefined();
      expect(buildOutcome(signals, '2026-10-09T12:00:00.000Z').skipped).toMatch(/not commented/);
      expect(api.calls.some((c) => c.url.includes('award_emoji'))).toBe(false);
    }
    // An outage is not "no user": it fails rather than guess.
    const down = fixtureFetch({ ...merged, [`GET ${BASE}/user`]: { status: 502 } }, replace);
    await expect(collector(down.fetch).collect(12)).rejects.toThrow(/HTTP 502/);
  });

  it('takes the recorded note among its own, never a pasted one', async () => {
    const discussions = {
      json: [
        { id: 'd1', notes: [note(901, 50, `<!-- covi:review -->\n${renderLedger(ledger)}`)] },
        { id: 'd2', notes: [note(905, 5, `<!-- covi:review -->\n${renderLedger(forged)}`)] },
        { id: 'd3', notes: [note(906, 50, `<!-- covi:review -->\n${renderLedger(ledger)}`)] },
      ],
    };
    const routes = {
      ...merged,
      ...projectToken,
      [DISCUSSIONS]: discussions,
      [`GET ${MR}/notes/906/award_emoji?per_page=100`]: { json: [] },
    };
    const api = fixtureFetch(routes);
    const gitlab = collector(api.fetch);
    // The newest of its own, as the publisher updates it.
    expect((await gitlab.collect(12)).comment?.id).toBe('906');
    expect((await gitlab.collect(12, { commentId: '901' })).comment?.id).toBe('901');
    expect((await gitlab.collect(12, { commentId: '905' })).comment?.id).toBe('906');
    // Who the token is was asked once.
    expect(api.calls.filter((c) => c.url === `${BASE}/user`)).toHaveLength(1);
  });

  it("reads CI's bot note with a person's token once GitLab confirms the bot", async () => {
    const api = fixtureFetch(
      { ...merged, ...personalToken, [BOT]: { fixture: 'gitlab/user.json' } },
      replace,
    );
    const gitlab = collector(api.fetch, 'project_5_bot_covi');
    expect((await gitlab.collect(12)).comment).toMatchObject({ id: '901', up: 1, down: 1 });
    expect((await gitlab.collect(12)).comment?.id).toBe('901');
    // GitLab is asked once whether the user is a bot.
    expect(api.calls.filter((c) => c.url === `${BASE}/users/50`)).toHaveLength(1);
    // Without the key, a person's token reads only that person's notes.
    const plain = fixtureFetch({ ...merged, ...personalToken }, replace);
    expect((await collector(plain.fetch).collect(12)).comment).toBeUndefined();
  });

  it('refuses a configured bot name GitLab does not confirm, or another user', async () => {
    for (const reply of [
      { json: { id: 50, username: 'project_5_bot_covi', bot: false } },
      { json: { id: 50, username: 'project_5_bot_covi' } },
      { json: { id: 50, username: 'someone_else', bot: true } },
      { json: { id: 51, username: 'project_5_bot_covi', bot: true } },
      { status: 404, json: { message: '404 Not found' } },
      { status: 403, json: { message: '403 Forbidden' } },
    ]) {
      const api = fixtureFetch({ ...merged, ...personalToken, [BOT]: reply }, replace);
      expect(
        (await collector(api.fetch, 'project_5_bot_covi').collect(12)).comment,
      ).toBeUndefined();
    }
    // Another username is never looked up; a display name that matches is not a username.
    const impostor = fixtureFetch({
      ...merged,
      ...personalToken,
      [DISCUSSIONS]: {
        json: [
          {
            id: 'd1',
            notes: [
              {
                ...note(907, 66, `<!-- covi:review -->\n${renderLedger(forged)}`),
                author: { id: 66, username: 'impostor', name: 'project_5_bot_covi' },
              },
            ],
          },
        ],
      },
    });
    expect(
      (await collector(impostor.fetch, 'project_5_bot_covi').collect(12)).comment,
    ).toBeUndefined();
    expect(impostor.calls.some((c) => c.url.includes('/users/'))).toBe(false);
  });

  it('stops rather than guess when the bot check is rate limited', async () => {
    const api = fixtureFetch(
      {
        ...merged,
        ...personalToken,
        [BOT]: { status: 429, headers: { 'ratelimit-reset': '1790000000' } },
      },
      replace,
    );
    await expect(collector(api.fetch, 'project_5_bot_covi').collect(12)).rejects.toThrow(
      /rate limit/,
    );
  });

  it('counts someone who gave both 👍 and 👎 on neither side', async () => {
    const api = fixtureFetch(
      {
        ...merged,
        ...projectToken,
        [EMOJI_901]: {
          json: [
            { name: 'thumbsup', user: { id: 6 } },
            { name: 'thumbsdown', user: { id: 6 } },
            { name: 'thumbsup', user: { id: 7 } },
            { name: 'thumbsdown', user: { id: 8 } },
            { name: 'tada', user: { id: 8 } },
            { name: 'thumbsup' },
          ],
        },
      },
      replace,
    );
    expect((await collector(api.fetch).collect(12)).comment).toMatchObject({ up: 1, down: 1 });
  });

  it('says which commits it could not read for a revert', async () => {
    const page = (n: number) => `${COMMITS.slice(4)}&page=${n}`;
    const link = (rels: Record<string, number>) =>
      Object.entries(rels)
        .map(([rel, n]) => `<${page(n)}>; rel="${rel}"`)
        .join(', ');
    const commit = (n: number) => ({ id: String(n).repeat(40), message: 'chore' });
    // GitLab linked only forward: the newest page alone was read.
    const forward = fixtureFetch(
      {
        ...merged,
        ...projectToken,
        [COMMITS]: { json: [commit(9)], headers: { link: link({ next: 2 }) } },
      },
      replace,
    );
    expect((await collector(forward.fetch).collect(12)).notes).toEqual([
      'commits since the merge: GitLab linked no last page, so only the newest page was read and a revert nearer the merge is missed',
    ]);
    // With a last page: the two nearest the merge and the newest.
    const paged = fixtureFetch(
      {
        ...merged,
        ...projectToken,
        [COMMITS]: { json: [commit(9)], headers: { link: link({ next: 2, last: 4 }) } },
        [`GET ${page(4)}`]: { json: [commit(1)], headers: { link: link({ prev: 3 }) } },
        [`GET ${page(3)}`]: { json: [commit(2)], headers: { link: link({ prev: 2 }) } },
      },
      replace,
    );
    expect((await collector(paged.fetch).collect(12)).notes).toEqual([
      'commits since the merge: more than 3 pages; read the 2 nearest the merge and the newest, so a revert in between is missed',
    ]);
  });

  it('notes award emoji cut at their page limit', async () => {
    const emoji = `${MR}/notes/901/award_emoji?per_page=100`;
    const api = fixtureFetch(
      {
        ...merged,
        ...projectToken,
        [EMOJI_901]: {
          fixture: 'gitlab/award-emoji-901.json',
          headers: { link: `<${emoji}>; rel="next"` },
        },
      },
      replace,
    );
    const signals = await collector(api.fetch).collect(12);
    expect(signals.notes).toEqual(['award emoji on note 901: only the first 3 pages were read']);
    expect(api.calls.filter((c) => c.url === emoji)).toHaveLength(3);
  });

  it('reads an open merge request without looking for a revert, and notes a cut listing', async () => {
    const discussions = `${MR}/discussions?per_page=100`;
    const api = fixtureFetch({
      [`GET ${MR}`]: mr({ state: 'opened', author: { id: 5 }, target_branch: 'main' }),
      [DISCUSSIONS]: { json: [], headers: { link: `<${discussions}>; rel="next"` } },
    });
    expect(await collector(api.fetch).collect(12)).toEqual({
      platform: 'gitlab',
      repository: 'acme/shop',
      number: 12,
      url: 'https://gitlab.example/acme/shop/-/merge_requests/12',
      state: 'open',
      author: '5',
      anchors: [],
      notes: ['discussions: only the first 10 pages were read'],
    });
    expect(api.calls).toHaveLength(11);
  });

  it('reads closed and locked merge requests as closed', async () => {
    for (const state of ['closed', 'locked']) {
      const api = fixtureFetch({
        [`GET ${MR}`]: mr({ state, closed_at: '2026-10-03T09:00:00.000Z', target_branch: 'main' }),
        [DISCUSSIONS]: { json: [] },
      });
      expect(await collector(api.fetch).collect(12)).toMatchObject({
        state: 'closed',
        closedAt: '2026-10-03T09:00:00.000Z',
        // GitLab left the author out: no one's votes are excluded.
        author: '',
      });
    }
  });

  it('counts a revert only where git or GitLab writes one', async () => {
    const commit = (n: number, message: string) => ({ id: String(n).repeat(40), message });
    const api = fixtureFetch({
      ...merged,
      [DISCUSSIONS]: { json: [] },
      [COMMITS]: {
        json: [
          commit(7, 'Reland cart totals\n\nThe earlier This reverts merge request !12 was wrong.'),
          commit(8, 'Revert "Fix tax"\n\nThis reverts merge request !120'),
        ],
      },
    });
    expect((await collector(api.fetch).collect(12)).revertedBy).toBeUndefined();
    const git = fixtureFetch({
      ...merged,
      [DISCUSSIONS]: { json: [] },
      [COMMITS]: { json: [commit(9, `Revert\n\nThis reverts commit ${'5'.repeat(40)}.`)] },
    });
    expect((await collector(git.fetch).collect(12)).revertedBy).toEqual({ sha: '9'.repeat(40) });
  });

  it('lists recently closed and merged merge requests', async () => {
    const api = fixtureFetch({
      [`GET ${PROJECT}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100`]: {
        fixture: 'gitlab/merge-requests-recent.json',
      },
    });
    expect(await collector(api.fetch).recent(2)).toEqual([13, 12]);
    expect(await collector(api.fetch).recent(0)).toEqual([]);
    expect(api.calls).toHaveLength(1);
  });

  it('refuses a project or number that is not one', async () => {
    const { fetch } = fixtureFetch({});
    const budget = new RequestBudget(1);
    for (const repository of ['acme', 'acme/../admin', '42'])
      expect(
        () => new GitLabCollector({ token: 't', repository, apiUrl: BASE, fetch, budget }),
      ).toThrow(/project/);
    await expect(collector(fetch).collect(0)).rejects.toThrow(/number/);
  });
});

describe('createCollector', () => {
  it('says what it needs before it collects', () => {
    const budget = new RequestBudget(1);
    expect(createCollector('github', {}, { budget }).missing).toBe('repository');
    expect(createCollector('github', { GITHUB_REPOSITORY: 'acme/shop' }, { budget }).missing).toBe(
      'token',
    );
    expect(
      createCollector('github', { GITHUB_REPOSITORY: 'acme/shop', GITHUB_TOKEN: 't' }, { budget })
        .collector,
    ).toMatchObject({ platform: 'github', repository: 'acme/shop' });
    expect(
      createCollector('github', { GITHUB_TOKEN: 't' }, { budget, repository: 'acme/api' }).collector
        ?.repository,
    ).toBe('acme/api');
    expect(createCollector('gitlab', {}, { budget }).missing).toBe('repository');
    expect(createCollector('gitlab', { CI_PROJECT_PATH: 'acme/shop' }, { budget }).missing).toBe(
      'token',
    );
    expect(
      createCollector(
        'gitlab',
        { CI_PROJECT_PATH: 'acme/shop', COVI_GITLAB_TOKEN: 't' },
        { budget },
      ).collector,
    ).toMatchObject({ platform: 'gitlab', repository: 'acme/shop' });
  });

  it("prefers the merge request's project and falls back to GITLAB_TOKEN", async () => {
    const api = fixtureFetch({
      [`GET ${BASE}/projects/acme%2Fshop/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100`]:
        { json: [] },
    });
    const made = createCollector(
      'gitlab',
      {
        // A merge request from a fork runs in the fork's project; its target is the one to ask.
        CI_MERGE_REQUEST_PROJECT_PATH: 'acme/shop',
        CI_PROJECT_PATH: 'someone/shop-fork',
        GITLAB_TOKEN: 'fallback',
        CI_API_V4_URL: BASE,
      },
      { budget: new RequestBudget(5), fetch: api.fetch },
    );
    expect(made.collector?.repository).toBe('acme/shop');
    await made.collector?.recent(1);
    expect(api.calls.map((c) => c.headers['PRIVATE-TOKEN'])).toEqual(['fallback']);
    expect(
      createCollector(
        'gitlab',
        { CI_PROJECT_PATH: 'acme/shop', GITLAB_TOKEN: 'a', COVI_GITLAB_TOKEN: 'b' },
        { budget: new RequestBudget(1), repository: 'acme/api' },
      ).collector?.repository,
    ).toBe('acme/api');
  });

  it('passes the configured GitLab bot user on', async () => {
    const api = fixtureFetch(
      { ...merged, ...personalToken, [BOT]: { fixture: 'gitlab/user.json' } },
      replace,
    );
    const made = createCollector(
      'gitlab',
      { CI_PROJECT_PATH: 'acme/shop', COVI_GITLAB_TOKEN: 't', CI_API_V4_URL: BASE },
      { budget: new RequestBudget(20), fetch: api.fetch, gitlabBotUser: 'project_5_bot_covi' },
    );
    expect((await made.collector!.collect(12)).comment?.id).toBe('901');
  });

  it("asks GitLab CI's own API, else gitlab.com", async () => {
    const list = (base: string) =>
      `GET ${base}/projects/acme%2Fshop/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100`;
    const api = fixtureFetch({
      [list(BASE)]: { json: [] },
      [list('https://gitlab.com/api/v4')]: { json: [] },
    });
    const env = { CI_PROJECT_PATH: 'acme/shop', COVI_GITLAB_TOKEN: 't' };
    const options = { budget: new RequestBudget(5), fetch: api.fetch };
    await createCollector('gitlab', { ...env, CI_API_V4_URL: BASE }, options).collector?.recent(1);
    await createCollector('gitlab', env, options).collector?.recent(1);
    expect(api.calls.map((c) => new URL(c.url).origin)).toEqual([
      'https://gitlab.example',
      'https://gitlab.com',
    ]);
  });

  it("reads the configured bot's comment on GitHub", async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/repos/acme/shop/pulls/8': { fixture: 'github/pull-8-open.json' },
      'GET https://api.github.com/repos/acme/shop/issues/8/comments?per_page=100': {
        json: [
          {
            id: 501,
            body: `<!-- covi:review -->\n${renderLedger(ledger)}`,
            created_at: '2026-10-01T09:00:00Z',
            user: { login: 'covi-app[bot]', id: 900, type: 'Bot' },
          },
        ],
      },
      'GET https://api.github.com/user': { fixture: 'github/user.json' },
    });
    const env = { GITHUB_REPOSITORY: 'acme/shop', GITHUB_TOKEN: 't' };
    const collect = (botLogin?: string) =>
      createCollector('github', env, {
        budget: new RequestBudget(10),
        fetch: api.fetch,
        botLogin,
      }).collector!.collect(8);
    expect((await collect('covi-app[bot]')).comment?.id).toBe('501');
    expect((await collect()).comment).toBeUndefined();
  });
});
