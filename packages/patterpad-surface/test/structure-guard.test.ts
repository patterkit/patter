// ---------------------------------------------------------------------------
// Ruling D (review 2026-10, HIGH 9): a structural merge or range replace that would
// drop a snippet's logic (condition, effects, jump) or remove a whole group is
// REFUSED, with a sentence for the host to toast; the ordinary merge of two plain
// bubbles still goes through. Each route the review reproduced has its trigger here.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command, type Transaction } from "prosemirror-state";
import { undo, history } from "prosemirror-history";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { backspace, forwardDelete, deleteSelectionGuarded } from "../src/delete.js";
import { joinSnippet, moveChunk, deleteChunk } from "../src/groups.js";
import { structureGuard, structureLoss } from "../src/guard.js";

type Children = Scene["blocks"][0]["children"];

/** A state with the guard installed; refusals are collected in `said`. */
function setup(children: Children, strings: Record<string, string>) {
  const said: string[] = [];
  const doc = sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] }, strings);
  const state = EditorState.create({ doc, plugins: [structureGuard((m) => said.push(m)), history()] });
  return { state, said };
}
const sayPos = (s: EditorState, beatId: string, offset = 0): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1 + offset; }); return false; }
    return true;
  });
  return p;
};
const sayEnd = (s: EditorState, beatId: string): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === "say") p = pos + 1 + o + 1 + z.content.size; }); return false; }
    return true;
  });
  return p;
};
const at = (s: EditorState, from: number, to = from): EditorState => s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
/** Run a command; dispatched transactions go through `apply`, so the guard filters them. */
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = n.apply(tr); }); return n; };
const ids = (s: EditorState): string[] => (docToScene(s.doc).scene.blocks[0]!.children as Array<{ id: string }>).map((c) => c.id);
const snipPos = (s: EditorState, id: string): number => {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet" && JSON.parse(n.attrs.raw).id === id) p = pos; return p < 0; });
  return p;
};

const text = (id: string) => ({ id, kind: "text" as const });
const strings = { T1: "Alpha beta", T2: "Gamma delta", T3: "Epsilon", P1: "Pick me", T9: "Option body" };

describe("ruling D: Backspace at a bubble's start", () => {
  it("merges two plain bubbles as before", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] }, { id: "b", type: "snippet", beats: [text("T2")] }], strings);
    const out = run(at(state, sayPos(state, "T2")), backspace);
    expect(ids(out)).toEqual(["a"]);
    expect(docToScene(out.doc).strings.T1).toBe("Alpha betaGamma delta");
    expect(said).toEqual([]);
  });

  it("refuses when this bubble has a condition, and says so", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] }, { id: "b", type: "snippet", condition: "@x", beats: [text("T2")] }], strings);
    const out = run(at(state, sayPos(state, "T2")), backspace);
    expect(out.doc.eq(state.doc)).toBe(true);
    expect(said).toEqual(["This bubble has a condition. Move or clear it first."]);
  });

  it("refuses when the previous bubble ends in a jump (it would land after these lines)", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", jump: { to: "END" }, beats: [text("T1")] }, { id: "b", type: "snippet", beats: [text("T2")] }], strings);
    const out = run(at(state, sayPos(state, "T2")), backspace);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(said[0]).toMatch(/previous bubble ends in a jump/);
  });
});

describe("ruling D: forward Delete at a bubble's end", () => {
  it("never merges across bubbles (so nothing can be dropped)", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] }, { id: "b", type: "snippet", condition: "@x", jump: { to: "END" }, beats: [text("T2")] }], strings);
    const s = at(state, sayEnd(state, "T1"));
    let dispatched = false;
    expect(forwardDelete(s, () => { dispatched = true; })).toBe(true); // handled: never falls to joinForward
    expect(dispatched).toBe(false);
    expect(said).toEqual([]);
  });
});

describe("ruling D: Join with next / previous", () => {
  it("refuses a join that would drop the next bubble's condition and effects", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] },
      { id: "b", type: "snippet", condition: "@x", onEnter: [{ kind: "set", target: "@y", value: "1" }], beats: [text("T2")] }], strings);
    const tr = joinSnippet(state, snipPos(state, "a"), "down")!;
    expect(tr).not.toBeNull(); // still offered, so the menu item explains itself when picked
    const out = state.apply(tr);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(said).toEqual(["The next bubble has a condition and effects. Move or clear them first."]);
  });

  it("refuses a join that would drop the leading bubble's jump", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", jump: { to: "END" }, beats: [text("T1")] }, { id: "b", type: "snippet", beats: [text("T2")] }], strings);
    const out = state.apply(joinSnippet(state, snipPos(state, "b"), "up")!);
    expect(ids(out)).toEqual(["a", "b"]);
    expect(said[0]).toBe("The previous bubble ends in a jump. Move or clear it first.");
  });

  it("still joins when the trailing bubble's only logic is its jump (the jump is carried)", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] }, { id: "b", type: "snippet", jump: { to: "END" }, beats: [text("T2")] }], strings);
    const out = state.apply(joinSnippet(state, snipPos(state, "a"), "down")!);
    const kids = docToScene(out.doc).scene.blocks[0]!.children as Array<{ id: string; jump?: { to: string } }>;
    expect(kids.map((k) => k.id)).toEqual(["a"]);
    expect(kids[0]!.jump).toEqual({ to: "END" });
    expect(said).toEqual([]);
  });
});

