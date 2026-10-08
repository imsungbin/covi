import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Writes via a temp file + rename so readers never observe partial artifacts. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Whether `path` is `root` or lexically below it. */
export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Why a place inside `root` is not where it seems: a symbolic link on the way from `root` to it, or
 * a real location outside `root`. A repository can commit a link (`.covi/runs` → a directory of the
 * user's), so every component is checked from `root` down, not from the place itself. Undefined
 * when neither, when only missing components are left (Covi creates them as plain directories), or
 * when `path` is not inside `root`: then configuration chose it, and the repository cannot plant it.
 */
export async function linkedOrOutside(root: string, path: string): Promise<string | undefined> {
  if (!isWithin(root, path)) return undefined;
  let at = root;
  let deepest = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    at = join(at, part);
    try {
      if ((await lstat(at)).isSymbolicLink()) return 'is reached through a symbolic link';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      return `could not be checked (${(error as NodeJS.ErrnoException).code ?? error})`;
    }
    deepest = at;
  }
  const real = await Promise.all([realpath(root), realpath(deepest)]).catch(() => undefined);
  if (!real) return 'could not be checked';
  return isWithin(real[0], real[1]) ? undefined : 'resolves outside the repository';
}
