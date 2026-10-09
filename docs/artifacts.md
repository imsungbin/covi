# Artifacts

Every Covi command that looks at a change writes a run: a directory of inspectable files plus a manifest, `run.json`. This page describes the layout, every file and the stage that writes it, the files agents may author, and how later commands re-enter a run.

## Where runs live

Runs are written to `.covi/runs/<run-id>/` inside the reviewed repository. Set `output.dir` (relative to the repository root) to use another directory; `covi report`, `covi render`, `covi publish`, `covi evidence`, and `covi runs` look for runs there too. Pass `--out <dir>` to write one run to an exact directory; the CI integrations do this so artifact paths are predictable.

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
    music/                        rendered music, keyed by everything it depends on
  subject/
    subject.json                  the subject model (subject.store: repo), meant to be committed
  outcomes/
    .gitignore                    "*"
    20261004-144549-ci-b3c73b6.json   what became of one change (covi outcomes collect)
```

**Run ids** are `<YYYYMMDD>-<HHMMSS>-<workflow>-<head7>`: the UTC start time, the workflow (`analyze`, `explain`, `review`, `demo`, `video`, `summarize`, `ci`), and the first seven characters of the head commit. If two runs start in the same second, the second gets a `-2` suffix.

**`LATEST`** holds the id of the newest run. `--run latest`, the default for `covi report`, `covi render`, and `covi publish`, reads it.

**Pruning.** When it creates a run, Covi deletes the oldest runs so that at most `output.keep` remain, counting the new one (default 20, allowed 1–1000). It only deletes directories whose names are run ids and that contain a `run.json`. A run written with `--out` does not prune anything and does not update `LATEST`.

**Outcomes** sit next to the runs, not inside them, because runs are pruned and outcomes must outlive them. `covi outcomes collect` writes one file per pull or merge request, named after the run that last updated Covi's comment there, and removes the older file for the same change. They hold ids, counts, states, certainties, and links, never text from the change or its comments. Reviews read at most the 200 newest, each at most 256 KB, and skip any that do not fit `covi schema outcome`; writing one removes any beyond the newest 200.

**Nothing to commit.** The runs, cache, and outcomes directories each contain a `.gitignore` with `*`, so nothing Covi generates shows up in `git status`, except the [subject model](#the-subject-model), which is meant to be committed. Covi never edits your own `.gitignore`, and its own directories never make the working tree count as changed. A directory given with `--out` gets no `.gitignore`. Outcome files are never read back if they are committed: in CI the checkout is the change under review. If git tracks any file under `.covi/outcomes/`, or `.covi` or `.covi/outcomes` is a symbolic link, Covi ignores the whole directory and warns.

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
| `publish` | Where `covi publish` posted the comment: `platform`, `repository`, `number`, `comment.id` and `url`, `at`. |

Stage names are `understand`, `demonstrate`, `rules`, `model-analysis`, `tests`, `video`, and `report`. A run that stops on an error keeps the failed stage and the error, but has no `outcome`.

## Files

Paths are relative to the run directory. The kind is the `kind` recorded for the file in `run.json`.

### Understanding and review

| File | Kind | Written by | Content |
|---|---|---|---|
| `run.json` | | every command | The manifest |
| `context.json` | `context` | every command | The `ReviewContext` from the Understand phase: change digest, size, intent, areas, surfaces, symbols, routes, dependencies, environment variables, data changes, tests, demonstration assessment, reading order, signals |
| `diff.patch` | `diff` | every command | The change as a unified diff, rebuilt from the parsed hunks |
| `evidence.json` | `evidence` | every command that starts a run; rewritten after a demonstration and after the review | The evidence registry: every diff hunk, screenshot, pixel diff, recording, trace, request, command, app start-up error, and test run in the run, with its id, kind, file, revision, sha256, and a short label. See [Evidence](#evidence). |
| `brief.md` | `brief` | `analyze` | The agent brief: author description, what Covi determined, how past findings held up (when `.covi/outcomes/` has enough), signals, reading order, the prioritized diff, and next steps |
| `rule-findings.json` | `findings` | `analyze`, `review`, `video`, `summarize`, `ci` | Findings from the deterministic rules (plus observations from a demonstration in the same run), each with a stable id, and the list of what the rules checked |
| `explanation.draft.json` | `explanation` | `analyze` | Covi's structural explanation, a starting point for an agent's `explanation.json` |
| `explanation.json`, `explanation.md` | `explanation` | `explain`, `review`, `video`, `summarize`, `ci`, `report` | The explanation and its rendering |
| `findings.json` | `findings` | `review`, `video`, `summarize`, `ci`, `report` | The authored findings, dismissals, and the author's checked and not-verified lists. Without a model or an agent, the rule findings. |
| `review.json`, `review.md` | `review` | `review`, `video`, `summarize`, `ci`, `report` | The merged review: verdict, summary, findings shown, dismissals, what was checked and not verified, test results, who generated it; `review.json` also lists the findings beyond `review.maxFindings` under `omitted` |
| `summary.md` | `summary` | `review`, `video`, `summarize`, `ci`, `report` | A short summary for a PR/MR description or a chat message |
| `comment.md` | `comment` | `review`, `video`, `summarize`, `ci`, `report` | A preview of the PR/MR comment. `covi publish` re-renders the comment from the JSON files instead of posting this file. |
| `tests.log` | `log` | `review`, `video`, `summarize`, `ci` when tests ran | The test command and the redacted tail of its output: the evidence `test-run:tests` names |

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
| `demo/screenshots/flow-<flow>-<NN>.png` | `screenshot` | Flow frames at head: one just before each labeled step's action, one at each `screenshot` step, and one at the end |
| `demo/screenshots/flow-<flow>-<NN>-base.png` | `screenshot` | The same flow frames at base; each is the `before` of the head frame for the same step |
| `demo/diffs/flow-<flow>-<step>.png` | `screenshot` | The pixel difference of a flow step that looks different at base and head |
| `demo/recordings/flow-<flow>-base.mp4`, `-head.mp4` | `recording` | Each flow at base and head, at the flow's viewport in CSS pixels (1280×800 on desktop). WebM (`.webm`) when ffmpeg is missing or converting fails; `captures.json` → `recording` says why. Not written with `--no-record` or `demo.record: false`. |
| `demo/traces/<scenario>-base.json`, `-head.json` | `trace` | What happened while a page loaded or a flow ran: steps (id, action, target, label, seconds from the start of the recording, duration, status, screenshot, target box, DOM changes), network requests (method, URL relative to the app, resource type, status or failure, timing), console messages (level, text, location), and DOM change counts and regions. No headers or bodies. |
| `demo/behavior-diff.json` | `behavior-diff` | Per scenario (page or flow) observed at both revisions: `status` (`changed`, `unchanged`, `incomplete`), steps that look different (at least 64 changed pixels, or 64 × scale² on a high-density viewport, however small a share of the frame; with region ids) or ended differently, requests added, removed, or answered with another status, console errors added or removed, and timing deltas of at least 500 ms and half the base time (timing alone never makes a scenario `changed`). Not written when only head ran (`app.url`). |
| `demo/subject.json` | `subject` | Demonstrations that saw anything at head (not with `subject.store: off`): the subject model as this run left it, and where each element is in each head capture |
| `demo/diffs/<page>-<viewport>.png` | `screenshot` | The pixel difference between base and head |
| `demo/app-base.log`, `demo/app-head.log` | `log` | Why the app did not start at that revision (`terminal:app-start-<revision>`); an `app-start` finding cites the head log |

**Ids.** A scenario is `flow-<flow>` or `<page>-<viewport>`, and its trace at a revision is `<scenario>-<revision>` (also the recording's file stem). Steps are `open`, `load` (a page), `s1`… (the flow's steps in order), and `end`, the same at base and head. Inside a trace, requests are `n1`… and console messages `c1`…; in `behavior-diff.json`, changed regions are `r1`… within their step. Claims cite them through [evidence ids](#evidence): `trace:flow-load-items-head#n2`, `pixel-diff:flow-load-items#end.r1`.

