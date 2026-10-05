import { z } from 'zod';

/*
 * The music score format: tracks (a patch or a drum kit each), named patterns, sections that loop
 * patterns for N bars, and a form (intro → loops → hero → loops → ending) that Covi fits to a
 * video. Covi's theme is YAML in templates/music/scores; `video/score.json` is the same format.
 *
 * Pattern kinds (exactly one per pattern):
 *   chords:  "Ebmaj9 | Cm9 . | Ab Bb" — bars split by |; a bar's tokens share it equally
 *            (`.` holds the previous chord, `-` rests). With `step`, each token is one step.
 *   arp:     <chords pattern> + steps: "0 1 2 3 1' 2 3 1" — chord-tone indices (0-based) on the
 *            chord sounding at that moment; ' = +octave, , = −octave, past the last tone wraps up.
 *   notes:   "Eb2 . - Bb1 | …" — note names (C4+E4 for dyads), `.` tie, `-` rest.
 *   degrees: "2 3 6 5 . ." — scale degrees 1–7 in the key (#4, b7 alter; ' , octave marks).
 *   drums:   { kick: "x...x...", hat: "..x." } — x hit, X accent, g ghost, . rest; one char per step.
 * Any melodic token may end in ! (accent) or ? (soft). Bar lines are checked against the step.
 *
 * Tracks: an explicit `track:` wins; drum patterns go to the only kit track; otherwise the
 * pattern name's prefix before `_` must name a track (bass_a → bass).
 *
 * Scores can come from an agent or a model, so every list and string is bounded: a score cannot
 * make the synthesizer do unbounded work.
 */

