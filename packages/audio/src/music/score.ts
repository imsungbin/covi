/*
 * Score parser: validates a score (ScoreSchema) and expands every pattern into note events in
 * beats, relative to the pattern start. See ../schema/score.ts for the token language.
 *
 * Scores are untrusted, so the parser also rejects what the schema cannot see: names that only
 * resolve through Object.prototype, voicings outside the MIDI range, and patterns longer than a
 * section can play. Notes that land outside MIDI 0–127 (after octave marks and transposition) are
 * dropped.
 */
import { z } from 'zod';
import { mulberry32, seedFrom } from '../dsp/prng.ts';
import {
  resolvePatternTrack,
  SCORE_LIMITS,
  type Score,
  type ScorePattern,
  ScoreSchema,
  type Verdict,
} from '../schema/score.ts';
import {
  arpTone,
  type Chord,
  chordTones,
  degreeToMidi,
  type Key,
  noteToMidi,
  noteValueBeats,
  parseChord,
  parseKey,
  toMidi,
  voiceChord,
} from './theory.ts';

export interface ScoreEvent {
  track: string;
  /** Onset in beats from the pattern start. */
  beat: number;
  /** Sounding length in beats (gate applied). */
  beats: number;
  midi: number;
  velocity: number;
  /** Drum voice (kick, snare, …) for kit tracks. */
  voice?: string;
  /** Patch override for this pattern. */
  patch?: string;
  /** The whole voiced chord this note belongs to (chords patterns). */
  chord?: number[];
}

export type PatternKind = 'chords' | 'arp' | 'notes' | 'degrees' | 'drums';

export interface ParsedPattern {
  name: string;
  kind: PatternKind;
  track: string;
  lengthBeats: number;
  events: ScoreEvent[];
}

export interface ChorusSettings {
  depth: number;
  rate: number;
  mix: number;
}

export interface ParsedTrack {
  name: string;
  patch?: string;
  kit?: string;
  gain: number;
  pan: number;
  delay: number;
  reverb: number;
  /** undefined = the patch's default chorus; false = none. */
  chorus?: ChorusSettings | false;
  highpass?: number;
  lowpass?: number;
  mute: boolean;
}

export interface ParsedSection {
  name: string;
  bars: number;
  play: string[];
  accent: boolean;
}

export interface ParsedFx {
  delay: { beats: number; feedback: number; lowpass: number; highpass: number; pingpong: boolean };
  reverb: {
    size: number;
    damp: number;
    width: number;
    predelay: number;
    lowcut: number;
    highcut: number;
  };
}

export interface ParsedScore {
  id: string;
  bpm: number;
  /** Beats (quarter notes) per bar. */
  meter: number;
  key: Key;
  /** The key as written, e.g. "Eb major". */
  keyName: string;
  draft: boolean;
  tracks: ParsedTrack[];
  fx: ParsedFx;
  patterns: Record<string, ParsedPattern>;
  sections: Record<string, ParsedSection>;
  form: {
    intro?: string;
    loop: string[];
    hero?: string;
    ending: string | Record<Verdict, string>;
    logo: { track: string; octave: number; double?: string };
  };
  source: Score;
}

/** A score Covi cannot play: it fails the schema, or one of its patterns cannot be read. */
export class ScoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScoreError';
  }
}

const DEFAULT_CHORUS: ChorusSettings = { depth: 0.4, rate: 0.3, mix: 0.4 };
const ACCENT = 1.25;
const GHOST = 0.35 / 0.8;
const EPS = 1e-9;
/** A section lasts at most 128 bars, so a longer pattern never plays to its end. */
const MAX_PATTERN_BARS = 128;

interface Segment {
  start: number;
  end: number;
  chord: Chord | null;
}

interface Segments {
  segments: Segment[];
  lengthBeats: number;
}

function fail(name: string, msg: string): never {
  throw new ScoreError(`pattern "${name}": ${msg}`);
}

const inMidiRange = (midi: number) => midi >= 0 && midi <= 127;

function checkLength(name: string, lengthBeats: number, meter: number): void {
  if (!(lengthBeats > 0)) fail(name, 'has zero length');
  if (lengthBeats > MAX_PATTERN_BARS * meter + EPS)
    fail(name, `is longer than ${MAX_PATTERN_BARS} bars`);
}

