// ---------------------------------------------------------------------------
// Tag browse (#215): list the project's author tags and every node that carries
// one, for the search window's Tag tab. Own tags only (not the runtime union).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runTagBrowse, listProjectTags } from "../src/index.js";

// A tiny project with tags at several levels: a scene tag, a block tag, a snippet tag, and a beat tag,
// with "barked" reused so counts and multi-node browse can be checked.
function makeTaggedProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-tags-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", { schema: "patter/project@0", project: { id: "t", name: "Tagged" }, locales: { default: "en", all: ["en"] } });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Tavern", tags: ["act1"], blocks: [
      { id: "b1", type: "block", name: "Intro", tags: ["hub"], children: [
        { id: "n1", type: "snippet", tags: ["barked"], beats: [{ id: "L1", kind: "line", character: "A" }] },
        { id: "n2", type: "snippet", beats: [
          { id: "L2", kind: "line", character: "A", tags: ["barked"] },
          { id: "L3", kind: "text" },
        ] },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en",
    strings: { L1: "Aye?", L2: "Hush now.", L3: "The fire pops." } });
  return dir;
}

const loaded = loadProject(makeTaggedProject());

describe("listProjectTags", () => {
  it("lists every distinct tag with a node count, sorted alphabetically", () => {
    expect(listProjectTags(loaded)).toEqual([
      { name: "act1", count: 1 },
      { name: "barked", count: 2 }, // the snippet n1 + the beat L2
      { name: "hub", count: 1 },
    ]);
  });
});

describe("runTagBrowse", () => {
  it("finds a tag applied at scene / block level (returns that node)", () => {
    expect(runTagBrowse(loaded, "act1").map((e) => ({ id: e.id, kind: e.kind }))).toEqual([{ id: "s1", kind: "scene" }]);
    expect(runTagBrowse(loaded, "hub").map((e) => e.id)).toEqual(["b1"]);
  });

  it("finds every node carrying a reused tag (a snippet AND a beat)", () => {
    const hits = runTagBrowse(loaded, "barked");
    expect(hits.map((e) => ({ id: e.id, kind: e.kind }))).toEqual([
      { id: "n1", kind: "snippet" }, // matched on its own tag; previews its first beat
      { id: "L2", kind: "beat" },
    ]);
    expect(hits[0]!.text).toBe("Aye?"); // snippet preview = first beat's source text
    expect(hits[1]!.text).toBe("Hush now.");
  });

  it("returns nothing for an unknown tag (and an empty tag)", () => {
    expect(runTagBrowse(loaded, "nope")).toEqual([]);
    expect(runTagBrowse(loaded, "")).toEqual([]);
  });
});
