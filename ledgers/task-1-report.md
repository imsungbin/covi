# Task 1 report: Core — demo paths, behavior model, artifact kinds, and `demo.record`

**Status:** DONE
**Commit:** `8ddf46e` Add demo run paths, behavior evidence types, and demo.record (author: SeongBeen Im, default git identity; trailer `Claude-Session:` only)

## Implemented

All code is verbatim from the brief.

- `packages/core/src/model/behavior.ts` (new): `DemoRevision`, `DemoViewport`, `ConsoleLevel`, `MutationSummary`, `TraceStep`, `TraceRequest`, `TraceConsole`, `Trace`, `StepState`, `StepDiff`, `RequestRef`, `NetworkEntry`, `NetworkChange`, `ConsoleEntry`, `TimingDelta`, `ScenarioDiff`, `BehaviorDiff`.
- `packages/core/src/run/paths.ts` (new): `DEMO_PATHS` (plan, captures, notes, screenshots, diffs, recordings, traces, behaviorDiff) and `demoPath.{pageFull,pageCrop,pageDiff,flowFrame,stepDiff,recording,trace}`.
- `packages/core/src/model/demo.ts`: `import type { DemoRevision, DemoViewport } from './behavior.ts'`; new `DemoRecording`, `DemoRecordingStatus`, `DemoTraceRef` before `Demonstration`; optional `recordings`, `recording`, `traces`, `behavior` at the end of `Demonstration`.
- `packages/core/src/run/run.ts`: `ArtifactKind` gains `'trace' | 'behavior-diff'` right after `'recording'`.
- `packages/core/src/index.ts`: `export * from './model/behavior.ts'` before `./model/change.ts`; `export * from './run/paths.ts'` before `./run/run.ts`.
- `packages/core/src/config/schema.ts`: `demo.record` (`z.boolean().optional().describe(...)`) after `viewports`; `CoviConfig.demo.record: boolean` with its doc comment; `DEFAULT_CONFIG.demo.record: true`.
- `packages/core/src/config/resolve.ts`: `COVI_DEMO_RECORD` → `demo.record` via `bool()`, after the `COVI_OUTRO` line.

## Tests

- `packages/core/test/run.test.ts`: new `describe('demo paths')` (import of `DEMO_PATHS, demoPath` added, sorted before `../src/run/run.ts`).
- `packages/core/test/config.test.ts`: new case inside `describe('configuration')`: default true, repository layer false with provenance `repository (.covi/config.yml)`, `COVI_DEMO_RECORD=0` → false, `yes` → true, a non-boolean rejected with a message naming `demo.record`.

### RED

Command: `npx vitest run packages/core/test/run.test.ts packages/core/test/config.test.ts`

```
 FAIL  packages/core/test/run.test.ts [ packages/core/test/run.test.ts ]
Error: Cannot find module '../src/run/paths.ts' imported from .../packages/core/test/run.test.ts
 FAIL  packages/core/test/config.test.ts > configuration > records browser flows by default; demo.record and COVI_DEMO_RECORD turn it off
AssertionError: expected undefined to be true // Object.is equality
 ❯ packages/core/test/config.test.ts:121:50
 Test Files  2 failed (2)
      Tests  1 failed | 13 passed (14)
```

Both failures match the brief's expectation.

### GREEN

Same command:

```
 ✓ packages/core/test/config.test.ts (14 tests) 20ms
 ✓ packages/core/test/run.test.ts (6 tests) 103ms
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

### Verification

- `npm run typecheck`: exit 0 (both `tsc` projects).
- `npx biome check --write packages/core`: fixed 1 file (it wrapped the brief's `pageCrop` assertion in `run.test.ts`, which was over 100 columns). Then `npx biome check packages/core`: "Checked 77 files ... No fixes applied", exit 0.
- Full suite `npx vitest run`: `Test Files 58 passed | 1 skipped (59)`, `Tests 800 passed | 6 skipped (806)`. No snapshot of the config or the schema broke.

## Files changed

- packages/core/src/model/behavior.ts (new)
- packages/core/src/run/paths.ts (new)
- packages/core/src/model/demo.ts
- packages/core/src/run/run.ts
- packages/core/src/index.ts
- packages/core/src/config/schema.ts
- packages/core/src/config/resolve.ts
- packages/core/test/run.test.ts
- packages/core/test/config.test.ts

## Self-review

- Completeness: every item in the brief's Interfaces list exists and is exported from `@covi/core` (types through `export *`, `DEMO_PATHS`/`demoPath` through `./run/paths.ts`).
- Architecture: core imports no other Covi package. `behavior.ts` and `demo.ts` import each other, but only with `import type`, so the cycle disappears at runtime (the brief specifies this). `.ts` extensions, no enums or namespaces.
- Config only grows: `demo.record` is a new optional key; nothing was repurposed.
- YAGNI: nothing beyond the brief.
- Output: test run is clean; no stray files (`git status` clean after commit).

## Concerns (non-blocking)

- Docs not updated (outside this brief): `docs/configuration.md` (demo keys table near line 311, env table near line 480), `docs/cli.md` (env table near line 560), and `docs/video.md:88` list `demo.*` keys and `COVI_*` variables, and none mention `demo.record` / `COVI_DEMO_RECORD` yet. A later task should add them if the plan doesn't already.
- Four lines from the brief run past 100 columns (doc comments in `behavior.ts` lines 26 and 36 and in `demo.ts` around line 104, plus the `flowFrame` template literal in `paths.ts`). Biome does not wrap comments or template literals and reports no error, so I left them verbatim.
