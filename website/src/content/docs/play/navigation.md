---
title: Sending the story somewhere
description: Move a running flow to a Game ID address from your game, on any Patterplay engine. goto behaves like an authored jump, runFlow plays an address in one call, and reusing a named flow is what keeps shuffles and once-each lists in their place.
sidebar:
  label: Host navigation
---

Usually the **writing** decides where the story goes: a jump at the end of a snippet, an option the
player picks. Sometimes the **game** needs to decide. The player walks into a room and the guard
should say his room-specific line. Combat starts and the conversation has to stop. A debug menu wants
to drop you at chapter four.

Every Patterplay engine can send a running flow to an **address** ([Game IDs](/format/gamedata-and-addressing/)) and carry
on playing from there.

## The short version: play an address

For the common case, one call does everything. It opens the flow if it does not exist yet, moves it
if it does, plays until the content stops, and hands you what played:

```js
const engine = new Engine(bundle);

// Each time the game wants a bark at a location:
const lines = engine.runFlow("guard-42", "npc-barks", "greet");
for (const line of lines) speak(line.character, line.text);
```

An **empty array** means that address had nothing left to give - an exhausted variation list, say -
which is your cue to fall back to other content. An address that does not exist is an error, not an
empty result, so the two never look alike.

### Name the flow, one per speaker

The name is the important part, and it is worth understanding why.

A flow remembers things: which variation of a **shuffle** or a **once each** list it has reached, how
many times it has visited each piece, and its own properties. `runFlow` **reuses** the flow with that
name, so those keep their place from call to call:

```js
engine.runFlow("guard-42", "npc-barks", "greet");   // "Morning."
engine.runFlow("guard-42", "npc-barks", "greet");   // "Cold today."   <- the next one, not the first again
engine.runFlow("guard-7", "npc-barks", "greet");    // "Morning."      <- a different speaker, its own place
```

Use **one name per independent speaker**. Two names never share this state, so two guards can work
through the same written list separately.

:::caution
**`openFlow` does the opposite.** Opening a flow with a name that already exists **replaces** it with
a fresh one, which starts that variation state over and closes the old flow. That is the right thing
when you genuinely mean "begin again" - but do not mix the two on one name by accident, or a speaker
will keep repeating its first line.
:::

## Moving a flow you are already holding

If you are driving a flow yourself, `goto` moves its cursor and leaves everything else alone:

```js
const flow = engine.openFlow("main", { scene: "market" });
// ...play for a while...
if (!flow.goto("throne-room", "audience")) {
  // The address did not resolve; the cursor has not moved.
}
```

Both parts of the address are **Game IDs** (an internal id works too). The block is **scene-scoped**,
so it is looked up inside the scene you named - two scenes can both have a block called `intro`
without ambiguity. To move within the scene you are already in, pass that scene's address again.
Passing `"END"` as the scene ends the flow.

### What it does, exactly

`goto` behaves **exactly like a jump the writer could have written**:

- the destination scene's **on-entry** effects run,
- arriving **counts as a visit**, so `visits()` conditions see it,
- the **call stack is replaced**, so if the story had been "called" and owed a return, that return is
  dropped - just as an authored jump would drop it.

Two things follow from it being a *game* action rather than a written one:

- **It happens immediately.** If a snippet was part-way through being delivered, its remaining lines
  are not played, and a choice waiting for the player is dropped. Interrupting is usually what you
  want; if it is not, finish reading the current content before you move.
- **It moves, it does not reset.** Variation, visit counts and properties all carry on. A flow that
  had run out of content simply resumes at the new address.

## Per engine

```js
// JavaScript
const lines = engine.runFlow("guard-42", "npc-barks", "greet");
const moved = flow.goto("throne-room", "audience");   // false = address not found
const { played, stop } = flow.advanceToStop();        // play to the next choice / end
```

```csharp
// Unity
List<StepResult> lines = engine.RunFlow("guard-42", "npc-barks", "greet");
bool moved = flow.Goto("throne-room", "audience");
AdvanceToStopResult res = flow.AdvanceToStop();
```

```gdscript
# Godot
var lines: Array = engine.run_flow("guard-42", "npc-barks", "greet")
var moved: bool = flow.goto("throne-room", "audience")
var res: Dictionary = flow.advance_to_stop()   # { "played": [...], "stop": {...} }
```

```cpp
// Unreal (Blueprint or C++). Every one of these is BlueprintCallable.
TArray<FPatterStep> Lines = Engine->RunFlow(TEXT("guard-42"), TEXT("npc-barks"), TEXT("greet"));
bool bMoved = Flow->Goto(TEXT("throne-room"), TEXT("audience"));
FPatterStep Stop;
TArray<FPatterStep> Played = Flow->AdvanceToStop(Stop);
```

All four engines agree on every behaviour above; the shared conformance corpus pins it.

:::note
In C++ the method is `gotoAddress` on the underlying engine core, because `goto` is a reserved word.
The Blueprint-facing name is `Goto`, like everywhere else.
:::

## Finished flows

Closing a flow - with `closeFlow`, by resetting the engine, or by replacing its name - **finishes**
it. If you are still holding one, it is inert: advancing reports the end, and `goto` refuses to move
it. This is deliberate, so a reference you forgot to drop cannot quietly keep running scene entry
effects and moving shared state behind your back.
