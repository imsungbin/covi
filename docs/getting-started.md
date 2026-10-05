# Getting started

This page covers installing Covi, checking what your environment supports, running a first review, trying the bundled example changes, and using Covi from a coding agent. For every command and flag, see the [CLI reference](cli.md).

## Requirements

Explaining, reviewing, and summarizing a change need only Node.js and git. Demonstrations and videos need more.

| Requirement | Needed for | Notes |
|---|---|---|
| Node.js 22.18 or newer | everything | A checkout runs the TypeScript sources directly on Node's type stripping. |
| git | everything | Covi reads changes from a git repository. |
| Playwright Chromium | demonstrations of pages and flows, video rendering | `covi doctor --install-browser` installs the build Covi's Playwright expects (see [Install](#install)). |
| ffmpeg and ffprobe | video | `brew install ffmpeg` or `apt-get install ffmpeg`. A build with libx264 is preferred; without an H.264 encoder Covi falls back to MPEG-4. Set `COVI_FFMPEG` and `COVI_FFPROBE` to use specific binaries. |
| A speech engine | narrated video | macOS `say` (built in), `espeak-ng` or `espeak` on Linux, or a hosted voice through `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Without one, videos are captioned but silent. |
| `ANTHROPIC_API_KEY` | optional: model-written reviews outside a coding agent | Without a model, Covi uses its built-in rules and a structural explanation. Inside a coding agent, the agent does the reasoning. |

## Install

Covi is not published to the public npm registry. The name `covi` there belongs to an unrelated project, so do not run `npm install covi` or `npx covi`. Install Covi from its source instead.

### With Claude Code

If you use Claude Code, one command in a session is enough:

```text
/plugin install covi --marketplace imsungbin/covi
```

The plugin brings the skills and its own `covi` command: its `bin/` directory is on Claude's PATH while the plugin is enabled, and the first run of `bin/covi` installs Covi's locked dependencies with `npm ci` (Node.js 22.18 or newer must be installed). On Claude Code older than 2.1.275, run `/plugin marketplace add imsungbin/covi`, then `/plugin install covi@covi`. To use `covi` in your own terminal too, also install it from a checkout.

### From a checkout

```bash
git clone https://github.com/imsungbin/covi.git covi
cd covi
npm install                     # dependencies; also builds dist/
npm link                        # puts `covi` on your PATH
covi doctor --install-browser   # Chromium, for demonstrations and video
covi --version
```

`npm link` points `covi` at the checkout, which runs the TypeScript sources directly, so edits and `git pull` take effect without a build. Without it, run `./bin/covi` (it installs dependencies on its first run if needed), `./bin/covi.mjs`, or `npm run covi -- <args>` from the checkout. Set `COVI_USE_DIST=1` to run the built bundle in `dist/` instead.

### As a package

To install a fixed version, build a tarball from a checkout and install that:

```bash
npm pack                                   # writes covi-<version>.tgz
npm install --global ./covi-<version>.tgz
covi doctor --install-browser
```

`npm install --global git+<covi-repository-url>` also works; npm runs the `prepare` script, which builds `dist/`. To share a build through a registry, publish it under a name or scope you control.

### The browser

`covi doctor --install-browser` downloads the Chromium build that matches Covi's Playwright version, then checks that it launches. On Linux, add `--with-deps` to install the system libraries Chromium needs as well (Playwright asks for root through `sudo`). A separately run `npx playwright install` may fetch a different version.

The examples in these docs write `covi`; from a checkout without `npm link`, use `./bin/covi.mjs`.

## Check the environment

`covi doctor` reports what Covi can do on this machine and what to install for the rest:

```console
$ covi doctor
✓ node          Node.js 22.19.0
✓ git           git version 2.39.5 (Apple Git-154)
✓ config        No .covi/config.yml (defaults apply; `covi init` creates one)
✓ intelligence  Built-in heuristics (run Covi from a coding agent, or set ANTHROPIC_API_KEY, for reasoning reviews)
✓ narration     system voice "Samantha"
✓ output        Runs are written to .covi/runs
✓ ffmpeg        ffmpeg with H.264 (/opt/homebrew/bin/ffmpeg)
✓ browser       Chromium 153.0.8010.12
```

`✓` is ready, `!` is a missing optional capability (with a hint), and `✗` is a blocker. `covi doctor` exits with 3 when any check fails. It also validates `.covi/config.yml` when one exists, and when the file asks Covi to run commands, a `commands` line says whether they are trusted on this machine (see [Trusted commands](#trusted-commands)). It changes nothing on disk. Add `--json` for a machine-readable list of checks.

## Your first review

Check out the branch you want reviewed and run:

```bash
covi review
```

With no arguments, Covi reviews what the current branch adds since it diverged from the base branch, including uncommitted work. The base is the configured `base`, or else a detected default branch such as `origin/HEAD`, `main`, or `master`; [Choosing the change](cli.md#choosing-the-change) gives the exact order. To review something else, pass a range such as `covi review main...feature` or `covi review abc1234^!`. The same section lists every form.

Here is a review of the bundled `api-users-pagination` example. With `--demo`, Covi also runs the app at both revisions. `--fail-on high` makes high-severity confirmed or likely findings fail the run:

```console
$ covi review --demo --fail-on high
› Resolving the change
› Understanding the change
› Demonstrating the change
  starting (base): node server.js
  starting (head): node server.js
