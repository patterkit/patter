// The special-insert ("/") menu (for the harness). At an empty line, "/" opens a
// two-section menu: "This line" (act on the current line - Insert action, Jump,
// Split here) and "Follow with" (add a sibling chunk after this snippet - Snippet,
// Branch, Choice, ...). The wording mirrors the right-click action menu (Branch, not
// "If / Else"). The first item is highlighted, Up/Down move it (skipping headings),
// Enter selects, Esc closes. Jump leads to a target picker over the injected
// scene/block ids. Mutually exclusive with the cast popup (main.ts closes the popup
// when this opens and swallows keys while open). Wired via EditorView props.

import type { EditorView } from "prosemirror-view";
import { canInsertSpecial, insertGameEvent } from "../src/special.js";
import { insertChunk, type GroupKind } from "../src/groups.js";
import { splitSnippetHere } from "../src/lines.js";
import { context } from "../src/context.js";
import { anchorBelowCaret } from "./anchor.js";
import { createFloating } from "./floating.js";

/** A menu row: a non-navigable section heading, or a runnable item. `key` is the single
 *  access-key letter (underlined in the label) that jumps the highlight to this item. */
type Entry = { kind: "head"; label: string } | { kind: "item"; label: string; key?: string; run: () => void };

// "Follow with" mirrors the action menu's ADD_KINDS wording (Branch, not "If / Else"). `key` is the
// type-ahead access letter; they are unique across the whole menu (Snippet keeps "s" per the design;
// the other S-words fall back to a distinctive in-word letter).
const FOLLOW_KINDS: Array<{ label: string; kind: "snippet" | GroupKind; key: string }> = [
  { label: "Snippet", kind: "snippet", key: "s" }, { label: "Branch", kind: "if", key: "b" }, { label: "Choice", kind: "choice", key: "c" },
  { label: "Once each", kind: "sequence", key: "o" }, { label: "Cycle", kind: "cycle", key: "y" }, { label: "Shuffle", kind: "shuffle", key: "h" },
];

export interface SlashMenu {
  handleTextInput(view: EditorView, text: string): boolean;
  handleKeyDown(view: EditorView, event: KeyboardEvent): boolean;
  isOpen(): boolean;
  close(): void;
}

