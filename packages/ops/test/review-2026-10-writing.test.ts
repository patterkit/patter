// ---------------------------------------------------------------------------
// The CLI review of October 2026 (patterkit design/patter-cli-review-2026-10.md), its writing-layer
// findings: the voice script, the spreadsheet and PO catalogues, Replace, and the start-point helper.
// Each test names the trigger of one finding.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { canonicalStringify } from "@patterkit/core";
import {
  loadProject, runVoiceScript, runReport, catalogToXlsx, xlsxToCatalog, catalogToPo, poToCatalog, catalogToJson, jsonToCatalog,
  runReplace, applyWrites, extractLoc, resolveStart, runPlay,
} from "../src/index.js";
import type { LocCatalog } from "../src/index.js";

type Obj = Record<string, unknown>;

/** Write a project from shard objects (path -> object) into a fresh folder, and return the folder. */
function writeProject(files: Record<string, Obj>): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-review-writing-")), "game.patter");
  for (const [path, o] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), canonicalStringify(o));
  }
  return dir;
}

const projectFile = (extra: Obj = {}): Obj => ({
  schema: "patter/project@0", project: { id: "rev", name: "Review" }, locales: { default: "en", all: ["en"] }, ...extra,
});

// ---- Item 13: the voice script leaves out spoken choice prompts ----------------------------------------

describe("voice script: an option's line prompt is recorded (item 13)", () => {
  const dir = writeProject({
    "game.patterproj": projectFile({ voiced: true, cast: [{ name: "ANNA", actor: "Jane Doe" }] }),
    "scenes/one.patterflow": { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "Bar", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "g1", type: "group", selector: "choice", children: [
          // A spoken prompt: the player character says the choice aloud.
          { id: "o1", type: "group", prompt: { id: "P1", kind: "line", character: "ANNA" }, children: [
            { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }] },
          ] },
          // A text prompt is choice text only, never spoken.
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, children: [
            { id: "n2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "ANNA" }] },
          ] },
          // A cut prompt is not recorded, as a cut line is not.
          { id: "o3", type: "group", prompt: { id: "P3", kind: "line", character: "ANNA" }, children: [] },
          // A prompt still in draft waits for the writing, as a line does.
          { id: "o4", type: "group", prompt: { id: "P4", kind: "line", character: "ANNA" }, children: [] },
        ] },
      ] },
    ] } },
    "loc/en/one.patterloc": { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
      strings: { P1: "<b>Another</b>, please.", P2: "Leave", P3: "Cut me", P4: "Not yet", L1: "Thanks.", L2: "Bye." } },
    "authoring/one.patterx": { schema: "patter/authoring@0",
      writing: { P1: "final", P2: "final", P3: "final", P4: "draft 1", L1: "final", L2: "final" },
      cut: { P3: true },
      documentation: { o1: [{ type: "vo", text: "Tired." }], P1: [{ type: "vo", text: "Mumbled." }] } },
  });
  const loaded = loadProject(dir);

  it("emits a ready line prompt in the option's scope, ahead of the option's content", () => {
    const lines = runVoiceScript(loaded).lines;
    expect(lines.map((l) => l.id)).toEqual(["P1", "L1", "L2"]); // P2 is text, P3 is cut, P4 is a draft
    const p1 = lines[0]!;
    expect(p1).toMatchObject({ character: "ANNA", actor: "Jane Doe", text: "Another, please.", recordingStatus: "missing" });
    expect(p1.scope).toBe(lines[1]!.scope); // the option's scope, which its content shares
    expect(p1.comments).toEqual(["Tired.", "Mumbled."]); // the option's context leads, then its own note
  });

  it("emits a draft prompt with everything, and agrees with the report's voiced count", () => {
    const all = runVoiceScript(loaded, { everything: true }).lines.map((l) => l.id);
    expect(all).toEqual(["P1", "L1", "L2", "P4"]);
    expect(runReport(loaded).totals.voiced.count).toBe(all.length);
  });
});

// ---- Items 16 and 36: the spreadsheet catalogue ------------------------------------------------------

const entry = (id: string, scene: string, translation = ""): LocCatalog["entries"][number] =>
  ({ id, scene, source: `source of ${id}`, translation, comments: [], stale: false });

