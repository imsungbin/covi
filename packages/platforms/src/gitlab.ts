import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { COMMENT_MARKER, type Finding, isBlockingCandidate, shortHash } from '@covi/core';
import { PlatformHttpError, readJson } from './http.ts';
import {
  type ExistingComment,
  type FetchLike,
  namesChange,
  type PlatformContext,
  type Publisher,
  type PublishOutcome,
} from './types.ts';

const ZERO_SHA = /^0+$/;

/** Maps GitLab CI's predefined variables onto Covi's change inputs (merge requests and branches). */
export function gitlabContext(env: NodeJS.ProcessEnv): PlatformContext {
  const ctx: PlatformContext = {
    platform: 'gitlab',
    ci: true,
    event: env.CI_PIPELINE_SOURCE,
    metadata: { platform: 'gitlab' },
    fetch: true,
    trusted: true,
    allowExecution: true,
    links: {
      job: env.CI_JOB_URL,
      run: env.CI_PIPELINE_URL,
      artifacts: env.CI_JOB_URL ? `${env.CI_JOB_URL}/artifacts/browse` : undefined,
    },
    notes: [],
  };
  const iid = env.CI_MERGE_REQUEST_IID ? Number(env.CI_MERGE_REQUEST_IID) : undefined;
  if (iid) {
    const fromFork = Boolean(
      env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID &&
        env.CI_MERGE_REQUEST_PROJECT_ID &&
        env.CI_MERGE_REQUEST_SOURCE_PROJECT_ID !== env.CI_MERGE_REQUEST_PROJECT_ID,
    );
    const url = env.CI_MERGE_REQUEST_PROJECT_URL
      ? `${env.CI_MERGE_REQUEST_PROJECT_URL}/-/merge_requests/${iid}`
      : undefined;
    ctx.base = env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
    // Merged-results pipelines check out a merge commit; the source branch SHA is the real head.
    ctx.head = env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA;
    ctx.metadata = {
      platform: 'gitlab',
      title: env.CI_MERGE_REQUEST_TITLE,
      description: env.CI_MERGE_REQUEST_DESCRIPTION,
      url,
      number: iid,
      fromFork,
      sourceBranch: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
      targetBranch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    };
    ctx.source = { kind: 'merge-request', platform: 'gitlab', number: iid, url };
    ctx.trusted = !fromFork;
    if (fromFork)
      ctx.notes.push(
        'Merge request from a fork: protected variables (tokens) are not available, so posting a note will be skipped.',
      );
  } else {
    if (env.CI_COMMIT_BEFORE_SHA && !ZERO_SHA.test(env.CI_COMMIT_BEFORE_SHA))
      ctx.base = env.CI_COMMIT_BEFORE_SHA;
    ctx.head = env.CI_COMMIT_SHA;
    // Pipelines a maintainer starts (scheduled, from the web, through the API) or a push to the
    // default branch: the checkout is not a change under review.
    const source = env.CI_PIPELINE_SOURCE;
    const onDefault =
      Boolean(env.CI_COMMIT_BRANCH) && env.CI_COMMIT_BRANCH === env.CI_DEFAULT_BRANCH;
    if (
      (source === 'schedule' ||
        source === 'web' ||
        source === 'api' ||
        (source === 'push' && onDefault)) &&
      !namesChange(ctx)
    )
      ctx.trustedCheckout = true;
  }
  return ctx;
}

export interface GitLabPublisherOptions {
  apiUrl: string;
  projectId: string;
  /** The project's path (group/name), recorded where the note was posted; defaults to the id. */
  projectPath?: string;
  iid: number;
  token: string;
  /** `private` for personal/project access tokens, `job` for CI_JOB_TOKEN. */
  tokenKind?: 'private' | 'job';
  fetch?: FetchLike;
}

/** Creates or updates Covi's merge request note and uploads videos for inline playback. */
export class GitLabPublisher implements Publisher {
  readonly platform = 'gitlab' as const;
  readonly target: { repository: string; number: number };
  private readonly options: GitLabPublisherOptions;
  private readonly fetch: FetchLike;
  /** The token's own user id, or `null` when the token cannot say (it gets 401/403). */
  private me?: { user: number | null };

  constructor(options: GitLabPublisherOptions) {
    this.options = options;
    this.target = { repository: options.projectPath ?? options.projectId, number: options.iid };
    const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
    // Never follow a redirect: fetch would carry PRIVATE-TOKEN along to any host.
    this.fetch = (url, init) => fetchImpl(url, { ...init, redirect: 'manual' });
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = { 'user-agent': 'covi' };
    headers[this.options.tokenKind === 'job' ? 'JOB-TOKEN' : 'PRIVATE-TOKEN'] = this.options.token;
    if (json) headers['content-type'] = 'application/json';
    return headers;
  }

  private url(path: string): string {
    return `${this.options.apiUrl}/projects/${encodeURIComponent(this.options.projectId)}${path}`;
  }

