// ---------------------------------------------------------------------------
// The editable script handoff in Patterpad's main process: line counts for the export dialog, the export
// and its handoff record, planning and applying a reimport (all or nothing under a lock), the review list,
// deciding suggestions on the files, and suggestions that carry no text surviving a save.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { setProvider, clearProvider } from "@wildwinter/simple-vc-lib";
import type { IVCProvider, VCResult, VCFileStatus } from "@wildwinter/simple-vc-lib";
import * as project from "../src/main/project.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const ok: VCResult = { success: true, status: "ok", message: "" };

/** A provider that can report one path as locked by someone else, and records what it was asked to write. */
class LockingVcs implements IVCProvider {
  readonly name = "perforce";
  lockedSuffix: string | null = null;
  prepared: string[] = [];
  prepareToWrite(p: string): VCResult { this.prepared.push(p); return ok; }
  finishedWrite(): VCResult { return ok; }
  deleteFile(): VCResult { return ok; }
  deleteFolder(): VCResult { return ok; }
  renameFile(): VCResult { return ok; }
  renameFolder(): VCResult { return ok; }
  prepareToWriteAsync(p: string): Promise<VCResult> { return Promise.resolve(this.prepareToWrite(p)); }
  finishedWriteAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  deleteFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFileAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  renameFolderAsync(): Promise<VCResult> { return Promise.resolve(ok); }
  status(paths: string[]): VCFileStatus[] {
    return paths.map((filePath) => {
      const held = this.lockedSuffix !== null && filePath.endsWith(this.lockedSuffix);
      return { filePath, system: "perforce", writable: !held, tracked: true, ...(held ? { lockedBy: ["bob@bob-ws"] } : {}) };
    });
  }
  statusAsync(paths: string[]): Promise<VCFileStatus[]> { return Promise.resolve(this.status(paths)); }
}

let vcs: LockingVcs;
beforeEach(() => { vcs = new LockingVcs(); });
afterEach(() => clearProvider());

function openTavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-editable-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  project.openProject(dir);
  setProvider(vcs); // after open, which pins the project's own system
  return dir;
}

/** Export, then hand back a copy with one line's words changed (untracked), as an editor would. */
async function exportAndEdit(dir: string, beat: string, text: string): Promise<string> {
  const out = (await project.editableScript({ range: "project", recipient: "Sam", notes: "editor", status: false, cast: false }, "Ian"))!;
  expect((await project.commitHandoff(out.writes)).ok).toBe(true);
  const h = JSON.parse(readFileSync(out.writes[0]!.path, "utf8")) as { lines: Record<string, { id: string }> };
  const code = Object.entries(h.lines).find(([, l]) => l.id === beat)![0];
  const zip = await JSZip.loadAsync(out.docx);
  let xml = await zip.file("word/document.xml")!.async("string");
  const t0 = xml.lastIndexOf("<w:tbl>", xml.indexOf(`[#${code}]`));
  const c1 = xml.indexOf("<w:tc>", xml.indexOf("<w:tc>", t0) + 1);
  const end = xml.indexOf("</w:tc>", c1);
  const cell = xml.slice(c1, end);
  xml = xml.slice(0, c1) + cell.slice(0, cell.indexOf("</w:tcPr>") + 9) + `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` + xml.slice(end);
  zip.file("word/document.xml", xml);
  const returned = join(dir, "..", "returned.docx");
  writeFileSync(returned, await zip.generateAsync({ type: "nodebuffer" }));
  return returned;
}

const opts = { strictQuotes: false, direct: false };

describe("editable script in Patterpad's main process", () => {
  it("counts the editable lines for one scene and the project", () => {
    openTavern();
    const counts = project.editableLineCounts("scn_tavern");
    expect(counts.scene).toBeGreaterThan(0);
    expect(counts.project).toBeGreaterThan(counts.scene);
  });

  it("exports, commits the handoff record, and lists it as open", async () => {
    openTavern();
    const out = (await project.editableScript({ range: "scene", sceneId: "scn_tavern", notes: "editor", status: false, cast: false }, "Ian"))!;
    expect(out.defaultName).toBe("The Tavern - The Tavern (editable).docx");
    expect((await project.commitHandoff(out.writes)).ok).toBe(true);
    expect(project.openHandoffs().map((h) => h.id)).toEqual([out.handoffId]);
  });

  it("plans a reimport, applies it, lists the suggestion, and accepts it on the files", async () => {
    const dir = openTavern();
    const returned = await exportAndEdit(dir, "L_greet", "What will it be, friend?");
    const summary = await project.planEditableImportFile(returned, opts, "Ian");
    expect(summary).toMatchObject({ recipient: "Sam", sentBy: "Ian", counts: { changed: 1, problems: 0 } });
    expect(summary.planId).toBeDefined();
    expect((await project.applyEditableImport(summary.planId!)).ok).toBe(true);

    expect(project.readSceneSuggestions("scn_tavern").map((s) => s.proposed)).toEqual(["What will it be, friend?"]);
    const listed = project.listSuggestions({});
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ anchor: "L_greet", sceneName: "The Tavern", author: "Sam", stale: [] });

    const decided = await project.decideSuggestions([{ id: listed[0]!.id, accept: true }], "Ian");
    expect(decided.ok).toBe(true);
    expect(project.readScene("scn_tavern").locSource).toContain("What will it be, friend?");
    expect(project.listSuggestions({})).toEqual([]);
  });

  it("an import refused under a lock writes nothing, and says who holds what", async () => {
    const dir = openTavern();
    const returned = await exportAndEdit(dir, "L_greet", "Locked out.");
    const authoring = join(dir, "authoring/tavern.patterx");
    const before = readFileSync(authoring, "utf8");
    const summary = await project.planEditableImportFile(returned, opts, "Ian");
    vcs.lockedSuffix = "tavern.patterx";
    const res = await project.applyEditableImport(summary.planId!);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Nothing was written");
    expect(res.error).toContain("bob@bob-ws");
    expect(readFileSync(authoring, "utf8")).toBe(before);
  });

  it("refuses a file from another project's handoff, with nothing to apply", async () => {
    const other = openTavern();
    const returned = await exportAndEdit(other, "L_greet", "x");
    openTavern(); // a fresh copy that never saw that handoff
    const summary = await project.planEditableImportFile(returned, opts, "Ian");
    expect(summary.refused).toMatch(/isn't in this project/);
    expect(summary.planId).toBeUndefined();
  });

  it("keeps a suggestion with no text change (a cut, a speaker) when the scene's suggestions are saved", async () => {
    openTavern();
    project.readScene("scn_tavern"); // as the editor does before it saves a scene's suggestions (lazy open)
    const cut = { id: "sg_cut", anchor: "L_greet", baseline: "x", proposed: "", author: "Sam", ts: "2026-10-05T00:00:00Z", proposedCut: true };
    const blank = { id: "sg_blank", anchor: "L_greet", baseline: "x", proposed: " ", author: "Me", ts: "2026-10-05T00:00:00Z" };
    const saved = await project.saveSceneSuggestions("scn_tavern", [cut, blank]);
    expect(saved.error ?? "").toBe("");
    expect(saved.ok).toBe(true);
    expect(project.readSceneSuggestions("scn_tavern").map((s) => s.id)).toEqual(["sg_cut"]);
  });
});

