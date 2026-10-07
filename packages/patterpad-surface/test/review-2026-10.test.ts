// ---------------------------------------------------------------------------
// The surface findings of the Patterpad review, October 2026, that are pure over
// EditorState: each test names its finding and sets up the trigger the review
// reproduced. (Ruling D has its own file, structure-guard.test.ts; paste is in
// paste.test.ts; the DOM-side findings are in web/review-2026-10.test.ts.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection, type Command } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { setSnippetJump } from "../src/special.js";
import { backspace, forwardDelete } from "../src/delete.js";
import { toggleLineType, flipToFreeText, promoteToDialogue } from "../src/linetype.js";
import { enter } from "../src/lines.js";
import { unwrapGroup, wrapChunksAt, wrapChunk, setGroupProps } from "../src/groups.js";
import { duplicateChunk } from "../src/duplicate.js";
import { context } from "../src/context.js";
import { hintsFor } from "../src/hints.js";

type Children = Scene["blocks"][0]["children"];
const FMT = true;
const stateOf = (children: Children, strings: Record<string, string> = {}): EditorState =>
  EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] }, strings, FMT) });
const zonePos = (s: EditorState, beatId: string, role: string, offset = 0): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1 + offset; }); return false; }
    return true;
  });
  return p;
};
const zoneEnd = (s: EditorState, beatId: string, role: string): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1 + z.content.size; }); return false; }
    return true;
  });
  return p;
};
const at = (s: EditorState, from: number, to = from): EditorState => s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = n.apply(tr); }); return n; };
const nodePos = (s: EditorState, id: string): number => {
  let p = -1;
  s.doc.descendants((n, pos) => { if (p < 0 && (n.type.name === "snippet" || n.type.name === "group") && JSON.parse(n.attrs.raw).id === id) p = pos; return p < 0; });
  return p;
};
const out = (s: EditorState) => docToScene(s.doc, FMT);
const kids = (s: EditorState) => out(s).scene.blocks[0]!.children as unknown as Array<Record<string, unknown>>;

describe("HIGH 6: setting a jump never deletes a game event or a beat carrying data", () => {
  it("a bubble holding only a game event keeps it", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "A1", kind: "gameEvent", gameData: { cue: "x" } } as never] }]);
    const next = s.apply(setSnippetJump(s, nodePos(s, "sn"), "END")!);
    const snip = kids(next)[0]!;
    expect((snip.beats as Array<{ id: string }>).map((b) => b.id)).toEqual(["A1"]);
    expect(snip.jump).toEqual({ to: "END" });
  });
  it("an empty line carrying game data or tags is kept", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", gameData: { k: 1 } } as never, { id: "L2", kind: "text", tags: ["t"] } as never] }]);
    const next = s.apply(setSnippetJump(s, nodePos(s, "sn"), "END")!);
    expect((kids(next)[0]!.beats as Array<{ id: string }>).map((b) => b.id)).toEqual(["L1", "L2"]);
  });
  it("a wholly blank bubble still collapses to a jump-only row", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] }]);
    const next = s.apply(setSnippetJump(s, nodePos(s, "sn"), "END")!);
    expect(kids(next)[0]!.beats).toBeUndefined();
  });
});

