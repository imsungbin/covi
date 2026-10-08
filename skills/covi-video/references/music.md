# Music

Covi's videos carry quiet music: the Covi theme by default, or a score written for one video. This reference is for writing that score. Covi fits it to the finished picture, adds its own sonic logo, and mixes it under the voice; the score says only what to play.

## Music serves the narration
- The voice is the product. While someone speaks, keep 300 Hz–3 kHz light: no lead melody, pads voiced low, sparse figures, bass and percussion outside the voice's band (a shaker or hat above it is fine).
- Movement belongs in the gaps and the lift. Keep the loops calm and repetitive; save the busier figure, the brighter instrument, and the fuller drums for the hero section.
- Density matters more than level. Covi brings the music to the voice's loudness and then places it: 20 dB under speech in short-form videos (a quiet bed throughout, swelling in gaps), and effectively off under speech in standard reviews (unless `--music-placement continuous` asks for a bed there too).
- In a narrated standard review, what the viewer hears is mostly the breaths Covi leaves around the narration: the first 2 s (the intro, or the first loop, over the opening scene), about 1.5–2 s before the hero's line (the hero section's first bar, lifting clear of speech), the pauses before the verdict and after long stretches of talk, and the outro. Make the intro, the hero's first bar, and the ending say something on their own.
- If the music is noticeable while someone talks, it is too busy.

## Mood by kind of change
- **Bug fix:** restrained, then it lifts at the proof (the hero scene shows the fix working).
- **Feature:** bright and curious; a light figure that moves.
- **Visual change:** light and airy; let the before/after breathe.
- **Architecture:** calm and spacious; long chords, little percussion.
- **Security:** sober but never ominous; minor colors that resolve, no tension effects.
- **API and CLI changes:** crisp; short notes, a dry rim or woodblock, a clear pulse.

