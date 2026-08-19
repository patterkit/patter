// Shared DOM helpers for the renderer: `el`, the tiny tag-typed element factory
// (was copy-pasted as `mk` / `el` in six files), and the small controls built on it.
//
// The anchored-panel lifecycle used to live here too. It is now the shell's
// `openAnchoredPanel` (@wildwinter/app-shell), because Storyletter had grown a
// second implementation of the same idea: the drift this file once fixed WITHIN
// Patterpad, fixed again one level up.
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

/** A small square glyph button (the gd-icon move/delete controls the settings editors share). */
export function iconBtn(glyph: string, title: string, onClick: () => void, disabled = false, danger = false): HTMLButtonElement {
  const b = el("button", `gd-icon${danger ? " danger" : ""}`);
  b.type = "button"; b.textContent = glyph; b.dataset.tip = title; b.setAttribute("aria-label", title);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

/** A captioned field row: `<label class="gd-labelled"><span class="gd-fieldcap">…</span>control</label>`. */
/**
 * A captioned field. The label is pointed at the field it captions, EXPLICITLY, and never at a button.
 *
 * A `<label>` with no `for` forwards a click to its first labelable descendant, and buttons are
 * labelable - so a caption wrapped around a control containing buttons (`tagChips`, whose every chip
 * carries a remove button) turns every click on the row's dead space into a press of the FIRST button
 * in it. That shipped as #44: clicking a Game Data list value anywhere but its own ✕ deleted the first
 * value in the list. It reads like a wrong-index bug and is not one - the click never reached the chip.
 *
 * When the control holds no labelable field, this is a plain `<div>`: no caption behaviour is better
 * than a caption that presses something.
 */
export function labelled(label: string, control: HTMLElement): HTMLElement {
  const target = control.matches("input, select, textarea")
    ? control
    : control.querySelector<HTMLElement>("input:not([type=button]):not([type=submit]), select, textarea");
  const w = el(target ? "label" : "div", "gd-labelled");
  w.append(el("span", "gd-fieldcap", label), control);
  if (target) {
    if (!target.id) target.id = `gd-f-${Math.random().toString(36).slice(2, 9)}`;
    (w as HTMLLabelElement).htmlFor = target.id;
  }
  return w;
}

/** Swap item `i` with its neighbour `i + delta` IN PLACE (the up/down reorder the settings lists share);
 *  a no-op when the target is out of range. Returns whether anything moved. */
export function moveItem<T>(arr: T[], i: number, delta: number): boolean {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  return true;
}

/** A tag-style editor for a string-list field (an enum's allowed values / flags): removable chips + an
 *  add input (Enter or "," commits, blank/duplicate ignored). Mutates `holder.values` in place (read back
 *  on save). `onChange` fires after any add / remove - callers use it to refresh a dependent control (the
 *  enum default picker, which lists these values). Shared by the game-data and property editors. */
export function tagChips(holder: { values?: string[] }, onChange?: () => void): HTMLElement {
  const wrap = el("div", "gd-tags");
  // One PERSISTENT input (never rebuilt), so focus stays in the field after each commit - you can type a
  // run of values without clicking back in. Chips are inserted before the input as they're committed.
  const input = el("input", "gd-tag-input") as HTMLInputElement;
  input.type = "text"; input.placeholder = "<add value>"; input.spellcheck = false;
  const makeChip = (v: string): HTMLElement => {
    const chip = el("span", "gd-tag", v);
    const x = el("button", "gd-tag-x", "✕"); x.type = "button"; x.dataset.tip = `remove ${v}`; x.setAttribute("aria-label", `remove ${v}`);
    x.addEventListener("click", () => { holder.values = (holder.values ?? []).filter((o) => o !== v); chip.remove(); onChange?.(); });
    chip.append(x);
    return chip;
  };
  const commit = (): void => {
    const v = input.value.trim();
    if (v && !(holder.values ?? []).includes(v)) { (holder.values ??= []).push(v); wrap.insertBefore(makeChip(v), input); onChange?.(); }
    input.value = "";
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } });
  input.addEventListener("blur", commit);
  for (const v of holder.values ?? []) wrap.append(makeChip(v));
  wrap.append(input);
  return wrap;
}
