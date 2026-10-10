// ---------------------------------------------------------------------------
// Speaker qualifiers (`TAM (O.S.)`) in the exports and the localisation formats. The qualifier shows wherever
// the script is displayed (the screenplay cue, the voice script's own column, playable HTML, the CLI's
// transcript) and rides as read-only translator context, while `TAM` and `TAM (O.S.)` stay one character
// for every count and grouping. Its shown name is a project-level string (`qualifier:<gameId>`) that
// round-trips through every loc format as a cast display name does.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import {
  loadProject, runScriptDoc, scriptToDocx, scriptToPdf, runVoiceScript, voiceScriptToXlsx, runReport, runPlay, renderPlay,
  runExportHtml, runExportFull, extractLoc, applyLoc, applyWrites, catalogToJson, jsonToCatalog, catalogToPo, poToCatalog,
  catalogToXlsx, xlsxToCatalog, cueLabel,
} from "../src/index.js";
import type { LocCatalog, ScriptElement } from "../src/index.js";
import { PLAYABLE_RUNTIME_JS } from "../src/playable-runtime.js";

/** TAM speaks plainly, then off-screen, then over the radio (a renamed default), then through a qualifier the
 *  list no longer has (left out with `stray: false`, as a project that builds). One voiced character throughout. */
function makeProject(stray = true): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-qual-"));
  for (const d of ["scenes", "loc/en", "loc/fr"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "q", name: "Qualified" },
    locales: { default: "en", all: ["en", "fr"] }, voiced: true,
    cast: [{ name: "TAM", actor: "Jo", gender: "male" }],
    qualifiers: [{ gameId: "vo", name: "V.O." }, { gameId: "os", name: "O.S." }, { gameId: "radio", name: "Radio" }],
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Night", blocks: [
      { id: "b1", type: "block", name: "Door", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "TAM" },
          { id: "L2", kind: "line", character: "TAM", qualifier: "os", direction: "muffled" },
          { id: "L3", kind: "line", character: "TAM", qualifier: "radio" },
          ...(stray ? [{ id: "L4", kind: "line", character: "TAM", qualifier: "phone" }] : []),
        ] },
      ] },
    ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { L1: "Who's there?", L2: "Open up.", L3: "Base, come in.", L4: "Hello?" } });
  return dir;
}

const dir = makeProject();
const loaded = loadProject(dir);
const lines = (els: ScriptElement[]) => els.filter((e): e is Extract<ScriptElement, { kind: "line" }> => e.kind === "line");

describe("cueLabel", () => {
  it("prints the qualifier's name after the character, in brackets, upper case as every cue is", () => {
    expect(cueLabel("Tam")).toBe("TAM");
    expect(cueLabel("Tam", "O.S.")).toBe("TAM (O.S.)");
    expect(cueLabel("TAM", "Radio")).toBe("TAM (RADIO)");
  });
});

