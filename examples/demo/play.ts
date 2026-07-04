// Patterplay JS demo: load the compiled demo bundle and play the flow, exercising the
// runtime API (openFlow / advance / choose / get+setProperty) and the @patterkit/play-helpers
// companion (save/load round-trip). Run with: npm run demo  (or: node play.mjs)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "@patterkit/runtime";
import type { Bundle } from "@patterkit/model";
import { serializeState, deserializeState, getProperty, setProperties } from "@patterkit/play-helpers";

// Load the compiled .patterc the same way a game would.
const bundlePath = process.env.PATTER_DEMO_BUNDLE ?? fileURLToPath(new URL("./demo.patterc", import.meta.url));
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;

console.log("=== Patterplay JS demo ===\n");

const engine = new Engine(bundle);
const flow = engine.openFlow("main", { scene: "demo" });

for (let i = 0; i < 100; i++) {
  const step = flow.advance();
  if (step.type === "line") console.log(`${step.characterName ?? step.character}: ${step.text}`);
  else if (step.type === "text") console.log(step.text);
  else if (step.type === "choice") {
    step.options.forEach((o, n) => console.log(`  [${n}] ${o.prompt?.text}`));
    const pick = step.options[0]!; // the demo always takes the left path
    console.log(`> ${pick.prompt?.text}`);
    flow.choose(pick.id);
  } else if (step.type === "end") {
    console.log("[end]");
    break;
  }
}

console.log(`\n@gold is now ${getProperty(engine, "@gold")}`);

// Save/load round-trip (play-helpers): the property state survives.
const save = serializeState(engine);
const restored = new Engine(bundle);
deserializeState(restored, save);
console.log(`@gold after save -> load = ${getProperty(restored, "@gold")}`);

// Runtime property write (play-helpers): a host can push state into the engine.
setProperties(restored, { "@gold": 99 });
console.log(`@gold after setProperties = ${getProperty(restored, "@gold")}`);
