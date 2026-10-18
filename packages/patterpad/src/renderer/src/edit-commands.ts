// Edit ▸ Select All, when the focus is NOT in the script.
//
// Inside the script, Select All means the field the caret is in (patterpad-surface/src/selectall.ts).
// Anywhere else it should mean what it always did: the text of the field you are in. For inputs and
// text areas that was already true. For an editable element that is neither - the scene's title, which
// is contenteditable - the fallback was `document.execCommand("selectAll")`, and that is not confined
// to the element: renaming a scene and pressing Cmd-A selected the whole window, the Scenes list, the
// entire script and the inspector with it (found while reproducing #73).

import { isEditableTarget } from "@wildwinter/app-shell";

/** An editable host: contenteditable in any form but "false" (the scene title uses "plaintext-only").
 *  The shell's `isEditableTarget` is the one answer to "is the focus in a field"; a select is a field
 *  there but has no contents to select, so it is left to the native fallback as it always was. */
const isEditableHost = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement && !(el instanceof HTMLSelectElement) && isEditableTarget(el);

/**
 * Select the whole of the focused field when that field is outside the script editor. Returns false
 * when it is not ours to handle - the focus is inside the editor (whose own rule applies), or nothing
 * editable has it - so the caller keeps its fallback for those.
 */
export function selectAllOutsideEditor(active: Element | null, editorDom: Element | null): boolean {
  if (!active) return false;
  if (editorDom && editorDom.contains(active)) return false;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) { active.select(); return true; }
  if (!isEditableHost(active)) return false;
  const range = document.createRange();
  range.selectNodeContents(active);
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Where Edit ▸ Undo and Redo go in the main window (patterkit design/patterpad-undo.md, "Where Cmd+Z goes"):
 *  - `"field"`: the focused field's own text undo. A field outside the script and the inspector holds text the
 *    scene's history never saw (Project Settings before its Save, the Find field, a dialog, the Properties page),
 *    and any open dialog owns the keyboard whatever has the focus.
 *  - `"scene"`: the open scene's history. The script, its title and the inspector edit the scene, so their
 *    edits are the history's to undo.
 *  - `"show-scene"`: the scene is open but out of sight (the overview keeps it mounted): show it, then undo,
 *    so an undo is always something you can see.
 *  - `"none"`: no scene to undo (the Properties page, the welcome screen). The scene behind the Properties page
 *    is remounted on return, so an undo there would change a scene nobody can see and save nothing. */
export type UndoRoute = "field" | "scene" | "show-scene" | "none";

export interface UndoPlace {
  /** The focused element (`document.activeElement`). */
  active: Element | null;
  /** The elements whose edits are the scene's: the editor column (script and title) and the inspector. */
  sceneAreas: ReadonlyArray<Element | null>;
  /** A modal dialog is open. */
  dialogOpen: boolean;
  /** Which scene state the window is in: showing, open but hidden behind the overview, or none. */
  scene: "showing" | "hidden" | "none";
}

export function undoRoute(p: UndoPlace): UndoRoute {
  if (p.dialogOpen) return "field";
  const inScene = !!p.active && p.sceneAreas.some((area) => !!area && area.contains(p.active));
  if (!inScene && p.active && isEditableTarget(p.active)) return "field";
  if (p.scene === "showing") return "scene";
  if (p.scene === "hidden") return "show-scene";
  return "none";
}
