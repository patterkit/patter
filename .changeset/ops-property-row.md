---
"@patterkit/ops": minor
---

The bundled playable-runtime carries the shared property row.

`listProperties()` inside the inlined runtime now returns rows addressed by
`path` rather than `ref`, and carrying `name` and `writable`. Anything reading
those rows out of a playable HTML export sees the new shape.

The blob is regenerated from the runtime by ops' prebuild, so this rides along
with the runtime change rather than being a decision of its own.
