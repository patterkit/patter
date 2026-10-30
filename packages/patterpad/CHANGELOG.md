# Changelog

All notable changes to **Patterpad**, the Patter desktop editor, are documented here.
Patterpad is released with `npm run release:pad -- X.Y.Z` (a bare `vX.Y.Z` tag; its own
pipeline, separate from the Patterplay runtimes' lockstep version).

## [Unreleased]

## [0.41.1] - 2026-10-30

### Fixed

- **Play's "Follow in the editor" shows the scene when the project overview is up.** The editor took the scene being
  played, but left the overview over it, so nothing seemed to follow. The same went for a search or Coverage jump
  made from the overview.

## [0.41.0] - 2026-10-30

### Added

- **Read a published story at your own pace.** The playable HTML has Play's **Continue** toggle. With it off,
  each line waits for a click or tap on the page, Space or Enter, or **Next**, and the choices come with the
  last line; with it on, the story plays through at the chosen speed, as before. Until a reader chooses, an
  unvoiced project starts with Continue off and a voiced one with it on, and Play's own Continue toggle now
  starts the same way. A page published before this gets the toggle when the story is published again.
- **Folders in the scene list.** **+ New ▸ Folder** at the foot of the list (which now offers a scene, a
  scene from a kit, or a folder), or File ▸ New Folder makes one
  straight after the open scene, its name ready to type. Drag a scene or folder onto a folder to put it inside,
  or between rows to place it. Folders can hold folders: New folder inside, on a folder's right-click menu,
  makes one within it. **Move to Folder…** on the right-click menu files a
  scene without dragging, which is quicker in a big project. Click a folder to open or close it; the arrow keys
  move through the list, and Right and Left open and close. Folders only organise the list: no file moves,
  play doesn't change, and deleting a folder moves its scenes up rather than deleting them. Which folders you've
  closed is remembered for you, not saved in the project. Opening a scene opens the folders it's in, a closed
  folder shows its scenes' version-control badges, and Find shows each result's folders. The production report,
  voice script, and loc spreadsheets gain a Folder column.
- **Two people reordering scenes now merge.** When both moved different scenes, both moves land; only one
  scene moved two ways is a clash.
- **A choice that can run dry and end the dialogue is a warning, marked on the choice.** Patterpad now finds a
  choice that comes round again through other blocks or scenes, not only one that jumps straight back to its
  own block. Where nothing comes after it, it warns, and **Add a fallback** in the Problems bar adds one. Where
  play carries on after it, it's a quieter note, since asking until nothing's left and then moving on is often
  what you mean.
- **The problems count no longer moves when another scene opens.** The title bar's count, and the problems you
  step through, are the project's problems only. Spelling keeps its underlines and gets its own count in the
  problems bar, for the scene that's open: click it to go to the next possible mistake in that scene.
- **Play says when a run ended because a choice ran dry**, in place of "The End", and moves the editor to the
  choice.

## [0.40.0] - 2026-10-29

### Added

- **Resolve clashes in the app.** When a merge (a returned Patterpack, or a `git merge` through Patter's
  merge driver) leaves clashes, a banner across the top of the window says how many, and its Resolve…
  button, or File ▸ Resolve Clashes…, opens the resolver. Each clash says where it is in words ("Line L12
  in The Tavern", "Property @gold") and shows both sides as text. Keep mine keeps your side, Take theirs
  writes theirs, and Edit takes you to the place to change it yourself, after which the clash offers Mark
  resolved. A clash that isn't one value, such as two different reorderings, offers Keep mine and Edit.
  Each choice is one step Edit ▸ Undo takes back, and a shard's `.patterconflict` file goes with its last
  clash. The resolver is the family's: Storyletter uses the same one.
- **Storylet cards keep their scenes.** Where a Storylets project nearby is paired with this one, Patterpad
  reads its cards when the project opens and whenever you come back to the window. Deleting a scene that cards
  play, or changing its Game ID, now asks first and names them ("2 storylet cards play this scene: Tavern
  Brawl, Last Orders."). Renaming such a scene while its Game ID follows its name pins the Game ID it had, so
  the cards still find it, and a toast says so with Undo.
- **A warning for lines that never play.** Anything after a snippet that always jumps, to END or anywhere
  else, now shows a warning on it in the page and the problems bar, so lines left after an END don't go
  unnoticed. A jump with a condition, a call, or a jump inside a choice's option doesn't count.
- **What's new, after an update.** The first time Patterpad opens after an update, it shows what's new in that
  version, or in every version since you last ran it. Help ▸ What's New shows the latest at any time, and a
  tickbox turns the after-update window off.
- **A command palette.** Press Cmd+K (Ctrl+K on Windows and Linux) to run any menu command by typing its
  name, or to open a scene, a block, or the Properties page. It lists exactly what the menus hold, greyed where
  a command can't run just now.
- **Change by, for a number.** Setting a number property in an effect now offers "Change by" first: add or
  take away an amount, and Patterpad writes it as the property plus or minus that amount. Adding 1 to a
  counter is one step instead of building the sum by hand.
- **Effects show on the page.** A snippet's On begin and On end effects sit beside it as a quiet line
  ("On begin: set @gold to @gold + 1"), and a scene's own effects sit under its title, so you can see what
  the story changes without opening the inspector. The Word, PDF, and editable scripts show them the same way.
- **Effects in the exported script.** The Word, PDF, and editable scripts show each snippet's effects as a
  quiet line, such as "On end: sets knows_secret to true". Re-importing an edited script leaves them alone.
- **Jump to somewhere new.** Type a name no scene or block has into the jump picker and it offers "+ New
  scene" and "+ New block in this scene": the jump then points at what it made. A new scene goes straight
  after the one you're in, and you stay where you are.
- **Make a property from an effect.** Type a name no property has into an effect's "+ set property" picker
  and choose "+ New property": Patterpad asks whether it holds a number (the default), true or false, or
  text, adds it to the Properties page, and carries on to its value. One undo takes it back.
- **Move things from the keyboard.** Ctrl+Cmd+Up and Ctrl+Cmd+Down (Ctrl+Alt on Windows and Linux) move
  the selected snippet, group, or block, or the snippet you're writing in, one place up or down, stopping
  with a quiet hint at the first or last place. Edit ▸ Move Up and Move Down do the same, and so does the
  command palette.
- **Move a scene up or down.** Right-click a scene for Move up and Move down, or use the same keys, or
  Edit ▸ Move Up and Move Down, with its row focused. One undo puts it back. A new scene now goes after the
  one you're in, and stays there when you reopen the project, rather than at the bottom of the list.
- **Writing status for a scene or a block.** The scene and block inspectors have a Writing dropdown showing
  the lowest status among their lines, with "Mixed" when they differ. Choosing a status raises every line
  below it and leaves the lines already further along; choosing the first rung clears them all. The ⋯ menu's
  Status follows the same rule, and either is one undo.

- **Direction in the voice script.** The exported voice script has a Direction column, so an actor reads each
  line's performance direction beside it.
- **Re-record, flagged for you.** Editing what a recorded or final line says now ticks its "Needs re-record"
  box, and undoing the edit unticks it. Changing only spaces or formatting, or the line's direction, doesn't.

### Changed

- **New Scene makes the scene at once.** File ▸ New Scene (still Shift+Cmd+N) and the "+ New scene" row
  add an "Untitled scene" straight after the one you're in and open it with its title selected, so you just
  type its name. A second one is "Untitled scene 2", and so on. To start from a scene kit, choose New Scene
  from Kit… in the same menu.
- **Show Navigator.** View ▸ Show Scenes is now Show Navigator, as in Storyletter.
- **Undo names in sentence case.** Edit ▸ Undo and Redo name the change the way Storyletter does: "Undo
  Move scene up", "Undo Writing status", "Undo New scene". Names such as Patterpack stay capitalised.
- **The merge's message points at the resolver.** After a Merge Returned Patterpack with clashes, the
  message says how many and where to settle them, instead of pointing at the `.patterconflict` files.
- **Game scopes, as in Storyletter.** Project Settings ▸ World properties is now Game scopes. `@world` comes
  first, and + Add scope adds another, such as `@player`, with its own name and a Remove button. Each scope
  can be read-only to the story, or take any name unchecked. A name that can't be used says why where you
  typed it. Renaming a scope renames every reference to it, in conditions, effects, and `{@player.hp}` in
  text, and one undo puts it all back. Removing a scope the game shares with its other tools removes it
  from `game.scopes.json` too. Coverage drivers can feed any scope.
- **Cmd+1 and Cmd+2 go into the pane.** With the scenes list or the inspector open, the shortcut moves the
  keyboard into it (the open scene's row, in the scenes list), and closes it only when you're already there,
  taking you back to where you were. A pane you can't see is no longer in the Tab order.
- **Focus comes back after a dialog.** Closing a dialog opened from the inspector, such as Scene properties
  or a note, puts the keyboard back on the button that opened it, or in the script, rather than nowhere.
- **`@gold` everywhere.** A property of the story's own reads `@gold` in conditions, effects, the inspector,
  and Find Property Usage, as you'd write it; a property of any other scope keeps its name in full
  (`@world.day`).
- **A renamed character keeps their colour.** Rename someone in Project Settings ▸ Cast and their name
  keeps the colour it had, on the page, in the play window, and in the Word and PDF scripts.
- **The speaker picker keeps up with the cast.** It offers "+ Add" only for a name (up to three words, with
  no full stop or question mark), and undoing an add, or renaming someone, takes the old name out of it.
- **Spell-check in your project's language.** A project whose source language is plain English ("en")
  checks spelling in your system's English, British or American, unless you pick a dictionary yourself.
- **No question with only one scene.** Play from Start and Coverage no longer ask where the story starts
  when the project has only one scene: it starts there.
- **Game scopes, everywhere.** The play window's advice, the merge messages, the coverage window's
  button, and the Properties page's link now say Game scopes, matching the settings tab.
- **Undo instead of "Are you sure?"** Deleting a scene, Replace All, and accepting every clean suggestion
  happen straight away and say what they did, with an Undo button on the message. Edit ▸ Undo works as
  before. Merging a returned pack still asks first when the pack seems to come from another project, or when
  it changes the game's shared World file.
- **Switching scenes is instant, and undo comes with you.** The next scene shows as soon as it's read,
  without waiting for the one you left to finish saving. The last eight scenes you visited keep their undo
  history, so you can go back to a scene and undo there, and Undo after a switch works back into the scene you
  came from, showing it first. A scene whose files changed while you were away opens fresh.
- **Updates don't interrupt.** When an update has downloaded, a "Restart to update" button appears in the
  top bar instead of a dialog over your work. It installs when you next quit if you'd rather not restart now.

- **A scene somebody else holds is easier to read.** Its locked fields and buttons keep their text at full
  strength, so you can read every value; they show they're locked with a dashed edge and a no-entry cursor,
  and the notice above the document still says who holds it. The inspector is no longer dimmed as a whole.
- **A cleaner, crisper look, shared with Storyletter.** The two apps now have the same colour themes: Light and
  Dark, which follow your system until you pick one, and Parchment, a warm option for long writing sessions. Blue
  is the one accent colour, and every text colour meets the usual contrast guideline in every theme. If you'd
  picked Paper or Mist you're now on Light, and Slate or Night are now Dark. The interface uses your system's own
  typeface, with quieter corners and shadows, white fields, and menus that open
  straight away.
- **A calmer inspector.** It shows what you've set, not every property a node could have: the rest wait in
  one Add menu under each section. The line and its snippet stay open, while the option, group, block, and
  scene above them fold to one line saying what they set, and Patterpad remembers which you keep open. An
  option's Sticky, Fallback, and Secret are one row of buttons.
- **The script is a page.** Each block is one white page with its title on it, and its snippets run down it
  as a script instead of sitting in separate cards. A thin rule beside each snippet shows where it starts
  and ends, at any depth inside a choice, and the snippet you're writing in has its rule in blue. Point at a
  snippet and its drag handle appears in its rule, with its menu at the end of its first line; only the
  thing you're pointing at shows a menu, never every group around it. A problem colours that snippet's
  rule, or that option's line, rather than adding a bar beside it.
- **Hover is calmer.** A snippet's drag handle and menu, the "+" controls, and the inspector's buttons fade in
  after a moment and fade out gently, instead of blinking, and a highlight eases rather than snapping. A jump
  no longer lights up a block of colour when you point at it; its target underlines instead. Reduce Motion
  turns all of it off.
- **Names hang in the margin.** A character's name sits right-aligned in a column to the left of their line,
  so speech, narration, game events, and jumps all start at one edge, as in a prompt book. A long name runs
  out into the margin rather than pushing the line along.
- **More room for the script.** The editor's margins are narrower, and a jump sits at the text's left edge,
  drawn as an arrow and its target (a call has its own loop icon). A choice's options are marked by a small
  diamond on their line instead of a tinted box and an "Option" label.
- **Renaming a scene looks like editing.** While you're in the scene's title, a blue line runs under it,
  instead of the system's focus box in your Mac's accent colour.
- **Change several snippets at once.** When you select more than one snippet, the inspector shows what
  they share: their condition, jump, default pause, and tags, with "Mixed" where they differ. A change there
  applies to all of them, and one Undo takes it back. A tag only some of them carry shows how many, and you
  can add it to the rest or remove it from all of them.
- **Dialogue fits a narrow window.** When the script column is narrow, a line's character name sits on its
  own line above the speech, with any direction under it, as in a screenplay, instead of squeezing the speech
  into a column one word wide.
- **A quieter navigator.** Scenes are listed at an even weight, the open one marked by a soft fill, and Find
  looks like the search field it opens.
- **The font theme changes only the script.** View ▸ Font Theme no longer changes the typeface of the menus,
  panes, and dialogs.

- **Translation import checks the file.** A file for one language won't import as another: pick the language
  the file is for, or leave Template picked and Patterpad uses the file's. Lines the project no longer has are
  skipped rather than written, and the import lists them, along with any translation whose placeholders or
  formatting don't match the source. Excel exports now say which language they're for; an older spreadsheet
  still imports as the language you pick, with a warning to check it.

### Fixed

- **The inspector's Jump row fits a narrow inspector.** A long target name used to run over the Jump and
  Call toggle beside it. The toggle now moves under the name when there isn't room for both.
- **A jump isn't called missing while a project is still opening.** Opening a project on a scene you'd left
  it in, a jump to another scene could read "Missing scene" or "Missing block" for a moment, until the rest
  of the project had loaded. It now reads "…" until then, and only a target that really has gone is missing.
- **Status badges keep up with the inspector's divider.** Dragging the divider left the badges beside the
  lines where they'd been until something else moved them. They now follow the lines as the page resizes.
- **The ⋯ button doesn't hide the end of a line.** At some window widths the end of a snippet's first line
  ran under its ⋯ button. That line now leaves the button room.
- **Production Information's scroll button doesn't cover the report.** The button that pages the report
  sat over it and could hide a table's headings, such as Written. It now has its own space under the report.
- **A jump into a scene you haven't opened yet lands on its line.** Edit in the clash resolver, a search result,
  or a problem in a scene opened for the first time that session could stop part-way down the page, because
  the blocks above hadn't been drawn yet. It now settles on the line.
- **Status badges and Settings' buttons aren't cut off in a small window.** With Review ▸ Line Status on, the
  pills beside the lines were cut off at the editor's left edge in a narrow window; the margin now makes room
  for the widest one showing. A long status name in the inspector ends in an ellipsis instead of running past
  a narrow inspector's edge, and Project Settings keeps Save and Cancel in view at the smallest window height.
- **Your name is offered before a project is open.** The box asking for your name for comments and edits
  now fills in git's global user.name when no project is open, as Storyletter does. It used to come up
  empty in the installed app until a project was open.
- **The game's scopes file keeps up with the project.** Where the game shares its scopes, `patter.scopes.json`
  is now brought up to date with every change to the project file (a pack merge, a new or deleted scene, the
  cast, a quick fix, and an undo or redo of any of them), not only when Project Settings are saved, as
  Storyletter does with its own.
- **A deleted jump target says so.** A jump or condition whose scene or block has been deleted reads
  "Missing scene" or "Missing block" in red, on the page and in the inspector, with the old id in its
  tooltip, instead of showing the raw id.
- **A scene changed outside Patterpad is no longer overwritten.** If a scene's files changed on disk after
  Patterpad read them (a pull in a terminal, a synced folder, another app), the next save used to write the
  editor's copy over them. Now the save is refused, the scene is read again so you see the change, and a
  message asks you to check your last edit is still there. Reopening a scene also reads it from disk if it has
  changed, rather than showing the copy Patterpad had in memory.
- **A comment appears as soon as you post it.** A reply posted with the Reply button didn't show until the comment
  popover was closed and opened again, and a second post on a new comment started a second thread. The popover
  now shows each thread as it stands after every change.
- **Restart plays what the editor shows.** Restarting the play window straight after an edit could play the
  script from before it until the edit was saved: an edit in a scene the run had jumped into showed live, then
  went back to the saved copy on Restart, and an edit made just before Restart could be missed. The editor's
  text is now written before every run starts, and Restart plays the latest edit in whichever scene it's in.
- **A coverage run includes the edit you've just made.** Running coverage straight after fixing what a row
  reported could sweep the script from before the fix, so the row stayed in the table. The editor's text is
  now written before the sweep starts.

## [0.39.0] - 2026-10-22

### Added

- **Extension views.** An extension can now bring views of its own, such as a timeline of a scene's lines,
  which open in a floating window beside the script and work on the scene you have open, unsaved changes
  included. The views the project offers are listed at the foot of the Window menu. A view follows what you
  select in the script, takes the editor's theme, and selects a line in the script when you pick it there. A
  change made in a view is one undo step, named after what the view did ("Undo Set shot" in the Edit menu), and
  Cmd+Z in a view's window undoes it. A view changes only the scene that's open, and shows read-only on a scene
  somebody else holds. A view can play a line's recording, through the same player as the inspector's play
  button, in Audio Folders mode. A view's window has the same title bar as the tool windows, with a pin that
  stays as you left it, and Escape closes it. A view keeps its own preferences across a restart.
- **File ▸ Extensions…** opens a tool window listing every extension the project takes or this machine has
  installed: the version the project uses, its views, and each version installed here. You can stay in it while
  you work, and it follows the project you have open.
  - **Add Extension…** takes an extension into the project from its package, a folder or an npm package
    tarball: it adds the extension's manifest and version to the project, as one step you can undo, and
    installs its views on this machine. It's the one way in, whoever you are: for an extension the project
    already takes, it installs the views on this machine, and offers to update the project when the package is
    newer (with any stages that version renamed renamed in your data). An older package never takes the project
    back. An extension that needs another the project doesn't take asks for that one's package too, and adds
    both as one step. A package with a fault in its manifest is refused, with what's wrong.
  - **Update…** asks for an extension's package and says what will happen before doing it. A newer version
    says what changes (fields gained or lost, views, what it newly needs), and is taken as one undo step and
    installed. The same version reinstalls the views, and takes the package's manifest into the project too if
    it differs from the project's copy. An older version, or another extension's package, is refused.
  - **Remove from Project…** stops the project taking an extension, as one undo step. It asks first, saying how
    many nodes carry the extension's data, and keeps that data, so adding the extension back restores it. An
    extension another one needs can't be removed first.
  - **Uninstall** removes one installed version of an extension's views from this machine, after asking. Its
    open view windows close; uninstalling the last version also clears its views' saved preferences.
- **Views not installed here.** On a machine without an extension's views, the Window menu lists each view as
  "(not installed)…" with the reason, and choosing it opens the Extensions window on that extension, where
  Install on This Machine… installs the views without changing the project. A view whose installed version
  differs from the project's says so in its window's title, and still opens while the major version matches.
- **A view as a field's editor.** An extension can name one of its views as the editor of a field holding a
  list of records by name. Its Edit button in the inspector then opens that view on the node, and the Fields
  window leaves the field out; until the view is installed here, Edit opens the Fields window as before.
- **Missing extensions said.** An extension that needs another the project doesn't take is warned of in the
  problems bar, and its views are told, so they can say so rather than show something misleading.
- **Increase Contrast.** With macOS's Increase Contrast turned on, grey text and dividing lines darken in
  every palette, so they're easier to read.

### Changed

- **Easier-to-read grey text.** Secondary text in Paper, Mist, and Night, and warnings in the light palettes,
  are darker or brighter so they meet the usual contrast guideline for text, and placeholder text in fields is
  no longer faded further.

### Removed

- **Extensions no longer present a project's Game Data fields.** An extension used to be able to draw one of
  your Game Data fields with its own label, help, and choices, through a setting naming the field. Extensions
  now keep their values in fields of their own, so a Game Data field is always drawn as the project declares
  it, and an extension's section of Project Settings no longer lists settings. A project file that still gives
  an extension settings opens as before: they're ignored, the problems bar says so, and saving the project
  file keeps them until you delete them.

### Fixed

- **Checkboxes and other native controls follow the palette you pick**, not the system's light or dark mode: a
  dark palette on a light system no longer draws bright white boxes, nor a light palette dark ones.

## [0.38.0] - 2026-10-20

### Added

- **The Fields window, for a field too big for the inspector.** An extension field that holds a set of
  records, one per character say (Pattershot's performance: a look, an expression, and a gesture for each
  character on a line), now shows in the inspector as a line per character, such as "TAM: smile, nod", with an
  Edit button. Edit opens the Fields window: a grid with a row per character and a column for each part, the
  same choices as the inspector offers, a menu to add a character and a button to remove one. The window
  follows what you select in the script, so you can work down a scene without opening and closing it; turn off
  Follow selection to keep it on one line. Each change is one undo step in the script, as in the inspector, and
  a scene somebody else holds shows read-only.

### Changed

- **An extension's fields fold to the ones a node sets.** In the inspector, each extension's section now shows
  only the fields the node sets, so an extension you leave alone on most nodes stays out of the way. Click its
  name to see every field; the caption counts what's set, as "Pattershot (3 set)". A section stays open or folded
  as you left it while you move between nodes, and a value you clear keeps its row until you move on. Project
  Settings still shows every field. The fold works on a scene somebody else holds, too.

## [0.37.0] - 2026-10-19

### Added

- **Pick fields for extensions.** An extension can declare a field whose value is one choice from a mix of
  sources: fixed words, the cast, and lists on the extension's own Project Settings section (points of interest,
  say). The inspector offers them in one menu, "auto" first, each source under its name. A value no source holds
  is kept and marked missing, and a name two sources hold (a character and a point of interest both called Gate)
  is flagged. Renaming a cast member rewrites the values naming them.
- **Find by Field.** The Find window has a Field tab, and the Review menu a Find by Field… item. Type a Game
  Data field, such as `mood`, to list every node that has it with the value it holds, or narrow it with
  `mood = tense` or `mood != calm`. A node that sets nothing holds the field's default, which the row marks.
  Storyletter's Find has the same tab and reads a query the same way (family parity item 16).
- **Replace covers Game Data text.** Replace now finds and rewrites the values nodes set for text and multiline
  Game Data fields, as well as dialogue, text, and choice text. Each such row names its field, and its own
  Replace button changes just that value. Other field types and a field's default are left alone. Storyletter's
  Replace covers its field values the same way (family parity item 16).

### Changed

- **One Live Link server for the family.** Patterpad's Live Link now runs on the same server as Storyletter's,
  from the shared editor shell, with Patterpad's own handling of what the game sends plugged in (family parity
  item 14). Two things change: after a save is pushed to the game, the chip shows a different build until the
  game confirms it has the new one, and if the port is taken the link stays off, so the next click tries again.
- **Version-control files come from the family's shared setup.** Switching a project's version control writes
  its ignore and attributes files from the same module Storyletter uses (family parity item V). Every pattern and
  rule is unchanged; the wording is tidied and the rows line up.

## [0.36.0] - 2026-10-19

### Changed

- **Merges keep your order and your comments.** A merge (Merge Returned Patterpack, or the structured merge your
  version control runs) put the cast, the properties and the Game Data fields back in name order, undoing Move up
  and Move down; they now keep your order, and two different reorders of one list are a conflict. Two replies to
  one comment thread both survive, an edit to a message or a moved anchor is no longer lost, and two people tagging
  one line no longer clash. The family's shared merge rules, as Storyletter has them.

### Fixed

- **Show Card in Storyletter names the scene by its address.** It named a scene whose internal id was a legal Game
  ID by that id, but a card finds its scene by address first, so where that id was another scene's address the
  card landed on the other scene. The address always lands on this one (family parity item 1).

## [0.35.0] - 2026-10-19

### Added

- **Action text.** A new setting on Project Settings' Language tab, "Localise text lines in dialogue scenes", off
  by default. While it's off, a text line in a scene where characters speak is action: a direction for whoever
  stages the scene. It isn't translated or shown to the player. The writing surface sets it apart in a muted
  italic, Play shows it as a direction that takes only its pause, the report counts it apart from the lines the
  player reads, and the Localisation dialog says how many text lines an export left out as action, and why, and
  lists any that have dropped out of the loc files or come into them. A project whose players see that text should
  turn the setting on.

### Changed

- Text lines are called text, not narration, throughout: narration is a spoken line with a narrator.

## [0.34.0] - 2026-10-18

### Changed

- **An extension's claim can take a game data field's own choices.** When an extension presents a game data
  field without listing its choices, the inspector shows the field's own, with the extension's label, help, and
  value help, and checks the value against them. A value the field doesn't offer is flagged as before.

## [0.33.0] - 2026-10-18

### Added

- **Everything Patterpad does can be undone.** Edit ▸ Undo takes back a Project Settings save (its renames
  included), a change on the Properties page, Replace, a new or deleted scene, a merged Patterpack, an imported
  editable script or translation, an accepted or rejected suggestion, shared scopes, the addresses Publish
  Bundle pins, a quick fix, the scene order, the start point, dictionary words, and writing status, recording
  status, re-record flags, and notes. They undo in the order you made them, mixed in with your edits to the
  script, and the Edit menu says what's next ("Undo Replace"). On the Properties page, Undo takes back the
  page's last change. If a file has changed since (a pull, or another app), Undo says which and stops rather
  than overwrite that work; if someone else has a file locked, it says who, and you can try again later.
  Comments and the suggestions you post aren't undone: they're a conversation.
- **Renaming a cast member renames them everywhere.** Change a name in Project Settings ▸ Cast, and every line
  they speak, their translated name and labels, and any extension data keyed by them or naming them follow it,
  in the same save. Before, their lines kept the old name and showed as a speaker who isn't in the cast.
- **Patter extensions in the inspector and Project Settings.** When a project takes an extension, its fields
  show in the inspector under the extension's name, after Game Data, for a line, text, game event, snippet,
  option, block, and scene: text, numbers, choices, flags, stages, references to other lines or scenes, and
  records, maps, and lists. Each shows its help, and a choice says what the picked value means. The project's
  own values have a section of their own in Project Settings, saved and undone with the rest of the settings,
  and it says which version the project takes and which game data field each setting names. A game data
  field an extension claims shows the extension's label and help, and says when its value isn't one the
  extension knows. Where someone else has an extension's data locked, its fields say who and can't be edited.
  Problems show under the field they're about, and Go to issue opens the extension's settings for a problem
  with the project's own values. A bubble whose extension data would be lost by merging it into the one above
  isn't merged, as one with a condition isn't: move or clear its data first.
- **The problems bar shows a project's extension problems**, under Extensions: a value an extension's manifest
  won't take, a claim on a game data field of another type, an entry for something that's gone, or a missing
  manifest.
- **A project's Patter extension data travels with it.** Deleting a scene deletes its extension data too, and
  a pack carries the project's extension manifests and data.
- **An unresolved merge stays marked when you edit the scene.** A merge that left a clash marks the files it
  touched, and saving the scene keeps that mark, so the clash can't be committed by accident.
- **An option has Game Data fields of its own.** Project Settings ▸ Game Data has an Option tab, and an
  option's fields are edited in the inspector like a line's, instead of shown read-only. A key no field
  declares, such as the Storyletter pairing's `outcome`, still shows as it stands.

### Changed

- **A game data value commits as you type**, as every other field in the family does, and Esc puts back what it
  held. The inspector keeps your place as it redraws. Each field's purpose shows under its control instead of
  in a rollover, Flags are picked from the declared values instead of typed with commas, and a Text (multiline)
  field is a text area.
- **Project Settings ▸ Game Data is the same declaration list as World properties and Storyletter's Card
  template**: name, type, default, values or stages, and purpose in one row each, with the same controls. A
  field name is still any name you like.

### Fixed

- **Changing a qualifier's Game ID and renaming a game data stage in one Project Settings save works.** When
  both touched the same scene, the save failed.
- **Undo undoes what you're looking at.** Edit ▸ Undo in the Search, Coverage or Play window undoes that
  window's own typing, and in Project Settings, a dialog, or on the Properties page it undoes the field you're
  in. Before, each of these undid the scene behind them, and on the Properties page that change wasn't saved.
  From the overview, Undo goes back to the scene and undoes there.

### Security

- **Every window carries a content security policy and stays on its own page**: a window no longer navigates
  away, opens another window or attaches a web view.

## [0.32.0] - 2026-10-18

### Added

- **Game data takes Flags and Quality.** Project Settings ▸ Game Data offers the family's seven field types,
  with a quality's stages declared in order. A stage renamed in place carries every node's value that names it,
  in the same save. In the inspector a quality value shows as its ladder, the current stage marked; unset, it
  says what it falls back to, "default (x)", and a click clears an override.
- **Game data values are checked.** A value that doesn't fit its field shows in the problems bar, and one left
  on a deleted stage offers the stages to choose from.
- **A blank default names its fallback**: "default (False)", "default (calm)", "default (first stage)" on every
  property and field list, from the shared shell. A default is optional, and the type's holds.

### Changed

- World properties take the shell's one type list, and a reorder of a quality's stages says how many gates it
  changes in the family's one wording.
- Play runs on Patterplay 0.28.0: a save holding a stage or value its scene no longer has goes back to the
  default as it loads, with a warning, instead of reaching the first gate that orders it.

## [0.31.0] - 2026-10-17

### Added

- **Rename a quality's stage in place.** Click a stage's name on its chip to rename it. Every condition and
  effect that names the stage follows, across the project (or within the scene, for a scene property), and so
  does the default. A condition that uses the same word for another quality is left as it was.
- **Reordering stages says what it changes.** Moving a stage changes what every "at this stage or past it"
  condition means, though no value moves, so the stages now say how many conditions order that quality.
- **A quality's declaration is checked by the family's shared rule,** so Patterpad and Storyletter agree about
  it: at least two stages, none empty, none twice, and a default on the ladder. The messages are as before.

### Changed

- **Built with Patterplay 0.27.0**, the runtime the Play window and playable exports use.

## [0.30.1] - 2026-10-17

### Changed

- **Built with Patterplay 0.26.1**, the runtime the Play window and playable exports use. Nothing changes in
  the editor itself.

## [0.30.0] - 2026-10-14

### Added

- **Live Link follows the most recent flow.** When a game runs several flows at once (a conversation, a
  bark, ambient chatter), the editor now moves to whichever one played last. Pick a flow in the flow picker
  to stay on it instead; choose **Most recent** to go back. A picked flow holds until it ends.
- **A readable flow picker.** Flows are grouped by the part of their name before the first slash
  (`patterstage/`, `menu/`), with the full name in the tooltip, and each shows the scene it's in.
- **The option a game took is marked.** When the game reports a choice made, the playhead moves onto that
  option's prompt and leaves its dot there as play moves on, as it does for every line the game passes.

### Fixed

- **When the followed flow ends, the editor shows where the next one is at once.** It used to stay where the
  ended flow left it until the next flow played another line.

## [0.29.0] - 2026-10-14

### Added

- **How a qualified speaker is shown.** A game shows `PLAYER (V.O.)` as the display name and the qualifier
  together, through the project's **Speaker pattern** (`{name} ({qualifier})`), now under Project Settings ▸
  Qualifiers. To label one character's version differently, expand the character on the Cast tab and type in
  its **Shown with V.O.** field ("Your thoughts"); a field appears for each qualifier that character's lines
  use, and one whose lines are gone is marked so you can clear it. Translators get the pattern and these labels
  with the display names, and the Play window shows what the game will.

### Fixed

- **Changing a display name or a qualifier's name in Project Settings now marks its translations stale.** So
  do changes to the speaker pattern and a character's own speaker label: each shows as stale on the next
  localisation export, as a changed line does, so translators know to check it. Changing a qualifier's Game ID
  alone doesn't, since the text is the same.

## [0.28.1] - 2026-10-11

### Fixed

- **Literata, Source Serif, and Courier come through in every window.** Choosing one under View ▸ Font
  Theme showed Georgia, or whatever the computer had, because Patterpad never loaded those faces. Every
  window now loads every face in the set, so the play, search, and coverage windows follow the theme too.

### Changed

- **The readable-script PDF** draws Greek, Cyrillic, arrows, and maths from Noto Sans and Noto Sans Math
  instead of DejaVu Sans, so its fallbacks are one family. The fonts now come from their makers' npm
  packages rather than copies kept in Patter.

## [0.28.0] - 2026-10-10

### Added

- **Line padding.** Set the pause after a line in its inspector, under Pad after, in seconds. Below zero,
  the next line cuts in before this one ends. An empty field shows the pause the line takes instead and
  where it comes from. A snippet, group, block, or scene can set a Default pad for the lines inside it, and
  the project sets one under General in Project Settings (0.6 seconds unless you change it). An option's
  prompt has one too, which times the reply.
- **A line that ends its snippet can't be cut in on,** because what follows isn't certain until the story
  gets there. Its field starts at zero, and if a line ends up there with a negative pause after a move or
  a merge, the problems bar says so straight away.
- **Play times a scene the way the game will.** Continue holds each line for the length of its recording,
  or for an estimate of its reading time when there's no recording, then waits its pause. A cut-in line
  arrives while the one before is still playing, and with audio on you hear the two overlap. The choices
  appear as the last line before them starts, while it's still playing, and The End once every line has
  finished. Speed is now Half, Normal, Double, or Instant, speeds up or slows down the whole timing, and
  takes effect as soon as you change it. Step still moves on only when you ask.
- **Publish Playable HTML times a scene the same way.** The page holds each line for an estimate of its
  reading time, then waits its pause, so a cut-in arrives before the line it cuts into has finished, and
  its choices and its end come when Play's do. Its Speed control is now Half, Normal, Double, or Instant
  too.

## [0.27.0] - 2026-10-10

### Added

- **Speaker qualifiers.** A line can say how it's delivered as well as who says it: `TAM (O.S.)`,
  `PLAYER (V.O.)`, `GUARD (RADIO)`. Pick one from the Qualifier list in the line's inspector, or press
  Shift+Cmd+E (Shift+Ctrl+E on Windows and Linux) to step through them; the cue shows it after the name,
  and Play does too. A new line takes the qualifier of the same character's last line, so a run of
  thoughts or a radio exchange needs one pick. TAM and TAM (O.S.) are still one character in the cast,
  the counts, and the report.
- **A Qualifiers tab in Project Settings.** Add, rename, reorder, and describe them, or start from a
  screenplay set or a game set. Changing a qualifier's Game ID updates every line that uses it.
- **Find Lines by Qualifier** in the Review menu, and a Qualifier tab in the search window. A line whose
  qualifier has been removed from the list shows in the problems bar, with a fix that picks another.

### Fixed

- **Plastic SCM: saving after the first checkout, again.** 0.26.1 still refused the second save of a file as
  "locked": it misread what Plastic reports about a checked-out file, so it tried to check the file out on
  every save. It now reads Plastic's report correctly, checks a file out once, and saves it freely after that.
- **Right-clicking a speaker's name** opens the context menu and nothing else. The character picker used
  to open behind it.
- **Clicking the colon after a speaker's name** selects the speaker, as clicking the name does. It used to
  leave the cursor where it was, so the next thing you typed could land somewhere else in the scene.

## [0.26.1] - 2026-10-10

### Fixed

- **Plastic SCM: saving after the first checkout.** In a workspace that keeps files read-only, the first save
  checked a file out and every save after it was refused as "locked" by your own checkout. Patterpad now sees
  the file is already checked out and saves it, and an unchanged file is properly checked out on its first save.

## [0.26.0] - 2026-10-07

### Security

- **Live Link refuses web pages.** While Live Link was on, a web page open in any browser could connect to it
  and receive your story each time you saved. It now lets in only games and pages running on your own machine.
- **Opening a patterpack writes only the project.** A pack could carry other files, `.git/config` among them,
  and version control would then run what that file names. Patterpad now writes only scenes, strings,
  authoring, the project file, the game's scopes, and handoff records, and refuses a pack with a hidden file
  or folder in it.
- **Only the editor window can reach the editor's controls.** The play, search, and coverage windows each get
  their own controls and nothing else, and removing a dictionary checks it is one you imported.
- **Importing a translation can't write outside the project.** A file naming a scene the project doesn't
  have, or a language it doesn't declare, is refused and nothing is written.

### Fixed

- **Merging a returned patterpack no longer undoes itself.** The open scene kept its text from before the
  merge, and the next save wrote it back over what had just merged; the scene now reloads, and anything you
  hadn't saved is saved first. Close Project afterwards closes the project, as it does after New Project.
- **Deleting a scene that version control won't let go of says so,** and leaves the scene whole, rather than
  reporting it deleted with its strings left behind.
- **A save that is refused says so.** Project Settings, Notes, comments, suggestions, a new or deleted scene,
  and a quick fix only reported a refusal (a file locked in version control) to the developer console, and
  Project Settings closed with your edits gone; it now stays open with them in it.
- **Back and Forward stay within the project you're in,** rather than leading into places from the last one.
- **Ticking Needs re-record opens Notes on the VO note,** where the reason travels with the voice script.
- **Following a run in the editor no longer shows the scene twice,** with typing in one copy never saved.
- **A scene with no strings file of its own saves what you type** into a new one, rather than reporting the
  save done and keeping nothing.
- **Live Link stops when you close the project,** and Play ▸ Live Link can't start it with nothing open.
- **Esc leaves Writing View,** as the docs said it did, and closing the project leaves it too.
- **The problems bar keeps your place** as you type, rather than going back to the first problem, and both
  bottom bars come back after you visit the overview or the Properties page.
- **Review Feedback finds the project's feedback from the Properties page,** rather than saying there is none.
- **Quality properties keep their stages in the condition editor** after you save the settings.
- **The Scene properties dialog refuses two properties with one name,** as the other property editors do.
- **The search window's Replace preview is the new project's** after you open another one.
- **Publish ▸ Update Audio Manifest is available only under Audio Folders,** the one case it can work in.
- **Coverage Test marks a Runs or Max steps value it can't use** and holds Run, rather than quietly running
  5,000.
- **Editing keeps what it should.** Setting a jump on a bubble holding only a game event kept the jump and
  deleted the event; it keeps both now. A new option's choice text survives clicking into the inspector.
  Bold and italic survive joining lines and switching a line between dialogue and narration.
- **An edit that would lose a condition, effects, a jump, or a whole choice is refused,** with a note saying
  what to move first. Joining two bubbles, deleting across them, and typing or pasting over a selection
  used to drop the second bubble's logic without a word.
- **Paste works.** Several paragraphs become lines of their own, a copied dialogue line pastes as its words
  without the speaker, a copy across lines no longer fails, and a paste from Google Docs is no longer all
  bold.
- **Backspace on a selected block heading asks before deleting the block,** as its menu does, and the last
  block of a scene can't be deleted.
- **A locked scene can't be changed through the editor's menus, grips, or add buttons,** as it already
  couldn't by typing.
- **Smaller editing fixes:** ungrouping a choice leaves plain groups without choice text; Wrap in is not
  offered for options; right-clicking a choice's text opens the option's menu; Delete at the end of a line
  joins the next line to it rather than removing it; Enter replaces a selection; a duplicated fallback option
  is no longer a second fallback; Esc in the scene title or a block's name puts back what was there, and the
  title follows Undo; Tab stays in the editor; a speaker's name can be typed with an input method.
- **Typing in a long scene with spell-check on is quicker:** only the lines you change are checked again.
- **Publish Bundle and Auto Rebuild refuse a project with errors in it,** listing them, rather than building a
  bundle the game then fails on. Auto Rebuild keeps the last good build until the errors are fixed, which is
  what it always meant to do, and Live Link no longer pushes a broken build to a running game.
- **Merging a returned patterpack keeps comment replies and resolves from both sides,** and never brings back a
  scene you deleted after sending it.
- **Replace makes the translations of the lines it changed out of date,** as typing the change does.
- **A choice that can run dry is a warning everywhere,** and no longer hides the "can never run" warnings.
- **Two strings files that disagree about a line are reported,** naming both, rather than stopping the checks.
- **Switching version control keeps a project's choice to leave the bundle out of it.**
- **The production report counts a writing status that isn't on the ladder as the lowest rung** in its
  totals, as it already did for each scene's status.
- **The voice script includes spoken choice prompts,** so they get recorded.
- **A loop of jumps with nothing in between is a warning,** in the writer's words, rather than a run that never ends.
- **Coverage Test no longer blames a write that ran,** follows gated jumps for both its "may need an input"
  hint and its "written only by" line (saying when the gate is on the way in), and leaves out empty lines
  that never ship.
- **Quitting or closing the window straight after typing no longer loses the last edit.** Patterpad saves a
  moment after you stop typing, and a quit inside that moment used to close without saving. It now finishes
  writing first. Leaving the window for another app also saves.
- **A recent project that won't open says why.** The welcome screen now gives the reason. A project
  whose folder has gone is taken off the recent list as before; one that is still there but won't open (a
  conflict in its project file, say) stays on the list so you can try again once it is fixed. The same goes
  for the last project, when it can't be reopened at launch.
- **Esc in an inspector field puts back what was there.** Typing a game data value or a tag and pressing Esc
  restores the value the field had when you clicked into it, as Storyletter's fields do. A half-typed tag is
  dropped rather than added when you click away.
- **Help ▸ PatterKit Documentation Home** is named for the suite. It said "Patter".
- **The About box says "licence"**, in UK English like the rest of Patterpad.
- **Pressing Enter at Merge Returned Patterpack's confirmation cancels.** It used to merge. The confirmation
  now uses Patterpad's own dialog, matching its other confirmations, with Cancel selected to begin with.
  A pack with nothing to merge now says so in a message rather than a system dialog.

### Changed

- **An error in the problems bar is shown in red,** and a warning in the warning colour, as Storyletter shows
  them, so the colour says how serious the problem in view is.
- **Publish Bundle writes the same files as `patter export`,** which now uses the same `patter-dist/` folder
  beside the project. Auto Rebuild also brings the game's shared scopes file up to date.
- **Patterpad always saves as you work,** a moment after you stop typing, as Storyletter does. The Autosave
  setting is gone: turned off, it only stopped the timer, and every scene switch, play, and window change
  still saved.
- **Auto Rebuild is your own setting,** kept with Patterpad rather than in the project file, so turning it on
  no longer turns it on for everyone on the project. It's on the Publish menu, as in Storyletter.
- **Share Scopes with Other Tools goes straight to choosing the folder,** as Storyletter's does.
- **One name for each thing:** the setting for where Publish Bundle writes is **Bundle path** in both Project
  Settings and New Project; the audio tab is **Recording status**, the Review menu's submenu **Writing
  Status**, the Coverage window's button **Run coverage**, and its drivers **coverage drivers**; Game Data is
  capitalised as the feature's name.
- **The health chip's clean answer names the project,** since it checks the whole project, and the
  version-control chip's tip names the system.
- **Save As and Open an Example add their copy to version control** when it lands in a working copy, as
  opening a patterpack does.
- **Project Settings rows look like Storyletter's:** the caption to the left, the control beside it, and any
  explanation underneath. The Notes editor is the family's too, and Notes now saves when you close it.
- **Smaller wording fixes** to confirmations ("You can't undo this."), tooltips, and messages, following the
  family's house style, and the topbar Play button is the family's button.
- **The Live Link control says "Live Link"** beside its plug icon in the bottom corner, as Storyletter's does.
- **The welcome screen offers a kit to start from,** above the finished projects, as Storyletter's does.
  Clicking it opens New Project with that kit chosen.
- **Menu items that need a project are greyed out when none is open,** Save, Play, Publish and Find among
  them, as they are in Storyletter. Some already were; now they all are.
- **The Play window's head button is called Restart,** the same word as the button at the end of a run. Its
  tip used to say "Rewind to the start and play again".
- **Smaller wording fixes.** The example tiles in New Project say "Open a copy…", since a folder picker
  follows. Replace's confirmation says it can't be undone from the Edit menu. The review bar's Previous and
  Next tips show their keys (⇧F8 and F8).
- **Reload and Toggle Developer Tools are gone from the View menu in released builds.** They are for
  working on Patterpad itself.
- **The last system message boxes now use Patterpad's own dialogs:** an example that could not be opened,
  Share Scopes with Other Tools, a Patterpack that could not be unpacked or whose folder already exists, and
  the prompt to find Storyletter. They follow the app's theme, and their buttons are in the same order as its
  other dialogs.
- **"Can't delete this scene" has an OK button.** It had a lone Cancel.
- **Six more dialogs match the rest:** Scene Properties, Notes, Export Voice Script, Localisation, Production
  Information, and "Where does your story start?". They now share the frame, title and button style of
  Patterpad's other dialogs.

## [0.25.0] - 2026-10-06

### Security

- **The editor's text library is updated** (prosemirror-view 1.42.6), fixing a cross-site scripting flaw in how it
  handled pasted content.

### Changed

- **The Play window marks a condition or effect that failed.** Patterplay now plays on past one (a failing
  condition counts as false, and a failing effect is skipped) instead of stopping, so the Play window shows
  each as a warning line in the transcript, where it happened, rather than ending the run with an error.
- **The Coverage window lists conditions and effects that failed**, with the scene, the error, and how many
  runs hit it. Click one to jump to it.
- **A choice whose every option is greyed out no longer stops play.** It runs dry, as a choice with no options
  does: the fallback plays if there is one, otherwise play moves on.

### Fixed

- **"+ Add group" asks for the group's first two conditions.** It used to insert a group starting with a
  condition you hadn't chosen and an empty second half, which the problems list then flagged. Now you pick
  both conditions through the usual condition menu, and the group is added only once both are chosen.
- **The Play button stays in the title bar after the Properties page.** Opening a scene from the navigator
  while the Properties page was showing left the title bar without Play or the problems count until the
  project was reopened.
- **The Coverage window no longer reports "0 stalled at a choice".** A run can't stall any more, since a choice
  with nothing to pick now runs dry and play moves on, so the count is shown only if one ever does.
- **A new option starts with its choice text.** Adding an option to a choice put the caret on the option's
  first line, under a choice text not yet written. It now lands in the choice text, as a new choice's first
  option always has, and the line below follows.
- **New Project opens at its full width again** (`@wildwinter/app-shell` 0.46.4). It had opened narrow, at the
  width of an ordinary dialog, since the Search window's Replace confirm arrived.
- **No stray "Replaced across the project".** Reimporting an editable script, and accepting or rejecting
  suggestions, also showed the message that belongs to Replace. Now only Replace says it.
- **The inspector's Jump row names the destination.** Right after opening a project, a jump to another scene
  could show that scene's internal id instead of its name until the caret moved. It now shows the name as
  soon as the project has finished loading, as do condition pills that name another scene.

## [0.24.1] - 2026-10-04

### Fixed

- **Opening a scene no longer pops up the character picker.** When a scene, or a block or bubble picked
  from the navigator, began with a dialogue line, the caret landed on the speaker's name and the cast
  picker opened at once, which got in the way of simply reading through a project. The caret now rests
  at the start of that line's spoken text, and the picker opens only when you go to the name.

## [0.24.0] - 2026-10-03

### Added

- **Send the script to an editor who doesn't use Patter, and bring their changes back.**
  **Review ▸ Export Editable Script…** writes a Word document of one scene or the whole project that
  reads like the readable script, with the words of every line in a shaded box. The editor changes the
  words in Word, Google Docs, OnlyOffice, or Pages (with or without Track Changes) and leaves comments as they normally
  would. **Review ▸ Reimport Editable Script…** shows what came back before writing anything, then brings
  each change in as a suggestion (new words, a new speaker or direction, or a cut), credited to whoever
  made it, and each comment as a comment on its line. Nothing in the script changes until you accept.
  Anything that can't be a suggestion arrives as a comment quoting the editor's words, so nothing they
  wrote is lost.
- **Review suggestions in bulk.** **Review ▸ Review Suggestions…** opens a **Suggestions** tab in the
  search window: every open suggestion, by handoff, with Accept and Reject on each and **Accept all clean**
  for the ones that still apply.
- **An Editors notes class**, for notes meant for whoever edits the script; they ride along in the
  editable script.

### Fixed

- **Confirmations in the search window are styled.** Replace all's confirmation drew without its frame.

## [0.22.5] - 2026-10-02

### Fixed

- **Update prompts come to the front.** Check for Updates, and the prompt that says an update is ready,
  opened in the main window even when the Play window or another pinned window was covering it, so the
  editor dimmed behind a prompt you could not see. The main window now comes forward, above pinned
  windows, until you answer, and the pins go back afterwards. A prompt that arrives while Patterpad is in the
  background waits until you come back to it. The "Update ready to install" prompt starts on Later, so a
  key pressed for the window it covered cannot restart Patterpad by accident.

## [0.22.4] - 2026-10-02

### Fixed

- **Spelling mistakes stay underlined in Writing View.** Writing View hid the spell-check squiggles along
  with the rest of the editor's markings, so a typo went unmarked until you left it. Misspellings now show
  in Writing View too; the structural problem markers still step aside with the problems bar.

## [0.22.3] - 2026-09-30

### Security

- **Electron 42.11.10.** Patterpad runs on the latest Electron 42 release, which fixes several security
  problems in how Electron keeps windows and web content apart. Nothing else changes.

## [0.23.0] - 2026-09-30

### Added

- **Two worked examples ship inside Patterpad**: the Interactive Tour, and **The Night Ferry**, a new short story (one crossing of a dark river, in conversation with the ferryman). The welcome screen shows them as tiles under Learn from a finished project, New Project offers them as its second shelf, and **Help ▸ Open an Example**, first in Help, reaches them from inside a project. Each opens as your own copy, in a folder you choose, as Storyletter's examples do. The welcome's link to the download page for the Tour is gone, since the Tour is now in the app.

## [0.22.2] - 2026-09-29

### Changed

- **The Coverage window is easier to read, and leads with what it reached least.** The table's columns
  now have headings, **Runs reached** and **Times played**, and the line under the numbers says in words
  how the runs ended. The table opens **least reached first**, so the beats worth a look come first; a
  switch puts it back in script order, and the window remembers your choice. Beats that played, but in
  fewer than 5% of runs, are tagged **Rare** and counted at the top.

## [0.22.1] - 2026-09-28

### Fixed

- **Buttons in a dialog over the welcome screen work.** On a first run, clicking Continue in the
  "Welcome to Patterpad" step did nothing, and neither did Close in the About box; Enter and Escape
  worked. The welcome screen lets you drag the window from anywhere on it, and those clicks were
  being taken as the start of a drag. Dialogs, menus and popups are no longer part of that area,
  wherever they open.

  **Updating from an earlier version:** the prompt that brings you this release still has the
  problem, if it opens over the welcome screen. If **Restart now** doesn't respond to a click, press
  Enter, or just quit Patterpad: a downloaded update installs when you quit.

## [0.22.0] - 2026-09-27

### Added

- **New Scene starts from a scene kit.** **Blank**, **Conversation with choices**, **Hub
  conversation**, **Barks** or **Cutscene**, each playing the moment it lands. Pick a tile and the
  panel says what the kit is for and what you'll see when you press Play. A kit with lines asks who
  speaks them, from your cast; if the cast is empty, the name you give is added to it.
- **New Project shows its kit as a gallery**, with what you get beside it, and the project name,
  version control and publish output in the same panel.
- **Kit tiles carry tags** naming what each kit's game has, such as *Ask in any order* or *Camera
  cues*, so they compare at a glance.

## [0.21.0] - 2026-09-26

### Added

- **Edit ▸ Show Card in Storyletter.** When a Storyletter project nearby is paired with this Patter
  project (it names it as its Patter project), the Edit menu offers the storylet card the open scene
  belongs to, and opens Storyletter at it. The first time, if Patterpad can't find Storyletter, it
  asks you to point to it once, and remembers.

### Fixed

- **Opening a scene another tool has just added lands on it.** Storyletter can now write a stub scene
  for a card into your Patter project, then open Patterpad at it. When Patterpad already had the project
  open, it looked for the scene in its open copy, didn't find it and stayed put. It now checks the
  project on disk, saves the scene you have open, and reopens the project at the new one.

## [0.20.0] - 2026-09-26

### Changed

- **Publish Bundle pins every Game ID that still follows its name.** A scene or block address comes from
  its name until you pin one, so renaming a scene after the game started using it moved the name the game
  calls. The first time a scene or block is published, its address is written down as it is, and a later
  rename leaves it alone; the toast says how many were pinned. New scenes still follow their name until
  they are published, so a scene can be called "New Scene" while you decide. Auto Rebuild, the live bundle
  push and `patter export` never pin. Storyletter does the same for its cards, decks, hands and boxes, so a
  card and the scene named after it stay paired.

### Fixed

- **Replace no longer loses its change in the scene you have open.** The open scene kept its old text after
  a project-wide Replace, and the next edit to it saved the old text back over the replacement. It now
  reloads with the replaced text.

## [0.19.1] - 2026-09-25

### Fixed

- **Share Scopes with Other Tools joins a folder another tool made, instead of replacing its
  `game.scopes.json`.** Choosing an existing shared folder the project wouldn't find by looking up (in
  another repository, say) rewrote that file with only this project's World properties, dropping every
  scope the game had there. It now keeps them all and adds only the ones the file lacks, and leaves a
  file it can't read alone.

