import { defineConfig } from "tsup";

// Two library builds, the same modules:
//   1. The npm library (dist/) - ESM + CJS + types, deps left external (Node + bundlers).
//      `@wildwinter/scoperegistry` above all: it is a peer dependency, a game holds ONE registry
//      that every engine in it shares, and a runtime carrying its own copy would not be on it.
//   2. The zip library (dist-zip/) - every dependency INLINED, for the patterplay-js zip, whose
//      module builds are copied into a project and imported by path with no npm behind them. Until
//      2026-09-27 the zip carried the npm build, which imports five packages the zip never had. The
//      zip build carries its own registry as a result, which play/javascript.md says.
//
// The browser drop-in (patterplay.min.js) is built by @patterkit/play-helpers, the one package that
// depends on the runtime AND the helpers it carries, so a plain page gets both under one global
// (from-storylets/browser-drop-in-carries-the-helpers, 2026-09-04). It used to be built here, runtime
// alone, which left a page with no bundler able to play but unable to write the family's save text.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: ["src/index.ts"],
    outDir: "dist-zip",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    noExternal: [/^@patterkit\//, /^@wildwinter\//],
  },
]);
