// The condition editor panel: mounts @wildwinter/expr-editor in a floating panel anchored to the
// inspector's Condition row. It lives at the body level so it survives the inspector's re-renders
// (the inspector rebuilds on every selection / edit). Builds the editor's schema + catalogue from the
// scene's properties (ConditionProperty[]) and passes patter's dialect + the patter function templates.

import { mountExpressionEditor, renderConditionPreview, type ExpressionEditorHandle } from "@wildwinter/expr-editor";
import type { ConditionProperty } from "../../shared/api.js";
import { SCOPE_ORDER, OTHER_ENGINE_SCOPES, catalogueFrom, editorDialect, schemaFrom, patterFunctions, propertyActions } from "./expr-shared.js";
import { openPanel } from "./panel.js";
import type { AnchoredPanel } from "@wildwinter/app-shell";

/** A read-only PILL rendering of a condition (name-form `src`), for the inspector's Condition row -
 *  the same pills the editor shows, so non-coders read pills everywhere. `nodeLabel` resolves
 *  seen()/visits() node ids to readable names. */
export function renderConditionPills(src: string, properties: ConditionProperty[], nodeLabel?: (id: string) => string): HTMLElement {
  const cat = catalogueFrom(properties);
  return renderConditionPreview(src, { schema: schemaFrom(properties), dialect: editorDialect(), otherEngineScopes: OTHER_ENGINE_SCOPES, catalogue: cat, scopeOrder: SCOPE_ORDER, propertyActions, ...(nodeLabel ? { nodeLabel } : {}) });
}

let active: AnchoredPanel | null = null;

export function openConditionEditor(opts: {
  anchor: HTMLElement; src: string; properties: ConditionProperty[]; onChange: (src: string) => void;
  /** Open the scene/block picker for a seen()/visits() node arg (handed the chosen node id). */
  pickNode?: (anchor: HTMLElement, current: string, onPick: (id: string) => void) => void;
  /** Resolve a node id to its readable label for the node pill. */
  nodeLabel?: (id: string) => string;
}): void {
  const cat = catalogueFrom(opts.properties);
  // The node picker (.target-picker) is body-appended outside the panel, so a click in it must not close it.
  let myHandle: ExpressionEditorHandle | null = null;
  const panel = openPanel({
    anchor: opts.anchor, className: "cond-editor", title: "Condition", width: 440,
    ignoreDown: ".exed-pop, .target-picker",
    deferEscape: ".exed-pop, .target-picker",
    // Runs AFTER the exit fade; guard the singletons so a panel opened meanwhile isn't clobbered.
    onClose: () => { myHandle?.destroy(); if (active === panel) active = null; },
  });
  if (!panel) return; // re-clicked the same row: toggled closed
  active = panel;
  myHandle = mountExpressionEditor(panel.body, {
    value: opts.src,
    schema: schemaFrom(opts.properties),
    dialect: editorDialect(), otherEngineScopes: OTHER_ENGINE_SCOPES,
    catalogue: cat,
    scopeOrder: SCOPE_ORDER,
    functions: patterFunctions(cat),
    mode: "tree",
    nullLabel: "always", // an empty condition is "always" eligible
    propertyActions,
    ...(opts.pickNode ? { pickNode: opts.pickNode } : {}),
    ...(opts.nodeLabel ? { nodeLabel: opts.nodeLabel } : {}),
    onChange: opts.onChange,
  });
}
