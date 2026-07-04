// Bundle + run the JS demo (play.ts) on Node. Workspace packages resolve to their TS
// source via aliases - the same source the runtime ships, so the demo can't drift.

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const res = await esbuild.build({
  entryPoints: [here("./play.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  alias: {
    "@patterkit/runtime": here("../../packages/runtime/src/index.ts"),
    "@patterkit/play-helpers": here("../../packages/play-helpers/src/index.ts"),
    "@patterkit/dialect": here("../../packages/dialect/src/index.ts"),
    "@patterkit/model": here("../../packages/model/src/index.ts"),
    "@wildwinter/expr": here("../../../expr/packages/expr/src/index.ts"),
    "@wildwinter/scoperegistry": here("../../../expr/packages/scoperegistry/src/index.ts"),
  },
});

// import.meta.url inside the data: URL can't resolve ./demo.patterc, so hand the
// bundled code the real path via an env var.
process.env.PATTER_DEMO_BUNDLE = here("./demo.patterc");
const code = res.outputFiles[0].text;
await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
