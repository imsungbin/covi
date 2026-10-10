# SDD ledger — plan: /Users/seongbeenim/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b3-code-morph.md

Pre-flight scanned against B2 branch e41c798 (B2 Tasks 1–10; Task 11 docs and the final fix wave still to land).

## Pre-flight scan

Scanned 2026-10-10, read-only, against `direction-canvas` at e41c798 (B2 Tasks 1–10 committed; B2 Task 11 docs were being edited in the working tree, so the doc anchors below come from that working copy). Read: the B3 plan, rulings R-001…R-031, the B2 ledger's rulings, and every B2 file the plan edits or calls. Nothing was run (one TypeScript probe in a scratch dir confirmed `d?.x.f?.(own(d, t))` narrows `d`).

### 1. Targets per task: plan vs B2 code

| Task | Plan target | B2 code (e41c798) | Corrected target / action |
|---|---|---|---|
| 1 | `runtime/highlight.ts` `KEYWORDS`, `family`, the `kw`/`comment` block of `highlightLine` | Unchanged from 0.2.0 (224 lines; table + `family` at :7–152); keyword lists identical to the plan's copy | as written |
| 1 | `timeline/types.ts` after `export type CameraMove = 'zoom' \| 'pan' \| 'follow';` | :46 | as written |
| 1 | `DIRECTION_LIMITS` after `evidencePerElement: 4,` | last key; no test iterates the keys | as written |
| 1 | `runtime/syntax.ts` imported by Node `direction/tokens.ts` | root tsconfig excludes `packages/video/src/runtime/**` from `include`, but imported files are still compiled (as `layout.ts`/`sizing.ts` are); runtime tsconfig includes `./**/*.ts` | as written (keep syntax.ts DOM-free) |
| 1 | `tokens.test.ts` | Node test, root typecheck | as written |
| 2 | `DirectionElement` before the `node` member; `DirectionBeat` camera member | match | as written |
| 2 | `cues.ts` before `shotSettledAt`; after `const at = revealedAt(e.id);`; doc phrase "(the storyboard visual on the scene's phases, the others from their reveal), and every beat has ended." | match (:693–709); `Span` exported at :25 | as written |
| 2 | `density.ts` `LOOKS_LIKE` after `capture: 'screenshot',` | match (:189–195, `satisfies Record<Exclude<DirectionElement['kind'],'visual'>, …>` forces it) | as written |
| 2 | `components/types.ts` after `target?(clock)` | match (followed by `laidOut?`) | as written |
| 2 | `elements.ts` Step 7.2: the `return { element, layer, …draw(element, sub, drawVisual) }` line | match verbatim | as written (span from the element's own beat) |
| 2 | Step 7.3: after `const visual = drawn.find(…)?.component;` add `own`; change the clock `{ ...clock, t: clock.t - d.reveal.t, open: true }` | B2: `const shown = drawn.find(…)` / `const visual = shown?.component;` (:79–80); `update` already calls `d.component.update(elementClock(d, clock))` (:94), which shifts t, duration, and p together | Do not add `own` or touch `update`. Factor B2's shift into one helper (e.g. `elementTime(d, t)`, used by `elementClock`) and use it for the span shift, `target`, and Task 4's `track` |
| 2 | Step 7.4: replace `target: (clock) => visual?.target?.(clock),` | B2 (:101): `target: (clock) => shown?.reveal && clock.t <= shown.reveal.t ? undefined : visual?.target?.(clock)` | Keep B2's guard for the visual; the fallback skips elements not yet revealed (`d.reveal && clock.t <= d.reveal.t`) and components with `laidOut` (the shot's flag comes from the visual only), and passes `elementClock(d, clock)` |
| 2 | Step 7.5 `draw` 4th param, case after `capture` | match | as written |
| 2 | `styles.ts` after `.code .caret {…}` | :140; `c` is the theme | as written |
| 2 | `morph.ts` imports (`easeInCubic`, `easeInOutCubic`, `easeOutCubic`, `lerp`, `rise`, `seg`, `lerpRect`, `drawnFont`, `entered`, `rectOf`, `el`, `union`, `cardHeight`, `codeFont`, `MORPH_*`, `Span`); `theme.syntax[tone]`, `codeText`, `addText`, `delText` | all exist; `SyntaxColors` keys = `TokenTone`; colors are `#rrggbb` | as written, except the sizing block (see §3.4) |
| 2 | "stage mounts after `document.fonts.ready`, scenes displayed and untransformed" | match (`mount()` :245–363) | — |
| 2 | `tests/render/morph.test.ts` | `@covi/video` exports `buildTimeline`, `layoutScenes`, `pacingFor`, `resolveVideoSpec`, `StoryboardSchema`, `writeComposition`, and `export type *` from `timeline/types.ts`; `canUseBrowser`; selectors `[data-scene] > .stop-view > .layer`, `[data-element]`; `layerTransform` format | as written |
| 2 | `direction-security.test.ts` render test: "elements `a`–`d`", append morph `e` at `slot(470)` | B2 has `a`–`e`: `e` is an output element (`{ ...slot(20, 600), y: 210 }`); `slot(470)` is `d` | Morph id `f`, its own rect, beat `{ verb: 'morph', element: 'f', … }`, query `[data-element="f"] .mlive [data-token]`. The file has 8 tests (Step 9 says 6) |
| 2 | `packages/video/test/morph-timeline.test.ts` | `packages/video/test/morph.test.ts` exists (line morph, in tsconfig.runtime.json); no clash | as written |
| 3 | `ShotElementSchema` after `capture`; `ShotBeatSchema` after `camera`; private `ElementIdSchema`/`EvidenceRefSchema`/`PhraseSchema` | match | as written |
| 3 | `layout.ts` `WEIGHT` after `capture: 3,` | match | as written |
| 3 | `refs.ts` imports, doc-comment end, beats loop after the "no element" check, `elementProblems` before `case 'capture':` | match (doc begins differently; only its end changes) | as written, but the "cannot find hunk" message echoes `element.evidence` raw → `shown(element.evidence)` as B2's `code` case does |
| 3 | `resolve.ts` import line; `BEAT_SECONDS`; Step 5.3 add `redact` to `Context` and `ctx` | import and `BEAT_SECONDS` match; `Context.redact` and `ctx.redact: input.redact` already exist | Skip Step 5.3 (a second member/property does not compile) |
| 3 | `resolveShot(shot, …)`, `element(e, rect, ctx)` (`tall`, `CODE_LINES`, before `case 'output':`), `timeBeats` final ternary | match; `moment(verb: keyof typeof BEAT_SECONDS, …)` picks up `morph` | as written; see §3.5 for the reveal wait |
| 3 | catalogs after `moreLines` in `video:` | all four under `video:` | as written |
| 3 | `direction-schema.test.ts` lists | exact match | as written |
| 3 | test setup: `buildEvidence({ diff })`, `directionSources({ files, evidence })`, `layoutScenes(…, 'en', pacingFor(spec))` | compatible (id + `hunkDigest` keys computed from the same hunk objects) | as written |
| 4 | `canvas.ts` `CameraStep`, the `view = lerpView(view, step.to, …)` statement in `viewAt` | match; `viewAt` is the only reader of `step.to` | as written; B2's final fix wave (Task 7 M4/M5: time-order doc, smooth hand-over of overlapping beats) may rewrite this loop → apply the function-`to` evaluation at `until` to whatever loop lands |
| 4 | `ShotComponent` after `frame(id)`; `mountShot`'s `frame(id) {…}` | match | `track` uses the shared element-time helper, not `own` |
| 4 | `stage.ts` `cameraSteps` after `if (!element) continue;`; `from`, `beatView(move, target, zoom, from, region, pivot)`, `m.shot`, `this.pivot` | match (:913–939) | as written |
| 4 | `canvas.test.ts` before 'pans and zooms between stops, continuous at both ends'; imports `easeInOutCubic`, `CameraStep`, `restView`, `viewAt`, `pivot` | match; file in tsconfig.runtime.json | as written |
| 5 | `defaultDirection`: replace doc + `const shots: Shot[] = …` with `input.scenes.map((scene, i) => morphShot(scene, i, input) ?? …)` | B2 builds `directed` (drops scenes whose id > `sceneIdChars`), `shots = directed.map(({ scene, id }) => …)`, then sets `shots[k].enter` by `directed`'s index; doc ends "reads back unchanged through `DirectionSchema`…" | `directed.map(({ scene, id }) => morphShot(scene, id, input) ?? { scene: id, elements: [{ id: 'visual', kind: 'visual' }], beats: cameraBeats(scene) })`; `morphShot` takes the id; keep B2's last doc sentence |
| 5 | `cameraBeats` → `highlightPhrase` + `cameraBeats` + `morphShot` | B2's `cameraBeats` trims the phrase (`sync[phase]!.trim()`) so `DirectionSchema.parse(plan)` equals `plan` | `highlightPhrase` returns the trimmed phrase (empty → undefined) for both callers |
| 5 | `plan.ts` add `sources: input.sources` | `PlanInput.sources` exists; pipeline builds sources from `diff.patch` (`diffFiles`) before `planDirection` | as written |
| 5 | `director.test.ts` import line, `scene(id, visual, extra)`, `callout` | match | as written; add `DirectionSchema.parse(plan)` equals `plan` for a morph draft |
| 5 | `examples.test.ts` 4-line replace block | B2's block has `expect(DirectionSchema.parse(plan)).toEqual(plan);` between the lines | Edit the two `defaultDirection(…)` calls in place, keep the parse assertion, append the benchmark morph check |
| 6 | `renderer.ts` after `const HERO_TILE = 0.1;`; forEach after the hero line | :132, :145–151 (uses `entranceSeconds`) | as written; `posterFrame` untouched |
| 6 | `frames.test.ts` before 'samples transitions of timelines written before they had kinds' | match | as written |
| 6 | `render.test.ts` loop "ends with `… toBeLessThanOrEqual(0.6);`" | ends with `toBeLessThanOrEqual(TRANSITION_SHARE)` (:1521–1524); `contactSheetFrames` imported :40; `example`, `timeline`, `story` in scope | locate by content |
| 6 | Step 5 shell: `RENDER=$(mktemp -d)` reused in later commands and Step 7 | B1 PF-4 / B2 PF-5: variables do not persist between commands | fixed path `/tmp/covi-b3-render/` (or one compound command) |
| 7 | `docs/video.md` Elements (`capture` (a `screenshot:` id);), Beats sentence, default-director opening, contact-sheet bullet | all present in B2's docs | as written; keep B2's "A camera beat toward a revealed element waits until it is in place."; add the two new refusals to the **Checks** bullet |
| 7 | `docs/visual-system.md` after **The canvas.**; `docs/security.md` **Content only from evidence.**; `docs/contributing.md:293`; SKILL.md **Review it yourself** | present | as written; security.md's `DIRECTION_LIMITS` list should gain the morph bounds |
| 7 | SKILL.md: append to B2's **Direction.** paragraph | :51 says "Covi's default direction, where every scene keeps its visual and gets an entrance" | rewrite that clause (small code hunks morph), then append |

