### Task 9: The drafter opens cold and marks the hero; the model gets 15-word lines

Spec items 10 and 11. Covi's own draft opens cold (Decision 10), never writes a table of contents, and marks the template's hero. `bug-fix`'s `proof` beat is no longer optional; a hero beat without evidence is left out rather than replaced by a callout. `refineNarration` budgets each line like the skill does (Decision 13) and rejects broken markup.

**Files:**
- Modify: `packages/video/src/storyboard/draft.ts`
- Modify: `packages/video/src/storyboard/model.ts`
- Modify: `templates/stories/bug-fix.yml`
- Modify: `templates/i18n/en.yml`, `ko.yml`, `ja.yml`, `zh.yml` (remove `narration.touches` and the `narration.roadmap` block)
- Test: `packages/video/test/model.test.ts` (create), `packages/video/test/templates.test.ts`, `tests/examples.test.ts`, `tests/multilingual.test.ts` (modify), `tests/__snapshots__/english-baseline.test.ts.snap` (update)

**Interfaces:**
- Consumes: `heroScene` (Task 5), title `background` and `hero` (Task 1), `parseEmphasis`/`stripEmphasis` (Task 1).
- Produces: drafted storyboards whose first scene is a title over a capture, a moved subject scene with a short title as its eyebrow, or (with nothing to show) a title card; exactly one `hero: true` when a hero beat is present; `lineBudget(language: Language): number` in `storyboard/model.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/model.test.ts`:

```ts
import { DEFAULT_CONFIG, type GenerateRequest, type ModelProvider } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { resolveVideoSpec } from '../src/spec.ts';
import { lineBudget, refineNarration } from '../src/storyboard/model.ts';
import type { Storyboard } from '../src/storyboard/schema.ts';

/** A provider that answers with `answer` and remembers what it was asked. */
function stub(answer: () => unknown): ModelProvider & { requests: GenerateRequest<unknown>[] } {
  const requests: GenerateRequest<unknown>[] = [];
  return {
    id: 'anthropic',
    requests,
    async generate<T>(request: GenerateRequest<T>): Promise<T> {
      requests.push(request as GenerateRequest<unknown>);
      return request.schema.parse(answer());
    },
  };
}

const words = (n: number) => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}.`;
const storyboard = {
  schemaVersion: 1,
  title: 'T',
  template: 'bug-fix',
  draft: true,
  scenes: Array.from({ length: 6 }, (_, i) => ({
    id: `s${i + 1}`,
    beat: 'b',
    narration: words(30),
    visual: { kind: 'callout', tone: 'info', title: 'C' },
  })),
} as Storyboard;
const materials = {
  explanation: { headline: 'H', summary: 'S' },
  review: { verdict: 'looks-good', findings: [] },
  spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
} as unknown as Parameters<typeof refineNarration>[2];

describe('narration refinement', () => {
  it('budgets one 15-word line per scene, as six seconds of speech in other languages', () => {
    expect([lineBudget('en'), lineBudget('ko'), lineBudget('ja'), lineBudget('zh')]).toEqual([
      15, 26, 24, 18,
    ]);
  });

  it('asks for lines the skill allows, and a total those lines can hold', async () => {
    const provider = stub(() => ({ scenes: [] }));
    await refineNarration(provider, storyboard, materials);
    const prompt = provider.requests[0]!.prompt;
    const scenes = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!) as Array<{
      maxWords: number;
    }>;
    expect(scenes.map((s) => s.maxWords)).toEqual([15, 15, 15, 15, 15, 15]);
    expect(Number(/total narration budget about (\d+) words/.exec(prompt)![1])).toBe(90);
  });

  it('keeps the draft for a line over its budget or with broken [[…]] markup', async () => {
    const provider = stub(() => ({
      scenes: [
        { id: 's1', narration: 'The fix [[clamps]] the quantity at zero.' },
        { id: 's2', narration: words(25) },
        { id: 's3', narration: 'Two [[marks]] in [[one]] line.' },
        { id: 's4', narration: 'An [[unclosed mark.' },
      ],
    }));
    const refined = await refineNarration(provider, storyboard, materials);
    expect(refined.scenes[0]!.narration).toBe('The fix [[clamps]] the quantity at zero.');
    for (const i of [1, 2, 3])
      expect(refined.scenes[i]!.narration).toBe(storyboard.scenes[i]!.narration);
  });
});
```

In `packages/video/test/templates.test.ts`, add to "story templates":

```ts
  it('never make a hero beat optional', async () => {
    for (const t of (await loadTemplates()).values())
      for (const id of t.hero)
        expect(t.beats.find((b) => b.id === id)!.optional, `${t.id}: ${id}`).toBe(false);
  });