## [0.19.0] - 2026-09-24

### Added

- **Patterpad reads the game's shared scopes.** A game can keep one `game-scopes/` folder, where each
  editing tool writes the properties it declares and reads the others'. Patterpad finds it by walking up
  from the project (or where the project's `gameScopes` names it), and then the condition and effects
  editors offer the other tools' properties by name, such as the Storylet Engine's `@story.act`, with who
  declares each in the tip. Their names, types, and read-only properties are checked, as warnings, since
  the other project may be a save behind.
- **Patterpad keeps its own file in that folder current.** Saving the project's properties, or a build,
  writes `patter.scopes.json` (the shared `@patter` properties) when it would change, and not otherwise.
- **World properties are the game's, where it shares its scopes.** The World Properties tab edits the
  game's `game.scopes.json`, re-read before each save so the scopes it doesn't show are kept, and the
  project keeps a copy so it still works packed or on its own. The tab says where they are saved.
- **File > Share Scopes with Other Tools.** Creates the game's `game-scopes/` folder (at the
  version-control root above the project, unless you choose another place) with Patter's file and a
  `game.scopes.json` holding the project's World properties.
- **The play window plays a line that names another engine's scope**, where the game shares its
  scopes: it stands that engine in, reading the defaults its file declares, and keeps doing so across a
  live refresh. So does a coverage run.