/** Load an exported workbook, let `edit` change it as a translator would, and read it back. */
async function roundTrip(catalog: LocCatalog, edit: (wb: ExcelJS.Workbook) => void = () => {}): Promise<LocCatalog> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await catalogToXlsx(catalog) as unknown as ArrayBuffer);
  edit(wb);
  return xlsxToCatalog(Buffer.from(await wb.xlsx.writeBuffer()));
}

describe("spreadsheet: a formatted translation reads as its text (item 16)", () => {
  const catalog: LocCatalog = { project: "rev", defaultLocale: "en", locale: "fr",
    entries: [entry("L1", "s1"), entry("L2", "s1"), entry("L3", "s1"), entry("L4", "s1"), entry("L5", "s1")] };

  it("joins a rich-text cell's runs, and reads hyperlinks, formulas and errors safely", async () => {
    const back = await roundTrip(catalog, (wb) => {
      const ws = wb.worksheets[0]!;
      // Rows 2 to 6 hold L1 to L5; column 3 is Translation.
      ws.getCell(2, 3).value = { richText: [{ text: "Un " }, { text: "autre", font: { bold: true } }, { text: ", merci." }] };
      ws.getCell(3, 3).value = { text: "le site", hyperlink: "https://example.com" };
      ws.getCell(4, 3).value = { formula: "\"Bon\"&\"jour\"", result: "Bonjour" };
      ws.getCell(5, 3).value = { error: "#N/A" };
      ws.getCell(6, 3).value = 42;
    });
    const byId = Object.fromEntries(back.entries.map((e) => [e.id, e.translation]));
    expect(byId).toEqual({ L1: "Un autre, merci.", L2: "le site", L3: "Bonjour", L4: "", L5: "42" });
    expect(back.entries.some((e) => e.translation.includes("[object Object]"))).toBe(false);
  });
});

describe("spreadsheet: scene ids that make awkward sheet names (item 36)", () => {
  const long = "a-scene-id-that-runs-well-past-31-characters";
  const scenes = [`${long}-one`, `${long}-two`, "act:1?[draft]*", "Intro", "intro", "History", "'quoted'"];
  const catalog: LocCatalog = { project: "rev", defaultLocale: "en", locale: "fr",
    entries: scenes.map((s, i) => entry(`L${i}`, s, `t${i}`)) };

  it("exports without throwing, with legal and distinct sheet names", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await catalogToXlsx(catalog) as unknown as ArrayBuffer);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toHaveLength(scenes.length);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(scenes.length);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[:\\/?*[\]]|^'|'$/);
    }
  });

  it("brings every row back to its own scene", async () => {
    const back = await roundTrip(catalog);
    expect(back.entries.map((e) => [e.id, e.scene])).toEqual(scenes.map((s, i) => [`L${i}`, s]));
  });

  it("gives a row the translator added the scene of the sheet it sits on", async () => {
    const back = await roundTrip(catalog, (wb) => { wb.worksheets[0]!.addRow(["L_new", "", "nouveau"]); });
    expect(back.entries.find((e) => e.id === "L_new")?.scene).toBe(scenes[0]);
  });

  it("still reads an older export, whose scene is its sheet name", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s1");
    ws.addRow(["ID", "Source", "Translation", "Comments", "Status", "Gender"]);
    ws.addRow(["L1", "Yes.", "Oui.", "", ""]);
    const back = await xlsxToCatalog(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(back.entries[0]).toMatchObject({ id: "L1", scene: "s1", translation: "Oui." });
  });
});

// ---- Item 31: a PO round-trip mangles backslashes -------------------------------------------------------

describe("PO: escapes round-trip in one pass (item 31)", () => {
  it("keeps backslashes, quotes, newlines and tabs, in combination", () => {
    const tricky = ["C:\\new", "a\\\\b", "say \"hi\"\\n", "two\nlines\tand \\\"both\\\"", "end\\", "\\t is not a tab", "\r\n"];
    const catalog: LocCatalog = { project: "rev", defaultLocale: "en", locale: "fr",
      entries: tricky.map((t, i) => ({ ...entry(`L${i}`, "s1", t), source: t })) };
    const back = poToCatalog(catalogToPo(catalog));
    expect(back.entries.map((e) => e.translation)).toEqual(tricky);
    expect(back.entries.map((e) => e.source)).toEqual(tricky);
  });
});

