import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMENT_MARKER, type Finding, normalizeFinding } from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotations,
  codeQualityReport,
  createPublisher,
  dotenvReport,
  escapeProperty,
  GitHubPublisher,
  GitLabPublisher,
  githubContext,
  gitlabContext,
  toSarif,
  writeOutputs,
} from '../src/index.ts';

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

  it('creates the comment once, then updates it in place', async () => {
    let stored: Array<{ id: number; body: string; html_url: string }> = [];
    const api = fakeApi({
      'GET https://api.github.com/repos/acme/shop/issues/7/comments': () => [200, stored],
      'POST https://api.github.com/repos/acme/shop/issues/7/comments': (b) => {
        stored = [{ id: 1, body: (b as { body: string }).body, html_url: 'https://x/1' }];
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
    expect(api.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET', 'PATCH']);
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

  it('detects fork merge requests', () => {
    expect(gitlabContext({ ...mrEnv, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '99' }).trusted).toBe(
      false,
    );
  });

  it('creates or updates the note, and uploads videos', async () => {
    let notes: Array<{ id: number; body: string; system: boolean }> = [
      { id: 3, body: 'system note', system: true },
    ];
    const api = fakeApi({
      'GET https://gitlab.example/api/v4/projects/5/merge_requests/12/notes': () => [200, notes],
      'POST https://gitlab.example/api/v4/projects/5/merge_requests/12/notes': (b) => {
        notes = [...notes, { id: 4, body: (b as { body: string }).body, system: false }];
        return [201, {}];
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
    });
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
