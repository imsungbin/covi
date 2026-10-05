import { describe, expect, it } from 'vitest';
import { type ParsedScore, parseScore, ScoreError } from '../src/music/score.ts';
import {
  degreeToMidi,
  midiToFreq,
  noteToMidi,
  parseChord,
  parseKey,
  voiceChord,
} from '../src/music/theory.ts';

const LOGO = { track: 'pad', octave: 5 };

function mini(patterns: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'mini',
    bpm: 120,
    meter: 4,
    key: 'C major',
    tracks: {
      pad: { patch: 'soft-pad' },
      pluck: { patch: 'glass-pluck' },
      bass: { patch: 'round-bass' },
      drums: { kit: 'soft-electro' },
    },
    patterns,
    sections: { a: { bars: 2, play: Object.keys(patterns).slice(0, 16) } },
    form: { loop: ['a'], ending: 'a', logo: LOGO },
    ...extra,
  };
}

const MELODY = { bass_a: { notes: 'C2 - - -', step: '1/4' } };

/** A complete score in Covi's format: intro, loop, hero, ending and the logo's track. */
const PULSE = {
  id: 'editorial-pulse',
  bpm: 112,
  key: 'D major',
  tracks: {
    pad: { patch: 'soft-pad', gain: -14, reverb: 0.3, chorus: true },
    pluck: { patch: 'glass-pluck', gain: -17, pan: 0.2, delay: 0.25, reverb: 0.2, chorus: false },
    bass: { patch: 'round-bass', gain: -13 },
    drums: { kit: 'soft-electro', gain: -12 },
  },
  fx: { delay: { time: '3/16', feedback: 0.32, lowpass: 5000 }, reverb: { size: 0.78, damp: 0.4 } },
  patterns: {
    prog_a: { chords: 'Dmaj9 | Bm11 | Gmaj9 | A6', voicing: ['C3', 'C5'], track: 'pad' },
    arp_a: { arp: 'prog_a', steps: "0 1 2 3 1' 2 3 1", step: '1/16', octave: 4, track: 'pluck' },
    bass_a: {
      notes: 'D2 . - D2 - - A1 - | B1 . - B1 - - F#1 - | G1 . - G1 - - D2 - | A1 . - A1 - E2 - -',
      step: '1/8',
    },
    beat_a: {
      drums: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: '..x...x...x...x.',
        shaker: 'gxgxgxgxgxgxgxgx',
      },
      step: '1/16',
    },
    motif: {
      degrees: '2 3 6 5 . . . .',
      step: '1/8',
      octave: 5,
      patch: 'glass-pluck',
      track: 'pluck',
    },
  },
  sections: {
    intro: { bars: 1, play: ['prog_a', 'arp_a'] },
    a: { bars: 4, play: ['prog_a', 'arp_a', 'bass_a', 'beat_a'] },
    hit: { bars: 1, play: ['prog_a', 'arp_a', 'bass_a', 'beat_a'], accent: true },
    outro: { bars: 2, play: ['motif', 'prog_a'] },
  },
  form: {
    intro: 'intro',
    loop: ['a'],
    hero: 'hit',
    ending: 'outro',
    logo: { track: 'pluck', octave: 5 },
  },
};

const pattern = (s: ParsedScore, name: string) => s.patterns[name]!;
const ev = (s: ParsedScore, name: string) =>
  pattern(s, name).events.map((e) => [e.beat, e.midi, +e.beats.toFixed(3), +e.velocity.toFixed(3)]);

/** Parsing fails with a ScoreError whose message matches. */
function rejects(score: unknown, message: RegExp) {
  let error: unknown;
  try {
    parseScore(score);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ScoreError);
  expect((error as Error).message).toMatch(message);
}

