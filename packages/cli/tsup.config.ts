import { defineConfig } from "tsup";

// The CLI ships SELF-CONTAINED (spec §13): every workspace package and runtime
// dependency is bundled into dist/cli.js, so `node dist/cli.js` works with no
// node_modules at all. (Node built-ins stay external, as always.) The true
// single-binary step - no Node either - is `build:standalone` (Bun --compile)
// over this same entry.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  splitting: false, // ONE file - dynamic imports inline (still lazily executed)
  platform: "node",
  clean: true,
  noExternal: [/^@patterkit\//, /^@wildwinter\//, "json5", "exceljs", "jszip"],
  // exceljs (CJS) does dynamic require('crypto') etc; an ESM bundle needs a
  // real require for node builtins.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
