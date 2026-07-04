# Patterplay for Unity

The native **C# port** of the Patter runtime, packaged as a UPM package.

```
ports/unity/
  Patterplay/    # the UPM package - what ships (see its README + CHANGELOG)
  TestHost/      # maintainers: dotnet corpus runner (never shipped)
```

- **Using the plugin**: read [`Patterplay/README.md`](Patterplay/README.md) (it ships inside
  the package) and the [Unity guide](https://patterkit.dev/play/unity/).
- **Releases**: the `play-unity-v*` tag pipeline (`.github/workflows/play-unity.yml`)
  verifies cross-runtime parity, then attaches the package zip to a GitHub Release. Bump
  versions with `npm run bump:play` (see [`RELEASING.md`](../../RELEASING.md)).
- **Maintainers**: parity against the shared conformance corpus is verified outside Unity
  via the [TestHost](TestHost/README.md).
