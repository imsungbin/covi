# Covi 0.2.0 — program spec

Repository: /Users/a10637/projects/covi (trunk-based, `main`, squash merges, CI = `npm run check`).
This file is the binding authority for the eight PRs below. Plans argue from it.

## Why

Covi's review videos look like slide decks: one static card per beat, motion timed as fixed
fractions of scene length, scene length padded to a target, one fade transition, catalog
narration. Measured on `examples/ui-comment-composer` (standard, 60 s): 24 s of speech,
scene s2 = 8.6 s with 1.4 s of narration, 7 cuts, 4 sound effects.

Covi's only non-copyable property is that it runs base and head. The 0.2.0 program makes
(a) videos feel produced and (b) the executed evidence the center of the product.

## Global constraints (bind every PR)

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

## Vocabulary

- *Scene*: one storyboard entry (`packages/video/src/storyboard/schema.ts`).
- *Phrase sync*: a visual phase pinned to the moment a phrase is spoken.
- *Hero*: the single most important moment of a video.
- *Evidence*: a captured artifact produced by running the software (screenshot, recording,
  trace, terminal output, HTTP exchange, pixel diff) with a stable id inside a run.

---

## PR 1 — Storytelling rules (skills only)

Scope: `skills/covi-video/SKILL.md`, `skills/covi-video/references/*.md`, `CHANGELOG.md`
(created). Optionally `templates/i18n/*.yml` only if a user-facing string must change.
No TypeScript changes. Remember skills are loaded into model prompts (`methodologyOf`), so
wording is product logic; agent-only sections keep their reserved headings.

Rules to add or change (the skill is the source of truth; write them in the skill's voice):

1. Cold open. The first scene is not a title card. Frame 0 already shows the subject
   (captured screen, terminal, or the key lines) with the title as a small eyebrow; the
   first spoken line starts within 0.5 s. The first line is a hook: a question, a surprising
   fact, or the payoff — never "This change shows …" and never a table of contents
   ("We'll look at A, B, and C" is banned).
2. Scenes are 2–5 s. A long beat is split across two scenes rather than holding one picture.
   Standard mode: 10–16 scenes; short mode: 6–9. (Schema max rises in PR 2; until then,
   stay within 14.)
3. One keyword per line. Each narration line is built around one key phrase the viewer
   should remember; the line's structure puts it where the voice naturally lands. (The
   `[[…]]` caption-emphasis markup is introduced by PR 2 together with its renderer; PR 1
   does not mention the markup.)
4. One hero per video. The agent names the scene where the change "clicks" (a bug
   reproducing, the key lines side by side with the thing they fix, the after state landing).
   Until PR 2 adds `hero: true`, the hero is expressed by naming the beat to match the
   template's hero list.
5. The list is the map. When there are 2–4 things to check, promise them up front
   ("three places to look"), visit each, and return to strike them off; a bonus question at
   the end is allowed. This is a narrative device, not a template.
6. Templates are suggestions. Beat order follows the evidence; the only fixed points are the
   cold open at the start and a ≤2 s wrap at the end. Drafted narration from the heuristic
   drafter is a scaffold and must be rewritten by the agent.
7. Narration persona stays "calm senior engineer, no hype", with this boundary made
   explicit: facts are never exaggerated; tone, metaphor, and structure are free.
   Punctuation shapes delivery ("." settles, "!" lands, "?" lifts). Lines ≤ 15 words.
   The last line is ≤ 8 words or absent (the outro carries it). Callbacks to the hook
   keyword are encouraged.
8. Self review. After rendering, the agent opens `video/contact-sheet.jpg` and `qc.json`
   and answers in order: Is frame 0 legible and intriguing with the sound off? Is the hero
   visibly the biggest moment? Does any scene hold a still picture while narration continues?
   Would this look at home in a SaaS dashboard? If any answer is wrong, it fixes the
   storyboard (not the renderer) and re-renders with `covi render --run … --storyboard …`.
   (Verify the actual CLI shape for re-rendering and name it precisely.)
9. Narration still never claims more than the evidence shows.

Acceptance:
- `npm run check` green (skills tests, `agents:check`, english baseline).
- A reader of SKILL.md can author a storyboard that is a cold open + 2–5 s scenes + hero +
  list-map without reading this spec.
- `CHANGELOG.md` exists with `## [Unreleased]` and one line for this PR.

## PR 2 — Timing and motion grammar

