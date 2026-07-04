// Compile the shared demo story to a `demo.patterc` bundle, and copy it where the
// per-runtime demos need it (the Unity sample). The same .patterc Patterpad's Build
// Bundle would emit. Workspace packages resolve to their TS source via aliases.

import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const alias = {
  "@patterkit/compiler": here("../../packages/compiler/src/index.ts"),
  "@patterkit/runtime": here("../../packages/runtime/src/index.ts"),
  "@patterkit/dialect": here("../../packages/dialect/src/index.ts"),
  "@patterkit/model": here("../../packages/model/src/index.ts"),
  "@patterkit/core": here("../../packages/core/src/index.ts"),
  "@wildwinter/expr": here("../../../expr/packages/expr/src/index.ts"),
  "@wildwinter/scoperegistry": here("../../../expr/packages/scoperegistry/src/index.ts"),
};

const entry = `
import { exportBundle } from "@patterkit/compiler";
import { demoInput } from "./story.js";
export const bundle = exportBundle(demoInput);
`;

const res = await esbuild.build({
  stdin: { contents: entry, resolveDir: here("."), sourcefile: "gen-entry.ts", loader: "ts" },
  bundle: true, format: "esm", platform: "node", write: false, alias,
});
const mod = await import("data:text/javascript;base64," + Buffer.from(res.outputFiles[0].text).toString("base64"));
const json = JSON.stringify(mod.bundle, null, 2) + "\n";

// 1. The canonical artifact next to the demos.
writeFileSync(here("./demo.patterc"), json);

// 2. Each runtime's demo copy (kept in lockstep - same flow across runtimes).
for (const dest of [
  "../../ports/unity/Patterplay/Samples~/PlayThrough/demo.patterc",
  "../../ports/unreal/Patterplay/Demos/demo.patterc",
  "../../ports/godot/demo/demo.patterc",
])
{
  const path = here(dest);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json);
}

console.log("wrote examples/demo/demo.patterc (+ Unity, Unreal & Godot demo copies)");
