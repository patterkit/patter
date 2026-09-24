# Unreal TestHost (maintainers)

A standalone clang build that replays the shared conformance corpus
([`packages/conformance`](../../../packages/conformance)) through the same
`Public/Patter/*.h` engine core the Unreal plugin ships - the core is std-only C++, so
parity is checkable without Unreal. It is **not part of the shipped plugins**; end-users
never need it.

```sh
bash ports/unreal/TestHost/build.sh
```

Compiles the engine + a tiny JSON parser and asserts every corpus case, then the checks the
corpus cannot express: among them `[one-registry]`, the engine on a registry the game owns (ports
of the JS runtime's `one-registry`, `combined-game`, and `save-envelope-shape` tests),
`[external-scopes]`, content naming another engine's scope (`@story.act`, the runtime cases of
`one-registry.test.ts`'s "other engines' scopes": read and written through the game's registry, and
refused at `openFlow` and `loadGame`, before anything changes, when nobody registered it), `[kernel-errors]`, one case per place the engine rethrows the shared kernel's `ExprError` /
`RegistryError` as its own `EvalError` (each fails when its rethrow is removed), and the
shared registry corpus (`registry-corpus.json`) through the vendored `RegistryCorpus.h`. The
`play-unreal-v*` release pipeline runs this gate before packaging. (The UE wrapper layer is
compile-verified separately, with a host project or `RunUAT BuildPlugin`.)
