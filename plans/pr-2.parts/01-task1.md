### Task 1: Storyboard grammar: new scene fields and their validation

Adds the storyboard fields (`sync`, `transition`, `hero`, `camera`, title `background`), raises the scene limit to 24, and validates what a schema alone cannot: one hero, phrases that exist exactly once, phase names that the visual has, step order, and sound `[[…]]` markup. Messages name the scene; `parseOrThrow` turns them into a `UsageError` (exit 2).

**Files:**
- Create: `packages/video/src/storyboard/grammar.ts`
- Modify: `packages/video/src/storyboard/schema.ts`
- Modify: `packages/video/src/timeline/types.ts` (add `TransitionKind` and `HERO_PHASE` only)
- Test: `packages/video/test/grammar.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  - `timeline/types.ts`: `export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through'`; `export const HERO_PHASE = 'hero'`.
  - `storyboard/schema.ts`: `export const TRANSITION_KINDS`; `Scene` gains `sync?: Record<string, string>`, `transition?: TransitionKind`, `hero?: boolean`, `camera?: 'drift' | 'static'`; the `title` visual gains `background?: { path: string; label?: string }`.
  - `storyboard/grammar.ts`: `interface Emphasis { text: string; phrase?: string; at?: number; error?: string }`; `parseEmphasis(narration: string): Emphasis`; `stripEmphasis(text: string): string`; `interface PhraseSpan { index: number; length: number }` (counted in code points, whitespace removed); `denseLength(text: string): number`; `findPhrase(text: string, phrase: string): PhraseSpan & { count: number }` (index −1 when absent); `emphasisSpan(line: Emphasis): PhraseSpan | undefined`; `phaseNames(visual: Visual): string[]`; `interface StoryboardIssue { path: Array<string | number>; message: string }`; `storyboardIssues(storyboard: { scenes: readonly Scene[] }): StoryboardIssue[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/video/test/grammar.test.ts`:

