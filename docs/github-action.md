# GitHub Action

This page covers reviewing pull requests with the composite action in `integrations/github-action/`. It explains setup, permissions, every input and output, what the action produces, the review gate, and how to handle pull requests from forks safely.

The action is a thin wrapper around the CLI. It installs Covi, runs [`covi ci`](cli.md), uploads the run directory, and posts the summary comment with [`covi publish`](cli.md). Anything it does, you can also do with the CLI in your own steps.

## Quick start

Copy [`examples/pull-request.yml`](../integrations/github-action/examples/pull-request.yml) to `.github/workflows/covi.yml`:

```yaml
name: Covi

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write   # only needed for the summary comment

concurrency:
  group: covi-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Covi diffs against the merge base

      - uses: imsungbin/covi/integrations/github-action@v1   # or your fork; pin a tag or commit SHA
        with:
          fail-on: high          # fail on confirmed/likely high-severity findings
          video: auto            # a video only when the change is worth seeing
          video-mode: short
          duration: 30s
          # anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}   # optional: model-written review
```

Covi lives at `imsungbin/covi`; if you run a fork or a mirror, use that repository instead. `@v1` refers to the `v1` release tag. For the strongest guarantee, pin a full commit SHA.

You don't need any configuration to start. Without an API key, Covi reviews with its built-in rules and a structural explanation. To tune it, add `.covi/config.yml` to your default branch (see [configuration.md](configuration.md)). In CI, Covi reads that file from the base revision. Any input you set in the workflow overrides it; inputs you leave out don't.

## What the action runs

1. **Set up Node.js** with `node-version`.
2. **Install Covi.** By default, it runs `npm ci` in the action's own source and uses the CLI it builds, so the ref you pinned is the Covi that runs. With `covi-package`, it runs `npm install --global <covi-package>` instead. Point that at a package or tarball you publish and control: on the public npm registry, the bare name `covi` belongs to an unrelated project.
3. **Install the browser and video tools** (only for `command: review`):
   - When `video` isn't `never`: ffmpeg and espeak-ng from apt on Linux, ffmpeg from Homebrew on macOS, each only if missing.
   - Unless `install-browser` is `false`: `covi doctor --install-browser`, which installs the Chromium build that Covi's own Playwright version expects. On Linux it adds `--with-deps`, so Playwright installs the system libraries too (it asks sudo for them itself).
