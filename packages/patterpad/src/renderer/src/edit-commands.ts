// Edit ▸ Select All, when the focus is NOT in the script.
//
// Inside the script, Select All means the field the caret is in (patterpad-surface/src/selectall.ts).
// Anywhere else it should mean what it always did: the text of the field you are in. For inputs and
// text areas that was already true. For an editable element that is neither - the scene's title, which
// is contenteditable - the fallback was `document.execCommand("selectAll")`, and that is not confined
// to the element: renaming a scene and pressing Cmd-A selected the whole window, the Scenes list, the
// entire script and the inspector with it (found while reproducing #73).

/** An editable host: contenteditable in any form but "false". The scene title uses "plaintext-only",
 *  and the attribute is read as well as `isContentEditable` because jsdom does not implement the latter. */
const isEditableHost = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement &&
  (el.isContentEditable === true || (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false"));

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