/** Split "a b | c d" into bars of whitespace-separated tokens (empty trailing bars dropped). */
function bars(src: string): string[][] {
  const out = src.split('|').map((b) => b.trim().split(/\s+/).filter(Boolean));
  while (out.length > 1 && out[out.length - 1]!.length === 0) out.pop();
  return out;
}

/** Flatten bars, checking each bar's step count when bar lines are present. */
function checkedSteps(name: string, src: string, stepBeats: number, meter: number): string[] {
  const bs = bars(src);
  if (bs.length > 1) {
    const perBar = meter / stepBeats;
    if (Math.abs(perBar - Math.round(perBar)) > 1e-6)
      fail(name, `step of ${stepBeats} beats does not divide a ${meter}-beat bar`);
    bs.forEach((b, i) => {
      if (b.length !== Math.round(perBar))
        fail(name, `bar ${i + 1} has ${b.length} steps, expected ${Math.round(perBar)}`);
    });
  }
  return bs.flat();
}

/** Strip a trailing velocity mark: "!" accent, "?" soft. */
function velocityMark(tok: string, base: number): [string, number] {
  if (tok.endsWith('!')) return [tok.slice(0, -1), Math.min(1, base * ACCENT)];
  if (tok.endsWith('?')) return [tok.slice(0, -1), base * GHOST];
  return [tok, base];
}

/** Count ' (up) and , (down) octave marks at the end of a token. */
function octaveMarks(tok: string): [string, number] {
  let shift = 0;
  let t = tok;
  while (t.endsWith("'") || t.endsWith(',')) {
    shift += t.endsWith("'") ? 12 : -12;
    t = t.slice(0, -1);
  }
  return [t, shift];
}

interface Held {
  step: number;
  midis: number[];
  velocity: number;
  held: number;
}

/**
 * Turn a step sequence into events: `resolve` maps a sounding token to MIDI notes (or null for an
 * unplayable step, which rests); `.` ties, `-` rests. Applies gate, swing and humanize.
 */
function stepEvents(
  name: string,
  track: string,
  tokens: string[],
  stepBeats: number,
  p: ScorePattern,
  resolve: (tok: string, step: number) => number[] | null,
): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const rng = mulberry32(seedFrom('humanize', name));
  let cur: Held | null = null;
  const close = () => {
    if (!cur) return;
    const swung = cur.step % 2 === 1 ? p.swing * stepBeats : 0;
    const beat = cur.step * stepBeats + swung;
    const beats = Math.max(0.01, cur.held * stepBeats * p.gate - swung);
    let vel = cur.velocity;
    if (p.humanize > 0) vel = Math.min(1, Math.max(0.05, vel * (1 + p.humanize * (rng() * 2 - 1))));
    for (const note of cur.midis) {
      const midi = note + p.transpose;
      if (!inMidiRange(midi)) continue;
      const e: ScoreEvent = { track, beat, beats, midi, velocity: vel };
      if (p.patch) e.patch = p.patch;
      events.push(e);
    }
    cur = null;
  };
  tokens.forEach((raw, step) => {
    if (raw === '.') {
      if (cur) cur.held++;
      return;
    }
    close();
    if (raw === '-') return;
    const [tok, velocity] = velocityMark(raw, p.velocity);
    const midis = resolve(tok, step);
    if (!midis || midis.length === 0) return;
    cur = { step, midis, velocity, held: 1 };
  });
  close();
  return events;
}

/** The tones a step joins with `+`, at most `SCORE_LIMITS.tonesPerOnset`. */
function joined(name: string, tok: string): string[] {
  const tones = tok.split('+');
  if (tones.length > SCORE_LIMITS.tonesPerOnset)
    fail(
      name,
      `"${tok.slice(0, 40)}…" joins ${tones.length} tones; a step may join at most ${SCORE_LIMITS.tonesPerOnset}`,
    );
  return tones;
}

function expandNotes(name: string, track: string, p: ScorePattern, meter: number): ParsedPattern {
  const stepBeats = noteValueBeats(p.step ?? '1/8');
  const tokens = checkedSteps(name, p.notes!, stepBeats, meter);
  const events = stepEvents(name, track, tokens, stepBeats, p, (tok) => {
    const tones = joined(name, tok);
    try {
      return tones.map((n) => noteToMidi(n));
    } catch {
      return fail(name, `invalid note "${tok}"`);
    }
  });
  return { name, kind: 'notes', track, lengthBeats: tokens.length * stepBeats, events };
}

