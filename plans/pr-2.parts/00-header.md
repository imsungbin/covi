# PR 2: Timing and Motion Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Covi videos a timing and motion grammar: visuals pinned to spoken phrases (`sync`), five scene transitions, one hero with its accent, caption emphasis (`[[…]]`), a camera that never holds still while narration continues, a cold open that shows the subject at frame 0, no padding to a target length, and QC gates (`still`, `hook`, `speech-share`) that catch slideshow pacing.

**Architecture:** Everything that is timing is resolved in Node, in the timeline: phrase times come from the same text-weighted split the captions use, and each timeline scene gains `transition`, `phases` (scene-local seconds), `hero`, and `camera`. The browser runtime stays a pure function of the frame: components read `ctx.phases` and fall back to today's fractions, transitions and the camera are pure functions in two new runtime modules, and the stage applies them per frame. QC measures the rendered video with ffmpeg `freezedetect` on the media region, and the contact sheet samples the moments a reviewer must see.

**Tech Stack:** TypeScript on Node 22.18+ (type stripping, `.ts` imports), Zod 4 schemas, Vitest 5, Biome 2, Playwright Chromium, ffmpeg/ffprobe.

**Spec:** `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/SPEC.md`. Binding parts: "Global constraints", "Vocabulary", and "PR 2 — Timing and motion grammar" (items 1–11). PR 3 builds on the hooks named in Tasks 1, 3, and 4 (`TimelineScene.phases`, `HERO_PHASE` in `timeline/types.ts`, the `Phases` type and the timing functions in `timeline/cues.ts`, and `phaseNames` in `storyboard/grammar.ts`), so keep those names.

**Worktree:** `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/video`, branch `timing-motion-grammar`, based on `main` at `888c958` (PR 1 merged). All work and commits happen there. Every command block sets `WT` first, because agent shells reset their working directory between calls.

## Global Constraints

Copied verbatim from SPEC.md, "Global constraints (bind every PR)":

- Follow `/Users/a10637/projects/covi/AGENTS.md` exactly (architecture rules, dependency
  direction, security model, code style, i18n catalogs ×4, derived files, test expectations).
- TypeScript on Node 22, `.ts` imports, `import type`, no enums/namespaces. Biome format.
- Code comments, commit messages, PR text, CHANGELOG: English. Comments explain why.
- No spec/plan/design documents are added to the repository. Existing product docs under
  `docs/` are updated only where they describe behavior that changed.
- `CHANGELOG.md` at the repo root, Keep a Changelog format. PR 1 creates it with
  `## [Unreleased]`; every later PR adds one concise line under Added/Changed/Fixed. No PR
  except PR 8 touches any `version` field.
- Schemas: additive only (new optional fields). A breaking change to a `schemaVersion` file
  bumps the version and updates the skill that describes it.
- Every deterministic behavior has tests (positive and negative). Rules in
  `packages/core/src/review/rules/` need a firing and a quiet test.
- Runtime components: pure functions of frame time; no Date/Math.random/CSS animation.
- Sound engine: deterministic; bump `AUDIO_ENGINE_VERSION` whenever rendered audio changes.
- Text for people goes through `templates/i18n/*.yml` (en, ko, ja, zh), never literals.
- `npm run check` green before any PR is opened. Render tests (`npm run test:render`) are
  run locally for PRs touching `packages/video` or `packages/audio`.
- Commits authored by the default git identity; no Claude authorship. Commit messages end
  with `Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh`.

PR 2 scope, verbatim from SPEC.md:

> Scope: `packages/video` (storyboard schema, timeline, runtime stage, qc, captions),
> `packages/brand` tokens if a token is needed, `docs/visual-system.md`, `skills/covi-video`
> (describe the new fields), `templates/i18n` for any new QC message, `CHANGELOG.md`.

Items 10 and 11 add `templates/stories/bug-fix.yml`, the four i18n catalogs (narration strings), `tests/english-baseline.test.ts` (and its snapshot), and `packages/video/src/storyboard/model.ts`. Tests in `tests/` that assert drafted storyboards (`tests/examples.test.ts`, `tests/multilingual.test.ts`) change with the drafter. `docs/video.md` and one sentence of `docs/contributing.md` describe changed behavior. Nothing in `packages/audio` changes.

AGENTS.md rules that bind this PR in particular:

