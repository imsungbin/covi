/*
 * Music theory helpers: note names, keys and scale degrees, chord symbols, chord voicing with
 * smooth voice leading, arpeggio chord tones, and note values. MIDI 60 = C4, A4 = 440 Hz.
 */

export type Mode =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'harmonic-minor'
  | 'melodic-minor';

export interface Key {
  /** Tonic as a MIDI note in octave 3 (D major → 50). */
  tonic: number;
  mode: Mode;
}

export interface Chord {
  symbol: string;
  /** Root pitch class 0..11. */
  root: number;
  /** Semitones above the root, ascending. */
  intervals: number[];
  /** Slash-bass pitch class (C/E → 4). */
  bass?: number;
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function accidental(acc: string): number {
  return acc === '#'
    ? 1
    : acc === '##' || acc === 'x'
      ? 2
      : acc === 'b'
        ? -1
        : acc === 'bb'
          ? -2
          : 0;
}

/** Pitch class of a note name without octave: "F#" → 6, "Bb" → 10, "Cb" → 11. */
export function pitchClass(name: string): number {
  const m = /^([A-Ga-g])(##|#|bb|b|x)?$/.exec(name.trim());
  if (!m) throw new Error(`invalid pitch name "${name}"`);
  return (((LETTER[m[1]!.toUpperCase()]! + accidental(m[2] ?? '')) % 12) + 12) % 12;
}

/** "F#4" → 66, "C4" → 60, "Bb3" → 58. Scientific pitch notation; octaves may be negative. */
export function noteToMidi(note: string): number {
  const m = /^([A-Ga-g])(##|#|bb|b|x)?(-?\d+)$/.exec(note.trim());
  if (!m) throw new Error(`invalid note "${note}" (expected a name like C4, F#2 or Bb3)`);
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!.toUpperCase()]! + accidental(m[2] ?? '');
}

/** A note name or a MIDI number. */
export function toMidi(v: string | number): number {
  return typeof v === 'number' ? v : noteToMidi(v);
}

export function midiToFreq(m: number): number {
  return 440 * 2 ** ((m - 69) / 12);
}

export const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
};

const MODE_ALIASES: Record<string, Mode> = {
  '': 'major',
  major: 'major',
  maj: 'major',
  ionian: 'major',
  m: 'minor',
  min: 'minor',
  minor: 'minor',
  aeolian: 'minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  'harmonic minor': 'harmonic-minor',
  'harmonic-minor': 'harmonic-minor',
  'melodic minor': 'melodic-minor',
  'melodic-minor': 'melodic-minor',
};

/** An own entry of `table`: scores are untrusted, and "constructor" must not find Object's. */
function lookup<T>(table: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** "D major" → { tonic: 50, mode: 'major' }; also "F# minor", "Am", "G mixolydian". */
export function parseKey(s: string): Key {
  const m = /^\s*([A-Ga-g](?:#|b)?)\s*(.*?)\s*$/.exec(s);
  const mode = m ? lookup(MODE_ALIASES, m[2]!.toLowerCase().replace(/\s+/g, ' ')) : undefined;
  if (!m || !mode)
    throw new Error(`invalid key "${s}" (expected e.g. "D major", "F# minor", "G mixolydian")`);
  return { tonic: 48 + pitchClass(m[1]!), mode };
}

/**
 * MIDI note of scale degree `deg` (1 = tonic; 8 = tonic an octave up; 0/negatives go below) with
 * the tonic placed in `octave`; `alter` adds semitones (for ♯/♭ degrees).
 */
export function degreeToMidi(deg: number, key: Key, octave: number, alter = 0): number {
  const scale = SCALES[key.mode];
  const idx = Math.round(deg) - 1;
  const oct = Math.floor(idx / 7);
  const step = ((idx % 7) + 7) % 7;
  return 12 * (octave + 1) + (key.tonic % 12) + scale[step]! + 12 * oct + alter;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  '9': [0, 4, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  m9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  // Dominant 11 without the 3rd (the 3rd clashes with the 11th): the modern "sus" sound.
  '11': [0, 7, 10, 14, 17],
  m11: [0, 3, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  maj13: [0, 4, 7, 11, 14, 21],
  sus: [0, 5, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '9sus4': [0, 5, 7, 10, 14],
  '6sus': [0, 5, 7, 9],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  'maj7#11': [0, 4, 7, 11, 18],
};

/** Chord qualities understood by `parseChord` (the part after the root). */
export const CHORD_QUALITIES = Object.keys(QUALITIES);

/**
 * "Bm11" → { root: 11, intervals: [0,3,7,10,14,17] };
 * "C/E" → { root: 0, intervals: [0,4,7], bass: 4 }.
 */
export function parseChord(symbol: string): Chord {
  const m = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(symbol.trim());
  if (!m) throw new Error(`invalid chord "${symbol}"`);
  const quality = m[2]!;
  const intervals = lookup(QUALITIES, quality);
  if (!intervals) {
    const known = CHORD_QUALITIES.filter(Boolean).join(' ');
    throw new Error(`unknown chord "${symbol}" (quality "${quality}"; known: ${known})`);
  }
  const chord: Chord = { symbol, root: pitchClass(m[1]!), intervals: [...intervals] };
  if (m[3]) chord.bass = pitchClass(m[3]);
  return chord;
}

function chordPcs(chord: Chord): number[] {
  const pcs: number[] = [];
  for (const i of chord.intervals) {
    const pc = (chord.root + i) % 12;
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  if (chord.bass !== undefined && !pcs.includes(chord.bass)) pcs.push(chord.bass);
  return pcs;
}

/** Symmetric nearest-neighbour distance between two voicings (works for different sizes). */
function leadingDistance(a: number[], b: number[]): number {
  let d = 0;
  for (const x of a) d += Math.min(...b.map((y) => Math.abs(x - y)));
  for (const y of b) d += Math.min(...a.map((x) => Math.abs(x - y)));
  return d;
}

/**
 * Voice `chord` inside [low, high] (MIDI, inclusive): every chord tone once, ascending. With
 * `prev`, the voicing closest to the previous chord wins (smooth voice leading); without it, a
 * centred voicing with the root (or slash bass) at the bottom is preferred. Muddy close
 * intervals low in the register are penalised.
 */
export function voiceChord(chord: Chord, range: [number, number], prev?: number[]): number[] {
  const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]];
  const pcs = chordPcs(chord);
  const options = pcs.map((pc) => {
    const list: number[] = [];
    for (let m = lo; m <= hi; m++) if (((m % 12) + 12) % 12 === pc) list.push(m);
    return list;
  });
  const placeable = options.filter((o) => o.length > 0);
  if (placeable.length === 0) return [Math.round((lo + hi) / 2)];
  const center = lo + 0.45 * (hi - lo);
  const bassPc = chord.bass ?? chord.root;
  let best: number[] | null = null;
  let bestCost = Infinity;
  const pick: number[] = new Array(placeable.length);
  const visit = (k: number) => {
    if (k === placeable.length) {
      const v = [...pick].sort((a, b) => a - b);
      let cost = 0;
      for (let i = 1; i < v.length; i++) {
        const gap = v[i]! - v[i - 1]!;
        if (gap < 3 && v[i - 1]! < 52) cost += 4; // low clusters are mud
        if (gap === 1) cost += 1.5; // semitone rubs: prefer spreading them
      }
      const span = v[v.length - 1]! - v[0]!;
      if (span > 19) cost += 0.3 * (span - 19);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      if (prev?.length) cost += leadingDistance(v, prev) + 0.1 * Math.abs(mean - center);
      else cost += 0.5 * Math.abs(mean - center) + (v[0]! % 12 === bassPc ? 0 : 1.5);
      if (chord.bass !== undefined && v[0]! % 12 !== chord.bass) cost += 6;
      if (
        cost < bestCost - 1e-9 ||
        (Math.abs(cost - bestCost) <= 1e-9 && best && v.join() < best.join())
      ) {
        bestCost = cost;
        best = v;
      }
      return;
    }
    for (const m of placeable[k]!) {
      if (pick.slice(0, k).includes(m)) continue;
      pick[k] = m;
      visit(k + 1);
    }
  };
  visit(0);
  return best ?? [Math.round((lo + hi) / 2)];
}

/**
 * Arpeggio chord tones: the chord's pitch classes stacked ascending from the root placed in
 * `octave` (slash bass excluded). Index i picks tones[i]; indices past the end wrap up an octave.
 */
export function chordTones(chord: Chord, octave: number): number[] {
  const base = 12 * (octave + 1) + chord.root;
  const seen = new Set<number>();
  const tones: number[] = [];
  for (const i of chord.intervals) {
    const pc = (chord.root + i) % 12;
    if (seen.has(pc)) continue;
    seen.add(pc);
    tones.push(base + i);
  }
  return tones;
}

export function arpTone(tones: number[], index: number): number {
  const n = tones.length;
  const i = ((index % n) + n) % n;
  return tones[i]! + 12 * Math.floor(index / n);
}

/**
 * Length in beats (quarter notes) of a note value: "1/16" → 0.25, "3/16" → 0.75, "1/8t" → 1/3
 * (triplet), "1/4." → 1.5 (dotted); a number is a fraction of a whole note.
 */
export function noteValueBeats(v: string | number): number {
  if (typeof v === 'number') return v * 4;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*([t.])?\s*$/.exec(v);
  if (!m || Number(m[2]) === 0)
    throw new Error(`invalid note value "${v}" (expected e.g. 1/16, 3/16, 1/8t, 1/4.)`);
  let beats = (Number(m[1]) / Number(m[2])) * 4;
  if (m[3] === 't') beats *= 2 / 3;
  if (m[3] === '.') beats *= 1.5;
  return beats;
}