```ts
import { parseOrThrow, UsageError } from '@covi/core';
import { describe, expect, it } from 'vitest';
import {
  emphasisSpan,
  findPhrase,
  parseEmphasis,
  phaseNames,
  stripEmphasis,
} from '../src/storyboard/grammar.ts';
import {
  type StoryboardInput,
  StoryboardSchema,
  TRANSITION_KINDS,
  type Visual,
} from '../src/storyboard/schema.ts';

const callout = { kind: 'callout', tone: 'info', title: 'C' } as const;
const shot = {
  kind: 'screenshot',
  image: { path: 'demo/screenshots/a.png' },
  focus: { x: 0, y: 0, width: 10, height: 10 },
  click: { x: 5, y: 5 },
} as const;
const step = { image: { path: 'demo/screenshots/a.png' } };

/** A valid storyboard that uses every new field; each test breaks one thing. */
function storyboard(): StoryboardInput {
  return {
    title: 'Clamp quantities',
    template: 'bug-fix',
    scenes: [
      {
        id: 'open',
        beat: 'context',
        narration: 'Remove one too many, and the cart says [[minus one]].',
        visual: {
          kind: 'title',
          title: 'Clamp quantities',
          background: { path: 'demo/screenshots/a.png' },
        },
      },
      {
        id: 'fix',
        beat: 'fix',
        narration: 'The fix clamps the quantity, and the cart stops at zero.',
        transition: 'cut',
        sync: { highlight: 'clamps the quantity' },
        visual: {
          kind: 'code',
          path: 'src/cart.js',
          lines: [{ type: 'add', text: 'qty = Math.max(0, qty - 1);' }],
          highlight: [0],
        },
      },
      {
        id: 'proof',
        beat: 'proof',
        hero: true,
        camera: 'static',
        narration: 'Click minus at zero, and nothing happens.',
        sync: { zoom: 'Click minus', click: 'nothing happens', hero: 'nothing happens' },
        visual: shot,
      },
      { id: 'wrap', beat: 'summary', narration: 'Ready to merge.', transition: 'push', visual: callout },
    ],
  };
}

/** The schema's issues as `path: message` lines, the way `parseOrThrow` prints them. */
const issues = (input: unknown) => {
  const result = StoryboardSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('caption emphasis markup', () => {
  it('reads one [[…]] phrase and removes the markup', () => {
    expect(parseEmphasis('The cart says [[minus one]].')).toEqual({
      text: 'The cart says minus one.',
      phrase: 'minus one',
      at: 14,
    });
    expect(parseEmphasis('[[ Zero ]] is the floor.')).toEqual({
      text: ' Zero  is the floor.',
      phrase: 'Zero',
      at: 1,
    });
    expect(parseEmphasis('No markup here.')).toEqual({ text: 'No markup here.' });
  });

  it('reports broken markup and never leaves brackets in the text', () => {
    for (const [line, error] of [
      ['Two [[marks]] in [[one]] line.', /more than one/],
      ['An [[unclosed mark.', /unbalanced/],
      ['A stray]] close.', /unbalanced/],
      ['Nested [[a [[b]] c]].', /unbalanced/],
      ['Empty [[ ]] mark.', /empty/],
    ] as const) {
      const parsed = parseEmphasis(line);
      expect(parsed.error, line).toMatch(error);
      expect(parsed.phrase, line).toBeUndefined();
      expect(parsed.text, line).not.toMatch(/\[\[|\]\]/);
    }
    expect(stripEmphasis('a [[b]] c]] [[')).toBe('a b c ');
  });

  it('places the phrase in characters without whitespace', () => {
    expect(emphasisSpan(parseEmphasis('The cart  says [[minus one]].'))).toEqual({
      index: 11,
      length: 8,
    });
    expect(emphasisSpan(parseEmphasis('남은 [[글자 수]]가 보입니다.'))).toEqual({ index: 2, length: 3 });
    expect(emphasisSpan(parseEmphasis('No markup.'))).toBeUndefined();
  });
});

describe('finding a synced phrase', () => {
  it('matches up to whitespace and counts in characters without whitespace', () => {
    expect(findPhrase('Open the composer,  type\na comment.', 'type a comment')).toEqual({
      index: 16,
      length: 12,
      count: 1,
    });
  });

  it('is case-sensitive, and finds nothing for a missing or blank phrase', () => {
    expect(findPhrase('Press Post.', 'press post').count).toBe(0);
    expect(findPhrase('Press Post.', 'Press Post').count).toBe(1);
    expect(findPhrase('Anything.', '  ')).toEqual({ index: -1, length: 0, count: 0 });
  });

  it('counts every occurrence, overlapping ones too', () => {
    expect(findPhrase('the cart and the list', 'the').count).toBe(2);
    expect(findPhrase('aaa', 'aa').count).toBe(2);
    expect(findPhrase('the cart and the list', 'the cart').index).toBe(0);
  });

  it('counts characters, not UTF-16 units, in CJK text and around emoji', () => {
    expect(findPhrase('残りの文字数が表示されます。', '文字数')).toEqual({
      index: 3,
      length: 3,
      count: 1,
    });
    expect(findPhrase('🎉 Ready to merge.', 'merge')).toEqual({ index: 8, length: 5, count: 1 });
  });
});

describe('phase names', () => {
  it('lists the moments each visual can pin to a phrase', () => {
    const v = (visual: unknown) => phaseNames(visual as Visual);
    expect(v(shot)).toEqual(['zoom', 'click']);
    expect(v({ kind: 'interaction', steps: [step, step, step] })).toEqual([
      'zoom',
      'click',
      'step2',
      'step3',
    ]);
    const code = (highlight: number[]) => ({ kind: 'code', path: 'a', lines: [], highlight });
    expect(v(code([1, 3]))).toEqual(['highlight', 'highlight1', 'highlight2']);
    expect(v(code([]))).toEqual([]);
    expect(v({ kind: 'before-after' })).toEqual(['reveal']);
    expect(v({ kind: 'findings', findings: [{}, {}] })).toEqual(['finding1', 'finding2']);
    expect(v({ kind: 'terminal' })).toEqual(['output']);
    expect(v({ kind: 'api' })).toEqual(['after']);
    expect(v(callout)).toEqual([]);
  });
});

describe('the storyboard schema', () => {
  it('accepts every timing field', () => {
    expect(issues(storyboard())).toEqual([]);
    expect([...TRANSITION_KINDS]).toEqual(['fade', 'cut', 'push', 'wipe', 'zoom-through']);
  });

  it('holds up to 24 scenes', () => {
    const many = (n: number) => ({
      ...storyboard(),
      scenes: Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        beat: 'b',
        narration: 'x',
        visual: callout,
      })),
    });
    expect(issues(many(24))).toEqual([]);
    expect(issues(many(25))).toHaveLength(1);
    expect(issues(many(25))[0]).toMatch(/^scenes: /);
  });

  it('rejects a second hero, naming the scene', () => {
    const sb = storyboard();
    sb.scenes[1]!.hero = true;
    expect(issues(sb)).toEqual([
      'scenes.2.hero: scene proof: only one scene can be the hero, and fix already is',
    ]);
  });

  it('rejects a sync phrase that is missing or repeated, naming the scene and the phase', () => {
    const missing = storyboard();
    missing.scenes[2]!.sync = { zoom: 'Tap minus' };
    expect(issues(missing)).toEqual([
      'scenes.2.sync.zoom: scene proof: sync.zoom quotes "Tap minus", which is not in its narration',
    ]);
    const twice = storyboard();
    twice.scenes[1]!.narration = 'Below zero becomes zero.';
    twice.scenes[1]!.sync = { highlight: 'zero' };
    expect(issues(twice)).toEqual([
      'scenes.1.sync.highlight: scene fix: sync.highlight quotes "zero", which appears 2 times in its narration; quote enough words to make it unique',
    ]);
  });

  it('matches a phrase inside [[…]] against the line without markup', () => {
    const sb = storyboard();
    sb.scenes[2]!.narration = 'Click minus at zero, and [[nothing happens]].';
    expect(issues(sb)).toEqual([]);
  });

  it('rejects a phase the visual does not have, and the hero phase off the hero', () => {
    const wrong = storyboard();
    wrong.scenes[1]!.sync = { zoom: 'clamps the quantity' };
    expect(issues(wrong)).toEqual([
      'scenes.1.sync.zoom: scene fix: a code scene has no "zoom" phase (it has: highlight, highlight1)',
    ]);
    const offHero = storyboard();
    offHero.scenes[1]!.sync = { hero: 'clamps the quantity' };
    expect(issues(offHero)).toEqual([
      'scenes.1.sync.hero: scene fix: sync.hero belongs to the hero scene; set "hero": true there, or remove it',
    ]);
  });

  it('rejects interaction steps synced out of order', () => {
    const sb = storyboard();
    sb.scenes[2] = {
      id: 'flow',
      beat: 'proof',
      narration: 'Type a comment, then post it, then edit it.',
      sync: { step2: 'then edit it', step3: 'then post it' },
      visual: { kind: 'interaction', steps: [step, step, step] },
    };
    expect(issues(sb)).toEqual([
      "scenes.2.sync.step3: scene flow: sync.step3's phrase comes before sync.step2's; steps play in order",
    ]);
  });

  it('rejects doubled or broken caption markup', () => {
    const sb = storyboard();
    sb.scenes[0]!.narration = 'Remove one [[too many]], and the cart says [[minus one]].';
    expect(issues(sb)).toEqual([
      "scenes.0.narration: scene open: more than one [[…]]: mark only the line's key phrase",
    ]);
  });

  it('rejects unknown transitions and camera modes', () => {
    const sb = storyboard() as unknown as { scenes: Array<Record<string, unknown>> };
    sb.scenes[1]!.transition = 'dissolve';
    sb.scenes[2]!.camera = 'shaky';
    expect(issues(sb).map((i) => i.split(':')[0])).toEqual([
      'scenes.1.transition',
      'scenes.2.camera',
    ]);
  });

  it('fails as a usage error (exit 2) that names the scene', () => {
    const sb = storyboard();
    sb.scenes[2]!.sync = { zoom: 'Tap minus' };
    expect(() => parseOrThrow(StoryboardSchema, sb, 'storyboard.json')).toThrow(UsageError);
    expect(() => parseOrThrow(StoryboardSchema, sb, 'storyboard.json')).toThrow(
      /scene proof: sync\.zoom quotes "Tap minus"/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/grammar.test.ts
```

