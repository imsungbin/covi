/**
 * Keeps agent-client packaging derived from the canonical sources:
 *   - `.claude/skills` (Claude Code) and `.agents/skills` (Codex and other clients) link to
 *     `skills/` (use `--copy` where symlinks are unavailable)
 *   - skills are well-formed (frontmatter, cross-references, reference files)
 *   - CLAUDE.md imports AGENTS.md instead of duplicating it
 *   - the Claude plugin manifest carries the package version
 *
 * `--check` changes nothing and exits 1 when anything has drifted.
 */
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const copy = process.argv.includes('--copy');
const problems: string[] = [];

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

export interface SkillInfo {
  name: string;
  description: string;
  body: string;
}

export async function readSkills(): Promise<SkillInfo[]> {
  const dir = join(root, 'skills');
  const out: SkillInfo[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) =>
    e.isDirectory(),
  )) {
    const text = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf8').catch(() => undefined);
    if (text === undefined) {
      problems.push(`skills/${entry.name}: missing SKILL.md`);
      continue;
    }
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!m) {
      problems.push(`skills/${entry.name}/SKILL.md: missing frontmatter`);
      continue;
    }
    const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1]!)?.[1]?.trim() ?? '';
    const name = field('name');
    const description = field('description');
    if (name !== entry.name)
      problems.push(`skills/${entry.name}: frontmatter name "${name}" must match the directory`);
    if (!/^[a-z0-9-]{1,64}$/.test(name))
      problems.push(`skills/${entry.name}: name must be lowercase letters, digits, and hyphens`);
    if (!description || description.length > 1536)
      problems.push(`skills/${entry.name}: description must be 1–1536 characters`);
    if (!/^# /m.test(m[2]!)) problems.push(`skills/${entry.name}: body needs a top-level heading`);
    for (const ref of m[2]!.matchAll(/`(references\/[\w.-]+\.md)`/g)) {
      if (!(await exists(join(dir, entry.name, ref[1]!))))
        problems.push(`skills/${entry.name}: missing ${ref[1]}`);
    }
    out.push({ name, description, body: m[2]! });
  }
  const names = new Set(out.map((s) => s.name));
  for (const skill of out) {
    for (const ref of skill.body.matchAll(/`(covi-[a-z-]+)`/g)) {
      if (!names.has(ref[1]!))
        problems.push(`skills/${skill.name}: references unknown skill \`${ref[1]}\``);
    }
  }
  return out;
}

async function syncSkillsLink(client: '.claude' | '.agents'): Promise<void> {
  const link = join(root, client, 'skills');
  const info = await lstat(link).catch(() => undefined);
  if (info?.isSymbolicLink() && (await readlink(link)) === '../skills') return;
  if (info?.isDirectory() && copy) {
    // Copy mode: compare file by file.
    const canonical = await readdir(join(root, 'skills'));
    const copied = await readdir(link);
    if (canonical.sort().join() === copied.sort().join() && !check) return;
  }
  if (check) {
    problems.push(`${client}/skills is not a link to ../skills (run npm run agents:sync)`);
    return;
  }
  await rm(link, { recursive: true, force: true });
  await mkdir(dirname(link), { recursive: true });
  if (copy) await cp(join(root, 'skills'), link, { recursive: true });
  else await symlink('../skills', link, 'dir');
}

async function checkClaudeMd(): Promise<void> {
  const text = await readFile(join(root, 'CLAUDE.md'), 'utf8').catch(() => '');
  if (!text.startsWith('@AGENTS.md'))
    problems.push('CLAUDE.md must start with @AGENTS.md (keep guidance in AGENTS.md)');
}

async function syncPluginManifest(): Promise<void> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
    description: string;
  };
  const path = join(root, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(await readFile(path, 'utf8').catch(() => '{}')) as Record<
    string,
    unknown
  >;
  if (manifest.version === pkg.version) return;
  if (check) {
    problems.push(
      `.claude-plugin/plugin.json version ${String(manifest.version)} does not match package.json ${pkg.version}`,
    );
    return;
  }
  await writeFile(path, `${JSON.stringify({ ...manifest, version: pkg.version }, null, 2)}\n`);
}

await readSkills();
await syncSkillsLink('.claude');
await syncSkillsLink('.agents');
await checkClaudeMd();
await syncPluginManifest();

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(check ? 'Agent packaging is in sync.' : 'Agent packaging synced.');