describe("MEDIUM 32: bold and italic survive merges and line-type toggles", () => {
  it("Backspace merging a text line into the one above keeps both lines' marks", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }] }], { T1: "ends <b>bold</b>", T2: "plain <i>ital</i>" });
    expect(out(run(at(s, zonePos(s, "T2", "say")), backspace)).strings.T1).toBe("ends <b>bold</b>plain <i>ital</i>");
  });
  it("Backspace merging into the previous bubble keeps the marks", () => {
    const s = stateOf([{ id: "a", type: "snippet", beats: [{ id: "T1", kind: "text" }] }, { id: "b", type: "snippet", beats: [{ id: "T2", kind: "text" }] }], { T1: "<b>bold</b> start", T2: "plain <i>ital</i>" });
    expect(out(run(at(s, zonePos(s, "T2", "say")), backspace)).strings.T1).toBe("<b>bold</b> startplain <i>ital</i>");
  });
  it("dissolving a dialogue line into the one above (name selected, Backspace) keeps the marks", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "L2", kind: "line", character: "BO" }] }], { L1: "I am <b>bold</b>", L2: "and <i>this</i> too" });
    const sel = at(s, zonePos(s, "L2", "cue"), zoneEnd(s, "L2", "cue"));
    expect(out(run(sel, backspace)).strings.L1).toBe("I am <b>bold</b>and <i>this</i> too");
  });
  it("Cmd-T both ways keeps the say's marks", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] }], { L1: "a <b>b</b> <i>c</i>" });
    const prose = run(at(s, zonePos(s, "L1", "say", 1)), toggleLineType);
    expect(out(prose).strings.L1).toBe("ANNA: a <b>b</b> <i>c</i>");
    const back = run(at(prose, zonePos(prose, "L1", "say", 8)), toggleLineType);
    expect(out(back).strings.L1).toBe("a <b>b</b> <i>c</i>");
  });
  it("the Space flip and the Tab promote keep the marks", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line" }] }], { L1: "<i>soft</i> words" });
    const flipped = s.apply(flipToFreeText(at(s, zonePos(s, "L1", "cue")))!);
    expect(out(flipped).strings.L1).toBe("<i>soft</i> words");
    const promoted = run(at(flipped, zonePos(flipped, "L1", "say")), promoteToDialogue);
    expect(out(promoted).strings.L1).toBe("<i>soft</i> words");
  });
});

describe("MEDIUM 37: forward Delete has a designed behaviour", () => {
  const two = (): EditorState => stateOf([{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "L2", kind: "line", character: "BO" }, { id: "A1", kind: "gameEvent" }] }], { T1: "One <b>bold</b>", L2: "Two" });

  it("at a line's end, folds the next line's words into this one (marks kept); no node selection", () => {
    const s = two();
    const next = run(at(s, zoneEnd(s, "T1", "say")), forwardDelete);
    expect(out(next).strings.T1).toBe("One <b>bold</b>Two");
    expect((kids(next)[0]!.beats as Array<{ id: string }>).map((b) => b.id)).toEqual(["T1", "A1"]);
    expect(next.selection).toBeInstanceOf(TextSelection);
    expect(next.selection.from).toBe(zonePos(next, "T1", "say", "One bold".length));
  });
  it("before a game event, does nothing (it is removed only by its ×)", () => {
    const s = two();
    const from = at(s, zoneEnd(s, "L2", "say"));
    const next = run(from, forwardDelete);
    expect(next.doc.eq(from.doc)).toBe(true);
    expect(next.selection).not.toBeInstanceOf(NodeSelection);
  });
  it("at the end of a name, does nothing", () => {
    const s = two();
    const from = at(s, zoneEnd(s, "L2", "cue"));
    expect(run(from, forwardDelete).doc.eq(from.doc)).toBe(true);
  });
  it("leaves a next line carrying game data alone", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text", gameData: { k: 1 } } as never] }], { T1: "a", T2: "b" });
    const from = at(s, zoneEnd(s, "T1", "say"));
    expect(run(from, forwardDelete).doc.eq(from.doc)).toBe(true);
  });
  it("collapses an empty direction, as Backspace does", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "A", direction: "x" }] }], { L1: "hi" });
    const emptied = s.apply(s.tr.delete(zonePos(s, "L1", "paren"), zoneEnd(s, "L1", "paren")));
    const next = run(at(emptied, zonePos(emptied, "L1", "paren")), forwardDelete);
    expect(out(next).scene.blocks[0]!.children[0]).toMatchObject({ beats: [{ id: "L1", character: "A" }] });
    expect((out(next).scene.blocks[0]!.children[0] as { beats: Array<{ direction?: string }> }).beats[0]!.direction).toBeUndefined();
    expect(context(next).zone?.role).toBe("say");
  });
});

describe("LOW: Backspace at a dialogue prompt's say start behaves like a normal line's", () => {
  const choice = (): EditorState => stateOf([{ id: "ch", type: "group", selector: "choice", children: [
    { id: "opt", type: "group", prompt: { id: "P1", kind: "line", character: "ANNA" }, children: [{ id: "o", type: "snippet", beats: [{ id: "T9", kind: "text" }] }] },
  ] }], { P1: "Hi there", T9: "Body" });
  it("selects the whole speaker, and never deletes it", () => {
    const s = choice();
    const once = run(at(s, zonePos(s, "P1", "say")), backspace);
    expect(once.doc.textBetween(once.selection.from, once.selection.to)).toBe("ANNA");
    expect(once.doc.eq(s.doc)).toBe(true);
  });
  it("a second Backspace at the prompt's left edge is swallowed (nothing merges out of a prompt)", () => {
    const s = choice();
    const atCueStart = at(s, zonePos(s, "P1", "cue"));
    expect(run(atCueStart, backspace).doc.eq(s.doc)).toBe(true);
  });
});

