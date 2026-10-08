import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listExamples, materializeExample } from '../../packages/cli/src/examples.ts';
import { GIT_ENV } from './repo.ts';

export interface Recorded {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Rollup {
  '+1': number;
  '-1': number;
}
export interface MockComment {
  id: number;
  body: string;
  /** The author as GitHub lists it. */
  user: { login: string; id?: number; type: 'Bot' | 'User' };
  /** The author as GitLab lists it. */
  author: { id: number; username: string };
  created_at: string;
  reactions: Rollup;
}
export interface MockReviewComment extends MockComment {
  path?: string;
  line?: number;
  commit_id?: string;
  side?: string;
  in_reply_to_id?: number;
}
export interface MockPull {
  number: number;
  owner: string;
  branch: string;
  sha: string;
  state?: 'open' | 'closed';
  merged_at?: string | null;
  closed_at?: string | null;
  merge_commit_sha?: string | null;
}
export interface MockApi {
  url: string;
  calls: Recorded[];
  server: Server;
  /** Issue comments (GitHub) and notes (GitLab), for every pull/merge request. */
  comments: MockComment[];
  /** Pull request review comments: finding anchors. */
  reviewComments: MockReviewComment[];
  pulls: MockPull[];
  /** Commits on main, newest first. */
  commits: Array<{ sha: string; message: string }>;
  /** Paths that answer with GitHub's primary rate limit (reset 2026-01-01T00:00:00Z). */
  limited: Set<string>;
}

/** GitHub's workflow token has no user of its own: it posts as this bot. */
export const BOT = { login: 'github-actions[bot]', id: 41898282, type: 'Bot' } as const;
/** A GitLab project access token's own bot user (`GET /api/v4/user`). */
export const GITLAB_BOT = { id: 50, username: 'project_5_bot' } as const;
const AT = '2026-10-01T09:00:00Z';

/** A local stand-in for the GitHub and GitLab REST APIs. */
export function mockApi(): Promise<MockApi> {
  const state = {
    calls: [] as Recorded[],
    comments: [] as MockComment[],
    reviewComments: [] as MockReviewComment[],
    pulls: [] as MockPull[],
    commits: [] as Array<{ sha: string; message: string }>,
    limited: new Set<string>(),
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      state.calls.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
        res
          .writeHead(status, { 'content-type': 'application/json', ...headers })
          .end(JSON.stringify(value));
      const url = new URL(req.url!, 'http://api');
      if (state.limited.has(url.pathname))
        return json(
          403,
          { message: 'API rate limit exceeded' },
          { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
        );
      // The token's own user on GitLab. GitHub's workflow token has none; it posts as a bot.
      if (req.method === 'GET' && url.pathname === '/api/v4/user') return json(200, GITLAB_BOT);
      if (req.method === 'GET' && url.pathname === '/api/v4/users/50')
        return json(200, { ...GITLAB_BOT, bot: true });
      if (req.method === 'GET' && url.pathname === '/user')
        return json(403, { message: 'Resource not accessible by integration' });
      const review = /^\/repos\/acme\/shop\/pulls\/(\d+)\/comments$/.exec(url.pathname);
      if (review && req.method === 'GET') return json(200, state.reviewComments);
      if (review && req.method === 'POST') {
        const input = JSON.parse(body) as Pick<
          MockReviewComment,
          'body' | 'path' | 'line' | 'commit_id' | 'side'
        >;
        const comment: MockReviewComment = {
          ...input,
          id: 500 + state.reviewComments.length,
          user: BOT,
          author: GITLAB_BOT,
          created_at: AT,
          reactions: { '+1': 0, '-1': 0 },
        };
        state.reviewComments.push(comment);
        return json(201, comment);
      }
      const pull = /^\/repos\/acme\/shop\/pulls(?:\/(\d+))?$/.exec(url.pathname);
      if (req.method === 'GET' && pull) {
        const shape = (p: MockPull) => ({
          number: p.number,
          state: p.state ?? 'open',
          html_url: `https://github.example/acme/shop/pull/${p.number}`,
          merged_at: p.merged_at ?? null,
          closed_at: p.closed_at ?? null,
          merge_commit_sha: p.merge_commit_sha ?? null,
          head: { sha: p.sha },
          base: { ref: 'main' },
        });
        if (pull[1]) {
          const found = state.pulls.find((p) => p.number === Number(pull[1]));
          return found ? json(200, shape(found)) : json(404, { message: 'not found' });
        }
        const head = url.searchParams.get('head');
        const wanted = url.searchParams.get('state') ?? 'open';
        return json(
          200,
          state.pulls
            .filter((p) => !head || head === `${p.owner}:${p.branch}`)
            .filter((p) => wanted === 'all' || (p.state ?? 'open') === wanted)
            .map(shape),
        );
      }
      if (req.method === 'GET' && url.pathname === '/repos/acme/shop/commits')
        return json(
          200,
          state.commits.map((c) => ({
            sha: c.sha,
            html_url: `https://github.example/acme/shop/commit/${c.sha}`,
            commit: { message: c.message },
          })),
        );
      if (req.method === 'GET' && /\/(comments|notes)/.test(url.pathname))
        return json(
          200,
          state.comments.map((c) => ({
            ...c,
            html_url: `https://example.test/c/${c.id}`,
            system: false,
          })),
        );
      if (req.method === 'POST' && /\/(comments|notes)/.test(url.pathname)) {
        const id = state.comments.length + 1;
        state.comments.push({
          id,
          body: (JSON.parse(body) as { body: string }).body,
          user: BOT,
          author: GITLAB_BOT,
          created_at: AT,
          reactions: { '+1': 0, '-1': 0 },
        });
        return json(201, { id, html_url: `https://example.test/c/${id}` });
      }
      if (
        (req.method === 'PATCH' || req.method === 'PUT') &&
        /\/(comments|notes)\/\d+$/.test(url.pathname)
      ) {
        const id = Number(/(\d+)$/.exec(url.pathname)![1]);
        state.comments.find((c) => c.id === id)!.body = (JSON.parse(body) as { body: string }).body;
        return json(200, { id, html_url: `https://example.test/c/${id}` });
      }
      json(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        ...state,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        server,
      }),
    ),
  );
}

