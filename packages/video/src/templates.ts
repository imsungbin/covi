import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseOrThrow, type ReviewContext, resourcePath } from '@covi/core';
import { parse } from 'yaml';
import { z } from 'zod';
import { EXPRESSION_VALUES } from './storyboard/schema.ts';

/**
 * Storytelling templates are data (templates/stories/*.yml): ordered beats with a goal, preferred
 * visuals, and a narrator expression. They describe story patterns; rendering stays in the engine.
 */
const VISUAL_TOKEN =
  /^(title|change-map|code|screenshot|before-after|interaction|terminal|api|findings|callout|diagram|summary)(:(before|after))?$/;

export const BeatSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  eyebrow: z.string().max(40),
  /** The eyebrow in Korean, Japanese, and Chinese (English is `eyebrow`). */
  eyebrows: z.strictObject({
    ko: z.string().max(40),
    ja: z.string().max(40),
    zh: z.string().max(40),
  }),
  goal: z.string().min(1),
  visuals: z.array(z.string().regex(VISUAL_TOKEN)).min(1),
  expression: z.enum(EXPRESSION_VALUES).default('explaining'),
  optional: z.boolean().default(false),
});

export const TemplateSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  use_when: z.string(),
  beats: z.array(BeatSchema).min(2),
  /** Beat ids used for short-form videos, in order. */
  short: z.array(z.string()).min(2),
  /**
   * The payoff: beat ids in priority order. The first scene playing one of them is where the
   * music lifts on a downbeat.
   */
  hero: z.array(z.string()).min(1),
});

export type Beat = z.output<typeof BeatSchema>;
export type StoryTemplate = z.output<typeof TemplateSchema>;

let cache: Map<string, StoryTemplate> | undefined;

export async function loadTemplates(
  dir = resourcePath('templates', 'stories'),
): Promise<Map<string, StoryTemplate>> {
  if (cache && dir === resourcePath('templates', 'stories')) return cache;
  const map = new Map<string, StoryTemplate>();
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.yml')).sort()) {
    const template = parseOrThrow(
      TemplateSchema,
      parse(await readFile(join(dir, file), 'utf8')),
      `templates/stories/${file}`,
    );
    for (const [list, ids] of [
      ['short', template.short],
      ['hero', template.hero],
    ] as const) {
      for (const id of ids) {
        if (!template.beats.some((b) => b.id === id))
          throw new Error(`templates/stories/${file}: ${list} beat "${id}" is not defined`);
      }
    }
    map.set(template.id, template);
  }
  if (dir === resourcePath('templates', 'stories')) cache = map;
  return map;
}

/**
 * The index of the hero scene: the scene marked `hero`, else the first scene whose beat is in
 * the hero list, taking the list in order (a bug fix's proof when it was captured, else its fix).
 */
export function heroScene(
  scenes: ReadonlyArray<{ beat: string; hero?: boolean }>,
  hero: readonly string[] | undefined,
): number | undefined {
  const marked = scenes.findIndex((s) => s.hero);
  if (marked !== -1) return marked;
  for (const beat of hero ?? []) {
    const index = scenes.findIndex((s) => s.beat === beat);
    if (index !== -1) return index;
  }
  return undefined;
}

export interface TemplateChoice {
  id: string;
  reason: string;
}

/** Picks the storytelling pattern that fits the change. */
export function selectTemplate(
  context: ReviewContext,
  evidence: { hasScreenshots: boolean; hasTerminal: boolean; hasApi: boolean },
): TemplateChoice {
  const kinds = new Set(context.demonstration.kinds);
  const intent = context.intent.kind;
  if (intent === 'bug-fix' || intent === 'security')
    return { id: 'bug-fix', reason: `intent is ${intent}` };
  if (kinds.has('architecture'))
    return {
      id: 'architecture-explainer',
      reason: 'a large structural change with no user-visible surface',
    };
  if ((kinds.has('visual') || intent === 'visual') && !kinds.has('interaction'))
    return { id: 'before-after', reason: 'the change is mostly visual' };
  if (kinds.has('ui') || kinds.has('interaction'))
    return { id: 'feature-demo', reason: 'user-facing UI behavior changes' };
  if (kinds.has('api') && (evidence.hasApi || !kinds.has('cli')))
    return { id: 'api-change', reason: 'API behavior changes' };
  if (kinds.has('cli')) return { id: 'cli-change', reason: 'command-line behavior changes' };
  return { id: 'quick-review', reason: 'no more specific story fits' };
}
