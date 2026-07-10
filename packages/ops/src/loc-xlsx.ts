// ---------------------------------------------------------------------------
// The Excel localisation format (spec §14): one sheet per scene (+ an `@project`
// sheet for display names), columns ID / Source / Translation / Comments / Status
// / Gender. A view of the LocCatalog, like loc-format.ts's JSON/PO. exceljs is
// lazy-loaded (heavy; only this path needs it), mirroring report-xlsx.ts.
//
// Round-trips: the sheet name carries the scene; Status "stale" carries the
// staleness flag. Source / Comments are read back for completeness but applyLoc
// only consumes id + scene + translation + stale. Gender is export-only translator
// context (regenerated from the cast each export), so the reader ignores it - which
// is also why it is APPENDED: the reader indexes columns 1-5 positionally, so a
// sheet exported by an older Patterpad still imports unchanged.
// ---------------------------------------------------------------------------

import type { LocCatalog, LocEntry } from "./localisation.js";

const HEADERS = ["ID", "Source", "Translation", "Comments", "Status", "Gender"] as const;
/** exceljs forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
const sheetName = (scene: string): string => scene.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);

/** Render the catalog as an .xlsx workbook: a sheet per scene, translator-facing columns. */
export async function catalogToXlsx(catalog: LocCatalog): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "patter";

  // Preserve scene order of first appearance.
  const byScene = new Map<string, LocEntry[]>();
  for (const e of catalog.entries) (byScene.get(e.scene) ?? byScene.set(e.scene, []).get(e.scene)!).push(e);

  for (const [scene, entries] of byScene) {
    const ws = wb.addWorksheet(sheetName(scene));
    ws.columns = [
      { header: "ID", key: "id", width: 22 },
      { header: "Source", key: "source", width: 40 },
      { header: "Translation", key: "translation", width: 40 },
      { header: "Comments", key: "comments", width: 30 },
      { header: "Status", key: "status", width: 10 },
      { header: "Gender", key: "gender", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const e of entries) {
      ws.addRow({ id: e.id, source: e.source, translation: e.translation,
        comments: e.comments.join("\n"), status: e.stale ? "stale" : (e.translation ? "translated" : ""),
        gender: e.context?.gender ?? "" });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Parse an .xlsx workbook back into a catalog. Scene = sheet name; stale = Status "stale". `locale` is
 *  not carried in the sheet, so the caller supplies it (--locale). */
export async function xlsxToCatalog(buffer: Buffer): Promise<LocCatalog> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const entries: LocEntry[] = [];
  for (const ws of wb.worksheets) {
    const scene = ws.name;
    // Confirm the header row matches before trusting column positions.
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
    if (header[0] !== HEADERS[0]) continue; // not a loc sheet
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cell = (c: number): string => { const v = row.getCell(c).value; return v == null ? "" : String(typeof v === "object" && "text" in v ? v.text : v); };
      const id = cell(1).trim();
      if (!id) return;
      const status = cell(5).trim().toLowerCase();
      entries.push({ id, scene, source: cell(2), translation: cell(3),
        comments: cell(4) ? cell(4).split("\n").filter(Boolean) : [], stale: status === "stale" });
    });
  }
  return { project: "", defaultLocale: "", locale: undefined, entries };
}
