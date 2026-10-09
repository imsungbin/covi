# SDD ledger — plan: /Users/seongbeenim/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-b1-density-checks.md

## Pre-flight scan

Scanned 2026-10-09 against `density-checks` at aeef1fa. Code read only to confirm suspected conflicts. The example trees were extracted from the plan into a scratch directory and run there (base `# pass 4`, 70406/4/28/1; head `# pass 5`, 9907/1/10/0, matching the plan). The plan's float and frame arithmetic was checked in node.

### Task pairs (shared files or interfaces)

| Tasks | Produces → consumes | Finding |
|---|---|---|
| 1 → 2 | `TEXT_FLOOR {code:24, body:28}`; `settledSpan(Pick<'scenes'\|'transition'>, i): Span\|undefined` → `settledReports`; `density.test.ts` helpers `video`, `scene`, `code`, `callout`, `terminal` → Task 2 tests | OK. Task 2 "Consumes" lists `settledFrame`, but `density.ts` imports only `settledSpan` (harmless). |
| 1 → 3 | `density.test.ts` helpers, the `TransitionKind`/`SceneTransition` types | OK |
| 2 → 3 | `density.ts` (`percent`, `DensityTimeline`, `TimelineScene` import, top comment), the `index.ts` export block, test helpers `story`, `report`, `band`, `at` | OK. Task 3 appends, replaces the comment and the export block, and adds the `storyScenes` import (`qc.ts` already imports `timeline/build.ts`, so there is no new cycle; `density.ts` imports `QcCheck` as a type only). |
| 1 → 4 | `codeFont(fit px, orientation, unit px)`, `cardHeight(region, width, content)`, `CARD_FILL`, `LayoutItem.font/text`, `settledFrame(Timeline, i)` → the `settled` helper | OK. Units agree: `fit` and the result are px, and `ctx.regions.unit` exists. |
| 1 → 5 | `cardHeight`, `CARD_FILL` (imported into `media.ts` by Task 4), `text: 'meta'` | OK |
| 3 → 4, 5 | `densityChecks` from `@covi/video` (exports point at `src/index.ts`); message `code at N px in sX` → regex `/code at \d+ px in s2/` | OK |
| 3, 4, 5, 7 | `tests/render/render.test.ts`: Task 3 edits the first test, Task 4 edits imports, `compose`, adds `settled` and 3 tests, Task 5 adds 1 test, Task 7 replaces the full-pipeline describe | OK, no overlapping hunks. `computeRegions`, `layoutChecks`, and `LayoutReport` are already imported. Task 4's `settled` helper is shadowed by locals named `settled` in two existing tests (:1027, :1091). Biome's recommended rules do not flag this; renaming the helper (for example `settledReport`) would avoid confusion. |
| 4 → 5 | `drawnFont`/`smallestFont` (`components/types.ts`); `media.ts` imports (Task 4 adds `drawnFont` and `../sizing.ts`, Task 5 adds `smallestFont`); `compose(…, undefined, { language })` | OK. Task 4 removes all 3 `clamp` uses (code, terminal, api). `cards.ts` keeps its own `clamp`. |
| 1 → existing render tests | `layoutSampleFrames` adds settled frames for story scenes only | OK. The outro report count stays 2 (render.test.ts:168, :273). `report.scene` is the earlier scene during an overlap, and settled frames fall after the previous scene ends. |
| 3 → existing tests | `runQc` adds 4 warn-only checks | Tests that filter only `fail` are OK. Two full-pipeline tests assert that every check except `still` passes: :1373 (timing grammar) and :1706 (`renders a storyboard that uses every component and sound field`). Task 8 Step 4 covers only the first. By arithmetic both pass (no repeated kinds; at most 2/6 push; code 33–34 units; caption 28; a 3-node diagram fills 60%), but the guidance should name both. |
| 6 → 7 | the example name, `--standard`, `materializeExample` (trusts `demo.commands`, examples.ts:100), `runDir` in `--json` | OK |
| 6, 8 | docs: Task 6 edits README, getting-started, and contributing; Task 8 edits video.md, SKILL.md, and CHANGELOG | No overlap. Task 6 misses README.md:91 ("Five example changes"). |
| 2, 3, 4, 5 → 8 | thresholds, the exempt kinds, and what each message names | OK. The skill's 54/108 characters and 24/14 lines check out against the code formulas (`typical+7`, box 936/1728 units, `(h-90)/(n·1.55+1.2)`). |