describe("screenplay export", () => {
  const doc = runScriptDoc(loaded);

  it("carries each line's qualifier by gameId and shown name; the character stays the character", () => {
    expect(lines(doc.elements).map((l) => [l.character, l.qualifier, l.qualifierName])).toEqual([
      ["TAM", undefined, undefined], ["TAM", "os", "O.S."], ["TAM", "radio", "Radio"], ["TAM", "phone", "phone"], // a gameId the list lacks shows as itself
    ]);
  });

  it("the .docx prints the cue as TAM (O.S.), before the direction", async () => {
    const xml = await (await JSZip.loadAsync(await scriptToDocx(doc))).file("word/document.xml")!.async("string");
    expect(xml).toContain(">TAM (O.S.)<");
    expect(xml).toContain(">TAM (RADIO)<");
    expect(xml).not.toContain("TAM (V.O.)"); // no line uses it
    expect(xml.indexOf(">TAM (O.S.)<")).toBeLessThan(xml.indexOf("(muffled)"));
  });

  it("the .pdf still renders", async () => {
    expect((await scriptToPdf(doc)).subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("voice script export", () => {
  it("gives each line its qualifier's shown name, under the one character and actor", () => {
    const vs = runVoiceScript(loaded, { everything: true });
    expect(vs.lines.map((l) => [l.character, l.actor, l.qualifier])).toEqual([
      ["TAM", "Jo", undefined], ["TAM", "Jo", "O.S."], ["TAM", "Jo", "Radio"], ["TAM", "Jo", "phone"],
    ]);
  });

  it("the spreadsheet has a Qualifier column beside Character", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await voiceScriptToXlsx(runVoiceScript(loaded, { everything: true })) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Voice Script")!;
    const header = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header).toEqual(["Scope", "Line ID", "Character", "Qualifier", "Actor", "Text", "Comments", "Status"]);
    expect(String(ws.getRow(3).getCell(3).value)).toBe("TAM");
    expect(String(ws.getRow(3).getCell(4).value)).toBe("O.S.");
    expect(ws.getRow(2).getCell(4).value ?? "").toBe("");
  });

  it("the report counts TAM once, whatever the qualifier", () => {
    const report = runReport(loaded);
    expect(report.characters.map((c) => c.character)).toEqual(["TAM"]);
    expect(report.characters[0]!.lines).toBe(4);
  });
});

describe("playthrough and playable HTML", () => {
  it("the CLI transcript shows the qualifier after the name", () => {
    const out = renderPlay(runPlay(loaded));
    expect(out.slice(0, 4)).toEqual(["TAM: Who's there?", "TAM (O.S.): Open up.", "TAM (Radio): Base, come in.", "TAM (phone): Hello?"]);
  });

  it("the player page appends the qualifier to the name", () => {
    const html = runExportHtml(loadProject(makeProject(false)));
    expect(html).toContain("s.qualifierName || s.qualifier");
  });

  it("the inlined runtime snapshot carries the qualifier on a line step", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${PLAYABLE_RUNTIME_JS};this.Patterplay=Patterplay;`, sandbox);
    const { Engine } = sandbox.Patterplay as { Engine: new (b: unknown) => { openFlow(n: string, o: unknown): { advance(): Record<string, unknown> } } };
    const flow = new Engine(runExportFull(loaded)).openFlow("main", { scene: "s1" });
    flow.advance();
    expect(flow.advance()).toMatchObject({ type: "line", character: "TAM", qualifier: "os", qualifierName: "O.S." });
  });
});

describe("localisation formats", () => {
  const catalog = extractLoc(loaded, { locale: "fr" });
  const byId = (c: LocCatalog) => Object.fromEntries(c.entries.map((e) => [e.id, e]));

  it("a line carries its qualifier's shown name as context; the qualifier is never the line's text", () => {
    const e = byId(catalog);
    expect(e["L2"]!.context).toEqual({ character: "TAM", kind: "line", gender: "male", qualifier: "O.S." });
    expect(e["L1"]!.context).toEqual({ character: "TAM", kind: "line", gender: "male" });
    expect(e["L2"]!.source).toBe("Open up.");
    expect(e["qualifier:os"]).toMatchObject({ scene: "@project", source: "O.S.", translation: "" });
    expect(e["qualifier:vo"]).toBeUndefined(); // no line uses it
  });

  it("PO shows the qualifier in the speaker context, as the cue has it", () => {
    const po = catalogToPo(catalog);
    expect(po).toContain("#. [line TAM (O.S.)]");
    expect(po).toContain("#. [line TAM]");
    expect(po).toContain("#. [qualifier]");
  });

  it("the spreadsheet shows it in a Qualifier column, after the hidden Scene", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await catalogToXlsx(catalog) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("s1")!;
    let l2: string | undefined;
    ws.eachRow((row, n) => { if (n > 1 && String(row.getCell(1).value) === "L2") l2 = String(row.getCell(8).value); });
    expect(String(ws.getRow(1).getCell(8).value)).toBe("Qualifier");
    expect(l2).toBe("O.S.");
  });

  it("a translated qualifier name round-trips through JSON, PO, and Excel into the project strings", async () => {
    const translated: LocCatalog = { ...catalog, entries: catalog.entries.map((e) =>
      e.id === "qualifier:os" ? { ...e, translation: "H.C." } : e.id === "qualifier:radio" ? { ...e, translation: "Radio (FR)" } : e) };
    const viaJson = jsonToCatalog(catalogToJson(translated));
    const viaPo = poToCatalog(catalogToPo(translated));
    const viaXlsx = { ...(await xlsxToCatalog(await catalogToXlsx(translated))), locale: "fr" };
    for (const back of [viaJson, viaPo, viaXlsx]) {
      expect(byId(back)["qualifier:os"]).toMatchObject({ scene: "@project", translation: "H.C." });
    }

    const work = makeProject(false);
    applyWrites(applyLoc(loadProject(work), viaPo, { now: "2026-10-10T00:00:00Z" }).writes);
    const again = loadProject(work);
    expect(byId(extractLoc(again, { locale: "fr" }))["qualifier:os"]!.translation).toBe("H.C.");
    // ...and the runtime shows it in French.
    const bundle = runExportFull(again);
    const { Engine } = await import("@patterkit/runtime");
    const flow = new Engine(bundle, { locale: "fr" }).openFlow("main", { scene: "s1" });
    flow.advance();
    expect(flow.advance()).toMatchObject({ qualifier: "os", qualifierName: "H.C." });
  });
});
