// ---------------------------------------------------------------------------
// The localisation engine (spec §14): extractLoc produces the format-neutral
// catalog (source + translation + loc-channel comments + staleness + the
// @project cast display names); applyLoc writes translations back + stamps
// localisedAt. Round-trip: export fr -> translate -> import -> re-export sees it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, extractLoc, applyLoc, applyWrites, describeLocImport, importLocale, compareLocTokens } from "../src/index.js";
import { readFileSync } from "node:fs";
import { parseSource } from "@patterkit/core";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-loc-"));
  for (const d of ["scenes", "loc/en", "loc/fr", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "loc", name: "Loc Game" },
    locales: { default: "en", all: ["en", "fr"] },
    localiseDialogueText: true, // T1 is shown text here; action-text.test.ts covers the default
    // ANNA declares a grammatical gender (translator context); BO leaves it unspecified.
    cast: [{ name: "ANNA", displayName: "Anna", gender: "female" }, { name: "BO" }], // BO has no display name -> no @project entry
  });

  // s1: a line (ANNA), a line by an ungendered speaker (BO), a text beat, and a choice with one prompted option.
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Opening", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "ANNA" },
          { id: "L2", kind: "line", character: "BO" },
          { id: "T1", kind: "text" },
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [{ id: "o1c", type: "snippet", jump: { to: "END" } }] },
        ] },
      ] },
    ] } });

  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { L1: "Hello", L2: "Yes", T1: "Narration", CT1: "Pick me" } });
  w("loc/fr/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "fr",
    strings: { L1: "Bonjour", CT1: "Choisis" } }); // T1 missing -> not yet translated

  w("authoring/one.patterx", { schema: "patter/authoring@0",
    documentation: { L1: [{ type: "loc", text: "Keep it short" }, { type: "vo", text: "warm tone" }] }, // only the loc note exports
    edits: {
      L1: { modifiedAt: "2026-02-01T00:00:00Z", localisedAt: { fr: "2026-01-01T00:00:00Z" } }, // source changed after fr -> stale
    } });
  return dir;
}

const dir = makeProject();
const loaded = loadProject(dir);

describe("extractLoc", () => {
  it("template (no locale) has empty translations + the @project cast names, source filled", () => {
    const cat = extractLoc(loaded);
    expect(cat.locale).toBeUndefined();
    expect(cat.defaultLocale).toBe("en");
    const byId = Object.fromEntries(cat.entries.map((e) => [e.id, e]));
    expect(byId["L1"]).toMatchObject({ source: "Hello", translation: "", scene: "s1", stale: false });
    expect(byId["L1"]!.comments).toEqual(["Keep it short"]);          // vo note excluded
    expect(byId["L1"]!.context).toEqual({ character: "ANNA", kind: "line", gender: "female" });
    expect(byId["CT1"]).toMatchObject({ source: "Pick me", translation: "", scene: "s1" });
    // @project display name, seeded from CastMember.displayName; BO (no displayName) absent.
    expect(byId["cast:ANNA"]).toMatchObject({ source: "Anna", translation: "", scene: "@project" });
    expect(byId["cast:BO"]).toBeUndefined();
  });

  it("stamps the speaker's grammatical gender onto the translator context, and only when declared", () => {
    const cat = extractLoc(loaded);
    const byId = Object.fromEntries(cat.entries.map((e) => [e.id, e]));

    // ANNA declares female: her line, and her @project display name, both carry it.
    expect(byId["L1"]!.context?.gender).toBe("female");
    expect(byId["cast:ANNA"]!.context).toEqual({ character: "ANNA", gender: "female" });

    // BO is in the cast but declares no gender -> the key is absent, not an empty string.
    expect(byId["L2"]!.context).toEqual({ character: "BO", kind: "line" });
    expect(byId["L2"]!.context).not.toHaveProperty("gender");

    // Narration has no speaker at all, so there is nothing to inflect.
    expect(byId["T1"]!.context?.gender).toBeUndefined();
  });

  it("for a target locale: translations fill in, missing stays empty, stale is flagged", () => {
    const cat = extractLoc(loaded, { locale: "fr" });
    expect(cat.locale).toBe("fr");
    const byId = Object.fromEntries(cat.entries.map((e) => [e.id, e]));
    expect(byId["L1"]).toMatchObject({ translation: "Bonjour", stale: true });   // source modified after fr localisation
    expect(byId["CT1"]).toMatchObject({ translation: "Choisis", stale: false });
    expect(byId["T1"]).toMatchObject({ translation: "", stale: false });          // missing != stale
    expect(byId["cast:ANNA"]).toMatchObject({ translation: "", stale: false });
  });
});

