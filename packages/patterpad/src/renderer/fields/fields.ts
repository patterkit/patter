// The detached FIELDS window (Pattershot's brief, "a map of records edited in a helper window", H1 to H4): a
// map whose values are records (Pattershot's performance: a look, an expression and a gesture for each member
// of the cast on a line) is too big for the inspector's column, so it is edited here, as a grid, a row per key
// and a column per record field. The window follows the editor's selection, or stays on its node with Follow
// selection off. The editor owns the document: it sends what to show, and every edit goes back to it, where it
// lands as an undoable step as the inspector's do.
import "@patterkit/patterpad-surface/theme.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/controls.css"; // the grid and its cells
import "@wildwinter/app-shell/settings.css"; // the row's remove button is the family's `.shell-icon`, styled there
import "./fields.css";
import "@patterkit/patterpad-surface/fonts.css";

import { initTooltips, pinButton, selectionFollowButton, toolWindowHead } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/tool-window.css";
import { recordMapGrid, type RecordMapGrid, type ValueAdapter, type ValueDecl } from "@wildwinter/app-shell/value-rows";
import { applyTheme } from "../src/apply-theme.js";
import { el } from "../src/dom.js";
import type { FieldsGrid, FieldsWinState } from "../../shared/api.js";

initTooltips();

const api = window.patterFields!;
const host = document.getElementById("fields-host")!;

const KIND_WORD: Record<string, string> = { line: "line", text: "text", gameEvent: "game event", snippet: "snippet", option: "option", block: "block", scene: "scene" };

/** The cells' adapter, from what the editor sent: the functions themselves can't cross between windows. */
const adapterOf = (g: FieldsGrid): ValueAdapter => ({
  nodes: (kind) => g.nodes[kind] ?? [],
  list: (name) => g.lists[name],
  label: (kind, id) => g.labels[kind]?.[id],
});

/** The grids, kept across states by node and field, so a cell being edited keeps its focus. */
const grids = new Map<string, { grid: RecordMapGrid; holder: HTMLElement }>();

function render(state: FieldsWinState): void {
  if (!state.hasProject) { grids.clear(); host.replaceChildren(el("p", "fields-empty", "No project open.")); return; }
  if (state.node === null) { grids.clear(); host.replaceChildren(el("p", "fields-empty", state.hint || "Nothing to edit here.")); return; }
  const node = state.node;
  const head = el("p", "fields-node");
  head.append(el("span", "fields-node-kind", KIND_WORD[node.kind] ?? node.kind), node.label);
  if (state.grids.length === 0) {
    grids.clear();
    const word = KIND_WORD[node.kind] ?? node.kind;
    host.replaceChildren(head, el("p", "fields-empty", `This ${word} has nothing to edit here.${state.hint ? ` ${state.hint}` : ""}`));
    return;
  }
  const used = new Set<string>();
  const parts: HTMLElement[] = [head];
  if (state.readOnlyWhy) parts.push(el("p", "fields-lock", state.readOnlyWhy));
  for (const g of state.grids) {
    const key = `${node.id}\u0000${g.extension}\u0000${g.field}`;
    used.add(key);
    const disabled = state.readOnly || g.locked !== null;
    const opts = {
      decl: g.decl as unknown as ValueDecl, value: g.value, adapter: adapterOf(g), disabled,
      ...(disabled ? {} : { onCommit: (v: unknown) => api.commit(node.id, g.extension, g.field, v) }),
    };
    let had = grids.get(key);
    if (had) had.grid.update(opts);
    else {
      const grid = recordMapGrid(opts);
      const holder = el("section", "fields-grid");
      had = { grid, holder };
      grids.set(key, had);
    }
    const cap = el("h2", "fields-cap", `${g.extensionName}: ${g.decl.label ?? g.decl.name}`);
    const lock = g.locked ? [el("p", "fields-lock", g.locked)] : [];
    had.holder.replaceChildren(cap, ...lock, had.grid.el);
    parts.push(had.holder);
  }
  for (const k of [...grids.keys()]) if (!used.has(k)) grids.delete(k);
  host.replaceChildren(...parts);
}

const pin = pinButton({ pinned: true, onToggle: (on) => api.setPin(on) });
const follow = selectionFollowButton({ on: true, onToggle: (on) => api.setFollow(on) });
document.body.prepend(toolWindowHead({ title: "Fields", trail: [follow.el], pin, onClose: () => api.close() }));
api.onPin((on) => pin.set(on));
api.onTheme((t) => applyTheme(t));
// A state can land before the boot info does: the newer one wins.
let fresh = false;
api.onState((state) => { fresh = true; render(state); });
// A different project under the window: what it shows is the old one's until the editor sends again.
api.onProject(() => { void api.info().then((info) => render(info.state)); });

void (async () => {
  const info = await api.info();
  applyTheme(info.theme);
  pin.set(info.pinned);
  follow.set(info.follow);
  if (!fresh) render(info.state);
})();
