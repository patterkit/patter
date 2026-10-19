// ---------------------------------------------------------------------------
// runReplace: project-wide find-and-replace over the source-language prose,
// and over text and multiline gameData values (family parity item 16).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseSource } from "@patterkit/core";
import { loadProject, runReplace } from "../src/index.js";
import type { FlowFile } from "@patterkit/model";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const loaded = loadProject(fixtureDir); // one string: L_1 = "Welcome." in scene scn_tavern

describe("runReplace", () => {
  it("plans a hit + a shard write for a matched string", () => {
    const plan = runReplace(loaded, { query: "Welcome", replacement: "Hello" });
    expect(plan.hits).toHaveLength(1);
    expect(plan.hits[0]).toMatchObject({ id: "L_1", field: "text", sceneId: "scn_tavern", before: "Welcome.", after: "Hello." });
    expect(plan.scenes).toBe(1);
    expect(plan.writes).toHaveLength(2); // the string shard, then the authoring shard stamping modifiedAt
    expect(plan.writes[0]!.path).toMatch(/tavern\.patterloc$/);
    expect(plan.writes[1]!.path).toMatch(/tavern\.patterx$/);
    expect(plan.writes[0]!.content).toContain('"Hello."'); // canonical shard carries the new text
    expect(plan.writes[0]!.content).not.toContain("Welcome");
    // location breadcrumb for the preview (scene › block).
    expect(plan.hits[0]!.location[0]).toBe("Tavern");
  });

  it("is case-insensitive by default, case-sensitive on request", () => {
    expect(runReplace(loaded, { query: "welcome", replacement: "Hi" }).hits).toHaveLength(1); // default: matches "Welcome"
    expect(runReplace(loaded, { query: "welcome", replacement: "Hi", caseSensitive: true }).hits).toHaveLength(0);
  });

  it("matches whole words only when asked", () => {
    expect(runReplace(loaded, { query: "Welcom", replacement: "X" }).hits).toHaveLength(1); // substring matches
    expect(runReplace(loaded, { query: "Welcom", replacement: "X", wholeWord: true }).hits).toHaveLength(0);
    expect(runReplace(loaded, { query: "Welcome", replacement: "X", wholeWord: true }).hits).toHaveLength(1);
  });

  it("treats the query + replacement as literal text (no regex / $ surprises)", () => {
    // A query with regex metacharacters matches literally (no match here → no false hit).
    expect(runReplace(loaded, { query: "Welc.me", replacement: "X" }).hits).toHaveLength(0);
    // A `$&`-style replacement is inserted verbatim, not expanded.
    const plan = runReplace(loaded, { query: "Welcome", replacement: "$&!" });
    expect(plan.hits[0]!.after).toBe("$&!.");
  });

  it("scopes to a single beat with onlyId", () => {
    expect(runReplace(loaded, { query: "Welcome", replacement: "Hi", onlyId: "L_1" }).hits).toHaveLength(1);
    expect(runReplace(loaded, { query: "Welcome", replacement: "Hi", onlyId: "L_999" }).hits).toHaveLength(0);
  });

  it("returns an empty plan for an empty query or no match", () => {
    expect(runReplace(loaded, { query: "", replacement: "x" }).writes).toHaveLength(0);
    expect(runReplace(loaded, { query: "nothinghere", replacement: "x" }).writes).toHaveLength(0);
  });
});

