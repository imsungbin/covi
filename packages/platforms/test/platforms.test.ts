import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anchorMarker, COMMENT_MARKER, type Finding, normalizeFinding } from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotations,
  codeQualityReport,
  createPublisher,
  dotenvReport,
  escapeProperty,
  GitHubClient,
  GitHubPublisher,
  GitLabPublisher,
  githubContext,
  gitlabContext,
  resolvePullRequest,
  toSarif,
  writeOutputs,
} from '../src/index.ts';
import { artifactFileBase } from '../src/links.ts';
import type { PlatformContext } from '../src/types.ts';
import { fixtureFetch, type Reply } from './fixtures.ts';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const finding = (over: Partial<Finding> = {}): Finding =>
  normalizeFinding(
    {
      title: 'Removed export still used',
      certainty: 'likely',
      severity: 'high',
      category: 'api-compatibility',
      evidence: 'src/a.ts:3',
      explanation: 'Imports break, at runtime: 100%',
      location: { path: 'src/a,b.ts', line: 3 },
      ...over,
    },
    { kind: 'rule', id: 'removed-export-still-referenced' },
  );

/** A tiny fake HTTP API: records requests and replies from a route table. */
function fakeApi(routes: Record<string, (body: unknown) => [number, unknown]>) {
  const calls: Array<{
    method: string;
    url: string;
    body: unknown;
    headers: Record<string, string>;
  }> = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body, headers: init.headers as Record<string, string> });
    const key = Object.keys(routes).find((k) => new RegExp(`^${k}`).test(`${method} ${url}`));
    if (!key) return new Response('not found', { status: 404 });
    const [status, json] = routes[key]!(body);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