describe('theory', () => {
  it('converts notes, keys and degrees', () => {
    expect(noteToMidi('F#4')).toBe(66);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('A1')).toBe(33);
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
    expect(parseKey('D major')).toEqual({ tonic: 62 - 12, mode: 'major' });
    expect(parseKey('F# minor').tonic).toBe(54);
    const d = parseKey('D major');
    expect([2, 3, 6, 5].map((g) => degreeToMidi(g, d, 5))).toEqual([76, 78, 83, 81]); // E5 F#5 B5 A5
    expect(degreeToMidi(8, d, 4)).toBe(74);
    expect(degreeToMidi(3, parseKey('A minor'), 4)).toBe(72); // C5
  });

  it('rejects keys and chords named after Object.prototype members', () => {
    expect(() => parseKey('C constructor')).toThrow(/invalid key/);
    expect(() => parseChord('CtoString')).toThrow(/unknown chord/);
  });

  it('parses chord symbols', () => {
    expect(parseChord('Bm11')).toMatchObject({ root: 11, intervals: [0, 3, 7, 10, 14, 17] });
    expect(parseChord('Dmaj9').intervals).toEqual([0, 4, 7, 11, 14]);
    expect(parseChord('A6').intervals).toEqual([0, 4, 7, 9]);
    expect(parseChord('Ebsus4')).toMatchObject({ root: 3, intervals: [0, 5, 7] });
    expect(parseChord('C/E')).toMatchObject({ root: 0, intervals: [0, 4, 7], bass: 4 });
    for (const sym of [
      'C',
      'Cm',
      'C7',
      'Cmaj7',
      'Cm7',
      'C6',
      'Cm6',
      'C9',
      'Cmaj9',
      'Cm9',
      'C11',
      'Cm11',
      'Csus2',
      'Csus4',
      'C6sus',
      'Cadd9',
      'Cdim',
      'Caug',
    ])
      expect(parseChord(sym).intervals[0], sym).toBe(0);
    expect(() => parseChord('Cfoo')).toThrow(/Cfoo/);
  });

  it('voices chords inside the range and leads voices smoothly', () => {
    const ranges: Array<[number, number]> = [
      [48, 72],
      [55, 79],
      [40, 64],
    ];
    for (const sym of ['C', 'Dmaj9', 'Bm11', 'G7', 'F#m7', 'Ebmaj7', 'C/E', 'A6']) {
      for (const range of ranges) {
        const v = voiceChord(parseChord(sym), range);
        expect(
          v.every((m) => m >= range[0] && m <= range[1]),
          `${sym} in ${range}`,
        ).toBe(true);
        const pcs = new Set(v.map((m) => m % 12));
        const want = parseChord(sym);
        for (const i of want.intervals)
          expect(pcs.has((want.root + i) % 12), `${sym} has ${i}`).toBe(true);
        expect([...v].sort((a, b) => a - b)).toEqual(v);
      }
    }
    let prev = voiceChord(parseChord('C'), [48, 72]);
    for (const sym of ['F', 'G', 'Am', 'C']) {
      const next = voiceChord(parseChord(sym), [48, 72], prev);
      const moved = next.reduce((s, m, i) => s + Math.abs(m - prev[i]!), 0);
      // F → G shares no tones, so 6 semitones (each voice a whole step) is the minimum there.
      expect(moved, `${sym}: ${prev} → ${next}`).toBeLessThanOrEqual(6);
      prev = next;
    }
  });
});

