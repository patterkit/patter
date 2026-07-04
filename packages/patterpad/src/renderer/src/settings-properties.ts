// The @patter global Properties editor (Project Settings > Properties tab). A flat list of property
// declarations - name, type, default, enum/flags values (tag chips), and a "Shared" flag (one world
// value vs per-flow). Mirrors the gameData field editor's shape. value() returns a clean list (blank
// names pruned) for the save round-trip.

import type { PropertyDecl, PropertyType, ScalarValue } from "@patterkit/model";
import { el, iconBtn, labelled, moveItem, tagChips } from "./dom.js";
import { dupGuard, expandableRow, focusNewRow } from "./settings-list.js";

const TYPES: Array<[PropertyType, string]> = [
  ["number", "Number"], ["boolean", "True / False"], ["string", "Text"], ["enum", "List"], ["flags", "Flags"],
];

export interface PropertiesHandle { value(): PropertyDecl[]; firstDuplicate(): HTMLInputElement | null; }


/** `scope` distinguishes project globals (@patter: default SHARED) from scene-local (@scene: default
 *  per-flow, plus a "reseed each entry" / temporary axis). */
export function mountProperties(host: HTMLElement, initial: PropertyDecl[], opts?: { scope?: "patter" | "scene" }): PropertiesHandle {
  const scope = opts?.scope ?? "patter";
  const sharedDefault = scope === "patter"; // @patter globals default shared; @scene props default per-flow
  const state: PropertyDecl[] = structuredClone(initial ?? []);
  const guard = dupGuard();

  const defaultControl = (p: PropertyDecl): HTMLElement => {
    if (p.type === "boolean") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      for (const [v, l] of [["", "(unset)"], ["true", "True"], ["false", "False"]] as const) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if ((v === "true" && p.default === true) || (v === "false" && p.default === false)) o.selected = true; sel.append(o); }
      sel.addEventListener("change", () => { if (sel.value === "") delete p.default; else p.default = sel.value === "true"; });
      return sel;
    }
    if (p.type === "enum") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      const o0 = el("option", undefined, "(unset)") as HTMLOptionElement; o0.value = ""; sel.append(o0);
      for (const v of p.values ?? []) { const o = el("option", undefined, v) as HTMLOptionElement; o.value = v; if (p.default === v) o.selected = true; sel.append(o); }
      sel.addEventListener("change", () => { if (sel.value === "") delete p.default; else p.default = sel.value; });
      return sel;
    }
    if (p.type === "flags") {
      // Flags hold a SET of values (any number on at once), so there's no single default value: a flags
      // property starts empty. (Toggle flags in effects with set_flags().)
      const s = el("span", "gd-flagnote", "starts empty");
      s.dataset.tip = "A flags property begins with no flags set; turn them on in effects with set_flags().";
      return s;
    }
    const input = el("input", "gd-input gd-default") as HTMLInputElement;
    input.type = p.type === "number" ? "number" : "text"; input.placeholder = "<default (optional)>";
    input.value = p.default == null ? "" : String(p.default);
    input.addEventListener("input", () => { const raw = input.value; if (raw === "") delete p.default; else p.default = (p.type === "number" ? Number(raw) : raw) as ScalarValue; });
    return input;
  };

  const propRow = (p: PropertyDecl, i: number): HTMLElement => {
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "<property name>"; name.value = p.name; name.spellcheck = false;
    name.addEventListener("input", () => { p.name = name.value; });
    guard.track(name);

    const type = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of TYPES) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === p.type) o.selected = true; type.append(o); }
    type.addEventListener("change", () => {
      p.type = type.value as PropertyType; delete p.default;
      if (p.type === "enum" || p.type === "flags") p.values ??= []; else delete p.values;
      render();
    });

    // Default control on the line; rebuilt in place when enum/flags values change (so a new list's values
    // become selectable as the default).
    let dflt = defaultControl(p);
    const refreshDefault = (): void => { const fresh = defaultControl(p); dflt.replaceWith(fresh); dflt = fresh; };

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move up", () => { moveItem(state, i, -1); render(); }, i === 0),
      iconBtn("↓", "move down", () => { moveItem(state, i, 1); render(); }, i === state.length - 1),
      iconBtn("✕", "delete property", () => { state.splice(i, 1); render(); }, false, true),
    );

    // Secondary fields behind the ▸ expander: Shared / (Temporary) / enum-or-flags Values / Purpose.
    const shared = el("input", "insp-check") as HTMLInputElement;
    shared.type = "checkbox"; shared.checked = p.shared ?? sharedDefault;
    shared.addEventListener("change", () => { if (shared.checked === sharedDefault) delete p.shared; else p.shared = shared.checked; });
    const sharedLabel = el("label", "gd-labelled gd-shared"); sharedLabel.dataset.tip = "Shared: one value across all flows. Off = a separate value per flow.";
    sharedLabel.append(shared, el("span", undefined, "Shared"));

    const details: HTMLElement[] = [sharedLabel];
    if (scope === "scene") { // reseed-each-entry (temporary) only meaningful on a scene-local property
      const temp = el("input", "insp-check") as HTMLInputElement;
      temp.type = "checkbox"; temp.checked = p.temporary ?? false;
      temp.addEventListener("change", () => { if (temp.checked) p.temporary = true; else delete p.temporary; });
      const tl = el("label", "gd-labelled gd-shared"); tl.dataset.tip = "Temporary: the value resets to its default every time the scene is entered (Ink's temp).";
      tl.append(temp, el("span", undefined, "Temporary")); details.push(tl);
    }
    if (p.type === "enum" || p.type === "flags") details.push(labelled("Values", tagChips(p, refreshDefault)));
    const purpose = el("input", "gd-input") as HTMLInputElement;
    purpose.type = "text"; purpose.placeholder = "<what this property is for (a note for your team)>"; purpose.value = p.purpose ?? "";
    purpose.addEventListener("input", () => { p.purpose = purpose.value.trim() || undefined; });
    details.push(labelled("Purpose", purpose));

    return expandableRow({ line: [name, type, dflt, acts], details });
  };

  const render = (): void => {
    guard.reset();
    host.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!state.length) list.append(el("p", "gd-empty", scope === "scene" ? "No scene properties yet." : "No global properties yet."));
    else state.forEach((p, i) => list.append(propRow(p, i)));
    host.append(list);
    guard.check();
    const add = el("button", "gd-add", "+ Add property"); add.type = "button";
    add.addEventListener("click", () => { state.push({ name: "", type: "number" }); render(); focusNewRow(host.querySelector(".gd-fieldlist")); });
    host.append(add);
  };
  render();

  return {
    firstDuplicate: () => guard.firstDuplicate(),
    value(): PropertyDecl[] {
      return state.filter((p) => p.name.trim()).map((p): PropertyDecl => {
        const c: PropertyDecl = { name: p.name.trim(), type: p.type };
        if (p.default !== undefined) c.default = p.default;
        if ((p.type === "enum" || p.type === "flags") && p.values?.length) c.values = [...p.values];
        if (p.shared !== undefined) c.shared = p.shared;
        if (scope === "scene" && p.temporary) c.temporary = true;
        if (p.purpose) c.purpose = p.purpose;
        return c;
      });
    },
  };
}
