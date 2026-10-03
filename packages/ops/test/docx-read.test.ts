// ---------------------------------------------------------------------------
// Reading an editable script back (docx-read.ts). Each case starts from a real export of the tavern
// fixture and edits its document.xml the way Word or Google Docs would write the change: tracked edits by
// two people, an untracked edit, a marker caught in a deletion, a deleted row, a move between boxes, a
// formatting-only change, comments and a reply, an Enter in a box, boxes merged into one table, colour.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { loadProject, exportEditableScript, readEditableDocx } from "../src/index.js";
import type { ReadBox, ReturnedDoc } from "../src/index.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const exported = await exportEditableScript(loadProject(fixture), { by: "Ian", now: "2026-10-03T12:00:00Z", random: seeded(11) });
const lines = exported.handoff.lines;
const codeOf = (beatId: string): string => Object.entries(lines).find(([, l]) => l.id === beatId)![0];
const GREET = codeOf("L_greet");      // "What'll it be, stranger?"
const WORK = codeOf("L_work");

/** The export with `document.xml` rewritten, and optionally extra parts added. */
async function edited(edit: (xml: string) => string, extra: Record<string, string> = {}): Promise<ReturnedDoc> {
  const zip = await JSZip.loadAsync(exported.docx);
  zip.file("word/document.xml", edit(await zip.file("word/document.xml")!.async("string")));
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return readEditableDocx(await zip.generateAsync({ type: "nodebuffer" }));
}

/** The `<w:tbl>` holding a marker, as [start, end] offsets. */
function tableSpan(xml: string, code: string): [number, number] {
  const at = xml.indexOf(`[#${code}]`);
  const start = xml.lastIndexOf("<w:tbl>", at);
  return [start, xml.indexOf("</w:tbl>", at) + "</w:tbl>".length];
}
/** The n-th `<w:tc>` (0 lead, 1 words, 2 margin) inside a marker's table, as [start, end]. */
function cellSpan(xml: string, code: string, n: number): [number, number] {
  const [t0] = tableSpan(xml, code);
  let at = t0;
  for (let i = 0; i <= n; i++) at = xml.indexOf("<w:tc>", at + 1);
  return [at, xml.indexOf("</w:tc>", at) + "</w:tc>".length];
}
/** Replace the paragraph content of a marker's words cell with `runs` (keeping the cell's properties). */
function setWords(xml: string, code: string, paragraphs: string): string {
  const [c0, c1] = cellSpan(xml, code, 1);
  const cell = xml.slice(c0, c1);
  const props = cell.slice(0, cell.indexOf("</w:tcPr>") + "</w:tcPr>".length);
  return xml.slice(0, c0) + props + paragraphs + "</w:tc>" + xml.slice(c1);
}
const r = (text: string, rPr = ""): string => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const ins = (author: string, text: string): string => `<w:ins w:id="${Math.floor(Math.random() * 1e6)}" w:author="${author}" w:date="2026-10-04T09:00:00Z">${r(text)}</w:ins>`;
const del = (author: string, text: string): string => `<w:del w:id="${Math.floor(Math.random() * 1e6)}" w:author="${author}" w:date="2026-10-04T10:00:00Z"><w:r><w:delText xml:space="preserve">${text}</w:delText></w:r></w:del>`;
const box = (doc: ReturnedDoc, code: string): ReadBox => doc.items.find((i): i is ReadBox => i.kind === "box" && i.marker?.code === code)!;

