# Covi 0.3.0 program — rulings ledger

Every ambiguity decided without asking the owner, as `Ruling: <what> — <why> — <cost if wrong>`.
Spec: `specs/2026-10-09-covi-0.3.0-program-design.md`. Plans: `plans/`.

## Status

| PR | Branch | Plan | PR # | State |
|---|---|---|---|---|
| A1 Broadcast mix | broadcast-mix | — | — | not started |
| B1 Density and monotony | density-checks | — | — | not started |
| B2 Direction and canvas | direction-canvas | — | — | not started |
| B3 Code morph | code-morph | — | — | not started |
| B4 Numbers | metrics | — | — | not started |
| B5 Flow verbs | flow-verbs | — | — | not started |
| B6 Draft and critique | draft-critique | — | — | not started |
| B7 Direction methodology | direction-method | — | — | not started |
| A2 Sound from motion | sound-from-motion | — | — | not started |
| R Release 0.3.0 | release-0.3.0 | — | — | not started |

## Program-level rulings

- R-001 Ruling: the program prompt is the owner's standing approval; I approve my own spec and plans and record each approval here instead of stopping at review gates — the owner said so explicitly — a design the owner would have redirected ships; per-PR reviews and the acceptance list limit the damage.
- R-002 Ruling: one program spec covers all ten PRs architecturally; each PR gets its own plan, written when the PR starts against the then-current `main` — later PRs build on earlier code, so early detailed plans would go stale — later plans get less up-front scrutiny; each plan is self-reviewed before execution.
- R-003 Ruling: worktrees `../covi-0.3.0-program`, `../covi-sound`, `../covi-direction`; branches `broadcast-mix`, `density-checks`, `direction-canvas`, `code-morph`, `metrics`, `flow-verbs`, `draft-critique`, `direction-method`, `sound-from-motion`, `release-0.3.0` — short descriptive names like earlier PRs (`components-and-sound`, `outcome-loop`) — cosmetic only.
- R-004 Ruling: `video.music.placement: auto` (still the default value) now resolves to `continuous` for every kind of video; `bookends` stays selectable — makes continuous the default without invalidating configurations that say `auto` — someone who relied on `auto` meaning bookends for narrated standard videos hears a bed; they can set `bookends`.
- R-005 Ruling: the benchmark example is `examples/backend-slim-request/`, with fixture documents and code written for Covi and numbers computed by the example's own code — the reference repository is private and must not be copied — a rename later is cheap.
- R-006 Ruling: the fast low-resolution draft render is `covi render --run <id> --draft` (into `video/draft/`); `covi video --draft` keeps its documented meaning (write the drafts and stop) and now also writes `video/direction.json` with `"draft": true` — `covi video --draft` already means "write storyboard.json and stop" in the CLI and the skill, and the critique loop re-renders an existing run, which is `covi render` — if the owner wanted the literal `covi video --draft` render, it is a one-flag alias.
- R-007 Ruling: the new density, monotony, and motion checks warn; only `out-of-frame` and `music-jump` fail — QC `fail` is reserved for broken output (captions over the product, missing images or fonts, audio jumps the owner called amateur); quality checks warn so agents iterate and CI never blocks on taste — a monotonous video can still pass CI.
- R-008 Ruling: direction never changes scene timing, except that a shot's `enter` is the scene's entrance kind and shapes the overlap exactly like a storyboard `transition` — narration-first timing stays the single source of time — none expected.
- R-009 Ruling: a `direction.json` with `"draft": true` is re-derived by the default director at render instead of being validated against a rewritten storyboard — a stale draft must never block a render — an agent that edits the draft but leaves `draft: true` loses its edits; the skill says to set `"draft": false`.
- R-010 Ruling: metric evidence is additive (new `metric` kind, optional `metric` field); `evidence.json` stays `schemaVersion: 1` — new readers read old files unchanged and Covi rebuilds evidence per run — an older Covi cannot read a newer `evidence.json` with metric items.
- R-011 Ruling: `sound-effects.yml` `gainDb` becomes relative to the music bed's level under speech, with a hard cap that keeps every effect ≥ 8 dB under the voice peak — the owner asked for effect gains relative to the bed — retuning the offsets is a data change.
- R-012 Ruling: number words in labels ("thirty") are not policed in code; the methodology forbids them — no deterministic rule catches number words in four languages without false positives — a determined agent can still write a number word in a 32-character label.
- R-013 Ruling: counts drawn by `split`, `stack`, and `pile` come only from metric evidence — a drawn count is a number, and numbers must cite evidence — agents cannot dramatize a count that was never measured; they use `reveal` and `flow` instead.
- R-014 Ruling: canvas stop paths are seeded by the timeline seed — "a different change gives a different video" while the same inputs give the same path — none expected.
- R-015 Ruling: direction labels use a character allowlist (letters, marks, spaces, a little punctuation; no digits, no `://`, no `www.`) — blocks made-up numbers and prompt-injected links or markup at the schema — some honest labels ("HTTP 2", "v1") are rejected; the narration or an evidence-backed element says them instead.
- R-016 Ruling: `video.direction: off` renders exactly as 0.2.0 did (no canvas, no direction) — an escape hatch and a regression baseline — maintaining both paths costs some code.
- R-017 Ruling: B1 plan approved as written (8 tasks, its 15 rulings stand), except its CHANGELOG ruling: every PR's line goes under a Keep a Changelog subsection (`### Added` / `### Changed` / `### Fixed`) inside `## [Unreleased]` — the owner asked for Keep a Changelog, whose entries are grouped by type, as 0.2.0's are — a mis-grouped line is a one-line move at release.
- R-018 Ruling: A1 plan approved as written (9 tasks; its rulings R-A1-1…12 stand, notably ramps lengthened to ~1.97 s so any second moves ≤ 5 dB, and a deterministic guard that holds a pause at the speech level when the theme's own movement would still break the 6 dB jump limit) — the spec's 1.2 s pre-roll contradicted its own slope rule, and the jump limit outranks the swell — narrated stretches sound like a steady bed with swells mainly at the opening, around the hero, and at the end; CHANGELOG uses a Keep a Changelog subsection (R-017).
- R-019 Ruling: B2 plan approved (11 tasks, its 30 rulings stand) with one amendment: the label allowlist also admits CJK punctuation (`、。・「」『』（）！？：`), and the `://`/`www.`/`javascript:`/`vbscript:`/`data:` checks run on the NFKC-normalized label, so full-width look-alikes cannot spell a scheme — Korean, Japanese, and Chinese videos are first-class and their labels need their own punctuation — none of these characters can form markup or a link after normalization.
- R-020 Ruling: B2 executes only after B1 merges; before Task 1, a fresh pre-flight scan checks the plan against post-B1 `main` (its Task 8 stage edits and Task 10 density edits were written against B1's plan, not its code) — the planner verified against a scratch copy of v0.2.0 plus B1's planned code — conflicts found then are ruled on before dispatch.
- R-021 Ruling: B4 plan approved (7 tasks, its 30 rulings stand: fold-change metric choice, counter only with ≥ 10 steps, count lands on its phrase, timings excluded, comma grouping in all four languages, delta never judged good or bad) — consistent with spec §7 and the evidence-binding principle — executes after B3 merges, with a fresh pre-flight scan against post-B3 `main` (its Tasks 3–5 edit B2/B3 files it reasoned about but could not run).
- R-022 Ruling: B3 plan approved (7 tasks, its 20 rulings stand: a hunk morphs only with code on both sides and ≤ 12 changed lines per side; the elision marker uses `…` because `⋯` is not in the embedded fonts; storyboard `mode: "morph"` untouched; one contact-sheet tile at each morph's midpoint; poster stays at 1.6 s) — consistent with spec §6 — executes after B2 merges, with a fresh pre-flight scan against post-B2 `main`.
