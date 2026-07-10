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

  it("strips the cast's authoring-only fields (notes, actor, grammatical gender) from the bundle", () => {
    const authored = project({ cast: [{ name: "BARKEEP", displayName: "Barkeep", gender: "male", notes: "gruff, ex-soldier", actor: "Jane Doe" }] });
    const b = exportBundle({ project: authored, scenes: [sceneWith("@hp > 0")], locales: [en] });
    const member = b.cast![0]!;
    // Notes are production chatter, gender is translator context (it rides the localisation formats),
    // and `actor` is a real person's name - a shipped game must not carry any of them. Only the
    // player-facing fields survive.
    expect(member).toEqual({ name: "BARKEEP", displayName: "Barkeep" });
    expect(member).not.toHaveProperty("notes");
    expect(member).not.toHaveProperty("gender");
    expect(member).not.toHaveProperty("actor");   // the VO script export is where the actor belongs
    // Nothing anywhere in the serialised bundle names the actor (not in cast, not in gameData).
    expect(JSON.stringify(b)).not.toContain("Jane Doe");
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

describe("Best match: the specificity selector order round-trips into the bundle", () => {
  // A `sequence` group whose order is the new Best-match value, with one conditioned child + a filler.
  const bestMatchScene = (order: "specificity" | "shuffle"): Scene => ({
    id: "scn_1", type: "scene", name: "Scene",
    blocks: [{ id: "blk_1", type: "block", name: "B", children: [
      { id: "g_1", type: "group", selector: "sequence", options: { order, exhaust: "repeat" }, children: [
        { id: "sn_a", type: "snippet", condition: "@hp > 0", beats: [{ id: "L_a", kind: "line", character: "BARKEEP" }] },
        { id: "sn_f", type: "snippet", beats: [{ id: "L_f", kind: "line", character: "BARKEEP" }] },
      ] },
    ] }],
  });
  const strings: LocaleFile = { schema: "patter/strings@0", scene: "scn_1", locale: "en", default: true, strings: { L_a: "hi", L_f: "..." } };

  it("carries selector + options { order: 'specificity' } through verbatim", () => {
    const bundle = exportBundle({ project: project(), scenes: [bestMatchScene("specificity")], locales: [strings] });
    const group = bundle.scenes.scn_1!.blocks[0]!.children[0]!;
    expect(group.type).toBe("group");
    if (group.type === "group") {
      expect(group.selector).toBe("sequence");
      expect(group.options).toEqual({ order: "specificity", exhaust: "repeat" });
    }
  });

  it("changes the structure hash vs the same group as shuffle (a Tier-2 hot-reload change, not strings-only)", () => {
    const spec = exportBundle({ project: project(), scenes: [bestMatchScene("specificity")], locales: [strings] });
    const shuffle = exportBundle({ project: project(), scenes: [bestMatchScene("shuffle")], locales: [strings] });
    expect(spec.content.structureHash).not.toBe(shuffle.content.structureHash);
  });
});