Expected: FAIL, `Failed to load url ../src/storyboard/grammar.ts` (the module does not exist yet).

- [ ] **Step 3: Add `TransitionKind` and `HERO_PHASE` to `packages/video/src/timeline/types.ts`**

After the `Point` interface, add:

```ts
/** How a scene enters: the transition into it (see `motion.transitions` for their lengths). */
export type TransitionKind = 'fade' | 'cut' | 'push' | 'wipe' | 'zoom-through';

/** The phase every hero scene has: its `sync.hero` phrase, else the start of its line. */
export const HERO_PHASE = 'hero';
```

- [ ] **Step 4: Create `packages/video/src/storyboard/grammar.ts`**

```ts
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
```

- [ ] **Step 5: Extend `packages/video/src/storyboard/schema.ts`**

Add imports at the top (after the existing ones):

```ts
import type { TransitionKind } from '../timeline/types.ts';
import { storyboardIssues } from './grammar.ts';
```

After `EXPRESSION_VALUES`, add:

```ts
/** How a scene can enter (the transition into it). */
export const TRANSITION_KINDS = [
  'fade',
  'cut',
  'push',
  'wipe',
  'zoom-through',
] as const satisfies readonly TransitionKind[];
```

In the `title` visual, after `meta`, add:

```ts
    background: ImageRefSchema.optional().describe(
      'A captured image (run-relative path) to set the title over, so the first frame already shows the subject.',
    ),
```

