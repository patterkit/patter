# The Night Ferry

One crossing of a dark river, in conversation with the ferryman. It is short (five minutes or so),
finished, and written to be read: a story rather than a lesson. The Interactive Tour teaches the
format; this is what a small piece of dialogue looks like when it is done.

## Play it

- **In Patterpad**: Help ▸ Open an Example ▸ The Night Ferry, or its tile on the welcome screen, copies
  it somewhere you choose. Then **Play ▸ Play from Start**.
- **From the terminal**: `patter play examples/projects/night-ferry.patter`.

## What it is made of

Three scenes, one for each stretch of the crossing: **The Landing**, **Midstream** and **The Far Bank**.

| What you do | What it uses |
| --- | --- |
| Pay the fare, or admit you can't | sticky options that both leave the scene, and a `@paid` boolean the far bank remembers |
| Talk while he rows | a hub: once-only topics that drop off the menu, and a way out that is always there |
| Sit in silence | a sticky option playing a shuffled line each time, never the same one twice running |
| Ask about him | an option greyed out until you have given something of yourself (`@candour >= 1`) |
| Say why you're crossing | a choice inside a choice, gathering back to the hub, setting a `@reason` enum |
| Look back | an option kept secret until you have said you're leaving |
| Reach the far bank | `branch` groups: the ferryman's farewell follows what you told him and how open you were |

Three properties carry the whole story: `@paid`, `@candour` (a count of the honest moments) and
`@reason` (`unsaid`, `home` or `away`), with `@looked_back` for the one choice that pays off later.
