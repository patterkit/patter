---
title: Live refresh & debug
description: "A localhost link between Patterpad and your running game: saves push the new bundle straight into the run (live refresh), and the game streams its story cursor back for the editor to follow (live debug)."
sidebar:
  label: Live refresh & debug
---

One small localhost link between Patterpad and your running game buys you two things:

- **Live refresh**: save in the editor and the running game **picks up the edit without
  restarting**. Reword a line and the game speaks the new words the next time it comes up; even
  restructured scenes carry the run across.
- **Live debug**: the game streams its story cursor back, and Patterpad **follows it like a
  debugger**: the current beat highlights, scenes switch as play crosses them, and you can see
  which flow is where.

The debug half is **observe-only**: the game stays in control and the editor is a passive mirror.
The link is a **loopback-only** WebSocket (`127.0.0.1`): only processes on your own machine can
reach it; nothing leaves your machine.

> **Every engine ships a client** (JavaScript, Unity, Unreal, Godot), all speaking the same
> `patterplay/debug@1` protocol below. Each is a **debug-only tool**: it is inert in a shipping build
> and safe to leave wired in (see the per-engine notes).

## Turn it on in Patterpad

The link is controlled by a small **connect icon** in the **bottom-right corner** of the editor (and
by the **Play ▸ Live Link** menu item, which is ticked while the link is on).

<figure class="doc-shot is-inset">
  <img src="/doc-images/LiveDebugLink.png" alt="The live-link chip in the editor's bottom-right corner: the loopback address ws://127.0.0.1:4471 beside an amber connect icon, with a tooltip reading Live link: listening, waiting for a game. Click to stop." />
  <figcaption>The connect icon, amber and listening. The loopback address <code>ws://127.0.0.1:4471</code> sits beside it (click to copy); hovering spells out the state.</figcaption>
</figure>

1. Click the **connect icon** (or tick **Play ▸ Live Link**). It turns **amber** (*listening*) and
   the **address** (`ws://127.0.0.1:4471`) appears beside it. Click the address to copy it.
2. Run your game with its link client pointed at that address (below). When it connects the icon turns
   **green** and the editor starts following the cursor.
3. Click the icon again (or untick the menu item) to stop.

The icon's **colour** is the state at a glance, and hovering it spells the status out:

- **Grey**: off.
- **Amber**: listening, waiting for a game.
- **Green**: connected and **in sync** (the game is running this exact build, so beats highlight precisely).
- **Red**: connected, but a **different build**. You've rebuilt or edited since the game launched, so
  beat ids may not line up. The editor still follows scenes, but **rebuild and relaunch to re-sync** for
  exact-beat highlighting. (A game wired for [live bundle refresh](#live-bundle-refresh)
  re-syncs itself: saving in Patterpad pushes the new bundle straight into the running game.)

If more than one flow is live, a small **flow picker** appears next to the address to choose which one
the playhead tracks.

## Live bundle refresh

With the link connected, Patterpad doesn't just *watch* your game: **saving in the editor pushes the
freshly compiled bundle into the running game**, which picks it up without restarting. Reword a line,
hit save, and the running game speaks the new words the next time that line comes up. For a writer,
this closes the loop completely: play your actual game, feel a line land wrong, fix it, and hear the
fix on the next pass, no rebuild, no restart, no losing your place.

Two tiers, picked automatically:

- **Text-only edits** swap the string tables in place: nothing restarts, no state is touched.
- **Structural edits** carry the whole run across (a save/load under the hood): position is re-found
  by id, so lines inserted or reordered before the cursor neither replay nor shift where you are; an
  option you deleted drops out of an open choice; content deleted under the cursor is skipped and
  play continues from the nearest survivor.

**JavaScript** wiring, via `applyLiveBundle` (a one-time developer task; writers just save):

```js
import { createDebugLink, applyLiveBundle } from "@patterkit/play-helpers";

let engine = new Engine(BUNDLE);
let bundle = BUNDLE;
let flow = engine.openFlow("main");

const link = createDebugLink({
  build: bundle.content.hash,
  onBundle: ({ build, data }) => {
    const r = applyLiveBundle(engine, bundle, data); // picks the tier itself
    engine = r.engine; bundle = r.bundle;
    if (r.kind === "structure") flow = engine.getFlow("main"); // re-bind your flow handles
    link.setBuild(build);                            // the editor's pill flips back to in-sync
  },
});
```

**Every engine receives the push.** The native wiring mirrors the JavaScript shape, adapted to
each engine's threading:

- **Unity**: drain the link from your `Update()` (the socket runs on a worker thread), then apply:
  `if (_link.TryReceive(out var raw) && PatterLiveBundle.TryParsePush(raw, out var build, out var data))
  { var r = PatterLiveBundle.Apply(_engine, _bundle, data); … _link.SetBuild(build); }`
- **Unreal**: set `Link->OnBundle` (fires on the game thread); load with
  `UPatterBundle::LoadFromString(Data)`, apply with `Engine->ApplyLiveBundle(NewBundle)` (the
  engine object and every `UPatterFlow` handle swap **in place** and stay valid), then
  `Link->SetBuild(Build)`.
- **Godot**: connect the link's `bundle_pushed(build, data)` signal; apply with
  `engine.apply_live_bundle(data)` (re-bind flow handles on a `"structure"` result), then
  `link.set_build(build)`.

The same swap powers Patterpad's own **Play window**: edit mid-run and it applies live (a quiet
"Edits applied live" note), only falling back to the restart prompt when the in-flight edit doesn't
compile. The cross-bundle behaviour is locked by the shared conformance corpus, so all four engines
resolve an edit under the cursor identically.

