import { type FrameMark, HERO_PHASE, type HighlightGroup } from '../timeline/types.ts';
import type { Scene, Visual } from './schema.ts';

type CodeVisual = Extract<Visual, { kind: 'code' }>;
type MarkEntry = NonNullable<Extract<Visual, { kind: 'screenshot' }>['marks']>[number];

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

const unique = (names: string[]) => [...new Set(names)];

/**
 * The `highlight` entries as groups of lines, each with the phase that lights it: its own `sync`
 * name, else highlight<N>.
 */
export function highlightGroups(highlight: CodeVisual['highlight']): HighlightGroup[] {
  return highlight.map((entry, n) =>
    typeof entry === 'number'
      ? { lines: [entry], phase: `highlight${n + 1}` }
      : {
          lines: typeof entry.lines === 'number' ? [entry.lines] : [...entry.lines],
          phase: entry.sync ?? `highlight${n + 1}`,
        },
  );
}

/**
 * A visual's marks in order (an interaction's through all its steps, with the step), each with
 * its phase: its own `sync` name, else mark<N>. A focus may still be a subject reference here:
 * validation reads only the phases, and the timeline gets marks after references are placed.
 */
export function visualMarks(
  visual: Visual,
): Array<Omit<FrameMark, 'focus'> & { focus: MarkEntry['focus']; step?: number }> {
  const marks: Array<{ mark: MarkEntry; step?: number }> =
    visual.kind === 'screenshot'
      ? (visual.marks ?? []).map((mark) => ({ mark }))
      : visual.kind === 'interaction'
        ? visual.steps.flatMap((s, step) => (s.marks ?? []).map((mark) => ({ mark, step })))
        : [];
  return marks.map(({ mark, step }, i) => ({
    focus: mark.focus,
    ...(mark.label === undefined ? {} : { label: mark.label }),
    phase: mark.sync ?? `mark${i + 1}`,
    ...(step === undefined ? {} : { step }),
  }));
}

/**
 * The moments a visual can pin to a phrase (besides `hero`, which every hero scene has). An
 * interaction's first step starts with the scene, so its steps start at `step2`; its `zoom` and
 * `click` act on the step showing at that moment. A highlight entry is `highlight<N>` and a mark
 * `mark<N>` unless it names its own phase.
 */
