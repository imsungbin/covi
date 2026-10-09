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

/** A steady chord bed, the stand-in for rendered music; each step raises it by dB from then on. */
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
  const l = Float32Array.from(
    { length: D * SR },
    (_, i) => 0.3 * Math.sin((2 * Math.PI * freq * i) / SR),
  );
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
  input({
    duration: 20,
    voice: voice(PAUSE, 0.3, 20),
    speech: PAUSE,
    music: music(20),
    effects: [],
    ...overrides,
  });

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
    const lift = weightedLevel(r.music!, SR, [[7.5, 8.5]]) - weightedLevel(r.music!, SR, [[2, 3]]);
    expect(lift).toBeCloseTo(7, 0);
    expect(r.levels.musicJumps!.maxDb).toBeGreaterThan(4);
    expect(r.levels.musicJumps!.maxDb).toBeLessThanOrEqual(MUSIC_JUMP_DB - 0.5);
  });

  it('holds a pause at the speech level when its swell would make the music jump', () => {
    // The music itself steps up 6 dB 1.2 s into the pause, where the swell is steepest.
    const r = mixSound(long({ music: music(20, [[6.2, 6]]) }));
    expect(r.levels.pausesHeld).toBe(1);
    expect(r.musicLines).toContainEqual([5, 11]);
    // Held, the pause plays at the bed's level: only the music's own step is left, which the glue
    // halves.
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
    expect(
      musicExemptWindows({
        speech: [
          [0.5, 6],
          [7, 18],
        ],
        hero: 9,
        duration: 20,
      }),
    ).toEqual([
      [0, 1.5],
      [7.5, 10.5],
      [17.5, 20],
    ]);
    expect(musicExemptWindows({ speech: [], duration: 20 })).toEqual([[0, 20]]);
    expect(musicExemptWindows({ speech: [[0.5, 6]], hero: Number.NaN, duration: 20 })).toEqual([
      [0, 1.5],
      [5.5, 20],
    ]);
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
      input({
        effects: [{ t: 1, audio: [new Float32Array(100), new Float32Array(100)], gainDb: 0 }],
      }),
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
