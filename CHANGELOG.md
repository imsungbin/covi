# Changelog

All notable changes to Covi are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Behavior diff capture: browser flows run at base and head with a recording (MP4, or WebM without ffmpeg) and a redacted trace each, and `demo/behavior-diff.json` and `demo/demo.md` show what changed (`demo.record`, `--record`, `--no-record`).
- A timing and motion grammar for review videos: `sync`, `transition`, `hero`, `camera`, `[[…]]` caption emphasis, and a title over a capture. Videos are never padded; QC flags stills and late hooks.

### Changed

- The `covi-video` skill now tells review videos as stories: a cold open on the subject with a hook for a first line, 2–5 second scenes, one hero moment, the list of things to check as the map, and a self review of every render.
