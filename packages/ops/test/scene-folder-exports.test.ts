// Scene folders in the exports (patterkit design/proposals/scene-folders.md, D5): the report, voice script,
// and loc spreadsheets carry a Folder column when the project has folders, and nothing changes when it hasn't.
// The loc sheet's Folder column is display only: the import never reads it.
import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { loadProject, runReport, runReportXlsx, runVoiceScript, voiceScriptToXlsx, extractLoc, catalogToXlsx, xlsxToCatalog, sceneFolderPaths } from "../src/index.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function copy(folders: boolean): string {
  const dir = join(mkdtempSync(join(tmpdir(), "ops-folders-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  if (folders) {
    const file = join(dir, "tavern.patterproj");
    const p = parseSource(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, canonicalStringify({ ...p, sceneFolders: [{ id: "act1", name: "Act 1" }, { id: "inn", name: "The inn", parent: "act1" }], sceneFolder: { scn_tavern: "inn" } }));
  }
  return dir;
}
const headers = async (buf: Buffer, sheet?: string): Promise<string[]> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = sheet ? wb.getWorksheet(sheet)! : wb.worksheets[0]!;
  return (ws.getRow(1).values as unknown[]).slice(1).map(String);
};

describe("scene folders in the exports", () => {
  it("names each filed scene's folder path", () => {
    const loaded = loadProject(copy(true));
    expect([...sceneFolderPaths(loaded)]).toEqual([["scn_tavern", "Act 1 / The inn"]]);
    expect(runReport(loaded).scenes.find((s) => s.sceneId === "scn_tavern")?.folder).toBe("Act 1 / The inn");
    const lines = runVoiceScript(loaded, { everything: true }).lines;
    expect(lines.length).toBeGreaterThan(0);
  });

  it("the report and voice script sheets gain a Folder column only when there are folders", async () => {
    const withF = loadProject(copy(true)), without = loadProject(copy(false));
    expect((await headers(await runReportXlsx(runReport(withF)), "Scenes"))[0]).toBe("Folder");
    expect((await headers(await runReportXlsx(runReport(without)), "Scenes"))[0]).toBe("Scene");
    expect((await headers(await voiceScriptToXlsx(runVoiceScript(withF, { everything: true }))))[0]).toBe("Folder");
    expect((await headers(await voiceScriptToXlsx(runVoiceScript(without, { everything: true }))))[0]).toBe("Scope");
  });

  it("the loc sheet's Folder column comes last and the import ignores it", async () => {
    const loaded = loadProject(copy(true));
    const catalog = extractLoc(loaded, { locale: "fr" });
    const buf = await catalogToXlsx(catalog, { folders: sceneFolderPaths(loaded) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheet = wb.worksheets.find((ws) => (ws.getRow(2).getCell(7).value as string) === "scn_tavern")!;
    expect((sheet.getRow(1).values as unknown[]).slice(1).at(-1)).toBe("Folder");
    expect(sheet.getRow(2).getCell(9).value).toBe("Act 1 / The inn");
    const back = await xlsxToCatalog(buf);
    expect(back.entries.map((e) => [e.id, e.scene])).toEqual(catalog.entries.map((e) => [e.id, e.scene]));
  });
});
