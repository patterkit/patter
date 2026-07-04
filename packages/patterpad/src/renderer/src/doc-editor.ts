// The documentation-notes editor (spec §18), mounted into the Notes modal. One text area PER
// documentation CLASS (everyone / vo / loc / studio-defined); each non-blank line is a DocLine
// of that class. Untyped lines (editor-only) get their own block. `onChange` fires live; the caller
// (renderer) owns the dialog + persists on close. A modal (not an anchored popover) so there's room to type.

import type { DocLine, DocumentationClass } from "@patterkit/model";
import { el } from "./dom.js";

const UNTYPED = "__untyped"; // sentinel for the editor-only (no-class) bucket in the add menu
const CLASS_LABEL: Record<string, string> = { everyone: "Everyone", vo: "Voice (VO)", loc: "Localisers" };
const label = (key: string): string => CLASS_LABEL[key] ?? (key ? key[0]!.toUpperCase() + key.slice(1) : "Note (editor-only)");
const placeholder = (key: string): string =>
  key === "vo" ? "<direction for the voice actor / director>"
  : key === "loc" ? "<context for translators>"
  : key === "" ? "<an internal note - never exported>"
  : "<intent / rationale - why this is here>";

export interface DocEditorOptions {
  /** The node's current notes. */
  lines: DocLine[];
  /** The documentation classes ADDABLE on this node (already filtered by node kind - e.g. no VO on a
   *  text/action beat). The untyped (editor-only) bucket is always offered too. */
  classes: DocumentationClass[];
  /** Live edit - the caller updates its in-memory map + the inspector count. */
  onChange: (lines: DocLine[]) => void;
}

/** Render the per-class Notes editor into `host` (replacing its contents). */
export function mountDocEditor(host: HTMLElement, opts: DocEditorOptions): void {
  const vocab = opts.classes.map((c) => c.name);
  const addable = [...vocab, ""]; // what the "+ add" menu offers ("" = untyped / editor-only, last)

  const seed = new Map<string, string>();
  for (const l of opts.lines) { const k = l.type ?? ""; seed.set(k, seed.has(k) ? `${seed.get(k)}\n${l.text}` : l.text); }

  // Shown blocks are seed-driven (every EXISTING class is shown, even one no longer addable here, so a
  // note is never dropped) plus a sensible default when empty.
  const shown: string[] = [...seed.keys()];
  if (!shown.length) shown.push(vocab.includes("everyone") ? "everyone" : (vocab[0] ?? "")); // a sensible first block
  const areas = new Map<string, HTMLTextAreaElement>();

  const value = (): DocLine[] => {
    const out: DocLine[] = [];
    for (const k of shown) {
      const ta = areas.get(k);
      if (!ta) continue;
      for (const raw of ta.value.split("\n")) { const t = raw.trim(); if (t) out.push(k ? { type: k, text: t } : { text: t }); }
    }
    return out;
  };

  const render = (): void => {
    host.replaceChildren();
    for (const k of shown) {
      const block = el("div", "doc-class");
      block.append(el("span", "doc-class-label", label(k)));
      const ta = el("textarea", "doc-text") as HTMLTextAreaElement;
      ta.value = areas.get(k)?.value ?? seed.get(k) ?? "";
      ta.rows = 4; ta.placeholder = placeholder(k); ta.spellcheck = true;
      ta.addEventListener("input", () => opts.onChange(value()));
      areas.set(k, ta);
      block.append(ta);
      host.append(block);
    }
    const remaining = addable.filter((k) => !shown.includes(k));
    if (remaining.length) {
      const add = el("select", "doc-add insp-select") as HTMLSelectElement;
      add.append(new Option("+ add a note for…", ""));
      for (const k of remaining) add.append(new Option(label(k), k || UNTYPED));
      add.addEventListener("change", () => {
        if (!add.value) return;
        const cls = add.value === UNTYPED ? "" : add.value;
        shown.push(cls);
        render();
        areas.get(cls)?.focus();
      });
      host.append(add);
    }
  };
  render();
}
