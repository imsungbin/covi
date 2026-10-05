import { appendFile, readFile } from 'node:fs/promises';
import { COMMENT_MARKER, type Finding, isBlockingCandidate, type Language, t } from '@covi/core';
import type { FetchLike, PlatformContext, Publisher, PublishOutcome } from './types.ts';

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
    const response = await client.request(
      'GET',
      `/repos/${repository}/pulls?state=open&head=${head}&per_page=100`,
    );
    if (!response.ok)
      return { reason: `could not look up the pull request (HTTP ${response.status})` };
    const pulls = (await response.json()) as Array<{ number: number; head: { sha: string } }>;
    target = pulls.find((p) => p.head.sha === sha)?.number;
    if (!target)
      return { reason: `no open pull request has head ${sha.slice(0, 7)} (${owner}:${branch})` };
  }
  if (!target) return { reason: 'not a pull request event' };
  if (context.expectedHead) {
    const response = await client.request('GET', `/repos/${repository}/pulls/${target}`);
    if (!response.ok)
      return { reason: `could not read pull request #${target} (HTTP ${response.status})` };
    const pull = (await response.json()) as { head: { sha: string } };
    if (pull.head.sha !== context.expectedHead)
      return {
        reason: `pull request #${target} now points at ${pull.head.sha.slice(0, 7)}, not the reviewed ${context.expectedHead.slice(0, 7)}; the newer run will comment`,
      };
  }
  return { number: target };
}

export interface GitHubPublisherOptions extends GitHubClientOptions {
  repository: string;
  number: number;
}

/** Creates or updates Covi's single summary comment on a pull request (issue comments API). */
export class GitHubPublisher implements Publisher {
  readonly platform = 'github' as const;
  private readonly options: GitHubPublisherOptions;
  private readonly client: GitHubClient;

  constructor(options: GitHubPublisherOptions) {
    this.options = options;
    this.client = new GitHubClient(options);
  }

  private request(method: string, path: string, body?: unknown): Promise<Response> {
    return this.client.request(method, path, body);
  }

  async upsertComment(body: string): Promise<PublishOutcome> {
    const { repository, number } = this.options;
    try {
      let existing: { id: number; html_url: string } | undefined;
      for (let page = 1; page <= 10 && !existing; page++) {
        const response = await this.request(
          'GET',
          `/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
        );
        if (!response.ok) return failure(response, 'list comments');
        const comments = (await response.json()) as Array<{
          id: number;
          body?: string;
          html_url: string;
        }>;
        existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
        if (comments.length < 100) break;
      }
      const response = existing
        ? await this.request('PATCH', `/repos/${repository}/issues/comments/${existing.id}`, {
            body,
          })
        : await this.request('POST', `/repos/${repository}/issues/${number}/comments`, { body });
      if (!response.ok)
        return failure(response, existing ? 'update the comment' : 'create a comment');
      const json = (await response.json()) as { html_url?: string };
      return { status: existing ? 'updated' : 'created', url: json.html_url };
    } catch (error) {
      return { status: 'failed', reason: (error as Error).message };
    }
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
