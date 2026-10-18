// The Game Data field-definition editor (Project Settings > Game Data tab). Author-defined custom
// fields are declared PER NODE TYPE, so the node kinds (scene / block / snippet / dialogue / text /
// action) sit in their own rail of tabs; the selected kind shows its field list. Each field has a
// name, a type from the family's one list (text, multiline, number, boolean, enum, flags, quality), an
// optional default + purpose, a tag-style list of allowed values for an enum or flags, and the ladder,
// in order, for a quality. Edits mutate a local copy; the caller reads value() on save (sparse: blank
// fields / empty kinds are pruned), and stageRenames() for the stages renamed in place, whose node
// values the save carries in the same batch.

import type { GameDataField, GameDataFields, GameDataFieldType, GameDataNodeKind } from "@patterkit/model";
import type { StageRenameDto } from "../../shared/api.js";
import { el } from "./dom.js";
import { iconBtn, labelled, moveItem, tagChips, stageChips, defaultControl, dupGuard, expandableRow, focusNewRow } from "@wildwinter/app-shell";

const KINDS: Array<{ kind: GameDataNodeKind; label: string }> = [
  { kind: "scene", label: "Scene" }, { kind: "block", label: "Block" }, { kind: "snippet", label: "Snippet" },
  { kind: "line", label: "Dialogue" }, { kind: "text", label: "Text" }, { kind: "gameEvent", label: "Game Event" },
];
// The family's field types, in Storyletter's Card template order and words (patterkit design/family-parity-2026-10.md
// item 9).
const TYPES: Array<[GameDataFieldType, string]> = [
  ["text", "Text"], ["multiline", "Text (multiline)"], ["number", "Number"], ["boolean", "True / False"], ["enum", "List"],
  ["flags", "Flags"], ["quality", "Quality"],
];

export interface GameDataFieldsHandle {
  /** The current edited field defs as a clean, serialisable copy (blank fields + empty kinds pruned). */
  value(): GameDataFields;
  /** The first duplicate-named field anywhere (switching to its node-kind tab so it's visible), or null. */
  firstDuplicate(): HTMLInputElement | null;
  /** The quality stages renamed in place since the dialog opened, in order: the save carries each into the
   *  node values that name it. */
  stageRenames(): StageRenameDto[];
}


export function mountGameDataFields(host: HTMLElement, initial: GameDataFields): GameDataFieldsHandle {
  const state: GameDataFields = structuredClone(initial ?? {}); // never mutate the caller's object
  let activeKind: GameDataNodeKind = "scene";
  const fieldsOf = (kind: GameDataNodeKind): GameDataField[] => (state[kind] ??= []);
  const guard = dupGuard();
  const renames: StageRenameDto[] = [];
  // Names are unique PER node kind. Only the active kind is in the DOM, so find the first kind whose data
  // has a clash (for the save gate to jump to).
  const kindWithDup = (): GameDataNodeKind | null => {
    for (const { kind } of KINDS) {
      const seen = new Set<string>();
      for (const f of state[kind] ?? []) { const k = f.name.trim().toLowerCase(); if (!k) continue; if (seen.has(k)) return kind; seen.add(k); }
    }
    return null;
  };

  // The default control is the shell's (`defaultControl`, typed: a real boolean / number in the model). A
  // multiline field's default is a one-line text field, as it always was. The row itself stays hand-built:
  // a game-data field name is the host's word and takes none of the property-name rules the shell list binds.
  const fieldRow = (f: GameDataField, i: number, fields: GameDataField[]): HTMLElement => {
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "Field name"; name.value = f.name; name.spellcheck = false;
    name.addEventListener("input", () => { f.name = name.value; });
    guard.track(name);

    const type = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of TYPES) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === f.type) o.selected = true; type.append(o); }
    type.addEventListener("change", () => {
      f.type = type.value as GameDataFieldType;
      delete f.default;                       // a default rarely survives a type change - reset it
      if (f.type === "enum" || f.type === "flags") f.values ??= []; else delete f.values;
      if (f.type === "quality") f.stages ??= []; else delete f.stages;
      render();                    // re-render: the default + values controls depend on type
    });

    // Default on the line; rebuilt in place when enum values change so the new options become selectable.
    // A field's enum may hold none chosen (""), which "(none)" writes; blank gives no default, the type's.
    const dfltOpts = { typed: true, noneChosen: true } as const;
    let dflt = defaultControl(f, undefined, dfltOpts);
    const refreshDefault = (): void => { const fresh = defaultControl(f, undefined, dfltOpts); dflt.replaceWith(fresh); dflt = fresh; };

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move up", () => { moveItem(fields, i, -1); render(); }, i === 0),
      iconBtn("down", "Move down", () => { moveItem(fields, i, 1); render(); }, i === fields.length - 1),
      iconBtn("close", "Delete field", () => { fields.splice(i, 1); render(); }, false, true),
    );

    const purpose = el("input", "gd-input") as HTMLInputElement;
    purpose.type = "text"; purpose.placeholder = "What this field is for"; purpose.value = f.purpose ?? "";
    purpose.addEventListener("input", () => { f.purpose = purpose.value.trim() || undefined; });
    const details: HTMLElement[] = [];
    if (f.type === "enum" || f.type === "flags") details.push(labelled("Values", tagChips(f, refreshDefault)));
    // A quality's ladder, IN ORDER (position is the meaning). A stage renamed in place carries every node's
    // value that names it, at save; no expression reads game data, so a reorder changes no gate.
    if (f.type === "quality") {
      const kind = activeKind;
      details.push(labelled("Stages (in order)", stageChips(f, refreshDefault, {
        onRename: (from, to) => {
          if (f.default === from) f.default = to;
          refreshDefault();
          if (f.name.trim()) renames.push({ scope: "gameData", gameData: kind, name: f.name.trim(), from, to });
        },
      })));
    }
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
    if (!fields.length) list.append(el("p", "empty", "No game-data fields on this node type yet."));
    else fields.forEach((f, i) => list.append(fieldRow(f, i, fields)));
    host.append(list);
    guard.check();

    const add = el("button", "gd-add", "+ Add field"); add.type = "button";
    add.addEventListener("click", () => { fields.push({ name: "", type: "text" }); render(); focusNewRow(host.querySelector<HTMLElement>(".gd-fieldlist")); });
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
    stageRenames(): StageRenameDto[] {
      return [...renames];
    },
    value(): GameDataFields {
      const out: GameDataFields = {};
      for (const { kind } of KINDS) {
        const fields = (state[kind] ?? [])
          .filter((f) => f.name.trim())
          .map((f): GameDataField => {
            const c: GameDataField = { name: f.name.trim(), type: f.type };
            if (f.default !== undefined) c.default = f.default;
            if ((f.type === "enum" || f.type === "flags") && f.values?.length) c.values = [...f.values];
            if (f.type === "quality" && f.stages) c.stages = [...f.stages];
            if (f.purpose) c.purpose = f.purpose;
            return c;
          });
        if (fields.length) out[kind] = fields;
      }
      return out;
    },
  };
}