```

In `tests/examples.test.ts`, in "drafts valid storyboards for short and standard videos", replace `expect(storyboard.scenes[0]!.visual.kind).toBe('title');` with:

```ts
          // A cold open: without captures the subject itself (code, a run, a response) comes
          // first; only a change with none of those keeps a title card.
          const subjects = ['code', 'terminal', 'api'];
          const first = storyboard.scenes[0]!.visual.kind;
          if (storyboard.scenes.some((s) => subjects.includes(s.visual.kind)))
            expect(subjects).toContain(first);
          else expect(first).toBe('title');
          expect(storyboard.scenes.filter((s) => s.hero).length).toBeLessThanOrEqual(1);
          for (const s of storyboard.scenes) expect(s.narration).not.toMatch(/We'll look at/);
```

In "standard-length narration", replace the `expect(scene('title').narration).toContain(…)` statement with:

```ts
    // The cold open: no captures here, so the code moves to the front under a short title,
    // and the API exchange (the template's payoff) is the hero.
    const opening = standard.scenes[0]!;
    expect(opening.visual.kind).toBe('code');
    expect(opening.eyebrow).toBe('Paginate GET /api/users');
    expect(opening.heading).toBeUndefined();
    expect(opening.narration).toMatch(
      /^This change paginates GET \/api\/users\. The key change is in app\.js/,
    );
    expect(standard.scenes.find((s) => s.hero)?.beat).toBe('exchange');
    expect(standard.scenes.some((s) => /We'll look at/.test(s.narration))).toBe(false);
```

In `tests/multilingual.test.ts`, in "writes … explanation, review, comment, and draft", replace `for (const scene of storyboard.scenes) {` and its first assertion with:

```ts
        for (const [i, scene] of storyboard.scenes.entries()) {
          // A cold open without captures wears the change's title, text from the change kept as
          // written, as its eyebrow; every other label is in the run's language.
          if (i > 0 || scene.visual.kind === 'title') expect(scene.eyebrow, scene.beat).toMatch(label);
```

(the rest of the loop body stays).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/model.test.ts packages/video/test/templates.test.ts tests/examples.test.ts
```

Expected: FAIL: `lineBudget` is not exported, the total is 156, `proof` is optional, drafts open on a title card with a roadmap.

- [ ] **Step 3: Make `proof` required in `templates/stories/bug-fix.yml`**

Delete the line `    optional: true` under the `proof` beat (the comment above `hero:` stays).

- [ ] **Step 4: Open cold and mark the hero in `packages/video/src/storyboard/draft.ts`**

1. Import `heroScene` with the template helpers: `import { type Beat, heroScene, type StoryTemplate, selectTemplate } from '../templates.ts';`.
2. Add to `BeatContext`:

```ts
  /** The template's payoff beats: a callout never stands in for one. */
  heroBeats: ReadonlySet<string>;
```

and set it in the `ctx` literal in `draftStoryboard`: `heroBeats: new Set(template.hero),`.
3. In `buildScene`, change the last line to:

```ts
  // A callout is never the payoff: a hero beat without evidence is left out instead.
  return beat.optional || ctx.heroBeats.has(beat.id) ? undefined : fallbackScene(beat, budget, ctx);
```

4. In `narrate`, the `title` case becomes (the "It touches …" sentence was a table of contents):

```ts
    case 'title':
      return { text: stripMarkdown(intentSentence(context, language)) };
```

5. In `draftStoryboard`, replace `if (!short) addRoadmap(scenes, budgets[0] ?? 0, ctx);` with:

```ts
  openCold(scenes, budgets, ctx);
  markHero(scenes, template);
```

6. Delete `addRoadmap` and `roadmapStop`, and add in their place:

```ts
/** Visuals that are the subject itself when nothing was captured. */
const SUBJECT = new Set<Visual['kind']>(['code', 'terminal', 'api']);

/**
 * Opens cold instead of on a title card: the title over the change's main capture; without one,
 * the first scene showing code, a command, or a response (the payoff only when nothing else
 * does) moves to the front with a short form of the title as its eyebrow and the opening line
 * before its own. A change with neither keeps its title card.
 */
function openCold(scenes: Scene[], budgets: number[], ctx: BeatContext): void {
  const opening = scenes[0];
  if (opening?.visual.kind !== 'title') return;
  const title = opening.visual.title;
  const shot = primaryShot(ctx, 'after');
  if (shot?.after) {
    opening.visual = { ...opening.visual, background: { path: shot.after.path, label: shot.name } };
    return;
  }
  const hero = heroScene(scenes, [...ctx.heroBeats]);
  const subjects = scenes.flatMap((s, i) => (i > 0 && SUBJECT.has(s.visual.kind) ? [i] : []));
  const index = subjects.find((i) => i !== hero) ?? subjects[0];
  if (index === undefined) return;
  const { heading: _heading, ...subject } = scenes[index]!;
  const { language } = ctx;
  const budget = (budgets[0] ?? 0) + (budgets[index] ?? 0);
  scenes.splice(index, 1);
  scenes[0] = {
    ...subject,
    eyebrow: shortTitle(title),
    narration: fitWords(
      joinSentences(language, [opening.narration, subject.narration]),
      budget,
      language,
    ),
    say: fitWords(
      joinSentences(language, [
        opening.say ?? spoken(opening.narration, language),
        subject.say ?? spoken(subject.narration, language),
      ]),
      budget + units(2.4, language),
      language,
    ),
  };
}

/** The template's payoff, the first one present, is the video's hero; a hero is never optional. */
function markHero(scenes: Scene[], template: StoryTemplate): void {
  const index = heroScene(scenes, template.hero);
  if (index === undefined) return;
  const { optional: _optional, ...scene } = scenes[index]!;
  scenes[index] = { ...scene, hero: true };
}

/** A title short enough for an eyebrow: whole words, at most `max` characters. */
function shortTitle(title: string, max = 32): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}
```

7. Remove `listOf` from the `@covi/core` import only if nothing else uses it (`list` in `narrate` and `exchangeDetail` still do, so it stays).

- [ ] **Step 5: Remove the table-of-contents strings from the four catalogs**

In each of `templates/i18n/en.yml`, `ko.yml`, `ja.yml`, `zh.yml`, under the top-level `narration:` key:

- delete the `touches:` line that sits directly under `narration:` (`  touches: ' It touches {areas}.'` in English; line 677 in en, 667 in ko, 666 in ja and zh). Do **not** touch `summary.touches` in the `explain` section (line 372 in ko), which the explanation still uses;
- delete the whole `  roadmap:` block (its `text` and the stop names `api` … `findings`).

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && grep -n "roadmap\|narration.touches\|say('touches'" templates/i18n/*.yml packages/video/src -r
```

Expected: no output.

- [ ] **Step 6: Budget lines in `packages/video/src/storyboard/model.ts`**

Add `import { parseEmphasis, stripEmphasis } from './grammar.ts';` and, above `describeVisual`:

```ts
/**
 * How much one scene's line may hold: the skill's 15-word line, which English speaks in about six
 * seconds, as six seconds of speech in other languages (Korean 26, Japanese 24, Chinese 18).
 */
export function lineBudget(language: Language): number {
  return Math.round((15 / SPEECH_RATE.en) * SPEECH_RATE[language]);
}
```

In `refineNarration`, replace the `total` and `budgetOf` lines with:

```ts
  const line = lineBudget(scenesLanguage);
  const budgetOf = (text: string) =>
    Math.min(line, Math.max(8, Math.round(speechUnits(text, scenesLanguage) * 1.3) + 4));
  // The total is what the lines can hold, never more than the video's length allows.
  const total = Math.min(
    Math.round(materials.spec.duration.target * SPEECH_RATE[scenesLanguage] * 0.78),
    storyboard.scenes.reduce((n, s) => n + budgetOf(s.narration), 0),
  );
```

and in the final `scenes.map`, after `if (!p?.narration.trim()) return s;`:

```ts
      // A rewrite that breaks its [[…]] markup, or runs past its line, keeps the draft.
      if (parseEmphasis(p.narration).error) return s;
      const budget = budgetOf(s.narration);
      if (speechUnits(stripEmphasis(p.narration), scenesLanguage) > budget * 1.25) return s;
```

(replacing the two existing lines that compute `budget` and compare it).

- [ ] **Step 7: Run the tests, then update the English baseline and check what changed**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test tests/examples.test.ts tests/multilingual.test.ts packages/core/test/catalog.test.ts
cd "$WT" && npx vitest run tests/english-baseline.test.ts -u
cd "$WT" && git diff tests/__snapshots__/english-baseline.test.ts.snap | grep '^[-+]exports\[' | sed 's/ [0-9]*`\] = .*//' | sort -u
cd "$WT" && git diff tests/__snapshots__/english-baseline.test.ts.snap | grep -c "We'll look at"
```

Expected: the first command PASSES. The snapshot update only touches entries named `… drafts the same storyboards and captions > storyboard …`, `… > captions …`, and `drafts every template the same way > …`; no `rules`, `explanation`, `review`, `summary`, `comment.md`, `brief.md`, `chunks`, `cues`, or demonstration entry changes (the grep prints only storyboard, captions, and template names, and only on `-` lines for removed entries if any). Read the diff of one example (`api-users-pagination`, standard, with demo): the first scene gains `"background"`, its narration loses "It touches …" and "We'll look at …", the hero scene gains `"hero": true`, and no scene is `optional` and hero at once. The last command counts removed roadmap lines (all on `-` lines). If anything else changed, stop and report it.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npm run typecheck && npx biome check --write packages/video/src/storyboard packages/video/test tests
cd "$WT" && git add packages/video/src/storyboard templates/stories/bug-fix.yml templates/i18n packages/video/test tests && git commit -F - <<'EOF'
Draft cold opens with a marked hero, and budget refined lines

The drafted first scene is the title over the main capture, or, without
captures, the code, run, or response that shows the change, with a short
title as its eyebrow. The table-of-contents line is gone from every
catalog, and the template's payoff is marked hero: true (never optional;
bug-fix's proof is now required). Model refinement asks for 15-word
lines and keeps the draft when a rewrite breaks its [[…]] markup.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
