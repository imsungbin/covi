# Task 5 report: Capture — the behavior diff (pure)

**Status:** DONE
**Commit:** `a106afe` Compare base and head traces into a deterministic behavior diff (on `behavior-diff-capture`, parent `8ddc938`)

## Implemented

`packages/capture/src/behavior.ts`: the brief's code, verbatim except for one lint fix (below).

- `PIXEL_THRESHOLD = 0.0005`, `TIMING_THRESHOLD = { ms: 500, ratio: 0.5 } as const`
- `StepPixels`, `ScenarioObservation`
- `diffBehavior` (scenarios plus summary counts), `diffScenario` (traces, recordings, and failure maps; `incomplete` with `missing` when a revision has no trace; `changed` from steps, network, console errors, or a difference in whether the scenario errored; never from timing), `diffSteps` (head order then base-only ids; reported when the state differs or `changedRatio >= PIXEL_THRESHOLD`; regions get ids `r1…`), `diffNetwork` (key `METHOD path` with query and fragment stripped; added and removed use the first request of a key; repeats pair by index, so extra repeats are ignored; a pair is changed when the status differs or only one side failed; keys sorted), `diffConsole` (errors only, excluding `Failed to load resource:`; a set keyed by `level + text` with digit runs of 4 or more normalized), `diffTiming` (steps that are ok at both revisions, reported at `|Δ| >= max(500, 0.5 × base)`).

Not exported from `packages/capture/src/index.ts`. That matches `regions.ts` and `trace.ts`, which aren't exported yet either, and the brief lists no index change.

### Deviation from the brief

`diffTiming`: `if (!b || b.status !== 'ok' || ...)` became `if (b?.status !== 'ok' || ...)`. Biome's `useOptionalChain` flagged the original as a warning. The two are logically the same, and TypeScript narrows `b` through the optional chain (typecheck passes).

Biome also re-wrapped some long lines in the brief's test code. Nothing else differs from the brief (checked with `diff` against the brief's code blocks).

## Tests

`packages/capture/test/behavior.test.ts`: the brief's 13 tests verbatim, plus 4 that pin decisions the brief's tests left open:

| Added test | Pins |
|---|---|
| steps: counts a step at exactly the threshold as different | `>=` at `PIXEL_THRESHOLD` |
| timing: stays quiet when a long step moves by less than half, and reports a speedup | the `0.5 × base` branch of the threshold (2000 to 2700 ms, Δ700 ≥ 500 but < 1000, stays quiet); `Math.abs` (a speedup of -900 is reported) |
| console: keeps short numbers such as HTTP statuses apart | the `{4,}` choice (`HTTP 404` and `HTTP 500` stay distinct) |
| scenarios: is unchanged, with nothing to report, when base and head behave the same | identical traces (with a request and an error) give `unchanged` and the exact empty diff, with no `recordings`, `failure`, or `missing` keys |

Negative cases the lead asked for:

| Case | Test |
|---|---|
| identical traces → unchanged | the new test above |
| polling and cache-busting → no noise | "stays quiet about repeated calls and changed query strings" |
| timing alone → not changed | "is unchanged when nothing but timing differs" |
| base-failed flow → `base: 'failed'` at the step where it stopped | "lists steps that failed or were never reached…" and "is changed, not a failure of the review, when the flow cannot run at base" |

## TDD evidence

- **RED:** `npx vitest run packages/capture/test/behavior.test.ts` failed with `Error: Cannot find module '../src/behavior.ts'`. No tests ran.
- **GREEN:** after adding `behavior.ts`, 13 of 13 passed; after the 4 added tests, 17 of 17 passed.
- **Mutation check for the added tests:** they passed on first run because the code already existed, so I broke the code one change at a time to confirm each one catches something. The source was restored byte-for-byte after each run (`cmp` OK).

| Mutation | Tests that failed |
|---|---|
| `>= PIXEL_THRESHOLD` → `>` | the threshold-boundary test only |
| timing threshold → `500` ms only, dropping the ratio | the long-step and speedup test only |
| `Math.abs(deltaMs)` → `deltaMs` | the long-step and speedup test only |
| `/\d{4,}/` → `/\d+/` | the HTTP-status test only |
| console `added` ignores base | the timestamps test and the identical-traces test |

  Three of these mutations are caught only by the added tests, so those branches weren't covered before.

