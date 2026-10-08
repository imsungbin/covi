# Changelog

All notable changes to Covi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Behavior diff capture: browser flows run at base and head with a recording (MP4, or WebM without ffmpeg) and a redacted trace each, and `demo/behavior-diff.json` and `demo/demo.md` show what changed (`demo.record`, `--record`, `--no-record`).
- A timing and motion grammar for review videos: `sync`, `transition`, `hero`, `camera`, `[[…]]` caption emphasis, and a title over a capture. Videos are never padded; QC flags stills, late hooks, and a low speech share.
- Evidence model: `evidence.json` gives every diff hunk and capture an id; findings, explanations, and scenes cite them in `evidenceIds` (required on confirmed and likely findings in `findings.json` v2, which is also how a file without `schemaVersion` is read), and `covi evidence` lists them.
- Subject model: `.covi/subject/subject.json` remembers the screens, elements, and passing flows Covi captured (`subject.store`); a plan without flows replays them, a storyboard `focus` can name `subject:<screen>#<element>`, and `covi subject` lists it.
- Video components and sound: code that morphs from the old lines to the new, highlight groups, and code captions; up to three `marks` per screenshot or interaction step, each with an optional gloss; diagram edge labels; storyboard `cues`; a whoosh for moving transitions, and a riser and a hit for the hero; music ducks 60 ms before speech and returns over 300 ms.

### Changed

- The `covi-video` skill now tells review videos as stories: a cold open on the subject with a hook for a first line, 2–5 second scenes, one hero moment, the list of things to check as the map, and a self review of every render.
