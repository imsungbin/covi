# PR A2 — Sound from motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In directed videos, what moves on screen makes its own sound: a camera move inside a scene gets a soft whoosh, a counter ticks (one train of ticks following its ease), merging pieces land with a thump, and an element appearing gets a soft accent. The sounds are new recipes pitched in C that follow the music's key, and they are mixed under A1's rules. Nothing in `video/timeline.json` depends on the sound choice.

**Architecture:** The timeline's cues (`buildCues` in `packages/video/src/timeline/cues.ts`) gain four kinds, derived from each scene's resolved direction beats (`TimelineScene.direction`, B2–B5): `camera`, `count` (one cue that carries its `seconds`), `merge`, and `appear`. A storyboard visual's own cues now sound only while the shot shows it. `@covi/audio` gains the tick train (`sfx/train.ts`: tick times on the counter's ease-out cubic, one stereo sound per count) and four recipes in `templates/music/sfx/` mapped in `sound-effects.yml`. Placement adds ranks and levels for the new kinds, and two counters never tick at once. The sound stage (`packages/video/src/sound.ts`) renders a count cue as a train, `video/audio.json` records each train's `seconds` and `ticks`, and QC fails a record where two counters overlap.

**Tech Stack:** TypeScript on Node 22.18+ (no build step), Zod 4, Vitest 5, ffmpeg (`ebur128`), Playwright Chromium (render tests).

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md`: §13 (sound from motion), §12 (A1's mix rules), §17 (acceptance), §15–§18. Rulings ledger: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md`. R-011 (effect gains relative to the bed, ≥ 8 dB under the voice peak), R-018 (A1 approved), and R-024 (one CHANGELOG line) bind this PR. Code worktree: `~/projects/covi-sound`, branch `sound-from-motion`, started from the latest `main` after A1 and B2–B7 merged.

## Global Constraints

Every task's requirements include these. Values are copied from the spec, the rulings, the owner's scope, and `AGENTS.md`.

- Owner's scope (verbatim):
  - "Direction events cue effects: camera moves → whoosh; counters → ticks; merge → thump; reveal → soft accent."
  - "Recipes are pitched in C and follow the music's key, and effects are mixed under A1's rules."
  - "Nothing in `video/timeline.json` may depend on the sound choice; sound follows the picture."
- Spec §13 (verbatim):
  - "Timeline cues gain direction events (cues exist whatever the sound settings, so frames never depend on sound): `camera` (stop-to-stop `pan`/`zoom` and in-stop camera beats) → whoosh; `count`/`count-up` → `tick` (one cue carrying its duration, rendered as a tick train following the counter's ease); `merge` → `thump`; `reveal` → soft `accent`."
  - "New recipes in `templates/music/sfx/` pitched in C (note names; they follow the key via `effectTranspose`); cue map entries in `sound-effects.yml`."
  - "Mixed under A1 rules (relative to the bed, ≥ 8 dB under the voice peak, density limits; ticks count as one effect)."
- Dependency direction: `brand` ← `video`, `audio` ← `video`; `core` ← `capture`, `video`, `platforms` ← `cli`. `core`, `brand`, and `audio` import no other Covi package, so `@covi/audio` never imports `packages/video`. Browser runtime files import only DOM-free shared files. `timeline/cues.ts` is bundled by the runtime: keep it free of DOM and Node APIs.
- Sound engine (AGENTS.md): it is deterministic like the runtime. Use only the seeded PRNG (`dsp/prng.ts`): no `Math.random` and no clocks. Bump `AUDIO_ENGINE_VERSION` whenever rendered output changes: it is `covi-audio-4` after A1, and this PR makes it `covi-audio-5`. Scores are untrusted input and stay bounded; this PR adds no score field.
- Music templates (AGENTS.md) are validated on load, and a test loads every file. Recipes write pitched layers as note names in C, which follow the music's key; they write sound design in Hz, which never transposes. Check a change by rendering an example and listening to `video/music.wav`, then reading `video/audio.json` and the sound checks in `video/qc.json`.
- "Music fits the picture, never the reverse: nothing in `video/timeline.json` may depend on the music or effects choice." Cues are built from the picture alone. `buildCues` takes no sound setting.
- A1's mix rules (spec §12.1, R-011, R-A1-4/5):
  - `sound-effects.yml` `gainDb` is relative to the bed's level under speech (`BED_DB`).
  - After placement, the mix lowers every effect together until the loudest peak is ≥ 8 dB under the voice's (`EFFECTS_UNDER_VOICE_DB`, recorded as `levels.effectsCutDb`).
  - Effects are ≥ `minSpacing` (0.15 s) apart and at most `maxPerSecond` (3) in any second.
  - A tick train counts as one effect.
- Schemas: `SoundEffectsSchema` stays a `z.strictObject` with bounded numbers. `video/audio.json` stays `schemaVersion: 1`; its new fields are additive. `video/timeline.json` stays `version: 1`, and `TimelineCue` gains only optional fields and kinds. The storyboard schema is unchanged, including its `SceneCueKind`. Never change any `version` field anywhere, including `package.json`.
- QC (R-007): quality checks warn, and `fail` is reserved for broken output. This PR adds one `fail` condition to the existing `sound-effects` check: two placed counters ticking at once. Placement prevents it, so a record showing it is a bug, like the crowding this check already fails.
- Messages in drop reasons and QC are English literals, like A1's: they are diagnostic records. This PR draws no text on screen and adds no catalog keys.
- Code style: `.ts` import extensions, `import type` for types, no enums, namespaces, or constructor parameter properties. Biome: two spaces, single quotes, 100 columns. Comments say why, in concise English.
- Commits use the default git identity and never name Claude as author or co-author. Each message is concise English and ends with a blank line and `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S`. Never push. Each task leaves `npm run check` green.
- `npm test`, `npm run check`, and `npm run test:render` take 3–6 minutes. Run them in the foreground with a 600000 ms timeout. A full `covi video` render goes to the background; wait for it with a foreground `until [ -s <marker> ]; do sleep 20; done` loop. Shell steps use fixed paths (`/tmp/covi-a2/…`) or one compound command. No shell variable is carried from one command to the next (B1 PF-4).
- **Pre-flight (as R-020/R-021):** A2 runs after A1 and B2–B7 merge. Before Task 1, a fresh scan checks every name under "Names this plan builds on" against post-B7 `main`. Where a merged name differs, use the merged name, keep the behavior described here, and record a ruling.

## Names this plan builds on

From A1 (`broadcast-mix`, plan `2026-10-09-a1-broadcast-mix.md`):

- `packages/audio/src/effects.ts`:
  - `SoundEffectsSchema`, with keys `gainDb`, `verdictBoostDb`, `outroBoostDb`, `swellCutDb`, `minSpacing`, `maxPerSecond`, and `recipes`.
  - `recipes` lists the cue keys `click`, `reveal`, `finding`, `finding-high`, the three `verdict-*` and three `outro-*` keys, `transition`, `riser`, and `hero`.
  - `SoundEffectsConfig`.
  - `EffectCue { t; kind; scene; detail? }`, `PlacedEffect { t; kind; recipe; gainDb }`, and `DroppedEffect { t; kind; recipe; reason }`.
  - `effectRecipe(cue, config): { recipe; priority }`. Its priorities: outro 4, verdict and hero 3, high-severity finding 2, the rest 1, transition and riser 0.
  - `placeEffects(cues, config): { placed; dropped }`.
  - `effectTranspose(key)`.
- `BED_DB` (`packages/audio/src/placement.ts`).
- `packages/audio/src/mix.ts`: `STEM_LUFS`, `EFFECTS_UNDER_VOICE_DB`, and `mixSound`, whose `effects: Array<{ t; audio: Float32Array[]; gainDb }>` places each effect's audio at `t`.
- `packages/audio/src/sfx/recipes.ts`: `renderSfx(recipe, patches, { sampleRate, seed, transpose })`. It renders every recipe to a −3 dBFS peak, and a recipe's `anchor` is the moment that meets its cue.
- `packages/audio/src/dsp/fx.ts`: `mixInto`, `peakAbs`, and `stereo`.
- `packages/audio/src/loudness.ts`: `momentaryLoudness` and `dbToGain`.
- `packages/audio/src/library.ts`:
  - `AUDIO_ENGINE_VERSION = 'covi-audio-4'`.
  - `loadMusicLibrary`, which checks every cue-map recipe exists.
- `packages/video/src/sound.ts`:
  - `produceSound`, whose effects loop renders each placed recipe once (the `renders` map) and pushes `{ t: max(0, p.t − recipe.anchor), audio, gainDb }`.
  - `musicLibrary()`, `AUDIO_PATHS`, and `AudioRecord`, whose `effects` field is `{ enabled; placed: PlacedEffect[]; dropped: DroppedEffect[] }`.
- `packages/video/src/qc.ts`: `soundChecks(record, limits)`. Its `sound-effects` block reads `effects.placed` and computes `crowded`, `dense`, and `quiet`.
- `tests/render/sound.test.ts` helpers: `covi(args)`, `example(name)`, `read(run, rel)`, and the interfaces `Result` and `Qc`.
- The A1 Task 8 measurement script, which Task 6 adapts.

From B2–B6 (plans `2026-10-09-b2-direction-canvas.md` … `-b6-draft-critique.md`):

- **B2:**
  - `TransitionKind` gains `pan` (0.7 s) and `zoom` (0.9 s).
  - `WHOOSH` in `timeline/cues.ts` already includes `pan` and `zoom`, so stop-to-stop camera moves are cued as `transition` with `detail: 'pan' | 'zoom'`. B2's test is `cues-hero.test.ts`, "sound mid-move when the camera pans or zooms to the next stop".
  - `TimelineScene.stop?: Stop` and `TimelineScene.direction?: SceneDirection`, where `SceneDirection` is `{ whole; elements: DirectionElement[]; beats: DirectionBeat[] }` with beats in time order.
  - `DirectionElement` has `{ id; kind: 'visual' | 'code' | 'output' | 'capture' | 'node' | 'label' | …; rect }`.
  - Resolved beats carry `t` (seconds since the scene started) and `seconds`:
    - `{ verb: 'reveal'; element; style; t; seconds }`
    - `{ verb: 'camera'; move: 'zoom' | 'pan' | 'follow'; to; zoom?; t; seconds }`
  - `BEAT_SECONDS`: reveal 0.5, camera 0.8.
  - `buildTimeline({ …, entrances, staging })` attaches `stop` and `direction` before `cues: buildCues(scenes)`.
  - `layoutScenes(…, entrances)`.
  - The stage's `cameraSteps` moves the camera only for a scene with a `stop`, and skips a camera beat whose `to` names no element of the shot.
  - `mountShot` keeps the storyboard visual on the scene's clock (unshifted), while other elements play from their reveal. An element not revealed yet is not on screen.
- **B3:** `{ verb: 'morph'; element; t; seconds }`.
- **B4:**
  - `{ verb: 'count'; element; t; seconds }`, which lands on its phrase. `BEAT_SECONDS.count` is 1.6 and `COUNT_MIN` is 0.6.
  - `packages/video/src/runtime/numbers.ts` (DOM-free): `CountSpan { t; seconds }` and `countProgress(t, count)`, an ease-out cubic `1 − (1 − k)³`.
- **B5:**
  - `{ verb: 'flow'; from; to; packet?; t; seconds }`
  - `{ verb: 'split'; element; count; name; side; t; seconds }`
  - `{ verb: 'merge'; element; into?; t; seconds }`, drawn with `easeInOutCubic(seg(t, merge.t, merge.t + merge.seconds))`
  - `{ verb: 'stack'; element; t; seconds }`
  - `{ verb: 'count-up'; element; value; t; seconds }`, timed like a count
  - Flows, splits, merges, and stacks stretch toward the next beat, ending 0.15 s before it, up to three times their length.
  - The benchmark's `s1` shot has beats `split`, `stack`, `merge`, and `count`. `s2` is a `morph` shot with a `camera follow`.
  - B5 ruling: "A2 owns cues (`merge` → thump, `count-up` → tick, read from the resolved beats)."
- **B6:** `shotMotion` and `motionSpans` (`timeline/motion.ts`). A2 adds no motion QC and does not use them.

## Review Focus

These are five inputs or conditions the spec implies that a person will meet and that no task's main tests would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **Two counters counting at once.** An agent counts two metrics on one phrase, or a `count-up` on one counter overlaps a `count` on another. Expected: one train of ticks, the other recorded as dropped ("while another counter ticks"), never a rattle; a record that shows an overlap fails QC. Tests:
   - Task 2: `effects.test.ts`, "never ticks two counters at once".
   - Task 3: `sound-motion.test.ts`, "record a second counter…", and `sound-qc.test.ts`, "fail two counters ticking at once…".
2. **A shot that replaces the storyboard visual, or reveals it late.** For example, a screenshot with a click, or a findings card, replaced by labels. Expected: no click, reveal, landing, or verdict sound for something never drawn. Test: Task 4, `cues-direction.test.ts`, "what the storyboard visual does".
3. **A count squeezed to 0.1 s at a scene's end, or stretched over many seconds.** Expected: a bounded train with ticks ≥ 0.06 s apart, at most 13 ticks, the last exactly on the count's end, and a single tick for a count shorter than the gap. Test: Task 1, `train.test.ts`, "keeps a long count to thirteen ticks…" and "plays a count shorter than the gap…".
4. **A merge stretched by B5 to end 0.15 s before the count that follows it.** Times are rounded to the millisecond, so 0.149 s can be left between them. Expected: the thump lands as the pieces meet, clear of the count, and both are heard. Test: Task 4, `cues-direction.test.ts`, "thump a stretched merge clear of the count that follows it".
5. **A sound-only re-render of a directed video** (`--no-sound-effects`, `--music none`, `--music compose`). Expected: the frames are reused and `video/timeline.json` stays byte for byte the same. Returning to the drafted sound gives byte-identical `audio.json` and `music.wav`. Test: Task 5, `tests/render/sound.test.ts`, "sounds the benchmark's motion…".

## File map

