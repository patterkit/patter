// ---------------------------------------------------------------------------
// Static structure introspection: engine.getOutline() (nested tree, groups kept)
// and engine.getBeatSequence() (flat, document-ordered), with per-beat data that
// mirrors what a delivered step carries (source text, gameData, accumulated tags).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "h", name: "H" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "GUARD", displayName: "The Guard" }],
  gameDataFields: { line: [{ name: "sfx", type: "text" }] },
};

// A scene: one block with a choice group (two option snippets) then a plain snippet, so the tree has
// a group to preserve and the flat walk crosses it.
const scene: Scene = {
  id: "s1", type: "scene", name: "Opening", gameId: "opening",
  blocks: [{
    id: "b1", type: "block", name: "Intro", tags: ["act1"], children: [
      { id: "g1", type: "group", selector: "choice", children: [
        { id: "opt1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "GUARD", gameData: { sfx: "door" } }], jump: { to: "END" } },
        { id: "opt2", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "END" } },
      ] },
      { id: "sn", type: "snippet", beats: [{ id: "E1", kind: "gameEvent" }], jump: { to: "END" } },
    ],
  }],
};
const en: LocaleFile = {
  schema: "patter/strings@0", scene: "s1", locale: "en",
  strings: { L1: "Halt!", T1: "The gate creaks.", "cast:GUARD": "The Guard" },
};
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("engine.getOutline", () => {
  it("returns the nested tree with groups preserved and beat data on snippets", () => {
    const outline = new Engine(bundle).getOutline();
    expect(outline.map((s) => s.id)).toEqual(["s1"]);
    const s = outline[0]!;
    expect(s.name).toBe("Opening");
    expect(s.gameId).toBe("opening");

    const block = s.blocks[0]!;
    expect(block.id).toBe("b1");
    expect(block.tags).toEqual(["act1"]);

    const group = block.children[0]!;
    const snippet = block.children[1]!;
    expect(group.type).toBe("group");
    expect(group.selector).toBe("choice");
    expect(group.children!.map((c) => c.id)).toEqual(["opt1", "opt2"]); // groups kept, not flattened

    // The option's line beat carries source text, resolved speaker name, gameData, inherited tag.
    const line = group.children![0]!.beats![0]!;
    expect(line).toMatchObject({ id: "L1", kind: "line", character: "GUARD", characterName: "The Guard", text: "Halt!" });
    expect(line.gameData).toEqual({ sfx: "door" });
    expect(line.tags).toEqual(["act1"]);

    expect(snippet.type).toBe("snippet");
    expect(snippet.jumpTo).toBe("END");
    expect(snippet.beats![0]!).toMatchObject({ id: "E1", kind: "gameEvent" });
    expect(snippet.beats![0]!.text).toBeUndefined(); // gameEvent has no text
  });
});

describe("engine.getBeatSequence", () => {
  it("flattens every beat in document order with its scene/block/snippet", () => {
    const seq = new Engine(bundle).getBeatSequence();
    expect(seq.map((f) => f.beat.id)).toEqual(["L1", "T1", "E1"]);
    expect(seq[0]).toMatchObject({ sceneId: "s1", blockId: "b1", snippetId: "opt1" });
    expect(seq[1]).toMatchObject({ snippetId: "opt2", beat: { id: "T1", kind: "text", text: "The gate creaks." } });
    expect(seq[2]).toMatchObject({ snippetId: "sn", beat: { id: "E1", kind: "gameEvent" } });
  });
});
