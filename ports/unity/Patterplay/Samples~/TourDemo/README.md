# Tour demo

Plays **the interactive Patter tour** inside Unity: a scrolling OnGUI transcript with clickable
choices, driven by the same step loop your game will use. The tour is itself a Patter story that
walks through choices, selectors, properties, conditions, and closed captions.

## Run it

1. Import this sample from **Package Manager ▸ Patterplay ▸ Samples**.
2. Open the **`Tour`** scene beside this file and press **Play**. That's it: the scene
   already holds a wired-up `TourDemo`, and the bundled `tour.patterc` imports as a
   **PatterBundleAsset** automatically. While the run is live,
   **Window ▸ Patterplay ▸ Runtime State** shows the story's properties.

(To use it in your own scene instead: add the **TourDemo** component to any GameObject and
assign the imported `tour` asset to its **Bundle** field.)

## Audio (optional)

The sample ships **without audio files**: how you load and play audio is your platform call, and
the runtime deliberately only *resolves* takes (`patteraudio.json` → `PatterAudioResolver` →
a path; playback stays yours). The demo still shows the full wiring: point its **Audio Root**
field at any Patter audio folder (one holding `patteraudio.json` + takes) and each line plays its
winning take through `UnityWebRequestMultimedia` + an `AudioSource`. The PatterKit repo carries
scratch takes for the tour under `examples/projects/audio` if you want to hear it end to end.
Leave the field empty and the tour plays silently.

## What it demonstrates

- Loading a compiled bundle through the **PatterBundleAsset** importer and `CreateEngine()`.
- The step loop: `OpenFlow` → `Advance()` → render `Line` / `Text` / `GameEvent`, offer `Choice`
  options (ineligible ones disabled), handle `End`.
- Runtime audio **resolution** (resolve-not-play) via `PatterAudioResolver`.

The demo is deliberately plain (a transcript + buttons) so the Patter integration is the only
thing to read.
