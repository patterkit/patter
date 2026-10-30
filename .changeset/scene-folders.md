---
"@patterkit/model": minor
"@patterkit/ops": minor
"@patterkit/cli": patch
---

Folders for organising the scene list. The project file gains `sceneFolders` (each folder's id, name, and optional parent) and `sceneFolder` (scene id to folder id), and `sceneOrder` now holds folder ids as well as scene ids, so folders and scenes mix in one order. They're navigation only: no file moves and nothing reaches the bundle. The model's `sceneFolderLayout` and `sceneFolderPath` lay the list out, forgiving a missing folder or a loop of parents; the loader sorts scenes as the list shows them (`applySceneNavOrder`). A merge now merges `sceneOrder` by moves, so two people moving different scenes both land, and only one scene moved two ways clashes; folders merge field by field, and filing scene by scene. The report, voice script, and loc spreadsheets gain a Folder column when a project has folders (`sceneFolderPaths`); the loc import never reads it.
