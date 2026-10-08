You are resuming an in-progress engineering program on the Covi repository (github.com/imsungbin/covi — trunk-based on `main`, squash merges, CI = `npm run check`). A previous Claude Code session on another machine was interrupted. Nothing from that machine is available; everything you need is on origin.

## Where everything is

- **Work branch `work/0.2.0-program`** (an orphan branch, never merged; delete it after PR 8 is merged). It holds:
  - `SPEC.md` — the binding spec: eight PRs. PR 1–3 make Covi's review videos feel produced instead of slide-like; PR 4–7 make executed evidence (recordings, traces, behavior diffs, evidence ids, a repository subject model, an outcome loop) the center of the product; PR 8 releases 0.2.0. Read it fully first.
  - `plans/pr-1.md` (merged), `plans/pr-4.md` (in progress), `plans/pr-2.parts/` (a planner was mid-write; if it is not one coherent plan with `### Task N:` headings, re-plan PR 2 as described below).
  - `ledgers/pr-4-progress.md` — the SDD ledger for PR 4: which tasks are complete, every ruling made, deferred minors. `ledgers/task-N-report.md` — implementer reports. Trust the ledger and `git log` over memory.
  - `pr-1-body.md` — the style of PR body used so far.
- **Feature branches on origin:** `behavior-diff-capture` (PR 4: Tasks 1–6 complete and reviewed; Task 7 — "demonstrate at both revisions and write the behavior diff" — may have partial commits: check `git log --oneline origin/main..origin/behavior-diff-capture`), `timing-motion-grammar` (PR 2, branched from current main; empty unless the planner finished and work started).
- **Merged:** PR #2 "Teach covi-video to tell a story" (program PR 1) is on `main` at 888c958.

## Setup on this machine

```bash
git clone https://github.com/imsungbin/covi.git && cd covi
git worktree add ../covi-work work/0.2.0-program        # spec, plans, ledgers live here, outside the code checkout
git worktree add ../covi-evidence behavior-diff-capture  # PR 4 track
git worktree add ../covi-video timing-motion-grammar     # PR 2 track
(cd ../covi-evidence && npm install) && (cd ../covi-video && npm install)
npx playwright install chromium   # demo/capture tests need it; ffmpeg must be on PATH for render tests
```

The superpowers plugin's `subagent-driven-development` skill keeps its per-plan workspace under `<worktree>/.superpowers/sdd/<plan-name>/` (git-ignored). Recreate the PR 4 ledger there from `../covi-work/ledgers/pr-4-progress.md` (first line must name the plan file path) so the skill resumes at the right task.

## How the work is run (keep doing it exactly this way)

1. Follow `superpowers:subagent-driven-development`: a fresh Opus (`model: "opus"`) implementer subagent per task, dispatched with the brief file the skill's `task-brief` script extracts from the plan plus a report-file path; a task review (Opus for judgment-heavy diffs, Sonnet for small ones) given the diff package from `review-package`; Sonnet scoped re-reviews after fix rounds (max 5 rounds, then adjudicate); one Opus final whole-branch review per PR; one fix wave; then `npm run check` green → push → `gh pr create` (English body, ending with the two attribution lines below) → wait for CI (`gh pr checks --watch`) → `gh pr merge --squash` → pull main → next PR. Record every ruling in the ledger (`Ruling: what — why — cost if wrong`) and commit the ledger to `work/0.2.0-program` regularly. Do not pause to ask between tasks; stop only for destructive, irreversible, or security-sensitive actions the user has not authorized.
2. Two tracks in parallel: video (PR 2 → 3) and evidence (PR 4 → 5 → 6); PR 7 after PR 5; PR 8 last. Each PR branches from the `main` of the moment it starts and is rebased onto `main` before opening.
3. Constraints the user set: no spec/plan/design documents inside the code branches (they live only on `work/0.2.0-program`); code comments, commit messages, PR text, and CHANGELOG in concise English; `CHANGELOG.md` is Keep a Changelog with `## [Unreleased]`, one line per PR; no `version` field changes until PR 8 (bump the nine `version` fields — root, seven `packages/*/package.json`, `.claude-plugin/plugin.json` — to 0.2.0, update `package-lock.json`, turn `[Unreleased]` into `[0.2.0] - <date>`, tag `v0.2.0` on the merge commit, force-move the floating `v1` tag to it, push tags); commits by the default git identity, never Claude as author; every commit message ends with `Claude-Session: https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and `https://claude.ai/code/session_013jxDTCwWohghYXHxHQJBZh`. Follow the repository's `AGENTS.md` for every architecture rule.
4. For each video PR (2, 3), render `examples/ui-comment-composer` (`covi examples create ui-comment-composer`, then `covi video --repo <dir> --standard --provider heuristic --tts system --language en --json`, and the short mode too), open `video/contact-sheet.jpg` with the Read tool yourself before opening the PR, and share the sheet with the user.

## What to do first

1. Set up as above. Read `SPEC.md`, then `ledgers/pr-4-progress.md`, then `git log --oneline origin/main..origin/behavior-diff-capture`.
2. Resume PR 4 at the first task without a `Task N: complete` line (expected: Task 7). If partial Task 7 commits exist, dispatch the implementer with the brief, the report path, and a note of what is already committed. Carry into Task 7's dispatch the rulings recorded in the ledger (scenario-id parameter rename in `paths.ts`; collector origin = `new URL(appUrl).origin`; `stop()` before `finish()`; map `runFlow.recordError` to `recording.status: 'unavailable'`; delete the recording directory after `finalizeRecording`; treat raw fs errors from `finalizeRecording` as `unavailable`, never a crash).
3. For PR 2: if `plans/pr-2.parts/` is not a finished plan, dispatch an Opus planner: invoke `superpowers:writing-plans`; requirements = `SPEC.md` "PR 2 — Timing and motion grammar" (all 11 items, including the carry-overs); explore `packages/video` thoroughly (storyboard schema/draft/model, timeline build/cues, captions, runtime stage/anim/components, brand motion tokens, qc, renderer, sound's hero alignment, templates.ts, `templates/stories/bug-fix.yml`, i18n catalogs, english baseline, render tests, the covi-video skill); TDD; `### Task N:` headings; Global Constraints copied verbatim; a Decisions section; a final acceptance-render task; 8–12 tasks; save to `../covi-work/plans/pr-2.md` and commit it to `work/0.2.0-program`.
4. Run both tracks in parallel until PR 8 is merged and tagged. Report progress to the user in Korean when asked; keep all repository text in English. When the program is done, delete `work/0.2.0-program` and list every ruling you made.
