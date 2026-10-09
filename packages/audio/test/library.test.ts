import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { glueCompressor } from '../src/dsp/fx.ts';
import { hashOf } from '../src/hash.ts';
import {
  AUDIO_ENGINE_VERSION,
  checkScoreReferences,
  loadMusicLibrary,
  musicCacheKey,
} from '../src/library.ts';
import { integratedLoudness } from '../src/loudness.ts';
import { fitMusic } from '../src/music/fit.ts';
import { logoNotes, noteLimit, renderMusic, scheduleArrangement } from '../src/music/render.ts';
import { parseScore, ScoreError } from '../src/music/score.ts';
import { renderSfx } from '../src/sfx/recipes.ts';
import { noteSeconds } from '../src/synth/instruments.ts';

const DIR = join(import.meta.dirname, '..', '..', '..', 'templates', 'music');
const library = loadMusicLibrary(DIR);
const theme = () => parseScore(library.scores.get('covi-theme'));

describe('the music library (templates/music)', () => {
  it('loads and validates every patch, kit, recipe, cue, and score', () => {
    expect(library.patches.size).toBeGreaterThanOrEqual(20);
    expect([...library.kits.keys()].sort()).toEqual(['soft-acoustic', 'soft-electro']);
    expect([...library.recipes.keys()].sort()).toEqual([
      'click',
      'finding',
      'finding-high',
      'hero',
      'outro-looks-good',
      'outro-needs-attention',
      'outro-needs-changes',
      'reveal',
      'riser',
      'transition',
      'verdict-looks-good',
      'verdict-needs-attention',
      'verdict-needs-changes',
    ]);
    expect(library.soundEffects).toMatchObject({
      gainDb: 1,
      swellCutDb: 4,
      minSpacing: 0.15,
      maxPerSecond: 3,
    });
    expect([...library.scores.keys()]).toEqual(['covi-theme']);
  });

  it('renders every effect recipe to a −3 dBFS peak, silent at both ends', () => {
    for (const recipe of library.recipes.values()) {
      const out = renderSfx(recipe, library.patches, { transpose: 3 });
      const peak = Math.max(...out.map((c) => Math.max(...c.map(Math.abs))));
      expect(20 * Math.log10(peak), recipe.id).toBeCloseTo(-3, 1);
      expect(Math.abs(out[0]![out[0]!.length - 1]!), recipe.id).toBeLessThan(1e-3);
    }
  });

  it('renders the hero stack: a riser that swells into its end, a hit that lands at once', () => {
    const sr = 48_000;
    const rms = (c: Float32Array, from: number, to: number) => {
      let sum = 0;
      for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) sum += c[i]! ** 2;
      return Math.sqrt(sum / (Math.round(to * sr) - Math.round(from * sr)));
    };
    const riser = renderSfx(library.recipes.get('riser')!, library.patches, { sampleRate: sr })[0]!;
    expect(rms(riser, 0.6, 0.8)).toBeGreaterThan(4 * rms(riser, 0, 0.2));
    const hit = renderSfx(library.recipes.get('hero')!, library.patches, { sampleRate: sr })[0]!;
    expect(rms(hit, 0, 0.1)).toBeGreaterThan(4 * rms(hit, 0.5, 0.6));
    // The riser starts at its cue; the whoosh peaks on its cue, mid-transition.
    expect(library.recipes.get('riser')!.anchor).toBe(0);
    expect(library.recipes.get('transition')!.anchor).toBeCloseTo(0.2, 9);
  });

  it("settles the hero's thump on the music's tonic", () => {
    const sr = 48_000;
    const hero = library.recipes.get('hero')!;
    const thump = { ...hero, layers: [hero.layers[0]!], fx: undefined };
    // After its glide the thump is a plain sine: time its rising zero crossings.
    const pitch = (transpose: number) => {
      const c = renderSfx(thump, library.patches, { sampleRate: sr, transpose })[0]!;
      const crossings: number[] = [];
      for (let i = Math.round(0.12 * sr); i < Math.round(0.3 * sr); i++)
        if (c[i - 1]! < 0 && c[i]! >= 0) crossings.push(i - 1 + c[i - 1]! / (c[i - 1]! - c[i]!));
      return ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0]!);
    };
    expect(pitch(0)).toBeCloseTo(65.41, 0); // C2
    expect(pitch(3)).toBeCloseTo(77.78, 0); // E♭2, in an E♭ render
  });

  it('is a new engine: the mix and the effects changed', () => {
    expect(AUDIO_ENGINE_VERSION).toBe('covi-audio-3');
  });

  it('describes the theme the spec asks for', () => {
    const score = theme();
    expect(score.bpm).toBeGreaterThanOrEqual(96);
    expect(score.bpm).toBeLessThanOrEqual(108);
    expect(score.meter).toBe(4);
    expect(score.key.mode).toBe('major');
    expect(score.form).toMatchObject({
      intro: 'intro',
      hero: 'lift',
      logo: { track: 'bell', double: 'pluck' },
      ending: { 'looks-good': 'resolved', 'needs-attention': 'open', 'needs-changes': 'minor' },
    });
    expect(score.form.loop).toHaveLength(2);
    for (const loop of score.form.loop) expect(score.sections[loop]!.bars).toBe(4);
    expect(score.sections.intro!.bars).toBeLessThanOrEqual(2);
    expect(score.sections.lift!.bars).toBeLessThanOrEqual(2);
  });

  it('rejects drum voices its kits lack, even ones every object has (constructor)', () => {
    const raw = structuredClone(library.scores.get('covi-theme')) as {
      patterns: Record<string, Record<string, unknown>>;
    };
    raw.patterns.kit_a = { drums: { constructor: 'x...' }, step: '1/16' };
    expect(() => checkScoreReferences(parseScore(raw), library)).toThrow(
      /plays "constructor", which kit "soft-acoustic" lacks/,
    );
  });

  it('rejects patches and kits it does not ship, listing what it has', () => {
    const raw = structuredClone(library.scores.get('covi-theme')) as {
      tracks: Record<string, { patch?: string; kit?: string }>;
    };
    raw.tracks.pad!.patch = 'theremin';
    expect(() => checkScoreReferences(parseScore(raw), library)).toThrow(
      /unknown patch "theremin".*Available patches: .*soft-pad/,
    );
    raw.tracks.pad!.patch = 'soft-pad';
    raw.tracks.kit!.kit = 'orchestra';
    expect(() => checkScoreReferences(parseScore(raw), library)).toThrow(
      /unknown kit "orchestra".*soft-acoustic/,
    );
  });
});