### Each task against itself

| Task | Tests vs. code; files created vs. touched | Finding |
|---|---|---|
| 1 | `settledAt(code,4)=0.535`, `callout=0.6`, `terminal(2.5)=2.25`. Frames: s1 17, s2 123, s3 258, the short scene's s2 166; the outro's 317 is not in the 35%/70% set. `8+0.6===8.6` and `10-0.45===9.55`. `Pick` types fit; `cues.ts` may import `type Timeline` (the runtime tsconfig includes it). | OK |
| 2 | Media rect at 1080p is (96, 206, 1728, 662); 4K unit 2; 360×640 unit 1/3. `band(180)` gives 27%, `band(400)` 60%. Frame 90 lies in s1's span [0.535, 3.5]. The `findings`/`summary`/`screenshot` shapes match `TimelineVisual`, and `certainty: 'risk'` is valid. | **Defect: `union()` in `density.ts` is a verbatim copy of `union` exported by `runtime/narrator.ts` (DOM-free).** Also `SIZE_TOLERANCE = 0.5`: code at 23.5 to 24 units passes, which departs from the Global Constraint "code < 24 warns". It is recorded in no ruling and pinned by no test. |
| 3 | The en dash in the message and in the regex is the same character (U+2013). 3/5 fade = 60% passes, 3/4 = 75% warns. A missing kind counts as fade. The outro is excluded through `storyScenes`. | OK |
| 4 | Two-line block: typical = max(28, 21) = 28. In 9:16, 52.5 units clamps to 48; in 16:9, 98.8 clamps to 44. Card share is 0.6 (>0.59). The 79-character line gives typical 70, about 21 units (between 12.5 and 24), so the check warns. Terminal: 48 units in both windows. API: request 30 units (26 in 16:9) plus one panel at 48, 2 items. The strings the plan replaces exist. `el('pre')` returns `HTMLPreElement`. | OK at the end. Transient: Step 5 drops `clamp` from the import while Steps 6–7 still use it, so the file does not compile between steps. Move the import edit to Step 7. |
| 5 | Body items: heading, callout, finding, 3 nodes, 2 areas, summary = 9. All are ≥ 28 units in 9:16 (heading `fitText` min 28, headline min 28). Fills: callout, findings, and diagram 60%; change map 56%. `title`, `headline`, and `points` exist; `vertical` is not redeclared in `changeMap`; `box-sizing: border-box` holds. The stage heading's `font` is measured once at mount; the header is in screen space, so no camera scale is lost. | OK |
| 6 | Ran both trees: the numbers and pass counts match. YAML parses, and `ExampleSchema` is strict-compatible. Sort order puts it second. Biome ignores base/head; `.covi/config.yml` is not gitignored. | README.md:91 is stale. Step 6 sets `EX` in one command and runs `rm -rf "$EX"` later in a separate shell, which leaks the temp directory. Step 10 skips `biome check --write` (Global Constraint; trivial). |
| 7 | The result type has `runDir`. The describe is at :1150–1170, not :1153–1172 (trivial). | Step 1 sets `RENDER=$(mktemp -d)`, then runs `covi video` as a separate background command, and Steps 1 and 5 read `$RENDER` again. Shell state does not persist between calls, so this becomes `--repo /repo`, `> /video.json`, and `rm -rf ""`. Use a fixed scratch path or one compound command. |
| 8 | Targets exist (video.md:639/650; SKILL.md:58, 88, 94; CHANGELOG `## [Unreleased]` at :8). No snapshot contains skill text. | Step 4 omits the :1706 strict test (see above). Step 5 runs no `biome`/lint right before its commit; Step 4's `npm run check` covers that. |

### Global Constraints and spec

