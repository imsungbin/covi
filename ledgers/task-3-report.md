# Task 3 report: Capture — change regions

**Status:** DONE (with minor observations below)
**Commit:** `dc6e61b` Find separate regions of change in pixel diffs (on `behavior-diff-capture`, parent `6dead4e`), authored with the default git identity, trailer `Claude-Session:` only.

## Implemented

- `packages/capture/src/regions.ts` (new), the brief's code verbatim, with Biome rewrapping two lines:
  - `MAX_REGIONS = 6`, internal `MAX_INPUT = 256`.
  - `mergeRegions(rects, { scale?, gap?, max? })`: scales CSS px to image px, clamps at 0, drops empty boxes, sorts by position, folds anything past 256 inputs into one box, merges overlapping or near boxes (`gap` defaults to 8), then merges the pair whose union adds the least area until `max` remain. The result doesn't depend on input order.
  - `changedRegions(image, { cell?, max? })`: puts pure-red pixelmatch pixels into 16 px cells, flood-fills 8-connected cells, keeps exact pixel bounds per area, then calls `mergeRegions` with `gap: cell`.
- `packages/capture/src/pixels.ts`:
  - imports `changedRegions`
  - `PixelDiff.regions: Rect[]` (doc comment as in the brief)
  - `comparePngs(before, after, diffPath?, options: { minRatio?: number } = {})` computes `changedRatio` once and writes the diff only when `changedRatio >= (minRatio ?? 0)`. The old unconditional write is gone. It returns `regions: changedRegions(diff)`.
  - The default behavior (always write) is unchanged for the existing caller, `demonstrate.ts:366`.

## Tests

- `packages/capture/test/regions.test.ts` (new): the brief's 7 tests, 3 for `changedRegions` and 4 for `mergeRegions`.
- `packages/capture/test/capture.test.ts`: `existsSync` added to the `node:fs` import, plus the new test `lists separate regions and writes the diff image only above minRatio` in `describe('pixel diffs')`.

## TDD evidence

**RED:** `npx vitest run packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts`
```
 FAIL  packages/capture/test/regions.test.ts [ packages/capture/test/regions.test.ts ]
Error: Cannot find module '../src/regions.ts' imported from .../packages/capture/test/regions.test.ts
 FAIL  packages/capture/test/capture.test.ts > pixel diffs > lists separate regions and writes the diff image only above minRatio
AssertionError: expected undefined to deeply equal [ { x: +0, y: +0, width: 2, …(1) } ]
 Test Files  2 failed (2)
      Tests  1 failed | 13 passed (14)
```
Both failures were the ones the brief predicted: the module was missing and `diff.regions` was `undefined`.

**GREEN:** same command
```
 Test Files  2 passed (2)
      Tests  21 passed (21)
```
The existing "finds where pixels changed and crops around it" test passes and wasn't modified.

**Wider checks:**
- `npx vitest run packages/capture`: 2 files, 21 tests pass.
- `npx vitest run tests/demo.test.ts tests/architecture.test.ts`: 2 files, 15 tests pass. This includes `captures before/after at each viewport and locates the change`, which runs `comparePngs` through `demonstrate.ts`, and the dependency-direction test, since capture imports only `@covi/core`.
- `npm run typecheck`: exit 0.
- `npx biome check --write packages/capture`: formatting only (two lines rewrapped, one in `regions.ts` and one in `regions.test.ts`). The follow-up `npx biome check packages/capture` is clean, and `npm run lint` (272 files) is clean.

**Ad-hoc probe (scratchpad only, not committed):**
- `mergeRegions` on 1000 isolated boxes with `gap: 0`: 1 ms, covers every input, and gives the same result for reversed input.
- `changedRegions` on a noisy 2560x1600 diff (one red pixel in every other 16 px cell, about 4000 separate areas): 6 regions in 180 ms.
- A clean 2560x1600 image: 0 regions in 12 ms.

## Files

- `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/regions.ts` (new)
- `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/src/pixels.ts`
- `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/test/regions.test.ts` (new)
- `/private/tmp/claude-501/-Users-a10637-projects-covi/b30bef48-8114-4ea2-ab09-f98dbfe231b5/scratchpad/wt/evidence/packages/capture/test/capture.test.ts`

## Self-review

- **Completeness:** every item in the brief's Interfaces and Steps 1–6 is done. Names match the brief exactly.
- **Rules:**
  - Capture imports only `@covi/core`, with `import type`.
  - Imports use `.ts`, and there are no enums or parameter properties.
  - The code is deterministic: no clocks or randomness, and sorting is total (`byPosition` compares y, x, width, height).
- **YAGNI:** nothing was added beyond the brief.
- **Output:** the test output is clean.

## Observations (none block this task)

1. **Inputs past `MAX_INPUT` usually collapse to one or a few boxes.**
   - The fold puts the smallest boxes into a single union. When they are scattered, that union spans most of the page, and `mergeOnce` then absorbs everything near it. In the probe, 1000 boxes of different sizes came out as 1 region.
   - The result still covers every input, and a page that noisy has no meaningful few regions anyway, so this follows the brief's design. Later tasks that show regions should expect a page-sized box on noisy pages.
2. **Some paths have no committed test, because the brief specified the tests:**
   - the `MAX_INPUT` fold
   - the `cell` and `max` options of `changedRegions`
   - the positive side of `minRatio` (a diff written when the ratio is at or above `minRatio`). The existing test passes a `diffPath` with the default `minRatio` but doesn't assert that the file exists.

   I can add these if the reviewer wants them.
