// ---------------------------------------------------------------------------
// Ruling E (review 2026-10, HIGH 10): paste. Multi-paragraph text becomes new text
// beats with fresh ids; a copied dialogue line copies as its words (no speaker); a
// copy across beats pastes without throwing, its line breaks kept. The clipboard
// reading half (HTML, Google Docs) is in web/clipboard.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { Fragment } from "prosemirror-model";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { patterSchema as S } from "../src/schema.js";
import { clipboardText, pasteParagraphs, textParagraphs } from "../src/paste.js";

type Children = Scene["blocks"][0]["children"];
const stateOf = (children: Children, strings: Record<string, string>): EditorState =>
  EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children }] }, strings, true) });
const zonePos = (s: EditorState, beatId: string, role: string, offset = 0): number => {
  let p = -1;
  s.doc.descendants((n, pos) => {
    if (p < 0 && (n.type.name === "line" || n.type.name === "prose") && n.attrs.id === beatId) { n.forEach((z, o) => { if (z.type.name === role) p = pos + 1 + o + 1 + offset; }); return false; }
    return true;
  });
  return p;
};
const at = (s: EditorState, from: number, to = from): EditorState => s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)));
const beatsOf = (s: EditorState) => (docToScene(s.doc, true).scene.blocks[0]!.children[0] as { beats: Array<{ id: string; kind: string }> }).beats;
const strings = (s: EditorState) => docToScene(s.doc, true).strings;
const para = (t: string): Fragment => Fragment.from(S.text(t));

describe("paste: paragraphs into a bubble", () => {
  const one = (): EditorState => stateOf([{ id: "sn", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "T2", kind: "text" }] }], { L1: "Before|after", T2: "Next" });

  it("one paragraph goes in at the caret, like typing", () => {
    const s = one();
    const next = s.apply(pasteParagraphs(at(s, zonePos(s, "L1", "say", 7)), [para("X")], true)!);
    expect(strings(next).L1).toBe("Before|Xafter");
  });

  it("several paragraphs: the first joins this line, the rest become text beats with fresh ids, the tail moves to the last", () => {
    const s = one();
    const next = s.apply(pasteParagraphs(at(s, zonePos(s, "L1", "say", 7)), [para("One"), para("Two"), para("Three")], true)!);
    const beats = beatsOf(next);
    expect(beats.map((b) => b.kind)).toEqual(["line", "text", "text", "text"]);
    expect(beats[0]!.id).toBe("L1");
    expect(beats[3]!.id).toBe("T2");
    const fresh = [beats[1]!.id, beats[2]!.id];
    expect(new Set(fresh).size).toBe(2);
    for (const id of fresh) expect(["L1", "T2"]).not.toContain(id);
    const str = strings(next);
    expect([str.L1, str[fresh[0]!], str[fresh[1]!]]).toEqual(["Before|One", "Two", "Threeafter"]);
    // The caret rests after the pasted text, before the moved tail.
    expect(next.selection.from).toBe(zonePos(next, fresh[1]!, "say", "Three".length));
  });

  it("strips bold and italic when the project has formatting off", () => {
    const s = one();
    const bold = Fragment.from(S.text("B", [S.mark("strong")]));
    const next = s.apply(pasteParagraphs(at(s, zonePos(s, "L1", "say", 0)), [bold], false)!);
    expect(docToScene(next.doc, true).strings.L1).toBe("BBefore|after");
  });

  it("a selected bubble takes the paragraphs as new lines at its end, never replaced", () => {
    const s = one();
    const sel = s.apply(s.tr.setSelection(NodeSelection.create(s.doc, 1))); // the snippet: the block opens at 0
    const next = sel.apply(pasteParagraphs(sel, [para("A"), para("B")], true)!);
    expect(beatsOf(next).length).toBe(4);
    expect(beatsOf(next).slice(0, 2).map((b) => b.id)).toEqual(["L1", "T2"]);
  });
});

describe("paste: fields that hold one line", () => {
  const choice = (): EditorState => stateOf([{ id: "ch", type: "group", selector: "choice", children: [
    { id: "o", type: "group", prompt: { id: "P1", kind: "line", character: "ANNA", direction: "dir" }, children: [] },
  ] }], { P1: "Pick" });
  it("several paragraphs in a choice prompt are joined with spaces (no beat can follow a prompt)", () => {
    const s = choice();
    const next = s.apply(pasteParagraphs(at(s, zonePos(s, "P1", "say", 4)), [para(" one"), para("two")], true)!);
    expect(strings(next).P1).toBe("Pick one two");
  });
  it("into a direction: joined and plain", () => {
    const s = choice();
    const next = s.apply(pasteParagraphs(at(s, zonePos(s, "P1", "paren", 3)), [para("a"), para("b")], true)!);
    const prompt = (docToScene(next.doc, true).scene.blocks[0]!.children[0] as { children: Array<{ prompt: { direction: string } }> }).children[0]!.prompt;
    expect(prompt.direction).toBe("dira b");
  });
  it("into a speaker name: refused (the cast popup owns the name)", () => {
    const s = choice();
    expect(pasteParagraphs(at(s, zonePos(s, "P1", "cue", 1)), [para("BOB")], true)).toBeNull();
  });
});

describe("paste: a copy across beats", () => {
  const scene = (): EditorState => stateOf([{ id: "sn", type: "snippet", beats: [
    { id: "L1", kind: "line", character: "ANNA" }, { id: "T2", kind: "text" }, { id: "T3", kind: "text" },
  ] }], { L1: "Hello there", T2: "Narration line", T3: "Target" });

  it("copies as the words of each beat, one per line, never the speaker", () => {
    const s = scene();
    const slice = TextSelection.create(s.doc, zonePos(s, "L1", "cue"), zonePos(s, "T2", "say", 9)).content();
    expect(clipboardText(slice)).toBe("Hello there\nNarration");
  });
  it("a whole dialogue line copies as its spoken text only", () => {
    const s = scene();
    let from = -1, to = -1;
    s.doc.descendants((n, pos) => { if (n.type.name === "line") { from = pos; to = pos + n.nodeSize; } return from < 0; });
    expect(clipboardText(s.doc.slice(from, to))).toBe("Hello there");
  });
  it("pastes back without throwing, its line break kept as a new beat", () => {
    const s = scene();
    const slice = TextSelection.create(s.doc, zonePos(s, "L1", "say", 6), zonePos(s, "T2", "say", 9)).content();
    const paras = textParagraphs(clipboardText(slice));
    let tr = null as ReturnType<typeof pasteParagraphs>;
    expect(() => { tr = pasteParagraphs(at(s, zonePos(s, "T3", "say", 6)), paras, true); }).not.toThrow();
    const next = s.apply(tr!);
    const beats = beatsOf(next);
    expect(beats.length).toBe(4);
    expect(strings(next).T3).toBe("Targetthere");
    expect(strings(next)[beats[3]!.id]).toBe("Narration");
  });
});

describe("textParagraphs", () => {
  it("one paragraph per non-blank line, whitespace tidied", () => {
    expect(textParagraphs("Line one\nLine two\n\n  Line   three \r\n").map((f) => f.textBetween(0, f.size))).toEqual(["Line one", "Line two", "Line three"]);
  });
});
