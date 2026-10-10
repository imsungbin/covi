# Changelog

All notable changes to Covi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Video cards size their text to their content and fill the frame (code and terminal text up to 44 px at 1080p, 48 in 9:16); QC warns on text under 24 px (code) or 28 px (body), empty frames, more than two scenes of one kind in a row, and one transition kind over 60% (with four or more); `examples/backend-slim-request` is the benchmark for videos of changes without a UI; and drafted explanations and narration no longer name a function whose only nearby change was the next one's doc comment.
- Direction and the canvas: every video is drawn on one canvas whose camera pans and zooms between scene stops; an optional `video/direction.json` (`covi schema direction`, drafted by `covi video --draft`) directs each scene with elements drawn only from evidence and `place`, `reveal`, and `camera` beats timed to its narration; Covi's default director gives runs without an agent the same motion; `video.direction: off` (`--direction off`) renders as 0.2.0 did; and a storyboard that gives two scenes one id is now refused.
- Code morph: a `morph` element (a `diff-hunk:` id) and `morph` beat turn a hunk's code before the change into the code after it, token by token (removed lines fold away, new lines slide in, kept tokens travel); long hunks elide to 14 rows (18 in 9:16) with a `… N lines` marker in the video's language; `camera` `follow` keeps the changed lines framed at every frame; Covi's default director morphs code scenes that show a hunk of at most 12 changed lines a side; the contact sheet shows every morph's midpoint; and highlighted code keeps every character (numbers such as `10n`, `1e5`, and `5px` lost some before).

### Changed

- Broadcast mix: music is a continuous bed by default, 12–20 dB under the voice with its 1–4 kHz band carved out, glued by a bus compressor, and placed on ramps that never make it jump; effects follow the bed and stay 8 dB under the voice's peak; `bookends` ramps are slope-limited; QC adds `music-jump`, which fails music that still moves more than 6 dB in a second (a composed score's sudden entry), and `music-range`; the audio engine is `covi-audio-4`, so cached music renders again.

## [0.2.0] - 2026-10-09

### Added

- Behavior diff capture: browser flows run at base and head with a recording (MP4, or WebM without ffmpeg) and a redacted trace each, and `demo/behavior-diff.json` and `demo/demo.md` show what changed (`demo.record`, `--record`, `--no-record`).
- A timing and motion grammar for review videos: `sync`, `transition`, `hero`, `camera`, `[[…]]` caption emphasis, and a title over a capture. Videos are never padded; QC flags stills, late hooks, and a low speech share.
- Evidence model: `evidence.json` gives every diff hunk and capture an id; findings, explanations, and scenes cite them in `evidenceIds` (required on confirmed and likely findings in `findings.json` v2, which is also how a file without `schemaVersion` is read), and `covi evidence` lists them.
- Subject model: `.covi/subject/subject.json` remembers the screens, elements, and passing flows Covi captured (`subject.store`); a plan without flows replays them, a storyboard `focus` can name `subject:<screen>#<element>`, and `covi subject` lists it.
- Video components and sound: code that morphs from the old lines to the new, highlight groups, and code captions; up to three `marks` per screenshot or interaction step, each with an optional gloss; diagram edge labels; storyboard `cues`; a whoosh for moving transitions, and a riser and a hit for the hero; music ducks 60 ms before speech and returns over 300 ms.
- Outcome loop: comments carry a ledger and a "Was this useful? 👍 👎" line, `covi outcomes collect` gathers what became of them into `.covi/outcomes/`, `covi outcomes report` gives precision by certainty, and the brief shows it as a hint; the GitHub Action gains `outcomes`, `finding-anchors`, and an author-side example, and GitLab a scheduled outcomes job. Covi now edits only a comment its own token or `publish.botLogin` wrote, so a GitHub App token needs `publish.botLogin` set (Covi warns with the value).

### Changed

- The `covi-video` skill now tells review videos as stories: a cold open on the subject with a hook for a first line, 2–5 second scenes, one hero moment, the list of things to check as the map, and a self review of every render.
