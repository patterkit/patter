// ---------------------------------------------------------------------------
// Bringing an editable script back (editable-import.ts), one case per rule in the design's tables
// (editable-script-handoff.md §6.1, §7). Each case: a fresh copy of the tavern, exported, its handoff
// record committed, the returned .docx edited the way Word or Google Docs would write the change, read,
// and planned.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { canonicalStringify, parseSource } from "@patterkit/core";
import type { AuthoringFile, LocaleFile } from "@patterkit/model";
import {
  loadProject, applyWrites, exportEditableScript, readEditableDocx, planEditableImport, readHandoff, handoffWrite,
} from "../src/index.js";
import type { ImportOptions, ImportPlan } from "../src/index.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));
const NOW = "2026-10-05T12:00:00.000Z";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** A fresh tavern (optionally with some strings changed first), exported, with its handoff committed. */
async function sent(strings: Record<string, string> = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-import-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  if (Object.keys(strings).length) setStrings(dir, strings);
  const out = await exportEditableScript(loadProject(dir), { by: "Ian", recipient: "Sam", now: "2026-10-03T12:00:00Z", random: seeded(3) });
  applyWrites(out.writes);
  const code = (beat: string): string => Object.entries(out.handoff.lines).find(([, l]) => l.id === beat)![0];
  return { dir, out, code };
}

function setStrings(dir: string, strings: Record<string, string>): void {
  const path = join(dir, "loc/en/tavern.patterloc");
  const loc = parseSource(readFileSync(path, "utf8")) as LocaleFile;
  writeFileSync(path, canonicalStringify({ ...loc, strings: { ...loc.strings, ...strings } }));
}

/** Return the export with `document.xml` edited (and extra parts), read, and planned. */
async function bringBack(s: Awaited<ReturnType<typeof sent>>, edit: (xml: string) => string = (x) => x, opts: Partial<ImportOptions> = {}, extra: Record<string, string> = {}): Promise<ImportPlan> {
  const zip = await JSZip.loadAsync(s.out.docx);
  zip.file("word/document.xml", edit(await zip.file("word/document.xml")!.async("string")));
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  const returned = await readEditableDocx(await zip.generateAsync({ type: "nodebuffer" }));
  return planEditableImport(loadProject(s.dir), returned, { by: "Ian", fileHash: "hash", now: NOW, random: seeded(9), ...opts });
}

