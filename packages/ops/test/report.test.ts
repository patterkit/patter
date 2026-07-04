// ---------------------------------------------------------------------------
// The report op (spec §13): voiced vs written line populations, status against
// the ladders (untracked = "stub"), SCENE status (lowest beat), ESTIMATING (an
// all-guesswork scene's actuals replaced by a tag-or-default estimate, shared
// across its characters by largest remainder), cut exclusion, and the
// localisation staleness sheet. Plus the xlsx renderer carrying the same numbers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { loadProject, runValidate, runReport, runReportXlsx, renderReportText } from "../src/index.js";

/** A voiced project with one started scene, two all-stub (estimatable) scenes, and a cut scene. */
function makeProject(voiced = true, estimating = true): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-report-"));
  for (const d of ["scenes", "loc/en", "loc/fr", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "rep", name: "Report Game" },
    locales: { default: "en", all: ["en", "fr"] },
    ...(voiced ? { voiced: true } : {}),
    cast: [{ name: "ANNA" }, { name: "BO" }],
    // Estimating: threshold omitted (= lowest rung, "stub"); default 20 lines; two tags, largest wins.
    estimating: { enabled: estimating, defaultLines: 20, tagEstimates: [{ tag: "cutscene", lines: 5 }, { tag: "big", lines: 10 }] },
  });

  // s1 Opening: started (L1 final, L2 draft 1; T1 + CT1 untracked = stub) -> NOT estimated, status "stub".
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Opening", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" },
          { id: "L2", kind: "line", character: "BO" },
          { id: "T1", kind: "text" },
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [{ id: "o1_c", type: "snippet", jump: { to: "END" } }] },
        ] },
      ] },
    ] } });
  // s2 Stub A: ANNAx2 + BOx1 + narration, all stub -> estimated at the DEFAULT (20); proportional shares.
  w("scenes/two.patterflow", { schema: "patter/flow@0", scene: {
    id: "s2", type: "scene", name: "Stub A", blocks: [
      { id: "b2", type: "block", name: "Main", children: [
        { id: "n2", type: "snippet", beats: [
          { id: "L2a", kind: "line", character: "ANNA" },
          { id: "L2b", kind: "line", character: "ANNA" },
          { id: "L2c", kind: "line", character: "BO" },
          { id: "T2", kind: "text" },
        ], jump: { to: "END" } },
      ] },
    ] } });
  // s4 Cutscene: tagged [cutscene, big] -> estimated at the LARGEST tag (10); ANNAx2 + BOx1 -> largest remainder.
  w("scenes/four.patterflow", { schema: "patter/flow@0", scene: {
    id: "s4", type: "scene", name: "Cutscene", tags: ["cutscene", "big"], blocks: [
      { id: "b4", type: "block", name: "Main", children: [
        { id: "n4", type: "snippet", beats: [
          { id: "L4a", kind: "line", character: "ANNA" },
          { id: "L4b", kind: "line", character: "ANNA" },
          { id: "L4c", kind: "line", character: "BO" },
        ], jump: { to: "END" } },
      ] },
    ] } });
  // s3 Cut: excluded from everything, surfaced as cut.
  w("scenes/three.patterflow", { schema: "patter/flow@0", scene: {
    id: "s3", type: "scene", name: "Cut Scene", blocks: [
      { id: "b3", type: "block", name: "Main", children: [
        { id: "n3", type: "snippet", beats: [{ id: "L3", kind: "line", character: "BO" }], jump: { to: "END" } },
      ] },
    ] } });

  // s1 strings are 3 words each -> avg 3 words/line, which estimated scenes derive their word counts from.
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: {
      L1: "one two three", L2: "one two three", T1: "one two three", CT1: "one two three",
      L2a: "p", L2b: "p", L2c: "p", T2: "p", L4a: "p", L4b: "p", L4c: "p", L3: "cut line here",
    } });
  w("loc/fr/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "fr",
    strings: { L1: "un deux trois" } }); // only L1, and stale

  w("authoring/statuses.patterx", { schema: "patter/authoring@0",
    writing: { L1: "final", L2: "draft 1" },
    recording: { L1: "recorded" },
    cut: { s3: true },
    edits: { L1: { modifiedAt: "2026-02-01T00:00:00Z", localisedAt: { fr: "2026-01-01T00:00:00Z" } } } });
  return dir;
}

