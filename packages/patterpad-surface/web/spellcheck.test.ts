// The inline spell-check squiggle logic (#177): build a doc with a say zone and confirm `misspellings`
// flags exactly the wrong words (with correct ranges) and honours the ignore set. A fake checker stands in
// for nspell so the test is fast and deterministic.

import { describe, it, expect } from "vitest";
import type { Scene } from "@patterkit/model";
import { sceneToDoc } from "../src/bridge.js";
import { EditorState, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { misspellings, spellingIssuesIn, updateDecos } from "./spellcheck.js";

// "teh" and "wuld" are wrong; everything else is "correct".
const checker = { check: (w: string) => !["teh", "wuld"].includes(w.toLowerCase()), suggest: () => ["the"] };

function docWith(text: string): ReturnType<typeof sceneToDoc> {
  const scene: Scene = {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "M", children: [{ id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }] }] },
    ],
  };
  return sceneToDoc(scene, { T1: text });
}

describe("spell-check squiggle ranges (#177)", () => {
  it("flags only the misspelled words in the say zone", () => {
    const hits = misspellings(docWith("the teh tavern wuld end"), checker, new Set());
    expect(hits.map((h) => h.word)).toEqual(["teh", "wuld"]);
  });

  it("each range slices back to exactly the flagged word", () => {
    const doc = docWith("a teh here");
    const [hit] = misspellings(doc, checker, new Set());
    expect(doc.textBetween(hit!.from, hit!.to)).toBe("teh");
  });

  it("honours the ignore set (a session 'Ignore')", () => {
    expect(misspellings(docWith("teh wuld"), checker, new Set(["teh"])).map((h) => h.word)).toEqual(["wuld"]);
  });

  it("flags nothing when every word is correct", () => {
    expect(misspellings(docWith("the tavern is dim"), checker, new Set())).toHaveLength(0);
  });

  it("maps each misspelling to its enclosing beat id (for the problems panel, #177)", () => {
    expect(spellingIssuesIn(docWith("the teh wuld end"), checker, new Set())).toEqual([
      { nodeId: "T1", word: "teh" },
      { nodeId: "T1", word: "wuld" },
    ]);
  });
});

// Review 2026-10, MEDIUM 39: the squiggles are mapped through each edit and only the touched say zones
// are checked again. The incremental set must always equal a full re-check, through typing, a merge, a
// paragraph split, a deletion across beats, and an undo-like reinsert.

describe("spell-check is incremental (review 2026-10)", () => {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "M", children: [
    { id: "sn1", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }, { id: "T3", kind: "text" }] },
  ] }] };
  const ranges = (set: DecorationSet, doc: EditorState["doc"]): string[] => set.find(0, doc.content.size).map((d) => `${d.from}-${d.to}`).sort();
  const full = (doc: EditorState["doc"]): string[] => misspellings(doc, checker, new Set()).map((m) => `${m.from}-${m.to}`).sort();

  it("matches a full re-check after every kind of edit", () => {
    let state = EditorState.create({ doc: sceneToDoc(scene, { T1: "teh one", T2: "two wuld", T3: "three" }) });
    // Seed from a full check, then only ever update incrementally.
    let deco = DecorationSet.create(state.doc, misspellings(state.doc, checker, new Set()).map((m) => Decoration.inline(m.from, m.to, { class: "spell-error" })));
    const step = (make: (s: EditorState) => import("prosemirror-state").Transaction): void => {
      const tr = make(state);
      deco = updateDecos(tr, deco, checker, new Set());
      state = state.apply(tr);
      expect(ranges(deco, state.doc)).toEqual(full(state.doc));
    };
    const sayStart = (s: EditorState, i: number): number => { const out: number[] = []; s.doc.descendants((n, p) => { if (n.type.name === "say") out.push(p + 1); return true; }); return out[i]!; };
    step((s) => s.tr.insertText(" teh", sayStart(s, 2) + 5));                      // typing a new misspelling
    step((s) => s.tr.insertText("x", sayStart(s, 0) + 1));                         // breaking one ("txeh")
    step((s) => s.tr.delete(sayStart(s, 0) + 1, sayStart(s, 0) + 2));              // and mending it again
    step((s) => s.tr.setSelection(TextSelection.create(s.doc, sayStart(s, 0) + 4, sayStart(s, 1) + 3)).deleteSelection()); // across beats
    step((s) => s.tr.insertText("wuld", sayStart(s, 1)));                          // into the next line
  });
});
