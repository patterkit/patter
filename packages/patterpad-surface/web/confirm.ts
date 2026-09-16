// The themed confirmation modal is the shell's (ui-review-2026-09, finding 5): a native <dialog> on the
// family's frame, with the focus trap, Esc, the scrim and the exit motion the overlay copy here lacked.
// Same promise shape (`{ title, body, confirmLabel }` -> true on confirm, false on Cancel / Esc / backdrop),
// so the group delete, the drag-drop confirm and the action menu keep their call sites. A window that
// mounts the surface imports `@wildwinter/app-shell/dialog.css`, `controls.css` and `confirm.css` once.
export { confirmDialog } from "@wildwinter/app-shell";
