import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ShotBeatSchema } from '../src/direction/schema.ts';
import { BEAT_VERBS_MAX, heroScene, loadTemplates } from '../src/templates.ts';

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

/** The bug-fix story's suggested verbs, beat by beat: the benchmark's story. */
const BUG_FIX_VERBS: Record<string, string[]> = {
  context: ['reveal', 'camera'],
  problem: ['split', 'stack', 'flow', 'reveal'],
  fix: ['morph', 'camera'],
  proof: ['count', 'merge', 'camera'],
  review: ['reveal', 'camera'],
  summary: ['place'],
};

function templateDir(hero: string, verbs?: string): string {
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
      `  - { id: context, eyebrow: C, eyebrows: { ko: C, ja: C, zh: C }, goal: g, visuals: [title]${verbs === undefined ? '' : `, verbs: ${verbs}`} }`,
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

  it('never make a hero beat optional', async () => {
    for (const t of (await loadTemplates()).values())
      for (const id of t.hero)
        expect(t.beats.find((b) => b.id === id)!.optional, `${t.id}: ${id}`).toBe(false);
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

  it('prefer the scene marked as the hero over the hero list', () => {
    const scenes = [{ beat: 'context' }, { beat: 'fix' }, { beat: 'review', hero: true }];
    expect(heroScene(scenes, ['fix'])).toBe(2);
    expect(heroScene(scenes, undefined)).toBe(2);
  });

  it('suggest direction verbs for every beat, each one the beat can stage', async () => {
    const verbs = new Set<string>(ShotBeatSchema.options.map((o) => o.shape.verb.value));
    // Verbs that need a measured number or a connection: never on a beat that can show neither.
    const measured = ['count', 'count-up', 'split', 'stack', 'merge', 'flow'];
    const plain = ['title', 'code', 'findings', 'callout', 'summary'];
    const templates = await loadTemplates();
    expect(Object.fromEntries(templates.get('bug-fix')!.beats.map((b) => [b.id, b.verbs]))).toEqual(
      BUG_FIX_VERBS,
    );
    for (const t of templates.values())
      for (const beat of t.beats) {
        const at = `${t.id}: ${beat.id}`;
        const kinds = beat.visuals.map((v) => v.split(':')[0]!);
        expect(beat.verbs, at).toBeDefined();
        const suggested = beat.verbs!;
        for (const verb of suggested) expect(verbs.has(verb), `${at}: ${verb}`).toBe(true);
        if (suggested.includes('morph')) expect(kinds, at).toContain('code');
        // A wrap keeps its card; every other beat suggests something that moves.
        if (kinds.every((k) => k === 'summary')) expect(suggested, at).toEqual(['place']);
        else expect(suggested, at).not.toContain('place');
        if (kinds.every((k) => plain.includes(k)))
          for (const verb of suggested) expect(measured, `${at}: ${verb}`).not.toContain(verb);
      }
  });

  it('load a beat without verbs, and refuse verbs that are unknown, repeated, or too many', async () => {
    await expect(loadTemplates(templateDir('[context]'))).resolves.toBeDefined();
    const loaded = await loadTemplates(templateDir('[context]', '[morph, camera]'));
    expect(loaded.get('tiny')!.beats[0]!.verbs).toEqual(['morph', 'camera']);
    await expect(loadTemplates(templateDir('[context]', '[morph, zoom]'))).rejects.toThrow(
      /tiny\.yml is invalid:\n {2}beats\.0\.verbs\.1: expected one of "place", "reveal"/,
    );
    await expect(loadTemplates(templateDir('[context]', '[reveal, reveal]'))).rejects.toThrow(
      /beats\.0\.verbs: name each verb once/,
    );
    await expect(loadTemplates(templateDir('[context]', '[]'))).rejects.toThrow(/beats\.0\.verbs/);
    expect(BEAT_VERBS_MAX).toBe(4);
    await expect(
      loadTemplates(templateDir('[context]', '[reveal, camera, morph, count, flow]')),
    ).rejects.toThrow(/beats\.0\.verbs/);
  });
});