function expandDegrees(
  name: string,
  track: string,
  p: ScorePattern,
  meter: number,
  key: Key,
): ParsedPattern {
  const stepBeats = noteValueBeats(p.step ?? '1/8');
  const tokens = checkedSteps(name, p.degrees!, stepBeats, meter);
  const octave = p.octave ?? 4;
  const events = stepEvents(name, track, tokens, stepBeats, p, (tok) =>
    joined(name, tok).map((d) => {
      const [body, shift] = octaveMarks(d);
      const m = /^(#|b)?(-?\d+)$/.exec(body);
      if (!m) return fail(name, `invalid degree "${d}"`);
      const alter = m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0;
      return degreeToMidi(Number(m[2]), key, octave, alter) + shift;
    }),
  );
  return { name, kind: 'degrees', track, lengthBeats: tokens.length * stepBeats, events };
}

function chordSegments(name: string, p: ScorePattern, meter: number): Segments {
  const segments: Segment[] = [];
  const push = (tok: string, start: number, len: number) => {
    if (tok === '.') {
      const last = segments[segments.length - 1];
      if (last) last.end = start + len;
      else segments.push({ start, end: start + len, chord: null });
      return;
    }
    let chord: Chord | null = null;
    if (tok !== '-') {
      try {
        chord = parseChord(tok);
      } catch (error) {
        fail(name, (error as Error).message);
      }
    }
    segments.push({ start, end: start + len, chord });
  };
  let lengthBeats: number;
  if (p.step !== undefined) {
    const stepBeats = noteValueBeats(p.step);
    const tokens = checkedSteps(name, p.chords!, stepBeats, meter);
    for (const [i, tok] of tokens.entries()) push(tok, i * stepBeats, stepBeats);
    lengthBeats = tokens.length * stepBeats;
  } else {
    const bs = bars(p.chords!);
    for (const [b, bar] of bs.entries()) {
      if (bar.length === 0) fail(name, `bar ${b + 1} is empty`);
      const slot = meter / bar.length;
      for (const [i, tok] of bar.entries()) push(tok, b * meter + i * slot, slot);
    }
    lengthBeats = bs.length * meter;
  }
  // Checked before expansion: arpeggios and rhythms over a chords pattern scale with its length.
  checkLength(name, lengthBeats, meter);
  return { segments, lengthBeats };
}

const GRID_VELOCITY: Record<string, number> = { x: 1, X: ACCENT, g: GHOST };
const isHit = (ch: string | undefined): ch is string => ch !== undefined && ch in GRID_VELOCITY;

function expandChords(name: string, track: string, p: ScorePattern, segs: Segments): ParsedPattern {
  const range: [number, number] = p.voicing
    ? [toMidi(p.voicing[0]), toMidi(p.voicing[1])]
    : [48, 72];
  if (!range.every(inMidiRange)) fail(name, 'voicing notes must lie within MIDI 0–127');
  const events: ScoreEvent[] = [];
  let prev: number[] | undefined;
  const rhythm = p.rhythm?.replace(/[\s|]/g, '');
  const rStep = noteValueBeats(p.rhythmStep ?? '1/16');
  if (rhythm) {
    for (const ch of rhythm)
      if (!isHit(ch) && ch !== '.' && ch !== '-') fail(name, `invalid rhythm character "${ch}"`);
  }
  for (const seg of segs.segments) {
    if (!seg.chord) continue;
    const voiced = voiceChord(seg.chord, range, prev);
    prev = voiced;
    const add = (beat: number, beats: number, velocity: number) => {
      const tones = voiced.map((m) => m + p.transpose).filter(inMidiRange);
      for (const midi of tones) {
        const e: ScoreEvent = { track, beat, beats, midi, velocity, chord: [...tones] };
        if (p.patch) e.patch = p.patch;
        events.push(e);
      }
    };
    if (!rhythm) {
      add(seg.start, (seg.end - seg.start) * p.gate, p.velocity);
      continue;
    }
    const first = Math.ceil(seg.start / rStep - EPS);
    for (let k = first; k * rStep < seg.end - EPS; k++) {
      const ch = rhythm[k % rhythm.length];
      if (!isHit(ch)) continue;
      let next = 1;
      while (next < rhythm.length && !isHit(rhythm[(k + next) % rhythm.length])) next++;
      const t = k * rStep;
      const len = Math.min(next * rStep, seg.end - t) * p.gate;
      add(t, len, Math.min(1, p.velocity * GRID_VELOCITY[ch]!));
    }
  }
  return {
    name,
    kind: 'chords',
    track,
    lengthBeats: segs.lengthBeats,
    events: sortEvents(events),
  };
}

function expandArp(
  name: string,
  track: string,
  p: ScorePattern,
  meter: number,
  src: Segments,
): ParsedPattern {
  const stepBeats = noteValueBeats(p.step ?? '1/16');
  const tokens = checkedSteps(name, p.steps!, stepBeats, meter);
  if (tokens.length === 0) fail(name, 'steps is empty');
  const octave = p.octave ?? 4;
  const n = Math.round(src.lengthBeats / stepBeats);
  const seq = Array.from({ length: n }, (_, s) => tokens[s % tokens.length]!);
  const chordAt = (beat: number) =>
    src.segments.find((s) => beat >= s.start - EPS && beat < s.end - EPS)?.chord ?? null;
  const events = stepEvents(name, track, seq, stepBeats, p, (tok, step) => {
    const chord = chordAt(step * stepBeats);
    if (!chord) return null;
    const [body, shift] = octaveMarks(tok);
    if (!/^\d+$/.test(body))
      return fail(name, `invalid arp step "${tok}" (expected a chord-tone index like 0, 2' or 1,)`);
    return [arpTone(chordTones(chord, octave), Number(body)) + shift];
  });
  return { name, kind: 'arp', track, lengthBeats: n * stepBeats, events };
}

function expandDrums(name: string, track: string, p: ScorePattern, meter: number): ParsedPattern {
  const stepBeats = noteValueBeats(p.step ?? '1/16');
  const rows = Object.entries(p.drums!).map(([voice, grid]) => {
    const bs = grid.split('|').map((b) => b.replace(/\s+/g, ''));
    while (bs.length > 1 && bs[bs.length - 1] === '') bs.pop();
    if (bs.length > 1) {
      const perBar = Math.round(meter / stepBeats);
      bs.forEach((b, i) => {
        if (b.length !== perBar)
          fail(name, `${voice} bar ${i + 1} has ${b.length} steps, expected ${perBar}`);
      });
    }
    const cells = bs.join('');
    for (const ch of cells)
      if (!isHit(ch) && ch !== '.' && ch !== '-')
        fail(name, `${voice}: invalid drum character "${ch}"`);
    return { voice, cells };
  });
  const steps = Math.max(...rows.map((r) => r.cells.length));
  const rng = mulberry32(seedFrom('humanize', name));
  const events: ScoreEvent[] = [];
  for (const { voice, cells } of rows) {
    for (let s = 0; s < steps; s++) {
      const ch = cells[s % cells.length];
      if (!isHit(ch)) continue;
      let velocity = Math.min(1, p.velocity * GRID_VELOCITY[ch]!);
      if (p.humanize > 0)
        velocity = Math.min(1, Math.max(0.05, velocity * (1 + p.humanize * (rng() * 2 - 1))));
      const swung = s % 2 === 1 ? p.swing * stepBeats : 0;
      events.push({
        track,
        beat: s * stepBeats + swung,
        beats: stepBeats * p.gate,
        midi: 0,
        velocity,
        voice,
      });
    }
  }
  return { name, kind: 'drums', track, lengthBeats: steps * stepBeats, events: sortEvents(events) };
}

/** Code-unit order, not localeCompare: the event order must not depend on the machine's locale. */
const byName = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);

