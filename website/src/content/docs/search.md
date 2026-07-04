---
title: Search and navigation
description: "Find any line in a Patterpad project and jump straight to it: search by text, title, or Game ID, browse lines by writing status, all from a small always-on-top search window."
---

Patterpad searches the **whole project**, every scene, not just the one you have open, and jumps you
straight to a line. Search lives in a small **floating window** that stays on top of the editor, so you
can step through matches and keep working without losing your place.

## Opening search

Press **⌘F** (macOS) / **Ctrl-F** (Windows / Linux) to open the search window. Press it again to bring
the window back to the front if it slips behind the editor.

The window floats above the editor, which stays live underneath. **Drag it by its top bar** to move it,
and the **pin** button keeps it on top. Close it with **✕** or **Escape**.

## Finding a line

<figure class="doc-shot">
  <img src="/doc-images/SearchWindow.png" alt="The floating search window over a dimmed editor: tabs for Text, Replace, Writing, Recording, Property and Tags, a query box holding choice, and a ranked list of BEAT and BLOCK results each showing its scene path and internal id." />
  <figcaption>The floating search window. Tabs across the top switch modes, Text, Replace, Writing, Recording, Property, Tags; each result shows its kind, its scene path, and its internal id, so a match is never ambiguous. <code>↑ / ↓</code> move, <code>Enter</code> jumps, and you can drag the bar to reposition the window.</figcaption>
</figure>

Type in the box and matches appear instantly. Search looks at:

- **Dialogue and narration** the words your characters say and the prose the player reads.
- **Scene and block titles**, and their **Game IDs** (the addresses your game uses).
- The internal **id** of any line. Paste an id like `L_0n7vdq42` and search finds the line it names,
  shown with its text and location. Handy when a [localisation](/production/localisation/) string, an
  [audio](/production/audio/#recording-status) filename, a coverage report, or a runtime log
  hands you an id and you need to see *which line* it is.
  (See [the two IDs](/format/gamedata-and-addressing/#the-two-ids).)

Results are **ranked around your cursor**: hits in the scene you're editing come first, starting from
where your cursor sits, then the rest of that scene, then everywhere else, so the nearest matches are at
the top.

Move through results with **↑ / ↓** and press **Enter** to jump, or **click** a result. Either way the
editor jumps to that line and **centres it**, and the search window **stays open**, so you can run
straight down a list of hits, checking each one in turn.

> Patterpad only ever shows and searches the **source language**, the language you write in. Translations
> live elsewhere, so search results are always your original lines.

## Replacing text across the project

Switch to the **Replace** tab (or press **⌘⌥F** / **Ctrl-H**) to find-and-replace across **every scene**,
not just the open one. Type what to find, type the replacement, and the list previews each line as
**before → after**. Then:

- **Replace all** rewrites every match at once (it asks you to confirm the count first).
- The **Replace** button on any row applies just that one.

Replace only ever touches **dialogue, narration, and choice text** in your source language. It never
touches ids or Game IDs, conditions or effects, or your translations. Every change is written through
version control, so a project-wide replace is one commit you can review and undo. Your open scene is saved
before the replace runs, and reloads with the new text afterward.

## Browsing by writing status

The **Writing** tab finds lines by how finished they are. Open it from the tab, or jump straight in
with **Review ▸ Find Lines by Status…** (**⌘⇧L** / **Ctrl-Shift-L**).

Pick a **status chip**, one per stage of your [writing-status ladder](/writing-status/), each
with its own colour, and the window lists every line at that stage across the project (a line with no
status set counts as the lowest stage). Type in the box to filter that list, then jump the same way:
↑ / ↓ and Enter, or click.

This is the fast way to answer "what's still at **stub**?" or "show me everything marked **final**",
and to walk through those lines one by one. It pairs with the
[production rollup](/production/tracking-and-reports/#the-writing-status-rollup), which gives
you the *counts*; the Writing tab gives you the *lines themselves*.

## Browsing by recording status

If your project is [**Voiced** and tracks audio status](/production/audio/#recording-status), a
**Recording** tab appears alongside Writing. It works the same way: pick a recording stage (missing,
scratch, recorded, final, or your own) and it lists every spoken line at that stage, so you can pull up
"everything still **missing** a take" and work through it. The tab stays hidden until both **Voiced**
and **Track Audio Status?** are on.

## Finding where a property is used

The **Property** tab answers "where is `@x` used?". Type a property (`@gold`, `@world.threat`, or
`faction rebels` to narrow by value) and it lists every place that property appears, in a
**condition**, an **effect**, or **interpolated into a line**. It's the quick companion to the
[coverage test](/production/coverage-testing/): when a branch reads as
*needs input* because it's gated on `@world.something`, the test's link opens this tab on that
property. You can also open it from **Review ▸ Find Property Usage…**.

## Browsing by tag

The **Tags** tab browses your [author tags](/format/gamedata-and-addressing/#tags). It
shows a **chip for every tag in the project** with how many nodes carry it; pick one and the
window lists every scene, block, group, snippet, or beat carrying that tag, so you can walk
everything marked `whisper` or `tutorial` and jump between them. Type in the box to filter the
list. Open it from the tab or from **Review ▸ Find by Tag…**.

It matches the tag where you actually *applied* it, not the runtime-accumulated set, so a beat only
shows up under a tag if that beat itself carries it, not because its scene does.
