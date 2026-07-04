// The condition editor panel: mounts @wildwinter/expr-editor in a floating panel anchored to the
// inspector's Condition row. It lives at the body level so it survives the inspector's re-renders
// (the inspector rebuilds on every selection / edit). Builds the editor's schema + catalogue from the
// scene's properties (ConditionProperty[]) and passes patter's dialect + the patter function templates.

import { mountExpressionEditor, renderConditionPreview, type ExpressionEditorHandle } from "@wildwinter/expr-editor";
import { patterDialect } from "@patterkit/dialect";
import type { ConditionProperty } from "../../shared/api.js";
import { SCOPE_ORDER, catalogueFrom, schemaFrom, patterFunctions } from "./expr-shared.js";
import { openAnchoredPanel, type AnchoredPanel } from "./dom.js";

/** A read-only PILL rendering of a condition (name-form `src`), for the inspector's Condition row -
 *  the same pills the editor shows, so non-coders read pills everywhere. `nodeLabel` resolves
 *  seen()/visits() node ids to readable names. */
export function renderConditionPills(src: string, properties: ConditionProperty[], nodeLabel?: (id: string) => string): HTMLElement {
  const cat = catalogueFrom(properties);
  return renderConditionPreview(src, { schema: schemaFrom(properties), dialect: patterDialect, catalogue: cat, scopeOrder: SCOPE_ORDER, ...(nodeLabel ? { nodeLabel } : {}) });
}

let active: AnchoredPanel | null = null;
let handle: ExpressionEditorHandle | null = null;

export function closeConditionEditor(): void {
  active?.close();
}

/** Flip an open condition editor between pills and raw text (the inspector's global toggle). No-op
 *  when nothing is open. Does NOT close the panel - the toggle re-themes it in place. */
export function setConditionEditorText(on: boolean): void {
  handle?.setText(on);
}

export function openConditionEditor(opts: {
  anchor: HTMLElement; src: string; properties: ConditionProperty[]; onChange: (src: string) => void;
  /** Start in raw-text mode (the inspector's global pills/text toggle drives this). */
  text?: boolean;
  /** Open the scene/block picker for a seen()/visits() node arg (handed the chosen node id). */
  pickNode?: (anchor: HTMLElement, current: string, onPick: (id: string) => void) => void;
  /** Resolve a node id to its readable label for the node pill. */
  nodeLabel?: (id: string) => string;
}): void {
  const cat = catalogueFrom(opts.properties);
  // The node picker (.target-picker) is body-appended outside the panel; the global pills/text toggle
  // (.insp-textmode-toggle) re-themes the panel in place. Neither should close it.
  let myHandle: ExpressionEditorHandle | null = null;
  const panel = openAnchoredPanel({
    anchor: opts.anchor, className: "cond-editor", title: "Condition", width: 440,
    ignoreDown: ".exed-pop, .target-picker, .insp-textmode-toggle",
    deferEscape: ".exed-pop, .target-picker",
    // Runs AFTER the exit fade; guard the singletons so a panel opened meanwhile isn't clobbered.
    onClose: () => { myHandle?.destroy(); if (handle === myHandle) handle = null; if (active === panel) active = null; },
  });
  if (!panel) return; // re-clicked the same row: toggled closed
  active = panel;
  myHandle = mountExpressionEditor(panel.body, {
    value: opts.src,
    schema: schemaFrom(opts.properties),
    dialect: patterDialect,
    catalogue: cat,
    scopeOrder: SCOPE_ORDER,
    functions: patterFunctions(cat),
    mode: "tree",
    text: opts.text ?? false,
    nullLabel: "always", // an empty condition is "always" eligible
    ...(opts.pickNode ? { pickNode: opts.pickNode } : {}),
    ...(opts.nodeLabel ? { nodeLabel: opts.nodeLabel } : {}),
    onChange: opts.onChange,
  });
  handle = myHandle;
}
