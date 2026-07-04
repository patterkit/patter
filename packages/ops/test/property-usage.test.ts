// ---------------------------------------------------------------------------
// Property-usage search: find every node that references a property in a
// condition, an effect, or interpolated text: the "@x is in this dead branch's
// condition; where else is @x used?" path off the coverage report.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runPropertyUsage } from "../src/index.js";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-propusage-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "pu", name: "PU" },
    locales: { default: "en", all: ["en"] },
    properties: [
      { name: "gold", type: "number", default: 0 },
      { name: "faction", type: "enum", values: ["crown", "rebels"], default: "crown" },
    ],
    scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number" }] }] },
  });

  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", onEnter: [{ kind: "set", target: "@gold", value: "@gold + 5" }],
          beats: [{ id: "L1", kind: "line", character: "A" }] },
        { id: "n2", type: "snippet", condition: "@gold >= 10", beats: [{ id: "L2", kind: "line", character: "A" }] },
        { id: "n3", type: "snippet", condition: "@world.threat >= 50", beats: [{ id: "L3", kind: "line", character: "A" }] },
        { id: "n4", type: "snippet", condition: "@faction == \"rebels\"", beats: [{ id: "L4", kind: "line", character: "A" }] },
      ] },
    ] } });

  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "You have {@gold} gold.", L2: "rich", L3: "danger", L4: "rebel" } });

  return dir;
}

describe("runPropertyUsage", () => {
  const loaded = loadProject(makeProject());
  const usages = (q: string) => runPropertyUsage(loaded, q).map((e) => ({ id: e.id, text: e.text }));

  it("finds a property in conditions, effects, and interpolated text", () => {
    const ids = usages("gold").map((u) => u.id).sort();
    // n1 (onEnter set), L1 (interpolation), n2 (condition). Not n3/n4.
    expect(ids).toEqual(["L1", "n1", "n2"]);
  });

  it("accepts a bare name or the @-prefixed form", () => {
    expect(runPropertyUsage(loaded, "@gold").length).toBe(runPropertyUsage(loaded, "gold").length);
  });

  it("matches a scoped host-scope ref exactly (not other scopes' same name)", () => {
    expect(usages("world.threat").map((u) => u.id)).toEqual(["n3"]);
    expect(usages("threat").map((u) => u.id)).toEqual([]); // bare 'threat' is @patter.threat, which is unused
  });

  it("narrows to a value when one is given", () => {
    expect(usages("faction rebels").map((u) => u.id)).toEqual(["n4"]);
    expect(usages("faction crown").map((u) => u.id)).toEqual([]); // no usage mentions 'crown'
  });

  it("describes each usage in its text (condition / effect / string)", () => {
    const byId = Object.fromEntries(usages("gold").map((u) => [u.id, u.text]));
    expect(byId["n2"]).toBe("if @gold >= 10");
    expect(byId["n1"]).toContain("set @gold = @gold + 5");
    expect(byId["L1"]).toBe("You have {@gold} gold.");
  });

  it("returns nothing for an unused / unparsable query", () => {
    expect(runPropertyUsage(loaded, "nope")).toEqual([]);
    expect(runPropertyUsage(loaded, "")).toEqual([]);
  });
});
