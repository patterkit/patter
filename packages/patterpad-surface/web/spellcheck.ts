// ---------------------------------------------------------------------------
// Inline spell-check (#177): a ProseMirror plugin that red-wavy-underlines misspelled words in the SAY
// zones (dialogue / narration content). The host (renderer) builds the engine - nspell over the active
// Hunspell dictionary + the project word list + the cast - and pushes it via the handle's setSpellChecker,
// so checking is synchronous (no IPC per word). Right-clicking a flagged word opens a Word / Docs-style
// menu: pick a suggestion to replace it, add it to the project dictionary, or ignore it for this session.
// The engine already accepts cast names + project words, so proper nouns never flag.
// ---------------------------------------------------------------------------

import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { EditorView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { createFloating } from "./floating.js";
import { modelIdOf } from "../src/zoneutil.js";

/** The spell engine the host supplies (synchronous check + ranked suggestions). */
export interface SpellChecker { check(word: string): boolean; suggest(word: string): string[] }

// "Add to dictionary" is a HOST action (it edits the project dictionary + rebuilds the engine); set at mount.
let addHandler: ((word: string) => void) | null = null;
export function setSpellAddHandler(fn: ((word: string) => void) | null): void { addHandler = fn; }

// "Ignore" is likewise a HOST action when wired: it persists the word to the project ignore list so it stays
// ignored across loads, rebuilds the engine, and refreshes the problems panel. Without a handler, Ignore
// falls back to a session-only suppression (the plugin's `ignore` set).
let ignoreHandler: ((word: string) => void) | null = null;
export function setSpellIgnoreHandler(fn: ((word: string) => void) | null): void { ignoreHandler = fn; }

interface SpellState { checker: SpellChecker | null; ignore: Set<string>; deco: DecorationSet }
const key = new PluginKey<SpellState>("patterSpellcheck");

// A word: a run of letters with optional internal apostrophes (don't, it's). Min length 2. Unicode-aware.
const WORD_RE = /\p{L}[\p{L}’']*/gu;
const ignored = (set: Set<string>, w: string): boolean => set.has(w) || set.has(w.toLowerCase());

/** Every misspelled word in the say zones, as document ranges (exported for tests). Walks say nodes,
 *  tokenizes their text, and skips words that are correct / ignored / too short. */
export function misspellings(doc: PMNode, checker: SpellChecker, ignore: Set<string>): Array<{ word: string; from: number; to: number }> {
  const out: Array<{ word: string; from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "say") return;
    node.forEach((child, childOffset) => {
      if (!child.isText || !child.text) return;
      const base = pos + 1 + childOffset; // say content begins at pos+1; childOffset is within that content
      for (const m of child.text.matchAll(WORD_RE)) {
        const w = m[0];
        if (w.length < 2 || ignored(ignore, w) || checker.check(w)) continue;
        const from = base + (m.index ?? 0);
        out.push({ word: w, from, to: from + w.length });
      }
    });
  });
  return out;
}

/** Decorate every misspelled word in the say zones with a wavy underline. */
function computeDecos(doc: PMNode, checker: SpellChecker | null, ignore: Set<string>): DecorationSet {
  if (!checker) return DecorationSet.empty;
  const decos = misspellings(doc, checker, ignore).map((m) => Decoration.inline(m.from, m.to, { class: "spell-error" }));
  return DecorationSet.create(doc, decos);
}

/** The misspelled word straddling document position `pos` (for the right-click menu), or null. */
function wordAt(doc: PMNode, pos: number, checker: SpellChecker, ignore: Set<string>): { word: string; from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name !== "say") return null;
  const sayStart = $pos.start();
  const rel = pos - sayStart;
  for (const m of $pos.parent.textContent.matchAll(WORD_RE)) {
    const s = m.index ?? 0, e = s + m[0].length;
    if (rel >= s && rel <= e) {
      const w = m[0];
      return (w.length < 2 || ignored(ignore, w) || checker.check(w)) ? null : { word: w, from: sayStart + s, to: sayStart + e };
    }
  }
  return null;
}