### 2. Shared files and interfaces

| Pair / task | Shared | Verdict |
|---|---|---|
| T1 × T2 | `timeline/types.ts` (Morph types → morph element); `morphHunk` in T2's render test | consistent |
| T1 × T3 | `direction/schema.ts` (limits vs element/verb, separate sections); `morphHunk`/`morphProblem` | consistent |
| T1 × T5 | `morphProblem` | consistent |
| T2 × T3 | timeline morph element/beat produced by the resolver; `BEAT_SECONDS.morph` 1.6 = T2's `MORPH.seconds` | consistent; morph beats should wait for their element's reveal (§3.5) |
| T2 × T4 | `runtime/direction/elements.ts` (span shift, `target`, `track`); `Component.follow` → `ShotComponent.track` → `cameraSteps`; `tests/render/morph.test.ts` (T4 appends) | conflict: `own` targets code B2 replaced; one shared element-time helper for both tasks |
| T2 × T6 | none (the sheet reads beats) | — |
| T3 × T5 | director drafts must pass `directionProblems` and read back unchanged | conflict: untrimmed phrase; long-id scenes |
| T4 × T5 | `follow` with `zoom: CODE_ZOOM` | consistent |
| T5 × T6 | the benchmark must morph for T6's render assertion | consistent (needs the drafted code scene to show one hunk) |
| T2/T3/T4/T5 × T7 | docs describe the behavior | consistent after the T7 fixes above |
| T2 × B6 | B6 rewrites `shotSettledAt` into `shotMotion` and reads `MORPH_SETTLE` and the morph branch | consistent |
| T4 × B6 | B6 edits T4's test "follows the changed lines with the camera as they move, keeping them in the region" (`toBeCloseTo(1.25, 2)`) | keep the name and assertion literal |
| T6 × B6 | `renderer.ts`: B6 owns `posterFrame`/`layoutSampleFrames`; B3 edits `contactSheetFrames` only | consistent |
| T5 × B4/B5 | both plans assume `morphShot(scene, i, input) ?? …` | record the `directed`/`id` shape for their pre-flights |
| T1 self | 14 tests; API matches T3/T5 use | consistent |
| T2 self | id clash in the security test; test count 8 not 6 | fix as §1 |
| T3 self | duplicate `Context.redact` | skip Step 5.3 |
| T4 self | depends on T2's helper | consistent after T2 fix |
| T5 self | expectations hold once the phrase is trimmed | consistent after fix |
| T6 self | shell variables; poster wording | fix as §1, §3.11 |
| T7 self | depends on B2 Task 11's final wording | re-anchor after B2 Task 11 lands |

