// The @patter global Properties editor (the Properties document; also the scene-local @scene list). The
// list itself - name, type, default, values or stages, purpose, reorder, remove, add-then-focus and the
// duplicate / illegal-name gates - is the shell's `mountPropertyList` (ui-review-2026-09, finding 14):
// Storyletter's prop-list.ts was the same rows in the same order. What is Patterpad's is the model's
// TYPED default (`typed: true`), the Shared axis, and the Temporary axis a scene-local property adds.
// value() returns a clean list (blank names pruned) for the save round-trip.

import type { PropertyDecl } from "@patterkit/model";
import { el, mountPropertyList } from "@wildwinter/app-shell";

export interface PropertiesHandle {
  value(): PropertyDecl[];
  firstDuplicate(): HTMLInputElement | null;
  /** The first name no expression could reach, for the Save gate. Separate from
   *  `firstDuplicate` because the two faults have different words. */
  firstIllegalName(): HTMLInputElement | null;
}

/** A checkbox on the shell's labelled row, for the two axes the shell's list does not know about. */
function axis(label: string, tip: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
  const box = el("input", "insp-check"); box.type = "checkbox"; box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  const row = el("label", "shell-labelled gd-shared"); row.dataset["tip"] = tip;
  row.append(box, el("span", undefined, label));
  return row;
}

/** `scope` distinguishes project globals (@patter: default SHARED) from scene-local (@scene: default
 *  per-flow, plus a "reseed each entry" / temporary axis). */
export function mountProperties(host: HTMLElement, initial: PropertyDecl[], opts?: { scope?: "patter" | "scene" }): PropertiesHandle {
  const scope = opts?.scope ?? "patter";
  const sharedDefault = scope === "patter"; // @patter globals default shared; @scene props default per-flow
  const state: PropertyDecl[] = structuredClone(initial ?? []);

  const list = mountPropertyList<PropertyDecl>(host, state, {
    typed: true,
    emptyText: scope === "scene" ? "No scene properties yet." : "No global properties yet.",
    newDecl: () => ({ name: "", type: "number" }),
    // Behind the disclosure, before Values / Stages / Purpose: Shared, and Temporary for a scene property.
    extraDetails: (p) => [
      axis("Shared", "One value across all flows. Off gives each flow its own value.", p.shared ?? sharedDefault,
        (on) => { if (on === sharedDefault) delete p.shared; else p.shared = on; }),
      scope === "scene" // reseed-each-entry (temporary) only meaningful on a scene-local property
        ? axis("Temporary", "Resets to its default every time the scene is entered.", p.temporary ?? false,
          (on) => { if (on) p.temporary = true; else delete p.temporary; })
        : null,
    ],
  });

  return {
    firstDuplicate: () => list.firstDuplicate(),
    firstIllegalName: () => list.firstIllegalName(),
    value(): PropertyDecl[] {
      return state.filter((p) => p.name.trim()).map((p): PropertyDecl => {
        const c: PropertyDecl = { name: p.name.trim(), type: p.type };
        if (p.default !== undefined) c.default = p.default;
        if ((p.type === "enum" || p.type === "flags") && p.values?.length) c.values = [...p.values];
        if (p.type === "quality" && p.stages?.length) c.stages = [...p.stages];
        if (p.shared !== undefined) c.shared = p.shared;
        if (scope === "scene" && p.temporary) c.temporary = true;
        if (p.purpose) c.purpose = p.purpose;
        return c;
      });
    },
  };
}
