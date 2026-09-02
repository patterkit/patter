# @patterkit/play-helpers

## 0.4.0

### Minor Changes

- bd33b5c: BREAKING: a property row's address is `path`, not `ref`, and the row now carries `name` and `writable`.

  `listProperties()` returns the row type from `@wildwinter/scoperegistry` itself,
  rather than a local interface redeclaring it. The inspector reads `row.path`
  where it read `row.ref`.

  This shipped briefly as a `PropertyView` that extended the shared row to add
  `path`. `path` is on the shared row now - both product families had forked it to
  add exactly that field - so `PropertyView` was a second name for one type, and it
  is gone rather than left as an alias. `PropertyRow` is re-exported from
  `@patterkit/runtime`, so naming a row needs no dependency on the kernel.

  The two are the same row: `path` is the addressable reference `getProperty` and
  `setProperty` already take (`@patter.gold`), which is exactly what `ref` held.
  What is new is `name`, the bare declared name, and `writable`, which the local
  interface dropped so an inspector could not tell a read-only property from a
  writable one.

  The fork is why this mattered. The shared type lacked a quality's `stages`,
  which was added here instead, so the Storylet Engine - reading the same expr
  property model through the same registry - edited a quality as free text on
  every platform it ships. One row type, one place to add the next field.

## 0.3.3

### Patch Changes

- 2a16584: Move to @wildwinter/expr 0.5.0 and the new @wildwinter/toolkit.

  Opaque ids, the FNV-1a hash, JSON5 source parsing, the find/replace matcher and
  the archive guards now come from @wildwinter/toolkit instead of being
  maintained here and, separately, in the Storylet Engine. No behaviour change:
  the implementations moved, they were not rewritten.

## 0.3.2

### Patch Changes

- 6fbc90c: The debug link announces a flow the host never opened. `flowOpened` was the host's job and nothing
  could check it, so a game that opened a flow and forgot to announce it left Patterpad's follow list
  short - and the omission outlived a reconnect, because the link's hello carries its own flow set.
  A flow the link has not seen now announces itself the first time it is observed; `flowOpened` still
  lists a flow before its first step, and `flowClosed` is still the only thing that ends one.

## 0.3.1

### Patch Changes

- f97f6eb: The `quality` property type (from @wildwinter/expr 0.4.0): a story stage as an ORDERED ladder of named
  stages. Declarations carry `stages`; ordering operators compare by ladder position; `advance()` steps
  to the next stage, saturating at the last; a stage name off the ladder is a compile-time error, and a
  quality with fewer than two stages or duplicate stage names is an invalid declaration. Saves carry the
  stage NAME, so inserting a stage mid-production shifts nothing. Coverage proposals random-walk a
  quality's stages, and the play-helpers state inspector edits one as a dropdown of its ladder.
  - @patterkit/runtime@0.5.1

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
