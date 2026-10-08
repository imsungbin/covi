import { appendFile, readFile } from 'node:fs/promises';
import {
  type AnchorDraft,
  anchorKeyOf,
  COMMENT_MARKER,
  type Finding,
  isBlockingCandidate,
  type Language,
  MAX_ANCHORS,
  t,
} from '@covi/core';
import { PlatformHttpError, readJson } from './http.ts';
import type {
  AnchorsOutcome,
  ExistingComment,
  FetchLike,
  PlatformContext,
  Publisher,
  PublishOutcome,
} from './types.ts';

const ZERO_SHA = /^0+$/;

interface PullRequestEvent {
  number: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  draft?: boolean;
  base: { sha: string; ref: string; repo?: { full_name?: string } };
  head: { sha: string; ref: string; repo?: { full_name?: string } | null };
}

/** Maps GitHub Actions' environment and event payload onto Covi's change inputs. */
export async function githubContext(env: NodeJS.ProcessEnv): Promise<PlatformContext> {
  const event = env.GITHUB_EVENT_NAME;
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runUrl =
    env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
      : undefined;
  const ctx: PlatformContext = {
    platform: 'github',
    ci: true,
    event,
    metadata: { platform: 'github' },
    fetch: true,
    trusted: true,
    allowExecution: true,
    links: { run: runUrl, artifacts: runUrl ? `${runUrl}#artifacts` : undefined },
    notes: [],
  };
  let payload: Record<string, unknown> = {};
  if (env.GITHUB_EVENT_PATH) {
    payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8').catch(() => '{}')) as Record<
      string,
      unknown
    >;
  }
  const pr = payload.pull_request as PullRequestEvent | undefined;
  if (
    pr &&
    (event === 'pull_request' || event === 'pull_request_target' || event === 'pull_request_review')
  ) {
    const fromFork = Boolean(
      pr.head.repo?.full_name &&
        pr.base.repo?.full_name &&
        pr.head.repo.full_name !== pr.base.repo.full_name,
    );
    ctx.base = pr.base.sha;
    ctx.head = pr.head.sha;
    ctx.metadata = {
      platform: 'github',
      title: pr.title,
      description: pr.body ?? undefined,
      url: pr.html_url,
      number: pr.number,
      fromFork,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
    };
    ctx.source = { kind: 'pull-request', platform: 'github', number: pr.number, url: pr.html_url };
    ctx.trusted = !fromFork;
    if (fromFork)
      ctx.notes.push(
        'Pull request from a fork: the workflow token is read-only, so posting a comment will be skipped.',
      );
    if (event === 'pull_request_target') {
      ctx.notes.push(
        'pull_request_target runs with write permissions and secrets. Covi analyzes the diff but will not run project commands from the pull request here.',
      );
      ctx.trusted = false;
      ctx.allowExecution = false;
    }
  } else if (event === 'push') {
    const before = payload.before as string | undefined;
    const after = payload.after as string | undefined;
    if (before && !ZERO_SHA.test(before)) ctx.base = before;
    if (after) ctx.head = after;
  } else if (event === 'workflow_run') {
    // A privileged follow-up to a pull_request run (see examples/fork-safe-comment.yml). The event
    // is trusted; the artifact it downloads is not, so the target comes from here, not from it.
    const run = payload.workflow_run as
      | {
          head_sha?: string;
          head_branch?: string;
          html_url?: string;
          head_repository?: { owner?: { login?: string } };
          pull_requests?: Array<{ number: number }>;
        }
      | undefined;
    ctx.head = run?.head_sha;
    ctx.expectedHead = run?.head_sha;
    const number = run?.pull_requests?.[0]?.number;
    if (number) ctx.metadata = { platform: 'github', number };
    else if (run?.head_sha && run.head_branch && run.head_repository?.owner?.login)
      // GitHub leaves pull_requests empty for forks: find the pull request by its head instead.
      ctx.pullRequestHead = {
        owner: run.head_repository.owner.login,
        branch: run.head_branch,
        sha: run.head_sha,
      };
    // Link to the run that reviewed the change, where its artifacts live.
    if (run?.html_url) ctx.links = { run: run.html_url, artifacts: `${run.html_url}#artifacts` };
  }
  return ctx;
}