describe("ruling D: range edits across bubbles", () => {
  const two = (): Children => [
    { id: "a", type: "snippet", condition: "@a", beats: [text("T1")] },
    { id: "b", type: "snippet", condition: "@b", onEnter: [{ kind: "set", target: "@x", value: "1" }], jump: { to: "END" }, beats: [text("T2")] },
  ];

  it("refuses a range delete that would drop the second bubble's logic", () => {
    const { state, said } = setup(two(), strings);
    const s = at(state, sayPos(state, "T1", 6), sayPos(state, "T2", 6));
    const out = run(s, deleteSelectionGuarded);
    expect(out.doc.eq(state.doc)).toBe(true);
    expect(said[0]).toBe("A bubble in the selection has a condition, effects, and a jump. Move or clear them first.");
  });

  it("refuses typing over that range too (one filter covers every route)", () => {
    const { state, said } = setup(two(), strings);
    const s = at(state, sayPos(state, "T1", 6), sayPos(state, "T2", 6));
    const out = s.apply(s.tr.insertText("x"));
    expect(out.doc.eq(s.doc)).toBe(true);
    expect(said.length).toBe(1);
  });

  it("lets a range delete across two PLAIN bubbles through", () => {
    const { state, said } = setup([{ id: "a", type: "snippet", beats: [text("T1")] }, { id: "b", type: "snippet", beats: [text("T2")] }], strings);
    const out = run(at(state, sayPos(state, "T1", 6), sayPos(state, "T2", 6)), deleteSelectionGuarded);
    expect(docToScene(out.doc).strings.T1).toBe("Alpha delta");
    expect(said).toEqual([]);
  });

  it("refuses a range delete into a choice, naming the choice", () => {
    const { state, said } = setup([
      { id: "a", type: "snippet", beats: [text("T1")] },
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "opt", type: "group", prompt: { id: "P1", kind: "text" }, children: [{ id: "o", type: "snippet", beats: [text("T9")] }] },
      ] },
    ], strings);
    const out = run(at(state, sayPos(state, "T1", 6), sayPos(state, "T9", 3)), deleteSelectionGuarded);
    expect(ids(out)).toEqual(["a", "ch"]);
    expect(said[0]).toBe("A choice in the selection would be lost. To remove it, use Delete on its menu.");
  });
});

describe("ruling D: deliberate structure passes", () => {
  const withLogic = (): Children => [
    { id: "a", type: "snippet", condition: "@a", beats: [text("T1")] },
    { id: "b", type: "snippet", condition: "@b", jump: { to: "END" }, beats: [text("T2")] },
  ];
  it("a move (delete + insert of the same node) is not a loss", () => {
    const { state, said } = setup(withLogic(), strings);
    const out = state.apply(moveChunk(state, snipPos(state, "b"), "up")!);
    expect(ids(out)).toEqual(["b", "a"]);
    expect(said).toEqual([]);
  });
  it("a deliberate delete (the menu's, after its confirm) is not refused", () => {
    const { state, said } = setup(withLogic(), strings);
    const out = state.apply(deleteChunk(state, snipPos(state, "b"))!);
    expect(ids(out)).toEqual(["a"]);
    expect(said).toEqual([]);
  });
  it("undo is never refused", () => {
    const { state } = setup(withLogic(), strings);
    const deleted = state.apply(deleteChunk(state, snipPos(state, "b"))!);
    let undone: EditorState = deleted;
    undo(deleted, (tr: Transaction) => { expect(structureLoss(tr, deleted)).toBeNull(); undone = deleted.apply(tr); });
    expect(ids(undone)).toEqual(["a", "b"]);
  });
  it("ordinary typing is never inspected past its own textblock", () => {
    const { state } = setup(withLogic(), strings);
    const s = at(state, sayPos(state, "T1", 2));
    expect(structureLoss(s.tr.insertText("zz"), s)).toBeNull();
  });
});
