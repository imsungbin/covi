# PR B7 — Direction methodology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents direct Covi videos well: a new `skills/covi-video/references/direction.md` teaches when each verb fits, the variety rules, the evidence-binding rule, and how to stage a change with no UI, with a worked example on the benchmark that tests validate and render; the `covi-video` skill carries one short direction rule into the narration prompt and points agents at the reference; every story template beat suggests `verbs`; and tests pin that the benchmark's default direction morphs, counts, and stages with flow verbs while passing the timeline's QC (and, rendered, the render QC).

**Architecture:** Methodology goes in the skill, not in code (AGENTS.md, "One methodology source"): no product code reads `references/direction.md` or the template `verbs`. The only code change is additive data validation: `BeatSchema.verbs` in `packages/video/src/templates.ts`, its enum read from B2–B5's `ShotBeatSchema`. Tests build the timeline a render would draw without rendering (a test helper running `produceVideo`'s own steps: `planDirection` → `fitToDuration` → `resolveDirection` → `buildTimeline`, with estimated speech), run B1's and B6's timeline-only checks on it, and a captions-only full-pipeline render cross-checks the helper and runs the render QC.

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, no build step), Zod 4, Vitest 5, YAML templates, Playwright Chromium and ffmpeg for `npm run test:render`, Biome.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` — §11 (direction methodology: this PR), §4 (the direction file, elements, verbs, labels, validation, timing, default director), §2 (measured problems), §8 (monotony, transition variety), §9 (flow verbs, the warning label for timeouts), §10 (draft and critique loop, motion QC), §14–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-007 quality checks warn; R-012 number words policed only by methodology; R-013 counts only from metrics; R-015/R-019 label allowlist incl. CJK punctuation; R-017/R-024 one CHANGELOG line under a Keep a Changelog subsection; R-023 dropped beats recorded). Code worktree: `~/projects/covi-direction`, branch `direction-method`, started from the latest `main` after B2–B6 merged.

## Global Constraints

Every task's requirements include these.

- TypeScript on Node 22.18+, run without a build step: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments explain why, in concise English.
- Dependency direction unchanged: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Nothing imports `cli` except tests. Files under `tests/` may import package sources directly (as `tests/examples.test.ts` does) but never a runtime file that carries DOM types (`runtime/anim.ts`, `runtime/camera.ts`, `runtime/canvas.ts`, components).
- AGENTS.md, verbatim: "Skills are read by agents and also loaded into model prompts (`methodologyOf` in `packages/core/src/resources.ts`). Sections named `Run it`, `Commands`, `Tools`, `Workflow with the CLI`, `Asking the user`, `Output files`, `Related skills`, or `When not to use` are agent-only and are left out of model prompts; everything else is methodology. Change methodology in the skill, not in code."
- Spec §11, verbatim: "`skills/covi-video/SKILL.md` and `references/direction.md`: when each verb fits, variety rules (≤ 2 of one kind in a row; camera moves over fades), the evidence-binding rule, staging changes with no UI (flow, split/merge, stack, metrics), and the draft/critique loop. `templates/stories/*.yml` beats gain `verbs:` suggestions (validated on load; schema additive). Example tests assert that the benchmark's default direction uses `morph`, a metric visual, and a flow verb, and passes the non-render QC; the render test asserts the render QC."
- The prompt-loaded methodology of `covi-video` (`methodologyOf(loadSkill('covi-video'))`) stays at or under 2800 words (2559 on `main` at 4ccbdb6; a test pins the cap). Reference files are agent-only except `references/music.md` (docs/skills.md); `references/direction.md` is loaded by no code.
- Spec §4.5 and R-015/R-019: labels are 1–32 characters of letters, marks, spaces, and `-–—·,.'’:()/&+?!` plus CJK `、。・「」『』（）！？：`; no digits; no links. R-012: number words are forbidden by the methodology, not by code. R-013: drawn counts come only from `metric:` evidence.
- Templates (`templates/stories/*.yml`) are validated on load; the schema change is additive (`verbs` optional, nothing repurposed); every shipped beat carries `verbs`; each beat's `eyebrows` stays as it is.
- No on-screen text is added: no catalog keys (`templates/i18n/*` unchanged). QC messages and CLI logs stay English.
- Never change any `version` field; `timeline.json`, `evidence.json`, `video/direction.json`, and storyboards keep their versions.
- CHANGELOG: exactly one line for this PR (R-024), under `## [Unreleased]` → `### Added`.
- Commits: default git identity (never Claude as author or co-author); concise English message ending with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Before each commit: `npx biome check --write <changed files>`, `npm run lint`, `npm run typecheck`. Each task leaves `npm run check` green.
- Long commands (full `npm test`, `npm run check`, `npm run test:render`, `covi video`, `covi render`, subagent pressure runs) run in the background; wait for them to finish before reporting.
- Shell steps use fixed scratch paths (`/tmp/covi-b7-…`) or one compound command; no shell variables across commands (B1 PF-4).

## B2–B6 names this plan builds on

B2–B6 merge before this PR starts; their plans are in `~/projects/covi-0.3.0-program/docs/superpowers/plans/` (`…-b2-direction-canvas.md` through `…-b6-draft-critique.md`). **Before Task 1, run a pre-flight scan of this plan against the merged `main`** (as R-020 did for B2): where a merged name, signature, file, or text differs from the list below, use the merged one, keep the behavior this plan describes, and record the difference in the task report.

- **B1** (merged at 4ccbdb6): `monotonyCheck(timeline)`, `transitionVarietyCheck(timeline)` in `packages/video/src/density.ts`; the `covi video (full pipeline)` loop in `tests/render/render.test.ts` (loop variables `example`, `dir`, `result`).
- **B2:** `packages/video/src/direction/schema.ts` — `DirectionSchema`, `Direction`, `ShotBeatSchema` (a `z.discriminatedUnion('verb', […])` of strict objects), `ShotBeat`; `direction/sources.ts` — `directionSources({ files?, demo?, evidence?, appLogs?, redact? })`, `DirectionSources`; `direction/plan.ts` — `planDirection({ mode, file?, authored, scenes, evidence?, sources, seed, orientation? })` → `{ draft?, plan?, entrances }` (throws `UsageError` listing every problem); `direction/resolve.ts` — `resolveDirection({ plan, scenes, layout, spec, language, sources, image, seed, redact })` → staging; `timeline/build.ts` — `fitToDuration(storyboard, speech, spec, language?, pacing?, entrances?)`, `buildTimeline({ …, entrances, staging })`; `TimelineScene.direction` (`elements` with `id`, `kind`, `rect`; `beats` with `verb`, `t`, `seconds`); `covi video --draft` writes `video/direction.json` (`"draft": true`), listed as `artifacts.direction`; `SKILL.md` `## Run it` gains a **Direction.** paragraph.
- **B3:** the `morph` element and verb; `DirectorInput.sources`; the default director morphs the benchmark's `diff-hunk:src/reader.js:19`; a sentence appended to the **Direction.** paragraph.
- **B4:** metric evidence (`metric:terminal-1:request-bytes` 70406 → 9907, `chunks` 4 → 1, `reader-steps` 28 → 10, `timeouts` 1 → 0); the `metric` element (`show`, `side`, `label`) and `count` verb (a `count` with `at` lands on its phrase, ticking 1.6 s before it); `PlanInput.orientation`; the benchmark block `if (example === 'backend-slim-request') { … }` in the full-pipeline loop; a sentence appended to the **Direction.** paragraph.
- **B5:** `node`, `packet`, `pile` elements; `flow`, `split`, `merge`, `stack`, `count-up` verbs; `FLOW_VERBS` in `packages/video/src/timeline/types.ts`; the default director's benchmark shot for `s1` (`metric` + `packet` + `pile`; `split`, `stack`, `merge`, `count`); a sentence appended to the **Direction.** paragraph.
- **B6:** `packages/video/src/choreography.ts` — `motionGapCheck(timeline)`, `motionBusyCheck(timeline)`, `readingTimeCheck(timeline)`, `droppedBeatsCheck(timeline)`; `covi render --run <id> --draft` into `video/draft/` (`qc.json`, `contact-sheet.jpg`); `SKILL.md` `## Run it` gains the `--draft` command line, a **Draft, look, revise.** paragraph with seven bullets and a "Stop after three draft rounds…" sentence, and a sentence in question 3 of **Review it yourself**; B6's assertions in the benchmark block that `still` and the six motion checks pass.

## Review Focus

The five inputs or conditions the spec implies that a person (an agent directing a video, or someone editing templates) will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns it.

1. **A narration line edited after its scene was directed**, so a beat's `at` phrase is gone — `covi render` must refuse (exit 2) naming the shot, the beat, and the phrase, never render a silently respaced beat. Test: Task 3, `tests/direction-method.test.ts` "is refused, naming the shot and the beat, once a line no longer says a phrase its beats quote".
2. **A template beat that suggests a verb its visuals cannot stage** (a `morph` on a beat without `code`, a count or flow verb on a title or a findings card, motion on the wrap) — suggestions must fit the beat. Test: Task 1, `packages/video/test/templates.test.ts` "suggest direction verbs for every beat, each one the beat can stage".
3. **A template written before `verbs` existed, or one with a misspelled or repeated verb** — the former loads; the latter is refused naming the file, the beat, and the verb. Test: Task 1, "load a beat without verbs, and refuse verbs that are unknown, repeated, or too many".
4. **The worked example teaching the wrong thing** (a number word in a label, a fade, a beat without a phrase, a crowded shot) — the example must obey its own rules. Test: Task 3, "practises what it teaches: short labels without numbers, camera moves for entrances, a phrase for every beat".
5. **The direction method bloating the narration prompt, or the agent-only draft loop leaking into it** — the narration model gets one short rule. Test: Task 4, "carries direction as one short rule, leaving the verb reference and the draft loop to agents".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/video/src/templates.ts` | 1 | `BEAT_VERBS_MAX`, `BeatSchema.verbs` (enum from `ShotBeatSchema`) |
| `templates/stories/*.yml` (7 files) | 1 | `verbs:` on every beat |
| `packages/video/test/templates.test.ts`, `tests/cli.test.ts` | 1 | verb rules, fixture refusals, `covi templates show` |
| `tests/helpers/direction.ts` (create) | 2, 3 | `VideoRun`, `readVideoRun`, `directedTimeline`, `TIMELINE_CHECKS`, `timelineChecks` (2); `DirectionExample`, `directionExample`, `rewriteScenes`, `choreography` (3) |
| `tests/direction-method.test.ts` (create) | 2, 3, 4 | the benchmark's default direction (2); the worked example (3); the prompt budget (4) |
| `tests/render/render.test.ts` | 2, 3 | render QC and a structural cross-check of the default render (2); the worked example rendered captions-only and cross-checked (3) |
| `skills/covi-video/references/direction.md` (create) | 3 | the direction methodology and the worked example |
| `skills/covi-video/SKILL.md` | 4 | `## Method` rule and corrections, `## Quality bar`, `## Run it` pointers, `## Related skills` |
| `skills/covi-video/references/storytelling.md`, `skills/covi-demo/SKILL.md`, `skills/covi/SKILL.md` | 4 | camera-move wording, the no-UI pointer, a measuring command, the run layout |
| `docs/video.md`, `docs/contributing.md`, `docs/skills.md`, `AGENTS.md`, `CHANGELOG.md` | 5 | documentation |

---
### Task 1: Template beats suggest direction verbs

**Files:**
- Modify: `packages/video/src/templates.ts` (imports; the file's doc comment; `BEAT_VERBS_MAX`; `BeatSchema`)
- Modify: `templates/stories/api-change.yml`, `architecture-explainer.yml`, `before-after.yml`, `bug-fix.yml`, `cli-change.yml`, `feature-demo.yml`, `quick-review.yml`
- Test: `packages/video/test/templates.test.ts`, `tests/cli.test.ts` (`it('prints JSON schemas, templates, skills, and examples', …)`)

**Interfaces:**
- Consumes: `ShotBeatSchema`, `ShotBeat` (B2–B5, `packages/video/src/direction/schema.ts`).
- Produces:
  ```ts
  // packages/video/src/templates.ts
  export const BEAT_VERBS_MAX = 4;
  // BeatSchema gains: verbs?: ShotBeat['verb'][]   (1–4, each once, a verb of ShotBeatSchema)
  // so `Beat` and `StoryTemplate` carry `verbs?`, and `covi templates show <id>` prints them.
  ```

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/templates.test.ts`, replace the import line `import { heroScene, loadTemplates } from '../src/templates.ts';` with:

```ts
import { ShotBeatSchema } from '../src/direction/schema.ts';
import { BEAT_VERBS_MAX, heroScene, loadTemplates } from '../src/templates.ts';
```

Replace the line `function templateDir(hero: string): string {` with:

```ts
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
```

and in that function replace the context beat line `'  - { id: context, eyebrow: C, eyebrows: { ko: C, ja: C, zh: C }, goal: g, visuals: [title] }',` with:

```ts
      `  - { id: context, eyebrow: C, eyebrows: { ko: C, ja: C, zh: C }, goal: g, visuals: [title]${verbs === undefined ? '' : `, verbs: ${verbs}`} }`,
```

Append inside `describe('story templates', …)`, after the last `it`:

```ts
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
```

In `tests/cli.test.ts`, inside `it('prints JSON schemas, templates, skills, and examples', …)`, after `expect(covi(['templates', '--json']).json()).toHaveLength(7);` add:

```ts
    // Each beat suggests how to direct it.
    const bugFix = covi(['templates', 'show', 'bug-fix']).json() as unknown as {
      beats: Array<{ id: string; verbs?: string[] }>;
    };
    expect(bugFix.beats.find((b) => b.id === 'fix')!.verbs).toEqual(['morph', 'camera']);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/templates.test.ts`
Expected: FAIL — `BEAT_VERBS_MAX` is not exported; once it is, the verb tests fail because no beat has `verbs` and the schema rejects the `verbs` key (`unknown key(s): verbs`).

- [ ] **Step 3: Implement the schema**

In `packages/video/src/templates.ts`:

1. After `import { z } from 'zod';` add:

```ts
import { type ShotBeat, ShotBeatSchema } from './direction/schema.ts';
```

2. Replace the file's doc comment

```ts
/**
 * Storytelling templates are data (templates/stories/*.yml): ordered beats with a goal, preferred
 * visuals, and a narrator expression. They describe story patterns; rendering stays in the engine.
 */
