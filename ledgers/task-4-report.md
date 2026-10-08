# Task 4 report: Capture — `TraceCollector`

**Status:** DONE_WITH_CONCERNS (one deliberate refinement of the controller ruling; see Concerns 1)
**Commit:** aad1599 `Collect bounded, redacted traces of pages and flows` (on 9d1dc05; default identity; `Claude-Session:` trailer only)

## Implemented

- `packages/capture/src/trace.ts`: the brief's `TraceCollector`, `TRACE_LIMITS`, `TraceMeta`, `TraceOptions`, verbatim except for three changes:
  1. **Bounded redaction (the ruling).** New module helper `redactBounded(text, max, redact)` = `truncate(redact(text.slice(0, max * 2)), max)`. Console text (after the origin is stripped) and every URL (request URLs and console locations, via `url()`) go through it. So the redactor never sees more than 1000 characters, and the stored value is always at most the limit. The comment explains why the order matters.
  2. **Request method bounded:** `truncate(init.method, 32).toUpperCase()`. The page picks the method, which can be any length, and `run.writeJson` runs `redactDeep` over the whole trace. An unbounded method was the one page-controlled string left that could stall the redactor at write time.
  3. Formatting by Biome only.
- `packages/capture/test/trace.test.ts`: the brief's three tests, plus two more:
  - `bounds hostile page text before redacting it, so a huge message or URL cannot stall capture`: sends a 300k-character `'a.'.repeat(150_000)` console message, URL, and method. Asserts the whole run takes under 500 ms, the console text is exactly `TRACE_LIMITS.text` long, the URL exactly `TRACE_LIMITS.url`, and the method at most 32.
  - `masks a secret that crosses the text limit instead of keeping an unmasked prefix of it`: positive case is a `ghp_` token starting at character 481, so it crosses the 500 limit; it is stored as `ghp_[REDACTED]`. Negative case: short clean text is stored unchanged.

## TDD evidence

1. RED (no module): `npx vitest run packages/capture/test/trace.test.ts` failed to import `../src/trace.ts`; no tests ran.
2. RED (the ruling) with the brief's code verbatim, which redacts first. The brief's three tests passed. `bounds hostile page text…` failed with `AssertionError: expected 47314.385334 to be less than 500`: 47 s spent in the redactor (`URL_CREDENTIALS` backtracks quadratically on `a.a.a…`).
3. RED (the literal ruling: truncate to the limit, then redact) applied to console text. `masks a secret that crosses the text limit…` failed: the stored tail was `"xxxxx ghp_A1b2C3d4E5A1b2…"`, so 14 characters of the token survived unmasked because the cut token no longer matches `gh[pousr]_[A-Za-z0-9]{30,}`.
4. GREEN with `redactBounded`: 5/5 pass, and the hostile test takes 5 ms.

## Verification

- `npx vitest run tests/architecture.test.ts packages/capture/test/trace.test.ts packages/capture/test/regions.test.ts packages/core/test/redact.test.ts`: 4 files, 37 tests passed. The architecture test covers capture importing only core.
- `npm run typecheck`: clean.
- `npm run lint`: 274 files, no fixes.
- `npx biome check packages/capture`: clean.

## Files

- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/trace.ts (new)
- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/test/trace.test.ts (new)

## Self-review

- Interface matches the brief exactly (constructor, `start`/`stop`/`beginStep`/`frame`/`endStep`/`request`/`response`/`console`/`finish`, and `TRACE_LIMITS` values 300/200/500/500).
- Imports: `@covi/core` (types plus `truncate`) and `./regions.ts`; `import type` is inline per the brief; `.ts` extension; no enums.
- Determinism: the clock is injected; `performance.now()` is only the default (an observation, per constraints.md). The test's `performance.now()` timing follows `packages/core/test/redact.test.ts`.
- `index.ts` is not touched: the brief lists only the two files, and Task 6 imports `./trace.ts` directly.

## Concerns

1. **Ruling refinement: the window is twice the limit, not the limit itself.** The ruling says to truncate "to its length limit" before redacting. Step 3 above shows that order stores an unmasked prefix of any secret that crosses the cut. Redacting a 2× window keeps the redactor's input bounded (1000 characters, about 1 ms worst case) and still stores exactly the limit. It masks a crossing secret whole. If the controller wants the literal order anyway, change `max * 2` to `max` in `redactBounded` and drop the crossing-secret test. A secret cut at the 2× boundary could still leak only if earlier masks shrink the text by about 500 characters. That takes something like a very long private-key block earlier in the same message, which I judged negligible.
2. **Out-of-brief addition: the method is capped at 32 characters**, with a test. Without the cap, the page-controlled method would make the write-time `redactDeep` super-linear. Revert it if the controller wants the brief verbatim.
3. Left as the brief has them: step and trace `error` and `title` are clipped (500 and 200) but not URL-masked in the collector. They are bounded, so the write-time `redactDeep` on them is cheap, and it masks token formats. Playwright errors can quote navigation URLs; whether to `redactUrls` them is a question for Task 6 or the final review.
4. The pre-existing super-linear patterns in `Redactor.redact` (`URL_CREDENTIALS`, `jwt`) remain. The collector now bounds everything it stores, but other callers of `redact` on page-controlled text are not covered (already noted for the final review).