export const VERDICTS = ['looks-good', 'needs-attention', 'needs-changes'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Limits for untrusted scores. */
export const SCORE_LIMITS = {
  tracks: 8,
  patterns: 40,
  sections: 16,
  /** Characters in any pattern string (chords, steps, notes, degrees, a drum row, a rhythm). */
  patternChars: 2_000,
  /** Bytes in a score file. */
  fileBytes: 64 * 1024,
  /** Scheduled notes per 120 s of video. */
  notesPer120s: 20_000,
  /**
   * Semitones a chord voicing range may span, and chord changes per score: voicing searches every
   * placement of a chord's tones, so both bound the work a score can ask for.
   */
  voicingSpan: 30,
  chordChanges: 256,
  /** Tones one step of a notes or degrees pattern may join with `+`. */
  tonesPerOnset: 12,
  /**
   * Seconds of sound per second of video: every note's rendered length (its gate, cut at the end
   * of the video, plus its release or ring) summed. Rendering grows with it; the Covi theme
   * sounds 10 to 16.
   */
  soundPerSecond: 48,
} as const;

/** A note name in octaves −1 to 9 (MIDI's range), so a name cannot carry an absurd octave. */
const NOTE_RE = /^[A-Ga-g](##|#|bb|b|x)?(-1|[0-9])$/;
const Name = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'names are letters, digits, _ and -');
const TrackName = z.string().regex(/^[a-z][a-z0-9-]*$/, 'track names are lowercase kebab-case');
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case');
const Pattern = z.string().min(1).max(SCORE_LIMITS.patternChars);

/** "1/16", "3/16", "1/8t" (triplet), "1/4." (dotted), or a number of whole notes (1/32 to 16). */
export const NoteValueSchema = z.union([
  z
    .number()
    .min(1 / 32)
    .max(16),
  z
    .string()
    .regex(
      /^\s*(?:[1-9]|1[0-6])\s*\/\s*(?:1|2|4|8|16|32)\s*[t.]?\s*$/,
      'expected a note value like 1/16, 3/16, 1/8t or 1/4.',
    ),
]);

/** A note name (C3, F#4) or a MIDI number. */
export const NoteRefSchema = z.union([
  z.number().int().min(0).max(127),
  z.string().regex(NOTE_RE, 'expected a note name like C3 or F#4'),
]);

export const ScoreChorusSchema = z.strictObject({
  depth: z.number().min(0).max(1),
  rate: z.number().positive().max(10),
  mix: z.number().min(0).max(1),
});

export const ScoreTrackSchema = z
  .strictObject({
    /** A bundled melodic patch (templates/music/patches). */
    patch: Id.optional(),
    /** A bundled drum kit (templates/music/kits). */
    kit: Id.optional(),
    /** Track gain in dB. */
    gain: z.number().min(-60).max(12).default(0),
    pan: z.number().min(-1).max(1).default(0),
    /** Send level (0..1) to the shared tempo-synced delay. */
    delay: z.number().min(0).max(1).default(0),
    /** Send level (0..1) to the shared reverb. */
    reverb: z.number().min(0).max(1).default(0),
    /** Chorus insert: true = default, false = off even if the patch asks for it, or settings. */
    chorus: z.union([z.boolean(), ScoreChorusSchema]).optional(),
    /** Track EQ: highpass / lowpass corner in Hz. */
    highpass: z.number().positive().max(8000).optional(),
    lowpass: z.number().positive().max(20000).optional(),
    mute: z.boolean().default(false),
  })
  .superRefine((t, ctx) => {
    if (!t.patch === !t.kit)
      ctx.addIssue({ code: 'custom', message: 'a track needs exactly one of `patch` or `kit`' });
  });

const PATTERN_KINDS = ['chords', 'arp', 'notes', 'degrees', 'drums'] as const;

export const ScorePatternSchema = z
  .strictObject({
    track: TrackName.optional(),
    chords: Pattern.optional(),
    /** The chords pattern whose chords this arpeggio plays (with `steps`). */
    arp: Name.optional(),
    notes: Pattern.optional(),
    degrees: Pattern.optional(),
    drums: z
      .record(z.string().regex(/^[a-z][a-z0-9-]*$/), Pattern)
      .refine((rows) => Object.keys(rows).length <= 12, 'at most 12 drum rows')
      .optional(),
    /** Arp step tokens (with `arp`). */
    steps: Pattern.optional(),
    step: NoteValueSchema.optional(),
    /** Octave of the tonic (degrees) or of the chord root (arp); default 4. */
    octave: z.number().int().min(0).max(8).optional(),
    /** Chord voicing range [low, high], default [C3, C5]. */
    voicing: z.tuple([NoteRefSchema, NoteRefSchema]).optional(),
    /** Chord stab grid (x X g .), cycled; each stab lasts until the next × gate. */
    rhythm: Pattern.optional(),
    rhythmStep: NoteValueSchema.optional(),
    /** Velocity of an ordinary note (accents ×1.25, ghosts ×0.44). */
    velocity: z.number().min(0).max(1).default(0.8),
    /** Delay of odd (off-beat) steps as a fraction of a step. */
    swing: z.number().min(0).max(0.3).default(0),
    /** Sounding fraction of each note's length. */
    gate: z.number().min(0.05).max(1).default(0.95),
    transpose: z.number().int().min(-24).max(24).default(0),
    /** Play this pattern with another patch on its track's channel. */
    patch: Id.optional(),
    /** Deterministic velocity variation (0..0.3). */
    humanize: z.number().min(0).max(0.3).default(0),
  })
  .superRefine((p, ctx) => {
    const kinds = PATTERN_KINDS.filter((k) => p[k] !== undefined);
    if (kinds.length !== 1)
      ctx.addIssue({
        code: 'custom',
        message: `a pattern needs exactly one of ${PATTERN_KINDS.join(', ')} (found ${kinds.join(', ') || 'none'})`,
      });
    if ((p.arp === undefined) !== (p.steps === undefined))
      ctx.addIssue({ code: 'custom', message: '`arp` and `steps` go together' });
    if (p.voicing && p.chords === undefined)
      ctx.addIssue({ code: 'custom', message: '`voicing` applies to chords patterns only' });
    if ((p.rhythm || p.rhythmStep) && p.chords === undefined)
      ctx.addIssue({ code: 'custom', message: '`rhythm` applies to chords patterns only' });
    if (p.drums && p.patch)
      ctx.addIssue({
        code: 'custom',
        message: 'drum patterns play their track kit; `patch` is not allowed',
      });
    if (p.voicing) {
      const [low, high] = p.voicing.map(midiOf);
      if (
        low !== undefined &&
        high !== undefined &&
        Math.abs(high - low) > SCORE_LIMITS.voicingSpan
      )
        ctx.addIssue({
          code: 'custom',
          message: `a voicing range spans at most ${SCORE_LIMITS.voicingSpan} semitones`,
          path: ['voicing'],
        });
    }
  });

export const ScoreSectionSchema = z.strictObject({
  bars: z.number().int().min(1).max(128),
  play: z.array(Name).max(16).default([]),
  /** +2 dB and a soft crash on beat 1 (the hero lift). */
  accent: z.boolean().default(false),
});

/** The ending section, one for every verdict or one per verdict. */
export const ScoreEndingSchema = z.union([
  Name,
  z.strictObject({ 'looks-good': Name, 'needs-attention': Name, 'needs-changes': Name }),
]);

export const ScoreFormSchema = z.strictObject({
  intro: Name.optional(),
  /** Sections cycled to fill the time around the hero (the last one before a boundary truncated). */
  loop: z.union([Name, z.array(Name).min(1).max(8)]).transform((v) => (Array.isArray(v) ? v : [v])),
  /** The section that starts on the hero downbeat. */
  hero: Name.optional(),
  /** Starts on the logo's landing; one section, or one per review verdict. */
  ending: ScoreEndingSchema,
  /**
   * Where Covi plays its sonic logo (a three-note motif the engine writes; scores never write
   * it): a melodic track, the tonic's octave, and an optional second track that doubles it.
   */
  logo: z.strictObject({
    track: TrackName,
    octave: z.number().int().min(2).max(7),
    double: TrackName.optional(),
  }),
});

export const ScoreFxSchema = z.strictObject({
  delay: z
    .strictObject({
      /** Delay time as a note value (tempo-synced), default 3/16. */
      time: NoteValueSchema.default('3/16'),
      feedback: z.number().min(0).max(0.9).default(0.3),
      lowpass: z.number().positive().max(20000).default(5000),
      highpass: z.number().positive().max(5000).default(300),
      pingpong: z.boolean().default(true),
    })
    .optional(),
  reverb: z
    .strictObject({
      size: z.number().min(0).max(1).default(0.7),
      damp: z.number().min(0).max(1).default(0.5),
      width: z.number().min(0).max(1).default(1),
      predelay: z.number().min(0).max(0.2).default(0.015),
      lowcut: z.number().positive().max(5000).default(220),
      highcut: z.number().positive().max(20000).default(9000),
    })
    .optional(),
});

export type ScoreTrack = z.output<typeof ScoreTrackSchema>;
export type ScorePattern = z.output<typeof ScorePatternSchema>;
export type ScoreSection = z.output<typeof ScoreSectionSchema>;
export type ScoreForm = z.output<typeof ScoreFormSchema>;

/** The track a pattern plays on (see the rules at the top of this file); throws with the pattern name. */
export function resolvePatternTrack(
  name: string,
  p: ScorePattern,
  tracks: Record<string, ScoreTrack>,
): string {
  const names = Object.keys(tracks);
  // Own names only: a record also "has" constructor, toString, and the rest of Object.prototype.
  const has = (name: string) => Object.hasOwn(tracks, name);
  if (p.track !== undefined) {
    if (!has(p.track))
      throw new Error(
        `pattern "${name}": unknown track "${p.track}" (tracks: ${names.join(', ')})`,
      );
    return p.track;
  }
  if (p.drums) {
    const kitTracks = names.filter((t) => tracks[t]!.kit);
    if (kitTracks.length === 1) return kitTracks[0]!;
    throw new Error(
      `pattern "${name}": drum patterns need a kit track (found ${kitTracks.length}); set track:`,
    );
  }
  const prefix = name.split('_')[0]!;
  if (has(prefix)) return prefix;
  throw new Error(
    `pattern "${name}": cannot infer its track; add track: (one of ${names.join(', ')}) or name it <track>_…`,
  );
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note reference, or undefined when it is not one. */
function midiOf(ref: string | number): number | undefined {
  if (typeof ref === 'number') return ref;
  const m = /^([A-Ga-g])(##|#|bb|b|x)?(-?\d+)$/.exec(ref);
  if (!m) return undefined;
  const acc = m[2] ?? '';
  const shift =
    acc === '#' ? 1 : acc === '##' || acc === 'x' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!.toUpperCase()]! + shift;
}

/** A record with at most `max` entries. */
const atMost = (max: number, what: string) =>
  [(record: object) => Object.keys(record).length <= max, `at most ${max} ${what}`] as const;

export const ScoreSchema = z
  .strictObject({
    schemaVersion: z.literal(1).default(1),
    id: Id,
    description: z.string().max(500).optional(),
    license: z.string().max(200).optional(),
    /** True for Covi's own draft (the Covi theme); set false once the score is written. */
    draft: z.boolean().default(false),
    bpm: z.number().min(60).max(160),
    /** Beats (quarter notes) per bar. */
    meter: z.union([z.literal(3), z.literal(4)]).default(4),
    /** "Eb major", "F# minor", "G mixolydian", … */
    key: z.string().min(1).max(40),
    tracks: z.record(TrackName, ScoreTrackSchema).refine(...atMost(SCORE_LIMITS.tracks, 'tracks')),
    fx: ScoreFxSchema.default({}),
    patterns: z
      .record(Name, ScorePatternSchema)
      .refine(...atMost(SCORE_LIMITS.patterns, 'patterns')),
    sections: z
      .record(Name, ScoreSectionSchema)
      .refine(...atMost(SCORE_LIMITS.sections, 'sections')),
    form: ScoreFormSchema,
  })
  .superRefine((s, ctx) => {
    if (Object.keys(s.tracks).length === 0)
      ctx.addIssue({
        code: 'custom',
        message: 'a score needs at least one track',
        path: ['tracks'],
      });
    for (const [name, p] of Object.entries(s.patterns)) {
      try {
        const track = s.tracks[resolvePatternTrack(name, p, s.tracks)]!;
        if (p.drums && !track.kit)
          ctx.addIssue({
            code: 'custom',
            message: `drum pattern "${name}" must play on a kit track`,
            path: ['patterns', name],
          });
        if (!p.drums && track.kit)
          ctx.addIssue({
            code: 'custom',
            message: `pattern "${name}" is melodic but its track plays a kit`,
            path: ['patterns', name],
          });
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: (error as Error).message,
          path: ['patterns', name],
        });
      }
      if (
        p.arp !== undefined &&
        !(Object.hasOwn(s.patterns, p.arp) && s.patterns[p.arp]!.chords !== undefined)
      )
        ctx.addIssue({
          code: 'custom',
          message: `arp "${name}" must reference a chords pattern (got "${p.arp}")`,
          path: ['patterns', name, 'arp'],
        });
    }
    for (const [name, section] of Object.entries(s.sections)) {
      for (const p of section.play)
        if (!Object.hasOwn(s.patterns, p))
          ctx.addIssue({
            code: 'custom',
            message: `section "${name}" plays unknown pattern "${p}"`,
            path: ['sections', name, 'play'],
          });
    }
    const endings =
      typeof s.form.ending === 'string'
        ? [['ending', s.form.ending] as const]
        : VERDICTS.map(
            (v) => [`ending.${v}`, (s.form.ending as Record<Verdict, string>)[v]] as const,
          );
    const refs: Array<readonly [string, string | undefined]> = [
      ['intro', s.form.intro],
      ['hero', s.form.hero],
      ...endings,
      ...s.form.loop.map((l) => ['loop', l] as const),
    ];
    for (const [slot, ref] of refs) {
      if (ref !== undefined && !Object.hasOwn(s.sections, ref))
        ctx.addIssue({
          code: 'custom',
          message: `form.${slot} names unknown section "${ref}"`,
          path: ['form', ...slot.split('.')],
        });
    }
    for (const role of ['track', 'double'] as const) {
      const name = s.form.logo[role];
      if (name === undefined) continue;
      const track = Object.hasOwn(s.tracks, name) ? s.tracks[name] : undefined;
      if (!track)
        ctx.addIssue({
          code: 'custom',
          message: `form.logo.${role} names unknown track "${name}"`,
          path: ['form', 'logo', role],
        });
      else if (track.kit)
        ctx.addIssue({
          code: 'custom',
          message: `form.logo.${role} must be a melodic track, not the kit track "${name}"`,
          path: ['form', 'logo', role],
        });
    }
  });

export type Score = z.output<typeof ScoreSchema>;
export type ScoreInput = z.input<typeof ScoreSchema>;
