import { describe, it, expect } from "vitest";
import { compileExpression, validateConditions, exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

function project(over: Partial<ProjectFile> = {}): ProjectFile {
  return {
    schema: "patter/project@0",
    project: { id: "proj_1", name: "Test" },
    locales: { default: "en", all: ["en"] },
    voiced: true,
    properties: [{ name: "hp", type: "number", shared: true }],
    cast: [{ name: "BARKEEP" }],
    ...over,
  };
}

function sceneWith(condition: string): Scene {
  return {
    id: "scn_1", type: "scene", name: "Scene",
    blocks: [{
      id: "blk_1", type: "block", name: "B", children: [
        { id: "sn_1", type: "snippet", condition, beats: [{ id: "L_1", kind: "line", character: "BARKEEP" }] },
      ],
    }],
  };
}

const en: LocaleFile = { schema: "patter/strings@0", scene: "scn_1", locale: "en", default: true, strings: { L_1: "Hello." } };

describe("compileExpression", () => {
  it("produces the { src, ast } envelope via the Patter dialect", () => {
    expect(compileExpression("@hp > 0")).toEqual({
      src: "@hp > 0",
      ast: ["bin", ">", ["sv", "patter", "hp"], ["n", 0]],
    });
  });
});

describe("validateConditions", () => {
  it("passes a valid condition against the property schema", () => {
    expect(validateConditions({ project: project(), scenes: [sceneWith("@hp > 0")] })).toEqual([]);
  });
  it("flags an unresolved property", () => {
    const issues = validateConditions({ project: project(), scenes: [sceneWith("@missing > 0")] });
    expect(issues.some((i) => i.message.includes("@missing") && i.field === "condition")).toBe(true);
  });
  it("flags an unparseable condition", () => {
    const issues = validateConditions({ project: project(), scenes: [sceneWith("@hp >")] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.nodeId).toBe("sn_1");
  });
  it("validates effect expressions too", () => {
    const s = sceneWith("@hp > 0");
    const node = s.blocks[0]!.children[0]!;
    if (node.type === "snippet") node.onEnter = [{ kind: "set", target: "@hp", value: "@nope > 1" }];
    const issues = validateConditions({ project: project(), scenes: [s] });
    expect(issues.some((i) => i.field === "onEnter.set" && i.message.includes("@nope"))).toBe(true);
  });
});

describe("exportBundle", () => {
  const bundle = exportBundle({ project: project(), scenes: [sceneWith("@hp > 0")], locales: [en] });

  it("emits a bundle envelope with metadata", () => {
    expect(bundle.schema).toBe("patter/bundle@0");
    expect(bundle.content.project).toBe("proj_1");
    expect(bundle.locales).toEqual({ default: "en", included: ["en"] });
  });
  it("compiles conditions to { src, ast } in the compiled tree", () => {
    const snippet = bundle.scenes.scn_1!.blocks[0]!.children[0]!;
    expect(snippet.condition).toEqual({ src: "@hp > 0", ast: ["bin", ">", ["sv", "patter", "hp"], ["n", 0]] });
  });
  it("carries the project-wide voiced flag", () => {
    expect(bundle.voiced).toBe(true);
  });
  it("assembles the selected locales' strings", () => {
    expect(bundle.strings.en!.L_1).toBe("Hello.");
  });
});

describe("author tags bake into the bundle (#215)", () => {
  function tagged(): Scene {
    const s = sceneWith("@hp > 0");
    s.tags = ["chapter1"];
    s.blocks[0]!.tags = ["intro"];
    const sn = s.blocks[0]!.children[0]!;
    sn.tags = ["combat"];
    if (sn.type === "snippet") sn.beats![0]!.tags = ["barked"];
    return s;
  }

  it("carries tags through at every level", () => {
    const bundle = exportBundle({ project: project(), scenes: [tagged()], locales: [en] });
    const scn = bundle.scenes.scn_1!;
    const blk = scn.blocks[0]!;
    const sn = blk.children[0]!;
    expect(scn.tags).toEqual(["chapter1"]);
    expect(blk.tags).toEqual(["intro"]);
    expect(sn.tags).toEqual(["combat"]);
    if (sn.type === "snippet") expect(sn.beats![0]!.tags).toEqual(["barked"]);
  });

  it("leaves the content hash unchanged when no tags are present", () => {
    const untagged = exportBundle({ project: project(), scenes: [sceneWith("@hp > 0")], locales: [en] });
    const alsoUntagged = exportBundle({ project: project(), scenes: [sceneWith("@hp > 0")], locales: [en] });
    expect(untagged.content.hash).toBe(alsoUntagged.content.hash);
  });
});
