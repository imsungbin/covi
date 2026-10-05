import { fadeIn } from '../dsp/env.ts';
import { Biquad } from '../dsp/filter.ts';
import {
  chorus,
  delay,
  gainPan,
  limiter,
  mixInto,
  reverb,
  rmsAll,
  softClip,
  stereo,
} from '../dsp/fx.ts';
import { mulberry32, seedFrom } from '../dsp/prng.ts';
import { SCORE_LIMITS, type Verdict } from '../schema/score.ts';
import { noteSeconds, renderNote } from '../synth/instruments.ts';
import type { Kit, Patch } from '../synth/patches.ts';
import type { Arrangement } from './fit.ts';
import { type ParsedScore, type ParsedTrack, ScoreError } from './score.ts';
import { degreeToMidi } from './theory.ts';

/*
 * Renders a fitted arrangement to stereo audio exactly as long as the video. Every section's
 * patterns loop within the section; notes go through their patches, tracks through gain, pan, and
 * inserts, and the shared tempo-synced delay and reverb. Then the bus: a 30 Hz high-pass, a level
 * of −18 dBFS RMS, a soft clipper, and a −1 dBFS limiter. Covi's sonic logo is written by the
 * engine, never by scores: a pickup of 5 (an octave below) and 1, landing on the ending's first
 * downbeat on 3 (looks good), 2 (needs attention), or 6 below the tonic (needs changes).
 */

export interface MusicLibraryParts {
  patches: ReadonlyMap<string, Patch>;
  kits: ReadonlyMap<string, Kit>;
}

export interface RenderOptions {
  sampleRate?: number;
  seed?: number;
  verdict: Verdict;
  /** Seconds of rendered notes a track keeps for reuse (default 300); reuse never changes bytes. */
  cacheSeconds?: number;
}

/** A note placed in video time (seconds). */
export interface ScheduledNote {
  t: number;
  dur: number;
  midi: number;
  velocity: number;
  /** Linear gain (accent sections: +2 dB). */
  gain: number;
  patch: string;
}

const ACCENT_GAIN = 10 ** (2 / 20);
const CRASH_VELOCITY = 0.7;
const BUS_RMS_DB = -18;
const CEILING_DB = -1;
const FADE_IN = 0.3;
const EPS = 1e-9;
/** About 115 MB of stereo notes at 48 kHz; the theme's pad keeps 260 s for a two-minute video. */
const CACHE_SECONDS = 300;

/** Samples in music rendered for a video of `seconds`. */
export function musicLength(seconds: number, sampleRate: number): number {
  return Math.max(1, Math.ceil(seconds * sampleRate - 1e-6));
}

/** Scheduled notes Covi accepts for a video of `seconds`. */
export function noteLimit(seconds: number): number {
  return Math.ceil((SCORE_LIMITS.notesPer120s * seconds) / 120);
}

/** Landing degree (and octave shift) of the sonic logo for each verdict. */
const LANDING: Record<Verdict, { degree: number; octave: number }> = {
  'looks-good': { degree: 3, octave: 0 },
  'needs-attention': { degree: 2, octave: 0 },
  'needs-changes': { degree: 6, octave: -1 },
};

/** The sonic logo's three notes, in video time. */
export function logoNotes(
  score: Pick<ParsedScore, 'key' | 'form'>,
  arrangement: Pick<Arrangement, 'bar' | 'meter' | 'markers'>,
  verdict: Verdict,
): Array<{ t: number; beats: number; midi: number; velocity: number }> {
  const beat = arrangement.bar / arrangement.meter;
  const t = arrangement.markers.logo.landing;
  const octave = score.form.logo.octave;
  const landing = LANDING[verdict];
  return [
    {
      t: t - 0.75 * beat,
      beats: 0.25,
      midi: degreeToMidi(5, score.key, octave - 1),
      velocity: 0.78,
    },
    { t: t - 0.5 * beat, beats: 0.5, midi: degreeToMidi(1, score.key, octave), velocity: 0.82 },
    {
      t,
      beats: 2,
      midi: degreeToMidi(landing.degree, score.key, octave + landing.octave),
      velocity: 0.9,
    },
  ];
}

/**
 * Every note of the arrangement on its track, resolving kit voices to drum patches. A score that
 * asks for more notes, or more seconds of sound, than the video allows fails here, before
 * anything is rendered.
 */