export function spellcheckPlugin(): Plugin<SpellState> {
  return new Plugin<SpellState>({
    key,
    state: {
      init: () => ({ checker: null, ignore: new Set(), deco: DecorationSet.empty }),
      apply: (tr, value) => {
        const meta = tr.getMeta(key) as Partial<SpellState> | undefined;
        if (meta) {
          const checker = "checker" in meta ? (meta.checker ?? null) : value.checker;
          const ignore = meta.ignore ?? value.ignore;
          return { checker, ignore, deco: computeDecos(tr.doc, checker, ignore) };
        }
        if (tr.docChanged) return { ...value, deco: computeDecos(tr.doc, value.checker, value.ignore) };
        return value;
      },
    },
    props: { decorations: (state) => key.getState(state)?.deco ?? null },
    // Right-clicking a flagged word opens the fix menu. A CAPTURE-phase listener so it pre-empts the beat's
    // structural context menu (which bubbles) - but only when the click lands on an actual misspelling.
    view(editorView) {
      const floating = createFloating("spell-menu action-menu");
      const onContext = (e: MouseEvent): void => {
        const st = key.getState(editorView.state);
        if (!st?.checker) return;
        const at = editorView.posAtCoords({ left: e.clientX, top: e.clientY });
        if (!at) return;
        const hit = wordAt(editorView.state.doc, at.pos, st.checker, st.ignore);
        if (!hit) return;
        e.preventDefault(); e.stopPropagation();
        openMenu(editorView, floating, st.checker, hit);
      };
      editorView.dom.addEventListener("contextmenu", onContext, true);
      return { destroy: () => { editorView.dom.removeEventListener("contextmenu", onContext, true); floating.close(); } };
    },
  });
}

function openMenu(view: EditorView, floating: ReturnType<typeof createFloating>, checker: SpellChecker, hit: { word: string; from: number; to: number }): void {
  const el = floating.el; el.replaceChildren();
  const item = (label: string, cls: string, run: () => void): HTMLElement => {
    const b = document.createElement("button"); b.className = `action-mi ${cls}`; b.textContent = label;
    b.addEventListener("mousedown", (ev) => { ev.preventDefault(); run(); view.focus(); floating.close(); });
    return b;
  };
  const head = (text: string): HTMLElement => { const h = document.createElement("div"); h.className = "action-head"; h.textContent = text; return h; };

  const suggestions = checker.suggest(hit.word).slice(0, 5);
  if (suggestions.length) for (const s of suggestions) el.appendChild(item(s, "spell-suggest", () => view.dispatch(view.state.tr.insertText(s, hit.from, hit.to))));
  else el.appendChild(head("No suggestions"));
  const sep = document.createElement("div"); sep.className = "action-sep"; el.appendChild(sep);
  el.appendChild(item("Add to dictionary", "", () => addHandler?.(hit.word)));
  el.appendChild(item("Ignore", "", () => {
    // Instant feedback: drop the squiggle now via the session set. The host handler (when wired) then
    // PERSISTS the word to the project ignore list, rebuilds the engine, and refreshes the problems panel.
    const st = key.getState(view.state);
    view.dispatch(view.state.tr.setMeta(key, { ignore: new Set([...(st?.ignore ?? []), hit.word]) }));
    ignoreHandler?.(hit.word);
  }));

  floating.show(() => {
    const c = view.coordsAtPos(hit.from);
    const w = el.offsetWidth || 180;
    el.style.left = `${Math.round(Math.max(8, Math.min(c.left, window.innerWidth - w - 8)))}px`;
    el.style.top = `${Math.round(c.bottom + 4)}px`;
  });
  window.setTimeout(() => floating.dismissOnOutside(() => floating.close()), 0);
}

/** Push the spell engine (or null to turn spell-check off / when no dictionary is installed). */
export function setSpellChecker(view: EditorView, checker: SpellChecker | null): void {
  view.dispatch(view.state.tr.setMeta(key, { checker }));
}

/** Misspellings as { enclosing line/prose beat id, word } - the pure core (exported for tests). */
export function spellingIssuesIn(doc: PMNode, checker: SpellChecker, ignore: Set<string>): Array<{ nodeId: string; word: string }> {
  const out: Array<{ nodeId: string; word: string }> = [];
  for (const m of misspellings(doc, checker, ignore)) {
    const $from = doc.resolve(m.from);
    let nodeId: string | null = null;
    for (let d = $from.depth; d >= 0; d--) { const t = $from.node(d).type.name; if (t === "line" || t === "prose") { nodeId = modelIdOf($from.node(d)); break; } }
    if (nodeId) out.push({ nodeId, word: m.word });
  }
  return out;
}

/** The open scene's misspellings as { beat node id, word } - the host lists them in the problems panel
 *  (#177). Empty when spell-check is off. */
export function spellingIssues(view: EditorView): Array<{ nodeId: string; word: string }> {
  const st = key.getState(view.state);
  return st?.checker ? spellingIssuesIn(view.state.doc, st.checker, st.ignore) : [];
}
