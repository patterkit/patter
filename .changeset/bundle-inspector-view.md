---
"@patterkit/play-helpers": minor
---

`createBundleInspector`: the bundle inspector's web view.

A read-only DOM panel over `describeBundle`, in the same visual grammar as
`createPropertyInspector`: identity, the addresses game code may call, the `@world` properties the
host must supply, the story's own declarations, gameData and counts, in collapsible sections.

The other three runtimes hang this off an imported asset (a Unity CustomEditor, an Unreal details
customisation, a Godot EditorInspectorPlugin). JS has no asset pipeline, so this is the JS half of
the same surface: somewhere to LOOK at a bundle rather than only a function that returns one.

Two rows carry warnings that are otherwise easy to miss: a declared property with no default is
tagged, since that is a value the host must supply, and a source-debug build says it is not shippable.
