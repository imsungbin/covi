# Skills

Covi's review method is written as skills: instructions that a coding agent follows. This page lists the skills and shows how they fit together. It also covers how agents use them with the `covi` CLI, how the same text becomes model prompts, and how to install the skills for an agent client.

To write a new skill, see [Creating a skill](creating-a-skill.md).

## Skills are product logic

Covi splits the work two ways:

- **Judgment goes in skills.** That includes inferring intent, deciding what is worth reviewing, classifying findings, and writing narration. Each skill is a directory under `skills/` with a `SKILL.md` and, sometimes, a `references/` folder.
- **Repeatable computation goes in the CLI.** That includes change resolution, the review rules, timing, rendering, and QC. It produces the same result every time and has tests.

When a skill produces something Covi consumes, the result is a JSON file with a schema (`covi schema <name>`). Covi validates that file before using it.

So changing how Covi reviews usually means editing a skill, not code. Agents read the skill text directly. When Covi calls a model itself, it loads the same text into the prompt (see [Methodology in model prompts](#methodology-in-model-prompts)). There is one source for the methodology.

## The skills

| Skill | Phase | What it does |
|---|---|---|
| `covi` | Entry point | Routes a request to the right skill. It explains how to identify the change (branch, `HEAD^!`, `HEAD~3..HEAD`, a PR or MR), which CLI commands exist, the shared principles, and the run directory layout. |
| `covi-understand` | Understand | The phase every workflow starts with. It runs `covi analyze --json`, then reads `brief.md` and the code around the changes. The goal is an evidence-based model of what the change does, why, what it affects, and how sure you are. |
| `covi-explain` | Explain | Explains the change at a depth that fits it (`brief`, `standard`, or `deep`). The agent writes `explanation.json`, and `covi report` validates it and renders `explanation.md`. |
| `covi-review` | Review | Combines understand, explain, demonstrate (when behavior matters), and risk inspection. Findings are classified by certainty and severity, and each needs evidence. The agent writes `findings.json`, and `covi report` merges it with the rule findings and derives the verdict. Checklists are in `references/checklists.md`. |
| `covi-demo` | Demonstrate | Decides what a reviewer needs to see, writes a demo plan when the defaults are not enough, runs `covi demo --plan` (or `covi review --demo --plan`), and checks the captures. When the repository's configured commands are not trusted on this machine yet, it shows them to the user and asks before running `covi trust --yes`; it never trusts them on its own. |
| `covi-visual-review` | Review (UI) | Reviews UI, CSS, layout, and theming changes visually. It compares before/after screenshots across viewports, checks pixel diffs, interaction states, responsive behavior, and accessibility. Each finding cites a screenshot and a region. |
| `covi-video` | Demonstrate | Makes a narrated review video, but only when seeing the change helps. It plans from the user's words, asks at most two questions, grounds a storyboard in captured evidence, renders it, and checks the result. Uses `references/storytelling.md` and `references/narration.md`. |
| `covi-summarize` | Summarize | Writes a PR/MR description, changelog entry, release note, or standup note, all grounded in Covi's understanding and review (`covi summarize`). |

Print any skill with `covi skills show <name>`.

## How the skills compose

```
covi (routes the request)
 ├── covi-explain          ┐
 ├── covi-review           │
 │    ├── covi-explain     │
 │    ├── covi-demo        │  when behavior matters and Covi can run the project
 │    └── risk inspection  │  references/checklists.md
 ├── covi-demo             │  every one of these starts with covi-understand
 ├── covi-visual-review    │
 │    └── covi-demo        │  viewports, flows, interaction states
 ├── covi-video            │
 │    ├── covi-demo        │  captures make the best scenes
 │    └── covi-review      │  the review note comes from it
 └── covi-summarize        ┘
```

Skills compose through files in the run directory, `.covi/runs/<run-id>/`. Each step writes files that later steps read:

- `covi analyze` writes `context.json` and `brief.md`.
- The agent writes `explanation.json` and `findings.json`.
- `covi demo` writes `demo/captures.json`, and keeps a plan passed with `--plan` as `demo/plan.json`.
- `covi render --run <id>` reads `explanation.json`, `review.json`, and `demo/captures.json` from the run it renders, and keeps the size and length chosen when the storyboard was drafted.

See [Artifacts](artifacts.md) for the full layout.

## How an agent uses a skill

1. The agent reads `skills/covi/SKILL.md` and routes the request. In this repository, `AGENTS.md` tells it to do this first.
2. It runs the deterministic parts with the CLI and passes `--json` whenever it needs to read a result. Every result carries `runId` and `runDir`, and `--run latest` continues the most recent run.
3. It does the reasoning: it reads code beyond the diff, follows callers, runs demonstrations, and writes its conclusions to files.
4. It runs `covi report` (or `covi render` for videos). That command validates the files and renders the reports. If a file does not match its schema, the command exits with code 2 and names the fields to fix.

Files agents write:

| File | Schema | Validated by |
|---|---|---|
| `explanation.json` | `covi schema explanation` | `covi report` |
| `findings.json` (findings, dismissed rule findings, what was checked, what was not verified) | `covi schema findings` | `covi report` |
| Demo plan (any path; kept as `demo/plan.json`) | `covi schema demo-plan` | `covi demo --plan <file>`, `covi review --demo --plan <file>` |
| `video/storyboard.json` | `covi schema storyboard` | `covi render`, `covi video --storyboard <file>` |
| `.covi/config.yml` | `covi schema config` | every command that loads configuration |

Skills ask the user a question only when the answer changes the result and cannot be inferred. They ask in one prompt, with concrete options, using the client's question tool. In CI nobody is asked, and configuration and defaults decide. The video question protocol is in [Video](video.md#which-questions-are-asked).

## Methodology in model prompts

Covi can also run without an agent. With `intelligence.provider` set to `anthropic` or `command` (or `auto` when `ANTHROPIC_API_KEY` is set), Covi calls a model itself. It builds those prompts from the same skill files:

| Purpose | Code | Skills loaded |
|---|---|---|
| Explanation and findings | `buildAnalysisSystemPrompt` in `packages/core/src/intelligence/analyze.ts` | `covi-understand`, `covi-explain`, `covi-review` |
| Rewriting a drafted video narration | `refineNarration` in `packages/video/src/storyboard/model.ts` | `covi-video` |

Each prompt starts with a fixed preamble. It tells the model that it runs inside a pipeline, cannot run commands, open files, or ask questions, and must answer with JSON that matches a schema. The skill methodology follows the preamble. The material from the change (diff, context, drafted narration) passes through the `Redactor` before it leaves the machine.

`methodologyOf` (in `packages/core/src/resources.ts`) takes a skill's body and drops the sections that only make sense to an interactive agent. A section is dropped when its `##` heading starts with one of these names (case-insensitive):

- `Run it`
- `Commands`
- `Tools`
- `Workflow with the CLI`
- `Asking the user`
- `Output files`
- `Related skills`
- `When not to use`

Everything else is kept: the title, the introduction, and sections such as `Method`, `Quality bar`, `Classifying findings`, and `Examples`.

Some material never reaches a model:

- Reference files (`references/*.md`) are for agents only.
- The `covi`, `covi-demo`, `covi-visual-review`, and `covi-summarize` skills are not loaded into any prompt.

The `heuristic` provider does not call a model, so skills are not involved. It uses Covi's built-in rules and a structural explanation instead. `auto` falls back to `heuristic` when no API key or command is configured. See [Configuration](configuration.md) for choosing a provider.

## Installing the skills for an agent client

**In this repository.** `.claude/skills` (Claude Code) and `.agents/skills` (Codex and other clients that use that location) are links to `skills/`, so the skills are available as project skills with no setup. `CLAUDE.md` imports `AGENTS.md`, which Codex reads directly. `npm run agents:sync` maintains both links.

**Claude Code, as a plugin.** The repository root contains `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, so the repository works as a plugin marketplace with one plugin, `covi`. Its skills are discovered from `skills/`. Add the marketplace with `/plugin marketplace add <path or git URL of this repository>`, then run `/plugin install covi@covi`.

**Any repository, any client.** `covi skills install` copies every skill into the location an agent client reads:

| Command | Destination |
|---|---|
| `covi skills install` (same as `--target claude`) | `<repo>/.claude/skills/` |
| `covi skills install --global` | `~/.claude/skills/` |
| `covi skills install --target codex` (same as `--target agents`) | `<repo>/.agents/skills/` |
| `covi skills install --target codex --global` | `~/.agents/skills/` |
| `covi skills install --dest <dir>` | `<dir>` |

Codex discovers skills in `.agents/skills` (in the repository and in the home directory), which is why `codex` and `agents` share a destination.

`<repo>` is the `--repo` directory, which defaults to the current directory.

Each installed skill gets a `.covi-skill` marker that records its name and Covi version. Running the command again refreshes the installed skills and removes Covi skills that no longer exist. Covi never overwrites a same-named directory that has no marker; it exits with code 2 instead. The installed skills call the `covi` CLI, so the CLI must be on `PATH` (see [Getting started](getting-started.md)). The `covi` skill tells agents not to try `npx covi`: that npm name belongs to an unrelated project.

**Clients that read `AGENTS.md`.** Inside this repository, `AGENTS.md` points these clients at `skills/covi/SKILL.md`.

## Browsing skills from the CLI

```bash
covi skills                    # names and descriptions (same as `covi skills list`)
covi skills list --json        # name, description, and path of each skill
covi skills show covi-review   # the instructions, without frontmatter
```

The skills and story templates ship with Covi, in a checkout and in the packaged build. To make Covi load them from somewhere else, set `COVI_HOME` to a directory that contains `skills/` and `templates/`.
