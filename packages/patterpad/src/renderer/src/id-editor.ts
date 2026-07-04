// The gameId (address) editor: a small floating popover with a text field, anchored to the
// inspector's Address row. Body-level (survives inspector re-renders). Validates the hyphen-slug
// format live; an empty value resets to the name-derived address. Mirrors cond-editor's lifecycle.

import { isValidGameId, gameIdify } from "@patterkit/core";
import { el, openAnchoredPanel, type AnchoredPanel } from "./dom.js";

let active: AnchoredPanel | null = null;

export function closeGameIdEditor(): void {
  active?.close();
}

/** `value` = the pinned gameId ("" if auto). `derived` = the name-slug shown as the placeholder.
 *  `onCommit(v)` persists (""=reset to auto). */
export function openGameIdEditor(opts: {
  anchor: HTMLElement; value: string; derived: string; onCommit: (gameId: string) => void;
}): void {
  const panel = openAnchoredPanel({
    anchor: opts.anchor, className: "cond-editor id-editor", title: "Game ID", width: 240,
    onClose: () => { if (active === panel) active = null; }, // runs after the exit fade
  });
  if (!panel) return; // re-clicked the same row: toggled closed
  active = panel;

  const input = el("input", "exed-input id-input"); // reuse the expr-editor input look
  input.type = "text";
  input.value = opts.value;
  input.placeholder = opts.derived || "<game-id>";
  input.spellcheck = false;
  const hint = el("div", "id-hint", "lowercase, digits, hyphens. Empty = auto from the name.");
  const actions = el("div", "id-actions");
  const save = el("button", "btn primary", "Set"); save.type = "button";
  const reset = el("button", "btn ghost", "Reset to auto"); reset.type = "button";
  actions.append(reset, save);
  panel.body.append(input, hint, actions);

  const valid = (): boolean => { const v = input.value.trim(); return v === "" || isValidGameId(v); };
  const sync = (): void => { save.disabled = !valid(); hint.classList.toggle("bad", !valid()); };
  const commit = (): void => { if (valid()) { opts.onCommit(input.value.trim()); closeGameIdEditor(); } };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    // a quick "slugify what I typed" helper on Tab
    if (e.key === "Tab" && input.value.trim()) { e.preventDefault(); input.value = gameIdify(input.value); sync(); }
  });
  save.addEventListener("click", commit);
  reset.addEventListener("click", () => { opts.onCommit(""); closeGameIdEditor(); });
  sync();
  setTimeout(() => input.focus(), 0);
}
