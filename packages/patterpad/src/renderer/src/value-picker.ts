// A short list of values to choose one from, in a floating popover: the pick-an-enum-value quick fix's
// chooser. It was the old jump picker standing in, titled "Jump to" with a "No jump" row, after the
// surface's own target picker took over every jump (ruling K of the October 2026 review). Body-level, so
// it survives inspector re-renders, as the condition and effects editors do.

import { el } from "./dom.js";
import { openPanel } from "./panel.js";
import type { AnchoredPanel } from "@wildwinter/app-shell";

let active: AnchoredPanel | null = null;

export function closeValuePicker(): void {
  active?.close();
}

/** Offer `values` under `title`; picking one calls `onPick` with its label and its row, and closes. Read
 *  the row when two rows can share a label (a list with a "None" row, say). */
export function openValuePicker(opts: { anchor: HTMLElement; title: string; values: string[]; current?: string; onPick: (value: string, index: number) => void }): void {
  const panel = openPanel({
    anchor: opts.anchor, className: "value-picker", title: opts.title, width: 220,
    onClose: () => { if (active === panel) active = null; }, // runs after the exit fade
  });
  if (!panel) return; // re-clicked the same control: toggled closed
  active = panel;
  panel.body.classList.add("value-list");
  opts.values.forEach((v, i) => {
    const b = el("button", `exed-opt${v === opts.current ? " sel" : ""}`, v);
    b.type = "button";
    b.addEventListener("click", () => { opts.onPick(v, i); closeValuePicker(); });
    panel.body.append(b);
  });
}

/** The pick-qualifier quick fix's rows: the project's qualifiers by name, then a row for none, and the Game
 *  ID each row stands for. Read by row, so a qualifier that is itself named "None" is still that qualifier. */
export function qualifierRows(list: ReadonlyArray<{ name: string; gameId: string }>): { values: string[]; gameIdAt: (index: number) => string } {
  return {
    values: [...list.map((q) => q.name), "None"],
    gameIdAt: (index) => list[index]?.gameId ?? "",
  };
}