export function scheduleArrangement(
  score: ParsedScore,
  arrangement: Arrangement,
  library: MusicLibraryParts,
  verdict: Verdict,
): Map<string, ScheduledNote[]> {
  const { kits, patches } = library;
  const beat = arrangement.bar / arrangement.meter;
  const end = arrangement.duration;
  const limit = noteLimit(end);
  const soundLimit = SCORE_LIMITS.soundPerSecond * end;
  const byName = new Map<string, ParsedTrack>(score.tracks.map((t) => [t.name, t]));
  const out = new Map<string, ScheduledNote[]>();
  let count = 0;
  let sound = 0;
  const push = (track: string, note: ScheduledNote) => {
    // The ending rings past the end of the video, which has faded out by then.
    if (note.t >= end) return;
    // Nothing after the end is heard, so a note held past it only costs work: its gate ends there
    // (its release still renders, beyond the last sample).
    const dur = Math.min(note.dur, end - note.t);
    if (++count > limit)
      throw new ScoreError(
        `score "${score.id}" schedules more than ${limit} notes for a ${end.toFixed(0)} s video; write sparser patterns.`,
      );
    const patch = patches.get(note.patch);
    if (!patch)
      throw new ScoreError(
        `score "${score.id}": track "${track}" uses unknown patch "${note.patch}"`,
      );
    // What rendering costs: every note's whole sound, its release or ring included.
    sound += noteSeconds(patch, { midi: note.midi, duration: dur });
    if (sound > soundLimit)
      throw new ScoreError(
        `score "${score.id}" sounds for more than ${soundLimit.toFixed(0)} s in a ${end.toFixed(0)} s video, counting every note with its release; write fewer, shorter, or higher notes.`,
      );
    const list = out.get(track);
    if (list) list.push({ ...note, dur });
    else out.set(track, [{ ...note, dur }]);
  };
  const kitOf = (track: ParsedTrack): Kit => {
    const kit = kits.get(track.kit!);
    if (!kit)
      throw new ScoreError(
        `score "${score.id}": track "${track.name}" uses unknown kit "${track.kit}"`,
      );
    return kit;
  };
  for (const section of arrangement.sections) {
    const def = score.sections[section.name]!;
    const sectionBeats = section.bars * arrangement.meter;
    const start = arrangement.start + section.startBar * arrangement.bar;
    const gain = def.accent ? ACCENT_GAIN : 1;
    for (const name of def.play) {
      const pattern = score.patterns[name]!;
      const track = byName.get(pattern.track)!;
      if (track.mute) continue;
      const kit = track.kit ? kitOf(track) : undefined;
      for (let loop = 0; loop < sectionBeats - EPS; loop += pattern.lengthBeats) {
        for (const e of pattern.events) {
          const b = loop + e.beat;
          if (b >= sectionBeats - EPS) break; // events are sorted by onset
          let patch: string;
          if (kit) {
            const id = Object.hasOwn(kit.voices, e.voice ?? '') ? kit.voices[e.voice!] : undefined;
            if (!id)
              throw new ScoreError(
                `score "${score.id}": kit "${kit.id}" has no voice "${e.voice}" (pattern "${name}")`,
              );
            patch = id;
          } else patch = e.patch ?? track.patch!;
          push(track.name, {
            t: start + b * beat,
            dur: Math.min(e.beats, sectionBeats - b) * beat,
            midi: e.midi,
            velocity: e.velocity,
            gain,
            patch,
          });
        }
      }
    }
    if (def.accent) {
      const drums = score.tracks.find((t) => t.kit && !t.mute);
      if (drums)
        push(drums.name, {
          t: start,
          dur: 0.5,
          midi: 0,
          velocity: CRASH_VELOCITY,
          gain: 1,
          patch: kitOf(drums).voices.crash ?? 'crash-soft',
        });
    }
  }
  const { track: logoTrack, double } = score.form.logo;
  for (const [name, scale] of [
    [logoTrack, 1],
    [double, 0.75],
  ] as const) {
    if (!name) continue;
    const track = byName.get(name)!;
    for (const n of logoNotes(score, arrangement, verdict))
      push(name, {
        t: n.t,
        dur: n.beats * beat * (n.beats < 1 ? 0.95 : 1),
        midi: n.midi,
        velocity: n.velocity * scale,
        gain: 1,
        patch: track.patch!,
      });
  }
  return out;
}

/** Round-robin renders per distinct note: noise-excited voices vary, pure oscillators need not. */
function variations(p: Patch): number {
  switch (p.algo) {
    case 'drum':
    case 'ks':
      return 3;
    case 'modal':
      return p.strike.noise > 0 ? 3 : 1;
    case 'subtractive':
      return p.noise > 0 ? 3 : 1;
    default:
      return 1;
  }
}

