import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { heroScene, loadTemplates } from '../src/templates.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const HERO: Record<string, string[]> = {
  'bug-fix': ['proof', 'fix'],
  'feature-demo': ['interaction'],
  'before-after': ['compare'],
  'api-change': ['exchange'],
  'cli-change': ['run'],
  'architecture-explainer': ['map'],
  'quick-review': ['core'],
};

function templateDir(hero: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'covi-templates-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'tiny.yml'),
    [
      'id: tiny',
      'name: Tiny',
      'description: d',
      'use_when: u',
      'beats:',
      '  - { id: context, eyebrow: C, eyebrows: { ko: C, ja: C, zh: C }, goal: g, visuals: [title] }',
      '  - { id: summary, eyebrow: S, eyebrows: { ko: S, ja: S, zh: S }, goal: g, visuals: [summary] }',
      'short: [context, summary]',
      `hero: ${hero}`,
    ].join('\n'),
  );
  return dir;
}

describe('story templates', () => {
  it('name the payoff beats each story builds to', async () => {
    const templates = await loadTemplates();
    expect(Object.fromEntries([...templates].map(([id, t]) => [id, t.hero]))).toEqual(HERO);
  });

  it('reject a hero that is not one of their beats', async () => {
    await expect(loadTemplates(templateDir('[context]'))).resolves.toBeDefined();
    await expect(loadTemplates(templateDir('[proof]'))).rejects.toThrow(
      /hero beat "proof" is not defined/,
    );
    await expect(loadTemplates(templateDir('[]'))).rejects.toThrow(/hero/);
  });

  it('find the hero scene by the hero list, in order', () => {
    const scenes = [{ beat: 'context' }, { beat: 'fix' }, { beat: 'proof' }, { beat: 'summary' }];
    expect(heroScene(scenes, ['proof', 'fix'])).toBe(2);
    expect(heroScene(scenes.slice(0, 2), ['proof', 'fix'])).toBe(1);
    expect(heroScene(scenes, ['interaction'])).toBeUndefined();
    expect(heroScene(scenes, undefined)).toBeUndefined();
  });
});
