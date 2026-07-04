// ---------------------------------------------------------------------------
// Editing a snippet's onEnter / onExit effects from the inspector's effects
// editor. The lists ride in the snippet's `raw` overlay; setSnippetEffects
// rewrites it, and the bridge round-trips them to the model Effect[].
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import type { Scene, Snippet } from "@patterkit/model";
import { sceneToDoc, docToScene } from "../src/bridge.js";
import { setSnippetEffects, type SnippetEffect } from "../src/groups.js";

function stateWithSnippet(s: Snippet): EditorState {
  const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [s] }] };
  return EditorState.create({ doc: sceneToDoc(scene, {}) });
}
const snip = (): Snippet => ({ id: "sn", type: "snippet", beats: [{ id: "L", kind: "line" }] });
const snippetPos = (s: EditorState): number => { let p = -1; s.doc.descendants((n, pos) => { if (p < 0 && n.type.name === "snippet") p = pos; }); return p; };
const apply = (s: EditorState, phase: "onEnter" | "onExit", e: SnippetEffect[]): Snippet => {
  const out = s.apply(setSnippetEffects(s, snippetPos(s), phase, e)!);
  return docToScene(out.doc).scene.blocks[0]!.children[0] as Snippet;
};

describe("setSnippetEffects", () => {
  it("writes a set effect into onEnter and round-trips it", () => {
    const s = stateWithSnippet(snip());
    const out = apply(s, "onEnter", [{ kind: "set", target: "@gold", value: "@gold - 5" }]);
    expect(out.onEnter).toEqual([{ kind: "set", target: "@gold", value: "@gold - 5" }]);
    expect(out.onExit).toBeUndefined();
  });

  it("writes multiple set effects into onExit and round-trips them", () => {
    const s = stateWithSnippet(snip());
    const out = apply(s, "onExit", [
      { kind: "set", target: "@gold", value: "@gold + 10" },
      { kind: "set", target: "@met", value: "true" },
    ]);
    expect(out.onExit).toEqual([
      { kind: "set", target: "@gold", value: "@gold + 10" },
      { kind: "set", target: "@met", value: "true" },
    ]);
  });

  it("an empty list clears the phase", () => {
    const seeded = snip();
    seeded.onEnter = [{ kind: "set", target: "@a", value: "1" }];
    const s = stateWithSnippet(seeded);
    expect(apply(s, "onEnter", []).onEnter).toBeUndefined();
  });

  it("returns null for a non-snippet position", () => {
    const s = stateWithSnippet(snip());
    expect(setSnippetEffects(s, 0, "onEnter", [])).toBeNull(); // pos 0 is the block, not a snippet
  });
});
