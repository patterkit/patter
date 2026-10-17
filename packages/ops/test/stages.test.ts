// ---------------------------------------------------------------------------
// A quality's stage rename, carried into the scenes' expressions, and the gates a reorder changes.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ProjectFile, Scene } from "@patterkit/model";
import { renameStage, renameStageInExpression, stageDialect, stageGateCount } from "../src/index.js";

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

describe("renameStageInExpression", () => {
  it("rewrites a literal compared with the quality, in the author's own text", () => {
    expect(renameStageInExpression('@debt >= "confronted" and @gold > 2', dialect, isDebt, "confronted", "faced"))
      .toBe('@debt >= "faced" and @gold > 2');
    expect(renameStageInExpression('"confronted" == @patter.debt', dialect, isDebt, "confronted", "faced"))
      .toBe('"faced" == @patter.debt');
  });

  it("leaves the same word compared with another quality as it was", () => {
    expect(renameStageInExpression('@debt == "troubled" or @mood == "troubled"', dialect, isDebt, "troubled", "uneasy"))
      .toBe('@debt == "uneasy" or @mood == "troubled"');
  });

  it("rewrites a whole value assigned to the quality, and nothing that isn't about it", () => {
    expect(renameStageInExpression('"troubled"', dialect, isDebt, "troubled", "uneasy", true)).toBe('"uneasy"');
    expect(renameStageInExpression('"troubled"', dialect, isDebt, "troubled", "uneasy", false)).toBeUndefined();
    expect(renameStageInExpression('@gold > 2', dialect, isDebt, "troubled", "uneasy")).toBeUndefined();
    expect(renameStageInExpression('@debt >= (', dialect, isDebt, "troubled", "uneasy")).toBeUndefined();
  });
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
  it("counts the expressions that order the quality, which a reorder changes", () => {
    const scenes = [scene("a", '@debt >= "confronted"', '"x"'), scene("b", '@debt == "resolved"', '"x"'), scene("c", 'not (@debt < "resolved")', '"x"')];
    expect(stageGateCount(scenes, { scope: "patter", name: "debt" }, dialect)).toBe(2);
    expect(stageGateCount(scenes, { scope: "patter", name: "mood" }, dialect)).toBe(0);
  });
});