- **A Patterpack carries the game's shared scopes.** Where the project has a `game-scopes/` folder,
  Export as Patterpack puts a read-only snapshot of it in the pack, and Open Patterpack writes it into
  `game-scopes/` inside the new project folder, so the recipient's checks, pickers, and play window know
  the other tools' scopes. A project with no folder packs exactly as before, and an older pack opens as
  it always did.
- **Merge Returned Patterpack brings a World properties edit home.** The returned pack's snapshot is
  never written anywhere: your folder stays the truth. But when the recipient changed World properties,
  the merge writes the scopes they changed to your `game.scopes.json` (keeping the rest of the file), so
  your next save doesn't quietly undo their change. The confirmation and the summary after the merge
  say so.

### Changed

- **The play window's hint for `@story` points at the shared folder.** With no folder, it suggests sharing
  scopes with the Storylet Engine (or declaring `@story` under World properties); with a folder but no
  Storylets file in it, it names the missing file and how to write it.
- **Problems list the shared folder's faults**: a scopes file that won't parse or a scope two files claim
  (errors), and Patter's own file being out of date or the project's copy of a game scope differing from
  the shared file (warnings).

### Fixed

- **World properties keep each scope's token.** A scope imported under another token (`@story`) was folded
  into `@world` the next time Project Settings were saved, and every property's purpose note was dropped;
  both are kept now.

