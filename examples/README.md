# Examples

Two different kinds of thing live here: **authored stories** (Patter *projects*) and
**host-integration samples** (small apps showing how to embed and play a compiled bundle).

## `projects/`: authored stories

Real Patter projects (each a `.patter` folder: `*.patterproj` + `scenes/` + `loc/` + `authoring/`).
Open one in Patterpad, or play it from the CLI.

| Project | What it is |
|---|---|
| [`projects/tour.patter`](projects/tour.patter) | The **interactive feature tour**, authored *as* a playable Patter story. Walks through choices, selectors, properties, conditions, and closed captions. `patter play examples/projects/tour.patter` |
| [`projects/tavern.patter`](projects/tavern.patter) | A small tavern project used as a demo / scratch project. |

## Host-integration samples

Each subfolder is a self-contained sample showing a **different way to run a compiled bundle**
through the runtime. These are for *developers integrating Patterplay*, not stories in themselves.
Each ships a pre-generated bundle so it runs without a build step.

| Folder | What it demonstrates |
|---|---|
| [`demo/`](demo) | The minimal shared API flow every runtime plays, as a Node script (advance / choose / get+set property / save+load). Used to compare the JS, Unity, Unreal, and Godot ports side by side. |
| [`tour-web/`](tour-web) | The **web tour demo**: plays the interactive tour in a browser *with its voice takes*, resolved per beat through `patteraudio.json`. The same demo each engine port bundles (Unity's `Samples~`, Godot's `addons/patterplay/demo`, Unreal's `PatterplayDemo` sample project); it also ships prebuilt (audio-less) inside `patterplay-js-*.zip` on each `play-js-v*` Release. |
| [`drop-in/`](drop-in) | The *smallest possible* host: a plain HTML page loading `patterplay.min.js` via `<script>` (no bundler, no dev server). The zero-build drop-in distribution. |
| [`player/`](player) | A framework-free **browser player** that plays *any* compiled `.patterc`, plus an in-browser vignette ("The Curfew Bell") that shows off the flow model (block-as-run, call-return, jumps, gather, conditionals). A game-agnostic test harness. |

## Notes

- Building a project with Patterpad's **Build Bundle** writes its compiled `.patterc` to a sibling
  `patter-dist/` folder by default; those are build artifacts and are git-ignored (see the repo
  `.gitignore`). The tour's `patter-dist/tour.patterc` (and its `audio/` folder) are deliberately
  committed so the demos run from a fresh clone; regenerating the bundle needs `git add -f`.
- `dist/` folders inside the samples are build output and are git-ignored too.