- Every commit carries the session trailer and no Claude authorship. No `version` field changes. No catalog keys. QC messages are English. All four checks warn. Dependency direction is unchanged: `density.ts` imports `runtime/{layout,sizing}.ts` like `qc.ts` does.
- Spec §8 deviations are recorded as rulings: the fallback to 13 below the "from 24 px" range, and `empty-frame` limited to card kinds. `SIZE_TOLERANCE` is not recorded (see Task 2).

## Pre-flight rulings
- PF-1 (Task 2): Ruling: `density.ts` imports `union` from `./runtime/narrator.ts` instead of copying it — verbatim duplication is a defect; narrator.ts has no DOM code — none.
- PF-2 (Task 2): Ruling: `SIZE_TOLERANCE` is 0.1 unit (measurement rounding of drawn boxes), not 0.5; tests: 23.8 warns, 23.95 passes — the constraint says code under 24 warns — a sub-pixel box rounding could flicker a warning.
- PF-3 (Task 4): Ruling: the `clamp` import removal moves to Step 7 so every step compiles — none.
- PF-4 (Tasks 6, 7): Ruling: shell steps use fixed scratch paths (e.g. `/tmp/covi-b1-render/`) or one compound command; no shell variables across commands — variables do not persist between commands — none.
- PF-5 (Task 8): Ruling: Step 4 names both full-pipeline tests that require every check but `still` to pass (timing grammar, and "every component and sound field") — none.
- PF-6 (Task 6): Ruling: README.md's "Five example changes" becomes six in Task 6 — none.
- PF-7 (Task 4): Ruling: the new test helper is named `settledReport` — avoids shadowing local `settled` variables — none.
Task 1: dispatched (BASE aeef1fa, implementer b1-impl-1)
Task 1: minor (deferred): settledSpan/settledFrame can start before the scene only for hand-built timelines (scene shorter than entrance+exit+1 frame); clamp or document.
Task 1: minor (deferred): transition-length default `scene.transition?.seconds ?? timeline.transition` repeated in 4 places.
Task 1: complete (commits aeef1fa..cef2735, review clean)
Task 2: dispatched (BASE cef2735, implementer b1-impl-2)
Task 2: Ruling: density checks read only frames inside the settled span, or exactly the frame settledFrame picks (short scenes) — the brief's "frame just before settling" counted entering text and, with the 0.1 tolerance, warned falsely — a scene whose only sample is mid-entrance goes unmeasured.
Task 2: Ruling: size warnings print sizes to a tenth (23.8 px) — whole-pixel rounding would claim text at its floor is too small — none.
Task 2: minor (deferred): 4 more minors in task-2-review.md.
Task 2: Ruling: the empty-frame share rounding minor (density.ts:39/:152 prints "(40%); at least 40% wanted" for 39.5–39.9%) is fixed in Task 3, which edits density.ts anyway: print the share to a tenth — same contradiction as the size ruling — none.
Task 2: complete (commits cef2735..4d70ac6, review clean)
Task 3: dispatched (BASE 4d70ac6, implementer b1-impl-3)
Task 3: Ruling (implementer): empty-frame share floored to a tenth (39.97% → 39.9%) — nearest rounding still prints 40% — none.
Task 3: Ruling: the review's Important finding (full-pipeline "every timing field" render test fails at 665667f because empty-frame warns on its 3-line code card, 25.4%) is plan sequencing, not a Task 3 defect: 665667f stays red on that test until Task 4; Task 4 must run `COVI_TEST_RENDER=1 npx vitest run tests/render/render.test.ts -t "renders a storyboard that uses every"` (background) and both strict tests must pass before it reports — Task 4 is the task that makes code cards fill the frame — if Task 4 cannot reach 40% for a 3-line card, it must report it.
Task 3: minor (deferred): monotony tests miss a run at the story's end and multiple runs; monotony message rebuilds `listed` helper with another separator; report's "hundreds of scenes" claim is 43.
Task 3: complete (commits 4d70ac6..665667f, 0 parked; Important finding ruled as sequencing)
Task 4: dispatched (BASE 665667f, implementer b1-impl-4)
Task 4: Ruling: review minors M2 (drawnFont divides by integer offsetWidth → up to 0.5 px/width low → false text-size warnings at the 28 floor in Task 5) and M3 (smallestFont([]) = Infinity → frames.json null → read back warns "at 0 px" on frames reuse) are load-bearing (Task 5 body text sits at the floor; sound-only re-renders read frames.json) and join fix round 1 with the Important finding and M1 — cross-task context the reviewer lacked — a slightly larger fix round.
Task 4: minor (deferred): M4 side-by-side 16:9 terminal windows can differ in height when one output is long.
Task 4: fix round 1/5 dispatched (I-1 weak terminal/API sizing test; M1 regex; M2 offsetWidth; M3 Infinity; FIX_BASE 662e3f3)
Task 4: Ruling (implementer): drawnFont browser test lives in packages/video/test/drawn-font.test.ts gated on canUseBrowser — in tests/ it would pull DOM-typed runtime code into the root typecheck — none.
Task 4: Ruling (implementer): drawnFont returns the set size for a node with no layout box — a hidden node never reads as 0 px — none.
Task 4: fix round 1/5 (4 addressed, 0 open; commits 662e3f3..e5f5bc8)
Task 4: minor (deferred, pre-existing): packages/*/test is outside every tsc project, so new test files are not type-checked.
Task 4: complete (commits 665667f..e5f5bc8, review clean)
Task 5: dispatched (BASE e5f5bc8, implementer b1-impl-5)
Task 5: Ruling: a one-area change map (27–30%) and a 4-node 1:1 diagram (30.9%) stay under the 40% empty-frame line and warn — the plan capped change-map rows at 2× and diagram nodes at their width; the check only warns (R-007) — such videos carry an empty-frame warning until direction (B2+) lays them out.
Task 5: Ruling: review minors M1 (`justify-content: center` hides half an overflow from QC → use `safe center`), M2 (`>= 9` where exactly 9 expected), and M3 (`.nlabel { word-break: break-word }` overrides Korean keep-all → Korean labels break mid-word) join fix round 1 — QC accuracy and the Korean acceptance render depend on them; all are one-line fixes — none.
Task 5: minor (deferred): M4 change-map names nowrap+ellipsis cut sooner at larger sizes; QC never sees it.
Task 5: fix round 1/5 dispatched (I-1 test only at 9:16; M1; M2; M3; FIX_BASE 843e4e0)
Task 5: fix round 1/5 (4 addressed, 0 open; commits 843e4e0..27fe078)
Task 5: minor (deferred): `safe` in `safe center` unpinned (no overflowing card in test); heading fitText floor (stage.ts:242) unpinned; 1:1 not run; two unbraced nested `for` statements wrap ~170 lines.
Task 5: complete (commits e5f5bc8..27fe078, review clean)
Task 6: dispatched (BASE 27fe078, implementer b1-impl-6)
Task 6: Ruling (implementer): README 'Five example changes' → six, wording per README style (PF-6) — none.
Task 6: Ruling: review minors M2 (head reader's staleness check compares byte length but says "changed") and M3 (no Covi test pins the four benchmark numbers; B2–B7/A2 rely on them) join fix round 1 — the benchmark is load-bearing for every later PR — none.
Task 6: minor (deferred): M1 README.md:91 parenthetical beyond PF-6.
Task 6: fix round 1/5 dispatched (I-1 head request test always passes; M2; M3; FIX_BASE f44732b)
Task 6: Ruling: add Task 6b (after Task 6): fix `rangeMap` in packages/core/src/understand/symbols.ts:311-323 so a symbol's range does not swallow the doc comment of the next symbol (benchmark narration wrongly says the change touches `chunk`); refresh affected baseline entries — "never claim more than the evidence shows", and the benchmark's default narration repeats it — touches core; other examples' baselines may shift.
Task 6: Ruling (implementer): M2 fixed by wording ('changed size'), not a content hash — a hash would change every ref and the pinned 9907 request bytes — none.
Task 6: fix round 1/5 (3 addressed, 0 open; commits f44732b..41e1dd1)
Task 6: complete (commits 27fe078..41e1dd1, review clean)
Task 6b: dispatched (BASE 41e1dd1, implementer b1-impl-6b; brief task-6b-brief.md written by controller)
Task 6b: Ruling (implementer): a comment belongs to the next declaration only when it touches it (no blank line); a comment indented deeper than the declaration stays with the body above; routes follow the same rule; decorators/attributes out of scope — conservative, minimal — a blank line between a doc comment and its function keeps the old attribution.
Task 6b: note (pre-existing, untouched): a top-level route after a file's last declaration falls inside that declaration's range.
Task 6b: Ruling: blank lines between declarations belong to neither symbol (the brief's "(and blank lines)" was the controller's error) — giving them to the documented symbol makes inserting/deleting a function above a documented one report the documented one as modified — none.
Task 6b: minor (deferred): file-start header touching the first declaration counts toward it; JSDoc with interior `*/` falls back to old behavior; no tests for file start or CSS/Go/Ruby comment styles; one doc comment reads backwards.
Task 6b: fix round 1/5 dispatched (I-1 blank lines; FIX_BASE 6a846ef)
Task 6b: Ruling (implementer): `gap` applies to every symbol, not only documented ones — else a blank-first hunk inserting an undocumented x still reports a:modified — in comment-free files a hunk changing only blank lines no longer marks the function above.
Task 6b: fix round 1/5 (1 addressed, 0 open; commits 6a846ef..6e4a23f)
Task 6b: minor (deferred): symbols.ts:12 `gap` doc doesn't say it is set for undocumented symbols; no test pins that a blank-only hunk between two functions names neither.
Task 6b: complete (commits 41e1dd1..6e4a23f, review clean)
Task 7: dispatched (BASE 6e4a23f, implementer b1-impl-7)
Task 7: note for B2/B6: s1's opening shows only the Before window (~30% of the media region) for 3.9 s — `still` warns; empty-frame reads only settled frames; the poster (1.6 s) comes from that phase and is half empty → B6 plans a deterministic poster choice (sent to planner-b6).
Task 7: minor (deferred): render.test.ts:1500 comment omits transition variety; unused `seconds` in result type (pre-existing); assertion checks presence only (text-fits/captions-clear not pinned to pass on the benchmark).
Task 7: complete (commits 6e4a23f..222d0d4, review clean)
Task 8: dispatched (BASE 222d0d4, implementer b1-impl-8)
Task 8: Ruling: the `### Fixed` CHANGELOG line for Task 6b stays (accurate; a user-visible fix belongs in the changelog) — none.
Task 8: Ruling: Task 8's Important finding (SKILL.md:59 says "40% of the frame"; the check divides by the media region, ≈ 22%/19% of the frame; contradicts docs/video.md:641) and its minors on doc accuracy (monotony row wording and code≠terminal kinds; Added line drops "with four or more"; Fixed line omits the blank-line half; `text-size` row wording; exempt list omits mark glosses/step labels) join the final review's single fix wave instead of a separate task fix round — Task 8 is the last task, its diff is docs only, and the final review runs on the same branch now — none.
Task 8: complete (commits 222d0d4..5d4b443; findings carried into the final fix wave)
Final review: Needs fixes — [I] README.md:91 quotes Covi's rendered explanation of its first commit; PF-6 edited quoted output. Ruling: PF-6 withdrawn; restore the line exactly as at aeef1fa — the README quotes text Covi produced — none.
Final review: Ruling: CHANGELOG keeps ONE line per PR (owner's words), under its dominant type (`### Added`); the Task 6b fix is mentioned inside that line, and the `### Fixed` line is removed — overrides the Task 8 ruling — a reader scanning only Fixed misses it.
Final review: deferred to B2: duplicated transition-length default; extra monotony tests; camera effect on fill share; benchmark code at 25.0 px means canvas zoom-out below ≈ 0.96 makes text-size warn. Deferred to B4/B5: terminal window heights; API before/after panels sized separately (media.ts:792).
Final fix wave dispatched (FIX_BASE 5d4b443, resumed b1-impl-8)
Final fix wave: re-review clean (4 addressed; commits 5d4b443..7321ca0).
Final: parked minors — CHANGELOG.md:10 says "drafted explanations" without "narration"; SKILL.md:90 omits "(with four or more)" — Ruling: cosmetic, fixed opportunistically in B2's docs task — none.