Scope: `packages/video` (storyboard schema, timeline, runtime stage, qc, captions),
`packages/brand` tokens if a token is needed, `docs/visual-system.md`, `skills/covi-video`
(describe the new fields), `templates/i18n` for any new QC message, `CHANGELOG.md`.

1. `sync` anchors. Scene gains optional `sync: Record<string, string>` mapping a phase
   name to a phrase that appears verbatim in `narration`. The timeline resolves each phrase
   to a time using the existing text-weighted split (the one captions use), relative to the
   scene's speech start/end. Resolved times are written to `timeline.json` per scene as
   `phases: { <name>: seconds }`. Components use phases when present and fall back to the
   current fixed fractions. Phase names by visual kind (minimum set): screenshot/interaction
   `zoom`, `click`, `step<N>`; code `highlight`, `highlight<N>`; before-after `reveal`;
   findings `finding<N>`; terminal `output`; api `after`. A phrase not found in the
   narration is a storyboard validation error (exit 2) with a message naming the scene.
2. No padding. The fitter no longer lengthens scenes to reach a duration target; the target
   is an upper bound. Scene length = lead + speech + tail, with tail ≤ 0.6 s unless
   `minSeconds` or a hero hold demands more. Transitions begin before the next line: cut
   start = max(speechEnd − 0.5·d, nextSpeechStart − 0.6·d) where d is the transition
   length. When narration continues past a finished visual, the component plays a slow
   push-in ("linger") instead of holding still. Default camera on every media scene is a
   slow drift (sine in/out, ≤ 2 % travel) unless the scene sets `camera: static`.
3. Transition grammar. Scene gains optional `transition: 'fade' | 'cut' | 'push' | 'wipe' |
   'zoom-through'` (the transition INTO this scene). Default stays `fade`. `cut` is 0 s.
   `push` slides left. `wipe` reveals left→right. `zoom-through` scales out of the previous
   scene into this one (used for the hero). Lengths are brand tokens.
4. Hero. Scene gains optional `hero: boolean` (at most one true; validation error otherwise).
   The hero scene gets +0.4 s hold after its speech, its `zoom-through` transition by default
   if unset, and the music hero downbeat is aligned to it (replacing the template `hero`
   beat lookup when `hero` is set; the beat lookup remains the fallback). A visual hero
   accent (flash ≤ 0.2 s + one expanding ring + a 6 % camera punch) plays at the hero scene's
   `hero` phase (its `sync.hero` phrase, else speech start).
5. Caption emphasis. `[[…]]` in `narration` is stripped from spoken text and from the
   narration shown in reports; the caption renders the marked phrase with an emphasis
   sweep timed to its phrase time. At most one per line; a second is a validation error.
6. Cold-open support. A `title` visual gains optional `background` (an image from the run)
   so the title can sit over the captured subject; `lead` for the first scene becomes ≤ 0.3 s
   so speech starts by 0.5 s.
7. QC gates (warn, not fail, in this PR): `still` — content region unchanged (freezedetect
   on the media region or frame hashing) for ≥ 1.5 s while narration is speaking;
   `hook` — first speech starts after 0.5 s; `speech-share` — speech < 70 % of the video
   (excluding the outro). Contact sheet sampling adds frame 0.3 s, the hero phase, and the
   midpoint of every transition.
8. Schema max scenes: 24. Minimum seconds per visual kind are reduced so 2–5 s scenes are
   possible: title 1.5, code 2.0, before-after 2.5, interaction 1.2·steps, findings 2.0+0.4n.
9. Skills updated to describe `sync`, `transition`, `hero`, `[[…]]`, `camera`, and the
   figures PR 1 deferred: first line by 0.5 s, 10–16 scenes standard, frame 0 on the
   contact sheet.
10. Heuristic drafter (`storyboard/draft.ts`) opens with a cold open (the first evidence
    visual with the title as eyebrow, or the title over a captured background) instead of a
    title card, never writes a table-of-contents line ("We'll look at …"), and marks the
    template's first hero beat `hero: true`. Catalog narration strings change accordingly in
    all four i18n catalogs; `tests/english-baseline.test.ts` is updated.
11. Carried from PR 1's review: `refineNarration` (`storyboard/model.ts`) must give the model
    a word budget compatible with the skill's 15-word lines (it currently asks ~156 words over
    ~6 scenes for a standard video); `templates/stories/bug-fix.yml` drops `optional` from the
    `proof` beat (the hero is never optional); the skill notes code line width in 9:16 (about
    48 characters before truncation) so agents pick lines that fit.

