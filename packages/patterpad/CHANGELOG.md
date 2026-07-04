# Changelog

## 0.0.1

### Patch Changes

- Updated dependencies [e69a249]
  - @patterkit/runtime@0.2.0
  - @patterkit/ops@0.1.1

All notable changes to **Patterpad**, the Patter desktop editor, are documented here.
Patterpad is versioned by `npm run bump:pad` and released by tagging `patterpad-vX.Y.Z`
(its own pipeline, separate from the Patterplay runtimes' lockstep version).

## [Unreleased]

## [0.1.0] - Unreleased

### Added

- The Patterpad editor: a writer-first, screenplay-style surface for Patter projects -
  character cues, lines, directions, narration, and game events, edited directly on the
  source files on disk (id-stable, lossless round-trip).
- Structure and logic: scenes / blocks / groups (choice, branch, sequence), a guided
  condition editor, properties + effects, jumps with go / call modes, freeform tags,
  and per-node game data.
- The Play window: walk the real story as you write - choices, conditions, saves,
  language switching, closed captions, paced reveal, and a live step marker back into
  the editor. Live Link streams a running game's cursor into the editor too.
- Review and production: threaded comments, rewrite suggestions, writing + recording
  status tracking, production reports (with export to spreadsheet), coverage testing,
  estimating, and voice-script export.
- Audio: recording-status tracking, Audio Folders (takes on disk drive status), scratch
  recording at the desk, and playback in the editor.
- Localisation: languages declared per project, export / import for translators
  (JSON / Excel / PO), staleness tracking, and live language preview.
- Publishing: compile the runtime bundle, publish a playable HTML page, a customisable
  web folder, or a readable script (PDF / Word).
- Project plumbing: version-control awareness (git / Perforce / Plastic / SVN), file
  associations, search & replace across the project, spell-check, and auto-update.
