// ---------------------------------------------------------------------------
// Localisation serialisers (spec §14): JSON / PO-POT / Excel each render and
// re-parse the SAME LocCatalog. Round-trip preserves the fields applyLoc needs
// (id, scene, translation, stale); PO keys by msgctxt so identical source text
// stays distinct; the fuzzy flag carries staleness.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  catalogToJson, jsonToCatalog, catalogToPo, poToCatalog, catalogToXlsx, xlsxToCatalog,
} from "../src/index.js";
import type { LocCatalog } from "../src/index.js";

const catalog: LocCatalog = {
  project: "demo", defaultLocale: "en", locale: "fr",
  entries: [
    { id: "L1", scene: "s1", source: "Yes.", translation: "Oui.", comments: ["Keep it short"], context: { character: "ANNA", kind: "line", gender: "female" }, stale: true },
    { id: "L2", scene: "s1", source: "Yes.", translation: "Ouais.", comments: [], context: { character: "BO", kind: "line" }, stale: false }, // same source, different id; BO has no declared gender
    { id: "T1", scene: "s1", source: "Narration", translation: "", comments: [], stale: false },
    { id: "cast:ANNA", scene: "@project", source: "Anna", translation: "Anne", comments: [], context: { character: "ANNA", gender: "female" }, stale: false },
  ],
};

const byId = (c: LocCatalog) => Object.fromEntries(c.entries.map((e) => [e.id, e]));

describe("JSON round-trip", () => {
  it("is lossless", () => {
    const back = jsonToCatalog(catalogToJson(catalog));
    expect(back.locale).toBe("fr");
    expect(back.defaultLocale).toBe("en");
    expect(back.entries).toEqual(catalog.entries);
  });
});

describe("PO / POT round-trip", () => {
  it("keys by msgctxt (identical source stays distinct), carries scene + fuzzy", () => {
    const po = catalogToPo(catalog);
    expect(po).toContain('Language: fr');
    expect(po).toContain('msgctxt "L1"');
    expect(po).toContain("#, fuzzy");           // L1 is stale
    expect(po).toContain("#: @project");        // the cast entry's scene anchor

    const back = byId(poToCatalog(po));
    expect(poToCatalog(po).locale).toBe("fr");  // from the Language header
    expect(back["L1"]).toMatchObject({ scene: "s1", source: "Yes.", translation: "Oui.", stale: true });
    expect(back["L2"]).toMatchObject({ source: "Yes.", translation: "Ouais.", stale: false }); // not collapsed with L1
    expect(back["T1"]!.translation).toBe("");
    expect(back["cast:ANNA"]).toMatchObject({ scene: "@project", translation: "Anne" });
  });

  it("carries the speaker's grammatical gender as an extracted comment", () => {
    const po = catalogToPo(catalog);
    expect(po).toContain("#. Gender: female");            // ANNA's line + her display name
    expect(po.match(/#\. Gender: /g)).toHaveLength(2);    // ...and only those two: BO / narration get none
    // The POT template carries it too - a translator sizing up the job needs it before any translating.
    const template: LocCatalog = { ...catalog, locale: undefined, entries: catalog.entries.map((e) => ({ ...e, translation: "", stale: false })) };
    expect(catalogToPo(template)).toContain("#. Gender: female");
  });

  it("a template (no locale) emits empty translations", () => {
    const template: LocCatalog = { ...catalog, locale: undefined, entries: catalog.entries.map((e) => ({ ...e, translation: "", stale: false })) };
    const po = catalogToPo(template);
    expect(po).toContain('Language: \\n');       // empty Language line
    expect(po).not.toContain('msgstr "Oui."');
  });
});

describe("Excel round-trip", () => {
  it("preserves id / scene / translation / stale", async () => {
    const back = byId(await xlsxToCatalog(await catalogToXlsx(catalog)));
    expect(back["L1"]).toMatchObject({ scene: "s1", translation: "Oui.", stale: true });
    expect(back["L2"]).toMatchObject({ scene: "s1", translation: "Ouais.", stale: false });
    expect(back["T1"]!.translation).toBe("");
    expect(back["cast:ANNA"]).toMatchObject({ scene: "@project", translation: "Anne" });
  });

  it("has a Gender column carrying the speaker's grammatical gender", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await catalogToXlsx(catalog) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("s1")!;

    // Appended AFTER Status, so the reader's positional columns 1-5 (and any sheet an older Patterpad
    // exported) keep working.
    const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
    expect(header).toEqual(["ID", "Source", "Translation", "Comments", "Status", "Gender"]);

    const rowFor = (id: string) => { let r; ws.eachRow((row, n) => { if (n > 1 && String(row.getCell(1).value) === id) r = row; }); return r!; };
    expect(String(rowFor("L1").getCell(6).value)).toBe("female"); // ANNA
    expect(rowFor("L2").getCell(6).value ?? "").toBe("");         // BO: no declared gender
  });

  it("still imports a sheet with no Gender column (an older export)", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s1");
    ws.addRow(["ID", "Source", "Translation", "Comments", "Status"]); // the legacy 5-column header
    ws.addRow(["L1", "Yes.", "Oui.", "", "stale"]);
    const back = byId(await xlsxToCatalog(Buffer.from(await wb.xlsx.writeBuffer())));
    expect(back["L1"]).toMatchObject({ scene: "s1", translation: "Oui.", stale: true });
  });
});
