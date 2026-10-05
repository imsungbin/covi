---
name: covi-understand
description: The Understand phase every Covi workflow starts with - build an evidence-based model of what a code change does, why, and what it affects before explaining, demonstrating, or reviewing it.
---

# Understand a change

Understanding comes before every explanation, demo, video, or review. The goal is a model of the change that you could defend line by line: what changed, why it appears to exist, who and what it affects, and how sure you are.

## Run it

```bash
covi analyze --json            # or: covi analyze <range> --json
```

Then read `brief.md` in the run directory from top to bottom. It contains Covi's deterministic analysis (intent signals, affected areas and surfaces, symbols, dependencies, environment variables, data changes, demonstration value), rule findings with ids, a suggested reading order, and the prioritized diff. `explanation.draft.json` is a structural first draft you may build on.

## Method

1. **Map the change.** Which areas (modules, packages, services) changed, and which surfaces: UI, API, CLI, data, state, configuration, dependencies, CI, security. Note the size class; it sets how deep everything else goes.
2. **Read beyond the diff.** For each file in the reading order, open the whole file around the changed regions. A diff hides the conditions around a line, the callers of a function, and the invariants a class maintains.
3. **Follow the edges.** For changed functions, components, routes, or exported types, search for their callers and consumers. For configuration, find where it is read and what the default is. For migrations, think about existing rows and about code still running the old version during deploy.
4. **Look at the tests.** Which tests changed or were added, what they assert, and which changed behavior has no test.
5. **Infer intent from evidence.** Combine the title, description, commit messages, and branch name with what the code actually does. When they agree, say so with high confidence. When they disagree (a "refactor" that changes behavior), or nothing describes the change, say that plainly. Never invent a purpose.
6. **Trace runtime effects.** Which user flows, requests, jobs, or commands reach the changed code? What happens on failure, on empty input, under concurrency, on retry?
7. **Decide what is worth seeing.** Is any of it user-visible? What would a reviewer need to see to trust it: a screen, an interaction, a response, terminal output? Or is it internal, where words and code serve better?

## What to consider

Diff and changed files · commit history · surrounding implementation · tests · configuration changes · API contracts · UI and styles · state management · database schema and data · dependencies and lockfiles · runtime effects (performance, concurrency, error paths) · affected user flows · documentation the change should have touched.

## Quality bar

- You can state the change's purpose in one sentence, with a confidence level and the evidence behind it.
- You know which files matter most and in what order to read them.
- Every claim you will later make is grounded in something you read or ran.
- Open questions are written down, not glossed over.

## Output files

Understanding feeds `explanation.json` (intent, behavior, areas, reading order, ambiguities). It does not need its own file; continue with the skill the request routed to.
