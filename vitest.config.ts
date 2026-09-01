import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// During dev/test, resolve workspace packages to their TS source (no build step).
//
// @wildwinter/expr + scoperegistry live in a sibling repo (github.com/wildwinter/expr). When a
// `../expr` checkout exists (maintainers, CI), alias to its source so the two repos can evolve
// together; otherwise fall back to the published npm packages in node_modules, so a plain clone
// of this repo runs the whole suite with no sibling checkout.
const expr = (pkg: string, entry = "index"): string | undefined => {
  const src = new URL(`../expr/packages/${pkg}/src/${entry}.ts`, import.meta.url);
  return existsSync(src) ? fileURLToPath(src) : undefined;
};

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
      ...(expr("expr") ? { "@wildwinter/expr": expr("expr")! } : {}),
      ...(expr("scoperegistry") ? { "@wildwinter/scoperegistry": expr("scoperegistry")! } : {}),
    },
  },
  test: {
    server: {
      deps: {
        // The updater lives in @wildwinter/app-shell now, and its watchdog test
        // (#33) mocks `electron` and `electron-updater`. A dependency shipped as
        // built ESM in node_modules is EXTERNALISED by default, so it resolves
        // those imports itself and never sees the mocks: the test fails on
        // electron's CommonJS shape rather than on any behaviour. Inlining makes
        // vitest process it like source, which is what the mocks need.
        inline: ["@wildwinter/app-shell"],
      },
    },
  },
});
