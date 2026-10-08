### Task 5: Layout without padding: cuts placed by the lines, the hero hold, shorter minimums

The layout becomes line-driven. Lines are 0.35 s apart at an ordinary scene change; the transition into the next scene starts at `max(lineEnd − 0.5·d, nextLine − 0.6·d)`; a visual still stays up for its (now shorter) minimum; the hero holds 0.4 s after its line; the first line starts by 0.3 s; breaths live in the incoming scene's lead (Decisions 2 and 3). The fitter stops padding. `heroScene` prefers `hero: true`, which moves the music's hero moment and the hero breath to that scene.

**Files:**
- Modify: `packages/video/src/timeline/build.ts` (`minSecondsFor`, `Pacing`, `BREATHING`, `layoutScenes`, `FitResult`, `fitToDuration`; new `LINE_GAP`, `HERO_HOLD`, `cutStart`)
- Modify: `packages/video/src/templates.ts` (`heroScene`)
- Modify: `packages/video/src/sound.ts` (`heroMoment`)
- Test: `packages/video/test/pacing.test.ts`, `packages/video/test/captions-timeline.test.ts`, `packages/video/test/templates.test.ts` (modify); `packages/video/test/hero.test.ts` (create)

**Interfaces:**
- Consumes: `sceneTransition` (Task 3), `Scene.hero`/`transition`/`minSeconds`, `stripEmphasis` (Task 1).
- Produces: `export const LINE_GAP = 0.35`; `export const HERO_HOLD = 0.4`; `export function cutStart(lineEnd: number, nextLine: number, seconds: number): number`; `layoutScenes` keeps its signature `(scenes, speech, extraHold = new Map(), language = 'en', pacing = TIGHT): Layout`; `FitResult` loses `extraHold`; `heroScene(scenes: ReadonlyArray<{ beat: string; hero?: boolean }>, hero: readonly string[] | undefined): number | undefined`.

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/pacing.test.ts`:

1. Extend the imports: add `motion` from `@covi/brand`, `TRANSITION_KINDS` from `../src/storyboard/schema.ts`, and `cutStart`, `HERO_HOLD`, `LINE_GAP` from `../src/timeline/build.ts`.
2. In "breathes in narrated standard reviews and keeps short-form tight", change `firstLead: 2` to `firstLead: 0.3`, and change the custom-landscape assertion to `expect(pacingFor(spec({ mode: 'custom', width: 1280, height: 720 }), HERO).heroBreath).toBe(1.4);`.
3. Replace the test "holds the title while the music opens, and lets the hero settle before its line" with:

```ts
  it('starts the hook by 0.3 s, lets the hero settle before its line, and breathes around it', () => {
    const layout = layoutScenes(story, talk, new Map(), 'en', pacingFor(standard, HERO));
    const [s1, s2, s3, s4] = layout.scenes;
    expect(s1!.speechStart).toBe(0.3);
    // The hero (the fix) settles as its transition ends, then 1.4 s pass before its line.
    expect(s3!.speechStart - (s3!.start + TRANSITION)).toBeCloseTo(1.4, 6);
    expect(s3!.speechStart - s2!.speechEnd).toBeGreaterThanOrEqual(1.5);
    // The breaths after the hook and after the hero, where bookends music is heard.
    expect(s2!.speechStart - s1!.speechEnd).toBeCloseTo(LINE_GAP + 1.25, 6);
    expect(s4!.speechStart - s3!.speechEnd).toBeCloseTo(LINE_GAP + 1.25, 6);
    // A breath belongs to the scene after it: the old picture leaves as at any scene change.
    expect(s1!.end - s1!.speechEnd).toBeLessThanOrEqual(0.6);
  });