› Reviewing
◆ covi review  feat(api): paginate GET /api/users · b053c4f…b3c73b6 · 1 files, +14 −1

Needs changes: 1 confirmed issue, 2 risks worth checking.
  1. Confirmed issue · high
     GET /api/users changed its response shape
  2. Risk worth checking · low app.js
     Behavior change without tests
  3. Risk worth checking · low app.js:3
     New environment variable USERS_PAGE_SIZE is not documented

1 finding(s) at or above "high" failed the review gate.

Artifacts: …/.covi/runs/20261004-145755-review-b3c73b6
```

The exit code is 1 because the gate failed. Without `--demo`, the same change gets only the two low-severity risks: Covi confirms the response-shape change only by observing it.

Every finding has a certainty and a severity:

- **Certainty:** confirmed, likely, risk worth checking, or question.
- **Severity:** high, medium, or low.

Only confirmed and likely findings can fail the gate. A change with nothing wrong gets zero findings and "Looks good". The [concept page](concept.md) explains the model.

Other things to try on the same change:

```bash
covi explain                 # what changed, why, and what a reviewer should know
covi summarize               # a short summary for a PR/MR description
covi demo                    # run the software at base and head and capture the difference
covi video                   # a review video, when seeing the change helps
```

Without a model provider and outside a coding agent, Covi's findings come from its built-in rules only. The review says so under "Not verified". Run Covi from a coding agent, or set `ANTHROPIC_API_KEY`, for a reasoning review (see [Configuration](configuration.md#intelligence)).

## Trusted commands

When a repository's `.covi/config.yml` asks Covi to run commands (how to install and start the app, the test command, demo commands), Covi does not run them on your machine until you have looked at them once:

```console
$ covi trust
.covi/config.yml asks Covi to run:
  app.install: npm ci
  app.start: npm run dev -- --port {port}
  app.url: http://127.0.0.1:{port}
  test.command: npm test

Trust these commands for this repository on this machine?
  1. No · keep them withheld
  2. Yes · Covi may run them until they change
Choose 1-2 [1]: 2
Trusted 4 commands for …/webapp.
```

Until you do, every run says which settings it withheld and works without them. If any of these commands changes, for example on a branch you check out to review, Covi withholds the set again until you trust it again. `covi init` and `covi examples create` trust the commands they write. In CI, Covi reads the configuration from the base revision instead, so this step does not apply there. See [Configuration](configuration.md#trusted-commands) and [Security](security.md).

## Try the bundled examples

Covi ships five realistic example changes. Each one says what Covi should conclude about it:

```console
$ covi examples
api-users-pagination       Paginate the users endpoint
                           expect: feature, demo high, video yes
bugfix-cli-slugify         Fix slugify for accented characters and repeated separators
                           expect: bug-fix, demo high, video yes
refactor-retry-helper      Extract backoff calculation from the retry loop
                           expect: refactor, demo none, video no
ui-comment-composer        Add a character counter to the comment composer
                           expect: feature, demo high, video yes
