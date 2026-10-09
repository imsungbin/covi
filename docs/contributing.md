# Contributing

This page is for people changing Covi itself. It covers development setup, the checks, how tests are organized, and how to add examples, review rules, and storytelling templates. It also covers changing the video runtime and the schemas, plus building the distributable package. The rules that keep the architecture sound are in [architecture](architecture.md) and in `AGENTS.md`, which is the guide coding agents read when they work on this repository.

## Set up

You need Node.js 22.18 or later (`.nvmrc` pins 22) and git.

```bash
npm install          # installs the workspaces and builds dist/ (the prepare script)
./bin/covi.mjs doctor
```

Covi runs its TypeScript sources directly on Node's built-in type stripping, so there is no build step during development. `./bin/covi.mjs` (or `npm run covi -- <command>`) uses `packages/cli/src/main.ts` when the sources are present, and an edit takes effect on the next run. Set `COVI_USE_DIST=1` to run the bundled `dist/covi.mjs` instead.

Demonstrations and videos need more tools. `covi doctor` reports which ones it finds:

- Chromium for Playwright: `./bin/covi.mjs doctor --install-browser` downloads the build that Covi's pinned Playwright version expects (add `--with-deps` on Linux for the system libraries). A separately run `npx playwright` may be a different version.
- ffmpeg and ffprobe, built with H.264: `brew install ffmpeg` or `apt-get install ffmpeg`
- A speech engine for narration: `say` (built into macOS), `espeak-ng` on Linux, or an `OPENAI_API_KEY` or `ELEVENLABS_API_KEY`. Videos fall back to captions only when none is available.

Try a change end to end:

```bash
./bin/covi.mjs examples create ui-comment-composer --into /tmp/covi-ui
./bin/covi.mjs review --repo /tmp/covi-ui --demo
./bin/covi.mjs video --repo /tmp/covi-ui --short
```

`covi examples create` trusts the commands in the example's own configuration, because examples ship with Covi. In any other repository, commands in `.covi/config.yml` stay withheld until you run `covi trust` there (see [security](security.md)).

## Repository layout

The packages, their responsibilities, and the dependency direction between them are described in [architecture](architecture.md). The repository map in `AGENTS.md` lists every top-level directory. In short:

- `packages/*` holds the code.
- `skills/` and `templates/` hold product logic as text and data.
- `integrations/` holds the GitHub Action and the GitLab CI component.
- `examples/` holds realistic test changes.
- `tests/` holds cross-package tests.

## Checks

