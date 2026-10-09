# A1 Broadcast Mix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the music under Covi videos a continuous, gently ducked, glued, voice-carved bed that never jumps, with effects set relative to that bed, and check it in `video/qc.json`.

**Architecture:** All DSP and measurement stays in `@covi/audio` (deterministic, no clocks, no `Math.random`): new loudness measures (`momentaryLoudness`, `loudnessRange`, `largestJump`), a glue compressor and a voice-band carve in `dsp/fx.ts`, a rewritten `placement.ts` whose ramps are long enough to keep a per-second step bound, and a `mix.ts` that builds a music bus (normalize → glue → normalize → carve → placement). The mix checks the placed stem and holds down any pause whose swell would make the music jump. `@covi/video` passes the hero downbeat to the mix, makes `auto` resolve to `continuous` (R-004), records the new levels in `video/audio.json`, and QC adds `music-jump` (fail) and `music-range` (warn).

**Tech Stack:** TypeScript on Node 22.18+ (run without a build), Vitest, Zod, Biome; ffmpeg's `ebur128` for the tuning measurements.

**Spec:** `~/projects/covi-0.3.0-program/docs/superpowers/specs/2026-10-09-covi-0.3.0-program-design.md` (§12 for A1, plus §2, §14–§18). Rulings: `~/projects/covi-0.3.0-program/docs/superpowers/rulings.md` (R-004, R-007, R-011 concern A1).

**Where to work:** the code worktree is `~/projects/covi-sound` on branch `broadcast-mix` (from `main` at aeef1fa). Every path below is relative to it. Agent shells reset their cwd, so start each command with `cd ~/projects/covi-sound &&`.

## Global Constraints

- Node 22.18+, TypeScript run directly: import with `.ts` extensions, `import type` for types, no enums, namespaces, or constructor parameter properties.
- Biome: two spaces, single quotes, 100 columns, trailing commas. Run `npx biome check --write <files>` on touched files before each commit.
- `@covi/audio` imports no other Covi package. `@covi/video` reaches it through `@covi/audio`. Nothing imports `cli`. `tests/architecture.test.ts` enforces this.
- Sound is deterministic. The seeded PRNG (`packages/audio/src/dsp/prng.ts`) is the only randomness, there is no `Math.random`, and there are no clocks. The same inputs give the same bytes.
- `AUDIO_ENGINE_VERSION = 'covi-audio-4'`.
- Master: −16 LUFS ± 0.5 for narrated videos (−20 for music alone), true peak ≤ −1 dBTP. The existing linear-gain + limiter loop is unchanged.
- Placement: `continuous` is what `auto` resolves to for every kind of video (R-004). The setting's default stays `auto`, and `bookends` stays selectable.
- During speech the music sits 12–20 dB below the voice, measured by the existing `musicBelowVoiceDb` (K-weighted RMS over the speech windows). Aim for about 16. The duck is 6–10 dB and recovers over 1–2 s.
- Carve: `music − k(t)·BP(music)`, with an RBJ constant-0-dB-peak band-pass at 2 kHz, Q 0.7. `k` is 0 in gaps and 0.5 while someone speaks, and it follows the duck.
- Glue: stereo-linked RMS detector of about 50 ms, 2:1 ratio, 6 dB soft knee, threshold −24 dBFS RMS, 30 ms attack, 400 ms release. Makeup comes from re-normalizing to −16 LUFS.
- Effects: `sound-effects.yml` `gainDb` is relative to the bed's level under speech (R-011). After placement, the mix lowers all effects together so they stay at least 8 dB under the voice's peak.
- Loudness measures: momentary uses 400 ms windows with a 100 ms hop. LRA follows EBU Tech 3342: 3 s short-term windows, absolute gate −70 LUFS, relative gate −20 LU, P95 − P10.
- QC `music-jump` **fails** if the music's momentary loudness changes by more than 6 dB within 1 s outside the exempt windows:
  - intro: `[0, firstLine + 1 s]`
  - hero: `[downbeat − 1.5 s, downbeat + 1.5 s]`
  - outro: `[lastLine − 0.5 s, end]`
- QC `music-range` **warns** if the music's LRA over the narrated span (first line start → last line end) exceeds 8 LU.
- QC `music-under-speech` for `continuous` passes at 12–20 dB, warns outside that range, and fails under 9.
- Text for people goes through `templates/i18n/{en,ko,ja,zh}.yml`, with the same keys and placeholders in all four. QC and CLI log messages stay English literals, as they are today.
- No `version` field changes anywhere. `CHANGELOG.md` gets one concise English line under `## [Unreleased]`.
- Commits use the default git identity, never Claude as an author. Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S` (pass it as a second `-m`).
- Long commands (`covi video` renders, `npm run check`, `npm run test:render`) run with `run_in_background: true`. Wait for the completion notification; do not poll with sleep.

## Review Focus

1. **Silence inside the music** (a composed score with a rest, or a stem that renders to zeros). The jump measure must stay finite: silence counts as −70 LUFS. `video/audio.json` must hold numbers, never `null`, and QC must fail honestly instead of crashing. Tests: Task 1 (silence floor), Task 6 (`audio.json` levels contain no `null`).
2. **Narration shorter than 3 s, or a single short line.** `musicRangeLu` is absent, nothing throws, and QC passes with "not measured". Tests: Task 5 (short narration), Task 7 (undefined range passes).
3. **Hero downbeat inside the opening, or exempt windows that cover the whole narration.** `musicJumps` is absent and QC passes. Exempt windows may start below 0. Tests: Task 5 (all windows exempt), Task 7 (undefined jumps pass).
4. **Messy speech windows from TTS** (unsorted, overlapping, zero-length, NaN, starting before 0, ending after the video). The placement is finite and identical to the cleaned layout. Test: Task 3.
5. **Runs drafted under 0.2.0.** A `video/decision.json` saved with `placement: 'bookends', setting: 'auto'` re-renders as `continuous`, and a 0.2.0 `audio.json` without the new levels passes QC. Tests: Task 6 (respec of an old spec), Task 7 (old record passes).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/audio/src/loudness.ts` | modify | + `momentaryLoudness`, `loudnessRange`, `largestJump`, `loudnessJump`, `Jump` |
| `packages/audio/src/dsp/fx.ts` | modify | + `glueCompressor`, `GLUE`, `voiceCarve`, `CARVE` |
| `packages/audio/src/placement.ts` | rewrite | step-bounded raised-cosine/linear ramps; `placementLevels`, `duckAmount`, `swellingPauses`, `rampSeconds`, `BED_DB`, `clearOfSpeech` |
| `packages/audio/src/effects.ts` | modify | `gainDb` relative to `BED_DB` |
| `packages/audio/src/mix.ts` | rewrite | music bus, carve, placement, jump guard, effects cap, new levels, exempt windows |
| `packages/audio/src/library.ts` | modify | `AUDIO_ENGINE_VERSION = 'covi-audio-4'` |
| `packages/audio/src/index.ts` | modify | exports |
| `templates/music/sound-effects.yml` | modify | `gainDb: 1` (relative to the bed) |
| `packages/video/src/sound.ts` | modify | pass `hero`, round and keep the new levels, `clearOfSpeech` over `musicLines` |
| `packages/video/src/spec.ts` | modify | `auto` → `continuous`; the music question always knows the placement |
| `packages/video/src/qc.ts` | modify | `music-jump`, `music-range`, new `music-under-speech` and `sound-effects` grading |
| `templates/i18n/{en,ko,ja,zh}.yml` | modify | drop `question.music.where.byMode`, rewrite `where.bookends` |
| `packages/core/src/config/schema.ts`, `packages/cli/src/main.ts` | modify | placement descriptions |
| tests | modify/create | `packages/audio/test/{loudness,dsp,library,placement,effects,mix}.test.ts`, `packages/video/test/{spec,sound-qc}.test.ts`, new `packages/video/test/sound-levels.test.ts`, `tests/render/{sound,render}.test.ts` |
| docs | modify | `docs/video.md`, `docs/configuration.md`, `docs/cli.md`, `docs/artifacts.md`, `skills/covi-video/SKILL.md`, `skills/covi-video/references/music.md`, `CHANGELOG.md`, two comments |

---

### Task 1: Momentary loudness, loudness range, and jumps

**Files:**
- Modify: `packages/audio/src/loudness.ts` (insert after `weightedLevel`, before the `AUDIBLE` block)
- Modify: `packages/audio/src/index.ts` (loudness exports)
- Test: `packages/audio/test/loudness.test.ts`

**Interfaces:**
- Consumes: the private `stepEnergies(channels, sampleRate): Float64Array`, `toLufs(power)`, and `LUFS_OFFSET` that already exist in `loudness.ts`.
- Produces:
  - `momentaryLoudness(channels: readonly Float32Array[], sampleRate: number): Float64Array`. Value `k` covers `[0.1·k, 0.1·k + 0.4]` s. LUFS, ungated, `-Infinity` for digital silence.
  - `loudnessRange(channels: readonly Float32Array[], sampleRate: number, span?: readonly [number, number]): number | undefined`. LU. Undefined when no 3 s window inside `span` passes the gates.
  - `interface Jump { maxDb: number; at: number }`. `at` is the end of the later window, in seconds.
  - `largestJump(momentary: Float64Array, options?: { exempt?: ReadonlyArray<readonly [number, number]>; within?: number; floor?: number }): Jump | undefined`. Defaults: `within` 1 s, `floor` −70 LUFS. A window counts only if its whole 400 ms lies outside every exempt window, and exempt ends may be ±Infinity.
  - `loudnessJump(channels, sampleRate, options?)`, which is `largestJump(momentaryLoudness(…), options)`.

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `packages/audio/test/loudness.test.ts` to:

```ts
import {
  AUDIBLE,
  audibleSeconds,
  dbfs,
  integratedLoudness,
  kWeightingCoefficients,
  largestJump,
  loudnessJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  truePeak,
  weightedLevel,
} from '../src/loudness.ts';
```

Append to the end of the file:

```ts
describe('momentary loudness', () => {
  it("reads 400 ms windows every 100 ms, as ffmpeg's ebur128 M does", () => {
    const x = sine(1000, 2, -23);
    const m = momentaryLoudness([x, x], SR);
    // 20 steps of 100 ms, windows of 4 steps.
    expect(m.length).toBe(17);
    for (const v of m) expect(v).toBeCloseTo(-23, 1);
  });

  it('is −Infinity in digital silence', () => {
    const x = new Float32Array(SR);
    for (const v of momentaryLoudness([x, x], SR)) expect(v).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('loudness range (EBU Tech 3342)', () => {
  const lra = (...parts: Array<[number, number]>) => {
    const x = concat(...parts.map(([seconds, db]) => sine(1000, seconds, db)));
    return loudnessRange([x, x], SR)!;
  };

  it('reads the Tech 3342 test signals within ±1 LU', () => {
    expect(Math.abs(lra([20, -20], [20, -30]) - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([20, -20], [20, -15]) - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(lra([20, -40], [20, -20]) - 20)).toBeLessThanOrEqual(1);
    // The −50 dBFS ends fall under the relative gate.
    expect(
      Math.abs(lra([20, -50], [20, -35], [20, -20], [20, -35], [20, -50]) - 15),
    ).toBeLessThanOrEqual(1);
  });

  it('measures only the windows inside a span, and nothing in silence or under 3 s', () => {
    const x = concat(
      sine(1000, 20, -50),
      sine(1000, 20, -35),
      sine(1000, 20, -20),
      sine(1000, 20, -35),
    );
    expect(Math.abs(loudnessRange([x, x], SR, [20, 80])! - 15)).toBeLessThanOrEqual(1);
    expect(loudnessRange([x, x], SR, [30, 32.5])).toBeUndefined();
    const silent = new Float32Array(5 * SR);
    expect(loudnessRange([silent, silent], SR)).toBeUndefined();
    const steady = sine(1000, 10, -20);
    expect(loudnessRange([steady, steady], SR)!).toBeLessThan(0.1);
  });
});

describe('loudness jumps', () => {
  const step = concat(sine(1000, 5, -20), sine(1000, 5, -30));

  it('finds a 10 dB step and when it is heard', () => {
    const jump = loudnessJump([step, step], SR)!;
    expect(jump.maxDb).toBeCloseTo(10, 0);
    expect(jump.at).toBeGreaterThanOrEqual(5);
    expect(jump.at).toBeLessThanOrEqual(5.6);
  });

  it('skips every window that touches an exempt window, open-ended ones too', () => {
    expect(loudnessJump([step, step], SR, { exempt: [[4.5, 5.5]] })!.maxDb).toBeLessThan(0.05);
    const around = loudnessJump([step, step], SR, {
      exempt: [
        [Number.NEGATIVE_INFINITY, 4],
        [6.5, Number.POSITIVE_INFINITY],
      ],
    })!;
    expect(around.maxDb).toBeCloseTo(10, 0);
  });

  it('measures a 5 dB-per-second fade as 5 dB within a second', () => {
    const x = new Float32Array(10 * SR);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const db = t < 4 ? -20 : t < 6 ? -20 - 5 * (t - 4) : -30;
      x[i] = 10 ** (db / 20) * Math.sin(2 * Math.PI * 1000 * t);
    }
    expect(loudnessJump([x, x], SR)!.maxDb).toBeCloseTo(5, 0);
  });

  it('counts silence as −70 LUFS, so a drop into silence is a finite jump', () => {
    const x = concat(sine(1000, 2, -20), new Float32Array(2 * SR));
    const jump = loudnessJump([x, x], SR)!;
    expect(Number.isFinite(jump.maxDb)).toBe(true);
    expect(jump.maxDb).toBeCloseTo(50, 0);
  });

  it('has nothing to report when fewer than two windows are clear', () => {
    const x = sine(1000, 2, -20);
    expect(loudnessJump([x, x], SR, { exempt: [[0, 2]] })).toBeUndefined();
    expect(largestJump(new Float64Array(0))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/loudness.test.ts`
Expected: FAIL, because `momentaryLoudness`, `loudnessRange`, `largestJump`, and `loudnessJump` are not exported.

- [ ] **Step 3: Implement**

In `packages/audio/src/loudness.ts`, insert after the `weightedLevel` function:

```ts
/** Loudness of windows `width` steps (100 ms each) wide, one window per step. */
function windowLoudness(steps: Float64Array, width: number, sampleRate: number): Float64Array {
  const samples = width * Math.round(sampleRate / 10);
  const out = new Float64Array(Math.max(0, steps.length - width + 1));
  for (let k = 0; k < out.length; k++) {
    let sum = 0;
    for (let j = k; j < k + width; j++) sum += steps[j]!;
    out[k] = toLufs(sum / samples);
  }
  return out;
}

/**
 * Momentary loudness (EBU Tech 3341): K-weighted and ungated, over 400 ms windows every 100 ms.
 * Value k covers [0.1·k, 0.1·k + 0.4] s; −Infinity where a window is digital silence.
 */
export function momentaryLoudness(
  channels: readonly Float32Array[],
  sampleRate: number,
): Float64Array {
  return windowLoudness(stepEnergies(channels, sampleRate), 4, sampleRate);
}

/**
 * Loudness range (EBU Tech 3342) in LU: short-term loudness over 3 s windows every 100 ms, of the
 * windows inside `span` (seconds; the whole signal by default), gated at −70 LUFS and then 20 LU
 * below the power mean of what passed; the spread from the 10th to the 95th percentile.
 * Undefined when no window passes: silence, or a span shorter than 3 s.
 */
export function loudnessRange(
  channels: readonly Float32Array[],
  sampleRate: number,
  span: readonly [number, number] = [0, Number.POSITIVE_INFINITY],
): number | undefined {
  const shortTerm = windowLoudness(stepEnergies(channels, sampleRate), 30, sampleRate);
  const [from, to] = span;
  const passed: number[] = [];
  for (let k = 0; k < shortTerm.length; k++) {
    const start = k / 10;
    if (start >= from - 1e-9 && start + 3 <= to + 1e-9 && shortTerm[k]! > -70)
      passed.push(shortTerm[k]!);
  }
  if (!passed.length) return undefined;
  const power = passed.reduce((sum, l) => sum + 10 ** ((l - LUFS_OFFSET) / 10), 0) / passed.length;
  const gate = toLufs(power) - 20;
  const gated = passed.filter((l) => l > gate).sort((a, b) => a - b);
  const percentile = (p: number) => gated[Math.round((gated.length - 1) * p)]!;
  return percentile(0.95) - percentile(0.1);
}

export interface Jump {
  /** The largest change (dB). */
  maxDb: number;
  /** When it is heard: the end of the later window (s). */
  at: number;
}

/**
 * The largest change of momentary loudness (values from `momentaryLoudness`) between two windows
 * that start at most `within` seconds apart, both lying wholly outside every `exempt` window
 * (seconds; either end may be infinite). Silence counts as `floor` LUFS, so a stem that falls
 * silent reads as a finite drop. Undefined when fewer than two windows are clear.
 */
export function largestJump(
  momentary: Float64Array,
  options: {
    exempt?: ReadonlyArray<readonly [number, number]>;
    within?: number;
    floor?: number;
  } = {},
): Jump | undefined {
  const exempt = options.exempt ?? [];
  const reach = Math.round((options.within ?? 1) * 10);
  const floor = options.floor ?? -70;
  const clear = Array.from(momentary, (_, k) =>
    exempt.every(([s, e]) => k / 10 + 0.4 <= s + 1e-9 || k / 10 >= e - 1e-9),
  );
  let best: Jump | undefined;
  for (let i = 0; i < momentary.length; i++) {
    if (!clear[i]) continue;
    const a = Math.max(floor, momentary[i]!);
    for (let j = i + 1; j <= i + reach && j < momentary.length; j++) {
      if (!clear[j]) continue;
      const change = Math.abs(Math.max(floor, momentary[j]!) - a);
      if (!best || change > best.maxDb + 1e-9) best = { maxDb: change, at: j / 10 + 0.4 };
    }
  }
  return best;
}

/** The largest momentary-loudness jump of a signal (see `largestJump`). */
export function loudnessJump(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: Parameters<typeof largestJump>[1] = {},
): Jump | undefined {
  return largestJump(momentaryLoudness(channels, sampleRate), options);
}
```

