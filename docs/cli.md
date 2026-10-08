# CLI reference

This page documents every `covi` command and flag, how to choose the change to work on, the `--json` result object, exit codes, and the environment variables Covi reads. For a guided introduction, see [Getting started](getting-started.md).

```
covi [global options] <command> [options] [range]
```

From a checkout, run `./bin/covi`, `./bin/covi.mjs`, or `npm run covi -- <args>` in place of `covi`. `covi help <command>` and `covi <command> --help` print the built-in help.

## Global options

Global options work before or after the command name.

| Option | Meaning |
|---|---|
| `-C, --repo <path>` | Repository to work in. Default: the current directory. Any path inside the repository works; Covi operates on the repository root. |
| `-c, --config <file>` | Configuration file to use instead of `.covi/config.yml`. The path is relative to the current directory. See [Configuration](configuration.md). |
| `--json` | Print a machine-readable result on stdout. Progress and logs go to stderr. Never asks questions. |
| `-q, --quiet` | Print only problems. The result is printed only when the exit code is not 0. |
| `-v, --verbose` | Debug logging. |
| `--no-color` | Disable colors. Setting `NO_COLOR` does the same. Without either, Covi colors output only at a terminal or in CI logs; `FORCE_COLOR` forces colors on. |
| `-y, --yes` | Never ask questions; use configured values and defaults. For `covi trust`, confirm without a prompt. |
| `--trust-commands` | Use the commands in the repository's configuration for this run even if they are not trusted on this machine yet (see [`covi trust`](#covi-trust)). |
| `-V, --version` | Print the Covi version. |
| `-h, --help` | Help for Covi or for a command. |

## Choosing the change

`analyze`, `explain`, `review`, `demo`, `video`, and `summarize` work on one change. They share these arguments:

| Option | Meaning |
|---|---|
| `[range]` | What to review: a base ref (`main`), `A..B`, `A...B`, or `<sha>^!`. |
| `--base <ref>` | Base revision, with merge-base semantics like a pull request. |
| `--head <ref>` | Head revision. Requires `--base`. |
| `--staged` | Only staged changes. |
| `--uncommitted` | Only uncommitted changes: staged, unstaged, and untracked. |
| `--committed` | Ignore uncommitted work. |
| `--fetch` | Fetch missing commits from `origin` (for shallow clones). |
| `--out <dir>` | Write the run to this exact directory instead of `.covi/runs/<run-id>/`. |

What each form compares:

| You pass | Base | Head |
|---|---|---|
| nothing | merge base of the detected base branch and `HEAD` | `HEAD`, plus uncommitted work |
| `main`, or `--base main` | merge base of `main` and `HEAD` | `HEAD`, plus uncommitted work |
| `--base main --head feature` | merge base of `main` and `feature` | `feature` |
| `A..B` | `A` | `B` |
| `A...B` | merge base of `A` and `B` | `B` |
| `abc1234^!` | the commit's parent (the empty tree for a root commit) | `abc1234` |
| `--staged` | `HEAD` | the index |
| `--uncommitted` | `HEAD` | the working tree, including untracked files |

Details:

- **Empty side of a range:** an empty side means `HEAD`, so `main..` is `main..HEAD`.
- **Base branch:** with no arguments, the base branch is the configured `base`, tried as `origin/<base>` and then `<base>`. Otherwise Covi uses the first of these that exists: `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`, `origin/trunk`, `trunk`, `origin/develop`, `develop`.
- **No commits beyond the base:** Covi reviews uncommitted work against `HEAD`. If there is none either, it prints `No changes: …` and exits 0 without creating a run.
- **Uncommitted work:** included only when the head is implicit and the working tree is dirty. Untracked files count unless git ignores them. Covi's own `.covi/runs/` and `.covi/cache/` never count.
- **Usage errors (exit 2):**
  - A range together with `--base` or `--head`.
  - `--staged` or `--uncommitted` together with a range or `--base`.
  - `--head` without a base.
  - A revision that starts with `-`.
- **`--fetch`:** fetches a missing revision from `origin` (depth 50). If the clone is shallow, it deepens the history until a merge base appears. `covi ci` always does this.

## Shared option groups

**Language** (`analyze`, `explain`, `review`, `demo`, `video`, `summarize`, `report`, `render`, `ci`):