## Verification (before commit)

- `npm run typecheck`: exit 0
- `npm run lint` (`biome check .`): exit 0, no warnings
- `npm test`: 61 files passed, 1 skipped; 844 tests passed, 6 skipped; exit 0

## Files

- `packages/capture/src/behavior.ts` (new, 250 lines)
- `packages/capture/test/behavior.test.ts` (new, 315 lines)

## Self-review

- **Complete:** every interface in the brief is exported with the specified signature; `ScenarioDiff` and `BehaviorDiff` match `packages/core/src/model/behavior.ts`.
- **Layering:** imports only `@covi/core` as types (`import type`); no I/O, clock, or randomness.
- **Deterministic:** network keys are sorted; steps follow head order then base-only ids; console entries follow arrival order. Calling `diffBehavior` twice gives equal results (tested).
- **Task 4 refinements:** request URLs are app-relative, so `METHOD path` keys match across base and head even though their ports differ. Console text is app-relative after redaction, and `location` is a separate field, so the `level + text` key doesn't carry line or column numbers. Step ids `open`, `load`, `s1…sN`, `end` pair up by id, and pixels are keyed by the same ids.

## Concerns (design notes, nothing blocking)

1. **Two different failures count as the same.** A request that failed at both revisions with different failure text, or a scenario that errored at both with different messages, isn't `changed`: `diffNetwork` and `diffScenario` only compare whether a failure happened. This follows the brief and the planner ("status/failure differs"). Both failure texts are still kept in the `failure` map and the request refs.
2. **Repeats pair by index.** Requests with the same key pair in start order. If a key's repeats return different statuses and their order flips between base and head (base `[200, 404]`, head `[404, 200]`), the diff reports two changed pairs even though the set of statuses is the same. This is rare and follows the brief.
3. **Not wired up yet.** `behavior.ts` has no consumer and no export from the capture index yet; I assume a later task wires it, as with `regions.ts` and `trace.ts`.

---

## Fix round 1

**Commit:** `c89ec01` Skip requests still pending when a trace ends in the network diff (on top of `a106afe`)

### 1. (Important) A request still pending when the trace ended was paired as a status change

- **Fix:** `diffNetwork` skips a pair when either side is unsettled, meaning it has neither `status` nor `failure`. The check is a small `settled` helper next to `byKey`. Adds and removes are unchanged, so a key seen only on one side is still reported even when its request is pending.
- **Negative test:** "stays quiet about a request still pending when the trace ended" runs the reviewer's exact repro: `diffNetwork([200, 200, <pending>], [200, 200, 200, 200, <pending>])` gives `{ added: [], removed: [], changed: [] }`.
- **Positive tests:** in the same test, `[200, <pending>]` against `[404, 200, <pending>]` still reports exactly one change on `GET /poll` (n1: 200 to 404), so the skip doesn't hide a real change next to a pending request. The original 200 to 404 test on `GET /items.json` is unchanged and passes.
- **RED:** before the fix, the new test failed with `AssertionError: expected { added: [], removed: [], …(1) } to deeply equal { added: [], removed: [], changed: [] }` (17 passed, 1 failed).
- **GREEN:** after the fix, 18 of 18 passed.

### 2. (Minor) The `diffNetwork` comment overstated what is compared

The comment now says that a pair is changed when its status differs or only one of the two failed, and that the failure text itself isn't compared. It gives the reason: codes such as `net::ERR_ABORTED` depend on when a request was cancelled, and both texts stay in the traces. It also says why pending pairs are ignored: like extra repeats, they depend on when the run ended, not on the change.

### Verification

- `npx vitest run packages/capture/test/behavior.test.ts`: 18 of 18 passed
- `npm run typecheck`: exit 0
- `npm run lint`: exit 0, no warnings

In the original report, design note 1 ("two different failures count as the same") still holds; the comment now states it and gives the reason.
