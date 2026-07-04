// Compiles the shared demo vignette (examples/player/sample.ts) to a Bundle and
// hands it to gen.mjs, which writes it out as bundle.js for the drop-in page.
import { exportBundle } from "@patterkit/compiler";
import { demoInput } from "../player/sample.js";

export const bundle = exportBundle(demoInput);
