# Security model

This page explains how Covi treats the code it reviews. It covers what Covi executes and with which environment, how commands from a repository's configuration earn your trust, what Covi sends to model and speech providers, how it keeps secrets out of its outputs, and how its CI integrations limit privileges.

## Principles

- **Repositories are untrusted input.** That includes the diff, file contents, pull request titles and descriptions, commit messages, branch names, the repository's own `.covi/config.yml`, and the software itself.
- **Project code runs only when someone asked for it.** Covi runs a project's commands only when they come from configuration you trust or from you. It never guesses a command and runs it. Locally, commands in a repository's configuration need `covi trust` first; in CI, configuration comes from the base revision.
- **Secrets stay in Covi's process.** Project commands get a minimal, allowlisted environment, and everything Covi writes passes through a redactor.
- **A change can't reconfigure its own review in CI.** `covi ci` reads configuration from the base revision.
- **Untrusted text never becomes markup.** Pull/merge request comments are rebuilt from schema-validated files, and comments and Markdown reports escape all dynamic text.

## What Covi executes

| What | When | Where | Environment |
|---|---|---|---|
| `git` | Every workflow: resolving the change, reading files, building checkouts | Your repository | Covi's environment |
| Static file server | Demonstrating a static site | In Covi's process, on `127.0.0.1` at a random port | Not applicable; no project code runs |
| `app.install`, `app.start` | Demonstrating an app | Temporary checkouts of the base and head revisions | Allowlisted ([below](#environment-for-project-commands)) |
| `demo.commands` | Demonstrating CLI behavior | Temporary checkouts of the base and head revisions | Allowlisted |
| `test.command` | `--run-tests`, or `review.runTests: true` in configuration | Your repository's working directory | Allowlisted |
| `intelligence.command` | The `command` reasoning provider | Your repository's root | Covi's full environment |
| Chromium, ffmpeg, a speech engine | Captures and videos | Temporary directories and the run directory | Covi's environment |

A few details:

- **Static sites.** These are served from a checkout. The server resolves real paths and refuses anything outside the site's root, including symlinks the repository commits that point elsewhere on the machine. Pages render in headless Chromium, so a page's own JavaScript runs inside the browser sandbox, with no access to Covi's environment.
- **`app.url`.** With this set, Covi starts nothing: it captures the URL you gave it, at the head revision only. Because it decides where Covi's browser and requests go, a repository's `app.url` needs your trust like a command does.
- **The `command` provider** runs an agent CLI, such as `claude -p` or `codex exec`. Covi writes a prompt to its stdin and reads JSON from stdout. The command inherits Covi's environment, because agent CLIs need their own credentials. Configure it only with a command you trust.
- **Storyboard images.** A video storyboard can only reference images inside the run directory, so an edited storyboard can't pull other files from the machine into a video.
- **Music and sound effects.** Sound comes only from data: the bundled patches, kits, effect recipes, and theme in `templates/music/`, and a validated `video/score.json`. Nothing runs and nothing is downloaded. A score can come from an agent or a model, so Covi treats it as untrusted input: at most 64 KB, 8 tracks, 40 patterns, and 16 sections, pattern strings of at most 2,000 characters, a tempo of 60–160 bpm, bounded note values, chord voicings within 30 semitones, at most 256 chord changes, at most 12 tones joined in one step, at most 20,000 scheduled notes per 120 s of video, at most 48 s of sound per second of video (every note counted with its release or ring, its gate cut at the end of the video), names that are the score's own (not `constructor` or anything else every object has), and only the bundled patches and kits. Covi checks a score against these rules and schedules it for the video before synthesizing anything: an agent's score that does not pass ends the command with exit code 2, and a model's is replaced by the theme. While rendering, Covi keeps at most about 115 MB of rendered notes per track for reuse.

### Where project commands come from

Project commands come from only these places:

- configuration: `.covi/config.yml` (which needs your trust locally and is read from the base revision in CI), or a file you pass with `--config`
- a demo plan you pass with `covi demo --plan` or `covi review --demo --plan`, written by you or by your agent (Covi keeps it as `demo/plan.json` in the run)

When Covi can't tell how to run a project, it suggests a setting, such as `app.start: npm run dev`, and skips the demonstration instead of trying it.

Which workflows can run project commands:

| Workflow | Project commands |
|---|---|
| `covi demo` | Demonstrates the change: app commands and `demo.commands`. |
| `covi review` | `test.command` with `--run-tests`; a demonstration with `--demo`. |
| `covi video` | A demonstration when a video is warranted and the project is runnable. |
| `covi summarize` | `test.command`, only when `review.runTests` is true. |
| `covi ci` | A demonstration whenever seeing the change helps and the project is runnable, whether or not a video is made; `test.command` with `--run-tests` or `review.runTests: true`. Under `pull_request_target`, none (see [CI](#ci-integrations)). |
| `covi analyze`, `explain`, `report`, `render`, `publish`, `schema`, `doctor` | None. |

With `review.runTests: true` in the configuration, `test.command` runs in every workflow that reviews: `review`, `video`, `summarize`, and `ci`.

## Commands in repository configuration need your trust

Locally, Covi reads `.covi/config.yml` from your working tree, and the working tree may be someone else's branch. A pull request can edit that file. So the settings that make Covi run something, open something, or hand something to a command take effect only after you trust them for that repository:

- `app.install`, `app.start`, `test.command`, `demo.commands`, `intelligence.command`
- `app.url`, which decides where Covi's browser and requests go
- `app.env` and `app.passEnv`, which shape what commands see (a variable such as `NODE_OPTIONS` can change what a trusted command does)

Run `covi trust` to see the exact set and allow it:

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
Choose 1-2 [1]:
```

How trust works:

- **Per repository, per exact set.** Covi stores a digest of the settings above for the repository's path. Change any of them (a command, the URL, an environment variable) and the whole set is untrusted again until you run `covi trust` once more.
- **Explicit consent.** In a terminal, `covi trust` asks. Without a terminal, it prints the set to stderr and exits with code 2 unless you pass `--yes`. Agents following Covi's skills show the user the commands and ask before running `covi trust --yes`.
- **Where it's stored.** `$COVI_TRUST_FILE` if set, else `$XDG_DATA_HOME/covi/trust.json`, else `~/.local/share/covi/trust.json`. Entries for repositories that no longer exist are dropped. `covi trust --revoke` forgets a repository.
- **Generated commands are trusted.** `covi init` trusts the commands it writes, and `covi examples create` trusts the bundled example's commands.
- **One-off override.** `--trust-commands` (or `COVI_TRUST_COMMANDS=1`) uses the repository's commands for a single run without recording anything.

Until you trust them, Covi withholds those settings and says so once in the run's warnings: which keys it didn't use and how to allow them. The rest of the run proceeds without them:

- Demonstrations use only what needs no command, such as a static site, and the skipped list says why.
- Tests don't run, and the review's "Not verified" section says the test command isn't trusted yet.
- A withheld `intelligence.command` means Covi uses the provider that `auto` would choose without it.

`covi doctor` shows whether the repository's commands are trusted on this machine.

Not gated, because they don't come from the repository:

- a file you pass with `--config`
- command-line flags and `COVI_*` variables
- in CI, the base revision's configuration (see [CI integrations](#ci-integrations))

Trusting a command doesn't vet the code it runs. `npm test` runs whatever test script the checked-out branch defines. Before running a branch's tests or app, review it as you would before running them by hand.

## Checkouts

To run the software, Covi materializes each revision into a temporary directory with `git archive`, and removes the directory afterwards. Uncommitted work is captured the same way:

- Working-tree changes become a dangling commit (`git stash create`).
- Staged changes become a tree and commit (`git write-tree` and `git commit-tree`).
- Untracked files are copied.

None of this changes your branches, index contents, or working tree. Symlinks in a checkout stay symlinks; the static server refuses any that lead outside the site root. In CI, or with `--fetch`, Covi may fetch missing commits from `origin` with `git fetch --no-tags`, deepening or unshallowing a shallow clone when it needs the merge base.

### Processes and time limits

Long-running commands, such as `app.start`, run in their own process group. When a capture finishes or fails, Covi stops the whole group: SIGTERM first, then SIGKILL after a short grace period. Every command has a time limit:

| Command | Limit |
|---|---|
| `app.install` | 15 minutes |
| App readiness | `app.timeout`, 120 s by default |
| `test.command` | `test.timeout`, 600 s by default |
| Each demo command | Its own `timeout`, 60 s by default |
| `intelligence.command` | `intelligence.timeout`, 300 s by default |

## Environment for project commands

Project commands (`app.install`, `app.start`, `test.command`, `demo.commands`) never inherit Covi's environment. `childEnv` in `packages/core/src/security/env.ts` builds a new one from:

1. **These names, if set:**
   - `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `TERM`, `TZ`
   - `TMPDIR`, `TMP`, `TEMP`
   - `CI`, `NO_COLOR`, `COLORTERM`
   - `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and their lowercase forms
   - `PLAYWRIGHT_BROWSERS_PATH`, `NODE_OPTIONS`
   - toolchain locations: `NVM_DIR`, `NVM_BIN`, `VOLTA_HOME`, `PNPM_HOME`, `COREPACK_HOME`, `BUN_INSTALL`, `GOPATH`, `GOROOT`, `GOCACHE`, `CARGO_HOME`, `RUSTUP_HOME`, `PYENV_ROOT`, `VIRTUAL_ENV`, `JAVA_HOME`
   - on Windows: `SystemRoot`, `ComSpec`, `PATHEXT`, `WINDIR`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `ProgramFiles`, `ProgramData`
2. **Names starting with** `LC_`, `XDG_`, or `npm_config_cache`.
3. **`app.env`:** literal values from configuration.
4. **`app.passEnv`:** names you explicitly allow through from Covi's environment. This is the only way a secret reaches project code. Locally it needs your trust, like the commands; in CI it comes from the base revision, like the rest of the configuration.

A name from the first two groups is still dropped if it looks like a credential (see [Redaction](#redaction)). Covi also sets:

- `CI=1` when it isn't already set
- `BROWSER=none` and `GIT_TERMINAL_PROMPT=0`, so tools don't open browsers or prompt
- `APP_URL` for demo commands, when an app is running

CI tokens, model and voice API keys, and cloud credentials are not in the list. Project code therefore can't read them from its environment, even under a CI job that has them.

## Redaction

Everything Covi writes as text passes through a `Redactor`:

- JSON artifacts, deeply
- Markdown reports and `diff.patch`
- log lines and warnings
- the `run.json` manifest: configuration values, options, and the change title
- command records, and the captured output of tests and demo commands
- video storyboards, before narration, captions, frames, and the composition are made from them
- every prompt sent to a model, including the prompts that refine a video's narration and compose its music
- `evidence.json`: labels and paths, and the registry `covi evidence` rebuilds in memory for an older run
- the subject model: `.covi/subject/subject.json` (or `subject.json` in the runs directory) and each run's `demo/subject.json`, and what `covi subject` prints

It masks four kinds of text:

1. **Credential environment values.** These are the values of variables whose names contain `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `PASSPHRASE`, `CREDENTIAL`, `PRIVATE`, `API_KEY`/`APIKEY`, `ACCESS_KEY`, `AUTH`, `SESSION`, `COOKIE`, `WEBHOOK`, `DSN`, or `SIGNING`, or that end in `_PAT` or start with `PAT_`. A value is masked wherever it appears verbatim, as long as it's at least 6 characters and isn't a boolean or number.
2. **Known token formats:**
   - private key blocks
   - GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`) and GitLab tokens (`glpat-` and related prefixes)
   - Anthropic and OpenAI API keys, AWS access key ids and secret access keys
   - Slack tokens and webhook URLs, Stripe live keys, Google API keys, npm tokens, and JSON Web Tokens
3. **Credential-shaped assignments,** such as `api_key = "..."` or `password: '...'`.
4. **Credentials embedded in URLs** (`scheme://user:password@host`).

Matches become `[REDACTED]`. For known formats, a short prefix stays visible so you can tell what was masked.

The `secret-in-diff` review rule uses the same token formats. It reports a secret that a change adds, and ignores obvious placeholders.

Because a video's narration, captions, and on-screen code, output, and responses all come from the redacted storyboard, a token in the diff doesn't appear in the video. Redaction can't reach inside screenshots or recordings, though: a page that renders a secret shows it in the capture. That's why project code never gets Covi's secrets in the first place.

## What leaves your machine

- **`heuristic` provider:** nothing. Analysis is local.
- **`anthropic` provider:** a redacted brief goes to the Anthropic API, using `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. The brief contains:
  - the change metadata: title, description, and commit subjects
  - Covi's structural understanding of the change
  - the deterministic rule findings
  - a prioritized digest of the diff, capped at `intelligence.maxDiffChars` (120,000 characters by default)
  - the methodology from the skills
- **`command` provider:** the same redacted prompt goes to the stdin of the command you configured. Where it goes from there depends on that tool.
- **Agent mode** (`covi analyze`, then `covi report`): your agent reads the brief and the files. Data handling is your agent's.
- **Narration:** text goes to OpenAI or ElevenLabs only when their API key is set (`auto`) or you choose that provider. The system engines (`say` on macOS, espeak-ng elsewhere) run locally.
- **Music:** synthesized on the machine. Only `video.music.use: compose` with a model provider sends anything, to the same provider as the analysis, and all of it redacted: the change's headline and summary (at most 200 and 500 characters), the story template and the verdict, the video's length and kind, the scene list (beats, labels, and times, not the narration's words), the hero moment, the end of the last line, and the moment the outro settles, the names and descriptions of the bundled instruments, the Covi theme as an example of the format, and the music methodology.
- **Comments:** go to GitHub or GitLab only from `covi ci` with commenting enabled, or from `covi publish`.

`provider: auto` uses Anthropic whenever `ANTHROPIC_API_KEY` is set. Set `intelligence.provider: heuristic` when code must not leave the machine.

## Run outputs

`run.json` records:

- the inputs and the resolved configuration, with where each value came from
- stages and warnings, including any commands that were withheld
- each command that ran: the redacted command line, its exit code, and its duration
- the artifacts, with SHA-256 digests
- the outcome

It never records environment values. Command output appears only in `demo/captures.json` and the tests section of `review.json`, both redacted. Traces (`demo/traces/`) keep request URLs, console messages, and timing, never headers or bodies; credential-shaped URL parameters are masked before the usual redaction. See [artifacts.md](artifacts.md).

Locally, runs live in `.covi/runs/`. That directory ignores itself with its own `.gitignore` containing `*`, so runs are never committed, and only the latest `output.keep` runs (20 by default) are kept. In CI, the run directory is uploaded as a job artifact: for 14 days in the GitHub Action, and for `expire-in` in GitLab.

In CI the checkout belongs to the change, and the runs directory is inside it by default. If the change makes that directory a symbolic link, or it resolves outside the checkout, Covi refuses to write runs there (exit 3), unless you chose the place yourself: `--out`, or `output.dir` on the command line or in `COVI_OUTPUT_DIR`.

### The subject model

The [subject model](artifacts.md#the-subject-model) (`.covi/subject/subject.json`) is kept in the repository by default, so it is untrusted input like the rest of it.

- **Data only.** Nothing in it runs. It holds no command line: a CLI scenario keeps a name and an exit code, an HTTP scenario a method, a path without its query, and a status, and a `run` field fails the schema. Flow steps are browser actions, and a `goto` must stay on the app (a path with one leading `/`).
- **Selectors Covi builds.** Element selectors are strings Covi builds in Node from attributes the page reported; the page never writes a selector. Values are quoted, ids that frameworks generate are skipped, and a selector is kept only when it finds exactly one element.
- **Page text is page input.** Titles and labels are cut to one line, control and bidi characters (terminal escapes among them) are removed, and lengths are capped. Covi never reads what is typed into a field, so typed text never becomes a label.
- **Secrets are never kept.** A flow that types into, presses keys in, or chooses from a secret field is never kept: a password, one-time code, or card field, told by its `type` or `autocomplete`, or by a selector or note that names one. A field the page cannot describe in time counts as secret. Its frames give the model nothing, and the run warns with the flow's name and why, never its values.
- **Redacted and checked.** What Covi writes (the store and `demo/subject.json`) passes through the `Redactor` and the schema first. What it reads is schema-checked (strict objects, every string and list bounded, at most 512 KB, sized before it is read). A file that fails is ignored with a warning and never overwritten. A store or lock reached through a symbolic link is neither read nor written.
- **From the base revision in CI.** With `subject.store: repo`, CI reads the model from the base revision, like configuration, and never writes it, so a change cannot steer its own demonstration; the run's `demo/subject.json` keeps what it saw. A `runs` store that the change committed, or that a link leads to, is set aside.
- **Bounded replay.** Flows from the model are replayed only when neither the plan nor configuration names one, only on an app Covi starts or serves (never at `app.url` alone), with exactly the steps that passed. A replayed flow that fails at head is a `risk` finding and never fails a gate.

## CI integrations

### Configuration comes from the base revision

`covi ci` reads `.covi/config.yml` from the change's base revision. The repository's `ignore` globs come from there too. A pull request that edits the file can't change the commands, environment pass-through, or gate of its own review. Explicit inputs (flags, `COVI_*` variables, and action or template inputs) still apply on top, because they come from your pipeline definition.

An explicit `--config <file>` (the action's `config` input) follows the same rule. If the file is inside the repository, Covi reads it from the base revision too, comparing real paths, so a pull request can't edit it either; if the base doesn't have the file, the run stops with a usage error. A file outside the checkout belongs to your pipeline, so Covi reads it from disk.

Because the base revision's configuration comes from the repository's maintainers, CI doesn't use the local trust store: its commands run without `covi trust`.

### Forks and privileged events

- **GitHub `pull_request` from a fork.** GitHub provides a read-only token and no secrets. Covi still reviews, annotates, and uploads artifacts, and marks the context untrusted, so it doesn't post the comment. The `workflow_run` pattern in [github-action.md](github-action.md#pull-requests-from-forks) posts it without running the fork's code with a write token.
- **GitHub `pull_request_target`.** The workflow runs with a write token and secrets, so Covi runs no project command: `app.install`, `app.start`, `demo.commands`, and `test.command` are all skipped. The demonstration's skipped list and the review's "Not verified" section say why. Covi still captures static sites, which run no project code, and it doesn't post a comment unless you call `covi publish --number` yourself. A configured `intelligence.command` doesn't run either, because an agent CLI would read the untrusted diff while holding the job's secrets; Covi uses the provider `auto` picks without it and says so in the run's warnings. Prefer `pull_request` plus `workflow_run`.
- **GitLab merge requests from forks.** Treated as untrusted: Covi reviews but doesn't post a note. See [gitlab-ci.md](gitlab-ci.md#merge-requests-from-forks) for how GitLab handles fork pipelines and variables.

Covi's safeguards govern Covi's own behavior. A pipeline definition that comes from an untrusted branch can do anything its runner allows, so the platform's rules for untrusted contributions still matter.

### Comments and reports

`covi publish`, and `covi ci` when it comments, build the comment from the run's `review.json` and `explanation.json`, after validating both against their schemas. All dynamic text is escaped:

- Markdown and HTML metacharacters are escaped.
- `@`-mentions are broken with a zero-width space.
- Newlines are collapsed.
- Inline code spans are kept, because they render literally. Inside table cells, `|` is escaped too, so a file path can't add cells.
- Evidence goes into code fences its content can't close.
- Provider and model names are escaped like any other text, and only hexadecimal commit ids are printed; anything else becomes `unknown`.
- Links are limited to `http(s)` URLs without characters that could break out of Markdown link syntax.

Cited evidence in a comment is shown as code: ids, labels, and file names. It becomes a link only when the platform serves run files one by one (GitLab job artifacts), the path stays inside the run and uses only letters, digits, `.`, `_`, `-`, and `/`, and the URL passes the same http(s) check as every other link.

Comments are capped at 60,000 characters. Covi edits its own comment, identified by a hidden marker, instead of posting new ones.

The Markdown reports escape dynamic text the same way: `review.md` (which also becomes the GitHub job summary), `explanation.md`, and `summary.md`. A crafted pull request title or file name renders as text in them, not as a link, image, or HTML.

In the GitHub `workflow_run` pattern, the run directory comes from an artifact that the pull request's own workflow produced, so it is untrusted. `covi publish` therefore:

- takes the pull request and the expected head commit from the trusted event, never from the artifact. GitHub leaves `pull_requests` empty for forks, so Covi finds the open pull request whose head is the reviewed commit, by its head owner, branch, and commit.
- refuses with exit code 2 a run whose manifest recorded a different head commit
- skips the comment when the pull request has moved on since the review; the newer run comments instead
- rebuilds the comment from schema-validated files with the escaping above, and executes nothing from the artifact

`--number` and `--expect-head` override the event's values for other setups; the head check applies to them too.

### Least privilege

GitHub:

- Grant `contents: read`, plus `pull-requests: write` only on jobs that comment. Add `security-events: write` only to upload SARIF, and `actions: read` only in the `workflow_run` comment job.
- Pass API keys through `secrets`, as action inputs. They are unavailable to fork pull requests, where `provider: auto` falls back to the heuristic review.
- Keep `fetch-depth: 0` so Covi doesn't need to fetch. Consider `persist-credentials: false` on `actions/checkout`, so the token isn't left in `.git/config` where project code could read it.
- Pin the action to a tag or commit SHA. By default the action builds and runs its own source at that ref; if you set `covi-package`, point it at a package you publish and control.

GitLab:

- Use a project access token with the `api` scope, the least role that can comment on merge requests, and an expiry. Store it as a masked variable in `COVI_GITLAB_TOKEN`.
- Covi uses `CI_JOB_TOKEN` for one thing: the template's install step fetches Covi's source from your instance with it. Notes and uploads use `COVI_GITLAB_TOKEN`; a job token can't write notes.
- Leave fork merge request pipelines in the fork project unless you have reviewed the change.
- Pin `covi-ref` to a tag (or `covi-package` to a version you control), so a pipeline always runs the Covi you reviewed.

Never install Covi by the bare npm name `covi`, and never run `npx covi`: on the public npm registry that name belongs to an unrelated project.

## Reporting a vulnerability

Report security issues privately, through the security advisory channel of the repository you got Covi from. On GitHub, that's **Security > Report a vulnerability**. Please don't open a public issue for a vulnerability. Include the Covi version (`covi version`), the workflow and platform, and steps to reproduce.
