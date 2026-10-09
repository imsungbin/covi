# SDD ledger — plan: /Users/seongbeenim/projects/covi-0.3.0-program/docs/superpowers/plans/2026-10-09-a1-broadcast-mix.md

## Pre-flight scan

Read-only scan of the plan against the spec (§12, §2, §14–§18), rulings R-004/R-007/R-011/R-017/R-018, and the code at aeef1fa (branch `broadcast-mix`). Numbers marked "computed" were worked out from the plan's own code; nothing was run against an implementation.

| # | Tasks | Shared file / interface | Produced → consumed | Finding |
|---|---|---|---|---|
| P1 | T1 → T5 | `loudness.ts` | `momentaryLoudness(ch, sr): Float64Array`, `largestJump(m, {exempt, within, floor}): Jump \| undefined`, `loudnessRange(ch, sr, span): number \| undefined`, `type Jump` → `mix.ts` imports and calls, all with matching signatures | OK |
| P2 | T1 → T5 → T6 → T7 | `Jump` through `MixLevels.musicJumps` | `Jump & { exempt: Array<[number, number]> }` → `roundLevels` (maxDb/at 2 dp, exempt 4 dp) → `soundChecks` reads `maxDb`, `at`, `exempt` | OK. QC gets the in-memory `sound.record` (pipeline.ts:542/569), not a schema-parsed file, so no fields are stripped |
| P3 | T1 ↔ T9 | `loudness.ts` | T1 inserts after `weightedLevel`; T9 edits the `AUDIBLE` comment below it | No overlap. But T9's "−36 → −31" leaves "halfway between" and "some 10 dB of margin either way" wrong (−45 against −31/−56 gives 14/11 dB); the same sentence is in docs/video.md:575 |
| P4 | T1, T3, T4, T5 | `packages/audio/src/index.ts` | Each task replaces its own export block (loudness, placement, mix) | OK. No current export is dropped (`mergeSpeech` and `Window` were never exported). T5's mix block keeps T4's `EFFECTS_UNDER_VOICE_DB` |
| P5 | T2 → T5 | `dsp/fx.ts` | `glueCompressor(buf, {sr})` in place, no makeup; `voiceCarve(buf, amount: Float32Array, {sr})` → `musicBus` / `placeMusic` | OK (`Biquad('bandpass', …)` is RBJ constant 0 dB peak; `DEFAULT_SR` and `TINY` exist) |
| P6 | T2, T4, T5 | `library.test.ts` | T2 adds imports and the glue-drop test; T4 changes `gainDb: -14` to `1`; T5 changes the engine test at :90 | OK: separate hunks, and each task's commit includes the file |
| P7 | T2 ↔ T8 | `GLUE.threshold` | T8 knob "lower toward −27 and record a ruling" → T2's `dsp.test.ts` pin (sine −5.5 dB: half of 11 dB over **−24**) and the theme drop bound (0.5–4 dB) | **CONFLICT.** Contradicts the Global Constraint and spec §12.1 (−24). `dsp.test.ts` is missing from T8's list of tests to re-pin, and a lower threshold can push the theme drop past the spec-pinned 4 dB |
| P8 | T3 → T4 | `BED_DB` | `PLACEMENT.continuous.speechDb` (−15) → `placeEffects` adds it; effects tests write `BED_DB + n` | OK. `gainDb: 1` reproduces 0.2.0's −14/−12/−18 |
| P9 | T3 → T5 | `placement.ts` | `placementLevels(lines, p, {duration, sampleRate}): Float64Array`, `duckAmount(levels, p): Float32Array`, `swellingPauses(lines, p): Array<[number, number]>`, `type Window`, `type Placement` → `placeMusic` and `placeWithoutJumps` | OK. Types match |
| P10 | T3 → T6 | `clearOfSpeech(t, speech, placement)` | Same signature, new meaning (level ≥ `gapDb`) → `sound.ts` passes `mixed.musicLines ?? input.speech` | OK. Side effect accepted by R-A1-3: under bookends `hero.clear` is true only in pauses ≥ 11.6 s, so `music-audible` warns more often (T8's bookends remix does not assert it) |
| P11 | T3 ↔ T8 | `PLACEMENT` table | T8 may move `speechDb`, `gapDb`, and `endsDb` together → `placement.test.ts` derived values (listed for re-pinning) | Tests OK. Spec §12.1 fixes −15/−8/−6; T8 requires a ruling only for the glue change, not for this one (minor) |
| P12 | T4 → T5 | `mix.ts`, `mix.test.ts` | T4 edits both (cap, `EFFECTS_UNDER_VOICE_DB`, `effectsCutDb`, "lowers every effect" test); T5 rewrites both | OK. T5's rewrite carries the cap block and the test verbatim. T4's `-t` filters name tests that exist ("only limits", "nothing to play", "deterministic") |
| P13 | T4 → T7 | `EFFECTS_UNDER_VOICE_DB` | Exported from `@covi/audio` in T4 → `qc.ts` `sound-effects` grading | OK |
| P14 | T4 ↔ T8 | `sound-effects.yml` `gainDb` | T8 may lower it → `effects.test.ts` (symbolic `BED_DB + 1`, unaffected) and the `library.test.ts` `toMatchObject` pin (listed) | OK |
| P15 | T5 → T6 | `MixInput.hero`, `MixResult.musicLines`, `MixLevels.{musicRangeLu, musicJumps, pausesHeld, effectsCutDb}` | → the `sound.ts` mix closure (`hero: music.hero?.downbeat`), `hero.clear`, `roundLevels` | OK. No `exactOptionalPropertyTypes`, so `hero: undefined` typechecks |
| P16 | T5 → T7 | `MUSIC_JUMP_DB` | → `music-jump` threshold | OK |
| P17 | T5 ↔ T8 | `JUMP_MARGIN_DB` | T8 knob "raise up to 1.0" → T5 test "swells in a long pause when the music is steady" (expects `pausesHeld` undefined, lift ≈ 7, maxDb ≤ 5.5) | **CONFLICT.** With a margin of 1.0 the guard holds at 5.0 dB, which is the most a placement ramp moves by construction (maxStepDb 5). The steady swell measures about 5.0–5.05 dB (computed), so it gets held, and every long pause in every video stays down. Cap the margin below `MUSIC_JUMP_DB − maxStepDb` minus the music's own movement (about ≤ 0.8) |
| P18 | T6 ↔ T7 | `AudioRecord.levels` (= `MixLevels`) | `audio.json` levels → the `sound-qc.test.ts` `record()` fixture shape (`musicJumps.exempt` as pairs, `pausesHeld`) | OK |
| P19 | T6 → T8 | `auto` → `continuous` | `resolveVideoSpec` → render test expects `placement: 'continuous'` and the new levels on `api-users-pagination --standard` | OK. The timeline does not depend on placement (build.ts keys breaths on the preset; pacing.test.ts "never depends on the music") |
| P20 | T7 → T8 | QC ids | `music-jump`, `music-range` → the check lists in `tests/render/sound.test.ts` | OK. No other test lists sound check ids. render.test.ts:1373/1706 require all checks except `still` to pass, which T9 notes |
| P21 | T6 ↔ T9 | the bookends wording | i18n `where.bookends` ("plays at the opening and the end…") → docs/video.md "Which questions are asked" text | OK. They match |
| P22 | T8 → T9 | tuned constants | T8's final `PLACEMENT`, `GLUE`, `JUMP_MARGIN_DB`, `gainDb` → numbers in the docs | OK. T9 names the derived values to recompute |
| P23 | T9 ↔ spec §12.2 | the skill | Spec: exempt windows "documented in the skill and `docs/video.md`" | **CONFLICT.** The 1 s / 1.5 s / 0.5 s bounds go only into docs/video.md; SKILL.md and music.md name the moments without the bounds. music.md:9 ("In a narrated standard review, what the viewer hears is mostly the breaths…") is left unchanged, and that file is methodology loaded into the score-composing model prompt (`storyboard/compose.ts` → `methodologyOf`) |
| T1 | T1 (self) | tests vs code | `sine`/`concat`/`SR` helpers exist; `stepEnergies`/`toLufs`/`LUFS_OFFSET` exist | OK. Computed: 2 s gives 17 windows; digital silence gives −∞; Tech 3342 signals give 10/5/20/15 LU; span test 15 LU; the 10 dB step lands at `at` 5.5; the 5 dB/s fade measures 5; the silence floor gives 50; undefined cases hold. Nit: `windowLoudness` repeats `integratedLoudness`'s 4-step block sum |
| T2 | T2 (self) | tests vs code | `tone`/`rmsOf`/`mulberry32`/`hashOf` exist in dsp.test.ts; `fitMusic`/`renderMusic`/`theme()` in library.test.ts; new imports don't duplicate existing ones | OK. Computed: −5.495 dB; carve −6.02 / −1.9 / −1.9 / −0.04 / −0.36 dB at 2k/1k/4k/150/8k. Defect a reviewer will flag: `glueCompressor` copies `compressor`'s soft-knee gain computer and attack/release smoothing verbatim (extract a `kneeReduction` helper) |
| T3 | T3 (self) | tests vs code | `rampSeconds(7, 1.2, 5)` = 1.97435 (`closeTo` 3 dp holds) | OK. Every pinned level recomputed (−10.5 at 1.4 s, −11.5 at 4.987 s, −37 at 4.6 s, −20 at 11 s, −25.5 at 17.75 s, duck 0.5). Minimum of step-bounded shapes keeps the bound; messy speech gives the same result as clean. Removed fields `elsewhereDb`/`minGap` are used only by the old placement.test.ts, which this task replaces |
| T4 | T4 (self) | tests vs code; file edits | edits to effects.ts, sound-effects.yml, mix.ts, index.ts | OK, one nit: the find strings for the header comments in effects.ts ("…they sit well under the voice, swells lower still,") and mix.ts ("and effects sit at fixed levels below the voice.") wrap across lines in the real files, so a literal Edit won't match. Old mix tests stay red until T5, as stated |
| T5 | T5 (self) | tests vs code | every imported symbol exists after T1–T4; library.ts:16 and render.test.ts:1690 match | OK. Computed: exempt arithmetic is exact; the steady swell is ≈ 5 dB (bounded by the log-mean-exp shift); carve 6.02 − 0.06 dB; the hold case is ≈ 3.1–3.6 dB after the glue; under 3 s / fully exempt give undefined. Nit: `speechSpan` repeats `placementLines`' valid-speech filter |
| T6 | T6 (self) | tests vs code | spec.ts line refs (47–53, 502–509, 621–651, 791–797) match; `requestFromSpec` maps setting `auto`, so `older` re-resolves to continuous | OK. sound-levels.test.ts mirrors sound-failure.test.ts (`Run.create`, `produceSound`, `themeScore` exist); 12 s ≥ `MIN_MUSIC_SECONDS` 8; exempt is [0, 1.3] / [10.5, 12] after rounding; the grep check comes back empty; `tests/__snapshots__` exists and holds none of the changed strings. Gap: Review Focus 1 cites this test for "never null", but the steady theme never puts silence inside the music |
| T7 | T7 (self) | tests vs code | `QcCheck.id` is `string`; qc.ts has no `@covi/audio` import yet | OK. Message regexes match the `toFixed` output; continuous grading 12/16/20 pass, 21/11.9/9 warn, 8.9 fail. Nit: the long `(at most … wanted …: windows)${held}` suffix is duplicated in the pass and fail branches |
| T8 | T8 (self) | test vs CLI | `render` takes `--music-placement` (via `addVideo`); `Result.framesReused` is typed; the file has 4 tests | Test OK. Conflicts P7 and P17 come from its knobs. Nits: `$dir`/`<runId>` must be re-supplied after shell resets; `ffmpegRange` nearly duplicates `ffmpegLoudness` |
| T9 | T9 (self) | docs vs behavior | every anchor exists (video.md 83/147/514–527/564/571–575/630/633, artifacts.md 125, cli.md 101, configuration.md 426, SKILL.md 41/63, music.md 8/117/118, build.ts:143) | Gaps: P23; the P3 "halfway" text; docs/video.md:575 still says `music.hero.clear` means "outside speech and the ramps around it", which no longer matches T3's `clearOfSpeech`. The CHANGELOG `### Changed` subsection follows R-017/R-018 and agrees with the "one line" Global Constraint |
| G | Global Constraints / spec | — | — | Only P7 contradicts them (the glue threshold knob). The P11 retune needs a ruling. Everything else agrees: R-004, R-007 (`music-jump` fail, `music-range` warn), R-011 + R-A1-4, engine `covi-audio-4`, the master loop unchanged, i18n keys in all four catalogs, no `version` change |

## Pre-flight rulings
- PF-1 (T5×T8): Ruling: Task 8 may tune `JUMP_MARGIN_DB` only within [0.3, 0.8] dB — at 1.0 the guard would hold every pause and T5's long-pause swell test fails — none.
- PF-2 (T2×T8): Ruling: Task 8 must not change the glue threshold (fixed −24 dBFS RMS per spec and Global Constraints); tune placement levels instead — keeps T2's pins valid — if the theme still jumps, the guard handles it.
- PF-3 (T9): Ruling: Task 9 also puts the exempt windows (intro `[0, firstLine + 1 s]`, hero `[downbeat − 1.5 s, downbeat + 1.5 s]`, outro `[lastLine − 0.5 s, end]`) in `skills/covi-video/SKILL.md` (or `references/music.md`), and rewrites `skills/covi-video/references/music.md` line 9 (standard reviews no longer heard mostly in the breaths; it is loaded into score-writing prompts) — spec §12.2 says documented in the skill — none.
- PF-4 (T9): Ruling: Task 9 rewrites the docs/video.md sentence about the audible threshold margin and the `AUDIBLE` comment so they match the new threshold, and the `music.hero.clear` description so it matches T3's `clearOfSpeech` — docs must stay true — none.
- PF-5 (T4): Ruling: header comments in `effects.ts`/`mix.ts` are edited by content, matching across line wraps — none.
- PF-6 (T2, T5, T7, T8): Ruling: no duplicated logic: `glueCompressor` shares a gain-computer/smoothing helper with `compressor` in `dsp/fx.ts`; T7's `music-jump` message suffix is one constant; T8's `ffmpegRange` reuses `ffmpegLoudness`'s parsing (scratch script, still no copy-paste); T5's `speechSpan` uses a valid-speech filter exported from `placement.ts` — reviewers flag verbatim duplication as Important — none.
- PF-7 (T6): Ruling: Task 6 adds a test where the music stem goes silent mid-narration and asserts `musicJumps` and `musicRangeLu` are finite numbers (or absent), never null — Review Focus 1 — none.
- PF-8 (T3/T8): Ruling: any Task 8 retune of `speechDb`/`gapDb`/`endsDb` away from −15/−8/−6 is recorded as a ruling in its report with the measured numbers, and must keep music 12–20 dB below the voice (aim ~16) and the duck within 6–10 dB — spec values are binding unless measurement shows otherwise — none.
Task 1: dispatched (BASE aeef1fa, implementer a1-impl-1)
Task 1: Ruling (implementer): windowLoudness → windowPowers shared with integratedLoudness; LRA gates in power domain — removes duplication, bit-identical — none (reviewer accepted).
Task 1: minor (deferred): loudness.test.ts:210 span case [20,80] indistinguishable from whole signal; add a [20,40] case.
Task 1: minor (deferred): loudness.ts:209 doc omits "clear windows but none within `within`" case.
Task 1: minor (deferred): no test passes `within`/`floor` explicitly; floor -Infinity gives maxDb Infinity.
Task 1: complete (commits aeef1fa..cbe44ef, review clean)
Task 2: dispatched (BASE cbe44ef, implementer a1-impl-2)
Task 2: Ruling (implementer): shared private `gainComputer` + `pole` helper; glue skips the multiply below 1e-12 dB rather than snapping state — keeps the compressor bit-identical — none.
Task 2: Ruling: Task 9 rewrites the `GLUE` comment and docs to the measured reduction (theme median ≈ 3 dB, p90 3.7–4.5 dB) instead of "1–3 dB" — comments must be true — none.
Task 2: Ruling: keep the compressor's literal output-hash pin — reviewer verified identical hashes on darwin arm64 and linux arm64/x64 Node 22 (CI's platform); a tolerance would accept the drift AUDIO_ENGINE_VERSION exists to flag — a future Node major could change the hash with fx.ts untouched (then re-measure).
Task 2: minor (deferred): pin needs a comment saying what a mismatch means.
Task 2: minor (deferred): no glue test sees attack/release/RMS window/stereo link (swapped attack/release still in 0.5–4 dB bound).
Task 2: minor (deferred): carve test is mono; theme test title promises more than it asserts.
Task 2: complete (commits cbe44ef..256609a, review clean)
Task 3: dispatched (BASE 256609a, implementer a1-impl-3)
Task 3: Ruling (implementer): ramps between lines are clamped to the span from the first line to the last — the brief's code let a long gap ramp reach past the first line and pull the opening down (fails its own bookends pin) — none; continuous unaffected.
Task 3: Ruling (implementer): `validSpeech(speech)` takes no duration — clipping would break `clearOfSpeech`, which renders only up to t + 2 ms — none.
Task 3: note: mix.test.ts red (music 15.73 dB under voice, test wants ≥ 18) until Task 5 rewrites it, as the brief expects.
Task 3: minor (deferred): swellingPauses and the 50 ms merge untested under bookends; clearOfSpeech re-renders from 0 to t on each call, undocumented.
Task 3: fix round 1/5 dispatched (finding: fill() with negative `to` when all speech before 0; FIX_BASE a6e6c86)
Task 3: fix round 1/5 (1 addressed, 0 open; commits a6e6c86..268051a)
Task 3: minor (deferred): no test for a line ending just before 0 whose ramp-out reaches into the video (behavior correct).
Task 3: complete (commits 256609a..268051a, review clean)
Task 4: dispatched (BASE 268051a, implementer a1-impl-4)
Task 4: Ruling (implementer): the brief's 102-column YAML comment kept verbatim — Biome does not check YAML; music templates already exceed 100 columns — none.
Task 4: minor (deferred): mix.test.ts:116–138 cannot tell a bus-wide cut from per-effect clamps, nor applied from recorded; mix.ts:12–13 comma splice in header.
Task 4: note for Task 8: verdict/outro land ≈ 8 dB under the voice (at the cap); Task 8 reports whether effectsCutDb appears and lowers gainDb if routine.
Task 4: complete (commits 268051a..178593b, review clean)
Task 5: dispatched (BASE 178593b, implementer a1-impl-5)
Task 5: Ruling (implementer): musicExemptWindows ignores a non-finite hero time — a NaN hero would exempt the whole video from the jump check — none.
Task 5: note for Task 6: musicLines unsorted (held pauses last); readers re-sort.
Task 5: minor (deferred): M1 per-pause check may hold a pause over movement it cannot fix (conservative); M2/M3 no test that the guard holds only the jumpy pause, nor the hero exemption through mixSound; M4 in file.
Task 5: Ruling: M5 (musicBelowVoiceDb not finite-guarded) is carried into Task 6, whose PF-7 test asserts audio.json levels hold no null — the no-null guarantee needs it — none.
Task 5: note for Tasks 7/8: one 7 dB swell over steady music already measures ≈ 6.8 LU, near the 8 LU music-range warning.
Task 5: complete (commits 178593b..12e82f5, review clean)
Task 6: dispatched (BASE 12e82f5, implementer a1-impl-6)
Task 6: Ruling (implementer): roundLevels writes a level only when finite (master included) — the brief's r() let non-finite values through — none.
Task 6: Ruling (implementer): fixed two stale VideoSpec.music docs in spec.ts and one test pinning removed byMode text — keeps docs and tests true — none.
Task 6: Ruling: routed to Task 9: docs/getting-started.md:290 still quotes the removed byMode text; the `where.bookends` wording in all four catalogs says "stays low" though bookends is ≈ −40 dB under speech — Task 9 rewrites it to "drops out under the narration" (en) with matching ko/ja/zh, and replaces zh "保持低调" with a literal phrase (e.g. "在旁白下几乎听不到") — accuracy; 调 can read as "key" in a music context — none.
Task 6: minor (deferred): roundLevels' finite filter untested; M5 guard comment/edge case; PF-7 test accepts absent musicRangeLu; `older` test fixture shape.
Task 6: complete (commits 12e82f5..4828ace, review clean)
Task 7: dispatched (BASE 4828ace, implementer a1-impl-7)
R-024 (program): CHANGELOG exactly one line per PR under its dominant subsection; Task 9 must follow it.
Task 7: note for Task 8: tests/render/sound.test.ts:127 pass list lacks music-jump and music-range. Note for Task 9: docs/video.md:525/:630 and docs/contributing.md:307 still describe 18 dB grading, WCAG, the old check list.
Task 7: Ruling: review minors M1 (very short narration: music-jump says "no music under narration" while music-under-speech reports a level) and M3 (messages print 1 decimal while grading uses 2 → "6.0 dB (at most 6 wanted)" can fail) are carried into Task 8 — same contradiction class B1 fixed; cheap — none.
Task 7: minor (deferred): 4 more in task-7-review.md.
Task 7: complete (commits 4828ace..acde886, review clean)
Rebased onto main 4ccbdb6 (B1 merged): clean; A1 tasks 1–7 now 09d7a3b (was acde886).
Task 8: dispatched (BASE 09d7a3b, implementer a1-impl-8)
Task 8: measured (ffmpeg; Covi within 0.1 dB): music 15.3/15.5/15.6 dB under voice (api en, slim en, slim ko); narrated LRA 2.2–2.9 LU; largest jump 3.0–3.6 dB; master −16.0 LUFS, TP −3.2…−3.5 dBTP; effects 10.8–11.4 dB under voice peak; effectsCutDb never; music.wav identical across two fresh renders (2c29f463…). No mix constant changed.
Task 8: Ruling: mid-narration pause swells do not sound on the theme (scene gaps 1.5–2 s are too short; a forced 9.4 s pause is held by the guard, else 7.67 dB jump) — accepted per R-018: a steady bed under narration, swells at the opening, the hero, and the end — the owner may want audible breaths; that would need a larger jump allowance.
Task 8: note for Task 9: sound-effects.yml comment says +1 dB puts an effect ≈ 10 dB under the voice; measured ≈ 13 dB (peak-to-peak 10.8–11.4) — rewrite to the measured value.
Task 8: Ruling: carried into Task 9 — review minors (1) render test also asserts ffmpeg LRA and Covi's musicRangeLu agree within 0.5 LU, (3) `hundredth` reuses sound.ts `round(n, 2)` instead of repeating it, and the out-of-scope precision contradictions in `audioCheck` (true peak −0.96 warns while printing "−1.0 dBTP") and `musicAudibleCheck` — same class as M3; cheap — none.
Task 8: minor (deferred): standard-review test never reaches a mid-narration swell or the guard (gaps 1.6–2.0 s); M1 wording one inexact case; misplaced comment.
Task 8: complete (commits 09d7a3b..bdd259f, review clean)
Task 9: dispatched (BASE bdd259f, implementer a1-impl-9)
Task 9: Ruling: carried into the final fix wave — `where.continuous` ("rises in the pauses") overstates: only pauses ≥ ~4.5 s rise and none did on the theme → reword in all four catalogs; `music-fit` print-vs-verdict precision (6.04% warns, prints "6.0%") — accuracy — none.
Task 9: note: under machine load (load avg ~150 from parallel agents) 4 tests timed out and the 10 s theme-synthesis bound hit 15.4 s; all pass alone/rerun.
Task 9: review: [I] docs/video.md:566 says the bed is 14 dB under the stems (it is 15; effect +1 → 14 under) → final fix wave. Minors to batch: build.ts:186-190 BREATHING comment stale; SKILL.md:41 "a little higher before the first line" understates a 9 dB lift; `hundredth(...)!` in musicAudibleCheck → direct round; zh where.bookends could be more idiomatic. When rewording where.continuous also update docs/video.md:147, docs/getting-started.md:294, spec.test.ts (387, 392, 620, 625), tests/cli.test.ts:280. density.ts R-007 is removed on the B2 branch (not A1's).
Task 9: complete (commits bdd259f..4199ab3; Important finding carried into the final fix wave)
Final review: ready after one fix — [I] where.continuous "rises in the pauses" (4 catalogs) contradicts behavior. Ruling: one fix wave also takes Task 9's [I] (video.md:566) and the cheap accuracy items: "never jumps" → placement never jumps, QC catches a composed score's own jumps (mix.ts:26, video.md:525, SKILL.md:41, configuration.md:426, CHANGELOG); music-jump message names "the hero" only when a hero window exists; document musicLines unsorted; strict musicRangeLu assertion; comment on the compressor hash pin; BREATHING comment (build.ts:186-190); SKILL.md:41 lift wording; `hundredth(...)!` → round; music-fit print-vs-verdict precision — accuracy before merge — none.
Final fix wave dispatched (FIX_BASE 4199ab3, resumed a1-impl-9)
Final fix wave: Ruling (implementer): en where.continuous says "louder before the first line and at the end" (not "a little fuller") — the 9 dB lift must not be understated — none.
Final fix wave: Ruling (implementer): the music-fit precision fix also covers logo start/landing/tail checks (−59.96 dBFS tail failed while printing −60.0) — same class — none.
Final fix wave: re-review clean (9 addressed; commits 4199ab3..295f77e). Parked minors: qc.ts:333 hero window end not clamped to duration; qc.ts:392 `hundredth(...)!` remains; qc.ts:396 nested parentheses — Ruling: cosmetic, can wait — none.
