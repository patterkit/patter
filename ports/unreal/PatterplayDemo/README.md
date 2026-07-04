# Patterplay Demo (Unreal sample project)

A ready-to-open **Unreal sample project** for the **Patterplay** plugin. Its `.uproject`
finds the plugin in the **sibling `Patterplay/` folder** (via Unreal's
`AdditionalPluginDirectories`), so the release zip works exactly as unpacked - nothing to
copy into another project first.

## Run it

1. Unzip the release; keep the two folders side by side:

   ```
   Patterplay/                      # the runtime plugin
   PatterplayDemo/                  # this sample project
     PatterplayDemo.uproject       # <- open this
   ```

2. Open `PatterplayDemo.uproject` (Unreal Engine 5.7, and a C++ toolchain - everything
   ships source-only; confirm the build prompt on first open). The very first open takes a
   few minutes while Unreal compiles the code and warms its shader caches - that's a
   one-time cost, not a hang.
3. Press **Play**. That's it: the project's game mode spawns the tour, which loads
   `Demos/tour.patterc` straight from disk - nothing to import or place.

The tour plays in a proper UI overlay: the transcript scrolls in reading order, non-choice
beats advance on their own, and **you click the choices** (ineligible options show
disabled, exactly as the runtime reports them). At the end, **Play again** reruns it - the
tour branches, so a replay actually differs. While it runs, **Window ▸ Patterplay Runtime
State** shows the story's properties live.

## The pieces

- **`ATourDemoActor`** - the interactive tour above. Auto-spawned by `ATourDemoGameMode`,
  or place one in your own level (assign an imported `UPatterBundle` to override the
  from-disk default).
- **`APatterplayDemoActor`** + `Demos/demo.patterc` - the minimal shared API flow every
  Patterplay runtime plays, logged to the Output Log: the smallest possible integration to
  read first.

To use Patterplay in **your own game**, copy the `Patterplay/` folder into your project's
`Plugins/` directory (see [its README](../Patterplay/README.md)); this sample project is
just a demo shell and is freely deletable.

## Audio (optional)

The demo ships **without audio files**: how you load and play audio is your platform call,
and the runtime deliberately only *resolves* takes (`patteraudio.json` →
`UPatterAudio::Resolve` → a path; playback stays yours). The tour actor still shows the
full wiring: point its **Audio Root** at any Patter audio folder and each line plays its
winning take through a minimal PCM16 WAV loader (a real game would route resolved paths
into its own audio pipeline instead). Inside the PatterKit repo the shared scratch takes
under `examples/projects/audio` are picked up automatically; in the zip that folder does
not exist and the tour plays silently.
