// The jump-target picker: a floating popover listing this scene's jump targets (END, the scene,
// its blocks, cross-scene targets) for a snippet's terminal jump. Body-level (survives inspector
// re-renders), mirroring cond-editor / id-editor. Picking commits via onPick; "No jump" clears.

import { el, openAnchoredPanel, type AnchoredPanel } from "./dom.js";

let active: AnchoredPanel | null = null;

export function closeJumpPicker(): void {
  active?.close();
}

export function openJumpPicker(opts: {
  anchor: HTMLElement; current: string; targets: Array<{ id: string; label: string }>; onPick: (target: string | null) => void;
}): void {
  const panel = openAnchoredPanel({
    anchor: opts.anchor, className: "cond-editor jump-picker", title: "Jump to", width: 220,
    onClose: () => { if (active === panel) active = null; }, // runs after the exit fade
  });
  if (!panel) return; // re-clicked the same row: toggled closed
  active = panel;
  panel.body.classList.add("jump-list");
  const opt = (label: string, target: string | null, sel: boolean, danger = false): HTMLElement => {
    const b = el("button", `exed-opt${sel ? " sel" : ""}${danger ? " danger" : ""}`, label);
    b.type = "button";
    b.addEventListener("click", () => { opts.onPick(target); closeJumpPicker(); });
    return b;
  };
  for (const t of opts.targets) panel.body.append(opt(t.label, t.id, t.id === opts.current));
  if (opts.current) panel.body.append(opt("No jump (clear)", null, false, true));
}