export function phaseNames(visual: Visual): string[] {
  const marks = visualMarks(visual).map((m) => m.phase);
  switch (visual.kind) {
    case 'screenshot':
      return unique(['zoom', 'click', ...marks]);
    case 'interaction':
      return unique(['zoom', 'click', ...numbered('step', 2, visual.steps.length), ...marks]);
    case 'code': {
      const groups = highlightGroups(visual.highlight);
      return unique([
        ...(groups.length ? ['highlight', ...groups.map((g) => g.phase)] : []),
        ...(visual.mode === 'morph' ? ['morph'] : []),
      ]);
    }
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

/** Phases a visual's entries name themselves (a highlight group's or a mark's `sync`). */
function namedPhases(
  visual: Visual,
): Array<{ phase: string; path: Array<string | number>; what: string }> {
  if (visual.kind === 'code')
    return visual.highlight.flatMap((entry, n) =>
      typeof entry === 'number' || entry.sync === undefined
        ? []
        : [
            {
              phase: entry.sync,
              path: ['visual', 'highlight', n, 'sync'],
              what: `highlight entry ${n + 1}`,
            },
          ],
    );
  if (visual.kind === 'screenshot')
    return (visual.marks ?? []).flatMap((m, k) =>
      m.sync === undefined
        ? []
        : [{ phase: m.sync, path: ['visual', 'marks', k, 'sync'], what: `mark ${k + 1}` }],
    );
  if (visual.kind === 'interaction')
    return visual.steps.flatMap((s, step) =>
      (s.marks ?? []).flatMap((m, k) =>
        m.sync === undefined
          ? []
          : [
              {
                phase: m.sync,
                path: ['visual', 'steps', step, 'marks', k, 'sync'],
                what: `step ${step + 1} mark ${k + 1}`,
              },
            ],
      ),
    );
  return [];
}

/** Where the i-th mark of a visual is written. */
function markPath(visual: Visual, i: number): Array<string | number> {
  if (visual.kind === 'interaction') {
    let k = i;
    for (const [step, s] of visual.steps.entries()) {
      const n = s.marks?.length ?? 0;
      if (k < n) return ['visual', 'steps', step, 'marks', k];
      k -= n;
    }
  }
  return ['visual', 'marks', i];
}

export interface StoryboardIssue {
  path: Array<string | number>;
  message: string;
}

/** 1st, 2nd, 3rd, 4th, …, 11th, 12th, 13th, …, 21st. */
function ordinal(n: number): string {
  const last = n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10;
  return `${n}${['th', 'st', 'nd', 'rd'][last] ?? 'th'}`;
}

/**
 * What the schema alone cannot check: one id per scene, one hero, sound markup, and phrases that
 * pin a moment.
 */
export function storyboardIssues(storyboard: { scenes: readonly Scene[] }): StoryboardIssue[] {
  const issues: StoryboardIssue[] = [];
  let hero: string | undefined;
  // Timing, entrances, and direction find a scene by its id, so two scenes with one would share
  // them. A scene without an id is `s<n>`, so that one counts too.
  const named = new Map<string, number>();
  storyboard.scenes.forEach((scene, i) => {
    const name = scene.id ?? `s${i + 1}`;
    const issue = (path: Array<string | number>, message: string) =>
      issues.push({ path: ['scenes', i, ...path], message: `scene ${name}: ${message}` });
    const first = named.get(name);
    if (first === undefined) named.set(name, i);
    else {
      // Positions as ordinals: an id can be a number too, and the path counts from 0.
      const implied = scene.id === undefined || storyboard.scenes[first]!.id === undefined;
      issues.push({
        path: ['scenes', i, 'id'],
        message: `the ${ordinal(i + 1)} scene repeats the id "${name}" of the ${ordinal(first + 1)} scene${implied ? ' (a scene without an id is s and its number)' : ''}; give each scene its own id`,
      });
    }
    const line = parseEmphasis(scene.narration);
    if (line.error) issue(['narration'], line.error);
    if (scene.hero) {
      if (hero) issue(['hero'], `only one scene can be the hero, and ${hero} already is`);
      else hero = name;
    }
    const names = [...phaseNames(scene.visual), ...(scene.hero ? [HERO_PHASE] : [])];
    const found = new Map<string, number>();
    for (const [phase, phrase] of Object.entries(scene.sync ?? {})) {
      if (phase === HERO_PHASE && !scene.hero) {
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
    const v = scene.visual;
    if (v.kind === 'screenshot' && v.marks && v.focus)
      issue(['visual', 'marks'], 'set marks, or focus as the one-mark shorthand, not both');
    if (v.kind === 'interaction')
      v.steps.forEach((s, k) => {
        if (s.marks && s.focus)
          issue(
            ['visual', 'steps', k, 'marks'],
            `step ${k + 1}: set marks, or focus as the one-mark shorthand, not both`,
          );
      });
    // A phase an entry names must be pinned by `sync`; only the hero's own phase needs no phrase.
    // Own properties only: "constructor" is a phase only when the author wrote one.
    const pinned = (phase: string) => Object.hasOwn(scene.sync ?? {}, phase);
    for (const named of namedPhases(v)) {
      if (named.phase === HERO_PHASE) {
        if (!scene.hero)
          issue(named.path, `${named.what} names phase "hero", which only the hero scene has`);
      } else if (!pinned(named.phase))
        issue(
          named.path,
          `${named.what} names phase "${named.phase}", which sync does not define; add sync.${named.phase} with a phrase from the narration`,
        );
    }
    // Marks play in order, each at its own moment.
    const owner = new Map<string, number>();
    let lastMark: { phase: string; index: number } | undefined;
    visualMarks(v).forEach((mark, i) => {
      const first = owner.get(mark.phase);
      if (first !== undefined) {
        issue(
          markPath(v, i),
          `marks ${first + 1} and ${i + 1} share phase "${mark.phase}"; give each mark its own moment`,
        );
        return;
      }
      owner.set(mark.phase, i);
      const index = found.get(mark.phase);
      if (index === undefined) return;
      if (lastMark && index <= lastMark.index)
        issue(
          ['sync', mark.phase],
          `sync.${mark.phase}'s phrase comes before sync.${lastMark.phase}'s; marks play in order`,
        );
      else lastMark = { phase: mark.phase, index };
    });
    (scene.cues ?? []).forEach((cue, k) => {
      if ((cue.kind === 'hero' || cue.kind === 'riser') && !scene.hero)
        issue(['cues', k, 'kind'], `a ${cue.kind} cue belongs to the hero scene`);
      if (typeof cue.at !== 'string') return;
      if (cue.at === HERO_PHASE) {
        if (!scene.hero)
          issue(['cues', k, 'at'], `cue ${k + 1} plays at "hero", which only the hero scene has`);
      } else if (!pinned(cue.at))
        issue(
          ['cues', k, 'at'],
          `cue ${k + 1} plays at "${cue.at}", a phase this scene does not pin; add sync.${cue.at}, or give seconds`,
        );
    });
  });
  return issues;
}
