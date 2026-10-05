# Creating a skill

This page explains how to add a skill to `skills/`. It covers the directory layout, the rules `npm run agents:check` enforces, the section names that decide what reaches model prompts, using the CLI from a skill, schema-validated outputs, and testing. A worked skeleton is at the end. For what the existing skills do, see [Skills](skills.md).

## Before you start

- **Skill or code?** If a result needs judgment (intent, risk, wording, what to show), it belongs in a skill. If it must come out the same way every time (parsing, rules, timing, rendering, checks), it belongs in the CLI, with tests. A skill can rely on new CLI behavior; add that to the CLI first.
- **New skill or a bigger existing one?** Two skills with overlapping descriptions make routing ambiguous. If the work is a variant of an existing phase, extend that skill.
- **Keep the loop.** Every Covi skill starts from the Understand phase (`covi-understand`) and reuses what it produced, rather than analyzing the change again.

## Layout

```
skills/
  covi-<name>/
    SKILL.md          frontmatter and instructions (required)
    references/       optional: longer material the skill points to
      <topic>.md
```

The directory name is the skill name. Keep `SKILL.md` focused; the shipped skills are 30–80 lines each. Put checklists, pattern catalogs, and long examples in `references/`, and point at them from the body by relative path in backticks, for example `references/checklists.md`. Agents open reference files when they need them. Reference files are never included in model prompts.

## Frontmatter

```markdown
---
name: covi-<name>
description: <What the skill does and when to use it, on one line.>
---

# <Title>
```

`scripts/sync-agents.ts` checks every skill. It runs as `npm run agents:check`, as part of `npm run check`, and inside `npm test` (`tests/architecture.test.ts`).

| Rule | Error when broken |
|---|---|
| Every directory in `skills/` has a `SKILL.md` | `missing SKILL.md` |
| The file starts with a `---` frontmatter block | `missing frontmatter` |
| `name` equals the directory name | `frontmatter name "…" must match the directory` |
| `name` has only lowercase letters, digits, and hyphens, at most 64 characters | `name must be lowercase letters, digits, and hyphens` |
| `description` has 1–1536 characters | `description must be 1–1536 characters` |
| The body has a top-level `# ` heading | `body needs a top-level heading` |
| Every `references/<file>.md` the body mentions in backticks exists | `missing references/<file>.md` |
| Every `covi-*` name the body mentions in backticks is an existing skill | ``references unknown skill `covi-…` `` |

Formatting rules:

- Put each field on a single line, unquoted. The checker reads `name:` and `description:` line by line, so YAML block scalars (`description: >`) and quoted values do not work.
- Start the file with the `---` line and use LF line endings.
- Name the skill `covi-<name>`, so the cross-reference check covers mentions of it.

## Body and section names

Start the body with `# <Title>` and a short paragraph that states the goal. Then use `##` sections. A few section names have a special meaning.

**Agent-only sections.** These are left out when Covi loads a skill into a model prompt:

| Section | Use it for |
|---|---|
| `## Run it` | The commands to run, in order |
| `## Commands`, `## Tools`, `## Workflow with the CLI` | How to use the CLI |
| `## Asking the user` | When to ask a question and how |
| `## Output files` | What the skill writes, and which command validates or renders it |
| `## Related skills` | Other skills to read |
| `## When not to use` | Where this skill stops and another starts |

**Everything else is methodology.** Sections such as `## Method`, `## Quality bar`, `## Examples`, and `## Evidence standard` are methodology. They reach model prompts whenever Covi loads the skill into one, so write them for a reader who cannot run commands, open files, or ask questions.

How the filter works:

- Matching is by heading prefix and ignores case, so `## Run it locally` is agent-only too.
- Only `##` headings start a new section. A `###` heading inside an agent-only section stays agent-only.

To see exactly what a model would receive, run:

```bash
node -e 'import("./packages/core/src/resources.ts").then(async (m) => console.log(m.methodologyOf(await m.loadSkill("covi-review"))))'
```

Write the way the existing skills do:

- Address the agent directly.
- Say what "done" looks like (a quality bar).
- Show a weak and a strong example when tone matters.
- Prefer tables for decisions ("the change… → show…").
- Mention other skills and reference files in backticks so the checker can verify them.

## Writing a description that triggers well

An agent client decides whether to load a skill from its description. `covi skills` also lists it.

- Lead with what the skill does, concretely: "Review dependency changes for…", not "Helps with dependencies".
- Follow with when to use it, in the words people actually say: "Use for 'is this upgrade safe?', 'review the lockfile changes'".
- Name the inputs it handles (branch, commit range, pull request, merge request) and what it produces.
- If a sibling skill is close, state the boundary.
- Keep it to one line. The shipped descriptions run 150–350 characters; the hard limit is 1536.

Also add a row to the routing table in `skills/covi/SKILL.md`, so requests that start at the entry skill reach the new one.

## Using the CLI from a skill

