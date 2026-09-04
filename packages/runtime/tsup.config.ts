import { defineConfig } from "tsup";

// The npm library - ESM + CJS + types, deps left external (Node + bundlers).
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
]);