In `packages/audio/src/index.ts`, replace the `./loudness.ts` export block with:

```ts
export {
  AUDIBLE,
  audibleSeconds,
  dbfs,
  dbToGain,
  integratedLoudness,
  type Jump,
  type Loudness,
  largestJump,
  loudnessJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  samplePeak,
  truePeak,
  weightedLevel,
} from './loudness.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/loudness.test.ts && npx biome check --write packages/audio/src/loudness.ts packages/audio/src/index.ts packages/audio/test/loudness.test.ts && npm run typecheck`
Expected: PASS, with Biome clean and typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/audio/src/loudness.ts packages/audio/src/index.ts packages/audio/test/loudness.test.ts && git commit -m "Measure momentary loudness, loudness range, and loudness jumps" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 2: Glue compressor and voice-band carve

**Files:**
- Modify: `packages/audio/src/dsp/fx.ts` (insert after the existing `compressor` function)
- Test: `packages/audio/test/dsp.test.ts`, `packages/audio/test/library.test.ts`

**Interfaces:**
- Consumes: `Biquad` from `packages/audio/src/dsp/filter.ts` (already imported in `fx.ts`) and the module constants `DEFAULT_SR` and `TINY`.
- Produces:
  - `GLUE = { threshold: -24, ratio: 2, knee: 6, attack: 0.03, release: 0.4, rms: 0.05 } as const`
  - `interface GlueOptions { threshold?; ratio?; knee?; attack?; release?; rms?; sr? }` (all numbers)
  - `glueCompressor(buf: Float32Array[], o?: GlueOptions): Float32Array[]`. Works in place, applies no makeup, and returns `buf`.
  - `CARVE = { freq: 2000, q: 0.7, depth: 0.5 } as const`
  - `voiceCarve(buf: Float32Array[], amount: Float32Array, o?: { freq?: number; q?: number; depth?: number; sr?: number }): Float32Array[]`. Works in place. `amount` is 0..1 per sample.

- [ ] **Step 1: Write the failing tests**

In `packages/audio/test/dsp.test.ts`, change the fx import to:

```ts
import {
  chorus,
  compressor,
  delay,
  glueCompressor,
  limiter,
  reverb,
  softClip,
  voiceCarve,
} from '../src/dsp/fx.ts';
```

Append to the end of the file:

```ts
describe('the music bus', () => {
  it('glue takes a steady loud sine down by half its excess over the threshold', () => {
    // A sine at −10 dBFS peak has a mean square of −13 dB: 11 dB over −24, so 2:1 takes 5.5 dB.
    const x = [tone(1000, 2, 10 ** (-10 / 20)), tone(1000, 2, 10 ** (-10 / 20))];
    const before = rmsOf(x[0]!, SR, 2 * SR);
    glueCompressor(x, { sr: SR });
    expect(20 * Math.log10(rmsOf(x[0]!, SR, 2 * SR) / before)).toBeCloseTo(-5.5, 1);
  });

  it('glue leaves quiet passages exactly as they were', () => {
    const x = [tone(1000, 1, 0.01), tone(1000, 1, 0.01)]; // −40 dBFS
    const copy = x.map((c) => c.slice());
    glueCompressor(x, { sr: SR });
    expect(x).toEqual(copy);
  });

  it('glue is deterministic', () => {
    const noisy = () => {
      const random = mulberry32(3);
      const c = Float32Array.from({ length: SR }, () => 0.5 * (random() * 2 - 1));
      return [c, c.slice()];
    };
    const a = glueCompressor(noisy(), { sr: SR });
    const b = glueCompressor(noisy(), { sr: SR });
    expect(hashOf(a[0]!, a[1]!)).toBe(hashOf(b[0]!, b[1]!));
  });

  it('carves −6 dB at 2 kHz while ducked, about 1–4 kHz in all, and nothing at amount 0', () => {
    const carved = (freq: number, amount: number) => {
      const x = tone(freq, 0.5);
      const y = [x.slice()];
      voiceCarve(y, new Float32Array(x.length).fill(amount), { sr: SR });
      const from = Math.round(0.25 * SR);
      return 20 * Math.log10(rmsOf(y[0]!, from) / rmsOf(x, from));
    };
    expect(carved(2000, 1)).toBeCloseTo(-6.02, 1);
    expect(carved(1000, 1)).toBeLessThan(-1);
    expect(carved(4000, 1)).toBeLessThan(-1);
    expect(Math.abs(carved(150, 1))).toBeLessThan(0.2);
    expect(carved(8000, 1)).toBeGreaterThan(-1);
    expect(carved(2000, 0)).toBe(0);
  });
});
```

In `packages/audio/test/library.test.ts`, add these imports at the top:

```ts
import { glueCompressor } from '../src/dsp/fx.ts';
import { integratedLoudness } from '../src/loudness.ts';
```

Then append:

```ts
describe('the music bus', () => {
  it("glues the theme's dense passages a few dB, the bed kept steady but not squashed", () => {
    const score = theme();
    const arrangement = fitMusic(score, {
      duration: 20,
      hero: 9,
      lastLine: 17,
      verdict: 'looks-good',
    })!;
    const music = renderMusic(score, arrangement, library, { verdict: 'looks-good' });
    const gain = 10 ** ((-16 - integratedLoudness(music, 48_000)) / 20);
    for (const c of music) for (let i = 0; i < c.length; i++) c[i]! *= gain;
    glueCompressor(music, { sr: 48_000 });
    // Measured 3.4 dB on 20, 60, and 90 s renders of the theme.
    const drop = -16 - integratedLoudness(music, 48_000);
    expect(drop).toBeGreaterThanOrEqual(0.5);
    expect(drop).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/dsp.test.ts packages/audio/test/library.test.ts`
Expected: FAIL, because `glueCompressor` and `voiceCarve` are not exported.

- [ ] **Step 3: Implement**

In `packages/audio/src/dsp/fx.ts`, insert after the `compressor` function:

```ts
export interface GlueOptions {
  /** Threshold on the RMS level (dB: 10·log10 of the mean square across channels). */
  threshold?: number;
  ratio?: number;
  /** Soft-knee width (dB). */
  knee?: number;
  /** Attack and release of the gain reduction (s). */
  attack?: number;
  release?: number;
  /** Time constant of the RMS detector (s). */
  rms?: number;
  sr?: number;
}

/** The music bus's glue: dense passages come down 1–3 dB together, quiet ones not at all. */
export const GLUE = {
  threshold: -24,
  ratio: 2,
  knee: 6,
  attack: 0.03,
  release: 0.4,
  rms: 0.05,
} as const;

/**
 * Bus compressor: a stereo-linked RMS detector, a soft knee, and smoothed gain reduction,
 * feed-forward and without makeup (the caller brings the bus back to its loudness).
 */
export function glueCompressor(buf: Float32Array[], o: GlueOptions = {}): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const n = buf[0]?.length ?? 0;
  const threshold = o.threshold ?? GLUE.threshold;
  const knee = o.knee ?? GLUE.knee;
  const slope = 1 - 1 / Math.max(1, o.ratio ?? GLUE.ratio);
  const detect = 1 - Math.exp(-1 / (Math.max(1e-4, o.rms ?? GLUE.rms) * sr));
  const att = Math.exp(-1 / (Math.max(1e-4, o.attack ?? GLUE.attack) * sr));
  const rel = Math.exp(-1 / (Math.max(1e-4, o.release ?? GLUE.release) * sr));
  let ms = 0;
  let gr = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of buf) sum += ch[i]! * ch[i]!;
    ms += detect * (sum / buf.length - ms);
    if (ms < TINY) ms = 0;
    const over = 10 * Math.log10(ms + TINY) - threshold;
    let target: number;
    if (over <= -knee / 2) target = 0;
    else if (over >= knee / 2) target = over * slope;
    else target = (slope * (over + knee / 2) ** 2) / (2 * knee);
    gr = target > gr ? target + (gr - target) * att : target + (gr - target) * rel;
    if (gr < 1e-12) gr = 0;
    if (gr === 0) continue;
    const g = 10 ** (-gr / 20);
    for (const ch of buf) ch[i]! *= g;
  }
  return buf;
}

/** The voice's band, carved out of the music while someone speaks. */
export const CARVE = { freq: 2000, q: 0.7, depth: 0.5 } as const;

/**
 * Carves the voice's band out of a bus in place: y = x − depth·amount·BP(x), with an RBJ
 * band-pass of constant 0 dB peak. Where `amount` (one value per sample, 0..1) is 1, the centre
 * sits `depth` lower (0.5: −6 dB) and frequencies far from it pass; where it is 0, the bus is
 * untouched. The filter runs on every sample, so the carve fades in and out without a click.
 */
export function voiceCarve(
  buf: Float32Array[],
  amount: Float32Array,
  o: { freq?: number; q?: number; depth?: number; sr?: number } = {},
): Float32Array[] {
  const sr = o.sr ?? DEFAULT_SR;
  const depth = o.depth ?? CARVE.depth;
  for (const ch of buf) {
    const band = new Biquad('bandpass', o.freq ?? CARVE.freq, o.q ?? CARVE.q, sr);
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]!;
      const b = band.process(x);
      const k = amount[i] ?? 0;
      if (k > 0) ch[i] = x - depth * k * b;
    }
  }
  return buf;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/dsp.test.ts packages/audio/test/library.test.ts && npx biome check --write packages/audio/src/dsp/fx.ts packages/audio/test/dsp.test.ts packages/audio/test/library.test.ts && npm run typecheck`
Expected: PASS. If the theme glue drop falls outside 0.5–4 dB, do not change the bound. Report the measured value: the spec pins it.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/audio/src/dsp/fx.ts packages/audio/test/dsp.test.ts packages/audio/test/library.test.ts && git commit -m "Add a glue compressor and a voice-band carve for the music bus" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 3: Smoothed, step-bounded placement

**Files:**
- Rewrite: `packages/audio/src/placement.ts`
- Modify: `packages/audio/src/index.ts` (placement exports)
- Rewrite: `packages/audio/test/placement.test.ts`

**Interfaces:**
- Consumes: `dbToGain` from `loudness.ts`.
- Produces (all exported from `placement.ts`):
  - `type Placement = 'continuous' | 'bookends'`, `type RampShape = 'cosine' | 'linear'`, `type Window = readonly [number, number]`
  - `interface PlacementParams { speechDb; gapDb; endsDb; down; up; gapRamp: RampShape; hold: number | null; maxStepDb }`
  - `PLACEMENT: Record<Placement, PlacementParams>`, set to:
    - continuous: speechDb −15, gapDb −8, endsDb −6, down 1.2, up 1.5, gapRamp `'cosine'`, hold 0.5, maxStepDb 5
    - bookends: speechDb −40, gapDb −11, endsDb −11, down 1.2, up 1.5, gapRamp `'linear'`, hold null, maxStepDb 5
  - `BED_DB = PLACEMENT.continuous.speechDb`. Effect levels are written against it.
  - `rampSeconds(depth: number, nominal: number, step: number, shape: RampShape): number`
  - `mergeSpeech(speech: readonly Window[], minGap: number): Array<[number, number]>` (unchanged behavior)
  - `swellingPauses(speech: readonly Window[], placement: Placement): Array<[number, number]>`. These are the pauses in which the music rises above the speech level.
  - `placementLevels(speech: readonly Window[], placement: Placement, options: { duration: number; sampleRate: number }): Float64Array`. The level in dB, one value per sample, length `ceil(duration·sampleRate)`.
  - `placementEnvelope(speech, placement, options): Float32Array`. The linear gain, the same signature as before.
  - `duckAmount(levels: Float64Array, placement: Placement): Float32Array`. 0 at the gap level or above, 1 at the speech level.
  - `clearOfSpeech(t: number, speech: readonly Window[], placement: Placement): boolean`. The same signature as before. True when the level at `t` is at or above `gapDb`.

- [ ] **Step 1: Write the failing tests**

