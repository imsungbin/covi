import type { ChangeMetadata, ChangeSource, Finding } from '@covi/core';

export type PlatformId = 'github' | 'gitlab' | 'local';

/** What a CI platform says about the change being reviewed. Core never reads CI variables directly. */
export interface PlatformContext {
  platform: PlatformId;
  ci: boolean;
  event?: string;
  base?: string;
  head?: string;
  metadata: ChangeMetadata;
  source?: ChangeSource;
  /** Shallow CI clones need Covi to fetch missing history. */
  fetch: boolean;
  /** False for fork contributions and other contexts where privileged actions must not run. */
  trusted: boolean;
  /** False where running project code would expose privileged credentials (pull_request_target). */
  allowExecution: boolean;
  links: { run?: string; job?: string; artifacts?: string };
  notes: string[];
  /**
   * The commit a published comment must belong to. Set from GitHub's workflow_run event (the
   * reviewed commit) or from `covi publish --expect-head`.
   */
  expectedHead?: string;
  /** Finds the pull request when the event does not name it (fork pull requests in workflow_run). */
  pullRequestHead?: { owner: string; branch: string; sha: string };
}

export interface PublishOutcome {
  status: 'created' | 'updated' | 'skipped' | 'failed';
  url?: string;
  reason?: string;
}

export interface Publisher {
  readonly platform: Exclude<PlatformId, 'local'>;
  upsertComment(body: string): Promise<PublishOutcome>;
  /** Uploads a file so it can be embedded in a comment (GitLab project uploads). */
  uploadFile?(path: string): Promise<{ url: string; markdown: string } | undefined>;
}

export interface CiOutputs {
  /** Writes workflow commands to the job log (GitHub annotations). */
  log?: (line: string) => void;
  files: Record<string, string>;
}

export interface FindingLocation {
  finding: Finding;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
