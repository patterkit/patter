# Patterplay for Unreal

The native **C++ Patterplay runtime**, packaged as an Unreal Engine plugin (plus a
ready-to-open sample project beside it).

```
ports/unreal/
  Patterplay/        # the runtime plugin - what ships (see its README + CHANGELOG)
  PatterplayDemo/    # sample .uproject - ships beside it; finds the plugin in the
                     #   sibling folder via AdditionalPluginDirectories (deletable)
  TestHost/          # maintainers: clang corpus runner (never shipped)
```

- **Using the plugin**: read [`Patterplay/README.md`](Patterplay/README.md) (it ships inside
  the plugin) and the [Unreal guide](https://patterkit.dev/play/unreal/).
- **Releases**: the `play-unreal-v*` tag pipeline (`.github/workflows/play-unreal.yml`)
  verifies cross-runtime parity, then attaches a source-only zip of both folders (plugin +
  sample project) to a GitHub Release. Bump versions with `npm run bump:play` (see
  [`RELEASING.md`](../../RELEASING.md)).
- **Maintainers**: the engine core (`Source/PatterplayRuntime/Public/Patter/`, std-only C++)
  is parity-verified against the shared conformance corpus via the
  [TestHost](TestHost/README.md); the UE wrapper layer compile-verifies with a host project
  or `RunUAT BuildPlugin`.
