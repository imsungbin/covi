---
name: covi-explain
description: Explain a code change at the right altitude - what changed, why it appears to exist, how behavior differs, and what a reviewer should know before reading the diff. Use for "explain this change/branch/PR/MR" and as the first half of every Covi review.
---

# Explain a change

A good explanation lets a reviewer read the diff already knowing what they are looking for. It is not a paraphrase of the diff.

## Run it

1. Apply `covi-understand` (`covi analyze --json`, read `brief.md` and the code around the changes).
2. Write `explanation.json` in the run directory (`covi schema explanation`), in the run's language (`data.language` in the `covi analyze --json` result; see the `covi` skill), with `"language"` set to its code. You may start from `explanation.draft.json`.
3. Run `covi report --run <id>` to validate it and render `explanation.md`. Fix any schema errors it reports.
4. Share the explanation with the user, in your own words if they asked a question, or the rendered Markdown.

## Method

**Match the depth to the change.**

| Change | Depth | Shape |
|---|---|---|
| Trivial or small (a style tweak, a one-function fix) | `brief` | Headline, two or three sentences, the key detail if any. No architecture section. |
| Medium (a feature, a multi-file fix) | `standard` | Summary, why, behavior before/after, changes by area, reviewer notes, reading order. |
| Large or cross-cutting | `deep` | Everything above plus architecture: boundaries that moved, contracts that changed, data and dependency changes, and a review plan. |

**Cover, in this order of importance:**

1. **What changed**, in terms of modules and behavior, not lines.
2. **Why it appears to exist**, with the evidence and a confidence level. If the evidence is thin or contradictory, say so.
3. **User-visible behavior**: before vs after, when you know it. Only state behavior you can ground in code or a run.
4. **Architecture implications**, only when boundaries, contracts, data shapes, or dependencies change.
5. **Important implementation details**: the one or two non-obvious decisions a reviewer must understand.
6. **What to know before reading the diff**: generated or mechanical files to skim, the riskiest place to start, related changes outside this diff.

**Write well.**

- The headline is one sentence, at most about twelve words: what the change does, not "Updates files".
- Name things reviewers recognize: components, endpoints, commands, tables. Use code formatting for identifiers.
- Group changes by area, not by file.
- Prefer concrete statements ("Decrementing now stops at zero") to vague ones ("Improves cart logic").
- Hedge exactly as much as the evidence requires; no more, no less.
- Write in the review's language, as a native speaker would; keep identifiers, paths, and code as they appear in the change.

## Examples

Weak (paraphrases the diff):
> Changes `qty - 1` to `Math.max(0, qty - 1)` in `cart.js` and adds a check for zero.

Strong (explains):
> Decrementing a cart line now stops at zero and removes the line instead of going negative. Before, repeated clicks produced negative quantities and a negative total. The fix is in `decrement()`; `removeItem()` now runs when the quantity reaches zero, which changes what the undo button restores.

## Quality bar

- A reviewer who reads only the headline and summary knows what the change does and why.
- Nothing is invented: every behavioral claim is grounded, every guess is labeled.
- The depth fits the change.

## Output files

`explanation.json` (you write it, schema: `covi schema explanation`) → `covi report` renders `explanation.md` and includes it in `summary.md`.
