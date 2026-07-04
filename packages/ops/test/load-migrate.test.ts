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
