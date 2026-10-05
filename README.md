<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/covi/logo-dark.svg">
    <img src="assets/covi/logo.svg" alt="Covi" height="64">
  </picture>
</p>

Covi helps people understand code changes well enough to review them. Give it a branch, a commit range, a pull request, or a merge request. It works out what changed and why, and explains the change in terms of modules and behavior rather than individual lines. When seeing the change helps, it runs the software at both revisions and captures the difference. It then reviews the change and reports only findings backed by evidence. When a change is worth watching, Covi also renders a short narrated review video. It works from a coding agent, from the terminal, and in GitHub Actions and GitLab CI.

## How it works

Every workflow follows one loop: **Understand → Explain → Demonstrate (when it helps) → Review**.

| Phase | What Covi does |
|---|---|
| Understand | Resolves the base and head revisions, parses the diff, and classifies files. Finds changed symbols, routes, environment variables, dependencies, and migrations. Infers the intent of the change, with a confidence level and the evidence for it. |
| Explain | Says what changed, why it appears to exist, how behavior differs, and where to start reading |
| Demonstrate | Runs the software at base and head (pages, user flows, commands, HTTP requests) and captures before/after screenshots, pixel diffs, command output, and responses. Runs only when seeing the change helps. |
| Review | Reports findings classified by certainty (confirmed, likely, risk, question) and by severity, gives a verdict, and lists what it could not verify |

A review video is one way to deliver the result. Videos come in three modes, with narration, captions, and Covi's fox as the narrator:

- Short: vertical 9:16, about 30 seconds.
- Standard: 16:9, 60–120 seconds.
- Custom: any size.

Covi declines to make a video when nothing is worth seeing, as with an internal refactor.

Inside a coding agent, the agent does the reasoning by following Covi's skills, and the `covi` CLI does the deterministic parts. Running on its own, the CLI uses one of three sources of reasoning:

- built-in rules and heuristics;
- a model, when `ANTHROPIC_API_KEY` is set;
- an agent CLI that you configure.

## Quick start

```bash
git clone https://github.com/your-org/covi.git    # placeholder: replace your-org with where Covi is hosted
cd covi
npm install
npm link                       # puts `covi` on your PATH (or run ./bin/covi.mjs)
covi doctor --install-browser  # the Chromium build Covi uses, for demos and videos
covi doctor                    # checks git, the browser, ffmpeg, and speech
```

You can also install a tarball built with `npm pack`, or straight from git with `npm install -g git+<repository URL>`. Don't use `npm install -g covi` or `npx covi`: on the public npm registry that name belongs to an unrelated project.

Then, in any git repository:

```bash
covi review                         # this branch against its base, plus uncommitted work
covi explain HEAD~3..HEAD           # explain the last three commits
covi review --fail-on high          # exit 1 on confirmed or likely high-severity findings
covi video --short --duration 30s   # a vertical review video, if the change is worth seeing
covi summarize                      # a summary for the PR/MR description
```

To try Covi without a change of your own, build one of the example changes into a scratch repository:

```bash
covi examples                                           # the five example changes
covi examples create ui-comment-composer --into /tmp/covi-ui
covi review --repo /tmp/covi-ui --demo                  # review, and capture the app at both revisions
covi video --repo /tmp/covi-ui --short
```

Every run writes its artifacts to `.covi/runs/<run-id>/` in the reviewed repository. That directory ignores itself, so it never shows up in `git status`. Add `--json` to any command to get a machine-readable result.

Commands in a repository's `.covi/config.yml` (installing and starting the app, tests, demo commands) run on your machine only after you trust them with `covi trust`; until then Covi says it withheld them. `covi init` and `covi examples create` trust the commands they write.

| Exit code | Meaning |
|---|---|
| 0 | OK |
| 1 | Review gate failed |
| 2 | Usage error or invalid input |
| 3 | Environment problem |
| 4 | Internal error |

See [getting started](docs/getting-started.md) and the [CLI reference](docs/cli.md).

## Use it from a coding agent

Covi's methodology ships as agent skills in `skills/`. The `covi` skill routes each request to `covi-understand`, `covi-explain`, `covi-review`, `covi-demo`, `covi-visual-review`, `covi-video`, or `covi-summarize`.

- **Claude Code:** in this repository the skills are already available through `.claude/skills`. To use them in another repository, run `covi skills install --target claude` there, or add `--global` to install them for your user. You can also add this repository as a plugin marketplace and install the plugin:
  1. `/plugin marketplace add your-org/covi`
  2. `/plugin install covi@covi`
- **Codex and other agents:** `covi skills install --target codex` (or `--target agents`) installs into `.agents/skills/`, where Codex discovers skills; add `--global` for `~/.agents/skills/`. In this repository, `.agents/skills` already links to `skills/`. `AGENTS.md` is the guide for agents working on Covi itself.

Then ask in plain words, for example:

