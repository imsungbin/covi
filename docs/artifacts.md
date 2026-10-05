# Artifacts

Every Covi command that looks at a change writes a run: a directory of inspectable files plus a manifest, `run.json`. This page describes the layout, every file and the stage that writes it, the files agents may author, and how later commands re-enter a run.

## Where runs live

Runs are written to `.covi/runs/<run-id>/` inside the reviewed repository. Set `output.dir` (relative to the repository root) to use another directory; `covi report`, `covi render`, `covi publish`, and `covi runs` look for runs there too. Pass `--out <dir>` to write one run to an exact directory; the CI integrations do this so artifact paths are predictable.

```
.covi/
  config.yml                      your configuration (optional, committed)
  runs/
    .gitignore                    "*": the directory ignores itself
    LATEST                        id of the most recent run
    20261004-144549-review-b3c73b6/
    20261004-144752-analyze-b3c73b6/
  cache/
    .gitignore                    "*"
    tts/                          synthesized narration, reused across runs
```

**Run ids** are `<YYYYMMDD>-<HHMMSS>-<workflow>-<head7>`: the UTC start time, the workflow (`analyze`, `explain`, `review`, `demo`, `video`, `summarize`, `ci`), and the first seven characters of the head commit. If two runs start in the same second, the second gets a `-2` suffix.

**`LATEST`** holds the id of the newest run. `--run latest`, the default for `covi report`, `covi render`, and `covi publish`, reads it.

**Pruning.** When it creates a run, Covi deletes the oldest runs so that at most `output.keep` remain, counting the new one (default 20, allowed 1–1000). It only deletes directories whose names are run ids and that contain a `run.json`. A run written with `--out` does not prune anything and does not update `LATEST`.

**Nothing to commit.** The runs and cache directories each contain a `.gitignore` with `*`, so nothing Covi generates shows up in `git status`. Covi never edits your own `.gitignore`, and its own directories never make the working tree count as changed. A directory given with `--out` gets no `.gitignore`.

## run.json

The manifest records what was asked, what ran, what was produced, and how it ended. It is rewritten after every stage, so an interrupted run can still be inspected. The type is `RunManifest` in `packages/core/src/run/run.ts`.

