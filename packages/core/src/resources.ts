import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedHome: string | undefined;

/**
 * Locates Covi's resource root (the directory holding `skills/`, `templates/`, and `assets/`).
 * Works from the TypeScript sources in a checkout and from the published bundle alike.
 */
export function coviHome(): string {
  if (cachedHome) return cachedHome;
  if (process.env.COVI_HOME && existsSync(join(process.env.COVI_HOME, 'skills'))) {
    cachedHome = process.env.COVI_HOME;
    return cachedHome;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'skills')) && existsSync(join(dir, 'templates'))) {
      cachedHome = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'Cannot locate Covi resources (skills/, templates/). Set COVI_HOME to the Covi installation.',
  );
}

export function resourcePath(...parts: string[]): string {
  return join(coviHome(), ...parts);
}

export interface SkillDocument {
  name: string;
  description: string;
  body: string;
  path: string;
}

/** Reads a skill's SKILL.md and splits frontmatter from the body. */
export async function loadSkill(name: string): Promise<SkillDocument> {
  const path = resourcePath('skills', name, 'SKILL.md');
  const text = await readFile(path, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const front = match?.[1] ?? '';
  const body = (match?.[2] ?? text).trim();
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.*)$`, 'm')
      .exec(front)?.[1]
      ?.replace(/^["']|["']$/g, '')
      .trim() ?? '';
  return { name: field('name') || name, description: field('description'), body, path };
}

export async function listSkills(): Promise<SkillDocument[]> {
  const entries = await readdir(resourcePath('skills'), { withFileTypes: true });
  const out: SkillDocument[] = [];
  for (const e of entries) {
    if (e.isDirectory() && existsSync(resourcePath('skills', e.name, 'SKILL.md')))
      out.push(await loadSkill(e.name));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extracts the methodology portion of a skill for use in model prompts: everything except sections
 * that only make sense to an interactive agent (tool usage, commands to run, asking the user).
 */
export function methodologyOf(skill: SkillDocument): string {
  const sections = skill.body.split(/\n(?=## )/);
  const skip =
    /^## (Run it|Commands|Tools|Workflow with the CLI|Asking the user|Output files|Related skills|When not to use)/i;
  return sections
    .filter((s) => !skip.test(s.trim()))
    .join('\n')
    .trim();
}
