// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): a beat's `padAfter` and a container's
// `padAfterDefault` ride through the bridge untouched; the inspector context says what each level sets
// and inherits; and the edits that rebuild beats or bubbles keep each pause with the words it follows.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import { history } from "prosemirror-history";
import { canonicalStringify } from "@patterkit/core";
import type { Scene, Beat } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { inspect, type LeafLevel, type SnippetLevel, type GroupLevel, type BlockLevel, type SceneLevel } from "../src/inspect.js";
import { enter, endBubble } from "../src/lines.js";
import { backspace, forwardDelete } from "../src/delete.js";
import { joinSnippet } from "../src/groups.js";
import { structureGuard } from "../src/guard.js";
import { pasteParagraphs, textParagraphs } from "../src/paste.js";
import { setPadAt } from "../src/pad.js";
import { findByModelId } from "../src/zoneutil.js";

const scene = (): Scene => ({
  id: "s", type: "scene", name: "S", padAfterDefault: 2, blocks: [{
    id: "b", type: "block", name: "B", padAfterDefault: 1.5, children: [
      { id: "a", type: "snippet", padAfterDefault: 0.3, beats: [
        { id: "T1", kind: "text", padAfter: -0.4 },
        { id: "T2", kind: "text" },
        { id: "L1", kind: "line", character: "ANNA", padAfter: -0.5 },
      ] },
      { id: "g", type: "group", selector: "sequence", padAfterDefault: 0.9, children: [
        { id: "c", type: "snippet", beats: [{ id: "T3", kind: "text" }] },
      ] },
      { id: "ch", type: "group", selector: "choice", children: [
        { id: "o", type: "group", padAfterDefault: 0.2, prompt: { id: "P1", kind: "line", character: "ANNA", padAfter: -0.3 },
          children: [{ id: "d", type: "snippet", beats: [{ id: "T4", kind: "text" }] }] },
      ] },
      { id: "e", type: "snippet", padAfterDefault: 0.7, beats: [{ id: "T5", kind: "text" }] },
    ],
  }],
});
const STRINGS = { T1: "One two", T2: "Three", L1: "Four", T3: "Five", P1: "Six", T4: "Seven", T5: "Eight" };

function state(sc: Scene = scene(), guard = false): { s: EditorState; said: string[] } {
  const said: string[] = [];
  const plugins = guard ? [structureGuard((m) => said.push(m)), history()] : [];
  return { s: EditorState.create({ doc: sceneToDoc(sc, STRINGS), plugins }), said };
}
const sayPos = (s: EditorState, id: string, offset = 0): number => {
  const at = findByModelId(s.doc, id)!;
  let p = -1;
  at.node.forEach((z, o) => { if (z.type.name === "say") p = at.pos + 1 + o + 1 + offset; });
  return p;
};
const sayEnd = (s: EditorState, id: string): number => {
  const at = findByModelId(s.doc, id)!;
  let p = -1;
  at.node.forEach((z, o) => { if (z.type.name === "say") p = at.pos + 1 + o + 1 + z.content.size; });
  return p;
};
const caret = (s: EditorState, pos: number): EditorState => s.apply(s.tr.setSelection(TextSelection.create(s.doc, pos)));
const run = (s: EditorState, cmd: Command): EditorState => { let n = s; cmd(s, (tr) => { n = n.apply(tr); }); return n; };
const model = (s: EditorState) => docToScene(s.doc).scene;
/** Every beat in a block, in order, with its own pause. */
function pads(s: EditorState): Array<[string, number | undefined]> {
  const out: Array<[string, number | undefined]> = [];
  for (const c of model(s).blocks[0]!.children) if (c.type === "snippet") for (const b of c.beats ?? []) out.push([b.id, (b as Beat & { padAfter?: number }).padAfter]);
  return out;
}
const snippets = (s: EditorState) => model(s).blocks[0]!.children.filter((c) => c.type === "snippet");

describe("the bridge carries line padding", () => {
  it("round-trips padAfter on beats and prompts, and padAfterDefault at every level", () => {
    const { s } = state();
    expect(canonicalStringify(docToScene(s.doc).scene)).toBe(canonicalStringify(scene()));
  });
});

describe("the inspector context: own and inherited pauses", () => {
  const levels = (id: string) => { const { s } = state(); return inspect(caret(s, sayPos(s, id))).levels; };

  it("a beat with none inherits its snippet's default; each container inherits the one above", () => {
    const [leaf, snip, block, sc] = levels("T2") as [LeafLevel, SnippetLevel, BlockLevel, SceneLevel];
    expect(leaf.padAfter).toBeUndefined();
    expect(leaf.padInherited).toEqual({ value: 0.3, from: "snippet" });
    expect(leaf.endsSnippet).toBeUndefined();
    expect(snip.padAfterDefault).toBe(0.3);
    expect(snip.padInherited).toEqual({ value: 1.5, from: "block" });
    expect(block.padInherited).toEqual({ value: 2, from: "scene" });
    expect(sc.padAfterDefault).toBe(2);
  });

  it("marks a snippet's last line, and names a group by its role", () => {
    const [last] = levels("L1") as [LeafLevel];
    expect(last).toMatchObject({ padAfter: -0.5, endsSnippet: true });
    const [leaf, , group] = levels("T3") as [LeafLevel, SnippetLevel, GroupLevel];
    expect(leaf.padInherited).toEqual({ value: 0.9, from: "sequence" });
    expect(group.padAfterDefault).toBe(0.9);
  });

  it("marks a line followed by a game event: a cut-in can't cross the event", () => {
    const sc: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "a", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", padAfter: -0.4 },
        { id: "E1", kind: "gameEvent", gameData: { cue: "bell" } },
        { id: "L2", kind: "line", character: "ANNA" },
      ] },
    ] }] };
    const { s } = state(sc);
    const before = inspect(caret(s, sayPos(s, "L1"))).levels[0] as LeafLevel;
    expect(before).toMatchObject({ padAfter: -0.4, beforeEvent: true });
    expect(before.endsSnippet).toBeUndefined();
    const last = inspect(caret(s, sayPos(s, "L2"))).levels[0] as LeafLevel;
    expect(last).toMatchObject({ endsSnippet: true });
    expect(last.beforeEvent).toBeUndefined();
  });

  it("an option's prompt resolves through its option and is never a snippet's last line", () => {
    const [leaf] = levels("P1") as [LeafLevel];
    expect(leaf).toMatchObject({ prompt: true, padAfter: -0.3, padInherited: { value: 0.2, from: "option" } });
    expect(leaf.endsSnippet).toBeUndefined();
  });

  it("with nothing set above, nothing is inherited (the host adds the project's)", () => {
    const sc = scene(); delete sc.padAfterDefault; delete sc.blocks[0]!.padAfterDefault;
    const { s } = state(sc);
    const [, snip, block] = inspect(caret(s, sayPos(s, "T2"))).levels as [LeafLevel, SnippetLevel, BlockLevel];
    expect(snip.padInherited).toBeUndefined();
    expect(block.padInherited).toBeUndefined();
  });
});