describe("applyLoc", () => {
  it("writes translations back (scene + @project shards) + stamps localisedAt, and round-trips", () => {
    const cat = extractLoc(loaded, { locale: "fr" });
    // Translate the previously-missing narration and the display name.
    for (const e of cat.entries) {
      if (e.id === "T1") e.translation = "Narration FR";
      if (e.id === "cast:ANNA") e.translation = "Anne";
    }
    const { writes, stats } = applyLoc(loaded, cat, { now: "2026-03-01T00:00:00Z" });
    expect(stats.updated).toBeGreaterThanOrEqual(2);
    // A scene fr shard and a @project fr shard are both produced, under loc/fr.
    expect(writes.some((wr) => wr.path.includes(`${"/"}fr${"/"}`) && wr.path.endsWith("strings.patterloc"))).toBe(true);
    expect(writes.some((wr) => wr.path.endsWith("_project.patterloc"))).toBe(true);

    applyWrites(writes);
    const reloaded = loadProject(dir);
    const after = Object.fromEntries(extractLoc(reloaded, { locale: "fr" }).entries.map((e) => [e.id, e]));
    expect(after["T1"]!.translation).toBe("Narration FR");        // newly written, fresh
    expect(after["T1"]!.stale).toBe(false);
    expect(after["L1"]!.translation).toBe("Bonjour");             // preserved
    expect(after["cast:ANNA"]!.translation).toBe("Anne");         // @project shard written
    // L1 was flagged stale on export and not re-flagged fresh, so it stays stale (decision 3a).
    expect(after["L1"]!.stale).toBe(true);
  });

  it("refuses to import into the default (source) locale", () => {
    const cat = extractLoc(loaded, { locale: "fr" });
    const sourceCat = { ...cat, locale: "en" };
    expect(applyLoc(loaded, sourceCat).writes).toEqual([]);
  });

  it("refuses a scene the project does not have, or a language it does not declare, writing nothing", () => {
    // CLI review 2026-10, item 4: the target path is built from the file's own names.
    const cat = extractLoc(loaded, { locale: "fr" });
    const one = { ...cat.entries[0]!, translation: "x" };
    expect(() => applyLoc(loaded, { ...cat, entries: [{ ...one, scene: "../../outside" }] })).toThrow(/does not have: '\.\.\/\.\.\/outside'/);
    expect(() => applyLoc(loaded, { ...cat, entries: [{ ...one, scene: "scn_nope" }] })).toThrow(/does not have/);
    expect(() => applyLoc(loaded, { ...cat, locale: "../../x" })).toThrow(/not one of the project's languages/);
  });

  it("counts only strings whose translation actually changed (a no-op re-import reads 0 updated)", () => {
    const fresh = loadProject(dir); // current on-disk state
    const cat = extractLoc(fresh, { locale: "fr" });
    // Re-applying the catalog unchanged writes the same values back -> nothing counts as updated.
    expect(applyLoc(fresh, cat, { now: "2026-06-01T00:00:00Z" }).stats.updated).toBe(0);
    // Editing exactly one existing translation -> exactly one update.
    const one = cat.entries.find((e) => e.translation.trim())!;
    one.translation += " (edit)";
    expect(applyLoc(fresh, cat, { now: "2026-06-02T00:00:00Z" }).stats.updated).toBe(1);
  });
});

describe("grammatical gender is free text", () => {
  // Gender is not a closed set (real languages have common / animate / inanimate, etc). A value
  // outside male/female/neuter must survive extraction verbatim as translator context.
  it("carries a non-standard gender value through to the translator context", () => {
    const d = mkdtempSync(join(tmpdir(), "patter-loc-gender-"));
    for (const sub of ["scenes", "loc/en"]) mkdirSync(join(d, sub), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(d, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "g", name: "G" },
      locales: { default: "en", all: ["en"] }, cast: [{ name: "SEA", gender: "inanimate" }] });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "M", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "SEA" }] }] }] } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { L1: "The tide turns." } });

    const byId = Object.fromEntries(extractLoc(loadProject(d)).entries.map((e) => [e.id, e]));
    expect(byId["L1"]!.context?.gender).toBe("inanimate");
  });
});

