# PatterplayDemo

A Unity project that exists to COMPILE, not to play: it pulls the Patterplay
package in through `Packages/manifest.json` as a local `file:` dependency, so a
headless editor run builds the package's Runtime **and Editor** assemblies.

Run it with `npm run check:unity-editor`.

The gap it closes: the dotnet TestHost compiles `Runtime/**/*.cs` only, because
that is the part with no UnityEngine dependency. `Editor/` (the Runtime State
window) and `Samples~/` (the demo scripts) talk to UnityEngine and UnityEditor,
so nothing built them at all - locally or in CI. The Storylet Engine has had
`scripts/check-unity-demo.sh` doing this since its own demo drifted; this is
the matching half.

`Assets/` is empty on purpose. The check copies `Samples~/*` in before it runs
and removes them after, so the sample scripts are compiled without being
duplicated in the repository: `Samples~` stays their one home, and Unity
ignores a `~` directory by design.

Nothing here is a deliverable. `Library/`, `Temp/`, `Logs/` and the copied
samples are all ignored.