| File | Task | Responsibility |
|---|---|---|
| `packages/audio/src/sfx/train.ts` (create) | 1 | `TICK_GAP`, `TICK_STEPS`, `tickTimes`, `tickTrain` |
| `packages/audio/src/index.ts` | 1 | export them |
| `packages/audio/test/train.test.ts` (create) | 1 | tick times and train |
| `packages/video/test/ticks.test.ts` (create) | 1 | ticks follow B4's `countProgress` |
| `templates/music/sfx/{tick,thump,accent,camera}.yml` (create) | 2 | the four recipes |
| `templates/music/sound-effects.yml` | 2 | `softCutDb`, cue map entries |
| `packages/audio/src/effects.ts` | 2 | schema, cue kinds, `seconds`/`ticks`, ranks, levels, counters exclusive |
| `packages/audio/test/effects.test.ts`, `library.test.ts` | 2, 3 | placement, recipes, under-the-bed levels, engine version |
| `packages/video/src/timeline/types.ts` | 3 | `TimelineCue` kinds and `seconds` |
| `packages/video/src/sound.ts` | 3 | a count cue renders as a train |
| `packages/video/src/qc.ts` | 3 | `sound-effects` fails overlapping counters |
| `packages/audio/src/library.ts` | 3 | `AUDIO_ENGINE_VERSION = 'covi-audio-5'` |
| `packages/video/test/sound-motion.test.ts` (create), `sound-qc.test.ts` | 3 | the sound stage and QC |
| `tests/render/render.test.ts` | 3 | the engine pin |
| `packages/video/src/timeline/cues.ts` | 4 | `visualShownFrom`, `MERGE_MET`, `beatCues`, `buildCues` |
| `packages/video/test/cues-direction.test.ts` (create) | 4 | cue derivation |
| `tests/render/sound.test.ts` | 5 | benchmark render: motion sounds, sound-only re-renders |
| `/tmp/covi-a2/measure-mix.mjs` (scratch, not committed) | 6 | ffmpeg measurement |
| `docs/video.md`, `docs/artifacts.md`, `skills/covi-video/SKILL.md`, `skills/covi-video/references/music.md`, `skills/covi-video/references/direction.md`, `CHANGELOG.md` | 7 | documentation |

---

### Task 1: A counter's ticks — `tickTimes` and `tickTrain`

**Files:**
- Create: `packages/audio/src/sfx/train.ts`
- Modify: `packages/audio/src/index.ts` (after `export { renderSfx } from './sfx/recipes.ts';`)
- Create: `packages/audio/test/train.test.ts`
- Create: `packages/video/test/ticks.test.ts`

**Interfaces:**
- Consumes: `mixInto`, `peakAbs`, `stereo` (`packages/audio/src/dsp/fx.ts`); B4's `countProgress` (`packages/video/src/runtime/numbers.ts`), in the cross-package test only.
- Produces:
  ```ts
  // packages/audio/src/sfx/train.ts (exported from @covi/audio)
  export const TICK_GAP = 0.06;   // seconds between two ticks at least
  export const TICK_STEPS = 12;   // steps in a count at most (so ≤ 13 ticks)
  export function tickTimes(seconds: number): number[];  // offsets from the count's start; [0, …, seconds]
  export function tickTrain(tick: Float32Array[], seconds: number, sampleRate: number): Float32Array[];
  ```
  Tick k of N steps sounds at `seconds · (1 − ∛(1 − k/N))`, k = 0…N, where the counter's eased progress `1 − (1 − τ)³` reaches k/N. N is the largest value ≤ 12 whose first gap, the shortest, is ≥ 0.06 s. A count shorter than 0.06 s, or with no length, gives `[0]`. A 1.6 s count (B4's) gives 10 ticks, a 0.6 s count 4, and a 4 s count 13. The train is stereo and `round(lastTick · sr) + tick.length` samples long, and its peak never exceeds the tick's peak.

- [ ] **Step 1: Write the failing tests**

Create `packages/audio/test/train.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { peakAbs, stereo } from '../src/dsp/fx.ts';
import { TICK_GAP, TICK_STEPS, tickTimes, tickTrain } from '../src/sfx/train.ts';

const SR = 48_000;
/** Progress of an ease-out cubic count at `t` of `seconds`, as the video draws a counter. */
const progress = (t: number, seconds: number) => 1 - (1 - t / seconds) ** 3;

describe('tickTimes', () => {
  it('ticks at the start and at every equal step of the number, the last on the landing', () => {
    const times = tickTimes(1.6);
    expect(times).toHaveLength(10);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(1.6);
    for (const [k, t] of times.entries()) expect(progress(t, 1.6)).toBeCloseTo(k / 9, 9);
    expect(times[1]).toBeCloseTo(0.0616, 4);
    expect(times[8]).toBeCloseTo(0.8308, 4);
  });

  it('crowds the ticks as the count starts and spreads them as it lands', () => {
    const gaps = tickTimes(1.6).flatMap((t, k, all) => (k ? [t - all[k - 1]!] : []));
    for (let k = 1; k < gaps.length; k++) expect(gaps[k]!).toBeGreaterThan(gaps[k - 1]!);
    expect(gaps[0]!).toBeGreaterThanOrEqual(TICK_GAP - 1e-9);
  });

  it('keeps a long count to thirteen ticks and a short one to a few, never closer than the gap', () => {
    expect(TICK_STEPS).toBe(12);
    expect(tickTimes(4)).toHaveLength(13);
    expect(tickTimes(0.6)).toHaveLength(4);
    expect(tickTimes(0.1)).toEqual([0, 0.1]);
    for (const seconds of [0.06, 0.1, 0.35, 0.6, 1.6, 2.4, 4, 30]) {
      const times = tickTimes(seconds);
      expect(times.length, `${seconds}`).toBeLessThanOrEqual(TICK_STEPS + 1);
      expect(times.at(-1)).toBe(seconds);
      for (let k = 1; k < times.length; k++)
        expect(times[k]! - times[k - 1]!, `${seconds}`).toBeGreaterThanOrEqual(TICK_GAP - 1e-9);
    }
  });

  it('plays a count shorter than the gap, or one with no length, as a single tick', () => {
    expect(tickTimes(0.05)).toEqual([0]);
    expect(tickTimes(0)).toEqual([0]);
    expect(tickTimes(Number.NaN)).toEqual([0]);
  });
});

describe('tickTrain', () => {
  const tick = () => {
    const t = stereo(Math.round(0.05 * SR));
    for (let i = 0; i < t[0]!.length; i++) t[0]![i] = t[1]![i] = 0.7 * Math.exp(-i / 200);
    return t;
  };

  it('lays one tick at each tick time, as long as the count plus a tick', () => {
    const train = tickTrain(tick(), 1.6, SR);
    expect(train).toHaveLength(2);
    expect(train[0]!.length).toBe(Math.round(1.6 * SR) + Math.round(0.05 * SR));
    for (const t of tickTimes(1.6)) expect(train[0]![Math.round(t * SR)]).toBeCloseTo(0.7, 5);
    // Silence between the last two ticks, after the one before the landing has died away.
    expect(peakAbs([train[0]!.subarray(Math.round(0.95 * SR), Math.round(1.55 * SR))])).toBe(0);
  });

  it('never peaks above the tick, even when ticks overlap', () => {
    const long = stereo(Math.round(0.3 * SR)).map((c) => c.fill(0.5));
    const train = tickTrain(long, 1.6, SR);
    expect(peakAbs(train)).toBeCloseTo(0.5, 6);
  });

  it('is the same every time', () => {
    const a = tickTrain(tick(), 2.4, SR);
    const b = tickTrain(tick(), 2.4, SR);
    expect(Buffer.from(a[1]!.buffer).equals(Buffer.from(b[1]!.buffer))).toBe(true);
  });
});
```

Create `packages/video/test/ticks.test.ts`. It pins the audio package's copy of the ease to the counter the video draws (R-A2-5):

```ts
import { tickTimes } from '@covi/audio';
import { describe, expect, it } from 'vitest';
import { countProgress } from '../src/runtime/numbers.ts';

describe("a counter's ticks", () => {
  it('fall where the number drawn has taken each equal step of its count', () => {
    for (const seconds of [0.6, 1.6, 2.4, 4]) {
      const times = tickTimes(seconds);
      const steps = times.length - 1;
      for (const [k, t] of times.entries())
        expect(countProgress(5 + t, { t: 5, seconds }), `${seconds} s, tick ${k}`).toBeCloseTo(
          k / steps,
          9,
        );
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/audio/test/train.test.ts packages/video/test/ticks.test.ts`
Expected: FAIL. `../src/sfx/train.ts` does not exist, and `tickTimes` is not exported from `@covi/audio`.

- [ ] **Step 3: Implement**

Create `packages/audio/src/sfx/train.ts`:

```ts
/*
 * A counter's ticks: one tick for each equal step of its number, timed by the count's ease-out
 * (progress 1 − (1 − τ)³, as the video draws it), so they crowd as it starts and spread out as it
 * lands, the last on the landing. The train is one sound as long as the count: the effects place
 * or drop it whole, so density limits never thin out its ticks.
 */
import { mixInto, peakAbs, stereo } from '../dsp/fx.ts';

/** The fewest seconds between two ticks: closer, they blur into a buzz. */
export const TICK_GAP = 0.06;
/** At most this many steps in a count, so at most one more tick. */
export const TICK_STEPS = 12;

/** The share of a count's time at which its eased progress reaches `p`. */
const progressAt = (p: number) => 1 - Math.cbrt(1 - p);

/**
 * When a count's ticks sound, in seconds from its start: at 0 and wherever its number has come
 * k/N of the way, for the most steps N (up to `TICK_STEPS`) whose first gap, the shortest, is at
 * least `TICK_GAP`. A count shorter than that gap is one tick.
 */
export function tickTimes(seconds: number): number[] {
  if (!(seconds >= TICK_GAP)) return [0];
  let steps = TICK_STEPS;
  while (steps > 1 && seconds * progressAt(1 / steps) < TICK_GAP - 1e-12) steps--;
  return Array.from({ length: steps + 1 }, (_, k) =>
    k === steps ? seconds : seconds * progressAt(k / steps),
  );
}

/**
 * The ticks of a count `seconds` long, as one stereo sound: `tick` (a rendered recipe) at each of
 * `tickTimes`. A tick longer than the gap would stack where two meet, so the train never peaks
 * above the tick itself.
 */
export function tickTrain(
  tick: Float32Array[],
  seconds: number,
  sampleRate: number,
): Float32Array[] {
  const offsets = tickTimes(seconds).map((t) => Math.round(t * sampleRate));
  const out = stereo(offsets.at(-1)! + tick[0]!.length);
  for (const offset of offsets) mixInto(out, tick, offset);
  const ceiling = peakAbs(tick);
  const peak = peakAbs(out);
  if (ceiling > 0 && peak > ceiling)
    for (const c of out) for (let i = 0; i < c.length; i++) c[i]! *= ceiling / peak;
  return out;
}
```

In `packages/audio/src/index.ts`, after `export { renderSfx } from './sfx/recipes.ts';` add:

```ts
export { TICK_GAP, TICK_STEPS, tickTimes, tickTrain } from './sfx/train.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/audio/test/train.test.ts packages/video/test/ticks.test.ts`
Expected: PASS (8 tests).

Then run `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add packages/audio/src/sfx/train.ts packages/audio/src/index.ts packages/audio/test/train.test.ts packages/video/test/ticks.test.ts
git commit -m "$(cat <<'EOF'
Time a counter's ticks on its ease and render them as one train

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 2: Recipes for motion, and their place in the mix

**Files:**
- Create: `templates/music/sfx/tick.yml`, `templates/music/sfx/thump.yml`, `templates/music/sfx/accent.yml`, `templates/music/sfx/camera.yml`
- Modify: `templates/music/sound-effects.yml` (header comment, after `swellCutDb`, the spacing comment, `recipes`)
- Modify: `packages/audio/src/effects.ts` (imports, header comment, `SoundEffectsSchema`, `EffectCue`, `PlacedEffect`, `effectRecipe`, `placeEffects`)
- Modify: `packages/audio/test/effects.test.ts`, `packages/audio/test/library.test.ts`

**Interfaces:**
- Consumes: `tickTimes`, `tickTrain`, `TICK_GAP` (Task 1); `BED_DB`, `STEM_LUFS`, `momentaryLoudness`, `dbToGain`, `renderSfx` (A1).
- Produces:
  ```ts
  // packages/audio/src/effects.ts
  // SoundEffectsSchema gains: softCutDb: number (0–12); recipes gain camera, count, merge, appear.
  export interface EffectCue {
    t: number;
    kind: 'click' | 'reveal' | 'finding' | 'verdict' | 'outro' | 'transition' | 'riser' | 'hero'
      | 'camera' | 'count' | 'merge' | 'appear';
    scene: string;
    detail?: string;
    seconds?: number;   // a counter: how long it counts
  }
  export interface PlacedEffect { t; kind; recipe; gainDb; seconds?: number; ticks?: number }
  // effectRecipe priorities: appear 0.5, camera 0 (with transition and riser); count and merge 1.
  // placeEffects levels (BED_DB + gainDb + offset):
  //   camera −swellCutDb; count and appear −softCutDb; merge 0.
  // placeEffects: a count overlapping a placed count is dropped, reason 'while another counter ticks';
  //   a placed count carries seconds and ticks = tickTimes(seconds).length.
  ```
  Cue map (`sound-effects.yml` `recipes`): `camera: camera`, `count: tick`, `merge: thump`, `appear: accent`. `softCutDb: 4`.

- [ ] **Step 1: Write the failing tests**

In `packages/audio/test/effects.test.ts`:

1. In the `config` constant, add `softCutDb: 4,` after `swellCutDb: 4,`. In its `recipes`, after `hero: 'hero',`, add:

```ts
    camera: 'camera',
    count: 'tick',
    merge: 'thump',
    appear: 'accent',
