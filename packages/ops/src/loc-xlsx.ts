// ---------------------------------------------------------------------------
// The Excel localisation format (spec §14): one sheet per scene (+ an `@project`
// sheet for display names), columns ID / Source / Translation / Comments / Status
// / Gender / Qualifier. A view of the LocCatalog, like loc-format.ts's JSON/PO. exceljs is
// lazy-loaded (heavy; only this path needs it), mirroring report-xlsx.ts.
//
// Round-trips: a hidden Scene column carries the scene id on every row; Status
// "stale" carries the staleness flag. Source / Comments are read back for
// completeness but applyLoc only consumes id + scene + translation + stale. Gender
// is export-only translator context (regenerated from the cast each export), so the
// reader ignores it, as it does Qualifier (a line's speaker qualifier, how it is
// delivered: context, never text to translate). Gender, Scene, and Qualifier are
// APPENDED: the reader indexes columns 1-5 positionally, and finds Scene at 7, so a
// sheet exported by an older Patterpad still imports unchanged.
//
// The scene cannot ride on the sheet name alone, because Excel's sheet names are
// not a faithful carrier: at most 31 characters, unique regardless of case, and
// barred from : \ / ? * [ ]. Two long ids sharing their first 31 characters would
// collide, and an id with a barred character would come back as a different id.
// The sheet name is now only a readable label; a sheet without the Scene column (an
// older export) still takes its scene from the name, as it always did.
// ---------------------------------------------------------------------------

import type { LocCatalog, LocEntry } from "./localisation.js";
import { checkCatalogField } from "./loc-format.js";

const HEADERS = ["ID", "Source", "Translation", "Comments", "Status", "Gender", "Scene", "Qualifier"] as const;
/** The 1-based column of the hidden scene id. */
const SCENE_COLUMN = HEADERS.indexOf("Scene") + 1;
/** Excel's (and exceljs's) cap on a sheet name's length. */
const SHEET_NAME_MAX = 31;

/**
 * A legal, unique sheet name for a scene. Excel forbids : \ / ? * [ ], a leading or trailing apostrophe, an
 * empty name, and "History"; it caps a name at 31 characters and compares names regardless of case. A name
 * already taken gets a numbered suffix, and the base is cut short BEFORE the suffix goes on, so the
 * suffixed name always fits and each attempt is a different name (the loop always ends).
 */
function uniqueSheetName(scene: string, used: Set<string>): string {
  const tidy = (s: string): string => s.replace(/^'+|'+$/g, "");
  const base = tidy(scene.replace(/[:\\/?*[\]]/g, "-").slice(0, SHEET_NAME_MAX)) || "Scene";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()) || name.toLowerCase() === "history"; n++) {
    const suffix = ` (${n})`;
    name = tidy(base.slice(0, SHEET_NAME_MAX - suffix.length)) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * A cell's text, whatever shape exceljs hands back. A translator's formatting is the usual trap: bolding
 * one word turns the cell into rich text (`{ richText: [{ text }, ...] }`), which plain `String()` renders
 * as "[object Object]" and import would then write over the translation. Hyperlinks carry `text` (itself
 * possibly rich text), formulas carry their cached `result`, and an error value (or anything else unknown)
 * reads as empty rather than as an object's name. Shared strings are resolved by exceljs on load.
 */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) return o.richText.map((run) => cellText((run as { text?: unknown })?.text)).join("");
  if ("text" in o) return cellText(o.text);       // a hyperlink
  if ("result" in o) return cellText(o.result);   // a formula (or shared formula): its cached value
  return "";                                     // an error value, or a shape this reader does not know
}

/** Render the catalog as an .xlsx workbook: a sheet per scene, translator-facing columns. */
export async function catalogToXlsx(catalog: LocCatalog): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "patter";

  // Preserve scene order of first appearance.
  const byScene = new Map<string, LocEntry[]>();
  for (const e of catalog.entries) (byScene.get(e.scene) ?? byScene.set(e.scene, []).get(e.scene)!).push(e);

  const used = new Set<string>();
  for (const [scene, entries] of byScene) {
    const ws = wb.addWorksheet(uniqueSheetName(scene, used));
    ws.columns = [
      { header: "ID", key: "id", width: 22 },
      { header: "Source", key: "source", width: 40 },
      { header: "Translation", key: "translation", width: 40 },
      { header: "Comments", key: "comments", width: 30 },
      { header: "Status", key: "status", width: 10 },
      { header: "Gender", key: "gender", width: 12 },
      // Hidden: the translator has no use for it, and it is the import's only faithful record of the scene.
      { header: "Scene", key: "scene", width: 22, hidden: true },
      // After the hidden Scene column, so the columns an older reader finds by position stay where they were.
      { header: "Qualifier", key: "qualifier", width: 11 },
    ];
    ws.getRow(1).font = { bold: true };
    // Frozen, not just bold: a long sheet is read by scrolling, and the header row is the only
    // thing that says which of the look-alike columns you are looking at. Presentation only -
    // `xlsxToCatalog` reads columns positionally and is untouched by it.
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const e of entries) {
      ws.addRow({ id: e.id, source: e.source, translation: e.translation,
        comments: e.comments.join("\n"), status: e.stale ? "stale" : (e.translation ? "translated" : ""),
        gender: e.context?.gender ?? "", scene, qualifier: e.context?.qualifier ?? "" });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Parse an .xlsx workbook back into a catalog. Scene = the hidden Scene column (else, for an older export,
 *  the sheet name); stale = Status "stale". `locale` is not carried in the sheet, so the caller supplies it
 *  (--locale). Throws when a scene is not a plain scene id (see `checkCatalogField`). */
export async function xlsxToCatalog(buffer: Buffer): Promise<LocCatalog> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const entries: LocEntry[] = [];
  for (const ws of wb.worksheets) {
    // Confirm the header row matches before trusting column positions.
    const header = (ws.getRow(1).values as unknown[]).slice(1).map(cellText);
    if (header[0] !== HEADERS[0]) continue; // not a loc sheet
    const hasSceneColumn = header[SCENE_COLUMN - 1] === "Scene";
    const sceneOf = (row: { getCell(c: number): { value: unknown } }): string => (hasSceneColumn ? cellText(row.getCell(SCENE_COLUMN).value).trim() : "");
    // A row the translator added has no scene of its own: it belongs to the sheet it sits on, whose scene is
    // the one its exported rows carry. An older export has no Scene column, and its sheet name is the scene.
    let sheetScene = "";
    ws.eachRow((row, n) => { if (n > 1 && !sheetScene) sheetScene = sceneOf(row); });
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cell = (c: number): string => cellText(row.getCell(c).value);
      const id = cell(1).trim();
      if (!id) return;
      const status = cell(5).trim().toLowerCase();
      const scene = checkCatalogField("spreadsheet", "scene", sceneOf(row) || sheetScene || ws.name);
      entries.push({ id, scene, source: cell(2), translation: cell(3),
        comments: cell(4) ? cell(4).split("\n").filter(Boolean) : [], stale: status === "stale" });
    });
  }
  return { project: "", defaultLocale: "", locale: undefined, entries };
}
