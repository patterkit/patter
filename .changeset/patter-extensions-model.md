---
"@patterkit/model": minor
---

The model takes Patter extensions: `ProjectFile.extensions` (the extensions a project takes, each pinned to a version, with its settings), the extension data shard (`ExtensionShard`, `EXTENSION_SCHEMA`, `.patterextension`, kept under the new `layout.extensions`, `extensions/` by default), where manifests live (`EXTENSIONS_DIR`, `MANIFEST_EXTENSION`), and the reserved `unresolved` key a merge marks a shard with (`UNRESOLVED_KEY`). The bundle types gain `Bundle.extensions` and an `extensions` value on each beat and compiled node, absent until a project takes an extension, so every bundle today is exactly what it was. `projectLayout` returns the new `ProjectLayout`.