describe("LOW: Enter with a selection replaces it", () => {
  it("deletes the selected words, then splits at the caret", () => {
    const s = stateOf([{ id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }] }], { T1: "keep DROP rest" });
    const next = run(at(s, zonePos(s, "T1", "say", 5), zonePos(s, "T1", "say", 10)), enter);
    const sc = out(next);
    const beats = (sc.scene.blocks[0]!.children[0] as { beats: Array<{ id: string }> }).beats;
    expect(beats.length).toBe(2);
    expect(sc.strings.T1).toBe("keep ");
    expect(sc.strings[beats[1]!.id]).toBe("rest");
  });
});

describe("MEDIUM 34: ungrouping a choice leaves no dead prompts", () => {
  it("each option becomes a plain group: prompt and option-only fields gone, condition kept", () => {
    const s = stateOf([{ id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, condition: "@c", sticky: true, fallback: true, children: [{ id: "x1", type: "snippet", beats: [{ id: "T1", kind: "text" }] }] } as never,
      { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, secretUntilEligible: true, children: [{ id: "x2", type: "snippet", beats: [{ id: "T2", kind: "text" }] }] } as never,
    ] }], { P1: "One", P2: "Two", T1: "a", T2: "b" });
    const next = s.apply(unwrapGroup(s, nodePos(s, "ch"))!);
    const k = kids(next);
    expect(k.map((g) => g.id)).toEqual(["o1", "o2"]);
    for (const g of k) { expect(g.prompt).toBeUndefined(); expect(g.sticky).toBeUndefined(); expect(g.fallback).toBeUndefined(); expect(g.secretUntilEligible).toBeUndefined(); }
    expect(k[0]!.condition).toBe("@c");
  });
});

describe("MEDIUM 35: options cannot be wrapped", () => {
  const options = (): EditorState => stateOf([{ id: "ch", type: "group", selector: "choice", children: [
    { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [] },
    { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, children: [] },
  ] }], { P1: "One", P2: "Two" });
  it("a multi-selection of options is refused", () => {
    const s = options();
    expect(wrapChunksAt(s, [nodePos(s, "o1"), nodePos(s, "o2")], "sequence")).toBeNull();
  });
  it("a single option is refused too", () => {
    const s = options();
    expect(wrapChunk(s, nodePos(s, "o1"), "if")).toBeNull();
  });
});

describe("LOW: Duplicate never copies an option's fallback", () => {
  it("the copy of the fallback option is not a second fallback", () => {
    const s = stateOf([{ id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, fallback: true, children: [] } as never,
    ] }], { P1: "One" });
    const next = s.apply(duplicateChunk(s, nodePos(s, "o1"))!.tr);
    const opts = (kids(next)[0]!.children as Array<{ fallback?: boolean }>);
    expect(opts.map((o) => o.fallback ?? false)).toEqual([true, false]);
  });
});

describe("LOW: a group's order can be set to best match (specificity)", () => {
  it("setGroupProps accepts order: specificity", () => {
    const s = stateOf([{ id: "g", type: "group", selector: "sequence", options: { order: "sequential", exhaust: "once" }, children: [] }]);
    const next = s.apply(setGroupProps(s, nodePos(s, "g"), { order: "specificity" })!);
    expect(kids(next)[0]!.options).toEqual({ order: "specificity", exhaust: "once" });
  });
});

describe("LOW: prompt hints offer only keys that work there", () => {
  it("no Enter or Shift+Enter in a choice prompt", () => {
    const s = stateOf([{ id: "ch", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "line", character: "A" }, children: [] },
    ] }], { P1: "" });
    const keys = hintsFor(context(at(s, zonePos(s, "P1", "say")))).map((h) => h.key);
    expect(keys).not.toContain("Enter");
    expect(keys).not.toContain("Shift+Enter");
    expect(keys.length).toBeGreaterThan(0);
  });
});
