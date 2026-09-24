// A project's host scopes (#159) as the expression editors see them. A host scope is a scope the
// project does not own and the game (or another engine) provides: `@world`, or `@story` imported
// from the Storylet Engine's published spec. Its declared properties join the editors' catalogue
// like any other; a scope declared with no properties is opaque, so its token is known to the
// parser and its names are unchecked. Shared by the main process (a scene's properties) and the
// renderer (the same list rebuilt after a settings save), so the two cannot disagree.
//
// Where the game has a shared scopes folder (`game-scopes/`), every other tool's scopes join too,
// with who declares each in the tip, and the folder's declarations win over a host scope of the same
// token: the shared file is the source, the project's copy the fallback.

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

/** One property from the game's scopes folder (scoperegistry's `ScopesCatalogueEntry`, structurally). */
export interface GameScopeEntry {
  scope: string;
  name: string;
  type: ConditionProperty["type"];
  enumValues?: string[];
  stages?: string[];
  purpose?: string;
  /** Who declares it ("Storylet Engine", "Game"). */
  owner: string;
}

/** The folder's properties as condition-editor properties: the owner leads the tip, then the author's note. */
export function gameScopeProperties(entries: readonly GameScopeEntry[]): ConditionProperty[] {
  return entries.map((e) => {
    const tip = e.owner && e.purpose ? `${e.owner}: ${e.purpose}` : e.owner || e.purpose;
    return {
      scope: e.scope, name: e.name, type: e.type,
      ...(e.enumValues ? { enumValues: e.enumValues } : {}),
      ...(e.stages ? { stages: e.stages } : {}),
      ...(tip ? { purpose: tip } : {}),
    };
  });
}

/**
 * The scopes the editors know besides `@patter` and `@scene`: the host scopes' properties and the
 * folder's, with the folder winning for a token both declare; and every token either names.
 */
export function editorScopes(
  registry: HostScopeRegistry | undefined,
  folder: { entries: readonly GameScopeEntry[]; tokens: readonly string[] } = { entries: [], tokens: [] },
): { properties: ConditionProperty[]; tokens: string[] } {
  const shared = new Set(folder.tokens);
  const own = hostScopeProperties(registry).filter((p) => !shared.has(p.scope));
  const tokens = [...new Set([...hostScopeTokens(registry), ...folder.tokens])];
  return { properties: [...own, ...gameScopeProperties(folder.entries)], tokens };
}