Replace `packages/audio/test/placement.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/dsp/prng.ts';
import { dbfs } from '../src/loudness.ts';
import {
  BED_DB,
  clearOfSpeech,
  duckAmount,
  mergeSpeech,
  PLACEMENT,
  placementEnvelope,
  placementLevels,
  rampSeconds,
  swellingPauses,
} from '../src/placement.ts';

const SR = 1000; // a coarse rate keeps the arithmetic readable
const at = (levels: ArrayLike<number>, t: number) => levels[Math.round(t * SR)]!;
const SPEECH: Array<[number, number]> = [
  [2, 4],
  [10, 12],
];

describe('music placement', () => {
  it('matches the table: a ducked bed by default, bookends around the narration', () => {
    expect(PLACEMENT.continuous).toEqual({
      speechDb: -15,
      gapDb: -8,
      endsDb: -6,
      down: 1.2,
      up: 1.5,
      gapRamp: 'cosine',
      hold: 0.5,
      maxStepDb: 5,
    });
    expect(PLACEMENT.bookends).toEqual({
      speechDb: -40,
      gapDb: -11,
      endsDb: -11,
      down: 1.2,
      up: 1.5,
      gapRamp: 'linear',
      hold: null,
      maxStepDb: 5,
    });
    expect(BED_DB).toBe(PLACEMENT.continuous.speechDb);
  });

  it('lengthens a ramp until no second of it moves more than the step', () => {
    expect(rampSeconds(4, 1.2, 5, 'cosine')).toBe(1.2);
    // A raised cosine of D dB over T s moves D·sin(π/2T) in its steepest second.
    expect(rampSeconds(7, 1.2, 5, 'cosine')).toBeCloseTo(1.974, 3);
    expect(rampSeconds(7, 2.5, 5, 'cosine')).toBe(2.5);
    expect(rampSeconds(29, 1.5, 5, 'linear')).toBeCloseTo(5.8, 9);
  });

  it('ducks the bed under speech, swells in a long pause, and rises at the ends', () => {
    const lv = placementLevels(SPEECH, 'continuous', { duration: 16, sampleRate: SR });
    expect(lv.length).toBe(16 * SR);
    expect(at(lv, 0.5)).toBeCloseTo(-6, 9);
    // Halfway through the 1.2 s pre-roll into the first line, down by the time it starts.
    expect(at(lv, 1.4)).toBeCloseTo(-10.5, 1);
    expect(at(lv, 2)).toBeCloseTo(-15, 9);
    expect(at(lv, 3)).toBeCloseTo(-15, 9);
    // A 6 s pause rises over the lengthened ramp (1.974 s), holds, and comes back down.
    expect(at(lv, 4 + 1.974 / 2)).toBeCloseTo(-11.5, 1);
    expect(at(lv, 7)).toBeCloseTo(-8, 9);
    expect(at(lv, 10)).toBeCloseTo(-15, 9);
    // Halfway through the 1.5 s recovery after the last line.
    expect(at(lv, 12.75)).toBeCloseTo(-10.5, 1);
    expect(at(lv, 14)).toBeCloseTo(-6, 9);
    expect(dbfs(placementEnvelope(SPEECH, 'continuous', { duration: 16, sampleRate: SR })[3 * SR]!))
      .toBeCloseTo(-15, 4);
  });

  it('keeps a pause down unless it can reach the gap level and hold it for half a second', () => {
    const short: Array<[number, number]> = [
      [2, 4],
      [8, 10],
    ];
    expect(at(placementLevels(short, 'continuous', { duration: 12, sampleRate: SR }), 6)).toBeCloseTo(
      -15,
      9,
    );
    expect(swellingPauses(short, 'continuous')).toEqual([]);
    expect(swellingPauses(SPEECH, 'continuous')).toEqual([[4, 10]]);
  });

  it('never moves more than maxStepDb within a second between the first line and the last', () => {
    const random = mulberry32(7);
    for (const placement of ['continuous', 'bookends'] as const) {
      const p = PLACEMENT[placement];
      for (let trial = 0; trial < 40; trial++) {
        const speech: Array<[number, number]> = [];
        for (let t = 0.3 + random() * 2; t < 50; ) {
          const end = Math.min(56, t + 0.3 + random() * 5);
          speech.push([t, end]);
          t = end + 0.1 + random() * 7;
        }
        const lv = placementLevels(speech, placement, { duration: 60, sampleRate: SR });
        const first = Math.ceil(speech[0]![0] * SR);
        const last = Math.floor(speech.at(-1)![1] * SR);
        let worst = 0;
        for (let i = first; i + SR <= last; i++) worst = Math.max(worst, Math.abs(lv[i + SR]! - lv[i]!));
        expect(worst, `${placement} trial ${trial}`).toBeLessThanOrEqual(p.maxStepDb + 1e-6);
        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (const v of lv) {
          low = Math.min(low, v);
          high = Math.max(high, v);
        }
        expect(low).toBeGreaterThanOrEqual(p.speechDb - 1e-9);
        expect(high).toBeLessThanOrEqual(Math.max(p.gapDb, p.endsDb) + 1e-9);
        // Down whenever someone speaks.
        for (const [s, e] of speech)
          expect(at(lv, (s + e) / 2), `${placement} line ${s}`).toBeCloseTo(p.speechDb, 9);
      }
    }
  });

  it('swells bookends only as far as 5 dB per second reaches between lines', () => {
    const lv = placementLevels(
      [
        [2, 4],
        [5.2, 7],
        [15, 17],
      ],
      'bookends',
      { duration: 20, sampleRate: SR },
    );
    expect(at(lv, 0.5)).toBeCloseTo(-11, 9);
    expect(at(lv, 3)).toBeCloseTo(-40, 9);
    // A 1.2 s breath rises 3 dB and falls again; an 8 s pause reaches −20 in its middle.
    expect(at(lv, 4.6)).toBeCloseTo(-37, 6);
    expect(at(lv, 11)).toBeCloseTo(-20, 6);
    // Out of the last line over 1.5 s, raised cosine: −40 + 29·0.5 halfway.
    expect(at(lv, 17.75)).toBeCloseTo(-25.5, 1);
    expect(at(lv, 19)).toBeCloseTo(-11, 9);
  });

  it('holds the ends level throughout without narration', () => {
    for (const placement of ['continuous', 'bookends'] as const) {
      const lv = placementLevels([], placement, { duration: 3, sampleRate: SR });
      expect(Math.min(...lv)).toBe(PLACEMENT[placement].endsDb);
      expect(Math.max(...lv)).toBe(PLACEMENT[placement].endsDb);
    }
  });

  it('takes speech unsorted, overlapping, empty, or past either end', () => {
    const messy: Array<[number, number]> = [
      [10, 12],
      [2, 3],
      [2.5, 4],
      [6, 6],
      [-1, 0.2],
      [15, 30],
      [Number.NaN, 5],
    ];
    const clean: Array<[number, number]> = [
      [-1, 0.2],
      [2, 4],
      [10, 12],
      [15, 30],
    ];
    const a = placementLevels(messy, 'continuous', { duration: 20, sampleRate: SR });
    const b = placementLevels(clean, 'continuous', { duration: 20, sampleRate: SR });
    expect(a.length).toBe(20 * SR);
    expect([...a].every(Number.isFinite)).toBe(true);
    expect(a).toEqual(b);
  });

  it('knows when the music plays at a pause’s full level', () => {
    expect(clearOfSpeech(7, SPEECH, 'continuous')).toBe(true);
    expect(clearOfSpeech(3, SPEECH, 'continuous')).toBe(false);
    expect(clearOfSpeech(4.5, SPEECH, 'continuous')).toBe(false);
    expect(clearOfSpeech(0.5, SPEECH, 'continuous')).toBe(true);
    expect(clearOfSpeech(14, SPEECH, 'continuous')).toBe(true);
    expect(
      clearOfSpeech(
        6,
        [
          [2, 4],
          [8, 10],
        ],
        'continuous',
      ),
    ).toBe(false);
    expect(
      clearOfSpeech(
        4.6,
        [
          [2, 4],
          [5.2, 7],
        ],
        'bookends',
      ),
    ).toBe(false);
    expect(clearOfSpeech(2, [], 'bookends')).toBe(true);
  });

  it('says how far the music is ducked, for the carve to follow', () => {
    const lv = placementLevels(SPEECH, 'continuous', { duration: 16, sampleRate: SR });
    const duck = duckAmount(lv, 'continuous');
    expect(duck[3 * SR]).toBe(1);
    expect(duck[7 * SR]).toBe(0);
    expect(duck[Math.round(0.5 * SR)]).toBe(0);
    expect(duck[Math.round((4 + 1.974 / 2) * SR)]).toBeCloseTo(0.5, 2);
  });

  it('merges overlapping and nearby speech', () => {
    expect(
      mergeSpeech(
        [
          [5, 6],
          [1, 2],
          [2.3, 3],
          [2.5, 2.8],
        ],
        0.6,
      ),
    ).toEqual([
      [1, 3],
      [5, 6],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/placement.test.ts`
Expected: FAIL, because `BED_DB`, `duckAmount`, `placementLevels`, `rampSeconds`, and `swellingPauses` are not exported and the table differs.

- [ ] **Step 3: Implement**

Replace `packages/audio/src/placement.ts` with:

```ts
import { dbToGain } from './loudness.ts';

/*
 * Where music plays, as a level in dB over the music bus (already at the voice's loudness).
 *
 * Continuous, the default: a bed under the whole video. It sits 15 dB down while someone speaks,
 * 8 dB down in a pause long enough to rise and hold there for half a second (shorter pauses stay
 * down), and 6 dB down before the first line, after the last, and throughout without narration.
 * Bookends: music before the first line and after the last, effectively off under speech;
 * between lines it rises and falls at 5 dB a second, so a short breath barely moves it.
 *
 * A ramp into a line ends as the line starts, so the music is down when the voice begins; a ramp
 * out of one starts as it ends. The ramp into the first line and the one out of the last are
 * raised cosines of their nominal lengths: the opening and the ending may move faster, and QC
 * exempts them. Between the first line and the last, every ramp is long enough that the level
 * changes by at most `maxStepDb` within any second. There the level is the minimum of per-line
 * shapes that each keep that bound, and a minimum keeps it too, so it holds by construction.
 */

export type Placement = 'continuous' | 'bookends';
export type RampShape = 'cosine' | 'linear';
export type Window = readonly [number, number];

export interface PlacementParams {
  /** Music level while someone speaks (dB). */
  speechDb: number;
  /** Music level in a pause between lines that swells (dB). */
  gapDb: number;
  /** Music level before the first line, after the last, and throughout without narration (dB). */
  endsDb: number;
  /** Nominal ramp into a line, ending as it starts (s). */
  down: number;
  /** Nominal ramp out of a line, starting as it ends (s). */
  up: number;
  /** The shape of the ramps between lines, in dB. */
  gapRamp: RampShape;
  /**
   * How long a pause must hold the gap level to swell at all (s); shorter pauses stay at the
   * speech level. Null: every pause swells as far as its ramps reach.
   */
  hold: number | null;
  /** Between the first line and the last, the most the level changes within any second (dB). */
  maxStepDb: number;
}

export const PLACEMENT: Record<Placement, PlacementParams> = {
  continuous: {
    speechDb: -15,
    gapDb: -8,
    endsDb: -6,
    down: 1.2,
    up: 1.5,
    gapRamp: 'cosine',
    hold: 0.5,
    maxStepDb: 5,
  },
  bookends: {
    speechDb: -40,
    gapDb: -11,
    endsDb: -11,
    down: 1.2,
    up: 1.5,
    gapRamp: 'linear',
    hold: null,
    maxStepDb: 5,
  },
};

/**
 * The continuous bed's level under speech: what effect levels are written against
 * (templates/music/sound-effects.yml), whatever the placement and with no music at all.
 */
export const BED_DB = PLACEMENT.continuous.speechDb;

/** Lines closer than this are one stretch of speech (s). */
const MIN_PAUSE = 0.05;

/**
 * The shortest ramp of `depth` dB, at least `nominal` seconds, whose level changes by at most
 * `step` dB within any second: a raised cosine moves most in its middle, D·sin(π/2T) in a
 * second; a straight line D/T.
 */
export function rampSeconds(depth: number, nominal: number, step: number, shape: RampShape): number {
  if (depth <= step) return nominal;
  const needed = shape === 'linear' ? depth / step : Math.PI / (2 * Math.asin(step / depth));
  return Math.max(nominal, needed);
}

function shapeAt(shape: RampShape, k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return shape === 'linear' ? x : (1 - Math.cos(Math.PI * x)) / 2;
}

/** Sorts speech windows and merges those closer than `minGap`. */
export function mergeSpeech(speech: readonly Window[], minGap: number): Array<[number, number]> {
  const sorted = [...speech].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out.at(-1);
    if (last && start - last[1] < minGap) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** The ramps between lines, lengthened to keep the placement's step. */
function gapRamps(p: PlacementParams): { down: number; up: number } {
  const depth = p.gapDb - p.speechDb;
  return {
    down: rampSeconds(depth, p.down, p.maxStepDb, p.gapRamp),
    up: rampSeconds(depth, p.up, p.maxStepDb, p.gapRamp),
  };
}

/** The lines the music ducks under: valid speech, merged across pauses too short to swell. */
function placementLines(speech: readonly Window[], p: PlacementParams): Array<[number, number]> {
  const valid = speech.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  const ramps = gapRamps(p);
  const minGap = p.hold === null ? MIN_PAUSE : Math.max(MIN_PAUSE, ramps.up + p.hold + ramps.down);
  return mergeSpeech(valid, minGap);
}

/** The pauses between lines in which the music rises above the speech level. */
export function swellingPauses(
  speech: readonly Window[],
  placement: Placement,
): Array<[number, number]> {
  const lines = placementLines(speech, PLACEMENT[placement]);
  return lines.slice(1).map(([start], i): [number, number] => [lines[i]![1], start]);
}

/** The music's level in dB, one value per sample. */
export function placementLevels(
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sampleRate: number },
): Float64Array {
  const p = PLACEMENT[placement];
  const sr = options.sampleRate;
  const n = Math.ceil(options.duration * sr);
  const levels = new Float64Array(n).fill(p.endsDb);
  const lines = placementLines(speech, p);
  if (!lines.length) return levels;
  const ramps = gapRamps(p);
  const first = lines[0]![0];
  const last = lines.at(-1)![1];
  for (let i = Math.max(0, Math.ceil(first * sr)); i < Math.min(n, Math.floor(last * sr) + 1); i++)
    levels[i] = p.gapDb;
  lines.forEach(([start, end], j) => {
    const opening = j === 0;
    const closing = j === lines.length - 1;
    const into = {
      seconds: opening ? p.down : ramps.down,
      shape: (opening ? 'cosine' : p.gapRamp) as RampShape,
      from: opening ? p.endsDb : p.gapDb,
    };
    const out = {
      seconds: closing ? p.up : ramps.up,
      shape: (closing ? 'cosine' : p.gapRamp) as RampShape,
      to: closing ? p.endsDb : p.gapDb,
    };
    const a = Math.max(0, Math.floor((start - into.seconds) * sr));
    const b = Math.min(n, Math.ceil((end + out.seconds) * sr));
    for (let i = a; i < b; i++) {
      const t = i / sr;
      const db =
        t < start
          ? p.speechDb + (into.from - p.speechDb) * shapeAt(into.shape, (start - t) / into.seconds)
          : t <= end
            ? p.speechDb
            : p.speechDb + (out.to - p.speechDb) * shapeAt(out.shape, (t - end) / out.seconds);
      if (db < levels[i]!) levels[i] = db;
    }
  });
  return levels;
}

/** Per-sample linear gain for the music bus. */
export function placementEnvelope(
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sampleRate: number },
): Float32Array {
  return Float32Array.from(placementLevels(speech, placement, options), (db) => dbToGain(db));
}

/** How far the music is ducked at each sample: 0 at a pause's level or above, 1 at the speech level. */
export function duckAmount(levels: Float64Array, placement: Placement): Float32Array {
  const p = PLACEMENT[placement];
  const depth = p.gapDb - p.speechDb;
  return Float32Array.from(levels, (db) => Math.min(1, Math.max(0, (p.gapDb - db) / depth)));
}

/** Whether the music plays at a pause's full level (or above) at `t`. */
export function clearOfSpeech(t: number, speech: readonly Window[], placement: Placement): boolean {
  const sr = 1000;
  const levels = placementLevels(speech, placement, {
    duration: Math.max(0, t) + 2 / sr,
    sampleRate: sr,
  });
  const level = levels[Math.max(0, Math.round(t * sr))];
  return level !== undefined && level >= PLACEMENT[placement].gapDb - 1e-6;
}
```

In `packages/audio/src/index.ts`, replace the `./placement.ts` export block with:

```ts
export {
  BED_DB,
  clearOfSpeech,
  duckAmount,
  PLACEMENT,
  type Placement,
  type PlacementParams,
  placementEnvelope,
  placementLevels,
  type RampShape,
  rampSeconds,
  swellingPauses,
} from './placement.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/placement.test.ts && npx biome check --write packages/audio/src/placement.ts packages/audio/src/index.ts packages/audio/test/placement.test.ts && npm run typecheck`
Expected: PASS. `packages/audio/test/mix.test.ts` may now fail (the bed sits higher under speech). Task 5 rewrites those expectations, so leave them alone here.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/audio/src/placement.ts packages/audio/src/index.ts packages/audio/test/placement.test.ts && git commit -m "Place music on smoothed ramps that keep a per-second step" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 4: Effects relative to the bed, at least 8 dB under the voice

**Files:**
- Modify: `packages/audio/src/effects.ts`, `templates/music/sound-effects.yml`, `packages/audio/src/mix.ts`, `packages/audio/src/index.ts`
- Test: `packages/audio/test/effects.test.ts`, `packages/audio/test/library.test.ts`, `packages/audio/test/mix.test.ts`

**Interfaces:**
- Consumes: `BED_DB` from `placement.ts` (Task 3).
- Produces:
  - `placeEffects(cues, config)`, same signature. `PlacedEffect.gainDb` is now `BED_DB + config.gainDb + boost` (relative to the voice-normalized stems, as before).
  - `SoundEffectsSchema.gainDb`: `z.number().min(-20).max(12)`, relative to the bed.
  - `EFFECTS_UNDER_VOICE_DB = 8`, exported from `mix.ts` and `index.ts`.
  - `MixLevels.effectsCutDb?: number`. Set only when the mix lowered the effects.

- [ ] **Step 1: Write the failing tests**

In `packages/audio/test/effects.test.ts`:
- add `import { BED_DB } from '../src/placement.ts';`
- in the `config` object, change `gainDb: -14,` to `gainDb: 1,`
- replace each expected literal gain:
  - `[-14, -12]` → `[BED_DB + 1, BED_DB + 3]` (around line 76)
  - in `places every cue at the configured level`, `gainDb: -14` → `gainDb: BED_DB + 1` (twice) and `gainDb: -12` → `gainDb: BED_DB + 3`
  - `gainDb: -14` → `gainDb: BED_DB + 1` in `prefers a high-severity finding`
  - in `play swells 4 dB under the other effects`, `['transition', -18], ['riser', -18], ['hero', -14]` → `['transition', BED_DB - 3], ['riser', BED_DB - 3], ['hero', BED_DB + 1]`

Then add this test inside `describe('placeEffects', …)`:

```ts
  it('writes levels against the music bed, so they move with it', () => {
    const { placed } = placeEffects([cue(1, 'click')], { ...config, gainDb: -2 });
    expect(placed[0]!.gainDb).toBe(BED_DB - 2);
  });
```

In `packages/audio/test/library.test.ts`, in `loads and validates every patch…`, change `gainDb: -14,` to `gainDb: 1,`.

In `packages/audio/test/mix.test.ts`, change `expect(r.levels.effectsBelowVoiceDb!).toBeGreaterThanOrEqual(6);` to `toBeGreaterThanOrEqual(8);`, and add inside `describe('mixSound', …)`:

```ts
  it("lowers every effect together when one comes within 8 dB of the voice's peak", () => {
    const hot = mixSound(
      input({
        effects: [
          { t: 1, audio: click(), gainDb: 0 },
          { t: 3.5, audio: click(), gainDb: -6 },
        ],
      }),
    );
    expect(hot.levels.effectsBelowVoiceDb!).toBeGreaterThanOrEqual(EFFECTS_UNDER_VOICE_DB);
    expect(hot.levels.effectsBelowVoiceDb!).toBeCloseTo(EFFECTS_UNDER_VOICE_DB + 0.1, 1);
    expect(hot.levels.effectsCutDb!).toBeGreaterThan(0);
    const quiet = mixSound(input({ effects: [{ t: 1, audio: click(), gainDb: -40 }] }));
    expect(quiet.levels.effectsCutDb).toBeUndefined();
    // A silent effect has no peak: nothing to lower, nothing to report, nothing infinite.
    const silent = mixSound(
      input({ effects: [{ t: 1, audio: [new Float32Array(100), new Float32Array(100)], gainDb: 0 }] }),
    );
    expect(silent.levels.effectsBelowVoiceDb).toBeUndefined();
    expect(silent.levels.effectsCutDb).toBeUndefined();
  });
```