## Fix round 1 (controller rulings after aad1599)

Rulings: (1) `redactBounded` refinement accepted as is; (2) the 32-character method cap accepted; (3) apply bounded redaction to step/trace `error` and `title`.

- **Commit:** 2c54847 `Mask URLs in trace errors and titles, bounded like console text` (on aad1599; `Claude-Session:` trailer only).
- **Change:** new private `TraceCollector.text(raw, max)` = `redactBounded(raw, max, redactUrls)`. Console text, step errors (`endStep`, including the open step `finish` closes as failed), the trace `error`, and `title` now all go through it. The limits are unchanged: text 500, title 200.
- **Tests added (2):**
  - `masks and clips the page title`: `Reset /reset?token=abc` followed by 300 x's comes out as `Reset /reset?token=[REDACTED] x…`, exactly 200 characters.
  - `masks and clips the error of a failed scenario and its open step`: `Failed with ghp_<40 chars>` followed by 600 x's comes out as `Failed with ghp_[REDACTED] x…`, exactly 500 characters, in both `trace.error` and `steps[0].error`.
- **RED:** both new tests failed before the change. Stored values were `Reset /reset?token=abc xxx…` and `Failed with ghp_A1b2C3d4E5A1b2C3d4E5A…`, both unmasked.
- **GREEN:** `trace.test.ts` 7/7; `npm run typecheck` clean; `npm run lint` exit 0.
- Concern 3 above is resolved. Errors and titles are not origin-stripped, because only console text is compared across revisions, so they keep absolute app URLs (masked).

## Fix round 2 (task review: 2 Important, 3 minor)

- **Commit:** 8ddc938 `Mask trace URLs before making them relative, and stop the clock with the recording` (on 2c54847; `Claude-Session:` trailer only).
- **1 (Important), on-origin secrets survived and the origin strip had no boundary.** `text()` now redacts the window first, while URLs are still absolute, and then replaces `${origin}/` with `/`. The strip moved into `text()`, so console text, errors, and the title are all made app-relative the same way. A port prefix such as `:50000` no longer matches. The comment explains the order: the redactor finds a bare path only at the start of the text or after a space or quote.
  - Test `masks secrets in app URLs in console text before making those URLs relative` (positive) covers the stack-frame form `at load (…/app.js?token=…:4:9)` and the `redirect=…/reset?token=…` form.
  - Test `keeps URLs on other origins absolute, including one the app origin is a prefix of` (negative) covers console text and request URLs on `:50000` and on a CDN.
- **2 (Important), a failed step closed after `stop()` outlasted the trace.** The clock itself now freezes: `stop()` sets `stoppedAt ??= now() - t0` and `elapsed()` returns `stoppedAt ?? now() - t0`. `finish` uses `elapsed()`.
  - Test `stops the clock with the recording, so a step closed later never outlasts the trace`: after stop at 300 ms and a clock moved to 5000, the trace, the failed step, and a late console message are all at 300.
- **3 (minor), request redaction ran before the limit check.** `request()` now checks the local scheme, then counts, then checks the limit, and only then redacts. `url()` returns `string`, and the local-scheme check sits at both call sites.
- **4 (minor), the error test did not check URL masking.** It now uses a Playwright-shaped message, `page.goto: net::ERR_ABORTED at <origin>/login?token=abc123 (ghp_…)`, and expects `… at /login?token=[REDACTED] (ghp_[REDACTED]) x…` clipped to 500, in both `trace.error` and the step error.
- **5 (minor), literals.** Added `SHORT_TEXT_LIMIT = 200` (title, failure) and `METHOD_LIMIT = 32` beside `TRACE_LIMITS`, unexported. `TRACE_LIMITS` is unchanged.
- **RED:** 4 tests failed before the change. Stored values were `… at http://127.0.0.1:5000/login?token=abc123 …` unmasked, the stack frame with its token, `Mirror at 0/x …`, and a step `durationMs` past the trace's.
- **GREEN:** `trace.test.ts` 10/10; `npm run typecheck` exit 0; `npm run lint` exit 0.
