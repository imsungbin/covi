# Covi agent guide

Covi helps people understand, explain, demonstrate, and review code changes. A coding agent provides the intelligence and execution; Covi provides the methodology (skills), deterministic tools (the `covi` CLI), schemas for agent-authored files, renderers, and a video pipeline.

The loop is **Understand → Explain → Demonstrate (when it helps) → Review**.

This file is the canonical guidance for every agent client. `CLAUDE.md` imports it; nothing here is duplicated elsewhere.

## Two kinds of work

**Using Covi** (the user asks you to explain, review, demo, summarize, or make a video of a change): read `skills/covi/SKILL.md` first. It routes to the right skill and explains the conventions. Do the reasoning yourself; use the CLI for the deterministic parts.

**Changing Covi** (you are developing this repository): read the rest of this file.

## Repository map

| Path | What it is |
|---|---|
| `skills/` | Canonical agent skills: the review methodology. Product logic, not documentation. |
| `templates/stories/` | Storytelling templates for videos (data, validated on load). |
| `templates/i18n/` | Message catalogs: every fixed string Covi writes for people, in `en`, `ko`, `ja`, and `zh` (data, validated on load). |
| `templates/speech/` | How Korean, Japanese, and Chinese voices should say Latin letters and acronyms (data, validated on load). |
| `templates/music/` | Sound data, validated on load: synthesizer patches and drum kits, sound-effect recipes and the cue map (`sound-effects.yml`), and the Covi theme (`scores/covi-theme.yml`). |
| `packages/core` | Platform-independent domain model, change resolution, understanding, review rules, configuration, runs, intelligence providers, reports. No browser, no CI APIs. |
| `packages/capture` | Demonstration: checks out base/head, runs the software, captures pages, flows, commands, and requests. |
| `packages/video` | Video pipeline: specs, storyboards, narration, captions, timeline, sound, browser composition runtime, renderer, QC. |
| `packages/audio` | Sound for videos: a deterministic synthesizer, the score format and parser, the fitter that fits music to a timed video, loudness measurement, and the narration-first mix. |
| `packages/brand` | Design tokens and the SVG fox mascot. Dependency-free and isomorphic. |
| `packages/platforms` | Thin GitHub and GitLab adapters: CI context → change inputs, comments, annotations, reports. |
| `packages/cli` | The `covi` command and the workflows that compose the packages. |
| `integrations/` | GitHub Action (`github-action/action.yml`) and GitLab CI component (`gitlab-ci/`). They call the CLI. |
| `examples/` | Realistic example changes (base tree + head overlay + expectations). Tests and `covi examples` use them. |
| `assets/covi/` | Generated SVGs of the mascot and logo. |
| `docs/` | Product and developer documentation. |
| `tests/` | Cross-package integration tests and helpers. Unit tests live in `packages/*/test/`. |

## Architecture rules