describe('GitHub', () => {
  function event(payload: object, name = 'pull_request') {
    dir = mkdtempSync(join(tmpdir(), 'covi-gh-'));
    const path = join(dir, 'event.json');
    writeFileSync(path, JSON.stringify(payload));
    return {
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: name,
      GITHUB_EVENT_PATH: path,
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '42',
      GITHUB_SERVER_URL: 'https://github.com',
    };
  }
  const pr = (fork: boolean) => ({
    pull_request: {
      number: 7,
      title: 'fix: cart totals',
      body: 'Fixes #3',
      html_url: 'https://github.com/acme/shop/pull/7',
      base: { sha: 'aaa', ref: 'main', repo: { full_name: 'acme/shop' } },
      head: {
        sha: 'bbb',
        ref: 'fix/totals',
        repo: { full_name: fork ? 'someone/shop' : 'acme/shop' },
      },
    },
  });

  it('maps pull request events onto change inputs', async () => {
    const ctx = await githubContext(event(pr(false)));
    expect(ctx).toMatchObject({
      platform: 'github',
      base: 'aaa',
      head: 'bbb',
      trusted: true,
      allowExecution: true,
      source: { kind: 'pull-request', number: 7 },
    });
    expect(ctx.metadata).toMatchObject({
      title: 'fix: cart totals',
      number: 7,
      fromFork: false,
      sourceBranch: 'fix/totals',
    });
    expect(ctx.links.run).toBe('https://github.com/acme/shop/actions/runs/42');
  });

  it('distrusts forks and refuses to execute project code under pull_request_target', async () => {
    expect((await githubContext(event(pr(true)))).trusted).toBe(false);
    const target = await githubContext(event(pr(false), 'pull_request_target'));
    expect(target).toMatchObject({ trusted: false, allowExecution: false });
    expect(target.notes.join(' ')).toMatch(/pull_request_target/);
  });

  it('maps push events and ignores the all-zero before SHA', async () => {
    expect(await githubContext(event({ before: 'ccc', after: 'ddd' }, 'push'))).toMatchObject({
      base: 'ccc',
      head: 'ddd',
    });
    expect(
      (
        await githubContext(
          event({ before: '0000000000000000000000000000000000000000', after: 'ddd' }, 'push'),
        )
      ).base,
    ).toBeUndefined();
  });

  it('trusts the checkout of scheduled, dispatched, and pushed runs on the default branch only', async () => {
    const repository = { default_branch: 'main' };
    const trusted = async (payload: object, name: string, env: NodeJS.ProcessEnv = {}) =>
      (await githubContext({ ...event(payload, name), ...env })).trustedCheckout === true;
    // A schedule's payload names no ref; GitHub sets GITHUB_REF to the default branch.
    expect(await trusted({ repository }, 'schedule', { GITHUB_REF: 'refs/heads/main' })).toBe(true);
    expect(await trusted({ repository }, 'schedule')).toBe(false);
    expect(await trusted({}, 'schedule', { GITHUB_REF: 'refs/heads/main' })).toBe(false);
    expect(await trusted({ repository, ref: 'refs/heads/main' }, 'workflow_dispatch')).toBe(true);
    // Anyone who can dispatch can pick their own branch, and with it the bot names it configures.
    expect(await trusted({ repository, ref: 'refs/heads/topic' }, 'workflow_dispatch')).toBe(false);
    expect(await trusted({ repository, ref: 'refs/heads/main', after: 'ddd' }, 'push')).toBe(true);
    expect(await trusted({ repository, ref: 'refs/heads/topic', after: 'ddd' }, 'push')).toBe(
      false,
    );
    expect(await trusted({ ref: 'refs/heads/main', after: 'ddd' }, 'push')).toBe(false);
    expect(await trusted(pr(false), 'pull_request')).toBe(false);
    expect(await trusted(pr(false), 'pull_request_target')).toBe(false);
    const run = { head_sha: 'eee', head_branch: 'main', pull_requests: [{ number: 7 }] };
    expect(await trusted({ workflow_run: run }, 'workflow_run')).toBe(false);
  });

  it('creates the comment once, then updates it in place', async () => {
    let stored: Array<{ id: number; body: string; html_url: string; user: object }> = [];
    const api = fakeApi({
      'GET https://api.github.com/user': () => [
        403,
        { message: 'Resource not accessible by integration' },
      ],
      'GET https://api.github.com/repos/acme/shop/issues/7/comments': () => [200, stored],
      'POST https://api.github.com/repos/acme/shop/issues/7/comments': (b) => {
        stored = [
          {
            id: 1,
            body: (b as { body: string }).body,
            html_url: 'https://x/1',
            user: { login: 'github-actions[bot]', id: 41898282, type: 'Bot' },
          },
        ];
        return [201, stored[0]];
      },
      'PATCH https://api.github.com/repos/acme/shop/issues/comments/1': () => [
        200,
        { html_url: 'https://x/1' },
      ],
    });
    const publisher = new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      fetch: api.fetchImpl,
    });
    expect(await publisher.upsertComment(`${COMMENT_MARKER}\nfirst`)).toMatchObject({
      status: 'created',
    });
    expect(await publisher.upsertComment(`${COMMENT_MARKER}\nsecond`)).toMatchObject({
      status: 'updated',
    });
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET', 'GET', 'PATCH']);
    expect(api.calls[1]!.headers.authorization).toBe('Bearer t');
  });

  it('turns permission errors into a readable failure instead of throwing', async () => {
    const api = fakeApi({
      'GET ': () => [403, { message: 'Resource not accessible by integration' }],
    });
    const outcome = await new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      fetch: api.fetchImpl,
    }).upsertComment('x');
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toMatch(/pull-requests: write/);
  });

  it('writes escaped annotations, capped per level', () => {
    const lines = annotations([
      finding(),
      ...Array.from({ length: 12 }, (_, i) =>
        finding({
          title: `Note ${i}`,
          severity: 'medium',
          location: { path: `f${i}.ts`, line: i + 1 },
        }),
      ),
    ]);
    expect(lines[0]).toBe(
      '::error file=src/a%2Cb.ts,title=Covi · Likely issue%3A Removed export still used,line=3::Imports break, at runtime: 100%25',
    );
    expect(lines.filter((l) => l.startsWith('::warning')).length).toBe(10);
    expect(escapeProperty('a:b,c\nd')).toBe('a%3Ab%2Cc%0Ad');
  });

  it('writes multiline step outputs safely', async () => {
    dir = mkdtempSync(join(tmpdir(), 'covi-out-'));
    const file = join(dir, 'out');
    writeFileSync(file, '');
    await writeOutputs(file, { verdict: 'looks-good', summary: 'a\nb', skip: undefined });
    const text = readFileSync(file, 'utf8');
    expect(text).toMatch(/^verdict=looks-good\nsummary<<COVI_EOF_\w+\na\nb\nCOVI_EOF_\w+\n$/);
  });
  it("prefers the bot's comment over a pasted marker, and returns the comment's id", async () => {
    const api = fakeApi({
      'GET https://api.github.com/user': () => [
        403,
        { message: 'Resource not accessible by integration' },
      ],
      'GET https://api.github.com/repos/acme/shop/issues/7/comments': () => [
        200,
        [
          {
            id: 5,
            body: `${COMMENT_MARKER} pasted`,
            html_url: 'https://x/5',
            user: { login: 'author', type: 'User' },
          },
          {
            id: 6,
            body: `${COMMENT_MARKER} real`,
            html_url: 'https://x/6',
            user: { login: 'github-actions[bot]', type: 'Bot' },
          },
        ],
      ],
      'PATCH https://api.github.com/repos/acme/shop/issues/comments/6': () => [
        200,
        { id: 6, html_url: 'https://x/6' },
      ],
    });
    const publisher = new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      fetch: api.fetchImpl,
    });
    expect(publisher.target).toEqual({ repository: 'acme/shop', number: 7 });
    const existing = await publisher.findComment();
    expect(existing).toEqual({ id: '6', body: `${COMMENT_MARKER} real`, url: 'https://x/6' });
    expect(await publisher.upsertComment(`${COMMENT_MARKER}\nnew`, existing)).toEqual({
      status: 'updated',
      id: '6',
      url: 'https://x/6',
    });
    // Given the comment it found, upsertComment does not list the comments again.
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PATCH']);
  });

  const comments =
    'GET https://api.github.com/repos/acme/shop/issues/7/comments?per_page=100&page=1';
  const whoami = 'GET https://api.github.com/user';
  const publisherWith = (fetch: ReturnType<typeof fixtureFetch>['fetch']) =>
    new GitHubPublisher({ token: 't', repository: 'acme/shop', number: 7, fetch });

  it("never takes over a person's comment that carries the marker", async () => {
    // The workflow token cannot read /user, so only a bot's comment could be Covi's.
    const api = fixtureFetch(
      {
        [comments]: { fixture: 'github/issue-comments-not-covi.json' },
        [whoami]: { status: 403, fixture: 'github/user-forbidden.json' },
        'POST https://api.github.com/repos/acme/shop/issues/7/comments': {
          status: 201,
          json: { id: 103, html_url: 'https://github.com/acme/shop/pull/7#issuecomment-103' },
        },
      },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    const publisher = publisherWith(api.fetch);
    const existing = await publisher.findComment();
    expect(existing).toBeNull();
    // null means "looked, found none": the comments are not listed a second time.
    expect(await publisher.upsertComment(`${COMMENT_MARKER}\nnew`, existing)).toMatchObject({
      status: 'created',
      id: '103',
    });
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      comments,
      whoami,
      'POST https://api.github.com/repos/acme/shop/issues/7/comments',
    ]);
  });

  it("takes the token's own comment, by user id, when the token is a person's", async () => {
    const api = fixtureFetch(
      {
        [comments]: { fixture: 'github/issue-comments-not-covi.json' },
        [whoami]: { fixture: 'github/user.json' },
      },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    expect(await publisherWith(api.fetch).findComment()).toEqual({
      id: '102',
      body: `${COMMENT_MARKER}\nPosted with a personal access token.`,
      url: 'https://github.com/acme/shop/pull/7#issuecomment-102',
    });
  });

  it('posts each anchor once, and skips a line GitHub does not show in the diff', async () => {
    const posted: unknown[] = [];
    const api = fakeApi({
      'GET https://api.github.com/user': () => [
        403,
        { message: 'Resource not accessible by integration' },
      ],
      'GET https://api.github.com/repos/acme/shop/pulls/7/comments': () => [
        200,
        [
          {
            id: 1,
            body: `${anchorMarker('aaaaaaaaaaaa')}\nold`,
            user: { login: 'github-actions[bot]', type: 'Bot' },
          },
        ],
      ],
      'POST https://api.github.com/repos/acme/shop/pulls/7/comments': (b) => {
        posted.push(b);
        return (b as { line: number }).line === 99
          ? [422, { message: 'pull_request_review_thread.line must be part of the diff' }]
          : [201, { id: 10 + posted.length }];
      },
    });
    const publisher = new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      fetch: api.fetchImpl,
    });
    const head = 'f'.repeat(40);
    const outcome = await publisher.postAnchors(
      [
        { key: 'aaaaaaaaaaaa', path: 'src/a.ts', line: 3, body: 'a' },
        { key: 'bbbbbbbbbbbb', path: 'src/b.ts', line: 4, body: 'b' },
        { key: 'cccccccccccc', path: 'src/c.ts', line: 99, body: 'c' },
      ],
      head,
    );
    expect(outcome).toEqual({
      posted: [{ key: 'bbbbbbbbbbbb', id: '11' }],
      existing: 1,
      skipped: [{ key: 'cccccccccccc', reason: 'the line is not part of the diff GitHub shows' }],
    });
    expect(posted[0]).toEqual({
      body: 'b',
      commit_id: head,
      path: 'src/b.ts',
      line: 4,
      side: 'RIGHT',
    });
  });

  it("does not count a person's or another app's anchor marker as Covi's anchor", async () => {
    const review = 'https://api.github.com/repos/acme/shop/pulls/7/comments';
    const api = fixtureFetch(
      {
        [`GET ${review}?per_page=100&page=1`]: { fixture: 'github/review-comments.json' },
        [whoami]: { status: 403, fixture: 'github/user-forbidden.json' },
        [`POST ${review}`]: { status: 201, json: { id: 203 } },
      },
      {
        '{{ANCHOR_A}}': anchorMarker('aaaaaaaaaaaa'),
        '{{ANCHOR_B}}': anchorMarker('bbbbbbbbbbbb'),
        '{{ANCHOR_C}}': anchorMarker('cccccccccccc'),
      },
    );
    const outcome = await publisherWith(api.fetch).postAnchors(
      [
        { key: 'aaaaaaaaaaaa', path: 'src/a.ts', line: 3, body: 'a' },
        { key: 'bbbbbbbbbbbb', path: 'src/b.ts', line: 4, body: 'b' },
        { key: 'cccccccccccc', path: 'src/c.ts', line: 5, body: 'c' },
      ],
      'f'.repeat(40),
    );
    expect(outcome).toEqual({
      posted: [
        { key: 'bbbbbbbbbbbb', id: '203' },
        { key: 'cccccccccccc', id: '203' },
      ],
      existing: 1,
      skipped: [],
    });
  });
  it("accepts a bot's comment only when the token has no user, and only Covi's bot by login", async () => {
    const routes = (user: Reply) =>
      fixtureFetch(
        {
          [comments]: { fixture: 'github/issue-comments-foreign-bot.json' },
          [whoami]: user,
          'POST https://api.github.com/repos/acme/shop/issues/7/comments': {
            status: 201,
            json: { id: 114 },
          },
        },
        { '{{MARKER}}': COMMENT_MARKER },
      );
    const forbidden = { status: 403, fixture: 'github/user-forbidden.json' };
    // The workflow token posts as github-actions[bot]; another app quoting the marker is not Covi.
    expect((await publisherWith(routes(forbidden).fetch).findComment())?.id).toBe('112');
    const app = new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      botLogin: 'covi-app[bot]',
      fetch: routes(forbidden).fetch,
    });
    expect((await app.findComment())?.id).toBe('113');
    // A token whose bot is none of these finds nothing and posts its own comment.
    const stranger = routes(forbidden);
    const other = new GitHubPublisher({
      token: 't',
      repository: 'acme/shop',
      number: 7,
      botLogin: 'other-app[bot]',
      fetch: stranger.fetch,
    });
    expect(await other.upsertComment(`${COMMENT_MARKER}\nnew`)).toMatchObject({
      status: 'created',
      id: '114',
    });
    expect(stranger.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'POST']);
    // A token that names its user trusts only that user's comments, never a bot's.
    const named = routes({ fixture: 'github/user.json' });
    expect(await publisherWith(named.fetch).findComment()).toBeNull();
  });

  it('names the botLogin to set when an app token finds Covi comments by another bot', async () => {
    // An app token (it cannot read /user) left at the default bot: Covi's earlier comments were
    // posted as the app, so it comments anew and says how to update the old one instead.
    const api = fixtureFetch({
      [comments]: {
        json: [
          {
            id: 111,
            body: `> ${COMMENT_MARKER}\n> Quoted back by another app.`,
            user: { login: 'some-app[bot]', id: 900, type: 'Bot' },
          },
          {
            id: 113,
            body: `${COMMENT_MARKER}\nPosted by Covi's own app.`,
            user: { login: 'my-covi-app[bot]', id: 901, type: 'Bot' },
          },
        ],
      },
      [whoami]: { status: 403, fixture: 'github/user-forbidden.json' },
      'POST https://api.github.com/repos/acme/shop/issues/7/comments': {
        status: 201,
        json: { id: 114 },
      },
    });
    const outcome = await publisherWith(api.fetch).upsertComment(`${COMMENT_MARKER}\nnew`);
    expect(outcome).toMatchObject({ status: 'created', id: '114' });
    expect(outcome.warnings).toEqual([
      "Covi's earlier comment here was posted by my-covi-app[bot], not github-actions[bot], so this token cannot update it and posted a new one. If Covi runs as that GitHub App, set `publish.botLogin: my-covi-app[bot]` in .covi/config.yml.",
    ]);
    // Only a comment that starts with the marker looks like Covi's; a quote names no bot.
    const quoted = fixtureFetch({
      [comments]: {
        json: [
          {
            id: 111,
            body: `> ${COMMENT_MARKER}`,
            user: { login: 'some-app[bot]', id: 900, type: 'Bot' },
          },
        ],
      },
      [whoami]: { status: 403, fixture: 'github/user-forbidden.json' },
      'POST https://api.github.com/repos/acme/shop/issues/7/comments': {
        status: 201,
        json: { id: 114 },
      },
    });
    expect(
      (await publisherWith(quoted.fetch).upsertComment(`${COMMENT_MARKER}\nnew`)).warnings,
    ).toBeUndefined();
  });

  it('fails the publish when /user fails for a moment, and asks again next time', async () => {
    const api = fixtureFetch(
      {
        [comments]: { fixture: 'github/issue-comments-foreign-bot.json' },
        [whoami]: [
          { status: 502, json: { message: 'Bad gateway' } },
          { status: 403, fixture: 'github/user-forbidden.json' },
        ],
        'PATCH https://api.github.com/repos/acme/shop/issues/comments/112': {
          json: { id: 112, html_url: 'https://github.com/acme/shop/pull/7#issuecomment-112' },
        },
      },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    const publisher = publisherWith(api.fetch);
    const failed = await publisher.upsertComment(`${COMMENT_MARKER}\nnew`);
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.reason).toMatch(/HTTP 502 for \/user/);
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(await publisher.upsertComment(`${COMMENT_MARKER}\nnew`)).toMatchObject({
      status: 'updated',
      id: '112',
    });
  });

  it('never follows a redirect, and names the request when a body is not JSON', async () => {
    const moved = fixtureFetch({
      [comments]: { status: 302, headers: { location: 'https://evil.example/steal' } },
    });
    const outcome = await publisherWith(moved.fetch).upsertComment(`${COMMENT_MARKER}\nnew`);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.reason).toMatch(/HTTP 302/);
    expect(moved.calls.map((c) => [new URL(c.url).origin, c.redirect])).toEqual([
      ['https://api.github.com', 'manual'],
    ]);
    const cut = fixtureFetch({ [comments]: { fixture: 'github/truncated.txt' } });
    const broken = await publisherWith(cut.fetch).upsertComment(`${COMMENT_MARKER}\nnew`);
    expect(broken.reason).toBe(
      'GitHub sent a body that is not JSON for /repos/acme/shop/issues/7/comments',
    );
  });

  it('reads pull request lookups through the bounded reader, and says why one failed', async () => {
    const api = fixtureFetch({
      'GET https://api.github.com/repos/acme/shop/pulls/7': { fixture: 'github/truncated.txt' },
      'GET https://api.github.com/repos/acme/shop/pulls?state=open&head=fork%3Afix&per_page=100': {
        fixture: 'github/truncated.txt',
      },
    });
    const client = new GitHubClient({ token: 't', fetch: api.fetch });
    expect(
      await resolvePullRequest(client, 'acme/shop', {
        metadata: { platform: 'github', number: 7 },
        expectedHead: 'a'.repeat(40),
      }),
    ).toEqual({ reason: 'GitHub sent a body that is not JSON for /repos/acme/shop/pulls/7' });
    expect(
      await resolvePullRequest(client, 'acme/shop', {
        metadata: { platform: 'github' },
        pullRequestHead: { owner: 'fork', branch: 'fix', sha: 'a'.repeat(40) },
      }),
    ).toEqual({ reason: 'GitHub sent a body that is not JSON for /repos/acme/shop/pulls' });
  });

  it('posts at most 10 anchors in one run', async () => {
    const review = 'https://api.github.com/repos/acme/shop/pulls/7/comments';
    const api = fixtureFetch({
      [`GET ${review}?per_page=100&page=1`]: { json: [] },
      [`POST ${review}`]: { status: 201, json: { id: 1 } },
    });
    const drafts = Array.from({ length: 12 }, (_, i) => ({
      key: i.toString(16).padStart(12, '0'),
      path: 'src/a.ts',
      line: i + 1,
      body: `anchor ${i}`,
    }));
    const outcome = await publisherWith(api.fetch).postAnchors(drafts, 'f'.repeat(40));
    expect(outcome.posted).toHaveLength(10);
    expect(outcome.skipped).toEqual([
      { key: '00000000000a', reason: 'only 10 anchors are posted per run' },
      { key: '00000000000b', reason: 'only 10 anchors are posted per run' },
    ]);
    expect(api.calls.filter((c) => c.method === 'POST')).toHaveLength(10);
  });
});

