// ---------------------------------------------------------------------------
// A quality's stage rename, carried into the scenes' expressions, and the gates a reorder changes. The
// rewrite inside one expression, and the gate count in one, are the kernel's and tested there.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { renameGameDataStage, renameStage, stageDialect, stageGateCount } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "debt", type: "quality", stages: ["troubled", "confronted", "resolved"], default: "troubled" },
    { name: "mood", type: "quality", stages: ["troubled", "calm"], default: "calm" },
  ],
  scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "act", type: "quality", stages: ["opening", "rising", "end"] }] }] },
};
const dialect = stageDialect(project);
const isDebt = (scope: string, name: string): boolean => scope === "patter" && name === "debt";

const scene = (id: string, condition: string, set: string, sceneProps?: Scene["sceneProps"]): Scene => ({
  id, type: "scene", name: id,
  ...(sceneProps ? { sceneProps } : {}),
  onEntry: [{ kind: "set", target: "@debt", value: set }],
  blocks: [{ id: `${id}_b`, type: "block", name: "B", children: [
    { id: `${id}_g`, type: "group", condition, children: [
      { id: `${id}_s`, type: "snippet", beats: [{ id: `${id}_T`, kind: "text" }],
        onExit: [{ kind: "set", target: "@mood", value: '"troubled"' }], jump: { to: "END" } },
    ] },
  ] }],
});

describe("renameStage", () => {
  it("carries a @patter quality's rename into every scene's conditions and set effects", () => {
    const scenes = [scene("a", '@debt >= "confronted"', '"confronted"'), scene("b", '@debt == "resolved"', '"troubled"')];
    const r = renameStage(scenes, { scope: "patter", name: "debt" }, "confronted", "faced", dialect);
    expect(r.expressions).toBe(2);
    expect(r.scenes.map((s) => s.id)).toEqual(["a"]);
    const a = scenes[0]!;
    expect(a.onEntry![0]!.value).toBe('"faced"');
    expect((a.blocks[0]!.children[0] as { condition?: string }).condition).toBe('@debt >= "faced"');
    // @mood's own "troubled" stays: the set effect is about @mood, not @debt.
    expect(renameStage(scenes, { scope: "patter", name: "debt" }, "troubled", "uneasy", dialect).expressions).toBe(1);
    const sn = (scenes[0]!.blocks[0]!.children[0] as { children: Array<{ onExit?: Array<{ value: string }> }> }).children[0]!;
    expect(sn.onExit![0]!.value).toBe('"troubled"');
  });

  it("reaches only its own scene for a @scene quality", () => {
    const props: Scene["sceneProps"] = [{ name: "step", type: "quality", stages: ["one", "two"] }];
    const scenes = [scene("a", '@scene.step == "one"', '"x"', props), scene("b", '@scene.step == "one"', '"x"', props)];
    const r = renameStage(scenes, { scope: "scene", name: "step", scene: "b" }, "one", "first", dialect);
    expect(r.scenes.map((s) => s.id)).toEqual(["b"]);
    expect((scenes[0]!.blocks[0]!.children[0] as { condition?: string }).condition).toBe('@scene.step == "one"');
  });

  it("carries a host scope's quality, such as @world", () => {
    const scenes = [scene("a", '@world.act > "opening"', '"x"')];
    expect(renameStage(scenes, { scope: "world", name: "act" }, "opening", "start", dialect).expressions).toBe(1);
    expect((scenes[0]!.blocks[0]!.children[0] as { condition?: string }).condition).toBe('@world.act > "start"');
  });
});

describe("stageGateCount", () => {
  it("counts the gates that order the quality, which a reorder changes", () => {
    const scenes = [scene("a", '@debt >= "confronted"', '"x"'), scene("b", '@debt == "resolved"', '"x"'),
      scene("c", 'not (@debt < "resolved")', '"x"'), scene("d", '@debt > "troubled" and @debt < "resolved"', '"x"')];
    expect(stageGateCount(scenes, { scope: "patter", name: "debt" }, dialect)).toBe(4);
    expect(stageGateCount(scenes, { scope: "patter", name: "mood" }, dialect)).toBe(0);
  });
});

describe("renameGameDataStage", () => {
  const withData = (): Scene[] => [{
    id: "a", type: "scene", name: "a", gameData: { act: "troubled" },
    blocks: [{ id: "a_b", type: "block", name: "B", gameData: { act: "troubled" }, children: [
      { id: "a_s", type: "snippet", gameData: { act: "troubled" }, beats: [
        { id: "a_L", kind: "line", character: "A", gameData: { act: "troubled" } },
        { id: "a_T", kind: "text", gameData: { act: "calm" } },
      ] },
    ] }],
  }, { id: "b", type: "scene", name: "b", blocks: [] }];

  it("renames the stage in every node of the field's type, and nowhere else", () => {
    const scenes = withData();
    const result = renameGameDataStage(scenes, "line", "act", "troubled", "uneasy");
    expect(result.values).toBe(1);
    expect(result.scenes.map((s) => s.id)).toEqual(["a"]);
    const snippet = scenes[0]!.blocks[0]!.children[0] as { gameData?: Record<string, unknown>; beats: { gameData?: Record<string, unknown> }[] };
    expect(snippet.beats[0]!.gameData).toEqual({ act: "uneasy" });
    expect(snippet.gameData).toEqual({ act: "troubled" });   // a snippet's field is another declaration
    expect(scenes[0]!.gameData).toEqual({ act: "troubled" });
  });

  it("reaches a scene's, a block's and a snippet's own values for those types", () => {
    const scenes = withData();
    expect(renameGameDataStage(scenes, "scene", "act", "troubled", "uneasy").values).toBe(1);
    expect(renameGameDataStage(scenes, "block", "act", "troubled", "uneasy").values).toBe(1);
    expect(renameGameDataStage(scenes, "snippet", "act", "troubled", "uneasy").values).toBe(1);
  });

  it("reaches a choice's options, and not the choice or any other group", () => {
    const scenes: Scene[] = [{ id: "c", type: "scene", name: "c", blocks: [{ id: "c_b", type: "block", name: "B", children: [
      { id: "c_g", type: "group", gameData: { act: "troubled" }, children: [
        { id: "c_ch", type: "group", selector: "choice", gameData: { act: "troubled" }, children: [
          { id: "c_o1", type: "group", prompt: { id: "c_P1", kind: "text" }, gameData: { act: "troubled" }, children: [] },
          { id: "c_o2", type: "group", prompt: { id: "c_P2", kind: "text" }, gameData: { act: "calm" }, children: [] },
        ] },
      ] },
    ] }] }];
    expect(renameGameDataStage(scenes, "option", "act", "troubled", "uneasy").values).toBe(1);
    const outer = scenes[0]!.blocks[0]!.children[0] as { gameData?: Record<string, unknown>; children: { gameData?: Record<string, unknown>; children: { gameData?: Record<string, unknown> }[] }[] };
    expect(outer.gameData).toEqual({ act: "troubled" });
    expect(outer.children[0]!.gameData).toEqual({ act: "troubled" });
    expect(outer.children[0]!.children.map((o) => o.gameData)).toEqual([{ act: "uneasy" }, { act: "calm" }]);
  });

  it("does nothing for an empty name or a rename to itself", () => {
    expect(renameGameDataStage(withData(), "line", "act", "troubled", " ").values).toBe(0);
    expect(renameGameDataStage(withData(), "line", "act", "troubled", "troubled").values).toBe(0);
  });
});