```

4. In "lets the verdict land before the summary speaks", change the first expectation to `expect(summary.speechStart - summary.start).toBeCloseTo(0.6 * TRANSITION + 1.25, 6);`.
5. In "pauses at a scene change after a long stretch of talk", change the last expectation to `expect(held.scenes[4]!.speechStart - held.scenes[4]!.start).toBeCloseTo(0.6 * TRANSITION, 6);`.
6. Replace "fits the duration window with the breaths and the outro in it" with:

```ts
  it('never pads a video shorter than its window', () => {
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'bug-fix',
      draft: true,
      scenes: story,
    };
    const brief = new Map(story.map((s) => [s.id!, 4]));
    const paced = pacingFor(standard, HERO);
    const fit = fitToDuration(storyboard, brief, standard, 'en', paced);
    expect(fit.layout).toEqual(layoutScenes(story, brief, new Map(), 'en', paced));
    expect(fit.layout.duration).toBeLessThan(standard.duration.min);
    expect(fit.notes).toEqual([]);
    expect(fit).not.toHaveProperty('extraHold');
    // fitToDuration paces by the spec when it is not told otherwise.
    expect(fitToDuration(storyboard, talk, standard).layout.outro).toBeDefined();
    const config = resolveConfig([
      { name: 'explicit', values: parseConfigInput({ video: { outro: false } }, 't') },
    ]).config;
    expect(
      fitToDuration(storyboard, talk, resolveVideoSpec(config, { mode: 'standard' })).layout.outro,
    ).toBeUndefined();
  });

  it('trims only past the window’s maximum, and never drops the hero', () => {
    const scenes = story.map((s, i) =>
      i === 2 ? { ...s, optional: true, hero: true } : i === 3 ? { ...s, optional: true } : s,
    );
    const storyboard: Storyboard = { schemaVersion: 1, title: 'x', template: 'bug-fix', draft: true, scenes };
    const long = new Map([...talk].map(([id, s]) => [id, s * 2.4]));
    const fit = fitToDuration(storyboard, long, standard, 'en', pacingFor(standard, HERO));
    expect(fit.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's5']);
    expect(fit.notes[0]).toMatch(/Dropped optional scene "review"/);
    expect(fit.layout.duration).toBeLessThanOrEqual(standard.duration.max);
  });
