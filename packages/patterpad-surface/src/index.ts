// ---------------------------------------------------------------------------
// @patterkit/patterpad-surface - Patterpad's structured-script editing surface
// (zone model, patterpad-zone-model.md). Framework-neutral: the schema, the
// model bridge to Patter source, real-shard load/save, character colour, and the
// pure cue-text helpers. The zone interaction layer (context, keystrokes, cue
// commit, decorations) is rebuilt over slices Z2-Z10 and re-exported as it lands.
// DOM-dependent node views live under web/.
// ---------------------------------------------------------------------------

export { patterSchema } from "./schema.js";
export { sceneToDoc, docToScene } from "./bridge.js";
export type { Strings } from "./bridge.js";
export {
  flowFromSource, sceneFromSource, localeFromSource, serializeFlow, serializeLocale, openScene, saveScene,
} from "./load.js";
export type { OpenedScene } from "./load.js";
export { context, zonesOf } from "./context.js";
export type { ZoneState, ZoneCtx, BeatCtx, NodeCtx, ZoneRole, BeatKind } from "./context.js";
export { arrowLeft, arrowRight, navKeymap } from "./navigation.js";
export { acceptCue, cueSuggestions } from "./cuezone.js";
export { openDirection, closeDirection, removeDirection } from "./direction.js";
export { enter, endBubble, prependLine } from "./lines.js";
export { backspace, deleteSelectionGuarded } from "./delete.js";
export { toggleLineType, flipToFreeText, promoteToDialogue } from "./linetype.js";
export { canInsertSpecial, insertJump, setSnippetJump, insertGameEvent, deleteAtomAt } from "./special.js";
export { insertChunk, unwrapGroup, deleteChunk, wrapInGroup, wrapChunk, canWrap, setGroupProps, setSnippetCondition, insertOption, insertOptionAfter, moveChunk, moveNodeTo, setBlockName, insertBlock, type GroupKind, type GroupPropsPatch } from "./groups.js";
export { hintsFor } from "./hints.js";
export type { Hint } from "./hints.js";
export { PALETTE, PALETTE_SIZE, colourIndex, colourFor } from "./colour.js";