// ---- XML editing, as in docx-read.test.ts ----
function tableSpan(xml: string, code: string): [number, number] {
  const at = xml.indexOf(`[#${code}]`);
  const start = xml.lastIndexOf("<w:tbl>", at);
  return [start, xml.indexOf("</w:tbl>", at) + "</w:tbl>".length];
}
function cellSpan(xml: string, code: string, n: number): [number, number] {
  const [t0] = tableSpan(xml, code);
  let at = t0;
  for (let i = 0; i <= n; i++) at = xml.indexOf("<w:tc>", at + 1);
  return [at, xml.indexOf("</w:tc>", at) + "</w:tc>".length];
}
function setCell(xml: string, code: string, n: number, paragraphs: string): string {
  const [c0, c1] = cellSpan(xml, code, n);
  const cell = xml.slice(c0, c1);
  const props = cell.slice(0, cell.indexOf("</w:tcPr>") + "</w:tcPr>".length);
  return xml.slice(0, c0) + props + paragraphs + "</w:tc>" + xml.slice(c1);
}
const setWords = (xml: string, code: string, paragraphs: string): string => setCell(xml, code, 1, paragraphs);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = (text: string): string => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (...runs: string[]): string => `<w:p>${runs.join("")}</w:p>`;
const ins = (author: string, text: string, date = "2026-10-04T09:00:00Z"): string => `<w:ins w:id="1" w:author="${author}" w:date="${date}">${r(text)}</w:ins>`;
const del = (author: string, text: string): string => `<w:del w:id="2" w:author="${author}" w:date="2026-10-04T08:00:00Z"><w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
const dropTable = (xml: string, code: string): string => { const [a, b] = tableSpan(xml, code); return xml.slice(0, a) + xml.slice(b); };

const GREET = "What'll it be, stranger?";
const problemsOf = (plan: ImportPlan, kind: string) => plan.report.problems.filter((x) => x.kind === kind);
const authoringOf = (dir: string): AuthoringFile => parseSource(readFileSync(join(dir, "authoring/tavern.patterx"), "utf8")) as AuthoringFile;

describe("planEditableImport: whose file is it (§7.1)", () => {
  it("an untouched file changes nothing, and the import is logged on the handoff", async () => {
    const s = await sent();
    const plan = await bringBack(s);
    expect(plan.report.refused).toBeUndefined();
    expect(plan.suggestions).toEqual([]);
    expect(plan.report.counts).toMatchObject({ changed: 0, unchanged: Object.keys(s.out.handoff.lines).length, problems: 0 });
    expect(plan.writes.map((w) => w.path.split("/").slice(-2).join("/"))).toEqual([`handoffs/${s.out.handoff.id}.json`]);
    applyWrites(plan.writes);
    expect(readHandoff(s.dir, s.out.handoff.id)!.imports).toEqual([{ at: NOW, by: "Ian", fileHash: "hash", counts: plan.report.counts }]);
  });

  it("refuses a file with no handoff id, and one from a handoff this project doesn't have", async () => {
    const s = await sent();
    const noId = await bringBack(s, (x) => x, {}, { "word/header1.xml": `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>` });
    // The front page still names it, so blank that too.
    const bare = await bringBack(s, (x) => x.replace(/Handoff H-[0-9A-Z]{4}/g, "Handoff"), {}, { "word/header1.xml": `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>` });
    expect(noId.report.refused).toBeUndefined(); // found on the front page instead
    expect(bare.report.refused).toMatch(/no handoff id/);
    const other = await bringBack(s, (x) => x.replace(new RegExp(s.out.handoff.id, "g"), "H-ZZZZ"), {}, { "word/header1.xml": `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p>${r("Handoff H-ZZZZ")}</w:p></w:hdr>` });
    expect(other.report.refused).toMatch(/isn't in this project/);
    expect(other.writes).toEqual([]);
  });

  it("refuses a file with more than a quarter of its lines missing", async () => {
    const s = await sent();
    const codes = Object.keys(s.out.handoff.lines);
    const plan = await bringBack(s, (x) => codes.slice(0, Math.ceil(codes.length / 3)).reduce(dropTable, x));
    expect(plan.report.refused).toMatch(/missing/);
    expect(plan.writes).toEqual([]);
  });
});

describe("planEditableImport: per line (§7.2, §6.1)", () => {
  it("a tracked change becomes a suggestion credited to its author, dated, and tied to the handoff", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("What'll it be, "), del("Jo", "stranger"), ins("Jo", "friend"), r("?"))));
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({
      anchor: "L_greet", baseline: GREET, proposed: "What'll it be, friend?", author: "Jo", ts: "2026-10-04T09:00:00Z",
      handoff: { id: s.out.handoff.id, marker: s.code("L_greet") },
    });
    expect(plan.suggestions[0]!.id).toMatch(/^sg_[a-z0-9]{8}$/);
    applyWrites(plan.writes);
    expect(authoringOf(s.dir).suggestions).toHaveLength(1);
  });

  it("a narration box (no speaker cell) is read and suggested like any other", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => setCell(x, s.code("T_scene"), 0, p(r("The tavern is dim and loud."))));
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ anchor: "T_scene", proposed: "The tavern is dim and loud." });
    expect(plan.suggestions[0]!.proposedCharacter).toBeUndefined();
  });

  it("an untracked change is credited to the 'Edits by' name, else the recipient", async () => {
    const s = await sent();
    const edit = (x: string) => setWords(x, s.code("L_greet"), p(r("What'll it be, love?")));
    expect((await bringBack(s, edit)).suggestions[0]!.author).toBe("Sam");
    expect((await bringBack(s, edit, { as: "Kit" })).suggestions[0]!.author).toBe("Kit");
  });

  it("several people's tracked changes: one suggestion, the most prolific first, all of them listed", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(del("Jo", "What'll"), ins("Jo", "What will"), r(" it be, stranger?"), ins("Kit", " Quick."))));
    expect(plan.suggestions[0]).toMatchObject({ author: "Jo", authors: ["Jo", "Kit"], proposed: "What will it be, stranger? Quick." });
  });

  it("tracked and untracked edits on one line: the suggestion, plus a note that the credit may be incomplete", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("So, what'll it be, "), del("Jo", "stranger"), ins("Jo", "friend"), r("?"))));
    expect(plan.suggestions[0]!.proposed).toBe("So, what'll it be, friend?");
    expect(problemsOf(plan, "untracked-edits")).toHaveLength(1);
  });

  it("an emptied box, or its row deleted with tracking on, is a cut suggestion, never empty text", async () => {
    const s = await sent();
    const emptied = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p()));
    expect(emptied.suggestions[0]).toMatchObject({ anchor: "L_greet", proposedCut: true, proposed: GREET, baseline: GREET });
    const rowGone = await bringBack(s, (x) => {
      const [t0] = tableSpan(x, s.code("L_greet"));
      const at = x.indexOf("<w:trPr>", t0) + "<w:trPr>".length;
      return x.slice(0, at) + `<w:del w:id="9" w:author="Jo" w:date="2026-10-04T09:00:00Z"/>` + x.slice(at);
    });
    expect(rowGone.suggestions[0]).toMatchObject({ proposedCut: true });
  });

  it("changed {@…} placeholders: no suggestion, a comment with the editor's version", async () => {
    const s = await sent({ L_greet: "What'll it be, {@player.name}?" });
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("What'll it be, friend?"))));
    expect(plan.suggestions).toEqual([]);
    expect(problemsOf(plan, "placeholders")).toHaveLength(1);
    expect(plan.comments[0]).toMatchObject({ anchor: "L_greet" });
    expect(plan.comments[0]!.messages[0]!.body).toContain("What'll it be, friend?");
    // Moving a placeholder within the line is fine.
    const moved = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("{@player.name}, what'll it be?"))));
    expect(moved.suggestions[0]!.proposed).toBe("{@player.name}, what'll it be?");
  });

  it("an inline [[note]] comes out of the text as a comment; one already in the line is left alone", async () => {
    const s = await sent({ L_work: "Aye [[team-tag]] - rats in the cellar." });
    const plan = await bringBack(s, (x) => {
      x = setWords(x, s.code("L_greet"), p(r(`${GREET} [[too warm?]]`)));
      return setWords(x, s.code("L_work"), p(r("Aye [[team-tag]] - rats in the cellar.")));
    });
    expect(plan.suggestions).toEqual([]); // neither line's words changed
    expect(plan.comments.map((c) => [c.anchor, c.messages[0]!.body])).toEqual([["L_greet", "too warm?"]]);
  });

  it("quote style and spacing aren't edits, unless quote style is asked to count", async () => {
    const s = await sent();
    const curly = (x: string) => setWords(x, s.code("L_greet"), p(r("What’ll  it be, stranger? ")));
    expect((await bringBack(s, curly)).suggestions).toEqual([]);
    expect((await bringBack(s, curly, { strictQuotes: true })).suggestions[0]!.proposed).toBe("What’ll it be, stranger?");
  });

  it("a speaker changed to a cast member is a suggestion; to anyone else, a comment", async () => {
    const s = await sent();
    const toPlayer = await bringBack(s, (x) => setCell(x, s.code("L_greet"), 0, p(r("PLAYER"))));
    expect(toPlayer.suggestions[0]).toMatchObject({ proposedCharacter: "PLAYER", baselineCharacter: "BARKEEP", proposed: GREET });
    const toStranger = await bringBack(s, (x) => setCell(x, s.code("L_greet"), 0, p(r("STRANGER"))));
    expect(toStranger.suggestions).toEqual([]);
    expect(problemsOf(toStranger, "unknown-speaker")).toHaveLength(1);
    expect(toStranger.comments[0]!.messages[0]!.body).toContain("STRANGER");
  });

  it("a direction added in the lead cell is a suggestion", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => setCell(x, s.code("L_greet"), 0, p(r("BARKEEP"), `<w:r><w:br/><w:t>(wiping a glass)</w:t></w:r>`)));
    expect(plan.suggestions[0]).toMatchObject({ proposedDirection: "wiping a glass", baselineDirection: "" });
  });

  it("a line changed in the project since export still gets its suggestion, counted as stale", async () => {
    const s = await sent();
    setStrings(s.dir, { L_greet: "Evening. What'll it be?" });
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("What'll it be, friend?"))));
    expect(plan.suggestions[0]).toMatchObject({ baseline: GREET });
    expect(plan.report.counts.stale).toBe(1);
  });

  it("a line no longer in the project: its new words become a comment on a neighbour", async () => {
    const s = await sent();
    const h = readHandoff(s.dir, s.out.handoff.id)!;
    h.lines[s.code("L_work")]!.id = "L_gone";
    applyWrites([handoffWrite(s.dir, h)]);
    const plan = await bringBack(s, (x) => setWords(x, s.code("L_work"), p(r("Rats. Lots of rats."))));
    expect(plan.suggestions).toEqual([]);
    expect(problemsOf(plan, "line-gone")).toHaveLength(1);
    expect(plan.comments[0]!.messages[0]!.body).toContain("Rats. Lots of rats.");
  });
});

describe("planEditableImport: markers and paragraphs (§7.3)", () => {
  it("a box deleted outright is a comment, never a cut", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => dropTable(x, s.code("L_greet")));
    expect(plan.suggestions).toEqual([]);
    expect(problemsOf(plan, "missing-box")).toHaveLength(1);
    expect(plan.comments[0]).toMatchObject({ anchor: "L_greet" });
  });

  it("a copied box: neither copy applied, both in a comment", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => {
      const [a, b] = tableSpan(x, s.code("L_greet"));
      const copy = x.slice(a, b).replace(GREET.replace("'", "&apos;"), "A copy.").replace(esc(GREET), "A copy.");
      return x.slice(0, b) + `<w:p/>` + copy + x.slice(b);
    });
    expect(plan.suggestions).toEqual([]);
    expect(problemsOf(plan, "duplicate-marker")).toHaveLength(1);
    expect(plan.comments[0]!.messages[0]!.body).toContain("A copy.");
  });

  it("a damaged marker is matched to its line by position", async () => {
    const s = await sent();
    const code = s.code("L_greet");
    const bad = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
    const plan = await bringBack(s, (x) => setWords(x, code, p(r("What'll it be, friend?"))).replace(`[#${code}]`, `[#${bad}]`));
    expect(problemsOf(plan, "repaired-marker")).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({ anchor: "L_greet", proposed: "What'll it be, friend?" });
  });

  it("a moved box still applies to its own line, with a comment saying where it went", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => {
      const [a, b] = tableSpan(x, s.code("L_greet"));
      const table = x.slice(a, b);
      x = x.slice(0, a) + x.slice(b);
      const [, end] = tableSpan(x, s.code("L_intim"));
      return x.slice(0, end) + "<w:p/>" + table.replace(esc(GREET).replace("'", "&apos;"), "Moved and changed.").replace(GREET.replace("'", "&apos;"), "Moved and changed.") + x.slice(end);
    });
    expect(problemsOf(plan, "moved").map((x) => x.anchor)).toContain("L_greet");
    expect(plan.suggestions.find((x) => x.anchor === "L_greet")).toBeDefined();
  });

  it("text typed outside every box is a comment on the line before", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => { const [, b] = tableSpan(x, s.code("L_greet")); return x.slice(0, b) + p(r("Should he smile here?")) + x.slice(b); });
    expect(problemsOf(plan, "added-text")).toHaveLength(1);
    expect(plan.comments[0]).toMatchObject({ anchor: "L_greet" });
    expect(plan.comments[0]!.messages[0]!.body).toBe("Editor added: “Should he smile here?”");
  });

  it("an edited context row becomes a comment on its node", async () => {
    const s = await sent();
    const plan = await bringBack(s, (x) => x.replace("‹ if @strength &gt;= 5 ›", "‹ if @strength &gt;= 8 ›"));
    const edited = problemsOf(plan, "context-edited");
    expect(edited).toHaveLength(1);
    expect(plan.comments[0]!.anchor).toBe(edited[0]!.anchor);
    expect(plan.comments[0]!.messages[0]!.body).toContain("@strength >= 8");
  });

  it("the document's comments land on their line or node, with replies, by their authors", async () => {
    const s = await sent();
    const plan = await bringBack(s,
      (x) => {
        x = setWords(x, s.code("L_greet"), p(`<w:commentRangeStart w:id="0"/>`, r(GREET), `<w:commentRangeEnd w:id="0"/>`));
        const at = x.indexOf("‹ if @strength");
        const run = x.lastIndexOf("<w:r>", at);
        return x.slice(0, run) + `<w:commentRangeStart w:id="1"/>` + x.slice(run);
      }, {},
      {
        "word/comments.xml": `<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">`
          + `<w:comment w:id="0" w:author="Jo" w:date="2026-10-04T09:00:00Z"><w:p w14:paraId="0A">${r("Too warm?")}</w:p></w:comment>`
          + `<w:comment w:id="2" w:author="Ian" w:date="2026-10-04T10:00:00Z"><w:p w14:paraId="0B">${r("Agreed.")}</w:p></w:comment>`
          + `<w:comment w:id="1" w:author="Jo"><w:p w14:paraId="0C">${r("Is 5 enough?")}</w:p></w:comment></w:comments>`,
        "word/commentsExtended.xml": `<?xml version="1.0"?><w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="0A"/><w15:commentEx w15:paraId="0B" w15:paraIdParent="0A"/></w15:commentsEx>`,
      });
    const greet = plan.comments.find((c) => c.anchor === "L_greet")!;
    expect(greet.messages.map((m) => [m.author, m.body])).toEqual([["Jo", "Too warm?"], ["Ian", "Agreed."]]);
    const onCondition = plan.comments.find((c) => c.messages[0]!.body === "Is 5 enough?")!;
    expect(onCondition.anchor).not.toBe("L_greet");
    expect(onCondition.messages[0]!.author).toBe("Jo");
  });
});

