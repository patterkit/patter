// ---------------------------------------------------------------------------
// The editable script round trip from the command line: export-editable, import-editable, and
// suggestions (the ops behind them are tested in @patterkit/ops; this is the argv / print / write layer).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { parseSource } from "@patterkit/core";
import type { AuthoringFile, HandoffFile, LocaleFile } from "@patterkit/model";
import { parseArgs, main } from "../src/main.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
const logged = (): string => vi.mocked(console.log).mock.calls.map((c) => c.join(" ")).join("\n");
const errored = (): string => vi.mocked(console.error).mock.calls.map((c) => c.join(" ")).join("\n");

function tavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-cli-editable-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}
const handoffOf = (dir: string): HandoffFile => {
  const [file] = readdirSync(join(dir, "handoffs"));
  return JSON.parse(readFileSync(join(dir, "handoffs", file!), "utf8")) as HandoffFile;
};

/** Change one line's words in the exported file, untracked, as an editor would. */
async function editLine(docx: string, marker: string, text: string): Promise<void> {
  const zip = await JSZip.loadAsync(readFileSync(docx));
  let xml = await zip.file("word/document.xml")!.async("string");
  const at = xml.indexOf(`[#${marker}]`);
  const t0 = xml.lastIndexOf("<w:tbl>", at);
  const c1 = xml.indexOf("<w:tc>", xml.indexOf("<w:tc>", t0) + 1);
  const end = xml.indexOf("</w:tc>", c1);
  const cell = xml.slice(c1, end);
  const props = cell.slice(0, cell.indexOf("</w:tcPr>") + "</w:tcPr>".length);
  xml = xml.slice(0, c1) + props + `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>` + xml.slice(end);
  zip.file("word/document.xml", xml);
  writeFileSync(docx, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("parseArgs: repeatable flags", () => {
  it("collects every --scene in order", () => {
    const { flags, errors } = parseArgs("export-editable", ["--scene", "Street", "-o", "x.docx", "--scene", "The Tavern"]);
    expect(errors).toEqual([]);
    expect(flags.scene).toEqual(["Street", "The Tavern"]);
  });
});

describe("export-editable", () => {
  it("writes the .docx and the handoff record", async () => {
    const dir = tavern(), out = join(dir, "..", "tavern.docx");
    expect(await main(["export-editable", dir, "-o", out, "--recipient", "Sam", "--by", "Ian"])).toBe(0);
    expect(existsSync(out)).toBe(true);
    const h = handoffOf(dir);
    expect(h).toMatchObject({ recipient: "Sam", createdBy: "Ian" });
    expect(logged()).toContain(`handoff ${h.id}`);
  });

  it("takes scenes by name or id, and names the scenes when one isn't found", async () => {
    const dir = tavern(), out = join(dir, "..", "t.docx");
    expect(await main(["export-editable", dir, "-o", out, "--scene", "the tavern", "--by", "Ian"])).toBe(0);
    expect(handoffOf(dir).range.scenes).toEqual(["scn_tavern"]);
    expect(await main(["export-editable", dir, "-o", out, "--scene", "Nowhere"])).toBe(2);
    expect(errored()).toContain("no scene called 'Nowhere'");
  });

  it("needs -o, ending .docx", async () => {
    expect(await main(["export-editable", tavern()])).toBe(2);
    expect(await main(["export-editable", tavern(), "-o", "x.pdf"])).toBe(2);
  });
});

describe("import-editable and suggestions", () => {
  it("round trip: a dry run writes nothing; the import adds a suggestion; accept-clean applies it", async () => {
    const dir = tavern(), out = join(dir, "..", "tavern.docx");
    expect(await main(["export-editable", dir, "-o", out, "--recipient", "Sam", "--by", "Ian"])).toBe(0);
    const h = handoffOf(dir);
    const greet = Object.entries(h.lines).find(([, l]) => l.id === "L_greet")![0];
    await editLine(out, greet, "What will it be, friend?");

    const authoring = join(dir, "authoring/tavern.patterx");
    const before = readFileSync(authoring, "utf8");
    expect(await main(["import-editable", out, dir, "--dry-run", "--by", "Ian"])).toBe(0);
    expect(readFileSync(authoring, "utf8")).toBe(before);
    expect(logged()).toContain("1 suggestion(s)");
    expect(logged()).toContain("dry run: nothing written");

    expect(await main(["import-editable", out, dir, "--by", "Ian"])).toBe(0);
    const s = (parseSource(readFileSync(authoring, "utf8")) as AuthoringFile).suggestions!;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ anchor: "L_greet", proposed: "What will it be, friend?", author: "Sam", handoff: { id: h.id } });
    expect(handoffOf(dir).imports).toHaveLength(1);

    vi.mocked(console.log).mockClear();
    expect(await main(["suggestions", dir, "--handoff", h.id])).toBe(0);
    expect(logged()).toContain("\"What'll it be, stranger?\" -> \"What will it be, friend?\"");

    expect(await main(["suggestions", dir, "--accept-clean"])).toBe(0);
    const loc = parseSource(readFileSync(join(dir, "loc/en/tavern.patterloc"), "utf8")) as LocaleFile;
    expect(loc.strings["L_greet"]).toBe("What will it be, friend?");
    expect(logged()).toContain("accepted 1 suggestion(s)");
  });

  it("a refused file exits 1 and writes nothing", async () => {
    const dir = tavern(), out = join(dir, "..", "tavern.docx");
    expect(await main(["export-editable", dir, "-o", out, "--by", "Ian"])).toBe(0);
    const other = tavern(); // a different copy, with no such handoff
    expect(await main(["import-editable", out, other])).toBe(1);
    expect(logged()).toContain("isn't in this project");
    expect(existsSync(join(other, "handoffs"))).toBe(false);
  });

  it("needs a file", async () => {
    expect(await main(["import-editable"])).toBe(2);
  });

  it("lists a speaker qualifier change by the qualifiers' shown names", async () => {
    const dir = tavern();
    const authoring = join(dir, "authoring/tavern.patterx");
    const af = parseSource(readFileSync(authoring, "utf8")) as AuthoringFile;
    const suggestion = { id: "sg_q", anchor: "L_greet", baseline: "What'll it be, stranger?", proposed: "What'll it be, stranger?", author: "Sam", ts: "2026-10-01T00:00:00Z", proposedQualifier: "os", baselineQualifier: "" };
    writeFileSync(authoring, JSON.stringify({ ...af, suggestions: [suggestion] }));
    expect(await main(["suggestions", dir])).toBe(0);
    expect(logged()).toContain("qualifier (none) -> O.S.");
  });
});
