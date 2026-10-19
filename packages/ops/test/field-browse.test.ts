// ---------------------------------------------------------------------------
// Field browse (family parity item 16): every node by a gameData field's value,
// for the search window's Field tab. The query is read by the family's shared
// matcher (`@wildwinter/toolkit` parseFieldQuery / fieldValueMatches), and the
// value tested is the one that holds: the node's own, else the declared default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runFieldBrowse, listGameDataFields } from "../src/index.js";

// Fields of every type on several node kinds; `mood` is declared on lines AND options, `act` on scenes. Some
// nodes set a value, the rest leave the default to hold.
function makeFieldProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-fields-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "f", name: "Fields" }, locales: { default: "en", all: ["en"] },
    gameDataFields: {
      scene: [{ name: "act", type: "number", default: 1 }],
      line: [
        { name: "mood", type: "enum", values: ["calm", "tense"] }, // no default: the first value holds
        { name: "note", type: "text" },
        { name: "loud", type: "boolean" },
        { name: "tags", type: "flags", values: ["bark", "vo"] },
      ],
      option: [{ name: "mood", type: "enum", values: ["calm", "tense"], default: "tense" }],
      snippet: [{ name: "cost", type: "number" }],
    },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Tavern", gameData: { act: 2 }, blocks: [
      { id: "b1", type: "block", name: "Intro", children: [
        { id: "n1", type: "snippet", gameData: { cost: 5 }, beats: [
          { id: "L1", kind: "line", character: "A", gameData: { mood: "tense", note: "Shout it", loud: true, tags: ["bark", "vo"] } },
          { id: "L2", kind: "line", character: "A" },
          { id: "T1", kind: "text" },
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "P1", kind: "line", character: "A" }, children: [] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "line", character: "A" }, gameData: { mood: "calm" }, children: [] },
        ] },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "Out!", L2: "Hush now.", T1: "The fire pops.", P1: "Stay", P2: "Go" } });
  return dir;
}

const loaded = loadProject(makeFieldProject());
const rows = (q: string) => runFieldBrowse(loaded, q).map((e) => ({ id: e.id, kind: e.kind, value: e.field!.value, isDefault: e.field!.isDefault }));

describe("listGameDataFields", () => {
  it("lists each declared field once, in declaration order, with the kinds declaring it", () => {
    expect(listGameDataFields(loaded)).toEqual([
      { name: "act", kinds: ["scene"] },
      { name: "mood", kinds: ["line", "option"] },
      { name: "note", kinds: ["line"] },
      { name: "loud", kinds: ["line"] },
      { name: "tags", kinds: ["line"] },
      { name: "cost", kinds: ["snippet"] },
    ]);
  });
});

describe("runFieldBrowse", () => {
  it("a bare field lists every declaring node with the value it holds, in project order", () => {
    expect(rows("mood")).toEqual([
      { id: "L1", kind: "beat", value: "tense", isDefault: false },
      { id: "L2", kind: "beat", value: "calm", isDefault: true }, // the enum's first value
      { id: "o1", kind: "group", value: "tense", isDefault: true }, // the option's declared default
      { id: "o2", kind: "group", value: "calm", isDefault: false },
    ]);
    // A text beat does not declare `mood`, so it is not listed. The row carries the field's name, type and preview.
    const hit = runFieldBrowse(loaded, "MOOD")[0]!;
    expect(hit.field).toEqual({ name: "mood", type: "enum", value: "tense", isDefault: false });
    expect(hit.text).toBe("Out!");
    expect(hit.location).toEqual(["Tavern", "Intro"]);
    expect(runFieldBrowse(loaded, "mood")[2]!.text).toBe("Stay"); // an option previews its prompt
  });

  it("= on an enum matches the value that holds, default included, and flags it", () => {
    expect(rows("mood = calm")).toEqual([
      { id: "L2", kind: "beat", value: "calm", isDefault: true },
      { id: "o2", kind: "group", value: "calm", isDefault: false },
    ]);
    expect(rows("mood = TENSE").map((r) => r.id)).toEqual(["L1", "o1"]);
  });

  it("= on text, boolean, flags and number", () => {
    expect(rows('note = "shout it"').map((r) => r.id)).toEqual(["L1"]);
    expect(rows("note =")).toEqual([{ id: "L2", kind: "beat", value: "", isDefault: true }]); // empty, by default
    expect(rows("loud = true").map((r) => r.id)).toEqual(["L1"]);
    expect(rows("loud = false")).toEqual([{ id: "L2", kind: "beat", value: "false", isDefault: true }]);
    expect(rows("tags = vo")).toEqual([{ id: "L1", kind: "beat", value: "bark, vo", isDefault: false }]);
    expect(rows('tags = ""').map((r) => r.id)).toEqual(["L2"]); // no flags set
    expect(rows("cost = 5.0")).toEqual([{ id: "n1", kind: "snippet", value: "5", isDefault: false }]);
    expect(rows("act = 2")).toEqual([{ id: "s1", kind: "scene", value: "2", isDefault: false }]);
  });

  it("!= is the opposite of =", () => {
    expect(rows("mood != calm").map((r) => r.id)).toEqual(["L1", "o1"]);
    expect(rows("loud != true").map((r) => r.id)).toEqual(["L2"]);
  });

  it("an unknown field, or a query that is not a field name, finds nothing", () => {
    expect(runFieldBrowse(loaded, "weather")).toEqual([]);
    expect(runFieldBrowse(loaded, "weather = wet")).toEqual([]);
    expect(runFieldBrowse(loaded, "@gold > 3")).toEqual([]);
    expect(runFieldBrowse(loaded, "")).toEqual([]);
  });

  it("floats the caret's scene first when given a focus", () => {
    expect(runFieldBrowse(loaded, "mood", { sceneId: "s1" }).map((e) => e.id)).toEqual(["L1", "L2", "o1", "o2"]);
  });
});