/** `openJump` opens the shared jump target picker at the caret (the surface wires it to insertJump). */
export function createSlashMenu(openJump: (view: EditorView) => void): SlashMenu {
  const floating = createFloating("slash-menu");
  const el = floating.el;
  let entries: Entry[] = [];
  let items: Array<{ label: string; key?: string; run: () => void }> = []; // the navigable rows (headings excluded)
  let highlight = 0;
  let open = false;
  let viewRef: EditorView | null = null;

  const close = (): void => { open = false; floating.close(); };

  // Render a label with its access letter underlined (the first case-insensitive match). Built from
  // text nodes (no innerHTML) - the labels are static, but keep it injection-proof regardless.
  const paintLabel = (b: HTMLButtonElement, label: string, key?: string): void => {
    const i = key ? label.toLowerCase().indexOf(key.toLowerCase()) : -1;
    if (i < 0) { b.textContent = label; return; }
    b.replaceChildren();
    if (i > 0) b.append(label.slice(0, i));
    const u = document.createElement("u"); u.textContent = label.slice(i, i + 1); b.append(u);
    b.append(label.slice(i + 1));
  };

  let buttons: HTMLButtonElement[] = []; // 1:1 with `items`
  // ONE highlight, shared by keyboard and mouse (standard combobox behaviour): arrows move it, and
  // hovering an item with the mouse makes THAT the highlight - so the keyboard-active and the
  // mouse-under item are never two competing highlights. `mousemove` (not `mouseenter`) means a
  // stationary mouse the menu happens to open under won't steal the keyboard default until you move.
  const setHighlight = (i: number): void => {
    if (i === highlight || i < 0 || i >= buttons.length) return;
    buttons[highlight]?.classList.remove("active");
    highlight = i;
    buttons[highlight]?.classList.add("active");
  };

  // Rebuild the rows (and the highlight). Position is NOT touched here: the menu is
  // anchored once when it opens (see show) and held while you navigate - re-anchoring
  // on every Up/Down made it jitter sideways as the measured caret coords shifted.
  const render = (): void => {
    el.replaceChildren();
    buttons = [];
    items = [];
    for (const entry of entries) {
      if (entry.kind === "head") {
        const h = document.createElement("div"); h.className = "slash-head"; h.textContent = entry.label;
        el.appendChild(h);
        continue;
      }
      const i = items.length;
      items.push(entry);
      const b = document.createElement("button");
      b.className = "slash-item" + (i === highlight ? " active" : "");
      paintLabel(b, entry.label, entry.key); // underline the access letter
      b.addEventListener("mousedown", (e) => { e.preventDefault(); entry.run(); });
      b.addEventListener("mousemove", () => setHighlight(i));
      el.appendChild(b);
      buttons.push(b);
    }
  };

  const show = (view: EditorView, menuEntries: Entry[]): void => {
    entries = menuEntries; highlight = 0; open = true; viewRef = view; render(); // first item selected
    // Anchor once at the caret it opened on, then follow the caret on scroll. (render() on Up/Down
    // does NOT re-anchor - that jittered sideways as the measured caret shifted.)
    floating.show(() => anchorBelowCaret(viewRef!, el));
  };

  const follow = (view: EditorView, kind: "snippet" | GroupKind): void => {
    // insertChunk CONSUMES the empty triggering line (the `/` was typed on an empty line): picking a
    // snippet / group means abandoning that half-started line, not keeping it.
    const tr = insertChunk(view.state, kind);
    if (tr) view.dispatch(tr);
    close(); view.focus();
  };

  const rootMenu = (view: EditorView): void => {
    const snippetPos = context(view.state).snippet?.pos;
    const canSplit = snippetPos != null && splitSnippetHere(view.state, snippetPos) != null;
    const thisLine: Entry[] = [
      { kind: "head", label: "This line" },
      { kind: "item", label: "Insert game event", key: "a", run: () => { const tr = insertGameEvent(view.state); if (tr) view.dispatch(tr); close(); view.focus(); } },
      { kind: "item", label: "Jump", key: "d", run: () => { close(); openJump(view); } },
    ];
    if (canSplit) thisLine.push({ kind: "item", label: "Split here", key: "p", run: () => { const tr = splitSnippetHere(view.state, snippetPos!); if (tr) view.dispatch(tr); close(); view.focus(); } });
    const followWith: Entry[] = [
      { kind: "head", label: "Follow with" },
      ...FOLLOW_KINDS.map((k): Entry => ({ kind: "item", label: k.label, key: k.key, run: () => follow(view, k.kind) })),
    ];
    show(view, [...thisLine, ...followWith]);
  };

  return {
    handleTextInput: (view, text) => {
      if (open) { close(); return false; }              // typing dismisses the menu
      if (text === "/" && canInsertSpecial(view.state)) { rootMenu(view); return true; }
      return false;
    },
    handleKeyDown: (view, event) => {
      if (!open) return false;
      if (event.key === "ArrowDown") { setHighlight((highlight + 1) % items.length); return true; }
      if (event.key === "ArrowUp") { setHighlight((highlight - 1 + items.length) % items.length); return true; }
      if (event.key === "Enter") { items[highlight]?.run(); return true; }
      if (event.key === "Escape") { close(); view.focus(); return true; }
      if (event.key === "Tab") { close(); view.focus(); return true; }
      // Type-ahead: a single letter jumps the highlight to the item whose access key it is (the
      // underlined letter); Enter then commits. A non-matching letter falls through to dismiss.
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && /[a-z]/i.test(event.key)) {
        const i = items.findIndex((it) => it.key === event.key.toLowerCase());
        if (i >= 0) { setHighlight(i); return true; }
      }
      return false; // other keys close-and-pass-through (handled by handleTextInput)
    },
    isOpen: () => open,
    close,
  };
}
