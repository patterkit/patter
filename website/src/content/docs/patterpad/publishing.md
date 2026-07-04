---
title: Publishing your story
description: "Get your writing out of Patterpad and into the world: publish the bundle your game loads, a playable web page to send to anyone, and a readable script for people who'd rather read it."
sidebar:
  label: Publishing
---

Everything under the **Publish** menu turns your project into something you hand to others.
Which one you reach for depends on who's receiving it: **the game** gets the bundle, **a
person** gets a playable page or a readable script.

## Into the game: Publish Bundle

If your story is part of a game, this is the everyday one. **Publish ▸ Publish Bundle**
(`⇧⌘B`) compiles the whole project into a single `.patterc` file - the thing the
[Patterplay runtime](/play/engine/) in your game actually loads - written to the **Publish
output** path in your [project settings](/patterpad/projects-and-settings/), which you point
once at your game's assets folder. From then on, getting your latest changes into the game is
one keystroke: publish, and the game picks up the new bundle on its next run.

It can be even tighter than that: with [Live Link](/play/live-debug/) connected, **saving in
Patterpad pushes the fresh bundle straight into the running game** - reword a line, save, and
hear it in context without anyone restarting anything. The full detail of what's in the
bundle (and how localised strings travel) is in
[Building & shipping](/setup/building-and-shipping/).

## A playable page: one file, plays anywhere

Not on a game team, or not yet? You don't need a game engine, a programmer, or a build
pipeline to put your story in front of people. If all you have is Patterpad, you already have
everything: write, press Play until it feels right, then **publish one file** and send it to
anyone.

**Publish ▸ Publish Playable HTML…** writes a single `.html` file containing your whole story and
the same engine a shipped game would use. It needs nothing else: no internet, no install, no
server. Anyone you give it to double-clicks it and plays, on a laptop or a phone, with choices,
memory, and branching working exactly as they did in your Play window. Players get a Restart,
and their place is saved in that browser.

Ways to get it to people:

- **Send it.** Email it, drop it in a shared folder, attach it to a message. It's one file.
- **Put it on itch.io.** Name the file `index.html`, zip it, and upload the zip as an HTML
  game. That's the whole process - itch is the natural home for exactly this kind of work.
- **Host it anywhere that serves files.** Neocities, GitHub Pages, or any web space you
  already have: upload the file and share the link.

Details worth knowing: it plays in your **source language**, and it's a text-first page (your
game's audio pipeline isn't part of it). The full reference is in
[Building & shipping](/setup/building-and-shipping/#a-playable-html-to-send-anyone).

## Make it yours: Publish for Web

The single file is perfect for sending, but its look is baked in. When you want a page you
can **customise and host**, use **Publish ▸ Publish for Web…** and pick a folder. You get
four small files:

```
index.html      the page - yours to edit
style.css       the look - yours to edit
story.js        your story - refreshed every publish
patterplay.js   the engine - refreshed every publish
```

The first two are the **harness**: published once, then *left alone*. Change the colours and
fonts in `style.css`, add a title image or an author credit to `index.html` - then keep
writing, and every later **Publish for Web…** to the same folder updates only your story,
leaving your customisations exactly as you made them. (Deleted one? It's re-created fresh on
the next publish.) The folder plays straight from disk with a double-click on `index.html`,
and uploads as-is to itch.io (zipped) or any static host.

## A readable script: for people who'd rather read

**Publish ▸ Publish Readable Script…** writes the whole story as a screenplay-style **PDF** or
**Word** document: scene headings, dialogue, narration, and the branching laid out plainly
(choices as labelled lists, jumps as "go to …"). It's the thing to hand an editor, a
collaborator, or anyone giving notes on the *writing* rather than playing it. Details:
[Building & shipping](/setup/building-and-shipping/#a-readable-script-pdf--word).

## The loop

Writing for a game, the everyday loop is:

1. Write ([the writing surface](/patterpad/writing-surface/)).
2. Play it yourself, from any block, as often as you like
   ([playtesting](/patterpad/playtesting/)).
3. **Publish ▸ Publish Bundle** (`⇧⌘B`) - the game loads the new `.patterc` on its next run,
   or picks it up live if [Live Link](/play/live-debug/) is connected.
4. Edit, publish again. The bundle is cheap to regenerate; your project on disk stays the
   single source of truth.

Publishing to people rather than to the game is the same loop with a different step 3:
**Publish Playable HTML…** and send the file (or upload it and share the link) whenever you
want playtesters or collaborators on the latest version - no engine involved. And if a story
that started life as a sent-around page later becomes part of a game in Unity, Unreal, Godot,
or the web, nothing is thrown away: the same project publishes the
[bundle those engines play](/setup/building-and-shipping/).