Also change the mix import line to `import { EFFECTS_UNDER_VOICE_DB, type MixInput, mixSound } from '../src/mix.ts';`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/effects.test.ts packages/audio/test/library.test.ts packages/audio/test/mix.test.ts -t "effect|loads and validates|lowers every effect"`
Expected: FAIL, because the gains are off by `BED_DB` and `EFFECTS_UNDER_VOICE_DB` is not exported.

- [ ] **Step 3: Implement**

`packages/audio/src/effects.ts`:
- add `import { BED_DB } from './placement.ts';` after the zod import
- in the header comment, replace `If an effect is noticeable, it is too loud: they sit well under the voice, swells lower still,` with `If an effect is noticeable, it is too loud: their levels are written against the music bed (the same with any placement, or with no music), swells lower still,`
- replace the `gainDb` field of `SoundEffectsSchema` with:

```ts
  /**
   * Level of every effect relative to the music bed's level under speech (dB; `BED_DB`), its
   * recipe at −3 dBFS. The mix lowers them all together if any comes within 8 dB of the voice.
   */
  gainDb: z.number().min(-20).max(12),
```

- in `PlacedEffect`, document the field: `/** Level relative to the voice-normalized stems (dB): the bed's, plus the configured offsets. */` above `gainDb: number;`
- in `placeEffects`, change `config.gainDb +` to `BED_DB + config.gainDb +`.

`templates/music/sound-effects.yml`: replace the two comment lines that begin `# gainDb is relative to the voice-normalized stems` and the `gainDb: -14` line with:

```yaml
# gainDb is relative to the music bed's level under speech (BED_DB in packages/audio/src/placement.ts:
# 15 dB under the voice-normalized stems), with every recipe rendered to a −3 dBFS peak. +1 puts an
# effect's peak about 10 dB under the voice's. Effects keep this level with any placement and
# without music, and the mix lowers them all together if any comes within 8 dB of the voice's peak.

gainDb: 1
```

`packages/audio/src/mix.ts`:
- after `export const TRUE_PEAK_MAX_DB = -1;` add:

```ts
/** Effects stay at least this far under the voice's peak (dB): the mix lowers them together. */
export const EFFECTS_UNDER_VOICE_DB = 8;
```

- in `MixLevels`, after `effectsBelowVoiceDb?: number;`, add:

```ts
  /** How far the mix lowered every effect together to keep them under the voice's peak (dB). */
  effectsCutDb?: number;
```

- replace the line `if (voice && effects) levels.effectsBelowVoiceDb = samplePeak([voice]) - samplePeak(effects);` with:

```ts
  if (voice && effects) {
    const voicePeak = samplePeak([voice]);
    const below = voicePeak - samplePeak(effects);
    if (Number.isFinite(below)) {
      if (below < EFFECTS_UNDER_VOICE_DB) {
        // A tenth of a dB of margin keeps float rounding from landing a hair under the floor.
        const cut = EFFECTS_UNDER_VOICE_DB + 0.1 - below;
        scale(effects, dbToGain(-cut));
        levels.effectsCutDb = cut;
      }
      levels.effectsBelowVoiceDb = voicePeak - samplePeak(effects);
    }
  }
```

- in the header comment, replace `and effects sit at fixed levels below the voice.` with `effects sit at levels written against the bed, lowered together if any comes within 8 dB of the voice's peak.`

`packages/audio/src/index.ts`: add `EFFECTS_UNDER_VOICE_DB,` to the `./mix.ts` export block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/effects.test.ts packages/audio/test/library.test.ts packages/audio/test/sfx.test.ts && npx vitest run packages/audio/test/mix.test.ts -t "lowers every effect|only limits|nothing to play|deterministic" && npx biome check --write packages/audio/src/effects.ts packages/audio/src/mix.ts packages/audio/src/index.ts packages/audio/test/effects.test.ts packages/audio/test/library.test.ts packages/audio/test/mix.test.ts && npm run typecheck`
Expected: PASS. The other `mix.test.ts` cases are rewritten in Task 5.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/audio/src/effects.ts packages/audio/src/mix.ts packages/audio/src/index.ts templates/music/sound-effects.yml packages/audio/test/effects.test.ts packages/audio/test/library.test.ts packages/audio/test/mix.test.ts && git commit -m "Set effect levels against the music bed and keep them 8 dB under the voice" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 5: The music bus, the jump guard, and the new levels

**Files:**
- Rewrite: `packages/audio/src/mix.ts`
- Modify: `packages/audio/src/library.ts:16` (`AUDIO_ENGINE_VERSION`), `packages/audio/src/index.ts`
- Test: `packages/audio/test/mix.test.ts`, `packages/audio/test/library.test.ts:90`, `tests/render/render.test.ts:1690`

**Interfaces:**
- Consumes:
  - from Task 1: `momentaryLoudness`, `largestJump`, `loudnessRange`, `Jump`
  - from Task 2: `glueCompressor`, `voiceCarve`
  - from Task 3: `placementLevels`, `duckAmount`, `swellingPauses`, `Placement`, `Window`
  - from Task 4: `EFFECTS_UNDER_VOICE_DB` and the cap
- Produces (from `mix.ts`, also exported from `index.ts`):
  - `MUSIC_JUMP_DB = 6`
  - `EXEMPT = { opening: 1, hero: 1.5, ending: 0.5 } as const`
  - `musicExemptWindows(input: { speech: readonly Window[]; hero?: number; duration: number }): Array<[number, number]>`. Returns `[[0, duration]]` without speech.
  - `MixInput.hero?: number`, the hero's downbeat in video time.
  - `MixLevels` gains `musicRangeLu?: number`, `musicJumps?: Jump & { exempt: Array<[number, number]> }`, and `pausesHeld?: number`.
  - `MixResult.musicLines?: Array<[number, number]>`: the speech windows plus any pause held down.
  - `AUDIO_ENGINE_VERSION = 'covi-audio-4'`

- [ ] **Step 1: Write the failing tests**

Replace `packages/audio/test/mix.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { hashOf } from '../src/hash.ts';
import { integratedLoudness, samplePeak, truePeak, weightedLevel } from '../src/loudness.ts';
import {
  EFFECTS_UNDER_VOICE_DB,
  type MixInput,
  MUSIC_JUMP_DB,
  mixSound,
  musicExemptWindows,
} from '../src/mix.ts';

const SR = 48_000;
const D = 5;

/** Speech-like bursts: a voiced tone with syllable-rate amplitude, inside each window. */
function voice(windows: Array<[number, number]>, level = 0.3, seconds = D): Float32Array {
  const out = new Float32Array(seconds * SR);
  for (const [s, e] of windows)
    for (let i = Math.round(s * SR); i < Math.round(e * SR); i++) {
      const t = i / SR;
      const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.3 * t);
      out[i] =
        level *
        syllable *
        (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 900 * t + 0.3));
    }
  return out;
}

/** A steady chord bed, the stand-in for rendered music; each step raises it by dB from a time on. */
function music(seconds = D, steps: Array<[number, number]> = []): Float32Array[] {
  const l = new Float32Array(seconds * SR);
  for (let i = 0; i < l.length; i++) {
    const t = i / SR;
    const db = steps.reduce((sum, [from, change]) => (t >= from ? sum + change : sum), 0);
    l[i] =
      0.12 *
      10 ** (db / 20) *
      (Math.sin(2 * Math.PI * 155.6 * t) +
        Math.sin(2 * Math.PI * 196 * t) +
        Math.sin(2 * Math.PI * 233.1 * t) +
        0.6 * Math.sin(2 * Math.PI * 77.8 * t));
  }
  return [l, l.slice()];
}

/** One sine as the music, to hear what the carve takes from one frequency. */
function sineMusic(freq: number): Float32Array[] {
  const l = Float32Array.from({ length: D * SR }, (_, i) => 0.3 * Math.sin((2 * Math.PI * freq * i) / SR));
  return [l, l.slice()];
}

function click(): Float32Array[] {
  const x = new Float32Array(Math.round(0.08 * SR));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.9) * Math.exp(-i / (0.01 * SR));
  const peak = Math.max(...x.map(Math.abs));
  for (let i = 0; i < x.length; i++) x[i] = (x[i]! / peak) * 10 ** (-3 / 20);
  return [x, x.slice()];
}

const SPEECH: Array<[number, number]> = [
  [0.4, 2.0],
  [2.8, 4.5],
];

const input = (overrides: Partial<MixInput> = {}): MixInput => ({
  sampleRate: SR,
  duration: D,
  voice: voice(SPEECH),
  speech: SPEECH,
  music: music(),
  placement: 'continuous',
  effects: [
    { t: 1, audio: click(), gainDb: -14 },
    { t: 3.5, audio: click(), gainDb: -12 },
  ],
  ...overrides,
});

/** A 20 s video with a 6 s pause between two lines. */
const PAUSE: Array<[number, number]> = [
  [0.5, 5],
  [11, 18],
];
const long = (overrides: Partial<MixInput> = {}) =>
  input({ duration: 20, voice: voice(PAUSE, 0.3, 20), speech: PAUSE, music: music(20), effects: [], ...overrides });

describe('mixSound', () => {
  it('masters a narrated video to −16 LUFS under −1 dBTP with the bed 12–20 dB under the voice', () => {
    const r = mixSound(input());
    expect(r.target).toBe(-16);
    expect(Math.abs(r.levels.master!.integrated + 16)).toBeLessThanOrEqual(0.5);
    expect(r.levels.master!.truePeak).toBeLessThanOrEqual(-1);
    expect(r.levels.voiceLufs).toBeCloseTo(-16, 1);
    expect(r.levels.musicBelowVoiceDb!).toBeGreaterThanOrEqual(12);
    expect(r.levels.musicBelowVoiceDb!).toBeLessThanOrEqual(20);
    expect(r.levels.effectsBelowVoiceDb!).toBeGreaterThanOrEqual(EFFECTS_UNDER_VOICE_DB);
    expect(r.master![0]!.length).toBe(D * SR);
    // The voice stem is normalized as heard: the same signal on both channels.
    expect(integratedLoudness([r.voice!, r.voice!], SR)).toBeCloseTo(-16, 1);
  });

  it('keeps the music effectively off under speech for bookends', () => {
    const r = mixSound(input({ placement: 'bookends' }));
    expect(r.levels.musicBelowVoiceDb!).toBeGreaterThanOrEqual(30);
  });

  it("carves the voice's band out of the music while someone speaks", () => {
    const below = (freq: number) =>
      mixSound(input({ music: sineMusic(freq), effects: [] })).levels.musicBelowVoiceDb!;
    // Both bring the music to the same loudness; 2 kHz sits in the carve's centre (−6 dB).
    expect(below(2000) - below(200)).toBeCloseTo(6, 0);
  });

  it("measures the music's range over the narration and its largest jump outside the exempt windows", () => {
    const speech: Array<[number, number]> = [
      [0.5, 6],
      [6.6, 12],
      [12.6, 18],
    ];
    const r = mixSound(long({ voice: voice(speech, 0.3, 20), speech, hero: 9 }));
    expect(r.levels.musicJumps!.exempt).toEqual([
      [0, 1.5],
      [7.5, 10.5],
      [17.5, 20],
    ]);
    expect(r.levels.musicJumps!.maxDb).toBeLessThan(1);
    expect(r.levels.musicRangeLu!).toBeLessThan(1);
    expect(r.levels.pausesHeld).toBeUndefined();
  });

  it('swells in a long pause when the music is steady, within the jump limit', () => {
    const r = mixSound(long());
    expect(r.levels.pausesHeld).toBeUndefined();
    const lift =
      weightedLevel(r.music!, SR, [[7.5, 8.5]]) - weightedLevel(r.music!, SR, [[2, 3]]);
    expect(lift).toBeCloseTo(7, 0);
    expect(r.levels.musicJumps!.maxDb).toBeGreaterThan(4);
    expect(r.levels.musicJumps!.maxDb).toBeLessThanOrEqual(MUSIC_JUMP_DB - 0.5);
  });

  it('holds a pause at the speech level when its swell would make the music jump', () => {
    // The music itself steps up 6 dB 1.2 s into the pause, where the swell is steepest.
    const r = mixSound(long({ music: music(20, [[6.2, 6]]) }));
    expect(r.levels.pausesHeld).toBe(1);
    expect(r.musicLines).toContainEqual([5, 11]);
    // Held, the pause plays at the bed's level: only the music's own step is left (the glue halves it).
    expect(r.levels.musicJumps!.maxDb).toBeGreaterThan(2);
    expect(r.levels.musicJumps!.maxDb).toBeLessThan(4);
    const lift = weightedLevel(r.music!, SR, [[8, 9]]) - weightedLevel(r.music!, SR, [[13, 14]]);
    expect(Math.abs(lift)).toBeLessThan(0.5);
  });

  it('measures no range under 3 s of narration, and no jump where every window is exempt', () => {
    const short = mixSound(input({ speech: [[0.5, 2]], voice: voice([[0.5, 2]]), effects: [] }));
    expect(short.levels.musicRangeLu).toBeUndefined();
    const covered = mixSound(
      input({ speech: [[0.5, 1.2]], voice: voice([[0.5, 1.2]]), hero: 0.8, effects: [] }),
    );
    expect(covered.levels.musicJumps).toBeUndefined();
    expect(covered.levels.musicBelowVoiceDb).toBeDefined();
  });

  it('names the windows where the music may move faster', () => {
    expect(musicExemptWindows({ speech: [[0.5, 6], [7, 18]], hero: 9, duration: 20 })).toEqual([
      [0, 1.5],
      [7.5, 10.5],
      [17.5, 20],
    ]);
    expect(musicExemptWindows({ speech: [], duration: 20 })).toEqual([[0, 20]]);
  });

  it('masters music without narration to −20 LUFS, measuring nothing about the bed', () => {
    const r = mixSound(input({ voice: undefined, speech: [] }));
    expect(r.target).toBe(-20);
    expect(Math.abs(r.levels.master!.integrated + 20)).toBeLessThanOrEqual(0.5);
    expect(r.levels.musicBelowVoiceDb).toBeUndefined();
    expect(r.levels.musicJumps).toBeUndefined();
    expect(r.levels.musicRangeLu).toBeUndefined();
    expect(r.musicLines).toBeUndefined();
  });

  it('masters narration alone too, so every narrated video has the same loudness', () => {
    const r = mixSound(input({ music: undefined, effects: [] }));
    expect(Math.abs(r.levels.master!.integrated + 16)).toBeLessThanOrEqual(0.5);
    expect(r.music).toBeUndefined();
  });

  it('only limits effects that play alone', () => {
    const r = mixSound(input({ voice: undefined, speech: [], music: undefined }));
    expect(r.target).toBeUndefined();
    expect(samplePeak(r.master!)).toBeCloseTo(-3 - 12, 1);
    expect(truePeak(r.master!, SR)).toBeLessThanOrEqual(-1);
  });

  it('has nothing to play when every layer is off', () => {
    const r = mixSound(input({ voice: undefined, speech: [], music: undefined, effects: [] }));
    expect(r.master).toBeUndefined();
  });

  it("lowers every effect together when one comes within 8 dB of the voice's peak", () => {
    const hot = mixSound(
      input({
        effects: [
          { t: 1, audio: click(), gainDb: 0 },
          { t: 3.5, audio: click(), gainDb: -6 },
        ],
      }),
    );
    expect(hot.levels.effectsBelowVoiceDb!).toBeGreaterThanOrEqual(EFFECTS_UNDER_VOICE_DB);
    expect(hot.levels.effectsBelowVoiceDb!).toBeCloseTo(EFFECTS_UNDER_VOICE_DB + 0.1, 1);
    expect(hot.levels.effectsCutDb!).toBeGreaterThan(0);
    const quiet = mixSound(input({ effects: [{ t: 1, audio: click(), gainDb: -40 }] }));
    expect(quiet.levels.effectsCutDb).toBeUndefined();
    const silent = mixSound(
      input({ effects: [{ t: 1, audio: [new Float32Array(100), new Float32Array(100)], gainDb: 0 }] }),
    );
    expect(silent.levels.effectsBelowVoiceDb).toBeUndefined();
    expect(silent.levels.effectsCutDb).toBeUndefined();
  });

  it('is byte-for-byte deterministic, guard and all', () => {
    const a = mixSound(long({ music: music(20, [[6.2, 6]]) }));
    const b = mixSound(long({ music: music(20, [[6.2, 6]]) }));
    expect(hashOf(a.master![0]!, a.master![1]!)).toBe(hashOf(b.master![0]!, b.master![1]!));
    expect(hashOf(a.music![0]!, a.music![1]!)).toBe(hashOf(b.music![0]!, b.music![1]!));
  });
});
```

In `packages/audio/test/library.test.ts`, change the engine test to:

```ts
  it('is a new engine: the mix changed (bus, carve, placement, effect levels)', () => {
    expect(AUDIO_ENGINE_VERSION).toBe('covi-audio-4');
  });