describe('the sonic logo', () => {
  it('lands on 3, 2, or 6 below the tonic by verdict, after a pickup of 5 and 1', () => {
    const score = theme(); // E♭ major, the logo at octave 5
    const arrangement = fitMusic(score, { duration: 30, lastLine: 28.5, verdict: 'looks-good' })!;
    const midis = (verdict: 'looks-good' | 'needs-attention' | 'needs-changes') =>
      logoNotes(score, arrangement, verdict).map((n) => n.midi);
    expect(midis('looks-good')).toEqual([70, 75, 79]); // B♭4 E♭5 G5
    expect(midis('needs-attention')).toEqual([70, 75, 77]); // … F5
    expect(midis('needs-changes')).toEqual([70, 75, 72]); // … C5
    const [first, second, landing] = logoNotes(score, arrangement, 'looks-good');
    const beat = arrangement.bar / arrangement.meter;
    expect(landing!.t).toBeCloseTo(arrangement.markers.logo.landing, 9);
    expect(second!.t).toBeCloseTo(landing!.t - 0.5 * beat, 9);
    expect(first!.t).toBeCloseTo(arrangement.markers.logo.start, 9);
  });

  it('is scheduled on the logo track and doubled, and nothing starts after the end', () => {
    const score = theme();
    const arrangement = fitMusic(score, {
      duration: 20,
      hero: 6.45,
      lastLine: 18.5,
      verdict: 'looks-good',
    })!;
    const schedule = scheduleArrangement(score, arrangement, library, 'looks-good');
    const landing = arrangement.markers.logo.landing;
    for (const track of ['bell', 'pluck'])
      expect(
        schedule.get(track)!.some((n) => Math.abs(n.t - landing) < 1e-9 && n.midi === 79),
      ).toBe(true);
    for (const notes of schedule.values()) for (const n of notes) expect(n.t).toBeLessThan(20);
  });
});