export interface GitHubClientOptions {
  token: string;
  apiUrl?: string;
  fetch?: FetchLike;
}

/** The few GitHub REST calls Covi makes. */
export class GitHubClient {
  private readonly options: GitHubClientOptions;
  private readonly fetch: FetchLike;

  constructor(options: GitHubClientOptions) {
    this.options = options;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetch(`${this.options.apiUrl ?? 'https://api.github.com'}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'covi',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Never follow a redirect: the token belongs to this API alone.
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  }
}

/**
 * The pull request a comment belongs to, verified. Uses the given or event number, or finds the
 * open pull request whose head is the reviewed commit (fork pull requests in workflow_run). When an
 * expected head is known, the pull request must still point at it; otherwise a stale or redirected
 * run could comment on the wrong code.
 */
export async function resolvePullRequest(
  client: GitHubClient,
  repository: string,
  context: Pick<PlatformContext, 'metadata' | 'expectedHead' | 'pullRequestHead'>,
  number?: number,
): Promise<{ number?: number; reason?: string }> {
  let target = number ?? context.metadata.number;
  if (!target && context.pullRequestHead) {
    const { owner, branch, sha } = context.pullRequestHead;
    const head = encodeURIComponent(`${owner}:${branch}`);
    const path = `/repos/${repository}/pulls`;
    const response = await client.request('GET', `${path}?state=open&head=${head}&per_page=100`);
    if (!response.ok) {
      await response.body?.cancel();
      return { reason: `could not look up the pull request (HTTP ${response.status})` };
    }
    const pulls = await bodyOf<Array<{ number?: number; head?: { sha?: string } }>>(response, path);
    if ('reason' in pulls) return pulls;
    target = Array.isArray(pulls.data)
      ? pulls.data.find((p) => p.head?.sha === sha)?.number
      : undefined;
    if (!target)
      return { reason: `no open pull request has head ${sha.slice(0, 7)} (${owner}:${branch})` };
  }
  if (!target) return { reason: 'not a pull request event' };
  if (context.expectedHead) {
    const path = `/repos/${repository}/pulls/${target}`;
    const response = await client.request('GET', path);
    if (!response.ok) {
      await response.body?.cancel();
      return { reason: `could not read pull request #${target} (HTTP ${response.status})` };
    }
    const pull = await bodyOf<{ head?: { sha?: string } }>(response, path);
    if ('reason' in pull) return pull;
    const head = String(pull.data?.head?.sha ?? '');
    if (head !== context.expectedHead)
      return {
        reason: `pull request #${target} now points at ${head.slice(0, 7) || 'an unknown commit'}, not the reviewed ${context.expectedHead.slice(0, 7)}; the newer run will comment`,
      };
  }
  return { number: target };
}

/** A bounded JSON body, or why it could not be read (too large, or not JSON), naming the path. */
async function bodyOf<T>(
  response: Response,
  path: string,
): Promise<{ data: T } | { reason: string }> {
  try {
    return { data: await readJson<T>(response, 'GitHub', path) };
  } catch (error) {
    return { reason: (error as Error).message };
  }
}

export interface GitHubPublisherOptions extends GitHubClientOptions {
  repository: string;
  number: number;
  /**
   * The bot a token without a user of its own comments as (`publish.botLogin`): the workflow
   * token's `github-actions[bot]` unless Covi runs as another GitHub App.
   */
  botLogin?: string;
}

/** Who wrote a comment, as GitHub lists it. */
export type Author = { id?: number; login?: string; type?: string } | null | undefined;

/** The token's own user id, or `null` for a token that has no user (a workflow or app token). */
export type Identity = { user: number | null };

/** The bot a workflow token comments as. */
const DEFAULT_BOT_LOGIN = 'github-actions[bot]';

/**
 * Whether Covi wrote a comment. Anyone can paste the marker, and other apps can quote it, so only
 * the token's own user counts; a token with no user (it comments as a bot) trusts only its bot's
 * login.
 */
export function authoredBy(author: Author, me: Identity, botLogin = DEFAULT_BOT_LOGIN): boolean {
  if (me.user !== null) return author?.id === me.user;
  return author?.type === 'Bot' && author.login === botLogin;
}

