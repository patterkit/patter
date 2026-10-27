// Putting the author's chosen theme on a window's root, for EVERY window rather than just the editor.
//
// The axes are independent and all live on `<html>`: `data-theme` picks one of the family's palettes
// (app-shell's palette.css; "system" follows the OS by setting nothing at all), `data-font` swaps the
// reading faces (`patterpad-surface/theme.css`), and `data-platform` lets the shell's tokens.css give
// Windows its larger chrome text.
//
// WHY THIS IS SHARED. It used to be a private function in the editor's renderer, and the play, search
// and coverage windows each imported `theme.css` and then never set either attribute - so an author on
// a dark palette had three helper windows sitting on the light one, and the font choice never reached
// them at all. The palettes only exist under the attribute; importing the stylesheet is not enough.

import { themeAttribute } from "@wildwinter/app-shell/theme";
import type { ThemePrefs } from "../../shared/api.js";

/** The platform as Node names it, from the renderer's side (which has no `process`). */
function platform(): string {
  const p = navigator.platform.toUpperCase();
  return p.includes("MAC") ? "darwin" : p.includes("WIN") ? "win32" : "linux";
}

/** Reflect `theme` on this window's root. Idempotent: call it again on every change. */
export function applyTheme(theme: ThemePrefs, root: HTMLElement = document.documentElement): void {
  const id = themeAttribute(theme.colour);
  if (id) root.setAttribute("data-theme", id);
  else root.removeAttribute("data-theme");
  root.setAttribute("data-font", theme.font);
  root.setAttribute("data-platform", platform());
}
