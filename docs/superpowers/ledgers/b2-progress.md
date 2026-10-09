# SDD ledger — plan: /Users/seongbeenim/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b2-direction-canvas.md

Base: main 4ccbdb6 (B1 merged).

## Carried from B1 final review
- duplicated transition-length default `scene.transition?.seconds ?? timeline.transition` (4 places) — consolidate when B2 touches them
- extra monotony tests (run at story end; several runs)
- camera effect on the empty-frame fill share
- benchmark code card draws at 25.0 px vs the 24 floor: a canvas zoom-out below ~0.96 makes text-size warn
- cosmetic docs: CHANGELOG "drafted explanations" should also say narration; SKILL.md:90 transition claim omits "(with four or more)"

## Pre-flight scan

Scanned 2026-10-09 against `direction-canvas` at 4ccbdb6 (B1 merged). Read-only: the plan, spec §3–§5/§14–§17, rulings R-001…R-025, the B1 ledger, and every file the plan edits or calls. Nothing was run.

### 1. Targets in the merged code (per task)

| Task | Plan target | Merged code | Correct target / action |
|---|---|---|---|
| 1 | `timeline/types.ts:29` `TransitionKind`; `TimelineScene` 171–201 | match | — |
| 1 | `brand/src/tokens.ts:159-175` | `motion` at 158–176; comment reads "All stay under 0.625 s…" | replace the whole `transitions` comment + line (as written) |
| 1 | `runtime/transitions.ts:36-80` `entering`/`leaving` | match | — |
| 1 | `timeline/cues.ts:631-641` `WHOOSH` + `buildCues` comment | B1 inserted `settledSpan`/`settledFrame` (621–651); `WHOOSH` at :669, comment at :671–678 (text matches) | edit at :669 |
| 1 | `build.ts` `sceneTransition` 65–69, `layoutScenes` 274–349, `fitToDuration` 364–393, `BuildTimelineInput` 414–426, `buildTimeline` 433–526 | match (B1 did not touch build.ts); `cjkFontsFor(JSON.stringify([title, scenes, captions, labels]))` at :500 | — |
| 1 | tests: `timeline-grammar` (`TRANSITION_KINDS` line :45, `sceneTransition` imported), `pacing` (`three`, `lines`, `cutStart`, `TIGHT`, `fitToDuration`, `resolveVideoSpec`, `DEFAULT_CONFIG`, `Storyboard`), `motion` (`U`, `W`, `entering`, `leaving`), `cues-hero` (`scene(id,start,end,extra)`) | all exist | — |
| 2 | `cli/src/main.ts:1378-1405` (`covi schema` help + map) | :1379–1405 | — |
| 2 | `tests/cli.test.ts:369-388` (after the `score` assertions) | match | — |
| 2 | `parseOrThrow(schema, value, label, hint)`, `UsageError(message, hint)`, `EVIDENCE_LIMITS` (via `export * from model/evidence.ts`), `TRANSITION_KINDS` (`as const`) | match | — |
| 2 | label allowlist `LABEL_CHARS` and the `://`/`www.`/scheme refine | **R-019 amends it** (CJK punctuation `、。・「」『』（）！？：`; scheme/URL checks on NFKC) | see §4 item A |
| 3 | `buildEvidence({diff, demo, fileSha})`, `indexEvidence(file, redact?)` (`find` maps refs to their parent), `evidenceId.hunk/terminal/appStart`, `EvidenceKind`, `DiffLine {kind,text,oldLine,newLine}`, `Hunk`, `DemoCommandResult {name,command,before?,after}`, `DemoShot.viewport` incl. `tablet`, `demoPath.appLog` = `demo/app-<rev>.log`, app-start label `app-start · <rev>` | match | — |
| 3 | `findPhrase(text, phrase) → {index,length,count}`, `parseEmphasis(n).text` | match | — |
| 4 | `sceneEvidence(Pick<'visual'\|'evidenceIds'>, index, findings = [])` | match (grounding.ts:41–74) | — |
| 4 | `highlightGroups(highlight)[0].phase` (`highlight<n>` or the group's `sync`) | match | — |
| 4 | `tests/examples.test.ts` helpers `analyzeExample`, `loadTemplates`, `draftStoryboard`, `resolveVideoSpec`, `indexEvidence`, `buildEvidence`; drafted scenes get ids `s<n>` (draft.ts:133) | match; `seedFrom` must be added to the `@covi/core` import (plan says so) | — |
| 5 | `runtime/layout.ts` `computeRegions`, `Regions` (unit, media, full) | match; stage grid is `u(30)` (styles.ts:44) so `gridSpacing` = 30 units | — |
| 5 | `build.ts:86-106` `scenePhases` (`captionWindow`, `phraseTime`, `round` local) | match | — |
| 5 | `storyboard/draft.ts:1224` `function clipLines(text, max, language)` | match | export it |
| 5 | `seededRandom(seed) → () => number` (`@covi/core`) | match | — |
| 5 | `grounding.test.ts` helpers `visual`, `index` (items `diff-hunk:src/cart.ts:10`, `screenshot:cart-desktop-after`, `http:1`, `terminal:1`) | match | — |
| 6 | `pipeline.ts`: `ProduceVideoInput.subject`, `let drafted`, the parse+redact block, `placed.problems`, `run.writeJson('video/storyboard.json')`, `draftOnly` block, `storyboardImages` loop, both `fitToDuration(storyboard, speech(), spec, language, pacing())`, `assets`/`buildTimeline`/`sceneEvidence(s, input.evidence!, input.review.findings)` | match (:96–132, :188–252, :263, :349/:352, :404–423) | — |
| 6 | `run.has/readText/writeJson` (writeJson redacts) ; `demoPath`, `seedFrom` exported from core | match | — |
| 6 | config `video.outro` (schema.ts:267/376/420), `configFromEnv` `COVI_OUTRO` (resolve.ts:133) | match | — |
| 6 | `main.ts` `addVideo` 317–364, `explicitConfig` 225–271; `addVideo` used by video/render/ci (:654/:812/:862) | match | — |
| 6 | `workflows.ts` `videoWorkflow` produceVideo :927, `renderWorkflow` :1049, `applyVideoResult` :956–963 | match | — |
| 6 | `tests/render/render.test.ts:1312` timing-grammar `covi(['render', …])` | the call is at **:1651** (same test name) | edit :1651 |
| 6 | sources from `input.change.files` | evidence is built from the run's `diff.patch` (`collect.ts:74`, `parseDiff` exported); `covi render` re-resolves the change from git (`reloadChange`; staged/uncommitted re-read the working tree) | see §4 item C |
| 7 | `anim.ts` `clamp(v,min=0,max=1)`, `lerp`, `easeInOutCubic` | match | — |
| 8 | `runtime/camera.ts:40-56` `cameraPlan` (`settled`, `drift`, `CAPTURES`) | match (:40–56) | — |
| 8 | `styles.ts:47` `.layer`; vars `dot`, `c.background` | match | — |
| 8 | `stage.ts`: `MountedScene.foxTaken?`, `accent` field, `this.regions = computeRegions(timeline)`, progress loop, media-layer lines, `camera: cameraPlan(scene)`, `component.header/entrance/camera/update/report/target`, `SceneClock {t,duration,p,frame,fox,open}`, seek's `enterWith/next/leaveWith/enter/leave`, push lines, `if (m.header)` block, `report()` `const active`/`items` | all match (B1 added only `drawnFont` on the heading) | — |
| 8 | B1 `drawnFont` "rect.width / offsetWidth" | divides by the **unrounded computed width** (`style.width`, falls back to offsetWidth) | plan text only; behavior (camera scale included) holds |
| 9 | `media.ts` `code`/`terminal`/`screenshot`; classes `.code`, `.term`, `.out`, `.ln add`, `.txt`; `drawnFont`, `overflows`, `rectOf`; `el`, `fitText(node,{max,min,maxHeight,maxWidth})`, `place`; `union`; `easeOutBack`, `rise(el,p,distance)`, `typedPrefix`; theme `accent/success/shadow/line/surface/text`; `.node .ndetail` rule (styles.ts:202) | all match | — |
| 9 | `.dlabel .nlabel { word-break: break-word }`, `.dlabel` `justify-content/align-items: center` + `overflow: hidden` | B1 (Task 5 M1/M3) changed `.node .nlabel` to `overflow-wrap: anywhere` and cards to `safe center` | see §4 item B |
| 9 | `writeComposition(dir, timeline, Map)`; page has exactly 2 `<script>`; JSON inlined with `<` escaped | match | — |
| 10 | `density.ts` `leadKind(Pick<'visual'>): string`, `CARDS`, `emptyFrameCheck` filter `CARDS.has(scene.visual.kind)`, `monotonyCheck`, `transitionVarietyCheck`, `TRANSITION_MIN = 4` | match | — |
| 10 | `settledSpan`'s `settledAt(scene.visual, scene.end - scene.start, scene.phases)` | exact text at cues.ts:632 | replace with `shotSettledAt(scene)` |
| 10 | `packages/video/test/density.test.ts`; render.test.ts B1 loop (:1478–1510), `Timeline`/`readFileSync`/`join` imported | match | — |
| 11 | docs/video.md `| Storyboard |` (:191), `### Editing a storyboard before rendering` (:333), `### Timing` bullet (:434), `### Quality checks` | the sampling sentence is B1's longer text (:654: "…and once more where each story scene has settled… `text-size` and `empty-frame` read only settled frames.") | append to the merged sentence; say a directed scene settles after its beats |
| 11 | visual-system.md:223 + "**Transitions.**" bullet (:231); artifacts.md Video table/:206/:259; security.md `### The subject model` (:214); configuration.md `outro` row (:428), YAML `outro: true` (:437), `COVI_OUTRO` (:506); AGENTS.md :43/:51/:68/:87/:115; SKILL.md `## Run it` "Music never moves frames" (:49), `## Output files` (:125) | all exist | — |
| 11 | (not listed) `docs/cli.md:103` video flags table and `:443` `covi schema` names; `skills/covi/SKILL.md:48` schema list; B1 parked minors CHANGELOG.md:10 ("drafted explanations" → + narration) and covi-video SKILL.md:90 ("(with four or more)") | exist, untouched by the plan | see §4 item F |
| — | B1 test helper `settledReport` (render.test.ts:472) | the plan never references it | — |
| — | README.md:91 (historical quote, R-025) | the plan does not touch README | — |

### 2. Task pairs (shared files or interfaces)

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 1 → 2 | `CAMERA_TRANSITIONS` (value in types.ts), 7-kind `TransitionKind` → `ENTRANCE_KINDS = [...TRANSITION_KINDS, ...CAMERA_TRANSITIONS]`; `TRANSITION_KINDS satisfies readonly TransitionKind[]` still holds | OK |
| 1 → 4 | `TransitionKind` → `entrances()`; `Shot.enter` (ENTRANCE_KINDS) accepts every `TransitionKind` | OK |
| 1 → 5 | `SceneStaging/SceneDirection/DirectionElement/DirectionBeat/Stop/CodeLine/ImageAsset` → resolve.ts; both edit build.ts (1: sceneTransition/layoutScenes/fitToDuration/buildTimeline; 5: scenePhases/phraseMoment) | OK, no overlapping hunks |
| 1 → 6 | `fitToDuration(…, entrances)`, `buildTimeline({entrances, staging})` | OK |
| 1 → 7, 8 | `Point/Rect/Stop/CameraMove/CAMERA_TRANSITIONS`; no-canvas fallbacks for pan/zoom; `TimelineScene.stop/direction` | OK |
| 1, 8, 10 → cues.ts | 1 `WHOOSH`; 8 adds `shotSettledAt` before `verdictEntrance`; 10 makes `settledSpan` call it (hoisted) | OK. cues.ts is in the runtime tsconfig; `shotSettledAt` imports only types |
| 2 → 3 | `Direction`, `ShotElement`, `ShotBeat` (place/reveal → `element`, camera → `to`) | OK |
| 2 → 4 | `Direction`, `Shot` (beats defaulted → required), `ShotBeat` | OK |
| 2 → 5 | `ShotElement['kind']`, `ShotLayout`, `Shot` | OK |
| 2 → 6 | `readDirectionFile`, `DIRECTION_PATH`, `DIRECTION_HINT`, `Direction` | OK |
| 2, 3, 9 → direction-security.test.ts | 2 creates; 3 appends (indexEvidence, refs, sources; "move imports to the top"); 9 appends (fs/os/path, resolveConfig, @covi/video, playwright, canUseBrowser; merge `indexEvidence`/`afterAll`/`LabelSchema`) | OK. Counts: 4 + 1 + 1 = 6 as Task 9 expects |
| 2, 6 → main.ts, index.ts | different blocks (schema map vs addVideo/explicitConfig; schema exports vs director/plan/refs/resolve/sources exports) | OK |
| 3 → 4 | `directionProblems`, `directionSources` (tests only) | OK |
| 3 → 5 | `DirectionSources.hunk/command/capture`, `hunkView` | OK |
| 3 → 6 | `directionSources({files, demo, evidence, appLogs, redact})` | OK by interface; content source deviates from spec (§4 item C) |
| 4 → 6 | `defaultDirection`, `entrances`, `mergeDirection` → `planDirection` | OK |
| 4 → 8 (tests) | director functions used by `directed()` in canvas.test.ts | OK |
| 5 → 6 | `resolveDirection`, `directionImages`, `sceneEvidence(…, shot)` | OK (`assets.prepare(imagePaths)` precedes `resolveDirection`, captures are added to `imagePaths` in step 6) |
| 5 → 8 | `gridSpacing` (runtime/layout.ts) → stage grid; stops snapped to it | OK |
| 5 ↔ 8 | `shotRegion` (whole + headerless → full, else media) ↔ stage `region` (`component.header === false ? full : media`) | OK, consistent; a shot component has no `header` → media |
| 6 → 10 | default director in every full render → Task 10's canvas assertions | OK, except the missing ≥4 guard (§4 item D) |
| 6, 10 → render.test.ts | 6: timing-grammar call (:1651); 10: B1 full-pipeline loop (:1478–1510) | OK, different tests |
| 7 → 8 | canvas functions (`View`, `CameraStep`, `beatView`, `viewAt`, `between`, `pullBack`, `layerTransform`, `insetOf`, `clipRect`, `lerpRect`, `gridStyle`, `PULL_MARGIN`, `isCameraMove`) | OK |
| 8 → 9 | `MountedScene.visual/steps/region`, `targetAt`, `.stop-view > .layer`; 9 replaces `visual: component` and the last line of `targetAt` | OK |
| 8 → 10 | `shotSettledAt` | OK |
| 8, 9 → canvas.test.ts | 8 creates (7 tests); 9 extends the `@covi/core` import and appends 4 tests (uses `SourcesInput`, `DirectionInput` from 8) | OK; 11 total as Task 9 expects |
| 8, 9 → stage.ts, styles.ts | 8: canvas layers, grid, report clip, `.canvas-grid`; 9: `mountShot`, `shot`, `.dlabel` | OK, no overlap |
| 10 ↔ B1 | `leadKind` widened (callers pass `TimelineScene`); `CARDS.has(leadKind(scene))`; `settledSpan` → also moves `layoutSampleFrames`' settled frame (renderer.ts:173) consistently | OK |
| 11 ↔ 1–10 | documents behavior | gaps in §4 item F |

### 3. Each task against itself

| Task | Tests vs code; files created vs touched | Finding |
|---|---|---|
| 1 | `sceneTransition` override; pan/zoom timing (`a.end - a.speechEnd ≤ 0.35 + 0.4·d`); whoosh at 4.35/8.45; staging attached, outro without stop, `fonts.cjk = ['ko']` (`cjkFontsFor` sees Hangul in the serialized scenes) | OK |
| 2 | Schema/JSON-schema keys `['schemaVersion','draft','shots']`, `additionalProperties: false`; all bound tests match the code; messages `at most 262144 bytes`, `not valid JSON`, `video/direction.json is invalid` | OK as written, but lacks R-019 (§4 item A) |
| 3 | 14 expected messages in order (layout-single before duplicate id; delete-only hunk id `…:39`, head view empty; lines past 3 head lines; base side missing) | OK |
| 4 | rotation: seed 0 → pan first; capture→capture cut; before-after wipe; hero zoom; storyboard `fade` kept, `last` updated only by pan/push; code beat at `sync.highlight1`; capture no beat | OK |
| 5 | stops (2–4 per row, ±grid snap, hero +0.5H, later stops unchanged); slots 735/245, 310/290, grid; resolve content, redaction, beat timing (camera 0.15, reader 0.15+0.85·2/3), 14-line window | OK. Files list omits `packages/video/test/phrases.test.ts`, which Step 4 runs unchanged (fine) |
| 6 | plan.ts tests; config test (provenance `global`, YAML `off` string, env error regex); CLI draft + exit 2 + `--direction off`; redaction test reads drafted `video/direction.json` | OK; render.test.ts line number drifted (§1) |
| 7 | camera math (rest transform `translate(0.00px, 0.00px) scale(1.00000)`, 2.5 cap, corner clamp, chaining, pullBack, grid) | OK |
| 8 | motion tests (`settled` 0.6 → 2.8; `2 + settledAt(code, 4)`; drift only when whole); canvas render tests (pan midpoint, zoom ≈ 0.385 < 0.75, header fade, beat 1.45–1.6, clip, grid, determinism, `off` path) | OK |
| 9 | slots, reveal pop/wipe/type, camera on a label (label slot centered on the pivot), hostile text render (2 scripts, 0 injected) | OK; CSS defects in §4 item B |
| 10 | lead kinds, monotony with shots, variety counts pan/zoom, settled 2.3 | OK; render assertion guard (§4 item D); shell vars in Steps 5/7 (§4 item E) |
| 11 | docs only; commit adds `docs AGENTS.md skills/covi-video/SKILL.md CHANGELOG.md` | add `skills/covi/SKILL.md` if item F is taken |

### 4. Defects and contradictions (spec, Global Constraints, rulings)

- **A. R-019 not applied (Tasks 2, 11; ledger).** `LABEL_CHARS` lacks `、。・「」『』（）！？：`; the `://`, `www.`, and `javascript:/vbscript:/data:` checks run on the raw label, so `ｗｗｗ.evil.example` and `ｈｔｔｐｓ：//x` (full-width letters are `\p{L}`, `：` becomes allowed) pass. The plan's own ruling "CJK punctuation … is refused" contradicts R-019, and so does `global-constraints.md` in this folder. Fix: add the characters (and to the error message), run the refine on `text.normalize('NFKC')`, add accept/reject tests (e.g. `「요청」이 큼！`, `完了。`, `タイム・アウト`; `ｊａｖａｓｃｒｉｐｔ：x`, `ｗｗｗ.evil.example`, `ｈｔｔｐｓ：//x`) in direction-schema and direction-security tests; update video.md's Labels bullet and security.md; amend global-constraints.md.
- **B. Task 9 CSS repeats two B1 defects.** `.dlabel .nlabel { word-break: break-word }` overrides `#stage { word-break: keep-all }` for Korean (B1 Task 5 M3; `.node .nlabel` now uses `overflow-wrap: anywhere`). `.dlabel` centers with `justify-content/align-items: center` under `overflow: hidden`, so a label that cannot fit at 28 units is clipped on both sides while `overflows(label)` (the flex item's own box) reports nothing (B1 M1 → `safe center`). Fix both.
- **C. Spec §4.2 deviation (Tasks 3/6).** Code elements read hunks from `input.change.files`; spec says the run's `diff.patch`, which is what `evidence.json` was built from. On `covi render` the change is re-resolved from git (staged/uncommitted runs re-read the working tree), so a `code` element can show lines that differ from the evidenced hunk. Fix: in the pipeline, `files: parseDiff(await run.readText(RUN_PATHS.diff))` (language joined from `change.files` by path; fall back to `change.files` only when no diff.patch).
- **D. Task 10 render assertion stricter than B1.** "no kind > 60%" is asserted for any number of moves; B1's check and Task 4's example test apply it only from four (`TRANSITION_MIN`). A 3-move short video alternating pan/push (2/3) fails. Fix: `if (moves.length >= TRANSITION_MIN)`.
- **E. Task 10 Steps 5 and 7** set `RENDER=$(mktemp -d)` and reuse it in separate (background) commands; shell state does not persist (B1 PF-4). Use a fixed scratch path (e.g. `/tmp/covi-b2-render/`) or one compound command.
- **F. Task 11 omissions.** `docs/cli.md` (`--direction` row in the video flags table near :103; `direction` in the `covi schema` list at :443); `skills/covi/SKILL.md:48` schema list; B1's parked minors (CHANGELOG.md:10 "drafted explanations" → "drafted explanations and narration"; covi-video SKILL.md:90 "(with four or more)"); the skill's direction paragraph should forbid number words in labels (R-012; security.md claims "the methodology forbids them"); the Method section's "Covi brings it in with zoom-through" and the whoosh list ("push, wipe, and zoom-through") are stale under the default canvas (hero zooms; pan/zoom whoosh) — one sentence each, the rest stays for B7.
- **G. B1 carried items not scheduled.** (1) Task 10 edits `settledSpan` (cues.ts:627/:629, plus renderer.ts:147): consolidate the `transition?.seconds ?? timeline.transition` default there. (2) Extra monotony tests (a run at the story's end; several runs) fit `density-direction.test.ts`. (3) Camera effect on density: Task 10 moves the settled span after the shot's beats, so `text-size` and `empty-frame` read a code scene only at its zoomed scale (default 1.25×): sub-24 px code can pass because the camera magnified it, and fill share is inflated. Record a ruling (accept "as drawn") or also read the frame before the first camera beat.
- **H. Minor / recorded deviations (no action needed unless ruled).** Spec §5.3 says the rotation keeps every kind ≤ 50%; with `cut` for repeated evidence it can exceed 50% (tests use 60%). Spec §4.8 camera beats for marks/focus are dropped by ruling. The hero's dropped stop overlaps the frame-sized region of a stop directly below it (no content overlap: media regions stay apart). A vertical pan into a full-region card (summary) interpolates the clip toward the header band while the outgoing scene is the reported one; watch `narrator-clear-of-content` on the every-component render.
- **Line drifts only:** cues.ts `WHOOSH` :669 (plan :631–641); render.test.ts timing-grammar render :1651 (plan :1312); `drawnFont` uses the computed width (plan says offsetWidth).

### 5. Render tests and the benchmark against B1's real sizing

- **Settled-frame scale is never below 1 on the canvas.** `stopView = clampView(withPush(viewAt(beats), push))`: beats clamp zoom to [1, 2.5] (`pan` keeps the current scale), push ≥ 0, `clampView` never changes scale. Pull-back (`between('zoom')`, scale ≈ 0.39) exists only inside a move, and a move into scene i+1 covers [s(i+1).start, s(i).end] = [settled span end, scene end], while scene i's span starts after its own entrance. So the benchmark's 25.0 px code card cannot fall under 24 at a settled frame; with a highlight it reads 31.25 px after the 1.25× beat. `text-size` holds.
- **Every-component full render (default director):** moves push, cut, zoom (hero, unset), wipe, push, pan (rotation after flow's push) → max 2/6; whooshes ≥ 3; code card scale 1→1.25 only increases size and fill; content clipped to media keeps `captions-clear-of-content` passing. Expected to pass, subject to item H's narrator note.
- **Timing-grammar render** is pinned to `--direction off` (R-016), so its zoom-through and the hero lift at +0.6 s hold.
- **Canvas render tests at 640×360** make no B1 size assertions; B1's code/terminal sizing fills slots (`cardHeight`, `codeFont`), which only helps the slot-centering checks. Labels fit at ≥ 28 units, exactly B1's body floor (passes with `SIZE_TOLERANCE` 0.1).
- **Full-pipeline benchmark assertion** (`backend-slim-request --standard`): stops, no fade, some pan/zoom hold; the 60% check needs item D's guard only for videos with three moves.

## Pre-flight rulings
- PF-1 (Tasks 2, 11): Ruling: apply R-019 — LABEL_CHARS adds `、。・「」『』（）！？：`; every `://`/`www.`/`javascript:`/`vbscript:`/`data:` check runs on `text.normalize('NFKC')`; tests: a CJK-punctuated Korean/Japanese label is accepted, `ｗｗｗ.evil.example` and `ｈｔｔｐｓ：//x` are rejected; the plan's "CJK punctuation is refused" ruling is withdrawn; docs (video.md, security.md) state the allowlist correctly — program ruling R-019 — none.
- PF-2 (Task 9): Ruling: `.dlabel .nlabel` uses `overflow-wrap: anywhere` (not `word-break: break-word`) and `.dlabel` centers with `safe center` — B1 fixed the same two bugs (Korean keep-all; hidden overflow) — none.
- PF-3 (Tasks 3, 6): Ruling: code/morph elements read hunk lines from the run's `diff.patch` (`parseDiff(await run.readText(RUN_PATHS.diff))` or the existing reader), with language taken from change.files — spec §4.2 says the run's diff.patch; `covi render` re-reading git can show lines that differ from the evidenced hunk — none.
- PF-4 (Task 10): Ruling: the "no kind over 60%" render assertion is guarded by `moves.length >= TRANSITION_MIN` (4) like B1's check — none.
- PF-5 (Task 10): Ruling: fixed scratch paths (e.g. `/tmp/covi-b2-render/`) or one compound command; no shell variables across commands — none.
- PF-6 (Task 11): Ruling: docs also cover: docs/cli.md `--direction` flag row and `direction` in the `covi schema` list; skills/covi/SKILL.md schema list; B1's parked wording (CHANGELOG line mentions narration; covi-video SKILL.md:90 "(with four or more)"); the skill says direction labels carry no numbers or number words (R-012); the skill's Method text about the hero's entrance and whoosh list updated for pan/zoom; append to docs/video.md's current settled-frame sentence (B1's longer version) that a directed scene settles after its beats — docs must match behavior — none.
- PF-7 (Task 10): Ruling: Task 10 also takes B1's carried items: consolidate `scene.transition?.seconds ?? timeline.transition` (cues.ts, renderer.ts) into one helper; add monotony tests for a run at the story's end and several runs; and for camera effects on QC: `text-size` takes the SMALLEST drawn size across a directed shot's settled frames including the frame just before its first in-stop camera beat (what a viewer reads at rest), `empty-frame` keeps the largest share (as B1) — QC measures what the viewer sees, and smallest-text/largest-fill is B1's semantics — one extra layout sample per directed shot with a camera beat.
- PF-8 (all): line numbers moved (cues.ts WHOOSH :669; render.test.ts timing-grammar call :1651; drawnFont divides by computed width) — implementers locate by content — none.
Task 1: dispatched (BASE 4ccbdb6, implementer b2-impl-1)
R-027 (program): no R-###/PF-# citations in shipped code/docs; B2 removes density.ts R-007 and Task 1's R-008.
Task 1: Ruling: density.ts:12 "(R-007)" removal (R-027) joins Task 1's fix round; M-1 (layoutScenes bound wrong for pan: 0.63 s) joins too — cheap, same lines — none.
Task 1: note for Task 6: build `staging` from `fit.scenes` keyed by id (review M-3: matched by index with no length check).
Task 1: note (program-wide): typecheck does not cover packages/*/test, which let a missing interface field pass — candidate for a separate fix; flag to final review.
Task 1: minor (deferred): M-2 "without direction" test thin.
Task 1: fix round 1/5 dispatched (I-1 TimelineScene.stop/direction missing; I-2 R-008 citation; + R-007, M-1; FIX_BASE c8faac5)
Task 1b: planned (R-028: typecheck package tests), brief task-1b-brief.md; runs after Task 1 completes.
Task 1: fix round 1/5 (4 addressed, 0 open; commits c8faac5..c7a8abf)
Task 1: complete (commits 4ccbdb6..c7a8abf, review clean)
Task 1b: dispatched (BASE c7a8abf, implementer b2-impl-1b)
Task 1b: Ruling (implementer): Node package tests join the root tsconfig; the 7 tests importing src/runtime use packages/video/test/tsconfig.runtime.json with DOM types — one DOM config hid a real error in platforms/test/fixtures.ts — none.
Task 1b: Ruling (implementer): `isWellFormed` replaced by a lone-surrogate regex instead of raising lib to es2024 — none.
Task 1b: minor (deferred): timeline-components.test.ts:245 unchecked Extract cast (add kind assertion); two hand-kept 7-entry lists (root exclude / runtime include); groundFinding Grounded<T>.finding omits evidenceIds (out of scope).
Task 1b: complete (commits c7a8abf..1bd51b5, review clean)
Task 2: dispatched (BASE 1bd51b5, implementer b2-impl-2)
Task 2: Ruling (implementer): `www.` refused wherever it starts a word; index.ts export after ./density.ts — none.
Task 2: Ruling (controller): a script scheme counts only when a non-space character follows its colon (`\b(javascript|vbscript|data):\S` on the NFKC form) — "Stale data: refetch" is an honest label; `data:text/html`/`javascript:alert` stay refused — none (labels render as text only).
Task 2: Ruling: scheme check is `/\b(?:javascript|vbscript)\s*:|\bdata:\S/i` on the folded form (replaces the earlier controller ruling) — keeps spec §14 (`javascript : x` refused) and accepts "Stale data: refetch" — refuses "Rewritten in JavaScript: faster".
Task 2: Ruling: labels refuse `\p{Default_Ignorable_Code_Point}` (CGJ, variation selectors, Mongolian FVS, Hangul fillers…), and the link check folds `。` (and other ideographic full stops NFKC leaves) to `.` first — invisible characters let `https:͏//evil.example` and `www。evil。example` through — none.
Task 2: Ruling: security-relevant minors join fix round 1: parse-error messages bound and escape echoed keys/values (control and ANSI characters escaped, long strings cut) for the direction file; the reader checks `isFile()` before the byte cap (FIFO, /dev/zero) and reports EISDIR/EACCES as such; id length derived from `idChars`; tests for bidi controls, `__proto__`/`constructor` ids, exact-limit lists — a hostile direction file must not reach the terminal raw — none.
Task 2: Ruling: CJK numeral characters (三, 十) stay allowed in labels (refusing them would refuse ordinary words like 一覧); non-NFKC look-alikes are visual spoofs only; docs call the label check a heuristic (Task 11) — R-012 residual risk — a label can still spell a number with CJK numerals.
Task 2: note for Task 3: `constructor`/`__proto__` are valid ids → lookups use Map/Set; error messages escape echoed phrases and evidence ids.
Task 2: fix round 1/5 dispatched (I-1 scheme; I-2 ignorables/。; + security minors; FIX_BASE f34f1cd)
Task 2: note for Task 3: messages built outside Zod must call core's escapeUnprintable (and cut long values).
Task 2: fix round 1/5 (6 addressed, 0 open; commits f34f1cd..9fca0ac)
Task 2: minor (deferred → B2 final fix wave, security): M-1 combining marks / non-ignorable joiners (U+2D7F, U+1107F, U+11A47, U+16FE4) still split `://`/`www.` — fold with NFKD + strip \p{M} for the link check; M-2 dead FULL_STOPS entries and fold tests that don't exercise it; M-3 raw U+202E/U+202A/U+200B/U+2028/U+FEFF in packages/core/test/zod-issues.test.ts source → \u escapes (Trojan Source pattern); M-4 stat before open (avoid opening device nodes) and a "64 accepted" sceneIdChars case.
Task 2: complete (commits 1bd51b5..9fca0ac, review clean)
Rebased onto main 57b69f7 (A1 merged): clean; typecheck exit 0; B2 Tasks 1–2 now at a8f6a56.
Task 3: dispatched (BASE a8f6a56, implementer b2-impl-3)
Task 3: Ruling (implementer): `diffFiles(patch, change.files)` parses diff.patch with parseDiff, language from change.files; hunks matched by id + registry digest (sha256(renderHunk)) so lines differing from the evidenced hunk are never shown; echoed values escaped and cut at 120 chars; Map/Set lookups — PF-3 and Task 2 notes — none.
Task 3: note for Task 6: pass `diffFiles(await run.readText(RUN_PATHS.diff), input.change.files)` (fall back to change.files only when diff.patch is absent), not `input.change.files`, else code elements are refused when redaction changed a hunk.
Task 3: Ruling: plan-mandated early `return` on an unknown scene (refs.ts:35–40) violates spec §4.6 "all problems at once" → removed; only phrase checks and `directed` bookkeeping are skipped — the spec is binding over the plan — none.
Task 3: Ruling: minors M-1 (app-start-base with side base refused with a false reason), M-2 (cut echoes AFTER escaping so one echo stays bounded), M-3 (core exports one `hunkDigest` used by diffHunkEvidence and refs), M-4 (remove the unreachable "no image" branch), M-5 (tests for `lines` on base and diff sides) join fix round 1 — cheap; M-2/M-3 are security/DRY — none.
Task 3: fix round 1/5 dispatched (FIX_BASE dad4697)
Task 3: fix round 1/5 (6 addressed, 0 open; commits dad4697..b0a45b7)
Task 3: complete (commits a8f6a56..b0a45b7, review clean)
Task 4: dispatched (BASE b0a45b7, implementer b2-impl-4)
Task 4: Ruling: mergeDirection keeps the draft's `enter` for scenes the agent left out (an agent's push can be followed by the draft's push) — as briefed; an agent that cares writes every scene's entrance, and transition-variety QC warns — none.
Task 4: note: examples draft ≤ 3 entrances, so the 60% variety check (from 4) never fires in the examples test; the benchmark at standard length exercises it later.
Task 4: Ruling: a scene whose id is longer than DIRECTION_LIMITS.sceneIdChars gets no shot in the default direction (its entrance still applies via `entrances`), so every draft Covi writes passes DirectionSchema; tests assert `DirectionSchema.parse(plan)` equals plan — Covi must never write a file it then refuses — such a scene keeps only its visual.
Task 4: Ruling: spec §5.3's "no kind exceeds 50%" reads as "at most ⌈n/2⌉ of n story moves" (12 plain scenes → 6/11 = 54.5%, within the 60% QC line) — an odd count cannot split evenly — none.
Task 4: note for Task 6: planDirection must validate agent shots before mergeDirection (it trusts its input); duplicate storyboard scene ids collapse to one entrance (no storyboard check refuses duplicates) — flag to final review.
Task 4: fix round 1/5 dispatched (I-1 long-storyboard tests + constants; I-2 schema-valid drafts; FIX_BASE 6dbded2)
Task 4: Ruling (implementer): camera beat phrases are trimmed so parse(plan) equals plan; the beat lands in the same place — none.
Task 4: fix round 1/5 (2 addressed, 0 open; commits 6dbded2..8ae9335)
Task 4: minor (deferred): examples 60% loop still never fires (unit tests cover it); new terminal:1 fixture changes no assertion; tests restate the share formula instead of calling transitionVarietyCheck; plus M-1…M-5 in task-4-review.md.
Task 4: complete (commits b0a45b7..8ae9335, review clean)
Task 5: dispatched (BASE 8ae9335, implementer b2-impl-5)
Task 5: Ruling (implementer): code/output text redacted before being cut to 96/90 chars, and the whole result redacted again at the end (test fails if either early redaction is removed) — a secret cut in half would escape redaction — none.
Task 5: Ruling (implementer): when every element of a shot is gone, all its beats drop too, so the replacing visual is never animated by stale beats — none.
Task 5: Ruling (implementer): explicit `lines` are shown exactly as asked, not windowed to CODE_LINES — the agent chose them (schema caps the span at 40) — a 40-line window may draw small (text-size QC warns).
Task 5: note: the hero's lowered stop overlaps the frame of a stop directly below it by 60 px (media regions do not overlap).
Task 5: Ruling: plan-mandated gutter numbering bug (base side shows head line numbers) is fixed: base → oldLine, head → newLine, diff → current rule — the gutter must show the file's real lines — none.
Task 5: Ruling: minors join fix round 1: M-1 grounding counts what resolved (not the plan's shot); M-2 no two stops' full regions overlap in any orientation (hero drop bounded by the gap); M-3 explicit `split` with one element uses the whole region; M-4 scene timings matched by id, no non-null assertions; M-5 tests for explicit lines, vertical path, label redaction; M-6 resolver docs state per-line redaction relies on diff.patch being redacted whole — cheap correctness/robustness — none.
Task 5: fix round 1/5 dispatched (FIX_BASE 901e301)
Task 5: note for Task 6: call `sceneEvidence(s, evidence, findings, staging && shownShot(shots.get(id), staging[i].direction))`, not `shots.get(s.id!)`. shownShot matches plan ids against redacted staging (an id equal to a redaction literal is missed in grounding; warn-only).
Task 5: fix round 1/5 (7 addressed, 0 open; commits 901e301..59094d3). The earlier "60 px overlap" note is resolved (hero drop now capped).
Task 5: minor (deferred): stops.ts:61 relies on Math.min() of [] = Infinity; resolve.ts:96 unreachable !stop check shares timing message; tall-frame test misses the 8th output line / landscape cut of 12.
Task 5: Ruling: duplicate storyboard scene ids are refused by the storyboard's grammar check (storyboardIssues) — added in Task 6 — two reviewers found duplicates collapse entrances and timings; the storyboard schema shape is unchanged (validation only) — a storyboard with duplicate ids that rendered under 0.2.0 now exits 2.
Task 5: note: director.ts:85 calls sceneEvidence without a shot (as briefed: director reads what visuals show).
Task 5: complete (commits 8ae9335..59094d3, review clean)
Task 6: dispatched (BASE 59094d3, implementer b2-impl-6)
Task 6: Ruling (implementer): `covi ci` also takes `direction` (ci.ts) — parity: CI renders get the default director — none.
Task 6: note: duplicate-id check counts the `s<n>` ids of scenes without an id (a scene id "s2" next to an unnamed second scene collides — correct); render test comment points to canvas.test.ts (Task 8).
Task 6: minor (deferred → B2 final fix wave): M1 duplicate-id message mixes 0-based path index with a 1-based ordinal and "scene 2" reads like an id (grammar.ts:248); M3 redaction test `not.toContain(TOKEN)` on direction.json can never fail; M4 no test that off mode reads nothing, nor that `--draft` keeps an agent's direction.json. Others in task-6-review.md.
Task 6: Ruling: M2 (entrances decided before fitToDuration drops optional scenes → a stale `cut` possible) stays — plan-mandated single timing pass (B2 plan ruling) — visual only.
Task 6: note for Task 11 (M7): document the duplicate storyboard scene-id refusal (CHANGELOG line, docs/video.md, covi-video skill).
Task 6: complete (commits 59094d3..391f42a, review clean)
Task 7: dispatched (BASE 391f42a, implementer b2-impl-7)
Task 7: Ruling (implementer): layerTransform prints translations through a `fixed` helper (values rounding to ±0.00 print 0.00) instead of `(tx + 0).toFixed(2)` — 581/4800 stops printed `-0.00px` on non-integer grids (1366×768, 854×480) — none (picture unchanged).
Task 7: note for Tasks 8–9: the stage multiplies pullBack by PULL_MARGIN, clamps views before toWorld, and passes camera steps to viewAt sorted by t.
Task 7: minor (deferred → B2 final fix wave, visual quality): M1 zoom dip leads its travel (trailing edge sweeps 374 px behind the origin stop vs 83 at midpoint) → couple the dip to the eased travel; M5 overlapping camera beats stop dead mid-move → hand over smoothly; M3 isCameraMove should read CAMERA_TRANSITIONS; M4 document viewAt's time-order requirement; M6 edge-case tests (seconds 0, clampView below 1). M2 pullBack assumes both ends at rest (a 2.5× end beat crops ~80 px at k=0.5) — note.
Task 7: complete (commits 391f42a..6268ac9, review clean)
Task 8: dispatched (BASE 6268ac9, implementer b2-impl-8)
Task 8: Ruling (implementer): scenes on screen share one camera through overlapping moves (moveAt(i) returns only the move into scene i); a move ends on the next stop's view as of the move's end; layout reports clip to the viewport as drawn; camera beats sorted by t — three added tests show the brief's code failing the 1st and 3rd — none.
Task 8: note (visual, for final wave unless review says otherwise): the region clip at rest cuts card shadows flat at the region's bottom edge; during a move the moving dot grid shows as a window on the static dots; Task 7 M1/M2/M5 still apply.
Task 8: Ruling (visual, verified on the reviewer's frames): fix now, overriding plan-mandated behavior: (1) no clip at rest — clip = lerp(whole frame, region, w) with w rising only during a camera move (ramps over k∈[0,0.2] and [0.8,1]) or a beat zoom > 1 (push excluded), so the summary fox's tail and card shadows are never cut flat; the plan's rest-clip assertion changes accordingly; (2) headers never superimpose — the outgoing header fades over the first 40% of a camera move and the incoming eyebrow/heading wait 0.4·seconds, with a test that two headers are never both visible; (3) the narrator eases in/out over a move when the other side has no narrator (opacity change < 0.2 per frame, tested); (4) the dot grid is the stage's first child without a clip-path (one continuous grid; progress bar above it); plus (5) during moves the clip protects only the header and caption bands (top/bottom), not the frame's sides — content was cut 64–96 px inside the sides — refines spec §5.2; (6) narrator/hero-ring targets are mapped through the camera view so they point at the right spot under a camera beat — 0.2.0 kept headers legible and nothing cut; these were visible defects — none.
Task 8: fix round 1/5 dispatched (FIX_BASE d5b528a)
Task 8: Ruling (implementer): the full-width band also applies to beat zooms (zoom test x bounds changed); narrator eases with a sine over 60% of the move (< 0.2/frame at 24 fps too); focus items from layout also mapped through the camera — consistent with the visual ruling — none.
Task 8: fix round 1/5 (6 addressed, 0 open; commits d5b528a..ef7514f)
Task 8: minor (deferred → final wave): header test lacks a `heading` (delay untested); nothing pins the grid (first child, no clip, progress above); narrator aim under a camera beat not asserted directly; incoming header waits ~0.28 s after a headerless title card (ruling-literal) — skip the wait when the outgoing scene has no header; zoomed card shadow cut flat at band top/bottom; grid snaps on non-camera transitions after a drifting scene; review M1/M4.
Task 8: complete (commits 6268ac9..ef7514f, review clean)
Task 9: dispatched (BASE ef7514f, implementer b2-impl-9)
Task 9: Ruling (implementer): the shot carries the visual's `laidOut` flag; a revealed element's clock shifts t/duration/p together; overflow measured on the clipping box; `.dnode` safe center + overflow hidden; wipe sweeps the slot shadow; tone colors border/tint, text keeps theme color — none.
Task 9: Ruling (controller): a `visual` element whose storyboard visual is a title or summary card may only be shown whole (alone); refs refuses it inside a multi-element shot — those cards draw their own header and large fox (outro handoff), which a slot cannot honor — agents cannot put a summary card beside a metric.
Task 9: fix round 1/5 dispatched (I-1 enforce whole-only title/summary in refs; I-2 label fitting under overflow-wrap anywhere; I-3 QC on element shots: canvas.test.ts case running layoutChecks + densityChecks on an element shot's settled frame in en and ko, plus a full-render case with an agent-written direction through covi render; minors: camera aimed at an element mid-reveal, narrator pointing before a visual's reveal, security test lacks output elements; FIX_BASE 6a015c4)
Task 9: note: in the full render with an agent direction, code in a vertical column slot draws at 14.3 px (text-size warns) — slots shared three ways in 9:16 are too small for code; flag to final review / B3 (elision) / B7 methodology (code wants a row of its own on tall frames).
Task 9: fix round 1/5 (3 I + minors addressed, 0 open; commits 6a015c4..8938f24)
Task 9: note for Task 10: the canvas QC unit test uses max(settledFrame, shotSettledAt) because settledSpan ignores shots until Task 10 — drop the max there. Minor (deferred): camera beat can start ≤ 0.1 s before an element is in place when its reveal ends near the scene end; label tolerance and narrator aim not asserted directly; M4 shadow constant copied; M6 typed text re-centres.
Task 9: complete (commits ef7514f..8938f24, review clean)
Task 10: dispatched (BASE 8938f24, implementer b2-impl-10)
Task 10: Ruling (implementer): no "frame before the camera beat" sample when the beat starts while the scene is still entering or during a reveal; one helper `entranceSeconds` in cues.ts for every entrance length (cues.ts, renderer.ts) — none.
Task 10: benchmark render: story moves zoom (hero), pan, push, outro fade; no story fades; QC warn only `still` on s1 (B6 owns); code at 25.0 px before the zoom, 31.2 px settled. Note: a pre-upgrade frames.json reused across this change could skip the new samples (frames key covers the runtime bundle, so reuse is unlikely).
Task 10: minor (deferred): M1 no rest frame when a reveal still runs at the camera beat; M2 rest frame can land inside the hero punch (+6% text); M3 reused frames.json may miss new samples; M4 empty-frame "fullest frame" test doesn't prove the rest frame is read; M5 test hard-codes the media region; M6 two stale comments.
Task 10: complete (commits 8938f24..e41c798, review clean)
Task 11: dispatched (BASE e41c798, implementer b2-impl-11)
Task 11: note: covi-video Method one-clause fixes reach model prompts; skills/covi/SKILL.md schema list also lacks `subject` (pre-existing).
Task 11: Ruling: Task 11's Important (SKILL.md:86 scene-id rule in a prompt-loaded Method section; "canvas"/"stop" undefined in the prompt at :76, :92) and its doc-accuracy minors (video.md:351 only pan/zoom travel; "after two to four steps"; video.md:383 scene's own evidenceIds; SKILL.md:51 redundancy and first-scene entrance; storytelling.md:8 hero default; visual-system.md:222 fade default; skills/covi schema list add `subject`) join B2's final fix wave — Task 11 is the last task; the final review runs now — none. architecture/skills/contributing mentions of direction → B7.
Task 11: complete (commits e41c798..8973b80; findings carried into the final fix wave)
Final review: ready after one fix wave. Ruling: the wave takes — [I] tests/redaction.test.ts:74-76 always-passing token check (put the token in a highlighted code scene's sync phrase so the draft's camera beat would carry it); label link check strips marks (NFKD, remove \p{M}) before link/scheme tests (`https:⵿//…`, `https:́//…` pass today) with security cases; raw bidi/invisible chars in packages/core/test/zod-issues.test.ts → \u escapes; duplicate-id message names the earlier scene by id and position; off-pinned render test writes an invalid video/direction.json first (proves off neither reads nor fails on it); frames.json layouts sorted by frame before writing (renderer.ts:331 collects in worker-finish order → breaks acceptance §17.4 determinism); Task 11's docs items; isCameraMove reads CAMERA_TRANSITIONS and viewAt documents its time order — before merge — none.
Final review: Ruling: deferred to B6 (canvas polish): camera M1 (zoom dip leads travel), M5 (overlapping beats stop dead), M6 (edge tests), the clip's hard top edge slicing the code card title during a beat zoom (feather the clip edge), header wait after a headerless title, grid snap after a drifting scene. Stat-before-open stays open-then-fstat (race-free). "--draft keeps an agent's direction" unreachable from the CLI (fresh run) — no test.
Final fix wave dispatched (FIX_BASE 8973b80, resumed b2-impl-11)
Final fix wave: Ruling (implementer): `--draft` CLI help says it also writes the direction; storytelling.md says to leave the hero's entrance to Covi; frame sort in the renderer (QC sees frame order too); label docs say combining marks are removed before link checks; item 1's test fails only when both redaction layers are removed (run.writeJson redacts on its own) — none.
Final fix wave: re-review clean (8 addressed; commits 8973b80..b57c1f5). Out-of-scope notes (SKILL.md:96 names pan/zoom in prompt-loaded text; video.md:351 last row; --draft help with --direction off) → B7 docs.
