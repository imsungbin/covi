# Task 6 report: Capture — Playwright recording and tracing

Status: DONE_WITH_CONCERNS (concerns are review notes; nothing is broken)
Commit: 5a13c1e `Record and trace browser flows and page captures with Playwright` (on c89ec01, default git identity, `Claude-Session:` trailer only)

## Implemented

All code follows the brief verbatim. The only changes are Biome's formatting of long lines in the test.

- `packages/capture/src/recording.ts` (new)
  - `RecordingUnavailableError extends EnvironmentError`: exit 3; message `Flows cannot be recorded: <detail>`; hint names `covi doctor --install-browser` and `--no-record`.
  - `FinalRecording`.
  - `finalizeRecording(raw, { mp4, webm }, ffmpeg)`:
    - no ffmpeg → rename to `.webm`, `cause: 'no-ffmpeg'`;
    - otherwise tries libx264, then mpeg4 (even dimensions, faststart);
    - on failure → removes the partial mp4 and keeps the WebM, with `cause: 'convert-failed'` and `detail`;
    - if spawning ffmpeg throws, it stops trying encoders.
- `packages/capture/src/observe.ts` (new)
  - `MUTATION_SCRIPT` (fixed string; counts only after `load`; ignores `<head>` and `documentElement`; keeps at most 200 targets).
  - `TAKE_MUTATIONS` (fixed string; reads and resets).
  - `collectMutations(page, scale)` → `mergeRegions(rects, { scale })`.
  - `observe(page, trace)` connects these Playwright events to the collector: `request`, `requestfinished` (status from `response()`), `requestfailed`, `console`, `pageerror`. Duration comes from `timing().responseEnd`.
  - No pre-truncation or pre-redaction; the collector does both.
- `packages/capture/src/browser.ts` (replaced)
  - `settle`, `describe`, `shortSelector`, `targetOf` are copied byte-for-byte from HEAD. They were taken with `git show HEAD:` and awk, and `git diff` shows no removed lines inside them.
  - New exports:
    - `ContextOptions`;
    - `contextOptions(viewport, { recordDir })`: `recordVideo` at the CSS viewport size, only when asked;
    - `newContext(browser, viewport, options)`;
    - `PageCapture.title`;
    - `capturePage(..., trace?)`: `start` → `observe` → step `load` → `frame` → `endStep` with mutations; `endStep` failed on error; `stop` in `finally`;
    - `FlowFrame.step`, `stepId`, `FlowOptions`, `FlowRun`.
  - Private `openPage`: if a recorded context fails, either at `newContext` or at `newPage`, it closes that context and falls back to an unrecorded one with `recordError` set (first line).
  - `runFlow` with trace steps `open`, `s1`…, `end`:
    - each step's mutations are read at the end of that step;
    - `stop()` runs before `context.close()`;
    - `video.path()` is read after close.
- `index.ts` is untouched, as the brief says (Task 7 rewrites it).

## Tests

`packages/capture/test/browser.test.ts` (new, verbatim from the brief, Biome-formatted), 6 tests:
- `contextOptions`: records only when asked, at 390×844 CSS, with DPR 2.
- `finalizeRecording`:
  - no ffmpeg → WebM kept and raw file gone;
  - bogus ffmpeg path → `convert-failed` with `detail`, and no mp4 left behind;
  - `RecordingUnavailableError` exit code and message.
- Browser test 1 (real Chromium, mobile), a recorded and traced flow:
  - frames are `['s1','end']`;
  - the `.webm` exists;
  - title is `Probe`;
  - steps are `open, s1, s2, end`;
  - s1 is the click on `#add` with label and screenshot `f-0.png`;
  - box width = focus width − 48 (±1);
  - mutations > 0;
  - the 404 fetch is recorded with `token=[REDACTED]`;
  - the console error `Could not load: HTTP 404` is recorded.
