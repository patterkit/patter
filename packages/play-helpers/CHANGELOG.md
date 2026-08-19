# @patterkit/play-helpers

## 0.3.0

### Minor Changes

- 7bc40af: `createBundleInspector`: the bundle inspector's web view.

  A read-only DOM panel over `describeBundle`, in the same visual grammar as
  `createPropertyInspector`: identity, the addresses game code may call, the `@world` properties the
  host must supply, the story's own declarations, gameData and counts, in collapsible sections.

  The other three runtimes hang this off an imported asset (a Unity CustomEditor, an Unreal details
  customisation, a Godot EditorInspectorPlugin). JS has no asset pipeline, so this is the JS half of
  the same surface: somewhere to LOOK at a bundle rather than only a function that returns one.

  Two rows carry warnings that are otherwise easy to miss: a declared property with no default is
  tagged, since that is a value the host must supply, and a source-debug build says it is not shippable.

## 0.2.1

### Patch Changes

- @patterkit/runtime@0.4.1

## 0.2.0

### Minor Changes

- 97f56aa: The property inspector gains Save/Load state buttons: download the run as a tagged `patter/save@0` envelope file, or restore one - the parity of the Unity, Godot, and Unreal examiner panels.

## 0.1.2

### Patch Changes

- 91b154f: Re-pin `@patterkit/runtime` to the 0.2.2 lockstep release (the four runtimes were realigned to 0.2.2 after a Changesets cascade briefly published `@patterkit/runtime@0.2.1` out of step with the native ports).

## 0.1.1

### Patch Changes

- @patterkit/runtime@0.2.1
