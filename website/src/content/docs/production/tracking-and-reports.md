---
title: Tracking & reports
description: "Roll up writing status, run the coverage test, and export production reports, voice scripts, and localisation: the numbers and artifacts that keep a narrative project on schedule."
sidebar:
  label: Tracking & reports
---

Once the writers are drafting, this is where you see **how much is done and what's left**,
catch content players can never reach, and turn the project into the reports and scripts
other people need. Writers set each line's [writing status](/writing-status/) as they
go; here it rolls up into numbers you can plan with.

## The writing-status rollup

Writing status feeds **Production ▸ Production Information** (and the exported report): each
scene's line counts broken down by stage, plus how many voiced lines have crossed the "ready
to record" and "ready to ship" thresholds. Since game event beats aren't tracked, they never
skew those totals: the numbers reflect only the lines actually written and (if you like)
voiced.

Where the report gives you the *counts*, **status search** gives you the *lines*: open
**Review ▸ Find Lines by Status…** (or switch the
[search window](/search/#browsing-by-writing-status) to its **Writing** mode) to list
and jump straight to every line at a given stage. It's the quick way to pull up "everything
still at **stub**" and work through it.

## Scene status

Every scene also has a **status**: the stage of its **lowest** beat, its weakest link (an
unset beat counts as the lowest). The report shows each scene's status and counts how many
scenes sit at each stage, so you can see at a glance which are furthest from done.

## Coverage testing

Rollups tell you how much is *written*; **coverage testing** tells you how much is *reachable*.
**Review ▸ Run Coverage Test…** plays the story through many times, flags content no player can
reach and choices that run dry, and drives branches gated on values only your game sets. It has
its own page: [Coverage testing](/production/coverage-testing/).

## Production reports and exports

The **Production** menu turns the project into the artifacts other people need:

- **Production Information…**: a report you can read but not edit: word and line counts,
  writing status by beat and by scene, branching, recording coverage (when
  [audio tracking](/production/audio/#recording-status) is on), and a lines-to-write
  burndown. Turn on [Estimating](#estimating) to size unwritten scenes by a guess instead of
  their placeholder lines.
- **Export Production Info…**: that same report as an `.xlsx` spreadsheet.
- **Export Voice Script…**: a recording script for voice actors, either every voiced line or
  only those marked ready to record. Once takes come back, drop them into folders by status
  and Patterpad reads each line's recording status from the files: see
  [Audio & recording](/production/audio/#recording-status).
- **Export / Import Localisation…**: hand your text out for translation and fold it back in;
  covered under [Projects & settings](/patterpad/projects-and-settings/) and
  [Localisation](/production/localisation/).

<figure class="doc-shot">
  <img src="/doc-images/ProductionInfo.png" alt="The Production information report: headline cards for written lines, voiced lines, choices, ready to record and ready to ship, above coloured bar breakdowns of writing status, scene status and recording status, with an Export to spreadsheet button." />
  <figcaption>The Production Information report. Headline cards summarise written and voiced lines, choices, and how much has crossed the record / ship thresholds; the bars below break the project down by writing, scene, and recording status. <strong>Export to spreadsheet</strong> writes the same figures as <code>.xlsx</code>.</figcaption>
</figure>

The "share with anyone" outputs live in the **Publish** menu instead:

- **Publish ▸ Publish Readable Script…**: a screenplay of the whole story (dialogue, narration,
  choices, jumps) as a **PDF** or **Word (.docx)**, the document to hand someone who just
  wants to *read* it. →
  [Building & shipping](/setup/building-and-shipping/#a-readable-script-pdf--word).
- **Publish ▸ Publish Playable HTML…**: a single `.html` file that *plays* the whole story in any
  browser, offline, with nothing to install. Hand one file to a stakeholder. →
  [Building & shipping](/setup/building-and-shipping/#a-playable-html-to-send-anyone).

## Estimating

By default the report counts the lines actually in each scene. That flatters scenes you've only
**stubbed**: a scene you've sketched as a couple of placeholder lines looks nearly done, when it
will really grow to dozens. **Estimating** swaps an unwritten scene's line count for a **guess**,
so the burndown shows the work still ahead.

Turn it on in **Project Settings ▸ Estimating** (off by default; while it's off, the report shows
plain actuals and no estimate appears anywhere).

**Which scenes get estimated.** Only a scene where **every beat** sits at or below the **"Estimate
scenes up to status"** stage (by default the lowest, *stub*). The moment any beat climbs past that
stage, the scene counts as started and goes back to real numbers. So the rhythm is simple: stub a
scene with a few placeholder lines, and it stays estimated until you actually start drafting it.

**How big the guess is.** Each estimated scene uses the **Default estimate (lines)**, unless it
carries a **tag** you've given a number to in the tag list, in which case that number wins. If a
scene has several such tags, the **largest** wins. Tag scenes `cutscene` or `conversation` to size
them by type.

**By character.** Assign your placeholder lines to the characters you expect in the scene, and the
guess is **split between them in proportion** (narration and speaker-less lines pool as an
"unattributed" share). A scene estimated at 20 lines with two BARKEEP placeholders, one GUARD, and
one line of narration comes out **BARKEEP 10, GUARD 5, unattributed 5**, feeding the per-character
counts in the report.

**In the report.** Estimated scenes are marked `(est.)` and their figures are projections, not
actuals; the word counts come from your project's real average words-per-line. None of this touches
the story itself; it's only there to help you plan.