- Browser test 2: an injected browser whose recorded `newContext` rejects → the flow runs unrecorded, with no `video`, `recordError` matching `Executable doesn't exist`, and frames present.

### TDD evidence
- RED: `npx vitest run packages/capture/test/browser.test.ts` → `FAIL … Error: Cannot find module '../src/recording.ts'` (0 tests ran).
- GREEN: same command → `6 passed (6)`. Both browser tests ran (3.2 s and 3.4 s), so they were not skipped.

### Verification
- `npx vitest run packages/capture/test/browser.test.ts packages/capture/test/capture.test.ts tests/demo.test.ts` → 3 files, 26 passed. Flow labels are unchanged, so demo.test passes.
- `npx vitest run packages/capture/test` (after Biome formatting) → 5 files, 58 passed.
- `npm run typecheck` → clean. `npx biome check --write packages/capture` reformatted the test file only; `npm run lint` → `Checked 267 files … No fixes applied.`
- Throwaway scripts in the scratchpad, not committed:
  - `capturePage` with a trace gives one `load` step with screenshot and mutations, requests `/` (200) and `/a.png` (404) attributed to `load` with relative URLs, console `warning` and `error`, and title `Page`.
  - A real recorded flow passed through `finalizeRecording` with `/opt/homebrew/bin/ffmpeg` gives `format: 'mp4'`, ffprobe reports `h264,390,844`, and the raw WebM is removed.

## Files
- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/recording.ts
- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/observe.ts
- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/browser.ts
- /private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/test/browser.test.ts

