---
title: RPGs
description: See how Patter slots into an RPG, with quest givers that follow quest state, reactions to reputation and past choices, checks, and a large voiced cast.
sidebar:
  label: RPGs
---

How Patter slots into an RPG.

An RPG has a lot of dialogue, and most of it has to react: to the quest the player is on, what they did last
time, their reputation, and their stats. Patter holds the conversations and the flags they set, and reads
everything else from your game. Your game runs the quests, the stats, the checks, combat, and the shops.

:::tip[Coming soon]
Upcoming Patter extensions will help marshal conversations in your engine, drive lipsync, and manage their
integration with cutscene animation.
:::

## Quest givers that follow the quest

Your quest system knows each quest's stage. Report it as a [`@world` property](/play/world-properties/) and the
quest giver's lines follow it, with a [`branch`](/format/choices-and-logic/#selectors) to pick the opener.

```
(branch)
(if @world.ring_quest == "notStarted")
ODA: You look like someone who can find things.
(if @world.ring_quest == "active")
ODA: Any sign of my ring?
(if @world.ring_quest == "returned")
ODA: You found it! I'd given up hope.
ODA: Busy day. Come back later.
```

The last line has no condition, so it plays for any other state, such as a quest the player failed.

When a conversation starts or finishes a quest, an effect sets a writable `@world` value, or a
[game event](/format/structure/#beats) carries a `quest` field in its Game Data, and your quest system acts on it.
Which of the two to use is your call: a value your game reads, or a cue it reacts to.

## Hub conversations

Most RPG conversations are a hub: an opener, then a list of things to ask or say, each answered and back to the
list, until the player leaves. The hub is a block holding a [`choice`](/format/choices-and-logic/#choices-and-options),
and each option ends with a [jump](/format/structure/#jumps) back to it. The options' conditions do most of the
work.

- **Topics that follow the game.** An option gated on quest state, reputation, faction, or a flag from another
  conversation appears only when it applies: "About the ring..." once the quest is active.
- **Locked options the player can see.** By default an option whose condition fails still reaches your game,
  marked [unavailable](/format/choices-and-logic/#unavailable-not-hidden) with the reason, so you can show
  "[Charisma 6] Talk them down" greyed out. Mark it `secretUntilEligible` to keep it hidden instead.
- **Asked once, or always there.** Options are once-only by default, so a question goes once asked. Sticky ones,
  such as "What do you sell?" or "Goodbye", stay.
- **A way out.** A sticky "Goodbye" ends it from anywhere. Without one, a fallback is taken by itself once
  nothing else is left.

```
(block hub: choice)
> About the ring...  (if @world.ring_quest == "active")
  ODA: It was my mother's. Please hurry.
  (jump to hub)
> [Charisma 6] Couldn't you pay a bit more?  (if @world.charisma >= 6)
  ODA: Fine. Fifty more, and not a coin over.
  (jump to hub)
> What do you sell?  (sticky)
  (game event: open = "shop")
  (jump to hub)
> Goodbye.  (sticky)
  ODA: Safe roads.
```

## Remembering what the player said

Flags the conversations own, such as "insulted the mayor" or "promised to help", are `@patter`
[properties](/format/choices-and-logic/#properties). They last the whole game, save with it, and any scene can
test them. `patter_seen()` and `patter_visits()` tell a scene whether the player has already been somewhere or
heard something, in any conversation. The plain `seen()` and `visits()` count only within the current flow.

## Reputation, stats, and checks

Options can be gated on anything your game reports. A persuade option gated on `@world.charisma >= 6` reaches
your game as [unavailable](/format/choices-and-logic/#unavailable-not-hidden) for a low-charisma player, so you
can show it locked with its requirement, or leave it out.

Dice rolls and skill checks are your game's. Put a game event in the option asking for the check, have your
game roll and report the result before it advances, and let the next lines follow it. The dialogue never needs
to know how the check works, only how it came out.

```
> [Charisma 6] Talk them down.  (if @world.charisma >= 6)
  (game event: check = "persuade")
  (branch)
  (if @world.check_passed)
  GUARD: Fine. Go on, then.
  GUARD: Nice try.
```

## Companions and relationships

How a companion feels about the player is a `@patter` [property](/format/choices-and-logic/#properties): a
number for approval, a [quality](/format/property-types/#quality-the-stage-of-a-story) for a stage that only moves
forward, or [flags](/format/property-types/#flags-any-of-these) for facts such as "trusts you" or "saw you lie".
Effects on options move it, and conditions on options open what a closer relationship allows: a personal
question, a favour, a romance.

```
(block camp: choice)
> How are you holding up?
  KAEL: Better, now you ask.
  (effect: @kael_approval = @kael_approval + 1)
  (jump to camp)
> Tell me about your brother.  (if @kael_approval >= 5)
  KAEL: I don't talk about him. But for you, I'll try.
  (effect: set_flags(@kael, +told_about_brother))
  (jump to camp)
> I need you to lie for me.  (if check_flags(@kael, +trusts_you))
  KAEL: Just this once.
  (jump to camp)
> Let's move on.  (sticky)
```

The same values can gate options in other conversations, so a companion who trusts you can vouch for you to
someone else. A companion's comments during play react to the moment with
[Best match](/format/choices-and-logic/#best-match-lines-that-fit-the-moment): the most specific line for the
current state wins, and a plain one covers the rest.

## Shops

A shopkeeper's greeting can follow reputation the same way. The shop itself, its stock and prices, is your
game's: an option sends a game event to open it, as in the hub above.

## A large cast and a lot of voice

The [cast](/setup/cast/) keeps every character's name and voice consistent across the project. Every line has a
recording status and a place in the voice script ([Audio](/production/audio/)).
[Tracking and reports](/production/tracking-and-reports/) shows how much is written, approved, and recorded, and
[coverage testing](/production/coverage-testing/) plays every branch to find the ones nobody can reach.
[Localisation](/production/localisation/) takes the text into other languages.

## What stays in your game

- The quest system, stats, checks, and combat.
- The shops, the inventory, and the economy.
- Which conversation starts when the player talks to someone.

## Where Storylet Studio fits

Often. Storylet Studio is good at the parts of an RPG where the game chooses what happens: encounters around
the map, rumours that whoever you talk to first gets to tell, jobs on a board, and finds that turn up as you
explore. Its starting kits cover each of these ([box kits](https://storylets.dev/storyletter/box-setup/)).
Storylet Studio picks the beat, and Patter plays the conversation for it.

## Where next

- [World Properties](/play/world-properties/) for reading and writing your game's state.
- [Choices and logic](/format/choices-and-logic/) for Best match and option flags.
