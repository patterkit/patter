import { defineConfig } from "tsup";

// Two artifacts from one package:
//   1. The npm library - ESM + CJS + types, deps left external (Node + bundlers).
//   2. Patterplay (drop-in browser): `patterplay.min.js`, a single self-contained minified IIFE
//      with EVERYTHING inlined (the runtime, the helpers, every @wildwinter/* dependency), exposing
//      `window.Patterplay`. It lives here, not in the runtime, because this is the one package that
//      depends on the runtime AND the helpers it carries (src/browser.ts). The release zip and the
//      loose GitHub asset ship it; unpkg / jsDelivr serve it from this package.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: { patterplay: "src/browser.ts" },
    format: ["iife"],
    globalName: "Patterplay",
    platform: "browser",
    minify: true,
    sourcemap: true,
    noExternal: [/.*/], // inline EVERYTHING (workspace + @wildwinter/*) so the script needs no loader
    outExtension: () => ({ js: ".min.js" }),
  },
]);
