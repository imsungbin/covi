<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/covi/logo-dark.svg">
    <img src="assets/covi/logo.svg" alt="Covi" height="64">
  </picture>
</p>

Covi helps people understand code changes well enough to review them. Give it a branch, a commit range, a pull request, or a merge request. It works out what changed and why, and explains the change in terms of modules and behavior rather than individual lines. When seeing the change helps, it runs the software at both revisions and captures the difference. It then reviews the change and reports only findings backed by evidence. When a change is worth watching, Covi also renders a short narrated review video. It works from a coding agent, from the terminal, and in GitHub Actions and GitLab CI.

<p align="center">
  <a href="docs/media/covi-review.mp4"><img src="docs/media/covi-review.gif" width="320" alt="A 25-second vertical review video made by Covi: a title card, the new comment flow captured on a phone, the key code, and the verdict, narrated by Covi's blue fox, whose tail points at what each scene highlights"></a>
  <br>
  <sub>A review video Covi made for one of its example changes, with <code>covi video --short</code>. The <a href="docs/media/covi-review.mp4">MP4</a> has the narration.</sub>
</p>

## Install

**Claude Code.** Run this in a Claude Code session:

```text
/plugin install covi --marketplace imsungbin/covi
```

That's all. The plugin adds Covi's skills and puts the `covi` command on Claude's PATH; the first run installs Covi's dependencies, so you need Node.js 22.18 or newer. (If Claude Code notes that it did not install the plugin's packages, that's expected: `covi` installs them itself.) Then ask: "Review this branch with Covi." On Claude Code older than 2.1.275, run `/plugin marketplace add imsungbin/covi` and then `/plugin install covi@covi`.

**Codex.** Install the `covi` command from source, then the skills:

```bash
git clone https://github.com/imsungbin/covi.git ~/covi && (cd ~/covi && npm install && npm link)
covi skills install --target codex --global
```

