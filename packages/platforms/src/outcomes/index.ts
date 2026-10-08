import type { RequestBudget } from '../http.ts';
import type { FetchLike } from '../types.ts';
import { GitHubCollector } from './github.ts';
import { GitLabCollector } from './gitlab.ts';
import type { OutcomeCollector } from './types.ts';

export interface CollectorOptions {
  /** owner/name (GitHub) or group/project (GitLab); else from the CI environment. */
  repository?: string;
  /** From `--api-url`, else the CI environment, else the public API. Never from a run's files. */
  apiUrl?: string;
  budget: RequestBudget;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** `publish.botLogin` from the base revision's configuration: Covi's GitHub App bot. */
  botLogin?: string;
  /** `publish.gitlabBotUser` from the base revision's configuration: Covi's GitLab bot user. */
  gitlabBotUser?: string;
}

/** A collector for the platform, or what is missing to make one. */
export function createCollector(
  platform: 'github' | 'gitlab',
  env: NodeJS.ProcessEnv,
  options: CollectorOptions,
): { collector?: OutcomeCollector; missing?: 'repository' | 'token'; reason?: string } {
  const shared = { budget: options.budget, fetch: options.fetch, sleep: options.sleep };
  if (platform === 'github') {
    const repository = options.repository || env.GITHUB_REPOSITORY;
    const token = env.COVI_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN;
    if (!repository) return { missing: 'repository', reason: 'no repository to ask GitHub about' };
    if (!token) return { missing: 'token', reason: 'no GitHub token' };
    return {
      collector: new GitHubCollector({
        ...shared,
        token,
        repository,
        apiUrl: options.apiUrl || env.GITHUB_API_URL || undefined,
        botLogin: options.botLogin,
      }),
    };
  }
  // A path, not CI_PROJECT_ID: outcome files name the project by its path.
  const repository = options.repository || env.CI_MERGE_REQUEST_PROJECT_PATH || env.CI_PROJECT_PATH;
  // CI_JOB_TOKEN cannot read notes or award emoji.
  const token = env.COVI_GITLAB_TOKEN || env.GITLAB_TOKEN;
  if (!repository) return { missing: 'repository', reason: 'no project to ask GitLab about' };
  if (!token) return { missing: 'token', reason: 'no GitLab token' };
  return {
    collector: new GitLabCollector({
      ...shared,
      token,
      repository,
      apiUrl: options.apiUrl || env.CI_API_V4_URL || 'https://gitlab.com/api/v4',
      botUser: options.gitlabBotUser,
    }),
  };
}
