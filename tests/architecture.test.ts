import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const ALLOWED: Record<string, string[]> = {
  core: [],
  brand: [],
  audio: [],
  capture: ['core'],
  video: ['core', 'brand', 'audio'],
  platforms: ['core'],
  cli: ['core', 'brand', 'capture', 'video', 'platforms'],
};

describe('architecture', () => {
  for (const [pkg, allowed] of Object.entries(ALLOWED)) {
    it(`${pkg} depends only on ${allowed.length ? allowed.join(', ') : 'no other Covi package'}`, () => {
      for (const file of sources(join(root, 'packages', pkg, 'src'))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/from '@covi\/([a-z]+)'/g)) {
          expect(allowed, `${relative(root, file)} imports @covi/${m[1]}`).toContain(m[1]);
        }
        for (const m of text.matchAll(/from '(\.\.\/)+(?:\.\.\/)?packages\/([a-z]+)\//g)) {
          expect(m[2], `${relative(root, file)} reaches into another package by path`).toBe(pkg);
        }
      }
    });
  }

  it('keeps the core platform-independent', () => {
    for (const file of sources(join(root, 'packages', 'core', 'src'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, relative(root, file)).not.toMatch(/process\.env\.(GITHUB|GITLAB|CI_)/);
      expect(text, relative(root, file)).not.toMatch(/api\.github\.com|gitlab\.com\/api/);
    }
  });

  it('keeps the domain model below the code that works on it', () => {
    // Model files describe data; merging, storing, and reviewing it import the model, never the
    // reverse, so a type that both sides share lives in the model.
    const allowed = /^(\.\/|\.\.\/(config|i18n|util)\/|zod$)/;
    for (const file of sources(join(root, 'packages', 'core', 'src', 'model'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from '([^']+)'/g))
        expect(m[1], `${relative(root, file)} imports ${m[1]}`).toMatch(allowed);
    }
  });

  it('runs on Node type stripping: no enums, namespaces, or parameter properties', () => {
    for (const dir of ['core', 'brand', 'audio', 'capture', 'video', 'platforms', 'cli']) {
      for (const file of sources(join(root, 'packages', dir, 'src'))) {
        const text = readFileSync(file, 'utf8');
        expect(text, relative(root, file)).not.toMatch(/^\s*(export\s+)?(const\s+)?enum\s/m);
        expect(text, relative(root, file)).not.toMatch(/^\s*(export\s+)?namespace\s/m);
        // A modifier at the start of a parameter is a parameter property; `x: readonly T[]` is a type.
        expect(text, relative(root, file)).not.toMatch(
          /constructor\((?:[^)]*,)?\s*(private|public|protected|readonly)\s+\w+\s*[:?,)]/,
        );
      }
    }
  });

  it('keeps derived agent packaging in sync with the canonical skills', () => {
    expect(() =>
      execFileSync('node', [join(root, 'scripts/sync-agents.ts'), '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
