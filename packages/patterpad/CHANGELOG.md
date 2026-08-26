# Changelog

All notable changes to **Patterpad**, the Patter desktop editor, are documented here.
Patterpad is released with `npm run release:pad -- X.Y.Z` (a bare `vX.Y.Z` tag; its own
pipeline, separate from the Patterplay runtimes' lockstep version).

## [Unreleased]

### Added

- **Back and forward.** A quiet `‹ ›` pair at the top left retraces the documents you have visited,
  greyed when there is nowhere to go, with **View ▸ Back / Forward** behind it (⌃⌘← / ⌃⌘→ on a Mac,
  Alt+arrows elsewhere). It is the other axis from the navigator: the navigator climbs, Back
  retraces. Scenes, the Properties page and the Project Overview are all places, and moving the
  caret around a scene is not a journey, so a Back into a scene lands where you left it.

- **Properties have their own page.** `@patter` properties are the story's working vocabulary, and
  they were living in a tab of the Project Settings dialog, which treated them as configuration.
  There is now a **Properties** row at the top of the navigator, above the scenes, carrying a count
  of what the project declares; it opens a page in the editor's column, with the navigator still
  beside it. Edits save as they settle, the way a document does, instead of on closing a dialog.
  World Properties stay in Settings, beside the coverage drivers: that half really is configuration,
  the contract with your game, and the page links across to it. If you were last on the page when
  you quit, that is where the project reopens. (from-storylets/property-visibility.)

- **A property chip says what it is for.** Hovering a property in any condition or effect shows the
  purpose written on its declaration, and, for a Quality, its ladder of stages. Nothing to fill in
  that you have not already: it is the Purpose field in Settings ▸ Properties.
- **Right-click a property: Go to definition, Find usages.** Go to definition opens where it is
  declared (`@patter` in Settings ▸ Properties, a scene property in that scene's editor, `@world` in
  Settings ▸ World Properties); Find usages opens the search window's property mode, which lists
  every read and write with its location. On every property chip, including the target of an effect
  and the read-only rows in the inspector. (from-storylets/property-visibility; expr-editor 0.14.1,
  which also carries the fix for a preview's target chip having neither.)

### Changed

- **One row of chrome, not two.** On macOS Patterpad's own topbar is now the window's title bar: the
  native strip above it carried nothing but a title the bar already showed, so it is gone and you get
  the row back. Off macOS the window keeps its native frame and the bar sits beneath it as before.
  In Writing View the bar no longer collapses; it fades back instead, and firms up when you point at
  it - collapsing it would leave the traffic lights floating over your prose.

### Fixed

- Move and delete buttons in the property lists centre their glyphs (app-shell 0.33.1).

## [0.11.1] - 2026-08-25

### Fixed

- **A pinned tool window no longer floats over every other application.** Pin meant "stay on top",
  full stop, so a pinned Find, Coverage or Play window sat above every app on the machine and nothing
  else could be brought to the front. It now means what it says: above Patterpad's own editor window,
  stacking normally against everything else. A window an older build left floating is healed the next
  time you pin it, or by View ▸ Reset Windows. (Found on the Storyletter side; fixed in app-shell
  0.33.0, adopted here.)
- **Open-where-you-left-off stops forgetting.** A stale key from a pre-0.24 build won the merge on
  every launch and reset the current project's remembered place, while every save wrote correctly.
  The shell now prefers the real entry and retires the old key. (app-shell 0.33.0; nothing to do.)
- **An emptied outcome value asks for a value.** Deleting the last term of an effect left the
  condition empty state in the row: "always", and a button offering to add your first condition,
  where a value belongs. (expr-editor 0.13.1.)

### Changed

- **A quality outcome reads as a sentence.** Advancing a Quality was written out as
  `@debt = advance(@debt)`, naming the property three times to say one thing. The row now reads
  `debt advances`, in the outcome editor and in the read-only previews on inspector rows alike;
  clicking the word still opens the usual editor. An outcome that advances a DIFFERENT quality
  keeps its explicit form, because there the second name is telling you something. (expr-editor
  0.13.0, released for this.)

## [0.11.0] - 2026-08-25

### Added

- **The Quality property type** (a story stage as an ordered ladder of named stages). Declared in
  Settings ▸ Properties or World Properties like a List, except its Stages carry ‹ › movers,
  because for a ladder the order is the meaning: conditions compare by position ("at or past done")
  and `advance()` steps along it. Stage names are validated in conditions, the value picker offers
  the ladder's stages, the default picker reads "(first stage)", and coverage runs walk the stages.
  Conditions on a quality are built the same way as any other: the property is offered in the clause
  wizard, with the ORDERING operators ("at or past a stage") and its stages listed in ladder order,
  and an outcome targeting one starts as `advance(...)` - which needs expr-editor 0.12.3, released
  for this. That release chain also fixed the clause that matters most: a stage compared with `>=`
  offered a free-text box where `==` offered the ladder, so the type's whole reason to exist was the
  one shape with no stage picker.

### Changed

- **The operator menu reads in words.** Swapping a condition's operator offered rows like `is ==`
  and `> >`: the label, then the raw source, which said the same thing twice. Each row is now the
  glyph and a plain word (`≥  at least`), matching the step the clause wizard already used.

## [0.10.0] - 2026-08-25

### Added

- **Game Events show their gameData inline** (#48, thanks @rubiline): the editor row reads
  `⚙ cue: camera_focus · target: barkeep` instead of a bare gear, so you can tell which event is
  which while reading the script - one line, ellipsized before it ever wraps, live as the inspector
  edits it. The readable-script export carries every field too (it silently capped at three), and a
  long field list wraps rather than truncating.
- **A project says where it lives on disk.** The Project view shows the full path under the title
  (click it to reveal the folder in Finder / your file manager), and the project name in the top bar
  carries the path as a tooltip - so two projects with the same name are no longer indistinguishable.

### Fixed

- **A readable-script PDF no longer draws stray lines down the page after a page break.** A dialogue
  line starting near the foot of a page, with its text flowing onto the next, left its snippet edge
  drawn most of the way down the following page and its speaker name stranded far from its words.
  (Thanks to the reporter's project for the reproduction.)

- **The Replace preview shows the replacement again.** Its row was one no-wrap line, so at the search
  window's default width a line of dialogue of ordinary length was cut off before the arrow: you saw
  the start of the old text and none of the new, which is the one thing the preview exists to show.
  The row is now a two-column grid, the diff wraps, the location sits on its own line beneath it, and
  the per-row Replace button spans both.

### Changed

- **The New Project dialog says what it creates.** It offered a name, version control, a publish path
  and a folder preview, and never mentioned that a new project arrives with a playable scene in it. A
  line under the name field now says so, in the concrete: a scene called `Start` holding one line of
  narration, so the project plays the moment it opens.
- Every sheet in an .xlsx export (report, voice script, localisation) freezes its header row, so it
  stays put while you scroll.
- The explanatory line under a form field (New Project, Project Settings) reads as prose rather than
  as a shrunken label. `.identity-hint` had no style of its own, so it inherited the field label's
  semi-bold and shrank again as a `small`; it is now sized and weighted like the shell's own hints.

## [0.9.1] - 2026-08-19

### Fixed

- **Clicking a Game Data list value no longer deletes the first value in the list** (#44, thanks
  @jlafos). Clicking anywhere on a values row except a chip's own ✕ removed the FIRST value, however
  many values there were and wherever you clicked. It was not an off-by-one: the caption wrapped the
  editor in a `<label>`, a label with no `for` forwards clicks to the first labelable thing inside it,
  and buttons count - so every click on the row's dead space pressed the first chip's remove button.
  The click never reached the chip you aimed at. Captions now point at the field they caption and
  never at a button, which also fixes the same behaviour in the Properties and World Properties value
  editors, where it was equally present and simply had not been reported.

### Changed
- **The "not the same project" warning now names the project ids.** Merging a returned Patterpack
  told you the two packs and your project disagreed, but not which of the two files you picked was
  the odd one out, which is the only part you can act on. It now quotes all three ids. Wording
  matched to Storyletter's, so the two editors say the same thing.

## [0.9.0] - 2026-08-18

### Added
- **File ▸ Merge Returned Patterpack.** Sending a project to a freelancer, a translator or a reviewer
  has been a single file for a while (**Export as Patterpack**), but folding their work back in was a
  terminal command. It is a menu entry now, and the round trip is three moves in the File menu: export
  sends, **Open Patterpack** receives someone else's as a new project, and **Merge Returned Patterpack**
  takes yours back. It asks for the pack that came *back*, then the pack you *sent* (the merge needs it
  as the common ancestor), and **shows you what it found before it writes anything**, so you can back
  out. Changes to different lines simply combine. Where you both changed the same line yours is kept
  and a `.patterconflict` file is left beside the shard saying what disagreed. A file they *added*
  arrives as it is; a file they *deleted* is left alone, because a missing entry in a zip is not good
  enough reason to remove your work. **It edits the open project and cannot be undone from the Edit
  menu**, so it says so and asks first, and your version control is the way back. If the two packs and
  your project don't all claim the same project, it says so before anything else and makes **Cancel**
  the default button, because that nearly always means the wrong file was picked at one of the prompts.
- **The name box offers the one your version control already knows.** Patterpad asks for your name
  on first run while a "Locked by *someone*" badge sits in the corner of the same window, which
  means it has had a name within reach the whole time it was asking for one. It now fills the box in
  with what Git, Perforce or Plastic calls you, ready to accept or type straight over. It is a
  suggestion and nothing more: nothing is stored until you press Continue, and the box is simply
  empty when your version control cannot say (or when you are not using any).
- **"Follow in the editor" on the Play window.** The play window has always marked the line it is on
  and left your place alone, which stays the default. If you would rather read the script as it runs,
  the new toggle beside the pin asks the editor to reveal each line as it plays. **Off until you turn
  it on, and remembered after that.** It never takes focus: the editor moves behind the play window,
  so the keyboard stays where you are playing.

### Fixed
- **Hover tooltips are back in the Play, Search and Coverage windows.** Several controls in those
  windows explained themselves on hover and had quietly stopped: the Search window's pin has had no
  tooltip since 0.7.0, and the Play window's lost its own in 0.8.0. Every control in those windows
  now shows the app's own tooltip rather than the operating system's slower one, matching the
  editor. The Coverage window's pin also says what a click will *do* ("click to unpin" when it is
  pinned) instead of always reading "Keep on top".

## [0.8.0] - 2026-08-17

### Added
- **The coverage test shows how far it has got, and you can stop it.** `Review ▸ Run Coverage Test`
  used to lock the whole app for the length of the sweep with no sign of progress: at the default
  5000 runs that is several seconds of a window that does not respond to anything. It now runs
  beside you. A strip above the results carries a progress bar, the runs done, how long it has
  been going, a rough estimate of what is left, and a **Cancel** button. Cancelling keeps what the
  sweep actually sampled instead of throwing it away, and marks that report **stopped early** and
  counts only the runs it really did, so a short sample can never be mistaken for a full one. The
  previous results stay readable, dimmed, while a new sweep runs.

### Changed
- **Every window paints in your theme now, not just the editor.** The Play, Search and Coverage
  windows had never applied your colour or font choice at all: whatever you picked, they sat on
  Paper in the default reading face. They follow the setting now, and change with it while they
  are open.
- **The scene list says more about version control.** Alongside "locked by" and "out of date", a
  scene now shows when it is **checked out by you**, when it has **uncommitted changes**, and when
  it is **new and not yet committed**. A fourth marker appears for a file that is read-only on disk
  with nobody else holding it, which under a locking system is most of a fresh checkout: it is not
  a problem, and saving checks the file out for you.
- **A scene somebody else has locked is more usable.** The inspector used to be switched off
  wholesale, which also stopped you expanding a section or copying an address to go and ask them
  about it. Only the controls that would change something are disabled now; everything you can read
  stays readable.
- **Your preferences have moved to `app-settings.json`,** in the same folder as before. The first
  launch after this update reads the old `patterpad-session.json` once and carries everything
  across: recent projects and their names, the scene and line you were last on in each of them,
  your name, the colour and font themes, and the size, position and pin of the Play, Search and
  Coverage windows. **The old file is not written to and not deleted,** so it stays where it is as
  a way back. One deliberate change comes with it: a remembered position is now kept only for
  projects still in your Open Recent list, rather than for every project ever opened.
- **A play session that has fallen behind the script now says so in a banner,** with the Restart
  button inside it, instead of a line of grey text at the bottom of the choice tray. The run is
  frozen until you restart, and the old note read like the end of a passage rather than something
  needing an answer.
- **The Review Feedback bar gives the scene its own column** instead of running it into the front
  of the comment, so the comment itself gets the width.

### Fixed
- **View ▸ Reset View left the helper windows' pin buttons showing the wrong state.** It re-pinned
  the Play, Search and Coverage windows and floated them back on top, but each window's pin button
  went on showing whatever it had last been set to, so the button and the window disagreed until
  you closed and reopened it.
- **Shift-clicking to extend a selection from a single selected line or group did nothing.** The
  run between the two never formed. (It failed outright rather than misbehaving, so nothing was
  written wrongly.)
- **A quick fix offering a list of valid values could write `null` into a condition.** The chooser
  it opens is shared with the "go to" picker, so it carried that picker's **No jump** row, which
  means nothing when you are picking a value. Choosing it wrote the word `null` into the condition
  instead of doing nothing. That row is now ignored here.

## [0.7.0] - 2026-08-16

### Changed
- **Patterpad now sits on a shared foundation for Patter's desktop apps.** The furniture that is
  not specific to writing dialogue, meaning menu wording and keyboard shortcuts, dialogs, and
  icons, now comes from one shared package instead of being spelled out separately in each app.
  Nothing has moved and nothing has been removed: the point is that what you learn in one Patter
  app keeps working the same way in the next, and stays that way as they grow. In this release
  that shows up as:
  - **Undo**, **Redo**, **Duplicate** and **Find…** in the Edit menu, and **About Patterpad**,
    **Patterpad Documentation**, **Patter Documentation Home**, **Check for Updates…** and
    **User Information…** in the Help and app menus, now take their wording and their shortcuts
    from that shared source. Every label and key is identical to 0.6.8; they have simply stopped
    being Patterpad's private choice, so they cannot drift apart later.
  - **One close button.** Patterpad drew its close affordance two ways: ✕ in most places, and the
    multiplication sign × in four others, including tag chips and the review bar. They are all ✕
    now.
  - The bulk **find-and-replace confirmation** is the shared dialog rather than Patterpad's own
    copy of it. It looks and behaves as it did.
- **View ▸ Reading Palette is now View ▸ Colour Theme.** Same control, same five choices; the name
  is the one the Patter family uses across its apps, so the setting is called the same thing
  wherever you meet it. **Font Theme** is unchanged and stays Patterpad's own. (The code has always
  called this `ColourTheme` internally, so only the label moved.)
- The author link in the **About** dialog now points to `ian.wildwinter.net`.

## [0.6.8] - 2026-07-31

### Fixed
- **Windows auto-update works again.** Since 0.6.0, the Windows installer was accidentally signed
  with the macOS Developer ID certificate (the mac signing secrets leaked into the Windows build
  job), so every downloaded update failed signature verification and was silently discarded - the
  real cause of #33. Windows builds are now genuinely unsigned (by policy; Authenticode signing is
  not currently available to us), so updates verify and install again.
  **One manual step for Windows users on 0.6.0-0.6.7:** the copy you are running still expects the
  wrong signature, so this one update must be installed by downloading the installer from
  https://patterkit.dev/download/ - auto-update works again from this version onward.

## [0.6.7] - 2026-07-30

### Fixed
- **Rescue Windows** now genuinely re-pins the Search and Coverage windows. It recorded them as
  pinned but only re-floated the Play window, so the setting lied until the windows were reopened.
- Closing the editor now also **closes the Coverage window**; an orphaned coverage window could keep
  the app alive on Windows and Linux.
- The bulk find-and-replace confirmation is now the app's **themed dialog** instead of a stock
  browser popup. Confirm dialogs also stop pre-selecting the destructive button (focus starts on
  Cancel, so a stray Enter can no longer delete or replace), and the destructive button now wears
  the danger colour rather than the accent.

## [0.6.6] - 2026-07-29

### Fixed
- An update download that **stalls is now noticed, killed, and retried** instead of sitting
  "downloading in the background" forever. A hung download reports neither progress nor an error, so
  nothing ever recovered it - the state a Windows user hit for a whole day (#33) - and only restarting
  Patterpad would clear it. A watchdog now cancels any download that reports no progress for 3 minutes
  and retries (up to 3 attempts; the next update check starts a fresh round). If it still can't get
  through, **Help ▸ Check for Updates** says so instead of staying silent. All platforms.

### Added
- **Help ▸ Check for Updates shows live download progress** - a real bar with percent, size, and
  speed - while an update is downloading, instead of just promising a background download. (#33)

## [0.6.5] - 2026-07-24

### Fixed
- The **jump picker** (the "Jump to…" popup on a snippet's Jump row, `/jump`, and node references) no
  longer crushes its rows into unreadable ~10px slivers in a project with enough scenes and blocks.
  This is the real fix for #30: 0.6.4 guarded three lookalike popups but missed the one actually in
  the screenshots - the type-to-filter picker, whose rows clip their text for ellipsis and so had no
  minimum height once the list outgrew its cap. Reproduced with the real component before fixing:
  92 rows measured at ~10px each before, ~25px (natural height, scrolling) after.

## [0.6.4] - 2026-07-23

### Added
- A **Play button in the topbar**. The core loop (write, play, tweak) had no visible affordance in the
  window - Play lived only in the menu. A quiet workspace-only button beside the pane toggles now runs
  the current scene.

### Fixed
- **Jump list** entries no longer get crushed into unreadable (but still clickable) slivers in a
  project with many scenes and blocks. The picker lists one row per scene and block, and once the list
  outgrew its height cap, the layout squeezed the rows to fit instead of scrolling - a flex quirk where
  button rows have no minimum height. Rows now always keep their full height and the list scrolls. The
  same guard is applied to the scene nav, the Settings tab column, and (via expr-editor 0.10.2) the
  condition editor's property picker, which could all squish the same way. (Candidate fix for #30:
  the squeeze is reproduced and fixed in isolation; please reopen if your project still shows it.)

## [0.6.3] - 2026-07-23

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
