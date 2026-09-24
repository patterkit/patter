// A project's host scopes (#159) as the expression editors see them. A host scope is a scope the
// project does not own and the game (or another engine) provides: `@world`, or `@story` imported
// from the Storylet Engine's published spec. Its declared properties join the editors' catalogue
// like any other; a scope declared with no properties is opaque, so its token is known to the
// parser and its names are unchecked. Shared by the main process (a scene's properties) and the
// renderer (the same list rebuilt after a settings save), so the two cannot disagree.

import type { HostScopeRegistry } from "@patterkit/model";
import type { ConditionProperty } from "./api.js";

/** Every declared property of every host scope, as condition-editor properties. */
export function hostScopeProperties(registry: HostScopeRegistry | undefined): ConditionProperty[] {
  const out: ConditionProperty[] = [];
  for (const scope of registry?.scopes ?? []) {
    for (const d of scope.declarations ?? []) {
      out.push({
        scope: scope.token, name: d.name, type: d.type,
        ...(d.values ? { enumValues: d.values } : {}),
        ...(d.stages ? { stages: d.stages } : {}),
        ...(d.purpose ? { purpose: d.purpose } : {}),
      });
    }
  }
  return out;
}

/** Every host scope's token, declared or opaque: the editors' parser must know them all. */
export const hostScopeTokens = (registry: HostScopeRegistry | undefined): string[] =>
  (registry?.scopes ?? []).map((s) => s.token);
