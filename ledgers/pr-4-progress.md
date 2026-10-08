# SDD ledger — plan: /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/plans/pr-4.md
Spec: scratchpad/SPEC.md (PR 4). Worktree: scratchpad/wt/evidence, branch behavior-diff-capture, base 6fe59ba.

## Pre-flight scan
| pair / task | produces vs consumes | found |
| T1 core paths/types → T4,T5,T6,T7 | DEMO_PATHS, behavior.ts types | consumers listed in plan; T1 first |
| T2 redactUrl → T4 collector | Redactor API | T4 calls redactUrl; ok |
| T3 regions → T5 diff, T7 scenarios | changedRegions, PixelDiff.regions | ok |
| T4 TraceCollector → T6 observe/browser | collector interface | ok |
| T5 diffBehavior → T7 writeBehaviorDiff | pure fn over two traces | ok |
| T6 browser/recording → T7 demonstrate | contextOptions, traced capturePage/runFlow | ok |
| T7 → T8 CLI | captures.json fields, behavior-diff.json | ok |
| T8 → T9 docs | flags/sections | ok |
| each task | tests named before code; verification commands present | consistent |
Ruling: planner decisions 1–10 accepted (flows run at base too; pages included in the diff; timing never flips "changed"; explicit-request provenance for exit 3; ffmpeg injected from CLI to keep capture→video direction). Cost if wrong: flow time roughly doubles; base-failure semantics may need tuning in PR 5.
Task 1: DONE_WITH_CONCERNS — docs for demo.record deferred to Task 9 (in scope there).
Task 1: minor (deferred): paths.ts flowFrame/recording parameter named `flow` but takes a scenario id — rename to `scenario` (carry into Task 7 dispatch).
Task 1: minor (deferred): a third copy of the viewport list in paths/tests (reviewer truncated; final review to triage).
Task 1: complete (commits 6fe59ba..8ddf46e, review clean)
Task 2: DONE_WITH_CONCERNS — Ruling: fix before review (1) quadratic URL_IN_TEXT → linear regex, accepting that a URL nested in a query value is not matched; (2) camelCase credential names masked (name ends with a credential word, case-insensitive); (3) hash-router fragments (`#/path?token=…`) masked. Over-masking of `*_code` accepted (prefer masking). Cost if wrong: a nested-URL token could slip; mitigated by Redactor's generic pass.
Task 2: Ruling: pre-existing quadratic patterns in redact() (URL_CREDENTIALS, jwt) are not fixed here; Task 4's collector must truncate console text to its limit BEFORE redacting so input is bounded (carry into Task 4 dispatch). Follow-up noted for the final review. Cost if wrong: a hostile page could stall capture.
Task 2: Ruling: `monkey=1` test changed to `tokenizer=1` under the suffix rule (masking `monkey` accepted).
Task 2: review clean (Approved). Minors truncated in the reviewer's message; final review to triage. Pre-existing quadratic patterns in redact() noted for the final review.
Task 2: complete (commits 8ddf46e..6dead4e, review clean)
Task 3: review — 2 Important (cap loop can return overlapping regions; no tests for the default write path and the >256 fold), 7 minors.
Task 3: Ruling: fix both Importants plus minors 2 (inline cost, no per-pair allocation) and 6 (use core Rect) in the same round; minors 1,3,4,5,7 deferred.
Task 3: minor (deferred): fold output on noisy pages poor (slivers); grid-offset join; "clamps at the edges" test name overclaims; no tests for cell/max options; bounds loop duplicates regions union.
Task 3: fix round 1/5 (4 addressed, 0 open; commits dc6e61b..9d1dc05)
Task 3: complete (commits 6dead4e..9d1dc05, review clean)
Task 4: DONE_WITH_CONCERNS — Ruling: accept redactBounded = truncate(redact(text.slice(0, max*2)), max) (bounded input, crossing secret masked whole); method capped at 32 chars accepted; error and title fields must also go through redactUrls (fix before review). Cost if wrong: none material.
Task 4: review — 2 Important (origin stripped before redaction leaks on-origin URL secrets; stop() does not freeze step durations), 5 minors. Ruling: fix both plus minors 1, 3, 5 now; minors 2, 4 deferred.
Task 4: minor (deferred): negative tests for events outside steps and blob:/about: schemes; 2× window gap clause in comment.
Task 4: carry to Task 6: pass `new URL(appUrl).origin` (no path, no default port) as the collector origin.
Task 4: fix round 1/5 (5 addressed, 0 open; commits 2c54847..8ddc938)
Task 4: complete (commits 9d1dc05..8ddc938, review clean)
Task 5: review — 1 Important (a request pending at finish() on one side counts as a status change; polling flips `changed`), minors (diffNetwork comment overpromises; rest truncated). Ruling: fix the Important and the comment now.
Task 5: fix round 1/5 (2 addressed, 0 open; commits a106afe..c89ec01)
Task 5: minor (deferred): base-pending vs head-failed pair is skipped symmetrically (policy; no test pins it).
Task 5: complete (commits 8ddc938..c89ec01, review clean)
Task 6: DONE_WITH_CONCERNS — Ruling: before review, validate what the page returns for mutations (page-controlled `window.__coviMutations`): clamp count to a non-negative integer, keep only finite rects, cap at 200; and commit the capturePage-with-trace test. Cost if wrong: none.
Task 6: review — 1 Important (finalizeRecording conversion/fallback/cleanup untested), 10 minors. Ruling: fix Important + minors 1 (count cap), 3 (leaks when observe/newPage throws), 5 (ffmpeg timeout break), 6 (failing-step and newPage-rejects tests) now; carry 7 (delete recordDir after finalize), 8 (fs errors / missing video file) into Task 7; defer 2 (evaluate deadlines), 4 (scroll offset), 9 (unbounded errors arrays) to the final review.
Task 6: minor (deferred): evaluate calls have no deadline (pre-existing in kind); capturePage regions offset by scrollY; FlowRun.errors/PageCapture.errors unbounded; origin built two ways in tests.
Task 6: fix round 1/5 (5 addressed, 0 open; commits e05a3c0..8a2b813)
Task 6: complete (commits c89ec01..8a2b813, review clean)
