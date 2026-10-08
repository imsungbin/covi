import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { COMMENT_MARKER, type Finding, isBlockingCandidate, shortHash } from '@covi/core';
import type {
  ExistingComment,
  FetchLike,
  PlatformContext,
  Publisher,
  PublishOutcome,
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
  private me?: Promise<number | undefined>;

  constructor(options: GitLabPublisherOptions) {
    this.options = options;
    this.target = { repository: options.projectPath ?? options.projectId, number: options.iid };
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
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

  /** The token's own user id, asked once (a project access token has its own bot user). */
  private whoami(): Promise<number | undefined> {
    this.me ??= this.fetch(`${this.options.apiUrl}/user`, {
      headers: this.headers(false),
      signal: AbortSignal.timeout(30_000),
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { id?: number }).id : undefined,
      )
      .catch(() => undefined);
    return this.me;
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
      const list = (await response.json()) as Listed[];
      marked.push(...list.filter((n) => !n.system && n.body?.includes(COMMENT_MARKER)));
      if (list.length < 100) break;
    }
    if (!marked.length) return null;
    const me = await this.whoami();
    const own = me === undefined ? undefined : marked.find((n) => n.author?.id === me);
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
      const json = (await response.json().catch(() => ({}))) as { id?: number };
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