## Tempo, key, and form
- Write at 90–120 bpm in 4/4 (3/4 works too). Covi moves the tempo at most 6% to land the hero on a downbeat (10% when nothing else fits), so write the tempo you mean.
- A major key suits most reviews; a minor or modal key suits a sober change, as long as it resolves.
- The form is `intro` (optional, 1–2 bars) → `loop` sections (cycled, the last one cut to fit) → `hero` (1–2 bars) → loops → `ending`. Covi starts the hero section exactly on the hero scene (the story's payoff) and the ending exactly where the logo lands: the moment the outro card settles, about 1.35 s after the last line (without an outro, about a second before the end). It drops the intro when the hero comes too early for it.
- Write two or three loop sections of 4 bars that differ (harmony, figure, or drums), so a long video does not repeat one bar pattern.
- Give `form.ending` one section per review verdict, about 2 bars each. The ending rings over the outro: about 1.8 s in standard reviews and 1.4 s in short-form ones, the last 0.5–1 s of it fading to silence. Write it to ring: a held chord, a bass note, and a soft hit on the downbeat, not a new figure:
  - `looks-good`: a resolved tonic (I).
  - `needs-attention`: an open chord (IVadd9 or Vsus4).
  - `needs-changes`: a calm relative minor (vi7).

## The sonic logo
Covi adds its logo itself; never write it. It is three notes: a pickup of 5 (an octave below) and 1, landing on the ending's first downbeat on 3 (looks good), 2 (needs attention), or 6 below the tonic (needs changes). Choose where it plays with `form.logo`: a melodic `track` (a bell, celesta, or kalimba carries it well), the tonic's `octave` (5 for a bell), and an optional `double` on a second track. Leave room for it: keep the ending sections' first bar sparse above the chord.

## Originality
Write new music. Do not quote or imitate an existing melody, riff, or hook, or a progression people associate with a particular song. Common progressions are fine; recognizable tunes are not.

## Instruments
Use only the bundled patches and kits (`templates/music/patches`, `templates/music/kits`); a score that names anything else is rejected.

| Role | Patches |
|---|---|
| Pads and keys | `soft-pad` (warm chord bed), `e-piano` (gentle comping) |
| Plucks and mallets | `glass-pluck` (bright arpeggios, pair with delay), `kalimba`, `marimba`, `pizzicato`, `celesta`, `glockenspiel` (octaves 5–7), `bell` |
| Winds | `flute`, `clarinet` (melodic: keep them out from under speech) |
| Bass | `round-bass` (reads on small speakers), `sub-bass` |

Kits, named by a track's `kit`: `soft-acoustic` (felt `kick`, brush `snare`, `hat`, `shaker`, `woodblock`, `woodblock-lo`, `rim`, `snap`, `crash`) and `soft-electro` (`kick`, `snare`, `clap`, `snap`, `hat`, `openhat`, `shaker`, `rim`, `tom`, `crash`). Drum rows use these voice names.

## The score format
A score is JSON (`covi schema score`), the same format as the theme's YAML in `templates/music/scores/covi-theme.yml`, which is a full example.

- **Top level:** `schemaVersion: 1`, `id` (kebab-case), `draft` (Covi's own draft says `true`; set `false` once you have written the score), `bpm` (60–160), `meter` (3 or 4), `key` ("Eb major", "A minor", "D dorian"), `tracks`, `fx`, `patterns`, `sections`, `form`.
- **Tracks:** a `patch` or a `kit` each, with `gain` (dB), `pan` (−1 to 1), and `delay` and `reverb` sends (0–1); optional `highpass` and `lowpass` (Hz). At most 8.
- **Patterns** (at most 40), exactly one kind each:
  - `chords`: `"Ebmaj9 | Gm7 | Abmaj9 | Bb6sus"`, one bar per `|`, the bar's chords sharing it; `.` holds, `-` rests. `voicing: ["Bb2", "Bb4"]` sets the range (at most 30 semitones); `rhythm: "x..x..x."` with `rhythmStep` makes stabs.
  - `arp`: the name of a chords pattern plus `steps: "0 2 1 3 1' 2"`, chord-tone indices (`'` up an octave, `,` down), with `step` and `octave`.
  - `notes`: `"Eb2 . . . - - Bb1 -"`, note names, `.` ties, `-` rests, `C4+E4` together.
  - `degrees`: `"1 3 5 . 6"`, scale degrees in the key (`#4`, `b7`), with `octave`.
  - `drums`: `{ "kick": "x.......x.......", "snare": "....g.......g..." }`, one character per step: `x` hit, `X` accent, `g` ghost, `.` rest.
  - Marks on melodic tokens: `!` accent, `?` soft. Options: `step` (`1/8`, `1/16`, `1/8t`, `1/4.`), `velocity`, `swing` (0–0.3), `gate`, `humanize`, `transpose`. Bars split by `|` must hold exactly one bar of steps.
  - A pattern plays on the track named by `track`, else the kit track (drums), else the track its name starts with (`bass_a` → `bass`).
- A score holds at most 256 chord changes and at most 20,000 notes per 120 s of video, its notes sound for at most 48 s per second of video in total (each counted with its release or ring, which lasts longer for low notes on bells and plucks), and a step joins at most 12 tones with `+`. Write sparse loops rather than dense ones.
- **Sections** (at most 16): `bars` and the patterns they `play`, looped within the section; `accent: true` adds 2 dB and a soft crash (use it for the hero).
- **Form:** `intro`, `loop` (a list), `hero`, `ending` (a section, or one per verdict), and `logo` (`track`, `octave`, `double`).

A compact score:

```json
{
  "schemaVersion": 1,
  "id": "steady-fix",
  "draft": false,
  "bpm": 96,
  "key": "F major",
  "tracks": {
    "pad": { "patch": "soft-pad", "gain": -18, "reverb": 0.3 },
    "keys": { "patch": "kalimba", "gain": -17, "delay": 0.2 },
    "bass": { "patch": "round-bass", "gain": -14 },
    "kit": { "kit": "soft-acoustic", "gain": -16 }
  },
  "patterns": {
    "pad_a": { "chords": "Fmaj7 | Dm7 | Bbmaj7 | C6sus", "voicing": ["A2", "A4"] },
    "keys_a": { "arp": "pad_a", "steps": "- 2? - 1 - 2? 3 -", "step": "1/8" },
    "pad_lift": { "chords": "Bbmaj9 | C" },
    "keys_lift": { "arp": "pad_lift", "steps": "0 2 1 3 2 4 3 1'", "step": "1/8", "octave": 5 },
    "bass_a": { "notes": "F2 . . . . . . . | D2 . . . . . . . | Bb1 . . . . . . . | C2 . . . . . . .", "step": "1/8" },
    "kit_a": { "drums": { "kick": "x.......x.......", "shaker": "..g...g...g...g." }, "step": "1/16" },
    "pad_end": { "chords": "Fadd9 | ." },
    "pad_open": { "chords": "Csus4 | ." },
    "pad_minor": { "chords": "Dm7 | ." }
  },
  "sections": {
    "a": { "bars": 4, "play": ["pad_a", "keys_a", "bass_a", "kit_a"] },
    "lift": { "bars": 2, "play": ["pad_lift", "keys_lift", "kit_a"], "accent": true },
    "resolved": { "bars": 2, "play": ["pad_end"] },
    "open": { "bars": 2, "play": ["pad_open"] },
    "minor": { "bars": 2, "play": ["pad_minor"] }
  },
  "form": {
    "loop": ["a"],
    "hero": "lift",
    "ending": { "looks-good": "resolved", "needs-attention": "open", "needs-changes": "minor" },
    "logo": { "track": "keys", "octave": 5 }
  }
}
```

## Run it
1. Draft with composed music: `covi video --short --duration 30s --draft --music compose --json`. Covi writes `video/storyboard.json` and `video/score.json`, the Covi theme marked `"draft": true`, as a starting point.
2. Write the score in `video/score.json` following this reference, and set `"draft": false`. For exact timing (where each scene and line falls, and the hero moment), read `video/timeline.json` after a first render.
3. Render: `covi render --run <id> --json`. Covi validates the score and schedules it for the video before rendering anything; a score that is invalid or too dense to play fails with exit code 2 and the problems (`covi schema score` prints the format).

Music never moves frames. You can render with the theme first, then write a score from the exact timing in `video/timeline.json` and run `covi render --run <id> --music compose`: Covi keeps the rendered frames and mixes only the new sound, in seconds.

## Output files
- `video/score.json`: the score (composed runs only).
- `video/audio.json`: the music as fitted (`bpm` against `scoreBpm`, `start`, `sections` with their start times, the `hero` moment and downbeat and whether it is `clear` of speech, the `outro` settle moment, the `logo` start and landing, the `fade`, the seconds of music `audible` outside the logo, `fallbacks` the fitter needed), the effects placed and dropped, and the mix `levels` (`musicBelowVoiceDb`, `effectsBelowVoiceDb`, the master's loudness and true peak).
- `video/qc.json`: `music-fit` (the logo after the last line and on the outro, the landing before the end, the hero on its downbeat, the tempo), `music-under-speech`, `music-audible` (the music is heard for at least 3 s or 5% of the video outside the logo, and the hero's downbeat clear of speech), `sound-effects`, and `audio`.
- `video/music.wav`: the music alone, as placed in the mix, to listen to.
