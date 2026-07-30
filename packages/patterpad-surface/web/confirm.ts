// A themed in-app confirmation modal (design-language §4 "coherent to the edges":
// no OS dialog). Used for the content-destroying group delete (groups §7). Returns
// a promise that resolves true on confirm, false on cancel / Esc / backdrop.

import { closeWithExit } from "./exit.js";

export function confirmDialog(opts: { title: string; body: string; confirmLabel: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div"); overlay.className = "confirm-overlay";
    const dialog = document.createElement("div"); dialog.className = "confirm-dialog"; dialog.setAttribute("role", "alertdialog");
    const title = document.createElement("div"); title.className = "confirm-title"; title.textContent = opts.title;
    const body = document.createElement("div"); body.className = "confirm-body"; body.textContent = opts.body;
    const actions = document.createElement("div"); actions.className = "confirm-actions";
    const cancel = document.createElement("button"); cancel.className = "confirm-btn cancel"; cancel.textContent = "Cancel";
    const ok = document.createElement("button"); ok.className = "confirm-btn danger"; ok.textContent = opts.confirmLabel;
    actions.append(cancel, ok);
    dialog.append(title, body, actions);
    overlay.append(dialog);

    // Enter is NOT globally bound to confirm: it activates the focused button (native <button>
    // behaviour), and focus starts on Cancel - a destructive default must be chosen, not stumbled
    // into by a stray Enter (the same behaviour app-shell's confirmDialog codified).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
    };
    function close(v: boolean): void {
      document.removeEventListener("keydown", onKey, true);
      dialog.classList.add("closing"); // the box slides out while the dim fades (closeWithExit drives the overlay)
      closeWithExit(overlay, () => overlay.remove());
      resolve(v);
    }

    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(false); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    cancel.focus();
  });
}