## [0.18.0] - 2026-09-24

### Added

- **World properties are pills in the condition and effects editors.** A property declared under Project
  Settings > World properties (`@world.time_of_day`, or `@story.act` imported from the Storylet Engine's
  published spec) is offered in the property picker and drawn as a pill, with its type, like any `@patter`
  property. Before, the editors did not know those scopes at all: a condition naming one could not be
  shown as pills, only as text.
- **A line can name the Storylet Engine's shared properties with no setting.** `@story.act` in a
  condition or an effect is accepted even when the project declares nothing for it, as every engine in
  the family now accepts the others' game-wide scopes. Undeclared, it is drawn as an ordinary pill with a
  tip saying another engine owns it and checks it.

### Changed

- **Patterplay 0.14.0 runs the play window**: one property registry per game, shared with the Storylet
  Engine, and the new save format.
- **The play window says why it cannot play a line that names `@story` undeclared, and how to fix it.**
  It runs Patter on its own, so it cannot supply another engine's values; the engine now refuses such a
  scene as it opens rather than quietly reading false. Declare `@story` under World properties, with the
  properties you read, and the play window backs it with their defaults.

### Fixed

- **The problems bar keeps clear of the live-link chip.** With a game connected, the chip in the bottom
  right corner was drawn over the end of the problems bar, covering a long message and, when the problem
  had one, its fix button. The chip now says how much of the corner it takes, and the bar stops short of
  it.

