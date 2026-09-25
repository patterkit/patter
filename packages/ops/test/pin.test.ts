// ---------------------------------------------------------------------------
// planPins: pin on publish. Expectations hand-written from the tavern fixture,
// whose one scene ("Tavern") and one block ("Intro") both still follow their
// names, and from copies of it that pin one by hand, name one "???", and apply
// the plan to check nothing is left and no address moved.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { effectiveGameId } from "@patterkit/model";
import type { FlowFile } from "@patterkit/model";
import { loadProject, planPins, runExport } from "../src/index.js";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const flowOf = (dir: string): string => join(dir, "scenes", "tavern.patterflow");

/** A scratch copy of the fixture, with `edit` applied to the flow shard through the parser. */
function copyWith(edit?: (flow: FlowFile) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "pin-"));
  cpSync(fixtureDir, dir, { recursive: true });
  if (edit) {
    const flow = parseSource(readFileSync(flowOf(dir), "utf8")) as FlowFile;
    edit(flow);
    writeFileSync(flowOf(dir), canonicalStringify(flow));
  }
  return dir;
}

describe("planPins", () => {
  it("pins the scene and its block at the addresses they already had, in one flow-shard write", () => {
    const plan = planPins(loadProject(fixtureDir));
    expect(plan.pinned).toEqual([
      { id: "scn_tavern", kind: "scene", sceneId: "scn_tavern", gameId: "tavern" },
      { id: "blk_intro", kind: "block", sceneId: "scn_tavern", gameId: "intro" },
    ]);
    expect(plan.writes.map((w) => w.path)).toEqual([flowOf(fixtureDir)]);
    const written = parseSource(plan.writes[0]!.content) as FlowFile;
    expect(written.schema).toBe("patter/flow@0");
    expect([written.scene.gameId, written.scene.blocks[0]!.gameId]).toEqual(["tavern", "intro"]);
    expect(plan.scenes).toEqual([written.scene]);
  });

  it("leaves an address pinned by hand alone, even one that differs from its name", () => {
    const dir = copyWith((f) => { f.scene.gameId = "the-tavern"; });
    const plan = planPins(loadProject(dir));
    expect(plan.pinned.map((p) => p.id)).toEqual(["blk_intro"]);
    expect((parseSource(plan.writes[0]!.content) as FlowFile).scene.gameId).toBe("the-tavern");
  });

  it("treats a blank Game ID as not pinned, and skips a name that slugs to nothing", () => {
    const dir = copyWith((f) => { f.scene.gameId = "  "; f.scene.blocks[0]!.name = "???"; });
    expect(planPins(loadProject(dir)).pinned).toEqual([
      { id: "scn_tavern", kind: "scene", sceneId: "scn_tavern", gameId: "tavern" },
    ]);
  });

  it("moves no address in the bundle, and has nothing left to do once applied", () => {
    const dir = copyWith();
    const addresses = (d: string): string[] =>
      Object.values(runExport(loadProject(d)).scenes).flatMap((s) => [effectiveGameId(s), ...s.blocks.map((b) => `${effectiveGameId(s)}.${effectiveGameId(b)}`)]);
    const before = addresses(dir);
    for (const w of planPins(loadProject(dir)).writes) writeFileSync(w.path, w.content);
    expect(addresses(dir)).toEqual(before);
    expect(planPins(loadProject(dir))).toEqual({ pinned: [], writes: [], scenes: [] });
  });
});
