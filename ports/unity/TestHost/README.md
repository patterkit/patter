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
