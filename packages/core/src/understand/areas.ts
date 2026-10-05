import type { ChangedFile, Surface } from '../model/change.ts';
import type { Area } from '../model/context.ts';
import { shortHash } from '../util/hash.ts';

const NOISE = new Set([
  'src',
  'lib',
  'app',
  'source',
  'internal',
  'pkg',
  'main',
  'java',
  'kotlin',
  'scala',
  'python',
  'js',
  'ts',
]);
const CONTAINERS = new Set([
  'packages',
  'apps',
  'services',
  'modules',
  'crates',
  'libs',
  'plugins',
  'workspaces',
]);

/** Groups files into a handful of logical areas so explanations talk about modules, not files. */
export function areaKey(path: string): string {
  const parts = path.split('/');
  parts.pop();
  if (parts.length === 0) return '(root)';
  if (parts[0] === '.github') return '.github';
  const out: string[] = [];
  let i = 0;
  if (CONTAINERS.has(parts[0]!) && parts.length > 1) {
    out.push(parts[1]!);
    i = 2;
  }
  for (; i < parts.length && out.length < 2; i++) {
    const part = parts[i]!;
    if (NOISE.has(part) && i < parts.length - 1) continue;
    if (NOISE.has(part) && out.length > 0) continue;
    out.push(part);
  }
  return out.join('/') || parts[0]!;
}

export function groupAreas(files: readonly ChangedFile[], maxAreas = 8): Area[] {
  const groups = new Map<string, ChangedFile[]>();
  for (const f of files) {
    const key = areaKey(f.path);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  // Merge the smallest groups into their parents until the count is manageable.
  // "other" is the catch-all: it absorbs groups but is never merged itself, so the loop always
  // makes progress (merging "other" into "other" would never shrink the map).
  while (groups.size > maxAreas) {
    const candidates = [...groups.entries()].filter(([key]) => key !== 'other');
    if (candidates.length === 0) break;
    const [smallestKey, smallest] = candidates.sort((a, b) => weight(a[1]) - weight(b[1]))[0]!;
    groups.delete(smallestKey);
    const parent = smallestKey.includes('/')
      ? smallestKey.split('/').slice(0, -1).join('/')
      : 'other';
    groups.set(parent, [...(groups.get(parent) ?? []), ...smallest]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const surfaces = new Set<Surface>();
      for (const f of group) for (const s of f.surfaces) surfaces.add(s);
      return {
        id: shortHash(key).slice(0, 8),
        name: displayName(key, group),
        path: key,
        surfaces: [...surfaces],
        files: group.map((f) => f.path),
        additions: group.reduce((n, f) => n + f.additions, 0),
        deletions: group.reduce((n, f) => n + f.deletions, 0),
      };
    })
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
}

function weight(files: readonly ChangedFile[]): number {
  return files.reduce((n, f) => n + f.additions + f.deletions + 1, 0);
}

function displayName(key: string, files: readonly ChangedFile[]): string {
  if (key === '(root)') return files.length === 1 ? files[0]!.path : 'project root';
  if (key === '.github') return 'GitHub configuration';
  if (key === 'other') return 'other files';
  return key;
}
