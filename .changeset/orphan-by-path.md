---
"@patterkit/ops": patch
---

The not-in-project check decides from paths, not from what is in memory. It compared the disk walk with the loaded file lists, so a shard that appeared under its folder after the project was opened was reported as outside the project while sitting exactly where the loader reads from. Patterpad hit this on a scene's first save, whose edit trail creates the authoring shard. The folder is the rule now, as it is for the loader.
