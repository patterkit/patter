// ---------------------------------------------------------------------------
// Duplicating a chunk (block / group / snippet) with its children. The load-bearing
// invariant: the copy shares NO id with the original (an id is identity - locale keys,
// jump targets, audio filenames and the edit trail all key on it), while the text
// itself rides across. A duplicated BLOCK is also renamed and loses any pinned
// address, because a block's address falls back to a slug of its name.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene, Block, Group, Snippet, Beat } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { duplicateChunk, copyName } from "../src/duplicate.js";

/** Every id anywhere under a block (blocks, groups, snippets, beats, prompts). */
function idsUnder(node: Block | Group | Snippet): string[] {
  const out: string[] = [node.id];
  const kids = "children" in node ? node.children : [];
  if ("prompt" in node && node.prompt) out.push(node.prompt.id);
  if ("beats" in node) for (const b of (node.beats ?? []) as Beat[]) out.push(b.id);
  for (const k of kids) out.push(...idsUnder(k as Group | Snippet));
  return out;
}

/** A scene: one block, a plain snippet, and a choice group with an option (prompt + body). */
function scene(): Scene {
  return {
    id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "Main", gameId: "main", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "opt1", type: "group", prompt: { id: "P1", kind: "text" }, children: [
            { id: "sn2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "BO" }, { id: "T1", kind: "text" }] },
          ] },
        ] },
      ] },
    ],
  };
}

const STRINGS = { L1: "Hello", P1: "Pick me", L2: "Yes", T1: "Narration" };

/** State + the doc position of the first node of `kind`. */
function stateAt(kind: string): { state: EditorState; pos: number } {
  const doc = sceneToDoc(scene(), STRINGS);
  let pos = -1;
  doc.descendants((n, p) => { if (pos < 0 && n.type.name === kind) { pos = p; return false; } return true; });
  if (pos < 0) throw new Error(`no ${kind} in the doc`);
  return { state: EditorState.create({ doc }), pos };
}

function duplicate(kind: string): { scene: Scene; strings: Record<string, string>; idMap: Record<string, string> } {
  const { state, pos } = stateAt(kind);
  const res = duplicateChunk(state, pos);
  if (!res) throw new Error("duplicateChunk returned null");
  const { scene: out, strings } = docToScene(state.apply(res.tr).doc);
  return { scene: out, strings, idMap: res.idMap };
}

describe("duplicateChunk", () => {
  it("copies a snippet in as the next sibling, with fresh ids and the same text", () => {
    const { scene: out, strings } = duplicate("snippet");
    const block = out.blocks[0]!;
    const [first, second] = [block.children[0] as Snippet, block.children[1] as Snippet];
    expect(second.type).toBe("snippet");
    expect(second.id).not.toBe(first.id);                       // fresh chunk id
    const [a, b] = [first.beats![0]!, second.beats![0]!];
    expect(b.id).not.toBe(a.id);                                // fresh beat id
    expect(b.id.startsWith("L_")).toBe(true);                   // ...keeping the type prefix
    expect(strings[b.id]).toBe("Hello");                        // the text came across
    expect(strings[a.id]).toBe("Hello");                        // ...and the original still has its own
    expect((b as { character?: string }).character).toBe("ANNA");
  });

  it("duplicates a group's whole subtree - no id anywhere is shared with the original", () => {
    const { scene: out, idMap } = duplicate("group");
    const block = out.blocks[0]!;
    const original = block.children.find((c) => c.id === "g1") as Group;
    const copy = block.children[block.children.indexOf(original) + 1] as Group;
    const before = idsUnder(original);
    const after = idsUnder(copy);
    expect(after).toHaveLength(before.length);                  // same shape
    expect(before.some((id) => after.includes(id))).toBe(false); // ...zero id overlap
    // The nested option prompt + both beats are all remapped.
    for (const id of ["g1", "opt1", "P1", "sn2", "L2", "T1"]) expect(idMap[id]).toBeTruthy();
    expect(copy.selector).toBe("choice");                        // non-id fields ride across
    const opt = copy.children[0] as Group;
    expect(opt.prompt!.id).toBe(idMap["P1"]);
  });

  it("renames a duplicated block and drops its pinned address (a copy must not collide)", () => {
    const { scene: out } = duplicate("block");
    expect(out.blocks).toHaveLength(2);
    const copy = out.blocks[1]!;
    expect(copy.name).toBe("Main copy");
    expect(copy.gameId).toBeUndefined();     // pinned address dropped; it now derives from "Main copy"
    expect(copy.id).not.toBe(out.blocks[0]!.id);
    expect(idsUnder(copy).some((id) => idsUnder(out.blocks[0]!).includes(id))).toBe(false);
  });

  it("refuses a position that is not a duplicable chunk", () => {
    const { state } = stateAt("say");
    let sayPos = -1;
    state.doc.descendants((n, p) => { if (sayPos < 0 && n.type.name === "say") { sayPos = p; return false; } return true; });
    expect(duplicateChunk(state, sayPos)).toBeNull();
  });

  it("copyName steps past names already taken", () => {
    expect(copyName("Main", new Set())).toBe("Main copy");
    expect(copyName("Main", new Set(["Main copy"]))).toBe("Main copy 2");
    expect(copyName("Main", new Set(["Main copy", "Main copy 2"]))).toBe("Main copy 3");
  });
});
