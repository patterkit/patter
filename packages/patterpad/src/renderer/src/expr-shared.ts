// Shared builders for the visual expression editors (condition + effects). Turns the scene's
// ConditionProperty[] into the expr-editor's catalogue + ExpressionSchema, and exposes patter's
// dialect function templates. Kept separate so the condition and effects panels don't couple to
// each other's lifecycles.

import {
  callNode, strLit, numLit, binary, scopedVar, flagDelta,
  type FunctionTemplateSpec, type CatalogueEntry,
} from "@wildwinter/expr-editor";
import type { ExpressionSchema, PropertyMeta } from "@wildwinter/expr";
import type { ConditionProperty } from "../../shared/api.js";

/** The right-click menu a property pill offers (from-storylets/property-visibility): "where is this
 *  declared" and "who else touches it", the two questions a chip in an expression cannot answer by
 *  itself. The actions are the RENDERER's to run - it owns the settings dialog, the scene-props
 *  editor and the search window - so it registers them once at boot and every editor surface reads
 *  the same provider, rather than four call sites threading an option through their callers. */
export type PropertyAction = { label: string; run: () => void };
let provider: ((ref: { scope: string; name: string }) => PropertyAction[]) | null = null;
export const setPropertyActions = (fn: (ref: { scope: string; name: string }) => PropertyAction[]): void => { provider = fn; };
/** Stable to pass as an option: the editor opens a menu only when this returns items, so a pill
 *  right-clicked before the renderer has registered anything simply has no menu. */
export const propertyActions = (ref: { scope: string; name: string }): PropertyAction[] => provider?.(ref) ?? [];

/** Scope display order in the property picker (project globals first, then scene-locals). */
export const SCOPE_ORDER = ["patter", "scene"];

export const catalogueFrom = (props: ConditionProperty[]): CatalogueEntry[] =>
  // A quality's ladder goes in `stages`, its own channel since expr-editor 0.11.0. It used to ride
  // `enumValues`, which bought a value picker and nothing else: the editor could not tell a ladder
  // from a list, so it withheld the ordering operators and would not even offer the property as a
  // comparison subject. Passing the real thing is what turns "at or past a stage" into a clause a
  // writer can build.
  props.map((p) => ({
    scope: p.scope, name: p.name, type: p.type,
    ...(p.enumValues ? { enumValues: p.enumValues } : {}),
    ...(p.stages ? { stages: p.stages } : {}),
    ...(p.purpose ? { purpose: p.purpose } : {}),
  }));

export function schemaFrom(props: ConditionProperty[]): ExpressionSchema {
  const m = new Map<string, Map<string, PropertyMeta>>();
  for (const p of props) {
    let s = m.get(p.scope);
    if (!s) { s = new Map(); m.set(p.scope, s); }
    s.set(p.name.toLowerCase(), { type: p.type, enumValues: p.enumValues, stages: p.stages });
  }
  return { properties: m };
}

/** Patter's condition functions as insertable templates (args refined by clicking the pills). */
export function patterFunctions(cat: CatalogueEntry[]): FunctionTemplateSpec[] {
  const flags = cat.find((p) => p.type === "flags");
  // check_flags always appears (disabled when no flags property is declared) so the
  // option stays discoverable in the clause menu, which leads with it.
  const checkFlags: FunctionTemplateSpec = flags
    ? { name: "check_flags", label: "Check flags", hint: "check one or more flags on a flags property", wizard: "check_flags", build: () => callNode("check_flags", [scopedVar(flags.scope, flags.name), flagDelta("+", "")]) }
    : { name: "check_flags", label: "Check flags", hint: "requires a flags property", disabled: true, build: () => callNode("check_flags", [strLit(""), flagDelta("+", "")]) };
  return [
    checkFlags,
    // seen / visits are node-flavoured: insert, then pick the node via its pill.
    { name: "seen", label: "Node seen", hint: "a scene / block has been visited", build: () => callNode("seen", [strLit("")]) },
    { name: "visits", label: "Visit count", hint: "how many times a node was entered, vs a number", build: () => binary(">", callNode("visits", [strLit("")]), numLit(0)) },
    { name: "random", label: "Random chance", hint: "e.g. random(1, 6) is 1", wizard: "random", build: () => binary("==", callNode("random", [numLit(1), numLit(6)]), numLit(1)) },
  ];
}
