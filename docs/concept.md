# Concept

This page explains what Covi is for, the loop it follows, how it classifies what it finds, and the judgment calls it makes on your behalf.

## What Covi is

Covi helps a person understand a code change well enough to review it. Given a change (a branch, a commit range, staged or uncommitted work, a pull request, or a merge request), it:

- builds a structured understanding of what changed, why it appears to exist, and what it touches;
- explains it at the right altitude, in modules and behavior rather than diff lines;
- runs the software at both revisions and captures what changed, when seeing it helps;
- reviews it, reporting only findings it can support with evidence, and a verdict;
- renders a short narrated review video when, and only when, watching the change is useful.

Covi is split in two. **Methodology** lives in skills (`skills/`): how to understand, explain, review, demonstrate, and tell the story of a change. **Deterministic tools** live in the `covi` CLI: change resolution, analysis, rules, schemas for anything an agent writes, report renderers, the capture engine, and the video pipeline. The **intelligence** that applies the methodology comes from a coding agent, a model provider, or Covi's built-in heuristics (see [Intelligence](#intelligence)).

## What Covi is not

- **Not an approver.** Covi produces evidence and a verdict for a human reviewer. It never approves or merges anything.
- **Not a linter.** It does not repeat what formatters, type checkers, or CI already enforce, and it does not comment on style.
- **Not a finding generator.** A sound change gets zero findings, and that is a complete review.
- **Not a video generator.** Most changes do not need a video; Covi says so and explains why.
- **Not tied to a hosting platform.** The core works on any git repository. GitHub and GitLab are adapters at the edge.

## The loop

**Understand → Explain → Demonstrate (when it helps) → Review.** Every workflow starts with understanding, and each step reuses what the earlier steps wrote.

| Step | What happens | Main output |
|---|---|---|
| Understand | Resolve the change, classify files, extract symbols, routes, dependencies, environment variables, and data migrations, infer intent with a confidence, group files into areas, assess whether a demonstration would help | `context.json` |
| Explain | Headline, summary, intent with evidence, behavior before and after, changes by area, reviewer notes, reading order, open ambiguities | `explanation.json`, `explanation.md` |
| Demonstrate | Check out base and head into temporary directories, run the software, capture pages, flows, commands, and API responses, diff them | `demo/` |
| Review | Merge deterministic rule findings, authored findings, and observations from the demonstration; derive a verdict; list what was checked and what was not verified | `review.json`, `review.md` |

A video, a PR/MR description, and a CI comment are renderings of these results, not separate analyses. See [Artifacts](artifacts.md) for every file.

## Who it serves

- **Reviewers** get the intent, a reading order, the behavior difference (often as before/after captures), and a short list of evidence-backed findings, before reading the diff.
- **Authors** can review their own branch before asking for review, generate a description with `covi summarize`, and attach a demonstration or video.
- **Coding agents** get the methodology as skills, deterministic tools with `--json` output, and schemas for the files they write, so their reviews follow the same standard as Covi's own.

## Entry points

All entry points use the same core and write the same run artifacts.

| Entry point | How it runs | Interactive |
|---|---|---|
| Local agent | An agent (for example Claude Code or Codex) reads the skills, runs `covi analyze`, writes `explanation.json` and `findings.json`, then runs `covi report` | The agent may ask a few intention questions |
| CLI | `covi review`, `covi explain`, `covi demo`, `covi video`, `covi summarize` | Only `covi video` asks about intent, and only at a terminal (`covi trust` asks for confirmation) |
| GitHub Action | `integrations/github-action/action.yml` runs `covi ci --platform github` | Never |
| GitLab CI | `integrations/gitlab-ci/covi.yml` runs `covi ci --platform gitlab` | Never |

See [Getting started](getting-started.md), [CLI](cli.md), [Skills](skills.md), [GitHub Action](github-action.md), and [GitLab CI](gitlab-ci.md).

## Findings

A finding has a title, a **certainty**, a **severity**, a category, an optional location, evidence, an explanation of why it matters, and an optional suggestion. Certainty (how sure Covi is) is kept separate from severity (how much it matters if real).

