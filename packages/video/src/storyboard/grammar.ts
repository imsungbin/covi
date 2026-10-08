import type { Scene, Visual } from './schema.ts';

/*
 * The storyboard's timing grammar, checked before anything is rendered: `[[…]]` marks a line's
 * key phrase for the caption, `sync` pins a visual's moments to phrases of the line, and one
 * scene may be the hero. These are the author's mistakes to fix, so every message names the scene.
 */

/** A line of narration with its `[[…]]` markup read. */
export interface Emphasis {
  /** The narration without markup: what the voice says, the captions show, and reports print. */
  text: string;
  /** The marked phrase, when the line marks one and its markup is sound. */
  phrase?: string;
  /** Where the phrase starts in `text` (a UTF-16 offset). */
  at?: number;
  /** What is wrong with the markup. */
  error?: string;
}

const MARK = /\[\[([^[\]]*)\]\]/g;
const MARKER = /\[\[|\]\]/g;

/** Removes every `[[` and `]]`, balanced or not: what a voice reads and a report prints. */
export function stripEmphasis(text: string): string {
  return text.replace(MARKER, '');
}

export function parseEmphasis(narration: string): Emphasis {
  const marks = [...narration.matchAll(MARK)];
  const unmarked = narration.replace(MARK, '$1');
  const error = /\[\[|\]\]/.test(unmarked)
    ? 'unbalanced [[…]]: every "[[" needs a "]]", and a marked phrase holds no brackets'
    : marks.length > 1
      ? "more than one [[…]]: mark only the line's key phrase"
      : marks.some((m) => !m[1]!.trim())
        ? 'an empty [[ ]]'
        : undefined;
  const text = stripEmphasis(unmarked);
  const mark = marks[0];
  if (error) return { text, error };
  if (!mark) return { text };
  // One mark and no stray markers: the text before it is unchanged, so its offset carries over.
  const inner = mark[1]!;
  return { text, phrase: inner.trim(), at: mark.index + inner.length - inner.trimStart().length };
}

/**
 * Where a phrase sits in a line, counted in characters (code points) with whitespace removed:
 * the one measure that survives how captions re-space and re-break a line.
 */
export interface PhraseSpan {
  index: number;
  length: number;
}

/** Characters without whitespace, by code point. */
export function denseLength(text: string): number {
  return [...text.replace(/\s/g, '')].length;
}

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Finds a phrase in a line, verbatim up to whitespace (runs of whitespace compare as one space)
 * and case-sensitive. `count` counts every occurrence, overlapping ones too; `index` is the
 * first one's, or −1.
 */
export function findPhrase(text: string, phrase: string): PhraseSpan & { count: number } {
  const hay = squeeze(text);
  const needle = squeeze(phrase);
  let first = -1;
  let count = 0;
  if (needle)
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
      if (first === -1) first = i;
      count++;
    }
  return {
    index: first === -1 ? -1 : denseLength(hay.slice(0, first)),
    length: denseLength(needle),
    count,
  };
}

/** The marked phrase's place, for the caption's emphasis. */
export function emphasisSpan(line: Emphasis): PhraseSpan | undefined {
  if (line.phrase === undefined || line.at === undefined) return undefined;
  return { index: denseLength(line.text.slice(0, line.at)), length: denseLength(line.phrase) };
}

const numbered = (prefix: string, from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => `${prefix}${from + i}`);

/**
 * The moments a visual can pin to a phrase (besides `hero`, which every hero scene has). An
 * interaction's first step starts with the scene, so its steps start at `step2`; its `zoom` and
 * `click` act on the step showing at that moment. `highlightN` is the N-th entry of `highlight`.
 */
export function phaseNames(visual: Visual): string[] {
  switch (visual.kind) {
    case 'screenshot':
      return ['zoom', 'click'];
    case 'interaction':
      return ['zoom', 'click', ...numbered('step', 2, visual.steps.length)];
    case 'code':
      return visual.highlight.length
        ? ['highlight', ...numbered('highlight', 1, visual.highlight.length)]
        : [];
    case 'before-after':
      return ['reveal'];
    case 'findings':
      return numbered('finding', 1, visual.findings.length);
    case 'terminal':
      return ['output'];
    case 'api':
      return ['after'];
    default:
      return [];
  }
}

export interface StoryboardIssue {
  path: Array<string | number>;
  message: string;
}

/** What the schema alone cannot check: one hero, sound markup, and phrases that pin a moment. */
export function storyboardIssues(storyboard: { scenes: readonly Scene[] }): StoryboardIssue[] {
  const issues: StoryboardIssue[] = [];
  let hero: string | undefined;
  storyboard.scenes.forEach((scene, i) => {
    const name = scene.id ?? `s${i + 1}`;
    const issue = (path: Array<string | number>, message: string) =>
      issues.push({ path: ['scenes', i, ...path], message: `scene ${name}: ${message}` });
    const line = parseEmphasis(scene.narration);
    if (line.error) issue(['narration'], line.error);
    if (scene.hero) {
      if (hero) issue(['hero'], `only one scene can be the hero, and ${hero} already is`);
      else hero = name;
    }
    const names = [...phaseNames(scene.visual), ...(scene.hero ? ['hero'] : [])];
    const found = new Map<string, number>();
    for (const [phase, phrase] of Object.entries(scene.sync ?? {})) {
      if (phase === 'hero' && !scene.hero) {
        issue(
          ['sync', phase],
          'sync.hero belongs to the hero scene; set "hero": true there, or remove it',
        );
        continue;
      }
      if (!names.includes(phase)) {
        issue(
          ['sync', phase],
          `a ${scene.visual.kind} scene has no "${phase}" phase (it has: ${names.join(', ') || 'none'})`,
        );
        continue;
      }
      const at = findPhrase(line.text, phrase);
      if (at.count === 0)
        issue(['sync', phase], `sync.${phase} quotes "${phrase}", which is not in its narration`);
      else if (at.count > 1)
        issue(
          ['sync', phase],
          `sync.${phase} quotes "${phrase}", which appears ${at.count} times in its narration; quote enough words to make it unique`,
        );
      else found.set(phase, at.index);
    }
    if (scene.visual.kind === 'interaction') {
      // Steps play in order, so the phrases that start them must come in order too.
      let last: { step: number; index: number } | undefined;
      for (let step = 2; step <= scene.visual.steps.length; step++) {
        const index = found.get(`step${step}`);
        if (index === undefined) continue;
        if (last && index <= last.index)
          issue(
            ['sync', `step${step}`],
            `sync.step${step}'s phrase comes before sync.step${last.step}'s; steps play in order`,
          );
        else last = { step, index };
      }
    }
  });
  return issues;
}
