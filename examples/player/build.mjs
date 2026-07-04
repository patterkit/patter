// Bundle the browser player into a single self-contained IIFE script
// (dist/player.js) so index.html runs by just opening it - no dev server, no
// module loader. Workspace packages resolve to their TS source via aliases (no
// pre-build needed); @wildwinter/* and json5 resolve from node_modules.

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await esbuild.build({
  entryPoints: [here("./player.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: here("./dist/player.js"),
  sourcemap: true,
  logLevel: "info",
  alias: {
    "@patterkit/runtime": here("../../packages/runtime/src/index.ts"),
    "@patterkit/compiler": here("../../packages/compiler/src/index.ts"),
    "@patterkit/dialect": here("../../packages/dialect/src/index.ts"),
    "@patterkit/model": here("../../packages/model/src/index.ts"),
    "@patterkit/core": here("../../packages/core/src/index.ts"),
    // Match tsconfig: bundle the SAME sibling-source expr the typecheck sees,
    // so an unpublished dialect change cannot pass the suite yet break the player.
    "@wildwinter/expr": here("../../../expr/packages/expr/src/index.ts"),
    "@wildwinter/scoperegistry": here("../../../expr/packages/scoperegistry/src/index.ts"),
  },
});

console.log("built examples/player/dist/player.js");
