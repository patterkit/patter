# Changelog

All notable changes to **Patterpad**, the Patter desktop editor, are documented here.
Patterpad is released with `npm run release:pad -- X.Y.Z` (a bare `vX.Y.Z` tag; its own
pipeline, separate from the Patterplay runtimes' lockstep version).

## [Unreleased]

### Fixed
- A project with **no version control** no longer triggers a repeating GitHub sign-in window (or, on
  Windows, an autosave error after that window is dismissed). If the project folder happened to sit inside
  a larger git checkout, Patterpad was letting the version-control layer auto-detect that enclosing `.git`
  and treat the project as a git repo, so its background status poll ran a git-lfs lock check against the
  remote (the credential prompt) and autosave would have staged the story files into that unrelated repo.
  Patterpad now pins the version-control layer to the system you actually chose in Settings, so a "None"
  project does plain file writes and never runs git. (#26)
- The **View** menu no longer lists two full-screen commands on macOS. macOS adds its own **Enter Full
  Screen** item to the View menu automatically, and Patterpad was adding a second one beside it. The
  system's item (with the usual ⌃⌘F) is now the only one on macOS; Windows and Linux, which get no such
  item, keep Patterpad's.

## [0.6.2] - 2026-07-21

### Fixed
- You can select a **block title** with the mouse again. Clicking the title selects the block, which made
  the whole block a drag source, so dragging across the words dragged the block instead of selecting the
  text. A block now moves only by its **⠿** grip, never by its title, so the title behaves like the plain
  text field it looks like. (#23)

### Changed
- The **block title** field now runs the full width of the heading, up to the **⋯** button, instead of
  stopping short and cutting long section names off. (#23)

## [0.6.1] - 2026-07-20

### Fixed
- Dragging across a **block title** to select it could dump a wall of the block's own lines into the
  name. The title is a plain text field sitting inside the editing surface, so the browser treated it as
  a drop target and the drag ended by *dropping* editor content into it. The field no longer starts or
  accepts a drag, so selecting the title by dragging just selects it.
- Ending a snippet with **Shift-Enter** (and **Split here**) no longer copies the snippet's condition
  onto the new one. Splitting carried the whole snippet across, so the new bubble silently inherited the
  original's condition - and its effects, tags and game data with it. Only the lines move down now; the
  new bubble starts clean, and the original keeps what you wrote on it. (A terminal jump still moves down
  with the tail, as before.)

## [0.6.0] - 2026-07-20

### Added
- **Duplicate** a whole snippet, group, option or block, contents and all: on the piece's **⋯** menu
  (or right-click), and on **Edit ▸ Duplicate** (`⌘D` / `Ctrl+D`), which copies whatever is selected or
  the piece the cursor is in. The copy lands right after the original and is genuinely separate: every
  line in it takes a new identity, so editing the copy never touches the original, while the text comes
  with it. Writing status and notes are carried over (the copy is at the same stage of drafting); review
  comments are not (a comment is a conversation about the original line), and neither is recording status
  (the copy has no take yet). A duplicated block is named "<name> copy" and takes a fresh address, since
  two blocks in a scene cannot share one. Undoable like any other edit.

### Changed
- Flag checks read more compactly in the condition / effects **preview** above a snippet or group:
  `check_flags(@p, +a, -b)` now shows as `@p: +a -b`, dropping the function name and brackets. The
  editable condition editor is unchanged, and so is what the expression actually means.
- A new project's starter line no longer talks about files and terminal commands. The scaffolded Start
  scene read "Welcome to <project>. Edit scenes/start.patterflow, then run: patter play", which means
  nothing when you created the project in Patterpad and are typing straight into the editor. It now reads
  "Welcome to <project>. This is the first line of your story - replace it with your own."

## [0.5.4] - 2026-07-16

### Fixed
- `patterpad <project> --at <where>` now lands correctly when Patterpad is already running. Two problems:
  on Windows the `--at` switch could be dropped as the launch was handed to the running window (the
  location is now forwarded over a reliable channel); and re-launching the project that was already open
  reloaded it from disk - resetting the editor to the landing scene and discarding unsaved in-memory
  state - instead of just jumping. Patterpad now jumps in place when the requested project is already
  open, and only loads when it is a different one. Cold-start `--at` was unaffected.

## [0.5.3] - 2026-07-15

### Fixed
- Arrow-key navigation past a dialogue line works again. The character-name cast popup used to open the
  moment the caret entered a cue and then swallowed **Up / Down**, so you couldn't move to the line above
  (its popup ate the key) and moving down meant escaping the popup on every line. Vertical arrows now pass
  straight through cues to move between lines; the cast popup opens only on a deliberate act - typing a
  letter, a sideways Left / Right move into the cue, or a click - and once it's open, Up / Down navigate
  its suggestions as before. (#20)

## [0.5.2] - 2026-07-14

### Changed
- **Grammatical gender** (Project Settings ▸ Cast) is now a free-text field with auto-suggest, instead
  of a fixed Male / Female / Neuter dropdown. Three genders don't cover every language (common, animate,
  inanimate, and so on), so you can type whatever a translation needs; the suggestions offer the everyday
  values plus any gender already used elsewhere in the cast, so common spellings stay consistent. Blank
  still means "not specified", and the value is still authoring-only (never shipped in the bundle). (#11)

## [0.5.1] - 2026-07-14

### Fixed
- A deleted line no longer leaves an unfixable problem behind. Removing a beat that carried a writing /
  recording status, a cut flag, or a documentation note used to leave that metadata orphaned and reported
  as a **"… set on unknown id"** error in the problems bar - one you couldn't jump to (the beat is gone)
  or clear. Orphaned per-beat metadata is now treated as harmless residue and ignored, like an orphaned
  comment. (Status-value and doc-class checks still apply to lines that exist.)
- Editing project (`@patter`) properties in **Project Settings ▸ Properties** now takes effect
  immediately. Adding, renaming, retyping, or editing the values of a property used to leave the
  **condition editor**'s property list stale until you restarted Patterpad; it now updates on save. A
  changed default (or any settings change) also live-refreshes an open **Play** window, instead of the
  run staying on the old values until restart.
- Localisation staleness now works. Editing a source line used to leave its existing translations marked
  **translated** on the next export; they now correctly flip to **stale**, because saving a scene stamps a
  fresh `modifiedAt` on each source string that actually changed (previously only a scene-level author
  timestamp moved, which the per-string staleness check never read). Importing a translation file also
  reports how many translations **changed** rather than every filled-in row, so re-importing an unedited
  file honestly reads **0 updated**.

## [0.5.0] - 2026-07-13

### Added
- **Needs re-record**: a checkbox on a dialogue line (inspector, when recording status is tracked) for a
  take that exists but must be redone (bad quality, wrong take, misread). It acts as a separate status
  that overrides the normal one: wherever recording status is shown or counted, the line reads as
  **re-record** instead of its rung on disk, so it reappears in the recording script, gets its own tally
  in the production report, and its own **Recording** browse filter. The audio file is left alone (you can
  still play the bad take). Ticking a line with no VO note opens the note editor so you can record *why* it
  needs redoing; that note rides the recording script to the session. Authoring-only, never in the bundle.

## [0.4.0] - 2026-07-10

### Added
- **Grammatical gender** on each cast member (Project Settings ▸ Cast, behind the row's ▸ expander):
  Male / Female / Neuter / Not specified. It is carried into every localisation export so a gendered
  language can inflect that character's lines: a **Gender** column in Excel, a `#. Gender: female`
  comment in PO / POT, and `context.gender` in JSON. Export-only context, regenerated from the cast on
  each export, never read back on import and never shipped in the compiled bundle.
- Launch straight at a line: `patterpad <project> --at <where>` opens the project at a location instead
  of where you left off, where `<where>` is a beat id, or a scene / block Game ID or name (the same query
  `patter resolve` takes). Paste an id from a locale table, an audio filename, or a runtime log and the
  cursor lands on the line it names. With no path it reopens the last project there; if Patterpad is
  already running the same command jumps the open window. An unmatched location opens the project as
  normal and says so on the terminal.

### Fixed
- **Voice actors' names no longer ship inside the published bundle.** The **Actor** you record against a
  cast member was meant to stay in the project (it feeds the VO script export), but every `.patterc` you
  published carried it. Building now emits only the player-facing cast, so a shipped game contains no
  actor names, casting notes, or grammatical gender. Rebuild to clear it from an existing bundle. If your
  project names actors the rebuilt bundle's hash changes, so an in-progress playthrough saved against the
  old bundle may be flagged as stale.

## [0.3.2] - 2026-07-09

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
