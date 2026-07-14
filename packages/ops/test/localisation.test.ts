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
import { loadProject, extractLoc, applyLoc, applyWrites } from "../src/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-loc-"));
  for (const d of ["scenes", "loc/en", "loc/fr", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "loc", name: "Loc Game" },
    locales: { default: "en", all: ["en", "fr"] },
    // ANNA declares a grammatical gender (translator context); BO leaves it unspecified.
    cast: [{ name: "ANNA", displayName: "Anna", gender: "female" }, { name: "BO" }], // BO has no display name -> no @project entry
  });

  // s1: a line (ANNA), a line by an ungendered speaker (BO), a narration text, and a choice with one prompted option.
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
