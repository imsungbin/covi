---
name: covi-review
description: Review a code change like a careful senior engineer - understand it, explain it, demonstrate it when useful, then inspect risks and report only evidence-backed findings classified as confirmed, likely, risk, or question. Use for "review this branch/PR/MR/commit" and "explain and review".
---

# Review a change

A review answers: is this change correct, safe, and maintainable, and what does the author need to address? It composes the other phases:

```
review
 ├── understand   (covi-understand)
 ├── explain      (covi-explain)
 ├── demonstrate  (covi-demo, when behavior matters and the software can run)
 └── inspect risks
```

## Run it

1. `covi analyze --json`. Read `brief.md`, including the rule findings and their ids.
2. Understand and explain the change (`covi-understand`, `covi-explain`). Write `explanation.json`.
3. If the change has user-visible or runtime behavior and Covi can run the project, demonstrate it (`covi-demo`). Observed behavior is the strongest evidence you can have.
4. Inspect risks using the method below and `references/checklists.md`.
5. Write `findings.json` (`covi schema findings`): your findings, the rule findings you dismiss (with reasons), what you checked, and what you could not verify. Write them in the run's language and set `"language"` (see the `covi` skill).
6. Run `covi report --run <id>`. It merges your findings with the rule findings, derives the verdict, and renders `review.md` and `summary.md`. Exit code 1 means a configured gate failed.
7. Tell the user the verdict, the findings that matter, and what you could not verify. Link `review.md`.

## Method

**Read in risk order, not file order.** Start where a mistake costs the most: data writes and migrations, money, authentication and permissions, concurrency, public APIs, and then the user flows the change touches. The reading order in `brief.md` is a starting point.

**For each risky spot, try to break it.** What input, timing, or state makes this wrong? Empty, null, huge, duplicate, concurrent, retried, partially failed, unauthorized, old client, old data. Follow the value: where it comes from, where it goes, what assumes it.

**Verify before you claim.**

- A behavior claim needs a path: show the caller, the input, and the line that goes wrong. Better: reproduce it (`covi demo`, a test, a command).
- "Unused" or "unreferenced" claims need a search across the repository.
- "Breaks clients" claims need the contract: the route, the type, the consumer.
- If tests exist and running them is safe, run them (`test.command`, or `covi review --run-tests`).

**Weigh rule findings.** They are precise but shallow. Confirm the ones that hold (restate them with real context if you can), and dismiss false positives in `findings.json` with a one-line reason.

**Check the change against its intent.** If it claims to be a refactor but changes behavior, or the description promises something the code does not do, that is a finding (usually a question).

## Classifying findings

| Certainty | Means | Example |
|---|---|---|
| `confirmed` | Demonstrably wrong: reproduced, or provable from the code alone | A test-only `.only` left in; a response shape observed to change; a secret committed |
| `likely` | Very probably wrong; you can show the path but have not executed it | A removed export that three files still import |
| `risk` | Could go wrong under conditions worth checking; not wrong as written | A destructive migration; a new code path with no tests |
| `question` | You cannot tell; the author probably can | Whether a behavior change in a "refactor" is intended |

Severity is impact if the finding is real: `high` (data loss, security, outage, broken core flow), `medium` (a user-visible bug or a contract break with workarounds), `low` (minor or edge-case impact).

Only `confirmed` and `likely` findings can fail a CI gate.

## Evidence standard

Every finding has a location (path and line when possible), evidence (quoted code, observed output, or the search result), an explanation of why it matters, and, when you have one, a concrete suggestion. If you cannot produce evidence, either investigate until you can or downgrade it to a question. If it is a matter of taste, leave it out.

## Calibration

- Prefer a handful of meaningful findings to a long list. Five is plenty for most changes.
- Do not manufacture findings. "No issues found in what I checked" is a complete review when it is true, as long as you list what you checked and what you did not verify.
- No style nits unless they hide a bug, and no speculative "might be slow" without a reason it is on a hot path.
- Do not repeat what linters, type checkers, or CI already enforce, unless they are not run for this code.

## Presenting the review

Lead with the verdict and the most important finding. Then the remaining findings in order, what you checked, and what you could not verify. Keep praise out unless the user asked; spend the reader's attention on what needs it. Write titles, explanations, and suggestions in the review's language; quote evidence exactly as it appears.

## Output files

`explanation.json` and `findings.json` (you write them) → `covi report` → `review.json`, `review.md`, `summary.md`, `comment.md`.

## Related skills

`covi-understand`, `covi-explain`, `covi-demo`, `covi-visual-review` for UI-heavy changes, `covi-video` when the user also wants a video.