  /**
   * Who the token is, asked once (a project access token has its own bot user). Failures other
   * than 401/403 throw and are asked again next time, so an outage cannot pass for "no user".
   */
  private async whoami(): Promise<number | null> {
    if (this.me) return this.me.user;
    const url = `${this.options.apiUrl}/user`;
    const response = await this.fetch(url, {
      headers: this.headers(false),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      this.me = { user: null };
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlatformHttpError('GitLab', response.status, new URL(url).pathname);
    }
    const { id } = await readJson<{ id?: unknown }>(response, 'GitLab', new URL(url).pathname);
    if (typeof id !== 'number') throw new Error('GitLab sent no user id for /user');
    this.me = { user: id };
    return id;
  }

  /**
   * The newest note the token's own user wrote with the marker. Anyone can paste the marker, so
   * when the token cannot say who it is, no note counts as Covi's.
   */
  async findComment(): Promise<ExistingComment | null> {
    const notes = `/merge_requests/${this.options.iid}/notes`;
    type Listed = { id: number; body?: string; system?: boolean; author?: { id?: number } | null };
    const marked: Listed[] = [];
    for (let page = 1; page <= 10; page++) {
      const response = await this.fetch(
        this.url(`${notes}?per_page=100&page=${page}&sort=desc&order_by=created_at`),
        { headers: this.headers(false), signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok)
        throw new Error((await failure(response, 'list merge request notes')).reason);
      const list = await readJson<Listed[]>(response, 'GitLab', new URL(this.url(notes)).pathname);
      marked.push(...list.filter((n) => !n.system && n.body?.includes(COMMENT_MARKER)));
      if (list.length < 100) break;
    }
    if (!marked.length) return null;
    const me = await this.whoami();
    const own = me === null ? undefined : marked.find((n) => n.author?.id === me);
    return own ? { id: String(own.id), body: own.body ?? '' } : null;
  }

  async upsertComment(body: string, existing?: ExistingComment | null): Promise<PublishOutcome> {
    const notes = `/merge_requests/${this.options.iid}/notes`;
    try {
      const found = existing === undefined ? await this.findComment() : existing;
      const response = found
        ? await this.fetch(this.url(`${notes}/${found.id}`), {
            method: 'PUT',
            headers: this.headers(true),
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(30_000),
          })
        : await this.fetch(this.url(notes), {
            method: 'POST',
            headers: this.headers(true),
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(30_000),
          });
      if (!response.ok) return failure(response, found ? 'update the note' : 'create a note');
      const json = await readJson<{ id?: number }>(
        response,
        'GitLab',
        new URL(this.url(notes)).pathname,
      ).catch(() => ({}) as { id?: number });
      return {
        status: found ? 'updated' : 'created',
        id: json.id !== undefined ? String(json.id) : found?.id,
      };
    } catch (error) {
      return { status: 'failed', reason: (error as Error).message };
    }
  }

  async uploadFile(path: string): Promise<{ url: string; markdown: string } | undefined> {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path)]), basename(path));
    const response = await this.fetch(this.url('/uploads'), {
      method: 'POST',
      headers: this.headers(false),
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { url?: string; full_path?: string; markdown?: string };
    if (!json.markdown || !json.url) return undefined;
    return { url: json.full_path ?? json.url, markdown: json.markdown };
  }
}

async function failure(response: Response, action: string): Promise<PublishOutcome> {
  const hint =
    response.status === 401 || response.status === 403
      ? ' Use a project access token with the `api` scope in COVI_GITLAB_TOKEN (CI_JOB_TOKEN cannot write notes).'
      : '';
  return {
    status: 'failed',
    reason: `GitLab refused to ${action} (HTTP ${response.status}).${hint}`,
  };
}

const SEVERITY: Record<string, 'info' | 'minor' | 'major' | 'critical' | 'blocker'> = {
  high: 'critical',
  medium: 'major',
  low: 'minor',
};

/** GitLab Code Quality report: findings appear in the merge request widget and diff. */
export function codeQualityReport(findings: readonly Finding[]): object[] {
  return findings.map((f) => ({
    description: `${f.title}: ${f.explanation}`,
    check_name: f.source.id ?? `${f.source.kind}-${f.category}`,
    fingerprint: shortHash('covi', f.id, f.location?.path, f.location?.line).padEnd(32, '0'),
    severity:
      f.certainty === 'question'
        ? 'info'
        : !isBlockingCandidate(f) && f.severity === 'high'
          ? 'major'
          : SEVERITY[f.severity],
    categories: [f.category],
    location: { path: f.location?.path ?? '.', lines: { begin: f.location?.line ?? 1 } },
  }));
}

/** dotenv report so later jobs can read Covi's outcome as variables. */
export function dotenvReport(values: Record<string, string | number | undefined>): string {
  return `${Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`)
    .join('\n')}\n`;
}
