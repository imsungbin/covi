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
export { artifactFileBase } from './links.ts';
export { toSarif } from './sarif.ts';
export type {
  CiOutputs,
  FetchLike,
  PlatformContext,
  PlatformId,
  Publisher,
  PublishOutcome,
} from './types.ts';