| Command | Runs |
|---|---|
| `npm run lint` | `biome check .` (formatting, lint, import order) |
| `npm run lint:fix` | `biome check --write .` |
| `npm run format` | `biome format --write .` |
| `npm run typecheck` | `tsc -p tsconfig.json`, then `tsc -p packages/video/src/runtime/tsconfig.json` (the browser runtime, with DOM types) |
| `npm run agents:check` | `node scripts/sync-agents.ts --check`: skills are well formed, `.claude/skills` and `.agents/skills` link to `skills/`, `CLAUDE.md` imports `AGENTS.md`, and the plugin manifest version matches `package.json` |
| `npm test` | `vitest run`: every unit and integration test |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:render` | `COVI_TEST_RENDER=1 vitest run tests/render`: also renders full review videos |
| `npm run check` | `lint`, `typecheck`, `agents:check`, and `test`, in that order |

Run `npm run check` before you open a pull request. CI (`.github/workflows/ci.yml`) runs the same check on every pull request and on every push to `main`. The asset check runs as part of `npm test` (see [derived files](#derived-files)).

## Tests

- **Unit tests** live next to their package in `packages/*/test/*.test.ts`. Among them, `packages/core/test/trust.test.ts`, `comment.test.ts`, and `static-server.test.ts` cover the trust store, comment escaping against hostile input, and the static server's refusal to follow paths or symlinks out of its root.
- **Integration tests** live in `tests/`:
  - `cli.test.ts` runs the real CLI.
  - `ci.test.ts` runs `covi ci` and `covi publish` against a local mock of the GitHub and GitLab APIs, including `pull_request_target` (no project command runs), configuration and `--config` read from the base revision, comments on fork pull requests from a `workflow_run`, and GitLab's `--no-annotations`.
  - `demo.test.ts` runs demonstrations on the examples.
  - `examples.test.ts` checks Covi's judgment on each example.
  - `integrations.test.ts` validates `action.yml` and the GitLab template: exact CLI flags, empty defaults for inputs that mirror settings, install sources, the Playwright image tag, and rendering with default inputs.
  - `architecture.test.ts` enforces the dependency direction, a platform-independent core, strippable TypeScript syntax, and agent packaging.
  - `trust.test.ts` checks that commands in repository configuration stay withheld until trusted, and that `covi init` trusts what it writes.
  - `redaction.test.ts` checks that a secret in the diff never reaches the video storyboard.
  - `render/` renders videos.
- **Setup:** `tests/setup.ts` (Vitest `setupFiles`) points `COVI_TRUST_FILE` at a temporary file, so tests never read or write your own trust store. Processes the tests spawn inherit it.
- **Helpers** in `tests/helpers/`:
  - `repo.ts` creates temporary git repositories with fixed identities and dates, and never reads your git configuration.
  - `analyze.ts` builds a base → head change and runs Understand and the review rules on it.
  - `cli.ts` runs `bin/covi.mjs`.
  - `env.ts` reports what the machine can do.

Vitest runs test files in forked processes with 60-second timeouts and uses the `dot` reporter when `CI` is set. To run one file or one test:

```bash
npx vitest run packages/core/test/rules.test.ts
npx vitest run -t "focus outline"
```

Tests that need more than git skip themselves when a tool is missing. The gates live in `tests/helpers/env.ts`:

| Gate | Requires | Tests |
|---|---|---|
| `canUseBrowser()` | Playwright's Chromium (`covi doctor --install-browser`) | Browser demonstrations in `tests/demo.test.ts` (the API, UI flow, and visual examples). The CLI demonstration and the "nothing to show" case always run. |
| `canRenderVideo()` | ffmpeg, ffprobe, and Chromium | `tests/render/render.test.ts`: renders a small composition to H.264 and runs QC, and checks that the same timeline renders identical frame bytes |
| `fullRenders` | `COVI_TEST_RENDER=1` (set by `npm run test:render`) | The full `covi video` pipeline on `ui-comment-composer` (short, 30 s) and `api-users-pagination` (standard), and `tests/render/sound.test.ts`: the theme's synthesis time and loudness against ffmpeg, a short video with the theme then re-mixed without music, a standard review's placement, and a composed score. This takes several minutes. |

A skipped test is reported as skipped, not passed. Before you change capture or video code, install the tools so these tests actually run.

## Example changes

`examples/<name>/` holds a realistic change that tests and `covi examples` build into a real git repository:

- `base/` is the full tree, committed on `main` as "Initial version".
- `head/` is an overlay copied over `base/` on the example's branch. It contains only the files that change.
- `change.yml` describes the change and what Covi should conclude about it.

```yaml
title: Fix slugify for accented characters and repeated separators
description: A bug fix in a small command-line tool. ...
branch: fix/slugify-accents
commits:
  - message: "fix(slugify): keep accented letters and collapse repeated separators"
expect:
  intent: bug-fix
  demonstration: high
  video: true
  template: bug-fix
  rules: []
  verdict: looks-good
```

| Field | Meaning |
|---|---|
| `title`, `description` | Shown by `covi examples` |
| `branch` | Branch the head is committed on |
| `commits` | At least one `{ message }`. The first commit carries the change; later ones are empty commits, useful for multi-commit intent. |
| `delete` | Paths to remove in the head (optional) |
| `expect.intent` | Expected intent kind (`feature`, `bug-fix`, `refactor`, `visual`, …) |
| `expect.demonstration` | Expected demonstration value: `high`, `medium`, `low`, or `none` |
| `expect.video` | Whether `video.when: auto` should render a video |
| `expect.template` | Storytelling template Covi should pick (optional) |
| `expect.rules` | Exact set of rule ids expected to fire (default none) |
| `expect.demoFindings` | Findings a demonstration should add, such as `api-shape` (default none) |
| `expect.verdict` | Expected verdict (optional). It is only checked against rule findings when `demoFindings` is empty, because demonstration findings change the verdict. |

The schema is strict (`ExampleSchema` in `packages/cli/src/examples.ts`), so misspelled keys fail. Put any configuration the example needs, such as how to start the app, what flows to run, and which commands to compare, in `base/.covi/config.yml`. Every example config is parsed by a test, and building an example trusts its commands. Repositories are built with fixed author names and dates, so runs are reproducible. Biome ignores `examples/*/base` and `examples/*/head`.

`tests/examples.test.ts` checks each example's intent, demonstration value, video decision, rule ids, verdict, and template choice. It also drafts short and standard storyboards for each one and validates them. Add your example's name to the list in the test named "ships the six reference scenarios". Try it with:

```bash
./bin/covi.mjs examples create <name> --into /tmp/covi-example
./bin/covi.mjs review --repo /tmp/covi-example
```

## Adding a review rule

Rules are deterministic, evidence-producing checks in `packages/core/src/review/rules/`. They are grouped by theme in `accessibility.ts`, `correctness.ts`, `hygiene.ts`, `project.ts`, and `security.ts`, and registered in `index.ts`. The order of `RULES` is the order in which findings are most useful to read.

```ts
import type { FindingInput } from '../../model/finding.ts';
import { addedLines, messages, quote, type Rule } from './types.ts';

export const exampleRule: Rule = {
  id: 'example-rule', // kebab-case: finding ids, dismissals, and review.disableRules use it
  checks: 'what the rule looks for', // listed under "What Covi checked" in the review
  run({ files, language }) {
    const say = messages(language, 'example-rule'); // rule.example-rule.* in templates/i18n/
    const out: FindingInput[] = [];
    for (const { file, line } of addedLines(files)) {
      if (!/some pattern/.test(line.text)) continue;
      out.push({
        title: say('title', { path: file.path }),
        certainty: 'likely',
        severity: 'medium',
        category: 'correctness',
        location: { path: file.path, line: line.newLine },
        evidence: quote(line.text),
        explanation: say('explanation'),
        suggestion: say('suggestion'),
      });
    }
    return out.slice(0, 3); // repeated hits add noise, not information
  },
};
```

The rule's text lives in the message catalogs (see [Writing text for people](#writing-text-for-people)): add `rule.example-rule.checks`, `title`, `explanation`, and `suggestion` to `templates/i18n/{en,ko,ja,zh}.yml`. The English `checks` must equal the rule's own `checks` (a test compares them).

`run` receives:

- `change`: the `CodeChange`.
- `context`: the Understand output.
- `config`.
- `reader`: reads files at the base or head revision.
- `files`: the reviewable files, with ignored paths already removed.
- `language`: the language findings are written in.

It returns findings synchronously or as a promise. `types.ts` provides `addedLines`, `removedLines`, `quote`, `isCode`, and `isAppCode`.

Guidelines:

- **Prefer silence.** Report only when the diff, or a lookup in the repository, supports the claim. A sound change should produce no findings.
- **Classify certainty honestly.**
  - `confirmed`: the evidence proves the claim.
  - `likely`: the evidence strongly suggests it.
  - `risk`: worth checking.
  - `question`: needs the author's intent.
  
  Only `confirmed` and `likely` findings can fail a CI gate.
- **Show evidence** in the finding: a quoted line, not a paraphrase. Never echo a secret; the `secret-in-diff` rule masks what it found.

Every rule needs at least two tests in `packages/core/test/rules.test.ts`: one where it fires and one where similar code stays quiet. The tests build a real repository from file maps:

```ts
it('flags the pattern but not the safe variant', async () => {
  const r = await run(
    { 'src/a.ts': 'x\n' },
    { 'src/a.ts': 'the risky code\n', 'src/b.ts': 'the safe variant\n' },
  );
  expect(r.findings.filter((f) => f.source.id === 'example-rule')).toHaveLength(1);
});
```

If the new rule fires on an example, update that example's `expect.rules`. Users can turn a rule off with `review.disableRules` (see [configuration](configuration.md)).

## Writing text for people

Covi writes in English, Korean, Japanese, and Simplified Chinese. Any fixed string a person reads (a report heading, a finding, a narration sentence, a label in the video) lives in the message catalogs `templates/i18n/{en,ko,ja,zh}.yml`, not in code:

- Look a message up with `t(language, 'group.key', { name: value })` from `@covi/core`. Placeholders are `{name}`; a plural message is a map of plural categories (`one`, `other`) chosen by `{count}`. English numbers print as before; other languages use `Intl.NumberFormat`. `listOf`, `joinSentences`, and `endSentence` join lists and sentences the way each language does.
- Add every key to all four catalogs with the same placeholders. `packages/core/test/catalog.test.ts` fails otherwise, and also checks that each language has the plural forms it needs.
- In Korean, a particle after a placeholder is a pair, `{name}{을/를}`, and Covi picks the form that agrees with how the value is read aloud (`JSON을`, `API를`).
- English output must not change unless you mean it to: `tests/english-baseline.test.ts` snapshots it.
- Ask a native speaker to read new Korean, Japanese, or Chinese text. CLI log messages stay in English.

## Adding a storytelling template

Templates are data in `templates/stories/<id>.yml`. They are validated when they load (`TemplateSchema` in `packages/video/src/templates.ts`). Unknown keys are rejected.

| Field | Meaning |
|---|---|
| `id` | Lowercase letters, digits, and hyphens; by convention also the file name |
| `name`, `description`, `use_when` | Shown by `covi templates` and read by agents choosing a template |
| `beats` | Two or more beats, in order |
| `short` | Ids of the beats used in short-form videos, in order (two or more; each must exist) |
| `hero` | The payoff beats, in priority order. The drafter marks the first scene playing one of them `hero: true`, and the music lifts there. A hero beat is never `optional` (a test checks it) |

Each beat has:

- `id` and `eyebrow`: the section label, up to 40 characters.
- `eyebrows`: the same label in Korean, Japanese, and Chinese (`{ ko: …, ja: …, zh: … }`).
- `goal`: what the scene must accomplish.
- `visuals`: preferred visuals in order of preference. The options are `title`, `change-map`, `code`, `screenshot`, `before-after`, `interaction`, `terminal`, `api`, `findings`, `callout`, `diagram`, and `summary`. Add a `:before` or `:after` suffix, as in `screenshot:before`, to pick a revision.
- `expression`: the narrator expression; defaults to `explaining`.
- `optional`: defaults to `false`.

When Covi drafts a storyboard, each beat uses the first visual that has evidence behind it:

- An optional beat with no usable visual is dropped. Optional beats are also the first to go when a video has to fit a duration.
- A required beat with no usable visual becomes a callout, except the context and summary beats and the `hero` beats: a callout is never the payoff, so a hero beat without evidence is left out.

By convention, and checked by tests, the first beat offers `title` and the last offers `summary`.

Covi picks a template automatically in `selectTemplate`, based on the change's intent and demonstration kinds:

| When | Template |
|---|---|
| Bug fixes and security fixes | `bug-fix` |
| Structural changes | `architecture-explainer` |
| Visual changes without interaction | `before-after` |
| UI and interaction changes | `feature-demo` |
| API changes | `api-change` |
| CLI changes | `cli-change` |
| Anything else | `quick-review` |

A new template is used automatically only once you add a case there, with a test. Until then, choose it with `covi video --template <id>`.

When you add a template:

- Add its id to the template list in `tests/examples.test.ts`. The test "can be forced for any change" drafts and validates a storyboard with every template.
- Update `skills/covi-video/references/storytelling.md` if it introduces a new pattern.

## Changing video components

The browser runtime in `packages/video/src/runtime/` draws every frame. It contains:

- `stage.ts`: scenes with their transitions and camera, the hero accent, the narrator, captions, and progress. It hands the summary card's fox to the outro, which takes it over.
- `transitions.ts` and `camera.ts`: how a scene enters and leaves, and the camera's drift, linger, and hero punch, as pure functions tested in Node (`packages/video/test/motion.test.ts`).
- `components/`: the visuals; `outro.ts` draws Covi's outro, whose settle moment (`outroSettle` in `timeline/cues.ts`) is also where the music's logo lands.
- `layout.ts`: the safe-area regions.
- `styles.ts`: the stylesheet.
- `anim.ts`: easing, springs, and a seeded random generator.

From a source checkout, the runtime is bundled with esbuild on each run, so edits apply immediately.

The renderer splits a video into segments and renders them in parallel browser pages, each starting at an arbitrary frame. Every component must therefore follow these rules:

- **Every visual property is a pure function of the frame time.** `seek(frame)` draws the same pixels whatever was drawn before.
- **No clocks or randomness:**
  - no `Date`, `performance.now()`, or timers;
  - no `Math.random()` (use `seeded(timeline.seed)` from `anim.ts`);
  - no network access (fonts and images are copied into the composition).
- **No CSS transitions or animations.** The stylesheet disables them; compute motion in `update()` instead.
- **Text must fit its box.** Use `fitText` for text with a size range. Components report their layout, and video QC fails when captions cover demonstrated content. It also flags text overflow and warns when the narrator, tail included, covers content, captions, or header text. A component with something highlighted returns it from `target()`, and the narrator's tail points at it.
- **Use the design tokens** from `packages/brand` through the timeline's theme. Don't hard-code colors (see [visual system](visual-system.md)).

`npm run typecheck` checks the runtime against DOM types. To see a change, render an example. Then open `video/contact-sheet.jpg` (the opening, every scene, every transition, and the hero's accent) and `video/poster.png` in the run directory. With ffmpeg and Chromium installed, `npm test` includes a determinism test that renders the same frame from two compositions and compares the bytes.

A moment that makes a sound (a click, the before/after reveal, a finding card, the verdict) is timed by a function in `packages/video/src/timeline/cues.ts`, which the component draws with and the sound engine places effects with. Change the timing there, never as a number in the component; a test checks that the components import it.

## Changing music and sound

Sound is data in `templates/music/`, synthesized by `packages/audio`:

- **The theme** (`scores/covi-theme.yml`) is a score in the format `covi schema score` describes (YAML here, JSON in a run). Its header explains the musical choices; keep it in step with the music. The music serves the narration: no lead melody, the 300 Hz–3 kHz band kept light, movement in the gaps and the lift. Keep an ending for each verdict, consistent with the logo's landing notes (3, 2, and 6 below the tonic).
- **Effect recipes** (`sfx/*.yml`) are layered generators (`tone`, `noise-sweep`, `fm`, `modal`, `pluck`, `notes`). Write pitched layers as note names in C, so they follow the music's key; write clicks and air in Hz. A sting that leads into its moment sets `anchor`, the seconds into the sound that meet its cue (the outro's sign-offs land 0.45 s in), and lets every note's release end inside `duration`. `sound-effects.yml` maps each cue to a recipe and sets the level and the spacing.
- **Patches and kits** (`patches/*.yml`, `kits/*.yml`) are synthesizer presets; the schema is in `packages/audio/src/synth/patches.ts`. A patch's `description` is shown to agents and models choosing instruments, so keep it accurate.

Every file is validated on load, and `packages/audio/test/library.test.ts` loads them all. When rendered output changes (a patch, the DSP, the scheduling, the mix), bump `AUDIO_ENGINE_VERSION` in `packages/audio/src/library.ts` so cached music is rendered again.

Check a change by ear and by eye: render an example, listen to `video/music.wav` (the music alone, as placed) and the video, and read `video/audio.json` and the `audio`, `music-fit`, `music-under-speech`, `music-audible`, and `sound-effects` checks in `video/qc.json`. Render a narrated standard review too: its music plays mostly in the breaths around the narration, and `music-audible` says how much of it is heard. Pictures help:

```bash
dir=$(./bin/covi examples create ui-comment-composer)
./bin/covi video --repo "$dir" --short --duration 30s
cd "$dir"/.covi/runs/$(cat "$dir"/.covi/runs/LATEST)/video
ffmpeg -i covi-review.mp4 -filter_complex "showwavespic=s=1600x400" -frames:v 1 wave.png
ffmpeg -i music.wav -lavfi "showspectrumpic=s=1600x600:fscale=log" -frames:v 1 spectrum.png
```

Changing only the sound keeps the rendered frames: `./bin/covi render --run latest --repo "$dir" --music none` re-mixes in seconds. `npm run test:render` renders videos with the theme, without music, as a standard review, and with a composed score, and times the synthesizer.

## Changing schemas

Files that agents and models write are validated with Zod:

| File | Schema |
|---|---|
| `explanation.json` | `ExplanationSchema`, `packages/core/src/model/explanation.ts` |
| `findings.json` | `FindingsFileSchema`, `packages/core/src/model/finding.ts` |
| `video/storyboard.json` | `StoryboardSchema`, `packages/video/src/storyboard/schema.ts` |
| `demo/plan.json` | `DemoPlanSchema`, `packages/capture/src/plan.ts` |
| `.covi/config.yml` | `ConfigInputSchema`, `packages/core/src/config/schema.ts` |

`covi schema <explanation|findings|storyboard|demo-plan|config>` prints the JSON Schema generated from these, and the skills point agents at that command.

The schemas use strict objects, so a file with an unknown key is rejected. Follow these rules:

- **Additive changes:** add the field as optional, so existing files stay valid.
- **Breaking changes to a versioned file** (`explanation.json`, `findings.json`, `storyboard.json`, all at `schemaVersion` 1 today):
  1. Bump `schemaVersion`.
  2. Update the skills that describe the file.
  3. Update [artifacts](artifacts.md).
- **The demo plan and the configuration** have no version field. Keep changes to them backward compatible.
- **Configuration keys:** also update [configuration](configuration.md) and check what `covi init` writes.
- **`review.json`:** `covi publish` reads it back with `ReviewFileSchema`, because a run downloaded from another CI job is untrusted. Keep that schema in step with what the review writes.

## Changing skills

Skills in `skills/` are product logic. Agents follow them, and Covi also loads their methodology into model prompts. Edit the methodology in the skill, not in code. [Creating a skill](creating-a-skill.md) describes the format, and `npm run agents:check` validates frontmatter, names, cross-references, and reference files.

## Derived files

| Derived | Source | Regenerate | Check |
|---|---|---|---|
| `assets/covi/*.svg` | `packages/brand/src`: `mascot.ts` and `tail.ts` (the fox), `mark.ts`, `logo.ts` and `wordmark.ts`, and `assets.ts` (the file list) | `npm run assets` (also removes files no longer generated) | `node scripts/generate-assets.ts --check`; the brand tests compare the files too |
| `dist/` | `packages/*/src` | `npm run build` (also runs on `npm install`) | Not committed |
| `.claude/skills`, `.agents/skills` | `skills/` (symlinks for Claude Code, and for Codex and other clients) | `npm run agents:sync` (add `-- --copy` where symlinks are unavailable) | `npm run agents:check` |
| `.claude-plugin/plugin.json` version | `package.json` | `npm run agents:sync` | `npm run agents:check` |

Never edit derived files by hand.

## Building the distributable

```bash
npm run build
COVI_USE_DIST=1 ./bin/covi.mjs doctor    # run the bundle instead of the sources
npm pack --dry-run                       # list what would be published
```

`scripts/build.ts` writes:

- `dist/covi.mjs`: the CLI with Covi's own packages bundled in. Playwright, the font packages, and esbuild stay external because they ship binaries or data files.
- `dist/runtime/composition.js`: the prebuilt browser runtime.
- `dist/BUILD`: the version stamp.

The package contains `bin`, `dist`, `skills`, `templates`, `assets`, `examples`, `AGENTS.md`, and `README.md`, but not `packages/`. That means installed copies always run the bundle. `bin/covi.mjs` runs the sources only when Node can strip types, the sources are present, and `COVI_USE_DIST` is not `1`.

Two things to know before a release:

- **The package name.** On the public npm registry, `covi` belongs to an unrelated project, so the package cannot be published under its current `name`. A release must use a name the maintainers control (for example, a scope), and the docs and the integrations' `covi-package` inputs should then name it. Until then, install from a checkout, a tarball from `npm pack`, or git (see [getting started](getting-started.md)).
- **Playwright is pinned to an exact version.** Its browser builds must match the GitLab template's default image, `mcr.microsoft.com/playwright:v<version>-noble`; `tests/integrations.test.ts` fails when they differ. Bump both together.

## Code style

- TypeScript on Node 22.18+, run without a build:
  - import with `.ts` extensions;
  - use `import type` for types;
  - use only erasable syntax: no enums, namespaces, or constructor parameter properties. `tsconfig.json` sets `erasableSyntaxOnly`, and the architecture test also checks for these.
- Strict compiler settings, including `noUncheckedIndexedAccess`.
- Biome formats code: two spaces, single quotes, semicolons, trailing commas, 100 columns, and organized imports. `npm run lint:fix` applies it.
- Keep modules focused, and prefer small pure functions that are easy to test. Comments explain why, not what.
- Report failures with `CoviError` (or `UsageError` and `EnvironmentError`), with the right exit code and a hint. The exit codes are `0` ok, `1` review gate failed, `2` usage, `3` environment, and `4` internal.
- Respect the dependency direction between packages, and keep CI platform details out of `packages/core`.
- Never weaken the execution model:
  - Project commands run with the allowlisted environment from `childEnv`.
  - Commands from repository configuration run locally only once trusted (`TrustStore`), and not at all where the `ExecutionPolicy` forbids it (`pull_request_target`).
  - Output, model prompts, and video storyboards pass through the `Redactor`.
  - In CI, configuration comes from the base revision.
  
  See [security](security.md).

## Commits and pull requests

- Keep each change focused on one concern, with the tests that cover it.
- Run `npm run check`. Also run `npm run test:render` when you touch capture, timing, rendering, or sound.
- Update the docs and skills that describe any behavior you change. Regenerate derived files instead of editing them, and don't commit `dist/` or `.covi/runs/`.
- Write commit messages that say what changed and why.
- Covi can review its own changes. `./bin/covi.mjs review` checks your branch against its base, and `./bin/covi.mjs summarize` drafts a description for the pull request.