describe('GitLab', () => {
  const mrEnv = {
    GITLAB_CI: 'true',
    CI_PIPELINE_SOURCE: 'merge_request_event',
    CI_MERGE_REQUEST_IID: '12',
    CI_MERGE_REQUEST_DIFF_BASE_SHA: 'base1',
    CI_COMMIT_SHA: 'merge1',
    CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'head1',
    CI_MERGE_REQUEST_TITLE: 'feat: export',
    CI_MERGE_REQUEST_PROJECT_ID: '5',
    CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '5',
    CI_MERGE_REQUEST_PROJECT_URL: 'https://gitlab.example/acme/shop',
    CI_API_V4_URL: 'https://gitlab.example/api/v4',
    CI_JOB_URL: 'https://gitlab.example/acme/shop/-/jobs/9',
  };

  it('uses the merge base and the real source SHA (not the merged-results commit)', () => {
    const ctx = gitlabContext(mrEnv);
    expect(ctx).toMatchObject({
      base: 'base1',
      head: 'head1',
      trusted: true,
      source: { kind: 'merge-request', number: 12 },
    });
    expect(ctx.metadata.url).toBe('https://gitlab.example/acme/shop/-/merge_requests/12');
  });

  it('trusts the checkout of scheduled, web, API, and pushed pipelines on the default branch only', () => {
    const branch = { GITLAB_CI: 'true', CI_DEFAULT_BRANCH: 'main', CI_COMMIT_SHA: 'c1' };
    const trusted = (env: NodeJS.ProcessEnv) => gitlabContext(env).trustedCheckout === true;
    for (const source of ['schedule', 'web', 'api']) {
      expect(trusted({ ...branch, CI_PIPELINE_SOURCE: source, CI_COMMIT_BRANCH: 'main' })).toBe(
        true,
      );
      // A pipeline someone starts on their own branch reads that branch's bot names.
      expect(trusted({ ...branch, CI_PIPELINE_SOURCE: source, CI_COMMIT_BRANCH: 'topic' })).toBe(
        false,
      );
      // A tag named like the default branch is not the branch.
      expect(
        trusted({
          ...branch,
          CI_PIPELINE_SOURCE: source,
          CI_COMMIT_REF_NAME: 'main',
          CI_COMMIT_TAG: 'main',
        }),
      ).toBe(false);
    }
    expect(trusted({ ...branch, CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'main' })).toBe(true);
    expect(trusted({ ...branch, CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'topic' })).toBe(
      false,
    );
    expect(trusted({ ...branch, CI_PIPELINE_SOURCE: 'trigger', CI_COMMIT_BRANCH: 'main' })).toBe(
      false,
    );
    expect(trusted(mrEnv)).toBe(false);
  });

  it('detects fork merge requests', () => {
    expect(gitlabContext({ ...mrEnv, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '99' }).trusted).toBe(
      false,
    );
  });

  it('creates or updates the note, and uploads videos', async () => {
    let notes: Array<{ id: number; body: string; system: boolean; author: { id: number } }> = [
      { id: 3, body: 'system note', system: true, author: { id: 1 } },
    ];
    const api = fakeApi({
      'GET https://gitlab.example/api/v4/user': () => [200, { id: 50, username: 'covi-bot' }],
      'GET https://gitlab.example/api/v4/projects/5/merge_requests/12/notes': () => [200, notes],
      'POST https://gitlab.example/api/v4/projects/5/merge_requests/12/notes': (b) => {
        notes = [
          ...notes,
          { id: 4, body: (b as { body: string }).body, system: false, author: { id: 50 } },
        ];
        return [201, { id: 4 }];
      },
      'PUT https://gitlab.example/api/v4/projects/5/merge_requests/12/notes/4': () => [200, {}],
      'POST https://gitlab.example/api/v4/projects/5/uploads': () => [
        201,
        {
          url: '/uploads/abc/v.mp4',
          full_path: '/acme/shop/uploads/abc/v.mp4',
          markdown: '![v](/uploads/abc/v.mp4)',
        },
      ],
    });
    const publisher = new GitLabPublisher({
      apiUrl: mrEnv.CI_API_V4_URL,
      projectId: '5',
      iid: 12,
      token: 'glpat',
      fetch: api.fetchImpl,
    });
    expect(await publisher.upsertComment(`${COMMENT_MARKER} one`)).toMatchObject({
      status: 'created',
      id: '4',
    });
    expect(publisher.target).toEqual({ repository: '5', number: 12 });
    expect(await publisher.findComment()).toMatchObject({ id: '4', body: `${COMMENT_MARKER} one` });
    expect(await publisher.upsertComment(`${COMMENT_MARKER} two`)).toMatchObject({
      status: 'updated',
    });
    expect(api.calls[1]!.headers['PRIVATE-TOKEN']).toBe('glpat');
    dir = mkdtempSync(join(tmpdir(), 'covi-gl-'));
    writeFileSync(join(dir, 'v.mp4'), 'video');
    expect(await publisher.uploadFile(join(dir, 'v.mp4'))).toEqual({
      url: '/acme/shop/uploads/abc/v.mp4',
      markdown: '![v](/uploads/abc/v.mp4)',
    });
  });

  it("takes only the token's own note, never a person's pasted marker", async () => {
    const notes =
      'GET https://gitlab.example/api/v4/projects/5/merge_requests/12/notes?per_page=100&page=1&sort=desc&order_by=created_at';
    const whoami = 'GET https://gitlab.example/api/v4/user';
    const publisher = (fetch: ReturnType<typeof fixtureFetch>['fetch']) =>
      new GitLabPublisher({
        apiUrl: mrEnv.CI_API_V4_URL,
        projectId: '5',
        projectPath: 'acme/shop',
        iid: 12,
        token: 'glpat',
        fetch,
      });
    const own = fixtureFetch(
      { [notes]: { fixture: 'gitlab/notes.json' }, [whoami]: { fixture: 'gitlab/user.json' } },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    const found = publisher(own.fetch);
    expect(found.target).toEqual({ repository: 'acme/shop', number: 12 });
    expect(await found.findComment()).toEqual({
      id: '30',
      body: `${COMMENT_MARKER}\nPosted by Covi.`,
    });

    // A token that cannot say who it is cannot tell Covi's note from a pasted one.
    const unknown = fixtureFetch(
      {
        [notes]: { fixture: 'gitlab/notes.json' },
        [whoami]: { status: 401, fixture: 'gitlab/user-unauthorized.json' },
      },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    expect(await publisher(unknown.fetch).findComment()).toBeNull();
  });

  it('fails when /user fails for a moment, and never follows a redirect', async () => {
    const notes =
      'GET https://gitlab.example/api/v4/projects/5/merge_requests/12/notes?per_page=100&page=1&sort=desc&order_by=created_at';
    const api = fixtureFetch(
      {
        [notes]: { fixture: 'gitlab/notes.json' },
        'GET https://gitlab.example/api/v4/user': [
          { status: 500, json: { message: '500 Internal Server Error' } },
          { fixture: 'gitlab/user.json' },
        ],
      },
      { '{{MARKER}}': COMMENT_MARKER },
    );
    const publisher = new GitLabPublisher({
      apiUrl: mrEnv.CI_API_V4_URL,
      projectId: '5',
      iid: 12,
      token: 'glpat',
      fetch: api.fetch,
    });
    await expect(publisher.findComment()).rejects.toThrow(/HTTP 500 for \/api\/v4\/user/);
    expect((await publisher.findComment())?.id).toBe('30');

    const moved = fixtureFetch({
      [notes]: { status: 302, headers: { location: 'https://evil.example/steal' } },
    });
    const outcome = await new GitLabPublisher({
      apiUrl: mrEnv.CI_API_V4_URL,
      projectId: '5',
      iid: 12,
      token: 'glpat',
      fetch: moved.fetch,
    }).upsertComment(`${COMMENT_MARKER} one`);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(moved.calls).toHaveLength(1);
    expect([...api.calls, ...moved.calls].every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('produces Code Quality and dotenv reports', () => {
    const [entry] = codeQualityReport([finding()]) as Array<Record<string, unknown>>;
    expect(entry).toMatchObject({
      check_name: 'removed-export-still-referenced',
      severity: 'critical',
      location: { path: 'src/a,b.ts', lines: { begin: 3 } },
    });
    expect(String(entry!.fingerprint)).toHaveLength(32);
    expect(dotenvReport({ COVI_VERDICT: 'needs-changes', X: undefined, Y: 'a\nb' })).toBe(
      'COVI_VERDICT=needs-changes\nY=a b\n',
    );
  });
});

describe('publishing prerequisites', () => {
  it('explains why it cannot publish', () => {
    const local = {
      platform: 'local' as const,
      ci: false,
      metadata: {},
      fetch: false,
      trusted: true,
      allowExecution: true,
      links: {},
      notes: [],
    };
    expect(createPublisher(local, {}).reason).toMatch(/not running in GitHub Actions or GitLab CI/);
    const gh = { ...local, platform: 'github' as const, metadata: { number: 7 } };
    expect(createPublisher(gh, { GITHUB_REPOSITORY: 'a/b' }).reason).toMatch(/no GitHub token/);
    expect(
      createPublisher(gh, { GITHUB_REPOSITORY: 'a/b', GITHUB_TOKEN: 't' }).publisher?.platform,
    ).toBe('github');
    const gl = { ...local, platform: 'gitlab' as const, metadata: { number: 3 } };
    expect(createPublisher(gl, { CI_PROJECT_ID: '1', CI_API_V4_URL: 'x' }).reason).toMatch(
      /COVI_GITLAB_TOKEN/,
    );
  });
});

describe('SARIF', () => {
  it('emits SARIF 2.1.0 results with rules and locations', () => {
    const sarif = toSarif(
      [
        finding(),
        finding({
          certainty: 'question',
          severity: 'low',
          location: undefined,
          title: 'Question about intent',
        }),
      ],
      '1.0.0',
    ) as {
      version: string;
      runs: Array<{
        tool: { driver: { rules: unknown[] } };
        results: Array<{ level: string; locations: unknown[] }>;
      }>;
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]!.tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0]!.results.map((r) => r.level)).toEqual(['error', 'note']);
    expect(sarif.runs[0]!.results[1]!.locations).toEqual([]);
  });
});

describe('artifactFileBase', () => {
  const gitlab = {
    platform: 'gitlab',
    links: { job: 'https://gitlab.example/acme/shop/-/jobs/9' },
  } as PlatformContext;

  it('serves GitLab job artifacts file by file, and nothing on GitHub', () => {
    expect(
      artifactFileBase(
        gitlab,
        { CI_PROJECT_DIR: '/builds/acme/shop' },
        '/builds/acme/shop/.covi/run',
      ),
    ).toBe('https://gitlab.example/acme/shop/-/jobs/9/artifacts/file/.covi/run/');
    expect(
      artifactFileBase(gitlab, { CI_PROJECT_DIR: '/builds/acme/shop' }, '/builds/acme/shop'),
    ).toBe('https://gitlab.example/acme/shop/-/jobs/9/artifacts/file/');
    expect(
      artifactFileBase(gitlab, { CI_PROJECT_DIR: '/builds/acme/shop' }, '/tmp/elsewhere'),
    ).toBeUndefined();
    expect(artifactFileBase(gitlab, {}, '/builds/acme/shop/run')).toBeUndefined();
    expect(
      artifactFileBase(
        { ...gitlab, platform: 'github' } as PlatformContext,
        { CI_PROJECT_DIR: '/b' },
        '/b/run',
      ),
    ).toBeUndefined();
  });
});
