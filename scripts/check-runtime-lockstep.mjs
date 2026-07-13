// Verify the four Patterplay runtimes share ONE version (the lockstep invariant).
//
// `bump:play` moves all four together, but @patterkit/runtime is also an npm package in the Changesets
// graph: when @patterkit/model takes a MINOR bump that crosses the runtime's caret range, Changesets
// will cascade-bump + publish the JS runtime ALONE, silently breaking lockstep with the three native
// ports. (It can't simply be `ignore`d - that would stop Changesets publishing it at all.) This guard
// catches the divergence in CI so it's fixed with `bump:play`, not discovered by a game team on a
// version mismatch. Run in CI's build job.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(resolve(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const versions = {
  "packages/runtime/package.json (JS)": json("packages/runtime/package.json").version,
  "ports/unity/Patterplay/package.json": json("ports/unity/Patterplay/package.json").version,
  "ports/unreal/Patterplay/Patterplay.uplugin": json("ports/unreal/Patterplay/Patterplay.uplugin").VersionName,
  "ports/godot/addons/patterplay/plugin.cfg": (read("ports/godot/addons/patterplay/plugin.cfg").match(/^version="([^"]+)"/m) ?? [])[1],
};

const distinct = [...new Set(Object.values(versions))];
if (distinct.length !== 1 || !distinct[0]) {
  console.error("The four Patterplay runtimes are OUT OF LOCKSTEP:\n");
  for (const [file, v] of Object.entries(versions)) console.error(`  ${v ?? "(unreadable)"}\t${file}`);
  console.error("\nAll four must carry one version. Realign them with `npm run bump:play -- <version>`");
  console.error("(a Changesets cascade may have bumped @patterkit/runtime on its own).");
  process.exit(1);
}
console.log(`Patterplay runtimes in lockstep at ${distinct[0]}`);
