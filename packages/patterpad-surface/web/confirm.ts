// The themed confirmation modal is the shell's (ui-review-2026-09, finding 5): a native <dialog> on the
// family's frame, with the focus trap, Esc, the scrim and the exit motion the overlay copy here lacked.
// Same promise shape (`{ title, body, confirmLabel }` -> true on confirm, false on Cancel / Esc / backdrop),
// so the group delete, the drag-drop confirm and the action menu keep their call sites. A window that
// mounts the surface imports `@wildwinter/app-shell/dialog.css`, `controls.css` and `confirm.css` once.
import { confirmDialog } from "@wildwinter/app-shell";
export { confirmDialog };

// The delete confirmations, worded once. The keyboard (surface.ts) and the action menu ask the same
// question for the same act, and they had drifted into four hand-written copies (review 2026-10).

/** Confirm deleting one snippet, group, or option ("snippet" | "group" | "option"). */
export const confirmDeleteChunk = (noun: string): Promise<boolean> =>
  confirmDialog({ title: `Delete this ${noun}?`, body: `The ${noun} and everything inside it will be removed. You can undo this.`, confirmLabel: `Delete ${noun}` });

/** Confirm deleting a multi-selection of `n` chunks. */
export const confirmDeleteSet = (n: number): Promise<boolean> =>
  confirmDialog({ title: `Delete these ${n} items?`, body: `${n} items and everything inside them will be removed. You can undo this.`, confirmLabel: `Delete ${n} items` });

/** Confirm deleting a whole block, by its name. */
export const confirmDeleteBlock = (name: string): Promise<boolean> =>
  confirmDialog({ title: `Delete "${name}"?`, body: "The block and everything inside it will be removed. You can undo this.", confirmLabel: "Delete block" });
