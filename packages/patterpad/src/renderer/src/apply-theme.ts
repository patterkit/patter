// Putting the author's chosen theme on a window's root, for EVERY window rather than just the editor.
//
// The two axes are independent and both live on `<html>`: `data-theme` picks a curated colour palette
// ("system" follows the OS by setting nothing at all), and `data-font` swaps the reading-face token set.
// `patterpad-surface/theme.css` keys off both, with Paper as the bare `:root` default.
//
// WHY THIS IS SHARED. It used to be a private function in the editor's renderer, and the play, search
// and coverage windows each imported `theme.css` and then never set either attribute - so an author on
// Slate, Night or Mist had three helper windows sitting on Paper, and the font choice never reached
// them at all. The palettes only exist under the attribute; importing the stylesheet is not enough.

import type { ThemePrefs } from "../../shared/api.js";

/** Reflect `theme` on this window's root. Idempotent: call it again on every change. */
export function applyTheme(theme: ThemePrefs, root: HTMLElement = document.documentElement): void {
  if (theme.colour === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme.colour);
  root.setAttribute("data-font", theme.font);
}
