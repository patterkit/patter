// Bundle the web tour demo into a single self-contained IIFE script (dist/tour.js), the same
// zero-loader shape as examples/player. Workspace packages resolve to their TS source via
// aliases (no pre-build needed); @wildwinter/* resolves from the sibling expr repo's source.

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await esbuild.build({
  entryPoints: [here("./tour.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: here("./dist/tour.js"),
  sourcemap: true,
  logLevel: "info",
  alias: {
    "@patterkit/runtime": here("../../packages/runtime/src/index.ts"),
    "@patterkit/play-helpers": here("../../packages/play-helpers/src/index.ts"),
    "@patterkit/model": here("../../packages/model/src/index.ts"),
    "@patterkit/core": here("../../packages/core/src/index.ts"),
    "@wildwinter/expr": here("../../../expr/packages/expr/src/index.ts"),
    "@wildwinter/scoperegistry": here("../../../expr/packages/scoperegistry/src/index.ts"),
  },
});

console.log("built examples/tour-web/dist/tour.js");