## [0.17.1] - 2026-09-21

### Fixed

- **A long jump list opened from `/` scrolls again.** Choosing Jump from the `/` menu opened a list that
  ran out of the bottom of its panel and could not be scrolled, so targets past the fold were out of
  reach. The Inspector's Jump row was not affected. Reported by jlafos in #75.

## [0.17.0] - 2026-09-16

### Changed

- **Every icon is drawn.** The editor, the Play window, Search, Coverage, and the settings dialog draw
  their icons from one set (Lucide, MIT licence) at one stroke weight, in place of the typed symbols
  that used to vary with the platform's font. Game events carry a drawn gear in the script and the
  Play transcript.
- **The chrome has its own scale.** The navigator, inspector, top bar, and dialogs are sized on a
  fixed 14px base, so they no longer grow with the reading size. On the default reading size they
  come out about nine percent smaller than before, matching Storyletter; the script itself is
  unchanged.
- **Section captions are words.** The tracked uppercase labels in the inspector, the script's group
  rails, the report cards, Search, and Coverage read as sentence-case labels now: Inspector, Game
  data, Choice, Option, + Block. Screenplay character cues and table column heads keep their
  uppercase.
- **Buttons have edges.** Every button reads as a button at rest, with a border or a fill, and one
  focus ring serves the whole window.