- **Dependency direction:** `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. Nothing imports `cli`. `core`, `brand`, and `audio` never import another Covi package; `cli` reaches `audio` through `video`'s re-exports. A test enforces this.
- **The domain model is platform-independent.** Core speaks of a `CodeChange` (repository, base and head revisions, changed files, commits, metadata), never of pull requests. GitHub and GitLab specifics live only in `packages/platforms` and `integrations/`. Core never reads CI environment variables.
- **One methodology source.** Skills are read by agents and also loaded into model prompts (`methodologyOf` in `packages/core/src/resources.ts`). Sections named `Run it`, `Commands`, `Tools`, `Workflow with the CLI`, `Asking the user`, `Output files`, `Related skills`, or `When not to use` are agent-only and are left out of model prompts; everything else is methodology. Change methodology in the skill, not in code.
- **Deterministic tools, judgment in skills.** If something must be computed the same way every time (resolution, rules, timing, rendering, QC), it belongs in code with tests. If it needs judgment (intent, findings, narration), it belongs in a skill, with a schema for the result.
- **Artifacts are the interface.** Every stage reads and writes files in a run directory (`.covi/runs/<run-id>/`), so stages can run independently and agents can author the inputs Covi validates: `explanation.json` and `findings.json` in the run, a demo plan passed with `--plan` (kept as `demo/plan.json`), `video/storyboard.json`, and `video/score.json`. Claims in them cite evidence ids from `evidence.json`, which Covi derives from the run's own files. Paths are defined once, in code.
- **Interactive and non-interactive parity.** Every choice an agent may ask the user about has a configuration key and a default. CI never waits for input.

## Using the CLI as a tool

- Run `./bin/covi.mjs` (or `npm run covi --`) from this checkout. It runs the TypeScript sources directly on Node 22.18+, so edits apply without a build. `./bin/covi` is the launcher the Claude Code plugin puts on PATH: it installs the locked dependencies on its first run, then runs `bin/covi.mjs`.
- Pass `--json` to get a stable result object on stdout; progress goes to stderr.
- Exit codes: `0` ok · `1` review gate failed · `2` usage or invalid input (including schema errors in agent-authored files) · `3` environment (not a repo, missing ffmpeg or browser) · `4` internal error.
- `covi schema <explanation|findings|storyboard|score|demo-plan|config|evidence>` prints the JSON Schema for files agents author or read.
- `covi evidence --run <id> --json` lists the run's evidence ids (read-only).
- `covi examples create <name>` builds a real git repository for an example change; point any command at it with `--repo <dir>`.

## Run outputs

```
.covi/runs/<YYYYMMDD-HHMMSS>-<workflow>-<head7>/
  run.json             manifest: inputs, config with provenance, stages, commands, artifacts (sha256), outcome
  context.json         Understand output          diff.patch           redacted diff
  evidence.json        evidence registry: the ids findings, explanations, and scenes cite
  brief.md             agent brief                rule-findings.json   deterministic findings with ids
  explanation.json/.md findings.json              review.json/.md      summary.md   comment.md
  tests.log            test command and output tail (when tests ran)
  demo/                plan.json (when given), captures.json, screenshots/, diffs/, recordings/, traces/,
                       behavior-diff.json, app-<revision>.log (when the app did not start), demo.md
  video/               decision.json, storyboard.json, speech.json, timeline.json, narration.wav,
                       score.json (composed music), audio.json, music.wav, captions.vtt/.srt,
                       composition/, covi-review.mp4, frames.json, poster.png, contact-sheet.jpg,
                       qc.json
