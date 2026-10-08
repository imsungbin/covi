import { GitHubPublisher, type GitHubPublisherOptions, githubContext } from './github.ts';
import { GitLabPublisher, gitlabContext } from './gitlab.ts';
import type { PlatformContext, PlatformId, Publisher } from './types.ts';

export function detectPlatform(env: NodeJS.ProcessEnv = process.env): PlatformId {
  if (env.GITHUB_ACTIONS === 'true') return 'github';
  if (env.GITLAB_CI === 'true') return 'gitlab';
  return 'local';
}

export async function platformContext(
  platform: PlatformId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlatformContext> {
  if (platform === 'github') return githubContext(env);
  if (platform === 'gitlab') return gitlabContext(env);
  return {
    platform: 'local',
    ci: Boolean(env.CI),
    metadata: {},
    fetch: false,
    trusted: true,
    allowExecution: true,
    links: {},
    notes: [],
  };
}

/**
 * Builds a publisher when the platform, a target pull/merge request, and credentials exist.
 * Returns a reason instead when publishing is not possible, so callers can report it plainly.
 */
export function createPublisher(
  context: PlatformContext,
  env: NodeJS.ProcessEnv = process.env,
  overrides: {
    number?: number;
    fetch?: GitHubPublisherOptions['fetch'];
    /** `publish.botLogin`: the bot a GitHub token without a user comments as. */
    botLogin?: string;
  } = {},
): { publisher?: Publisher; reason?: string } {
  const number = overrides.number ?? context.metadata.number;
  if (context.platform === 'github') {
    const token = env.COVI_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
    if (!number) return { reason: 'not a pull request event' };
    if (!token)
      return { reason: 'no GitHub token (pass github-token to the action or set GITHUB_TOKEN)' };
    if (!env.GITHUB_REPOSITORY) return { reason: 'GITHUB_REPOSITORY is not set' };
    return {
      publisher: new GitHubPublisher({
        token,
        repository: env.GITHUB_REPOSITORY,
        number,
        apiUrl: env.GITHUB_API_URL,
        botLogin: overrides.botLogin,
        fetch: overrides.fetch,
      }),
    };
  }
  if (context.platform === 'gitlab') {
    const token = env.COVI_GITLAB_TOKEN || env.GITLAB_TOKEN;
    const projectId = env.CI_MERGE_REQUEST_PROJECT_ID || env.CI_PROJECT_ID;
    if (!number) return { reason: 'not a merge request pipeline' };
    if (!projectId || !env.CI_API_V4_URL) return { reason: 'GitLab project variables are missing' };
    if (!token)
      return {
        reason: 'no GitLab token (set COVI_GITLAB_TOKEN to a project access token with api scope)',
      };
    return {
      publisher: new GitLabPublisher({
        apiUrl: env.CI_API_V4_URL,
        projectId,
        projectPath: env.CI_MERGE_REQUEST_PROJECT_PATH || env.CI_PROJECT_PATH || undefined,
        iid: number,
        token,
        fetch: overrides.fetch,
      }),
    };
  }
  return { reason: 'not running in GitHub Actions or GitLab CI' };
}