- "Review this branch with Covi."
- "Explain the last commit."
- "Make a 30-second vertical video of this change."

The agent asks a question only when the answer would change the result. See [skills](docs/skills.md).

## CI

**GitHub Actions.** A trimmed version of [`examples/pull-request.yml`](integrations/github-action/examples/pull-request.yml):

```yaml
name: Covi
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write    # only for the summary comment
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # Covi diffs against the merge base
      - uses: your-org/covi/integrations/github-action@v1   # placeholder: replace your-org with where Covi is hosted
        with:
          fail-on: high
          video: auto
```

The action:

- reviews the pull request and annotates findings on the diff;
- runs the software and captures the change when seeing it helps;
- writes a job summary and a SARIF report;
- uploads the run as an artifact;
- posts or updates a single comment.

Inputs that mirror Covi settings (`fail-on`, `video`, `video-mode`, …) default to empty, so the repository's `.covi/config.yml` decides unless you set them. By default the action runs its own source; `covi-package` installs a package you publish instead.

Pull requests from forks get a read-only token. The review still runs, and a separate [`workflow_run` workflow](integrations/github-action/examples/fork-safe-comment.yml) posts the comment without running the fork's code: Covi finds the pull request from the trusted event and checks that it still points at the reviewed commit. See [GitHub Action](docs/github-action.md).

**GitLab CI.** In `.gitlab-ci.yml`:

```yaml
include:
  - project: 'your-org/covi'        # placeholder: where Covi is hosted on your GitLab instance
    ref: v1
    file: '/integrations/gitlab-ci/covi.yml'
    inputs:
      covi-project: your-org/covi   # the same project; the job clones it to install Covi
      covi-ref: v1                  # the same ref
      fail-on: high
```

The `covi-review` job runs in merge request pipelines and installs Covi from that project with the job token (or from `covi-package`, a package you publish). It adds findings to the Code Quality widget and keeps the run, including any video, as job artifacts. When `COVI_GITLAB_TOKEN` holds a project access token with the `api` scope, it also posts or updates a single merge request note. See [GitLab CI](docs/gitlab-ci.md).

In CI, Covi never asks questions. It reads `.covi/config.yml` (and a `--config` file inside the repository) from the base revision, so a change cannot rewrite the gate or the commands of its own review. Under GitHub's `pull_request_target`, no project command runs at all. See [security](docs/security.md).

## What you get

| In the run directory | Contents |
|---|---|
| `review.md`, `review.json` | The verdict, findings with their evidence, what Covi checked, and what it could not verify |
| `explanation.md`, `explanation.json` | What changed, why, how behavior differs, and where to start reading |
| `summary.md`, `comment.md` | A compact summary for the PR/MR description, and the comment body |
| `context.json`, `diff.patch` | The structured understanding of the change, and the redacted diff |
| `demo/` | Before/after screenshots, pixel diffs, flow steps, command output, API responses |
| `video/` | `covi-review.mp4`, `poster.png`, `contact-sheet.jpg`, captions (`.vtt`, `.srt`), the storyboard, and QC results |
| `run.json` | The manifest: inputs, configuration with provenance, stages, commands, artifact hashes, and the outcome. It never contains secrets. |

See [artifacts](docs/artifacts.md).

## Configuration

Covi works without configuration. `covi init` writes a `.covi/config.yml` based on what it detects in the repository: the base branch, the test command, and how to start the app. Settings resolve in this order, highest first:

1. Explicit flags, CI inputs that are set, and `COVI_*` environment variables.
2. The repository's config file.
3. Workflow defaults (for example, `covi demo`, `covi video`, and `covi ci` capture desktop and mobile).
4. Built-in defaults.

`run.json` records which of these set each value. See [configuration](docs/configuration.md).

## Requirements

- Node.js 22.18 or later, and git.
- For demonstrations and videos (optional):
  - Chromium for Playwright (`covi doctor --install-browser`).
  - ffmpeg and ffprobe with H.264 support.
- For narration (optional): `say` on macOS, `espeak-ng` on Linux, or an `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Without a speech engine, videos have captions only.
- For model-written reviews outside an agent session (optional): `ANTHROPIC_API_KEY`.

`covi doctor` checks all of these.

## Documentation

- [Product concept](docs/concept.md)
- [Getting started](docs/getting-started.md)
- [CLI reference](docs/cli.md)
- [Configuration](docs/configuration.md)
- [Skills](docs/skills.md) and [creating a skill](docs/creating-a-skill.md)
- [Review videos](docs/video.md)
- [Artifacts](docs/artifacts.md)
- [GitHub Action](docs/github-action.md)
- [GitLab CI](docs/gitlab-ci.md)
- [Security and execution model](docs/security.md)
- [Architecture](docs/architecture.md)
- [Visual system](docs/visual-system.md)
- [Contributing](docs/contributing.md)

## License

MIT. See [LICENSE](LICENSE).