```

In `tests/render/render.test.ts`, change `expect(audio.engine).toBe('covi-audio-3');` to `expect(audio.engine).toBe('covi-audio-4');` (around line 1690).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio/test/mix.test.ts packages/audio/test/library.test.ts`
Expected: FAIL, because `MUSIC_JUMP_DB` and `musicExemptWindows` are not exported, `musicJumps` and `musicRangeLu` are undefined, and the engine is still `covi-audio-3`.

- [ ] **Step 3: Implement**

Replace `packages/audio/src/mix.ts` with:

```ts
import { glueCompressor, limiter, mixInto, stereo, voiceCarve } from './dsp/fx.ts';
import {
  dbToGain,
  integratedLoudness,
  type Jump,
  largestJump,
  loudnessRange,
  measureLoudness,
  momentaryLoudness,
  samplePeak,
  weightedLevel,
} from './loudness.ts';
import {
  duckAmount,
  type Placement,
  placementLevels,
  swellingPauses,
  type Window,
} from './placement.ts';

/*
 * The narration-first mix. The voice is brought to −16 LUFS. The music becomes a bus: brought to
 * −16 LUFS, glued by a gentle compressor, and brought to −16 LUFS again; then, while someone
 * speaks, the voice's band (about 1–4 kHz) is carved out of it, and its level follows the
 * placement. The music never jumps: outside the opening, the hero, and the ending, its momentary
 * loudness changes by at most 6 dB within a second. A pause whose swell, added to the music's own
 * movement, would come within half a dB of that stays at the speech level, and the music is
 * placed again. Effects sit at levels written against the bed, lowered together if any comes
 * within 8 dB of the voice's peak. The master then gets linear gain to its target and a
 * deterministic lookahead limiter at −1.5 dBFS, up to three times, until it is within ±0.5 LU of
 * the target with a true peak at or below −1 dBTP. A linear gain plus a limiter, rather than
 * ffmpeg's loudnorm, because loudnorm silently turns dynamic when linear gain would break its
 * peak target.
 */

export const STEM_LUFS = -16;
/** Narrated videos, and music without narration; effects alone are only limited. */
export const MASTER_LUFS = { narrated: -16, music: -20 } as const;
export const CEILING_DB = -1.5;
export const TRUE_PEAK_MAX_DB = -1;
/** Effects stay at least this far under the voice's peak (dB): the mix lowers them together. */
export const EFFECTS_UNDER_VOICE_DB = 8;
/** The most the music's momentary loudness may change within 1 s outside the exempt windows (dB). */
export const MUSIC_JUMP_DB = 6;
/** A pause whose swell would bring the music this close to the limit stays down (dB). */
const JUMP_MARGIN_DB = 0.5;
/**
 * Where the music may move faster (s): the opening, until 1 s after the first line starts; the
 * hero, 1.5 s either side of its downbeat; the ending, from 0.5 s before the last line ends.
 */
export const EXEMPT = { opening: 1, hero: 1.5, ending: 0.5 } as const;
/** A 400 ms window up to 1 s from one that a pause moved can pair with it (s). */
const PAUSE_REACH = 1.4;
const TOLERANCE_LU = 0.5;
const PASSES = 3;

export interface MixInput {
  sampleRate: number;
  /** The video's length in seconds. */
  duration: number;
  /** The narration, mono and already placed (the samples of video/narration.wav). */
  voice?: Float32Array;
  /** Where someone speaks, in seconds: for placement and for levels. */
  speech: ReadonlyArray<readonly [number, number]>;
  /** The rendered music, stereo and as long as the video, before any level change. */
  music?: Float32Array[];
  placement: Placement;
  /** The hero's downbeat (s), where the music lifts: exempt from the jump limit. */
  hero?: number;
  /** Effects at their cue times, each recipe at −3 dBFS peak, played at `gainDb`. */
  effects: ReadonlyArray<{ t: number; audio: Float32Array[]; gainDb: number }>;
}

export interface MixLevels {
  /** The voice stem's integrated loudness, as heard on both channels. */
  voiceLufs?: number;
  /** How far the music sits under the voice where someone speaks (K-weighted RMS, dB). */
  musicBelowVoiceDb?: number;
  /** The music's loudness range from the first line's start to the last line's end (LU). */
  musicRangeLu?: number;
  /** The largest change of the music's momentary loudness within 1 s, outside `exempt`. */
  musicJumps?: Jump & { exempt: Array<[number, number]> };
  /** Pauses kept at the speech level because swelling in them would have made the music jump. */
  pausesHeld?: number;
  /** How far the loudest effect sits under the voice's peak (dB). */
  effectsBelowVoiceDb?: number;
  /** How far the mix lowered every effect together to keep them under the voice's peak (dB). */
  effectsCutDb?: number;
  master?: { integrated: number; truePeak: number };
}

export interface MixResult {
  /** The master, stereo; undefined when nothing plays. */
  master?: Float32Array[];
  /** The voice stem at −16 LUFS (mono). */
  voice?: Float32Array;
  /** The music stem after placement (stereo). */
  music?: Float32Array[];
  /** What the music was placed under as speech: the narration's lines and any pause held down. */
  musicLines?: Array<[number, number]>;
  levels: MixLevels;
  /** The master's loudness target, when it has one. */
  target?: number;
}

function scale(channels: readonly Float32Array[], gain: number): void {
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= gain;
}

/**
 * The narration at −16 LUFS, measured as heard: the mono voice plays on both channels of the
 * master, so it is measured as that pair. Returns a new array; silence stays silence.
 */
export function normalizeVoice(voice: Float32Array, sampleRate: number): Float32Array {
  const out = Float32Array.from(voice);
  const loudness = integratedLoudness([out, out], sampleRate);
  if (Number.isFinite(loudness)) scale([out], dbToGain(STEM_LUFS - loudness));
  return out;
}

/** The first line's start and the last line's end; undefined without speech. */
function speechSpan(speech: readonly Window[]): [number, number] | undefined {
  const valid = speech.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  if (!valid.length) return undefined;
  return [Math.min(...valid.map(([s]) => s)), Math.max(...valid.map(([, e]) => e))];
}

/** Where the music may move faster than `MUSIC_JUMP_DB`: the whole video without speech. */
export function musicExemptWindows(input: {
  speech: readonly Window[];
  hero?: number;
  duration: number;
}): Array<[number, number]> {
  const span = speechSpan(input.speech);
  if (!span) return [[0, input.duration]];
  const windows: Array<[number, number]> = [[0, span[0] + EXEMPT.opening]];
  if (input.hero !== undefined) windows.push([input.hero - EXEMPT.hero, input.hero + EXEMPT.hero]);
  windows.push([span[1] - EXEMPT.ending, input.duration]);
  return windows;
}

/** The music bus before placement: at −16 LUFS, glued, at −16 LUFS again; undefined when silent. */
function musicBus(music: Float32Array[], n: number, sr: number): Float32Array[] | undefined {
  const bus = stereo(n);
  mixInto(bus, music, 0);
  const loudness = integratedLoudness(bus, sr);
  if (!Number.isFinite(loudness)) return undefined;
  scale(bus, dbToGain(STEM_LUFS - loudness));
  glueCompressor(bus, { sr });
  const glued = integratedLoudness(bus, sr);
  if (!Number.isFinite(glued)) return undefined;
  scale(bus, dbToGain(STEM_LUFS - glued));
  return bus;
}

/** The bus placed under `lines`: the voice's band carved as far as it is ducked, then the level. */
function placeMusic(
  bus: readonly Float32Array[],
  lines: readonly Window[],
  placement: Placement,
  duration: number,
  sr: number,
): Float32Array[] {
  const levels = placementLevels(lines, placement, { duration, sampleRate: sr });
  const placed = bus.map((c) => Float32Array.from(c));
  voiceCarve(placed, duckAmount(levels, placement), { sr });
  const gain = Float32Array.from(levels, (db) => dbToGain(db));
  for (const c of placed) for (let i = 0; i < c.length; i++) c[i]! *= gain[i]!;
  return placed;
}

/**
 * Places the music, then holds at the speech level every pause in which it would jump: a swell's
 * ramp adding to the music's own movement past the limit, less a margin. Each round holds at least
 * one more pause, and a held pause merges with the lines around it, so the rounds end.
 */
function placeWithoutJumps(
  bus: readonly Float32Array[],
  speech: readonly Window[],
  placement: Placement,
  options: { duration: number; sr: number; exempt: ReadonlyArray<readonly [number, number]> },
): { music: Float32Array[]; momentary: Float64Array; lines: Array<[number, number]>; held: number } {
  let lines = speech.map(([s, e]): [number, number] => [s, e]);
  let held = 0;
  for (;;) {
    const music = placeMusic(bus, lines, placement, options.duration, options.sr);
    const momentary = momentaryLoudness(music, options.sr);
    const jumpy = swellingPauses(lines, placement).filter(([a, b]) => {
      const jump = largestJump(momentary, {
        exempt: [
          ...options.exempt,
          [Number.NEGATIVE_INFINITY, a - PAUSE_REACH],
          [b + PAUSE_REACH, Number.POSITIVE_INFINITY],
        ],
      });
      return jump !== undefined && jump.maxDb > MUSIC_JUMP_DB - JUMP_MARGIN_DB;
    });
    if (!jumpy.length) return { music, momentary, lines, held };
    lines = [...lines, ...jumpy];
    held += jumpy.length;
  }
}

export function mixSound(input: MixInput): MixResult {
  const sr = input.sampleRate;
  const n = Math.ceil(input.duration * sr);
  const levels: MixLevels = {};

  let voice: Float32Array | undefined;
  if (input.voice) {
    const placed = new Float32Array(n);
    placed.set(input.voice.subarray(0, n));
    voice = normalizeVoice(placed, sr);
    levels.voiceLufs = integratedLoudness([voice, voice], sr);
    if (!Number.isFinite(levels.voiceLufs)) {
      voice = undefined;
      delete levels.voiceLufs;
    }
  }

  let music: Float32Array[] | undefined;
  let musicLines: Array<[number, number]> | undefined;
  const bus = input.music ? musicBus(input.music, n, sr) : undefined;
  if (bus) {
    const speech = voice ? input.speech : [];
    const span = speechSpan(speech);
    if (span) {
      const exempt = musicExemptWindows({ speech, hero: input.hero, duration: input.duration });
      const placed = placeWithoutJumps(bus, speech, input.placement, {
        duration: input.duration,
        sr,
        exempt,
      });
      music = placed.music;
      musicLines = placed.lines;
      if (placed.held) levels.pausesHeld = placed.held;
      const range = loudnessRange(music, sr, span);
      if (range !== undefined) levels.musicRangeLu = range;
      const jump = largestJump(placed.momentary, { exempt });
      if (jump) levels.musicJumps = { ...jump, exempt };
    } else music = placeMusic(bus, [], input.placement, input.duration, sr);
  }

  let effects: Float32Array[] | undefined;
  for (const e of input.effects) {
    effects ??= stereo(n);
    mixInto(effects, e.audio, Math.round(e.t * sr), dbToGain(e.gainDb));
  }
  if (voice && effects) {
    const voicePeak = samplePeak([voice]);
    const below = voicePeak - samplePeak(effects);
    if (Number.isFinite(below)) {
      if (below < EFFECTS_UNDER_VOICE_DB) {
        // A tenth of a dB of margin keeps float rounding from landing a hair under the floor.
        const cut = EFFECTS_UNDER_VOICE_DB + 0.1 - below;
        scale(effects, dbToGain(-cut));
        levels.effectsCutDb = cut;
      }
      levels.effectsBelowVoiceDb = voicePeak - samplePeak(effects);
    }
  }

  if (voice && music && input.speech.length)
    levels.musicBelowVoiceDb =
      weightedLevel([voice, voice], sr, input.speech) - weightedLevel(music, sr, input.speech);

  if (!voice && !music && !effects) return { levels };
  const master = stereo(n);
  if (voice) mixInto(master, [voice], 0);
  if (music) mixInto(master, music, 0);
  if (effects) mixInto(master, effects, 0);

  const target = voice ? MASTER_LUFS.narrated : music ? MASTER_LUFS.music : undefined;
  if (target === undefined) {
    limiter(master, CEILING_DB, { sr });
  } else {
    let ceiling = CEILING_DB;
    for (let pass = 0; pass < PASSES; pass++) {
      const before = integratedLoudness(master, sr);
      if (!Number.isFinite(before)) break;
      scale(master, dbToGain(target - before));
      limiter(master, ceiling, { sr });
      const after = measureLoudness(master, sr);
      if (Math.abs(after.integrated - target) <= TOLERANCE_LU && after.truePeak <= TRUE_PEAK_MAX_DB)
        break;
      // Peaks between samples can pass a sample-peak limiter: lower its ceiling by the overshoot.
      if (after.truePeak > TRUE_PEAK_MAX_DB) ceiling -= after.truePeak - TRUE_PEAK_MAX_DB + 0.1;
    }
  }
  const measured = measureLoudness(master, sr);
  levels.master = { integrated: measured.integrated, truePeak: measured.truePeak };
  return { master, voice, music, ...(musicLines ? { musicLines } : {}), levels, target };
}
```

`packages/audio/src/library.ts`: change `export const AUDIO_ENGINE_VERSION = 'covi-audio-3';` to `'covi-audio-4'`.

`packages/audio/src/index.ts`: replace the `./mix.ts` export block with:

```ts
export {
  CEILING_DB,
  EFFECTS_UNDER_VOICE_DB,
  EXEMPT,
  MASTER_LUFS,
  MUSIC_JUMP_DB,
  type MixInput,
  type MixLevels,
  type MixResult,
  mixSound,
  musicExemptWindows,
  normalizeVoice,
  STEM_LUFS,
  TRUE_PEAK_MAX_DB,
} from './mix.ts';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/audio && npx biome check --write packages/audio tests/render/render.test.ts && npm run typecheck`
Expected: PASS for the whole audio package.
- If `swells in a long pause` reports `maxDb` above 5.5, the ramp lengthening in Task 3 is wrong; fix it there, not here.
- If `carves the voice's band` lands outside 5.5–6.5 dB, the duck amount under speech is not 1.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/audio/src/mix.ts packages/audio/src/library.ts packages/audio/src/index.ts packages/audio/test/mix.test.ts packages/audio/test/library.test.ts tests/render/render.test.ts && git commit -m "Mix the music as a glued, voice-carved bus that never jumps" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 6: Continuous by default, wired through the video pipeline

**Files:**
- Modify: `packages/video/src/sound.ts` (the `mix` closure in `produceSound`, `hero.clear`, `roundLevels`)
- Modify: `packages/video/src/spec.ts:47-53` (comment), `:502-509` (placement), `:621-651` (music question), `:791-797` (planVideo)
- Modify: `templates/i18n/en.yml`, `ko.yml`, `ja.yml`, `zh.yml` (`question.music.where`)
- Modify: `packages/core/src/config/schema.ts:30-33`, `:258-263`, and `packages/cli/src/main.ts:355`
- Test: `packages/video/test/spec.test.ts`; create `packages/video/test/sound-levels.test.ts`

**Interfaces:**
- Consumes (from `@covi/audio`, Task 5):
  - `MixInput.hero`
  - `MixResult.musicLines`
  - `MixLevels.musicRangeLu`, `musicJumps`, `pausesHeld`, `effectsCutDb`
  - `clearOfSpeech(t, speech, placement)`
- Produces:
  - `resolveVideoSpec(...).music.placement` is `'continuous'` whenever the setting is `'auto'`.
  - `video/audio.json` `levels` carries:
    - `musicRangeLu` (2 decimals)
    - `musicJumps { maxDb (2 decimals), at (2), exempt (4) }`
    - `pausesHeld`
    - `effectsCutDb` (2)

- [ ] **Step 1: Write the failing tests**

