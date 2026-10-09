# Implementer contract (Covi 0.3.0 program)

You implement ONE task of a plan, in the code worktree named in your dispatch. Your task brief is your requirements, with exact values to use verbatim.

## Rules
- Read `AGENTS.md` in the worktree (architecture rules, code style, security model). They bind you: dependency direction; core platform-independent; methodology in skills, not code; deterministic runtime and audio (no `Date`, no `Math.random`, no clocks, no CSS transitions/animations; seeded PRNG only); text for people through `templates/i18n/{en,ko,ja,zh}.yml` with identical placeholders; Zod schemas with bounds; redaction of agent-authored content; derived files regenerated (`npm run assets`, `npm run agents:sync`), never edited.
- TypeScript on Node 22.18+, `.ts` import extensions, `import type` for types, no enums/namespaces/parameter properties. Biome style (2 spaces, single quotes, 100 cols). Comments explain why, concise English.
- TDD where the brief says so: write the failing test, run it (RED), implement, run it (GREEN). Run focused tests while iterating (`npx vitest run <file>`); render tests need `COVI_TEST_RENDER=1`. Run `npm run lint` and `npm run typecheck` before committing. The full `npm test` once before your final commit if your change touches shared code.
- Long commands (full test suite, renders, `npm run check`) run in the background; wait for them to finish (poll the output file in bounded waits) instead of ending your turn. Never report while a command you started is still running.
- Commit with the default git identity (never add Claude as an author or co-author). Every commit message is concise English and ends with a blank line and:
  `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`
- Never change any `version` field. Never push, never open PRs, never touch other worktrees or branches. Never publish to npm.
- Do NOT dispatch subagents (no helpers, no reviewers). Review comes from the controller after you report.
- If something in the brief is wrong or ambiguous, make the smallest sound decision, note it in your report as `Ruling: <what> — <why> — <cost if wrong>`, and continue. Stop with BLOCKED only if every path forward is a guess.

## Report
Write the full report to the report file named in your dispatch: what you implemented, tests and results, TDD evidence (RED and GREEN commands with relevant output), files changed, self-review findings, rulings, concerns.

Then reply with ONLY (under 12 lines): **Status** (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.

## After review findings
You may be resumed with findings. Fix them, re-run the covering tests, append a fix report (changes, covering tests, command, output) to the same report file, commit, and reply with the same short contract.
