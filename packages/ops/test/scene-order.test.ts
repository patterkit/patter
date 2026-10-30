// The nav's authored scene order (ProjectFile.sceneOrder): listed scenes first in list order,
// unlisted scenes keep their file order after them, vanished ids are ignored.
import { describe, it, expect } from "vitest";
import type { Scene } from "@patterkit/model";
import { applySceneOrder, applySceneNavOrder } from "../src/index.js";
import { sceneFolderLayout, sceneFolderPath } from "@patterkit/model";

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

// Scene folders (design/proposals/scene-folders.md): folders and scenes mix in one order, nested, and the
// layout forgives anything a merge or a hand edit can leave behind.
describe("sceneFolderLayout", () => {
  const rows = (l: ReturnType<typeof sceneFolderLayout>): string[] => l.rows.map((r) => `${"  ".repeat(r.depth)}${r.id}`);

  it("mixes folders and scenes in sceneOrder, nested depth first", () => {
    const l = sceneFolderLayout({
      sceneOrder: ["prologue", "act1", "docks", "a", "b", "interlude"],
      sceneFolders: [{ id: "act1", name: "Act 1" }, { id: "docks", name: "The docks", parent: "act1" }],
      sceneFolder: { a: "docks", b: "act1" },
    }, ["a", "b", "prologue", "interlude"]);
    expect(rows(l)).toEqual(["prologue", "act1", "  docks", "    a", "  b", "interlude"]);
    expect(l.sceneIds).toEqual(["prologue", "a", "b", "interlude"]);
  });

  it("puts unlisted scenes after the listed rows of their level, then unlisted folders", () => {
    const l = sceneFolderLayout({ sceneOrder: ["b"], sceneFolders: [{ id: "f", name: "F" }] }, ["a", "b", "c"]);
    expect(rows(l)).toEqual(["b", "a", "c", "f"]);
  });

  it("reads a missing folder or parent as the top level, and ignores stray ids", () => {
    const l = sceneFolderLayout({
      sceneOrder: ["gone", "f", "a"],
      sceneFolders: [{ id: "f", name: "F", parent: "nowhere" }],
      sceneFolder: { a: "missing", vanished: "f" },
    }, ["a"]);
    expect(rows(l)).toEqual(["f", "a"]);
    expect(l.sceneFolder.get("a")).toBeUndefined();
  });

  it("breaks a loop of parents at its first folder", () => {
    const l = sceneFolderLayout({
      sceneFolders: [{ id: "x", name: "X", parent: "y" }, { id: "y", name: "Y", parent: "x" }, { id: "z", name: "Z", parent: "y" }],
      sceneFolder: { a: "z" },
    }, ["a"]);
    expect(rows(l)).toEqual(["x", "  y", "    z", "      a"]);
  });

  it("names a scene's folder path", () => {
    const project = { sceneFolders: [{ id: "act1", name: "Act 1" }, { id: "docks", name: "The docks", parent: "act1" }], sceneFolder: { a: "docks" } };
    const l = sceneFolderLayout(project, ["a", "b"]);
    expect(sceneFolderPath(project, l, "a")).toBe("Act 1 / The docks");
    expect(sceneFolderPath(project, l, "b")).toBe("");
  });
});

describe("applySceneNavOrder", () => {
  it("sorts scenes as the list shows them, folders and all", () => {
    const scenes = [scene("a"), scene("b"), scene("c")];
    applySceneNavOrder(scenes, { sceneOrder: ["c", "f", "a"], sceneFolders: [{ id: "f", name: "F" }], sceneFolder: { b: "f" } });
    expect(ids(scenes)).toEqual(["c", "b", "a"]);
  });

  it("matches applySceneOrder when there are no folders", () => {
    const one = [scene("a"), scene("b"), scene("c"), scene("d")];
    const two = [scene("a"), scene("b"), scene("c"), scene("d")];
    applySceneOrder(one, ["c", "gone", "a"]);
    applySceneNavOrder(two, { sceneOrder: ["c", "gone", "a"] });
    expect(ids(two)).toEqual(ids(one));
  });
});