describe("edits keep a pause with the words it follows", () => {
  it("setPadAt sets and clears a beat's own pause", () => {
    const { s } = state();
    const at = findByModelId(s.doc, "T2")!.pos;
    const set = s.apply(setPadAt(s, at, 1.25)!);
    expect(pads(set)).toContainEqual(["T2", 1.25]);
    const cleared = set.apply(setPadAt(set, at, undefined)!);
    expect(pads(cleared)).toContainEqual(["T2", undefined]);
    expect(setPadAt(cleared, at, undefined)).toBeNull(); // no change, no transaction
  });

  it("Enter mid-line moves the pause to the tail, which now ends the words", () => {
    const { s } = state();
    const out = run(caret(s, sayPos(s, "T1", 3)), enter);
    const [first, tail] = pads(out);
    expect(first).toEqual(["T1", undefined]);
    expect(tail![1]).toBe(-0.4);
  });

  it("a multi-paragraph paste mid-line moves it to the last new beat", () => {
    const { s } = state();
    const at = caret(s, sayPos(s, "T1", 3));
    const out = at.apply(pasteParagraphs(at, textParagraphs("x\ny"), false)!);
    const list = pads(out);
    expect(list[0]).toEqual(["T1", undefined]);
    expect(list[1]![1]).toBe(-0.4); // the new "y two" ends where "One two" did
  });

  it("Delete at a line's end merges the next one in, taking its pause", () => {
    const { s } = state();
    const out = run(caret(s, sayEnd(s, "T2")), forwardDelete);
    expect(pads(out).slice(0, 2)).toEqual([["T1", -0.4], ["T2", -0.5]]); // L1 folded into T2
    expect(docToScene(out.doc).strings.T2).toBe("ThreeFour");
  });

  it("Backspace at a text line's start merges it up, the merged line taking its (absent) pause", () => {
    const { s } = state();
    const out = run(caret(s, sayPos(s, "T2")), backspace);
    expect(pads(out).slice(0, 2)).toEqual([["T1", undefined], ["L1", -0.5]]);
  });

  it("splitting a bubble gives the tail the same default, so its lines keep their timing", () => {
    const { s } = state();
    const out = run(caret(s, sayEnd(s, "T1")), endBubble);
    const [a, tail] = snippets(out);
    expect(a!.padAfterDefault).toBe(0.3);
    expect(tail!.padAfterDefault).toBe(0.3);
    expect(tail!.id).not.toBe("a");
  });
});

describe("a bubble's own default pause is not merged away", () => {
  const two = (bDefault: number | undefined): Scene => {
    const sc = scene();
    sc.blocks[0]!.children = [
      { id: "a", type: "snippet", padAfterDefault: 0.3, beats: [{ id: "T1", kind: "text" }] },
      { id: "x", type: "snippet", ...(bDefault !== undefined ? { padAfterDefault: bDefault } : {}), beats: [{ id: "T2", kind: "text" }] },
    ];
    return sc;
  };
  const posOf = (s: EditorState, id: string): number => findByModelId(s.doc, id)!.pos;

  it("Join refuses when the bubble that goes sets a different default, and joins when they match", () => {
    let { s } = state(two(0.8));
    const refused = joinSnippet(s, posOf(s, "x"), "up")!;
    expect(refused.docChanged).toBe(false);
    ({ s } = state(two(0.3)));
    const joined = s.apply(joinSnippet(s, posOf(s, "x"), "up")!);
    expect(snippets(joined)).toHaveLength(1);
    ({ s } = state(two(undefined)));
    expect(snippets(s.apply(joinSnippet(s, posOf(s, "x"), "up")!))).toHaveLength(1); // nothing of its own to lose
  });

  it("Backspace at the bubble's start is refused by the guard, with a reason", () => {
    const { s, said } = state(two(0.8), true);
    const out = run(caret(s, sayPos(s, "T2")), backspace);
    expect(snippets(out)).toHaveLength(2);
    expect(said).toEqual(["This bubble has its own default pause. Clear it, or give both bubbles the same one, first."]);
    const same = state(two(0.3), true);
    expect(snippets(run(caret(same.s, sayPos(same.s, "T2")), backspace))).toHaveLength(1);
  });
});
