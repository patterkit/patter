// ---------------------------------------------------------------------------
// Scene folders (patterkit design/proposals/scene-folders.md): the pure edits to the scene list's shape
// (main/scene-nav.ts), and the main-process calls that commit them as one undoable project step each.
// Folders are cosmetic: no scene file moves, and nothing but the project file is written.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@patterkit/core";
import { loadProject } from "@patterkit/ops";
import { sceneFolderLayout } from "@patterkit/model";
import type { ProjectFile } from "@patterkit/model";
import { addNavFolder, dropNavScene, insertNavScene, moveNavRowBy, orderNavScenes, placeNavRow, removeNavFolder, untitledFolderName, withNav, type SceneNavFields } from "../src/main/scene-nav.js";
import * as project from "../src/main/project.js";

const tree = (nav: SceneNavFields | { error: string } | null, scenes: string[]): string[] => {
  if (!nav || "error" in nav) throw new Error(JSON.stringify(nav));
  return sceneFolderLayout(nav, scenes).rows.map((r) => `${"  ".repeat(r.depth)}${r.id}`);
};

describe("scene-nav: the list's shape", () => {
  const scenes = ["a", "b", "c"];
  const base: SceneNavFields = { sceneOrder: ["a", "f", "b", "c"], sceneFolders: [{ id: "f", name: "F" }], sceneFolder: { b: "f" } };

  it("drops a scene into a folder, before or after a row, and back out to the top level", () => {
    expect(tree(placeNavRow(base, scenes, "c", "f", "into"), scenes)).toEqual(["a", "f", "  b", "  c"]);
    expect(tree(placeNavRow(base, scenes, "c", "b", "before"), scenes)).toEqual(["a", "f", "  c", "  b"]);
    expect(tree(placeNavRow(base, scenes, "b", "a", "before"), scenes)).toEqual(["b", "a", "f", "c"]);
    expect(tree(placeNavRow(base, scenes, "b", null, "into"), scenes)).toEqual(["a", "f", "c", "b"]);
  });

  it("adds a folder at the end of another with `inside`", () => {
    expect(tree(addNavFolder(base, scenes, { id: "g", name: "G" }, undefined, "f"), scenes)).toEqual(["a", "f", "  b", "  g", "c"]);
  });

  it("nests folders, and refuses a folder inside itself or a scene holding anything", () => {
    const two = addNavFolder(base, scenes, { id: "g", name: "G" }, "c");
    expect(tree(placeNavRow(two, scenes, "g", "f", "into"), scenes)).toEqual(["a", "f", "  b", "  g", "c"]);
    const nested = placeNavRow(two, scenes, "g", "f", "into") as SceneNavFields;
    expect(placeNavRow(nested, scenes, "f", "g", "into")).toEqual({ error: "A folder can't go inside itself." });
    expect(placeNavRow(base, scenes, "c", "a", "into")).toEqual({ error: "Only a folder can hold scenes." });
  });

  it("moves a row among its siblings only", () => {
    expect(tree(moveNavRowBy(base, scenes, "f", -1), scenes)).toEqual(["f", "  b", "a", "c"]);
    expect(moveNavRowBy(base, scenes, "b", 1)).toBeNull(); // b is alone in f
  });

  it("deletes a folder by moving what it holds up into its place", () => {
    expect(tree(removeNavFolder(base, scenes, "f"), scenes)).toEqual(["a", "b", "c"]);
    const out = removeNavFolder(base, scenes, "f") as SceneNavFields;
    expect(out.sceneFolders).toBeUndefined();
    expect(out.sceneFolder).toBeUndefined();
  });

  it("puts a new scene after the one it follows, in its folder; drops a deleted one from both", () => {
    expect(tree(insertNavScene(base, [...scenes, "n"], "n", "b"), [...scenes, "n"])).toEqual(["a", "f", "  b", "  n", "c"]);
    const gone = dropNavScene(base, ["a", "c"], "b");
    expect(gone.sceneFolder).toBeUndefined();
    expect(gone.sceneOrder).toEqual(["a", "f", "c"]);
  });

  it("the old flat reorder keeps each scene in its folder", () => {
    expect(tree(orderNavScenes(base, scenes, ["c", "b", "a"]), scenes)).toEqual(["c", "f", "  b", "a"]);
  });

  it("withNav removes a field the edit emptied", () => {
    const p = withNav({ ...base, voiced: true } as SceneNavFields & { voiced: boolean }, { sceneOrder: ["a"] });
    expect(p).toEqual({ voiced: true, sceneOrder: ["a"] });
  });

  it("numbers new folders past the ones already called that", () => {
    expect(untitledFolderName([])).toBe("New folder");
    expect(untitledFolderName(["New folder", "New folder 2"])).toBe("New folder 3");
  });
});

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function openCopy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-folders-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
  return dir;
}
const projectFile = (dir: string): ProjectFile => parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as ProjectFile;
const files = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.endsWith(".patterproj")).sort();

