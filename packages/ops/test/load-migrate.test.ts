// ---------------------------------------------------------------------------
// Back-compat (#209): the boolean property type was renamed "bool" -> "boolean"
// (matching @wildwinter/expr). loadProject normalises legacy "bool" on read so
// existing projects keep loading; they upgrade to "boolean" on the next save.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject } from "../src/index.js";
import { validateProject } from "@patterkit/core";

// A project whose @patter property, a scene's @scene prop, and a host scope all
// use the LEGACY "bool" spelling on disk.
function makeLegacyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-migrate-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "leg", name: "Legacy" },
    locales: { default: "en", all: ["en"] },
    properties: [{ name: "flag", type: "bool", default: false }],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "alarm", type: "bool" }] }] },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start",
    sceneProps: [{ name: "seen", type: "bool", default: false }],
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [{ id: "L", kind: "line", character: "A" }] },
    ] }],
  } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L: "hi" } });
  return dir;
}

describe("legacy bool→boolean migration on load", () => {
  const loaded = loadProject(makeLegacyProject());

  it("normalises a global @patter property type", () => {
    expect(loaded.project.properties?.[0]).toMatchObject({ name: "flag", type: "boolean" });
  });

  it("normalises a scene-local @scene property type", () => {
    expect(loaded.scenes[0]!.sceneProps?.[0]).toMatchObject({ name: "seen", type: "boolean" });
  });

  it("normalises a host-scope declaration type", () => {
    expect(loaded.project.scopeRegistry?.scopes[0]?.declarations?.[0]).toMatchObject({ name: "alarm", type: "boolean" });
  });
});

// ---------------------------------------------------------------------------
// A declared name that is not lower case is folded on read, for the same reason
// and at the same three sites: expressions fold every property REFERENCE, so a
// declaration spelled `isNight` is one nothing can reach. Such a project PLAYED
// (the bags key lower case), so it is upgraded rather than reported.
// ---------------------------------------------------------------------------

function makeCapitalisedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-fold-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "cap", name: "Capitals" },
    locales: { default: "en", all: ["en"] },
    properties: [{ name: "isNight", type: "boolean", default: true }],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "AlarmRaised", type: "boolean" }] }] },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start",
    sceneProps: [{ name: "hasSeen", type: "boolean", default: false }],
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [{ id: "L", kind: "line", character: "A" }] },
    ] }],
  } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L: "hi" } });
  return dir;
}

describe("capitalised declared names are folded on load", () => {
  const loaded = loadProject(makeCapitalisedProject());

  it("folds a global @patter property name", () => {
    expect(loaded.project.properties?.[0]?.name).toBe("isnight");
  });

  it("folds a scene-local @scene prop name", () => {
    expect(loaded.scenes[0]!.sceneProps?.[0]?.name).toBe("hasseen");
  });

  it("folds a host-scope declaration name", () => {
    expect(loaded.project.scopeRegistry?.scopes[0]?.declarations?.[0]?.name).toBe("alarmraised");
  });

  it("leaves a loaded project clean of declaration issues", () => {
    expect(validateProject({ project: loaded.project, scenes: loaded.scenes })
      .filter((i) => i.code === "invalid-declaration")).toEqual([]);
  });
});

// The other half of that rule: a loader repairs case, and REFUSES to guess at
// anything else. `is-night` never worked (an expression reads the hyphen as
// subtraction), so inventing `is_night` for it would be choosing what the author
// meant, which is the line the gameId editor already draws.
describe("names that need more than folding are left for the validator", () => {
  function makeIllegalProject(name: string): string {
    const dir = mkdtempSync(join(tmpdir(), "patter-illegal-"));
    for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", {
      schema: "patter/project@0", project: { id: "ill", name: "Illegal" },
      locales: { default: "en", all: ["en"] },
      properties: [{ name, type: "boolean" }],
    });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
      id: "s1", type: "scene", name: "Start",
      blocks: [{ id: "b", type: "block", name: "B", children: [
        { id: "n", type: "snippet", beats: [{ id: "L", kind: "line", character: "A" }] },
      ] }],
    } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L: "hi" } });
    return dir;
  }

  for (const name of ["is-night", "9lives", "not", "is night"]) {
    it(`keeps '${name}' verbatim and reports it`, () => {
      const loaded = loadProject(makeIllegalProject(name));
      expect(loaded.project.properties?.[0]?.name).toBe(name);
      expect(validateProject({ project: loaded.project, scenes: loaded.scenes })
        .filter((i) => i.code === "invalid-declaration")).toHaveLength(1);
    });
  }
});