| Option | Meaning |
|---|---|
| `--language <code>` | The language Covi writes and narrates in: `auto` (detected from the change's title, description, and commits), `en`, `ko`, `ja`, or `zh` (Simplified Chinese; `zh-CN` and `zh-Hans` also work). On `report` it rewrites the reports in that language; on `render` it sets the narration language. See [Configuration](configuration.md#language). |

**Intelligence** (`analyze`, `explain`, `review`, `video`, `summarize`, `ci`):

| Option | Meaning |
|---|---|
| `--provider <provider>` | Who does the reasoning: `auto`, `heuristic`, `anthropic`, or `command`. See [Configuration](configuration.md#intelligence). |
| `--model <id>` | Model id for the `anthropic` provider. Default: `claude-opus-5-5`. |

**Video** (`video`, `render`, `ci`):

| Option | Meaning |
|---|---|
| `--short` | Short-form: vertical 9:16 (1080×1920), about 30 seconds (20–35). |
| `--standard` | Standard review: 16:9 (1920×1080), up to 120 seconds. |
| `--custom` | Custom size; use `--width` and `--height`. |
| `--mode <mode>` | The mode by name: `short`, `standard`, or `custom`. Same as the three flags above. |
| `--width <px>`, `--height <px>` | Size, 240–3840 pixels. For `custom`, a missing side is filled to 16:9. |
| `--duration <time>` | Target length: `30s`, `1m30s`, `90`, or `auto`. |
| `--fps <n>` | Frames per second, 10–60. Default: 30. |
| `--narration`, `--no-narration` | Force narration on, or captions only with no voice. |
| `--no-captions` | No burned-in captions. |
| `--voice <name>` | Voice for the speech engine. |
| `--tts <provider>` | Speech engine: `auto`, `system`, `openai`, `elevenlabs`, or `none`. |
| `--theme <theme>` | Color theme: `light` or `dark`. |
| `--music <music>` | Background music: `theme` (the Covi theme, default), `compose` (a score written for this video), or `none`. See [Video](video.md#sound). |
| `--music-placement <placement>` | Where the music plays: `auto` (the kind of video decides, default), `continuous` (a quiet bed under the narration), or `bookends` (around the narration only). See [Video](video.md#where-the-music-plays). |
| `--no-sound-effects` | No sound effects for clicks, the before/after reveal, findings, the verdict, and the outro. |
| `--outro`, `--no-outro` | End with Covi's branded outro (default), or hold the last scene for a second instead. See [Video](video.md#the-outro). |

Every flag maps to a configuration key. On the command line it is the highest-precedence layer; see [Configuration](configuration.md#precedence).

## Commands

### `covi analyze [range]`

Understands a change and writes an agent brief. This starts an [agent-driven review](#agent-driven-reviews).

- **Options:** change selection, intelligence.
- **Writes:**
  - `context.json`: the structured understanding.
  - `diff.patch`: the redacted diff.
  - `rule-findings.json`: deterministic findings with ids.
  - `explanation.draft.json`: a structural explanation to start from.
  - `brief.md`: signals, reading order, the prioritized diff, and next steps for the agent.
- **Result `data`:** `intent`, `size`, `demonstration` (`value`, `kinds`, `recommendation`), and `ruleFindings` (`id`, `title`, `certainty`, `severity`, `location`).

### `covi explain [range]`

Explains what changed, why, and what reviewers should know, and prints the explanation. With a model provider, the model writes it. Otherwise Covi builds a structural explanation from its understanding of the change.

- **Options:** change selection, intelligence.
- **Writes:** `context.json`, `diff.patch`, `explanation.json`, `explanation.md`.
- **Result `data`:** `explanation`.

### `covi review [range]`

Reviews a change: an explanation, evidence-based findings, and a verdict.

| Option | Meaning |
|---|---|
| `--fail-on <level>` | Exit 1 when confirmed or likely findings reach this severity: `none`, `low`, `medium`, or `high`. |
| `--max-findings <n>` | Findings to show (1–50). The rest are kept in `review.json` under `omitted`. |
| `--run-tests` | Run `test.command` as part of the review. |
| `--demo` | Also run the software and capture the change (see `covi demo`). Observed differences become findings. |
| `--plan <file>` | With `--demo`: the demo plan to follow. Without `--demo` it is a usage error (exit 2). |
| `--record` | With `--demo`: record browser flows at base and head (the default), and exit 3 if they cannot be recorded. |
| `--no-record` | With `--demo`: do not record browser flows; screenshots, traces, and the behavior diff are still written. |

Plus change selection and intelligence options.

- **Writes:**
  - `context.json`, `diff.patch`, `rule-findings.json`.
  - `explanation.json`, `explanation.md`.
  - `findings.json`, `review.json`, `review.md`.
  - `summary.md`, `comment.md`.
  - With `--demo`, also `demo/`: `captures.json`, screenshots, diffs, `recordings/`, `traces/`, `behavior-diff.json`, `demo.md`, and `plan.json` when you passed `--plan`.
- **Tests:** with `--run-tests` (or `review.runTests`), `test.command` runs only if it is trusted on this machine; otherwise "Not verified" says why.
- **Verdicts:** `looks-good`, `needs-attention`, or `needs-changes`.
- **Result `data`:** `review`.

Only confirmed and likely findings can fail the gate. A risk or a question never does.

### `covi demo [range]`

Runs the software at the base and head revisions and captures what changed. It never modifies your working tree; each revision is checked out into a temporary directory.

| Option | Meaning |
|---|---|
| `--plan <file>` | Demo plan JSON (pages, flows, commands, requests, viewports). See `covi schema demo-plan`. Covi validates it before running anything; an invalid plan exits 2 with one line per problem. |
| `--record` | Record browser flows at base and head (the default), and exit 3 if they cannot be recorded. |
| `--no-record` | Do not record browser flows; screenshots, traces, and the behavior diff are still written. |

Plus change selection options.

- **What it captures:** the union of the plan, the `demo` section of the configuration, and what Covi detects. Covi detects these targets:
  - pages rendered by changed files: static HTML, and file-based routes such as Next.js `app/` and `pages/` or SvelteKit `routes/`;
  - parameter-free `GET` routes.
- **Viewports:** `covi demo` captures desktop and mobile unless the plan or `demo.viewports` says otherwise.
- **How it runs the app:** `app.start`, `app.url`, or `app.static` (see [Configuration](configuration.md#app)). Commands from the repository's configuration run only once trusted on this machine (see [`covi trust`](#covi-trust)); untrusted ones are skipped, and `captures.json` says so.
- **Writes:**
  - `demo/plan.json`, when you passed `--plan`.
  - `demo/captures.json`.
  - `demo/screenshots/`, with before and after images.
  - `demo/diffs/`, with pixel diffs.
  - `demo/recordings/`, each flow at base and head (MP4, or WebM without ffmpeg).
  - `demo/traces/`, one trace per page and flow per revision.
  - `demo/behavior-diff.json`.
  - `demo/demo.md`.
- **Findings:** a difference Covi observes becomes a finding when you run `covi review --demo`, `covi video`, or `covi ci`. Examples are a changed response shape, a new server error, a page error, or a failing command.
- **Result `data`:** `demo`.
- **Exit code:** 3 when the demonstration cannot run at all, for example because Chromium is missing, or when recording was asked for (`--record`, `COVI_DEMO_RECORD`, or `demo.record` in the repository's configuration) and flows cannot be recorded. When there is nothing to demonstrate, the result says why.

### `covi video [range]`

Makes a review video when seeing the change helps. Covi first decides whether a video is worthwhile. It declines for changes with nothing user-visible and says why; `--force` overrides that. When it renders, it demonstrates the change when it can, reviews it, drafts a storyboard, narrates, renders, and runs quality checks.

| Option | Meaning |
|---|---|
| `--request <text>` | The request in plain words, e.g. `"30-second vertical video"`. Covi infers mode, length, size, narration, captions, theme, music, and sound from it. |
| `--template <id>` | Storytelling template (see `covi templates`). |
| `--storyboard <file>` | Render this storyboard instead of drafting one. This implies `--force`. |
| `--draft` | Write `video/storyboard.json` and stop, so it can be edited before `covi render`. |
| `--dry-run` | Print the resolved video plan and the questions worth asking, then stop. See [Video planning](#video-planning). |
| `--force` | Render even when Covi judges a video unhelpful. |
| `--workers <n>` | Parallel render workers, 1–64. |
| `--record` | Record browser flows at base and head (the default), and exit 3 if they cannot be recorded. |
| `--no-record` | Do not record browser flows; screenshots, traces, and the behavior diff are still written. |

Plus change selection, intelligence, and video options.

- **Questions:** at an interactive terminal, Covi asks for the video type and length when nothing decided them. Choosing Custom then asks for the size; a custom size alone (for example "a square video") asks for the length (see [Getting started](getting-started.md#when-covi-asks-questions)). While it asks, it also asks about music if nothing decided it; at a terminal, composing is offered only when a model provider can write the score.
- **Music:** the Covi theme by default, placed by the kind of video, with subtle sound effects. When nobody chose the music, the result's `video.music.hint` says how to change it.
- **Decision:** `video.when: never` declines unless you pass `--force`; `video.when: always` renders even when Covi would decline.
- **Viewports:** demonstrations for a video capture desktop and mobile unless `demo.viewports` says otherwise; vertical videos use the mobile captures.
- **Gate:** `covi video` never fails on findings.
- **Writes:**
  - The review artifacts, and `demo/` when Covi could demonstrate the change.
  - `video/decision.json`, `video/storyboard.json`, `video/timeline.json`.
  - `video/narration.md` (the script with timings), `video/narration.wav`, `video/captions.vtt`, `video/captions.srt`.
  - `video/audio.json` (music, effects, and the levels of the mix), `video/music.wav` (when music plays), `video/score.json` (composed music).
  - `video/composition/`, `video/covi-review.mp4`, `video/frames.json`.
  - `video/poster.png`, `video/contact-sheet.jpg`, `video/qc.json`.
- **More:** see [Video](video.md).

### `covi summarize [range]`

Writes a short summary for a pull or merge request description, a changelog, or a chat message. It runs a review and prints only the summary, so it pipes cleanly:

```bash
covi summarize --format text | pbcopy
```

| Option | Meaning |
|---|---|
| `--format <format>` | `markdown` (default), `text` (one paragraph), or `json` (`headline`, `summary`, `changes`, `verdict`). |

Plus change selection and intelligence options. With the global `--json`, it prints the standard result object instead, with the summary in `data.summary`.

### `covi report`

Validates agent-written `explanation.json` and `findings.json` in a run, merges them with the rule findings, and renders `review.md`, `review.json`, `explanation.md`, `summary.md`, and `comment.md`.

Every evidence id the files cite must be in the run (exit 2 names the file, the claim, and the id), and in `findings.json` version 2 every confirmed or likely finding cites at least one. Explanation statements that cite nothing are recorded as warnings.

| Option | Meaning |
|---|---|
| `--run <id>` | Run id, run directory, or `latest` (default). |
| `--fail-on <level>` | Exit 1 when confirmed or likely findings reach this severity. |

`covi report` also updates the run's recorded outcome in `run.json` (verdict, findings, gate, status) and sets `updatedAt`, so `covi runs` shows the agent's review. See [Agent-driven reviews](#agent-driven-reviews).

### `covi render`

Renders, or re-renders, a run's storyboard into a video. It uses the run's explanation, review, and captures.

| Option | Meaning |
|---|---|
| `--run <id>` | Run id, run directory, or `latest` (default). |
| `--storyboard <file>` | Storyboard to render. Default: `video/storyboard.json` in the run. |
| `--workers <n>` | Parallel render workers, 1–64. |

Plus video options. Without a storyboard, it exits 2 and suggests `covi video --draft`.

`covi render` keeps the settings chosen when the storyboard was drafted (the spec in `video/decision.json`, music, its placement, and the outro included), so `covi video --standard --draft` followed by `covi render` renders a standard video. Video flags change those settings; a different mode also resets the size, length, and style that came with the old one. Rendering updates only the video part of the run's outcome in `run.json`.

With `--music compose`, `covi render` plays `video/score.json` when the run has one (an agent wrote it; an invalid score exits 2), composes one with the configured model provider when it does not, and otherwise uses the Covi theme with a warning.

Frames never depend on the sound. When only the music, its placement, or the effects changed (`covi render --run <id> --music none`), Covi finds the composition unchanged (`video/frames.json`), keeps the rendered frames, mixes the new sound into the existing video, runs QC again, and says "Reused the rendered frames; only the audio changed." It takes seconds.

### `covi ci`

Runs Covi in GitHub Actions or GitLab CI. It is never interactive. It takes the change from the platform: the pull request or merge request base and head, title, and description.

| Option | Meaning |
|---|---|
| `--platform <platform>` | `auto` (default; detected from `GITHUB_ACTIONS` or `GITLAB_CI`), `github`, `gitlab`, or `local`. |
| `--fail-on <level>` | Exit 1 when confirmed or likely findings reach this severity. |
| `--video <when>` | Render a video: `auto` (when useful), `always`, or `never`. |
| `--no-annotations` | Do not annotate findings inline on GitHub. On GitLab, the Code Quality report is written empty. |
| `--comment`, `--no-comment` | Post or update the summary comment, or skip it (for example, when a later step publishes). Default: `publish.comment`. |
| `--run-tests` | Run `test.command`. |
| `--out <dir>` | Write the run to this exact directory. |
| `--record` | Record browser flows at base and head (the default), and exit 3 if they cannot be recorded. |
| `--no-record` | Do not record browser flows; screenshots, traces, and the behavior diff are still written. |

Plus intelligence and video options.

On GitHub and GitLab, `covi ci` reads `.covi/config.yml` from the base revision, so a change cannot reconfigure its own review; an explicit `--config` file inside the repository is read from the base revision too. That configuration is the repository maintainers', so its commands need no `covi trust`. It always fetches missing history.

`covi ci` demonstrates the change whenever seeing it helps and Covi can run the software (the demonstration recommendation is not text-only), whether or not it renders a video. Captures default to desktop and mobile. Under `pull_request_target`, which runs with secrets, no project command runs: no `app.install`, `app.start`, demo commands, or tests. Static pages can still be captured, because serving files runs no project code.

Besides the usual review artifacts it writes:

- `reports/covi.sarif` on every platform.
- **GitHub:**
  - Annotations on stdout.
  - The job summary (`GITHUB_STEP_SUMMARY`).
  - Step outputs (`GITHUB_OUTPUT`): `run-dir`, `verdict`, `findings-count`, `video-path`, `summary-path`, `review-path`, `sarif-path`, and `gate-failures`.
- **GitLab:**
  - `reports/gl-code-quality-report.json`, a Code Quality report.
  - `reports/covi.env`, a dotenv report with `COVI_VERDICT`, `COVI_FINDINGS`, `COVI_RUN_DIR`, and `COVI_VIDEO`.

`--platform local` runs the same workflow outside CI against the committed change. It reads the working-tree configuration, so its commands need trust like any local run.

See [GitHub Action](github-action.md), [GitLab CI](gitlab-ci.md), and [Security](security.md).

### `covi publish`

Posts or updates the summary comment for a finished run. Covi re-renders the comment from the run's schema-validated `review.json` and `explanation.json`, with dynamic text escaped; from `context.json` it prints only the base and head commit ids, and only when they are hexadecimal. Free-form Markdown from the run is never posted. One comment per pull or merge request is updated in place.

| Option | Meaning |
|---|---|
| `--run <id>` | Run id, run directory, or `latest` (default). Ids and `latest` are looked up in the configured runs directory (`output.dir`). |
| `--platform <platform>` | `auto` (default), `github`, or `gitlab`. |
| `--number <n>` | The pull or merge request to comment on, when the event does not name one. |
| `--expect-head <sha>` | Refuse (exit 2) unless the run reviewed this commit. |
| `--artifact-url <url>` | Link to the uploaded run artifacts. |
| `--video-url <url>` | Link to the video. |

In a GitHub `workflow_run` event (the [fork-safe pattern](github-action.md)), Covi takes the target from the trusted event, never from the run directory:

- **Pull request:** the one the event names, or, for a fork (GitHub leaves the event's list empty), the open pull request whose head is the event's head commit.
- **Expected head:** the event's head commit, unless `--expect-head` is given. A run that reviewed any other commit is refused with exit 2.
- **Moved on:** if the pull request no longer points at that commit, Covi skips the comment; the newer run comments instead.
- **Links:** to the run that reviewed the change, where its artifacts are.

Tokens come from:

- **GitHub:** `COVI_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN`.
- **GitLab:** `COVI_GITLAB_TOKEN` or `GITLAB_TOKEN`. Use a project or personal access token with the `api` scope; `CI_JOB_TOKEN` cannot write notes.

When publishing is skipped or the platform refuses it, the result says why and the exit code stays 0. Covi skips publishing when there is no token, when it cannot tell which pull or merge request to comment on, or in an untrusted context such as a fork's pull request run (its token cannot write anyway) unless `--number` is given.

### `covi init`

Creates `.covi/config.yml` from what Covi can detect safely. It detects:

- the base branch;
- a static site with an `index.html`;
- a `dev`, `start`, `preview`, or `serve` script, with an install command for npm, pnpm, or yarn;
- a test script.

`--force` overwrites an existing file. Video settings are written commented out, so interactive sessions still ask about them. Covi trusts the commands it writes for this repository on this machine and says so. With `--json`, the result lists them under `trusted`. See [Configuration](configuration.md#covi-init) for example output.

### `covi trust`

Shows the commands this repository's `.covi/config.yml` asks Covi to run and trusts them for this repository on this machine. Until then, Covi does not use them locally: it withholds `app.install`, `app.start`, `app.url`, `app.env`, `app.passEnv`, `test.command`, `demo.commands`, and `intelligence.command`, and says so in a warning on each run. See [Configuration](configuration.md#trusted-commands).

| Option | Meaning |
|---|---|
| `--revoke` | Forget the commands trusted for this repository. |

- **Confirmation:** at a terminal, Covi lists the commands and asks. Otherwise it needs the global `--yes`; without it, Covi prints the commands on stderr and exits 2:

  ```console
  $ covi trust
  .covi/config.yml asks Covi to run:
    app.install: npm ci
    app.start: npm run dev -- --port {port}
    app.url: http://127.0.0.1:{port}
    test.command: npm run test:ci
  error Refusing to trust commands without confirmation.
  hint: Review the commands above, then run `covi trust --yes`.
  ```

- **Exact set:** trust covers exactly these values for this repository path. Changing any of them, for example by checking out a branch that edits the file, withholds them again until you trust the new set.
- **`--config <file>`:** a file you pass with `--config` is your own choice, so Covi uses its commands without asking for trust.
- **Result with `--json`:** `{ "repository", "source", "commands", "trusted": true }`, or `{ "repository", "revoked" }` with `--revoke`. Without `--yes` when nobody can be asked, it exits 2 with `{ "ok": false, "error", "hint", "repository", "source", "commands", "trusted": false }`, so an agent can show the user the exact commands before confirming.

The global `--trust-commands` flag, or `COVI_TRUST_COMMANDS=1`, uses the commands for one run without recording trust.

### `covi doctor`

Checks the environment: Node.js, git, the repository, the configuration, whether its commands are trusted here (`commands`), the reasoning provider, the speech engine, whether the runs directory can be written, ffmpeg, and Chromium. `✓` means ready, `!` a missing optional capability, and `✗` a blocker. Exits 3 when any check fails. With `--json`, it prints a list of `{ id, status, message, hint? }`. It changes nothing on disk.

| Option | Meaning |
|---|---|
| `--install-browser` | First download the Chromium build that this Covi version's Playwright uses, then check only the browser. Exits 3 if the browser still does not launch. |
| `--with-deps` | With `--install-browser`: also install the system libraries Chromium needs (Linux; Playwright asks for root through `sudo`). |

Installing through Covi keeps the browser in step with Covi's Playwright version, which a separately run `npx playwright` may not.

### `covi runs`

| Command | Meaning |
|---|---|
| `covi runs`, `covi runs list` | Recent runs in the runs directory (`output.dir`, default `.covi/runs/`): id, status, verdict, and title. `--json` prints all of them. |
| `covi runs show [id]` | One run's stages (with durations), and its artifacts. `id` is a run id, a directory, or `latest` (default). `--json` prints the full `run.json`. |

### `covi evidence`

Lists a run's evidence: every id a finding, explanation statement, or storyboard scene can cite (see [Evidence](artifacts.md#evidence)). Read-only.

| Option | Meaning |
|---|---|
| `--run <id>` | Run id, run directory, or `latest` (default). |

Without `--json`, one line per item: id, kind, revision, label. With `--json`, the result object with `data.items` (the registry's items), `data.schemaVersion`, and `data.source`: `file` when the run has `evidence.json`, `rebuilt` when it was made before Covi kept one (rebuilt in memory, nothing written; `artifacts.evidence` is then absent).

### `covi schema <name>`

Prints the JSON Schema of a file agents author or read: `explanation`, `findings`, `storyboard`, `score`, `demo-plan`, `config`, or `evidence` (what `covi evidence` prints).

### `covi templates`

| Command | Meaning |
|---|---|
| `covi templates`, `covi templates list` | Storytelling templates for videos, with their beats. |
| `covi templates show <id>` | One template as JSON. |

### `covi skills`

| Command | Meaning |
|---|---|
| `covi skills`, `covi skills list` | Covi's skills and their descriptions. |
| `covi skills show <name>` | A skill's instructions. |
| `covi skills install` | Install the skills for an agent client. |

`covi skills install` options:

| Option | Meaning |
|---|---|
| `--target <client>` | `claude` (default; `.claude/skills/`), or `codex` or `agents` (both `.agents/skills/`, where Codex and other clients that follow the shared layout look). |
| `--global` | Install for the user (`~/.claude/skills/` or `~/.agents/skills/`) instead of this repository. |
| `--dest <dir>` | Install into this directory. |

It refuses to overwrite a skill directory it did not install. See [Skills](skills.md).

### `covi examples`

| Command | Meaning |
|---|---|
| `covi examples`, `covi examples list` | The bundled example changes and what Covi should conclude about each. |
| `covi examples create <name>` | Build a git repository containing the example change and print its path on stdout (a hint goes to stderr, so `dir=$(covi examples create …)` works). `--into <dir>` chooses the directory (default: a new temporary directory). The example ships with Covi, so the commands in its configuration are trusted for that repository. |

### `covi mascot`

Exports the Covi fox as SVG.

| Option | Meaning |
|---|---|
| `--expression <name>` | `neutral` (default), `explaining`, `thinking`, `reviewing`, `warning`, or `success`. |
| `--size <px>` | Size in pixels, 16–4096. Default: 256. |
| `--mark` | The head-only mark for icons, with the detail for `--size` (no ear chevrons at 24 px and below). |
| `--logo` | The head mark and the wordmark, half as tall as `--size`. |
| `--out <file>` | Write to a file instead of stdout. |

See [Visual system](visual-system.md).

### `covi version`

Prints the Covi version, like `covi --version`.

## The result object

With `--json`, workflow commands print one JSON object on stdout. These commands are `analyze`, `explain`, `review`, `demo`, `video`, `summarize`, `report`, `render`, `ci`, `publish`, and `evidence`:

```ts
{
  ok: boolean;              // false when the gate failed or the command could not finish
  command: string;          // "review", "video", ...
  exitCode: number;         // the process exit code
  runId?: string;           // e.g. "20261004-145755-review-b3c73b6"
  runDir?: string;          // absolute path of the run directory
  change?: { base: string; head: string; files: number; additions: number; deletions: number; title?: string };
  verdict?: "looks-good" | "needs-attention" | "needs-changes";
  findings?: { total: number; confirmed: number; likely: number; risk: number; question: number };
  gate?: { failOn: string; failures: number };
  artifacts: Record<string, string>;   // name → absolute path, e.g. review, explanation, manifest
  video?: {
    rendered: boolean; reason: string; path?: string; seconds?: number; qc?: string;
    music?: { use: string; source: string; hint?: string };  // hint: how to change a default
    framesReused?: boolean;                                    // only the sound changed
  };
  warnings: string[];
  message?: string;
  data?: unknown;           // command-specific, described with each command above
}
```

Other shapes:

- **Errors:** `{ "ok": false, "exitCode": <code>, "error": "<message>", "hint": "<what to do>" }`. The error is also written to stderr.
- **No change found:** `{ "ok": true, "exitCode": 0, "message": "No changes: …", "artifacts": {}, "warnings": [] }`.
- **Other commands:** `doctor`, `trust`, `runs`, `skills`, `examples`, `templates`, and `init` print their own data with `--json`. `schema` always prints JSON.

## Exit codes

| Code | Meaning | Examples |
|---|---|---|
| 0 | OK | A review with no gate failures, including one with findings, or no change to review. |
| 1 | The review gate failed | `review`, `report`, or `ci` found confirmed or likely findings at or above `--fail-on`. |
| 2 | Usage or invalid input | Unknown flag, a number out of range, bad range, invalid `.covi/config.yml`, schema errors in an agent-written file or demo plan, a `publish` head mismatch, or `covi trust` without confirmation when nobody can be asked. |
| 3 | Environment | Not a git repository, a missing tool or browser, or a missing API key for a provider set explicitly. Also a demonstration that could not run, flows that could not be recorded when recording was asked for, or a failed `doctor` check. |
| 4 | Internal error | A bug. Set `COVI_DEBUG=1` for the stack trace. |

Artifacts are written even when the gate fails, so CI can upload them.

## Agent-driven reviews

Inside a coding agent, the agent is the reasoning provider:

1. `covi analyze` resolves and understands the change, runs the rules, and writes `brief.md`. The brief ends with the run id and the next steps.
2. The agent reads the brief and the surrounding code, following the `covi-review` skill. It writes two files into the run directory:
   - `explanation.json`, following `covi schema explanation`. Starting from `explanation.draft.json` is fine.
   - `findings.json`, following `covi schema findings`. List what you can cite with `covi evidence --run <id> --json`.
3. `covi report --run <run-id>` validates both files and renders the reports.

A minimal `findings.json`:

```json
{
  "schemaVersion": 2,
  "summary": "The fix works for Latin accents; one edge case is worth a test.",
  "findings": [
    {
      "title": "Non-Latin titles now produce an empty slug",
      "certainty": "likely",
      "severity": "medium",
      "category": "edge-case",
      "location": { "path": "src/slugify.js", "line": 9 },
      "evidence": "The new replace(/[^a-z0-9]+/g, '-') removes every non-ASCII character after NFKD.",
      "evidenceIds": ["diff-hunk:src/slugify.js:1"],
      "explanation": "A title written entirely in, say, Japanese becomes \"\", which callers use as a URL segment.",
      "suggestion": "Fall back to a hash or keep Unicode letters for non-Latin scripts."
    }
  ],
  "dismissed": [],
  "checked": ["accented Latin input", "repeated separators"],
  "notVerified": ["Behavior with right-to-left scripts"]
}
```

`dismissed` lists rule findings the agent judged wrong, as `{ "id": "<id from rule-findings.json>", "reason": "…" }`. Rule findings that are neither dismissed nor matched by an authored finding stay in the review.

`covi report` behaves as follows:

- **Schema errors** exit with 2 and list every problem:

  ```console
  error findings.json is invalid:
    findings.0.title: Too small: expected string to have >=3 characters
    findings.0.certainty: expected one of "confirmed", "likely", "risk", "question"
    ...
  hint: Run `covi schema findings` for the expected shape.
  ```

- **Unknown rule ids:** dismissing a rule finding id that does not exist is an error (exit 2).
- **Unknown evidence ids:** citing an id the run does not have is an error (exit 2), and so is a confirmed or likely finding without `evidenceIds` in version 2.
- **No `explanation.json`:** the structural explanation is used, with a warning.
- **No `findings.json`:** the review contains rule findings only, with a warning.

## Video planning

`covi video --dry-run` resolves the video plan and stops. With `--json`, `data` contains:

| Field | Meaning |
|---|---|
| `spec` | The resolved spec: `mode`, `width`, `height`, `fps`, `duration` (`target`, `min`, `max`, `auto`), `narration`, `captions`, `style`, `theme`, `mascot`, `music` (`use`, `placement`, and `setting`, the placement as chosen: `auto`, `continuous`, or `bookends`), `soundEffects`, and `outro`. |
| `inferred` | What Covi read from `--request`, e.g. `{ "mode": "\"vertical\"", "duration": "\"30-second\"" }`. |
| `missing` | Choices nothing decided, for example `["mode", "duration", "music"]`. |
| `questions` | Questions worth asking: `id`, `header`, `question`, and `options` (`value`, `label`, `description`). Empty when nothing needs asking, and always empty with `--yes`. |
| `decision` | Whether Covi would render (`render`) and why (`reason`). |
| `demonstration` | The demonstration assessment from `context.json`. |

An agent asks the questions with its own question tool, then runs `covi video` with the answers as flags:

- **Type:** `--short`, `--standard`, or `--custom --width <px> --height <px>`.
- **Length:** `--duration 15s|30s|60s|auto`.
- **Music:** `--music theme|compose|none`. Covi asks about music only alongside another question.

If the user picks Custom, run the dry run again with `--custom` (and the other answers as flags) to get the size question. A custom size from the request, such as "a square video", comes with a length question, because a size implies no length.

See [Video](video.md).

## Environment variables

| Variable | Effect |
|---|---|
| `COVI_LANGUAGE` | `language` |
| `COVI_PROVIDER`, `COVI_MODEL` | `intelligence.provider`, `intelligence.model` |
| `COVI_FAIL_ON` | `review.failOn` |
| `COVI_DEMO_RECORD` | `demo.record` (`1`, `true`, `yes`, `on` mean on) |
| `COVI_VIDEO_MODE`, `COVI_VIDEO_DURATION` | `video.mode`, `video.duration` |
| `COVI_NARRATION` | `video.narration.enabled` (`1`, `true`, `yes`, `on` mean on) |
| `COVI_TTS_PROVIDER`, `COVI_TTS_VOICE` | `video.narration.provider`, `video.narration.voice` |
| `COVI_CAPTIONS` | `video.captions` |
| `COVI_MUSIC` | `video.music.use` (`theme`, `compose`, or `none`) |
| `COVI_MUSIC_PLACEMENT` | `video.music.placement` (`auto`, `continuous`, or `bookends`) |
| `COVI_SOUND_EFFECTS` | `video.soundEffects.enabled` (`1`, `true`, `yes`, `on` mean on) |
| `COVI_OUTRO` | `video.outro` (`1`, `true`, `yes`, `on` mean on) |
| `COVI_OUTPUT_DIR` | `output.dir` |
| `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | Enables the `anthropic` provider; `auto` picks it when set. |
| `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` | Hosted narration voices; `auto` prefers ElevenLabs, then OpenAI, then the system voice. |
| `COVI_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN` | Token for GitHub comments (first one set wins). |
| `COVI_GITLAB_TOKEN`, `GITLAB_TOKEN` | Token for GitLab notes and uploads. |
| `COVI_FFMPEG`, `COVI_FFPROBE` | Paths to the ffmpeg and ffprobe binaries. |
| `COVI_HOME` | A Covi installation directory to load resources from (`skills/`, `templates/`, `examples/`) instead of the one Covi runs from. |
| `COVI_USE_DIST` | `1` runs the built bundle in `dist/` instead of the TypeScript sources (in a checkout). |
| `COVI_NONINTERACTIVE`, `CI` | When set, Covi never asks questions. |
| `COVI_DEBUG` | Print stack traces for internal errors. |
| `NO_COLOR` | Disable colors. |
| `GITHUB_ACTIONS`, `GITLAB_CI` | Platform detection for `covi ci` and `covi publish`. Each platform's own variables provide the change; see the integration guides. |
| `CLAUDECODE`, `CODEX_SANDBOX`, `CODEX_HOME` | Recorded as entry point `agent` in `run.json`. |
| `COVI_TRUST_COMMANDS` | `1` uses the repository's commands for the run without recording trust, like `--trust-commands`. |
| `COVI_TRUST_FILE` | Where trusted command sets are recorded. Default: `$XDG_DATA_HOME/covi/trust.json`, or `~/.local/share/covi/trust.json` when `XDG_DATA_HOME` is not set. |
| `FORCE_COLOR` | Colors even when output is not a terminal (`0` does not force). |

The `COVI_*` configuration variables form part of the explicit layer; command-line flags override them. See [Configuration](configuration.md#environment-variables).

Covi never passes its own environment to project commands such as `app.start`, `test.command`, or `demo.commands`. They get an allowlisted environment without tokens or keys, and locally they run only once trusted (see [Security](security.md)).
