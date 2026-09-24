// ---------------------------------------------------------------------------
// @patterkit/compiler - compile condition/effect expressions, validate them,
// and export source to the runtime bundle.
// ---------------------------------------------------------------------------

export { compileExpression, validateConditions, validateInterpolation } from "./expressions.js";
export type { ConditionIssue, ValidateOptions } from "./expressions.js";
export { hostScopesToSpec, EXTERNAL_SCOPES } from "@patterkit/dialect";
export { exportBundle } from "./export.js";
export type { ExportInput } from "./export.js";
export { projectScopes, externalGameScopes, PATTER_SCOPE } from "./game-scopes.js";
export type { ProjectScopes, HostScopeNote } from "./game-scopes.js";
