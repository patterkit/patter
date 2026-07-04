// ---------------------------------------------------------------------------
// @patterkit/compiler - compile condition/effect expressions, validate them,
// and export source to the runtime bundle.
// ---------------------------------------------------------------------------

export { compileExpression, validateConditions, validateInterpolation } from "./expressions.js";
export type { ConditionIssue } from "./expressions.js";
export { hostScopesToSpec } from "@patterkit/dialect";
export { exportBundle } from "./export.js";
export type { ExportInput } from "./export.js";
