---
title: The runner
description: Play a conversation a beat at a time as events, with begin, next, and choose, in every Patterplay runtime.
sidebar:
  label: The runner
---

The runner is the quickest way to get a conversation on screen. It plays one flow a beat at a time and hands
each beat to your game as an event: you show it however you like, then call `next()` when the player's ready.
At a choice it waits for `choose(id)`. That's all it does.

It's built for **straightforward games**: a conversation, a choice, the next conversation. It has no timing,
no auto-advance, no arbitration between speakers, and it dictates no UI and no audio. Your game owns all of
that. A fuller dialogue manager for more complex games, **Patterstage**, is coming. For more detail, contact
the Patterkit team at [ian@storytools.se](mailto:ian@storytools.se).

The runner sits on the [Engine API](/play/engine/), so you can always drop down to it: the flow the runner plays
is an ordinary flow.

## How it plays

- **`begin(scene?, block?)`** starts a conversation and delivers its first beat. The first `begin` opens the flow.
  A later one moves the same flow to the scene, as an authored jump does, so visit counts, variations, and the
  flow's own properties carry on through the playthrough. With no scene, the story starts from the beginning at
  the project's start scene; on a flow that's already open, that's a new game (the flow is reset).
- **`next()`** delivers the next beat: a line, a text, or a game event. Every one of them waits for the next
  `next()`, a game event included, so your game can play an animation or move the camera before carrying on.
  If it doesn't care, call `next()` straight from the handler.
- **`choose(id)`** picks an option of the pending choice and delivers what it leads to.
- At the end, **`ended`** is raised.
- **`stop()`** stops delivering. The flow stays where it is, open and saveable, and `ended` isn't raised;
  `next()` carries on from there later.
- **`rebind(engine)`** plays on after a [hot swap](/play/live-debug/), which returns a new engine.

Handlers may call `next()` or `choose()` themselves. The runner finishes the event it's delivering first, so a
long run never deepens the stack.

**Saving.** The runner keeps nothing a save needs: [`saveGame` and `loadGame`](/play/engine/) stay the one way
to save. After a load, call `next()` to carry on. A load lands after the last line delivered, so if you want to
show that line again, get it from the flow with `stepFor(id)`.

**Audio.** A line carries its beat id, the same id the [audio resolver](/play/audio/) takes. Play its recording
with the resolver or with your own pipeline; the runner never plays anything itself.

## JavaScript

`Runner` is in `@patterkit/play-helpers` (and on the `Patterplay` global in the browser drop-in).

```js
import { Engine } from "@patterkit/runtime";
import { Runner } from "@patterkit/play-helpers";

const engine = new Engine(bundle);
const runner = new Runner(engine);            // plays the flow "main"; pass another id as the second argument

runner.on("line", (step) => show(step.speakerLabel, step.text));
runner.on("text", (step) => show("", step.text));
runner.on("gameEvent", (step) => { playCutscene(step.gameData); });
runner.on("choice", (step) => offer(step.options, (id) => runner.choose(id)));
runner.on("ended", () => closeDialogue());

continueButton.onclick = () => runner.next();
runner.begin();                               // or runner.begin("tavern")
```

`on` returns a function that stops listening. `runner.flow` is the flow it plays.

## Unity

`PatterRunner` is a plain C# class with C# events, and `PatterRunnerBehaviour` is a component that wraps it with
UnityEvents you can wire in the Inspector.

From code:

```csharp
using Patterkit.Patterplay;

var runner = new PatterRunner(engine);       // the flow "main"; pass another id as the second argument
runner.Line += step => Show(step.SpeakerLabel, step.Text);
runner.Text += step => Show("", step.Text);
runner.GameEvent += step => PlayCutscene(step.GameData);
runner.Choice += (groupId, options) => Offer(options, id => runner.Choose(id));
runner.Ended += CloseDialogue;

runner.Begin();                              // or runner.Begin("tavern")
// Your Continue button calls runner.Next().
```

From the Inspector: add **Patter Runner Behaviour** to a GameObject, give it a bundle asset (or call
`Attach(engine)` from code), and wire **On Line**, **On Text**, **On Game Event**, **On Choice**, and **On Ended**
to your UI. Buttons call `Next()` and `Choose(id)`; `Begin()` or `Begin(scene)` starts the conversation.

## Godot

`PatterRunner` is a node with signals. Add it to your scene, attach the engine, and connect the signals.

```gdscript
@onready var runner: PatterRunner = $PatterRunner

func _ready() -> void:
	runner.attach(engine)                    # the flow "main"; pass another id as the second argument
	runner.line.connect(func(step): show_line(step["speakerLabel"], step["text"]))
	runner.text.connect(func(step): show_line("", step["text"]))
	runner.game_event.connect(func(step): play_cutscene(step.get("gameData", {})))
	runner.choice.connect(func(step): offer(step["options"]))   # then runner.choose(id)
	runner.ended.connect(close_dialogue)
	runner.begin()                           # or runner.begin("tavern")
	# Your Continue button calls runner.next().
```

GDScript can't throw, so a call the runner refuses (an address that doesn't resolve, a `choose` with no choice
pending) prints the error and keeps it for `runner.last_error()`, as the flow's own calls do.

## Unreal

Add a **Patter Runner** component (`UPatterRunnerComponent`) to an actor, give it your engine with
`SetEngine`, and bind its events: **On Line**, **On Text**, **On Game Event**, **On Choice**, and **On Ended**.
Your Continue button calls **Next**, a choice button calls **Choose** with its option id, and **Begin** starts the
conversation (leave **Scene** empty for the project's start scene).

```cpp
UPatterRunnerComponent* Runner = FindComponentByClass<UPatterRunnerComponent>();
Runner->SetEngine(Engine);                 // the flow "main"; pass another id as the second argument
Runner->OnLine.AddDynamic(this, &AMyDialogue::HandleLine);
Runner->OnChoice.AddDynamic(this, &AMyDialogue::HandleChoice);
Runner->OnEnded.AddDynamic(this, &AMyDialogue::HandleEnded);
Runner->Begin();                           // or Runner->Begin(TEXT("tavern"))
```

`Begin`, `Next`, and `Choose` return the refusal as text (empty when the call worked), keep it for
`GetLastError`, and log it to `LogPatterplay`. The demo project's tour actor plays on the runner, with an optional
UMG widget built in C++ (`UTourRunnerWidget`) to copy from.

For C++ outside Blueprint, the engine-free core has the same runner, `patter::Runner`, with
`onLine`, `onText`, `onGameEvent`, `onChoice`, and `onEnded`.

**Voice-over as imported assets (optional).** If you import your takes as sound assets, `UPatterAudioResolver`
can find them for you: `SoundAsset(BeatId, ContentRoot)` gives the soft pointer to the asset the import made of a
beat's take, and `LoadSound` loads it there and then (a bigger game loads the soft pointer asynchronously
itself). The runner doesn't use either; they're there if you want them. See [Audio](/play/audio/).
