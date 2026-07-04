// ---------------------------------------------------------------------------
// The readable-script export: the structure walk (runScriptDoc) turns the project into a reading-order
// element list set like a paper script - coloured dialogue cues, narration, game events + jumps set apart,
// choices as a labelled rail with flag tags - and the two renderers emit a valid .docx / .pdf. The walk is
// the part with logic; the renderers are smoke-tested for a non-empty file of the right type.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runScriptDoc, scriptToDocx, scriptToPdf } from "../src/index.js";
import type { ScriptElement, ScriptDoc } from "../src/index.js";
import { textRuns, characterColour, colourIndex } from "../src/script-doc.js";

/** The concatenated plain text of a run-bearing element (line / narration / option). */
const runText = (e: ScriptElement): string => ("runs" in e ? e.runs.map((r) => r.text).join("") : "");

/** A project with narration, a directed line, a game event, a conditional once-only option that jumps, a
 *  repeatable option, and a block that ends - enough to exercise every element kind. */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-script-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "s", name: "The Tavern" },
    locales: { default: "en", all: ["en"] }, voiced: true,
    cast: [{ name: "BARKEEP" }, { name: "STRANGER" }],
  });

  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "The Tavern", blocks: [
      { id: "b1", type: "block", name: "Entrance", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "T1", kind: "text" },
          { id: "L1", kind: "line", character: "BARKEEP", direction: "gruff" },
          { id: "A1", kind: "gameEvent", gameData: { event: "door.open" } }] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, condition: "@gold > 5", children: [
            { id: "n2", type: "snippet", beats: [{ id: "L2", kind: "line", character: "BARKEEP" }], jump: { to: "b2" } }] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "text" }, sticky: true, children: [
            { id: "n3", type: "snippet", beats: [{ id: "L3", kind: "line", character: "STRANGER" }] }] },
        ] },
      ] },
      { id: "b2", type: "block", name: "Back Room", children: [
        { id: "n4", type: "snippet", beats: [{ id: "T2", kind: "text" }], jump: { to: "END" } }] },
    ] } });

  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: {
    T1: "The door creaks open.", L1: "What'll it be?", P1: "Order an ale", P2: "Ask about the back room",
    L2: "Coming right up.", L3: "You didn't see anything.", T2: "Shadows everywhere." } });

  return dir;
}

describe("runScriptDoc", () => {
  const doc = runScriptDoc(loadProject(makeProject()));
  const kinds = (k: ScriptElement["kind"]) => doc.elements.filter((e) => e.kind === k);

  it("titles from the project name and walks every scene + block as headings", () => {
    expect(doc.project).toBe("The Tavern");
    expect(kinds("scene").map((e) => (e as { text: string }).text)).toEqual(["The Tavern"]);
    expect(kinds("block").map((e) => (e as { text: string }).text)).toEqual(["Entrance", "Back Room"]);
  });

  it("emits dialogue with speaker + direction, and narration flush-left", () => {
    const line = kinds("line")[0] as Extract<ScriptElement, { kind: "line" }>;
    expect(line).toMatchObject({ character: "BARKEEP", direction: "gruff" });
    expect(runText(line)).toBe("What'll it be?");
    expect(runText(kinds("narration")[0]!)).toBe("The door creaks open.");
  });

  it("shows a game event set apart (not omitted), named from its gameData", () => {
    const ge = kinds("gameEvent")[0] as Extract<ScriptElement, { kind: "gameEvent" }>;
    expect(ge.text).toContain("game event");
    expect(ge.text).toContain("door.open");
  });

  it("renders a choice as a 'Choose' group label plus options carrying a flag tag", () => {
    expect(kinds("group").some((e) => (e as { label: string }).label === "Choose")).toBe(true);
    const opts = kinds("option") as Array<Extract<ScriptElement, { kind: "option" }>>;
    expect(opts.map(runText)).toEqual(["Order an ale", "Ask about the back room"]);
    expect(opts[0]!.tag).toBe("once only"); // default once-only
    expect(opts[1]!.tag).toBe("repeatable"); // sticky
    expect(opts.every((o) => o.snippet !== undefined)).toBe(true); // inside a selector: edged snippet
    expect(opts[0]!.snippet).not.toBe(opts[1]!.snippet);           // each option is its own snippet
  });

  it("gives each sequence / branch child its own snippet id, but leaves top-level snippets unedged", () => {
    const narr = kinds("narration") as Array<Extract<ScriptElement, { kind: "narration" }>>;
    expect(narr.some((n) => n.snippet === undefined)).toBe(true); // top-level narration: no edge
  });

  it("puts an option's condition on its own accent line above it", () => {
    const conds = kinds("condition").map((e) => (e as { text: string }).text);
    expect(conds).toContain("if @gold > 5");
  });

  it("sets jumps apart by destination name and END", () => {
    const jumps = kinds("jump").map((e) => (e as { text: string }).text);
    expect(jumps).toContain("The Tavern › Back Room");
    expect(jumps).toContain("END");
  });
});