const examples = await listExamples();

/** A real repository for an example change, on its branch, with `main` as the base. */
export async function prRepo(name: string, cleanup: string[]) {
  const dir = await materializeExample(examples.find((e) => e.name === name)!);
  cleanup.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
  return { dir, base: git('rev-parse', 'main'), head: git('rev-parse', 'HEAD'), git };
}

/** GitHub Actions' environment for a `pull_request` event (#7 on acme/shop) against the mock API. */
export function githubEnv(
  apiUrl: string,
  repo: { base: string; head: string },
  extra: NodeJS.ProcessEnv = {},
  cleanup: string[] = [],
) {
  const work = mkdtempSync(join(tmpdir(), 'covi-gha-'));
  cleanup.push(work);
  const event = join(work, 'event.json');
  writeFileSync(
    event,
    JSON.stringify({
      pull_request: {
        number: 7,
        title: 'style(pricing): refresh plan cards and highlight the popular plan',
        body: 'Adds a popular badge. @everyone <script>alert(1)</script>',
        html_url: 'https://github.example/acme/shop/pull/7',
        base: { sha: repo.base, ref: 'main', repo: { full_name: 'acme/shop' } },
        head: { sha: repo.head, ref: 'design/pricing-refresh', repo: { full_name: 'acme/shop' } },
      },
    }),
  );
  const output = join(work, 'output');
  const summary = join(work, 'summary.md');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  return {
    env: {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event,
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_RUN_ID: '1001',
      GITHUB_SERVER_URL: 'https://github.example',
      GITHUB_API_URL: apiUrl,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      ...extra,
    },
    output,
    summary,
    out: join(work, 'run'),
  };
}
