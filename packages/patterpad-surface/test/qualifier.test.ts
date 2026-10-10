// ---------------------------------------------------------------------------
// Speaker qualifiers (design/proposals/speaker-qualifiers.md §3): a line's
// qualifier rides through the bridge untouched, and runs inherit it when a line
// is added or a blank line is named, on real EditorStates read back through the
// bridge. The cue drawing is web/qualifiers.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { enter, endBubble } from "../src/lines.js";
import { acceptCueForBeat } from "../src/cuezone.js";
import { toggleLineType } from "../src/linetype.js";
import { duplicateChunk } from "../src/duplicate.js";
import { findByModelId } from "../src/zoneutil.js";
import { inheritQualifiers, cycleQualifier, nextQualifier, qualifierOf } from "../src/qualifier.js";

/** The inheritance rule as the surface runs it: an appended transaction after every edit. */
const inheritance = new Plugin({ appendTransaction: (trs, a, b) => inheritQualifiers(trs, a, b) });

const L = (id: string, character: string, qualifier?: string) => ({ id, kind: "line" as const, character, ...(qualifier ? { qualifier } : {}) });

function build(blocks: Scene["blocks"], strings: Record<string, string> = {}): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks };
  return EditorState.create({ doc: sceneToDoc(scene, strings), plugins: [history(), inheritance] });
}
const block = (id: string, beats: ReturnType<typeof L>[]): Scene["blocks"][number] =>
  ({ id, type: "block", name: id, children: [{ id: `sn_${id}`, type: "snippet", beats }] });

/** The caret at the end of a beat's say. */
function caretAtEnd(state: EditorState, beatId: string): EditorState {
  const at = findByModelId(state.doc, beatId)!;
  let end = -1;
  at.node.forEach((z, off) => { if (z.type.name === "say") end = at.pos + 1 + off + 1 + z.content.size; });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
}
const run = (state: EditorState, cmd: Command): EditorState => {
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
};
/** Every line in document order as [character, qualifier ("" for none)]. */
function lines(state: EditorState): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  state.doc.descendants((n) => {
    if (n.type.name === "line") { out.push([n.firstChild?.textContent ?? "", qualifierOf(n) ?? ""]); return false; }
    return true;
  });
  return out;
}
/** The id of the line after `beatId` in document order. */
function lineAfter(state: EditorState, beatId: string): string {
  const ids: string[] = [];
  state.doc.descendants((n) => { if (n.type.name === "line") { ids.push(n.attrs.id as string); return false; } return true; });
  return ids[ids.indexOf(beatId) + 1]!;
}

describe("the bridge carries a line's qualifier", () => {
  it("round-trips on a line and on a line-kind option prompt, and absent stays absent", () => {
    const scene: Scene = {
      id: "s", type: "scene", name: "S", blocks: [{
        id: "b", type: "block", name: "M", children: [
          { id: "sn", type: "snippet", beats: [L("L1", "TAM", "os"), L("L2", "TAM"), { id: "L3", kind: "line", character: "BO", direction: "quietly", qualifier: "vo" }] },
          { id: "g", type: "group", selector: "choice", children: [
            { id: "o1", type: "group", prompt: { id: "P1", kind: "line", character: "PLAYER", qualifier: "radio" }, children: [{ id: "sn2", type: "snippet", jump: { to: "END" } }] },
          ] },
        ],
      }],
    };
    const strings = { L1: "Who's there?", L2: "Hello?", L3: "Nobody.", P1: "Come in." };
    const back = docToScene(sceneToDoc(scene, strings));
    expect(back.scene).toEqual(scene);
    expect(back.strings).toEqual(strings);
  });

  it("a line turned into text leaves its qualifier behind (a text beat has none)", () => {
    let s = build([block("b", [L("L1", "TAM", "os")])], { L1: "Psst." });
    s = caretAtEnd(s, "L1");
    s = run(s, toggleLineType);
    const beat = docToScene(s.doc).scene.blocks[0]!.children[0]!;
    expect((beat as unknown as { beats: Array<Record<string, unknown>> }).beats[0]).toEqual({ id: "L1", kind: "text" });
  });
});