/** Creates or updates Covi's single summary comment on a pull request (issue comments API). */
export class GitHubPublisher implements Publisher {
  readonly platform = 'github' as const;
  readonly target: { repository: string; number: number };
  private readonly options: GitHubPublisherOptions;
  private readonly client: GitHubClient;
  private me?: Identity;

  constructor(options: GitHubPublisherOptions) {
    this.options = options;
    this.target = { repository: options.repository, number: options.number };
    this.client = new GitHubClient(options);
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.client.request(method, path, body);
  }

  /** Reads a JSON body, bounded, naming the path (without its query) if it is not JSON. */
  private json<T>(response: Response, path: string): Promise<T> {
    return readJson<T>(response, 'GitHub', path.split('?')[0]!);
  }

  /**
   * Who the token is, asked once. A workflow or app token cannot read `/user` (401/403); any other
   * failure throws and is asked again next time, so a passing outage cannot pass for "no user".
   */
  private async whoami(): Promise<Identity> {
    if (this.me) return this.me;
    const response = await this.request('GET', '/user');
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      this.me = { user: null };
    } else if (!response.ok) {
      await response.body?.cancel();
      throw new PlatformHttpError('GitHub', response.status, '/user');
    } else {
      const { id } = await this.json<{ id?: unknown }>(response, '/user');
      if (typeof id !== 'number') throw new Error('GitHub sent no user id for /user');
      this.me = { user: id };
    }
    return this.me;
  }

  /** The first comment Covi wrote (see `authoredBy`). */
  private async own<T extends { user?: Author }>(comments: readonly T[]): Promise<T | undefined> {
    if (!comments.length) return undefined;
    const me = await this.whoami();
    return comments.find((c) => authoredBy(c.user, me, this.options.botLogin));
  }

  async findComment(): Promise<ExistingComment | null> {
    const { repository, number } = this.options;
    type Listed = { id: number; body?: string; html_url: string; user?: Author };
    const marked: Listed[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.request(
        'GET',
        `/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      );
      if (!response.ok) throw new Error((await failure(response, 'list comments')).reason);
      const comments = await this.json<Listed[]>(
        response,
        `/repos/${repository}/issues/${number}/comments`,
      );
      marked.push(...comments.filter((c) => c.body?.includes(COMMENT_MARKER)));
      if (comments.length < 100) break;
    }
    const own = await this.own(marked);
    return own ? { id: String(own.id), body: own.body ?? '', url: own.html_url } : null;
  }

  async upsertComment(body: string, existing?: ExistingComment | null): Promise<PublishOutcome> {
    const { repository, number } = this.options;
    try {
      const found = existing === undefined ? await this.findComment() : existing;
      const path = found
        ? `/repos/${repository}/issues/comments/${found.id}`
        : `/repos/${repository}/issues/${number}/comments`;
      const response = await this.request(found ? 'PATCH' : 'POST', path, { body });
      if (!response.ok) return failure(response, found ? 'update the comment' : 'create a comment');
      const json = await this.json<{ id?: number; html_url?: string }>(response, path);
      return {
        status: found ? 'updated' : 'created',
        id: json.id !== undefined ? String(json.id) : found?.id,
        url: json.html_url,
      };
    } catch (error) {
      return { status: 'failed', reason: (error as Error).message };
    }
  }

  async postAnchors(anchors: readonly AnchorDraft[], head: string): Promise<AnchorsOutcome> {
    const { repository, number } = this.options;
    const outcome: AnchorsOutcome = { posted: [], existing: 0, skipped: [] };
    if (!anchors.length) return outcome;
    try {
      const marked: Array<{ key: string; user?: Author }> = [];
      for (let page = 1; page <= 10; page++) {
        const response = await this.request(
          'GET',
          `/repos/${repository}/pulls/${number}/comments?per_page=100&page=${page}`,
        );
        if (!response.ok)
          throw new Error(`could not list review comments (HTTP ${response.status})`);
        const comments = await this.json<Array<{ body?: string; user?: Author }>>(
          response,
          `/repos/${repository}/pulls/${number}/comments`,
        );
        for (const c of comments) {
          const key = anchorKeyOf(c.body ?? '');
          if (key) marked.push({ key, user: c.user });
        }
        if (comments.length < 100) break;
      }
      // A pasted anchor marker must not keep Covi from posting the real anchor.
      const have = new Set<string>();
      for (const key of new Set(marked.map((m) => m.key)))
        if (await this.own(marked.filter((m) => m.key === key))) have.add(key);
      for (const [index, anchor] of anchors.entries()) {
        // Each anchor is a notification; Decision 3 allows a run this many.
        if (index >= MAX_ANCHORS) {
          outcome.skipped.push({
            key: anchor.key,
            reason: `only ${MAX_ANCHORS} anchors are posted per run`,
          });
          continue;
        }
        // An anchor stays once posted: its reactions are what outcomes count.
        if (have.has(anchor.key)) {
          outcome.existing++;
          continue;
        }
        const response = await this.request(
          'POST',
          `/repos/${repository}/pulls/${number}/comments`,
          {
            body: anchor.body,
            commit_id: head,
            path: anchor.path,
            line: anchor.line,
            side: 'RIGHT',
          },
        );
        if (response.ok) {
          const json = await this.json<{ id: number }>(
            response,
            `/repos/${repository}/pulls/${number}/comments`,
          );
          outcome.posted.push({ key: anchor.key, id: String(json.id) });
        } else
          outcome.skipped.push({
            key: anchor.key,
            reason:
              response.status === 422
                ? 'the line is not part of the diff GitHub shows'
                : `GitHub answered HTTP ${response.status}`,
          });
      }
    } catch (error) {
      const done = new Set([...outcome.posted, ...outcome.skipped].map((a) => a.key));
      for (const anchor of anchors)
        if (!done.has(anchor.key))
          outcome.skipped.push({ key: anchor.key, reason: (error as Error).message });
    }
    return outcome;
  }
}

async function failure(response: Response, action: string): Promise<PublishOutcome> {
  const hint =
    response.status === 403 || response.status === 404
      ? ' The token likely lacks `pull-requests: write` (fork pull requests always get a read-only token).'
      : '';
  const detail = (await response.text().catch(() => '')).slice(0, 200);
  return {
    status: 'failed',
    reason: `GitHub refused to ${action} (HTTP ${response.status}).${hint}${detail ? ` ${detail}` : ''}`,
  };
}

/** Escapes text for workflow command data and properties. */
export function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/**
 * Inline annotations on the pull request diff, no token required. GitHub shows at most 10 of each
 * level per step, so the most important findings go first.
 */
export function annotations(
  findings: readonly Finding[],
  limit = 10,
  language: Language = 'en',
): string[] {
  const counts = { error: 0, warning: 0, notice: 0 };
  const lines: string[] = [];
  for (const f of findings) {
    const level =
      isBlockingCandidate(f) && f.severity === 'high'
        ? 'error'
        : f.severity === 'low' || f.certainty === 'question'
          ? 'notice'
          : 'warning';
    if (counts[level] >= limit) continue;
    counts[level]++;
    const props = [
      `title=${escapeProperty(`Covi · ${t(language, `certainty.${f.certainty}`)}: ${f.title}`)}`,
    ];
    if (f.location) {
      props.unshift(`file=${escapeProperty(f.location.path)}`);
      if (f.location.line) props.push(`line=${f.location.line}`);
      if (f.location.endLine) props.push(`endLine=${f.location.endLine}`);
    }
    lines.push(
      `::${level} ${props.join(',')}::${escapeData(`${f.explanation}${f.suggestion ? `\n\n${t(language, 'comment.suggestion')} ${f.suggestion}` : ''}`)}`,
    );
  }
  return lines;
}

/** Writes `name=value` pairs to $GITHUB_OUTPUT using the multiline-safe delimiter syntax. */
export async function writeOutputs(
  file: string,
  outputs: Record<string, string | number | undefined>,
): Promise<void> {
  const lines: string[] = [];
  for (const [name, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    const text = String(value);
    if (text.includes('\n')) {
      const delimiter = `COVI_EOF_${Math.random().toString(36).slice(2)}`;
      lines.push(`${name}<<${delimiter}`, text, delimiter);
    } else {
      lines.push(`${name}=${text}`);
    }
  }
  await appendFile(file, `${lines.join('\n')}\n`);
}

export async function writeJobSummary(file: string, markdown: string): Promise<void> {
  await appendFile(file, `${markdown}\n`);
}
