// The Game Data field-definition editor (Project Settings > Game Data tab). Author-defined custom
// fields are declared PER NODE TYPE, so the node kinds (scene / block / snippet / dialogue / text /
// action) sit in their own rail of tabs; the selected kind shows its field list. Each field has a
// name, a type, an optional default + purpose, and - for an enum - a tag-style list of allowed values
//. Edits mutate a local copy; the caller reads value() on save (sparse: blank
// fields / empty kinds are pruned).

import type { GameDataField, GameDataFields, GameDataFieldType, GameDataNodeKind } from "@patterkit/model";
import { el, iconBtn, labelled, moveItem, tagChips } from "./dom.js";
import { dupGuard, expandableRow, focusNewRow } from "./settings-list.js";

const KINDS: Array<{ kind: GameDataNodeKind; label: string }> = [
  { kind: "scene", label: "Scene" }, { kind: "block", label: "Block" }, { kind: "snippet", label: "Snippet" },
  { kind: "line", label: "Dialogue" }, { kind: "text", label: "Text" }, { kind: "gameEvent", label: "Game Event" },
];
const TYPES: Array<[GameDataFieldType, string]> = [
  ["text", "Text"], ["multiline", "Text (multiline)"], ["number", "Number"], ["boolean", "True / False"], ["enum", "List"],
];

export interface GameDataFieldsHandle {
  /** The current edited field defs as a clean, serialisable copy (blank fields + empty kinds pruned). */
  value(): GameDataFields;
  /** The first duplicate-named field anywhere (switching to its node-kind tab so it's visible), or null. */
  firstDuplicate(): HTMLInputElement | null;
}


export function mountGameDataFields(host: HTMLElement, initial: GameDataFields): GameDataFieldsHandle {
  const state: GameDataFields = structuredClone(initial ?? {}); // never mutate the caller's object
  let activeKind: GameDataNodeKind = "scene";
  const fieldsOf = (kind: GameDataNodeKind): GameDataField[] => (state[kind] ??= []);
  const guard = dupGuard();
  // Names are unique PER node kind. Only the active kind is in the DOM, so find the first kind whose data
  // has a clash (for the save gate to jump to).
  const kindWithDup = (): GameDataNodeKind | null => {
    for (const { kind } of KINDS) {
      const seen = new Set<string>();
      for (const f of state[kind] ?? []) { const k = f.name.trim().toLowerCase(); if (!k) continue; if (seen.has(k)) return kind; seen.add(k); }
    }
    return null;
  };

  /** A type-aware editor for the field's default value (empty/"unset" leaves it absent). */
  const defaultControl = (f: GameDataField): HTMLElement => {
    if (f.type === "boolean") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      for (const [v, l] of [["", "(unset)"], ["true", "True"], ["false", "False"]] as const) {
        const o = el("option", undefined, l) as HTMLOptionElement; o.value = v;
        if ((v === "true" && f.default === true) || (v === "false" && f.default === false)) o.selected = true;
        sel.append(o);
      }
      sel.addEventListener("change", () => { if (sel.value === "") delete f.default; else f.default = sel.value === "true"; });
      return sel;
    }
    if (f.type === "enum") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      const o0 = el("option", undefined, "(unset)") as HTMLOptionElement; o0.value = ""; sel.append(o0);
      for (const v of f.values ?? []) { const o = el("option", undefined, v) as HTMLOptionElement; o.value = v; if (f.default === v) o.selected = true; sel.append(o); }
      sel.addEventListener("change", () => { if (sel.value === "") delete f.default; else f.default = sel.value; });
      return sel;
    }
    const input = el("input", "gd-input gd-default") as HTMLInputElement;
    input.type = f.type === "number" ? "number" : "text";
    input.placeholder = "<default (optional)>";
    input.value = f.default == null ? "" : String(f.default);
    input.addEventListener("input", () => {
      const raw = input.value;
      if (raw === "") { delete f.default; }
      else f.default = f.type === "number" ? Number(raw) : raw;
     
    });
    return input;
  };

  const fieldRow = (f: GameDataField, i: number, fields: GameDataField[]): HTMLElement => {
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "<field name>"; name.value = f.name; name.spellcheck = false;
    name.addEventListener("input", () => { f.name = name.value; });
    guard.track(name);

    const type = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of TYPES) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === f.type) o.selected = true; type.append(o); }
    type.addEventListener("change", () => {
      f.type = type.value as GameDataFieldType;
      delete f.default;                       // a default rarely survives a type change - reset it
      if (f.type === "enum") f.values ??= []; else delete f.values;
      render();                    // re-render: the default + values controls depend on type
    });

    // Default on the line; rebuilt in place when enum values change so the new options become selectable.
    let dflt = defaultControl(f);
    const refreshDefault = (): void => { const fresh = defaultControl(f); dflt.replaceWith(fresh); dflt = fresh; };

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move up", () => { moveItem(fields, i, -1); render(); }, i === 0),
      iconBtn("↓", "move down", () => { moveItem(fields, i, 1); render(); }, i === fields.length - 1),
      iconBtn("✕", "delete field", () => { fields.splice(i, 1); render(); }, false, true),
    );

    const purpose = el("input", "gd-input") as HTMLInputElement;
    purpose.type = "text"; purpose.placeholder = "<what this field is for (shown as a hint)>"; purpose.value = f.purpose ?? "";
    purpose.addEventListener("input", () => { f.purpose = purpose.value.trim() || undefined; });
    const details: HTMLElement[] = [];
    if (f.type === "enum") details.push(labelled("Values", tagChips(f, refreshDefault)));
    details.push(labelled("Purpose", purpose));

    return expandableRow({ line: [name, type, dflt, acts], details });
  };

  const render = (): void => {
    guard.reset();
    host.replaceChildren();
    const tabs = el("div", "gd-kindtabs");
    for (const { kind, label } of KINDS) {
      const b = el("button", `gd-kindtab${kind === activeKind ? " active" : ""}`); b.type = "button";
      b.append(document.createTextNode(label));
      const n = state[kind]?.length ?? 0;
      if (n) b.append(el("span", "gd-kindcount", String(n)));
      b.addEventListener("click", () => { activeKind = kind; render(); });
      tabs.append(b);
    }
    host.append(tabs);

    const fields = fieldsOf(activeKind);
    const list = el("div", "gd-fieldlist");
    if (!fields.length) list.append(el("p", "gd-empty", "No game-data fields on this node type yet."));
    else fields.forEach((f, i) => list.append(fieldRow(f, i, fields)));
    host.append(list);
    guard.check();

    const add = el("button", "gd-add", "+ Add field"); add.type = "button";
    add.addEventListener("click", () => { fields.push({ name: "", type: "text" }); render(); focusNewRow(host.querySelector(".gd-fieldlist")); });
    host.append(add);
  };

  render();

  return {
    firstDuplicate(): HTMLInputElement | null {
      const kind = kindWithDup();
      if (!kind) return null;
      activeKind = kind; render(); // surface the clashing kind so its red field is on screen
      return guard.firstDuplicate();
    },
    value(): GameDataFields {
      const out: GameDataFields = {};
      for (const { kind } of KINDS) {
        const fields = (state[kind] ?? [])
          .filter((f) => f.name.trim())
          .map((f): GameDataField => {
            const c: GameDataField = { name: f.name.trim(), type: f.type };
            if (f.default !== undefined) c.default = f.default;
            if (f.type === "enum" && f.values?.length) c.values = [...f.values];
            if (f.purpose) c.purpose = f.purpose;
            return c;
          });
        if (fields.length) out[kind] = fields;
      }
      return out;
    },
  };
}
