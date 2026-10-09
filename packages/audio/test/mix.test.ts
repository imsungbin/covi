import { describe, expect, it } from 'vitest';
import { hashOf } from '../src/hash.ts';
import { integratedLoudness, samplePeak, truePeak } from '../src/loudness.ts';
import { EFFECTS_UNDER_VOICE_DB, type MixInput, mixSound } from '../src/mix.ts';

const SR = 48_000;
const D = 5;

/** Speech-like bursts: a voiced tone with syllable-rate amplitude, inside each window. */
function voice(windows: Array<[number, number]>, level = 0.3): Float32Array {
  const out = new Float32Array(D * SR);
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

/** A steady chord bed, the stand-in for rendered music. */
function music(): Float32Array[] {
  const l = new Float32Array(D * SR);
  for (let i = 0; i < l.length; i++) {
    const t = i / SR;
    l[i] =
      0.12 *
      (Math.sin(2 * Math.PI * 155.6 * t) +
        Math.sin(2 * Math.PI * 196 * t) +
        Math.sin(2 * Math.PI * 233.1 * t) +
        0.6 * Math.sin(2 * Math.PI * 77.8 * t));
  }
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

describe('mixSound', () => {
  it('masters a narrated video to −16 LUFS under −1 dBTP with the music well under the voice', () => {
    const r = mixSound(input());
    expect(r.target).toBe(-16);
    expect(Math.abs(r.levels.master!.integrated + 16)).toBeLessThanOrEqual(0.5);
    expect(r.levels.master!.truePeak).toBeLessThanOrEqual(-1);
    expect(r.levels.voiceLufs).toBeCloseTo(-16, 1);
    expect(r.levels.musicBelowVoiceDb!).toBeGreaterThanOrEqual(18);
    expect(r.levels.effectsBelowVoiceDb!).toBeGreaterThanOrEqual(8);
    expect(r.master![0]!.length).toBe(D * SR);
    // The voice stem is normalized as heard: the same signal on both channels.
    expect(integratedLoudness([r.voice!, r.voice!], SR)).toBeCloseTo(-16, 1);
  });

  it('keeps the music effectively off under speech for bookends', () => {
    const r = mixSound(input({ placement: 'bookends' }));
    expect(r.levels.musicBelowVoiceDb!).toBeGreaterThanOrEqual(30);
  });

  it('masters music without narration to −20 LUFS', () => {
    const r = mixSound(input({ voice: undefined, speech: [] }));
    expect(r.target).toBe(-20);
    expect(Math.abs(r.levels.master!.integrated + 20)).toBeLessThanOrEqual(0.5);
    expect(r.levels.musicBelowVoiceDb).toBeUndefined();
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

  it('is byte-for-byte deterministic', () => {
    const a = mixSound(input());
    const b = mixSound(input());
    expect(hashOf(a.master![0]!, a.master![1]!)).toBe(hashOf(b.master![0]!, b.master![1]!));
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
    // A silent effect has no peak: nothing to lower, nothing to report, nothing infinite.
    const silent = mixSound(
      input({
        effects: [{ t: 1, audio: [new Float32Array(100), new Float32Array(100)], gainDb: 0 }],
      }),
    );
    expect(silent.levels.effectsBelowVoiceDb).toBeUndefined();
    expect(silent.levels.effectsCutDb).toBeUndefined();
  });
});