function renderTrack(
  track: ParsedTrack,
  notes: readonly ScheduledNote[],
  patches: ReadonlyMap<string, Patch>,
  total: number,
  sr: number,
  seed: number,
  scoreId: string,
  cacheSeconds: number,
): Float32Array[] {
  const buf = stereo(total);
  // A note's key seeds its render, so a note rendered again is the same bytes: a full cache costs
  // time, never memory or a different result.
  const cache = new Map<string, Float32Array[]>();
  let room = cacheSeconds * sr;
  const seen = new Map<string, number>();
  for (const ev of notes) {
    const patch = patches.get(ev.patch);
    if (!patch)
      throw new ScoreError(
        `score "${scoreId}": track "${track.name}" uses unknown patch "${ev.patch}"`,
      );
    const durSamples = Math.max(1, Math.round(ev.dur * sr));
    const velocity = Math.round(ev.velocity * 1000) / 1000;
    const base = `${ev.patch}|${ev.midi}|${velocity}|${durSamples}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const key = `${base}|${count % variations(patch)}`;
    let note = cache.get(key);
    if (!note) {
      note = renderNote(
        patch,
        { midi: ev.midi, velocity, duration: durSamples / sr },
        sr,
        mulberry32(seedFrom(seed, key)),
      );
      if (note[0]!.length <= room) {
        cache.set(key, note);
        room -= note[0]!.length;
      }
    }
    mixInto(buf, note, Math.round(ev.t * sr), ev.gain);
  }
  const own = track.patch ? patches.get(track.patch) : undefined;
  const ch = track.chorus === undefined ? own?.fx?.chorus : track.chorus || undefined;
  if (ch) chorus(buf, { ...ch, sr });
  if (track.highpass)
    for (const c of buf) new Biquad('highpass', track.highpass, Math.SQRT1_2, sr).run(c);
  if (track.lowpass)
    for (const c of buf) new Biquad('lowpass', track.lowpass, Math.SQRT1_2, sr).run(c);
  return gainPan(buf, 10 ** (track.gain / 20), track.pan);
}

/**
 * Renders the arrangement as video-length stereo audio. Music that starts partway into its first
 * bar fades in over 0.3 s; the end fades to silence over the arrangement's fade (half a second to
 * a second, after the ending has rung), on a cubic curve, so the final 10 ms are far below
 * audibility.
 */
export function renderMusic(
  score: ParsedScore,
  arrangement: Arrangement,
  library: MusicLibraryParts,
  options: RenderOptions,
): Float32Array[] {
  const sr = options.sampleRate ?? 48_000;
  const seed = options.seed ?? 1;
  const total = musicLength(arrangement.duration, sr);
  const schedule = scheduleArrangement(score, arrangement, library, options.verdict);
  const master = stereo(total);
  const dly = stereo(total);
  const rev = stereo(total);
  let useDelay = false;
  let useReverb = false;
  for (const track of score.tracks) {
    // Scheduling already left out muted tracks' patterns; the logo plays on its track regardless.
    const notes = schedule.get(track.name);
    if (!notes?.length) continue;
    const buf = renderTrack(
      track,
      notes,
      library.patches,
      total,
      sr,
      seed,
      score.id,
      options.cacheSeconds ?? CACHE_SECONDS,
    );
    mixInto(master, buf, 0);
    if (track.delay > 0) {
      mixInto(dly, buf, 0, track.delay);
      useDelay = true;
    }
    if (track.reverb > 0) {
      mixInto(rev, buf, 0, track.reverb);
      useReverb = true;
    }
  }
  const fx = score.fx;
  if (useDelay) {
    delay(dly, {
      time: (fx.delay.beats * 60) / arrangement.bpm,
      feedback: fx.delay.feedback,
      mix: 1,
      lowpass: fx.delay.lowpass,
      highpass: fx.delay.highpass,
      pingpong: fx.delay.pingpong,
      sr,
    });
    mixInto(master, dly, 0);
    mixInto(rev, dly, 0, 0.3); // echoes bloom into the room
    useReverb = true;
  }
  if (useReverb) {
    reverb(rev, { ...fx.reverb, mix: 1, sr });
    mixInto(master, rev, 0);
  }
  for (const c of master) new Biquad('highpass', 30, Math.SQRT1_2, sr).run(c);
  const level = rmsAll(master);
  const g = level > 1e-9 ? Math.min(10 ** (30 / 20), 10 ** (BUS_RMS_DB / 20) / level) : 1;
  for (const c of master) for (let i = 0; i < c.length; i++) c[i] = softClip(c[i]! * g);
  limiter(master, CEILING_DB, { sr });
  const fadeStart = Math.max(0, Math.round(arrangement.markers.fade.start * sr));
  const fadeLength = Math.max(1, total - fadeStart);
  for (const c of master) {
    fadeIn(c, arrangement.start < 0 ? FADE_IN : 0.002, sr);
    for (let i = fadeStart; i < total; i++) c[i]! *= (1 - (i - fadeStart + 1) / fadeLength) ** 3;
  }
  return master;
}
