// ---------------------------------------------------------------------------
// @patterkit/runtime - public surface.
//
// The reference runtime. Construct an `Engine` from a compiled Bundle (the world
// + flow manager: shared scope state, foreign scopes, whole-game save/load), then
// `engine.openFlow(id, { scene })` to get a `Flow` and play it (advance / choices
// / properties). Many flows run concurrently, sharing the shared `@patter`/`@scene`
// state, each with its own per-flow half + cursor + PRNG.
// ---------------------------------------------------------------------------

export { Engine, Flow } from "./engine.js";
// The compiled-bundle type the Engine constructor consumes (from the shared model), so hosts can
// type a parsed .patterc without depending on @patterkit/model directly.
export type { Bundle } from "@patterkit/model";
// The examiner row listProperties() returns, for the same reason: it is the shared kernel's
// (@wildwinter/scoperegistry, the property implementation both product families use), and a
// host typing a row should not have to depend on the kernel to name it.
export type { PropertyRow } from "@wildwinter/scoperegistry";
export type {
  StepResult, AdvanceToStopResult, ChoiceOption, EngineOptions, OpenFlowOptions, WorldResolver,
  EngineSave, SaveGame, FlowSnapshot, SelectorSnapshot, SavedChoice, StackFrame,
  BeatInfo, OutlineNode, OutlineBlock, OutlineScene, FlatBeat,
  TraceEvent, TraceHandler, EngineTraceHandler, LogEntry, EngineLogEntry,
} from "./engine.js";

// The bundle inspector's runtime half: what a game may call, read off the asset with no Engine.
export { describeBundle } from "./describe.js";
export type {
  BundleDescription, BundleIdentity, AddressSummary, HostScopeSummary,
  PropertySummary, OwnedProperties, GameDataSummary, GameDataFieldSummary, BundleCounts,
} from "./describe.js";

// gameData read helpers (sparse overrides + field-default merge).
export { gameDataFields, gameDataValue, effectiveGameData } from "./gamedata.js";

// Author tags (#215): accumulated node-tag index (also surfaced via Engine.tagsFor* + step.tags).
export { buildTagIndex } from "./tags.js";
