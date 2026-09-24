# Unity TestHost (maintainers)

A plain dotnet console that replays the shared conformance corpus
([`packages/conformance`](../../../packages/conformance)) through the same `Runtime/*.cs`
the Unity package ships - so cross-runtime parity is checkable in plain .NET (and CI)
without a Unity install. It is **not part of the shipped package**; end-users never
need it.

```sh
dotnet run --project ports/unity/TestHost -- packages/conformance/corpus.json
```

Every bundle case runs through BOTH the System.Text.Json and the Newtonsoft loader, so the
Unity (`PatterBundleLoader`) path is proven too. The `play-unity-v*` release pipeline runs
this gate before packaging.

Beside the corpus it runs the checks the corpus grammar cannot express, among them
`OneRegistry.cs`: the one-registry model from the game's side (the game's `ScopeRegistry`,
Patter's keys and owner label, one save loaded in either order, version 2 saves moving into the
registry, `HotSwap` handing bags over, and a combined game with a stand-in second engine), ported
from the JS runtime's `one-registry.test.ts` and `combined-game.test.ts`.
