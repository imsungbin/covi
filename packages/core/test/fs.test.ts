import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The temp file's name is random; fixing it lets the test plant a link exactly there.
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  randomUUID: () => 'planted',
}));

const { writeFileAtomic } = await import('../src/util/fs.ts');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'covi-fs-'));
  dirs.push(dir);
  return dir;
};

describe('writeFileAtomic', () => {
  it('writes through a temp file and leaves nothing else behind', async () => {
    const dir = tempDir();
    await writeFileAtomic(join(dir, 'out.json'), '{}\n');
    expect(readFileSync(join(dir, 'out.json'), 'utf8')).toBe('{}\n');
    expect(readdirSync(dir)).toEqual(['out.json']);
  });

  it('never follows a link planted at its temp name', async () => {
    const dir = tempDir();
    const victim = join(tempDir(), 'victim.txt');
    writeFileSync(victim, 'keep me\n');
    symlinkSync(victim, join(dir, 'out.json.planted.tmp'));
    await expect(writeFileAtomic(join(dir, 'out.json'), 'payload\n')).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(victim, 'utf8')).toBe('keep me\n');
    expect(readdirSync(dir)).toEqual(['out.json.planted.tmp']);
  });

  it('removes its temp file when the rename fails', async () => {
    const dir = tempDir();
    // A non-empty directory at the target: the rename fails after the temp file is written.
    mkdirSync(join(dir, 'out.json'));
    writeFileSync(join(dir, 'out.json', 'x'), '');
    await expect(writeFileAtomic(join(dir, 'out.json'), 'payload\n')).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['out.json']);
  });
});
