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
import { backspace, forwardDelete, deleteSelectionGuarded } from "../src/delete.js";
import { joinSnippet, unwrapGroup } from "../src/groups.js";
import { structureGuard } from "../src/guard.js";
import { pasteParagraphs, textParagraphs } from "../src/paste.js";
import { setPadAt, projectPad, keepTimingOnJoin } from "../src/pad.js";
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
const STRINGS = { T1: "One two", T2: "Three", L1: "Four", T3: "Five", P1: "Six", T4: "Seven", T5: "Eight", L8: "More", T6: "Nine" };

/** A state for `sc`; with `guard`, the plugins the surface runs on every edit: the structure guard (its
 *  refusals collected in `said`), history, the project's default pause, and keepTimingOnJoin. */
function state(sc: Scene = scene(), guard = false, project?: number): { s: EditorState; said: string[] } {
  const said: string[] = [];
  const plugins = guard ? [structureGuard((m) => said.push(m)), history(), projectPad(() => project), keepTimingOnJoin()] : [projectPad(() => project)];
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

describe("merging an empty line up keeps the pause of the line it joins", () => {
  // Review 2026-10: a merge gave the line above the merged line's pause even when that line had no words,
  // so Enter at a line's end and then Backspace wiped the line's own pause.
  const newBeat = (s: EditorState, after: string): string => { const list = pads(s); return list[list.findIndex(([id]) => id === after) + 1]![0]; };

  it("Backspace at a blank text line's start", () => {
    const { s } = state();
    const split = run(caret(s, sayEnd(s, "T1")), enter);
    const out = run(caret(split, sayPos(split, newBeat(split, "T1"))), backspace);
    expect(pads(out).slice(0, 2)).toEqual([["T1", -0.4], ["T2", undefined]]);
  });

  it("Delete at a line's end with a blank line after it", () => {
    const { s } = state();
    const split = run(caret(s, sayEnd(s, "T1")), enter);
    const out = run(caret(split, sayEnd(split, "T1")), forwardDelete);
    expect(pads(out).slice(0, 2)).toEqual([["T1", -0.4], ["T2", undefined]]);
  });

  it("Backspace on a new dialogue line's name (Enter lands with it selected)", () => {
    const { s } = state();
    const split = run(caret(s, sayEnd(s, "L1")), enter);
    expect(pads(split).slice(0, 4).map(([id]) => id)).toEqual(["T1", "T2", "L1", newBeat(split, "L1")]);
    const out = run(split, backspace);
    expect(pads(out).slice(0, 4)).toEqual([["T1", -0.4], ["T2", undefined], ["L1", -0.5], ["T5", undefined]]);
  });

  const bubbles = (second: Beat): Scene => {
    const sc = scene();
    sc.blocks[0]!.children = [
      { id: "a", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA", padAfter: 2 }] },
      { id: "x", type: "snippet", beats: [second] },
    ];
    return sc;
  };

  it("Backspace at a blank first line folds into the previous bubble", () => {
    const { s } = state(bubbles({ id: "T9", kind: "text" }), true);
    const out = run(caret(s, sayPos(s, "T9")), backspace);
    expect(snippets(out)).toHaveLength(1);
    expect(pads(out)).toEqual([["L1", 2]]);
  });

  it("a blank line alone in its bubble, its name removed, folds into the previous bubble", () => {
    const { s } = state(bubbles({ id: "L9", kind: "line", character: "ANNA" }), true);
    const out = run(run(caret(s, sayPos(s, "L9")), backspace), backspace);
    expect(snippets(out)).toHaveLength(1);
    expect(pads(out)).toEqual([["L1", 2]]);
  });

  it("a merged line with words still brings its pause", () => {
    const { s } = state(bubbles({ id: "L8", kind: "line", character: "ANNA", padAfter: 0.5 }), true);
    const out = run(run(caret(s, sayPos(s, "L8")), backspace), backspace);
    expect(pads(out)).toEqual([["L1", 0.5]]);
  });
});

describe("lines that come under a different default keep their timing when any of them is timed", () => {
  // The rule (pad.ts): if none of the moved lines sets its own pause, they take the new default; if any
  // does, the own pauses stay and each line that set none is pinned to the pause it had.
  type B = Beat & { padAfter?: number };
  const text = (id: string, padAfter?: number): B => ({ id, kind: "text", ...(padAfter !== undefined ? { padAfter } : {}) });
  /** Bubble `a` (default 0.3) holding T1, then bubble `x` with `xDefault` holding `beats`; nothing above sets
   *  a default unless `withBlock`. */
  const two = (xDefault: number | undefined, beats: Beat[], withBlock = true): Scene => ({
    id: "s", type: "scene", name: "S", blocks: [{
      id: "b", type: "block", name: "B", ...(withBlock ? { padAfterDefault: 1.5 } : {}), children: [
        { id: "a", type: "snippet", padAfterDefault: 0.3, beats: [text("T1")] },
        { id: "x", type: "snippet", ...(xDefault !== undefined ? { padAfterDefault: xDefault } : {}), beats },
      ],
    }],
  });
  const posOf = (s: EditorState, id: string): number => findByModelId(s.doc, id)!.pos;
  const join = (s: EditorState): EditorState => s.apply(joinSnippet(s, posOf(s, "x"), "up")!);

  it("Join: when every moved line inherits, they take the new default and nothing is refused", () => {
    const { s } = state(two(0.8, [text("T2"), text("T3")]));
    const out = join(s);
    expect(snippets(out)).toHaveLength(1);
    expect(pads(out)).toEqual([["T1", undefined], ["T2", undefined], ["T3", undefined]]);
  });

  it("Join: one timed line pins every other moved line to the pause it had", () => {
    const { s } = state(two(0.8, [text("T2"), text("T3", -0.2), text("T4")]));
    const out = join(s);
    expect(snippets(out)).toHaveLength(1);
    // T4 ended bubble x, so it played 0.8 there too (a positive pause is never clamped).
    expect(pads(out)).toEqual([["T1", undefined], ["T2", 0.8], ["T3", -0.2], ["T4", 0.8]]);
  });

  it("pins a moved line to what it played: clamped at its bubble's end, but not before a game event", () => {
    const beats: Beat[] = [text("T2"), { id: "E1", kind: "gameEvent", gameData: { cue: "bell" } }, text("T3", 1), text("T4")];
    const out = join(state(two(-0.2, beats)).s);
    // T2 is followed by a game event and played -0.2; T4 ended bubble x, so its -0.2 played as none.
    expect(pads(out)).toEqual([["T1", undefined], ["T2", -0.2], ["E1", undefined], ["T3", 1], ["T4", 0]]);
  });

  it("a line pinned through the project's default takes the project's value", () => {
    const out = join(state(two(undefined, [text("T2"), text("T3", 1)], false), false, 0.25).s);
    expect(pads(out)).toEqual([["T1", undefined], ["T2", 0.25], ["T3", 1]]);
  });

  it("Backspace at a bubble's start merges it, with no refusal, and the rule holds", () => {
    let { s, said } = state(two(0.8, [text("T2"), text("T3")]), true);
    let out = run(caret(s, sayPos(s, "T2")), backspace);
    expect(said).toEqual([]);
    expect(pads(out)).toEqual([["T1", undefined], ["T3", undefined]]);

    ({ s, said } = state(two(0.8, [text("T2"), text("T3", -0.2), text("T4")]), true));
    out = run(caret(s, sayPos(s, "T2")), backspace);
    expect(said).toEqual([]);
    // T1 now ends with T2's words, so it stands in for T2 and keeps the pause T2 played.
    expect(pads(out)).toEqual([["T1", 0.8], ["T3", -0.2], ["T4", 0.8]]);
  });

  it("a range delete from one bubble into the next: the rest of the second keeps its timing", () => {
    const { s, said } = state(two(0.8, [text("T2"), text("T3"), text("T4", 0.4)]), true);
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, sayPos(s, "T1", 3), sayPos(s, "T2", 2))));
    const out = run(sel, deleteSelectionGuarded);
    expect(said).toEqual([]);
    expect(snippets(out)).toHaveLength(1);
    expect(pads(out)).toEqual([["T1", undefined], ["T3", 0.8], ["T4", 0.4]]);
  });

  it("a range delete that removes a bubble outright, default and all, is not refused", () => {
    // Review 2026-10: the guard read a bubble the selection deleted whole as one whose lines moved into
    // another, and refused the delete over its default pause.
    const sc = two(1, [text("T2"), { id: "L1", kind: "line", character: "ANNA" }]);
    sc.blocks[0]!.children.push({ id: "e", type: "snippet", beats: [text("T5")] });
    const { s, said } = state(sc, true);
    const sel = s.apply(s.tr.setSelection(TextSelection.create(s.doc, sayPos(s, "T1", 3), sayPos(s, "T5", 2))));
    const out = run(sel, deleteSelectionGuarded);
    expect(said).toEqual([]);
    expect(snippets(out).map((c) => c.id)).toEqual(["a"]);
    expect(docToScene(out.doc).strings.T1).toBe("Oneght");
  });

  /** A block holding a sequence group (default 0.9) of bubble `c` with `beats`, and bubble `d` (default 0.1)
   *  with T6, which its own default shields from the group's. */
  const grouped = (beats: Beat[]): Scene => ({
    id: "s", type: "scene", name: "S", blocks: [{
      id: "b", type: "block", name: "B", padAfterDefault: 1.5, children: [
        { id: "g", type: "group", selector: "sequence", padAfterDefault: 0.9, children: [
          { id: "c", type: "snippet", beats },
          { id: "d", type: "snippet", padAfterDefault: 0.1, beats: [text("T6")] },
        ] },
      ],
    }],
  });
  const ungroup = (s: EditorState): EditorState => s.apply(unwrapGroup(s, posOf(s, "g"))!);
  const allPads = (s: EditorState): Array<[string, number | undefined]> => {
    const out: Array<[string, number | undefined]> = [];
    for (const c of model(s).blocks[0]!.children) if (c.type === "snippet") for (const b of c.beats ?? []) out.push([b.id, (b as B).padAfter]);
    return out;
  };

  it("Ungroup: with every line inheriting, they take the default above the group", () => {
    const out = ungroup(state(grouped([text("T2"), text("T3")])).s);
    expect(allPads(out)).toEqual([["T2", undefined], ["T3", undefined], ["T6", undefined]]);
  });

  it("Ungroup: one timed line pins the lines whose pause came from the group's default", () => {
    const out = ungroup(state(grouped([text("T2"), text("T3", 0.2), text("T4")])).s);
    // T6 took its bubble's 0.1 before and after, so it is left alone.
    expect(allPads(out)).toEqual([["T2", 0.9], ["T3", 0.2], ["T4", 0.9], ["T6", undefined]]);
  });
});