visual-pricing-cards       Refresh the pricing cards
                           expect: visual, demo high, video yes
```

`covi examples create <name>` builds a real git repository for one: the base on `main` and the change on a feature branch, which is checked out. It prints the repository path on stdout and a hint on stderr. The repository goes in a temporary directory unless you pass `--into <dir>`. The commands in the example's configuration are trusted for that repository, so demonstrations run right away. Point any command at it with `--repo`:

```bash
covi examples create ui-comment-composer --into ~/covi-examples/ui
covi review --repo ~/covi-examples/ui
covi demo --repo ~/covi-examples/ui    # the composer before and after, and the typing flow step by step
covi video --repo ~/covi-examples/ui   # a review video (at a terminal, Covi first asks type and length)
```

The `refactor-retry-helper` example shows Covi's product judgment. Nothing user-visible changes, so `covi video` declines to render. It explains why and suggests `--force`.

## Use Covi from a coding agent

Covi is designed to run inside a coding agent. The agent does the reasoning, following Covi's skills (the review methodology), and uses the `covi` CLI for the deterministic parts: resolving the change, rules, capture, rendering, and validation.

### Install the agent

| Agent | Install | Start |
|---|---|---|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` (macOS, Linux, WSL), `brew install --cask claude-code`, or `irm https://claude.ai/install.ps1 \| iex` in Windows PowerShell. See the [setup guide](https://code.claude.com/docs/en/setup). | `claude` |
| Codex | `npm install -g @openai/codex`, `brew install --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`. See the [Codex repository](https://github.com/openai/codex). | `codex` |

Both ask you to sign in the first time they start.

### Install the skills

```bash
covi skills install                   # Claude Code, this repository: .claude/skills/
covi skills install --global          # Claude Code, every repository: ~/.claude/skills/
covi skills install --target codex    # Codex, this repository: .agents/skills/
covi skills install --target codex --global   # Codex, every repository: ~/.agents/skills/
covi skills install --dest <dir>      # any directory
```

`--target agents` installs to the same `.agents/skills/` location as `codex`; other clients that follow that shared layout read it too. In Codex, `/skills` lists the skills it found and `$covi-review` (or any skill name) invokes one directly; Codex picks up new skills on its own, so restart it only if one is missing.

Each installed skill directory gets a `.covi-skill` marker. Running the command again refreshes skills that Covi installed and removes ones that no longer exist. Covi refuses to overwrite a directory it did not install. `covi skills` lists the skills, and `covi skills show <name>` prints one.

### Claude Code plugin

The Covi repository is also a Claude Code plugin marketplace. `.claude-plugin/marketplace.json` lists one plugin, `covi`, whose source is the repository root. `.claude-plugin/plugin.json` describes it, and Claude Code discovers its `skills/`. Install it with `/plugin install covi --marketplace imsungbin/covi`, or add the marketplace with `/plugin marketplace add <path-or-repository>` and install `covi@covi` (a local path starts with `./` or is absolute; from a shell, use `claude plugin marketplace add` and `claude plugin install covi@covi`). The plugin's skills appear as `/covi:covi`, `/covi:covi-review`, and so on. Because the plugin is the whole repository, its `bin/covi` is on Claude's PATH, so Claude can run `covi` without a separate install.

### Inside the Covi repository

An agent working in a Covi checkout needs no installation:

- `AGENTS.md` is the canonical guide for every agent client. It covers both using Covi and changing it.
- `CLAUDE.md` imports `AGENTS.md`.
- `.claude/skills` (Claude Code) and `.agents/skills` (Codex and other clients) link to `skills/`.

### Asking for work

Ask in plain words: "review this branch with Covi", "explain the last three commits", "make a 30-second vertical video of this change". The `covi` skill routes the request to the right skill. A typical agent-driven review:

1. `covi analyze` writes `brief.md`, `context.json`, and `rule-findings.json`.
2. The agent reads the brief and the surrounding code.
3. The agent writes `explanation.json` and `findings.json` into the run directory.
4. `covi report` validates them and renders the reports.

See [Agent-driven reviews](cli.md#agent-driven-reviews) and [Skills](skills.md).

## When Covi asks questions

The CLI asks only about videos, and only what it cannot infer:

- **Video type:** short-form, standard, or custom.
- **Length:** about 15, 30, or 60 seconds, or let Covi decide. Covi also asks this when a request names only a custom size, such as "a square video", because a size implies no length.
- **Size:** only for a custom video. Choosing Custom at the prompt leads to this question.

Agents following the skills likewise ask only when the answer would change what they do. For example, they ask before adding a start command to your configuration, and before trusting the commands in it.

A specific request needs no questions. Values already set on the command line, in `COVI_*` environment variables, or in `.covi/config.yml` count as decided. From the words "30-second vertical video", Covi infers both the type and the length:

```console
$ covi video --dry-run --request "30-second vertical video" --json
```

An excerpt of the result's `data`:

```json
{
  "spec": { "mode": "short", "width": 1080, "height": 1920,
            "duration": { "target": 30, "min": 25.5, "max": 34.5, "auto": false } },
  "inferred": { "mode": "\"vertical\"", "duration": "\"30-second\"" },
  "missing": [],
  "questions": []
}
```

See [Video planning](cli.md#video-planning) for the full result.

**Agents** run `covi video --dry-run --request "<the user's words>" --json` first. If `data.questions` is not empty, they ask with their own question tool, then pass the answers as flags such as `--short --duration 30s`.

**People at a terminal** get a numbered prompt; Enter picks the first option:

```console
$ covi video
› Resolving the change
› Understanding the change

What kind of video should Covi create?
  1. Short-form · Vertical 9:16, about 30 seconds, concise
  2. Standard review · 16:9, 60–120 seconds, more explanatory
  3. Custom · Choose the size, length, and narration
Choose 1-3 [1]: 1

How long?
  1. ~15 sec · Just the key moment
  2. ~30 sec · The change and one review note
  3. ~60 sec · Room to explain why it matters
  4. Let Covi decide · Fit the length to the change
Choose 1-4 [1]: 2
```

**Covi never asks** in these cases, and uses configured values or defaults instead:

- with `--yes` or `--json`;
- when `CI` or `COVI_NONINTERACTIVE` is set;
- when stdin or stdout is not a terminal;
- under `covi ci`.

## Where results go

Each run writes a directory under `.covi/runs/` in the reviewed repository. Its name is `<YYYYMMDD-HHMMSS>-<workflow>-<head7>`, with the timestamp in UTC.

- **Latest run:** `.covi/runs/LATEST` names it. `covi report`, `covi render`, `covi publish`, and `covi runs show` use it by default. All of them, and `covi runs`, look in `output.dir` when you configure another runs directory.
- **Retention:** Covi keeps the 20 most recent runs (`output.keep`).
- **Git:** the runs directory contains a `.gitignore` with `*`, so runs never show up in `git status`. Covi does not edit your own `.gitignore`.
- **Other locations:** `--out <dir>` writes a run to an exact directory and does not update `LATEST`. Pass that directory to `--run` later.
- **Cache:** `.covi/cache/` holds cached narration takes, so re-rendering does not synthesize unchanged lines again.

```console
$ covi runs
20261004-145755-review-b3c73b6  gated  needs-changes  feat(api): paginate GET /api/users
20261004-145727-review-b3c73b6  success  looks-good  feat(api): paginate GET /api/users
20261004-145712-review-b3c73b6  success  looks-good  feat(api): paginate GET /api/users
```

`covi runs show [id]` lists a run's stages and artifacts. [Artifacts](artifacts.md) describes every file.

Untracked files are part of the change Covi reviews whenever uncommitted work is included. A `.covi/config.yml` from `covi init`, or skills installed into the repository, count as part of the change until you commit them. Pass `--committed` to leave uncommitted work out.

## Next steps

- [Configuration](configuration.md): `.covi/config.yml`, including how to run your app for demonstrations.
- [CLI reference](cli.md): every command, flag, exit code, and environment variable.
- [Video](video.md): modes, storyboards, narration, captions, and quality checks.
- [GitHub Action](github-action.md) and [GitLab CI](gitlab-ci.md): reviews on every pull or merge request.
- [Security](security.md): how Covi treats the repositories it reviews.