- **Dialogs share one frame.** Settings, the first-run name question, confirmations, the update
  prompt, and About sit on the same panel with the same scrim and exit. The About dialog's version
  line no longer clips under the frame.
- **Keyboard hints read true to the platform.** Tooltips and hint bars say Ctrl on Windows and Linux
  and ⌘ on macOS, and key hints are drawn as keycaps rather than typed.
- **Tooltips are all the editor's own.** The last native tooltips now use the themed one the rest of
  the app uses, and an unset value in the inspector reads "None" rather than a dash.
- **Copy tidied throughout.** Settings notes, field hints, tooltips, and problem messages are plain
  sentences in UK English; the six settings tabs are in sentence case; the problems bar names the
  scene beside each problem.
- **Escape in Find closes the window from the query box**, and the job strip shows a moving band
  while a job's size is still unknown.

## [0.16.9] - 2026-09-15

### Fixed

- **Renaming a scene updates the Scenes list straight away.** The new name showed in the scene's title
  and its jump list, but the Scenes list kept the old one until Patterpad was restarted, and so did the
  project overview, the Start scene pickers, the Delete scene dialog, and jumps to that scene seen from
  other scenes. They all follow a rename now. Reported by jlafos in #73.
- **Select All while renaming a scene selects the title, not the whole window.** With the cursor in a
  scene's title, Edit ▸ Select All (Cmd/Ctrl-A) selected everything on screen instead of the title's text.
