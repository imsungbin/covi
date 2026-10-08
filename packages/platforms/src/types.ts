import type { AnchorDraft, ChangeMetadata, ChangeSource, Finding } from '@covi/core';

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
  /** The comment's id on the platform. */
  id?: string;
  /** What happened to the finding anchors, when they were asked for. */
  anchors?: AnchorsOutcome;
}

/** Covi's comment as the platform has it. */
export interface ExistingComment {
  id: string;
  body: string;
  url?: string;
}

export interface AnchorsOutcome {
  posted: Array<{ key: string; id: string }>;
  /** Anchors already on the pull request from an earlier push. */
  existing: number;
  skipped: Array<{ key: string; reason: string }>;
}

export interface Publisher {
  readonly platform: Exclude<PlatformId, 'local'>;
  /** Where comments go: the repository (GitLab: the project) and the pull/merge request. */
  readonly target: { repository: string; number: number };
  /**
   * Covi's existing comment, or `null` when it has none. Only a comment Covi itself posted counts
   * (a bot's, or the token's own user's): anyone can paste the marker. Throws when the platform
   * refuses the lookup.
   */
  findComment(): Promise<ExistingComment | null>;
  /**
   * Creates or updates Covi's comment. Given what `findComment` returned (`null` included), it
   * does not look again.
   */
  upsertComment(body: string, existing?: ExistingComment | null): Promise<PublishOutcome>;
  /** Uploads a file so it can be embedded in a comment (GitLab project uploads). */
  uploadFile?(path: string): Promise<{ url: string; markdown: string } | undefined>;
  /** Posts findings as inline comments people can react to, once per finding key (GitHub). */
  postAnchors?(anchors: readonly AnchorDraft[], head: string): Promise<AnchorsOutcome>;
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
