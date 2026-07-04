# Patterplay for Godot

The native **pure-GDScript port** of the Patter runtime, packaged as a Godot addon.

```
ports/godot/
  project.godot        # minimal host project for headless runs (never shipped)
  addons/patterplay/   # the addon - what ships (see its README + CHANGELOG)
  test/                # maintainers: corpus runner + demo smoke check (never shipped)
```

- **Using the addon**: read [`addons/patterplay/README.md`](addons/patterplay/README.md)
  (it ships inside the addon) and the
  [Godot guide](https://patterkit.dev/play/godot/).
- **Releases**: the `play-godot-v*` tag pipeline (`.github/workflows/play-godot.yml`)
  verifies cross-runtime parity, then attaches the addon zip to a GitHub Release. Bump
  versions with `npm run bump:play` (see [`RELEASING.md`](../../RELEASING.md)).
- **Maintainers**: parity against the shared conformance corpus runs headless via the
  scripts in [`test/`](test/README.md).
