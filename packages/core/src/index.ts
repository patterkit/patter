// ---------------------------------------------------------------------------
// @patterkit/core - id generation, slug/hash helpers, canonical (de)serialisation,
// and the structural validator. Shared by the editor, CLI, and CI.
// ---------------------------------------------------------------------------

export { newId } from "./ids.js";
export { slug, hash4, hash32 } from "./handle.js";
// The game-id (address) helpers live in the shape layer (@patterkit/model); re-exported here so
// editor / CLI / CI keep importing addressing helpers from @patterkit/core alongside ids.
export { gameIdify, isValidGameId, effectiveGameId } from "@patterkit/model";
export { humanizeNodeRefs } from "./noderefs.js";
// Audio take stamps (the text hash a take was made from, and Placeholder Speech's request hash), kept in the WAV
// Placeholder Speech's voices: the curated Standard and HD voices per accent and the default a name hashes to
export { PLACEHOLDER_ACCENTS, PLACEHOLDER_HD_ACCENTS, placeholderAccent, placeholderVoiceTier, accentForLanguage, defaultPlaceholderVoice, describePlaceholderVoice } from "./placeholder-voices.js";
export type { PlaceholderAccent, PlaceholderVoice, PlaceholderTier, VoiceGender } from "./placeholder-voices.js";
export { textHash, readInfoChunks, readTextStamp, readGeneratedStamp, infoListChunk, withStamps, isWav, TEXT_STAMP, GENERATED_STAMP } from "./take-stamp.js";
export { parseSource, canonicalStringify } from "./serialize.js";
export type { StringifyOptions } from "./serialize.js";
export { validateProject } from "./validate.js";
// Content that can never run (after a jump, or behind a branch child that always wins): validate warns, coverage reads it
export { neverRunNodes } from "./never-runs.js";
export type { NeverRuns, RunTreeNode } from "./never-runs.js";
// A stub scene another tool can hand a writer (Storyletter, for a card with no scene yet)
export { planProject, planScene } from "./scene-scaffold.js";
export type { SceneScaffold, ScenePlanTarget, ScenePlan } from "./scene-scaffold.js";
export type { ValidationIssue, ProjectInput } from "./validate.js";