In `SceneSchema`, after `optional`, add:

```ts
  sync: z
    .record(z.string().regex(/^[a-z]+\d*$/), z.string().min(1).max(200))
    .optional()
    .describe(
      'Pins a moment of the visual to when a phrase of `narration` is spoken: phase name → a phrase that appears exactly once in the narration. Screenshot: zoom, click. Interaction: step2…stepN, and zoom or click for the step showing then. Code: highlight, or highlight1… for each `highlight` entry. Before-after: reveal. Findings: finding1…. Terminal: output. API: after. The hero scene: hero.',
    ),
  transition: z
    .enum(TRANSITION_KINDS)
    .optional()
    .describe(
      'How the scene enters: fade (default), cut, push (slides left), wipe (reveals left to right), or zoom-through (the default for the hero). The first scene has none.',
    ),
  hero: z
    .boolean()
    .optional()
    .describe(
      'The one scene where the change clicks: it holds 0.4 s after its line, enters with zoom-through, plays the hero accent, and carries the music lift.',
    ),
  camera: z
    .enum(['drift', 'static'])
    .optional()
    .describe(
      'drift (default): captures drift slowly, and a visual that has finished pushes in while its line continues. static: the picture holds still.',
    ),
```

Replace the `StoryboardSchema` definition's `scenes` line and close it with the cross-field check:

```ts
export const StoryboardSchema = z
  .strictObject({
    schemaVersion: z.literal(1).default(1),
    /** The language of the narration and on-screen text. Absent: detected from the narration. */
    language: LanguageSchema.optional().describe(
      'Language of the narration and on-screen text: en, ko, ja, or zh (Simplified Chinese). Omit it to let Covi detect the language from the narration.',
    ),
    title: z.string().min(1),
    template: z.string().min(1),
    /** True for Covi's heuristic draft; an agent or model sets false after rewriting it. */
    draft: z.boolean().default(false),
    scenes: z.array(SceneSchema).min(2).max(24),
  })
  .superRefine((storyboard, ctx) => {
    for (const issue of storyboardIssues(storyboard))
      ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });
```

Also update the `narration` description so `covi schema storyboard` tells authors about the markup:

```ts
  narration: z
    .string()
    .max(600)
    .describe(
      'What Covi says. Also used for captions. Mark the key phrase with [[…]] (at most one per line): the caption sweeps it as it is spoken; the voice and reports never see the brackets.',
    ),
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/grammar.test.ts
cd "$WT" && npx vitest run tests/examples.test.ts tests/multilingual.test.ts packages/video/test
cd "$WT" && npm run typecheck && npx biome check --write packages/video/src/storyboard packages/video/src/timeline/types.ts packages/video/test/grammar.test.ts
cd "$WT" && ./bin/covi.mjs schema storyboard | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));const sc=s.properties.scenes;console.log(sc.maxItems, Object.keys(sc.items.properties).join(","))'
```

Expected: the grammar tests PASS; every other test still passes (no drafted storyboard uses the new fields yet); typecheck and Biome are clean; the schema line prints `24` and a key list containing `sync,transition,hero,camera`.

- [ ] **Step 7: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src/storyboard/grammar.ts packages/video/src/storyboard/schema.ts packages/video/src/timeline/types.ts packages/video/test/grammar.test.ts && git commit -F - <<'EOF'
Add the storyboard's timing grammar fields and their validation

Scenes gain sync (phase to phrase), transition, hero, and camera; a
title can sit over a captured background; a storyboard holds up to 24
scenes. A missing or repeated phrase, a phase the visual lacks, a second
hero, steps out of order, and broken [[…]] markup are usage errors that
name the scene.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