- Begin with the Understand phase: `covi analyze --json`, then read `brief.md` in the run directory. Use `runId` and `runDir` from the JSON result, and pass `--run <id>` (or `--run latest`) to later commands.
- Pass `--json` whenever the agent reads a result. Progress goes to stderr; the result object goes to stdout.
- Tell the agent what each exit code means for the skill:

  | Code | Meaning | What the agent does |
  |---|---|---|
  | 0 | ok | continue |
  | 1 | a review gate failed | report the gating findings |
  | 2 | usage error or invalid input, including schema errors in files the agent wrote | fix the file or the flags, then rerun |
  | 3 | environment problem (not a repository, no browser or ffmpeg) | run `covi doctor` and report what is missing |
  | 4 | internal error | report it |

- Use `covi schema <explanation|findings|storyboard|demo-plan|config>` for file formats. Do not restate schemas in the skill.
- Keep paths relative to the run directory (`demo/screenshots/…`, `video/storyboard.json`).
- Do not tell the agent to run project code outside configured commands. Covi runs the software under review only through configuration or with the user's agreement, in a scrubbed environment. Commands in a repository's `.covi/config.yml` run locally only after the user trusts them (`covi trust`); a skill that depends on them must tell the agent to show the user the commands and ask, never to trust them on the user's behalf. See [Security](security.md).

## Adding a schema-validated output

If the skill produces a structured file that Covi consumes:

1. Define a Zod schema next to the code that owns the file:
   - `packages/core/src/model/` for domain files;
   - `packages/video/src/storyboard/schema.ts` and `packages/capture/src/plan.ts` show the pattern for stage-specific ones.

   Use strict objects so typos fail, and describe fields with `.describe()`. The descriptions appear in the JSON Schema.
2. Register the schema in the `covi schema` command (the `schemas` map in `packages/cli/src/main.ts`) so agents can print it.
3. Validate the file where it is read, with `parseOrThrow(Schema, value, '<file name>', '<hint>')` from `@covi/core`. An invalid file becomes a usage error (exit 2) that lists each problem.
4. Version the format with a `schemaVersion`. Additive changes are fine. Breaking changes bump the version and update every skill that describes the file.
5. Test both a valid and an invalid file.

If the skill's methodology should also guide a model provider, load it in the prompt builder with `loadSkill('<name>')` and `methodologyOf(...)`, the way `buildAnalysisSystemPrompt` in `packages/core/src/intelligence/analyze.ts` does. Then extend the prompt test in `packages/core/test/providers.test.ts`.

## Testing a skill

```bash
npm run agents:check                  # structure and cross-references
./bin/covi.mjs skills show covi-<name> # it loads; the body is what you expect
npm test                              # includes the packaging check and `covi skills install`
```

Then use the skill for real, against an example change:

```bash
./bin/covi.mjs examples list
./bin/covi.mjs examples create api-users-pagination --into /tmp/covi-api
# ask your agent to follow the skill with --repo /tmp/covi-api
```

Each example's `examples/<name>/change.yml` records what Covi should conclude: intent, demonstration value, video decision and template, expected rule and demonstration findings, and verdict. Compare the agent's output against it. If none of the examples exercises the new skill, add one: a `base/` tree, a `head/` overlay, and `change.yml` (see [Contributing](contributing.md)).

## Making it available

- **In this repository.** No extra step. `.claude/skills` and `.agents/skills` link to `skills/`, the Claude plugin discovers `skills/`, and `covi skills install` copies every skill directory. If your filesystem has no symlinks and you replaced the links with copies (`node scripts/sync-agents.ts --copy`), run that command again.
- **For users.** The skill ships with Covi (`skills/` is part of the package). Users get it the next time they update Covi and run `covi skills install` again (`--target claude`, or `--target codex` for `.agents/skills`).

## Worked skeleton

This is an illustration, not a shipped skill: a dependency review that builds on the Understand phase and reports through the normal findings file.

````markdown
---
name: covi-dependency-review
description: Review dependency changes in a code change (added, removed, upgraded, or downgraded packages and lockfile updates) for breaking upgrades, unused additions, and risky sources. Use for "is this upgrade safe?", "review the dependency bump", or when a change mostly touches manifests and lockfiles.
---

# Review dependency changes

A dependency change is reviewed by what it does to the code that uses it, not by the size of the lockfile diff.

## Run it

1. `covi analyze --json`. Read `brief.md` and `context.json` → `dependencies` (name, manifest, ecosystem, from → to, major, dev).
2. For each major upgrade, find the call sites in the repository and the package's changelog entries for the versions crossed.
3. Write `findings.json` (`covi schema findings`, category `dependency`), then run `covi report --run <id>`.

## Method

- Start with major upgrades of runtime (non-dev) dependencies.
- An added dependency needs a caller; an unused addition is a finding.
- A downgrade needs a reason; without one, it is a question for the author.
- Lockfile-only churn with unchanged manifests is usually not worth a finding.

## Quality bar

- Every finding names the package, the version change, and the call site or changelog entry that makes it matter.

## Output files

`findings.json` → `covi report` → `review.md` and `summary.md`.

## Related skills

`covi-understand`, `covi-review`.
````

After you add it:

- Add a routing row to `skills/covi/SKILL.md`, for example "review a dependency bump → `covi-dependency-review`".
- Run `npm run agents:check`.
- Try it against a change that upgrades a package.
