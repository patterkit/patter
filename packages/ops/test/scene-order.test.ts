// The nav's authored scene order (ProjectFile.sceneOrder): listed scenes first in list order,
// unlisted scenes keep their file order after them, vanished ids are ignored.
import { describe, it, expect } from "vitest";
import type { Scene } from "@patterkit/model";
import { applySceneOrder } from "../src/index.js";

const scene = (id: string): Scene => ({ id, type: "scene", name: id.toUpperCase(), blocks: [] });
const ids = (scenes: Scene[]): string[] => scenes.map((s) => s.id);

describe("applySceneOrder", () => {
  it("sorts listed scenes into the authored order", () => {
    const scenes = [scene("a"), scene("b"), scene("c")];
    applySceneOrder(scenes, ["c", "a", "b"]);
    expect(ids(scenes)).toEqual(["c", "a", "b"]);
  });

  it("appends unlisted scenes in their file order", () => {
    const scenes = [scene("a"), scene("b"), scene("c"), scene("d")];
    applySceneOrder(scenes, ["c", "a"]);
    expect(ids(scenes)).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores listed ids that no longer exist", () => {
    const scenes = [scene("a"), scene("b")];
    applySceneOrder(scenes, ["gone", "b", "a"]);
    expect(ids(scenes)).toEqual(["b", "a"]);
  });

  it("is a no-op without an order", () => {
    const scenes = [scene("b"), scene("a")];
    applySceneOrder(scenes, undefined);
    expect(ids(scenes)).toEqual(["b", "a"]);
  });
});
