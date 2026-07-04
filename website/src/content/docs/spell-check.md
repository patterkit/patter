---
title: Spell-check
description: "Patterpad's built-in spell-checker: a Word / Docs-style red wavy underline, a right-click fix menu, a per-project dictionary, and your own importable Hunspell dictionaries."
---

Patterpad has a **built-in spell-checker** for the words your players read. It works the way you expect
from Word or Google Docs: misspelled words get a **red wavy underline**, and right-clicking one offers
corrections, "Add to dictionary", or "Ignore". It checks the language you write in (your project's
**source language**) and stays out of your finished game: spelling never reaches the build.

> Only the words a player reads are checked: dialogue, narration, and directions. Character names, ids,
> and `@property` references are never flagged, and your cast names are always accepted.

## The dictionary

**Project Settings ▸ Dictionary** is where you set it up:

- **Spell-check**: the on/off switch (on by default).
- **Dictionary**: the language to check against. **English (US)** and **English (UK)** are built in, so
  `colour` is right in UK English and `color` is right in US English. Pick the one that matches what you
  write; it starts from your project's source language.
- **Import…**: add your own language. Pick any **Hunspell** `.dic` file (its matching `.aff` comes with
  it). Hunspell is the dictionary format used by LibreOffice, Firefox, and Chrome, so free dictionaries
  exist for dozens of languages. Imported dictionaries stay **on your computer**, not in the project, so a
  large dictionary never bloats the repo. A teammate who opens the project without it just sees spell-check
  switch off (the built-in English ones always work).
- **Project dictionary**: a list of words to **always accept in this project**: character names, places,
  invented terms. This list **travels with the project** through version control, so the whole team checks
  against the same words. Add, edit, or delete them here, or use "Add to dictionary" on a flagged word in
  the editor.

## Fixing a misspelling

Right-click a wavy-underlined word for the usual menu:

- **A correction**: pick one of the suggested spellings to replace the word in place.
- **Add to dictionary**: the word is right for this project; add it to the project dictionary so it's
  never flagged again, for anyone on the project.
- **Ignore**: leave the word as-is for this session, without adding it anywhere.

Misspellings also show up in the **problems panel** for the open scene, as "Spelling" notes you can step
through like any other problem. They're advisory: they never block a build or export.

The dictionary and engine licenses are listed on the
[Third-party licenses](/licenses/) page.