```

2. After the `cue` helper, add:

```ts
/** A counter counting from `t` for `seconds`. */
const count = (t: number, seconds: number): EffectCue => ({ t, kind: 'count', scene: 's', seconds });
```

3. Append this `describe` at the end of the file:

```ts
describe('the sounds of a directed shot', () => {
  it('map the camera, a count, a merge, and an appearance to their recipes and ranks', () => {
    expect(effectRecipe(cue(1, 'camera', 'zoom'), config)).toEqual({
      recipe: 'camera',
      priority: 0,
    });
    expect(effectRecipe(count(1, 1.6), config)).toEqual({ recipe: 'tick', priority: 1 });
    expect(effectRecipe(cue(1, 'merge'), config)).toEqual({ recipe: 'thump', priority: 1 });
    expect(effectRecipe(cue(1, 'appear'), config)).toEqual({ recipe: 'accent', priority: 0.5 });
  });

  it('play the thump with the landings, ticks and accents softer, the camera as a swell', () => {
    const { placed, dropped } = placeEffects(
      [cue(1, 'camera'), count(2, 1.6), cue(4.5, 'merge'), cue(6, 'appear')],
      config,
    );
    expect(dropped).toEqual([]);
    expect(placed).toEqual([
      { t: 1, kind: 'camera', recipe: 'camera', gainDb: BED_DB - 3 },
      { t: 2, kind: 'count', recipe: 'tick', gainDb: BED_DB - 3, seconds: 1.6, ticks: 10 },
      { t: 4.5, kind: 'merge', recipe: 'thump', gainDb: BED_DB + 1 },
      { t: 6, kind: 'appear', recipe: 'accent', gainDb: BED_DB - 3 },
    ]);
  });

  it("count a counter's ticks as one effect, so a busy second never thins them out", () => {
    // Thirteen ticks in 2.4 s, then two clicks inside the count: three effects in the second.
    const { placed, dropped } = placeEffects(
      [count(1, 2.4), cue(1.4, 'click'), cue(1.8, 'click')],
      config,
    );
    expect(dropped).toEqual([]);
    expect(placed.map((p) => [p.kind, p.ticks])).toEqual([
      ['count', 13],
      ['click', undefined],
      ['click', undefined],
    ]);
  });

  it('never ticks two counters at once: the later count gives way', () => {
    const { placed, dropped } = placeEffects([count(2, 1.6), count(2.5, 1.6)], config);
    expect(placed.map((p) => p.t)).toEqual([2]);
    expect(dropped).toEqual([
      { t: 2.5, kind: 'count', recipe: 'tick', reason: 'while another counter ticks' },
    ]);
  });

  it('ticks a count-up and the count that follows it on the same counter', () => {
    const { placed, dropped } = placeEffects([count(0.5, 1.6), count(2.6, 1.6)], config);
    expect(dropped).toEqual([]);
    expect(placed.map((p) => [p.t, p.ticks])).toEqual([
      [0.5, 10],
      [2.6, 10],
    ]);
  });

  it('let an accent give way to a landing, and a camera whoosh to an accent', () => {
    const landing = placeEffects([cue(3, 'appear'), cue(3.05, 'merge')], config);
    expect(landing.placed.map((p) => p.kind)).toEqual(['merge']);
    expect(landing.dropped.map((d) => d.kind)).toEqual(['appear']);
    const swell = placeEffects([cue(3, 'camera'), cue(3.05, 'appear')], config);
    expect(swell.placed.map((p) => p.kind)).toEqual(['appear']);
    expect(swell.dropped.map((d) => d.kind)).toEqual(['camera']);
  });
});
```

In `packages/audio/test/library.test.ts`:

1. Imports: add `import { placeEffects } from '../src/effects.ts';` and `import { TICK_GAP, tickTrain } from '../src/sfx/train.ts';`. Replace `import { integratedLoudness } from '../src/loudness.ts';` with `import { dbToGain, integratedLoudness, momentaryLoudness } from '../src/loudness.ts';`. Add `import { STEM_LUFS } from '../src/mix.ts';` and `import { BED_DB } from '../src/placement.ts';`. Let `npx biome check --write` order them.

2. In "loads and validates every patch, kit, recipe, cue, and score":
   - Make the recipe list:

```ts
    expect([...library.recipes.keys()].sort()).toEqual([
      'accent',
      'camera',
      'click',
      'finding',
      'finding-high',
      'hero',
      'outro-looks-good',
      'outro-needs-attention',
      'outro-needs-changes',
      'reveal',
      'riser',
      'thump',
      'tick',
      'transition',
      'verdict-looks-good',
      'verdict-needs-attention',
      'verdict-needs-changes',
    ]);
```

   - In the `library.soundEffects` match, add `softCutDb: 4,` after `swellCutDb: 4,`, and add `recipes: { camera: 'camera', count: 'tick', merge: 'thump', appear: 'accent' },` after `maxPerSecond: 3,`. Keep `gainDb` at whatever A1 tuned it to.

3. Before the test `it('is a new engine: …'`, add:

```ts
  it('renders the sounds of motion: a tick short enough for its train, a thump on the tonic', () => {
    const sr = 48_000;
    const tick = library.recipes.get('tick')!;
    // Ticks of a train come at least TICK_GAP apart: a tick that long never smears into the next.
    expect(tick.duration).toBeLessThanOrEqual(TICK_GAP);
    expect(tick.anchor).toBe(0);
    expect(library.recipes.get('camera')!.anchor).toBeCloseTo(0.16, 9);
    const thump = library.recipes.get('thump')!;
    const low = { ...thump, layers: [thump.layers[0]!], fx: undefined };
    const pitch = (transpose: number) => {
      const c = renderSfx(low, library.patches, { sampleRate: sr, transpose })[0]!;
      const crossings: number[] = [];
      for (let i = Math.round(0.1 * sr); i < Math.round(0.24 * sr); i++)
        if (c[i - 1]! < 0 && c[i]! >= 0) crossings.push(i - 1 + c[i - 1]! / (c[i - 1]! - c[i]!));
      return ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0]!);
    };
    expect(pitch(0)).toBeCloseTo(65.41, 0); // C2
    expect(pitch(3)).toBeCloseTo(77.78, 0); // E♭2, in an E♭ render
  });

  it('keeps every sound of motion under the music bed: none is louder than it under speech', () => {
    const sr = 48_000;
    for (const cue of [
      { t: 1, kind: 'camera', scene: 's' },
      { t: 1, kind: 'merge', scene: 's' },
      { t: 1, kind: 'appear', scene: 's' },
      { t: 1, kind: 'count', scene: 's', seconds: 1.6 },
    ] as const) {
      const p = placeEffects([cue], library.soundEffects).placed[0]!;
      const one = renderSfx(library.recipes.get(p.recipe)!, library.patches, { sampleRate: sr });
      const sound = p.kind === 'count' ? tickTrain(one, p.seconds!, sr) : one;
      // Half a second of silence either side, so every 400 ms window that holds it is measured.
      const placed = sound.map((c) => {
        const out = new Float32Array(c.length + sr);
        for (let i = 0; i < c.length; i++) out[i + sr / 2] = c[i]! * dbToGain(p.gainDb);
        return out;
      });
      const loudest = Math.max(...momentaryLoudness(placed, sr));
      expect(loudest, cue.kind).toBeLessThanOrEqual(STEM_LUFS + BED_DB);
    }
  });
```

The existing "renders every effect recipe to a −3 dBFS peak, silent at both ends" test covers the four new recipes by itself.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/audio/test/effects.test.ts packages/audio/test/library.test.ts`
Expected: FAIL. The typecheck in the test fails because `softCutDb`, `camera`, and the other new keys are not in `SoundEffectsConfig`, and the library has no `tick`, `thump`, `accent`, or `camera` recipe.

- [ ] **Step 3: Write the recipes**

`templates/music/sfx/tick.yml`:

```yaml
# One tick of a counting number: a tiny wooden tap on the tonic over a dry click. Covi plays a train
# of them, one for each step of the count, so a tick is shorter than the closest two can be (0.06 s)
# and never smears. The tap is written in C, so it moves into the music's key; the click is in Hz.
id: tick
description: One tick of a counting number - a tiny wooden tap on the tonic.
license: original
duration: 0.05
layers:
  - gen: modal
    freq: C6
    partials:
      - { ratio: 1, gain: 1, decay: 0.018 }
      - { ratio: 3.93, gain: 0.25, decay: 0.007 }
    strike: { noise: 0.3, ms: 0.4 }
  - { gen: noise-sweep, color: white, filter: highpass, from: 6000, q: 0.7, env: { a: 0.0005, d: 0.003 }, gain: -16 }
```

`templates/music/sfx/thump.yml`:

```yaml
# Pieces merging into one: a round, low thump that settles on the tonic, a soft knock on the tonic
# above it, and a short, dark room. Lower and rounder than a finding's landing, never a hit: the
# voice is usually speaking over it. Written in C, so it moves into the music's key.
id: thump
description: Pieces merging into one - a round, low thump on the tonic with a soft knock.
license: original
duration: 0.45
layers:
  - { gen: tone, wave: sine, from: G2, to: C2, glide: 0.07, env: { a: 0.003, d: 0.24 } }
  - gen: modal
    freq: C4
    partials:
      - { ratio: 1, gain: 1, decay: 0.09 }
      - { ratio: 2.76, gain: 0.2, decay: 0.04 }
    strike: { noise: 0.15, ms: 1 }
    gain: -9
  - { gen: noise-sweep, color: pink, filter: lowpass, from: 1800, to: 300, q: 0.7, env: { a: 0.001, d: 0.07 }, gain: -16 }
fx:
  reverb: { size: 0.3, damp: 0.65, mix: 0.08, width: 1 }
```

`templates/music/sfx/accent.yml`:

```yaml
# Something appears in a shot: a light glass note on the fifth (G in C, which sits in any major or
# minor key) with a breath of air, and a little room. Softer than a click: a shot may reveal several
# things in a row.
id: accent
description: Soft accent for an element appearing - a light glass note on the fifth with a breath of air.
license: original
duration: 0.5
layers:
  - gen: notes
    notes:
      - { note: G5, at: 0, dur: 0.1, patch: glass-pluck, velocity: 0.5 }
  - { gen: noise-sweep, color: pink, filter: bandpass, from: 2500, to: 4500, q: 1, env: { a: 0.01, d: 0.06 }, gain: -18 }
fx:
  reverb: { size: 0.4, damp: 0.55, mix: 0.12, width: 1 }
```

`templates/music/sfx/camera.yml`:

```yaml
# The camera moves inside a scene (a zoom to an element, a pan, following what moves): a softer,
# narrower whoosh than a scene's transition, peaking 0.16 s in, its anchor, which lands mid-move.
# Sound design, written in Hz: it never transposes.
id: camera
description: Soft air move for the camera zooming, panning, or following inside a scene.
license: original
duration: 0.5
anchor: 0.16
layers:
  - { gen: noise-sweep, color: pink, filter: bandpass, from: 700, to: 1900, q: 1.3, env: { a: 0.16, d: 0.2 }, pan: [-0.25, 0.25] }
  - { gen: noise-sweep, color: white, filter: highpass, from: 3000, to: 5500, q: 0.7, env: { a: 0.14, d: 0.1 }, gain: -18, pan: [-0.4, 0.4] }
fx:
  reverb: { size: 0.35, damp: 0.6, mix: 0.08, width: 1 }
```

- [ ] **Step 4: The cue map**

In `templates/music/sound-effects.yml`, keep `gainDb` and every other value as A1 left them, and make three text changes and one addition.

Replace the header comment's first five lines with:

```yaml
# Which recipe plays for each on-screen event, and how loud. Effects follow only what the viewer
# sees: a pointer press, the before/after reveal, a finding card landing, the verdict, the outro
# card settling, a scene that pushes, wipes, or zooms through, or that the camera pans or zooms to,
# the hero (a riser into its moment and a hit on it), and a directed shot's motion: the camera
# moving inside a scene, a counter counting, pieces merging into one, and an element appearing. If
# an effect is noticeable, it is too loud. The outro's sign-off plays only without music: with
# music, the music's own sonic logo lands on that moment.
```

Replace the `swellCutDb` comment and line with:

```yaml
# Swells (a transition's whoosh, the camera's, the riser into the hero) are long sounds: they sit
# lower still.
swellCutDb: 4
# A counter's ticks come many to a second, and a shot may reveal several things in a row: the
# ticks and the accents sit lower too.
softCutDb: 4
```

Replace the comment above `minSpacing` with:

```yaml
# Seconds between two effects at least, and effects in any one second at most. When cues compete,
# the outro wins, then the verdict and the hero's hit, then a high-severity finding, then the rest,
# then the accents, and the swells last. The riser is exempt from the spacing (its onset is quiet),
# not the density. A counter's ticks are one effect, at the count's start; two never overlap.
```

At the end of `recipes`, after `hero: hero`, add:

```yaml
  camera: camera
  count: tick
  merge: thump
  appear: accent
```

- [ ] **Step 5: Placement (`packages/audio/src/effects.ts`)**

1. Imports: after `import { BED_DB } from './placement.ts';` add `import { tickTimes } from './sfx/train.ts';`.

2. Replace the header comment with:

```ts
/*
 * Sound effects follow only what happens on screen: a pointer click, the before/after reveal, a
 * finding card landing (heavier for high severity), the verdict appearing, the outro card
 * settling, a scene pushing, wiping, or zooming through (a whoosh), the hero (a riser into its
 * moment and a hit on it), and a directed shot's motion: the camera moving inside a scene (a softer
 * whoosh), a counter counting (a train of ticks), pieces merging into one (a thump), and an element
 * appearing (a soft accent). If an effect is noticeable, it is too loud: their levels are written
 * against the music bed (the same with any placement, or with no music), ticks, accents, and swells
 * lower still, and density limits keep a busy stretch from turning into a rattle; when effects
 * crowd, the swells give way first, then the accents. A counter's ticks are one effect, placed or
 * dropped whole, and two counters never tick at once. The outro's sign-off plays only when no music
 * does: with music, the music's own sonic logo lands on that moment.
 */
```

3. In `SoundEffectsSchema`, replace the `swellCutDb` doc comment and line with:

```ts
  /**
   * How far swells (a transition's whoosh, the camera's, the riser into the hero) sit under the
   * others (dB).
   */
  swellCutDb: z.number().min(0).max(12),
  /** How far the soft effects (a counter's ticks, an element's accent) sit under the others (dB). */
  softCutDb: z.number().min(0).max(12),
```

and in its `recipes`, after `hero: Recipe,` add:

```ts
    camera: Recipe,
    count: Recipe,
    merge: Recipe,
    appear: Recipe,
```

4. Replace `EffectCue` and `PlacedEffect` with:

```ts
/** A moment with a sound (the timeline's cues). */
export interface EffectCue {
  t: number;
  kind:
    | 'click'
    | 'reveal'
    | 'finding'
    | 'verdict'
    | 'outro'
    | 'transition'
    | 'riser'
    | 'hero'
    | 'camera'
    | 'count'
    | 'merge'
    | 'appear';
  scene: string;
  /** `high` for a high-severity finding; the verdict for a verdict or outro cue. */
  detail?: string;
  /** How long a counter counts (s): its ticks are one effect that long. */
  seconds?: number;
}

export interface PlacedEffect {
  t: number;
  kind: EffectCue['kind'];
  recipe: string;
  /** Level relative to the voice-normalized stems (dB): the bed's, plus the configured offsets. */
  gainDb: number;
  /** A counter: how long it counts (s), and how many ticks its train plays. */
  seconds?: number;
  ticks?: number;
}
```

5. In `effectRecipe`, replace the `transition`/`riser` case and everything after it up to the function's closing brace with:

```ts
    // An accent gives way to every landing, and a swell gives way to it.
    case 'appear':
      return { recipe: r.appear, priority: 0.5 };
    case 'transition':
    case 'riser':
    case 'camera':
      return { recipe: r[cue.kind], priority: 0 };
    default:
      return { recipe: r[cue.kind], priority: 1 };
  }
}

/** An effect's level against the bed's (dB): the verdict and the sign-off louder, the rest lower. */
function offsetDb(kind: EffectCue['kind'], config: SoundEffectsConfig): number {
  switch (kind) {
    case 'verdict':
      return config.verdictBoostDb;
    case 'outro':
      return config.outroBoostDb;
    case 'transition':
    case 'riser':
    case 'camera':
      return -config.swellCutDb;
    case 'count':
    case 'appear':
      return -config.softCutDb;
    default:
      return 0;
  }
}

/** Whether two counts overlap in time: their ticks would run together. */
const overlaps = (a: { t: number; seconds?: number }, b: { t: number; seconds?: number }) =>
  a.t < b.t + (b.seconds ?? 0) - 1e-9 && b.t < a.t + (a.seconds ?? 0) - 1e-9;
```

