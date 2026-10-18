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
import { mountPropertyList, type PropertyListHandle } from "@wildwinter/app-shell";

const KINDS: Array<{ kind: GameDataNodeKind; label: string }> = [
  { kind: "scene", label: "Scene" }, { kind: "block", label: "Block" }, { kind: "snippet", label: "Snippet" },
  { kind: "line", label: "Dialogue" }, { kind: "text", label: "Text" }, { kind: "gameEvent", label: "Game Event" },
];
// The family's field types, in Storyletter's Card template order and words (patterkit design/family-parity-2026-10.md
// item 9).
const TYPES: ReadonlyArray<readonly [GameDataFieldType, string]> = [
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
  let list: PropertyListHandle | undefined;
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

  const render = (): void => {
    host.replaceChildren();
    const tabs = el("div", "gd-kindtabs");
    let activeCount: (() => void) | undefined;
    for (const { kind, label } of KINDS) {
      const b = el("button", `gd-kindtab${kind === activeKind ? " active" : ""}`); b.type = "button";
      b.append(document.createTextNode(label));
      const count = el("span", "gd-kindcount");
      const recount = (): void => { const n = state[kind]?.length ?? 0; count.textContent = String(n); if (n) b.append(count); else count.remove(); };
      recount();
      if (kind === activeKind) activeCount = recount;
      b.addEventListener("click", () => { activeKind = kind; render(); });
      tabs.append(b);
    }
    host.append(tabs);

    // The kind's fields are the shell's declaration list, as Settings' properties and Storyletter's Card
    // template are: one type list, purpose, values and the ordered ladder for free. A game-data field name is
    // the host's word, so the list takes any name and refuses only a duplicate.
    const kind = activeKind;
    const listHost = el("div", "gd-fieldlist");
    host.append(listHost);
    list = mountPropertyList(listHost, fieldsOf(kind), {
      noun: "field", names: "free", types: TYPES, typed: true,
      onChange: () => activeCount?.(),   // the tab's count follows an add or a delete
      // A field's enum may hold none chosen (""), which "(none)" writes; blank gives no default, the type's.
      noneChosen: true,
      addLabel: "+ Add field", emptyText: "No game-data fields on this node type yet.",
      newDecl: () => ({ name: "", type: "text" }),
      // A stage renamed in place carries every node's value that names it, at save; no expression reads game
      // data, so a reorder changes no gate.
      onStageRename: (f, from, to) => { if (f.name.trim()) renames.push({ scope: "gameData", gameData: kind, name: f.name.trim(), from, to }); },
    });
  };

  render();

  return {
    firstDuplicate(): HTMLInputElement | null {
      const kind = kindWithDup();
      if (!kind) return null;
      activeKind = kind; render(); // surface the clashing kind so its red field is on screen
      return list?.firstDuplicate() ?? null;
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
            if (f.purpose?.trim()) c.purpose = f.purpose.trim();
            return c;
          });
        if (fields.length) out[kind] = fields;
      }
      return out;
    },
  };
}