Create `packages/video/test/sound-levels.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, Redactor, Run, silentLogger } from '@covi/core';
import { afterEach, describe, expect, it } from 'vitest';
import { produceSound, themeScore } from '../src/sound.ts';
import { resolveVideoSpec } from '../src/spec.ts';
import type { Timeline } from '../src/timeline/types.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SR = 48_000;
const SPEECH: Array<[number, number]> = [
  [0.3, 4.5],
  [5.1, 11],
];
const timeline = {
  duration: 12,
  scenes: [
    {
      id: 's1',
      beat: 'summary',
      eyebrow: 'Summary',
      start: 0,
      end: 11.5,
      visual: { kind: 'summary', verdict: 'looks-good', headline: 'h', points: [] },
      expression: 'success',
      narrator: false,
      speech: { start: 0.3, end: 11, text: 'x' },
    },
  ],
  cues: [],
} as unknown as Timeline;

async function sound(narrated: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'covi-levels-'));
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
  const voice = new Float32Array(12 * SR);
  for (const [s, e] of SPEECH)
    for (let i = Math.round(s * SR); i < Math.round(e * SR); i++)
      voice[i] =
        0.2 *
        (0.55 + 0.45 * Math.sin((2 * Math.PI * 4.3 * i) / SR)) *
        Math.sin((2 * Math.PI * 220 * i) / SR);
  const result = await produceSound(
    {
      run,
      spec: resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard' }),
      timeline,
      storyboard: { template: 'quick-review' },
      ...(narrated ? { voice, speech: SPEECH } : { speech: [] }),
      cacheDir: join(root, '.covi', 'cache'),
      logger: silentLogger,
    },
    { score: themeScore(), source: 'theme', reason: 'The Covi theme.' },
  );
  return { run, result };
}

describe('the sound record', () => {
  it('lays a standard review on the continuous bed and records how the music moved', async () => {
    const { run, result } = await sound(true);
    const { music, levels } = result.record;
    expect(music.placement).toBe('continuous');
    expect(levels.musicJumps!.exempt[0]).toEqual([0, 1.3]);
    expect(levels.musicJumps!.exempt.at(-1)).toEqual([10.5, 12]);
    expect(levels.musicJumps!.maxDb).toBeLessThanOrEqual(6);
    expect(levels.musicRangeLu!).toBeGreaterThanOrEqual(0);
    expect(levels.musicRangeLu!).toBeLessThanOrEqual(8);
    // What QC reads holds numbers only: JSON has no −Infinity or NaN.
    const written = JSON.parse(readFileSync(run.path('video/audio.json'), 'utf8'));
    expect(JSON.stringify(written.levels)).not.toMatch(/null/);
    expect(written.levels.musicJumps.maxDb).toBe(levels.musicJumps!.maxDb);
  });

  it('measures nothing about the bed when no one speaks', async () => {
    const { result } = await sound(false);
    expect(result.record.levels.musicJumps).toBeUndefined();
    expect(result.record.levels.musicRangeLu).toBeUndefined();
  });
});
```

In `packages/video/test/spec.test.ts`, make these edits:

1. Replace the whole `it('places music by the kind of video', …)` block (around lines 323–334) with:

```ts
  it('lays a continuous bed under every kind of video', () => {
    const place = (request: Parameters<typeof resolveVideoSpec>[1]) =>
      resolveVideoSpec(config(), request).music.placement;
    for (const request of [
      { mode: 'short' },
      { mode: 'standard' },
      { mode: 'custom', width: 1080, height: 1920 },
      { mode: 'custom', width: 1080, height: 1080 },
      { mode: 'custom', width: 1280, height: 720 },
      { mode: 'standard', narration: false },
    ] as const)
      expect(place(request), JSON.stringify(request)).toBe('continuous');
  });
```

2. In the test whose comment reads `// A new mode moves the music too: standard reviews keep it around the narration.`, replace that comment and the `toEqual` block after it with:

```ts
    // A new mode keeps the bed: `auto` is continuous for every kind of video.
    expect(respecVideo(DEFAULT_CONFIG, drafted, { mode: 'standard' }).music).toEqual({
      use: 'compose',
      placement: 'continuous',
      setting: 'auto',
    });
    // A run drafted when `auto` meant bookends for standard reviews gets the bed now.
    const older = {
      ...drafted,
      mode: 'standard' as const,
      music: { use: 'theme' as const, placement: 'bookends' as const, setting: 'auto' as const },
    };
    expect(respecVideo(DEFAULT_CONFIG, older, {}).music.placement).toBe('continuous');
```

3. Replace the whole `it('keeps a chosen placement and the outro through a re-render, unless set again', …)` block with:

```ts
  it('keeps a chosen placement and the outro through a re-render, unless set again', () => {
    const drafted = resolveVideoSpec(DEFAULT_CONFIG, {
      mode: 'standard',
      musicPlacement: 'bookends',
      outro: false,
    });
    expect(drafted.music).toEqual({ use: 'theme', placement: 'bookends', setting: 'bookends' });
    expect(drafted.outro).toBe(false);
    // A chosen placement holds whatever the kind of video; `auto` is continuous.
    expect(respecVideo(DEFAULT_CONFIG, drafted, {})).toMatchObject({
      music: { placement: 'bookends', setting: 'bookends' },
      outro: false,
    });
    expect(respecVideo(DEFAULT_CONFIG, drafted, { musicPlacement: 'auto' }).music.placement).toBe(
      'continuous',
    );
    expect(respecVideo(DEFAULT_CONFIG, drafted, { outro: true }).outro).toBe(true);
    // Only the music: the drafted placement and outro stay.
    expect(respecVideo(DEFAULT_CONFIG, drafted, { music: 'none' })).toMatchObject({
      music: { use: 'none', placement: 'bookends' },
      outro: false,
    });
    // COVI_MUSIC_PLACEMENT and COVI_OUTRO (explicit configuration) win over the drafted choice,
    // and setting the placement leaves the drafted music alone.
    const composed = resolveVideoSpec(DEFAULT_CONFIG, { mode: 'standard', music: 'compose' });
    const env = config({ video: { music: { placement: 'bookends' }, outro: false } });
    expect(
      respecVideo(env, composed, {}, new Set(['video.music.placement', 'video.outro'])),
    ).toMatchObject({ music: { use: 'compose', placement: 'bookends' }, outro: false });
  });
```

4. In `lets configuration place the music of runs saved before placement was a setting`, replace its last three lines with:

```ts
    const configured = config({ video: { music: { placement: 'bookends' } } });
    expect(respecVideo(configured, old, {}).music.placement).toBe('bookends');
    expect(respecVideo(DEFAULT_CONFIG, old, {}).music.placement).toBe('continuous');
```

5. In `places music by the kind of video unless a placement is chosen`:
   - rename it to `places music continuously unless a placement is chosen`
   - change `expect(place({ mode: 'standard' })).toBe('bookends');` to `.toBe('continuous')`
   - change `expect(place({ mode: 'custom', width: 1280, height: 720 })).toBe('bookends');` to `.toBe('continuous')`
   - leave the other lines alone

6. In `says where the music plays in the music question`, replace the first expectation and its comment with:

```ts
    // A standard review gets the bed, like every kind of video.
    expect(
      where({ explicit: { mode: 'custom', width: 1920, height: 1080 }, interactive: true }),
    ).toBe(
      'Arranged to the story and the verdict. A quiet bed under the narration that rises in the pauses',
    );
```

   Also replace the last expectation (configured `continuous` while the kind of video is asked) with:

```ts
    // A placement in configuration says where, even while the kind of video is asked.
    expect(
      where(
        { text: 'make a review video', interactive: true },
        config({ video: { music: { placement: 'bookends' } } }),
      ),
    ).toBe(
      'Arranged to the story and the verdict. Plays at the opening and the end, and stays low under the narration',
    );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/video/test/spec.test.ts packages/video/test/sound-levels.test.ts`
Expected: FAIL. Standard still resolves to `bookends`, `musicJumps` is missing from the record (dropped by `roundLevels`), and the bookends text differs.

- [ ] **Step 3: Implement**

`packages/video/src/sound.ts`:
- in the `mix` closure inside `produceSound`, add `hero: music.hero?.downbeat,` after `placement: spec.music.placement,`
- replace the `clearOfSpeech` call with:

```ts
      music.hero.clear = clearOfSpeech(
        music.hero.downbeat,
        input.voice ? (mixed.musicLines ?? input.speech) : [],
        spec.music.placement,
      );
```

- replace `roundLevels` with:

```ts
function roundLevels(levels: MixLevels): MixLevels {
  const r = (n: number | undefined) => (n === undefined ? undefined : round(n, 2));
  const jumps = levels.musicJumps;
  return {
    ...(levels.voiceLufs === undefined ? {} : { voiceLufs: r(levels.voiceLufs) }),
    ...(levels.musicBelowVoiceDb === undefined
      ? {}
      : { musicBelowVoiceDb: r(levels.musicBelowVoiceDb) }),
    ...(levels.musicRangeLu === undefined ? {} : { musicRangeLu: r(levels.musicRangeLu) }),
    ...(jumps
      ? {
          musicJumps: {
            maxDb: r(jumps.maxDb)!,
            at: r(jumps.at)!,
            exempt: jumps.exempt.map(([s, e]) => [round(s, 4), round(e, 4)] as [number, number]),
          },
        }
      : {}),
    ...(levels.pausesHeld ? { pausesHeld: levels.pausesHeld } : {}),
    ...(levels.effectsBelowVoiceDb === undefined
      ? {}
      : { effectsBelowVoiceDb: r(levels.effectsBelowVoiceDb) }),
    ...(levels.effectsCutDb === undefined ? {} : { effectsCutDb: r(levels.effectsCutDb) }),
    ...(levels.master
      ? {
          master: {
            integrated: r(levels.master.integrated)!,
            truePeak: r(levels.master.truePeak)!,
          },
        }
      : {}),
  };
}
```

`packages/video/src/spec.ts`:
- replace the doc comment above `export type MusicPlacement` with:

```ts
/**
 * Where music plays. A continuous bed under the whole video, ducked while someone speaks, for
 * every kind of video (`video.music.placement: auto`); bookends play it before the first line and
 * after the last, effectively off under the narration.
 */
```

- replace the `// \`auto\`: the kind of video decides…` comment and the `placement` const with:

```ts
  // `auto` is continuous for every kind of video: a bed that ducks under the voice, never jumps.
  const placement: MusicPlacement = setting === 'auto' ? 'continuous' : setting;
```

- in `MusicQuestionContext`, replace the `placement?` doc with `/** Where music would play (continuous unless a placement was chosen). */`
- in `videoQuestion`, replace the two-line comment and the `where` const with:

```ts
    // Say where the music plays, which is worth knowing before choosing to compose.
    const where = !sound.narration ? 'throughout' : (sound.placement ?? 'continuous');
```

- in `planVideo`, replace the `placement:` property (and the comment lines above the `questions.push(` that mention the kind of video deciding) so that the call reads:

```ts
    // Music is worth a question only while Covi is asking anyway; otherwise the default applies
    // and the result says how to change it.
    if (questions.length && missing.includes('music'))
      questions.push(
        videoQuestion('music', asking, {
          narration: spec.narration.enabled,
          soundEffects: spec.soundEffects,
          placement: spec.music.placement,
        }),
      );
```

`templates/i18n/*.yml`, under `question.music.where`: delete the `byMode:` line in all four files, and replace the `bookends:` line with:
- `en.yml`: `      bookends: '{what}. Plays at the opening and the end, and stays low under the narration'`
- `ko.yml`: `      bookends: '{what}. 도입부와 마지막에 들리고, 내레이션 중에는 낮게 깔림'`
- `ja.yml`: `      bookends: '{what}。冒頭と最後に流れ、ナレーション中は控えめになります'`
- `zh.yml`: `      bookends: '{what}；在开头和结尾播放，旁白期间保持低调'`

`packages/core/src/config/schema.ts`:
- replace the doc comment above `MUSIC_PLACEMENTS` with:

```ts
/**
 * Where music plays: `auto` is continuous for every kind of video; `continuous` keeps a bed under
 * the whole video that ducks under the narration; `bookends` plays it before the first line and
 * after the last only.
 */
```

- replace the placement `.describe(...)` string with `'auto (continuous), continuous (a bed under the whole video, ducked under the narration), or bookends (before the first line and after the last only).'`

`packages/cli/src/main.ts:355`: replace the help string with `'where music plays: auto (continuous, default), continuous (a bed under the whole video, ducked under the narration), bookends (before the first line and after the last only)'`.

Then run `cd ~/projects/covi-sound && grep -rn "the kind of video decides\|byMode" packages tests templates`. It must print nothing. Fix any test that pinned the old describe string.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/video packages/core/test/catalog.test.ts packages/core/test/config.test.ts tests/cli.test.ts tests/english-baseline.test.ts && npx biome check --write packages/video packages/core/src/config/schema.ts packages/cli/src/main.ts && npm run typecheck`
Expected: PASS. If `tests/english-baseline.test.ts` fails only because the bookends or CLI help text changed, update the snapshot with `npx vitest run tests/english-baseline.test.ts -u`, and check that the diff shows only those strings.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/video/src/sound.ts packages/video/src/spec.ts packages/video/test/spec.test.ts packages/video/test/sound-levels.test.ts templates/i18n packages/core/src/config/schema.ts packages/cli/src/main.ts tests/__snapshots__ && git commit -m "Lay the continuous bed under every kind of video" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 7: QC: music jumps, music range, the bed under speech, effects

**Files:**
- Modify: `packages/video/src/qc.ts` (`soundChecks`, its doc comment, constants)
- Test: `packages/video/test/sound-qc.test.ts`

**Interfaces:**
- Consumes:
  - `MUSIC_JUMP_DB` and `EFFECTS_UNDER_VOICE_DB` from `@covi/audio` (Task 5)
  - `AudioRecord.levels` with `musicJumps`, `musicRangeLu`, and `pausesHeld` (Task 6)
- Produces:
  - `soundChecks(record, limits)` returns, in order: `music-under-speech`, `music-jump`, `music-range`, `music-fit`, `music-audible`, `sound-effects`
  - exported constants `MUSIC_RANGE_LU = 8` and `BED_UNDER_VOICE = { min: 12, max: 20, fail: 9 } as const`

- [ ] **Step 1: Write the failing tests**

In `packages/video/test/sound-qc.test.ts`:
- in `record()`, replace the `levels` object with:

```ts
    levels: {
      voiceLufs: -16,
      musicBelowVoiceDb: 16.2,
      musicRangeLu: 3.1,
      musicJumps: {
        maxDb: 3.4,
        at: 12.3,
        exempt: [
          [0, 1.3],
          [9, 12],
          [28, 30],
        ],
      },
      effectsBelowVoiceDb: 11.2,
      master: { integrated: -16, truePeak: -1.4 },
    },
```

- in `pass a well-placed mix`, change the expected ids to `['music-under-speech', 'music-jump', 'music-range', 'music-fit', 'music-audible', 'sound-effects']`
- replace the `grade music under speech by placement` test with:

```ts
  it('grade music under speech by placement: a bed 12–20 dB under the voice, bookends 30', () => {
    const under = (db: number, placement: 'continuous' | 'bookends') =>
      byId(
        soundChecks(
          record({
            music: { ...record().music, placement },
            levels: { ...record().levels, musicBelowVoiceDb: db },
          }),
          LIMITS,
        ),
      )['music-under-speech']!.status;
    expect([12, 16, 20].map((db) => under(db, 'continuous'))).toEqual(['pass', 'pass', 'pass']);
    expect([21, 11.9, 9, 8.9].map((db) => under(db, 'continuous'))).toEqual([
      'warn',
      'warn',
      'warn',
      'fail',
    ]);
    expect([under(31, 'bookends'), under(25, 'bookends')]).toEqual(['pass', 'warn']);
  });

  it('fail music that jumps more than 6 dB within a second outside the exempt windows', () => {
    const jump = (maxDb: number | undefined, pausesHeld?: number) =>
      byId(
        soundChecks(
          record({
            levels: {
              ...record().levels,
              musicJumps:
                maxDb === undefined ? undefined : { ...record().levels.musicJumps!, maxDb },
              ...(pausesHeld ? { pausesHeld } : {}),
            },
          }),
          LIMITS,
        ),
      )['music-jump']!;
    expect(jump(6).status).toBe('pass');
    expect(jump(6.4).status).toBe('fail');
    expect(jump(6.4).message).toMatch(/6\.4 dB within 1 s at 12\.30 s/);
    expect(jump(6.4).message).toMatch(/0\.0–1\.3 s, 9\.0–12\.0 s, 28\.0–30\.0 s/);
    expect(jump(3.4, 2).message).toMatch(/2 pause\(s\) held/);
    // Not measured (no narration, or a 0.2.0 record): nothing to fail.
    expect(jump(undefined).status).toBe('pass');
  });

  it("warn when the music's loudness range over the narration exceeds 8 LU", () => {
    const range = (lu: number | undefined, placement: 'continuous' | 'bookends' = 'continuous') =>
      byId(
        soundChecks(
          record({
            music: { ...record().music, placement },
            levels: { ...record().levels, musicRangeLu: lu },
          }),
          LIMITS,
        ),
      )['music-range']!;
    expect(range(8).status).toBe('pass');
    expect(range(8.6).status).toBe('warn');
    expect(range(8.6, 'bookends').message).toMatch(/continuous keeps one bed/);
    expect(range(undefined).status).toBe('pass');
  });

  it('pass a record written before these checks existed', () => {
    const { musicJumps: _j, musicRangeLu: _r, ...old } = record().levels;
    const checks = byId(soundChecks(record({ levels: old }), LIMITS));
    expect(checks['music-jump']!.status).toBe('pass');
    expect(checks['music-range']!.status).toBe('pass');
  });