describe('parseScore', () => {
  it('parses a complete score: tracks, pattern lengths, fx and form', () => {
    const s = parseScore(PULSE);
    expect(s).toMatchObject({
      id: 'editorial-pulse',
      bpm: 112,
      meter: 4,
      key: { tonic: 50, mode: 'major' },
      keyName: 'D major',
      draft: false,
    });
    expect(pattern(s, 'bass_a').track).toBe('bass');
    expect(pattern(s, 'beat_a').track).toBe('drums');
    expect(pattern(s, 'prog_a').lengthBeats).toBe(16);
    expect(pattern(s, 'arp_a').lengthBeats).toBe(16);
    expect(pattern(s, 'beat_a').lengthBeats).toBe(4);
    expect(pattern(s, 'motif').events.map((e) => e.midi)).toEqual([76, 78, 83, 81]);
    expect(pattern(s, 'motif').events[0]!.patch).toBe('glass-pluck');
    expect(s.tracks.map((t) => [t.name, t.chorus])).toEqual([
      ['pad', { depth: 0.4, rate: 0.3, mix: 0.4 }],
      ['pluck', false],
      ['bass', undefined],
      ['drums', undefined],
    ]);
    expect(s.fx.delay).toEqual({
      beats: 0.75,
      feedback: 0.32,
      lowpass: 5000,
      highpass: 300,
      pingpong: true,
    });
    expect(s.fx.reverb).toMatchObject({ size: 0.78, damp: 0.4, width: 1, predelay: 0.015 });
    expect(s.sections.hit).toMatchObject({ name: 'hit', bars: 1, accent: true });
    expect(s.form).toEqual({
      intro: 'intro',
      loop: ['a'],
      hero: 'hit',
      ending: 'outro',
      logo: { track: 'pluck', octave: 5 },
    });
  });

  it('keeps one ending per verdict', () => {
    const ending = { 'looks-good': 'a', 'needs-attention': 'a', 'needs-changes': 'a' };
    const s = parseScore(mini(MELODY, { form: { loop: 'a', ending, logo: LOGO } }));
    expect(s.form.ending).toEqual(ending);
    expect(s.form.loop).toEqual(['a']);
  });

  it('expands chords, arps (chord-tone indices), notes and drum grids', () => {
    const s = parseScore(
      mini({
        prog: { chords: 'C | Am', track: 'pad' },
        arp: { arp: 'prog', steps: "0 1 2 3 4 1' 2, -", step: '1/8', octave: 4, track: 'pluck' },
        bass_a: { notes: 'C2 . - G1 | A1 . . -', step: '1/4' },
        beat: { drums: { kick: 'X...x...', shaker: 'g.x.' }, step: '1/8' },
      }),
    );
    expect(pattern(s, 'arp').events.map((e) => e.midi)).toEqual([
      60, 64, 67, 72, 76, 76, 55, 69, 72, 76, 81, 84, 84, 64,
    ]);
    expect(pattern(s, 'arp').events.map((e) => e.beat)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 4.5, 5, 5.5, 6, 6.5, 7,
    ]);
    expect(ev(s, 'bass_a')).toEqual([
      [0, 36, 1.9, 0.8],
      [3, 31, 0.95, 0.8],
      [4, 33, 2.85, 0.8],
    ]);
    const beat = pattern(s, 'beat').events;
    expect(beat.filter((e) => e.voice === 'kick').map((e) => [e.beat, e.velocity])).toEqual([
      [0, 1],
      [2, 0.8],
    ]);
    expect(
      beat.filter((e) => e.voice === 'shaker').map((e) => [e.beat, +e.velocity.toFixed(2)]),
    ).toEqual([
      [0, 0.35],
      [1, 0.8],
      [2, 0.35],
      [3, 0.8],
    ]);
    const chords = pattern(s, 'prog').events;
    const pcsAt = (beat: number) =>
      chords
        .filter((e) => e.beat === beat)
        .map((e) => e.midi % 12)
        .sort((a, b) => a - b);
    expect(pcsAt(0)).toEqual([0, 4, 7]);
    expect(pcsAt(4)).toEqual([0, 4, 9]);
    expect(chords[0]!.beats).toBeCloseTo(3.8, 9);
    expect(chords[0]!.chord).toHaveLength(3);
  });

  it('applies swing to off-beat steps', () => {
    const s = parseScore(
      mini({ bass_a: { notes: 'C2 C2 C2 C2 C2 C2 C2 C2', step: '1/8', swing: 0.2 } }),
    );
    expect(pattern(s, 'bass_a').events.map((e) => e.beat)).toEqual([
      0, 0.6, 1, 1.6, 2, 2.6, 3, 3.6,
    ]);
  });

  it('drops notes that a transposition pushes outside MIDI 0–127', () => {
    const s = parseScore(mini({ bass_a: { notes: 'G9 C4', step: '1/2', transpose: 1 } }));
    expect(pattern(s, 'bass_a').events.map((e) => e.midi)).toEqual([61]);
  });
});

describe('invalid scores', () => {
  it('reports a schema failure as a ScoreError naming the score', () => {
    rejects(mini(MELODY, { bpm: 'fast' }), /^invalid score "mini":\n.*bpm/s);
    rejects(null, /^invalid score:/);
  });

  it('names the pattern whose bar length is wrong', () => {
    rejects(mini({ bass_a: { notes: 'C2 . - | G1 . . .', step: '1/4' } }), /bass_a.*bar 1/);
  });

  it('names the pattern that plays an unknown chord', () => {
    rejects(
      mini({ prog: { chords: 'C | Cfoo', track: 'pad' } }),
      /pattern "prog": unknown chord "Cfoo"/,
    );
  });

  it('rejects a key it cannot read', () => {
    rejects(mini(MELODY, { key: 'H major' }), /invalid key "H major"/);
  });

  it('requires a track for patterns it cannot infer', () => {
    rejects(mini({ lead_x: { notes: 'C4 - - -', step: '1/4' } }), /lead_x/);
  });

  it('rejects names that only resolve through Object.prototype', () => {
    rejects(
      mini(MELODY, { form: { loop: ['constructor'], ending: 'a', logo: LOGO } }),
      /unknown section "constructor"/,
    );
    rejects(
      mini({ x: { notes: 'C4 - - -', step: '1/4', track: 'constructor' } }),
      /unknown track "constructor"/,
    );
    rejects(
      { ...mini(MELODY), sections: { a: { bars: 2, play: ['bass_a', 'toString'] } } },
      /unknown pattern "toString"/,
    );
  });

  it('rejects voicings outside the MIDI range and patterns longer than a section', () => {
    rejects(mini({ pad_a: { chords: 'C', voicing: ['C10', 'C11'] } }), /voicing/);
    const huge = `C${'9'.repeat(400)}`; // Infinity as a MIDI number
    rejects(mini({ pad_a: { chords: 'C', voicing: [huge, huge] } }), /voicing/);
    rejects(mini({ bass_a: { notes: 'C2 . . . . . . . .', step: 16 } }), /longer than 128 bars/);
  });
});