`count` and `merge` take the `default` branch, `r.count` and `r.merge` at rank 1.

6. Replace `placeEffects`'s doc comment with:

```ts
/**
 * Chooses which cues sound. The outro first, then the verdict and the hero's hit, then
 * high-severity findings, then the rest, then accents, and the swells last, each in time order; a
 * cue is dropped when it would come within `minSpacing` of a placed one or make any second hold
 * more than `maxPerSecond`. A riser is exempt from the spacing (its onset is quiet), not from the
 * density. A counter's ticks count as one effect at its start, and a count that would tick while a
 * placed one still does is dropped.
 */
```

In its loop, replace everything from `const times = [...kept, cue.t].sort((a, b) => a - b);` to the closing `});` of `placed.push(…)` with:

```ts
    const ticking =
      cue.kind === 'count' && placed.some((p) => p.kind === 'count' && overlaps(p, cue));
    const times = [...kept, cue.t].sort((a, b) => a - b);
    const max = config.maxPerSecond;
    const dense = times.some((t, i) => i >= max && t - times[i - max]! < 1 - 1e-9);
    if (crowded || ticking || dense) {
      dropped.push({
        t: cue.t,
        kind: cue.kind,
        recipe,
        reason: crowded
          ? `within ${config.minSpacing} s of a more important effect`
          : ticking
            ? 'while another counter ticks'
            : `more than ${max} per second`,
      });
      continue;
    }
    kept.push(cue.t);
    const seconds = cue.kind === 'count' ? Math.max(0, cue.seconds ?? 0) : undefined;
    placed.push({
      t: cue.t,
      kind: cue.kind,
      recipe,
      gainDb: BED_DB + config.gainDb + offsetDb(cue.kind, config),
      ...(seconds === undefined ? {} : { seconds, ticks: tickTimes(seconds).length }),
    });
```

The old inline level expression gave the verdict `verdictBoostDb`, the outro `outroBoostDb`, and the transition and riser `−swellCutDb`. `offsetDb` gives every existing kind exactly that, so A1's tests pass unchanged.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/audio`
Expected: PASS. That includes A1's effects tests unchanged, the six new placement tests, the thump settling on C2 and on E♭2, and all four motion sounds under the bed. On a scratch copy, the loudest momentary loudness at their placed gains was: thump −32.9, camera −33.4, accent −36.0, and a 1.6 s train −37.9 LUFS, against −31 for the bed under speech. A1's own effects measured click −41.1, finding −33.2, transition −32.2, and reveal −29.8.

If A1's Task 8 raised `gainDb` so that the thump measures above −31, lower only the thump's modal layer `gain` until it passes. Every recipe is rendered to the same −3 dBFS peak, which the low sine sets, so a quieter mid-range knock lowers the thump's loudness without changing its peak. Record that as a ruling.

Then run `npm run typecheck && npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add templates/music packages/audio/src/effects.ts packages/audio/test/effects.test.ts packages/audio/test/library.test.ts
git commit -m "$(cat <<'EOF'
Add tick, thump, accent, and camera recipes and place them under the bed

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 3: The sound stage plays motion — cue kinds, tick trains in the mix, QC, engine version

**Files:**
- Modify: `packages/video/src/timeline/types.ts` (`TimelineCue` and its doc comment)
- Modify: `packages/video/src/sound.ts` (the `@covi/audio` import; the effects loop in `produceSound`)
- Modify: `packages/video/src/qc.ts` (the `sound-effects` block of `soundChecks`)
- Modify: `packages/audio/src/library.ts` (`AUDIO_ENGINE_VERSION`)
- Modify: `packages/audio/test/library.test.ts` (the engine test), `tests/render/render.test.ts` (the `audio.engine` pin, `expect(audio.engine).toBe('covi-audio-4');`)
- Create: `packages/video/test/sound-motion.test.ts`
- Modify: `packages/video/test/sound-qc.test.ts`

**Interfaces:**
- Consumes: `tickTrain`, `tickTimes` (Task 1); `PlacedEffect.seconds`/`.ticks`, the cue kinds and their recipes (Task 2).
- Produces:
  ```ts
  // packages/video/src/timeline/types.ts
  export interface TimelineCue {
    t: number;
    kind: 'click' | 'reveal' | 'finding' | 'verdict' | 'outro' | 'transition' | 'riser' | 'hero'
      | 'camera' | 'count' | 'merge' | 'appear';
    scene: string;
    detail?: string;   // also: the camera's move for a camera cue
    seconds?: number;  // a count: how long it counts
  }
  // packages/audio/src/library.ts
  export const AUDIO_ENGINE_VERSION = 'covi-audio-5';
  // video/audio.json: effects.placed entries for a count carry `seconds` and `ticks`.
  // qc.json `sound-effects`: fail with message 'Two counters tick at once.' when two placed counts overlap.
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/sound-motion.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav, tickTimes } from '@covi/audio';
import { DEFAULT_CONFIG, Redactor, Run, silentLogger } from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIO_PATHS, type AudioRecord, produceSound } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Timeline, TimelineCue } from '../src/timeline/types.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SR = 48_000;
const cue = (t: number, kind: TimelineCue['kind'], extra: Partial<TimelineCue> = {}) =>
  ({ t, kind, scene: 's1', ...extra }) as TimelineCue;

/** Effects alone (no voice, no music), so the master is the effects as placed, only limited. */
async function effectsOnly(cues: TimelineCue[]) {
  const root = mkdtempSync(join(tmpdir(), 'covi-motion-'));
  roots.push(root);
  const run = await Run.create({
    root,
    workflow: 'video',
    entryPoint: 'cli',
    interactive: false,
    coviVersion: '0.0.0-test',
    redactor: new Redactor({}),
  });
  mkdirSync(run.path('video'), { recursive: true });
  const timeline = {
    duration: 8,
    scenes: [
      {
        id: 's1',
        beat: 'proof',
        eyebrow: 'Proof',
        start: 0,
        end: 8,
        visual: { kind: 'callout', tone: 'info', title: 'x' },
        expression: 'explaining',
        narrator: true,
      },
    ],
    cues,
  } as unknown as Timeline;
  const result = await produceSound(
    {
      run,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      timeline,
      storyboard: { template: 'quick-review' },
      speech: [],
      cacheDir: join(root, '.covi', 'cache'),
      logger: silentLogger,
    },
    { source: 'none', reason: 'Music is off.' },
  );
  return { run, result };
}

/** Peak of a stretch of a channel. */
function peak(c: Float32Array, from: number, to: number): number {
  let p = 0;
  for (let i = Math.round(from * SR); i < Math.round(to * SR); i++)
    p = Math.max(p, Math.abs(c[i]!));
  return p;
}

describe('the sounds of motion', () => {
  it("play a counter as one train of ticks, each where the count's number steps", async () => {
    const { run, result } = await effectsOnly([cue(2, 'count', { seconds: 1.6 })]);
    expect(result.record.effects.placed).toEqual([
      expect.objectContaining({ t: 2, kind: 'count', recipe: 'tick', seconds: 1.6, ticks: 10 }),
    ]);
    const master = readWav(result.master!).channels[0]!;
    const times = tickTimes(1.6).map((t) => 2 + t);
    const loudest = peak(master, 0, 8);
    for (const t of times)
      expect(peak(master, t, t + 0.02), `tick at ${t}`).toBeGreaterThan(loudest / 4);
    // Between the last two ticks, after the one before has died away, nothing plays.
    expect(peak(master, times.at(-2)! + 0.1, times.at(-1)! - 0.01)).toBeLessThan(loudest / 1000);
    const written = JSON.parse(readFileSync(run.path(AUDIO_PATHS.record), 'utf8')) as AudioRecord;
    expect(written.effects.placed[0]).toMatchObject({ seconds: 1.6, ticks: 10 });
  });

  it('play the camera, a merge, and an appearance with their own recipes', async () => {
    const { result } = await effectsOnly([
      cue(1, 'camera', { detail: 'zoom' }),
      cue(3, 'merge'),
      cue(5, 'appear'),
    ]);
    expect(result.record.effects.placed.map((p) => [p.kind, p.recipe])).toEqual([
      ['camera', 'camera'],
      ['merge', 'thump'],
      ['appear', 'accent'],
    ]);
    expect(result.record.engine).toBe('covi-audio-5');
  });

  it('record a second counter that would tick over the first as dropped, with the reason', async () => {
    const { result } = await effectsOnly([
      cue(2, 'count', { seconds: 1.6 }),
      cue(2.5, 'count', { seconds: 1.6 }),
    ]);
    expect(result.record.effects.placed.map((p) => p.t)).toEqual([2]);
    expect(result.record.effects.dropped).toEqual([
      expect.objectContaining({ t: 2.5, kind: 'count', reason: 'while another counter ticks' }),
    ]);
  });
});
```

In `packages/video/test/sound-qc.test.ts`, inside `describe('sound checks', …)`, add before `it('fail effects that crowd each other, and grade their level under the voice', …)`:

```ts
  it('fail two counters ticking at once, and pass one that counts after another', () => {
    const counts = (spans: Array<[number, number]>) =>
      byId(
        soundChecks(
          record({
            effects: {
              enabled: true,
              placed: spans.map(([t, seconds]) => ({
                t,
                kind: 'count' as const,
                recipe: 'tick',
                gainDb: -18,
                seconds,
                ticks: 10,
              })),
              dropped: [],
            },
          }),
          LIMITS,
        ),
      )['sound-effects']!;
    expect(
      counts([
        [2, 1.6],
        [3, 1.6],
      ]),
    ).toMatchObject({ status: 'fail', message: 'Two counters tick at once.' });
    expect(
      counts([
        [0.5, 1.6],
        [2.6, 1.6],
      ]).status,
    ).toBe('pass');
  });
```

In `packages/audio/test/library.test.ts`, replace the engine test with:

```ts
  it('is a new engine: effects follow the motion of directed shots', () => {
    expect(AUDIO_ENGINE_VERSION).toBe('covi-audio-5');
  });
```

In `tests/render/render.test.ts`, change `expect(audio.engine).toBe('covi-audio-4');` to `expect(audio.engine).toBe('covi-audio-5');`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/sound-motion.test.ts packages/video/test/sound-qc.test.ts packages/audio/test/library.test.ts`
Expected: FAIL. `TimelineCue` has no `count` kind (typecheck), a count plays one tick, not a train, so the tick-at-each-time assertion fails, the engine is still `covi-audio-4`, and QC passes overlapping counters.

- [ ] **Step 3: Implement**

`packages/video/src/timeline/types.ts`: replace `TimelineCue` and its doc comment with:

```ts
/**
 * A moment with a sound: a click, the before/after reveal, a finding card landing, the verdict,
 * a scene moving in, the hero (its riser and its hit), or a directed shot's motion (the camera
 * moving inside the scene, a counter counting, pieces merging, an element appearing). Timing comes
 * from `timeline/cues.ts`, which the runtime draws with too. Cues exist whether or not sound
 * effects are on, so nothing in the timeline depends on the sound choices.
 */
export interface TimelineCue {
  /** Seconds from the start of the video (a riser's is where it starts to swell). */
  t: number;
  /**
   * `outro`: the outro card settles, where the music's sonic logo lands. `camera`: the camera moves
   * inside a scene's stop (`t` mid-move). `count`: a counter counts (`t` its start, for `seconds`).
   * `merge`: merging pieces become one. `appear`: a shot's element appears.
   */
  kind:
    | 'click'
    | 'reveal'
    | 'finding'
    | 'verdict'
    | 'outro'
    | 'transition'
    | 'riser'
    | 'hero'
    | 'camera'
    | 'count'
    | 'merge'
    | 'appear';
  /** The scene id. */
  scene: string;
  /**
   * `high` for a high-severity finding; the verdict for a verdict or outro cue; the transition's
   * kind for a whoosh; the camera's move for a camera cue.
   */
  detail?: string;
  /** How long a counter counts (s): its ticks follow the count's ease over this time. */
  seconds?: number;
}
```

`packages/video/src/sound.ts`: add `tickTrain,` to the `@covi/audio` import list, after `scheduleArrangement,`. In `produceSound`'s effects loop (`for (const p of placed.placed) { … }`), between the `if (!audio) { … }` block and the line `// A sting starts early enough that its landing meets the cue.`, insert:

```ts
      // A counter's recipe plays as a train of ticks spaced like its numbers, as long as it counts.
      if (p.kind === 'count') audio = tickTrain(audio, p.seconds ?? 0, SAMPLE_RATE);
```

`renders` still caches the single tick, so every train is built from the same rendered tick. `effects.placed` is written with `seconds` and `ticks` as placement set them.

`packages/video/src/qc.ts`: in the `sound-effects` block of `soundChecks`, after the line `const dense = times.some((t, i) => i >= max && t - times[i - max]! < 1 - 1e-6);`, add:

```ts
    // A counter's ticks are one effect as long as its count: two counts must not overlap.
    const counts = effects.placed.filter((p) => p.kind === 'count').sort((a, b) => a.t - b.t);
    const ticking = counts.some(
      (p, i) => i > 0 && p.t < counts[i - 1]!.t + (counts[i - 1]!.seconds ?? 0) - 1e-6,
    );
```

Change `const status = crowded || dense ? 'fail' : quiet;` to `const status = crowded || dense || ticking ? 'fail' : quiet;`. Replace the `checks.push({ id: 'sound-effects', status, message: … })` call that follows with this one. Its last template literal is A1's, unchanged; only the `ticking` branch is new:

```ts
    checks.push({
      id: 'sound-effects',
      status,
      message: crowded
        ? `Two effects are closer than ${limits.minSpacing} s.`
        : dense
          ? `More than ${max} effects play within one second.`
          : ticking
            ? 'Two counters tick at once.'
            : `${effects.placed.length} effect(s) placed, ${effects.dropped.length - logo} dropped to keep them apart${logo ? "; the music's sonic logo marks the outro" : ''}${level === undefined ? '' : `; their peaks sit ${level.toFixed(2)} dB under the voice's (at least ${EFFECTS_UNDER_VOICE_DB} wanted)`}.`,
    });
```

If A1's merged message differs from this last literal, keep A1's literal and add only the `ticking` branch.