```

The runs directory ignores itself (it contains a `.gitignore` with `*`); Covi never edits the user's `.gitignore`.

## Quality expectations

- **Evidence over assertion.** Findings need a location, evidence, and a reason it matters. Rules must prefer silence over noise; every rule has tests for both firing and staying quiet.
- **Honest uncertainty.** Intent comes with a confidence and its evidence. Ambiguity is stated, never papered over.
- **Product judgment.** Covi declines to make a video when nothing is worth seeing, and reports zero findings for sound changes.
- **Readable output.** Explanations at the right altitude; narration that sounds like a colleague; captions that never cover the product (QC verifies).

## Changing workflows safely

- **Schemas** (`packages/core/src/model/*`, `packages/video/src/storyboard/schema.ts`, `packages/audio/src/schema/score.ts`, `packages/capture/src/plan.ts`, `packages/core/src/config/schema.ts`): agent-authored files are validated with Zod. Additive changes are fine. A breaking change to a versioned file (one with `schemaVersion`) bumps the version; the configuration and the demo plan have no version, so they only grow (add keys, never repurpose one). Either way, update the skills that describe the file.
- **Rules** (`packages/core/src/review/rules/`): add a positive and a negative test in `packages/core/test/rules.test.ts`. Classify certainty honestly; only `confirmed` and `likely` findings can fail a CI gate.
- **Templates** (`templates/stories/*.yml`): validated on load; tests draft and validate a storyboard with each. Each beat's `eyebrows` carries its label in Korean, Japanese, and Chinese.
- **Text for people** goes through the message catalogs (`templates/i18n/<language>.yml`, `t()` in `packages/core/src/i18n/catalog.ts`), never as a literal in code. Add the key to all four catalogs with the same placeholders (a test checks it); Korean particles after a placeholder are written as pairs such as `{을/를}`. English output is pinned by `tests/english-baseline.test.ts`. CLI log messages stay in English.
- **Speech tables** (`templates/speech/*.yml`): letter names and words for normalizing narration; check a change with a real voice.
- **Music templates** (`templates/music/`): patches, kits, effect recipes, the cue map, and the Covi theme are validated on load, and a test loads every file. Recipes write pitched layers as note names in C (they follow the music's key) and sound design in Hz. Check a change by rendering an example and listening to `video/music.wav`, then reading `video/audio.json` and the sound checks in `video/qc.json`.
- **Sound engine** (`packages/audio`): deterministic like the runtime: only the seeded PRNG (`dsp/prng.ts`), no `Math.random`, no clocks. Bump `AUDIO_ENGINE_VERSION` whenever rendered output changes, so cached music is rendered again. Scores are untrusted input: keep every new field bounded in `SCORE_LIMITS`. Music fits the picture, never the reverse: nothing in `video/timeline.json` may depend on the music or effects choice.
- **Video components** (`packages/video/src/runtime/`): every visual property must be a pure function of the frame time. No `Date`, no `Math.random` (use the seeded helper), no CSS transitions or animations. Text must fit its box (QC checks). Check changes by rendering an example and opening `video/contact-sheet.jpg`.
- **Platform behavior:** new CI features go in `packages/platforms` and the integration templates, exposed through CLI flags so the core stays unaware of the platform.

## Derived files

| Derived | Source | Regenerate | Check |
|---|---|---|---|
| `assets/covi/*.svg` | `packages/brand/src` (the fox, its tail, the mark, the logo) and `assets.ts` | `npm run assets` | `node scripts/generate-assets.ts --check` (also a test) |
| `dist/` | `packages/*/src` | `npm run build` (runs on `npm install`) | not committed |
| `.claude/skills`, `.agents/skills` | `skills/` (symlinks, for Claude Code and for Codex and other clients) | `npm run agents:sync` | `npm run agents:check` |

Never edit derived files by hand.

## Security model

Repositories under review are untrusted input.

- Covi runs project commands (`app.install`, `app.start`, `test.command`, `demo.commands`, `intelligence.command`) only when they come from configuration or from the user, with an allowlisted environment that excludes tokens, keys, and cloud credentials (`childEnv` in `packages/core/src/security/env.ts`).
- Locally, commands in repository configuration (and `app.url`, `app.env`, `app.passEnv`) take effect only after the user trusts that exact set for that repository (`covi trust`; `packages/core/src/security/trust.ts`). Untrusted ones are withheld with a message saying so.
- In CI, configuration is read from the **base** revision (an explicit `--config` inside the repository too), so a change cannot rewrite the commands its own review runs.
- Under `pull_request_target`, no project command runs (`ExecutionPolicy`); static pages can still be captured.
- Every artifact, log line, command record, model prompt, and video storyboard (the source of narration, captions, and frames) passes through the `Redactor`.
- Sound comes only from bundled data and validated scores; nothing runs and nothing is downloaded. A score is bounded (size, tracks, patterns, sections, note values, chord voicings and changes, tones per step, notes and seconds of sound per second of video) and scheduled for the video before anything is synthesized, and names resolve only to the score's own entries.
- PR/MR comments are re-rendered from schema-validated artifacts with all dynamic text escaped.
- Do not add code paths that bypass these.

## Testing

```bash
npm test                 # unit + integration tests (needs git; demo tests need Playwright Chromium)
npm run test:render      # also renders small videos (needs ffmpeg)
npm run typecheck        # Node code and the browser runtime
npm run lint             # Biome
npm run check            # all of the above, plus the derived-file checks
```

Add realistic scenarios as `examples/<name>/` (a `base/` tree, a `head/` overlay, and `change.yml` with expectations). The example tests assert intent, demonstration value, video decision, findings, and verdict for each.

## Code style

TypeScript on Node 22.18+, run without a build step:

- Import with `.ts` extensions.
- Use `import type` for types.
- Avoid syntax that cannot be stripped (no enums, namespaces, or constructor parameter properties).

Biome formats code (two spaces, single quotes, 100 columns). Keep modules focused; prefer small pure functions that are easy to test. Comments explain why, not what.