describe("runs inherit a qualifier when a line is added", () => {
  it("Enter after a qualified line carries it to the new line by the same speaker", () => {
    let s = build([block("b", [L("L1", "TAM", "vo")])], { L1: "I wonder." });
    s = run(caretAtEnd(s, "L1"), enter);
    expect(lines(s)).toEqual([["TAM", "vo"], ["TAM", "vo"]]);
  });

  it("a split mid-line and a new bubble carry it too", () => {
    let s = build([block("b", [L("L1", "TAM", "os")])], { L1: "Open the door." });
    const at = findByModelId(s.doc, "L1")!;
    let sayStart = -1;
    at.node.forEach((z, off) => { if (z.type.name === "say") sayStart = at.pos + 1 + off + 1; });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, sayStart + 4))); // "Open| the door."
    s = run(s, enter);
    s = run(caretAtEnd(s, lineAfter(s, "L1")), endBubble);
    expect(lines(s)).toEqual([["TAM", "os"], ["TAM", "os"], ["TAM", "os"]]);
  });

  it("takes the NEAREST earlier line by that speaker, so none there means none", () => {
    let s = build([block("b", [L("L1", "TAM", "vo"), L("L2", "TAM")])], { L1: "A thought.", L2: "Out loud." });
    s = run(caretAtEnd(s, "L2"), enter);
    expect(lines(s)).toEqual([["TAM", "vo"], ["TAM", ""], ["TAM", ""]]);
  });

  it("follows position: a line inserted between two V.O. lines takes V.O.", () => {
    let s = build([block("b", [L("L1", "TAM", "vo"), L("L2", "TAM", "vo")])], { L1: "One.", L2: "Two." });
    s = run(caretAtEnd(s, "L1"), enter);
    expect(lines(s)).toEqual([["TAM", "vo"], ["TAM", "vo"], ["TAM", "vo"]]);
  });

  it("a line by a different speaker takes nothing, and naming a blank line looks back across blocks", () => {
    let s = build([block("b1", [L("L1", "TAM", "radio")]), block("b2", [L("L2", "BO")])], { L1: "Over.", L2: "Copy." });
    s = run(caretAtEnd(s, "L2"), enter); // a new BO line: BO has no qualifier anywhere
    const fresh = lineAfter(s, "L2");
    expect(lines(s)).toEqual([["TAM", "radio"], ["BO", ""], ["BO", ""]]);
    s = s.apply(acceptCueForBeat(s, fresh, "TAM")!); // the blank line becomes TAM's: TAM's last line was RADIO
    expect(lines(s)).toEqual([["TAM", "radio"], ["BO", ""], ["TAM", "radio"]]);
    s = s.apply(acceptCueForBeat(s, fresh, "BO")!); // and back to BO: none again
    expect(lines(s)).toEqual([["TAM", "radio"], ["BO", ""], ["BO", ""]]);
  });

  it("a speaker change on a line that has words leaves its qualifier alone", () => {
    let s = build([block("b", [L("L1", "TAM", "os"), L("L2", "BO", "vo")])], { L1: "Here.", L2: "There." });
    s = s.apply(acceptCueForBeat(s, "L2", "TAM")!);
    expect(lines(s)).toEqual([["TAM", "os"], ["TAM", "vo"]]);
  });

  it("is one undo step with the edit that made the line, and undo never re-inherits", () => {
    let s = build([block("b", [L("L1", "TAM", "os")])], { L1: "Hm." });
    s = run(caretAtEnd(s, "L1"), enter);
    expect(lines(s)).toEqual([["TAM", "os"], ["TAM", "os"]]);
    s = run(s, undo);
    expect(lines(s)).toEqual([["TAM", "os"]]);
  });

  it("a duplicated bubble keeps each copied line's qualifier as it was", () => {
    let s = build([block("b", [L("L1", "TAM", "os"), L("L2", "TAM")])], { L1: "One.", L2: "Two." });
    const sn = findByModelId(s.doc, "sn_b")!;
    s = s.apply(duplicateChunk(s, sn.pos)!.tr);
    expect(lines(s)).toEqual([["TAM", "os"], ["TAM", ""], ["TAM", "os"], ["TAM", ""]]);
  });
});

describe("the keyboard route cycles a line's qualifier", () => {
  it("steps through the list, then none, and an unlisted one moves on to the first", () => {
    expect(nextQualifier(["vo", "os"], undefined)).toBe("vo");
    expect(nextQualifier(["vo", "os"], "vo")).toBe("os");
    expect(nextQualifier(["vo", "os"], "os")).toBeUndefined();
    expect(nextQualifier(["vo", "os"], "phone")).toBe("vo");
  });

  it("acts on the caret's line, and declines with no list or off a line", () => {
    let s = caretAtEnd(build([block("b", [L("L1", "TAM")])], { L1: "Hi." }), "L1");
    const cycle = cycleQualifier(["vo", "os"]);
    s = run(s, cycle); expect(lines(s)).toEqual([["TAM", "vo"]]);
    s = run(s, cycle); expect(lines(s)).toEqual([["TAM", "os"]]);
    s = run(s, cycle); expect(lines(s)).toEqual([["TAM", ""]]);
    expect(cycleQualifier([])(s)).toBe(false);
  });
});