| Field | Content |
|---|---|
| `schemaVersion` | `1` |
| `runId` | The run id |
| `covi.version` | The Covi version that produced the run |
| `workflow` | The command: `analyze`, `explain`, `review`, `demo`, `video`, `summarize`, or `ci` |
| `entryPoint` | `cli`; `agent` when run from a coding agent session; `github-action` or `gitlab-ci` from `covi ci` |
| `interactive` | Whether Covi was allowed to ask questions |
| `startedAt`, `finishedAt`, `durationMs` | Timing |
| `updatedAt` | When `covi report` or `covi render` last updated the outcome (absent until then) |
| `environment` | Node version, `<platform>-<arch>`, and the CI system when detected (`github-actions`, `gitlab-ci`, `buildkite`, `circleci`, `jenkins`, or `ci`) |
| `repository` | Name, remote URL without credentials, branch |
| `change` | Change id, `base` and `head` (`{ ref, sha }`), merge base, source, title, whether uncommitted work is included, and stats (files, additions, deletions, binary and ignored files) |
| `config` | `values`: the resolved configuration. `provenance`: for each dotted key, the layer that set it, such as `global` or `repository (.covi/config.yml)` |
| `language` | The language Covi resolved for the run: `value` (`en`, `ko`, `ja`, `zh`), the `setting` it came from (`auto` or a language), and `source`, why (for `auto`, the script found in the change's title, description, and commit messages) |
| `options` | The command, range, and flags it was given |
| `stages` | One entry per stage: `name`, `status` (`ok`, `skipped`, `failed`), `startedAt`, `durationMs`, and a `reason` (skipped) or `error` (failed) |
| `commands` | Every project command Covi ran: `command`, `cwd` (`.`, or `base` and `head` for the temporary checkouts), `exitCode`, `durationMs`, `timedOut`, and `purpose` (`install`, `start`, `tests`, or `demo: <name>`) |
| `artifacts` | Every recorded file: `path` (relative to the run), `kind`, `bytes`, `sha256` |
| `warnings`, `errors` | Things that degraded the run, and stage failures with their messages |
| `outcome` | `status` (`success`, `partial`, `failed`, `gated`), `exitCode`, `verdict`, finding counts by certainty, `gateFailures`, `video` (`rendered`, `reason`, `path` relative to the run, `seconds`), and a `message` |

Stage names are `understand`, `demonstrate`, `rules`, `model-analysis`, `tests`, `video`, and `report`. A run that stops on an error keeps the failed stage and the error, but has no `outcome`.

## Files

Paths are relative to the run directory. The kind is the `kind` recorded for the file in `run.json`.

### Understanding and review

| File | Kind | Written by | Content |
|---|---|---|---|
| `run.json` | | every command | The manifest |
| `context.json` | `context` | every command | The `ReviewContext` from the Understand phase: change digest, size, intent, areas, surfaces, symbols, routes, dependencies, environment variables, data changes, tests, demonstration assessment, reading order, signals |
| `diff.patch` | `diff` | every command | The change as a unified diff, rebuilt from the parsed hunks |
| `brief.md` | `brief` | `analyze` | The agent brief: author description, what Covi determined, signals, reading order, the prioritized diff, and next steps |
| `rule-findings.json` | `findings` | `analyze`, `review`, `video`, `summarize`, `ci` | Findings from the deterministic rules (plus observations from a demonstration in the same run), each with a stable id, and the list of what the rules checked |
| `explanation.draft.json` | `explanation` | `analyze` | Covi's structural explanation, a starting point for an agent's `explanation.json` |
| `explanation.json`, `explanation.md` | `explanation` | `explain`, `review`, `video`, `summarize`, `ci`, `report` | The explanation and its rendering |
| `findings.json` | `findings` | `review`, `video`, `summarize`, `ci`, `report` | The authored findings, dismissals, and the author's checked and not-verified lists. Without a model or an agent, the rule findings. |
| `review.json`, `review.md` | `review` | `review`, `video`, `summarize`, `ci`, `report` | The merged review: verdict, summary, findings shown, dismissals, what was checked and not verified, test results, who generated it; `review.json` also lists the findings beyond `review.maxFindings` under `omitted` |
| `summary.md` | `summary` | `review`, `video`, `summarize`, `ci`, `report` | A short summary for a PR/MR description or a chat message |
| `comment.md` | `comment` | `review`, `video`, `summarize`, `ci`, `report` | A preview of the PR/MR comment. `covi publish` re-renders the comment from the JSON files instead of posting this file. |

The Markdown files escape every piece of text that comes from the change (titles, paths, branch names, descriptions, and model-written text), so it renders as text: no links, images, HTML, or headings it did not ask for. Inline code stays code, and evidence sits in fences it cannot close. `review.md` is also what the GitHub job summary shows.

### Demonstration

Written when a demonstration runs: `covi demo` and `covi review --demo` on request, `covi video` when a video will be rendered and Covi can run the software, and `covi ci` whenever the recommendation is screenshots or video and Covi can run the software.

| File | Kind | Content |
|---|---|---|
| `demo/plan.json` | `capture` | The plan passed with `--plan`, as given (only then) |
| `demo/captures.json` | `capture` | The `Demonstration`: how the app ran, page and flow shots with image sizes, focus regions, and click points, command and request comparisons, what was skipped and why (including commands withheld because they are not trusted, or blocked under `pull_request_target`), and findings observed while running |
| `demo/demo.md` | `capture` | A readable summary with links to the images (`covi demo`, `covi review --demo`, and `covi video`; not `covi ci`) |
| `demo/screenshots/<page>-<viewport>-before.png`, `-after.png` | `screenshot` | Viewport-sized crops around the changed region, at base and head |
| `demo/screenshots/<page>-<viewport>-base.full.png`, `-head.full.png` | | The full-page captures the crops come from (not recorded in `run.json`) |
| `demo/screenshots/flow-<flow>-<NN>.png` | `screenshot` | Flow frames: one just before each labeled step's action, one at each `screenshot` step, and one at the end |
| `demo/diffs/<page>-<viewport>.png` | `screenshot` | The pixel difference between base and head |

### Video

Written by `covi video`, `covi render`, and `covi ci` when a video is rendered. See [Video](video.md).

| File | Kind | Content |
|---|---|---|
| `video/decision.json` | `storyboard` | Whether to render and why, the resolved video spec, and the demonstration assessment (`covi video` only). `covi render` reuses the spec from here. |
| `video/storyboard.json` | `storyboard` | The title, the template, and the scenes: story beat, labels, narration (also the captions), visual, the narrator's expression. Redacted before narration, captions, and frames are drawn from it. |
| `video/speech.json` | `narration` | What the voice was given: the narration `language` and why, the voice (`provider`, `name`, `locale`), whether it was `narrated`, and per scene the caption text (`narration`), the authored `say`, the text sent to the voice (`spoken`), and each rewrite (`from`, `to`, and the `rule`: `pronunciation`, `word`, `letters`, or `particle`). QC reads it. |
| `video/narration.wav` | `narration` | The mixed narration track (only when narrated) |
| `video/narration.md` | `narration` | The narration script with scene timings |
| `video/timeline.json` | `timeline` | Frame-exact layout of scenes, speech, captions, and the narrator's mouth movement |
| `video/captions.vtt`, `video/captions.srt` | `captions` | Captions (unless disabled) |
| `video/composition/` | `composition` | The HTML composition that draws each frame: `index.html`, `runtime.js`, `timeline.json`, and `assets/` (images and fonts). Only `index.html` is recorded in `run.json`. |
| `video/covi-review.mp4` | `video` | The video: H.264, with AAC narration audio when narrated |
| `video/poster.png` | `poster` | A representative frame |
| `video/contact-sheet.jpg` | `contact-sheet` | A grid of frames for checking the video at a glance |
| `video/qc.json` | `qc` | Quality checks with `pass`, `warn`, or `fail` and the measured format, duration, and loudness |

### CI reports

Written by `covi ci`. See [GitHub Action](github-action.md) and [GitLab CI](gitlab-ci.md).

| File | Kind | Platform |
|---|---|---|
| `reports/covi.sarif` | `report` | All |
| `reports/gl-code-quality-report.json` | `report` | GitLab (the Code Quality report) |
| `reports/covi.env` | `report` | GitLab (a dotenv report with `COVI_VERDICT`, `COVI_FINDINGS`, `COVI_RUN_DIR`, `COVI_VIDEO`) |

On GitHub, annotations go to the job log, and step outputs and the job summary go to the files GitHub provides; none of them are written into the run.

## Files agents author

An agent can write these files and hand them to Covi, which validates them against Zod schemas. `covi schema <name>` prints each schema as JSON Schema. A file that does not match fails with exit code 2 and a list of the problems.

| File | Schema | Used by |
|---|---|---|
| `explanation.json` in the run | `covi schema explanation` | `covi report` |
| `findings.json` in the run | `covi schema findings` | `covi report` |
| A demo plan, at any path | `covi schema demo-plan` | `covi demo --plan <file>`, `covi review --demo --plan <file>` (validated before the run starts; kept as `demo/plan.json`) |
| `video/storyboard.json` in the run, or any path | `covi schema storyboard` | `covi render`, `covi render --storyboard <file>`, `covi video --storyboard <file>` |
| `.covi/config.yml` (or `.covi/config.yaml`) | `covi schema config` | every command |

The objects are strict: unknown keys are rejected rather than ignored. A minimal `explanation.json`:

```json
{
  "depth": "standard",
  "headline": "GET /api/users now returns a paginated object instead of an array.",
  "summary": "The users endpoint wraps results in { items, page, pageSize, total } and reads the page size from USERS_PAGE_SIZE.",
  "intent": {
    "statement": "Paginate the users list so large accounts do not receive every user at once.",
    "confidence": "high",
    "evidence": ["Commit subject: feat(api): paginate GET /api/users"]
  }
}
```

A `findings.json` that adds one finding and dismisses a rule finding by its id from `rule-findings.json`:

```json
{
  "findings": [
    {
      "title": "Response shape change breaks existing clients",
      "certainty": "likely",
      "severity": "high",
      "category": "api-compatibility",
      "location": { "path": "app.js", "line": 10 },
      "evidence": "res.json(users) became res.json({ items, page, pageSize, total }).",
      "explanation": "Clients that iterate over the array will fail."
    }
  ],
  "dismissed": [
    { "id": "missing-tests-01e4a91d1b29", "reason": "Pagination is covered by test/users.test.js." }
  ],
  "checked": ["callers of GET /api/users in this repository"],
  "notVerified": ["external clients of the API"]
}
```

Dismissing an id that is not in `rule-findings.json` is an error (exit code 2).

## Schema versions

`explanation.json`, `findings.json`, and `video/storyboard.json` accept an optional `language` (`en`, `ko`, `ja`, or `zh`; `zh-CN` and `zh-Hans` are read as `zh`). It says what language the prose is in: reports rendered from the file use its headings, and a storyboard's language sets the narration language. Covi writes it on what it generates in Korean, Japanese, and Chinese, and on every drafted storyboard; English explanations and reviews leave it out, as before. Text Covi writes into `context.json` (signals, notes, reading order, ambiguities, demonstration reasons) and `rule-findings.json` is in the run's language too.

JSON files that agents write or that later stages read back carry `schemaVersion: 1`: `run.json`, `context.json`, `rule-findings.json`, `explanation.json`, `explanation.draft.json`, `findings.json`, `review.json`, `demo/captures.json`, and `video/storyboard.json`. Agent-authored files may omit it; it defaults to 1. A demo plan has no version field. `video/timeline.json` carries its own `version: 1`, read by the browser runtime; `video/speech.json` carries `schemaVersion: 1`; `video/decision.json` and `video/qc.json` are diagnostic records.

Additive changes, such as a new optional field, keep the version. A breaking change to a versioned file bumps `schemaVersion`. The configuration and the demo plan have no version, so they only grow: keys are added, never repurposed. Either way, the skills that describe the file are updated with it.

## Redaction

Repositories and CI environments contain secrets, so Covi redacts before anything reaches disk. The `Redactor` (`packages/core/src/security/redact.ts`) masks:

- the values of environment variables whose names look like credentials (containing `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `ACCESS_KEY`, `AUTH`, `SESSION`, `COOKIE`, `WEBHOOK`, `DSN`, `SIGNING`, and similar), wherever those values appear;
- known token formats: private keys, GitHub and GitLab tokens, Anthropic and OpenAI keys, AWS access keys and secret keys, Slack tokens and webhook URLs, Stripe live keys, Google API keys, npm tokens, and JSON Web Tokens;
- credential-shaped assignments such as `password = "…"`, and credentials embedded in URLs.

Masked values become `[REDACTED]`, sometimes after a short recognizable prefix.

The redactor is applied to every file written through the run: the JSON, Markdown, patch, caption, and report files listed above. In `run.json` it covers the change title, configuration values, options, warnings, errors, command lines, and the outcome message. It also covers HTTP response bodies and command output captured during demonstrations, the tail of test output, the brief sent to a model provider for analysis, and the narration-refinement prompt. The video storyboard is redacted before any later stage reads it, so the narration audio, the captions, the composition in `video/composition/`, and the text in video frames carry redacted values too. The spoken text in `video/speech.json` is redacted again after pronunciations are applied, before it reaches the voice. Commit authors are recorded by display name only, never by e-mail address, and remote URLs are stored without credentials.

Screenshots are pictures of the running software, and the video shows them as captured: Covi cannot redact what a page displays. Do not demonstrate pages that display secrets. Storyboard images must be files inside the run directory, so a storyboard cannot pull other files from the machine into a video.

## Re-entering a run

Commands that continue a run take `--run <ref>`, where `<ref>` is `latest` (the default), a run id, or a path to a run directory (absolute, containing `/`, or starting with `.`).

- **`covi report`** validates `explanation.json` and `findings.json` in the run, checks that every dismissal names an id in `rule-findings.json`, merges the authored findings with the rule findings, renders `explanation.md`, `review.json`, `review.md`, `summary.md`, and `comment.md`, and updates the run's `outcome` (verdict, finding counts, gate status). It rewrites the two input files in normalized form (defaults filled in, the explanation marked as written by an agent). If `explanation.json` is missing, Covi uses its structural explanation; if `findings.json` is missing, the review contains rule findings only. Both cases are recorded as warnings. A failed gate (`--fail-on` or `review.failOn`) exits with code 1.
- **`covi render`** validates the storyboard (`video/storyboard.json`, or `--storyboard <file>`), reads `review.json`, `explanation.json`, and `demo/captures.json` when present, re-reads the change from the base and head recorded in `run.json`, and renders into the run's `video/` directory. For runs of staged or uncommitted work, the change is read again from the current index or working tree. It keeps the video spec saved in `video/decision.json` when the storyboard was drafted (mode, size, length, style, captions, narration on or off, theme, frame rate, and voice); video flags such as `--no-narration` change only what they name, and choosing a different mode (`--short`, `--standard`, `--custom`, `--mode`) resets the size, length, and style that came with the old one. It updates only `outcome.video`.
- **`covi publish`** re-renders the comment from `review.json` and `explanation.json` (validated against their schemas) and `context.json` (only hex commit ids are printed from it), links the video recorded in `run.json`, and posts or updates the comment. With `--expect-head <sha>`, it refuses to publish a run that reviewed a different head commit. In a GitHub `workflow_run` event the expected head comes from the event, and the pull request is found from the event too, never from the run directory, which may come from an untrusted artifact. See [GitHub Action](github-action.md).

`covi report` and `covi render` append their stage (`report`, `video`) to `run.json`, update the artifact records and the outcome, and set `updatedAt`; the original timing stays. `covi publish` only reads the run. `covi runs list` lists runs, newest first; `covi runs show [ref]` prints a run's stages and artifacts.

With `--json`, commands that create or continue a run print a result object on stdout that includes `runId`, `runDir`, and absolute paths to the main artifacts. See [CLI](cli.md).