Acceptance: tests for phrase resolution (found, not found, duplicate phrase, multi-byte
languages), fitter no longer pads, transition timing math, hero validation, caption
emphasis, each QC gate firing and quiet. `npm run test:render` renders an example with a
storyboard that uses every new field; contact sheet reviewed by the controller.

## PR 3 — Components and sound

Scope: `packages/video/src/runtime/media.ts` and siblings, `packages/video/src/timeline/
cues.ts`, `templates/music/sound-effects.yml`, `packages/audio` (AUDIO_ENGINE_VERSION bump),
schema (additive), skills, `docs/visual-system.md`, `CHANGELOG.md`.

1. Code morph. `code` visual gains `mode: 'diff' | 'morph'`. In `morph`, deleted lines
   fade to a struck ghost and the added lines type into the same position; `highlight`
   accepts a list and each entry may carry a `sync` phase name. `caption` is rendered (it is
   in the schema today and ignored).
2. Multi-mark screenshots. `screenshot` and each `interaction` step accept `marks` (1–3),
   each `{ focus, label?, sync? }`; the camera pans mark→mark; the cursor starts from the
   previous mark; each mark may show a short gloss under the frame. `focus`/`click` remain
   as the single-mark shorthand.
3. Agent cues. Scene gains optional `cues: [{ at: <phase name> | seconds, kind }]` where
   kind is one of the cue map's kinds. Cue map gains `transition` (a short whoosh for
   push/wipe/zoom-through), `riser` (into the hero, 0.8 s before its phase), `hero` (the
   hit at the hero phase). Density limits stay. Ducking starts 60 ms before speech and
   releases over 300 ms.
4. Diagram edge labels are rendered.
5. Hero stack from PR 2 gains the `hero` cue and the riser.

Acceptance: tests per component for phase use and fallback, cue placement (riser before
hero, dropped when crowded), engine version bump, render test with every new field,
contact sheet and `audio.json` reviewed by the controller.

## PR 4 — Behavior diff capture

Scope: `packages/capture`, `packages/core` (model additions for recordings/traces, run
paths), `packages/cli` (flags, demo.md rendering), `skills/covi-demo`, `docs/`, examples'
expectations if they list artifacts, `CHANGELOG.md`.

1. Recording. Every browser flow is recorded with Playwright `recordVideo` (webm, 1280×800
   or the plan's viewport) and converted to mp4 with ffmpeg when present (webm kept if
   ffmpeg is absent; demo.md says so). Output: `demo/recordings/<flow-id>-<base|head>.mp4`.
2. Trace. For every page and flow, a JSON trace alongside: network requests (method, url,
   status, timing, redacted), console messages (level, text, redacted), DOM mutations
   summary (count, changed regions as rects) and the step timeline (step id, t, screenshot
   path). `demo/traces/<id>-<base|head>.json`. Playwright's own trace.zip is NOT stored
   (size, unredacted).
3. Behavior diff. A deterministic comparison of the same scenario at base and head:
   `demo/behavior-diff.json` listing per flow: steps that differ (pixel diff region ids),
   network calls added/removed/changed status, console errors added/removed, timing deltas.
   Human summary appended to `demo/demo.md`.
4. All new artifacts pass through the Redactor and are registered in `run.json` with sha256.
5. Config and flags: `demo.record: true|false` (default true when a browser runs),
   `--no-record`. CI parity via config.
6. `assessDemonstration` may use "a flow exists" as before; no change in decline rules here.

Acceptance: unit tests with a tiny static app in `examples/` or test fixtures (base vs head
with one changed request and one console error); recording skipped cleanly when ffmpeg or
browser is missing (exit 3 only when the user asked for it explicitly); redaction test;
`npm test` under Playwright Chromium.

## PR 5 — Evidence model

Scope: `packages/core` (model schemas: explanation, findings, review; evidence registry),
`packages/video` (storyboard scene `evidence` refs; narration grounding check),
`packages/platforms` (comment rendering links evidence), `packages/cli`, skills
(`covi-explain`, `covi-review`, `covi-video`), `covi schema`, `docs/`, `CHANGELOG.md`.

1. Evidence registry. `evidence.json` in the run lists every evidence item with id, kind
   (screenshot, recording, trace, terminal, http, pixel-diff, diff-hunk, test-run), path,
   revision (base/head/both), sha256, and a short label. Produced by capture and by the
   diff/understand stages (diff hunks are evidence too).
2. Claims carry evidence. `explanation.json` statements, `findings.json` findings, and
   storyboard scenes gain optional `evidence: string[]` (ids). Validation: an id must exist
   in `evidence.json`. A finding with certainty `confirmed` or `likely` MUST carry at least
   one evidence id (schema error otherwise). Explanation statements and scenes: warned when
   missing (QC `grounding` check lists them).
