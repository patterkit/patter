// ---------------------------------------------------------------------------
// @patterkit/core - id generation, slug/hash helpers, canonical (de)serialisation,
// and the structural validator. Shared by the editor, CLI, and CI.
// ---------------------------------------------------------------------------

export { newId } from "./ids.js";
export { slug, hash4, hash32 } from "./handle.js";
// The game-id (address) helpers live in the shape layer (@patterkit/model); re-exported here so
// editor / CLI / CI keep importing addressing helpers from @patterkit/core alongside ids.
export { gameIdify, isValidGameId, effectiveGameId } from "@patterkit/model";
export { parseSource, canonicalStringify } from "./serialize.js";
export type { StringifyOptions } from "./serialize.js";
export { validateProject } from "./validate.js";
export type { ValidationIssue, ProjectInput } from "./validate.js";