describe("scene folders in the open project", () => {
  it("makes a folder, files a scene into it, renames it, and keeps every scene file where it was", async () => {
    const dir = openCopy();
    const before = files(dir);
    const made = await project.createSceneFolder("scn_street");
    expect(made.ok).toBe(true);
    const id = made.folderId!;
    expect(made.project!.sceneFolders).toEqual([{ id, name: "New folder" }]);
    const filed = await project.placeSceneRow("scn_tavern", id, "into");
    expect(filed.ok).toBe(true);
    expect(filed.project!.navRows).toEqual([
      { kind: "scene", id: "scn_street", depth: 0 },
      { kind: "folder", id, depth: 0 },
      { kind: "scene", id: "scn_tavern", depth: 1, folder: id },
    ]);
    await project.renameSceneFolder(id, "  The inn  ");
    expect(projectFile(dir)).toMatchObject({ sceneOrder: ["scn_street", id, "scn_tavern"], sceneFolders: [{ id, name: "The inn" }], sceneFolder: { scn_tavern: id } });
    expect(files(dir)).toEqual(before);
    // A fresh load lists the scenes as the list shows them.
    expect(loadProject(dir).scenes.map((s) => s.id)).toEqual(["scn_street", "scn_tavern"]);
  });

  it("each edit is one undo step, and undo puts the list back", async () => {
    const dir = openCopy();
    const { folderId } = await project.createSceneFolder();
    await project.placeSceneRow("scn_street", folderId!, "into");
    expect(project.projectHistoryState().undo?.label).toBe("Move scene to folder");
    await project.stepProjectHistory("undo");
    expect(projectFile(dir).sceneFolder).toBeUndefined();
    await project.stepProjectHistory("undo");
    expect(projectFile(dir).sceneFolders).toBeUndefined();
  });

  it("deleting a folder moves its scenes up and deletes none of them", async () => {
    const dir = openCopy();
    const { folderId } = await project.createSceneFolder("scn_tavern");
    await project.placeSceneRow("scn_street", folderId!, "into");
    const res = await project.deleteSceneFolder(folderId!);
    expect(res.ok).toBe(true);
    expect(res.project!.navRows.map((r) => r.id)).toEqual(["scn_tavern", "scn_street"]);
    expect(projectFile(dir).sceneFolders).toBeUndefined();
    expect(res.project!.scenes).toHaveLength(2);
  });

  it("a new scene joins the open scene's folder; deleting a scene drops its filing", async () => {
    const dir = openCopy();
    const { folderId } = await project.createSceneFolder();
    await project.placeSceneRow("scn_tavern", folderId!, "into");
    const made = await project.createScene("Cellar", "blank", undefined, "scn_tavern");
    expect(projectFile(dir).sceneFolder).toEqual({ scn_tavern: folderId, [made.sceneId!]: folderId });
    await project.deleteScene(made.sceneId!);
    expect(projectFile(dir).sceneFolder).toEqual({ scn_tavern: folderId });
  });

  it("puts a scene's folders in front of a search hit's location", async () => {
    openCopy();
    const { folderId } = await project.createSceneFolder();
    await project.renameSceneFolder(folderId!, "Act 1");
    await project.placeSceneRow("scn_tavern", folderId!, "into");
    const hit = project.searchProject("scn_tavern").find((h) => h.id === "scn_tavern");
    expect(hit?.location[0]).toBe("Act 1");
    const street = project.searchProject("scn_street").find((h) => h.id === "scn_street");
    expect(street?.location[0]).not.toBe("Act 1");
  });

  it("refuses a blank folder name, and moves a folder up and down as a row", async () => {
    openCopy();
    const { folderId } = await project.createSceneFolder();
    expect(await project.renameSceneFolder(folderId!, "   ")).toEqual({ ok: false, error: "A folder needs a name." });
    const up = await project.moveScene(folderId!, -1);
    expect(up).toMatchObject({ ok: true, moved: true });
    expect(project.projectHistoryState().undo?.label).toBe("Move folder up");
    expect(up.project!.navRows.map((r) => r.id)).toEqual(["scn_street", folderId, "scn_tavern"]);
  });
});
