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
export type {
  StepResult, AdvanceToStopResult, ChoiceOption, EngineOptions, OpenFlowOptions, WorldResolver, PropertyRow,
  EngineSave, SaveGame, FlowSnapshot, SelectorSnapshot, SavedChoice, StackFrame,
  BeatInfo, OutlineNode, OutlineBlock, OutlineScene, FlatBeat,
} from "./engine.js";

// gameData read helpers (sparse overrides + field-default merge).
export { gameDataFields, gameDataValue, effectiveGameData } from "./gamedata.js";

// Author tags (#215): accumulated node-tag index (also surfaced via Engine.tagsFor* + step.tags).
export { buildTagIndex } from "./tags.js";
