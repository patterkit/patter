// ---------------------------------------------------------------------------
// Phase C: the block outline (groups §1/§3). Blocks are the scene's H1 sections -
// addressable, named, flat. setBlockName renames; insertBlock adds one after;
// moveChunk reorders them (the same command as bubbles/groups).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { context } from "../src/context.js";
import { setBlockName, insertBlock, moveChunk } from "../src/groups.js";

const line = (id: string) => ({ id, type: "snippet" as const, beats: [{ id: `${id}_L`, kind: "line" as const }] });
const block = (id: string, name: string) => ({ id, type: "block" as const, name, children: [line(`${id}s`)] });

function stateOf(blocks: Scene["blocks"]): EditorState {
  return EditorState.create({ doc: sceneToDoc({ id: "s", type: "scene", name: "S", blocks }, {}) });
}
function blockPos(s: EditorState, n: number): number {
  const out: number[] = [];
  s.doc.forEach((_b, off) => out.push(off));
  return out[n]!;
}
const blocks = (s: EditorState) => docToScene(s.doc).scene.blocks;

describe("block outline commands", () => {
  it("setBlockName renames the H1 section", () => {
    const s = stateOf([block("b1", "Intro")]);
    const out = s.apply(setBlockName(s, blockPos(s, 0), "The Tavern")!);
    expect(blocks(out)[0]!.name).toBe("The Tavern");
  });

  it("insertBlock adds a named block after, caret in its seeded bubble", () => {
    const s = stateOf([block("b1", "Intro")]);
    const out = s.apply(insertBlock(s, blockPos(s, 0))!);
    const bs = blocks(out);
    expect(bs).toHaveLength(2);
    expect(bs[1]!.name).toBe("New section");
    expect(bs[1]!.children[0]!.type).toBe("snippet"); // seeded with an editable bubble
    expect(context(out).zone?.role).toBe("cue");      // a new snippet starts a new line: caret on the character selector
  });

  it("moveChunk reorders blocks (the same command, no-op at the edges)", () => {
    const s = stateOf([block("a", "A"), block("b", "B"), block("c", "C")]);
    expect(blocks(s.apply(moveChunk(s, blockPos(s, 0), "down")!)).map((b) => b.id)).toEqual(["b", "a", "c"]);
    expect(blocks(s.apply(moveChunk(s, blockPos(s, 2), "up")!)).map((b) => b.id)).toEqual(["a", "c", "b"]);
    expect(moveChunk(s, blockPos(s, 0), "up")).toBeNull();    // first
    expect(moveChunk(s, blockPos(s, 2), "down")).toBeNull();  // last
  });

  it("a renamed + inserted block round-trips losslessly", () => {
    const s = stateOf([block("b1", "Intro")]);
    const out = s.apply(insertBlock(s, blockPos(s, 0))!);
    const sc = docToScene(out.doc);
    expect(docToScene(sceneToDoc(sc.scene, sc.strings)).scene).toEqual(sc.scene);
  });
});