describe("readEditableDocx", () => {
  it("reads an untouched export: the handoff id, every box by its marker, and each line's text as sent", async () => {
    const doc = await readEditableDocx(exported.docx);
    expect(doc.handoffId).toBe(exported.handoff.id);
    const boxes = doc.items.filter((i): i is ReadBox => i.kind === "box");
    expect(boxes.map((b) => b.marker!.code)).toEqual(Object.keys(lines));
    for (const b of boxes) {
      expect(b.marker!.valid).toBe(true);
      expect(b.text.proposed).toBe(lines[b.marker!.code]!.baseline);
      expect(b.text.original).toBe(b.text.proposed);
      expect(b.text.changes).toEqual([]);
    }
    expect(box(doc, GREET).lead.proposed).toBe("BARKEEP");
  });

  it("tracked changes by two people: the proposed and original views, and who made each", async () => {
    const doc = await edited((x) => setWords(x, GREET,
      `<w:p>${r("What'll it be, ")}${del("Sam", "stranger")}${ins("Sam", "friend")}${r("?")}${ins("Jo", " Quickly.")}</w:p>`));
    const b = box(doc, GREET);
    expect(b.text.proposed).toBe("What'll it be, friend? Quickly.");
    expect(b.text.original).toBe("What'll it be, stranger?");
    expect(b.text.changes.map((c) => [c.kind, c.author, c.text])).toEqual([["delete", "Sam", "stranger"], ["insert", "Sam", "friend"], ["insert", "Jo", " Quickly."]]);
  });

  it("an untracked edit shows in both views alike, so it is told apart from a tracked one", async () => {
    const b = box(await edited((x) => setWords(x, GREET, `<w:p>${r("What'll it be, love?")}</w:p>`)), GREET);
    expect(b.text.proposed).toBe("What'll it be, love?");
    expect(b.text.original).toBe("What'll it be, love?");
  });

  it("recovers a marker the editor deleted with tracking on", async () => {
    const doc = await edited((x) => {
      const [c0, c1] = cellSpan(x, GREET, 2);
      const cell = x.slice(c0, c1).replace(/<w:r>(?:(?!<w:r>).)*?\[#[^\]]+\]<\/w:t><\/w:r>/s, del("Sam", `[#${GREET}]`));
      return x.slice(0, c0) + cell + x.slice(c1);
    });
    expect(box(doc, GREET).marker).toEqual({ code: GREET, valid: true, recovered: true });
  });

  it("notices a whole row deleted with tracking on", async () => {
    const doc = await edited((x) => {
      const [t0] = tableSpan(x, GREET);
      const tr = x.indexOf("<w:tr>", t0);
      const trPr = x.indexOf("<w:trPr>", tr);
      return x.slice(0, trPr + "<w:trPr>".length) + `<w:del w:id="9" w:author="Sam" w:date="2026-10-04T09:00:00Z"/>` + x.slice(trPr + "<w:trPr>".length);
    });
    expect(box(doc, GREET).rowDeleted).toBe(true);
  });

  it("a move between two boxes reads as a deletion in one and an insertion in the other", async () => {
    const doc = await edited((x) => {
      const mv = (kind: "moveFrom" | "moveTo", text: string) => kind === "moveFrom"
        ? `<w:moveFrom w:id="1" w:author="Sam" w:date="2026-10-04T09:00:00Z"><w:r><w:delText>${text}</w:delText></w:r></w:moveFrom>`
        : `<w:moveTo w:id="2" w:author="Sam" w:date="2026-10-04T09:00:00Z">${r(text)}</w:moveTo>`;
      x = setWords(x, GREET, `<w:p>${r("What'll it be")}${mv("moveFrom", ", stranger?")}</w:p>`);
      return setWords(x, WORK, `<w:p>${r(lines[WORK]!.baseline)}${mv("moveTo", " Stranger?")}</w:p>`);
    });
    expect(box(doc, GREET).text).toMatchObject({ proposed: "What'll it be", original: "What'll it be, stranger?" });
    expect(box(doc, WORK).text.proposed).toBe(`${lines[WORK]!.baseline} Stranger?`);
    expect(box(doc, WORK).text.changes[0]).toMatchObject({ kind: "moveTo", author: "Sam" });
  });

  it("bold and italic come back as markup; a formatting-only change is no text change; colour is counted", async () => {
    const doc = await edited((x) => setWords(x, GREET,
      `<w:p>${r("What'll it be, ")}${r("stranger", `<w:b/><w:rPrChange w:id="5" w:author="Sam" w:date="2026-10-04T09:00:00Z"><w:rPr/></w:rPrChange>`)}${r("?", '<w:color w:val="FF0000"/>')}</w:p>`));
    const b = box(doc, GREET);
    expect(b.text.proposed).toBe("What'll it be, <b>stranger</b>?");
    expect(b.text.original).toBe(b.text.proposed);
    expect(b.text.droppedFormatting).toBe(1);
  });

  it("the exporter's own colours and box fill, which Google Docs copies onto every run, aren't counted as an editor's", async () => {
    const own = `<w:color w:val="3A352D"/><w:shd w:fill="f7f2e8" w:val="clear"/><w:u w:val="none"/>`;
    const b = box(await edited((x) => setWords(x, GREET, `<w:p>${r("What'll it be, stranger?", own)}</w:p>`)), GREET);
    expect(b.text.droppedFormatting).toBe(0);
    const highlighted = box(await edited((x) => setWords(x, GREET, `<w:p>${r("What'll it be, stranger?", `<w:highlight w:val="yellow"/>`)}</w:p>`)), GREET);
    expect(highlighted.text.droppedFormatting).toBe(1);
  });

  it("an Enter inside a box joins with a space, and the paragraph count says it happened", async () => {
    const b = box(await edited((x) => setWords(x, GREET, `<w:p>${r("What'll it be,")}</w:p><w:p>${r("stranger?")}</w:p>`)), GREET);
    expect(b.text.proposed).toBe("What'll it be, stranger?");
    expect(b.paragraphs).toBe(2);
  });

  it("still reads each box when a tool merged neighbouring tables into one", async () => {
    // Drop every spacer, then merge each pair of touching tables into one table of several rows.
    const doc = await edited((x) => x
      .replace(/<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"\/><\/w:pPr>.*?<\/w:p>/gs, "")
      .replace(/<\/w:tbl>\s*<w:tbl>.*?<\/w:tblGrid>/gs, ""));
    const boxes = doc.items.filter((i): i is ReadBox => i.kind === "box");
    expect(boxes.map((b) => b.marker!.code).sort()).toEqual(Object.keys(lines).sort());
  });

  it("reads comments with their author, where they start, and a reply under its parent", async () => {
    const doc = await edited(
      (x) => {
        x = setWords(x, GREET, `<w:p><w:commentRangeStart w:id="0"/>${r("What'll it be, stranger?")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`);
        return x.replace("‹ if", "<w:commentRangeStart w:id=\"2\"/>‹ if");
      },
      {
        "word/comments.xml": `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">`
          + `<w:comment w:id="0" w:author="Sam" w:date="2026-10-04T09:00:00Z"><w:p w14:paraId="00000001">${r("Too warm?")}</w:p></w:comment>`
          + `<w:comment w:id="1" w:author="Ian" w:date="2026-10-04T11:00:00Z"><w:p w14:paraId="00000002">${r("Agreed.")}</w:p></w:comment>`
          + `<w:comment w:id="2" w:author="Sam"><w:p w14:paraId="00000003">${r("Cheap?")}</w:p></w:comment></w:comments>`,
        "word/commentsExtended.xml": `<?xml version="1.0" encoding="UTF-8"?><w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">`
          + `<w15:commentEx w15:paraId="00000001" w15:done="0"/><w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/></w15:commentsEx>`,
      });
    expect(doc.comments).toEqual([
      { id: "0", author: "Sam", date: "2026-10-04T09:00:00Z", text: "Too warm?", replies: [{ author: "Ian", date: "2026-10-04T11:00:00Z", text: "Agreed." }] },
      { id: "2", author: "Sam", text: "Cheap?", replies: [] },
    ]);
    expect(box(doc, GREET).text.comments).toEqual(["0"]);
  });

  it("reads a real export that went through Google Docs (uploaded, converted, downloaded as .docx)", async () => {
    // The tour example's editable script (76 lines, handoff H-KGBY), converted by Google Docs and saved back
    // out; Google's embedded fonts were stripped to keep the fixture small. Google rewrites every run and
    // bookmark, merges nothing here (the spacers hold), and copies the script's own inks onto each run.
    const doc = await readEditableDocx(readFileSync(fileURLToPath(new URL("./fixture/editable/tour-from-google-docs.docx", import.meta.url))));
    expect(doc.handoffId).toBe("H-KGBY");
    const boxes = doc.items.filter((i): i is ReadBox => i.kind === "box");
    expect(boxes).toHaveLength(76);
    expect(boxes.every((b) => b.marker?.valid && !b.marker.recovered)).toBe(true);
    expect(boxes.every((b) => b.text.proposed === b.text.original && b.text.changes.length === 0)).toBe(true);
    expect(boxes.reduce((n, b) => n + b.text.droppedFormatting, 0)).toBe(0);
  });

  it("refuses something that isn't a Word document", async () => {
    const zip = new JSZip(); zip.file("hello.txt", "hi");
    await expect(readEditableDocx(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow(/not a Word document/);
  });
});

