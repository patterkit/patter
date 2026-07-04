// ---------------------------------------------------------------------------
// @patterkit/play-helpers - the Patterplay JS companion.
//
// Thin game-integration helpers around @patterkit/runtime's Engine: save/load
// serialisation, runtime property setters, a state logger, and the live-debug
// link. None are required to play a bundle - they smooth the common host wiring
// (localStorage saves, pushing game state into dialogue, debugging what changed,
// streaming the cursor to Patterpad's live debugger).
// ---------------------------------------------------------------------------

export { SAVE_SCHEMA, saveState, loadState, serializeState, deserializeState } from "./save.js";
export type { SaveEnvelope } from "./save.js";

export { getProperty, setProperty, setProperties } from "./properties.js";
export type { PropertyValue } from "./properties.js";

export { snapshotState, diffState, createStateLogger } from "./logger.js";
export type { StateSnapshot, StateChange, StateValue, StateLogger, StateLoggerOptions } from "./logger.js";

export { createDebugLink } from "./debug.js";
export type { DebugLink, DebugLinkOptions, DebugSocketLike } from "./debug.js";

export { applyLiveBundle } from "./refresh.js";
export type { LiveBundleResult } from "./refresh.js";

export { createPropertyInspector } from "./inspector.js";
export type { PropertyInspector, PropertyInspectorOptions } from "./inspector.js";

export { createAudioResolver } from "./audio.js";
export type { AudioResolver } from "./audio.js";
