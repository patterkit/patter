import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The vanilla dev harness (npm run dev) - deliberately framework-neutral (no
// Svelte; the shell framework is a later slice). Resolves @patterkit/* to TS
// source (no build step), mirroring the repo's vitest aliases.
export default defineConfig({
  root: fileURLToPath(new URL("web", import.meta.url)),
  resolve: {
    alias: {
      "@patterkit/model": fileURLToPath(new URL("../model/src/index.ts", import.meta.url)),
      "@patterkit/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
      "@patterkit/dialect": fileURLToPath(new URL("../dialect/src/index.ts", import.meta.url)),
      "@wildwinter/expr": fileURLToPath(new URL("../../../expr/packages/expr/src/index.ts", import.meta.url)),
      "@wildwinter/scoperegistry": fileURLToPath(new URL("../../../expr/packages/scoperegistry/src/index.ts", import.meta.url)),
    },
  },
});