function sortEvents(events: ScoreEvent[]): ScoreEvent[] {
  return events.sort((a, b) => a.beat - b.beat || a.midi - b.midi || byName(a.voice, b.voice));
}

/**
 * Every name a score refers to must be one it declares. The schema looks names up in plain
 * objects, where "constructor" or "toString" would find an Object.prototype member.
 */
function checkReferences(s: Score): void {
  const has = (record: object, name: string) => Object.hasOwn(record, name);
  for (const [name, p] of Object.entries(s.patterns)) {
    const track = resolvePatternTrack(name, p, s.tracks);
    if (!has(s.tracks, track)) fail(name, `unknown track "${track}"`);
  }
  for (const [name, section] of Object.entries(s.sections)) {
    for (const p of section.play)
      if (!has(s.patterns, p))
        throw new ScoreError(`section "${name}" plays unknown pattern "${p}"`);
  }
  const { intro, loop, hero, ending, logo } = s.form;
  const endings = typeof ending === 'string' ? [ending] : Object.values(ending);
  for (const section of [intro, hero, ...loop, ...endings])
    if (section !== undefined && !has(s.sections, section))
      throw new ScoreError(`form names unknown section "${section}"`);
  for (const track of [logo.track, logo.double])
    if (track !== undefined && !has(s.tracks, track))
      throw new ScoreError(`form.logo names unknown track "${track}"`);
}