| Certainty | Label | Meaning |
|---|---|---|
| `confirmed` | Confirmed issue | Demonstrably wrong: reproduced, observed while running the software, or provable from the code alone |
| `likely` | Likely issue | Very probably wrong; the path can be shown but was not executed |
| `risk` | Risk worth checking | Could go wrong under conditions worth checking; not wrong as written |
| `question` | Question | Cannot be decided from the code; the author probably knows |

Severity is `high` (data loss, security, outage, broken core flow), `medium` (a user-visible bug or a contract break with workarounds), or `low` (minor or edge-case impact).

**Only `confirmed` and `likely` findings can fail a gate.** With `review.failOn` (or `--fail-on`) set to a severity, any confirmed or likely finding at or above it fails the gate, and `covi review`, `covi report`, and `covi ci` exit with code 1. Risks and questions inform the reviewer; they never block. The default is `none`, so nothing blocks until you opt in.

The verdict follows from the findings shown:

| Verdict | When |
|---|---|
| Needs changes | Any confirmed or likely finding of high severity |
| Needs attention | Any other confirmed or likely finding, or any risk or question of medium or high severity |
| Looks good | Everything else, including no findings |

Findings come from four sources, recorded on each finding: `rule` (Covi's deterministic checks), `model` (a model provider), `agent` (a coding agent's `findings.json`), and `demo` (something observed while running the software, such as an API response that changed shape).

## Product judgment

- **No manufactured findings.** Rules prefer silence over noise and report only what the diff or a repository lookup supports. An author of `findings.json` can dismiss a rule finding by id, with a reason. The review shows at most `review.maxFindings` findings; lower-priority ones are listed under `omitted` in `review.json`, not shown.
- **Honest uncertainty.** Intent comes with a confidence (`high`, `medium`, `low`), the evidence behind it, and its basis (the PR/MR title, a commit subject, or only the files). When signals conflict or are missing, Covi states the ambiguity instead of inventing an intent. The author's description is treated as a claim to verify, not as evidence.
- **What was not verified.** A review lists what it did not verify, such as tests that were not run, user-visible behavior reviewed from code only, or logic checked by rules alone.
- **Show only when it helps.** The Understand phase rates how much a demonstration would help (`high`, `medium`, `low`, `none`) and recommends a video, screenshots, or text only. A refactor gets no video and a stated reason. A small visual tweak gets before/after screenshots instead. A new user flow or a changed API response is worth demonstrating and worth a video, which CI renders by default (`video.when: auto`) and `covi video` renders on request. In CI, Covi demonstrates whenever the recommendation is screenshots or video and it can run the project, even when no video is rendered, because captures are evidence and can confirm regressions.
- **Careful with the repository's code.** A repository under review is untrusted input. Covi runs project commands only from configuration you trust on your machine (`covi trust`) or, in CI, from configuration on the base revision; under `pull_request_target` it runs none. Secrets are redacted from the text it writes, including video narration and captions. See [Security](security.md).
- **Ask little, infer much.** In an interactive session an agent asks at most a couple of questions about intent (for example, what kind of video), and only when the request leaves them open. A request such as "a 30-second vertical video" is specific enough to answer itself. CI never asks; every choice has a configuration key and a default.

## Intelligence

The methodology is the same in every mode; only who applies it changes.

| Mode | Who reasons | When it is used |
|---|---|---|
| Agent | The coding agent running Covi. It writes `explanation.json` and `findings.json`; `covi report` validates them against their schemas and renders the reports. | Whenever Covi is driven from an agent session through the skills |
| `anthropic` | Claude through the Anthropic API, prompted with the methodology from the skills and answering in a schema-validated JSON shape | `intelligence.provider: anthropic`, or `auto` when `ANTHROPIC_API_KEY` is set |
| `command` | Any agent CLI you configure in `intelligence.command`. Covi writes the prompt to its stdin and reads JSON from its stdout. | `intelligence.provider: command`, or `auto` when a command is configured and no Anthropic key is set. Locally, a command from the repository's configuration needs `covi trust` first. |
| `heuristic` | Covi's built-in rules and a structural explanation, with no model | `intelligence.provider: heuristic`, or `auto` when nothing else is available |

If a model provider fails, Covi records a warning and falls back to its heuristics instead of failing the run. See [Architecture](architecture.md#intelligence-providers) for how the skills become model prompts and [Configuration](configuration.md) for the keys.
