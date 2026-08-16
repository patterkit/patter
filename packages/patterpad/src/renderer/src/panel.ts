// Patterpad's placement policy for the shell's anchored panel.
//
// The lifecycle is the shell's (@wildwinter/app-shell). What is Patterpad's is
// WHERE these panels go, and it is the same answer for all of them: to the LEFT,
// because every one of them hangs off a row in the right-hand inspector, and
// clear of the two bottom bars, because an author may be stepping through
// problems while a panel is open.
//
// One place rather than seven call sites. The lifecycle originally diverged per
// editor for exactly that reason (the left-placement offset was a literal 230 in
// one file and 250 in another), and repeating a policy is how that starts.

import { openAnchoredPanel, type AnchoredPanel } from "@wildwinter/app-shell";

/** The bars a panel must not cover. Selectors, not ids: the shell takes either.
 *  Exported for the shell's own wrappers (the gameId editor, the comment popover),
 *  which build their panel internally and so take this as an option. */
export const PANEL_KEEP_CLEAR = ["#reviewbar", "#problembar"];

type PanelOptions = Parameters<typeof openAnchoredPanel>[0];

/** Open an inspector panel. Returns null when the click toggled it shut, which
 *  callers must early-return on, exactly as before. */
export function openPanel(opts: Omit<PanelOptions, "prefer" | "keepClear">): AnchoredPanel | null {
  return openAnchoredPanel({ ...opts, prefer: "left", keepClear: PANEL_KEEP_CLEAR });
}
