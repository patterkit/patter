import { defineConfig } from "tsup";

// Three artifacts from one package:
//   1. The npm library (dist/) - ESM + CJS + types, deps left external (Node + bundlers).
//   1b. The zip library (dist-zip/) - the same modules with every dependency inlined EXCEPT
//      `@patterkit/runtime`, which the patterplay-js zip ships as a sibling folder. That exception is
//      not about size: the helpers wrap a LIVE engine, and a private copy of the runtime would give
//      the host two runtimes. (The Storylet Engine's zip is built the same way.)
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
    entry: ["src/index.ts"],
    outDir: "dist-zip",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    noExternal: [/^@patterkit\/(?!runtime)/, /^@wildwinter\//],
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