- **The scene name beside the project name follows a rename.** Once the title scrolls out of view, the
  topbar shows the scene's name; after a rename it went on showing the old one, and clearing the title
  brought the old name back too.

## [0.16.8] - 2026-09-14

### Fixed

- **Go to definition lands on the property, not just its page.** Right-clicking a property and choosing
  Go to definition opened the page it is declared on and stopped there: on a long list the declaration
  was off screen with nothing marking it, and an enum's values stayed shut behind its row. It now brings
  that row to the middle of the page, opens its details and lights it for a moment, on the Properties
  page, the scene properties dialog and the World tab alike. Reported first in Storyletter.

## [0.16.7] - 2026-09-07

### Fixed

- **`/` ▸ Jump on an empty bubble sets the jump.** Picking a target did nothing at all, while the same
  jump set from the inspector worked. The picker takes the editor's focus when it opens, and the
  blank line the menu was raised on was tidied away on that blur, so by the time you picked there was
  no line left to turn into a jump. Blank lines are now left alone while the menu or the picker is
  open, and the pick routes the bubble it was raised in even if something else clears the line first.
  The inspector also stays on that bubble afterwards, rather than following the caret to its neighbour.
  Reported by jlafos in #63, against 0.16.6, with a screen capture that showed the line vanishing.
- **A structural menu (the bubble's ⋯, or right-click) no longer passes your click through to what it
  was covering.** Its items ran as the button went down and the menu closed under your finger, so the
  click that followed landed on the editor or the inspector behind it. Same fault as the jump list,
  same fix; this was the last place it lived.


## [0.16.6] - 2026-09-07

### Fixed

- **Setting a jump on a bubble you have just started no longer wanders off to the bubble next door.**
  An empty bubble holds no cursor, so abandoning the blank line it was started with left the caret
  homeless and the editor moved it to the nearest line, which sits in a neighbouring bubble. The
  inspector follows the caret, so clicking "+ set jump" quietly re-pointed the whole inspector at a
  bubble you had not chosen. The caret now lands on the bubble itself, which is what you are looking at.
- **Picking a jump target with the mouse no longer sets a second jump somewhere else.** The list acted
  as the button went down and closed itself, so the click that followed fell through to whatever the
  list had been covering. Where that was the inspector's own Jump row, it opened a second picker on a
  different bubble. Choosing with the arrow keys was never affected. The `/` menu had the same fault.
- **A second `/` no longer types a slash into your line.** It dismissed the menu and let the character
  through, and since the menu only opens on an empty line, that one stray slash locked the menu out of
  that line for good.
- **`/` works on a line with no character set.** The menu opened underneath the cast list, which kept
  the keyboard, so it looked as though nothing had happened.
- **Choosing a jump target with the mouse works on a bubble you have just started.** Found by
  re-testing the fixes above against the reporter's own steps: moving the mouse over the list rebuilt
  its rows, which swapped the row out from under the button as it went down, and a click needs the
  press and the release on the same row. The highlight now moves without rebuilding.
- **After you set a jump, the inspector stays on the bubble you set it on.** A bubble with no lines
  holds no cursor, so the jump landed correctly while the inspector moved to the bubble next door.
- **The `/` menu stays on screen.** Opened near the bottom of the window it ran off the edge, with most
  of its items unreachable and no way to scroll. It now flips above the line when there is no room
  below, and scrolls when there is room for neither.

- **The readable script names the blocks a condition refers to.** Publish ▸ Readable Script printed
  `‹ if not seen(blk_lcd858q2) ›` where the editor shows `‹ if not seen(Intro) ›`, because the export
  read only the quoted spelling of a node reference and Patterpad writes the bare one. Both spellings
  are the same thing, and one rule now serves the editor and the script. Reported by jlafos in #64.
- **`/` no longer opens over a performance direction.** A direction begins like an empty line as far as
  the old check was concerned, so typing a slash into one raised the insert menu instead. The hint bar
  there has always offered only ")", and it was right.
- **`/` no longer opens on a choice's own text, where one of its items destroyed that text.** An option
  prompt has no bubble around it, so Jump and Follow-with both did nothing; "Insert game event" did
  something worse, replacing the option's prompt with a new bubble and losing what you had written.
- **Choosing a target twice in a row cannot set two jumps.** The list only stopped a second click
  because the fade-out ignores the mouse; now the pick itself is once per opening.
- **The jump list follows its row when the panel behind it scrolls**, as the `/` menu already did.

  Reported by jlafos in #63; the last four came out of exercising the same area afterwards.

## [0.16.5] - 2026-09-06

### Fixed

- **The macOS build signs again, so the 0.16.4 fix below is the first one that reaches you.** 0.16.4
  was tagged and built, then stopped in the signing step: electron-builder creates its keychain with
  one password and then unlocks it with another, and the macOS build image of 2026-08-31 started
  refusing that. Its release never went live. Nothing in the app changed between the two versions.

## [0.16.4] - 2026-09-06

### Fixed

- **Coverage Test can drive a `@world` property the story is not allowed to write.** A host property
  declared `writable: false` is the story's promise never to write it, not a lock on the game that
  owns the value, and a coverage run's drivers are the game's side of exactly those properties. So a
  run over a project with one stopped on `'time_phase' is read-only`, refusing to vary the property
  it was pointed at. The rule now binds the story alone: an outcome's write is still refused, the
  compiler still refuses one at publish, and Patterpad's own tooling writes. Carries
  `@patterkit/runtime` 0.13.0 and `@patterkit/ops` 0.7.5, where the fix was made and where all four
  Patterplay runtimes took it, along with the shared kernel's explicit host authority.

## [0.16.3] - 2026-09-04

### Fixed

- **Cmd/Ctrl-A in the editor selects the field you are typing in, not the whole scene.** It selected
  the entire document and scrolled to the end of it, with nothing highlighted where you were looking.
  Now it selects a dialogue line's spoken words (never the character: that is a token the cast list
  owns), a text line's words, a direction when the caret is in one, or a choice option's prompt. On a
  game event it does nothing, since an atom holds no text. Both routes to the key are fixed: the
  editor's own shortcut and Edit ▸ Select All, which was Electron's native role and knew nothing
  about the story model, the same finding as Undo and Redo before it. Other fields, and the detached
  search window, select all of their text as they always did.
