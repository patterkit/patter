// The effects editor panel: mounts @wildwinter/expr-editor's mountEffectsEditor in a floating panel
// anchored to the inspector's Effects row. A snippet has two effect phases - On enter / On exit -
// so the panel shows a section per phase, each its own list of set / emit effects whose values are
// full pill/tree expressions. Lives at the body level so it survives inspector re-renders. onChange
// writes the edited phase straight back through the surface.

import { mountEffectsEditor, renderEffectsPreview, type EffectsEditorHandle, type EditorEffect } from "@wildwinter/expr-editor";
import { patterDialect } from "@patterkit/dialect";
import type { ConditionProperty } from "../../shared/api.js";
import { SCOPE_ORDER, catalogueFrom, schemaFrom, patterFunctions } from "./expr-shared.js";
import { el, openAnchoredPanel, type AnchoredPanel } from "./dom.js";

export type Phase = "onEnter" | "onExit";

/** A snippet effect as it arrives from the inspector. SET-ONLY (spec §15): an effect is a property
 *  mutation; host event emission rides on gameData, not effects. */
export interface ModelEffect { kind: "set"; target?: string; value?: string; }

/** Normalise a model Effect into the editor's EditorEffect. */
const toEditor = (e: ModelEffect): EditorEffect => ({ kind: "set", target: e.target ?? "", value: e.value ?? "" });

/** A read-only PILL rendering of an effects list, for the inspector's On enter / On exit rows -
 *  matching the editor's pills. `nodeLabel` resolves any node references in values. */
export function renderEffectsPills(effects: ModelEffect[], properties: ConditionProperty[], nodeLabel?: (id: string) => string): HTMLElement {
  const cat = catalogueFrom(properties);
  return renderEffectsPreview(effects.map(toEditor), { schema: schemaFrom(properties), dialect: patterDialect, catalogue: cat, scopeOrder: SCOPE_ORDER, ...(nodeLabel ? { nodeLabel } : {}) });
}

let active: AnchoredPanel | null = null;
let handles: EffectsEditorHandle[] = [];

export function closeEffectsEditor(): void {
  active?.close();
}

/** Flip an open effects editor's inline value editors between pills and raw text (global toggle). */
export function setEffectsEditorText(on: boolean): void {
  for (const h of handles) h.setText(on);
}

export function openEffectsEditor(opts: {
  anchor: HTMLElement;
  onEnter: ModelEffect[];
  onExit: ModelEffect[];
  properties: ConditionProperty[];
  /** Scope the panel to a single phase (the inspector opens On enter / On exit separately). Omit for both. */
  phase?: Phase;
  /** Start each inline value editor in raw-text mode (the inspector's global toggle drives this). */
  text?: boolean;
  /** Persist a phase's edited effect list (the renderer saves + re-validates). */
  onChange: (phase: Phase, effects: EditorEffect[]) => void;
}): void {
  const cat = catalogueFrom(opts.properties);
  const schema = schemaFrom(opts.properties);
  const fns = patterFunctions(cat);

  const title = opts.phase === "onEnter" ? "On begin" : opts.phase === "onExit" ? "On end" : "Effects";
  // The global pills/text toggle (.insp-textmode-toggle) flips the value editors in place (setEffectsEditorText), so a click on it must not close the panel.
  const myHandles: EffectsEditorHandle[] = [];
  const panel = openAnchoredPanel({
    anchor: opts.anchor, className: "cond-editor effects-editor", title, width: 380,
    ignoreDown: ".exed-pop, .insp-textmode-toggle", deferEscape: ".exed-pop",
    // Runs AFTER the exit fade; guard the singletons so a panel opened meanwhile isn't clobbered.
    onClose: () => { for (const h of myHandles) h.destroy(); if (handles === myHandles) handles = []; if (active === panel) active = null; },
  });
  if (!panel) return; // re-clicked the same row: toggled closed
  active = panel;
  handles = myHandles;

  const section = (label: string, phase: Phase, effects: ModelEffect[]): void => {
    const sec = el("div", "effects-section");
    sec.append(el("div", "effects-section-cap", label));
    const host = el("div", "effects-section-host");
    sec.append(host);
    panel.body.append(sec);
    myHandles.push(mountEffectsEditor(host, {
      effects: effects.map(toEditor),
      schema, dialect: patterDialect, catalogue: cat, scopeOrder: SCOPE_ORDER, functions: fns,
      allowEmit: false, // patter effects are set-only; emission rides on gameData (spec §15)
      text: opts.text ?? false,
      onChange: (next) => opts.onChange(phase, next),
    }));
  };
  if (opts.phase !== "onExit") section("On begin", "onEnter", opts.onEnter);
  if (opts.phase !== "onEnter") section("On end", "onExit", opts.onExit);
}
