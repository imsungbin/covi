export { createPublisher, detectPlatform, platformContext } from './detect.ts';
export {
  annotations,
  escapeData,
  escapeProperty,
  GitHubClient,
  GitHubPublisher,
  githubContext,
  resolvePullRequest,
  writeJobSummary,
  writeOutputs,
} from './github.ts';
export { codeQualityReport, dotenvReport, GitLabPublisher, gitlabContext } from './gitlab.ts';
export {
  ApiClient,
  type ApiOptions,
  BudgetExhaustedError,
  PlatformHttpError,
  type PlatformName,
  RateLimitedError,
  RequestBudget,
} from './http.ts';
export { artifactFileBase } from './links.ts';
export { GitHubCollector, type GitHubCollectorOptions } from './outcomes/github.ts';
export { GitLabCollector, type GitLabCollectorOptions } from './outcomes/gitlab.ts';
export { type CollectorOptions, createCollector } from './outcomes/index.ts';
export { findRevert, quotesComment } from './outcomes/signals.ts';
export type { OutcomeCollector } from './outcomes/types.ts';
export { toSarif } from './sarif.ts';
export type {
  AnchorsOutcome,
  CiOutputs,
  ExistingComment,
  FetchLike,
  PlatformContext,
  PlatformId,
  Publisher,
  PublishOutcome,
} from './types.ts';
