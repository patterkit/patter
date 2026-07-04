// The producer-facing spreadsheet view of a VoiceScript (spec §16): one sheet, one row per spoken line,
// with the scope trail + run-leading comments. exceljs is lazy-loaded (heavy), like report-xlsx / loc-xlsx.

import type { VoiceScript } from "./voice-script.js";

/** Render the VO script as an .xlsx workbook (a single "Voice Script" sheet). */
export async function voiceScriptToXlsx(data: VoiceScript): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "patter";

  const ws = wb.addWorksheet("Voice Script");
  ws.columns = [
    { header: "Scope", key: "scope", width: 28 },
    { header: "Line ID", key: "id", width: 18 },
    { header: "Character", key: "character", width: 16 },
    { header: "Actor", key: "actor", width: 16 },
    { header: "Text", key: "text", width: 60 },
    { header: "Comments", key: "comments", width: 36 },
    { header: "Status", key: "status", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const l of data.lines) {
    const row = ws.addRow({
      scope: l.scope, id: l.id, character: l.character, actor: l.actor ?? "",
      text: l.text, comments: l.comments.join("\n"), status: l.recordingStatus,
    });
    row.getCell("text").alignment = { wrapText: true, vertical: "top" };
    row.getCell("comments").alignment = { wrapText: true, vertical: "top" };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