Honest limits: your game's own side-effects don't rewind (things already spawned stay spawned); text
already in a transcript keeps the words the player saw; and an edit that changes how many random
draws happen before the cursor naturally changes later draws.

## Wire in the debug half: follow the cursor

Every engine's client has the same shape: open it with the build id, tell it when a flow opens,
report the position after each `advance()` / `choose()`, and tell it when a flow closes. It never
throws into your game loop, and if Patterpad isn't listening every call is a no-op.

**JavaScript** - `@patterkit/play-helpers` ships `createDebugLink`:

```js
import { createDebugLink } from "@patterkit/play-helpers";

const link = createDebugLink({
  build: BUNDLE.content.hash,       // the build identity, from your compiled bundle
  project: "My Game",               // shown in the editor's debug-link tooltip (optional)
  // url: "ws://127.0.0.1:4471",    // the default; override if you changed the port
});

link.flowOpened("main");            // tell the editor a flow exists

// ...in your play loop, after each step:
const step = flow.advance();
link.observe("main", flow.currentScene, step.id ?? null, step.type);

link.flowClosed("main");            // ...and when the flow ends
```

**Unity** - `new PatterDebugLink(...)`. Wire it behind `#if UNITY_EDITOR || DEVELOPMENT_BUILD` so it
is stripped from a release player build:

```csharp
#if UNITY_EDITOR || DEVELOPMENT_BUILD
_link = new PatterDebugLink(engine.BuildId, "My Game");
_link.FlowOpened("main");
// ...after each step:
_link.Observe("main", flow.CurrentScene, step.Id, PatterDebugLink.TypeName(step.Type));
#endif
```

**Unreal** - `FPatterDebugLink::Create(...)`. It compiles to no-ops in a Shipping build (the
WebSockets dependency is dropped there), so it is safe to leave in:

```cpp
Link = FPatterDebugLink::Create(Engine->GetBuildId(), TEXT("My Game"));
Link->FlowOpened(TEXT("main"));
// ...after each step (map EPatterStepType -> "line" / "text" / "gameEvent" / "choice" / "end"):
Link->Observe(TEXT("main"), Flow->CurrentScene(), Step.Id, StepTypeName(Step.Type));
```

**Godot** - a `PatterDebugLink` node. It only opens the link in a debug build
(`OS.is_debug_build()`), so it is inert in a release export:

```gdscript
var link := PatterDebugLink.new(engine.build_id(), "My Game")
add_child(link)
link.flow_opened("main")
# ...after each step:
link.observe("main", flow.current_scene(), step.get("id", ""), step["type"])
```

That's the whole integration on any engine. Leave the client wired behind your engine's debug flag
and it costs nothing in a shipped game.

### The wire protocol (`patterplay/debug@1`)

For native ports or a custom client, the protocol is one small JSON object per message over the
WebSocket:

```json
{ "t": "hello", "v": 1, "build": "<bundle hash>", "project": "My Game", "flows": ["main"] }
{ "t": "frame", "flow": "main", "sceneId": "<scene id>", "beatId": "<beat id|null>", "type": "line|text|gameEvent|choice|end" }
{ "t": "flowOpen",  "flow": "main" }
{ "t": "flowClose", "flow": "main" }
```

One message travels the OTHER way, editor to game ([live bundle refresh](#live-bundle-refresh), above):

```json
{ "t": "bundle", "v": 1, "build": "<new bundle hash>", "data": "<the full .patterc JSON>" }
```

Send `hello` first; the editor reads the build + flow list from it before honouring any frames. The
ids are the bundle's **opaque model ids**: the same ones every runtime already exposes on its step
result and `currentScene`. The server binds to `127.0.0.1` only, so no pairing token is needed.

