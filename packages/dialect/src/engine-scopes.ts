// GENERATED - vendored from expr/family/engine-scopes.json by scripts/sync-conformance.mjs.
// Do not edit here; edit the shared list and re-run the script.

/** Every engine's game-wide scope token across the family. A compiler accepts every token here
 *  that is not its own engine's, unchecked: the other engine owns those names and types. */
export interface EngineScope {
  token: string;
  engine: string;
  means: string;
}

export const ENGINE_SCOPES: readonly EngineScope[] = [
  { token: "patter", engine: "Patterplay", means: "Patter's shared globals" },
  { token: "story", engine: "Storylet Engine", means: "the Storylet Engine's shared @story properties" },
];