// ---- Item 32: a catalogue's scene and locale are not checked when read -----------------------------------

describe("catalogue reading refuses a scene or locale that is not a plain name (item 32)", () => {
  const json = (o: Obj): string => JSON.stringify({ project: "rev", defaultLocale: "en", locale: "fr", entries: [], ...o });

  it("JSON: a scene with a path in it, or no scene", () => {
    expect(() => jsonToCatalog(json({ entries: [{ id: "L1", scene: "../../outside", translation: "x" }] }))).toThrow(/'scene'/);
    expect(() => jsonToCatalog(json({ entries: [{ id: "L1", scene: "a/b", translation: "x" }] }))).toThrow(/'scene'/);
    expect(() => jsonToCatalog(json({ entries: [{ id: "L1", scene: "a\\b", translation: "x" }] }))).toThrow(/'scene'/);
    expect(() => jsonToCatalog(json({ entries: [{ id: "L1", translation: "x" }] }))).toThrow(/'scene' must be a non-empty string/);
    expect(() => jsonToCatalog(json({ entries: [{ id: "L1", scene: "", translation: "x" }] }))).toThrow(/'scene'/);
  });

  it("JSON: a locale with a path in it, or not a string", () => {
    expect(() => jsonToCatalog(json({ locale: "../fr" }))).toThrow(/'locale'/);
    expect(() => jsonToCatalog(json({ locale: 7 }))).toThrow(/'locale' must be a non-empty string/);
    expect(() => jsonToCatalog(json({ locale: "" }))).toThrow(/'locale'/);
    // A template has no locale, and stays readable.
    expect(jsonToCatalog(json({ locale: undefined })).locale).toBeUndefined();
  });

  it("PO: a scene reference or Language header with a path in it", () => {
    const good: LocCatalog = { project: "rev", defaultLocale: "en", locale: "fr", entries: [entry("L1", "s1", "x")] };
    const po = catalogToPo(good);
    expect(poToCatalog(po).entries[0]!.scene).toBe("s1");
    expect(() => poToCatalog(po.replace("#: s1", "#: ../../outside"))).toThrow(/PO: 'scene'/);
    expect(() => poToCatalog(po.replace("#: s1\n", ""))).toThrow(/PO: 'scene' must be a non-empty string/);
    expect(() => poToCatalog(po.replace("Language: fr", "Language: ../fr"))).toThrow(/PO: 'locale'/);
  });

  it("a well-formed catalogue still round-trips through JSON", () => {
    const good: LocCatalog = { project: "rev", defaultLocale: "en", locale: "fr", entries: [entry("L1", "@project", "x")] };
    expect(jsonToCatalog(catalogToJson(good)).entries[0]!.scene).toBe("@project");
  });
});

// ---- Item 30: Replace stamps no modifiedAt ---------------------------------------------------------------