### 3. Defects and contradictions

1. T2 `target`: drops B2's reveal guard, so the narrator and the hero ring would point at a morph (or the visual) before its reveal; B2's 'points at the visual only once it is revealed' covers only the visual.
2. T2 `target` fallback takes the first element target whatever its coordinate space; the shot's `laidOut` comes from the visual only, so a laid-out element target (B4/B5 kinds) would go unmapped. Restrict the fallback to components without `laidOut`.
3. T2/T4 `own` duplicates `elementClock`'s shift (reviewers flag duplicated logic, A1 PF-6).
4. T2 `morph.ts` copies the code card's sizing block (typical line, font by width/height, `codeFont`, natural height, `cardHeight`, centered padding) verbatim from `media.ts` `code()`: extract one helper both use.
5. T3: B2 makes a camera beat toward a revealed element wait until it is in place (`aimed`); a morph beat pinned before its element's reveal ends plays partly unseen. Apply the same wait to morph beats (`inPlace.get(b.element)`), and say so in docs.
6. T3: the morph's "cannot find hunk" problem echoes the id raw (B2 escapes every echo with `shown`).
7. T5: dropping `directed` gives long-id scenes shots (schema-invalid drafts, B2 Task 4 ruling) and misaligns `enter`; dropping the trim breaks B2's "writes only what the direction schema reads back unchanged".
8. T2: element-id clash `e` in the security test.
9. T3: Step 5.3 duplicates B2's `redact` (does not compile).
10. T6: shell variables across commands (B1 PF-4, B2 PF-5).
11. Poster (R-026 → R-029, B6 owns it): B3 adds no poster code (good), but its ruling "the poster stays at 1.6 s", Task 6 Step 3's "The poster stays where it is (1.6 s in)", and Step 5's "The poster is the opening frame" should become "B3 does not touch poster selection; B6 chooses it". B6's poster never lands mid-morph (its candidates are settled moments).
12. T7: the skill's **Direction.** paragraph would still say every scene keeps its visual; video.md **Checks** and security.md's limits list omit the morph; the schema's `move` description ("follow: frame what it highlights.") should mention a morph's changed lines.
13. Global Constraints cite R-020 (B2's pre-flight) where R-022 applies, and omit R-024 (one CHANGELOG line, dominant subsection: the plan already complies), R-027 (no ruling ids in shipped files: the plan's code and docs already comply), and R-029.
14. Sequencing: B2's final fix wave (viewAt M4/M5; the "camera beat ≤ 0.1 s before an element is in place" minor in resolve's `aimed`; elements/stage test minors) may move T3/T4 anchors; re-check those hunks if HEAD moves past e41c798.