- **Video components** (`packages/video/src/runtime/`): every visual property is a pure function of the frame time. No `Date`, no `Math.random`, no CSS transitions or animations. Text must fit its box. Check changes by rendering an example and opening `video/contact-sheet.jpg`.
- **Music fits the picture, never the reverse:** nothing in `video/timeline.json` may depend on the music or effects choice.
- **Schemas** are validated with Zod; additive changes are fine; update the skills that describe the file.
- **Text for people** goes through the message catalogs; English output is pinned by `tests/english-baseline.test.ts`; CLI log messages stay in English.

## Decisions

Where the spec leaves a choice, or the code forces one:

1. **The `still` gate uses ffmpeg `freezedetect` on the media region**, not frame hashing. `runQc` runs `crop=<media region>,freezedetect=n=0.001:d=1.5` on the finished MP4 (the same place `blackdetect` runs), so it also works when only the sound changed and the frames were reused (no new state in `video/frames.json`), and it measures what the viewer sees. Measured while planning: on PR 1's acceptance render (`scratchpad/pr1-accept`, 1080×1920) it finds the static holds (2.17 s in a code scene, 1.97 s in a findings scene); a synthetic 2 % sine push-in over 4, 10, and 14 s at 30 fps, and over 4 s at 624×696/15 fps and 312×348/12 fps, is never reported as frozen. The narrator, captions, header, and progress bar are outside the media region, so they never hide a still. Other encoders (`h264_videotoolbox`, `mpeg4`) add noise and can only make the gate miss a still, never invent one; it is a warning.
2. **A breath belongs to the scene after it.** The cut formula `start = max(lineEnd − 0.5·d, nextLine − 0.6·d)` holds exactly at every ordinary scene change, with lines 0.35 s apart (`LINE_GAP`), so every non-final tail is `0.35 + 0.4·d ≤ 0.59 s`. Where narrated standard reviews breathe (before the hero's line, before the verdict, after 24 s of talk, and two new breaths below), the transition still starts where the formula puts it for an ordinary gap, and the incoming scene's lead grows by the breath. Applying the formula to the full breath would hold the old picture for 1.3–1.9 s, breaking "tail ≤ 0.6 s".
3. **Two new breaths replace the 2 s opening.** Spec item 6 starts the first line by 0.3 s, which removes the 2 s where bookends music used to open. To keep `music-audible` passing on standard reviews (the gated sound render test asserts it for `api-users-pagination --standard`), `BREATHING` adds its 1.25 s breath before the second line (after the hook) and before the line after the hero. Each line takes at most one breath; the hero's own line keeps `heroBreath` (1.4 s after it settles).
4. **"The target is an upper bound" means the duration window's maximum.** The fitter still drops optional scenes (never the hero) and speeds speech up only past `spec.duration.max`, and it never pads. QC `duration` passes up to `max + 0.5 s`, warns above, and fails above `1.5 × max`. Below the window it passes for `auto` durations (narration sets the length) and warns only when the user asked for a duration explicitly (`spec.duration.auto === false`) and the video is shorter than `min − 0.5 s`, because then the request was missed.
5. **Transition lengths are brand tokens** (`motion.transitions`): `fade` 0.45 s (today's `motion.transition`, unchanged), `cut` 0, `push` 0.5, `wipe` 0.55, `zoom-through` 0.6. All stay under 0.625 s so the tail stays under 0.6 s (Decision 2). The first scene has no incoming transition; the outro keeps its 0.45 s fade.
6. **Phases** are seconds since the scene started (the clock components and `timeline/cues.ts` already use). A phrase is matched verbatim up to whitespace (runs of whitespace compare as one space, case-sensitive) in the narration with markup removed. It must occur exactly once: zero or two-plus occurrences are validation errors (exit 2) naming the scene. A phase marks when its event starts: the zoom starts, the press lands, the step appears, the highlight sweeps, the reveal starts, the card enters, the output prints, the after panel rises. Names: screenshot `zoom`, `click`; interaction `step2`…`stepN` (step 1 starts with the scene) plus `zoom` and `click`, which act on the step showing at that moment; code `highlight` (all highlighted lines, staggered as today) and `highlight1`…`highlightN` (the N-th entry of `highlight`); before-after `reveal`; findings `finding1`…; terminal `output`; api `after`; the hero scene `hero`. Interaction step phrases must follow the step order. `sync.hero` on a scene that is not the hero is an error.
7. **The music's hero moment keeps its definition** (the hero scene has settled: its start plus its transition's length); only the scene it uses changes: a `hero: true` scene first, the template's `hero` beats as the fallback. Nothing in `packages/audio` changes and `AUDIO_ENGINE_VERSION` stays as is: the engine renders the same audio for the same inputs, and the cached-music key already includes the hero moment.
8. **The camera** works on a new per-scene media layer (the scene header is not in it), scaled about the media region's center: a 2 % sine drift (`motion.drift`) through the whole scene on captures (screenshot, before-after, interaction, and a title over a capture); on every other visual a 2 % push-in (`motion.linger`) from the moment its choreography settles (`settledAt`) to the scene's end, when its line is still going; and on the hero a 6 % punch (`motion.punch`, in over 0.1 s, out by 0.6 s), a white flash (`motion.flash`: 0.18 s, 35 %), and one expanding ring centered on the component's target, all clipped to the media region. Cards that draw a large fox (the title card and the summary) push their text panel instead, so the fox the outro takes over never moves. `camera: "static"` stops drift and linger; the hero accent still plays.
9. **A title with `background`** draws the capture in the media region (with browser chrome for landscape images) and puts the title in the scene header (`heading` = the title unless the scene sets one; `eyebrow` = the visual's eyebrow unless the scene sets one). The corner narrator shows, as on any content scene. The video's first scene is drawn settled from frame 0 (its entrances are skipped), so frame 0 shows the subject; its choreography (zoom, click, highlight, typing) still plays on time.
10. **The drafter's cold open:** (a) with a captured page, the opening title gets `background` = the most-changed after capture (`primaryShot(ctx, 'after')`); (b) without one, the first scene showing `code`, `terminal`, or `api` that is not the hero (else the hero) moves to the front, with a short form of the title (whole words, at most 32 characters) as its `eyebrow`, no `heading`, and the opening line before its own; (c) a change with neither keeps its title card. The opening line is the intent sentence alone: the "It touches …" sentence and the roadmap ("We'll look at …") are gone, with their catalog keys (`narration.touches`, `narration.roadmap.*`) removed from all four catalogs. The first scene playing the template's first hero beat present gets `hero: true` and loses `optional`. A hero beat without evidence is left out instead of falling back to a callout, so that `bug-fix`'s `proof` (no longer optional) never becomes a callout hero.
11. **QC messages stay English literals in `qc.ts`**, like all 20 existing checks. They are diagnostics: `run.warn` logs them in English and reports show only `video.qc` (the status). The spec's "`templates/i18n` for any new QC message" therefore adds no catalog keys.
12. **The contact sheet** tiles, in time order: the frame at 0.3 s, each scene's middle, the middle of each transition (a cut has none; the outro's fade counts), and the hero accent 0.1 s after the hero phase. Landscape sheets use four columns once there are more than twelve tiles; vertical ones keep six.
13. **`refineNarration`** budgets each line at most one 15-word line (15 words at English's 2.5 words per second is 6 s; other languages get 6 s of speech: Korean 26, Japanese 24, Chinese 18 units), the total at most the sum of the lines, and it rejects a refined line whose `[[…]]` markup is broken.
14. **The `hero` hold (+0.4 s), default `zoom-through`, accent, `phases.hero`, and hero contact-sheet tile apply only to a scene with `hero: true`.** The template-derived hero (no `hero: true` anywhere) keeps today's role: the hero breath in narrated standard reviews and the music downbeat.

## Review Focus

The five input classes or conditions most likely to bite a user that the spec implies but no requirement names, each with the test that pins it (in the task that owns the code):

1. **Narration changed after validation.** Redaction rewrites a synced phrase (`sk-live-…` becomes `[REDACTED]`), or a model refines drafted narration and breaks `[[…]]`. Expected: rendering never throws; an unresolvable phase is skipped (the visual falls back to its fractions); a broken refined line keeps the draft. Tests: Task 3 "skips a phrase redaction removed"; Task 9 `model.test.ts` "keeps the draft … with broken [[…]]".
2. **Storyboards and timelines written before PR 2.** A storyboard without any new field renders as before apart from the intended timing; a `timeline.json` without per-scene `transition` (an old composition opened in a browser) still draws. Tests: Task 3 "adds nothing to a storyboard that uses none of it"; Task 6 `transitionOf` fallback.
3. **Multi-byte narration.** Korean, Japanese, Chinese, and astral characters (emoji) in phrases and in emphasized captions: offsets must count characters, not bytes or UTF-16 units. Tests: Task 2 multi-byte phrase times and the character-preservation property; Task 7 emphasis offsets in Korean and around an emoji.
4. **Hero edge cases.** The hero as the first scene (no incoming transition), as the last scene (hold before the outro), marked `optional` (the fitter must not drop it), two heroes, `sync.hero` on a non-hero. Tests: Task 1 schema errors; Task 5 "never drops the hero" and the first-scene/last-scene hero layout cases.
5. **Degenerate videos in QC and the contact sheet.** No narration at all, a freeze that runs to the end of the video (`freeze_start` without `freeze_end`), cut transitions (no midpoint), a two-scene video. Tests: Task 10 `parseFreezes` trailing freeze, `hookCheck`/`speechShareCheck` without speech, `contactSheetFrames` with a cut.

## File Map

| File | Change | Task |
|---|---|---|
| `packages/video/src/storyboard/grammar.ts` | Create: `[[…]]` parsing, phrase finding, phase names, storyboard issues | 1 |
| `packages/video/src/storyboard/schema.ts` | `sync`, `transition`, `hero`, `camera`, title `background`, 24 scenes, cross-field validation | 1 |
| `packages/video/src/timeline/types.ts` | `TransitionKind`, `SceneTransition`, `CaptionEmphasis`; scene `transition`, `phases`, `hero`, `camera`; title `background`; cue `emphasis` | 1, 3, 7 |
| `packages/video/src/captions.ts` | Shared timed-window machinery, `phraseTime`, emphasis segments | 2, 7 |
| `packages/brand/src/tokens.ts` | `motion.transitions`, `drift`, `linger`, `punch`, `flash` | 3 |
| `packages/video/src/timeline/build.ts` | `sceneTransition`, `scenePhases`, markup-free speech, title background; new layout, minimums, pacing, fitter | 3, 5, 7, 8 |
| `packages/video/src/pipeline.ts` | `storyboardImages` (title backgrounds), markup-free language detection | 3, 7 |
| `packages/video/src/timeline/cues.ts` | Phase-aware timing functions, `settledAt`, phase-aware `buildCues` | 4 |
| `packages/video/src/runtime/components/*.ts` | Components read phases; camera hook; `entered` for the opening scene; title over a capture | 4, 6, 8 |
| `packages/video/src/templates.ts` | `heroScene` prefers `hero: true` | 5 |
| `packages/video/src/sound.ts` | `heroMoment` uses the hero scene's own transition | 5 |
| `packages/video/src/runtime/transitions.ts` | Create: pure transition looks | 6 |
| `packages/video/src/runtime/camera.ts` | Create: pure camera plan, push, hero accent | 6 |
| `packages/video/src/runtime/anim.ts` | `easeInCubic`, `easeInOutSine` | 6 |
| `packages/video/src/runtime/stage.ts` | Media layer, transitions, camera, hero accent, caption emphasis, settled opening | 6, 7, 8 |
| `packages/video/src/runtime/styles.ts` | Hero accent and caption emphasis rules | 6, 7 |
| `packages/video/src/narration/speech.ts` | Spoken text without markup | 7 |
| `packages/video/src/storyboard/draft.ts` | Cold open, no roadmap, hero mark, hero beats never fall back | 9 |
| `packages/video/src/storyboard/model.ts` | Line budget, broken-markup rejection | 9 |
| `templates/stories/bug-fix.yml` | `proof` not optional | 9 |
| `templates/i18n/{en,ko,ja,zh}.yml` | Remove `narration.touches`, `narration.roadmap.*` | 9 |
| `packages/video/src/qc.ts` | `durationCheck`, `still`, `hook`, `speech-share` | 10 |
| `packages/video/src/render/renderer.ts` | `contactSheetFrames`, `sheetColumns` | 10 |
| `skills/covi-video/SKILL.md`, `references/{storytelling,narration,music}.md` | Describe the new fields and figures | 11 |
| `docs/video.md`, `docs/visual-system.md`, `docs/contributing.md` | Changed behavior only | 11 |
| `CHANGELOG.md` | One `### Added` line | 11 |
| `tests/render/render.test.ts` | Full-pipeline render with every new field (gated by `COVI_TEST_RENDER`) | 12 |

New test files: `packages/video/test/{grammar,phrases,timeline-grammar,motion,emphasis,cold-open,hero,model,qc-grammar}.test.ts`. Changed test files: `packages/video/test/{cues,pacing,captions-timeline,templates,frames}.test.ts`, `tests/{examples,multilingual,english-baseline}.test.ts`, `tests/__snapshots__/english-baseline.test.ts.snap`, `tests/render/render.test.ts`.

---
