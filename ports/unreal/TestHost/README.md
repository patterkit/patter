# Unreal TestHost (maintainers)

A standalone clang build that replays the shared conformance corpus
([`packages/conformance`](../../../packages/conformance)) through the same
`Public/Patter/*.h` engine core the Unreal plugin ships - the core is std-only C++, so
parity is checkable without Unreal. It is **not part of the shipped plugins**; end-users
never need it.

```sh
bash ports/unreal/TestHost/build.sh
```

Compiles the engine + a tiny JSON parser and asserts every corpus case. The
`play-unreal-v*` release pipeline runs this gate before packaging. (The UE wrapper layer is
compile-verified separately, with a host project or `RunUAT BuildPlugin`.)