- **"Go to issue" reaches a problem in another scene.** The problems bar could only reveal a node in
  the open scene, so a problem elsewhere (an empty snippet in a scene you were not looking at, say)
  answered the click with nothing and no way to find it. Each problem now knows its scene: the bar
  names the scene up front when it is not the open one, and switches to it before revealing the node.

## [0.16.2] - 2026-09-03

### Fixed

- **A snippet that opens with a game event can take a line above it.** An option body of "game event
  and a jump" had no way in: typing with the game event (or the whole bubble) selected fell through
  to the editor's default, which replaced the selection with the letter, so the game event, or the
  bubble, vanished. Now a keystroke over a selected game event inserts a line above it and carries on
  into that line (the cast list for a dialogue line, the text for prose), a keystroke over a selected
  bubble seeds its first line the same way, Enter on a selected game event adds a line below it, and
  a bubble that opens with a game event shows a slim "+" strip on its top edge for the mouse. A
  keystroke over any other selected node (a choice, an option) no longer deletes it.

## [0.16.1] - 2026-09-03

### Fixed

- **Open Recent over an open project showed only the first scene.** The shared session opens the new
  project and then runs the close hook for the old one, and Patterpad's hook tore down whatever was
  loaded, which by then was the new project. The rest of its scenes never streamed in. The hook now
  closes only a project that is still the current one.
- **Switching projects flushes what you were typing first.** An edit still inside the autosave
  debounce was dropped when Open Recent, Open, Open Patterpack or New Project switched projects
  underneath it. The switch now waits for the outgoing project's save, Notes, comments and remembered
  place, as Close Project always did.
- **A problem about a file now names the file.** The problems bar said "This file sits outside the
  project's folders" about a file it never named, and "Go to issue" has nowhere to go for a file with
  no node in the story. Not-in-project, merge-conflict, stale-build and tidy-up problems now give the
  path relative to the project, and the not-in-project one says which folder this project would read
  it from.
- **Editing a scene for the first time no longer raises "not in project" on the file the save just
  wrote.** A project with no authoring folder yet (one generated by another tool, say) gets its
  `authoring/<scene>.patterx` created by the first save's edit trail; the save never told the in-memory
  model about that file, and the check compared disk with the model, so it flagged a file sitting
  exactly where it belongs. Two fixes: the save registers the shard it writes, and the check judges by
  folder, as the loader does, so a file that appears there by any route is in the project.

## [0.16.0] - 2026-09-01

### Changed

- **A condition comparing flags no longer depends on the order they were added.** `@f == [red, blue]`
  now matches a value built as `+blue` then `+red`, and every Patterplay runtime agrees with the editor
  about it. A flags value is a set; its stored order was an artefact of the order somebody happened to
  write the outcomes in, which nothing in Patterpad ever showed you. A condition that was quietly false
  for that reason will start passing, which is the answer it should always have given.

- **Saves your game writes can be read by the Unity, Unreal and Godot runtimes.** The random-number
  state was recorded as a signed number, so more than half of all saves carried a value the native
  runtimes rejected: Unity threw on load and the C++ one read it through undefined behaviour. Patterpad
  and the JS runtime always coped, so this never showed up here, which is exactly why it lasted. Saves
  written before this release still load everywhere.

- Under the hood, the expression language and the shared authoring pieces come from `@wildwinter/expr`
  and `@wildwinter/toolkit` rather than copies kept here. One implementation, shared with the Storylet
  Engine, so a fix lands once instead of twice.


## [0.15.0] - 2026-08-31

### Changed

- **The Windows icon script fails where the fault is, rather than a minute later somewhere else.** Off
  macOS it cannot run (the resize step is Apple's `sips`), and it used to announce a skip and exit 0. The
  committed `.ico` set is what makes that safe, so it now checks the set is actually there: quiet when it
  is, and a failure naming the missing files and the command that rebuilds them when it is not. Nothing
  was broken; this keeps it that way. Reported from the Storylet Studio side, where the same blind skip
  surfaced an hour later as electron-builder failing on a file nobody had mentioned.

### Added

- **Conditions that can never hold are reported as you type.** A snippet asking for `@connected && !@seen`
  where the only writer of `@connected` is itself gated on `@seen` is dead on the page, and no amount of
  playtesting explains why. The Problems panel now names the chain. It reasons only about one-way switches
  (a boolean only ever set true, a flag only ever `+set`) and drops any value written another way, driven
  by the game, reseeded by `temporary` or already true by default, because a wrong "this can never happen"
  is worse than silence. A warning, never an error: writing that bit next week is normal.
- **Coverage explains a dead beat that is dead at one remove.** A beat gated on a value the story does
  set, but only from a beat that never played either, used to read as perfectly wired: two dead beats,
  one cause, and nothing joining them. The row now names the gate and links the writer that would have
  to play first. A gate on a single flag is named as that flag rather than the whole property, since a
  property half the story writes always looks well fed. Where it cannot be sure, it says nothing.

### Fixed

- **A flags property with more than a handful of values no longer runs off the popover.** Choosing a
  flags property in the effects editor drew its flags as one non-wrapping row of sign x flag, which grew
  as wide as the author's data and ran past the popover and on across the window. The picker now uses the
  set/clear toggle over one column that the package's other two flag pickers already used, so all three
  behave alike. A popover too long to fit below its anchor also flips to the roomier side and scrolls
  inside a max-height, rather than sitting below with its tail off the bottom of the window. Both fixes
  are `@wildwinter/expr-editor@0.15.1`, adopted here; reported and fixed on the Storylet Studio side.
- **Three file dialogs said nothing on macOS.** macOS open panels ignore `title`, so Publish for Web,
  Import localisation and Import a Hunspell dictionary rendered a bare file browser with a button reading
  "Open" and no sentence anywhere. Each now carries the `message` and `buttonLabel` that macOS does show,
  which five of the eight open dialogs already had. A source scan holds the convention from now on.

## [0.14.0] - 2026-08-30

### Added

- **The welcome screen points at the tour.** A quiet line under Open and New: "New to Patter? Take
  the interactive tour", which opens the download page that offers it. The first screen is where
  somebody who needs teaching is standing, and it used to say nothing about the thing that teaches.

### Changed

- **Hints look like hints, and the explanations read as sentences.** Placeholder text is styled once,
  consistently, so an empty field can't read as a filled one (a tag field's hint was the exception and
  sat at full strength). And a sweep of the settings notes for words that came from the code rather
  than from writing: "debounced", "write path", "node type", and a couple of sentences contorted
  enough to say the same thing twice.

## [0.13.0] - 2026-08-29

### Added

- **Setting a flag is its own step.** Point an effect at a flags property and the value step now leads
  with **Set a flag** / **Clear a flag**, listing the flags you declared, instead of asking you to
  build the call yourself. Replacing the whole set is still there, one step further in.
- **File ▸ Close Project.** Opening a project was a one-way door: the welcome screen only appeared at
  launch, so there was no way back to it, or to the shipped tour, without quitting. Closing returns
  the window to the welcome with the project you closed at the top of the recents list, and shuts the
  Play, Search and Coverage windows, which have nothing to show once there is no project. A quit
  after closing opens on the welcome screen rather than silently reopening what you just closed.
- **The Properties page carries a version-control badge**, the way a scene row does: modified, new,
  locked by someone else, out of date. It reads the project file, which is where `@patter`
  declarations live, and it updates the moment the page saves rather than on the next poll.

### Changed

- Newly written effect targets spell the scope out (`@patter.gold` where the editor used to write
  `@gold`). Both forms mean the same thing and both compile; old scenes are untouched, and a target
  re-picked in the editor takes the longer spelling. (expr-editor 0.15.0.)

### Fixed

- **The keystroke hints go when the editor does.** The welcome screen showed "Tab → dialogue, Enter
  next line" with nothing to type into, because the bar kept whatever it last displayed. It empties
  with the editor now.
- **A pinned tool window stays where you put it.** On macOS, dragging the editor dragged every pinned
  window along with it. They keep the pin's meaning - above Patterpad while you are in Patterpad, and
  not above your other apps - without being towed around. (app-shell 0.35.1.)

## [0.12.0] - 2026-08-26

### Added

- **Back and forward.** A quiet `← →` pair at the top left retraces the documents you have visited,
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