3. **`pixels.ts` still declares its own `Rect`,** while `regions.ts` uses `Rect` from `@covi/core`. The two are structurally identical, so they type-check together. This duplication existed before the task and the brief didn't ask to remove it.
4. **`comparePngs` now scans the diff image twice:** once in the existing bounds loop, kept as the brief asked, and once in `changedRegions`. This is negligible at screenshot sizes.

---

## Fix round 1

**Commit:** `9d1dc05` Keep capped change regions apart, and test diff writes and the input fold (on top of `dc6e61b`). Trailer is `Claude-Session:` only.

### What changed

1. **Cap loop left overlapping boxes (Important).**
   - `mergeRegions` in `packages/capture/src/regions.ts` now runs `while (mergeOnce(boxes, gap)) {}` after each merge in the cap loop. Its comment says why: the union can reach a box it did not include.
   - The doc comment now says "until at most `max` are left, and no two left overlap".
   - New test `merges again when keeping at most max boxes makes two of them overlap` uses the reviewer's repro with `{ max: 2 }`. It asserts the exact result `[{ x: 0, y: 0, width: 100, height: 130 }]` and that the boxes are pairwise apart, using a new `expectApart(boxes, gap)` test helper.
2. **Missing tests (Important).**
   - **(a) Writing the diff image:**
     - The existing `finds where pixels changed and crops around it` test now also asserts `existsSync(diff.png)`. This pins the default "writes always" behavior.
     - New boundary test `writes the diff image when exactly minRatio of the pixels changed`: 400 of 8000 pixels change with `minRatio: 0.05`. It asserts `changedPixels === 400` and that the file exists. `400 / 8000 === 0.05` is exactly true in JS, so this checks `>=` at equality.
   - **(b) The fold:** new test `folds very many boxes and still covers every input, in any order`.
     - Input is 300 boxes: 255 10x10 boxes on a grid, plus 45 2x2 boxes clustered in the corner. The 45 small ones are the ones folded.
     - It asserts `1 < length <= MAX_REGIONS`, that every input is covered on both axes (new `covered` helper), that the output boxes are pairwise apart at `gap: 0`, and identical output for reversed input.
     - The input is designed to give 6 real boxes, so the pairwise check is not vacuous. A scattered input collapses to 1 box.
3. **Cap loop allocated per pair (Minor).** A new `addedArea(a, b)` computes the cost inline, with no allocation. `union()` is still used for the actual merges, which happen O(n) times.
   - **Identical output, checked against a baseline:** I saved the fix-1 version of `regions.ts` before this change, then compared both versions on a seeded corpus. 400 box sets, of which 20 have up to 400 boxes and so exercise the fold, each with 4 option sets (`{}`, `{gap:0}`, `{max:2}`, `{gap:0,max:3,scale:2}`): **1600 cases, 0 differ**. The comparison was a scratchpad probe and is not committed.
   - The fold test went from about 500 ms to 44 ms.
4. **Duplicate `Rect` (Minor).** `packages/capture/src/pixels.ts` now uses `import type { Rect } from '@covi/core'`, and the local interface is removed. Nothing imported `Rect` from `pixels.ts`; `index.ts` re-exports only `comparePngs`, `cropPng`, `PixelDiff`, and `readPng`.

### TDD evidence

**RED** (new tests in place, before fix 1): `npx vitest run packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts`
```
     × merges again when keeping at most max boxes makes two of them overlap 4ms
     ✓ folds very many boxes and still covers every input, in any order 487ms
 FAIL  packages/capture/test/regions.test.ts > mergeRegions > merges again when keeping at most max boxes makes two of them overlap
AssertionError: expected [ …(2) ] to deeply equal [ { x: +0, y: +0, width: 100, …(1) } ]
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 23 passed (24)
```
The tests for 2a and 2b pass on the old code too. That is expected: they add coverage for behavior that already existed, rather than reproduce a bug.

**GREEN after fix 1:** `npx vitest run packages/capture/test/regions.test.ts` gives 9 passed.

**Final**, after all four fixes: `npx vitest run packages/capture/test/regions.test.ts packages/capture/test/capture.test.ts tests/demo.test.ts --reporter=verbose`
```
✓ regions.test.ts > mergeRegions > merges again when keeping at most max boxes makes two of them overlap 0ms
✓ regions.test.ts > mergeRegions > folds very many boxes and still covers every input, in any order 44ms
✓ capture.test.ts > pixel diffs > finds where pixels changed and crops around it 47ms
✓ capture.test.ts > pixel diffs > reports no bounds for identical images 16ms
✓ capture.test.ts > pixel diffs > lists separate regions and writes the diff image only above minRatio 21ms
✓ capture.test.ts > pixel diffs > writes the diff image when exactly minRatio of the pixels changed 27ms
✓ tests/demo.test.ts > demonstrations > captures before/after at each viewport and locates the change 8159ms
 Test Files  3 passed (3)
      Tests  29 passed (29)
```
(The listing above is trimmed; the remaining tests in the three files also pass.)

**Other checks:**
- `npm run typecheck`: exit 0.
- `npx biome check --write packages/capture`: no fixes.
- `npm run lint`: "No fixes applied", exit 0.

### Remaining observations

- As before, more than 256 scattered inputs usually collapse to one page-sized box. The fold test uses a clustered fold set so that it can check separation.