### 4. Fit with B2's stage conventions

| Convention | Fit |
|---|---|
| Clip (none at rest; header/caption bands during moves and beat zooms) | Fits. The morph clips only inside its `.code` panel (overflow hidden). A follow at 1.25× keeps the stop magnified, so the band clip stays closed for the rest of the scene, as B2's code zoom does; `report()` clips the panel to it. T4's render test reads unclipped rects, which is fine for what it asserts. |
| `laidOut` / `Frame.map` | Fits if the morph never sets `laidOut`: its `target` is measured as drawn (screen space, camera included) and the stage must not map it again; its `follow` returns stop-local layout pixels, the space `cameraSteps` uses for `element.rect` and mount-time `frame()`. Only the shot `target` fallback needs the `laidOut` filter (§3.2). |
| Settled spans, `shotSettledAt`, `restFrame` | Fits. The morph branch sits after `const at = revealedAt(e.id)`; `settledSpan` waits for the morph plus `MORPH_SETTLE`; `restFrame` (before the director's unpinned follow) reads the base code at scale 1, so `text-size` sees the morph unmagnified. |
| `CameraStep.to` as a function | Fits. `viewAt` is its only reader; the stage calls `viewAt` several times a frame (`stopView`, `magnified`/`closedInto`, a move landing on `stopView(move.to, move.end)`), and each evaluates `track` → `follow` → `focus`, which is arithmetic on numbers measured at mount (no DOM reads), so every call agrees and frames stay pure. Risk only from B2's final-wave edit of `viewAt` (§3.14). |
| Camera beats toward revealed elements start at the reveal's end | Kept for the follow beat (resolver `aimed`); morph beats need the same rule (§3.5). |
| Element clocks (reveal-shifted t/duration/p) | Fits once the span shift and `track` use B2's `elementClock` shift (§1 T2/T4). |

## Pre-flight rulings (all 13 scan findings accepted as suggested)
- PF-1 (T2/T4): no `own`; B2's `elementClock(d, clock)` shift factored into one helper used for the span, `target`, and T4's `track`.
- PF-2 (T2): keep B2's reveal guard in `target`; the fallback skips unrevealed elements and `laidOut` components and passes `elementClock`.
- PF-3 (T2): the security test's morph element is `f` with its own rect (e is an output, slot(470) is d's); the file has 8 tests.
- PF-4 (T2): morph.ts shares the code card's sizing through one helper extracted from media.ts `code()` — no verbatim copy.
- PF-5 (T3): skip adding `Context.redact`/`ctx.redact` (they exist).
- PF-6 (T3): "cannot find hunk" message echoes the id through `shown()`; morph beats wait for their element's reveal like camera beats (`aimed`).
- PF-7 (T5): shots built from `directed`: `directed.map(({scene, id}) => morphShot(scene, id, input) ?? …)`; keep B2's last doc sentence. B4/B5 pre-flights must use this signature (not `morphShot(scene, i, input)`).
- PF-8 (T5): `highlightPhrase` trims (empty → no phrase); add a `DirectionSchema.parse(plan)` equality check for a morph draft.
- PF-9 (T5): edit the two `defaultDirection` calls in examples.test in place; keep its `DirectionSchema.parse(plan)` line.
- PF-10 (T4): evaluate a function `to` at `until` in whatever `viewAt` loop exists after B2's final fix wave; keep the follow test's name and its literal 1.25 assertion (B6 edits it).
- PF-11 (T6): fixed scratch path `/tmp/covi-b3-render/`; no poster code and no "poster stays at 1.6 s"/"poster is the opening frame" text — B6 owns the poster (R-029).
- PF-12 (T7): rewrite SKILL.md's **Direction.** paragraph (not append); add morph refusals to video.md **Checks** and morph limits to security.md; re-check anchors against B2's merged docs.
- PF-13 (global): the plan's Global Constraints cite R-022 (not R-020) and include R-024, R-027, R-029.
Base: main 67626a3 (B2 merged; B2's final wave touched schema label checks, renderer frame sort, isCameraMove, docs — viewAt unchanged).
Task 1: dispatched (BASE 67626a3, implementer b3-impl-1)
Task 1: Ruling (implementer): morphProblem also refuses a hunk whose changes cannot all show on a 14-row card (rows = changedLines + 2) — else ≥ 8 one-line changes 6 lines apart passed and some changes hid behind markers — additive, no message changed.
Task 1: Ruling (controller): add Task 1b — fix the code card highlighter dropping characters (`10n` → `n`, `1e5` → `e5`, and any other lost characters): every drawn code token must be the evidence's text; tests assert highlighted text equals the source line for a corpus of tricky tokens in each supported language — drawing code that is not in the diff violates the evidence rule — highlight colors may change for numeric literals.
Task 1: Ruling: Task 1's minors M1 (keptLines retry loop can never keep anything new; single pass; fix its comment), M3 (one helper for "tabs as two spaces, cut at the line limit" used by tokens.ts, resolve.ts:227, draft.ts:504 — no hard-coded 96), M5 (`spread(3)` on a 14-row card shows only markers and no code on the base side — fix or refuse), and M6 (number/word patterns live in syntax.ts so the morph and the code card agree) join Task 1b — same files — none.
Task 1: note for Task 3: redact each hunk line whole before morphHunk (it cuts at 96 internally).
Task 1: complete (commits 67626a3..47772f5, review clean)
Task 1b: dispatched (BASE 47772f5, implementer b3-impl-1b)
Task 1b: root cause: highlight.ts:17-20 token regex did not match every character and matchAll skips unmatched text — 11,611 of 22,407 language×line pairs lost characters (digits joined to letters: 10n, 1e5, 0x1F, 5px; unclosed quotes). Fixed with one shared lexer (whole-number pattern, match-anything last group).
Task 1b: Ruling (implementer): string pattern and lexer shared too; a dot followed by digits starts a number under a stated rule; storyboard/draft.ts imports direction/schema.ts for the shared cut; the cut never splits an emoji; M5 refuses such hunks instead of changing elision — none.
Task 1b: minor (deferred → B3 final wave): fallback-c lines colour a URL tail (`//github.com/…`) as a comment — add `(?<!:)` before `//`; storyboard code lines (agent-authored) are uncut, so the old string/comment patterns stay reachable at 440 ms for a 40k-char line (pre-existing; consider bounding storyboard code line length or cutting before highlighting); 4 more in task-1b-review.md.
Task 1b: complete (commits 47772f5..a853388, review clean)
Task 2: dispatched (BASE a853388, implementer b3-impl-2)
Task 2: Ruling (implementer): clockStart/elementTime/elementClock replace `own` (T4's track returns follow(elementTime(d, t))); codeCard() moved to sizing.ts (A/B identical on 12 cases); rows stack without gaps mid-morph and text clips 1em before the card edge (the plan's paths left gaps/overlaps, seen in frames); in shots without a visual the narrator points at a code element's highlighted lines — none.
Task 2: note: codeCard has no unit test of its own; long lines get no ellipsis.
Task 2: Ruling: review minors join fix round 1 — line numbers at the code card's 0.8 opacity; the box the camera/narrator follow is clamped to the visible text (Task 4 depends on it); the "reported as code" test asserts the floor-aware size, not > 0 — cheap — none. Replaced-line cross-fade stays (plan's overlapping phases, magic-move style).
Task 2: note for B4/B5 pre-flights: morph CSS adds `.mrows` (and `.mnum`/`.mbar` under `.code.tokens`); metric CSS must stay scoped under `.mcard`.
Task 2: fix round 1/5 dispatched (I-1 ellipsis on cut lines; FIX_BASE 654b1fb)
Task 2: note: new DOM classes .mrows and .mcut (for B4/B5 pre-flights); a sliver of a sliding token can show beside the ellipsis mid-morph (settled frames clean).
Task 2: fix round 1/5 (4 addressed, 0 open; commits 654b1fb..515786c)
Task 2: note for Task 4: test that a long changed line's followed box stays within the visible column (the clamp has no test yet). Minor (deferred): sliver beside "…" mid-morph; with CJK glyphs the cut can fall mid-glyph.
Task 2: complete (commits a853388..515786c, review clean)
Task 3: dispatched (BASE 515786c, implementer b3-impl-3)
Task 3: Ruling (implementer): test helper uses `kind: 'morph' as const`; once-per-element check skipped when the target is missing (no false 'already morphs'); a Map of element kind replaces the ids Set; a waiting morph beat keeps its own 1.6 s — none.
Task 3: minor (deferred → B3 final wave): schema descriptions should say a morph without a beat still morphs and waits for its element's reveal; "on its phrase" test doesn't assert t; no test pins redaction before the 96-char cut; wrong-kind evidence message unasserted; two small duplications. Note for Task 6: check a ko/ja/zh elided marker renders with the CJK font slices.
Task 3: complete (commits 515786c..250adcd, review clean)
Task 4: dispatched (BASE 250adcd, implementer b3-impl-4)
Task 4: Ruling: an unzoomed follow holds one scale for the whole follow — `beat.zoom`, else the scale fitted to the union of track(id, beat.t) and track(id, scene end) — only the position tracks per frame (overrides the plan's per-frame refit, which whipped 2.5→2.17 in one frame) — none. Minors join the round: the camera must not stop dead when the box outgrows the view (ease the clamp); a test of follow on a morph revealed later; comment on the `?? track` fallback.
Task 4: fix round 1/5 dispatched (FIX_BASE 62f5e49)
Task 4: Ruling (implementer): EASE_IN = 1/4 of the view for the centring/start switch and the region clamp (follow steps only); a box 91–100% of the view loses up to 1/16 of the view at its end; static beats unchanged — none.
Task 4: fix round 1/5 (4 addressed, 0 open; commits 62f5e49..016caff)
Task 4: minor (deferred): `follower` is a third copy of the clamp math (valid because pivot = region centre; document it); no test of a pan after an unzoomed follow; fallback comment wording; hand-off from a moving follow drops speed to 0 at next.t (pinned by the brief's test) → B6 camera polish.
Task 4: complete (commits 250adcd..016caff, review clean)
Task 5: dispatched (BASE 016caff, implementer b3-impl-5)
Task 5: Ruling (implementer): a code scene showing only context lines keeps its visual (else it would morph the nearest hunk or repeat the previous scene) — none.
Task 5: Ruling (controller): the director morphs only a hunk whose changed lines the scene's visual actually shows (overlap required); no nearest-hunk fallback (`hunksAt`) for morphs — morphing code the scene did not show could contradict its narration — such scenes keep their visual.
Task 5: fix round 1/5 dispatched (I-1 morph only a hunk the scene shows: match shown add/del lines by newLine/oldLine against each hunk of hunksOf(evidence, path), exactly one match; tests for no-overlap, no numbers, deleted-only shifted line, far context line; FIX_BASE 317ca8a)
Task 5: fix round 1/5 (1 I + 2 minors addressed, 0 open; commits 317ca8a..795d617)
Task 5: minor (deferred): director.ts:103-111 three nested closures → named helper. Note for Task 7: document the del-old/add-new line-number convention for storyboard code lines (schema description and covi-video skill).
Task 5: complete (commits 016caff..795d617, review clean)
Task 6: dispatched (BASE 795d617, implementer b3-impl-6)
Task 6: controller viewed f521.png: the morph midpoint reads as code changing (lines 23–28 sliding open, tokens crossing on 21/22, numbers cross-fading); the card header row is under the protected band during the 1.25× follow (noted for B6 polish).
Task 6: minor (deferred): MORPH_TILE fraction vs HERO_TILE seconds; fixture beats name `m` with no elements; no test for two morphs in a scene / coinciding midpoint / last-frame clamp; render assertion checks the frame list, not the jpg. Note for Task 7: docs listing the sheet's tiles (docs/video.md:664, docs/contributing.md:293, skills/covi-video/SKILL.md:53) must add the morph midpoint tile.
Task 6: complete (commits 795d617..80eec59, review clean)
Task 7: dispatched (BASE 80eec59, implementer b3-impl-7)
Task 7: Ruling (implementer): docs corrected to merged behavior (follow holds one scale; one-hunk overlap rule; card-fit refusals); line-number convention documented in the storyboard `number` description, video.md director bullet, and the agent-only Direction paragraph — none.
Task 7: Ruling: Task 7's Important (schema `follow` description should mention a morph's changed lines; morph element/beat descriptions should note the implicit beat and the reveal wait) and its minors (docs/video.md:276 storyboard `number` convention; visual-system.md pointer between token and line morph; follow bounds wording) join the B3 final fix wave; the skill steering away from `mode: "morph"` is B7's — Task 7 is the last task — none. global-constraints.md updated per PF-13.
Task 7: complete (commits 80eec59..0f8123c; findings carried into the final fix wave)
Final review: ready after one wave. Ruling: the wave takes the schema description Important (follow on a morph; implicit beat; reveal wait), syntax.ts:167 `(?<!:)` before `\/\/` (URL tails coloured as comments in every Markdown/plain code card), a test that redaction happens before the 96-char cut, the "morphs on its phrase" test asserting pinned and spaced `t`, Task 7 doc minors (video.md:276 `number`, visual-system.md token/line morph pointer, follow bounds wording), raw invisible chars in highlight.test.ts → \u escapes, and the two colour minors (kept tokens take the new code's colour after the morph, morph.ts:325; CSS lines starting with `*` not comments in a morph, tokens.ts:37) — before merge — none.
Final review: determinism: frames.json/timeline.json/qc.json/music.wav identical across 5 renders; the mp4 video stream differed in 2 frames of one render (Chromium flake, s1 terminal fade) — acceptance requires frames.json + music.wav only.
Final fix wave dispatched (FIX_BASE 0f8123c, resumed b3-impl-7)
Final fix wave: Ruling (implementer): in CSS only a line starting `/*` reads as a comment (continuation ` * text` colours as code); a recoloured kept token switches class at the morph's end and eases colour over the 0.5 s settle — none.
Final fix wave: re-review clean (7 addressed; commits 0f8123c..96064ba). Parked minors: file:/// and host//path partly comment-coloured; case 1://x trade-off; test repeats narration literal; Markdown * bullets read as comments in a morph.