// The 2026-10-28 rulings (Q7): a line the project doesn't have is skipped and listed; a translation whose
// placeholders or markup differ from the source as it is now is imported and listed; a file for one language is
// refused as another, and one that names none imports as chosen, with a warning.
describe("translation import checks", () => {
  /** A fresh copy of the project, its English with a placeholder and markup in L1. */
  function project(): string {
    const d = makeProject();
    writeFileSync(join(d, "loc/en/strings.patterloc"), JSON.stringify({ schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
      strings: { L1: "You have {@gold} coins, <b>friend</b>.", L2: "Yes", T1: "Narration", CT1: "Pick me" } }));
    return d;
  }
  const entry = (id: string, translation: string, scene = "s1") => ({ id, scene, source: "", translation, comments: [], stale: false });

  it("skips a line the project doesn't have: not written, counted or stamped, and listed", () => {
    const d = project();
    const p = loadProject(d);
    const { writes, stats, report } = applyLoc(p, { project: "loc", defaultLocale: "en", locale: "fr",
      entries: [entry("L2", "Oui"), entry("GHOST", "Fantôme"), entry("cast:NOBODY", "Personne", "@project")] }, { now: "2026-10-28T00:00:00Z" });
    expect(stats.updated).toBe(1); // L2 only
    expect(report.unknown).toEqual([{ id: "GHOST", scene: "s1" }, { id: "cast:NOBODY", scene: "@project" }]);
    const all = writes.map((w) => w.content).join("\n");
    expect(all).not.toContain("GHOST");
    expect(all).not.toContain("NOBODY");
    applyWrites(writes);
    const fr = parseSource(readFileSync(join(d, "loc/fr/strings.patterloc"), "utf8")) as { strings: Record<string, string> };
    expect(fr.strings).not.toHaveProperty("GHOST");
    expect(fr.strings.L2).toBe("Oui");
  });

  it("a line the file puts in the wrong scene goes to the scene that holds it", () => {
    const p = loadProject(project());
    const { writes, report } = applyLoc(p, { project: "loc", defaultLocale: "en", locale: "fr", entries: [entry("L2", "Oui", "@project")] });
    expect(report.unknown).toEqual([]);
    expect(writes.find((w) => w.path.endsWith("_project.patterloc"))).toBeUndefined();
    expect(writes.find((w) => w.content.includes('"L2"') && w.content.includes('"s1"'))).toBeDefined();
  });

  it("imports a translation whose placeholders or markup don't match the source, and lists what's missing or extra", () => {
    const p = loadProject(project());
    const { writes, stats, report } = applyLoc(p, { project: "loc", defaultLocale: "en", locale: "fr", entries: [
      entry("L1", "Tu as {@gold} pièces, <b>ami</b>."),   // matches: not listed
      entry("CT1", "Choisis {@name}"),                     // a placeholder the source hasn't
    ] });
    expect(stats.updated).toBe(2);
    expect(writes.some((w) => w.content.includes("Choisis {@name}"))).toBe(true);
    expect(report.mismatched).toEqual([{ id: "CT1", scene: "s1", missing: [], extra: ["{@name}"] }]);

    const wrong = applyLoc(p, { project: "loc", defaultLocale: "en", locale: "fr", entries: [entry("L1", "Tu as des pièces, ami {@gold} {@gold}.")] });
    expect(wrong.report.mismatched).toEqual([{ id: "L1", scene: "s1", missing: ["<b>"], extra: ["{@gold}"] }]);
    expect(wrong.stats.updated).toBe(1); // imported all the same
  });

  it("compares with the source as it is now, not as the file quotes it", () => {
    expect(compareLocTokens("Hi {@name}", "Salut {@name}")).toBeNull();
    expect(compareLocTokens("<i>Run</i> {@a}", "Cours")).toEqual({ missing: ["<i>", "{@a}"], extra: [] });
    expect(compareLocTokens("<b>x</b>", "<i>x</i>")).toEqual({ missing: ["<b>"], extra: ["<i>"] });
    const p = loadProject(project());
    // The file's own `source` is stale (no placeholder); the project's current source has one.
    const { report } = applyLoc(p, { project: "loc", defaultLocale: "en", locale: "fr", entries: [{ ...entry("L1", "Bonjour, <b>ami</b>."), source: "Hello, <b>friend</b>." }] });
    expect(report.mismatched).toEqual([{ id: "L1", scene: "s1", missing: ["{@gold}"], extra: [] }]);
  });

  it("tells a person what it skipped and what to check, in plain lines", () => {
    const p = loadProject(project());
    const lines = describeLocImport(p, {
      unknown: [{ id: "GHOST", scene: "s1" }, { id: "cast:NOBODY", scene: "@project" }],
      mismatched: [{ id: "L1", scene: "s1", missing: ["{@gold}"], extra: ["<i>"] }],
    });
    expect(lines).toEqual([
      "Skipped 2 lines this project doesn't have, so their translations weren't imported:",
      "  GHOST in 'Opening'",
      "  cast:NOBODY in the project's strings",
      "1 translation doesn't match the source's placeholders or formatting. It was imported, but check it:",
      "  L1 in 'Opening': missing {@gold}; extra <i>",
    ]);
    expect(describeLocImport(p, { unknown: [], mismatched: [] })).toEqual([]);
    for (const l of lines) expect(l).not.toMatch(/[\u2014\u00b7]/); // no em-dash, no interpunct
  });

  it("refuses a file for one language chosen as another, unless forced; one with none imports as chosen, warned", () => {
    expect(importLocale("fr", "fr")).toEqual({ ok: true, locale: "fr" });
    expect(importLocale("fr", undefined)).toEqual({ ok: true, locale: "fr" });
    expect(importLocale("fr", "de")).toMatchObject({ ok: false, reason: "mismatch", error: "This file is for 'fr', not 'de', so nothing was imported." });
    expect(importLocale("fr", "de", { force: true })).toEqual({ ok: true, locale: "de" });
    const none = importLocale(undefined, "de");
    expect(none).toMatchObject({ ok: true, locale: "de" });
    expect(none.ok && none.warning).toMatch(/doesn't say which language .* imported as 'de'/);
    expect(importLocale(undefined, undefined)).toMatchObject({ ok: false, reason: "none" });
  });
});
