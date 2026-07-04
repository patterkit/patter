---
title: Tags at runtime
description: "Read author tags off each step at runtime: accumulated down the structure, delivered on step.tags, with engine accessors for a beat, scene, or block."
sidebar:
  label: Tags
---

[Author tags](/format/gamedata-and-addressing/#tags) are a freeform label layer that ships in
the bundle. Every delivered `line` / `text` / `gameEvent` step carries its **accumulated** tags: the
beat's own plus every container's above it (scene → block → group → snippet → beat), deduped and
outermost-first, under `step.tags` (absent when empty):

```ts
if (step.type === "line" && step.tags?.includes("barked")) playBark(step);
```

When you need a level's tags without walking to a beat, the engine exposes accessors:

```ts
engine.tagsForBeat(beatId);          // a beat's accumulated tags
engine.tagsForScene("the-tavern");   // a scene's own tags (by id or Game ID)
engine.tagsForBlock("the-tavern", "cellar"); // scene + block accumulated
```

The native ports expose the same three (`TagsForBeat` / `tags_for_beat`, etc.).