describe("replace stamps each changed source string's modifiedAt (item 30)", () => {
  const files = (): Record<string, Obj> => ({
    "game.patterproj": projectFile({ locales: { default: "en", all: ["en", "fr"] } }),
    "scenes/one.patterflow": { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "Bar", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "L2", kind: "line", character: "ANNA" }] },
      ] },
    ] } },
    "loc/en/one.patterloc": { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { L1: "Hello.", L2: "Goodbye." } },
    "loc/fr/one.patterloc": { schema: "patter/strings@0", scene: "s1", locale: "fr", strings: { L1: "Bonjour.", L2: "Au revoir." } },
    "authoring/one.patterx": { schema: "patter/authoring@0", writing: { L1: "final" },
      edits: { L1: { localisedAt: { fr: "2026-01-01T00:00:00.000Z" } }, L2: { localisedAt: { fr: "2026-01-01T00:00:00.000Z" } } } },
  });

  it("plans the stamp beside the string write, keeping the rest of the authoring shard", () => {
    const loaded = loadProject(writeProject(files()));
    const plan = runReplace(loaded, { query: "Hello", replacement: "Hi", now: "2026-10-06T12:00:00.000Z" });
    expect(plan.shards).toHaveLength(1);
    expect(plan.writes.map((w) => w.path.split("/").pop())).toEqual(["one.patterloc", "one.patterx"]);
    const af = plan.authoring[0]!.file;
    expect(af.edits?.L1).toEqual({ modifiedAt: "2026-10-06T12:00:00.000Z", localisedAt: { fr: "2026-01-01T00:00:00.000Z" } });
    expect(af.edits?.L2?.modifiedAt).toBeUndefined(); // untouched string, untouched stamp
    expect(af.writing).toEqual({ L1: "final" });
    // `loaded` itself is not changed: the plan carries copies.
    expect(loaded.authoring[0]!.edits?.L1?.modifiedAt).toBeUndefined();
  });

  it("makes the translation of a replaced line go stale on the next export", () => {
    const dir = writeProject(files());
    applyWrites(runReplace(loadProject(dir), { query: "Hello", replacement: "Hi" }).writes);
    const fr = Object.fromEntries(extractLoc(loadProject(dir), { locale: "fr" }).entries.map((e) => [e.id, e.stale]));
    expect(fr).toMatchObject({ L1: true, L2: false });
  });

  it("creates the authoring shard when the scene has none", () => {
    const f = files();
    delete f["authoring/one.patterx"];
    const plan = runReplace(loadProject(writeProject(f)), { query: "Goodbye", replacement: "Bye", now: "2026-10-06T12:00:00.000Z" });
    expect(plan.authoring[0]!.file).toEqual({ schema: "patter/authoring@0", edits: { L2: { modifiedAt: "2026-10-06T12:00:00.000Z" } } });
  });
});

// ---- Item 33: --block without --scene is silently ignored ------------------------------------------------

describe("a block named without a scene is found in every scene (item 33)", () => {
  const scene = (id: string, name: string, blocks: Array<{ id: string; name: string; line: string }>): Obj => ({
    schema: "patter/flow@0", scene: { id, type: "scene", name, blocks: blocks.map((b) => ({
      id: b.id, type: "block", name: b.name, children: [{ id: `n_${b.id}`, type: "snippet", beats: [{ id: b.line, kind: "line", character: "ANNA" }] }],
    })) },
  });
  const dir = writeProject({
    "game.patterproj": projectFile({ start: { scene: "s1" } }),
    "scenes/one.patterflow": scene("s1", "Bar", [{ id: "b1", name: "Main", line: "L1" }, { id: "b2", name: "Hub", line: "L2" }]),
    "scenes/two.patterflow": scene("s2", "Street", [{ id: "b3", name: "Alley", line: "L3" }, { id: "b4", name: "Hub", line: "L4" }]),
    "loc/en/one.patterloc": { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { L1: "one", L2: "two" } },
    "loc/en/two.patterloc": { schema: "patter/strings@0", scene: "s2", locale: "en", default: true, strings: { L3: "three", L4: "four" } },
  });
  const loaded = loadProject(dir);

  it("resolves a block by name, address or id in whichever scene holds it", () => {
    expect(resolveStart(loaded, { block: "Alley" })).toEqual({ scene: "s2", block: "b3" });
    expect(resolveStart(loaded, { block: "alley" })).toEqual({ scene: "s2", block: "b3" }); // its derived address
    expect(resolveStart(loaded, { block: "b4" })).toEqual({ scene: "s2", block: "b4" });   // an id is unique: no ambiguity
    // Not dropped for the project's own start any more: play begins at the block asked for.
    const first = runPlay(loaded, { block: "Alley" }).events[0];
    expect(first).toMatchObject({ type: "line", id: "L3" });
  });

  it("throws, naming the scenes, when the block is in more than one", () => {
    expect(() => resolveStart(loaded, { block: "Hub" })).toThrow(/"Bar" \(s1\), "Street" \(s2\)/);
  });

  it("throws when no scene has the block", () => {
    expect(() => resolveStart(loaded, { block: "Nowhere" })).toThrow(/no scene has a block "Nowhere"/);
  });

  it("leaves a block with a scene, and no block at all, as they were", () => {
    expect(resolveStart(loaded, { scene: "s2", block: "Hub" })).toEqual({ scene: "s2", block: "Hub" });
    expect(resolveStart(loaded, {})).toEqual({ scene: "s1", block: undefined });
  });
});
