// Shared building blocks for the Project Settings list-of-fields tabs (Properties, Game Data, Cast,
// World, …). Three concerns the tabs used to each solve differently:
//   - `expandableRow`: a compact single-line row (name · type · default · actions) with the secondary /
//     optional fields tucked behind a ▸ disclosure, so a list of bools/numbers scans like a table.
//   - `focusNewRow`: after "+ Add", scroll the new row into view and focus its name input (it used to
//     append off the bottom of the scroll area with nothing focused).
//   - `dupGuard`: case-insensitive duplicate-name detection that paints the clashing inputs red and lets
//     the Save gate block until they're resolved.

import { el } from "./dom.js";

/** Build a compact list row: a single `.gd-rowline` (the inline controls) plus, when `details` are given,
 *  a ▸ disclosure that reveals a `.gd-details` panel below. The disclosure leads the line so every row in a
 *  list aligns. Pass the name input as `nameInput` so `focusNewRow` and the dup guard can find it. */
export function expandableRow(opts: { line: HTMLElement[]; details?: HTMLElement[] }): HTMLElement {
  const row = el("div", "gd-row");
  const line = el("div", "gd-rowline");
  if (opts.details && opts.details.length) {
    const details = el("div", "gd-details"); details.hidden = true;
    for (const d of opts.details) details.append(d);
    const toggle = el("button", "gd-expand", "▸"); toggle.type = "button";
    toggle.dataset.tip = "More"; toggle.setAttribute("aria-label", "More");
    toggle.addEventListener("click", () => {
      const open = details.hidden;
      details.hidden = !open;
      toggle.textContent = open ? "▾" : "▸";
      toggle.classList.toggle("open", open);
    });
    line.append(toggle);
    opts.line.forEach((c) => line.append(c));
    row.append(line, details);
  } else {
    opts.line.forEach((c) => line.append(c));
    row.append(line);
  }
  return row;
}

/** After a "+ Add" re-renders the list, bring the freshly-appended row into view and focus its name input
 *  (the `.gd-name`, else the first input). `listEl` is the `.gd-fieldlist` the new row lives in. */
export function focusNewRow(listEl: HTMLElement | null | undefined): void {
  const last = listEl?.lastElementChild;
  if (!(last instanceof HTMLElement)) return;
  last.scrollIntoView({ block: "nearest" });
  const name = last.querySelector<HTMLInputElement>("input.gd-name") ?? last.querySelector<HTMLInputElement>("input");
  name?.focus();
}

export interface DupGuard {
  /** Forget the previous render's inputs (call at the top of render). */
  reset(): void;
  /** Register a name input; `key` returns the comparison string (default the input's own value). Re-checks
   *  live on input. Pass `also` for extra inputs that change the key (e.g. World's scope token). */
  track(input: HTMLInputElement, key?: () => string, also?: HTMLInputElement[]): void;
  /** Re-paint duplicates; returns true if any two non-blank keys collide. */
  check(): boolean;
  /** The first input currently flagged as a duplicate (after a fresh check), or null. */
  firstDuplicate(): HTMLInputElement | null;
}

/** Track a list's name inputs and flag case-insensitive duplicates (red `.invalid` border). Two entries
 *  sharing a name is a data hazard (e.g. two properties called the same), so the Save gate consults
 *  `firstDuplicate()` to block + jump to the offender. */
export function dupGuard(): DupGuard {
  const items: Array<{ input: HTMLInputElement; key: () => string }> = [];
  const check = (): boolean => {
    const counts = new Map<string, number>();
    for (const it of items) { const k = it.key().trim().toLowerCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
    let any = false;
    for (const it of items) {
      const k = it.key().trim().toLowerCase();
      const dup = !!k && (counts.get(k) ?? 0) > 1;
      it.input.classList.toggle("invalid", dup);
      if (dup) { it.input.dataset.tip = "Duplicate name. Names must be unique."; any = true; }
      else if (it.input.dataset.tip === "Duplicate name. Names must be unique.") delete it.input.dataset.tip;
    }
    return any;
  };
  return {
    reset() { items.length = 0; },
    track(input, key = () => input.value, also) {
      items.push({ input, key });
      input.addEventListener("input", check);
      for (const a of also ?? []) a.addEventListener("input", check);
    },
    check,
    firstDuplicate() { check(); return items.find((it) => it.input.classList.contains("invalid"))?.input ?? null; },
  };
}