/** Validate a score object (parsed YAML or JSON) and expand its patterns into events. */
export function parseScore(raw: unknown): ParsedScore {
  const parsed = ScoreSchema.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown } | null)?.id;
    const named = typeof id === 'string' && id ? ` "${id}"` : '';
    throw new ScoreError(`invalid score${named}:\n${z.prettifyError(parsed.error)}`);
  }
  const s = parsed.data;
  checkReferences(s);
  let key: Key;
  try {
    key = parseKey(s.key);
  } catch (error) {
    throw new ScoreError(`score "${s.id}": ${(error as Error).message}`, { cause: error });
  }
  const meter = s.meter;
  const patterns: Record<string, ParsedPattern> = {};
  const chordSrc = new Map<string, Segments>();
  const entries = Object.entries(s.patterns);
  for (const [name, p] of entries)
    if (p.chords !== undefined) chordSrc.set(name, chordSegments(name, p, meter));
  // Each chord change is voiced by a search over its tones' placements: bound the total.
  const changes = [...chordSrc.values()].reduce(
    (n, src) => n + src.segments.filter((g) => g.chord).length,
    0,
  );
  if (changes > SCORE_LIMITS.chordChanges)
    throw new ScoreError(
      `score "${s.id}" has ${changes} chord changes; a score may have at most ${SCORE_LIMITS.chordChanges}.`,
    );
  for (const [name, p] of entries) {
    const track = resolvePatternTrack(name, p, s.tracks);
    let pattern: ParsedPattern;
    if (p.chords !== undefined) pattern = expandChords(name, track, p, chordSrc.get(name)!);
    else if (p.arp !== undefined) {
      const src = chordSrc.get(p.arp);
      if (!src) fail(name, `"${p.arp}" is not a chords pattern`);
      pattern = expandArp(name, track, p, meter, src);
    } else if (p.notes !== undefined) pattern = expandNotes(name, track, p, meter);
    else if (p.degrees !== undefined) pattern = expandDegrees(name, track, p, meter, key);
    else pattern = expandDrums(name, track, p, meter);
    checkLength(name, pattern.lengthBeats, meter);
    patterns[name] = pattern;
  }
  const tracks: ParsedTrack[] = Object.entries(s.tracks).map(([name, t]) => ({
    name,
    patch: t.patch,
    kit: t.kit,
    gain: t.gain,
    pan: t.pan,
    delay: t.delay,
    reverb: t.reverb,
    chorus:
      t.chorus === undefined
        ? undefined
        : t.chorus === false
          ? false
          : t.chorus === true
            ? DEFAULT_CHORUS
            : t.chorus,
    highpass: t.highpass,
    lowpass: t.lowpass,
    mute: t.mute,
  }));
  const sections: Record<string, ParsedSection> = {};
  for (const [name, sec] of Object.entries(s.sections))
    sections[name] = { name, bars: sec.bars, play: sec.play, accent: sec.accent };
  const d = s.fx.delay;
  const r = s.fx.reverb;
  return {
    id: s.id,
    bpm: s.bpm,
    meter,
    key,
    keyName: s.key,
    draft: s.draft,
    tracks,
    fx: {
      delay: {
        beats: noteValueBeats(d?.time ?? '3/16'),
        feedback: d?.feedback ?? 0.3,
        lowpass: d?.lowpass ?? 5000,
        highpass: d?.highpass ?? 300,
        pingpong: d?.pingpong ?? true,
      },
      reverb: {
        size: r?.size ?? 0.7,
        damp: r?.damp ?? 0.5,
        width: r?.width ?? 1,
        predelay: r?.predelay ?? 0.015,
        lowcut: r?.lowcut ?? 220,
        highcut: r?.highcut ?? 9000,
      },
    },
    patterns,
    sections,
    form: {
      intro: s.form.intro,
      loop: s.form.loop,
      hero: s.form.hero,
      ending: s.form.ending,
      logo: s.form.logo,
    },
    source: s,
  };
}