// gameData fields of several types on several node kinds, every one holding "storm" somewhere, so only the
// text and multiline ones may change.
function makeFieldProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-replace-fields-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "f", name: "Fields" }, locales: { default: "en", all: ["en"] },
    gameDataFields: {
      scene: [{ name: "brief", type: "multiline" }],
      line: [
        { name: "note", type: "text" },
        { name: "weather", type: "enum", values: ["storm", "calm"] },
        { name: "tense", type: "quality", stages: ["storm", "calm"] },
      ],
      option: [{ name: "note", type: "text", default: "storm default" }],
      snippet: [{ name: "cue", type: "text" }],
    },
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Tavern", gameData: { brief: "A storm.\nThen another storm." }, blocks: [
      { id: "b1", type: "block", name: "Intro", gameData: { note: "storm" }, children: [
        { id: "n1", type: "snippet", gameData: { cue: "thunder" }, beats: [
          { id: "L1", kind: "line", character: "A", gameData: { note: "Say storm softly", weather: "storm", tense: "storm" } },
        ] },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "P1", kind: "line", character: "A" }, children: [] },
          { id: "o2", type: "group", prompt: { id: "P2", kind: "line", character: "A" }, gameData: { note: "Storm out" }, children: [] },
        ] },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "A storm is coming.", P1: "Stay", P2: "Go" } });
  return dir;
}

describe("runReplace over gameData values", () => {
  const fields = loadProject(makeFieldProject());
  const flowOf = (plan: ReturnType<typeof runReplace>) => (parseSource(plan.writes.at(-1)!.content) as FlowFile).scene;

  it("replaces text and multiline values a node sets, alongside the prose, and nothing else", () => {
    const plan = runReplace(fields, { query: "storm", replacement: "gale" });
    expect(plan.hits.map((h) => `${h.id} ${h.field}`)).toEqual([
      "L1 text", "s1 field:brief", "L1 field:note", "o2 field:note",
    ]);
    expect(plan.hits.find((h) => h.field === "field:brief")).toMatchObject({ sceneId: "s1", location: ["Tavern"], before: "A storm.\nThen another storm.", after: "A gale.\nThen another gale." });
    expect(plan.hits.find((h) => h.id === "o2")).toMatchObject({ location: ["Tavern", "Intro"], after: "gale out" });
    expect(plan.scenes).toBe(1);
    // The flow shard is the last write, and the rewritten scene is handed back to swap in.
    expect(plan.flows).toHaveLength(1);
    expect(plan.writes.at(-1)!.path).toMatch(/one\.patterflow$/);
    const scene = flowOf(plan);
    expect(scene).toEqual(plan.flows[0]!.scene);
    const beat = (scene.blocks[0]!.children[0] as { beats: Array<{ gameData: Record<string, unknown> }> }).beats[0]!;
    // An enum and a quality hold a choice and a stage, not prose: left alone, as is a field the kind doesn't
    // declare (a block's `note`), and the option default nobody set.
    expect(beat.gameData).toEqual({ note: "Say gale softly", weather: "storm", tense: "storm" });
    expect(scene.blocks[0]!.gameData).toEqual({ note: "storm" });
    // The loaded project is untouched.
    expect(fields.scenes[0]!.gameData).toEqual({ brief: "A storm.\nThen another storm." });
  });

  it("stamps no modifiedAt for a field: a gameData value has no translations to go stale", () => {
    const plan = runReplace(fields, { query: "Storm out", replacement: "Leave" });
    expect(plan.hits).toHaveLength(1);
    expect(plan.authoring).toHaveLength(0);
    expect(plan.writes).toHaveLength(1);
  });

  it("scopes to one node's one text with onlyId and onlyField", () => {
    const one = runReplace(fields, { query: "storm", replacement: "gale", onlyId: "L1", onlyField: "field:note" });
    expect(one.hits.map((h) => `${h.id} ${h.field}`)).toEqual(["L1 field:note"]);
    expect(one.shards).toHaveLength(0);
    const prose = runReplace(fields, { query: "storm", replacement: "gale", onlyId: "L1", onlyField: "text" });
    expect(prose.hits.map((h) => `${h.id} ${h.field}`)).toEqual(["L1 text"]);
    expect(prose.flows).toHaveLength(0);
    // onlyId alone takes every text of that node, as Storyletter's does.
    expect(runReplace(fields, { query: "storm", replacement: "gale", onlyId: "L1" }).hits).toHaveLength(2);
  });
});