describe("planEditableImport: applying", () => {
  it("a second import of the same handoff replaces its still-open suggestions", async () => {
    const s = await sent();
    const first = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("First try."))));
    applyWrites(first.writes);
    const second = await bringBack(s, (x) => setWords(x, s.code("L_greet"), p(r("Second try."))));
    applyWrites(second.writes);
    expect(authoringOf(s.dir).suggestions!.map((x) => x.proposed)).toEqual(["Second try."]);
    expect(readHandoff(s.dir, s.out.handoff.id)!.imports).toHaveLength(2);
  });

  it("direct: clean changes are accepted on the way in; stale ones stay as suggestions", async () => {
    const s = await sent();
    setStrings(s.dir, { L_work: "Changed at home." });
    const plan = await bringBack(s, (x) => {
      x = setWords(x, s.code("L_greet"), p(r("What'll it be, friend?")));
      return setWords(x, s.code("L_work"), p(r("Changed away.")));
    }, { direct: true });
    applyWrites(plan.writes);
    const loc = parseSource(readFileSync(join(s.dir, "loc/en/tavern.patterloc"), "utf8")) as LocaleFile;
    expect(loc.strings["L_greet"]).toBe("What'll it be, friend?");
    expect(loc.strings["L_work"]).toBe("Changed at home.");
    const outcomes = Object.fromEntries(authoringOf(s.dir).suggestions!.map((x) => [x.anchor, x.outcome ?? "open"]));
    expect(outcomes).toEqual({ L_greet: "accepted", L_work: "open" });
  });
});