```

with:

```ts
/**
 * Storytelling templates are data (templates/stories/*.yml): ordered beats with a goal, preferred
 * visuals, a narrator expression, and the direction verbs that suit them. They describe story
 * patterns; rendering stays in the engine.
 */
```

3. Before `export const BeatSchema = z.strictObject({` add:

```ts
/** The verbs a direction beat may use, read from its schema so the two lists never drift apart. */
const SHOT_VERBS = ShotBeatSchema.options.map((o) => o.shape.verb.value) as [
  ShotBeat['verb'],
  ...ShotBeat['verb'][],
];

/** A beat suggests a few verbs, not a shot list. */
export const BEAT_VERBS_MAX = 4;
```

4. In `BeatSchema`, after `visuals: z.array(z.string().regex(VISUAL_TOKEN)).min(1),` add:

```ts
  /**
   * The direction verbs that suit the beat, most fitting first: a suggestion for whoever directs
   * the scene (`references/direction.md`). Covi's default director reads evidence, not these.
   */
  verbs: z
    .array(z.enum(SHOT_VERBS))
    .min(1)
    .max(BEAT_VERBS_MAX)
    .refine((verbs) => new Set(verbs).size === verbs.length, 'name each verb once')
    .optional(),
```

If the pre-flight finds that a merged `ShotBeatSchema` option is not a plain object schema (so `o.shape.verb.value` does not type-check), build `SHOT_VERBS` from the verbs B2–B5 merged, in their schema order (`place`, `reveal`, `camera`, `morph`, `count`, `flow`, `split`, `merge`, `stack`, `count-up`), and add to the first new test an assertion that this list equals the union's discriminator values, so the two cannot drift.

- [ ] **Step 4: Add `verbs` to every template beat**

In each file, add a `verbs:` line directly after each beat's `visuals:` line, exactly as below (beat id → line):

`templates/stories/api-change.yml`:
- `context` → `    verbs: [reveal, camera]`
- `exchange` → `    verbs: [count, flow, camera]`
- `implementation` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/architecture-explainer.yml`:
- `context` → `    verbs: [reveal, camera]`
- `map` → `    verbs: [flow, split, merge, camera]`
- `core` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/before-after.yml`:
- `context` → `    verbs: [reveal, camera]`
- `compare` → `    verbs: [camera, count-up]`
- `detail` → `    verbs: [camera, reveal]`
- `styles` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/bug-fix.yml`:
- `context` → `    verbs: [reveal, camera]`
- `problem` → `    verbs: [split, stack, flow, reveal]`
- `fix` → `    verbs: [morph, camera]`
- `proof` → `    verbs: [count, merge, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/cli-change.yml`:
- `context` → `    verbs: [reveal, camera]`
- `run` → `    verbs: [count, count-up, reveal]`
- `implementation` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/feature-demo.yml`:
- `context` → `    verbs: [reveal, camera]`
- `before` → `    verbs: [camera]`
- `interaction` → `    verbs: [camera, reveal]`
- `implementation` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

`templates/stories/quick-review.yml`:
- `context` → `    verbs: [reveal, camera]`
- `scope` → `    verbs: [reveal, camera]`
- `core` → `    verbs: [morph, camera]`
- `review` → `    verbs: [reveal, camera]`
- `summary` → `    verbs: [place]`

For example, `bug-fix.yml`'s fix beat becomes:

```yaml
  - id: fix
    eyebrow: The fix
    eyebrows: { ko: '수정', ja: '修正', zh: '修复' }
    goal: Point at the lines that fix it and say why they work.
    visuals: [code]
    verbs: [morph, camera]
    expression: explaining
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/templates.test.ts tests/examples.test.ts -t "templates|story templates" && npx vitest run tests/cli.test.ts -t "prints JSON schemas"`
Expected: PASS (on a scratch copy of `main` with a stand-in `ShotBeatSchema` of the ten verbs, the template tests and the examples' template tests passed).

Then `npm run typecheck && npx biome check --write packages/video/src/templates.ts packages/video/test/templates.test.ts tests/cli.test.ts templates && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add packages/video/src/templates.ts packages/video/test/templates.test.ts tests/cli.test.ts templates/stories
git commit -m "$(cat <<'EOF'
Suggest direction verbs for every story beat

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 2: The benchmark's default direction is pinned: morph, a metric, a flow verb, and every timeline check passes

**Files:**
- Create: `tests/helpers/direction.ts`
- Create: `tests/direction-method.test.ts`
- Modify: `tests/render/render.test.ts` (imports; B4's `if (example === 'backend-slim-request') { … }` block in B1's `covi video (full pipeline)` loop)

**Interfaces:**
- Consumes: B2 `planDirection`, `resolveDirection`, `DirectionSchema`, `Direction`, `directionSources`, `DirectionSources`; B4 `PlanInput.orientation`; B5 `FLOW_VERBS`; B1 `monotonyCheck`, `transitionVarietyCheck`; B6 `motionGapCheck`, `motionBusyCheck`, `readingTimeCheck`, `droppedBeatsCheck`; `@covi/video`'s `AssetCollector`, `buildTimeline`, `fitToDuration`, `loadTemplates`, `orientationOf`, `pacingFor`, `QcCheck`, `Storyboard`, `StoryboardSchema`, `Timeline`, `VideoSpec`; `@covi/core`'s `Demonstration`, `EvidenceFileSchema`, `EvidenceIndex`, `indexEvidence`, `parseOrThrow`, `resolveChange`, `seedFrom`; `covi` (`tests/helpers/cli.ts`); `listExamples`, `materializeExample` (`packages/cli/src/examples.ts`).
- Produces (Tasks 3–4 rely on these exact names):
  ```ts
  // tests/helpers/direction.ts
  export interface VideoRun {
    runDir: string; storyboard: Storyboard; evidence: EvidenceIndex; sources: DirectionSources; spec: VideoSpec;
  }
  export function readVideoRun(runDir: string, repo: string): Promise<VideoRun>;
  export function directedTimeline(run: VideoRun, direction?: unknown): Promise<{ plan: Direction; timeline: Timeline }>;
  export const TIMELINE_CHECKS: readonly ['monotony', 'transition-variety', 'motion-gap', 'motion-busy', 'reading-time', 'dropped-beats'];
  export function timelineChecks(timeline: Timeline): QcCheck[];

  // tests/direction-method.test.ts (module scope, shared by Tasks 3–4)
  let drafted: VideoRun;   // the benchmark after `covi video --standard --draft`, set in beforeAll
  ```

Why a helper: `npm test` (CI) has no ffmpeg, and `produceVideo` locates ffmpeg before it builds a timeline, so no CLI path writes `timeline.json` without rendering. The helper runs the pipeline's own steps in the order `produceVideo` runs them (B2 Task 6: plan before fitting, entrances into the fit, resolve after it, staging and entrances into `buildTimeline`), with Covi's estimate of each line's speech (`layoutScenes` estimates any line without a take). Task 3's captions-only render checks that the helper draws exactly the timeline Covi draws.

- [ ] **Step 1: Write the failing test**

Create `tests/direction-method.test.ts`:

```ts
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listExamples, materializeExample } from '../packages/cli/src/examples.ts';
import { DirectionSchema } from '../packages/video/src/direction/schema.ts';
import { FLOW_VERBS } from '../packages/video/src/timeline/types.ts';
import { covi } from './helpers/cli.ts';
import {
  directedTimeline,
  readVideoRun,
  TIMELINE_CHECKS,
  timelineChecks,
  type VideoRun,
} from './helpers/direction.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const flowing = (verb: string) => (FLOW_VERBS as readonly string[]).includes(verb);

/** The benchmark as `covi video --standard --draft` leaves it for an agent to direct. */
let drafted: VideoRun;
beforeAll(async () => {
  const example = (await listExamples()).find((e) => e.name === 'backend-slim-request')!;
  const repo = await materializeExample(example);
  dirs.push(repo);
  const result = covi(['video', '--repo', repo, '--standard', '--draft', '--force', '--json']);
  expect(result.code, result.stderr).toBe(0);
  drafted = await readVideoRun((result.json() as { runDir: string }).runDir, repo);
}, 300_000);

describe('the benchmark’s default direction', () => {
  it('morphs its code, counts its key number, stages its counts with flow verbs, and passes every check of its timeline', async () => {
    const { plan, timeline } = await directedTimeline(drafted);
    // What `covi video --draft` wrote for the agent is what Covi directs when nobody rewrites it.
    const written = JSON.parse(
      readFileSync(join(drafted.runDir, 'video', 'direction.json'), 'utf8'),
    ) as unknown;
    expect(plan).toEqual(DirectionSchema.parse(written));
    const kinds = plan.shots.flatMap((s) => s.elements.map((e) => e.kind));
    expect(kinds).toContain('morph');
    expect(kinds).toContain('metric');
    expect(plan.shots.flatMap((s) => s.beats.map((b) => b.verb)).filter(flowing)).not.toEqual([]);
    // The timeline draws them: the morph and the flow verbs play, and the metric is on screen.
    const shots = timeline.scenes.flatMap((s) => (s.direction ? [s.direction] : []));
    const played = shots.flatMap((d) => d.beats.map((b) => b.verb));
    expect(played).toContain('morph');
    expect(played.filter(flowing)).not.toEqual([]);
    expect(shots.flatMap((d) => d.elements.map((e) => e.kind))).toContain('metric');
    const checks = timelineChecks(timeline);
    expect(checks.map((c) => c.id)).toEqual([...TIMELINE_CHECKS]);
    for (const check of checks) expect(check, check.message).toMatchObject({ status: 'pass' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/direction-method.test.ts`
Expected: FAIL — `Cannot find module './helpers/direction.ts'`.

- [ ] **Step 3: Write the helper**

Create `tests/helpers/direction.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Demonstration,
  EvidenceFileSchema,
  type EvidenceIndex,
  indexEvidence,
  parseOrThrow,
  resolveChange,
  seedFrom,
} from '@covi/core';
import {
  AssetCollector,
  buildTimeline,
  fitToDuration,
  loadTemplates,
  orientationOf,
  pacingFor,
  type QcCheck,
  type Storyboard,
  StoryboardSchema,
  type Timeline,
  type VideoSpec,
} from '@covi/video';
import {
  droppedBeatsCheck,
  motionBusyCheck,
  motionGapCheck,
  readingTimeCheck,
} from '../../packages/video/src/choreography.ts';
import { monotonyCheck, transitionVarietyCheck } from '../../packages/video/src/density.ts';
import { planDirection } from '../../packages/video/src/direction/plan.ts';
import { resolveDirection } from '../../packages/video/src/direction/resolve.ts';
import { type Direction, DirectionSchema } from '../../packages/video/src/direction/schema.ts';
import {
  type DirectionSources,
  directionSources,
} from '../../packages/video/src/direction/sources.ts';

/**
 * Directing a run as `covi render` does, without drawing a frame: the steps of `produceVideo`
 * (packages/video/src/pipeline.ts) from the storyboard to the timeline, with Covi's estimate of
 * each line's speech in place of a voice. A captions-only render test checks that Covi draws the
 * same timeline.
 */

/** What a run holds for directing its video. */
export interface VideoRun {
  runDir: string;
  storyboard: Storyboard;
  evidence: EvidenceIndex;
  sources: DirectionSources;
  spec: VideoSpec;
}

/** Reads a run `covi video` wrote, drafted or rendered: storyboard, evidence, demo, change, spec. */
export async function readVideoRun(runDir: string, repo: string): Promise<VideoRun> {
  const read = (rel: string): unknown => JSON.parse(readFileSync(join(runDir, rel), 'utf8'));
  const evidence = indexEvidence(
    parseOrThrow(EvidenceFileSchema, read('evidence.json'), 'evidence.json'),
  );
  // The change as the run recorded it, the way `covi render` reloads it.
  const { change: recorded } = read('run.json') as {
    change: { base: { sha: string }; head: { sha: string } };
  };
  const change = await resolveChange({
    repo,
    range: `${recorded.base.sha}..${recorded.head.sha}`,
    scope: 'committed',
  });
  const demo = read('demo/captures.json') as Demonstration;
  return {
    runDir,
    storyboard: StoryboardSchema.parse(read('video/storyboard.json')),
    evidence,
    sources: directionSources({ files: change.files, demo, evidence }),
    spec: (read('video/decision.json') as { spec: VideoSpec }).spec,
  };
}

/**
 * The timeline a render of this run would draw: `direction` (an agent's file; none for Covi's
 * default director) checked and merged as `planDirection` does, the scenes timed with estimated
 * speech (paced as narrated unless the spec turns narration off), and the shots resolved against
 * the run's evidence. Rejects with the `UsageError` `covi render` exits 2 with.
 */
export async function directedTimeline(
  run: VideoRun,
  direction?: unknown,
): Promise<{ plan: Direction; timeline: Timeline }> {
  const { storyboard, evidence, sources, spec } = run;
  const scenes = storyboard.scenes.map((s, i) => ({ ...s, id: s.id ?? `s${i + 1}` }));
  const language = storyboard.language ?? 'en';
  const seed = seedFrom(storyboard.title);
  const directed = planDirection({
    mode: 'auto',
    file:
      direction === undefined
        ? undefined
        : parseOrThrow(DirectionSchema, direction, 'video/direction.json'),
    authored: scenes,
    scenes,
    evidence,
    sources,
    seed,
    orientation: orientationOf(spec.width, spec.height),
  });
  const plan = directed.plan!;
  const hero = (await loadTemplates()).get(storyboard.template)?.hero;
  const fit = fitToDuration(
    { ...storyboard, scenes },
    new Map(),
    spec,
    language,
    pacingFor(spec, hero),
    directed.entrances,
  );
  const assets = new AssetCollector(run.runDir);
  const staging = resolveDirection({
    plan,
    scenes: fit.scenes,
    layout: fit.layout,
    spec,
    language,
    sources,
    image: assets.image,
    seed,
    redact: (value) => value,
  });
  const timeline = buildTimeline({
    title: storyboard.title,
    scenes: fit.scenes,
    layout: fit.layout,
    spec,
    image: assets.image,
    language,
    entrances: directed.entrances,
    staging,
  });
  return { plan, timeline };
}

/** The checks that read the timeline alone: what QC says about a video before a frame is drawn. */
export const TIMELINE_CHECKS = [
  'monotony',
  'transition-variety',
  'motion-gap',
  'motion-busy',
  'reading-time',
  'dropped-beats',
] as const;

export function timelineChecks(timeline: Timeline): QcCheck[] {
  return [
    monotonyCheck(timeline),
    transitionVarietyCheck(timeline),
    motionGapCheck(timeline),
    motionBusyCheck(timeline),
    readingTimeCheck(timeline),
    droppedBeatsCheck(timeline),
  ];
}
```

Before running, open `packages/video/src/pipeline.ts` and compare its direction steps with `directedTimeline`: the `planDirection`, `fitToDuration`, `resolveDirection`, and `buildTimeline` calls must take the same inputs (B4 passes `orientation`; B6 may have added inputs). Where the merged pipeline passes something more that changes the timeline, pass it here too and say so in the report.

- [ ] **Step 4: Run the test to verify it passes**

Run (in the background, and wait): `npx vitest run tests/direction-method.test.ts`
Expected: PASS. If a check warns, print its message (it is the assertion's label) and compare with B6's measurements (the benchmark's default render passed every motion check in English and Korean): a warning here that the render does not show means the helper diverges from the pipeline (fix the helper); a warning both show is the default director's, not this PR's to hide — stop and report it to the controller with the message. Never weaken the assertion.

- [ ] **Step 5: The render test asserts the render QC, and that the helper plans the shots Covi drew**

In `tests/render/render.test.ts`, add to the imports:

```ts
import { directedTimeline, readVideoRun } from '../helpers/direction.ts';
```

Inside B4's `if (example === 'backend-slim-request') { … }` block of the `covi video (full pipeline)` loop (as B5 and B6 extended it), after its last assertion, add:

```ts
        // The render's own checks pass for the default direction: text large enough, frames
        // filled, and no element overlapping another or cut off by the frame.
        const rendered = JSON.parse(
          readFileSync(join(result.runDir, 'video', 'qc.json'), 'utf8'),
        ) as { checks: Array<{ id: string; status: string; message: string }> };
        for (const id of ['text-size', 'empty-frame', 'overlap', 'out-of-frame'])
          expect(rendered.checks.find((c) => c.id === id), id).toMatchObject({ status: 'pass' });
        // The shots the non-render tests plan are the ones Covi drew, scene by scene.
        const planned = (await directedTimeline(await readVideoRun(result.runDir, dir))).timeline;
        const drawn = JSON.parse(
          readFileSync(join(result.runDir, 'video', 'timeline.json'), 'utf8'),
        ) as Timeline;
        const shots = (t: Timeline) =>
          t.scenes.map((s) => [
            s.id,
            s.direction?.elements.map((e) => e.kind),
            s.direction?.beats.map((b) => b.verb),
          ]);
        expect(shots(drawn)).toEqual(shots(planned));
```

(If the loop's materialized repository is not named `dir`, use the merged name.)

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "renders backend-slim-request"`
Expected: PASS. On `main` at 4ccbdb6 the benchmark's render already passed `text-size` and `empty-frame` (measured while planning). If `text-size` or `empty-frame` warns now, the default direction's layout is the cause: do not weaken the assertion; stop and report the message to the controller (a layout fix belongs to a ruling, not to this PR's methodology).

- [ ] **Step 6: Commit**

```bash
npx biome check --write tests/helpers/direction.ts tests/direction-method.test.ts tests/render/render.test.ts
npm run lint && npm run typecheck
git add tests/helpers/direction.ts tests/direction-method.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Pin the benchmark's default direction and its QC

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 3: The direction reference, with a worked example the tests validate and render

**Files:**
- Create: `skills/covi-video/references/direction.md`
- Modify: `tests/helpers/direction.ts` (append `DirectionExample`, `directionExample`, `rewriteScenes`, `choreography`)
- Modify: `tests/direction-method.test.ts` (imports; a second `describe`)
- Modify: `tests/render/render.test.ts` (imports; a new `describe` after `covi video (full pipeline)`)

**Interfaces:**
- Consumes: Task 2's `VideoRun`, `readVideoRun`, `directedTimeline`, `TIMELINE_CHECKS`, `timelineChecks`, and `drafted` (module scope of `tests/direction-method.test.ts`); `DirectionSchema` (B2).
- Produces:
  ```ts
  // tests/helpers/direction.ts
  export interface DirectionExample { scenes: Array<{ id: string } & Record<string, unknown>>; direction: unknown }
  export function directionExample(): DirectionExample;   // parses references/direction.md
  export function rewriteScenes(storyboard: Storyboard, scenes: DirectionExample['scenes']): Storyboard;
  export function choreography(timeline: Pick<Timeline, 'scenes'>): Array<{
    id: string; start: number; end: number; transition?: string;
    elements?: Array<[string, string, Rect]>; beats?: Array<[string, number, number]>;
  }>;
  ```
  `references/direction.md` has these `##` sections, in order: `Show the change happening`, `Verbs`, `Elements`, `Bind everything to evidence`, `Variety`, `Staging a change with no UI`, `Example: a change with no UI` (exactly two fenced `json` blocks: the scene edits, then the direction), `Workflow with the CLI`. Task 4's skill text points at the file and at "Staging a change with no UI".

This task starts with the writing-skills RED baseline: before any methodology exists, watch fresh agents direct the benchmark with the skill as B2–B6 left it. Task 4 runs the same scenario after the skill points at the reference (GREEN).

- [ ] **Step 1: RED baseline — agents direct the benchmark with today's skill**

Do this before creating `direction.md` or editing any skill. Prepare three drafted copies of the benchmark (one command, in the background):

```bash
rm -rf /tmp/covi-b7-pressure && mkdir -p /tmp/covi-b7-pressure && for n in 1 2 3; do ./bin/covi.mjs examples create backend-slim-request --into /tmp/covi-b7-pressure/red-$n --json > /dev/null && ./bin/covi.mjs video --repo /tmp/covi-b7-pressure/red-$n --standard --draft --force --json > /tmp/covi-b7-pressure/red-$n.json; done
```

Create `/tmp/covi-b7-pressure/score.mjs` (a scoring tool for this step and Task 4; never committed):

```js
// Scores one agent's direction of the benchmark against the methodology's checkable criteria.
// node score.mjs <result.json from covi video --draft> <repo> <path to bin/covi.mjs>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [resultFile, repo, covi] = process.argv.slice(2);
const { runDir } = JSON.parse(readFileSync(resultFile, 'utf8'));
const read = (rel) => JSON.parse(readFileSync(join(runDir, rel), 'utf8'));
const row = { repo };
try {
  execFileSync('node', [covi, 'render', '--repo', repo, '--run', runDir, '--draft', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  row.valid = true;
} catch (error) {
  row.valid = false;
  row.error = String(error.stderr ?? error).split('\n').slice(0, 8).join(' | ');
}
const direction = existsSync(join(runDir, 'video/direction.json'))
  ? read('video/direction.json')
  : { shots: [] };
const storyboard = read('video/storyboard.json');
const elements = direction.shots.flatMap((s) => s.elements);
const beats = direction.shots.flatMap((s) => s.beats);
row.agentsOwn = direction.draft === false;
row.morph = elements.some((e) => e.kind === 'morph');
row.metric = elements.some((e) => e.kind === 'metric');
row.flowVerb = beats.some((b) => ['flow', 'split', 'merge', 'stack', 'count-up'].includes(b.verb));
row.fade =
  direction.shots.some((s) => s.enter === 'fade') ||
  storyboard.scenes.some((s) => s.transition === 'fade');
row.warningLabel = elements.some((e) => e.kind === 'label' && e.tone === 'warning');
row.labels = elements.flatMap((e) => [e.label, e.text].filter(Boolean));
if (row.valid && existsSync(join(runDir, 'video/draft/qc.json'))) {
  const wanted = ['monotony', 'transition-variety', 'motion-gap', 'motion-busy', 'reading-time',
    'overlap', 'out-of-frame', 'dropped-beats', 'still'];
  row.qc = Object.fromEntries(
    read('video/draft/qc.json').checks.filter((c) => wanted.includes(c.id)).map((c) => [c.id, c.status]),
  );
}
console.log(JSON.stringify(row));
```

Dispatch three fresh subagents at once with your Agent tool (`subagent_type: general-purpose`), one per copy, each with this prompt (replace `N` with 1, 2, 3):

> You are an agent using Covi to make a review video, and Covi has already drafted it. The repository under review is `/tmp/covi-b7-pressure/red-N`; read `runDir` from `/tmp/covi-b7-pressure/red-N.json`. Run Covi as `node ~/projects/covi-direction/bin/covi.mjs … --repo /tmp/covi-b7-pressure/red-N`. Follow the `covi-video` skill at `~/projects/covi-direction/skills/covi-video/SKILL.md`, and open the references it points to when it says to. The change has no UI. Rewrite the narration in `video/storyboard.json` and write `video/direction.json` so the video shows the change. You may render drafts (`covi render --run <runDir> --draft --json`) as the skill describes; do not run the final render, and do not edit files outside that run directory. Reply with one sentence on how you staged the change.

If you have no Agent tool, stop here and report NEEDS_CONTEXT so the controller dispatches them. When all three have replied, score each (in the background):

```bash
for n in 1 2 3; do node /tmp/covi-b7-pressure/score.mjs /tmp/covi-b7-pressure/red-$n.json /tmp/covi-b7-pressure/red-$n ./bin/covi.mjs; done
```

Read every label each agent wrote and note any number word. Record in your report a table with one row per agent: `valid`, `agentsOwn`, `morph`, `metric`, `flowVerb`, `fade`, `warningLabel`, number words in labels, and the draft QC statuses, plus each agent's one-sentence reply. This is the RED baseline: the methodology below must fix what it shows (the controller passes the table to Task 4). Then run `git status` and confirm the worktree is unchanged.

- [ ] **Step 2: Write the failing tests**

In `tests/direction-method.test.ts`, extend the `./helpers/direction.ts` import to:

```ts
import {
  directedTimeline,
  directionExample,
  readVideoRun,
  rewriteScenes,
  TIMELINE_CHECKS,
  timelineChecks,
  type VideoRun,
} from './helpers/direction.ts';
```

and append at the end of the file:

```ts
/** English number words: the example's labels hold none (R-012: Covi cannot police them). */
const NUMBER_WORDS =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)\b/i;

describe('the direction method’s worked example', () => {
  it('directs the benchmark as written: every id, kind, side, and phrase fits, and every check of its timeline passes', async () => {
    const example = directionExample();
    const authored = DirectionSchema.parse(example.direction);
    const storyboard = rewriteScenes(drafted.storyboard, example.scenes);
    const { plan, timeline } = await directedTimeline({ ...drafted, storyboard }, example.direction);
    // The agent's shots stand as written; Covi directs only the summary it left out.
    expect(plan.draft).toBe(false);
    expect(plan.shots.slice(0, authored.shots.length)).toEqual(authored.shots);
    expect(plan.shots.map((s) => s.scene)).toEqual(['s1', 's2', 's3', 's4']);
    // It stages the change with what the method teaches: a morph, a measured count, flow verbs,
    // and the timeout as a warning on the scene that cites the measured timeout.
    const elements = authored.shots.flatMap((s) => s.elements);
    expect(elements.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['node', 'packet', 'label', 'morph', 'metric']),
    );
    expect(authored.shots.flatMap((s) => s.beats.map((b) => b.verb))).toEqual(
      expect.arrayContaining(['reveal', 'flow', 'split', 'camera', 'morph', 'merge', 'count']),
    );
    expect(elements).toContainEqual(expect.objectContaining({ kind: 'label', tone: 'warning' }));
    expect(storyboard.scenes.find((s) => s.id === 's1')!.evidenceIds).toEqual([
      'metric:terminal-1:timeouts',
    ]);
    // Every beat plays, in the order written, and the timeline passes every check it can.
    for (const shot of authored.shots)
      expect(
        timeline.scenes.find((s) => s.id === shot.scene)!.direction!.beats.map((b) => b.verb),
        shot.scene,
      ).toEqual(shot.beats.map((b) => b.verb));
    const checks = timelineChecks(timeline);
    expect(checks.map((c) => c.id)).toEqual([...TIMELINE_CHECKS]);
    for (const check of checks) expect(check, check.message).toMatchObject({ status: 'pass' });
  });

  it('practises what it teaches: short labels without numbers, camera moves for entrances, a phrase for every beat', () => {
    const { shots } = DirectionSchema.parse(directionExample().direction);
    for (const shot of shots) {
      expect(shot.elements.length, shot.scene).toBeLessThanOrEqual(4);
      expect(shot.beats.length, shot.scene).toBeLessThanOrEqual(4);
      if (shot.enter) expect(['pan', 'zoom', 'wipe', 'cut'], shot.scene).toContain(shot.enter);
      for (const beat of shot.beats) expect(beat, shot.scene).toHaveProperty('at');
      for (const element of shot.elements) {
        const words =
          'label' in element ? element.label : 'text' in element ? element.text : undefined;
        if (words !== undefined)
          expect(words, `${shot.scene}: ${element.id}`).not.toMatch(NUMBER_WORDS);
      }
    }
  });

  it('is refused, naming the shot and the beat, once a line no longer says a phrase its beats quote', async () => {
    const example = directionExample();
    const scenes = example.scenes.map((s) =>
      s.id === 's3' ? { ...s, narration: 'Those four chunks are now [[one request]].' } : s,
    );
    const storyboard = rewriteScenes(drafted.storyboard, scenes);
    await expect(
      directedTimeline({ ...drafted, storyboard }, example.direction),
    ).rejects.toThrow(/s3[\s\S]*ten thousand/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/direction-method.test.ts -t "worked example"`
Expected: FAIL — `directionExample` is not exported by `./helpers/direction.ts`.

- [ ] **Step 4: Append the example helpers**

Append to `tests/helpers/direction.ts` (and add `type Rect` to an `import type` from `'../../packages/video/src/timeline/types.ts'` at the top):

```ts
/** The worked example of `skills/covi-video/references/direction.md`: scene edits and a direction. */
export interface DirectionExample {
  /** What the rewrite changes in each scene it lists; every other field stays as drafted. */
  scenes: Array<{ id: string } & Record<string, unknown>>;
  direction: unknown;
}

const EXAMPLE_HEADING = 'Example: a change with no UI';

/** Reads the example from the reference itself, so the text agents learn from is the text tested. */
export function directionExample(): DirectionExample {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    'skills',
    'covi-video',
    'references',
    'direction.md',
  );
  const section = readFileSync(path, 'utf8')
    .split(/^## /m)
    .find((s) => s.startsWith(`${EXAMPLE_HEADING}\n`));
  if (!section) throw new Error(`references/direction.md has no "## ${EXAMPLE_HEADING}" section`);
  const blocks = [...section.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map(
    (m) => JSON.parse(m[1]!) as unknown,
  );
  if (blocks.length !== 2)
    throw new Error(
      `"## ${EXAMPLE_HEADING}" must hold two JSON blocks, the scenes then the direction; it holds ${blocks.length}`,
    );
  return {
    scenes: (blocks[0] as { scenes: DirectionExample['scenes'] }).scenes,
    direction: blocks[1],
  };
}

/**
 * The drafted storyboard with the example's rewrite applied: each listed scene takes the fields
 * shown and drops `say`, the spoken form of its old line; every other field stays as drafted.
 */
export function rewriteScenes(
  storyboard: Storyboard,
  scenes: DirectionExample['scenes'],
): Storyboard {
  const edits = new Map(scenes.map((s) => [s.id, s]));
  for (const id of edits.keys())
    if (!storyboard.scenes.some((s) => s.id === id))
      throw new Error(`the example rewrites scene ${id}, which the draft does not have`);
  return StoryboardSchema.parse({
    ...storyboard,
    draft: false,
    scenes: storyboard.scenes.map((scene) => {
      const edit = edits.get(scene.id ?? '');
      if (!edit) return scene;
      const { say: _old, ...kept } = scene;
      return { ...kept, ...edit };
    }),
  });
}

/** What a viewer sees happen, and when: each scene's span and entrance, its elements, its beats. */
export function choreography(timeline: Pick<Timeline, 'scenes'>) {
  return timeline.scenes.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    transition: s.transition?.kind,
    elements: s.direction?.elements.map((e): [string, string, Rect] => [e.id, e.kind, e.rect]),
    beats: s.direction?.beats.map((b): [string, number, number] => [b.verb, b.t, b.seconds]),
  }));
}
```

Run: `npx vitest run tests/direction-method.test.ts -t "worked example"`
Expected: FAIL — `references/direction.md` does not exist (ENOENT).

- [ ] **Step 5: Write `skills/covi-video/references/direction.md`**

Create the file with exactly this content:

````markdown
# Direction

Evidence decides what a video shows; direction decides how. `video/direction.json` gives storyboard scenes a **shot**: the **elements** on screen, each drawn from an evidence id or a short label, and the **beats** that move them, each a verb that lands on a phrase of the scene's line. Covi draws it the same way every time. Its default director directs every scene you leave out, so direct the scenes where you can tell the change better than it does.

## Show the change happening

Choose by what the change does. Each template beat's `verbs` (`covi templates show <id>`) are a starting point, not a rule.

| The change… | Stage it with |
|---|---|
| edits a few lines: a fix, a renamed call, a new branch | a `morph` of its hunk, with a `camera` `follow` on it |
| moves a number: bytes, steps, a score, a duration | a `metric`: a `counter` that `count`s from before to after for the key number, `compare` for a small change, `bars` for one size against another, `count-up` to build one side from zero |
| sends, batches, or splits work: requests, queues, workers | `node`s for the parts and a `flow` between them; a `packet` that `split`s into its measured pieces and `merge`s back |
| piles up work: retries, steps, rows, calls | a `pile` that `stack`s up to its measured count |
| fails, times out, or is refused | a `label` with `tone: "warning"` beside what failed, revealed as the line says it |
| fixes that | the same staging after the change: the pieces `merge`, the pile is shorter, the counter lands on the new value |
| shows a screen or prints output | the scene's `visual` (or a `capture`, an `output`) and a `camera` move to what changed |

The key number is the largest thing on screen when it lands: make its `metric` the shot's first element (the larger side of a `split` layout), or give it a shot of its own.

## Verbs

| Verb | Acts on | Use it for |
|---|---|---|
| `place` | any element | being there from the shot's start (the default; rarely written) |
| `reveal` | any element | arriving with its words: `rise` (the default), `pop` for a warning, `wipe`, `type` for output |
| `camera` | `to` an element | `zoom` to frame it, `pan` to it at the same scale, `follow` a morph's changing lines or a travelling packet |
| `morph` | a `morph` | the hunk's old code turning into its new code |
| `count` | a `metric` with a value before and after | the number ticking from before to after; it lands on its phrase, so quote the words that say the number |
| `count-up` | a `metric` | a counter rising from zero to one side's value (`side`) |
| `flow` | `from` a node `to` a node | something travelling between parts (`packet`: what travels) |
| `split` | a packet or a node | one thing breaking into a measured count of pieces (`count`: a `metric:` id; `side`) |
| `merge` | a split, or a pile | the pieces coming back together, after their split |
| `stack` | a `pile` | items piling up, one by one, to the measured count |

Every verb but `count` starts on its phrase. Beats without `at` spread through the line in the order written.

## Elements

- From evidence: `visual` (the scene's storyboard visual, drawn as without direction), `code` (a `diff-hunk:` id; `side`, `lines`), `morph` (a `diff-hunk:` id with code on both sides and at most 12 changed lines a side), `output` (a `terminal:` id; `side`), `capture` (a `screenshot:` id), `metric` (a `metric:` id; `show`, `side`), and `pile` (a `metric:` id that counts something; `side`).
- Written by you: `node` (a `label`, and the evidence ids it stands for), `packet` (an optional `label`), and `label` (`text`, and `tone`: `neutral`, `warning`, or `success`).

A shot without a `visual` element replaces the scene's storyboard visual. Keep that visual true to the shot anyway: it is what `--direction off` draws.

## Bind everything to evidence

- **Content only by id.** Code and morphs come from `diff-hunk:` ids, output from `terminal:`, images from `screenshot:`, and every number from a `metric:` id: counters, bars, comparisons, piles, and the pieces of a split. `covi evidence --run <id> --json` lists the ids, and each metric with its values.
- **Never write a number.** Labels cannot hold digits, and number words ("thirty", "삼십", "三十") are just as wrong, though Covi cannot catch them. Deltas and ratios are Covi's to compute. A count nobody measured is never drawn: `reveal` or `flow` the thing instead.
- **Labels name things.** A word or two, 32 characters at most, in the video's language: a part ("Reader"), what travels ("Every document"), a state ("Timed out"). A warning or success label says only what the evidence shows, and the scene cites that evidence in `evidenceIds` (a timeout: the command's `timeouts` metric).
- **Phrases come from the line.** `at` quotes the scene's `narration` as written, letter case included, and must occur in it exactly once (`[[…]]` aside); a few words are safer than one. Write the lines first, then direct them; after you edit a line, check the phrases its beats quote (`covi render` names any that no longer match).

## Variety

- **No more than two shots of one kind in a row.** A shot's kind is its first element's (a `visual` counts as the storyboard visual's kind), and a shot with flow verbs counts as a flow.
- **Camera moves over fades.** `enter: "pan"` to the next step, `"zoom"` into the hero, `"wipe"` from before to after, `"cut"` when the same subject continues; `"push"` slides in the next step of a sequence. Leave the storyboard's `transition`s unset so these decide, and use no entrance for more than 60% of the scene changes.
- **One idea per shot.** About four elements and four beats at most. No more than three beats start within any second, and no more than two camera moves within any two seconds.
- **Keep it moving.** No 1.5 s of narration without a beat, a camera move, or an element arriving: spread the beats over the line, each on its own phrase.
- **Give words time.** Anything with words on it (a label, a node, a packet's or a pile's name) needs 0.4 s plus a second for every 15 characters (8 in Korean, Japanese, or Chinese) before the next scene comes in, which happens about when the line ends. Bring it in on a phrase in the first half of the line, and keep the end of the line for beats without words: a `count`, a `merge`, a camera move.

## Staging a change with no UI

When there is nothing to capture, show what the change does to the work.

1. **Measure it.** A demo command that prints one `label: number` line per measure at both revisions (`covi-demo`) gives `metric:` evidence: a request's bytes, its chunks, the reader's steps, its timeouts.
2. **The problem**, the cold open: the parts as `node`s, the work `flow`ing between them, `split` into its measured pieces or `stack`ed into a pile, and the failure as a warning `label`.
3. **The fix**, usually the hero: a `morph` of the lines that change it, the camera following them.
4. **The result**: the same staging after the change (the pieces `merge` into one, the pile is shorter), and the key number's `count` landing as the line says it.
5. **The review note and the wrap**, as in any video.

## Example: a change with no UI

`covi examples create backend-slim-request` builds the benchmark: a review request that embedded every document, went out in chunks, and timed out now lists document references, and the reader fetches each document itself. Covi's draft (`covi video --standard --draft`) has four scenes: `s1` the measuring command's output before and after, `s2` the fix in `src/reader.js` (the hero), `s3` the review note, and `s4` the summary. The rewrite keeps their ids and the cold open's eyebrow, writes new lines, turns `s3` into the proof (the same command's output), and directs the first three scenes.

The rewritten scenes of `video/storyboard.json`. Every field not shown stays as drafted, except `say`, the spoken form of the old line, which is removed:

```json
{
  "scenes": [
    {
      "id": "s1",
      "narration": "The reader [[timed out]]: the review went out in four chunks.",
      "evidenceIds": ["metric:terminal-1:timeouts"]
    },
    {
      "id": "s2",
      "narration": "Now the request lists references, and the reader [[fetches each document]] itself!"
    },
    {
      "id": "s3",
      "beat": "proof",
      "eyebrow": "After",
      "expression": "success",
      "narration": "Those four chunks are now [[one request]], and request bytes fall below ten thousand.",
      "evidenceIds": ["metric:terminal-1:chunks", "metric:terminal-1:request-bytes"],
      "visual": {
        "kind": "terminal",
        "title": "Measure the review request",
        "command": "node scripts/measure.js",
        "output": "request bytes: 9907\nchunks: 1\nreader steps: 10\ntimeouts: 0",
        "before": "request bytes: 70406\nchunks: 4\nreader steps: 28\ntimeouts: 1"
      }
    },
    {
      "id": "s4",
      "narration": "Nothing blocking: [[ready to merge]]."
    }
  ]
}
```

`video/direction.json`:

```json
{
  "schemaVersion": 1,
  "draft": false,
  "shots": [
    {
      "scene": "s1",
      "layout": "row",
      "elements": [
        { "id": "review", "kind": "node", "label": "Review", "evidence": ["diff-hunk:src/request.js:25"] },
        { "id": "reader", "kind": "node", "label": "Reader", "evidence": ["diff-hunk:src/reader.js:19"] },
        { "id": "docs", "kind": "packet", "label": "Every document" },
        { "id": "late", "kind": "label", "text": "Timed out", "tone": "warning" }
      ],
      "beats": [
        { "verb": "reveal", "element": "late", "style": "pop", "at": "timed out" },
        { "verb": "flow", "from": "review", "to": "reader", "packet": "docs", "at": "the review went out" },
        { "verb": "split", "element": "docs", "count": "metric:terminal-1:chunks", "side": "base", "at": "four chunks" }
      ]
    },
    {
      "scene": "s2",
      "enter": "zoom",
      "elements": [{ "id": "fix", "kind": "morph", "evidence": "diff-hunk:src/reader.js:19" }],
      "beats": [
        { "verb": "camera", "move": "follow", "to": "fix", "at": "lists references" },
        { "verb": "morph", "element": "fix", "at": "fetches each document" }
      ]
    },
    {
      "scene": "s3",
      "enter": "pan",
      "layout": "split",
      "elements": [
        { "id": "bytes", "kind": "metric", "evidence": "metric:terminal-1:request-bytes", "show": "counter" },
        { "id": "request", "kind": "packet", "label": "Review request" }
      ],
      "beats": [
        { "verb": "split", "element": "request", "count": "metric:terminal-1:chunks", "side": "base", "at": "Those four chunks" },
        { "verb": "merge", "element": "request", "at": "one request" },
        { "verb": "count", "element": "bytes", "at": "ten thousand" }
      ]
    }
  ]
}
```

- `s1` opens on the two parts. "Timed out" pops in as the line says it, every document travels to the reader, and it splits into the four chunks the command measured before the change.
- `s2` zooms into the hero. The camera follows the reader's loop while it morphs into the one that fetches each document.
- `s3` pans to the proof. The four chunks merge into one request (the command measured one after the change), and the request's bytes count down to the new value as the line says it, the largest thing on screen.
- `s4` keeps Covi's shot: the summary card.

## Workflow with the CLI

1. `covi video --draft --json` writes `video/storyboard.json` and Covi's `video/direction.json` (`"draft": true`).
2. Rewrite the storyboard first: its lines hold the phrases beats land on. Then direct it: `covi evidence --run <id> --json` lists ids and values, `covi templates show <template>` each beat's `verbs`, and `covi schema direction` every field. Set `"draft": false`, or Covi derives its draft again.
3. `covi render --run <id> --draft --json` renders a fast draft into `video/draft/`; a direction that does not fit the run exits 2 and lists every problem. Open `video/draft/contact-sheet.jpg`, read `video/draft/qc.json`, and fix what the checks name:
   - `motion-gap`: nothing moves for 1.5 s or more of narration; the message names what ends the gap. Pin a beat to a phrase in that stretch, bring an element in sooner, or add a camera move.
   - `motion-busy`: more than three beats start within a second, or more than two camera moves within two seconds. Give each beat its own phrase, or drop one.
   - `reading-time`: words leave before they can be read. Bring them in earlier, or shorten them.
   - `overlap`: two elements of a shot collide. Choose another `layout`, or show fewer elements.
   - `out-of-frame` (fails): an element is cut off by the frame. Show fewer lines or elements, or split the shot.
   - `dropped-beats`: phrases put a beat out of order (a merge before its split, a count-up after its count starts), so it did not play. Quote phrases in the order the beats should play.
   - `still`: the picture froze under the narration; "where only the camera's slow push-in moves" means the plan had nothing else there. Give it a beat.
   - `monotony` and `transition-variety`: see Variety.
4. Stop after three draft rounds even if a warning remains, then render the video with `covi render --run <id> --json` and review it as the skill says.
````

The example was checked against `main` while planning: every `at` phrase occurs exactly once in its rewritten line, every label passes the allowlist (B2, with R-019's CJK punctuation), the rewritten storyboard parses, and with Covi's speech estimate the beats land 1.2–3.9 s into `s1`'s 5.5 s, `s2`'s camera at 3.0 s and morph at 5.1 s, and `s3`'s split, merge, and count landing at 1.6, 3.4, and 6.4 s, leaving the warning label 3 s on screen. If the RED baseline shows agents failing in a way this text does not address, add the missing rule in the same recipe form (a table row or a numbered step, not a prohibition) and say so in the report.

- [ ] **Step 6: Run the example tests**

Run (in the background, and wait): `npx vitest run tests/direction-method.test.ts`
Expected: PASS. If a timeline check warns for the example, change the example in `direction.md` (only there: the test reads it), within the methodology's own rules: move a beat to another phrase of its line, reorder the line so words arrive earlier, or choose another layout. Keep the verbs the first test requires, and record each change in the report.

- [ ] **Step 7: Render the example, captions only, and cross-check the helper**

In `tests/render/render.test.ts`, extend the `../helpers/direction.ts` import to:

```ts
import {
  choreography,
  directedTimeline,
  directionExample,
  readVideoRun,
  rewriteScenes,
  TIMELINE_CHECKS,
} from '../helpers/direction.ts';
```

and add after the `describe.skipIf(!available || !fullRenders)('covi video (full pipeline)', …)` block:

```ts
describe.skipIf(!available || !fullRenders)('the direction example (full pipeline)', () => {
  it('renders the worked example of references/direction.md cleanly, as the tests plan it', async () => {
    const dir = await materializeExample(
      (await listExamples()).find((e) => e.name === 'backend-slim-request')!,
    );
    dirs.push(dir);
    const covi = (args: string[]) =>
      JSON.parse(
        execFileSync('node', ['bin/covi.mjs', ...args, '--repo', dir, '--json'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 600_000,
        }),
      ) as { runDir: string; video: { rendered: boolean; qc: string } };
    const { runDir } = covi(['video', '--standard', '--draft', '--force']);
    const run = await readVideoRun(runDir, dir);
    const example = directionExample();
    const storyboard = rewriteScenes(run.storyboard, example.scenes);
    writeFileSync(join(runDir, 'video', 'storyboard.json'), `${JSON.stringify(storyboard, null, 2)}\n`);
    writeFileSync(join(runDir, 'video', 'direction.json'), `${JSON.stringify(example.direction, null, 2)}\n`);
    // Captions only: the timing is Covi's estimate, so the test can plan the very same timeline.
    const result = covi(['render', '--run', runDir, '--no-narration', '--music', 'none']);
    expect(result.video.rendered).toBe(true);
    expect(result.video.qc).not.toBe('fail');
    const qc = JSON.parse(readFileSync(join(runDir, 'video', 'qc.json'), 'utf8')) as {
      checks: Array<{ id: string; status: string; message: string }>;
    };
    for (const id of ['text-size', 'empty-frame', 'overlap', 'out-of-frame', 'still', ...TIMELINE_CHECKS])
      expect(qc.checks.find((c) => c.id === id), id).toMatchObject({ status: 'pass' });
    const drawn = JSON.parse(
      readFileSync(join(runDir, 'video', 'timeline.json'), 'utf8'),
    ) as Timeline;
    const spec = { ...run.spec, narration: { ...run.spec.narration, enabled: false } };
    const { timeline } = await directedTimeline({ ...run, storyboard, spec }, example.direction);
    expect(choreography(drawn)).toEqual(choreography(timeline));
  }, 600_000);
});
```

Run (in the background, and wait): `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "direction example"`
Expected: PASS. Then open `<runDir>/video/contact-sheet.jpg` and `<runDir>/video/poster.png` with the Read tool (print `runDir` once with a temporary `console.log` and remove it) and check as a viewer: `s1` shows the two parts, the packet, and "Timed out", not an empty frame; the morph is mid-way in `s2`; the counter is the largest thing in `s3` when it lands; nothing covers the captions or the narrator. If the choreography differs, the helper diverges from `produceVideo` (fix the helper, then re-run Task 2's test). If a QC check warns, adjust the example as in Step 6 and re-run both. Record what the sheet shows in the report.

- [ ] **Step 8: Commit**

```bash
npx biome check --write tests/helpers/direction.ts tests/direction-method.test.ts tests/render/render.test.ts
npm run lint && npm run typecheck
git add skills/covi-video/references/direction.md tests/helpers/direction.ts tests/direction-method.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Add the direction reference and its worked example

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 4: The skill directs: one rule in the prompt, the workflow in the reference, and agents pass the GREEN run

**Files:**
- Modify: `skills/covi-video/SKILL.md` (`## Method`: "Pick the story", "Name the hero", a new **Direct the picture.** paragraph, the **Transitions** and **Vary the picture** bullets, the `say` sentence; `## Quality bar`; `## Run it`: B2–B5's **Direction.** paragraph, B6's **Draft, look, revise.** block, question 4 of **Review it yourself**; `## Related skills`)
- Modify: `skills/covi-video/references/storytelling.md` (the **One hero** and **Motion follows the words** bullets; the Bug fix pattern)
- Modify: `skills/covi-demo/SKILL.md` (the "Decide what to show" table)
- Modify: `skills/covi/SKILL.md` (the run layout's `video/` line)
- Modify: `tests/direction-method.test.ts` (imports; a third `describe`)

**Interfaces:**
- Consumes: Task 3's `references/direction.md` (its file name and its "Staging a change with no UI" section); Task 3's RED table (from the controller); `/tmp/covi-b7-pressure/score.mjs` (Task 3, Step 1; repeated below).
- Produces: the `**Direct the picture.**` paragraph in `## Method` (the test pins its name); `PROMPT_WORDS = 2800` in `tests/direction-method.test.ts`.

- [ ] **Step 1: Write the failing test**

In `tests/direction-method.test.ts`, add `import { loadSkill, methodologyOf } from '@covi/core';` to the imports, and append:

```ts
/** The most words the covi-video methodology may carry into the narration prompt. */
const PROMPT_WORDS = 2800;

describe('the covi-video methodology in model prompts', () => {
  it('carries direction as one short rule, leaving the verb reference and the draft loop to agents', async () => {
    const methodology = methodologyOf(await loadSkill('covi-video'));
    expect(methodology).toContain('**Direct the picture.**');
    expect(methodology).toContain('references/direction.md');
    for (const term of ['--draft', 'video/draft', 'covi render', 'count-up', 'qc.json'])
      expect(methodology, term).not.toContain(term);
    expect(methodology.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(PROMPT_WORDS);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/direction-method.test.ts -t "model prompts"`
Expected: FAIL — the methodology has no `**Direct the picture.**`.

- [ ] **Step 3: `## Method` and `## Quality bar` (loaded into the narration prompt)**

In `skills/covi-video/SKILL.md`:

1. In **Pick the story**, replace

```markdown
Covi's draft is a scaffold: rewrite every line of its narration and set `"draft": false`.
```

with

```markdown
Covi's draft is a scaffold: rewrite every line of its narration and set `"draft": false`. Each beat's `verbs` (`covi templates show <id>`) suggest how to direct it.
```

2. In **Name the hero**, replace

```markdown
Covi brings it in with `zoom-through` unless you set its `transition`,
```

with

```markdown
Covi zooms into it (the camera pulls back and pushes into its stop; `zoom-through` with `--direction off`) unless you set its `transition`,
```

3. After the **Let the list be the map.** paragraph and before `**Storyboard rules**`, add the paragraph:

```markdown
**Direct the picture.** Evidence decides what is shown; the direction decides how (`references/direction.md`). Show the change happening: code that changes morphs, a measured number counts to its new value and is the largest thing on screen when it lands, and work with nothing to see is staged (a request travels, splits into its measured chunks, and merges back; a timeout is a warning label). Every number and line of code on screen comes from the run's evidence; labels are a word or two, with no digits and no number words. Give each moment its own phrase in the line, early enough to be read.
```

4. Replace the whole **Transitions** bullet (it starts ``- **Transitions** (`transition`, how the scene enters): `fade` (the default),``) with:

```markdown
- **Transitions** (`transition`, how the scene enters): leave it unset, and the camera carries the change: Covi pans or pushes to the next step, zooms into the hero, wipes from before to after, and cuts when the same subject continues (with `--direction off`, an unset transition fades and the hero zooms through). Set it only to insist: `cut`, `push` (slides left), `wipe` (uncovers left to right), `zoom-through`, or `fade`. Covi starts each one just before the next line, so the picture changes with the words.
```

5. Replace the whole **Vary the picture.** bullet with:

```markdown
- **Vary the picture.** No more than two scenes of one kind in a row (two code cards, then the output or a capture), and no one transition for more than 60% of the scene changes; camera moves over fades. QC's `monotony` and `transition-variety` warn otherwise.
```

6. In the storyboard rule about `narration` and `say`, replace

```markdown
(`useCartTotals` → "use cart totals").
```

with

```markdown
(`useCartTotals` → "use cart totals"); rewrite or remove it whenever you rewrite the line.
```

7. In `## Quality bar`, after the bullet that starts "It looks like the software under review", add:

```markdown
- The change is shown, not told: code that changes morphs, the key number is the largest thing on screen when it lands, and a change with nothing to see is staged.
```

On a scratch copy of `main`, these seven edits took the methodology from 2559 to 2746 words, with none of the test's agent-only terms in it.

- [ ] **Step 4: `## Run it` and `## Related skills` (agent-only)**

1. Replace B2's **Direction.** paragraph in `## Run it` (from `**Direction.** Every video is drawn on Covi's canvas` through the end of B5's sentence, which ends "beside its key number.") with:

```markdown
**Direction.** Every video is drawn on Covi's canvas: each scene at its own stop, the camera moving between them. `covi video --draft` also writes `video/direction.json` with `"draft": true`: Covi's default direction, which morphs small code hunks, counts a command's key number and stages its counts, sends something along a diagram's edges, and gives every scene an entrance. Direct the scenes where you can tell the change better, by `references/direction.md`: which verb fits which change, the variety rules, how every number and line of code binds to evidence, how to stage a change with no UI, and a worked example. `covi templates show <template>` lists each beat's suggested `verbs`, and `covi schema direction` every field. Set `"draft": false`, or Covi derives its draft again; scenes you leave out keep Covi's shots. `covi render` refuses a direction that does not fit the run and lists why. `--direction off` renders without the canvas.
```

2. Replace B6's block from `**Draft, look, revise.**` through its sentence "Stop after three draft rounds even if a warning remains, then render the video with `covi render --run <id> --json` and review it as below." (the paragraph, its seven bullets, and that sentence) with:

```markdown
**Draft, look, revise.** Before the real render, check the motion on a draft: `covi render --run <id> --draft --json` renders the same video at half size and 15 fps with the voice alone, in seconds, into `video/draft/`, and leaves the video's own files as they are. Open `video/draft/contact-sheet.jpg`, read `video/draft/qc.json`, and revise `video/direction.json` or the storyboard; `references/direction.md` says how to fix each check it names. Stop after three draft rounds even if a warning remains, then render the video with `covi render --run <id> --json` and review it as below.
```

3. In **Review it yourself**, question 4, replace "it would: trade cards for captured evidence." with "it would: trade cards for captured evidence, or for shots that show the change (a morph, a counter, a flow)."
4. In `## Related skills`, replace

```markdown
Narration: `references/narration.md`.
```

with

```markdown
Narration: `references/narration.md`. Directing shots: `references/direction.md`.
```

- [ ] **Step 5: The related skills and storytelling**

`skills/covi-video/references/storytelling.md`:
- In the **One hero.** bullet, replace "and let it enter with `zoom-through` (its default)." with "and let Covi zoom into it (its default)."
- In the **Motion follows the words.** bullet, replace "and choose transitions for what they say: `cut` when the same subject continues, `push` for the next step, `wipe` from before to after, `zoom-through` into the hero." with "and let the camera carry each scene change: a cut when the same subject continues, a pan or a push to the next step, a wipe from before to after, a zoom into the hero (`references/direction.md`)."
- In `## Bug fix`, after the item "5. **Wrap**: the verdict in a few words." add a blank line and this paragraph:

```markdown
When the bug has nothing to see (a backend fix), stage the before and the after from what a command measured instead of capturing them (`references/direction.md`, "Staging a change with no UI").
```

`skills/covi-demo/SKILL.md`, in the "Decide what to show" table, before the row `| is internal (refactor, tests, CI, types) | nothing; say so, and let the explanation carry it |`, add:

```markdown
| changes what a backend does with nothing to see (sizes, counts, retries, timeouts) | a command that prints what it measures at base and head, one `label: number` line per measure with nothing after the unit: Covi reads them as `metric:` evidence a video can count and stage |
```

`skills/covi/SKILL.md`, in the run layout, replace the line `video/                storyboard.json, timeline.json, captions, audio.json, music.wav, covi-review.mp4, qc.json` with `video/                storyboard.json, direction.json, timeline.json, captions, audio.json, music.wav, covi-review.mp4, qc.json, draft/` (leave it if B2–B6 already list them).

- [ ] **Step 6: Run the tests**

Run (in the background, and wait): `npx vitest run tests/direction-method.test.ts && npm run agents:check`
Expected: PASS.

- [ ] **Step 7: GREEN — agents direct the benchmark with the new skill**

Prepare three fresh drafted copies (in the background):

```bash
rm -rf /tmp/covi-b7-pressure/green-* && mkdir -p /tmp/covi-b7-pressure && for n in 1 2 3; do ./bin/covi.mjs examples create backend-slim-request --into /tmp/covi-b7-pressure/green-$n --json > /dev/null && ./bin/covi.mjs video --repo /tmp/covi-b7-pressure/green-$n --standard --draft --force --json > /tmp/covi-b7-pressure/green-$n.json; done
```

If `/tmp/covi-b7-pressure/score.mjs` is gone, recreate it with this content (the same scorer the RED run used):

```js
// Scores one agent's direction of the benchmark against the methodology's checkable criteria.
// node score.mjs <result.json from covi video --draft> <repo> <path to bin/covi.mjs>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [resultFile, repo, covi] = process.argv.slice(2);
const { runDir } = JSON.parse(readFileSync(resultFile, 'utf8'));
const read = (rel) => JSON.parse(readFileSync(join(runDir, rel), 'utf8'));
const row = { repo };
try {
  execFileSync('node', [covi, 'render', '--repo', repo, '--run', runDir, '--draft', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  row.valid = true;
} catch (error) {
  row.valid = false;
  row.error = String(error.stderr ?? error).split('\n').slice(0, 8).join(' | ');
}
const direction = existsSync(join(runDir, 'video/direction.json'))
  ? read('video/direction.json')
  : { shots: [] };
const storyboard = read('video/storyboard.json');
const elements = direction.shots.flatMap((s) => s.elements);
const beats = direction.shots.flatMap((s) => s.beats);
row.agentsOwn = direction.draft === false;
row.morph = elements.some((e) => e.kind === 'morph');
row.metric = elements.some((e) => e.kind === 'metric');
row.flowVerb = beats.some((b) => ['flow', 'split', 'merge', 'stack', 'count-up'].includes(b.verb));
row.fade =
  direction.shots.some((s) => s.enter === 'fade') ||
  storyboard.scenes.some((s) => s.transition === 'fade');
row.warningLabel = elements.some((e) => e.kind === 'label' && e.tone === 'warning');
row.labels = elements.flatMap((e) => [e.label, e.text].filter(Boolean));
if (row.valid && existsSync(join(runDir, 'video/draft/qc.json'))) {
  const wanted = ['monotony', 'transition-variety', 'motion-gap', 'motion-busy', 'reading-time',
    'overlap', 'out-of-frame', 'dropped-beats', 'still'];
  row.qc = Object.fromEntries(
    read('video/draft/qc.json').checks.filter((c) => wanted.includes(c.id)).map((c) => [c.id, c.status]),
  );
}
console.log(JSON.stringify(row));
```

Dispatch three fresh subagents at once (Agent tool, `subagent_type: general-purpose`), one per copy, with this prompt (replace `N`), the same words the RED run used:

> You are an agent using Covi to make a review video, and Covi has already drafted it. The repository under review is `/tmp/covi-b7-pressure/green-N`; read `runDir` from `/tmp/covi-b7-pressure/green-N.json`. Run Covi as `node ~/projects/covi-direction/bin/covi.mjs … --repo /tmp/covi-b7-pressure/green-N`. Follow the `covi-video` skill at `~/projects/covi-direction/skills/covi-video/SKILL.md`, and open the references it points to when it says to. The change has no UI. Rewrite the narration in `video/storyboard.json` and write `video/direction.json` so the video shows the change. You may render drafts (`covi render --run <runDir> --draft --json`) as the skill describes; do not run the final render, and do not edit files outside that run directory. Reply with one sentence on how you staged the change.

Score them: `for n in 1 2 3; do node /tmp/covi-b7-pressure/score.mjs /tmp/covi-b7-pressure/green-$n.json /tmp/covi-b7-pressure/green-$n ./bin/covi.mjs; done`, and read every label for number words.

GREEN passes when every run is `valid`, `agentsOwn`, and has `morph`, `metric`, `flowVerb`, a `warningLabel`, no `fade`, and no number word in a label; and in at least two of three runs the draft QC passes `motion-gap`, `motion-busy`, `reading-time`, `dropped-beats`, and does not fail `out-of-frame`. If the runs split 2–1 on a criterion, run two more agents (`green-4`, `green-5`) before deciding. If a criterion fails in most runs, find why in the agents' files (the omission, or the reason given), tighten `direction.md` or the `SKILL.md` paragraphs in recipe form (a table row, a step, a field in the workflow; a prohibition only for a rule the agent knew and broke), re-run Step 6, and run GREEN again with fresh copies; at most two such rounds, then report what still fails. Report the GREEN table beside the RED table. Then `git status`: only this task's files may have changed.

- [ ] **Step 8: Commit**

```bash
npx biome check --write tests/direction-method.test.ts
npm run lint && npm run typecheck
git add skills/covi-video/SKILL.md skills/covi-video/references skills/covi-demo/SKILL.md skills/covi/SKILL.md tests/direction-method.test.ts
git commit -m "$(cat <<'EOF'
Teach the covi-video skill to direct videos

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
### Task 5: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md` (`### Storytelling templates`: the beat list and the template format; B2's `### Direction and the canvas`: a closing paragraph)
- Modify: `docs/contributing.md` (`## Adding a storytelling template`: the beat fields)
- Modify: `docs/skills.md` (the `covi-video` row; the "Files agents write" table)
- Modify: `AGENTS.md` (Changing workflows safely → Templates)
- Modify: `CHANGELOG.md` (one line under `## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: Tasks 1–4 as documented below.
- Produces: documentation only. `skills/` is linked into `.claude/skills` and `.agents/skills`, so nothing needs regenerating (`npm run agents:check` confirms it).

- [ ] **Step 1: `docs/video.md`**

In `### Storytelling templates`, in the list after "each beat has:", replace "- a narrator expression;" with:

```markdown
- a narrator expression;
- the direction verbs that suit it (`verbs`), a suggestion for whoever directs the scene;
```

In **Template format:**, replace "Each beat has an `id`, an `eyebrow` (up to 40 characters), a `goal`, a list of `visuals`, an `expression`, and an `optional` flag." with "Each beat has an `id`, an `eyebrow` (up to 40 characters), a `goal`, a list of `visuals`, up to four direction `verbs` (each a verb of `covi schema direction`, at most once; Covi's default director does not read them), an `expression`, and an `optional` flag."

At the end of B2's `### Direction and the canvas` section (after its last bullet, before the next `###`), add:

```markdown
How to direct well is methodology, in `skills/covi-video/references/direction.md`: which verb fits which change, the variety rules (no more than two shots of one kind in a row, camera moves over fades), how every number and line of code binds to evidence, how to stage a change with no UI, and a worked example on the benchmark. `tests/direction-method.test.ts` checks that the example fits the benchmark and passes the timeline's checks, and that Covi's own direction of the benchmark morphs its code, counts its key number, and stages its counts with flow verbs; the render tests render both and check the frames.
```

- [ ] **Step 2: `docs/contributing.md`**

In `## Adding a storytelling template`, in the beat list, after the `visuals` item, add:

```markdown
- `verbs` (optional): up to four direction verbs that suit the beat, most fitting first, each once (`covi schema direction` lists them). They are suggestions for agents; Covi's default director does not read them. Every shipped beat has them, and a test checks that they fit its visuals: a `morph` needs `code`, a wrap suggests only `place`, and counts and flows need something measured or connected.
```

- [ ] **Step 3: `docs/skills.md`**

In the skills table's `covi-video` row, replace "Uses `references/storytelling.md`, `references/narration.md`, and `references/music.md` (writing a score)." with "Uses `references/storytelling.md`, `references/narration.md`, `references/direction.md` (directing shots), and `references/music.md` (writing a score)."

In the "Files agents write" table, after the `video/storyboard.json` row, add (unless B2 already did):

```markdown
| `video/direction.json` | `covi schema direction` | `covi render` (unless `video.direction` is `off`) |
```

- [ ] **Step 4: `AGENTS.md`**

In "Changing workflows safely", in the **Templates** bullet, replace

```markdown
Each beat's `eyebrows` carries its label in Korean, Japanese, and Chinese.
```

with

```markdown
Each beat's `eyebrows` carries its label in Korean, Japanese, and Chinese, and its `verbs` suggest how to direct it (data for agents; the default director never reads them).
```

- [ ] **Step 5: `CHANGELOG.md`**

Under `## [Unreleased]`, in its `### Added` list, one line:

```markdown
- Direction methodology: the `covi-video` skill's new `references/direction.md` says which verb fits which change, how to vary shots (no more than two of one kind in a row, camera moves over fades), how every number and line of code binds to evidence, and how to stage a change with no UI, with a worked example on the benchmark that tests validate and render; every story template beat suggests `verbs`; and tests pin that the benchmark's default direction morphs, counts, and stages with flow verbs while passing the motion and variety checks.
```

- [ ] **Step 6: Run every check**

Run in the background and wait for each: `npm run check` (lint, typecheck, `agents:check`, `npm test`), then `npm run test:render`.
Expected: both PASS. If `npm run test:render` fails in a test this PR did not touch, check it against `main` before changing anything: a render test that fails on `main` too is not this PR's to fix, and the report says so.

- [ ] **Step 7: Commit**

```bash
git add docs AGENTS.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
Document the direction methodology and template verbs

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---
## Self-review

Checked against the spec with fresh eyes, then fixed inline.

- **Spec coverage.** §11 "when each verb fits" → Task 3 (`## Show the change happening`, `## Verbs`, `## Elements`); "variety rules (≤ 2 of one kind in a row; camera moves over fades)" → Task 3 (`## Variety`) and Task 4 (Method's **Vary the picture** and **Transitions**); "the evidence-binding rule" → Task 3 (`## Bind everything to evidence`: content only by id, never a number, labels name things, phrases from the line) and Task 4 (**Direct the picture.**); "staging changes with no UI (flow, split/merge, stack, metrics)" → Task 3 (`## Staging a change with no UI`, the worked example) and Task 4 (covi-demo's measuring command, storytelling's pointer); "the draft/critique loop" → Task 3 (`## Workflow with the CLI`, B6's per-check fixes moved there) and Task 4 (the short **Draft, look, revise.** paragraph); "`templates/stories/*.yml` beats gain `verbs:` suggestions (validated on load; schema additive)" → Task 1; "the benchmark's default direction uses `morph`, a metric visual, and a flow verb, and passes the non-render QC" → Task 2 (`tests/direction-method.test.ts`); "the render test asserts the render QC" → Task 2 (default render: `text-size`, `empty-frame`, `overlap`, `out-of-frame`) and Task 3 (the example's render). The lead's pointers: a reference `direction.json` staging the timeout with a warning label, validated against the benchmark's evidence → Task 3; which parts are prompt-loaded → Task 4 and its budget test; docs, CHANGELOG (R-024), `npm run check` and `npm run test:render` → Task 5; no `version` changes → Global Constraints. §4.5/R-012/R-015/R-019 labels → Task 3's example and its "practises what it teaches" test. §14: nothing new reaches the renderer (template verbs are bundled data the renderer never reads).
- **Placeholders.** None: every code step carries its code, every skill and doc edit its exact text and anchor. Steps that touch B2–B6 text (the `## Run it` paragraphs, the render loop's benchmark block) name the merged anchor and say what to do when it differs.
- **Type consistency.** `BEAT_VERBS_MAX`, `BeatSchema.verbs` (Task 1); `VideoRun` (`runDir`, `storyboard`, `evidence`, `sources`, `spec`), `readVideoRun`, `directedTimeline(run, direction?)` → `{ plan, timeline }`, `TIMELINE_CHECKS`, `timelineChecks`, module-scope `drafted` (Task 2); `DirectionExample` (`scenes`, `direction`), `directionExample`, `rewriteScenes`, `choreography` (Task 3); `PROMPT_WORDS`, `**Direct the picture.**` (Task 4). Each later use matches its definition; Task 3 extends Task 2's import lists rather than redefining them.
- **Verification of the plan itself.** No mirror of B2–B6 exists, so what depends on their code was reasoned from their plans. On a scratch copy of `main` (4ccbdb6) with a stand-in `ShotBeatSchema` of the ten verbs: Task 1's schema, all seven templates, and its tests passed (`templates.test.ts` and the examples' template tests), `covi templates show bug-fix` printed the verbs, and Biome was clean. Task 4's Method and Quality bar edits measured 2746 words of methodology (from 2559), every anchor matching exactly once, with none of the agent-only terms the test forbids. Task 3's example was checked against the benchmark drafted on `main`: every phrase occurs exactly once, every label passes B2's allowlist (with R-019's CJK punctuation) and has no number word, the rewritten storyboard parses, and its estimated timing (captions' phrase moments over `layoutScenes`) leaves no wordless gap over 1.4 s and the warning label 3 s on screen. The benchmark's `main` render passed `text-size` and `empty-frame`.
- **Review Focus.** Each of the five lines has its test in the owning task (Tasks 3, 1, 1, 3, 4).

## Rulings

- Ruling: template `verbs` are optional in the schema, 1–4 verbs each named once, from an enum read off `ShotBeatSchema`'s own discriminators, and every shipped beat carries them (a test) — spec §11 says "schema additive", and reading the enum from the direction schema keeps one list — a custom template without verbs loads silently, with no suggestions.
- Ruling: verbs are suggestions for agents only; the drafter and the default director never read them — "methodology goes in the skill, not in code", and the director chooses from evidence — the default direction may stage a beat differently from what its template suggests.
- Ruling: a wrap (a beat whose only visual is `summary`) suggests exactly `place`, and no other beat suggests `place` — the summary card has its own choreography, and motion there invites busy endings — `place` reads as "leave it" only through the reference's verb table.
- Ruling: `references/direction.md` is agent-only (no code loads it); the prompt-loaded `## Method` gains one short **Direct the picture.** paragraph plus corrections, and a test caps the methodology at 2800 words — `refineNarration` only rewrites narration, so a verb reference would be dead weight in its prompt — the narration model learns direction only in brief.
- Ruling: B6's per-check fix list moves from `SKILL.md` `## Run it` into `direction.md`'s `## Workflow with the CLI`, and `## Run it` keeps a short loop paragraph pointing there (B6 left this move to B7) — one source for how to fix each check, where the directing agent already is — an agent that skips the reference sees the checks without their fixes.
- Ruling: prompt-loaded text that B2 made stale is corrected in place: the hero enters with a zoom under direction, and an unset transition is the director's camera move (a fade only with `--direction off`) — prompt text must not contradict the renderer — about 40 more words in the prompt.
- Ruling: the non-render tests build the timeline in-process with a test helper that runs `produceVideo`'s own steps with estimated speech, and a captions-only render checks that the helper draws Covi's timeline exactly — `npm test` has no ffmpeg, and the pipeline locates ffmpeg before it builds a timeline — the helper can drift from the pipeline; only `npm run test:render` (local) catches it.
- Ruling: the non-render QC is the six timeline-only checks (`monotony`, `transition-variety`, `motion-gap`, `motion-busy`, `reading-time`, `dropped-beats`); the render QC is `text-size`, `empty-frame`, `overlap`, `out-of-frame` (plus `still` for the example) — the first need only the timeline, the rest the stage's boxes or pixels — none.
- Ruling: the default-direction test runs on the real drafted benchmark (`covi video --standard --draft`), in English — the program's benchmark and mode; the drafted direction must equal what the helper plans — Korean and short-form default directions are not pinned here (B6's hand checks cover Korean).
- Ruling: the worked example lives inside `direction.md` as two fenced JSON blocks (scene edits, then the direction) that the tests parse — the example agents read is the one tested, and it installs with the skill — editing the example means keeping its heading and the two blocks in order.
- Ruling: the example keeps the draft's four scene ids and the cold open's eyebrow, turns `s3` into the proof with the command's terminal visual, and drops `say` from every rewritten line — the storyboard stays true for `--direction off`, and a stale `say` would be spoken over new captions — the example teaches one restructuring, not several.
- Ruling: the example stages the timeout with a `label` (`tone: "warning"`) and cites `metric:terminal-1:timeouts` in the scene's `evidenceIds` — a label has no evidence field (spec §4.2), yet its claim must cite evidence — none.
- Ruling: the example morphs `diff-hunk:src/reader.js:19`, the hunk the draft shows and B3 verified morphs, not `src/request.js:25` — the storyboard's visual stays true and the hunk is known to morph — the request side of the change is told in the line, not shown.
- Ruling: the example renders captions-only with no music in the render test — its timing is then Covi's estimate, deterministic and equal to the helper's — the voiced example's timing is not pinned; agents' draft loops cover voiced timing.
- Ruling: the methodology tells agents to bring words in on a phrase in the first half of the line — `reading-time` counts until the next scene starts entering, which is about when the line ends (estimated: a label on a line's last words got 0.24 s) — a long label in a short line can still warn; the draft loop catches it.
- Ruling: the writing-skills pressure test uses three fresh agents per arm (RED before the reference exists, GREEN after the skill points at it), scored by the CLI's own validation and draft QC plus a manual label read, with two more agents on a 2–1 split — the skill's TDD requires a watched baseline, and the CLI makes scoring objective — three runs can mislead where five would not.
- Ruling: `covi-demo` gains one table row (a backend change with nothing to see → a command printing `label: number` lines at both revisions) — metric staging needs such a command, and B4 counts only lines that are wholly `label: number [unit]` — none.
- Ruling: the router skill's run layout lists `direction.json` and `draft/` — B2 and B6 added them, and the router predates them — none.
- Ruling: the CHANGELOG line goes under `### Added` — a new reference and a new template field dominate the PR, and the skill change is mentioned inside the line (R-024) — someone may read a methodology change as `### Changed`.
- Ruling: if the default render warns `text-size` or `empty-frame`, the implementer reports instead of weakening the assertion or changing layout code — B7 is methodology; layout belongs to B1/B2 — B7 can block on an upstream fix.
- Ruling: number words stay unpoliced in product code (R-012); only the example's own labels are checked against an English number-word list — the methodology's example must obey the methodology — none.