## Self-review
- Completeness: every interface in the brief exists with the given signature.
- Imports and style: capture imports only `@covi/core` and `playwright`, never `@covi/video`. The ffmpeg path is injected (`finalizeRecording`'s third argument). Imports use `.ts`, `import type` is used for Playwright and core types, and there are no enums.
- Security:
  - `page.evaluate` and `addInitScript` only ever receive fixed module strings.
  - Selectors come from configuration or the plan, as before.
  - URLs, console text, titles, and errors reach the collector raw, and it redacts and bounds them.
- Tests check behavior, not just shape:
  - the recording file exists;
  - WebM is kept, with a reason, when ffmpeg is absent or fails;
  - the flow still runs when the recorder is unavailable;
  - step, request, and console ids and attributions;
  - box versus focus at 2×.
- Output is clean: the vitest runs print no stray warnings.

## Concerns (for the reviewer or lead; I did not change the brief's code)
1. **The page can tamper with its own mutation data.** `MUTATION_SCRIPT` stores its state on `window.__coviMutations`, which runs in the page's main world, so the app under test can overwrite it. `collectMutations` passes the result of `page.evaluate(TAKE_MUTATIONS)` through without checking it.
   - A non-iterable `targets` throws inside the page and is caught, giving `{0, []}`.
   - Non-numeric rects become NaN and `mergeRegions` drops them.
   - But a page that sets `state.count = 'x'` or `{}` gets that value into `trace.mutations.count`; the reduce in `finish()` would then produce a string such as `"0x"`.
   - Traces have no Zod schema on read, so nothing catches this later.
   - Suggested fix, about 5 lines in `collectMutations`: keep `count` only when it is a finite number ≥ 0, rounded, otherwise 0; drop rects that are not objects with finite numbers; cap rects at 200.
   - The main world can't hide the state, so this has to be checked on the Node side.
2. **No committed test for `capturePage` with a trace.** The brief's tests cover only `runFlow`. I checked the `load` path by hand (see Verification). Task 7 may cover it through `demonstrate`; if not, a small test is worth adding.
3. **Test files are not typechecked.** `tsconfig.json` includes `packages/*/src/**` and `tests/**`, but not `packages/*/test/**`, so `browser.test.ts` is not typechecked. This is an existing project convention; I left it as is.

## Fix report (lead rulings on concerns 1 and 2)

Commit: e05a3c0 `Check the DOM changes a page reports, and test traced page captures`, on top of 5a13c1e. Only the `Claude-Session:` trailer.

### Changes
- `observe.ts`:
  - New pure, exported `parseMutations(raw: unknown, frame: { width; height }) → { count; rects }`, in CSS pixels.
    - Non-objects read as `{}`.
    - `count`: a finite number becomes `Math.max(0, Math.floor(count))`; anything else becomes 0.
    - `rects`: an array, sliced to 200 *before* filtering. This bounds the work, and it loses nothing for an honest page, whose init script never keeps more than 200.
    - Each rect is kept only if `x`, `y`, `width`, and `height` are all finite numbers. It is clipped to `[0, frame.width] × [0, frame.height]` and dropped if nothing is left. Because `x + width` overflowing to Infinity is clamped too, `1e308` values stay finite.
  - `collectMutations(page, scale, frame)` now runs `parseMutations` on the raw `page.evaluate` result. A failed evaluate gives `undefined`, which parses to `{0, []}`.
- `browser.ts`:
  - `capturePage` passes `{ width: v.width, height }`: the screenshot's full, capped height rather than just the viewport, so changes below the fold that appear in the image are kept.
  - `runFlow` passes `VIEWPORT_PRESETS[viewport]`, because flow frames are viewport screenshots.
  - Signature change: `collectMutations` gains a required third parameter, `frame`. Its only callers are in `browser.ts`; Task 7 only re-exports it.
- Tests:
  - New `packages/capture/test/observe.test.ts`, 4 unit tests, no browser:
    - honest boxes pass, and one is clipped to the frame;
    - hostile input (`count: 'x'`; NaN, string, Infinity, null, number, and off-frame rects; then 10,000 rects of `1e308`) gives count 0, between 1 and 200 rects, all finite, positive, and inside the frame;
    - counts: 4→4, 2.7→2, −5→0, NaN, ∞ and `'12'`→0;
    - non-objects and non-array rects read as no boxes.
  - `browser.test.ts` gains one Chromium test, `capturePage with a trace`, using the `WIDE` page. It appends a 5000 CSS px banner after load. The test checks:
    - a single `load` step (`goto`, `ok`, `page.png`);
    - a `GET /` 200 `document` request attributed to `load`;
    - the title `Wide`;
    - `mutations.count` is an integer > 0;
    - between 1 and `MAX_REGIONS` regions, each inside `capture.width × capture.height`.

### TDD evidence
- RED, with the tests written before the code:
  - `observe.test.ts`: 4 failures, `TypeError: parseMutations is not a function`;
  - the new Chromium test: `AssertionError: expected 5008 to be less than or equal to 1280`, i.e. the unclamped banner region at 5a13c1e.
  - The other 6 browser tests passed.
- GREEN: `npx vitest run packages/capture/test/observe.test.ts packages/capture/test/browser.test.ts` → 2 files, 11 passed. The new Chromium test passed in all 3 repeated runs (`-t capturePage`).
- `npm run typecheck` is clean. `npm run lint` reports `No fixes applied`.

### Note
A hostile page can still hang its own main thread, and with it any `page.evaluate`, including `settle`'s existing call. That was already true before this task and is not something the mutation script can prevent, so it is out of scope here.

## Fix report: review round 1

Commit: 8a2b813 `Close contexts whose page cannot open, and test ffmpeg conversion with a stand-in`, on top of e05a3c0. Only the `Claude-Session:` trailer.

### Fixes
1. **finalizeRecording's real paths are now tested** (`browser.test.ts`, `finalizeRecording › with ffmpeg`, skipped on win32).
   - `fakeFfmpeg(dir, exit)` writes a POSIX `sh` script (chmod 755). It appends `$*` to `ffmpeg.log`, writes its last argument (the MP4 target), then runs the given exit shell.
   - The cases:
     - (a) `exit 0` gives `{ file: mp4, format: 'mp4' }`; the MP4 exists, the raw file is gone, 1 call.
     - (b) exit 1 on `libx264`, otherwise 0, gives mp4 with 2 calls: the first contains `libx264`, the second `mpeg4`.
     - (c) writes the target, then `echo 'bad input' >&2; exit 1`, gives `{ format: 'webm', cause: 'convert-failed', detail: 'bad input' }`; the WebM exists, the MP4 doesn't, the raw file is gone, 2 calls.
   - The brief's nonexistent-path test stays: it covers the branch where the spawn itself throws.
2. **Count capped at 1e9** (`observe.ts`): `MAX_COUNT = 1e9`, and the count is `clamp(Math.floor(count), MAX_COUNT)`. `observe.test.ts` now checks that `1e308` becomes `1e9`.
3. **Context and trace cleanup** (`browser.ts`):
   - A new private `openContext(browser, viewport, options)` creates the context and then the page. If `newPage` rejects, it closes the context and rethrows.
   - `capturePage` and both `openPage` paths use it: the recorded attempt, the unrecorded fallback, and the run without recording. `capturePage` had the same leak at its own `newPage`, so it is fixed too.
   - `trace.start()` and `observe()` now run inside the `try`, in both `capturePage` and `runFlow`. If `addInitScript` rejects, `stop()` and `context.close()` still run: `runFlow` returns `error`, and `capturePage` rethrows.
4. **Timeout** (`recording.ts`): `CONVERT_TIMEOUT_MS = 120_000`. When `exec` resolves with `timedOut`, the loop breaks with `detail: 'ffmpeg timed out after 120 s'` and does not retry mpeg4.
   - Not tested: the timeout is a constant, so a test would take 120 s. Making it injectable seemed beyond this finding.
5. **Tests**:
   - (a) A failing step: `press: 'NoSuchKey'` gives steps `open/ok, s1/ok, s2/failed` with the error.
     - To check that `stop()` ran, the test uses a skewable clock: after the run it jumps 60 s ahead, and `finish().durationMs` stays under 60 s.
     - The WebM is still returned and exists.
   - (b) A stub whose recorded context's `newPage` rejects: that half-made context's `close()` is called once, and the flow runs unrecorded with no `video`, a `recordError` matching `Executable doesn't exist`, no `error`, and frames.
     - `runFlow` has no `recording.status`. Task 7's `demonstrate` maps "no video" plus `recordError` to `status: 'unavailable'` with `detail`; a comment in the test says so.
   - New stub tests for fix 3, which need no Chromium:
     - "closes every context it made": `newPage` always rejects; `runFlow` rejects and closes 2 contexts (recorded, then unrecorded); `capturePage` rejects and closes 1.
     - "closes the context and stops the trace when the page cannot be observed": a fake page whose `addInitScript` rejects. `runFlow` returns `error: 'Init script refused'`, the context is closed, and the trace is stopped. `capturePage` rejects, closes its context, and stops its trace.

### TDD evidence
- RED, on the code at e05a3c0 with the new tests in place, 3 failures, each the intended one:
  - `expected 1e+308 to be 1000000000` (count cap);
  - `closes every context it made`: `expected 1 to be 2` (the unrecorded context leaked);
  - `closes the context and stops the trace…`: `Error: Init script refused` (`observe` was outside the `try`, so `runFlow` rejected).
- Passed on the old code too, because they cover behavior that already worked: the three fake-ffmpeg tests, 5a, and 5b. The recorded path's half-made context was already closed.
- GREEN: `npx vitest run packages/capture/test/observe.test.ts packages/capture/test/browser.test.ts` gives 2 files, 18 passed.
- Also re-ran `packages/capture/test/capture.test.ts` and `tests/demo.test.ts`: 2 files, 20 passed. They call `capturePage` and `runFlow`, whose structure changed.
- `npm run typecheck` is clean. `npm run lint` reports `No fixes applied`.
- One run showed the fake-ffmpeg failure test at 3.1 s. Run alone, all three take under a second: the time came from contention with the parallel Chromium worker, not the code.