**Terminal.** The same clone and `npm link` give you `covi` in any shell; see [Quick start](#quick-start).

Demonstrations and videos also need Chromium (`covi doctor --install-browser`), and videos need ffmpeg. `covi doctor` checks what's missing.

## How it works

Every workflow follows one loop: **Understand → Explain → Demonstrate (when it helps) → Review**.

| Phase | What Covi does |
|---|---|
| Understand | Resolves the base and head revisions, parses the diff, and classifies files. Finds changed symbols, routes, environment variables, dependencies, and migrations. Infers the intent of the change, with a confidence level and the evidence for it. |
| Explain | Says what changed, why it appears to exist, how behavior differs, and where to start reading |
| Demonstrate | Runs the software at base and head (pages, user flows, commands, HTTP requests) and captures before/after screenshots, pixel diffs, command output, and responses. Runs only when seeing the change helps. |
| Review | Reports findings classified by certainty (confirmed, likely, risk, question) and by severity, gives a verdict, and lists what it could not verify |

A review video is one way to deliver the result. Videos come in three modes, with narration, captions, and Covi's fox as the narrator, and end with Covi's outro, where the fox signs off with the logo and the verdict. Quiet music plays with the narration (the Covi theme, or a score composed for the change), with subtle sound effects for clicks, reveals, findings, and the verdict; all of it is synthesized, so it is license-clean and exactly as long as the video:

- Short: vertical 9:16, about 30 seconds.
- Standard: 16:9, 60–120 seconds.
- Custom: any size.

Covi declines to make a video when nothing is worth seeing, as with an internal refactor.

Inside a coding agent, the agent does the reasoning by following Covi's skills, and the `covi` CLI does the deterministic parts. Running on its own, the CLI uses one of three sources of reasoning:

- built-in rules and heuristics;
- a model, when `ANTHROPIC_API_KEY` is set;
- an agent CLI that you configure.

## Covi, explained by Covi

We asked Covi to explain its own first commit, the one that adds this whole repository (259 files, +35,895 lines), from a Claude Code session. `covi analyze` worked out what it could without a model, the agent wrote the explanation by following the `covi-explain` skill, and `covi report` checked it against the schema and rendered it. This is the rendered result, with headings resized for this page:

> ### Adds Covi: understand, explain, demonstrate, and review code changes
>
> This commit creates Covi, a code review workspace built for coding agents. Given a branch, commit range, pull request, or merge request, Covi works out what changed and why, explains it by module and behavior, runs the software at both revisions when seeing the change helps, and reports only findings backed by evidence. A coding agent supplies the judgment by following Covi's skills; the `covi` CLI supplies deterministic tools, schemas for what the agent writes, renderers for reports and comments, and a pipeline for short narrated review videos. The same workflows run in GitHub Actions and GitLab CI.
>
> **Why:** To give reviewers, and the agents that help them, one consistent way to understand a change before judging it: understand, explain, demonstrate when it helps, then review. _(confidence: high. Evidence: commit "Initial commit: Covi, an agent-native code review workspace"; README.md and AGENTS.md describe the loop Understand → Explain → Demonstrate → Review; skills/ holds the methodology that both agents and the CLI's model prompts use.)_

<details>
<summary>What changed, the architecture, and where to start reading</summary>

#### Behavior

- User-visible: yes
- **Before:** No project existed.
- **After:** A `covi` CLI (`analyze`, `explain`, `review`, `demo`, `video`, `summarize`, `report`, `render`, `ci`, `publish`, and helpers such as `init`, `trust`, and `doctor`), agent skills for Claude Code and Codex, a GitHub Action, and a GitLab CI template.
- Every run writes its artifacts to `.covi/runs/<run-id>/` in the reviewed repository.

#### What changed

- **Core (packages/core)**: Defines the platform-independent model (`CodeChange`, `ReviewContext`, `Finding`, `Demonstration`, `Artifact`) and everything deterministic: resolving ranges, branches, and uncommitted work into a change; understanding it (file roles, symbols, routes, environment variables, dependencies, migrations, and intent with a confidence); 26 review rules that keep certainty separate from severity; layered configuration with provenance; run manifests; redaction; and three reasoning providers (built-in heuristics, the Anthropic API, or any agent CLI).
- **Demonstration (packages/capture)**: Checks out base and head into temporary directories, serves static sites or starts the app, and captures pages, scripted flows, command output, and HTTP responses. Pixel diffs locate visual changes, and regressions it observes, such as a changed response shape, become confirmed findings.
- **Video (packages/video)**: Plans a video from the user's words (short, standard, or custom), drafts a storyboard from evidence and story templates, times scenes to the measured narration, builds captions, renders a deterministic browser composition through ffmpeg, and checks the result.
- **Brand (packages/brand)**: The blue fox narrator as code: a seated fox whose tail is a rig that points at what a scene highlights, six expressions, seven named animations, the mark and logo, design tokens, and the generated SVG assets.
- **Platforms and CLI (packages/platforms, packages/cli)**: Map GitHub and GitLab CI context onto a `CodeChange`; publish comments, inline annotations, SARIF, Code Quality reports, and step outputs; and compose everything into the `covi` commands with fixed exit codes.
- **Skills and templates**: Eight skills hold the review methodology for agents and are also loaded into model prompts; seven storytelling templates shape the videos.
- **CI integrations**: A composite GitHub Action with a fork-safe comment workflow, and a GitLab CI template. Both build Covi from its own source.
- **Examples, tests, and docs**: Five example changes with expected results, unit and integration tests (236 test cases), fourteen documentation pages, and agent packaging (`AGENTS.md`, `CLAUDE.md`, a Claude Code plugin manifest).

#### Architecture

- Dependency direction is fixed and enforced by a test: `core` imports no other Covi package; `capture`, `video`, and `platforms` build on it; `cli` composes them.
- Stages communicate through files in a run directory, so an agent can author any input Covi validates (`explanation.json`, `findings.json`, a demo plan, a storyboard) and resume a run.
- Judgment lives in skills and computation in code: the same skill text guides agents and the prompts of model providers.
- Repositories are treated as untrusted: their commands need `covi trust` locally, CI reads configuration from the base revision, and `pull_request_target` runs no project code.

#### Implementation details

- Video timing is narration-first: Covi synthesizes and measures each line, lays the scenes out around the speech, then fits the total to the requested length.
- The browser composition is a pure function of the frame number (seeded blinks, no clocks), so a timeline always renders the same frames.
- During development TypeScript runs directly on Node's type stripping; installs use a bundled `dist/`.

#### Before you read the diff

- `package-lock.json` and `assets/covi/*.svg` are generated; skim them.
- The example changes under `examples/` contain deliberate problems (a removed focus outline, an undocumented environment variable) because the tests expect Covi to find them.
- Token-shaped test fixtures, such as those in `packages/core/test/redact.test.ts`, are assembled at runtime, so no literal credential appears in the source.
- Start with the trust boundary: `packages/core/src/security/` and `packages/capture/src/demonstrate.ts` decide what Covi may execute.

#### Suggested reading order

1. `AGENTS.md`: Architecture rules and the repository map
2. `packages/core/src/model/change.ts`: The platform-independent model
3. `packages/core/src/git/resolve.ts`: How a range or branch becomes a change
4. `packages/core/src/understand/understand.ts`: What Covi derives without a model
5. `packages/core/src/review/engine.ts`: How rule and authored findings become a verdict
6. `packages/core/src/security/trust.ts`: What Covi will execute, and when
7. `packages/capture/src/demonstrate.ts`: Running the software at both revisions
8. `packages/video/src/pipeline.ts`: From storyboard to a checked video
9. `packages/cli/src/workflows.ts`: How the commands compose the packages

#### Open questions

- The npm name `covi` belongs to an unrelated package, so Covi cannot be published to npm under its current name.

</details>

To get the same for any change, ask your agent to "explain this change with Covi", or drive it yourself:

```bash
covi analyze <range> --json   # what Covi determines without a model, and a brief for the agent
# the agent writes explanation.json in the run (see: covi schema explanation)
covi report --run latest      # validate it and render explanation.md and summary.md
```

Without an agent, `covi explain <range>` writes a shorter, structural explanation on its own.

## Quick start

```bash
git clone https://github.com/imsungbin/covi.git
cd covi
npm install
npm link                       # puts `covi` on your PATH (or run ./bin/covi)
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

Covi's methodology ships as agent skills in `skills/`. The `covi` skill routes each request to `covi-understand`, `covi-explain`, `covi-review`, `covi-demo`, `covi-visual-review`, `covi-video`, or `covi-summarize`, and the skills use the `covi` command for the deterministic parts.

### Claude Code

[Install](#install) covers the plugin. Its skills appear as `/covi:covi`, `/covi:covi-review`, and so on, though asking in plain words is usually enough. The plugin carries its own `covi` command, so Claude needs nothing else; to use `covi` in your own terminal as well, install it as in [Quick start](#quick-start).

- **Without the plugin:** with `covi` installed, `covi skills install --target claude` copies the skills into a repository's `.claude/skills/` (add `--global` for `~/.claude/skills/`).
- **In this repository:** nothing to do. `.claude/skills` links to `skills/`, and `CLAUDE.md` imports `AGENTS.md`.
- **Claude Code itself:** see the [setup guide](https://code.claude.com/docs/en/setup), or run `curl -fsSL https://claude.ai/install.sh | bash` (macOS, Linux, WSL) or `brew install --cask claude-code`.

### Codex

[Install](#install) covers the `covi` command and the skills; `--target codex` puts them in `~/.agents/skills/` with `--global`, or in the repository's `.agents/skills/` without it. In this repository, `.agents/skills` already links to `skills/`, and Codex reads `AGENTS.md`.

Run `codex` in the repository you want reviewed and ask in plain words, or name a skill with `$covi-review`. `/skills` lists the skills Codex found; it picks up new ones automatically, so restart Codex only if one is missing. To install Codex itself: `npm install -g @openai/codex`, `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh | sh` (see the [Codex repository](https://github.com/openai/codex)).

### What to ask

- "Review this branch with Covi."
- "Explain the last commit."
- "Make a 30-second vertical video of this change."

The agent asks a question only when the answer would change the result. When a repository's `.covi/config.yml` asks Covi to run commands you haven't trusted yet, the agent shows you those commands before it runs `covi trust --yes`. See [skills](docs/skills.md).

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
      - uses: imsungbin/covi/integrations/github-action@v1   # or your fork; pin a tag or commit SHA
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
  - project: 'your-org/covi'        # placeholder: a copy of Covi on your GitLab instance
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

Covi writes and narrates in English, Korean, Japanese, or Simplified Chinese. By default it follows the language of the change's own title, description, and commit messages; `--language ko` (or `language: ko` in the config) chooses one. Reports, comments, video narration, captions, and on-screen labels follow it, and narration spells out acronyms the way a Korean, Japanese, or Chinese voice should say them (CLI → 씨엘아이).

## Requirements

- Node.js 22.18 or later, and git.
- For demonstrations and videos (optional):
  - Chromium for Playwright (`covi doctor --install-browser`).
  - ffmpeg and ffprobe with H.264 support.
- For narration (optional): `say` on macOS, `espeak-ng` on Linux, or an `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Without a speech engine, videos have captions only. Narration in Korean, Japanese, or Chinese needs a voice for that language (macOS: Yuna, Kyoko, Tingting; espeak-ng: ko, ja, cmn).
- For model-written reviews outside an agent session (optional): `ANTHROPIC_API_KEY`.

`covi doctor` checks all of these.

## Privacy

Covi has no server and collects no telemetry. It runs on your machine or in your CI and writes its results to `.covi/runs/` in the repository. Run files record commit authors' display names, never their e-mail addresses.

Data leaves the machine only for services you set up:

- **Anthropic API**, when `ANTHROPIC_API_KEY` is set or you choose the `anthropic` provider: a redacted brief of the change, including a digest of the diff. Set `intelligence.provider: heuristic` to keep code on the machine.
- **An agent CLI you configure** (the `command` provider): the same redacted brief, on its stdin.
- **OpenAI or ElevenLabs**, when you set their API key: the narration text of a video.
- **GitHub or GitLab**: review comments, only from `covi ci` with commenting enabled or from `covi publish`.

Inside a coding agent, the agent reads the change itself, under that agent's own data handling. [What leaves your machine](docs/security.md#what-leaves-your-machine) has the details.

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
