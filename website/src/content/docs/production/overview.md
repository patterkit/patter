---
title: Running the project
description: For producers and narrative leads. Track the writing, manage recording and localisation, catch dead branches, review, and hand the story off, all from one place.
---

If you run the narrative effort, this is your map. Patter is not just a writing tool: it tracks how
finished the script is, manages the voice-recording and localisation pipelines, catches dead or
unreachable content before players do, and packages the whole story into something you can hand to a
stakeholder, a translator, or a studio. The pages below are the ones you will live in; a writer or
developer can ignore most of them.

## Track how much writing is left

Every line carries a **writing status** on an ordered ladder (for example stub to final), with two
readiness markers ("ready to record" and "ready to ship"). Patter rolls those up per scene and across
the project, so "how much is drafted vs done, and what's left" is a number, not a guess.

- Writers set the ladder up on the [Writing status](/writing-status/) page; here it becomes the
  [rollup](/production/tracking-and-reports/#the-writing-status-rollup) and the reports.
- **Burndown and estimating**: stub scenes with a couple of placeholder lines would read as almost
  finished. Turn on Estimating to size them by a guess, so the "lines to write" burndown reflects the
  real work ahead and the schedule is honest. See
  [Estimating](/production/tracking-and-reports/#estimating).

## Manage voice recording

The whole VO pipeline lives in the app:

- **Assign actors** to characters in the [Cast](/setup/cast/).
- **Export a recording script** for the studio, either every voiced line or only those marked ready to
  record: [Production reports and exports](/production/tracking-and-reports/#production-reports-and-exports)
  (or `patter voice-export` from the [CLI](/cli/)).
- **Track takes** by dropping audio into per-status folders; Patter derives each line's recording
  status from the files, and flags a take as **out of date** when the line is edited after it was
  recorded, so you know exactly what needs a re-take. See
  [Recording status and audio](/production/audio/#recording-status).

## Run localisation

Source strings never leave your hands. Export for translation (JSON, Excel, or PO), hand off, and
import the translations back; stable ids mean moving or editing a line never orphans its translation.

- The round-trip, step by step: [Languages & translation](/setup/languages/).
- The full picture (and the embedded-vs-IDs-only choice at build): [Localisation](/production/localisation/).

## Catch dead content before players do

The **coverage test** walks the flow many times with random choices and flags every beat it can never
reach (dead) or can only reach with the right game state (needs input), and can auto-propose the inputs
to exercise world-gated branches. It is narrative QA you can gate a build on.

- [Coverage testing](/production/coverage-testing/), or `patter coverage`
  (with `--fail-on-gap` for CI).

## Review and sign off

- **Threaded comments** and **suggested rewrites** live on the nodes themselves, Word/Docs style, and a
  **review walk** steps you through the open ones.
  See [Reviewing & feedback](/patterpad/reviewing/#threaded-comments).
- The **Production Information** report (word and line counts, status bars, recording coverage,
  burndown) exports to `.xlsx` for anyone who wants it in a spreadsheet:
  [Production reports and exports](/production/tracking-and-reports/#production-reports-and-exports).

## Hand it off and ship

You do not need a build to show the story to anyone:

- A single **playable HTML** file that plays the whole story offline in any browser:
  [Playable HTML](/setup/building-and-shipping/#a-playable-html-to-send-anyone).
- A **readable PDF or Word** screenplay of the script and flow:
  [Readable script](/setup/building-and-shipping/#a-readable-script-pdf--word).
- A **`.patterpack`** to hand the whole project to a freelancer outside your version control:
  [Handing off without your VCS](/setup/building-and-shipping/#handing-the-project-to-someone-without-your-vcs).

## Keep the team from clobbering each other

A project is plain files in your version control (git, Perforce, Plastic, or SVN), and Patter is
lock-aware, so a writing team's edits merge instead of colliding. See
[Version control](/setup/version-control/).
