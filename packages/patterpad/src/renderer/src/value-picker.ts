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

/** Offer `values` under `title`; picking one calls `onPick` and closes. */
export function openValuePicker(opts: { anchor: HTMLElement; title: string; values: string[]; current?: string; onPick: (value: string) => void }): void {
  const panel = openPanel({
    anchor: opts.anchor, className: "value-picker", title: opts.title, width: 220,
    onClose: () => { if (active === panel) active = null; }, // runs after the exit fade
  });
  if (!panel) return; // re-clicked the same control: toggled closed
  active = panel;
  panel.body.classList.add("value-list");
  for (const v of opts.values) {
    const b = el("button", `exed-opt${v === opts.current ? " sel" : ""}`, v);
    b.type = "button";
    b.addEventListener("click", () => { opts.onPick(v); closeValuePicker(); });
    panel.body.append(b);
  }
}