```

7. Append a new block:

```ts
describe('the timing grammar', () => {
  const three = (middle: Partial<Scene> = {}) => [
    scene('s1', 'a', 'callout'),
    scene('s2', 'b', 'callout', middle),
    scene('s3', 'c', 'callout'),
  ];
  const lines = new Map([
    ['s1', 3],
    ['s2', 3],
    ['s3', 3],
  ]);

  it('starts a transition at max(line end − 0.5·d, next line − 0.6·d), whatever its kind', () => {
    for (const kind of TRANSITION_KINDS) {
      const [a, b] = layoutScenes(three({ transition: kind }), lines).scenes;
      const d = motion.transitions[kind];
      expect(b!.start, kind).toBeCloseTo(
        Math.max(a!.speechEnd - 0.5 * d, b!.speechStart - 0.6 * d),
        3,
      );
      expect(b!.start, kind).toBeCloseTo(cutStart(a!.speechEnd, a!.speechEnd + LINE_GAP, d), 3);
      expect(b!.speechStart - a!.speechEnd, kind).toBeCloseTo(LINE_GAP, 3);
      expect(a!.end, kind).toBeCloseTo(b!.start + d, 3);
      // So no scene outstays its line by more than 0.6 s.
      expect(a!.end - a!.speechEnd, kind).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('cuts on the first word of the next line', () => {
    const [, b] = layoutScenes(three({ transition: 'cut' }), lines).scenes;
    expect(b!.start).toBe(b!.speechStart);
  });

  it('lets the hero in with zoom-through and holds it 0.4 s after its line', () => {
    const [a, b, c] = layoutScenes(three({ hero: true }), lines).scenes;
    const d = motion.transitions['zoom-through'];
    expect(b!.start).toBeCloseTo(Math.max(a!.speechEnd - 0.5 * d, b!.speechStart - 0.6 * d), 3);
    expect(c!.speechStart - b!.speechEnd).toBeCloseTo(LINE_GAP + HERO_HOLD, 3);
    const plain = layoutScenes(three(), lines).scenes;
    expect(plain[2]!.speechStart - plain[1]!.speechEnd).toBeCloseTo(LINE_GAP, 3);
  });

  it('holds a hero that comes first, or last before the outro', () => {
    const first = layoutScenes(
      [scene('s1', 'a', 'callout', { hero: true }), scene('s2', 'b', 'callout')],
      lines,
    ).scenes;
    expect(first[0]!.start).toBe(0);
    expect(first[1]!.speechStart - first[0]!.speechEnd).toBeCloseTo(LINE_GAP + HERO_HOLD, 3);
    const last = layoutScenes(
      [scene('s1', 'a', 'callout'), scene('s2', 'b', 'callout', { hero: true })],
      lines,
      new Map(),
      'en',
      pacingFor(standard),
    ).scenes;
    expect(last[1]!.end - last[1]!.speechEnd).toBeCloseTo(0.8 + HERO_HOLD, 3);
  });

  it('keeps a visual up for its minimum, and starts the next line after it', () => {
    const [, b, c] = layoutScenes(
      three({ minSeconds: 6 }),
      new Map([
        ['s1', 3],
        ['s2', 1],
        ['s3', 3],
      ]),
    ).scenes;
    expect(b!.end - b!.start).toBeCloseTo(6, 3);
    expect(c!.speechStart - c!.start).toBeCloseTo(0.6 * TRANSITION, 3);
  });

  it('starts the hook by 0.3 s in every kind of video', () => {
    for (const mode of ['short', 'standard'] as const) {
      const paced = pacingFor(spec({ mode }), HERO);
      expect(layoutScenes(story, talk, new Map(), 'en', paced).scenes[0]!.speechStart).toBeLessThanOrEqual(0.3);
    }
  });

  it('gives the visuals the shorter minimums that 2–5 s scenes need', () => {
    const line = { type: 'add', text: 'x' } as const;
    const v = (visual: unknown) => minSecondsFor(visual as Scene['visual']);
    expect(v({ kind: 'title', title: 'T', meta: [] })).toBe(1.5);
    expect(v({ kind: 'code', path: 'a', lines: Array(40).fill(line), highlight: [] })).toBe(2);
    expect(v({ kind: 'before-after' })).toBe(2.5);
    expect(v({ kind: 'interaction', steps: [{}, {}, {}] })).toBeCloseTo(3.6, 9);
    expect(v({ kind: 'findings', findings: [{}, {}] })).toBeCloseTo(2.8, 9);
  });
});
```

(Add `minSecondsFor` to the import from `../src/timeline/build.ts`.)

In `packages/video/test/captions-timeline.test.ts`:

- Import `pacingFor` and `LINE_GAP` from `../src/timeline/build.ts` as well.
- In "lays scenes out from narration length with overlapping transitions", replace the expectations after `const [a, b, c] = layout.scenes;` with:

```ts
    expect(a!.start).toBe(0);
    expect(b!.start).toBeCloseTo(a!.end - TRANSITION, 3);
    // Lead 0.6·d, the line, then the tail to the next cut (0.35 s gap + 0.4·d).
    expect(b!.end - b!.start).toBeCloseTo(0.6 * TRANSITION + 6 + LINE_GAP + 0.4 * TRANSITION, 3);
    expect(a!.end - a!.start).toBeCloseTo(0.2 + 1 + LINE_GAP + 0.4 * TRANSITION, 3);
    expect(c!.speechStart).toBeCloseTo(c!.start + 0.6 * TRANSITION, 3);
    // A summary card stays up 3.4 s, and a 1 s hold follows it.
    expect(c!.end - c!.start).toBeCloseTo(3.4, 3);
    expect(layout.duration).toBeCloseTo(c!.end + 1, 3);
```

- Replace "extends visual holds to reach the minimum" with:

```ts
  it('never pads a short video to reach the minimum', () => {
    const config = resolveConfig([
      { name: 'explicit', values: parseConfigInput({ video: { mode: 'standard' } }, 't') },
    ]).config;
    const spec = resolveVideoSpec(config);
    const storyboard: Storyboard = {
      schemaVersion: 1,
      title: 'x',
      template: 'quick-review',
      draft: true,
      scenes: [scene('s1', 'title', 'a'), scene('s2', 'callout', 'b'), scene('s3', 'summary', 'c')],
    };
    const speech = new Map([
      ['s1', 2],
      ['s2', 8],
      ['s3', 2],
    ]);
    const fit = fitToDuration(storyboard, speech, spec);
    expect(fit.layout).toEqual(
      layoutScenes(storyboard.scenes, speech, new Map(), 'en', pacingFor(spec)),
    );
    expect(fit.layout.duration).toBeLessThan(spec.duration.min);
    expect(fit.notes).toEqual([]);
  });
```

In `packages/video/test/templates.test.ts`, add to "story templates":

```ts
  it('prefer the scene marked as the hero over the hero list', () => {
    const scenes = [{ beat: 'context' }, { beat: 'fix' }, { beat: 'review', hero: true }];
    expect(heroScene(scenes, ['fix'])).toBe(2);
    expect(heroScene(scenes, undefined)).toBe(2);
  });
```

Create `packages/video/test/hero.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { heroMoment } from '../src/sound.ts';
import type { TimelineScene } from '../src/timeline/types.ts';

const scene = (
  id: string,
  beat: string,
  start: number,
  end: number,
  extra: Partial<TimelineScene> = {},
) =>
  ({
    id,
    beat,
    eyebrow: beat,
    start,
    end,
    visual: { kind: 'callout', tone: 'info', title: 'C' },
    expression: 'explaining',
    narrator: true,
    ...extra,
  }) as TimelineScene;

describe('the music hero moment', () => {
  it('lands on the hero once it has settled, preferring hero: true over the template beats', async () => {
    const scenes = [
      scene('s1', 'context', 0, 3),
      scene('s2', 'fix', 2.55, 6, { transition: { kind: 'fade', seconds: 0.45 } }),
      scene('s3', 'review', 5.4, 9, {
        hero: true,
        transition: { kind: 'zoom-through', seconds: 0.6 },
      }),
    ];
    expect(await heroMoment({ scenes }, 'bug-fix')).toBeCloseTo(6, 9);
    // Without a marked hero, the template's beats decide (bug-fix: proof, then fix).
    const unmarked = scenes.map(({ hero: _hero, ...s }) => s as TimelineScene);
    expect(await heroMoment({ scenes: unmarked }, 'bug-fix')).toBeCloseTo(3, 9);
    // Timelines written before per-scene transitions settle after the shared fade.
    expect(
      await heroMoment({ scenes: [scene('s1', 'context', 0, 3), scene('s2', 'fix', 2.55, 6)] }, 'bug-fix'),
    ).toBeCloseTo(3, 9);
    expect(await heroMoment({ scenes: [scene('s1', 'context', 0, 3)] }, 'bug-fix')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && npx vitest run packages/video/test/pacing.test.ts packages/video/test/captions-timeline.test.ts packages/video/test/templates.test.ts packages/video/test/hero.test.ts
```

Expected: FAIL: `cutStart`/`LINE_GAP`/`HERO_HOLD` are not exported, `firstLead` is 2, the fitter pads, `heroScene` ignores `hero`, and `heroMoment` returns the template beat's moment for the marked timeline.

- [ ] **Step 3: Rewrite the layout and the fitter in `packages/video/src/timeline/build.ts`**

Add `stripEmphasis` to the `../storyboard/grammar.ts` import.

Replace the constants block from `const LEAD_IN = 0.3;` through `const BREATH_GAP = 1.5;` with:

```ts
/** The pause between one line and the next at an ordinary scene change. */
export const LINE_GAP = 0.35;
/** At most this share of a transition plays over the end of the line before it… */
const OVER_LINE = 0.5;
/** …and the next line starts this far into it: the picture arrives with the words. */
const INTO_LINE = 0.6;
/** The hero holds its picture this long after its line before the next scene takes over. */
export const HERO_HOLD = 0.4;
/** Without the outro, the last scene lingers this long after its last word, then the hold. */
const TAIL = 0.5;
/** Before the outro, the last scene lingers a moment after its last word. */
const LAST_TAIL = 0.8;
/**
 * Without the outro, the video holds its last scene this long: room for the sonic logo's pickup
 * after the last line, whatever the music; frames never depend on the music choice.
 */
const HOLD = 1;
/** A pause between two lines at least this long already breathes (bookends music rises in it). */
const BREATH_GAP = 1.5;

/**
 * When the transition into the next scene starts: as late as it can while the next line still
 * starts within its first 60%, and never with more than half of it over the line before. With
 * lines `LINE_GAP` apart, the scene before ends at most 0.35 + 0.4·d after its line.
 */
export function cutStart(lineEnd: number, nextLine: number, seconds: number): number {
  return Math.max(lineEnd - OVER_LINE * seconds, nextLine - INTO_LINE * seconds);
}
```

Update the `Pacing` doc comments for `firstLead` and `breath`:

```ts
  /** Seconds before the first scene's line: at most 0.3, so the hook is heard by 0.5 s. */
  firstLead: number;
  // …
  /**
   * Extra lead before the line after the hook, the line after the hero, the summary's line, and a
   * line that ends a long stretch of talk.
   */
  breath?: number;
```

Replace `BREATHING` and its comment with:

```ts
/**
 * Narrated standard reviews breathe: the hook is heard at once, then the music opens in a breath
 * before the second line; the hero scene settles before its line so the music's lift lands clear
 * of speech, and the line after it breathes again; the verdict lands before the summary's line;
 * and long stretches of talk pause at a scene change. A music placement that plays only around
 * the narration (bookends) is heard in exactly these breaths.
 */
const BREATHING = { firstLead: 0.3, heroBreath: 1.4, breath: 1.25, chapter: 24 } as const;
```

Replace `minSecondsFor` with:

```ts
/** The least time a visual needs on screen to be read, regardless of narration length. */
export function minSecondsFor(visual: Visual): number {
  switch (visual.kind) {
    case 'title':
      return 1.5;
    case 'summary':
      return 3.4;
    case 'code':
      return 2;
    case 'before-after':
      return 2.5;
    case 'interaction':
      return 1.2 * visual.steps.length;
    case 'terminal':
      return visual.before ? 4.4 : 3.4;
    case 'api':
      return visual.before ? 4.6 : 3.6;
    case 'findings':
      return 2 + 0.4 * visual.findings.length;
    case 'diagram':
      return 3.8;
    default:
      return 3;
  }
}
```

Replace `layoutScenes` (and its doc comment) with:

```ts
/**
 * Narration-first timing, line by line. Lines are `LINE_GAP` apart at an ordinary scene change,
 * and the transition into each scene starts where `cutStart` puts it. A scene stays up for its
 * visual's minimum, and the next line waits for it; the hero holds `HERO_HOLD` after its line. A
 * breath belongs to the scene after it: the transition starts as at any scene change and the new
 * picture holds the breath, so no scene outstays its line by more than 0.6 s. The video ends with
 * the outro or a short hold.
 */
export function layoutScenes(
  scenes: readonly Scene[],
  speech: ReadonlyMap<string, number>,
  extraHold: ReadonlyMap<string, number> = new Map(),
  language: Language = 'en',
  pacing: Pacing = TIGHT,
): Layout {
  // The hero: a scene marked `hero`, else the template's payoff beats (for its breath).
  const hero = heroScene(scenes, pacing.hero);
  const summary = findLastIndex(scenes, (s) => s.visual.kind === 'summary');
  const minimum = (s: Scene) => s.minSeconds ?? minSecondsFor(s.visual);
  const out: SceneTiming[] = [];
  // When the line after the latest breath (or a pause as long as one) started.
  let breathed = 0;
  scenes.forEach((scene, i) => {
    const id = scene.id ?? `s${i + 1}`;
    const talk =
      speech.get(id) ?? estimateSpeech(stripEmphasis(scene.say ?? scene.narration), language);
    if (i === 0) {
      out.push({ id, start: 0, end: 0, speechStart: pacing.firstLead, speechEnd: pacing.firstLead + talk });
      breathed = pacing.firstLead;
      return;
    }
    const previous = out[i - 1]!;
    const before = scenes[i - 1]!;
    const { seconds } = sceneTransition(scene);
    // Where the line before ends for the cut: the hero, and any hold asked for, stay a little.
    const lineEnd =
      previous.speechEnd + (before.hero ? HERO_HOLD : 0) + (extraHold.get(previous.id) ?? 0);
    const nextLine = lineEnd + LINE_GAP;
    const start = Math.max(
      cutStart(lineEnd, nextLine, seconds),
      previous.start + minimum(before) - seconds,
    );
    let lead = Math.max(nextLine - start, INTO_LINE * seconds);
    if (i === hero && pacing.heroBreath !== undefined)
      lead = Math.max(lead, seconds + pacing.heroBreath);
    else if (pacing.breath) {
      const chapter = pacing.chapter !== undefined && start + lead - breathed > pacing.chapter;
      const afterHero = hero !== undefined && i === hero + 1;
      if (i === 1 || afterHero || i === summary || chapter) lead += pacing.breath;
    }
    previous.end = start + seconds;
    if (start + lead - previous.speechEnd >= BREATH_GAP) breathed = start + lead;
    out.push({ id, start, end: 0, speechStart: start + lead, speechEnd: start + lead + talk });
  });
  const last = out.at(-1);
  if (last) {
    const scene = scenes.at(-1)!;
    const tail =
      (pacing.outro ? LAST_TAIL : TAIL) +
      (scene.hero ? HERO_HOLD : 0) +
      (extraHold.get(last.id) ?? 0);
    last.end = Math.max(last.start + minimum(scene), last.speechEnd + tail);
  }
  const timed = out.map((s) => ({
    id: s.id,
    start: round(s.start),
    end: round(s.end),
    speechStart: round(s.speechStart),
    speechEnd: round(s.speechEnd),
  }));
  const end = timed.at(-1)?.end ?? 0;
  if (pacing.outro && timed.length) {
    // The outro enters like any scene, overlapping the last one by its fade.
    const outro = { start: round(end - TRANSITION), end: round(end - TRANSITION + pacing.outro) };
    return { scenes: timed, outro, duration: outro.end };
  }
  return { scenes: timed, duration: round(end + HOLD) };
}
```

Replace `FitResult` and `fitToDuration` with:

```ts
export interface FitResult {
  scenes: Scene[];
  layout: Layout;
  /** Suggested speech tempo when the narration itself is too long (1 = unchanged). */
  tempo: number;
  notes: string[];
}

/**
 * Fits the storyboard under the spec's duration window without touching the story's required
 * beats or its hero. The window is an upper bound: a video is as long as its narration needs,
 * so a short one is never padded. The pacing (breaths and the outro) counts toward the length.
 */
export function fitToDuration(
  storyboard: Storyboard,
  speech: ReadonlyMap<string, number>,
  spec: VideoSpec,
  language: Language = 'en',
  pacing: Pacing = pacingFor(spec),
): FitResult {
  const notes: string[] = [];
  let scenes = [...storyboard.scenes];
  let layout = layoutScenes(scenes, speech, new Map(), language, pacing);
  const { max } = spec.duration;

  while (layout.duration > max && scenes.length > 3) {
    const index = findLastIndex(scenes, (s) => Boolean(s.optional) && !s.hero);
    if (index === -1) break;
    notes.push(`Dropped optional scene "${scenes[index]!.beat}" to fit ${Math.round(max)}s.`);
    scenes = scenes.filter((_, i) => i !== index);
    layout = layoutScenes(scenes, speech, new Map(), language, pacing);
  }
  let tempo = 1;
  if (layout.duration > max) {
    tempo = Math.min(1.15, layout.duration / max);
    notes.push(
      `Narration runs ${Math.round(layout.duration)}s for a ${Math.round(max)}s maximum; speeding speech up ${Math.round((tempo - 1) * 100)}%.`,
    );
  }
  return { scenes, layout, tempo, notes };
}
```

The `SceneTiming` interface is unchanged. `LEAD_IN` is gone (nothing else uses it); check with `grep -n LEAD_IN packages -r`.

- [ ] **Step 4: Prefer the marked hero in `packages/video/src/templates.ts`**

Replace `heroScene` with:

```ts
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
```

- [ ] **Step 5: Settle the music's hero on the hero's own transition in `packages/video/src/sound.ts`**

Replace `heroMoment` with:

```ts
/**
 * The hero moment: the hero scene (marked `hero`, else the template's payoff beats) has settled,
 * at its start plus its transition (timelines without one faded in over the shared length).
 */
export async function heroMoment(
  timeline: Pick<Timeline, 'scenes'>,
  template: string,
): Promise<number | undefined> {
  const hero = (await loadTemplates()).get(template)?.hero;
  const scenes = storyScenes(timeline.scenes);
  const index = heroScene(scenes, hero);
  if (index === undefined) return undefined;
  const scene = scenes[index]!;
  return scene.start + (scene.transition?.seconds ?? TRANSITION);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && grep -rn "LEAD_IN\|extraHold" packages --include='*.ts' | grep -v "timeline/build.ts"
cd "$WT" && npx vitest run packages/video/test
cd "$WT" && npx vitest run tests/examples.test.ts tests/multilingual.test.ts tests/render/render.test.ts
cd "$WT" && npm run typecheck && npx biome check --write packages/video/src/timeline/build.ts packages/video/src/templates.ts packages/video/src/sound.ts packages/video/test
```

Expected: the grep prints nothing; all PASS (the existing render tests check relative timing only and still pass); typecheck and Biome clean. If `tests/render/render.test.ts` reports a `text-fits` or overflow failure, a scene got shorter than its entrances; report it rather than raising a minimum.

- [ ] **Step 7: Commit**

```bash
WT=/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video
cd "$WT" && git add packages/video/src/timeline/build.ts packages/video/src/templates.ts packages/video/src/sound.ts packages/video/test && git commit -F - <<'EOF'
Time scenes from their lines and stop padding videos

Lines sit 0.35 s apart and each transition starts at
max(line end - 0.5d, next line - 0.6d), so no scene outstays its line by
more than 0.6 s. The first line starts by 0.3 s, the hero holds 0.4 s
after its line, breaths move into the next scene's lead, and visual
minimums drop so 2-5 s scenes are possible. The duration window is now
an upper bound: Covi never pads. A scene marked hero: true is the hero
for the music and the breaths.

Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh
EOF
```

---