describe("character cue colour", () => {
  it("hashes a name into the 12-slot palette (FNV-1a + fmix32), stable per name", () => {
    expect(colourIndex("GUIDE")).toBe(7); // worked example from the design handoff (blue)
    expect(colourIndex("SFX")).toBe(3);   // olive
    expect(characterColour("GUIDE")).toBe("3a6aa8");
    expect(characterColour("GUIDE")).toBe(characterColour("GUIDE")); // recomputed, stable
  });
});

describe("script renderers", () => {
  const doc = runScriptDoc(loadProject(makeProject()));

  it("scriptToDocx produces a non-trivial .docx (zip) buffer", async () => {
    const buf = await scriptToDocx(doc);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // docx is a zip
  });

  it("scriptToPdf produces a non-trivial %PDF buffer", async () => {
    const buf = await scriptToPdf(doc);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("embeds the design faces + fallbacks so accents / arrows / maths / scripts / emoji render", async () => {
    const uni: ScriptDoc = { project: "Uni", elements: [
      { kind: "line", indent: 0, character: "GUIDE", runs: textRuns("Maths 1 ≥ 0, arrow ←, café, привет, Ελλάς, torch 🔥.") },
    ] };
    const buf = await scriptToPdf(uni);
    const raw = buf.toString("latin1");
    expect(raw).toContain("Newsreader"); // the serif reading face (café / Latin body)
    expect(raw).toContain("DejaVu");     // the symbol / non-Latin fallback (≥ ← and Cyrillic / Greek)
    expect(raw).toContain("NotoEmoji");  // the emoji fallback (the 🔥 routed to it)
  });
});

describe("readable-script text handling: conditions, markup, interpolation", () => {
  it("humanizes visits()/seen() in conditions to the scene / block title (not the raw id)", () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-script-h-"));
    for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "h", name: "H" }, locales: { default: "en", all: ["en"] } });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "Scene One", blocks: [
      { id: "intro", type: "block", name: "Intro", children: [{ id: "n0", type: "snippet", beats: [{ id: "T0", kind: "text" }] }] },
      { id: "vault", type: "block", name: "The Vault", children: [
        { id: "n1", type: "snippet", condition: "visits('vault') == 1 && seen('intro')", beats: [{ id: "T1", kind: "text" }] }] },
    ] } });
    w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { T0: "x", T1: "y" } });
    const doc = runScriptDoc(loadProject(dir));
    const conds = doc.elements.filter((e) => e.kind === "condition").map((e) => (e as { text: string }).text);
    expect(conds).toContain("if visits(The Vault) == 1 && seen(Intro)"); // ids swapped for titles
    expect(doc.elements.some((e) => JSON.stringify(e).includes("'vault'") || JSON.stringify(e).includes("'intro'"))).toBe(false); // no raw id leaks
  });

  it("textRuns splits the closed <b>/<i>/<bi> markup into formatting runs, literals verbatim", () => {
    expect(textRuns("Gold & <b>glory</b> await")).toEqual([
      { text: "Gold & ", bold: false, italic: false, code: false },
      { text: "glory", bold: true, italic: false, code: false },
      { text: " await", bold: false, italic: false, code: false },
    ]);
    expect(textRuns("<bi>both</bi>")).toEqual([{ text: "both", bold: true, italic: true, code: false }]);
    expect(textRuns("plain")).toEqual([{ text: "plain", bold: false, italic: false, code: false }]);
  });

  it("textRuns marks {@property} interpolation as a code run (accent mono), braces kept", () => {
    expect(textRuns("You have {@gold} gold")).toEqual([
      { text: "You have ", bold: false, italic: false, code: false },
      { text: "{@gold}", bold: false, italic: false, code: true },
      { text: " gold", bold: false, italic: false, code: false },
    ]);
    // interpolation inside markup keeps both the markup flags and the code flag
    expect(textRuns("<b>{@torch} left</b>")).toEqual([
      { text: "{@torch}", bold: true, italic: false, code: true },
      { text: " left", bold: true, italic: false, code: false },
    ]);
  });
});
