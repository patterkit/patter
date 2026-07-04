// ---------------------------------------------------------------------------
// The producer-facing spreadsheet view of ReportData (spec §13: "the default
// report artifact is a polished .xlsx... openable with ZERO Patter tooling").
// A renderer only - all numbers come from report.ts's one engine. Sheets:
// Scenes (voiced + written + burndown), Characters, Localisation, Plan.
// ---------------------------------------------------------------------------

import type { ReportData, SceneReport, ReportTotals } from "./report.js";

/** Render the report as an .xlsx workbook. */
export async function runReportXlsx(data: ReportData): Promise<Buffer> {
  // Lazy: exceljs is heavy and only the report path needs it.
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "patter";

  // Voiced-only columns (the voiced line counts + ready-to-record/ship) are dropped for a TEXT-ONLY project;
  // the recording-status breakdown columns need audio-status tracking (#206), a narrower gate. exceljs ignores
  // row-object keys with no matching column, so gating the column lists alone is enough; row builders untouched.
  const v = data.voiced;
  const rec = data.recordingTracked;

  // --- Scenes ---------------------------------------------------------------
  const scenes = wb.addWorksheet("Scenes");
  scenes.columns = [
    { header: "Scene", key: "name", width: 24 },
    { header: "Status", key: "status", width: 10 },
    ...(v ? [{ header: "Voiced", key: "vCount", width: 8 }] : []),
    { header: "Written", key: "wCount", width: 8 },
    { header: "Words", key: "words", width: 9 },
    { header: "Choices", key: "choices", width: 8 },
    ...data.writingLadder.map((s) => ({ header: s, key: `w:${s}`, width: 10 })),
    ...(v ? [{ header: "Ready record", key: "rr", width: 12 }, { header: "Ready ship", key: "rs", width: 11 }] : []),
    ...(rec ? data.recordingLadder.map((s) => ({ header: `rec ${s}`, key: `r:${s}`, width: 10 })) : []),
    ...(data.estimating ? [{ header: "Estimate", key: "estimate", width: 9 }] : []),
    { header: "Written left", key: "wRem", width: 11 },
    ...(v ? [{ header: "Voiced left", key: "vRem", width: 11 }] : []),
  ];
  const sceneRow = (name: string, s: Pick<SceneReport, "voiced" | "written" | "choices" | "writtenRemaining" | "voicedRemaining"> & { estimate?: number; status?: string }) => ({
    name, status: s.status,
    vCount: s.voiced.count, wCount: s.written.count, words: s.written.words, choices: s.choices,
    ...Object.fromEntries(data.writingLadder.map((k) => [`w:${k}`, s.written.byWriting[k] ?? 0])),
    rr: s.voiced.readyToRecord, rs: s.voiced.readyToShip,
    ...Object.fromEntries(data.recordingLadder.map((k) => [`r:${k}`, s.voiced.byRecording[k] ?? 0])),
    estimate: s.estimate, wRem: s.writtenRemaining, vRem: s.voicedRemaining,
  });
  for (const s of data.scenes) scenes.addRow(sceneRow(s.name, s));
  const totals: ReportTotals = data.totals;
  const totalRow = scenes.addRow(sceneRow("TOTAL", totals));
  totalRow.font = { bold: true };
  scenes.getRow(1).font = { bold: true };

  // --- Characters -----------------------------------------------------------
  const chars = wb.addWorksheet("Characters");
  chars.columns = [
    { header: "Character", key: "character", width: 20 },
    { header: "Lines", key: "lines", width: 8 },
    ...(data.estimating ? [{ header: "Est. lines", key: "estLines", width: 9 }] : []),
    { header: "Words", key: "words", width: 9 },
    ...(rec ? data.recordingLadder.map((s) => ({ header: `rec ${s}`, key: `r:${s}`, width: 10 })) : []),
  ];
  for (const c of data.characters) {
    chars.addRow({ character: c.character, lines: c.lines, estLines: c.estimatedLines, words: c.words,
      ...Object.fromEntries(data.recordingLadder.map((k) => [`r:${k}`, c.recording[k] ?? 0])) });
  }
  chars.getRow(1).font = { bold: true };

  // --- Localisation ---------------------------------------------------------
  if (data.locales.length > 0) {
    const loc = wb.addWorksheet("Localisation");
    loc.columns = [
      { header: "Locale", key: "locale", width: 10 },
      { header: "Translated", key: "translated", width: 11 },
      { header: "Missing", key: "missing", width: 9 },
      { header: "Stale", key: "stale", width: 8 },
      { header: "Words", key: "words", width: 9 },
    ];
    for (const l of data.locales) loc.addRow(l);
    loc.getRow(1).font = { bold: true };
  }

  // --- Estimates (only when Estimating is on) -------------------------------
  if (data.estimating && data.coverage.estimated > 0) {
    const plan = wb.addWorksheet("Estimates");
    plan.columns = [
      { header: "Scene", key: "name", width: 24 },
      { header: "Est. written", key: "written", width: 12 },
      ...(v ? [{ header: "Est. voiced", key: "voiced", width: 11 }] : []),
    ];
    for (const s of data.scenes) if (s.estimated) plan.addRow({ name: s.name, written: s.estimate, voiced: s.voicedRemaining });
    const coverageRow = plan.addRow({ name: `coverage: ${data.coverage.estimated}/${data.coverage.totalScenes} scenes estimated` });
    coverageRow.font = { italic: true };
    plan.getRow(1).font = { bold: true };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