3. Rendering. `review.md`, `comment.md`, and the PR/MR comment show an evidence footnote per
   finding (file:line for diff hunks; a link or attachment name for captures). Video scenes
   with evidence record it in `timeline.json` and the contact sheet labels.
4. Skills instruct agents to cite evidence ids and explain how to list them
   (`covi evidence --run <id> --json` — add this read-only command).

Acceptance: schema tests (missing evidence on confirmed finding fails; unknown id fails;
optional elsewhere), registry built from a run of an example, comment rendering snapshot
updated, english baseline updated.

## PR 6 — Repository subject model

Scope: `packages/core` (model + storage under `.covi/subject/`), `packages/capture`
(producer and consumer), `packages/cli`, skills (`covi-demo`, `covi-video`), `docs/`,
`CHANGELOG.md`.

1. Model: `subject.json` describes the software as seen so far: screens (route/url, title,
   viewport sizes seen), elements (stable selector, role, label, bounding box per viewport,
   last seen revision), flows (id, steps with selectors and labels, last successful
   revision), commands (CLI/API scenarios). Versioned (`schemaVersion`), bounded in size,
   redacted.
2. Producer: every capture run merges what it saw into the model (upsert by stable key;
   stale entries expire after N revisions not seen).
3. Consumer: the demo planner proposes flows and focus rects from the model when the plan
   does not specify them; the storyboard drafter resolves `subject:<screen>#<element>`
   references in `focus`/`marks` to rects for the captured viewport.
4. Storage: `.covi/subject/` is committed by default (it is small and shareable); a config
   key `subject.store: repo|runs|off`.
5. Security: the model is data from an untrusted repository; it never contains commands to
   run; selectors are strings only; size-bounded.

Acceptance: merge semantics tests (upsert, expiry, bound), reference resolution tests,
an example run twice shows the second plan using the model, redaction.

## PR 7 — Outcome loop and author-side automation

Scope: `packages/platforms`, `packages/cli`, `integrations/github-action`,
`integrations/gitlab-ci`, `docs/`, `CHANGELOG.md`. Core stays platform-unaware.

1. `covi outcomes collect` (GitHub first; GitLab where the API allows): for runs that posted
   a comment, fetch the PR state (merged / closed / reverted-by), reactions and replies on
   Covi's comment, and per-finding thumbs (👍/👎 on the finding's anchor comment when
   present). Written to `.covi/outcomes/<run-id>.json`, redacted, with a schema.
2. `covi outcomes report --json`: per repository precision by certainty (`confirmed`,
   `likely`, `risk`, `question`) with counts, and a short English/i18n summary.
3. Calibration hint: the review stage reads `.covi/outcomes/` (when present) and includes
   the observed precision in the brief the agent sees; it does not change certainty by itself.
4. Author-side workflow template: `integrations/github-action` gains an example workflow
   that runs Covi on every push to a PR branch and updates one sticky comment; the action
   gains `outcomes: true` to collect outcomes on PR close.
5. Human rating: the sticky comment ends with a one-line "Was this useful? 👍 👎" and the
   collector counts those reactions.

Acceptance: adapter tests with recorded fixtures (no network), report math tests, action
template validated by a test that parses it, docs updated.

## PR 8 — Release 0.2.0

Scope: `package.json`, `packages/*/package.json` (7), `.claude-plugin/plugin.json`,
`CHANGELOG.md`, tag `v0.2.0`, move tag `v1` to the release commit.

1. Bump all nine `version` fields to `0.2.0`; `package-lock.json` updated via `npm install`.
2. `## [Unreleased]` → `## [0.2.0] - <date>`; add a fresh empty `## [Unreleased]` above.
3. After squash merge: tag `v0.2.0` on the merge commit, force-move `v1` to it, push tags.

---

## Delivery protocol (controller)

- Two worktrees: video track (PR 1 → 2 → 3) and evidence track (PR 4 → 5 → 6). PR 7 after
  PR 5. PR 8 last. Each PR branches from the current `main` at the time it starts and is
  rebased onto `main` before opening.
- Each PR: plan (Opus) → subagent-driven development (implementer Opus, task review) → final
  whole-branch review → `npm run check` (+ render tests where relevant) → push → PR (English
  body, ends with the attribution lines required by the session) → CI green → squash merge →
  next PR.
- The controller shares each video PR's contact sheet with the user when the PR opens.