4. **Review.** Runs `covi ci --platform github --out "$RUNNER_TEMP/covi-run" --no-comment`, plus one flag for each input you set. Inputs reach the script as environment variables and are never interpolated into it.
5. **Upload artifacts.** Uploads the run directory with `actions/upload-artifact`.
6. **Comment.** Runs `covi publish --platform github --run <run-dir> --artifact-url <url>`. The comment is posted after the upload so it can link to the artifact. Commenting is best effort: a failure logs a warning and doesn't fail the job.
7. **Enforce the review gate.** Fails the job if the review step reported a gate failure (see [The review gate](#the-review-gate)).

## Permissions

Grant only what the jobs use:

| Permission | Needed for |
|---|---|
| `contents: read` | Checking out the repository. Always required. |
| `pull-requests: write` | Posting or updating the summary comment. Leave it out, or set `comment: false`, if you don't want a comment. |
| `security-events: write` | Only if you upload the SARIF report to code scanning. |
| `actions: read` | Only in the `workflow_run` comment workflow, to download the artifact from the review run. |

The action doesn't use any other permission. Annotations, the job summary, step outputs, and the artifact upload need no extra scopes.

## Inputs

Inputs that mirror a Covi setting default to empty. Empty means the setting comes from `.covi/config.yml` on the base revision, and then from Covi's own default, shown in the table. Set an input only to override the repository.

| Input | Default | Description |
|---|---|---|
| `command` | `review` | `review` runs Covi on the pull request. `publish` posts the comment for a run made earlier (see [Pull requests from forks](#pull-requests-from-forks)). |
| `fail-on` | empty (`review.failOn`, else `none`) | Fail the job on confirmed or likely findings at or above this severity: `none`, `low`, `medium`, or `high`. |
| `video` | empty (`video.when`, else `auto`) | `auto` renders a video only when the change is worth seeing. The other values are `always` and `never`. |
| `video-mode` | empty (`video.mode`, else `short`) | `short` (9:16, about 30 s), `standard` (16:9, up to 120 s), or `custom`. Passed as `--mode`. |
| `duration` | empty (`video.duration`, else `auto`) | Target video length, for example `30s` or `1m30s`, or `auto`. |
| `narration` | empty (`video.narration`, else on) | `true` or `false`: narrate the video. |
| `captions` | empty (`video.captions`, else on) | `true` or `false`: burn captions into the video. |
| `language` | empty (`language`, else `auto`) | The language of the review, the comment, and the video: `auto` (detected from the pull request's title, description, and commits), `en`, `ko`, `ja`, or `zh` (Simplified Chinese). Passed as `--language`. |
| `annotations` | empty (`publish.annotations`, else on) | `true` or `false`: annotate findings inline on the diff. |
| `provider` | empty (`intelligence.provider`, else `auto`) | Reasoning provider: `auto`, `heuristic`, `anthropic`, or `command`. |
| `model` | empty | Model id for the `anthropic` provider. When empty, Covi uses `claude-opus-5-5`. |
| `comment` | `true` | Post or update the summary comment, in the step after the upload. Needs `pull-requests: write`. This is an action setting: the review step always runs `covi ci --no-comment`. |
| `anthropic-api-key` | empty | Optional. Enables model-written explanations, findings, and narration. |
| `openai-api-key` | empty | Optional. Narration with OpenAI voices. |
| `elevenlabs-api-key` | empty | Optional. Narration with ElevenLabs voices. |
| `github-token` | `${{ github.token }}` | Used only to post the comment. |
| `config` | empty | Path to a config file. A path inside the repository is read from the base revision, like `.covi/config.yml`; a file outside the checkout is read from disk. See [Configuration in CI](#configuration-in-ci). |
| `working-directory` | `.` | Directory of the checked-out repository. |
| `artifact-name` | `covi-review` | Name of the uploaded run artifact. |
| `upload-artifact` | `true` | Upload the run directory (reports, screenshots, video) as a workflow artifact, kept for 14 days. |
| `install-browser` | `true` | Install the Chromium build Covi uses, for demonstrations and videos. Set `false` when the repository has nothing to show in a browser. |
| `run-dir` | empty | `publish` only: the downloaded run directory. |
| `pr-number` | empty | `publish` only: the pull request to comment on. Usually unnecessary: Covi finds it from the `workflow_run` event and checks that its head is the reviewed commit. |
| `expect-head` | empty | `publish` only: refuse to publish unless the run reviewed this commit. Defaults to the `workflow_run` event's head commit. |
| `node-version` | `22` | Node.js version used to run Covi. Covi needs 22.18 or later. |
| `covi-package` | empty | Install Covi from this npm package spec or tarball URL instead of building the action's own source. Use a package you publish and control. |

Boolean inputs are the strings `true` and `false`.

## Outputs

These outputs are set when `command` is `review` and `covi ci` got far enough to write its results.

| Output | Description |
|---|---|
| `run-dir` | Directory holding every artifact of the run (`$RUNNER_TEMP/covi-run`). |
| `verdict` | `looks-good`, `needs-attention`, or `needs-changes`. |
| `findings-count` | Number of findings in the review. |
| `gate-failures` | Number of findings that failed the `fail-on` gate. |
| `video-path` | Path of the rendered video, when one was made. |
| `summary-path` | Markdown summary, suitable for a pull request description. |
| `sarif-path` | SARIF 2.1.0 report for code scanning. |
| `artifact-url` | URL of the uploaded artifact. |

Give the step an `id` to read them:

```yaml
      - id: covi
        uses: imsungbin/covi/integrations/github-action@v1
      - if: always() && steps.covi.outputs.verdict == 'needs-changes'
        run: echo "Covi found ${{ steps.covi.outputs.findings-count }} findings"
```

## What it produces

### Annotations

Covi prints GitHub workflow commands to the job log, and findings show up on the diff in the "Files changed" tab. This needs no token, so it works for fork pull requests too.

- **Levels:** `error` for confirmed or likely findings of high severity. `notice` for low-severity findings and questions. `warning` for everything else.
- **Content:** each title reads `Covi · <certainty>: <title>`, and the message carries the explanation and any suggestion.
- **Limit:** GitHub shows at most 10 annotations of each level per step, so Covi emits at most 10 per level. Findings are ordered most important first.

Set `annotations: false` (or `publish.annotations: false` in the configuration) to turn them off.

### Job summary

The full review is appended to the job summary. It's the same Markdown as `review.md`, with all dynamic text escaped, and it covers:

- the verdict and summary
- each finding with its evidence
- test results, when tests ran
- what Covi checked and what it didn't verify
- rule findings that were dismissed

### SARIF and code scanning

Every run writes `reports/covi.sarif` (SARIF 2.1.0) and exposes its path as `sarif-path`. Severity maps to SARIF levels: high is `error`, medium is `warning`, and low is `note`. Questions are always `note`. Each result carries a stable `partialFingerprints.coviFindingId`.

Covi doesn't upload the report itself. To see findings in code scanning, upload the file in a later step. This needs `security-events: write`, and code scanning has to be available for the repository. Fork pull requests get a read-only token, so skip the upload for them:

```yaml
    permissions:
      contents: read
      pull-requests: write
      security-events: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: covi
        uses: imsungbin/covi/integrations/github-action@v1
      - uses: github/codeql-action/upload-sarif@v4
        if: always() && steps.covi.outputs.sarif-path != '' && github.event.pull_request.head.repo.full_name == github.repository
        with:
          sarif_file: ${{ steps.covi.outputs.sarif-path }}
          category: covi
```

### Run artifact

With `upload-artifact: true`, the run directory is uploaded as `artifact-name` and kept for 14 days. Upload happens even when the review gate fails. The directory holds:

- `review.md` and `review.json`, `explanation.md` and `explanation.json`, `summary.md`, `comment.md`
- the `run.json` manifest
- `reports/covi.sarif`
- `demo/` with screenshots and diffs, when the software was demonstrated
- `video/` with the video, poster, captions, and QC report, when a video was made

[artifacts.md](artifacts.md) describes each file.

### The pull request comment

Covi keeps one comment per pull request. It finds its earlier comment by a hidden marker, `<!-- covi:review -->`, and edits that comment on every push instead of adding new ones.

The comment is rebuilt from the run's schema-validated `review.json` and `explanation.json`, with all dynamic text escaped. It contains:

- the verdict, headline, and summary
- a link to the video, when one was made
- a findings table with certainty, severity, and location
- collapsible details with evidence and suggestions
- what changed and what was not verified
- links to the artifact and the workflow run

GitHub has no API for attaching a video to a comment, so the video link points at the uploaded artifact, which reviewers download as a zip. To link a video hosted elsewhere, run `covi publish --video-url <url>` yourself.

## The review gate

`fail-on` sets the threshold. Only `confirmed` and `likely` findings can fail the gate; `risk` and `question` findings never do. With no `fail-on` input and no `review.failOn` in the configuration, the threshold is `none` and Covi never fails the job.

When the gate fails, `covi ci` exits with code 1. The action handles exit codes like this:

1. The review step records the exit code and keeps going on `1`, so the artifact upload and the comment still happen.
2. The final "Enforce the review gate" step then fails the job with an error annotation.
3. Exit codes `2` (usage or invalid input), `3` (environment), and `4` (internal error) fail the review step immediately.

Don't put `continue-on-error` on the Covi step to make it advisory; use `fail-on: none`. To block merging on Covi, make the job a required status check in your branch protection rules.

## Demonstrations and video

The action only demonstrates and renders for `command: review`.

**Demonstration.** When seeing the change helps and Covi can run the project, it demonstrates the change even if no video is made: it captures pages (at desktop and mobile sizes unless `demo.viewports` says otherwise), API responses, or command output at the base and head revisions. Observed regressions, such as a changed response shape or a page that now errors, become confirmed findings. How Covi runs the project comes from `.covi/config.yml` on the base revision ([configuration.md](configuration.md)).

**Video.** With `video: auto` (the default when neither the input nor `video.when` is set), Covi renders one only when seeing the change helps, such as a UI, visual, CLI-output, or API-behavior change. Otherwise it records in the run why it declined. `always` renders regardless. Setting the `video` input to `never` also skips installing ffmpeg and espeak-ng; the browser is still installed for demonstrations unless `install-browser` is `false`.

- **Mode and length:** `video-mode` and `duration` choose the format.
  - `short` is 1080×1920.
  - `standard` is 1920×1080.
  - `custom` uses `video.width` and `video.height` from `.covi/config.yml`. Without them it's 1920×1080.
- **Narration:** uses ElevenLabs when `elevenlabs-api-key` is set. Otherwise it uses OpenAI when `openai-api-key` is set. Without either key, it falls back to the runner's speech engine (espeak-ng on Linux).
- **Captions:** set `narration: false` for a captions-only video, or `captions: false` to drop the burned-in captions.

[video.md](video.md) covers storyboards, templates, and quality checks.

## Providers and secrets

`provider: auto` picks the first available option:

1. Anthropic, when `anthropic-api-key` is set.
2. The agent command, when the base revision's configuration sets `intelligence.command`.
3. Covi's built-in heuristics.

Keep `auto` on repositories that accept fork pull requests. Secrets are empty for forks, so `auto` falls back to the heuristic review. `provider: anthropic` without a key fails the step with exit code 3.

The action scopes secrets narrowly:

- API keys go only to the review step, as environment variables.
- The `github-token` goes only to the comment steps.
- Project commands that Covi runs (app servers, tests, demo commands) get an allowlisted environment that excludes all of them.

Everything Covi writes passes through its redactor. [security.md](security.md) describes both.

## Configuration in CI

`covi ci` reads `.covi/config.yml` from the base revision of the pull request, not from the pull request itself. A change therefore can't rewrite the commands or settings of its own review. Action inputs override the file, because they come from your workflow; inputs you leave empty don't.

The `config` input follows the same rule. If the path is inside the checked-out repository, Covi reads that file from the base revision, so a pull request can't edit it; the base must already have it. A file outside the checkout, for example one an earlier step writes, is read from disk.

Commands in the base revision's configuration run without `covi trust`: trust is for configuration that comes from a working tree on your own machine.

## Pull requests from forks

GitHub runs `pull_request` workflows for forks with a read-only `GITHUB_TOKEN` and without secrets. Covi detects a fork by comparing the head and base repositories. For a fork it still:

- reviews the change
- annotates the diff
- writes the job summary
- uploads the artifact

It skips the comment and logs this reason:

```
untrusted context (fork or pull_request_target); see docs/github-action.md for the workflow_run pattern
```

### Posting the comment with `workflow_run`

To comment on fork pull requests without ever running their code with a write token, split the work into two workflows:

1. **The review workflow** is the quick start above. It runs under `pull_request` with no secrets and uploads the run as an artifact.
2. **A comment workflow** runs under `workflow_run` after the review finishes, with `pull-requests: write`. It never checks out or executes the pull request's code. It downloads the artifact and runs `covi publish`.

Save [`examples/fork-safe-comment.yml`](../integrations/github-action/examples/fork-safe-comment.yml) as `.github/workflows/covi-comment.yml`:

```yaml
name: Covi comment

on:
  workflow_run:
    workflows: [Covi]   # the `name:` of pull-request.yml
    types: [completed]

permissions:
  pull-requests: write
  actions: read

jobs:
  comment:
    if: >-
      github.event.workflow_run.event == 'pull_request' &&
      github.event.workflow_run.conclusion != 'cancelled' &&
      github.event.workflow_run.conclusion != 'skipped'
    runs-on: ubuntu-latest
    steps:
      - id: download
        uses: actions/download-artifact@v4
        continue-on-error: true   # no artifact: the review did not get far enough to upload one
        with:
          name: covi-review
          path: covi-run
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}

      - if: steps.download.outcome == 'success'
        uses: imsungbin/covi/integrations/github-action@v1   # or your fork; pin a tag or commit SHA
        with:
          command: publish
          run-dir: covi-run
```

The job runs whenever the review finished, including when its gate failed, so a failing review still gets its comment. You don't pass a pull request number or a head commit. `covi publish` reads both from the `workflow_run` event:

- **The target comes from GitHub.** GitHub leaves `workflow_run.pull_requests` empty for pull requests from forks. Covi then finds the open pull request whose head is the reviewed commit, using the head repository's owner, the branch, and the commit from the event. For branches in the same repository, the event names the pull request directly.
- **The run must be for that commit.** Covi refuses with exit code 2 a run whose manifest recorded a different head commit.
- **The pull request must still point there.** If someone pushed after the review, Covi skips the comment; the newer review run comments instead.
- **Untrusted content stays data.** A fork can change the review workflow in its own pull request, so the downloaded artifact is untrusted. `covi publish` executes nothing from it. It validates `review.json` and `explanation.json` against their schemas, rebuilds the comment from them, and escapes all text, so the artifact can't inject links, HTML, or @-mentions.
- **Links point at the review run,** where the artifact lives, not at the comment workflow.

The `pr-number` and `expect-head` inputs override the event's values for other setups, and the head check applies to them too.

Notes:

- GitHub runs `workflow_run` workflows only from the default branch. The comment workflow does nothing until it is merged there.
- The `workflows:` entry must match the review workflow's `name:`.
- `name:` in the download step must match `artifact-name`.
- For pull requests from branches in the same repository, the review workflow already comments, and this workflow updates the same comment. To skip that second update, add `&& github.event.workflow_run.head_repository.full_name != github.repository` to the job's `if:`.

### `pull_request_target`

Under `pull_request_target`, the workflow comes from the base branch and runs with a write token and secrets. Running the pull request's code there would expose them. When Covi sees this event, it:

- analyzes the diff but runs no project command: `app.install`, `app.start`, `demo.commands`, and `test.command` are skipped, and the demonstration's skipped list and the review's "Not verified" section say why
- still captures static sites, because serving files runs no project code
- treats the context as untrusted and skips the comment unless you call `covi publish --number` yourself

A configured `intelligence.command` doesn't run either: an agent CLI would read the pull request's diff while holding the job's secrets, so Covi uses the provider `auto` would pick without it (the Anthropic API when a key is set, otherwise the built-in review) and says so in the run's warnings. Prefer `pull_request` plus the `workflow_run` pattern above. If you use `pull_request_target` anyway, don't check out the pull request's head with persisted credentials.

## Other events

On `push`, Covi reviews the pushed range (`before..after`). There's no pull request to comment on, so the comment step skips with "not a pull request event".

## Troubleshooting

- **"Covi could not post the comment."** The token lacks `pull-requests: write`, or the pull request comes from a fork. The step log has the reason from GitHub.
- **Exit code 3 in the review step.** An environment problem: for example, `provider: anthropic` without a key, or a missing ffmpeg or browser on a self-hosted runner. `covi doctor` lists what Covi can do on a machine, and `covi doctor --install-browser` installs the browser.
- **No video.** With `video: auto`, Covi decided a video wouldn't help. `run.json` in the artifact records the reason, under the skipped `video` stage and in `outcome.video.reason`.
- **No demonstration.** Covi doesn't know how to run the project, or the event was `pull_request_target`. `demo/captures.json` in the artifact lists what was skipped and why. Configure `app` or `demo` settings on the default branch.
- **The comment workflow skipped the comment.** The pull request moved on after the review, or no open pull request has the reviewed commit as its head. The step log gives the reason.

## How the integration is tested

`tests/integrations.test.ts` checks the action's metadata: every input is documented and used, every output comes from a real step, no `${{ }}` expression is interpolated into a shell script, the flags it passes are flags `covi ci` accepts, setting inputs default to empty, and Covi is never installed by a package name it doesn't control. `tests/ci.test.ts` runs `covi ci` and `covi publish` against a local stand-in for the GitHub API, including the fork `workflow_run` flow. The example workflows were also checked with `actionlint`, and the action's scripts with `shellcheck`.

The action's steps have also been run in order inside the pinned Playwright image, with a mock GitHub API receiving the comment. That exercises installing Covi from source, the browser install, the review, the step outputs, the job summary, and the comment. It is not a run on GitHub's hosted runners.