```

- in `fail effects that crowd each other, and grade their level under the voice`, replace `expect(effects([1, 2], 4)).toBe('warn');` with:

```ts
    expect(effects([1, 2], 8)).toBe('pass');
    expect(effects([1, 2], 7)).toBe('warn');
    expect(effects([1, 2], 4)).toBe('warn');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/projects/covi-sound && npx vitest run packages/video/test/sound-qc.test.ts`
Expected: FAIL. The `music-jump` and `music-range` checks are missing, and the old continuous grading (≥ 18) applies.

- [ ] **Step 3: Implement**

In `packages/video/src/qc.ts`:
- add `import { EFFECTS_UNDER_VOICE_DB, MUSIC_JUMP_DB } from '@covi/audio';` as the first import
- above `soundChecks`, add:

```ts
/** The music's loudness range over the narration above which QC warns (LU). */
export const MUSIC_RANGE_LU = 8;
/** Where a continuous bed sits under the voice (dB): passes inside, warns outside, fails under `fail`. */
export const BED_UNDER_VOICE = { min: 12, max: 20, fail: 9 } as const;
```

- replace the doc comment of `soundChecks` with:

```ts
/**
 * Checks on the mix itself, read from `video/audio.json`: the music under the narration, whether
 * it jumps or ranges too widely, its fit to the picture (the logo after the last line, the landing
 * before the end, the hero on its downbeat, the tempo, a silent end), how much of it is heard at
 * all, and the effects' spacing and level.
 */
```

- replace the `else { const continuous = … }` branch of `music-under-speech` with:

```ts
  else {
    const continuous = music.placement === 'continuous';
    const status: QcStatus = continuous
      ? below < BED_UNDER_VOICE.fail
        ? 'fail'
        : below >= BED_UNDER_VOICE.min && below <= BED_UNDER_VOICE.max
          ? 'pass'
          : 'warn'
      : below >= 30
        ? 'pass'
        : 'warn';
    checks.push({
      id: 'music-under-speech',
      status,
      message: `Music sits ${below.toFixed(1)} dB under the voice where it speaks (${continuous ? `continuous: ${BED_UNDER_VOICE.min}–${BED_UNDER_VOICE.max} dB wanted` : 'bookends: at least 30 dB'}).`,
    });
  }

  const jumps = record.levels.musicJumps;
  if (!jumps)
    checks.push({
      id: 'music-jump',
      status: 'pass',
      message: 'Not measured: no music under narration.',
    });
  else {
    const windows = jumps.exempt.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)} s`).join(', ');
    const held = record.levels.pausesHeld
      ? `; ${record.levels.pausesHeld} pause(s) held at the bed's level so it would not jump`
      : '';
    checks.push(
      jumps.maxDb > MUSIC_JUMP_DB + 1e-9
        ? {
            id: 'music-jump',
            status: 'fail',
            message: `The music jumps ${jumps.maxDb.toFixed(1)} dB within 1 s at ${jumps.at.toFixed(2)} s (at most ${MUSIC_JUMP_DB} wanted outside the opening, the hero, and the ending: ${windows})${held}.`,
          }
        : {
            id: 'music-jump',
            status: 'pass',
            message: `The music's momentary loudness changes by at most ${jumps.maxDb.toFixed(1)} dB within 1 s (at most ${MUSIC_JUMP_DB} wanted outside the opening, the hero, and the ending: ${windows})${held}.`,
          },
    );
  }

  const range = record.levels.musicRangeLu;
  checks.push(
    range === undefined
      ? {
          id: 'music-range',
          status: 'pass',
          message: 'Not measured: no music under at least 3 s of narration.',
        }
      : {
          id: 'music-range',
          status: range > MUSIC_RANGE_LU + 1e-9 ? 'warn' : 'pass',
          message: `The music's loudness range over the narration is ${range.toFixed(1)} LU (at most ${MUSIC_RANGE_LU} wanted${range > MUSIC_RANGE_LU + 1e-9 && music.placement === 'bookends' ? '; bookends swell around the narration, continuous keeps one bed' : ''}).`,
        },
  );
```

- in the `sound-effects` branch:
  - change `level >= 6 ? 'pass'` to `level >= EFFECTS_UNDER_VOICE_DB ? 'pass'`
  - change `(at least 6 wanted)` in the message to `(at least ${EFFECTS_UNDER_VOICE_DB} wanted)`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/projects/covi-sound && npx vitest run packages/video && npx biome check --write packages/video/src/qc.ts packages/video/test/sound-qc.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/projects/covi-sound && git add packages/video/src/qc.ts packages/video/test/sound-qc.test.ts && git commit -m "Check the music for jumps and loudness range" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

### Task 8: Render tests, and tuning on a narrated standard review

**Files:**
- Modify: `tests/render/sound.test.ts`
- Possibly tune:
  - `packages/audio/src/placement.ts` (`PLACEMENT`)
  - `packages/audio/src/mix.ts` (`JUMP_MARGIN_DB`)
  - `packages/audio/src/dsp/fx.ts` (`GLUE.threshold` only)
  - `templates/music/sound-effects.yml` (`gainDb`)
  - their pinned tests: `placement.test.ts` (table), `effects.test.ts` and `library.test.ts` (if `gainDb` changes), `mix.test.ts` (if a constant moves a pinned number)
- Scratch, not committed: `<your scratchpad>/measure-mix.mjs`

**Interfaces:**
- Consumes: everything above, plus `covi video` and `covi render` from this checkout (`./bin/covi.mjs`).
- Produces:
  - the tuned constants, inside the owner's bounds:
    - duck `gapDb − speechDb` 6–10 dB
    - the lengthened gap ramp ≤ 2 s (for a duck of D dB, `maxStepDb ≥ 0.71·D`)
    - `endsDb ≥ gapDb`
  - a measurement table in your final report, for the PR description

- [ ] **Step 1: Update the render sound tests**

In `tests/render/sound.test.ts`, add this helper after `ffmpegLoudness`:

```ts
/** Loudness range of a stretch of a file, as ffmpeg's ebur128 measures it. */
function ffmpegRange(file: string, from: number, to: number): number {
  const { stderr } = spawnSync(
    'ffmpeg',
    [
      ...['-hide_banner', '-nostats', '-ss', String(from), '-to', String(to), '-i', file],
      ...['-af', 'ebur128', '-f', 'null', '-'],
    ],
    { encoding: 'utf8' },
  );
  return Number(/LRA:\s+(-?[\d.]+) LU/.exec(stderr.slice(stderr.lastIndexOf('Summary')))![1]);
}
```

In `renders a short video with the theme at −16 LUFS…`, change the check list to `['audio', 'music-under-speech', 'music-jump', 'music-range', 'music-fit', 'music-audible', 'sound-effects']`.

Replace the whole `it('keeps the music around the narration of a standard review', …)` with:

```ts
  it('lays a continuous bed under a standard review that ducks without jumping', async () => {
    const repo = await example('api-users-pagination');
    const { result } = covi(['video', '--repo', repo, '--standard']);
    expect(result.video.rendered).toBe(true);
    const run = result.runDir;
    const audio = read<{
      music: { placement: string };
      levels: {
        musicBelowVoiceDb: number;
        musicRangeLu: number;
        musicJumps: { maxDb: number };
        effectsBelowVoiceDb?: number;
      };
    }>(run, 'video/audio.json');
    expect(audio.music.placement).toBe('continuous');
    expect(audio.levels.musicBelowVoiceDb).toBeGreaterThanOrEqual(12);
    expect(audio.levels.musicBelowVoiceDb).toBeLessThanOrEqual(20);
    expect(audio.levels.musicRangeLu).toBeLessThanOrEqual(8);
    expect(audio.levels.musicJumps.maxDb).toBeLessThanOrEqual(6);
    if (audio.levels.effectsBelowVoiceDb !== undefined)
      expect(audio.levels.effectsBelowVoiceDb).toBeGreaterThanOrEqual(8);
    const qc = read<Qc>(run, 'video/qc.json');
    for (const id of ['audio', 'music-under-speech', 'music-jump', 'music-range', 'sound-effects'])
      expect(qc.checks.find((c) => c.id === id)?.status, id).toBe('pass');
    expect(qc.status).not.toBe('fail');
    // ffmpeg agrees on the range over the narration.
    const timeline = read<{ scenes: Array<{ speech?: { start: number; end: number } }> }>(
      run,
      'video/timeline.json',
    );
    const lines = timeline.scenes.flatMap((s) => (s.speech ? [s.speech] : []));
    const from = Math.min(...lines.map((l) => l.start));
    const to = Math.max(...lines.map((l) => l.end));
    expect(ffmpegRange(join(run, 'video/music.wav'), from, to)).toBeLessThanOrEqual(8);
    // Mixing the same sound again gives the same music, byte for byte.
    const first = readFileSync(join(run, 'video/music.wav'));
    covi(['render', '--repo', repo, '--run', result.runId]);
    expect(readFileSync(join(run, 'video/music.wav')).equals(first)).toBe(true);
    // Bookends still play, slope-limited: never a jump, effectively off under speech.
    const remix = covi(['render', '--repo', repo, '--run', result.runId, '--music-placement', 'bookends']);
    expect(remix.result.video.framesReused).toBe(true);
    const bookends = read<Qc>(run, 'video/qc.json');
    expect(bookends.checks.find((c) => c.id === 'music-jump')?.status).toBe('pass');
    expect(bookends.checks.find((c) => c.id === 'music-under-speech')?.status).toBe('pass');
  }, 900_000);
```

- [ ] **Step 2: Write the measurement script (scratchpad, not committed)**

Write `<your scratchpad>/measure-mix.mjs`:

```js
// node measure-mix.mjs <runDir>: measures a run's stems and master with ffmpeg's ebur128 against
// A1's targets. A tuning aid only; not part of the repository.
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
row('music under voice during speech (dB)', below.toFixed(1), '12–20, aim 16', below >= 12 && below <= 20);
row('music LRA over the narration (LU)', span.LRA.toFixed(1), '≤ 8', span.LRA <= 8);
row('largest music jump within 1 s (dB)', `${jump.db.toFixed(1)} at ${jump.at.toFixed(1)} s`, '≤ 6 outside exempt', jump.db <= 6);
row('master integrated (LUFS)', master.I.toFixed(1), '−16 ± 0.5', Math.abs(master.I + 16) <= 0.5);
row('master true peak (dBTP)', master.TP.toFixed(1), '≤ −1', master.TP <= -1);
row('effects under the voice peak (dB, Covi)', String(audio.levels.effectsBelowVoiceDb), '≥ 8', !(audio.levels.effectsBelowVoiceDb < 8));
console.log('\nCovi levels:', JSON.stringify(audio.levels));
console.log('Exempt windows:', JSON.stringify(exempt));
```

- [ ] **Step 3: Render the narrated standard example (background) and measure**

Run in the background (`run_in_background: true`) and wait for the notification:

```bash
cd ~/projects/covi-sound && dir=$(./bin/covi.mjs examples create api-users-pagination) && echo "repo: $dir" && ./bin/covi.mjs video --repo "$dir" --standard --force --json > "<your scratchpad>/a1-render.json" && node -e "const r=require('<your scratchpad>/a1-render.json');console.log(r.runId, r.runDir, r.video.qc)"
```

Then run `node "<your scratchpad>/measure-mix.mjs" <runDir>`, and read `video/qc.json` (`music-*` and `sound-effects`) and `video/audio.json` `levels`.

- [ ] **Step 4: Tune until every target holds, re-mixing only the sound**

After any constant change, re-mix in seconds. Frames are reused, because audio code does not touch the frames key. Then measure again:

```bash
cd ~/projects/covi-sound && ./bin/covi.mjs render --repo "$dir" --run <runId> --json > /dev/null && node "<your scratchpad>/measure-mix.mjs" <runDir>
```

Knobs, in this order, staying inside the owner's bounds:
- **Music under the voice outside 12–20 dB, or off the aim of 16 by more than 1.5 dB:** move `PLACEMENT.continuous.speechDb`, `gapDb`, and `endsDb` together by the error. That keeps the 7 dB duck and the 2 dB end lift. One dB of `speechDb` moves the measure by one dB. Effects follow the bed through `BED_DB`, so re-check the effects row.
- **Jump over 6 dB outside the exempt windows:** read `levels.musicJumps.at` and `pausesHeld`.
  - If the jump lies inside a pause that swelled, raise `JUMP_MARGIN_DB` (up to 1.0).
  - If it lies under a line (the music's own movement), lower `GLUE.threshold` toward −27 (ratio stays 2), and record the change as a ruling.
- **LRA over 8 LU:** same as jumps. Also check that the span ffmpeg measured starts at the first line.
- **Effects:** if `effectsCutDb` exceeds 2 dB on this example, lower `gainDb` in `sound-effects.yml` by the cut, rounded to whole dB. The cap should rarely act.
- **Master:** must already hold. If it does not, report it; the master loop is out of A1's scope.
- **Disagreement:** if ffmpeg's "music under voice" and Covi's `musicBelowVoiceDb` differ by more than 1.5 dB, report both and tune on Covi's (QC reads it).

Whenever a constant changes, update the test that pins it in the same commit:
- `placement.test.ts`, the table plus the derived values in the shape tests: recompute `rampSeconds` for a new duck or step
- `effects.test.ts` and `library.test.ts` for `gainDb`

Then run `cd ~/projects/covi-sound && npx vitest run packages/audio packages/video`.

- [ ] **Step 5: Run the render sound tests (background)**

Run in the background and wait: `cd ~/projects/covi-sound && COVI_TEST_RENDER=1 npx vitest run tests/render/sound.test.ts`
Expected: PASS for all four tests.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/covi-sound && git add tests/render/sound.test.ts packages/audio templates/music/sound-effects.yml && git commit -m "Tune the broadcast mix on a narrated standard review" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

In your final report, include:
- the measurement table printed in Step 3 (before tuning) and in Step 4 (after)
- every constant you changed, with its old and new value
- `pausesHeld`
- the example's duration

The lead puts these numbers in the PR description. Do not commit the table.

---

### Task 9: Documentation, skill, changelog, and the full check

**Files:**
- Modify:
  - `docs/video.md`, `docs/configuration.md`, `docs/cli.md`, `docs/artifacts.md`
  - `skills/covi-video/SKILL.md`, `skills/covi-video/references/music.md`
  - `CHANGELOG.md`
  - comments in `packages/audio/src/loudness.ts` (the `AUDIBLE` block) and `packages/video/src/timeline/build.ts:143`
- Test: `npm run check`, `npm run test:render`

**Interfaces:**
- Consumes: the final constants after Task 8 tuning. Read them from:
  - `PLACEMENT` and `BED_DB` in `packages/audio/src/placement.ts`
  - `GLUE` and `CARVE` in `packages/audio/src/dsp/fx.ts`
  - `MUSIC_JUMP_DB`, `EXEMPT`, and `EFFECTS_UNDER_VOICE_DB` in `packages/audio/src/mix.ts`
  - `gainDb` in `templates/music/sound-effects.yml`
  
  The text below uses the untuned defaults. Replace any number Task 8 changed, including derived ones: the bed under speech in dBFS is −16 plus `speechDb`, and the ramp length is `rampSeconds(gapDb − speechDb, up, maxStepDb, 'cosine')`.
- Produces: docs that match the behavior.

- [ ] **Step 1: `docs/video.md`**

(a) Replace everything from the line `#### Where the music plays` up to (not including) `#### Fitting the music to the picture` with:

```markdown
#### Where the music plays

With `video.music.placement: auto` (the default), every kind of video gets a continuous bed (`spec.music.placement` is `continuous`). Set `bookends` (`--music-placement`, `COVI_MUSIC_PLACEMENT`) to keep the music to the opening and the ending; the choice is kept when a drafted video is rendered again.

| Placement | Under speech | In a pause | Before the first line, after the last | Ramps |
|---|---|---|---|---|
| continuous (default) | −15 dB | −8 dB, in a pause long enough to rise and hold there 0.5 s (about 4.5 s); shorter pauses stay down | −6 dB | raised cosines in dB: 1.2 s into the first line, 1.5 s out of the last; between lines about 2 s each way, so the level never moves more than 5 dB in a second |
| bookends | −40 dB (effectively off) | at most −11 dB, rising and falling at 5 dB a second, so a short breath moves it only a few dB | −11 dB | raised cosines of 1.2 s and 1.5 s at the ends; straight lines at 5 dB a second between lines |

The levels apply to the music bus, which is at the voice's loudness (−16 LUFS; see [The mix](#the-mix)). While someone speaks, the voice's band is also carved out of the music. Without narration there is no speech to duck under, so the music plays at the ends' level throughout.

The music never jumps. Three moments may move faster: the opening, until 1 s after the first line starts; the hero, 1.5 s either side of its downbeat; and the ending, from 0.5 s before the last line ends. Everywhere else, its momentary loudness changes by at most 6 dB within a second. A pause whose swell, added to the music's own movement, would come within 0.5 dB of that limit stays at the speech level instead; `levels.pausesHeld` in `video/audio.json` counts these pauses. QC's `music-jump` and `music-range` check the result.

Where someone speaks, a continuous bed sits 12–20 dB under the voice. WCAG 1.4.7 (AAA) asks for 20 dB; choose `--music none` when that matters. Bookends are heard mainly before the first line and over the outro, so QC's `music-audible` may warn for them.
```

