---
title: Languages
description: "Declare the languages a Patter project ships in; the translation loop itself is run from the production side."
sidebar:
  label: Languages
---

Patter is built to ship in multiple languages, and the rule that keeps it sane is: **writers
only ever see and edit the source language.** Translations live in their own files and never
clutter the writing surface.

Setting that up is one step: in **Project Settings ▸ Language**, list the languages you'll
ship and mark the **default** (the one writers author in). That's it - the project is now
exportable for translation at any point.

Everything that happens *after* setup - exporting for translators (JSON / Excel / PO),
importing the results back, the staleness tracking that survives rewrites, and the
Embedded-vs-IDs-only choice of how strings ship in the build - is the running-the-project
side, covered in [Localisation](/production/localisation/).

> **Voice production?** The same source of truth feeds **Production ▸ Export Voice Script**
> (a recording script for actors) and the recording-status tracking in
> [Audio & recording](/production/audio/). Set those up once and writers get them for
> free.