const loaded = loadProject(makeProject());
const data = runReport(loaded);

describe("runReport", () => {
  it("validates clean (statuses are ladder members, estimating config is sane, ids live)", () => {
    expect(runValidate(loaded).ok).toBe(true);
  });

  it("excludes the cut scene from the scene list and surfaces it separately", () => {
    expect(data.scenes.map((s) => s.sceneId).sort()).toEqual(["s1", "s2", "s4"]);
    expect(data.cut).toEqual({ scenes: 1, voicedLines: 1, writtenLines: 1 });
  });

  it("splits voiced (line beats) from written (line+text+labels) on a real scene", () => {
    const s1 = data.scenes.find((s) => s.sceneId === "s1")!;
    expect(s1.voiced.count).toBe(2);          // L1, L2
    expect(s1.written.count).toBe(4);          // + T1 + CT1 label
    expect(s1.written.words).toBe(12);         // 4 beats x 3 words
    expect(s1.voiced.words).toBe(6);           // L1 + L2
  });

  it("a scene's status is its LOWEST-rung beat; the tally counts scenes by status", () => {
    expect(data.scenes.find((s) => s.sceneId === "s1")!.status).toBe("stub"); // T1/CT1 untracked = stub is the floor
    expect(data.scenesByStatus).toMatchObject({ stub: 3, "draft 1": 0, final: 0 });
  });

  it("a started scene uses real counts; remaining = its stub beats; not estimated", () => {
    const s1 = data.scenes.find((s) => s.sceneId === "s1")!;
    expect(s1.estimated).toBe(false);
    expect(s1.estimate).toBeUndefined();
    expect(s1).toMatchObject({ writtenDone: 2, writtenRemaining: 2, voicedDone: 2, voicedRemaining: 0 });
  });

  it("an all-stub scene is estimated at the default; the estimate is proportionally shared, narration unattributed", () => {
    const s2 = data.scenes.find((s) => s.sceneId === "s2")!;
    expect(s2.estimated).toBe(true);
    expect(s2.estimate).toBe(20);            // default (untagged)
    expect(s2.writtenDone).toBe(0);
    expect(s2.writtenRemaining).toBe(20);    // the whole estimate is to-write
    expect(s2.voicedRemaining).toBe(15);     // ANNA 10 + BO 5 (narration's 5 is unattributed, not voiced)
    expect(s2.written.words).toBe(60);       // derived: 20 lines x avg 3 words
    expect(s2.voiced.words).toBe(45);        // 15 voiced x 3
  });

  it("a tagged scene uses the LARGEST matching tag, shared by LARGEST REMAINDER", () => {
    const s4 = data.scenes.find((s) => s.sceneId === "s4")!;
    expect(s4.estimate).toBe(10);            // max(cutscene 5, big 10)
    expect(s4.voicedRemaining).toBe(10);     // no narration -> all voiced
    // ANNA weight 2, BO weight 1 of 10: ideals 6.67 / 3.33 -> floors 6/3, the leftover unit goes to ANNA's larger frac.
    const anna = data.characters.find((c) => c.character === "ANNA")!;
    const bo = data.characters.find((c) => c.character === "BO")!;
    // ANNA estimated = 10 (s2) + 7 (s4) = 17; BO = 5 + 3 = 8. Actual lines are only the real (non-estimated) scene.
    expect(anna).toMatchObject({ lines: 1, estimatedLines: 17 }); // L1 real; rest are estimated placeholders
    expect(bo).toMatchObject({ lines: 1, estimatedLines: 8 });    // L2 real
  });

  it("totals project done + remaining across real and estimated scenes; coverage is honest", () => {
    expect(data.estimating).toBe(true);
    expect(data.coverage).toEqual({ totalScenes: 3, estimated: 2 });
    expect(data.totals.projectedWritten).toBe(2 + 2 + 20 + 10);   // s1 done 2 + s1 stub 2 + s2 est 20 + s4 est 10
    expect(data.totals.projectedVoiced).toBe(2 + 0 + 15 + 10);    // s1 done 2 + s2 15 + s4 10
    // Actual writing-status breakdown counts only real (non-estimated) beats: just s1.
    expect(data.totals.written.byWriting).toMatchObject({ stub: 2, "draft 1": 1, final: 1 });
  });

  it("localisation: translated / missing / stale over every non-cut written-line id (placeholders included)", () => {
    const fr = data.locales.find((l) => l.locale === "fr")!;
    expect(fr.translated).toBe(1);   // only L1
    expect(fr.missing).toBe(10);     // the other 10 non-cut ids (L4 cut ids excluded)
    expect(fr.stale).toBe(1);        // L1 source modified after its fr localisation
  });
});

