// Shared DOM helpers for the renderer: `el`, the tiny tag-typed element factory
// (was copy-pasted as `mk` / `el` in six files).
//
// The anchored-panel lifecycle used to live here too. It is now the shell's
// `openAnchoredPanel` (@wildwinter/app-shell), because Storyletter had grown a
// second implementation of the same idea: the drift this file once fixed WITHIN
// Patterpad, fixed again one level up. The small controls that followed it here
// (`iconBtn`, `labelled`, `moveItem`, `tagChips`, `stageChips`) are the shell's
// now as well (ui-review-2026-09, finding 3): the same four functions under a
// second class prefix, plus `stageChips`, which moved up rather than out.
//
// `el` itself stays. The shell's widgets bring their own and the two signatures
// differ, so unifying them is a late optional tidy rather than a step.

/** Create an element with an optional class and text. Tag-typed return, so no casts at call sites. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
