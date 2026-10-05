import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exists, listSkills, resourcePath, UsageError } from '@covi/core';
import { coviVersion } from './version.ts';

export type SkillTarget = 'claude' | 'codex' | 'agents';

/**
 * Where each client reads skills: Claude Code from `.claude/skills`; Codex and other clients that
 * follow the shared layout from `.agents/skills`. `--global` uses the same folder in the home
 * directory.
 */
export function skillDestination(
  target: SkillTarget,
  options: { repo: string; global: boolean; dest?: string },
): string {
  if (options.dest) return options.dest;
  const folder = target === 'claude' ? '.claude' : '.agents';
  return join(options.global ? homedir() : options.repo, folder, 'skills');
}

/**
 * Installs Covi's skills for an agent client. The repository's skills/ directory stays the single
 * source; installed copies carry a version marker so `covi skills install` can refresh them.
 */
export async function installSkills(
  target: SkillTarget,
  options: { repo: string; global: boolean; dest?: string },
): Promise<{ destination: string; installed: string[] }> {
  const destination = skillDestination(target, options);
  await mkdir(destination, { recursive: true });
  const version = await coviVersion();
  const installed: string[] = [];
  for (const skill of await listSkills()) {
    const dir = join(destination, skill.name);
    if ((await exists(dir)) && !(await exists(join(dir, '.covi-skill')))) {
      throw new UsageError(
        `${dir} exists and was not installed by Covi.`,
        'Remove it or pass --dest to install elsewhere.',
      );
    }
    await rm(dir, { recursive: true, force: true });
    await cp(resourcePath('skills', skill.name), dir, { recursive: true });
    await writeFile(
      join(dir, '.covi-skill'),
      `${JSON.stringify({ name: skill.name, version, source: 'covi' })}\n`,
    );
    installed.push(skill.name);
  }
  // Remove skills Covi installed earlier that no longer exist.
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name.startsWith('covi') &&
      !installed.includes(entry.name) &&
      (await exists(join(destination, entry.name, '.covi-skill')))
    ) {
      await rm(join(destination, entry.name), { recursive: true, force: true });
    }
  }
  return { destination, installed };
}
