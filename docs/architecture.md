# Architecture

This page describes how Covi is built: the packages and their dependency rules, the platform-independent domain model, how a change flows through the stages, and how the CLI is distributed. For the files a run produces, see [Artifacts](artifacts.md).

## Design rules

- **The domain model is platform-independent.** The core speaks of a `CodeChange`, never of pull requests. GitHub and GitLab specifics live in `packages/platforms` and `integrations/` only.
- **Methodology in skills, determinism in code.** Anything that must come out the same every time (resolution, rules, timing, rendering, QC) is code with tests. Anything that needs judgment (intent, findings, narration) is described in a skill and returned as JSON that matches a schema.
- **Artifacts are the interface.** Every stage reads and writes files in a run directory, so stages can run separately, an agent can author the inputs Covi validates (`explanation.json`, `findings.json`, a demo plan, `video/storyboard.json`), and every result can be inspected afterwards.
- **Interactive and non-interactive parity.** Every choice an agent may ask about has a configuration key and a default, so CI never waits for input.

## Packages

Covi is an npm workspace. Each package under `packages/` exports its TypeScript sources directly (`src/index.ts`).

| Package | Responsibility | May import |
|---|---|---|
| `@covi/core` (`packages/core`) | Domain model, change resolution, understanding, review rules and engine, configuration, runs and artifacts, intelligence providers, report renderers, redaction, the scrubbed environment for project commands, and the trust store for repository commands | no other Covi package |
| `@covi/brand` (`packages/brand`) | Design tokens and the SVG fox mascot; dependency-free and usable in Node and the browser | no other Covi package |
| `@covi/capture` (`packages/capture`) | Demonstration: checks out base and head, runs the software, captures pages, flows, commands, and HTTP requests, compares them | `core` |
| `@covi/video` (`packages/video`) | Video specs, storyboards, narration, captions, timeline, the browser composition runtime, renderer, QC | `core`, `brand` |
| `@covi/platforms` (`packages/platforms`) | GitHub and GitLab adapters: CI context, comments, annotations, SARIF, Code Quality, dotenv and step outputs | `core` |
| `@covi/cli` (`packages/cli`) | The `covi` command and the workflows that compose the other packages | all of the above |

Nothing imports `cli`. `tests/architecture.test.ts` enforces this direction, checks that the core never reads GitHub or GitLab environment variables or calls their APIs, and rejects TypeScript syntax that Node's type stripping cannot run (enums, namespaces, constructor parameter properties).

Outside `packages/`:

| Path | What it is |
|---|---|
| `skills/` | The methodology, as agent skills. Also loaded into model prompts. See [Skills](skills.md). |
| `templates/stories/` | Storytelling templates for videos, validated on load. See [Video](video.md). |
| `integrations/` | The GitHub Action and the GitLab CI component. Both call the CLI. |
| `examples/` | Realistic example changes with expected outcomes; used by tests and `covi examples`. |
| `bin/covi.mjs` | The executable. See [Distribution](#distribution). |
| `.claude/skills`, `.agents/skills`, `.claude-plugin/` | Agent packaging derived from `skills/`: links for Claude Code and for Codex and other clients, and the Claude Code plugin manifest. `npm run agents:check` keeps them in sync. |

## Domain model

The model lives in `packages/core/src/model/` and `packages/core/src/run/run.ts`.

| Concept | Type | File |
|---|---|---|
| A code change | `CodeChange` | `model/change.ts` |
| The repository | `Repository` | `model/change.ts` |
| Base and head revisions | `BaseRevision` and `HeadRevision` (both `Revision`), as `CodeChange.base` and `CodeChange.head` | `model/change.ts` |
| Where the change came from | `ChangeSource`, `ChangeMetadata` | `model/change.ts` |
| A changed file | `ChangedFile`, with `Hunk` and `DiffLine` | `model/change.ts` |
| The review context (output of Understand) | `ReviewContext` | `model/context.ts` |
| An explanation | `Explanation` (schema `ExplanationSchema`) | `model/explanation.ts` |
| A finding, a review | `Finding`, `FindingsFile`, `Review` | `model/finding.ts` |
| A demonstration | `DemonstrationAssessment` (whether and how to demonstrate, part of `ReviewContext`) and `Demonstration` (what was captured) | `model/context.ts`, `model/demo.ts` |
| An artifact, a run | `Artifact`, `RunManifest`, `Run` | `run/run.ts` |

Key points:

- **`CodeChange`** holds an `id` (a hash of repository, revisions, source, and for uncommitted work the diff itself), the `repository`, `base` and `head`, the `mergeBase`, the `source`, `metadata`, `commits`, `files`, `includesUncommitted`, and `stats`.
- **`BaseRevision`** and **`HeadRevision`** are `Revision`s, `{ ref, sha }`: what was asked for and what it resolved to. For a branch comparison the base SHA is the merge base, so the change contains only what the branch added. For uncommitted or staged work the head ref is `WORKTREE` or `INDEX` and the SHA is the commit the work sits on.
- **`ChangeSource`** is `range`, `branch`, `uncommitted`, `staged`, `pull-request`, or `merge-request`. Pull and merge requests appear only here and in `ChangeMetadata` (title, description, URL, number, platform, `fromFork`, branches), as provenance. The core never branches on the platform.
- **`ChangedFile`** carries the parsed hunks, status (`added`, `modified`, `deleted`, `renamed`, `copied`, `type-changed`), binary flag, modes, rename similarity, language, a category (`source`, `test`, `style`, `migration`, `lockfile`, …), and the surfaces it touches (`ui`, `api`, `cli`, `data`, `config`, `security`, …). Files excluded by the `ignore` setting or by built-in rules (vendored and generated code such as `node_modules/`, minified files, snapshots, `dist/`, and files marked as generated) stay in the list with `ignored: true` and a reason, so statistics stay honest.
- **Commits** record the author's display name only; e-mail addresses are never stored. Remote URLs are stored without credentials.

## Data flow

```
     local change                          CI event (GitHub, GitLab)
     (range, branch, staged, worktree)     platforms → PlatformContext
                  │                                   │
                  └────────────────┬──────────────────┘
                                   ▼
  resolve         CodeChange
                                   │
  understand      ReviewContext ──────────────────► context.json, diff.patch
                                   │
  demonstrate     Demonstration (optional) ──────────► demo/
                                   │ observations become demo findings
  rules           rule + demo findings ───────────► rule-findings.json
                                   │
  reason          explanation and authored findings, from an agent, a model, or heuristics
                                   │
  review          buildReview ────────────────────► explanation.*, findings.json, review.*,
                                   │                summary.md, comment.md
                    ┌──────────────┴───────────────┐
                    ▼                              ▼
  video           video pipeline ──► video/     outputs: CLI result and exit code;
                  (when worth it)               CI annotations, SARIF, Code Quality,
                                                PR/MR comment
```

Every workflow starts with a session (`startSession` in `packages/cli/src/session.ts`): resolve configuration, withhold repository commands that are not trusted (see [Security](security.md)), resolve the change, create the run, set the execution policy, understand the change, and write `context.json` and `diff.patch`. The workflows in `packages/cli/src/workflows.ts` (`analyze`, `explain`, `review`, `demo`, `video`, `render`, `report`, `summarize`) and `packages/cli/src/ci.ts` (`ci`, `publish`) then run the stages they need. `covi report` and `covi render` reopen an existing run instead of starting a new one (`openSession`), and update its recorded outcome.

The session's `ExecutionPolicy` (`packages/core/src/security/trust.ts`) tells every stage what it may run: `allowed` is false under `pull_request_target`, so no project command runs at all, and `withheld` lists repository commands that were not used because they are not trusted on this machine yet. Stages report what they skipped and why.

### Change resolution

`resolveChange` (`packages/core/src/git/resolve.ts`) turns what the user or the platform asked for into a `CodeChange`:

| Input | Meaning |
|---|---|
| nothing | The current branch against its base branch, plus uncommitted work. If the branch has no commits of its own, the uncommitted work alone. |
| `main` (a single ref) | Everything on HEAD since it diverged from `main` (merge-base semantics, like a pull request) |
| `A..B` | `A` diffed directly against `B` (use `A...B` when `A` has moved on since `B` branched) |
| `A...B` | Diffed from the merge base of `A` and `B` |
| `<sha>^!` | One commit against its parent (a root commit against the empty tree) |
| `--base` / `--head` | Explicit revisions, with merge-base semantics; `--head` needs `--base` |
| `--staged`, `--uncommitted` | Only the index, or only uncommitted work (staged, unstaged, and untracked), against HEAD |
| `--committed` | Ignore uncommitted work |

The base branch is the configured `base`, then `origin/HEAD`, then the first of `origin/main`, `origin/master`, `main`, `master`, `origin/trunk`, `trunk`, `origin/develop`, `develop` that exists. Untracked files are included as additions (up to 200 files; files over 512 KiB count as binary). Covi's own `.covi/runs` and `.covi/cache` never make the tree dirty or join a change. Refs that start with `-` are rejected.

CI checkouts are often shallow. With `--fetch` (always on in `covi ci`), Covi fetches missing commits and branches, deepens the clone step by step until the merge base appears, and unshallows as a last resort.

The diff is parsed by `parseDiff` (`git/diff-parser.ts`), which handles quoted paths, renames, copies, mode changes, binary files, and missing trailing newlines. File contents at either revision come from `RevisionReader` (`git/reader.ts`), which reads from the commit, the index, or the working tree without checking anything out.

### Understand

`understandChange` (`packages/core/src/understand/understand.ts`) is deterministic: no model, no network. It produces the `ReviewContext`:

- `size`: a class (`trivial` to `huge`), changed lines, files, areas.
- `intent`: kind (`feature`, `bug-fix`, `refactor`, `visual`, …), a one-line summary, confidence, evidence, ambiguity, conventional-commit scope, and basis (`title`, `commit`, or `files`).
- `areas`: files grouped into a handful of logical modules, so explanations talk about modules rather than files.
- `surfaces`, `symbols` (added, removed, and modified functions, classes, components, routes, …), `routes`, `dependencies` (with major-version upgrades flagged), `envVars` (and whether they are documented), `data` (migration operations, with destructive ones flagged), and `tests` (changed test files, added and removed test cases, untested source files, detected frameworks).
- `demonstration`: a `DemonstrationAssessment` with the value of demonstrating (`high` to `none`), the kinds (`ui`, `visual`, `interaction`, `cli`, `api`, `architecture`), a recommendation (`video`, `screenshots`, `text-only`), whether Covi can run the software, and concrete candidates (pages, commands, requests).
- `readingOrder`, `signals`, `notes`, and `ambiguities`.

### Review engine

The rules live in `packages/core/src/review/rules/`. Each `Rule` has an `id`, a `checks` sentence (listed in the review's "what Covi checked"), and a `run(ctx)` that returns findings with evidence. There are 26 rules in five groups:

| File | Checks |
|---|---|
| `security.ts` | raw HTML injection points, `eval` and dynamically constructed code, SQL built by string interpolation, GitHub Actions scripts that interpolate untrusted event data, `pull_request_target` workflows that check out untrusted code, workflow token permissions broadened to `write-all` |
| `correctness.ts` | `async` callbacks passed to `forEach`, silently discarded errors, error handling removed without replacement, removed exports that other files still use, removed or renamed API routes, destructive migrations, ORM schema changes without a migration |
| `accessibility.ts` | images without alternative text, focus indicators removed without a replacement, click handlers on non-interactive elements |
| `project.ts` | manifests changed without their lockfile, major-version dependency upgrades, undocumented environment variables, behavior changes without tests, a stated intent the change does not match |
| `hygiene.ts` | committed credentials or private keys, merge conflict markers, focused tests (`.only`), newly skipped tests, debugger statements |

A rule that throws is recorded and skipped; it never fails the run. `review.disableRules` turns rules off by id.

`runRules` gives every finding a stable id (`<rule>-<hash>`). `buildReview` (`review/engine.ts`) then:

1. merges authored findings (from a model or an agent) with rule and demonstration findings;
2. drops rule findings the author dismissed by id, and rule findings an authored finding supersedes (same file, within three lines, same category);
3. sorts blocking candidates (confirmed and likely) first, then the categories in `review.focus`, then by severity and certainty;
4. shows at most `review.maxFindings`, keeping the rest in `review.json` under `omitted`;
5. adds to `notVerified` what was not checked: tests not run or failing, user-visible behavior not demonstrated, logic checked by rules only;
6. derives the verdict.

The gate (`gateFailures`) counts confirmed and likely findings at or above `review.failOn`. See [Concept](concept.md#findings) for the certainty model and verdicts.

### Intelligence providers

Reasoning (the explanation and the authored findings) comes from one of:

- **An agent.** No provider runs. `covi analyze` writes `brief.md` and `rule-findings.json`; the agent writes `explanation.json` and `findings.json`; `covi report` validates both against their schemas and renders the reports.
- **A `ModelProvider`** (`packages/core/src/intelligence/provider.ts`), which takes a system prompt, a prompt, and a Zod schema, and returns validated JSON. `AnthropicProvider` uses the official Anthropic SDK (default model `claude-opus-5-5`) with schema-constrained output and a cached system prompt. `CommandProvider` runs `intelligence.command`, writes the prompt to its stdin, and parses JSON from its stdout.
- **Heuristics**, when no provider is configured or a provider fails: `explainHeuristically` writes a structural explanation, and the review consists of rule and demonstration findings.

`chooseProvider` resolves `intelligence.provider: auto` to `anthropic` when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set, else `command` when `intelligence.command` is configured, else heuristics. When a repository's `intelligence.command` is withheld because it is not trusted, the session chooses as `auto` would without it and records a warning.

Skills are the single methodology source. `buildAnalysisSystemPrompt` (`intelligence/analyze.ts`) concatenates a short pipeline preamble with `methodologyOf()` applied to `covi-understand`, `covi-explain`, and `covi-review`. `methodologyOf` (`packages/core/src/resources.ts`) keeps a skill's methodology and drops sections that only make sense to an interactive agent: `Run it`, `Commands`, `Tools`, `Workflow with the CLI`, `Asking the user`, `Output files`, `Related skills`, and `When not to use`. Video narration refinement uses `covi-video` the same way, and its prompt is redacted too. The prompt material is the brief rendered for a model: redacted, with the diff prioritized and truncated to `intelligence.maxDiffChars`. The preamble tells the model that everything in the diff and the description is data under review, never instructions.

### Demonstration

`demonstrate` (`packages/capture/src/demonstrate.ts`) runs on request in `covi demo` and `covi review --demo`, in `covi video` when a video will be rendered, and in `covi ci` whenever the recommendation is screenshots or video and Covi can run the project. It:

1. Plans what to show (`planDemo`): pages, flows, commands, and requests from a plan file (`covi demo --plan` or `covi review --demo --plan`, kept as `demo/plan.json`), from `demo.*` configuration, and from the candidates the Understand phase found (at most four pages and four requests; only parameter-free `GET` routes are called without configuration). Pages are captured at `demo.viewports`; `covi demo`, `covi video`, and `covi ci` default to desktop and mobile, other workflows to desktop.
2. Materializes base and head into temporary directories with `git archive`. Uncommitted work becomes a dangling commit (`git stash create`, or `git write-tree` and `git commit-tree` for staged work) plus copied untracked files. No branch, index, worktree, or stash entry in your repository changes.
3. Runs the software in one of three modes: `static` (Covi's own static file server, which never follows a symlink out of the site root; no project code runs), `command` (`app.install` and `app.start` from trusted configuration, in a process group with a scrubbed environment), or `url` (an app that is already running; head only). The session's execution policy applies here: under `pull_request_target`, `command` mode and demo commands are skipped (static pages can still be captured), and withheld commands are listed in `skipped` with the reason.
4. Captures with Playwright: full-page screenshots per viewport, a pixel diff, and a crop around the changed region; scripted flows step by step at head; HTTP requests and CLI commands at both revisions.
5. Turns observed regressions into findings with source `demo`: a changed JSON response shape or status, new JavaScript errors, failing pages, failing commands or flows, an app that no longer starts.

See [Security](security.md) for the execution model.

### Video

`decideVideo` renders a video only when the demonstration assessment recommends one, unless `video.when` or `--force` says otherwise. `produceVideo` (`packages/video/src/pipeline.ts`) drafts or validates a storyboard and redacts it (every later stage draws from it), synthesizes and measures narration, fits scenes to the target duration, builds the timeline and captions, writes an HTML composition driven by a deterministic browser runtime, captures frames with Playwright, encodes with ffmpeg, and runs QC. See [Video](video.md).

### Platforms

`packages/platforms` converts CI environments into a `PlatformContext` (base and head SHAs, change metadata and source, whether to fetch, links to the job) and back into native outputs:

- `trusted` is false for fork contributions and under `pull_request_target`; Covi then does not post comments from that job.
- `allowExecution` is false under `pull_request_target`; it becomes the session's execution policy, so no project command runs.
- In a GitHub `workflow_run` event, `expectedHead` is the reviewed commit and `pullRequestHead` locates the pull request when the event omits it (fork pull requests). `covi publish` finds the open pull request whose head is that commit, refuses a run that reviewed another commit, and skips if the pull request has moved on. The target never comes from the downloaded artifact.
- `Publisher.upsertComment` creates or updates a single comment marked `<!-- covi:review -->`, re-rendered from schema-validated artifacts with every dynamic string escaped.
- Every platform gets a SARIF report. GitHub also gets annotations, step outputs, and the job summary; GitLab gets the Code Quality report, a dotenv report, and project uploads for videos.

In CI, `.covi/config.yml` (and an explicit `--config` file inside the repository) is read from the base revision, so a change cannot reconfigure its own review. See [GitHub Action](github-action.md), [GitLab CI](gitlab-ci.md), and [Security](security.md).

## Configuration

`resolveConfig` (`packages/core/src/config/resolve.ts`) merges layers in precedence order, lowest first: `global` (built-in defaults), `workflow`, `repository` (`.covi/config.yml`), and `explicit` (`COVI_*` environment variables, then command-line flags). It records the layer that set every key; the provenance is saved in `run.json`. The `workflow` layer (`WORKFLOW_DEFAULTS` in `packages/cli/src/workflows.ts`) currently sets `demo.viewports` to desktop and mobile for `demo`, `video`, and `ci`. See [Configuration](configuration.md).

## Runs

`Run` (`packages/core/src/run/run.ts`) owns a run directory. Stages run through `run.stage(name, fn)`, which records timing, status, and errors. Writes go through `run.writeJson` and `run.writeText`, which redact the content, write atomically, and record the artifact's kind, size, and SHA-256 in `run.json`. The manifest is rewritten after every stage, so an interrupted run can still be inspected. `run.finish` records the outcome once; `run.updateOutcome` lets `covi report` and `covi render` update it later without changing the original timing. See [Artifacts](artifacts.md).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The review gate failed (confirmed or likely findings at or above `review.failOn`) |
| 2 | Usage error or invalid input, including schema errors in agent-authored files |
| 3 | Environment problem: not a git repository, missing ffmpeg or browser, missing credentials for a configured provider |
| 4 | Internal error |

## Distribution

- **From a checkout.** `bin/covi.mjs` runs `packages/cli/src/main.ts` directly when Node supports type stripping (Node 22.18 and later) and the sources exist, so edits apply without a build. The browser runtime for video compositions is bundled on demand with esbuild.
- **As a package.** `npm run build` (also run on `npm install` through `prepare`) writes `dist/covi.mjs`, the CLI with Covi's internal packages bundled, and `dist/runtime/composition.js`, the prebuilt browser runtime. Playwright and the font packages stay external. The published package contains `bin/`, `dist/`, `skills/`, `templates/`, `assets/`, `examples/`, `AGENTS.md`, `README.md`, and the license.
- `COVI_USE_DIST=1` forces the bundle even in a checkout. `COVI_HOME` overrides where Covi looks for its resources (`skills/`, `templates/`); by default it finds them next to the code.