describe('rendering music', () => {
  it('refuses a score that schedules too many notes for the video', () => {
    expect(noteLimit(120)).toBe(20_000);
    // Every short kit voice on every 32nd-note triplet at 160 bpm: 256 notes a second, where Covi
    // allows 167 (and their sound stays within its budget, so the count is what fails).
    const voices = ['kick', 'snare', 'hat', 'shaker', 'woodblock', 'woodblock-lo', 'rim', 'snap'];
    const dense = parseScore({
      id: 'dense',
      bpm: 160,
      key: 'C major',
      tracks: { kit: { kit: 'soft-acoustic' }, pad: { patch: 'soft-pad' } },
      patterns: {
        beat: { drums: Object.fromEntries(voices.map((v) => [v, 'X'.repeat(48)])), step: '1/32t' },
      },
      sections: { a: { bars: 8, play: ['beat'] }, end: { bars: 1, play: [] } },
      form: { loop: ['a'], ending: 'end', logo: { track: 'pad', octave: 5 } },
    });
    const arrangement = fitMusic(dense, { duration: 20, lastLine: 18.5, verdict: 'looks-good' })!;
    expect(() => scheduleArrangement(dense, arrangement, library, 'looks-good')).toThrow(
      /more than 3334 notes/,
    );
    expect(() => scheduleArrangement(dense, arrangement, library, 'looks-good')).toThrow(
      ScoreError,
    );
  });

  it('cuts every note at the end of the video, however long the score holds it', () => {
    // One tone held for sixteen bars (38 s at 100 bpm) in a 20 s video.
    const held = parseScore({
      id: 'held',
      bpm: 100,
      key: 'C major',
      tracks: { pad: { patch: 'soft-pad' } },
      patterns: { pad_a: { notes: 'C4', step: 16 } },
      sections: { a: { bars: 16, play: ['pad_a'] }, end: { bars: 1, play: [] } },
      form: { loop: ['a'], ending: 'end', logo: { track: 'pad', octave: 5 } },
    });
    const arrangement = fitMusic(held, { duration: 20, lastLine: 18.5, verdict: 'looks-good' })!;
    const notes = scheduleArrangement(held, arrangement, library, 'looks-good').get('pad')!;
    expect(Math.max(...notes.map((n) => n.dur))).toBeGreaterThan(15);
    for (const n of notes) expect(n.t + n.dur).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('refuses a score that sounds for more than 48 s per second of video, releases included', () => {
    // Twelve tones held all bar long on each of eight tracks: about 90 s of sound a second.
    const tracks = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`p${i}`, { patch: 'soft-pad' }]),
    );
    const cluster = 'C3+D3+E3+F3+G3+A3+B3+C4+D4+E4+F4+G4 . . . . . . .';
    const patterns = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [
        `hold${i}`,
        { notes: cluster, step: '1/8', track: `p${i}` },
      ]),
    );
    const held = parseScore({
      id: 'held-down',
      bpm: 100,
      key: 'C major',
      tracks,
      patterns,
      sections: { a: { bars: 8, play: Object.keys(patterns) }, end: { bars: 1, play: [] } },
      form: { loop: ['a'], ending: 'end', logo: { track: 'p0', octave: 5 } },
    });
    const twenty = fitMusic(held, { duration: 20, lastLine: 18.5, verdict: 'looks-good' })!;
    expect(() => scheduleArrangement(held, twenty, library, 'looks-good')).toThrow(
      /sounds for more than 960 s in a 20 s video/,
    );
    // Short notes count their whole sound too: low bell clusters ring for seconds each, and
    // humanized velocities keep every note distinct, so no note could be rendered once and reused.
    const low = 'C-1+C#-1+D-1+D#-1+E-1+F-1+F#-1+G-1+G#-1+A-1+A#-1+B-1';
    const rings = parseScore({
      id: 'low-bells',
      bpm: 160,
      key: 'C major',
      tracks: { bell: { patch: 'bell' } },
      patterns: {
        bell_ring: {
          notes: Array(16).fill(low).join(' '),
          step: '1/16',
          gate: 0.05,
          humanize: 0.3,
        },
      },
      sections: { a: { bars: 1, play: ['bell_ring'] }, end: { bars: 1, play: [] } },
      form: { loop: ['a'], ending: 'end', logo: { track: 'bell', octave: 5 } },
    });
    const fifteen = fitMusic(rings, { duration: 15, lastLine: 13.5, verdict: 'looks-good' })!;
    expect(() => scheduleArrangement(rings, fifteen, library, 'looks-good')).toThrow(
      /sounds for more than 720 s in a 15 s video, counting every note with its release/,
    );
    // The theme sounds 10 to 16 seconds a second.
    const score = theme();
    const fitted = fitMusic(score, {
      duration: 30,
      hero: 12,
      lastLine: 28,
      verdict: 'looks-good',
    })!;
    const all = [...scheduleArrangement(score, fitted, library, 'looks-good').values()].flat();
    const sound = all.reduce(
      (sum, n) =>
        sum + noteSeconds(library.patches.get(n.patch)!, { midi: n.midi, duration: n.dur }),
      0,
    );
    expect(sound / 30).toBeLessThan(16);
  });

  it('renders the same bytes whether or not its note cache has room', () => {
    const score = theme();
    const fitted = fitMusic(score, { duration: 8, lastLine: 3.6, verdict: 'looks-good' })!;
    const arrangement = {
      ...fitted,
      duration: 3,
      markers: { ...fitted.markers, fade: { start: 2.5, end: 3 } },
    };
    const cached = renderMusic(score, arrangement, library, { verdict: 'looks-good' });
    const uncached = renderMusic(score, arrangement, library, {
      verdict: 'looks-good',
      cacheSeconds: 0,
    });
    expect(hashOf(uncached[0]!, uncached[1]!)).toBe(hashOf(cached[0]!, cached[1]!));
  });

  it('is deterministic, as long as the video, and silent at the end', () => {
    const score = theme();
    const fitted = fitMusic(score, { duration: 8, lastLine: 3.6, verdict: 'needs-changes' })!;
    // Five seconds of it keeps the test fast: cut the arrangement short, fade included.
    const arrangement = {
      ...fitted,
      duration: 5,
      markers: { ...fitted.markers, fade: { start: 4.5, end: 5 } },
    };
    const a = renderMusic(score, arrangement, library, { verdict: 'needs-changes' });
    const b = renderMusic(score, arrangement, library, { verdict: 'needs-changes' });
    expect(a[0]!.length).toBe(5 * 48_000);
    expect(hashOf(a[0]!, a[1]!)).toBe(hashOf(b[0]!, b[1]!));
    const tail = a.map((c) => Math.max(...c.subarray(c.length - 480).map(Math.abs)));
    expect(20 * Math.log10(Math.max(...tail, 1e-12))).toBeLessThan(-60);
    expect(Math.abs(a[0]![a[0]!.length - 1]!)).toBe(0);
  });
});

describe('the music cache key', () => {
  const input = {
    score: library.scores.get('covi-theme'),
    fingerprint: library.fingerprint,
    duration: 30,
    hero: 10.45,
    lastLine: 28.5,
    verdict: 'looks-good',
    seed: 1,
    sampleRate: 48_000,
  };

  it('changes with anything the render depends on, and with the engine version', () => {
    const key = musicCacheKey(input);
    expect(musicCacheKey({ ...input })).toBe(key);
    expect(musicCacheKey(input, AUDIO_ENGINE_VERSION)).toBe(key);
    expect(musicCacheKey(input, 'covi-audio-0')).not.toBe(key);
    for (const change of [
      { duration: 31 },
      { hero: undefined },
      { lastLine: 28 },
      { verdict: 'needs-changes' },
      { seed: 2 },
      { fingerprint: 'other' },
    ])
      expect(musicCacheKey({ ...input, ...change }), JSON.stringify(change)).not.toBe(key);
  });
});

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