### Video

Written by `covi video`, `covi render`, and `covi ci` when a video is rendered. See [Video](video.md).

| File | Kind | Content |
|---|---|---|
| `video/decision.json` | `storyboard` | Whether to render and why, the resolved video spec, and the demonstration assessment (`covi video` only). `covi render` reuses the spec from here. |
| `video/storyboard.json` | `storyboard` | The title, the template, and the scenes: story beat, labels, narration (also the captions), visual, the narrator's expression. Redacted before narration, captions, and frames are drawn from it. |
| `video/speech.json` | `narration` | What the voice was given: the narration `language` and why, the voice (`provider`, `name`, `locale`), whether it was `narrated`, and per scene the caption text (`narration`), the authored `say`, the text sent to the voice (`spoken`), and each rewrite (`from`, `to`, and the `rule`: `pronunciation`, `word`, `letters`, or `particle`). QC reads it. |
| `video/narration.wav` | `narration` | The voice stem: every take in place, mono 48 kHz 16-bit, at −16 LUFS as heard on both channels (only when narrated) |
| `video/music.wav` | `audio` | The music stem as placed in the mix, stereo 48 kHz 16-bit, so it can be heard alone (only when music plays) |
| `video/audio.json` | `audio` | What the viewer hears besides the voice: the music (`use`, `source` and why, `id`, `placement`, `scoreBpm` and the fitted `bpm`, `key`, `start`, `sections`, the `hero` moment and downbeat and whether it is `clear` of speech, the `outro` settle moment, the `logo` start and landing, the `fade`, `tailDb`, how much music is `audible` outside the logo (`seconds`, `share`, and the `thresholdDbfs` and `window` measured with), `fallbacks`), the effects (`placed` with times, recipes, and gains; `dropped` with reasons), and the `levels` of the mix (`voiceLufs`, `musicBelowVoiceDb`, `musicRangeLu`, `musicJumps` with `maxDb`, `at`, and the `exempt` windows, `pausesHeld`, `effectsBelowVoiceDb`, `effectsCutDb`, and the master's `integrated` loudness and `truePeak`). QC reads it. |
| `video/score.json` | `audio` | The music score, when the music is composed: Covi's draft (the Covi theme, `"draft": true`), the agent's score, or the model's |
| `video/narration.md` | `narration` | The narration script with scene timings |
| `video/timeline.json` | `timeline` | Frame-exact layout of scenes (Covi's outro last, as a scene with the `outro` visual), speech, captions, the moments that carry a sound, and the narrator's mouth movement |
| `video/captions.vtt`, `video/captions.srt` | `captions` | Captions (unless disabled) |
| `video/composition/` | `composition` | The HTML composition that draws each frame: `index.html`, `runtime.js`, `timeline.json`, and `assets/` (images and fonts). Only `index.html` is recorded in `run.json`. |
| `video/covi-review.mp4` | `video` | The video: H.264, with the mix (AAC, 192 kb/s, 48 kHz stereo) when anything plays |
| `video/frames.json` | `composition` | A hash of the composition the frames were drawn from, and the layout reports QC sampled. When `covi render` finds the same hash, it keeps the frames and muxes only the new sound. |
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

## The subject model

The subject model is what Covi has seen of the software across runs. It lives in `.covi/subject/subject.json` (`subject.store: repo`, the default), small and meant to be committed so everyone's runs share it, or in `subject.json` in the runs directory (`subject.store: runs`), never committed. See [Configuration](configuration.md#subject). It holds:

- `revisions`: the distinct head commits (12 characters) at which a demonstration updated the model, newest first.
- `screens`: one per app path (without query, fragment, or trailing slash), with the page title, the viewports it was seen at and their sizes, and its elements. Each element has a selector Covi built from the attributes the page reported, a role, a label, and a box per viewport in image pixels from the top of the page. Each viewport and box records `since`, the revision it was first seen at.
- `flows`: browser flows that passed, with their path, viewport, steps, and step labels.
- `commands`: CLI and HTTP scenarios that ran, by name and outcome (an exit code; a method, a path without its query, and a status), never their command lines.

**Keys and references.** Every screen, element, flow, and scenario has a key of lowercase letters, digits, and dashes. A screen's key comes from its path (`/` is `home`), an element's from its test id, else its id, else its accessible name, and a flow's or scenario's from its name; a key that is taken gets `-2`, `-3`, and so on. A storyboard names an element as `subject:<screen>#<element>`, for example `subject:home#start-trial`. `covi subject` lists them.

**Updating.** A demonstration that saw anything at head merges what it saw into the model. Entries are matched by identity (a screen by its path, an element by its selector within its screen, a flow by its name, a scenario by its kind and name), and an entry keeps the key it was first given, so references survive a changed label. A box is updated only for the viewport that saw the element. The run's revision moves to the front of `revisions`, which keeps `subject.expireAfter` of them (20 by default); an entry, or a per-viewport box, last seen at a revision no longer kept is forgotten. An entry seen again gets the run's revision as its `seen` only once its old one is at least half that window old, so something still on screen is never forgotten, and something gone is forgotten between half and all of `expireAfter` revisions after it was last seen. A run that changes nothing records nothing, not even its revision, and leaves the file byte for byte as it was; a run that sees an element gone from a screen it scanned, or a kept flow fail, records its revision, so what is gone ages out. Running again at the same commit ages nothing, and a run that saw nothing at head changes nothing. Lists are written sorted by key, so the committed file changes only where the software did.

**Focus.** A page captured at head only (the app ran at head only, or base could not be captured) has no pixel diff to locate the change, so the model gives it a focus: the one to three elements new at this run's revision on a screen the model saw at that viewport before it. New means first seen at this revision, so a second run at the same commit (`covi demo`, then `covi video`) focuses the same way.

**Merge conflicts.** Two branches that each changed the committed model can conflict over it. Take either side (`git checkout --ours` or `--theirs` on the file), or delete it: the next run rebuilds what it sees. Covi recognizes a file left with conflict markers, plans without it, warns how to resolve it, and does not overwrite it. To keep the model out of the repository instead, use `subject.store: runs`.

**Bounds.** At most 100 screens, 60 elements per screen, 50 flows of at most 30 steps, 50 scenarios, and 100 revisions; every string is one line without control characters, and the file is at most 512 KB. Past a cap, what was seen longest ago goes first. A file over 512 KB is never parsed.

**Saving.** A run saves under a lock, `.subject.lock` in the runs directory. Under it, the run reads the store again, merges its observations into what it finds, and replaces the file atomically, so two runs racing both land. A run that waits 5 seconds for the lock gives up with a warning; what it saw is still in its `demo/subject.json`. A lock older than 30 seconds belongs to a run that died and is removed.

**A file Covi cannot read.** A store that is not JSON, does not match the schema (`covi schema subject`), is newer than this Covi reads, is larger than 512 KB, or is reached through a symbolic link is ignored with a warning: the run plans without it and never overwrites it. Fix or delete the file.

**The run's snapshot.** `demo/subject.json` is the model as the run left it, plus `images`: for every head capture (a page's `-after.png` crop and each head flow frame), the elements at least half visible in it and their boxes in that image's pixels. `covi render` places `subject:` references with the snapshot, never with a store that may have moved on. Base images are not indexed.

**Not evidence.** The model is memory accumulated over revisions, so an entry may describe a screen this run never saw. Nothing cites it: [evidence](#evidence) is what this run produced, including the screenshots and traces the model was built from.

## Evidence

`evidence.json` lists every piece of evidence in a run. Claims cite it: findings (`findings.json`), explanation statements (`intent`, `behavior`, and each entry of `changes` in `explanation.json`), and storyboard scenes, each in `evidenceIds`. `covi evidence --run <id> --json` prints it.

| Kind | Id | Revision |
|---|---|---|
| `diff-hunk` | `diff-hunk:<path>:<start>`, `<start>` being the `+` start of the hunk's `@@` header (`0` for a deleted file) | `both` |
| `screenshot` | `screenshot:<file name without .png>` | `base` for a before image, `head` for an after image |
| `pixel-diff` | `pixel-diff:<scenario>#<step>`; a changed region is `pixel-diff:<scenario>#<step>.r<N>` | `both` |
| `recording` | `recording:<scenario>-<revision>` | that revision |
| `trace` | `trace:<scenario>-<revision>`; a step, request, or console message in it is `…#<step>`, `…#n<N>`, `…#c<N>` | that revision |
| `http` | `http:<N>`, the N-th request in `demo/captures.json` | `both` when base answered too, else `head` |
| `terminal` | `terminal:<N>`, the N-th command in `demo/captures.json`; `terminal:app-start-<revision>` when the app did not start | `both`, `head`, or that revision |
| `test-run` | `test-run:tests` | `head` |

Each item has `path` (the run file that holds it), `sha256` (the file's, or for a hunk, request, or command, its own text's), a language-neutral `label` (redacted), a `location` for hunks, and `refs`, the parts that can be cited on their own.

Covi grounds what it writes. A rule finding cites the hunk at its location, a demo finding cites what it observed, Covi's explanation cites the hunks of each change's files and, for its intent, what those changes cite, and a scene cites what its visual shows from the run; a drafted review callout cites the finding it shows, or, with no findings, the hunks of the changed files. A model's findings keep only ids the run has and otherwise cite the hunk at their location. A confirmed or likely finding Covi wrote that has nothing to cite is reported as a risk; for a demonstration's or a model's finding, a run warning says so. What an agent writes is checked: `covi report` and `covi render` exit 2 on an id the run does not have, naming the claim, and `findings.json` version 2 requires at least one id on every confirmed or likely finding. Explanation statements and scenes without evidence are reported as warnings: by `covi report`, and by the `grounding` check in `video/qc.json`.

A run made before Covi kept a registry has no `evidence.json`. `covi evidence` rebuilds it in memory without writing, and `covi report` rebuilds and writes it.

## Files agents author

An agent can write these files and hand them to Covi, which validates them against Zod schemas. `covi schema <name>` prints each schema as JSON Schema. A file that does not match fails with exit code 2 and a list of the problems.

| File | Schema | Used by |
|---|---|---|
| `explanation.json` in the run | `covi schema explanation` | `covi report` |
| `findings.json` in the run | `covi schema findings` | `covi report` |
| A demo plan, at any path | `covi schema demo-plan` | `covi demo --plan <file>`, `covi review --demo --plan <file>` (validated before the run starts; kept as `demo/plan.json`) |
| `video/storyboard.json` in the run, or any path | `covi schema storyboard` | `covi render`, `covi render --storyboard <file>`, `covi video --storyboard <file>` |
| `video/score.json` in the run | `covi schema score` | `covi render` with `--music compose` (or `video.music.use: compose`). At most 64 KB, and only the bundled patches and kits; see `skills/covi-video/references/music.md`. |
| `.covi/config.yml` (or `.covi/config.yaml`) | `covi schema config` | every command |
| — | `covi schema evidence` | `evidence.json` is Covi's; the schema documents what `covi evidence` prints |
| — | `covi schema subject` | `.covi/subject/subject.json` is Covi's; the schema documents what `covi subject` prints |
| — | `covi schema outcome` | `.covi/outcomes/*.json` is Covi's; the schema documents what `covi outcomes collect` writes |

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

A `findings.json` that adds one finding, cites the diff hunk behind it, and dismisses a rule finding by its id from `rule-findings.json`:

```json
{
  "schemaVersion": 2,
  "findings": [
    {
      "title": "Response shape change breaks existing clients",
      "certainty": "likely",
      "severity": "high",
      "category": "api-compatibility",
      "location": { "path": "app.js", "line": 10 },
      "evidence": "res.json(users) became res.json({ items, page, pageSize, total }).",
      "evidenceIds": ["diff-hunk:app.js:8"],
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

Dismissing an id that is not in `rule-findings.json` is an error (exit code 2). So is citing an evidence id the run does not have, or leaving a confirmed or likely finding without one in version 2.

## Schema versions

`explanation.json`, `findings.json`, and `video/storyboard.json` accept an optional `language` (`en`, `ko`, `ja`, or `zh`; `zh-CN` and `zh-Hans` are read as `zh`). It says what language the prose is in: reports rendered from the file use its headings, and a storyboard's language sets the narration language. Covi writes it on what it generates in Korean, Japanese, and Chinese, and on every drafted storyboard; English explanations and reviews leave it out, as before. Text Covi writes into `context.json` (signals, notes, reading order, ambiguities, demonstration reasons) and `rule-findings.json` is in the run's language too.

JSON files that agents write or that later stages read back carry a `schemaVersion`: `findings.json` is at 2 (confirmed and likely findings cite evidence; version 1 files are still read, without that rule, and `covi report` warns about what it let through), and `run.json`, `context.json`, `rule-findings.json`, `explanation.json`, `explanation.draft.json`, `review.json`, `evidence.json`, `demo/captures.json`, `demo/traces/*.json`, `demo/behavior-diff.json`, `demo/subject.json`, `.covi/subject/subject.json`, `.covi/outcomes/*.json`, `video/storyboard.json`, `video/score.json`, `video/audio.json`, and `video/frames.json` are at 1. Agent-authored files may omit it; it defaults to the current version. A demo plan has no version field. `video/timeline.json` carries its own `version: 1`, read by the browser runtime; `video/speech.json` carries `schemaVersion: 1`; `video/decision.json` and `video/qc.json` are diagnostic records.

Additive changes, such as a new optional field, keep the version. A breaking change to a versioned file bumps `schemaVersion`. The configuration and the demo plan have no version, so they only grow: keys are added, never repurposed. Either way, the skills that describe the file are updated with it.

## Redaction

Repositories and CI environments contain secrets, so Covi redacts before anything reaches disk. The `Redactor` (`packages/core/src/security/redact.ts`) masks:

- the values of environment variables whose names look like credentials (containing `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `ACCESS_KEY`, `AUTH`, `SESSION`, `COOKIE`, `WEBHOOK`, `DSN`, `SIGNING`, and similar), wherever those values appear;
- known token formats: private keys, GitHub and GitLab tokens, Anthropic and OpenAI keys, AWS access keys and secret keys, Slack tokens and webhook URLs, Stripe live keys, Google API keys, npm tokens, and JSON Web Tokens;
- credential-shaped assignments such as `password = "…"`, and credentials embedded in URLs.

Masked values become `[REDACTED]`, sometimes after a short recognizable prefix.

The redactor is applied to every file written through the run: the JSON, Markdown, patch, caption, and report files listed above. In `run.json` it covers the change title, configuration values, options, warnings, errors, command lines, and the outcome message. It also covers HTTP response bodies and command output captured during demonstrations, the URLs and console messages in traces, where credential-shaped query and fragment parameters (`token`, `key`, `session`, `signature`, `code`, and similar) are masked too, the tail of test output, the brief sent to a model provider for analysis, the narration-refinement prompt, and the music-composition prompt. The video storyboard is redacted before any later stage reads it, so the narration audio, the captions, the composition in `video/composition/`, and the text in video frames carry redacted values too. The spoken text in `video/speech.json` is redacted again after pronunciations are applied, before it reaches the voice. Commit authors are recorded by display name only, never by e-mail address, and remote URLs are stored without credentials.

Screenshots and recordings are pictures of the running software, and the video shows them as captured: Covi cannot redact what a page displays. Do not demonstrate pages that display secrets. Storyboard images must be files inside the run directory, so a storyboard cannot pull other files from the machine into a video.

## Re-entering a run

Commands that continue a run take `--run <ref>`, where `<ref>` is `latest` (the default), a run id, or a path to a run directory (absolute, containing `/`, or starting with `.`).

- **`covi report`** validates `explanation.json` and `findings.json` in the run, checks every evidence id they cite against `evidence.json`, checks that every dismissal names an id in `rule-findings.json`, merges the authored findings with the rule findings, renders `explanation.md`, `review.json`, `review.md`, `summary.md`, and `comment.md`, and updates the run's `outcome` (verdict, finding counts, gate status). It rewrites the two input files in normalized form (defaults filled in, the explanation marked as written by an agent). If `explanation.json` is missing, Covi uses its structural explanation; if `findings.json` is missing, the review contains rule findings only. Both cases are recorded as warnings. A failed gate (`--fail-on` or `review.failOn`) exits with code 1.
- **`covi render`** validates the storyboard (`video/storyboard.json`, or `--storyboard <file>`) and the evidence ids its scenes cite, reads `review.json`, `explanation.json`, and `demo/captures.json` when present, re-reads the change from the base and head recorded in `run.json`, and renders into the run's `video/` directory. For runs of staged or uncommitted work, the change is read again from the current index or working tree. It keeps the video spec saved in `video/decision.json` when the storyboard was drafted (mode, size, length, style, captions, narration on or off, theme, frame rate, and voice); video flags such as `--no-narration` change only what they name, and choosing a different mode (`--short`, `--standard`, `--custom`, `--mode`) resets the size, length, and style that came with the old one. It updates only `outcome.video`.
- **`covi publish`** re-renders the comment from `review.json` and `explanation.json` (validated against their schemas) and `context.json` (only hex commit ids are printed from it), links the video recorded in `run.json`, and posts or updates the comment. With `--expect-head <sha>`, it refuses to publish a run that reviewed a different head commit. In a GitHub `workflow_run` event the expected head comes from the event, and the pull request is found from the event too, never from the run directory, which may come from an untrusted artifact. See [GitHub Action](github-action.md).

`covi report` and `covi render` append their stage (`report`, `video`) to `run.json`, update the artifact records and the outcome, and set `updatedAt`; the original timing stays. `covi publish` and `covi evidence` only read the run. `covi runs list` lists runs, newest first; `covi runs show [ref]` prints a run's stages and artifacts.

With `--json`, commands that create or continue a run print a result object on stdout that includes `runId`, `runDir`, and absolute paths to the main artifacts. See [CLI](cli.md).
