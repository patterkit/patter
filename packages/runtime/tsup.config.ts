import { defineConfig } from "tsup";

// Two artifacts from one source:
//   1. The npm library - ESM + CJS + types, deps left external (Node + bundlers).
//   2. Patterplay (drop-in browser): a single self-contained minified IIFE,
//      every dependency inlined, exposing `window.Patterplay`. One npm package
//      serves both: `import { Engine }` in apps, `<script src=...patterplay.min.js>`
//      on a plain page.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: { patterplay: "src/index.ts" },
    format: ["iife"],
    globalName: "Patterplay",
    platform: "browser",
    minify: true,
    sourcemap: true,
    noExternal: [/.*/], // inline EVERYTHING (workspace + @wildwinter/*) so the script needs no loader
    outExtension: () => ({ js: ".min.js" }),
  },
]);
