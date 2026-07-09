# Changelog

All notable changes to **Patterpad**, the Patter desktop editor, are documented here.
Patterpad is released with `npm run release:pad -- X.Y.Z` (a bare `vX.Y.Z` tag; its own
pipeline, separate from the Patterplay runtimes' lockstep version).

## [Unreleased]

### Fixed
- Publishing a playable HTML page now runs the current runtime. The inlined runtime had drifted
  behind, so an exported page played **Best match** groups as plain sequential; they now play
  correctly (matching the editor and all four engines).

## [0.3.1] - 2026-07-09

### Fixed
- The **Auto Rebuild** toggle in Project Settings ▸ General now reflects the saved value (in 0.3.0
  it always showed off, and saving the dialog could switch Auto Rebuild off). The Build-menu
  checkbox was unaffected.

## [0.3.0] - 2026-07-09

### Added
- **Auto Rebuild** (opt-in): recompile the `.patterc` bundle a moment after you stop editing, so the
  on-disk build stays current without pressing Publish Bundle. Toggle it from the **Publish** menu
  checkbox or **Project Settings ▸ General**. It only writes when the compiled bundle actually
  changed, and silently keeps the last good build if the project is momentarily invalid mid-edit.
  Off by default (best left off if you commit the bundle to a lock-based VCS).

## [0.2.0] - 2026-07-07

### Added
- Author **Best match** groups: a new sequence order (`specificity`) that plays the eligible child
  whose condition most specifically fits the current state, falling back to a condition-less filler.
  Available in the `/` insert menu and the action menu (Follow with / Wrap in), with **Best match**
  in the inspector's Order control. A soft nudge flags a Best-match group that has no conditioned
  children (it behaves like Shuffle). Plays identically on all four runtimes.

## [0.1.7] - 2026-07-06

### Added
- **Patterpack**: send a whole project as one file. **File ▸ Export as Patterpack…**
  writes a `.patterpack` (source only, like Save As: no audio, no build output).
  **File ▸ Open Patterpack…** (and double-clicking a `.patterpack`) asks where to unpack
  it into a fresh `.patter` folder, then opens it. Files get a `.patterpack` association
  and a document icon.

## [0.1.6] - 2026-07-06

### Fixed
- Windows auto-update could download forever without ever offering to restart. It now
  downloads the update in one full pass instead of the flaky block-by-block method, and
  writes an updater log for diagnosis.

## [0.1.5] - 2026-07-06

### Changed
- Actually ship on Electron 42. A stale build pin meant every prior build was still
  packaged on Electron 31 despite the toolchain upgrade, so the security fixes never
  reached the installed app until now.

## [0.1.4] - 2026-07-06

### Changed
- The About dialog's PatterKit link now points at patterkit.dev.

## [0.1.3] - 2026-07-05

### Fixed
- A packaging regression in the 0.1.2 build could make the app fail to launch. The
  build now bundles its internal modules correctly, so packaged builds start reliably
  on every platform.

## [0.1.2] - 2026-07-05

### Changed
- Updated to Electron 42: over a year of Chromium and security fixes under the editor
  and the scratch recorder, plus the latest build toolchain.

### Fixed
- The first scratch take in a project now updates the line's recording status
  immediately; previously a brand-new audio folder wasn't noticed until the app was
  restarted.

## [0.1.1] - 2026-07-04

### Changed

- Minor tweaks to terminology to get rid of references to bubbles instead of snippets.

## [0.1.0] - 2026-07-04

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
  recording at the desk (take-state badges plus a skip-to-next-needed sweep), and playback
  in the editor.
- Localisation: languages declared per project, export / import for translators
  (JSON / Excel / PO), staleness tracking, and live language preview.
- Publishing: compile the runtime bundle, publish a playable HTML page, a customisable
  web folder, or a readable script (PDF / Word).
- Project plumbing: version-control awareness (git / Perforce / Plastic / SVN), file
  associations, search & replace across the project, spell-check, and auto-update.