`packages/audio/src/library.ts`: `export const AUDIO_ENGINE_VERSION = 'covi-audio-5';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/sound-motion.test.ts packages/video/test/sound-qc.test.ts packages/video/test/sound-levels.test.ts packages/video/test/sound-failure.test.ts packages/audio`
Expected: PASS.

Then run `npm run typecheck && npm run lint`, and `npm test` (foreground, 600000 ms). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/timeline/types.ts packages/video/src/sound.ts packages/video/src/qc.ts packages/audio/src/library.ts packages/audio/test/library.test.ts packages/video/test/sound-motion.test.ts packages/video/test/sound-qc.test.ts tests/render/render.test.ts
git commit -m "$(cat <<'EOF'
Play a counter's ticks as one train, and check that two never overlap

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 4: Direction events become cues

**Files:**
- Modify: `packages/video/src/timeline/cues.ts`:
  - imports: add `type DirectionBeat`
  - new code before `buildCues`'s doc comment: `visualShownFrom`, `CameraBeat`, `MERGE_MET`, `beatCues`
  - `buildCues` and its doc comment, replaced
- Create: `packages/video/test/cues-direction.test.ts`

**Interfaces:**
- Consumes: B2's `TimelineScene.stop`/`.direction`, `DirectionElement`, `DirectionBeat` (with B3–B5's verbs), `SceneDirection`, `SceneStaging`, `buildTimeline({ entrances, staging })`, `layoutScenes(…, entrances)`, `WHOOSH` (with `pan`/`zoom`); Task 3's `TimelineCue`; `placeEffects` (Task 2) and `musicLibrary()` (`sound.ts`) in one test.
- Produces:
  ```ts
  // packages/video/src/timeline/cues.ts
  export function visualShownFrom(scene: Pick<TimelineScene, 'direction'>): number | undefined;
  export const MERGE_MET = 0.9;
  export function beatCues(scene: Pick<TimelineScene, 'id' | 'start' | 'stop' | 'direction'>): TimelineCue[];
  export function buildCues(scenes: readonly TimelineScene[]): TimelineCue[];   // same signature
  ```
  Each beat's sound:

  | Beat | Cue | When (video time) |
  |---|---|---|
  | `camera` | `{ kind: 'camera', detail: move }` | `scene.start + t + seconds / 2` (mid-move). Only when the scene has a `stop` and `to` names an element of the shot. None when it repeats the previous such camera beat's `move`, `to`, and `zoom`. None when the riser into the hero carries it (between the riser's start and the hit). |
  | `count`, `count-up` | `{ kind: 'count', seconds }` | `scene.start + t` |
  | `merge` | `{ kind: 'merge' }` | `scene.start + t + MERGE_MET · seconds` |
  | `reveal` | `{ kind: 'appear' }` | `scene.start + t` |
  | `morph`, `flow`, `split`, `stack`, any other | none | |

  The storyboard visual's own cues (click, before/after reveal, finding, verdict, outro) are kept only from `visualShownFrom(scene)` on:
  - without direction: 0
  - a shot with a `visual` element: 0, or its reveal's `t`
  - a shot without a `visual` element: `undefined`, so none of them sound

  The hero's riser and hit, entrance whooshes, and the storyboard's own `cues` are unchanged.

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/cues-direction.test.ts`. The elements are hand-built: B2's `visual` and `label`. A label stands in for the element each beat names, because `buildCues` reads only element ids and the `visual` kind. If B2's merged `label` or `visual` element types differ, adapt the two helpers.

```ts
import { placeEffects } from '@covi/audio';
import { DEFAULT_CONFIG } from '@covi/core';
import { describe, expect, it } from 'vitest';
import { musicLibrary } from '../src/sound.ts';
import { resolveVideoSpec, type VideoSpec } from '../src/spec.ts';
import type { Scene } from '../src/storyboard/schema.ts';
import { buildTimeline, layoutScenes, pacingFor } from '../src/timeline/build.ts';
import { beatCues, buildCues, MERGE_MET, visualShownFrom } from '../src/timeline/cues.ts';
import type {
  DirectionBeat,
  DirectionElement,
  SceneDirection,
  SceneStaging,
  TimelineCue,
  TimelineScene,
  TimelineVisual,
} from '../src/timeline/types.ts';

const R = { x: 0, y: 0, width: 400, height: 200 };
const visual: DirectionElement = { id: 'visual', kind: 'visual', rect: R };
const label = (id: string): DirectionElement => ({
  id,
  kind: 'label',
  rect: R,
  text: id,
  tone: 'neutral',
});
const callout: TimelineVisual = { kind: 'callout', tone: 'info', title: 'x' };

function scene(
  id: string,
  start: number,
  end: number,
  extra: Partial<TimelineScene> = {},
): TimelineScene {
  return {
    id,
    beat: id,
    eyebrow: id,
    start,
    end,
    visual: callout,
    expression: 'explaining',
    narrator: true,
    ...extra,
  };
}

/** A scene on the canvas at its stop, directed with these elements and beats. */
const directed = (
  start: number,
  elements: DirectionElement[],
  beats: DirectionBeat[],
  extra: Partial<TimelineScene> = {},
) =>
  scene('d', start, start + 10, {
    stop: { x: 0, y: 0 },
    direction: { whole: false, elements, beats },
    ...extra,
  });

const sounds = (cues: TimelineCue[]) =>
  cues.map((c) => [c.kind, +c.t.toFixed(6), ...(c.seconds === undefined ? [] : [c.seconds])]);

describe('the sounds of a directed scene', () => {
  it('whoosh mid-move for the camera, tick through a count, thump on a merge, accent a reveal', () => {
    const cues = beatCues(
      directed(
        10,
        [visual, label('bytes'), label('req')],
        [
          { verb: 'reveal', element: 'bytes', style: 'pop', t: 1, seconds: 0.5 },
          { verb: 'camera', move: 'zoom', to: 'bytes', t: 2, seconds: 0.8 },
          { verb: 'count', element: 'bytes', t: 3, seconds: 1.6 },
          { verb: 'merge', element: 'req', t: 5, seconds: 2.4 },
          { verb: 'count-up', element: 'bytes', value: 28, t: 8, seconds: 1.6 },
        ],
      ),
    );
    expect(sounds(cues)).toEqual([
      ['appear', 11],
      ['camera', 12.4],
      ['count', 13, 1.6],
      // A merge stretched toward the next beat thumps as its pieces meet, 90% of the way in.
      ['merge', 17.16],
      ['count', 18, 1.6],
    ]);
    expect(cues.find((c) => c.kind === 'camera')).toMatchObject({ scene: 'd', detail: 'zoom' });
    expect(MERGE_MET).toBe(0.9);
  });

  it('make no sound of their own for a morph, a flow, a split, or a stack', () => {
    const cues = beatCues(
      directed(
        0,
        [label('a'), label('b')],
        [
          { verb: 'morph', element: 'a', t: 1, seconds: 1.6 },
          { verb: 'flow', from: 'a', to: 'b', t: 3, seconds: 1.2 },
          {
            verb: 'split',
            element: 'a',
            count: 4,
            name: 'chunks',
            side: 'base',
            t: 5,
            seconds: 0.9,
          },
          { verb: 'stack', element: 'b', t: 7, seconds: 1.8 },
        ],
      ),
    );
    expect(cues).toEqual([]);
  });

  it('keep the camera silent when it does not move: off the canvas, at no element, or already there', () => {
    const zoom = (t: number, to = 'a', zoom?: number): DirectionBeat => ({
      verb: 'camera',
      move: 'zoom',
      to,
      ...(zoom === undefined ? {} : { zoom }),
      t,
      seconds: 0.8,
    });
    const shot = directed(
      0,
      [label('a'), label('b')],
      [zoom(1), zoom(2), zoom(3, 'a', 1.5), zoom(4, 'ghost'), zoom(5, 'b'), zoom(6)],
    );
    // The second beat repeats the first; the one at no element is skipped, as the stage skips it.
    expect(sounds(beatCues(shot))).toEqual([
      ['camera', 1.4],
      ['camera', 3.4],
      ['camera', 5.4],
      ['camera', 6.4],
    ]);
    const { stop: _, ...offCanvas } = shot;
    expect(beatCues(offCanvas)).toEqual([]);
  });

  it('thump a stretched merge clear of the count that follows it, so both are heard', () => {
    // B5 stretches a merge until 0.15 s before the next beat (here a count landing on its phrase);
    // times rounded to the millisecond can leave 0.149 s, inside the spacing the effects keep.
    const cues = beatCues(
      directed(
        0,
        [label('req'), label('bytes')],
        [
          { verb: 'merge', element: 'req', t: 1, seconds: 2.4 },
          { verb: 'count', element: 'bytes', t: 3.549, seconds: 1.6 },
        ],
      ),
    );
    const { placed, dropped } = placeEffects(cues, musicLibrary().soundEffects);
    expect(dropped).toEqual([]);
    expect(placed.map((p) => p.kind)).toEqual(['merge', 'count']);
  });

  it('let the riser carry a camera move into the hero, as it carries the entrance', () => {
    const hero = directed(
      0,
      [label('a')],
      [
        { verb: 'camera', move: 'zoom', to: 'a', t: 2.5, seconds: 0.8 },
        { verb: 'camera', move: 'pan', to: 'a', t: 5, seconds: 0.8 },
      ],
      { hero: true, phases: { hero: 3.5 } },
    );
    expect(sounds(buildCues([hero]))).toEqual([
      ['riser', 2.7],
      ['hero', 3.5],
      ['camera', 5.4],
    ]);
  });
});

describe('what the storyboard visual does', () => {
  const findings: TimelineVisual = {
    kind: 'findings',
    findings: [{ title: 'F', certainty: 'likely', severity: 'high' }],
  };
  const shot = (direction: SceneDirection) =>
    scene('f', 0, 6, { visual: findings, stop: { x: 0, y: 0 }, direction });

  it('sounds while the shot shows it, and not when the shot leaves it out', () => {
    const kinds = (s: TimelineScene) => buildCues([s]).map((c) => c.kind);
    expect(kinds(scene('f', 0, 6, { visual: findings }))).toEqual(['finding']);
    expect(kinds(shot({ whole: true, elements: [visual], beats: [] }))).toEqual(['finding']);
    expect(visualShownFrom(shot({ whole: false, elements: [label('note')], beats: [] }))).toBe(
      undefined,
    );
    expect(kinds(shot({ whole: false, elements: [label('note')], beats: [] }))).toEqual([]);
  });

  it('keeps only what happens after the shot reveals it', () => {
    const late = (t: number) =>
      shot({
        whole: false,
        elements: [visual, label('note')],
        beats: [{ verb: 'reveal', element: 'visual', style: 'rise', t, seconds: 0.5 }],
      });
    // The card lands 0.45 s in: revealed at 0.2 s it is heard, revealed at 2 s it is not.
    expect(buildCues([late(0.2)]).map((c) => c.kind)).toEqual(['appear', 'finding']);
    expect(buildCues([late(2)]).map((c) => c.kind)).toEqual(['appear']);
    expect(visualShownFrom(late(2))).toBe(2);
  });
});

