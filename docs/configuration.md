# Configuration

This page covers `.covi/config.yml`: every key with its type, default, and meaning; how configuration layers combine; the `COVI_*` environment variables; which commands need your trust before they run; and how CI decides which configuration to trust.

## Zero configuration

Covi needs no configuration. Without a config file:

- **Change:** `covi review` compares the current branch with the detected base branch (see [Choosing the change](cli.md#choosing-the-change)).
- **Reasoning:** a coding agent does it when Covi runs inside one. Otherwise it is the `anthropic` provider when `ANTHROPIC_API_KEY` is set, or the built-in rules and a structural explanation.
- **Static sites:** detected and served as-is for demonstrations, with no project code run. Covi looks for an `index.html` in the repository root, `public/`, `static/`, `site/`, or `www/`, in a project without a frontend build tool.
- **Videos:** short-form (vertical, about 30 seconds), narrated with the best available voice, with captions, the Covi theme as quiet music, and subtle sound effects, rendered only when seeing the change helps.

Configuration is for what Covi cannot detect safely:

- how to start your app;
- which pages, flows, commands, or requests to demonstrate;
- the test command;
- the review gate.

## The configuration file

Covi reads `.covi/config.yml` (or `.covi/config.yaml`) at the repository root. `--config <file>` reads a different file instead; that path is relative to the current directory. Every key is optional. Write only what you want to change.

```yaml
# .covi/config.yml
app:
  install: npm ci
  start: npm run dev -- --port {port}
test:
  command: npm test
review:
  failOn: high
```

Validation is strict:

- An unknown key or an invalid value is an error, with exit code 2, so typos never pass silently:

  ```console
  error .covi/config.yml is invalid:
    review.failOn: expected one of "none", "low", "medium", "high"
    video: unknown key(s): moed
  hint: See docs/configuration.md for every supported key.
  ```

- A section whose keys are all commented out counts as absent.
- Durations accept seconds (`90`) or strings such as `30s`, `1m30s`, or `2 minutes`.

`covi schema config` prints the JSON Schema of the file, for editor validation. `covi doctor` validates the file.

## `covi init`

`covi init` writes a small, commented `.covi/config.yml` from what it can detect safely:

- the base branch;
- a static site;
- a `dev`, `start`, `preview`, or `serve` script, with the matching install command for npm, pnpm, or yarn;
- a test script.

It never overwrites an existing file unless you pass `--force`. In a Vite project:

```console
$ covi init
Created …/webapp/.covi/config.yml (detected: base branch main, "dev" script, test script)

# Covi configuration. Every key is optional; see docs/configuration.md.
# Commands here run with an allowlisted environment (no tokens or keys). On your machine they
# run only after `covi trust` (covi init trusts what it writes); in CI, Covi reads this file
# from the base revision, so a change cannot alter the commands that review it.
base: main

app:
  install: npm ci
  start: npm run dev -- --port {port}
  url: http://127.0.0.1:{port}

test:
  command: npm test

review:
  failOn: none        # none | low | medium | high (confirmed and likely findings only)

# Unset video settings are asked about in interactive sessions and default to short in CI.
# video:
#   mode: short       # short | standard | custom
#   duration: auto

Trusted these commands for this repository on this machine (covi trust --revoke to undo).
```

Review the result before committing it. If your dev server listens on another host or ignores `--port`, adjust `start` and `url`. After an edit to any command, run `covi trust` again (see [Trusted commands](#trusted-commands)).

Values in the file count as decided. The video settings stay commented out, so `covi video` still asks for the type and length at a terminal or through an agent. Uncomment them to decide once for everyone.

## Precedence

Covi resolves configuration from four layers, highest first:

| Layer | Source |
|---|---|
| explicit | command-line flags, then `COVI_*` environment variables (flags win over environment variables) |
| repository | `.covi/config.yml`, or the file given with `--config` |
| workflow | defaults a command declares: `covi demo`, `covi video`, and `covi ci` capture desktop and mobile (`demo.viewports`) |
| global | Covi's built-in defaults: the values on this page |

Objects merge key by key; lists and scalar values replace the lower layer's value. `app.env` is replaced as a whole.

Covi has no per-user configuration file. For personal defaults, export `COVI_*` variables in your shell profile. They belong to the explicit layer, so they also override the repository's file.

Every run records the resolved configuration and where each value came from in `run.json` under `config.values` and `config.provenance`:

```json
"provenance": {
  "review.failOn": "explicit (COVI_* environment)",
  "review.maxFindings": "explicit (command line)",
  "test.command": "repository (.covi/config.yml)",
  "video.mode": "repository (.covi/config.yml)",
  "intelligence.provider": "global"
}
```

## In CI: configuration from the base revision

On GitHub and GitLab, `covi ci` reads `.covi/config.yml` from the base revision of the change, not from the checked-out head. A change therefore cannot rewrite its own review:

- the commands its review runs (`app.*`, `test.*`, `demo.commands`);
- its gate (`review.failOn`);
- what it ignores (`ignore`, `review.disableRules`).

A change to `.covi/config.yml` takes effect for the next change after it merges. The run's provenance shows the source, for example `repository (.covi/config.yml@1a2b3c4 (base))`.

`--config <file>` (the GitHub Action's `config` input) follows the same rule:

- **Inside the repository:** Covi reads the file from the base revision. If the file does not exist there, the run fails with exit 2.
- **Outside the repository:** Covi reads the file from disk as is.

Because this configuration is the repository maintainers', its commands run without `covi trust`. Under GitHub's `pull_request_target`, which runs with secrets, no project command runs at all.

Locally, and under `covi ci --platform local`, Covi reads the working tree's file, and its commands need your trust.

See [Security](security.md) for the full execution model.

## Trusted commands

Some keys make Covi run code, reach a URL, or shape the environment of what it runs:

- `app.install`, `app.start`, `test.command`, `demo.commands`, `intelligence.command`;
- `app.url`;
- `app.env`, `app.passEnv`.

A repository is untrusted input: checking out someone's branch can change `.covi/config.yml`. So on your machine, Covi uses these keys from the repository's configuration only after you trust that exact set for that repository with `covi trust`. Until then it withholds them, says so once per run, and works without them:

```text
.covi/config.yml sets app.install, app.start, app.url, test.command, which are not trusted on this machine yet, so Covi did not use them. Run `covi trust` to review and allow them.
```

- **What changes:** without `app.start`, demonstrations fall back to what needs no project code (a static site) or are skipped with that reason; without `test.command`, the review's "Not verified" says the tests were not run because of trust; without `intelligence.command`, Covi uses the provider `auto` would pick.
- **Exact set:** trust records the values, keyed by the repository's path. Any change to one of them withholds the set again until you run `covi trust` again.
- **Already trusted:** what `covi init` writes, and the bundled examples that `covi examples create` builds.
- **Not gated:** a file you pass with `--config` (your own choice), and CI, where configuration comes from the base revision.
- **One run only:** `--trust-commands` or `COVI_TRUST_COMMANDS=1` uses the commands without recording trust.
- **Where trust is kept:** `$COVI_TRUST_FILE`, else `$XDG_DATA_HOME/covi/trust.json`, else `~/.local/share/covi/trust.json`. Records for repositories that no longer exist are dropped. `covi trust --revoke` forgets a repository's set.

`covi doctor` shows whether the current set is trusted. See [`covi trust`](cli.md#covi-trust).

## Reference

### Top level

| Key | Type | Default | Meaning |
|---|---|---|---|
| `base` | string | detected | Base branch for the default comparison, tried as `origin/<base>` first, then `<base>`. |
| `language` | `auto`, `en`, `ko`, `ja`, `zh` | `auto` | The language Covi writes and speaks in: explanations, findings, reports, the pull or merge request comment, drafted video narration, captions, and on-screen labels. `zh` is Simplified Chinese; `zh-CN` and `zh-Hans` mean the same. `auto` uses the language the change's own title, description, and commit messages are written in (the dominant script; identifiers and code don't count), else English. `run.json` records the result and why. See [Language](#language). |
| `ignore` | list of globs | `[]` | Files to leave out of the review. They are listed as ignored but not analyzed. |

#### Language

Covi writes for people in English, Korean, Japanese, or Simplified Chinese. A run resolves one language, in this order: `--language` (or `COVI_LANGUAGE`), then `language` in configuration, then `auto`. It applies to:

- What Covi writes itself: the structural explanation, rule findings, the review summary and notes, the agent brief, `demo/demo.md`, report headings, and the comment. The fixed strings are message catalogs in `templates/i18n/<language>.yml`.
- What agents and models write: the brief and the model prompts ask for that language, and `explanation.json`, `findings.json`, and `storyboard.json` may declare it with `language`. A declared language decides the headings of the reports rendered from that file.
- Videos: drafted narration, captions, eyebrows, and labels, and the narration language (see [Narration language](video.md#narration-language)).

Identifiers, paths, code, commands, and quoted evidence stay as they appear in the change. CLI log messages stay in English.

`ignore` patterns follow `.gitignore` conventions:

- `*`, `**`, `?`, `{a,b}`, and character classes work.
- A pattern without a slash matches at any depth.
- A directory pattern also matches everything beneath it.

These are always ignored:

- Vendored code: `node_modules/`, `vendor/`, `third_party/`.
- Minified files and source maps.
- Snapshots: `__snapshots__/`, `*.snap`.
- Generated code: `*_pb2.py`, `*.pb.go`, `*.generated.*`, `*.gen.*`.
- Build output: `dist/`, `build/`, `coverage/`, `.next/`, `.nuxt/`.
- Covi's own `.covi/runs/` and `.covi/cache/`.

### `intelligence`

Who does the reasoning: the explanation, the findings beyond the built-in rules, and the narration a model writes.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `provider` | `auto`, `heuristic`, `anthropic`, `command` | `auto` | `auto` picks `anthropic` when `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set, else `command` when `command` is set, else `heuristic`. |
| `model` | string | `claude-opus-5-5` | Model id for the `anthropic` provider. |
| `command` | string | none | Shell command for the `command` provider: an agent CLI that reads a prompt on stdin and prints a JSON object, for example `claude -p`. |
| `maxDiffChars` | integer, at least 10,000 | `120000` | How much of the diff, in characters, goes into a model prompt and into the agent brief. |
| `timeout` | duration | `300` (seconds) | Time limit for each model call. |

The providers differ:

- **`heuristic`** uses Covi's built-in rules and a structural explanation, with no model.
- **`anthropic`** calls the Anthropic API. It fails with exit 3 when no key is set.
- **`command`** pipes the prompt to `command`. It runs with Covi's own environment, because the agent CLI needs its credentials. On your machine it runs only once [trusted](#trusted-commands); in CI it comes from the base revision like the rest of the configuration.

If a model call fails, Covi falls back to the heuristics and records a warning.

Inside a coding agent you usually do not configure a provider. The agent reads the brief from `covi analyze`, writes `explanation.json` and `findings.json`, and runs `covi report` (see [Agent-driven reviews](cli.md#agent-driven-reviews)).

### `review`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `failOn` | `none`, `low`, `medium`, `high` | `none` | The gate. A review exits 1 when a confirmed or likely finding has at least this severity. Risks and questions never fail it. |
| `maxFindings` | integer, 1–50 | `10` | Findings shown in the review. Blocking candidates come first. The rest are kept in `review.json` under `omitted`. |
| `focus` | list of categories | `[]` | Categories to rank first. Confirmed and likely findings still come before risks and questions; within each group, these categories lead. |
| `disableRules` | list of rule ids | `[]` | Built-in rules to turn off. |
| `runTests` | boolean | `false` | Run `test.command` as part of every review (same as `--run-tests`). |

Categories: `correctness`, `regression`, `edge-case`, `error-handling`, `state`, `concurrency`, `security`, `permissions`, `api-compatibility`, `data-integrity`, `performance`, `accessibility`, `testing`, `ui`, `maintainability`, `complexity`, `intent-mismatch`, `dependency`, `configuration`.

Rule ids, grouped by area:

- **Hygiene:** `secret-in-diff`, `merge-conflict-markers`, `focused-test`, `skipped-test`, `debug-leftover`.
- **Security:** `dangerous-html`, `dynamic-code-execution`, `sql-string-building`, `workflow-script-injection`, `workflow-pull-request-target`, `workflow-broad-permissions`.
- **Correctness:** `async-foreach`, `empty-catch`, `error-handling-removed`, `removed-export-still-referenced`, `route-removed`, `destructive-migration`, `schema-without-migration`.
- **Accessibility:** `img-missing-alt`, `focus-outline-removed`, `click-on-static-element`.
- **Project:** `lockfile-out-of-sync`, `major-dependency-upgrade`, `env-var-undocumented`, `missing-tests`, `intent-mismatch`.

Every review lists what was checked and what was not verified.

### `test`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `command` | string | none | The test command, for example `npm test`. |
| `timeout` | duration | `600` (seconds) | Time limit for the test command. |

Tests run only when `review.runTests` is true or you pass `--run-tests`. They run in the repository's working directory, so they test the checked-out revision. Covi skips them, with a note under "Not verified", in these cases:

- locally, when the reviewed head is a different branch from the one checked out;
- when `test.command` is not [trusted](#trusted-commands) on this machine;
- under `pull_request_target` in GitHub Actions, where no project command runs.

The result appears in the review, and the command, exit code, and duration are recorded in `run.json`.

### `app`

How Covi runs your software for demonstrations. Each revision is checked out into a temporary directory, and the app is started there for the base and then for the head. Your working tree is never touched. On your machine, `install`, `start`, `url`, `env`, and `passEnv` from the repository's configuration take effect only once [trusted](#trusted-commands).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `install` | string | none | Run in each checkout before `start`, for example `npm ci`. Limited to 15 minutes. |
| `start` | string | none | Starts the app. `{port}` is replaced with the port, which is also in `PORT`. |
| `url` | string | `http://127.0.0.1:{port}` | Where the started app listens. Without `start`, the URL of an app that is already running. |
| `port` | integer | a free port | Use a fixed port instead. |
| `static` | path | detected | Serve this directory as a static site. No project code runs. |
| `readyPath` | string | `/` | Path Covi polls until the app answers with a status below 500. |
| `timeout` | duration | `120` (seconds) | How long to wait for the app to become ready. |
| `env` | map of strings | `{}` | Extra environment variables for project commands. |
| `passEnv` | list of names | `[]` | Variables to pass through from Covi's environment, such as a database URL the app needs. |

How Covi runs the app:

- **`start` set:** Covi runs the app at the base and the head, and compares them.
- **Only `url` set:** Covi captures the running app at the head only, so there is no before-and-after comparison.
- **Only `static` set, or a detected static site:** Covi serves the files itself.

Project commands (`install`, `start`, `test.command`, `demo.commands`) get an allowlisted environment:

- **Included:** `PATH`, `HOME`, locale, proxy, and toolchain variables, plus `env` and `passEnv`.
- **Excluded:** tokens, keys, and cloud credentials.
- **Set by Covi:** `CI=1`, `BROWSER=none`, and `GIT_TERMINAL_PROMPT=0` keep tools non-interactive.

See [Security](security.md).

```yaml
app:
  install: npm ci
  start: npm run start -- --port {port}
  readyPath: /health
  env:
    NODE_ENV: development
  passEnv: [DATABASE_URL]
```

### `demo`

What to demonstrate. Covi adds what it detects: pages rendered by changed files, and parameter-free `GET` routes. An agent can pass a plan with `covi demo --plan <file>` (`covi schema demo-plan`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `pages` | list of paths | `[]` | Pages captured at base and head in every viewport, with a pixel diff and a crop around the change. At most four pages per run, including detected ones. |
| `flows` | list of flows | `[]` | Scripted interactions run at base and head, each recorded and traced. Each interactive step is captured before it happens, and the flow ends with the resulting state. A flow that fails at base is expected when the change adds what it uses; one that fails at head is a finding. |
| `commands` | list of commands | `[]` | Commands run in each revision's checkout; their output is compared. |
| `requests` | list of requests | `[]` | HTTP requests sent to the running app at base and head. Status and JSON shape are compared. At most four per run, including detected ones. |
| `viewports` | list of `desktop`, `tablet`, `mobile` | `[desktop]`; `[desktop, mobile]` for `covi demo`, `covi video`, and `covi ci` | Viewports for pages. A flow uses its own first viewport, or the first one here. |
| `record` | `true`, `false` | `true` | Record every flow at base and head into `demo/recordings/` (MP4 when ffmpeg is installed, else WebM). When it is set explicitly — here, with `--record`, or with `COVI_DEMO_RECORD` — a recording that cannot be made (Chromium is missing, the recorder does not start, or a recording cannot be saved) fails the run with exit code 3; otherwise Covi records what it can and says why in `captures.json`. |

The viewport sizes are:

- `desktop`: 1280×800.
- `tablet`: 834×1112 at 2×.
- `mobile`: 390×844 at 2×.

A **flow** has these keys:

- `name` (required).
- `path`: where it starts; default `/`.
- `description`.
- `viewports`.
- `steps`: a list in which each step has exactly one action:

| Step | Meaning |
|---|---|
| `goto: /path` | Navigate within the app. |
| `click: <selector>` | Click. Optional `note` labels the step. |
| `fill: <selector>` with `text: …` | Type into a field. Optional `note`. |
| `press: Enter` | Press a key, optionally on `selector`. |
| `hover: <selector>` | Hover. |
| `select: <selector>` with `value: …` | Choose an option. |
| `check: <selector>` | Tick a checkbox. |
| `scroll: <selector or pixels>` | Scroll an element into view, or by a number of pixels. |
| `wait: <ms or selector>` | Wait a number of milliseconds, or until the selector appears; at most 10 seconds either way. |
| `screenshot: <label>` | Capture now. Optional `focus` selector and `note`. |

Selectors are Playwright selectors.

A **command** has these keys:

- `name`.
- `run`.
- `compare`: default `true`; `false` runs it at the head only.
- `timeout`: default 60 seconds.

Commands get `APP_URL` when an app is running.

A **request** has these keys:

- `name`.
- `method`: default `GET`.
- `path`.
- `headers`.
- `body`: sent as JSON.
- `compare`: default `true`; `false` sends it at the head only.

```yaml
demo:
  viewports: [desktop, mobile]
  flows:
    - name: Write a comment
      path: /
      steps:
        - fill: "#comment"
          text: "Looks good to me"
          note: Type a comment
        - screenshot: Counter updates as you type
          focus: ".composer"
        - click: "#post"
          note: Post the comment
  commands:
    - name: Slugify a title
      run: node bin/slugify.js "Héllo  Wörld!"
  requests:
    - name: List users
      path: /api/users
```

Commands in `demo.commands` run only once [trusted](#trusted-commands) on your machine.

Differences Covi observes become findings in `covi review --demo`, `covi video`, and `covi ci`. Examples are a changed response shape, a new server error, a page error, a command that now fails, a flow that cannot complete, or an app that no longer starts. Every demonstration that runs at both revisions also writes `demo/behavior-diff.json`, the step-by-step comparison of each page and flow.

### `subject`

The subject model is what Covi has seen of the software: the screens it captured at head, the elements on them, the flows that passed, and the CLI and HTTP scenarios that ran. A demonstration updates it, and the next one replays its flows when neither the plan nor `demo.flows` names any (see [Artifacts](artifacts.md#the-subject-model)).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `store` | `repo`, `runs`, `off` | `repo` | `repo` keeps the model in `.covi/subject/subject.json`. It is small and meant to be committed, so everyone's runs share it. `runs` keeps it as `subject.json` in the runs directory, never committed. `off` neither reads nor writes one. In CI, `repo` is read from the base revision, like configuration, and never written: the run's `demo/subject.json` holds what it saw. A `runs` store is read and written in CI too, unless the change committed that file or reaches it through a symbolic link; then it is set aside with a warning. |
| `expireAfter` | integer, 1–100 | `20` | Forget a screen, element, flow, or scenario not seen in this many revisions. A revision is a distinct commit at which a demonstration updated the model. Running again at the same commit does not count, and neither does a run that changed nothing. An entry seen again is restamped only every half window, so it is forgotten between half and all of this many revisions after it was last seen. |

**Replayed flows.** When neither the plan nor `demo.flows` names a flow, Covi replays up to two flows from the model that passed within its revisions and start on a page this run captures, the most recently passed first, with exactly the steps that passed. It replays them only on an app it starts or serves, never on one reached through `app.url` alone. A replayed flow that fails at head is a `risk` finding, so it never fails a gate. A plan with `"flows": []` turns replays off for one run; `subject.store: off` turns them off for good.

**A committed model.** A run that saw nothing new leaves `.covi/subject/subject.json` byte for byte as it was, but branches that each changed it can still conflict over it. Take either side, or delete the file: the next run rebuilds it. Until then, Covi warns and plans without it ([Artifacts](artifacts.md#the-subject-model)).

```yaml
subject:
  store: runs       # keep the model out of the repository
  expireAfter: 30
```

### `video`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `when` | `auto`, `always`, `never` | `auto` | Whether `covi ci` and `covi video` render a video: when Covi judges it useful, always (even when Covi would decline), or never. `covi video --force` renders despite `never`. |
| `mode` | `short`, `standard`, `custom` | `short` | `short`: vertical 9:16 (1080×1920), about 30 seconds. `standard`: 16:9 (1920×1080), up to 120 seconds. `custom`: your size. |
| `duration` | `auto` or duration | `auto` | Target length. `auto` uses the mode's range (short: 20–35 s, standard: 60–120 s; a custom size uses the short range unless it is landscape). A number sets the target with a window of about ±15% (at least ±2 s); the window's maximum is a ceiling, and Covi never pads a shorter video. |
| `width`, `height` | integer, 240–3840 | from `mode` | Frame size. For `custom`, a missing side is filled to 16:9, and with neither set the size is 1920×1080. With `short` or `standard`, a value you set replaces that side of the preset. |
| `fps` | integer, 10–60 | `30` | Frame rate. |
| `narration` | boolean or object | `true` | `false` makes a captions-only video. The object form has `enabled`, `provider`, `voice`, `rate`, and `pronunciations`. |
| `narration.provider` | `auto`, `system`, `openai`, `elevenlabs`, `none` | `auto` | `auto` prefers ElevenLabs (`ELEVENLABS_API_KEY`), then OpenAI (`OPENAI_API_KEY`), then the system voice: macOS `say`, `espeak-ng`, or `espeak`. |
| `narration.voice` | string | per engine | Voice name or id. |
| `narration.rate` | number, 0.8–1.3 | `1` | Speech rate multiplier. |
| `narration.pronunciations` | map | `{}` | How the voice should say particular words. See [Pronunciations](#pronunciations). |
| `captions` | boolean | `true` | Burn captions into the video. Captions are also written as `captions.vtt` and `captions.srt`. |
| `theme` | `light`, `dark` | `light` | Color theme. |
| `style` | `concise`, `explanatory` | from `mode` | Guides the narration a model writes. Short videos are concise and standard ones explanatory; a custom video is explanatory when it is longer than 45 seconds. |
| `mascot` | boolean | `true` | Show the Covi fox narrator. |
| `music.use` | `theme`, `compose`, `none` | `theme` | Background music. `theme`: the bundled Covi theme, arranged to the story and the verdict. `compose`: a score written for this video, by the agent in an interactive session or by the configured model in CI (without either, the theme, with a warning). `none`: no music. See [Sound](video.md#sound). |
| `music.placement` | `auto`, `continuous`, `bookends` | `auto` | Where the music plays. `auto`: the kind of video decides (a quiet bed under short-form narration, music around the narration of standard reviews). `continuous`: a quiet bed under the narration, 20 dB under the voice, rising in the pauses. `bookends`: music only around the narration: the opening, the breaths between lines, under the key moment, and the end. See [Where the music plays](video.md#where-the-music-plays). |
| `soundEffects.enabled` | boolean | `true` | Subtle sound effects for what happens on screen: a click, the before/after reveal, a finding card, the verdict, and (without music) the outro's sign-off. |
| `outro` | boolean | `true` | End with Covi's outro: the fox and the logo, the verdict, and the sign-off, where the music's sonic logo lands. `false` holds the last scene for a second instead. See [The outro](video.md#the-outro). |

```yaml
video:
  music:
    use: none          # theme | compose | none
    placement: auto    # auto | continuous | bookends
  soundEffects:
    enabled: true
  outro: true
```

`music` and `soundEffects` are objects rather than plain values because configuration has no version: keys can be added later, never repurposed. Music runs no command and downloads nothing, so it needs no trust; in CI it comes from the base revision like the rest of the file.

See [Video](video.md) for how these shape the storyboard, timing, sound, and quality checks.

#### Pronunciations

Voices for Korean, Japanese, and Chinese misread Latin names. Covi spells out acronyms on its own (see [Spoken form](video.md#spoken-form)); `pronunciations` covers the rest: product names, lowercase identifiers, and words you want said a particular way.

```yaml
video:
  narration:
    pronunciations:
      CLI: 씨엘아이                 # every language
      c2: { ko: 씨투, ja: シーツー }  # per language; others keep the default
      kubectl: cube control
```

- A key matches exactly and case-sensitively, as a whole token: `c2` matches in `c2-delegate`, not in `c22`. Longer keys win over shorter ones.
- A value is one spoken form for every language, or a map of `en`, `ko`, `ja`, and `zh`. Keys are up to 64 characters, values up to 128, at most 500 entries.
- Pronunciations apply in prose, code spans, and paths, but never inside URLs or e-mail addresses. They win over Covi's built-in words and letter spelling, and they apply to English narration too.
- A spoken form must not contain a key, or the next pass would rewrite it again; Covi rejects such a map.
- Captions are not affected. `video/speech.json` shows what the voice was given.

The map is replaced as a whole, not merged key by key, when several configuration layers set it.

### `output`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `dir` | path | `.covi/runs` | Where runs are written, relative to the repository root. The directory ignores itself for git. |
| `keep` | integer, 1–1000 | `20` | How many runs to keep. Covi deletes the oldest run directories beyond this. |

### `publish`

Used by `covi ci` and `covi publish`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `comment` | boolean | `true` | Post or update one summary comment on the pull or merge request. |
| `annotations` | boolean | `true` | Annotate findings inline: workflow annotations in GitHub Actions, the Code Quality report in GitLab CI (written empty when `false`). |
| `video` | `link`, `upload`, `none` | `link` | How the comment refers to the video. `link` links to it: the job artifact file on GitLab, otherwise the uploaded artifacts. `upload` uploads the MP4 where the platform supports it (GitLab) for inline playback, and links elsewhere. `none` leaves the video out. |
| `botLogin` | `name[bot]` | `github-actions[bot]` | The GitHub App bot Covi comments as when its token has no user of its own (the workflow token, or an app token). Covi takes a comment or a finding anchor as its own only when that bot wrote it, or, for a token with a user, when that user did. |

## Environment variables

These variables set configuration keys in the explicit layer. Command-line flags override them.

| Variable | Key |
|---|---|
| `COVI_LANGUAGE` | `language` |
| `COVI_PROVIDER` | `intelligence.provider` |
| `COVI_MODEL` | `intelligence.model` |
| `COVI_FAIL_ON` | `review.failOn` |
| `COVI_DEMO_RECORD` | `demo.record` (same values as `COVI_NARRATION`) |
| `COVI_VIDEO_MODE` | `video.mode` |
| `COVI_VIDEO_DURATION` | `video.duration` |
| `COVI_NARRATION` | `video.narration.enabled` (`1`, `true`, `yes`, `on` mean on; anything else off) |
| `COVI_TTS_PROVIDER` | `video.narration.provider` |
| `COVI_TTS_VOICE` | `video.narration.voice` |
| `COVI_CAPTIONS` | `video.captions` (same values as `COVI_NARRATION`) |
| `COVI_MUSIC` | `video.music.use`: `theme`, `compose`, or `none` |
| `COVI_MUSIC_PLACEMENT` | `video.music.placement`: `auto`, `continuous`, or `bookends` |
| `COVI_SOUND_EFFECTS` | `video.soundEffects.enabled` (same values as `COVI_NARRATION`) |
| `COVI_OUTRO` | `video.outro` (same values as `COVI_NARRATION`) |
| `COVI_OUTPUT_DIR` | `output.dir` |

The narration variables combine: `COVI_NARRATION=false` with `COVI_TTS_VOICE=Reed` keeps narration off and records the voice.

Credentials are never configuration keys. They come only from the environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, and the platform tokens. The [CLI reference](cli.md#environment-variables) lists every variable Covi reads.
