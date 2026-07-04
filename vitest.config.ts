import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// During dev/test, resolve workspace packages to their TS source (no build step).
export default defineConfig({
  resolve: {
    alias: {
      "@patterkit/model": fileURLToPath(new URL("./packages/model/src/index.ts", import.meta.url)),
      "@patterkit/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@patterkit/dialect": fileURLToPath(new URL("./packages/dialect/src/index.ts", import.meta.url)),
      "@patterkit/compiler": fileURLToPath(new URL("./packages/compiler/src/index.ts", import.meta.url)),
      "@patterkit/runtime": fileURLToPath(new URL("./packages/runtime/src/index.ts", import.meta.url)),
      "@patterkit/play-helpers": fileURLToPath(new URL("./packages/play-helpers/src/index.ts", import.meta.url)),
      "@patterkit/ops": fileURLToPath(new URL("./packages/ops/src/index.ts", import.meta.url)),
      // @wildwinter/simple-vc-lib resolves from the npm registry via node_modules - no alias.
      // @wildwinter/expr lives in a sibling repo; resolve to its source for dev (no publish needed).
      "@wildwinter/expr": fileURLToPath(new URL("../expr/packages/expr/src/index.ts", import.meta.url)),
      "@wildwinter/scoperegistry": fileURLToPath(new URL("../expr/packages/scoperegistry/src/index.ts", import.meta.url)),
    },
  },
});
