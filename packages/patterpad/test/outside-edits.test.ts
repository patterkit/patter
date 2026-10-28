// ---------------------------------------------------------------------------
// A scene changed outside Patterpad (the hands-on review of October 2026, section 5): a pull in a terminal,
// a synced folder, another app. The editor's save writes the whole scene, so writing over such a change
// would throw it away; the save is refused instead and the scene read again, and a reopen reads the disk.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@patterkit/ops";
import * as project from "../src/main/project.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "pp-outside-"));

/** Change a file as another app would: new bytes, and a later modification time. */
function editOutside(path: string, text: string): void {
  writeFileSync(path, text);
  const later = new Date(Date.now() + 5000);
  utimesSync(path, later, later);
}

async function openScene(): Promise<{ id: string; flowPath: string }> {
  const dir = await project.scaffoldProject(tmp(), "Outside");
  project.openProject(dir);
  const id = (await project.createScene("Pulled")).sceneId!;
  return { id, flowPath: loadProject(dir).sceneFiles[id]! };
}

describe("a scene changed outside Patterpad", () => {
  it("is read again on reopen, not served from memory", async () => {
    const { id, flowPath } = await openScene();
    const before = project.readScene(id).flowSource;
    editOutside(flowPath, `${before}\n`);
    expect(project.readScene(id).flowSource).toBe(`${before}\n`);
  });

  it("refuses a save that would overwrite it, keeps the outside change, and reads the scene again", async () => {
    const { id, flowPath } = await openScene();
    const src = project.readScene(id);
    const pulled = `${src.flowSource}\n`;
    editOutside(flowPath, pulled);
    const res = await project.saveScene(id, `${src.flowSource}\n\n`, src.locSource);
    expect(res.ok).toBe(false);
    expect(res.reread).toBe(true);
    expect(res.error).toMatch(/changed outside Patterpad since it was read/);
    expect(readFileSync(flowPath, "utf8")).toBe(pulled);
    // Read again: a save built from what's on disk now goes through.
    expect(project.readScene(id).flowSource).toBe(pulled);
    expect((await project.saveScene(id, `${pulled}\n`, src.locSource)).ok).toBe(true);
    expect(readFileSync(flowPath, "utf8")).toBe(`${pulled}\n`);
  });

  it("isn't confused by Patterpad's own saves", async () => {
    const { id, flowPath } = await openScene();
    const src = project.readScene(id);
    expect((await project.saveScene(id, `${src.flowSource}\n`, src.locSource)).ok).toBe(true);
    expect((await project.saveScene(id, `${src.flowSource}\n\n`, src.locSource)).ok).toBe(true);
    expect(readFileSync(flowPath, "utf8")).toBe(`${src.flowSource}\n\n`);
  });
});