(b) In "Which questions are asked", replace the sentence beginning `The theme's and the score's descriptions say where the music would play:` through `While the kind of video is still being asked, they describe both.` with:

`The theme's and the score's descriptions say where the music would play: with narration (continuous, the default) "a quiet bed under the narration that rises in the pauses"; with \`bookends\` "plays at the opening and the end, and stays low under the narration"; without narration "under the whole video".`

(c) In `#### Sound effects`, replace the sentence `` `templates/music/sound-effects.yml` maps cues to recipes and sets the level: each recipe is rendered to a −3 dBFS peak and played 14 dB under (the verdict and the outro 12 dB; swells, the whoosh and the riser, 18 dB). `` with:

`` `templates/music/sound-effects.yml` maps cues to recipes and sets their level against the music bed's level under speech, the same with any placement or with no music. Each recipe is rendered to a −3 dBFS peak and plays 1 dB above the bed, which is 14 dB under the voice-normalized stems. The verdict and the outro play 3 dB above it; swells (the whoosh and the riser) play 3 dB under. If any effect's peak comes within 8 dB of the voice's, the mix lowers every effect together (`levels.effectsCutDb`). ``

(d) In `#### The mix`, replace the **Music**, **Effects**, and **Levels** bullets with:

```markdown
- **Music:** rendered (and cached in `.covi/cache/music/`, keyed by the score, the patches and kits, the timing, the verdict, and the engine version), then made a bus. The bus is brought to −16 LUFS and glued by a compressor (a stereo-linked 50 ms RMS detector; 2:1 above −24 dB RMS with a 6 dB soft knee; 30 ms attack, 400 ms release). It is brought back to −16 LUFS. While someone speaks, its 1–4 kHz band is carved out: `x − k·BP(x)`, an RBJ band-pass at 2 kHz with Q 0.7, where `k` is 0.5 under speech (−6 dB at the centre) and follows the duck. Finally the placement shapes it. `video/music.wav` keeps the stem as placed, so it can be heard alone.
- **Effects:** at their cue times, at levels written against the bed; lowered together if any comes within 8 dB of the voice's peak.
- **Levels** go to `video/audio.json`:
  - the voice's loudness
  - how far the music sits under the voice where it speaks (K-weighted RMS)
  - the music's loudness range over the narration (`musicRangeLu`, EBU Tech 3342)
  - its largest momentary jump within 1 s outside the exempt windows (`musicJumps`, with its time and the windows)
  - the pauses held down (`pausesHeld`)
  - how far the effects' peaks sit under the voice's, and how far the mix lowered them (`effectsCutDb`)
  - the master's loudness and true peak
```

(e) In the **What is heard** bullet, change `a continuous bed under speech (about −36 dBFS, quiet but heard)` to `a continuous bed under speech (about −31 dBFS, quiet but heard)`.

(f) In the configuration table near the top, change the `video.music.placement` row's description to: `where music plays: \`auto\` (continuous), \`continuous\`, \`bookends\`; see [Where the music plays](#where-the-music-plays)`.

(g) In "Quality checks":
- replace the `music-under-speech` row with:

`| \`music-under-speech\` | Where someone speaks, a continuous bed sits 12–20 dB under the voice, and bookends at least 30 dB, as K-weighted RMS from \`video/audio.json\`. Passes when no music plays under narration | continuous: warn outside 12–20 dB, fail under 9; bookends: warn under 30 |`

- add these two rows after it:

`| \`music-jump\` | Outside the opening (until 1 s after the first line starts), the hero (1.5 s either side of its downbeat), and the ending (from 0.5 s before the last line ends), the music's momentary loudness (400 ms windows every 100 ms) changes by at most 6 dB between any two windows up to 1 s apart (\`levels.musicJumps\`). Passes when no music plays under narration | fail |`

`| \`music-range\` | The music's loudness range (EBU Tech 3342) from the first line's start to the last line's end is at most 8 LU (\`levels.musicRangeLu\`). Passes when not measured (no music under at least 3 s of narration) | warn |`

- in the `sound-effects` row, change `their peaks sit at least 6 dB under the voice's | fail on crowding or under 3 dB; warn from 3 to 6 dB` to `their peaks sit at least 8 dB under the voice's | fail on crowding or under 3 dB; warn from 3 to 8 dB`.

- [ ] **Step 2: The other docs**

- `docs/configuration.md`, the `music.placement` row: replace the description with ``Where the music plays. `auto`: continuous, for every kind of video. `continuous`: a bed under the whole video, 12–20 dB under the voice while someone speaks, rising before the first line, in long pauses, and after the last, never jumping. `bookends`: music before the first line and after the last, effectively off under the narration. See [Where the music plays](video.md#where-the-music-plays).``
- `docs/cli.md`, the `--music-placement` row: ``Where the music plays: `auto` (continuous, default), `continuous` (a bed under the whole video, ducked under the narration), or `bookends` (before the first line and after the last only). See [Video](video.md#where-the-music-plays).``
- `docs/artifacts.md`, the `video/audio.json` row: change ``the `levels` of the mix (`voiceLufs`, `musicBelowVoiceDb`, `effectsBelowVoiceDb`, and the master's `integrated` loudness and `truePeak`)`` to ``the `levels` of the mix (`voiceLufs`, `musicBelowVoiceDb`, `musicRangeLu`, `musicJumps` with `maxDb`, `at`, and the `exempt` windows, `pausesHeld`, `effectsBelowVoiceDb`, `effectsCutDb`, and the master's `integrated` loudness and `truePeak`)``.
- `packages/audio/src/loudness.ts`, the `AUDIBLE` doc comment: change `a continuous bed under speech (about −36, quiet but heard)` to `a continuous bed under speech (about −31, quiet but heard)`.
- `packages/video/src/timeline/build.ts:143`: change the comment to `/** A pause between two lines at least this long already breathes (the music may rise in it). */`.

- [ ] **Step 3: The skill**

`skills/covi-video/SKILL.md`:
- In the **Music.** paragraph, replace from `Where it plays follows the kind of video:` through `` `bookends` plays it only around the narration. `` with:

  `` It is a continuous bed under the whole video: 12–20 dB under the voice while someone speaks, with the voice's band carved out, a little higher before the first line, in long pauses, and over the outro, where its sonic logo lands. It never jumps. `--music-placement bookends` plays it before the first line and after the last instead, effectively off under the narration. ``

- In the paragraph beginning `For narration in Korean, Japanese, or Chinese`, replace from `with the \`audio\`, \`music-fit\`` to the end of the paragraph with:

  `` with the `audio`, `music-under-speech`, `music-jump`, `music-range`, `music-fit`, `music-audible`, and `sound-effects` checks. When `music-jump` fails, the music itself jumps where `levels.musicJumps.at` says: in a composed score, smooth that passage (no sudden drops or entries); with the theme, report it. When `music-audible` warns under bookends, the music is heard only around the narration: use the default placement. ``

`skills/covi-video/references/music.md`:
- line 8: replace the bullet with:

  `` - Density matters more than level. Covi brings the music to the voice's loudness, glues it, and places it: a continuous bed 15 dB under the voice-normalized level while someone speaks, with the voice's band carved out (or, with `--music-placement bookends`, effectively off under speech). Outside the opening, the hero, and the ending, a score whose own loudness jumps more than 6 dB within a second fails QC's `music-jump`: keep section changes, drops, and entries gentle. ``

- in the `video/audio.json` bullet: change ``and the mix `levels` (`musicBelowVoiceDb`, `effectsBelowVoiceDb`, the master's loudness and true peak)`` to ``and the mix `levels` (`musicBelowVoiceDb`, `musicRangeLu`, `musicJumps`, `pausesHeld`, `effectsBelowVoiceDb`, `effectsCutDb`, the master's loudness and true peak)``.
- in the `video/qc.json` bullet: change ``, `music-under-speech`, `music-audible` `` to ``, `music-under-speech` (12–20 dB for the bed), `music-jump` (at most 6 dB within a second outside the opening, the hero, and the ending), `music-range` (at most 8 LU over the narration), `music-audible` ``.

- [ ] **Step 4: CHANGELOG**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
### Changed

- Broadcast mix: music is a continuous bed by default, 12–20 dB under the voice with its 1–4 kHz band carved out, glued by a bus compressor, and smoothed so it never jumps more than 6 dB in a second; effects follow the bed and stay 8 dB under the voice's peak; `bookends` ramps are slope-limited; QC adds `music-jump` and `music-range`.
```

- [ ] **Step 5: Run the full checks (background)**

Run in the background and wait: `cd ~/projects/covi-sound && npx biome check --write docs skills CHANGELOG.md packages/audio/src/loudness.ts packages/video/src/timeline/build.ts; npm run check`
Expected: PASS (lint, typecheck, agents:check, all unit and integration tests).

Then run in the background and wait: `cd ~/projects/covi-sound && npm run test:render`
Expected: PASS. This needs ffmpeg and Playwright Chromium, both present. Two render tests require every QC check except `still` to pass on a short theme render:
- `renders a storyboard that uses every timing field`
- `…every component and sound field`

If `music-jump`, `music-range`, or `music-under-speech` fails there, go back to the Task 8 knobs and re-measure. Do not loosen a QC threshold.

- [ ] **Step 6: Commit**

```bash
cd ~/projects/covi-sound && git add docs skills CHANGELOG.md packages/audio/src/loudness.ts packages/video/src/timeline/build.ts && git commit -m "Document the broadcast mix" -m "Claude-Session: https://claude.ai/code/session_01J7ZXRARft4Xuha1NPN7A4S"
```

---

## Self-Review

- **Spec coverage (§12):**

  | Spec item | Task |
  |---|---|
  | Glue (§12.1) | Task 2 |
  | Carve | Tasks 2 and 5 |
  | Placement continuous/bookends with smoothed ramps | Task 3 |
  | Pre-roll and recovery | Task 3 (as nominal lengths; see ruling R-A1-1) |
  | Effects relative to the bed, 8 dB cap | Task 4 |
  | Engine version | Task 5 |
  | Master loop | unchanged (Task 5 keeps it) |
  | `momentaryLoudness` and `loudnessRange` (§12.2) | Task 1 |
  | `musicRangeLu` and `musicJumps` | Tasks 5 and 6 |
  | Exempt windows | Task 5, documented in Task 9 |
  | QC `music-jump`, `music-range`, `music-under-speech` | Task 7 |
  | `auto` → continuous (R-004) | Task 6 |
  | Docs, skill, CHANGELOG | Task 9 |
  | Measured tuning | Task 8 |
  | Determinism | Tasks 2, 5, and 8 |

- **Placeholder scan:** none. Task 8's tuning is bounded by named knobs, ranges, and the tests to update. Task 9 names the derived numbers to recompute if Task 8 changed a constant.
- **Type consistency:**
  - `Jump` (Task 1) feeds `MixLevels.musicJumps` (Task 5), `roundLevels` (Task 6), and QC (Task 7).
  - `placementLevels` and `duckAmount` return `Float64Array` and `Float32Array`, as `placeMusic` consumes them.
  - `swellingPauses` returns `Array<[number, number]>`, which `placeWithoutJumps` appends to `lines`.
  - `MixResult.musicLines` is read by `sound.ts`.
  - `BED_DB` is consumed by `effects.ts` and the effects tests.
  - `EFFECTS_UNDER_VOICE_DB` and `MUSIC_JUMP_DB` are exported from `index.ts` in Tasks 4 and 5, before Task 7 imports them.
- **Review Focus:** each of the five lines has its test in the owning task (Tasks 1, 3, 5, 6, 7), as listed.

## Rulings

- R-A1-1 Ruling: between lines, a continuous duck's raised-cosine ramps are lengthened by construction (`rampSeconds`) until no second moves more than `maxStepDb` = 5 dB. A 7 dB duck therefore ramps about 1.97 s each way. The spec's 1.2 s pre-roll and 1.5 s recovery stay as the nominal lengths, and they apply as written into the first line and out of the last (the exempt opening and ending) — the spec's own numbers contradict its "≤ 6 dB per second by construction" (a 7 dB raised cosine over 1.2 s moves 6.8 dB in its steepest second), and 1.97 s still sits inside the owner's "recovers over 1–2 s" — a pause must last about 4.5 s to swell, so mid-narration swells are rare.
- R-A1-2 Ruling: after placement, the mix measures the placed stem and holds at the speech level any pause whose region shows a momentary jump above 6 − 0.5 dB, then places the music again. Each round holds at least one more pause, so it terminates, and it is deterministic — measured on the theme, the music's own 400 ms movement is 2.5–3.6 dB within 1 s even after glue. A swept 5.5 s pause reached 7.5 dB with 7 dB/1.97 s ramps (6.9 dB with 2.25 s ramps), so no constant inside the owner's bounds passes the 6 dB check robustly — the owner may expect audible swells in pauses, but with the theme most long pauses stay down and the bed stays steady.
- R-A1-3 Ruling: bookends' between-line ramps are straight lines at ≤ 5 dB/s with no hold rule, so every breath swells partway (and R-A1-2 may hold it). Its ramps into the first line and out of the last are 1.2 s and 1.5 s raised cosines inside the exempt windows — the spec asks for slope-limited ramps and partial swells, and the opening and the logo must still be heard — bookends no longer lifts the hero or the breaths, so `music-audible` warns on bookends standard reviews more often.
- R-A1-4 Ruling: effect levels are written against the continuous bed's level under speech (`BED_DB = PLACEMENT.continuous.speechDb`), whatever the placement and with music off. `gainDb: 1` reproduces 0.2.0's absolute levels (−14/−12/−18) — R-011 says "relative to the bed", but bookends' bed under speech is −40 dB, which would silence effects — if the owner meant the bed actually playing, effects under bookends need another rule.
- R-A1-5 Ruling: the effects cap lowers all effects together to 8.1 dB under the voice's sample peak (0.1 dB rounding margin) and records `effectsCutDb`. `sound-effects` QC now passes at ≥ 8 dB and keeps warn 3–8 and fail < 3 — with the cap in place, anything under 8 is a bug, and the old fail floor still catches it — none expected.
- R-A1-6 Ruling: `music-jump` and `music-range` are measured only for narrated videos with music. A momentary window counts only if its whole 400 ms lies outside every exempt window, and silence counts as −70 LUFS — the owner's windows are defined from the narration, and a finite floor keeps `audio.json` free of `null` — a composed score's own jumps in an unnarrated video go unchecked.
- R-A1-7 Ruling: `video/audio.json` levels gain `musicRangeLu`, `musicJumps: { maxDb, at, exempt }` (the spec's name, one object that records its exempt windows), `pausesHeld`, and `effectsCutDb`; the file stays `schemaVersion: 1` — the change is additive, and readers ignore unknown fields — none.
- R-A1-8 Ruling: the `question.music.where.byMode` strings are removed from all four catalogs, and `where.bookends` is rewritten in all four languages ("plays at the opening and the end, and stays low under the narration") — `auto` no longer depends on the kind of video, and the old bookends text promised swells bookends no longer make — the ko/ja/zh wording is mine; a native read is cheap.
- R-A1-9 Ruling: `music-under-speech` for bookends keeps 0.2.0's grading (pass ≥ 30 dB, else warn). For continuous it passes at 12–20, warns outside, and fails under 9. The WCAG 1.4.7 mention moves from the QC message to the docs — the owner set 12–20, below WCAG AAA's 20 — people who need AAA must choose `--music none`, and the docs say so.
- R-A1-10 Ruling: the ffmpeg measurement script for tuning lives in the implementer's scratchpad, not the repository. The render test checks ffmpeg's LRA, Covi's own levels, and QC; the measured numbers go into the PR description — this avoids a second measurement tool to maintain — a later tuner rewrites the script (it is about 60 lines in the plan).
- R-A1-11 Ruling: the glue's "typical reduction" pin is the theme's integrated-loudness drop at −16 LUFS, which must lie in 0.5–4 dB (measured 3.37–3.39 dB on 20, 60, and 90 s renders) — the spec asks for a pin on typical reduction, and the integrated drop is deterministic and simple — a change to the theme could push it toward 4 dB.
- R-A1-12 Ruling: bumping `AUDIO_ENGINE_VERSION` to `covi-audio-4` invalidates the music cache, even though `renderMusic` itself is unchanged — the owner asked for the bump, and the version names the whole audio output — a one-time re-render of cached music.