describe('score limits', () => {
  it('rejects more than 8 tracks, 40 patterns, or a pattern over 2000 characters', () => {
    const tracks = Object.fromEntries([
      ['pad', { patch: 'soft-pad' }],
      ['bass', { patch: 'round-bass' }],
      ...Array.from({ length: 7 }, (_, i) => [`t${i}`, { patch: 'bell' }]),
    ]);
    rejects(mini(MELODY, { tracks }), /at most 8 tracks/);
    const patterns = Object.fromEntries(
      Array.from({ length: 41 }, (_, i) => [`bass_${i}`, { notes: 'C2 - - -', step: '1/4' }]),
    );
    rejects(mini(patterns), /at most 40 patterns/);
    rejects(mini({ bass_a: { notes: '-'.repeat(2001), step: '1/4' } }), /2000 characters/);
  });

  it('rejects a tempo outside 60–160 BPM, a meter other than 3 or 4, and a 1/64 note value', () => {
    rejects(mini(MELODY, { bpm: 59 }), /bpm/);
    rejects(mini(MELODY, { bpm: 161 }), /bpm/);
    rejects(mini(MELODY, { meter: 5 }), /meter/);
    rejects(mini({ bass_a: { notes: 'C2 - - -', step: '1/64' } }), /expected a note value/);
  });

  it('rejects a voicing range wider than 30 semitones', () => {
    rejects(mini({ pad_a: { chords: 'C', voicing: ['C3', 'G5'] } }), /at most 30 semitones/);
    expect(parseScore(mini({ pad_a: { chords: 'C', voicing: ['C3', 'F#5'] } })).id).toBe('mini');
  });

  it('rejects voicing notes outside octaves −1 to 9, and drops pattern notes outside MIDI', () => {
    rejects(mini({ pad_a: { chords: 'C', voicing: [`C${'9'.repeat(400)}`, 'C4'] } }), /note name/);
    const huge = `C${'9'.repeat(400)}`;
    const s = parseScore(mini({ bass_a: { notes: `C10 C2 ${huge} -`, step: '1/4' } }));
    expect(pattern(s, 'bass_a').events.map((e) => e.midi)).toEqual([36]);
  });

  it('rejects names that exist only on Object.prototype', () => {
    rejects(
      mini({ bass_a: { notes: 'C2 - - -', step: '1/4', track: 'constructor' } }),
      /constructor/,
    );
    rejects(mini(MELODY, { form: { loop: ['toString'], ending: 'a', logo: LOGO } }), /toString/);
    rejects(
      mini(MELODY, {
        form: { loop: ['a'], ending: 'a', logo: { track: 'constructor', octave: 5 } },
      }),
      /constructor/,
    );
    rejects(mini({ arp_x: { arp: 'toString', steps: '0 1', track: 'pluck' } }), /toString/);
  });

  it('bounds the chord changes a score may ask to voice', () => {
    const steps = (n: number) =>
      Array.from({ length: n }, (_, k) => (k % 2 ? 'Dm9' : 'C13')).join(' ');
    expect(parseScore(mini({ pad_a: { chords: steps(256), step: '1/16' } })).id).toBe('mini');
    rejects(
      mini({ pad_a: { chords: steps(257), step: '1/16' } }),
      /257 chord changes; a score may have at most 256/,
    );
  });

  it('rejects a step that joins more than 12 tones', () => {
    const cluster = (n: number) =>
      Array.from({ length: n }, (_, k) => `${'CDEFGAB'[k % 7]}${3 + Math.floor(k / 7)}`).join('+');
    expect(parseScore(mini({ pad_a: { notes: `${cluster(12)} - - -`, step: '1/4' } })).id).toBe(
      'mini',
    );
    rejects(
      mini({ pad_a: { notes: `${cluster(13)} - - -`, step: '1/4' } }),
      /joins 13 tones; a step may join at most 12/,
    );
    rejects(
      mini({ pad_a: { degrees: `${Array(13).fill('1').join('+')} - - -`, step: '1/4' } }),
      /joins 13 tones/,
    );
  });

  it('rejects a logo on a kit track and an ending map that misses a verdict', () => {
    rejects(
      mini(MELODY, { form: { loop: ['a'], ending: 'a', logo: { track: 'drums', octave: 5 } } }),
      /must be a melodic track/,
    );
    const ending = { 'looks-good': 'a', 'needs-attention': 'a' };
    rejects(mini(MELODY, { form: { loop: ['a'], ending, logo: LOGO } }), /form\.ending/);
  });
});
