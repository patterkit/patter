// The themed auto-update prompt: the in-app replacement for Electron's stock dialog.showMessageBox, so
// "Update available" / "Restart now" / "Save before restart" all wear the app's typography, palette, and
// motion (design-language.md §4 "coherent to the edges ... never a stock system dialog"). Main summons it
// over `updater:prompt` and reads back the chosen button index - the same contract as showMessageBox.

import { el } from "./dom.js";
import type { UpdaterPromptOptions } from "../../shared/api.js";

/** Show the prompt as a modal themed dialog; resolve the index of the clicked button (Esc → cancelId). */
export function showUpdaterDialog(opts: UpdaterPromptOptions): Promise<number> {
  return new Promise((resolve) => {
    const defaultId = opts.defaultId ?? 0;
    const cancelId = opts.cancelId ?? opts.buttons.length - 1;

    const dlg = el("dialog", "identity um-dialog");
    const form = el("div", "identity-form");
    if (opts.wordmark) {
      // The PatterKit wordmark (same geometry as the website's), inline so the text renders in the
      // app's own Newsreader and the word colours follow the theme; the leaf marks keep the fixed
      // brand teal + ember (readable on every palette, like the site footer's mark).
      const brand = el("div", "um-wordmark");
      brand.innerHTML =
        '<svg viewBox="0 0 820 220" role="img" aria-label="PatterKit" xmlns="http://www.w3.org/2000/svg">' +
        '<g transform="translate(40,30) scale(0.98)">' +
        '<g transform="translate(36.7,6) rotate(270 50 50)"><path fill="#57a294" d="M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z"/></g>' +
        '<g transform="translate(3.3,56) rotate(90 50 50)"><path fill="#d2603e" d="M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z"/></g></g>' +
        '<text x="232" y="150" font-family="Newsreader, Georgia, serif" font-weight="500" font-size="120" letter-spacing="-2" fill="var(--ink)">Patter<tspan fill="var(--accent)">Kit</tspan></text>' +
        "</svg>";
      form.append(brand);
    }
    form.append(el("h2", "identity-title", opts.message));
    if (opts.detail) form.append(el("p", "identity-sub", opts.detail));
    if (opts.links?.length) {
      // The About dialog's web links; main only opens allow-listed URLs, so a bad label/url pair is inert.
      const row = el("p", "um-links");
      for (const link of opts.links) {
        const a = el("a", "", link.label) as HTMLAnchorElement;
        a.href = link.url;
        a.addEventListener("click", (e) => { e.preventDefault(); window.patter.openExternal(link.url); });
        row.append(a);
      }
      form.append(row);
    }
    const actions = el("div", "identity-actions");

    let done = false;
    const finish = (idx: number): void => {
      if (done) return;
      done = true;
      try { dlg.close(); } catch { /* already closed */ }
      dlg.remove();
      resolve(idx);
    };

    opts.buttons.forEach((label, i) => {
      const b = el("button", `btn${i === defaultId ? " primary" : ""}`, label);
      b.type = "button";
      b.addEventListener("click", () => finish(i));
      actions.append(b);
    });
    form.append(actions);
    dlg.append(form);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(cancelId); }); // Esc maps to cancel
    document.body.append(dlg);
    dlg.showModal(); // plays the shared panel-in via the .identity CSS
    (actions.children[defaultId] as HTMLElement | undefined)?.focus();
  });
}