describe("estimating OFF", () => {
  const off = runReport(loadProject(makeProject(true, false)));
  it("shows pure actuals: no scene is estimated, stub beats are the remaining", () => {
    expect(off.estimating).toBe(false);
    expect(off.scenes.every((s) => !s.estimated)).toBe(true);
    const s2 = off.scenes.find((s) => s.sceneId === "s2")!;
    expect(s2.estimate).toBeUndefined();
    expect(s2.writtenRemaining).toBe(4); // its 4 stub placeholder beats, counted literally
    expect(off.characters.find((c) => c.character === "ANNA")!.estimatedLines).toBe(0);
  });
});

describe("runReportXlsx", () => {
  it("produces Scenes / Characters / Localisation / Estimates sheets with the engine's numbers", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await runReportXlsx(data) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((x) => x.name)).toEqual(["Scenes", "Characters", "Localisation", "Estimates"]);
    const scenes = wb.getWorksheet("Scenes")!;
    const sceneHeaders = (scenes.getRow(1).values as string[]).filter(Boolean);
    expect(sceneHeaders).toContain("Status");
    expect(sceneHeaders).toContain("Estimate");
    // The Opening row carries its scene status "stub" in the Status column (scene order follows filename).
    const openingRow = scenes.getSheetValues().find((r) => Array.isArray(r) && r[1] === "Opening") as unknown[];
    expect(openingRow[2]).toBe("stub");
    const charHeaders = (wb.getWorksheet("Characters")!.getRow(1).values as string[]).filter(Boolean);
    expect(charHeaders).toContain("Est. lines");
  });
});

describe("a TEXT-ONLY (un-voiced) project omits all recording detail (#206)", () => {
  const textOnly = runReport(loadProject(makeProject(false)));

  it("the report data carries voiced=false", () => {
    expect(textOnly.voiced).toBe(false);
  });

  it("the console report drops the voiced-line + recording lines but keeps scene status", () => {
    const text = renderReportText(textOnly).join("\n");
    expect(text).toContain("written lines:");
    expect(text).toContain("scene status:");
    expect(text).not.toMatch(/voiced lines:/);
    expect(text).not.toMatch(/ready to record:/);
    expect(text).not.toMatch(/^recording:/m);
  });

  it("the xlsx drops the Voiced + recording columns (Scenes + Characters)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await runReportXlsx(textOnly) as unknown as ArrayBuffer);
    const sceneHeaders = (wb.getWorksheet("Scenes")!.getRow(1).values as string[]).filter(Boolean);
    expect(sceneHeaders).not.toContain("Voiced");
    expect(sceneHeaders).not.toContain("Voiced left");
    expect(sceneHeaders.some((h) => h.startsWith("rec "))).toBe(false);
    const charHeaders = (wb.getWorksheet("Characters")!.getRow(1).values as string[]).filter(Boolean);
    expect(charHeaders.some((h) => h.startsWith("rec "))).toBe(false);
  });
});