describe('a directed timeline', () => {
  it('never depends on the music or the effects', () => {
    const board = ['s1', 's2'].map(
      (id) => ({ id, beat: id, narration: 'A short line here.', visual: callout }) as Scene,
    );
    const staging: SceneStaging[] = [
      {
        stop: { x: 0, y: 0 },
        direction: {
          whole: false,
          elements: [visual, label('bytes')],
          beats: [
            { verb: 'reveal', element: 'bytes', style: 'pop', t: 0.4, seconds: 0.5 },
            { verb: 'count', element: 'bytes', t: 1, seconds: 1.6 },
          ],
        },
      },
      {
        stop: { x: 2400, y: 0 },
        direction: {
          whole: false,
          elements: [label('req')],
          beats: [
            { verb: 'camera', move: 'zoom', to: 'req', t: 0.3, seconds: 0.8 },
            { verb: 'merge', element: 'req', t: 1.2, seconds: 0.8 },
          ],
        },
      },
    ];
    const entrances = new Map([['s2', 'pan' as const]]);
    const build = (spec: VideoSpec) =>
      buildTimeline({
        title: 'T',
        scenes: board,
        layout: layoutScenes(board, new Map(), new Map(), 'en', pacingFor(spec), entrances),
        spec,
        image: () => ({ src: 'a.png', width: 1, height: 1 }),
        entrances,
        staging,
      });
    const spec = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' });
    const loud = build(spec);
    for (const quiet of [
      { ...spec, soundEffects: false },
      { ...spec, music: { ...spec.music, use: 'none' as const } },
      { ...spec, music: { ...spec.music, use: 'compose' as const } },
    ])
      expect(build(quiet)).toEqual(loud);
    expect(loud.cues.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['appear', 'count', 'transition', 'camera', 'merge']),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/video/test/cues-direction.test.ts`
Expected: FAIL. `beatCues`, `visualShownFrom`, and `MERGE_MET` are not exported, and a directed timeline has no `appear`, `count`, `camera`, or `merge` cue.

- [ ] **Step 3: Implement (`packages/video/src/timeline/cues.ts`)**

1. Add `type DirectionBeat,` to the `./types.ts` import (alphabetically after `type CodeLine,`).

2. Immediately before the doc comment of `buildCues` (`/**\n * Every moment with a sound, in time order. …`), insert:

```ts
/**
 * From when a scene's storyboard visual is on screen, in seconds since the scene started: from
 * the start without direction or when its shot shows it from the start, from its reveal when the
 * shot reveals it later; undefined when the shot leaves it out.
 */
export function visualShownFrom(scene: Pick<TimelineScene, 'direction'>): number | undefined {
  const d = scene.direction;
  if (!d) return 0;
  const visual = d.elements.find((e) => e.kind === 'visual');
  if (!visual) return undefined;
  const reveal = d.beats.find((b) => b.verb === 'reveal' && b.element === visual.id);
  return reveal?.t ?? 0;
}

type CameraBeat = Extract<DirectionBeat, { verb: 'camera' }>;

/**
 * How far into a merge its pieces have met: they ease in and out, so by then they are within half
 * a percent of one, and the thump lands clear of the beat that follows (a stretched merge ends
 * 0.15 s before it).
 */
export const MERGE_MET = 0.9;

/**
 * The moments a directed scene's beats sound, in seconds from the start of the video: a soft
 * whoosh mid-way through each camera move inside the scene's stop, a counter's ticks (one cue that
 * lasts the count, from `count` and `count-up` alike), a thump as merging pieces meet, and a soft
 * accent as an element starts to appear. The camera moves as the stage moves it: only on the
 * canvas, toward an element the shot has; a beat that repeats the move before it (the same move,
 * target, and zoom) leaves the camera where it is, so it makes no sound. Morphs, flows, splits,
 * and stacks make none of their own.
 */
export function beatCues(
  scene: Pick<TimelineScene, 'id' | 'start' | 'stop' | 'direction'>,
): TimelineCue[] {
  const d = scene.direction;
  if (!d) return [];
  const cues: TimelineCue[] = [];
  let last: CameraBeat | undefined;
  for (const beat of d.beats) {
    const t = scene.start + beat.t;
    switch (beat.verb) {
      case 'camera': {
        if (!scene.stop || !d.elements.some((e) => e.id === beat.to)) break;
        const still = last?.move === beat.move && last.to === beat.to && last.zoom === beat.zoom;
        last = beat;
        if (!still)
          cues.push({
            t: t + beat.seconds / 2,
            kind: 'camera',
            scene: scene.id,
            detail: beat.move,
          });
        break;
      }
      case 'count':
      case 'count-up':
        cues.push({ t, kind: 'count', scene: scene.id, seconds: beat.seconds });
        break;
      case 'merge':
        cues.push({ t: t + MERGE_MET * beat.seconds, kind: 'merge', scene: scene.id });
        break;
      case 'reveal':
        cues.push({ t, kind: 'appear', scene: scene.id });
        break;
      default:
        break;
    }
  }
  return cues;
}
```

3. Replace `buildCues` and its doc comment with the text below. B2 changed only `WHOOSH` and this doc comment, and no B3–B7 plan touches `buildCues`. If the merged function has any other change, carry it into this text and record a ruling.

```ts
/**
 * Every moment with a sound, in time order. A whoosh plays mid-move for a scene that pushes,
 * wipes, or zooms through, or that the camera pans or zooms to (unless the riser into the hero
 * carries that move); the hero's hit lands at its phase, the riser swelling into it from 0.8 s
 * before (left out before the video starts); a directed scene's beats sound as `beatCues` says (a
 * camera move the riser carries makes none); and a scene's own cues play where they ask (a riser
 * ends there; one past the scene's end is not played, and one repeating Covi's is merged). What
 * the storyboard visual does sounds only while it is on screen: a shot that leaves it out takes
 * its sounds with it. Fades, cuts, code, and terminals make no sound. The outro's moment is where
 * the music's logo lands, or, without music, its own sign-off.
 */
export function buildCues(scenes: readonly TimelineScene[]): TimelineCue[] {
  const cues: TimelineCue[] = [];
  for (const scene of scenes) {
    const v = scene.visual;
    const duration = scene.end - scene.start;
    const phases = scene.phases ?? {};
    const at = (t: number) => scene.start + t;
    const own: TimelineCue[] = [];
    switch (v.kind) {
      case 'screenshot':
        if (v.click)
          own.push({
            t: at(
              (v.marks?.length
                ? screenshotMarks(duration, v.marks, phases)
                : screenshotTiming(duration, phases)
              ).press[0],
            ),
            kind: 'click',
            scene: scene.id,
          });
        break;
      case 'interaction':
        interactionTiming(
          duration,
          v.steps.length,
          phases,
          v.steps.map((s) => s.marks),
        ).forEach((step, i) => {
          if (v.steps[i]!.click) own.push({ t: at(step.press[0]), kind: 'click', scene: scene.id });
        });
        break;
      case 'before-after':
        own.push({
          t: at(beforeAfterTiming(v.layout, duration, phases).reveal[0]),
          kind: 'reveal',
          scene: scene.id,
        });
        break;
      case 'findings':
        v.findings.forEach((f, i) => {
          own.push({
            t: at(findingLanding(i, phases)),
            kind: 'finding',
            scene: scene.id,
            ...(f.severity === 'high' ? { detail: 'high' } : {}),
          });
        });
        break;
      case 'summary':
        own.push({
          t: at(verdictEntrance()[0]),
          kind: 'verdict',
          scene: scene.id,
          detail: v.verdict,
        });
        break;
      case 'outro':
        own.push({
          t: at(outroSettle()),
          kind: 'outro',
          scene: scene.id,
          ...(v.verdict ? { detail: v.verdict } : {}),
        });
        break;
      default:
        break;
    }
    // What the visual does is heard only once it is on screen.
    const shown = visualShownFrom(scene);
    if (shown !== undefined) cues.push(...own.filter((c) => c.t >= at(shown) - 1e-9));
    // The hero: a riser swells into its phase, where the hit lands with the accent.
    const hero = scene.hero ? phaseAt(phases, HERO_PHASE) : undefined;
    const hit = hero === undefined ? undefined : at(hero);
    const riser = hit === undefined ? undefined : hit - RISER_LEAD;
    const rises = riser !== undefined && riser >= 0;
    const carried = (t: number) => rises && hit !== undefined && t >= riser && t <= hit;
    if (hit !== undefined) {
      cues.push({ t: hit, kind: 'hero', scene: scene.id });
      if (rises) cues.push({ t: riser, kind: 'riser', scene: scene.id });
    }
    // A scene that moves in gets a whoosh mid-move, unless the riser already carries the move.
    const move = scene.transition;
    if (move && WHOOSH.has(move.kind)) {
      const t = scene.start + move.seconds / 2;
      if (!carried(t)) cues.push({ t, kind: 'transition', scene: scene.id, detail: move.kind });
    }
    // A directed scene's beats; the riser carries a camera move inside it too.
    for (const cue of beatCues(scene)) if (cue.kind !== 'camera' || !carried(cue.t)) cues.push(cue);
    // The storyboard's own cues: a riser ends at its moment.
    for (const cue of scene.cues ?? []) {
      if (cue.at > duration + 1e-6) continue;
      const t = at(cue.at) - (cue.kind === 'riser' ? RISER_LEAD : 0);
      if (t < 0) continue;
      const repeats = cues.some(
        (c) => c.scene === scene.id && c.kind === cue.kind && Math.abs(c.t - t) < 1e-6,
      );
      if (!repeats) cues.push({ t, kind: cue.kind, scene: scene.id });
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/video/test/cues-direction.test.ts packages/video/test/cues.test.ts packages/video/test/cues-hero.test.ts packages/video/test/cues-components.test.ts`
Expected: PASS. That includes the new file and every existing cue test unchanged. B2's "sound mid-move when the camera pans or zooms to the next stop" still passes, so stop-to-stop camera moves keep their `transition` whoosh.

To see the merge test bite, set `MERGE_MET = 1` and rerun `-t "stretched merge"`. Expected: FAIL, because the count is dropped within 0.15 s of the thump. Then restore 0.9.

Then run `npm run typecheck && npm run lint`, and `npm test` (foreground, 600000 ms). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/video/src/timeline/cues.ts packages/video/test/cues-direction.test.ts
git commit -m "$(cat <<'EOF'
Cue sounds from a shot's camera moves, counts, merges, and reveals

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 5: The benchmark sounds its motion, and a sound-only render keeps the frames

**Files:**
- Modify: `tests/render/sound.test.ts` (one new `it` at the end of `describe('sound', …)`)

**Interfaces:**
- Consumes:
  - From this file: `covi`, `example`, `read`, `Qc`, and `copyFileSync` (already imported), plus `readFileSync` and `join`.
  - The fixture `tests/render/fixtures/score.json` (id `crisp-cli`).
  - B5's benchmark: `s1` with `count` and `merge`, `s2` with a `camera follow`.
  - Tasks 1–4.
- Produces: the render-level pin for the owner's scope and for Review Focus 5.

- [ ] **Step 1: Write the test**

Append inside `describe.skipIf(!available || !fullRenders)('sound', () => { … })`, after the last `it`:

```ts
  it("sounds the benchmark's motion, and re-mixes only the sound when only the sound changes", async () => {
    const repo = await example('backend-slim-request');
    const { result } = covi(['video', '--repo', repo, '--standard']);
    expect(result.video.rendered).toBe(true);
    const run = result.runDir;
    type Cue = { t: number; kind: string; seconds?: number };
    type Beat = { verb: string; t: number; seconds: number };
    const timeline = read<{
      scenes: Array<{ start: number; direction?: { beats: Beat[] } }>;
      cues: Cue[];
    }>(run, 'video/timeline.json');
    // Each count in a shot is one cue that lasts it.
    const counts = timeline.scenes.flatMap((s) =>
      (s.direction?.beats ?? [])
        .filter((b) => b.verb === 'count' || b.verb === 'count-up')
        .map((b) => ({ t: s.start + b.t, seconds: b.seconds })),
    );
    expect(counts.length).toBeGreaterThan(0);
    for (const c of counts)
      expect(timeline.cues).toContainEqual(
        expect.objectContaining({ kind: 'count', t: expect.closeTo(c.t, 6), seconds: c.seconds }),
      );
    // The mix accounts for every motion cue; the counter ticks and the merge thumps.
    type Effect = { t: number; kind: string; recipe: string; seconds?: number; ticks?: number };
    const audio = read<{
      effects: { placed: Effect[]; dropped: Effect[] };
      levels: { effectsBelowVoiceDb?: number };
    }>(run, 'video/audio.json');
    const heard = [...audio.effects.placed, ...audio.effects.dropped];
    for (const cue of timeline.cues.filter((c) =>
      ['camera', 'count', 'merge', 'appear'].includes(c.kind),
    ))
      expect(
        heard.some((e) => e.kind === cue.kind && Math.abs(e.t - cue.t) < 1e-3),
        `${cue.kind} at ${cue.t}`,
      ).toBe(true);
    const tick = audio.effects.placed.find((p) => p.kind === 'count');
    expect(tick).toMatchObject({ recipe: 'tick' });
    expect(tick!.ticks).toBeGreaterThanOrEqual(2);
    expect(audio.effects.placed.find((p) => p.kind === 'merge')).toMatchObject({ recipe: 'thump' });
    expect(audio.levels.effectsBelowVoiceDb).toBeGreaterThanOrEqual(8);
    const qc = read<Qc>(run, 'video/qc.json');
    for (const id of ['audio', 'music-under-speech', 'music-jump', 'music-range', 'sound-effects'])
      expect(qc.checks.find((c) => c.id === id)?.status, id).toBe('pass');

    // Only the sound changes: the timeline stays byte for byte, and the frames are kept.
    const bytes = (rel: string) => readFileSync(join(run, rel));
    const framesKey = () => read<{ key: string }>(run, 'video/frames.json').key;
    const first = {
      timeline: bytes('video/timeline.json'),
      audio: bytes('video/audio.json'),
      music: bytes('video/music.wav'),
      key: framesKey(),
    };
    const remix = (...flags: string[]) => {
      const again = covi(['render', '--repo', repo, '--run', result.runId, ...flags]).result;
      expect(again.video.framesReused, flags.join(' ')).toBe(true);
      expect(bytes('video/timeline.json').equals(first.timeline), flags.join(' ')).toBe(true);
      expect(framesKey()).toBe(first.key);
      return read<{ effects: { enabled: boolean; placed: Effect[] }; music: { source: string } }>(
        run,
        'video/audio.json',
      );
    };
    expect(remix('--no-sound-effects').effects).toMatchObject({ enabled: false, placed: [] });
    expect(remix('--music', 'none').music.source).toBe('none');
    copyFileSync(
      join(import.meta.dirname, 'fixtures', 'score.json'),
      join(run, 'video', 'score.json'),
    );
    expect(remix('--music', 'compose').music.source).toBe('score');
    // Back to the sound it was drafted with: the same effects and music, byte for byte.
    remix();
    expect(bytes('video/audio.json').equals(first.audio)).toBe(true);
    expect(bytes('video/music.wav').equals(first.music)).toBe(true);
  }, 900_000);
```

`covi render` without flags uses the spec saved in `video/decision.json`: the theme, with effects on. The flags passed to the earlier renders change only that render.

- [ ] **Step 2: Run it**

Run in the foreground (600000 ms timeout; if it times out, rerun in the background and wait on a marker): `COVI_TEST_RENDER=1 npx vitest run tests/render/sound.test.ts -t "benchmark's motion"`
Expected: PASS.

Tasks 1–4 are in, so this test passes on its first run. To see it bite, comment out the `for (const cue of beatCues(scene))` line in `buildCues` and rerun. Expected: FAIL, because `timeline.cues` has no `count` cue. Then restore the line.

If a `count` or `merge` is dropped rather than placed, print `audio.effects.dropped` and the cues within 1 s of it. Report it with the reason; do not loosen the assertion. The benchmark's count is the payoff of its key number.

- [ ] **Step 3: Run the whole sound suite**

Run: `COVI_TEST_RENDER=1 npx vitest run tests/render/sound.test.ts tests/render/render.test.ts` (in the background, then wait on a marker file).
Expected: PASS. `render.test.ts` pins `covi-audio-5` (Task 3).

- [ ] **Step 4: Commit**

```bash
npx biome check --write tests/render/sound.test.ts
npm run lint && npm run typecheck
git add tests/render/sound.test.ts
git commit -m "$(cat <<'EOF'
Check that the benchmark ticks and thumps, and that sound-only renders keep the frames

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

### Task 6: Acceptance — the benchmark in English and Korean, measured, and rendered twice

**Files:**
- Scratch, not committed: `/tmp/covi-a2/measure-mix.mjs`, `/tmp/covi-a2/same.mjs`, renders under `/tmp/covi-a2/`
- Possibly tune:
  - `templates/music/sound-effects.yml`: `softCutDb` only
  - the four new recipes' layer `gain`s
  - the tests that pin them: `effects.test.ts` and `library.test.ts`

**Interfaces:**
- Consumes: everything above, run from `~/projects/covi-sound` with `./bin/covi.mjs`.
- Produces: a measurement table for each language, a determinism table, and any tuned value with its old and new numbers. All of these go in the final report for the PR description; none are committed.

A2 changes no frame and no music. A music measure that misses its target is therefore not this PR's to tune (A1's constants stay). Step 5 says how to show that.

- [ ] **Step 1: Write the measurement scripts**

`/tmp/covi-a2/measure-mix.mjs` is A1's Task 8 script with the master at ±1 LU (spec §17.3) and the motion effects listed:

```js
// node /tmp/covi-a2/measure-mix.mjs <runDir>: measures a run's stems and master with ffmpeg's
// ebur128 against A1's targets, and lists the motion effects. A tuning aid only; not committed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const video = join(process.argv[2], 'video');
const json = (f) => JSON.parse(readFileSync(join(video, f), 'utf8'));
const timeline = json('timeline.json');
const audio = json('audio.json');
const speech = timeline.scenes.filter((s) => s.speech).map((s) => [s.speech.start, s.speech.end]);
const first = Math.min(...speech.map(([s]) => s));
const last = Math.max(...speech.map(([, e]) => e));
const hero = audio.music.hero?.downbeat;
const exempt = [
  [0, first + 1],
  ...(hero === undefined ? [] : [[hero - 1.5, hero + 1.5]]),
  [last - 0.5, audio.duration],
];

function ebur(file, filter, before = []) {
  const { stderr } = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-v', 'verbose', ...before, '-i', file, '-af', filter, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const frames = [...stderr.matchAll(/t:\s*([\d.]+)\s+TARGET:\S+ LUFS\s+M:\s*(-?[\d.]+|-inf)/g)].map(
    (m) => ({ t: Number(m[1]), m: m[2] === '-inf' ? Number.NEGATIVE_INFINITY : Number(m[2]) }),
  );
  const summary = stderr.slice(stderr.lastIndexOf('Summary'));
  const num = (re) => Number(re.exec(summary)?.[1]);
  return { frames, I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

const music = ebur(join(video, 'music.wav'), 'ebur128');
const voice = ebur(join(video, 'narration.wav'), 'ebur128=dualmono=true');
const master = ebur(join(video, 'covi-review.mp4'), 'ebur128=peak=true');
const span = ebur(join(video, 'music.wav'), 'ebur128', ['-ss', String(first), '-to', String(last)]);

const inSpeech = (t) => speech.some(([s, e]) => t - 0.4 >= s - 1e-6 && t <= e + 1e-6);
const level = (frames) => {
  const p = frames.filter((f) => inSpeech(f.t) && Number.isFinite(f.m)).map((f) => 10 ** (f.m / 10));
  return 10 * Math.log10(p.reduce((a, b) => a + b, 0) / p.length);
};
const below = level(voice.frames) - level(music.frames);

const clear = (t) => exempt.every(([s, e]) => t <= s + 1e-6 || t - 0.4 >= e - 1e-6);
let jump = { db: 0, at: 0 };
const fr = music.frames;
for (let i = 0; i < fr.length; i++) {
  if (!clear(fr[i].t)) continue;
  for (let j = i + 1; j < fr.length && fr[j].t - fr[i].t <= 1 + 1e-6; j++) {
    if (!clear(fr[j].t)) continue;
    const d = Math.abs(Math.max(-70, fr[j].m) - Math.max(-70, fr[i].m));
    if (d > jump.db) jump = { db: d, at: fr[j].t };
  }
}

const row = (name, value, target, ok) =>
  console.log(`| ${name} | ${value} | ${target} | ${ok ? 'ok' : 'FAIL'} |`);
console.log('| Measure (ffmpeg ebur128) | Value | Target | |\n|---|---|---|---|');
row('music under voice during speech (dB)', below.toFixed(1), '12–20', below >= 12 && below <= 20);
row('music LRA over the narration (LU)', span.LRA.toFixed(1), '≤ 8', span.LRA <= 8);
row('largest music jump within 1 s (dB)', `${jump.db.toFixed(1)} at ${jump.at.toFixed(1)} s`, '≤ 6 outside exempt', jump.db <= 6);
row('master integrated (LUFS)', master.I.toFixed(1), '−16 ± 1', Math.abs(master.I + 16) <= 1);
row('master true peak (dBTP)', master.TP.toFixed(1), '≤ −1', master.TP <= -1);
row('effects under the voice peak (dB, Covi)', String(audio.levels.effectsBelowVoiceDb), '≥ 8', !(audio.levels.effectsBelowVoiceDb < 8));
const motion = ['camera', 'count', 'merge', 'appear'];
console.log('\nMotion effects placed:', JSON.stringify(audio.effects.placed.filter((p) => motion.includes(p.kind))));
console.log('Motion effects dropped:', JSON.stringify(audio.effects.dropped.filter((d) => motion.includes(d.kind))));
console.log('Covi levels:', JSON.stringify(audio.levels));
console.log('Exempt windows:', JSON.stringify(exempt));
```

`/tmp/covi-a2/same.mjs` compares two runs' files byte for byte:

```js
// node /tmp/covi-a2/same.mjs <result-a.json> <result-b.json>: compares two renders of one input.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runs = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')).runDir);
const sha = (run, rel) => createHash('sha256').update(readFileSync(join(run, rel))).digest('hex');
for (const rel of ['video/frames.json', 'video/music.wav', 'video/audio.json', 'video/timeline.json']) {
  const [a, b] = runs.map((r) => sha(r, rel));
  console.log(`| ${rel} | ${a.slice(0, 12)} | ${b.slice(0, 12)} | ${a === b ? 'same' : 'DIFFERENT'} |`);
}
```

- [ ] **Step 2: Render the benchmark in English (background), and measure**

```bash
rm -rf /tmp/covi-a2/repo /tmp/covi-a2/en-1.json /tmp/covi-a2/en-1.done /tmp/covi-a2/en-2.json /tmp/covi-a2/en-2.done /tmp/covi-a2/ko.json /tmp/covi-a2/ko.done; mkdir -p /tmp/covi-a2 && cd ~/projects/covi-sound && ./bin/covi.mjs examples create backend-slim-request --into /tmp/covi-a2/repo && (./bin/covi.mjs video --repo /tmp/covi-a2/repo --standard --force --json > /tmp/covi-a2/en-1.json; echo done > /tmp/covi-a2/en-1.done)
```

Run it in the background, then wait in the foreground: `until [ -s /tmp/covi-a2/en-1.done ]; do sleep 20; done` (timeout 600000, repeated as needed). Then:

```bash
node -e 'const r=require("/tmp/covi-a2/en-1.json");console.log(r.runId, r.runDir, r.video.rendered, r.video.qc)' && node /tmp/covi-a2/measure-mix.mjs "$(node -p 'require("/tmp/covi-a2/en-1.json").runDir')"
```

Expected:
- Every row reads `ok`.
- The motion effects placed include a `count` with recipe `tick`, ticks ≥ 2, and `seconds` equal to the count beat's; a `merge` with recipe `thump`; and a `camera` (for `s2`'s follow).
- `video/qc.json` has `sound-effects`, `music-*`, and `audio` at `pass`.

- [ ] **Step 3: Render the same input again, and compare**

```bash
cd ~/projects/covi-sound && (./bin/covi.mjs video --repo /tmp/covi-a2/repo --standard --force --json > /tmp/covi-a2/en-2.json; echo done > /tmp/covi-a2/en-2.done)
```

Run it in the background and wait on `/tmp/covi-a2/en-2.done`. Then run `node /tmp/covi-a2/same.mjs /tmp/covi-a2/en-1.json /tmp/covi-a2/en-2.json`.

Expected: all four rows `same`. If `music.wav` or `audio.json` differ, that is this PR's bug: find the unseeded or order-dependent step, fix it, and commit the fix with a test. If only `frames.json` or `timeline.json` differ, find the field that differs and report it to the lead:

```bash
diff <(node -e 'const r=require("/tmp/covi-a2/en-1.json");console.log(JSON.stringify(require(r.runDir+"/video/timeline.json"),null,1))') <(node -e 'const r=require("/tmp/covi-a2/en-2.json");console.log(JSON.stringify(require(r.runDir+"/video/timeline.json"),null,1))') | head -40
```

A2 changes no frame, so that is not this PR's to fix.

- [ ] **Step 4: The same in Korean**

```bash
cd ~/projects/covi-sound && (./bin/covi.mjs video --repo /tmp/covi-a2/repo --standard --force --language ko --json > /tmp/covi-a2/ko.json; echo done > /tmp/covi-a2/ko.done)
```

Run it in the background and wait on `/tmp/covi-a2/ko.done`. Then run `node /tmp/covi-a2/measure-mix.mjs "$(node -p 'require("/tmp/covi-a2/ko.json").runDir')"`.

Expected: every row `ok`, and the same motion effects as in English. The times differ, because the Korean lines have their own lengths.

- [ ] **Step 5: Tune only what A2 owns, if a row fails**

Re-mix in seconds after any change; frames are reused: `cd ~/projects/covi-sound && ./bin/covi.mjs render --repo /tmp/covi-a2/repo --run <runId> --json > /dev/null && node /tmp/covi-a2/measure-mix.mjs <runDir>`.

- **Effects under the voice peak < 8, or `sound-effects` not `pass`:** the cap guarantees ≥ 8, so this is a bug. Find it, fix it, and add a test.
- **`levels.effectsCutDb` > 2 dB:** the mix is lowering every effect to make room for the loudest peak, perhaps where the thump overlaps the train's first ticks. Raise `softCutDb` from 4 to 6, re-mix, and compare.
  - Keep the smallest value that brings the cut to ≤ 2 dB, update `effects.test.ts` (`BED_DB − 3` becomes `BED_DB − 5` for the count and the accent) and `library.test.ts` (`softCutDb`), and record a ruling.
  - If `softCutDb` does not move the cut, a motion effect is not what drives it. Every recipe peaks at −3 dBFS, so a layer's `gain` cannot lower a peak. Report the cut and the placed effects; do not change `gainDb`, which A1 tuned.
- **A music row (under voice, LRA, jump):** re-mix with `--no-sound-effects` (frames reused) and measure again. If the row still fails, the music is A1's and the timeline B-series': report both tables to the lead and change nothing here.
- **Master integrated or true peak:** A1's master loop owns these. Report them; do not change `mix.ts`.

After any tuning, run `npx vitest run packages/audio packages/video` and commit:

```bash
cd ~/projects/covi-sound && git add templates/music packages/audio/test && git commit -m "$(cat <<'EOF'
Tune the motion effects on the benchmark

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

- [ ] **Step 6: Report**

The final report includes:
- the measurement table for English and for Korean
- the determinism table
- each language's placed and dropped motion effects
- every value tuned, with its old and new number
- the benchmark's duration in each language

Then `rm -rf /tmp/covi-a2`.

---

### Task 7: Documentation, changelog, and the full checks

**Files:**
- Modify: `docs/video.md`, `docs/artifacts.md`
- Modify: `skills/covi-video/SKILL.md`, `skills/covi-video/references/music.md`, `skills/covi-video/references/direction.md` (B7's)
- Modify: `CHANGELOG.md`
- Test: `npm run check`, `npm run test:render`

**Interfaces:**
- Consumes: the final values. Read `softCutDb`, `swellCutDb`, and `gainDb` from `templates/music/sound-effects.yml`, and `TICK_GAP`/`TICK_STEPS` from `packages/audio/src/sfx/train.ts`. The text below assumes `softCutDb` = `swellCutDb` = 4 and A1's "swells … play 3 dB under" wording. If Task 6 or A1's tuning changed a number, write the tuned one.
- Produces: docs and skills that match the behavior.

- [ ] **Step 1: `docs/video.md`**

(a) In the configuration table, change the `video.soundEffects.enabled` row's description from `subtle sound effects for clicks, reveals, findings, the verdict, and the outro` to `subtle sound effects for clicks, reveals, findings, the verdict, the outro, and each directed shot's motion`.

(b) In the **Sound effects** bullet of the Sound overview (the one beginning `- **Sound effects** for what happens on screen:`):
- Replace `a soft whoosh when a scene pushes, wipes, or zooms through, a riser into the hero and a hit on it,` with `a soft whoosh when a scene pushes, wipes, or zooms through or the camera pans or zooms to it, a riser into the hero and a hit on it, a directed shot's motion (a softer whoosh as the camera moves inside it, ticks while a counter counts, a thump as pieces merge, a soft accent as an element appears),`.
- Replace `Fades, cuts, code, terminal output, API panels, and diagrams make no sound of their own;` with `Fades, cuts, code, terminal output, API panels, diagrams, morphs, flows, splits, and stacks make no sound of their own;`.

(c) In `#### Sound effects`:
- Replace the row `| A scene entering with \`push\`, \`wipe\`, or \`zoom-through\` | \`transition\` | …` with:

  `| A scene entering with \`push\`, \`wipe\`, or \`zoom-through\`, or the camera panning or zooming to its stop | \`transition\` | its peak mid-transition; none when the riser into the hero already carries that move |`

- Insert these rows after the `| The hero | …` row:

```markdown
| The camera moving inside a directed scene (a `camera` beat: zoom, pan, or follow) | `camera` | its peak mid-move; none off the canvas, toward no element of the shot, for a beat that repeats the one before it (same move, target, and zoom), or when the riser into the hero carries it |
| A counter counting (a `count` or `count-up` beat) | `tick`, as a train | one tick as it starts and one for each equal step of its number, on the count's ease-out, the last on the landing |
| Pieces merging into one (a `merge` beat) | `thump` | 90% of the way through the merge, where its pieces have met |
| An element appearing (a `reveal` beat) | `accent` | as it starts to appear |
```

- In the paragraph after the table:
  - Replace `swells (the whoosh and the riser) play 3 dB under` with `swells (the whooshes and the riser) and the soft effects (a counter's ticks, an element's accent) play 3 dB under; the thump plays at the bed's offset, like a finding`.
  - Replace `then the rest, and the swells last.` with `then the rest, then accents, and the swells last. A counter's ticks are one effect, at the count's start, for the spacing and the limit per second; a count that would tick while another still does is dropped ("while another counter ticks").`
- Add this paragraph after that paragraph:

```markdown
A counter's count is split into as many equal steps of its number as keep its two closest ticks at least 0.06 s apart, at most 12, and it ticks as it starts and at each step: a 1.6 s count ticks 10 times, quick as it starts and spreading out as it lands, like the number on screen. The ticks are the `tick` recipe repeated, and the train never peaks above one tick. `video/audio.json` records each counter's `seconds` and `ticks`. What a storyboard visual does sounds only while a shot shows it: a shot that leaves the visual out takes its clicks, reveal, finding cards, and verdict with it, and one that reveals the visual later keeps only what happens after. Morphs, flows, splits, and stacks have no sound of their own, and a scene's `cues` are unaffected by its shot.
```

(d) In "Quality checks", in the `sound-effects` row:
- Change `and their peaks sit at least 8 dB under the voice's` to `no two counters tick at once, and their peaks sit at least 8 dB under the voice's`.
- Change `fail on crowding or under 3 dB` to `fail on crowding, on two counters ticking at once, or under 3 dB`.

- [ ] **Step 2: `docs/artifacts.md`**

In the `video/audio.json` row, change `the effects (\`placed\` with times, recipes, and gains; \`dropped\` with reasons)` to `the effects (\`placed\` with times, recipes, and gains, a counter's also with its \`seconds\` and \`ticks\`; \`dropped\` with reasons)`.

- [ ] **Step 3: The skill**

`skills/covi-video/SKILL.md`:
- In the **Music.** paragraph, change `with subtle sound effects for clicks, reveals, findings, scenes that push, wipe, or zoom through, the hero, and the verdict.` to `with subtle sound effects for clicks, reveals, findings, scenes that push, wipe, or zoom through (or that the camera pans or zooms to), the hero, the verdict, and each shot's motion (camera moves, counters, merges, and elements appearing).` If B7 reworded that sentence, make the same addition to its list of sound effects.
- In the **Sound cues** bullet:
  - Change `Covi already sounds clicks, reveals, findings, the verdict, a whoosh for \`push\`, \`wipe\`, and \`zoom-through\`, and the hero's riser and hit;` to `Covi already sounds clicks, reveals, findings, the verdict, a whoosh for \`push\`, \`wipe\`, \`zoom-through\`, and the camera's \`pan\` and \`zoom\` between scenes, the hero's riser and hit, and each shot's beats (a softer whoosh for \`camera\`, ticks for \`count\` and \`count-up\`, a thump for \`merge\`, a soft accent for \`reveal\`);`.
  - At the end of the bullet, add: `A visual that a shot leaves out makes no sound.`

`skills/covi-video/references/direction.md` (B7): at the end of the part that describes the verbs, add this paragraph:

```markdown
**What the beats sound like.** Covi gives a shot's motion its own quiet effects: a soft whoosh mid-way through each `camera` move, ticks while a `count` or `count-up` runs (spaced like the number on screen, the last as it lands), a thump as a `merge`'s pieces meet, and a soft accent as a `reveal` begins. `place`, `morph`, `flow`, `split`, and `stack` are silent. Only one counter ticks at a time, so stagger two counts rather than landing them on one phrase. Do not add a storyboard `cues` entry for a moment a beat already sounds.
```

`skills/covi-video/references/music.md`: after the bullet beginning `- The hero has effects of its own:`, add:

```markdown
- Directed shots have effects of their own too: ticks while a counter counts, a thump when pieces merge, and a soft accent when something appears (pitched in C, so they move into the score's key), and soft whooshes for the camera's moves. Leave those moments to them: do not write ticks, hits, or swells into the score for them.
```

- [ ] **Step 4: CHANGELOG**

In `CHANGELOG.md`, under `## [Unreleased]`, in its `### Added` subsection (add the heading if the section has none), add one line (R-024):

```markdown
- Sound from motion: in directed videos the camera's moves inside a scene get a soft whoosh, counters tick (one train of ticks following the count's ease, placed as a single effect), merges land with a thump, and elements appear with a soft accent; the new `camera`, `tick`, `thump`, and `accent` recipes are pitched in C, follow the music's key, and sit under the bed, two counters never tick at once, and a shot that leaves out its storyboard visual no longer plays that visual's sounds; the audio engine is `covi-audio-5`.
```

- [ ] **Step 5: Run the full checks**

Run in the foreground (600000 ms): `cd ~/projects/covi-sound && npx biome check --write docs skills CHANGELOG.md; npm run check`
Expected: PASS (lint, typecheck, agents:check, the derived-file checks, and all unit and integration tests).

Then run `npm run test:render` in the background and wait on a marker file.
Expected: PASS. Two render tests require every QC check except `still` to pass on a short theme render:
- `renders a storyboard that uses every timing field`
- `…every component and sound field`

Task 5's benchmark test must pass too. If `sound-effects` fails anywhere, read its message and the run's `video/audio.json` before changing code.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/covi-sound && git add docs skills CHANGELOG.md && git commit -m "$(cat <<'EOF'
Document the sounds of motion

Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S
EOF
)"
```

---

## Self-review

Checked against the spec, the owner's scope, and the lead's pointers, then fixed inline.

**Spec coverage (§13, the owner's scope, §17):**

| Requirement | Where |
|---|---|
| Stop-to-stop `pan`/`zoom` → whoosh | B2 already cues these as `transition` (`WHOOSH`). Task 4 keeps it (B2's test unchanged) and Task 7 documents it. |
| In-stop `camera` beats → whoosh | Tasks 2 (`camera` recipe, swell level and rank) and 4 (`beatCues`) |
| `count`/`count-up` → `tick`, one cue carrying its duration, rendered as a train following the counter's ease | Task 4 (one `count` cue with `seconds`), Task 1 (`tickTimes` on the ease-out cubic, pinned to B4's `countProgress`; `tickTrain`), Task 3 (the stage renders the train) |
| `merge` → `thump` | Tasks 2 and 4 |
| `reveal` → soft `accent` | Tasks 2 (`softCutDb`, rank 0.5) and 4 |
| Recipes pitched in C, following the key via `effectTranspose` | Task 2: note names in `tick`, `thump`, `accent`; Hz in `camera`. The thump settles on C2, and on E♭2 transposed. The stage already applies `effectTranspose`. |
| Cue map entries | Task 2 |
| Mixed under A1 rules: relative to the bed | Task 2 (`BED_DB + gainDb + offset`; under-the-bed test) |
| ≥ 8 dB under the voice peak | A1's cap, unchanged; checked in Tasks 5 and 6 |
| Density limits; ticks count as one effect | Tasks 2 and 3 |
| Nothing in `timeline.json` depends on the sound choice | Task 4 (unit, with direction and sound on, off, none, and compose) and Task 5 (render: byte-identical `timeline.json`, frames reused) |
| `audio.json` lists the new effects | Tasks 3 and 5 |
| QC sound checks pass | Tasks 3 (`sound-effects` overlap) and 5 |
| Determinism | Tasks 1, 3, 5 (`music.wav` and `audio.json` bytes after re-mixes), 6 (twice-rendered input) |
| Acceptance §17.3–4 | Task 6, en and ko |
| Docs, skill, CHANGELOG, `npm run check`, `npm run test:render` | Task 7 |
| `AUDIO_ENGINE_VERSION` | Task 3 |

**Placeholder scan.** Every code step carries its code. The `…` that remain stand only for unchanged code named around a step (an existing function's arguments, a test name). Task 6's tuning is bounded by named knobs, the tests they move, and what is out of scope.

**Type consistency.** Names are checked across tasks:
- Task 1: `TICK_GAP`, `TICK_STEPS`, `tickTimes`, `tickTrain`.
- Task 2: `EffectCue.seconds`, `PlacedEffect.seconds`/`.ticks`, `softCutDb`, the recipe keys `camera`, `count`, `merge`, `appear`, and the reason `'while another counter ticks'`.
- Task 3: `TimelineCue.kind`/`.seconds`, `'covi-audio-5'`, and `'Two counters tick at once.'`.
- Task 4: `visualShownFrom`, `MERGE_MET`, `beatCues`.

Cue kinds match between `EffectCue` (Task 2) and `TimelineCue` (Task 3). `TimelineCue` is assignable to `EffectCue` at every step, because Task 2 widens the audio side first.

**Verification of the plan itself.** Tasks 1–4 were applied to a scratch copy of the A1 branch (`broadcast-mix` at 09d7a3b, with its uncommitted Task 7 QC edits). B2's Task 1 timeline types and `buildTimeline`/`layoutScenes` edits were added, with B3–B5's beat members and B4's `countProgress` as written in their plans.
- Every test in this plan passed there: Task 1 (8), Task 2 (all of `packages/audio`: 189), Task 3 (sound-motion, sound-qc, sound-levels, sound-failure), and Task 4 (8 new, plus all existing cue tests).
- `npm run typecheck` and Biome were clean.
- Each guard was confirmed to bite:
  - `MERGE_MET = 1` fails the stretched-merge test.
  - Single-tick rendering fails the train test.
- The full `npx vitest run` on that copy failed only where a copy without `.git` fails: `examples`, `english-baseline`, `demo`, `ci`, `cli init`, `evidence`, and `subject` fail identically on a pristine copy. The one exception was B2's own `timeline-grammar` test, which B2 updates.
- On that copy, the loudest momentary loudness of each motion effect at its placed gain was: thump −32.9, camera −33.4, accent −36.0, and a 1.6 s train −37.9 LUFS, against the bed's −31.
- Tasks 5–7 were reasoned, not run, because B2–B7's code is not in that copy. Task 5 follows A1's render test helpers, and B5's documented benchmark beats (`s1`: split, stack, merge, count; `s2`: morph with camera follow).

**Review Focus.** Each of the five lines has its test in the owning task (Tasks 2/3, 4, 1, 4, 5).

## Rulings

- Ruling: cue kinds are named for the picture event (`camera`, `count`, `merge`, `appear`) and recipes for the sound (`camera`, `tick`, `thump`, `accent`); `reveal` stays the before/after reveal — the cue kind `reveal` and the storyboard cue kind `reveal` are taken, and cues describe the picture, not the sound — a reader of `audio.json` sees `appear` for a direction `reveal` (the docs table says so).
- Ruling: stop-to-stop `pan`/`zoom` keep B2's `transition` whoosh; only in-stop camera beats get the new, softer `camera` whoosh — B2 already cues entrances, and a move between scenes is bigger than a move inside one — two whoosh recipes to maintain.
- Ruling: every camera beat sounds mid-move (`zoom`, `pan`, and `follow` alike). It is silent off the canvas, toward no element of the shot, as a repeat of the previous camera beat (same move, target, and zoom), or when carried by the riser — this mirrors the stage's `cameraSteps` and B2's riser rule for entrances, so a whoosh is never heard without a move — a repeated `follow` of a target that has moved far makes no second whoosh.
- Ruling: a count ticks once at its start and once at each of N equal value steps on the ease-out cubic (`τ = 1 − ∛(1 − k/N)`). N is the most steps ≤ 12 whose first, shortest gap is ≥ 0.06 s, giving 10 ticks for B4's 1.6 s count, 4 for `COUNT_MIN` 0.6 s, and 13 for 4 s — it follows the counter's ease literally, and the gap keeps ticks from blurring into a buzz — a long count is heard in at most 13 ticks, and the value shown changes between them.
- Ruling: the ease is restated in `@covi/audio` (which imports no Covi package) and pinned to B4's `countProgress` by `packages/video/test/ticks.test.ts` — the dependency direction forbids importing it — if the counter's ease changes, that test fails until the audio follows.
- Ruling: a tick train is one effect at its start for spacing and density. Two trains never overlap: the later or lower-ranked one is dropped with "while another counter ticks". Other effects may sound during a train — the owner said "ticks count as one effect", and two counters ticking together would rattle — an effect that lands mid-count overlaps the quiet ticks.
- Ruling: ranks: `count` and `merge` with the rest (1); `appear` at 0.5, giving way to every landing but beating a swell; `camera` a swell (0) — accents decorate and can come many to a shot, and whooshes are long sounds A1 already lets yield first — an accent can lose to a click within 0.15 s, and a camera whoosh to an accent.
- Ruling: levels: the thump at the bed's offset (`gainDb`, like a finding); ticks and accents `softCutDb` (4) lower; the camera whoosh `swellCutDb` lower. A test keeps all four at or under the bed's level under speech (−31 LUFS momentary) — "if an effect is noticeable, it is too loud". They measured −32.9, −36.0, −37.9, and −33.4 on a scratch copy — retuning is a data change.
- Ruling: the recipes are:
  - `tick`: a modal C6 tap plus a 6 kHz click, 0.05 s, at most `TICK_GAP`.
  - `thump`: a sine gliding G2 → C2, plus a modal C4 knock and a dark room.
  - `accent`: a glass-pluck G5 plus air.
  - `camera`: noise only, in Hz, with anchor 0.16 s.

  Pitched layers are in C and follow the key; the whoosh never transposes — AGENTS.md's recipe rule, and the fifth (G) sits in every major and minor parent scale — none.
- Ruling: a merge's thump lands 90% of the way through it (`MERGE_MET`), where B5's ease-in-out has the pieces within 0.4% of one — B5 stretches a merge to end 0.15 s before the next beat, and with millisecond rounding a thump at the very end can fall inside `minSpacing` of the count that usually follows; tied in rank and later, the count's ticks would be dropped — on a stretched 2.4 s merge the thump leads the last 0.24 s of a barely visible settle.
- Ruling: the reveal accent sounds at the reveal's start — the before/after `reveal` cue does the same, and every reveal style is visible within its first tenth of a second — none.
- Ruling: `morph`, `flow`, `split`, and `stack` beats make no sound — the owner's map lists camera moves, counters, merge, and reveal only, and a stack's pops are drawn items, not a counter's ease — a pile fills silently and a packet travels silently; adding one is a cue-map line, a recipe, and a `beatCues` case.
- Ruling: a storyboard visual's own cues (click, before/after reveal, finding, verdict) sound only while the shot shows it. They are dropped when the shot has no `visual` element, and before its reveal when it is revealed later, because the visual keeps the scene's clock — "sound follows the picture", and B2 left these cues firing for visuals a shot had replaced — an agent who replaces a findings card with labels loses the card's landing sound, which is correct, since no card lands.
- Ruling: the hero's riser and hit, the entrance whooshes, and the storyboard's own `cues` stay scene-level and are unaffected by a shot — they belong to the scene, not its visual, and storyboard cues are the author's explicit request — a storyboard `click` cue on a scene whose screenshot a shot replaced still sounds.
- Ruling: `AUDIO_ENGINE_VERSION` becomes `covi-audio-5` in Task 3 — rendered effects change, and AGENTS.md asks for the bump whenever rendered output changes — a one-time re-render of cached music, although the music itself is unchanged (as R-A1-12).
- Ruling: placed counters in `video/audio.json` carry `seconds` and `ticks`, and the file stays `schemaVersion: 1` — the change is additive and readers ignore unknown fields — none.
- Ruling: QC `sound-effects` fails a record with two overlapping placed counters ("Two counters tick at once.") — placement prevents it, so such a record is broken output, like the crowding the check already fails (R-007 keeps `fail` for broken output) — none expected.
- Ruling: the storyboard's `SceneCueKind` is unchanged, so agents cannot ask for `camera`, `count`, `merge`, or `appear` cues — those sounds follow direction beats, which is where agents direct motion — none.
- Ruling: drop reasons and QC messages are English literals, like A1's — diagnostic records; CLI-level text stays English (AGENTS.md) — none.
- Ruling: Task 5's compose re-render copies the existing fixture score into the run instead of letting a model provider compose — deterministic and needs no model — model composition is not re-exercised here (0.2.0's tests cover it).
- Ruling: acceptance determinism renders the English benchmark twice from scratch in one materialized repo (narration cached) and compares `frames.json`, `music.wav`, `audio.json`, and `timeline.json` bytes; Korean is rendered once and measured — spec §17.4 asks for one input rendered twice — a nondeterminism only in Korean would go unseen by the acceptance step (Task 5's re-mix byte checks still run in English).
- Ruling: a music measure that fails in Task 6 is reported, not tuned, in this PR — A2 changes no frame and no music, and A1's constants were tuned and approved (R-018) — a failing music row waits for a follow-up fix rather than being tuned here.
- Ruling: the CHANGELOG gets one line under `### Added` (R-024), naming the replaced-visual sound fix and the engine version inside it — R-024 — a reader scanning only `### Fixed` misses the fix.
- Ruling: A2 executes only after A1 and B2–B7 merge, with a pre-flight scan of every name in "Names this plan builds on" against post-B7 `main` — the planner verified against A1's branch plus B2–B5's planned types, not their merged code — conflicts found then are ruled on before dispatch.
