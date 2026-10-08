import { isAbsolute, relative, sep } from 'node:path';
import type { PlatformContext } from './types.ts';

/**
 * Where a platform serves one file of a run's artifacts, as a base URL that a run-relative path
 * completes. Only GitLab serves job artifacts file by file; on GitHub artifacts are one archive,
 * so a comment names the file and the footer links the archive.
 */
export function artifactFileBase(
  platform: PlatformContext,
  env: NodeJS.ProcessEnv,
  runDir: string,
): string | undefined {
  if (platform.platform !== 'gitlab' || !platform.links.job || !env.CI_PROJECT_DIR)
    return undefined;
  const rel = relative(env.CI_PROJECT_DIR, runDir);
  if (rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return `${platform.links.job}/artifacts/file/${rel ? `${rel.split(sep).join('/')}/` : ''}`;
}
